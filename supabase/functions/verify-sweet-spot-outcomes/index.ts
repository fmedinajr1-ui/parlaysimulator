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

// Extract last name for fuzzy fallback
const getLastName = (s: string): string => {
  const parts = normalizeName(s).split(' ');
  return parts[parts.length - 1] || '';
};

// Extract first initial for disambiguation
const getFirstInitial = (s: string): string => {
  const parts = normalizeName(s).split(' ');
  return parts[0]?.substring(0, 3) || '';
};

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
    if (gameLog[normalizedProp] !== undefined) {
      return Number(gameLog[normalizedProp]);
    }
    console.log(`Unknown prop type: ${propType}`);
    return null;
  }
  
  if (statField === 'pra') {
    return (Number(gameLog.points) || 0) + (Number(gameLog.rebounds) || 0) + (Number(gameLog.assists) || 0);
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
  return actual < line ? 'hit' : 'miss';
};

// Get Eastern date string
const getEasternDate = (daysAgo: number = 0): string => {
  const now = new Date();
  now.setDate(now.getDate() - daysAgo);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
};

// Add days to a date string
const addDays = (dateStr: string, days: number): string => {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
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
      targetDate = body.date || getEasternDate(1);
    } catch {
      targetDate = getEasternDate(1);
    }

    console.log(`[verify-sweet-spot-outcomes] Starting verification for date: ${targetDate}`);

    // Step 1: Fetch pending picks for the target date
    const { data: pendingPicks, error: fetchError } = await supabase
      .from('category_sweet_spots')
      .select('id, player_name, prop_type, recommended_side, recommended_line, actual_line, category, l10_hit_rate, confidence_score')
      .eq('analysis_date', targetDate)
      .in('outcome', ['pending', 'no_data'])
      .is('actual_value', null);

    if (fetchError) {
      throw new Error(`Failed to fetch pending picks: ${fetchError.message}`);
    }

    if (!pendingPicks || pendingPicks.length === 0) {
      console.log(`[verify-sweet-spot-outcomes] No pending picks found for ${targetDate}`);
      return new Response(JSON.stringify({
        success: true,
        date: targetDate,
        message: 'No pending picks to verify',
        summary: { total: 0, verified: 0, noData: 0, pending: 0, hits: 0, misses: 0, pushes: 0 }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[verify-sweet-spot-outcomes] Found ${pendingPicks.length} pending picks`);

    // Step 2: Fetch game logs in a 3-day window from BOTH NBA and NCAAB tables
    const windowStart = targetDate;
    const windowEnd = addDays(targetDate, 2);

    const { data: nbaLogs, error: nbaLogsError } = await supabase
      .from('nba_player_game_logs')
      .select('player_name, game_date, points, rebounds, assists, threes_made, steals, blocks, turnovers')
      .gte('game_date', windowStart)
      .lte('game_date', windowEnd);

    if (nbaLogsError) {
      throw new Error(`Failed to fetch NBA game logs: ${nbaLogsError.message}`);
    }

    // Fetch NCAAB game logs
    const { data: ncaabLogs, error: ncaabLogsError } = await supabase
      .from('ncaab_player_game_logs')
      .select('player_name, game_date, points, rebounds, assists, threes_made, steals, blocks, turnovers')
      .gte('game_date', windowStart)
      .lte('game_date', windowEnd);

    if (ncaabLogsError) {
      console.warn(`[verify-sweet-spot-outcomes] NCAAB logs fetch warning: ${ncaabLogsError.message}`);
    }

    const allGameLogs = [...(nbaLogs || []), ...(ncaabLogs || [])];
    console.log(`[verify-sweet-spot-outcomes] Found ${nbaLogs?.length || 0} NBA + ${ncaabLogs?.length || 0} NCAAB game logs in window ${windowStart} to ${windowEnd}`);

    // Build normalized name lookup — use the most recent game log per player
    const gameLogMap = new Map<string, any>();
    // Also build a last-name index for fuzzy fallback
    const lastNameIndex = new Map<string, any[]>();
    
    for (const log of allGameLogs) {
      const normalizedName = normalizeName(log.player_name);
      const existing = gameLogMap.get(normalizedName);
      if (!existing || log.game_date > existing.game_date) {
        gameLogMap.set(normalizedName, log);
      }
      
      // Build last name index
      const lastName = getLastName(log.player_name);
      if (lastName.length >= 3) {
        const arr = lastNameIndex.get(lastName) || [];
        arr.push(log);
        lastNameIndex.set(lastName, arr);
      }
    }

    const totalPlayersWithLogs = gameLogMap.size;
    console.log(`[verify-sweet-spot-outcomes] Unique players with game logs: ${totalPlayersWithLogs}`);

    // Determine if we have enough game data to verify
    // If very few game logs exist, games likely haven't been played yet
    const hasSubstantialData = totalPlayersWithLogs >= 10;

    // Step 3: Match and verify each pick
    const results = {
      total: pendingPicks.length,
      verified: 0,
      noData: 0,
      pending: 0,
      hits: 0,
      misses: 0,
      pushes: 0,
      fuzzyMatches: 0,
      details: [] as any[]
    };

    const updates: { id: string; actual_value: number | null; outcome: string; settled_at: string; verified_source: string }[] = [];

    for (const pick of pendingPicks) {
      const normalizedPlayerName = normalizeName(pick.player_name);
      let gameLog = gameLogMap.get(normalizedPlayerName);
      let matchType = 'exact';

      // Fuzzy fallback: try last name + first 3 chars match
      if (!gameLog) {
        const lastName = getLastName(pick.player_name);
        const firstPrefix = getFirstInitial(pick.player_name);
        const candidates = lastNameIndex.get(lastName) || [];
        
        if (candidates.length === 1) {
          // Only one player with this last name — safe match
          gameLog = candidates[0];
          matchType = 'fuzzy_lastname_unique';
          results.fuzzyMatches++;
        } else if (candidates.length > 1 && firstPrefix.length >= 3) {
          // Multiple matches — use first 3 chars of first name to disambiguate
          const match = candidates.find(c => {
            const candFirst = getFirstInitial(c.player_name);
            return candFirst.startsWith(firstPrefix) || firstPrefix.startsWith(candFirst);
          });
          if (match) {
            gameLog = match;
            matchType = 'fuzzy_firstname_prefix';
            results.fuzzyMatches++;
          }
        }
      }

      if (!gameLog) {
        // No game log found — but was the player's game even scheduled?
        // If we have very few logs, the game probably hasn't happened yet → keep as pending
        if (!hasSubstantialData) {
          results.pending++;
          results.details.push({
            player: pick.player_name,
            propType: pick.prop_type,
            status: 'pending',
            reason: 'Insufficient game data in window — games may not have been played yet'
          });
          // Don't update — leave as pending/no_data for retry
          continue;
        }
        
        // We have substantial data but this player isn't in it — mark no_data
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
          reason: 'No game log found — player likely did not play'
        });
        continue;
      }

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

      const line = pick.actual_line || pick.recommended_line || 0;
      const side = pick.recommended_side || 'over';
      const outcome = determineOutcome(actualValue, line, side);

      updates.push({
        id: pick.id,
        actual_value: actualValue,
        outcome,
        settled_at: new Date().toISOString(),
        verified_source: `nba_player_game_logs (${matchType})`
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
        matchType,
        gameDate: gameLog.game_date,
        l10HitRate: pick.l10_hit_rate,
        confidence: pick.confidence_score
      });
    }

    // Step 4: Batch update all picks
    console.log(`[verify-sweet-spot-outcomes] Updating ${updates.length} picks (${results.pending} left pending for retry)...`);
    
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
    const hitRate = (results.hits + results.misses) > 0
      ? (results.hits / (results.hits + results.misses)).toFixed(4)
      : null;

    await supabase.from('cron_job_history').insert({
      job_name: 'verify-sweet-spot-outcomes',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: {
        date: targetDate,
        window: { start: windowStart, end: windowEnd },
        totalPlayersWithLogs: totalPlayersWithLogs,
        summary: {
          total: results.total,
          verified: results.verified,
          noData: results.noData,
          pending: results.pending,
          hits: results.hits,
          misses: results.misses,
          pushes: results.pushes,
          fuzzyMatches: results.fuzzyMatches,
          hitRate
        }
      }
    });

    console.log(`[verify-sweet-spot-outcomes] Completed in ${duration}ms`);
    console.log(`Summary: ${results.verified} verified (${results.fuzzyMatches} fuzzy), ${results.noData} no_data, ${results.pending} pending, ${results.hits} hits, ${results.misses} misses`);

    return new Response(JSON.stringify({
      success: true,
      date: targetDate,
      window: { start: windowStart, end: windowEnd },
      duration_ms: duration,
      summary: {
        total: results.total,
        verified: results.verified,
        noData: results.noData,
        pending: results.pending,
        hits: results.hits,
        misses: results.misses,
        pushes: results.pushes,
        fuzzyMatches: results.fuzzyMatches,
        hitRate
      },
      details: results.details.slice(0, 50) // Limit detail payload
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    console.error('[verify-sweet-spot-outcomes] Error:', errorMessage);
    
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
