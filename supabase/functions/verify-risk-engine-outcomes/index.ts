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

// Fuzzy name matching - handles variations like "Jr." vs "Jr", spacing differences
function fuzzyMatchPlayerName(pickName: string, logName: string): boolean {
  const normPick = normalizePlayerName(pickName);
  const normLog = normalizePlayerName(logName);
  
  // Exact match
  if (normPick === normLog) return true;
  
  // One contains the other (handles Jr./Jr, III, etc.)
  if (normPick.includes(normLog) || normLog.includes(normPick)) return true;
  
  // Split and compare first/last name
  const pickParts = normPick.split(' ');
  const logParts = normLog.split(' ');
  
  if (pickParts.length >= 2 && logParts.length >= 2) {
    // Match first name + first 4 chars of last name
    const pickFirst = pickParts[0];
    const logFirst = logParts[0];
    const pickLast = pickParts[pickParts.length - 1].substring(0, 4);
    const logLast = logParts[logParts.length - 1].substring(0, 4);
    
    if (pickFirst === logFirst && pickLast === logLast) return true;
  }
  
  return false;
}

// Get date range for matching (handles timezone edge cases)
function getDateRange(dateStr: string): string[] {
  const date = new Date(dateStr);
  const prevDay = new Date(date);
  prevDay.setDate(prevDay.getDate() - 1);
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  
  return [
    prevDay.toISOString().split('T')[0],
    dateStr,
    nextDay.toISOString().split('T')[0]
  ];
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

    // Fetch pending picks from the last 3 days (handles timezone edge cases)
    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 2);
    const threeDaysAgoStr = threeDaysAgo.toISOString().split('T')[0];
    
    const { data: pendingPicks, error: picksError } = await supabase
      .from('nba_risk_engine_picks')
      .select('id, player_name, prop_type, line, side, game_date, outcome, created_at')
      .gte('game_date', threeDaysAgoStr)
      .lte('game_date', todayStr)
      .or('outcome.is.null,outcome.eq.pending')
      .limit(200);

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

    // Fetch game logs for the date range (broader to catch timezone edge cases)
    const { data: gameLogs, error: logsError } = await supabase
      .from('nba_player_game_logs')
      .select('*')
      .gte('game_date', threeDaysAgoStr)
      .lte('game_date', todayStr);

    if (logsError) {
      console.error('[verify-risk-engine-outcomes] Error fetching game logs:', logsError);
      throw logsError;
    }

    console.log(`[verify-risk-engine-outcomes] Found ${gameLogs?.length || 0} game logs`);

    console.log(`[verify-risk-engine-outcomes] Found ${gameLogs?.length || 0} game logs`);

    // Fetch upcoming game times from unified_props to avoid grading future games
    const { data: upcomingProps } = await supabase
      .from('unified_props')
      .select('player_name, commence_time')
      .gte('commence_time', new Date().toISOString());
    
    // Map player -> earliest upcoming game time AND game date
    const upcomingPlayersMap = new Map<string, { gameTime: Date; gameDate: string }>();
    for (const prop of upcomingProps || []) {
      if (prop.player_name && prop.commence_time) {
        const playerKey = prop.player_name.toLowerCase().trim();
        const gameTime = new Date(prop.commence_time);
        const gameDate = gameTime.toISOString().split('T')[0];
        
        // Only store if not already set (keep earliest)
        if (!upcomingPlayersMap.has(playerKey)) {
          upcomingPlayersMap.set(playerKey, { gameTime, gameDate });
        }
      }
    }
    console.log(`[verify-risk-engine-outcomes] Found ${upcomingPlayersMap.size} players with upcoming games`);

    // Process each pick with fuzzy matching
    let verified = 0;
    let hits = 0;
    let misses = 0;
    let pushes = 0;
    let skippedFuture = 0;
    const updates: { id: string; outcome: string; actual_value: number }[] = [];

    for (const pick of pendingPicks) {
      const normalizedPickName = pick.player_name.toLowerCase().trim();
      const upcomingGame = upcomingPlayersMap.get(normalizedPickName);
      const now = new Date();
      
      // Check 1: Skip if game hasn't started yet
      if (upcomingGame && upcomingGame.gameTime > now) {
        console.log(`[verify-risk-engine-outcomes] Skipping ${pick.player_name} - game hasn't started yet (${upcomingGame.gameTime.toISOString()})`);
        skippedFuture++;
        continue;
      }
      
      // Check 2: Skip if pick's game_date matches an upcoming game date (prevents grading with yesterday's logs)
      if (upcomingGame && pick.game_date === upcomingGame.gameDate) {
        // Game might have started but estimate ~3 hours to complete
        const estimatedGameEnd = new Date(upcomingGame.gameTime.getTime() + 3 * 60 * 60 * 1000);
        if (now < estimatedGameEnd) {
          console.log(`[verify-risk-engine-outcomes] Skipping ${pick.player_name} - game in progress, ends ~${estimatedGameEnd.toISOString()}`);
          skippedFuture++;
          continue;
        }
      }

      // Check 3: For recent picks (created in last 24h), require EXACT date match to prevent cross-day grading
      const pickCreatedAt = new Date(pick.created_at || pick.game_date);
      const isRecentPick = (now.getTime() - pickCreatedAt.getTime()) < 24 * 60 * 60 * 1000;
      
      // Recent picks = exact date only. Older picks = ±1 day tolerance for timezone edge cases
      const dateRange = isRecentPick ? [pick.game_date] : getDateRange(pick.game_date);
      
      // Find matching game log with fuzzy name matching and date tolerance
      const gameLog = (gameLogs || []).find(log => 
        fuzzyMatchPlayerName(pick.player_name, log.player_name) &&
        dateRange.includes(log.game_date)
      );
      
      // Extra safety: if we found a log but pick.game_date != log.game_date for today's picks, skip
      if (gameLog && pick.game_date === todayStr && gameLog.game_date !== todayStr) {
        console.log(`[verify-risk-engine-outcomes] Skipping ${pick.player_name} - pick is for today but matched yesterday's log`);
        skippedFuture++;
        continue;
      }

      if (!gameLog) {
        console.log(`[verify-risk-engine-outcomes] No game log found for ${pick.player_name} on ${pick.game_date} (checked ${dateRange.join(', ')})`);
        continue;
      }
      
      console.log(`[verify-risk-engine-outcomes] Matched ${pick.player_name} → ${gameLog.player_name} on ${gameLog.game_date}`);

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
            settled_at: new Date().toISOString()
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
      result: { verified, hits, misses, pushes, skippedFuture, total_pending: pendingPicks.length }
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
