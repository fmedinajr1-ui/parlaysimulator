import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Map prop types to their corresponding stat columns in nba_player_game_logs
const PROP_TO_STAT_MAP: Record<string, string | string[]> = {
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_threes': 'threes_made',
  'player_blocks': 'blocks',
  'player_steals': 'steals',
  'player_turnovers': 'turnovers',
  // Combo props
  'player_points_rebounds': ['points', 'rebounds'],
  'player_points_assists': ['points', 'assists'],
  'player_rebounds_assists': ['rebounds', 'assists'],
  'player_points_rebounds_assists': ['points', 'rebounds', 'assists'],
  // Alternate formats
  'points': 'points',
  'rebounds': 'rebounds',
  'assists': 'assists',
  'threes': 'threes_made',
  'blocks': 'blocks',
  'steals': 'steals',
  'pts+reb': ['points', 'rebounds'],
  'pts+ast': ['points', 'assists'],
  'reb+ast': ['rebounds', 'assists'],
  'pts+reb+ast': ['points', 'rebounds', 'assists'],
};

function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateActualValue(gameLog: any, propType: string): number | null {
  const statKey = PROP_TO_STAT_MAP[propType.toLowerCase()];
  
  if (!statKey) {
    console.log(`[verify-risk-engine-outcomes] Unknown prop type: ${propType}`);
    return null;
  }
  
  if (Array.isArray(statKey)) {
    // Combo prop - sum all stats
    let total = 0;
    for (const key of statKey) {
      const value = gameLog[key];
      if (value === null || value === undefined) return null;
      total += Number(value);
    }
    return total;
  } else {
    const value = gameLog[statKey];
    return value !== null && value !== undefined ? Number(value) : null;
  }
}

function determineOutcome(actualValue: number, line: number, side: string): 'hit' | 'miss' | 'push' {
  if (actualValue === line) return 'push';
  
  const wentOver = actualValue > line;
  const betOver = side.toLowerCase() === 'over';
  
  if ((wentOver && betOver) || (!wentOver && !betOver)) {
    return 'hit';
  }
  return 'miss';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[verify-risk-engine-outcomes] Starting outcome verification...');

    // Get today and yesterday's date in YYYY-MM-DD format
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const todayStr = today.toISOString().split('T')[0];
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // Fetch pending picks from the last 2 days
    const { data: pendingPicks, error: picksError } = await supabase
      .from('nba_risk_engine_picks')
      .select('id, player_name, prop_type, line, side, game_date, outcome')
      .in('game_date', [todayStr, yesterdayStr])
      .or('outcome.is.null,outcome.eq.pending')
      .limit(100);

    if (picksError) {
      console.error('[verify-risk-engine-outcomes] Error fetching picks:', picksError);
      throw picksError;
    }

    console.log(`[verify-risk-engine-outcomes] Found ${pendingPicks?.length || 0} pending picks to verify`);

    if (!pendingPicks || pendingPicks.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No pending picks to verify',
        verified: 0,
        hits: 0,
        misses: 0,
        pushes: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get unique player names
    const playerNames = [...new Set(pendingPicks.map(p => p.player_name))];
    
    // Fetch game logs for these players
    const { data: gameLogs, error: logsError } = await supabase
      .from('nba_player_game_logs')
      .select('*')
      .in('player_name', playerNames)
      .in('game_date', [todayStr, yesterdayStr]);

    if (logsError) {
      console.error('[verify-risk-engine-outcomes] Error fetching game logs:', logsError);
      throw logsError;
    }

    console.log(`[verify-risk-engine-outcomes] Found ${gameLogs?.length || 0} game logs`);

    // Create lookup map for game logs
    const logMap = new Map<string, any>();
    for (const log of (gameLogs || [])) {
      const key = `${normalizePlayerName(log.player_name)}_${log.game_date}`;
      logMap.set(key, log);
    }

    // Process each pick
    let verified = 0;
    let hits = 0;
    let misses = 0;
    let pushes = 0;
    const updates: { id: string; outcome: string; actual_value: number }[] = [];

    for (const pick of pendingPicks) {
      const lookupKey = `${normalizePlayerName(pick.player_name)}_${pick.game_date}`;
      const gameLog = logMap.get(lookupKey);

      if (!gameLog) {
        console.log(`[verify-risk-engine-outcomes] No game log found for ${pick.player_name} on ${pick.game_date}`);
        continue;
      }

      const actualValue = calculateActualValue(gameLog, pick.prop_type);
      
      if (actualValue === null) {
        console.log(`[verify-risk-engine-outcomes] Could not calculate actual value for ${pick.player_name} ${pick.prop_type}`);
        continue;
      }

      const outcome = determineOutcome(actualValue, pick.line, pick.side);
      
      updates.push({
        id: pick.id,
        outcome,
        actual_value: actualValue
      });

      if (outcome === 'hit') hits++;
      else if (outcome === 'miss') misses++;
      else pushes++;
      
      verified++;
      
      console.log(`[verify-risk-engine-outcomes] ${pick.player_name} ${pick.prop_type} ${pick.side} ${pick.line}: actual=${actualValue} → ${outcome}`);
    }

    // Batch update all picks
    if (updates.length > 0) {
      for (const update of updates) {
        const { error: updateError } = await supabase
          .from('nba_risk_engine_picks')
          .update({
            outcome: update.outcome,
            actual_value: update.actual_value,
            verified_at: new Date().toISOString()
          })
          .eq('id', update.id);

        if (updateError) {
          console.error(`[verify-risk-engine-outcomes] Error updating pick ${update.id}:`, updateError);
        }
      }
    }

    // Log to cron job history
    await supabase.from('cron_job_history').insert({
      job_name: 'verify-risk-engine-outcomes',
      status: 'success',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      result: { verified, hits, misses, pushes, total_pending: pendingPicks.length }
    });

    console.log(`[verify-risk-engine-outcomes] Complete: ${verified} verified (${hits}H/${misses}M/${pushes}P)`);

    return new Response(JSON.stringify({
      success: true,
      verified,
      hits,
      misses,
      pushes,
      hitRate: verified > 0 ? ((hits / verified) * 100).toFixed(1) : '0'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('[verify-risk-engine-outcomes] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
