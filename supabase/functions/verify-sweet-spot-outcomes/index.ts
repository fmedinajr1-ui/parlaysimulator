import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Normalize player names for matching
const normalizeName = (s: string): string =>
  (s || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// Map prop_type to stat field in game logs
const propTypeToStat: Record<string, string> = {
  'points': 'points',
  'pts': 'points',
  'rebounds': 'rebounds',
  'reb': 'rebounds',
  'assists': 'assists',
  'ast': 'assists',
  'threes': 'threes_made',
  'three_pointers': 'threes_made',
  '3pt': 'threes_made',
  'steals': 'steals',
  'stl': 'steals',
  'blocks': 'blocks',
  'blk': 'blocks',
  'turnovers': 'turnovers',
  'to': 'turnovers',
  // Combos
  'pra': 'pra',
  'points_rebounds_assists': 'pra',
  'pr': 'pr',
  'points_rebounds': 'pr',
  'pa': 'pa',
  'points_assists': 'pa',
  'ra': 'ra',
  'rebounds_assists': 'ra',
};

// Extract stat value from game log
const extractStatValue = (gameLog: any, propType: string): number | null => {
  const normalizedProp = propType.toLowerCase().replace(/[\s_-]+/g, '_');
  const statField = propTypeToStat[normalizedProp];
  
  if (!statField) {
    // Try direct field access
    if (gameLog[normalizedProp] !== undefined) {
      return Number(gameLog[normalizedProp]);
    }
    console.log(`Unknown prop type: ${propType}`);
    return null;
  }
  
  // Handle combo stats
  if (statField === 'pra') {
    const pts = Number(gameLog.points) || 0;
    const reb = Number(gameLog.rebounds) || 0;
    const ast = Number(gameLog.assists) || 0;
    return pts + reb + ast;
  }
  if (statField === 'pr') {
    return (Number(gameLog.points) || 0) + (Number(gameLog.rebounds) || 0);
  }
  if (statField === 'pa') {
    return (Number(gameLog.points) || 0) + (Number(gameLog.assists) || 0);
  }
  if (statField === 'ra') {
    return (Number(gameLog.rebounds) || 0) + (Number(gameLog.assists) || 0);
  }
  
  const value = gameLog[statField];
  return value !== undefined ? Number(value) : null;
};

// Determine outcome with push handling
const determineOutcome = (actual: number, line: number, side: string): 'hit' | 'miss' | 'push' => {
  if (actual === line) return 'push';
  
  const normalizedSide = side.toLowerCase();
  if (normalizedSide === 'over' || normalizedSide === 'o') {
    return actual > line ? 'hit' : 'miss';
  }
  // Under
  return actual < line ? 'hit' : 'miss';
};

// Get Eastern date string
const getEasternDate = (daysAgo: number = 0): string => {
  const now = new Date();
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  eastern.setDate(eastern.getDate() - daysAgo);
  return eastern.toISOString().split('T')[0];
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request body
    let targetDate: string;
    try {
      const body = await req.json();
      targetDate = body.date || getEasternDate(1); // Default to yesterday ET
    } catch {
      targetDate = getEasternDate(1);
    }

    console.log(`[verify-sweet-spot-outcomes] Starting verification for date: ${targetDate}`);

    // Step 1: Fetch pending picks for the target date
    const { data: pendingPicks, error: fetchError } = await supabase
      .from('category_sweet_spots')
      .select('id, player_name, prop_type, recommended_side, recommended_line, actual_line, category, l10_hit_rate, confidence_score')
      .eq('analysis_date', targetDate)
      .eq('outcome', 'pending')
      .eq('is_active', true);

    if (fetchError) {
      throw new Error(`Failed to fetch pending picks: ${fetchError.message}`);
    }

    if (!pendingPicks || pendingPicks.length === 0) {
      console.log(`[verify-sweet-spot-outcomes] No pending picks found for ${targetDate}`);
      return new Response(JSON.stringify({
        success: true,
        date: targetDate,
        message: 'No pending picks to verify',
        summary: { total: 0, verified: 0, noData: 0, hits: 0, misses: 0, pushes: 0 }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[verify-sweet-spot-outcomes] Found ${pendingPicks.length} pending picks`);

    // Step 2: Fetch all game logs for the target date
    const { data: gameLogs, error: logsError } = await supabase
      .from('nba_player_game_logs')
      .select('player_name, game_date, points, rebounds, assists, threes_made, steals, blocks, turnovers')
      .eq('game_date', targetDate);

    if (logsError) {
      throw new Error(`Failed to fetch game logs: ${logsError.message}`);
    }

    console.log(`[verify-sweet-spot-outcomes] Found ${gameLogs?.length || 0} game logs for ${targetDate}`);

    // Build normalized name lookup
    const gameLogMap = new Map<string, any>();
    for (const log of gameLogs || []) {
      const normalizedName = normalizeName(log.player_name);
      gameLogMap.set(normalizedName, log);
    }

    // Step 3: Match and verify each pick
    const results = {
      total: pendingPicks.length,
      verified: 0,
      noData: 0,
      hits: 0,
      misses: 0,
      pushes: 0,
      details: [] as any[]
    };

    const updates: { id: string; actual_value: number | null; outcome: string; settled_at: string; verified_source: string }[] = [];

    for (const pick of pendingPicks) {
      const normalizedPlayerName = normalizeName(pick.player_name);
      const gameLog = gameLogMap.get(normalizedPlayerName);

      if (!gameLog) {
        // No game log found - player may not have played
        updates.push({
          id: pick.id,
          actual_value: null,
          outcome: 'no_data',
          settled_at: new Date().toISOString(),
          verified_source: 'nba_player_game_logs'
        });
        results.noData++;
        results.details.push({
          player: pick.player_name,
          propType: pick.prop_type,
          status: 'no_data',
          reason: 'No game log found'
        });
        continue;
      }

      // Extract the stat value
      const actualValue = extractStatValue(gameLog, pick.prop_type);
      
      if (actualValue === null) {
        updates.push({
          id: pick.id,
          actual_value: null,
          outcome: 'no_data',
          settled_at: new Date().toISOString(),
          verified_source: 'nba_player_game_logs'
        });
        results.noData++;
        results.details.push({
          player: pick.player_name,
          propType: pick.prop_type,
          status: 'no_data',
          reason: `Could not extract stat for prop type: ${pick.prop_type}`
        });
        continue;
      }

      // Determine outcome - prioritize actual_line over recommended_line
      const line = pick.actual_line || pick.recommended_line || 0;
      const side = pick.recommended_side || 'over';
      const outcome = determineOutcome(actualValue, line, side);

      updates.push({
        id: pick.id,
        actual_value: actualValue,
        outcome,
        settled_at: new Date().toISOString(),
        verified_source: 'nba_player_game_logs'
      });

      results.verified++;
      if (outcome === 'hit') results.hits++;
      else if (outcome === 'miss') results.misses++;
      else results.pushes++;

      results.details.push({
        player: pick.player_name,
        propType: pick.prop_type,
        side,
        line,
        actual: actualValue,
        outcome,
        l10HitRate: pick.l10_hit_rate,
        confidence: pick.confidence_score
      });
    }

    // Step 4: Batch update all picks
    console.log(`[verify-sweet-spot-outcomes] Updating ${updates.length} picks...`);
    
    for (const update of updates) {
      const { error: updateError } = await supabase
        .from('category_sweet_spots')
        .update({
          actual_value: update.actual_value,
          outcome: update.outcome,
          settled_at: update.settled_at,
          verified_source: update.verified_source
        })
        .eq('id', update.id);

      if (updateError) {
        console.error(`Failed to update pick ${update.id}: ${updateError.message}`);
      }
    }

    // Step 5: Log to cron_job_history
    const duration = Date.now() - startTime;
    await supabase.from('cron_job_history').insert({
      job_name: 'verify-sweet-spot-outcomes',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: {
        date: targetDate,
        summary: {
          total: results.total,
          verified: results.verified,
          noData: results.noData,
          hits: results.hits,
          misses: results.misses,
          pushes: results.pushes,
          hitRate: results.verified > 0 ? (results.hits / (results.hits + results.misses)).toFixed(4) : null
        }
      }
    });

    console.log(`[verify-sweet-spot-outcomes] Completed in ${duration}ms`);
    console.log(`Summary: ${results.verified} verified, ${results.noData} no data, ${results.hits} hits, ${results.misses} misses, ${results.pushes} pushes`);

    return new Response(JSON.stringify({
      success: true,
      date: targetDate,
      duration_ms: duration,
      summary: {
        total: results.total,
        verified: results.verified,
        noData: results.noData,
        hits: results.hits,
        misses: results.misses,
        pushes: results.pushes,
        hitRate: results.verified > 0 ? results.hits / (results.hits + results.misses) : null
      },
      details: results.details
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[verify-sweet-spot-outcomes] Error:', errorMessage);
    
    // Log error to cron_job_history
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    await supabase.from('cron_job_history').insert({
      job_name: 'verify-sweet-spot-outcomes',
      status: 'failed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      error_message: errorMessage
    });

    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
