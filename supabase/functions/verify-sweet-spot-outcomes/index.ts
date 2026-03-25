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

// Map prop_type to stat field in game logs (NBA/NCAAB)
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

// MLB prop_type → stat field mapping
const mlbPropTypeToStat: Record<string, string> = {
  'hits': 'hits',
  'batter_hits': 'hits',
  'runs': 'runs',
  'batter_runs_scored': 'runs',
  'total_bases': 'total_bases',
  'batter_total_bases': 'total_bases',
  'rbis': 'rbis',
  'batter_rbis': 'rbis',
  'home_runs': 'home_runs',
  'batter_home_runs': 'home_runs',
  'stolen_bases': 'stolen_bases',
  'batter_stolen_bases': 'stolen_bases',
  'walks': 'walks',
  'batter_walks': 'walks',
  'strikeouts': 'strikeouts',
  'batter_strikeouts': 'strikeouts',
  'pitcher_strikeouts': 'pitcher_strikeouts',
  'pitcher_hits_allowed': 'pitcher_hits_allowed',
  'pitcher_earned_runs': 'earned_runs',
  'innings_pitched': 'innings_pitched',
  'hitter_fantasy_score': 'hitter_fantasy_score',
  'pitcher_outs': 'pitcher_outs',
};

// NHL prop_type → stat field mapping (skaters)
const nhlPropTypeToStat: Record<string, string> = {
  'nhl_points': 'points',
  'nhl_goals_scorer': 'goals',
  'nhl_assists': 'assists',
  'nhl_shots_on_goal': 'shots_on_goal',
  'nhl_blocked_shots': 'blocked_shots',
  'nhl_power_play_points': 'power_play_points',
  // player_* prefixed keys from category_sweet_spots
  'player_points': 'points',
  'player_goals': 'goals',
  'player_assists': 'assists',
  'player_shots_on_goal': 'shots_on_goal',
  'player_blocked_shots': 'blocked_shots',
  'player_power_play_points': 'power_play_points',
  // Short keys
  'points': 'points',
  'goals': 'goals',
  'assists': 'assists',
  'shots': 'shots_on_goal',
  'shots_on_goal': 'shots_on_goal',
  'blocked_shots': 'blocked_shots',
  'power_play_points': 'power_play_points',
};

// NHL goalie prop_type → stat field mapping
const nhlGoaliePropTypeToStat: Record<string, string> = {
  'nhl_goalie_saves': 'saves',
  'goalie_saves': 'saves',
  'saves': 'saves',
};

// Detect sport from category or prop_type
const detectSport = (category: string, propType: string): 'nba' | 'mlb' | 'nhl' | 'ncaab' => {
  const cat = (category || '').toUpperCase();
  const pt = (propType || '').toLowerCase();
  if (cat.startsWith('NHL_') || pt.startsWith('nhl_')) return 'nhl';
  if (cat.startsWith('MLB_') || pt.startsWith('batter_') || pt.startsWith('pitcher_') || pt.startsWith('hitter_') || ['hits', 'total_bases', 'rbis', 'home_runs', 'stolen_bases', 'innings_pitched'].includes(pt)) return 'mlb';
  if (cat.startsWith('NCAAB_')) return 'ncaab';
  return 'nba';
};

// Compute MLB hitter fantasy score
const computeMLBFantasy = (log: any): number => {
  return (Number(log.hits) || 0) * 3 + (Number(log.runs) || 0) * 2 + (Number(log.rbis) || 0) * 2 +
    (Number(log.walks) || 0) + (Number(log.stolen_bases) || 0) * 2 + (Number(log.home_runs) || 0) * 4;
};

// Extract stat value from game log based on sport
const extractStatValue = (gameLog: any, propType: string, sport: string): number | null => {
  const normalizedProp = propType.toLowerCase().replace(/[\s_-]+/g, '_');

  if (sport === 'mlb') {
    if (normalizedProp === 'hitter_fantasy_score') return computeMLBFantasy(gameLog);
    if (normalizedProp === 'pitcher_outs') {
      const ip = Number(gameLog.innings_pitched) || 0;
      return Math.floor(ip) * 3 + Math.round((ip % 1) * 10);
    }
    const statField = mlbPropTypeToStat[normalizedProp];
    if (statField && gameLog[statField] !== undefined) return Number(gameLog[statField]);
    if (gameLog[normalizedProp] !== undefined) return Number(gameLog[normalizedProp]);
    console.log(`[MLB] Unknown prop type: ${propType}`);
    return null;
  }

  if (sport === 'nhl') {
    // Check goalie stats first
    const goalieField = nhlGoaliePropTypeToStat[normalizedProp];
    if (goalieField && gameLog[goalieField] !== undefined) return Number(gameLog[goalieField]);
    // Then skater stats
    const skaterField = nhlPropTypeToStat[normalizedProp];
    if (skaterField && gameLog[skaterField] !== undefined) return Number(gameLog[skaterField]);
    if (gameLog[normalizedProp] !== undefined) return Number(gameLog[normalizedProp]);
    console.log(`[NHL] Unknown prop type: ${propType}`);
    return null;
  }

  // NBA/NCAAB
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

    // Step 0: Auto-void stale picks older than 2 days with no market line
    const twoDaysAgo = addDays(getEasternDate(0), -2);
    const { data: voidedRows, error: voidError } = await supabase
      .from('category_sweet_spots')
      .update({ outcome: 'void', settled_at: new Date().toISOString() })
      .is('actual_line', null)
      .in('outcome', ['pending', 'no_data'])
      .lt('analysis_date', twoDaysAgo)
      .select('id');

    if (voidError) {
      console.error(`[verify-sweet-spot-outcomes] Void cleanup error: ${voidError.message}`);
    } else {
      const voidCount = voidedRows?.length || 0;
      if (voidCount > 0) {
        console.log(`[verify-sweet-spot-outcomes] Auto-voided ${voidCount} stale picks with no market line`);
      }
    }

    // Step 1: Fetch pending picks for the target date
    const { data: pendingPicks, error: fetchError } = await supabase
      .from('category_sweet_spots')
      .select('id, player_name, prop_type, recommended_side, recommended_line, actual_line, category, l10_hit_rate, confidence_score, outcome')
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

    // Step 2: Fetch game logs in a 3-day window from NBA, NCAAB, MLB, and NHL tables
    const windowStart = targetDate;
    const windowEnd = addDays(targetDate, 2);

    // Also fetch player-team mapping to check if team played
    const { data: playerTeams } = await supabase
      .from('bdl_player_cache')
      .select('player_name, team_name')
      .not('team_name', 'is', null);

    // Fetch all sport logs in parallel — use .limit(5000) to avoid the default 1000-row cap
    const [nbaResult, ncaabResult, mlbResult, nhlSkaterResult, nhlGoalieResult] = await Promise.all([
      supabase
        .from('nba_player_game_logs')
        .select('player_name, game_date, opponent, points, rebounds, assists, threes_made, steals, blocks, turnovers')
        .gte('game_date', windowStart)
        .lte('game_date', windowEnd)
        .limit(5000),
      supabase
        .from('ncaab_player_game_logs')
        .select('player_name, game_date, opponent, points, rebounds, assists, threes_made, steals, blocks, turnovers')
        .gte('game_date', windowStart)
        .lte('game_date', windowEnd)
        .limit(5000),
      supabase
        .from('mlb_player_game_logs')
        .select('player_name, game_date, opponent, hits, runs, rbis, home_runs, stolen_bases, walks, strikeouts, total_bases, innings_pitched, earned_runs, pitcher_strikeouts, pitcher_hits_allowed, at_bats')
        .gte('game_date', windowStart)
        .lte('game_date', windowEnd)
        .limit(5000),
      supabase
        .from('nhl_player_game_logs')
        .select('player_name, game_date, opponent, goals, assists, points, shots_on_goal, blocked_shots, power_play_points')
        .gte('game_date', windowStart)
        .lte('game_date', windowEnd)
        .limit(5000),
      supabase
        .from('nhl_goalie_game_logs')
        .select('player_name, game_date, opponent, saves, shots_against, goals_against')
        .gte('game_date', windowStart)
        .lte('game_date', windowEnd)
        .limit(5000),
    ]);

    if (nbaResult.error) throw new Error(`Failed to fetch NBA game logs: ${nbaResult.error.message}`);
    if (ncaabResult.error) console.warn(`[verify] NCAAB logs warning: ${ncaabResult.error.message}`);
    if (mlbResult.error) console.warn(`[verify] MLB logs warning: ${mlbResult.error.message}`);
    if (nhlSkaterResult.error) console.warn(`[verify] NHL skater logs warning: ${nhlSkaterResult.error.message}`);
    if (nhlGoalieResult.error) console.warn(`[verify] NHL goalie logs warning: ${nhlGoalieResult.error.message}`);

    const nbaLogs = nbaResult.data || [];
    const ncaabLogs = ncaabResult.data || [];
    const mlbLogs = mlbResult.data || [];
    const nhlSkaterLogs = nhlSkaterResult.data || [];
    const nhlGoalieLogs = nhlGoalieResult.data || [];

    console.log(`[verify] Logs found — NBA: ${nbaLogs.length}, NCAAB: ${ncaabLogs.length}, MLB: ${mlbLogs.length}, NHL skaters: ${nhlSkaterLogs.length}, NHL goalies: ${nhlGoalieLogs.length}`);

    // Build per-sport game log maps
    const buildLogMap = (logs: any[]) => {
      const map = new Map<string, any>();
      const lastNameIdx = new Map<string, any[]>();
      for (const log of logs) {
        const nn = normalizeName(log.player_name);
        const existing = map.get(nn);
        if (!existing || log.game_date > existing.game_date) map.set(nn, log);
        const ln = getLastName(log.player_name);
        if (ln.length >= 3) {
          const arr = lastNameIdx.get(ln) || [];
          arr.push(log);
          lastNameIdx.set(ln, arr);
        }
      }
      return { map, lastNameIdx };
    };

    const nbaMap = buildLogMap([...nbaLogs, ...ncaabLogs]);
    const mlbMap = buildLogMap(mlbLogs);
    const nhlMap = buildLogMap([...nhlSkaterLogs, ...nhlGoalieLogs]);

    // Legacy combined map for "substantial data" check
    const totalPlayersWithLogs = nbaMap.map.size + mlbMap.map.size + nhlMap.map.size;
    console.log(`[verify] Unique players: NBA/NCAAB ${nbaMap.map.size}, MLB ${mlbMap.map.size}, NHL ${nhlMap.map.size}`);

    const hasSubstantialData = totalPlayersWithLogs >= 10;

    // Build a set of teams whose players appear in game logs (i.e., teams that played)
    // This lets us distinguish "player didn't play" from "team didn't play that day"
    const buildTeamsPlayed = (logs: any[]): Set<string> => {
      const teams = new Set<string>();
      for (const log of logs) {
        if (log.opponent) teams.add(log.opponent.toLowerCase());
      }
      return teams;
    };
    const nbaTeamsPlayed = buildTeamsPlayed([...nbaLogs, ...ncaabLogs]);
    const mlbTeamsPlayed = buildTeamsPlayed(mlbLogs);
    const nhlTeamsPlayed = buildTeamsPlayed([...nhlSkaterLogs, ...nhlGoalieLogs]);

    // Build player → team lookup from bdl_player_cache
    const playerTeamMap = new Map<string, string>();
    if (playerTeams) {
      for (const pt of playerTeams) {
        playerTeamMap.set(normalizeName(pt.player_name), (pt.team_name || '').toLowerCase());
      }
    }

    // Helper: did this player's team play on the target date?
    const didTeamPlay = (playerName: string, sport: string): boolean => {
      const teamsPlayed = sport === 'mlb' ? mlbTeamsPlayed : sport === 'nhl' ? nhlTeamsPlayed : nbaTeamsPlayed;
      if (teamsPlayed.size === 0) return false; // no games at all for this sport
      
      const normalizedPlayer = normalizeName(playerName);
      const teamName = playerTeamMap.get(normalizedPlayer);
      if (!teamName) return true; // can't determine team → assume they played (safer to mark no_data)
      
      // Check if any of the teams that played match this player's team
      for (const playedTeam of teamsPlayed) {
        if (teamName.includes(playedTeam) || playedTeam.includes(teamName) ||
            // Handle partial matches like "Celtics" in "Boston Celtics"
            teamName.split(' ').some(w => w.length > 3 && playedTeam.includes(w)) ||
            playedTeam.split(' ').some(w => w.length > 3 && teamName.includes(w))) {
          return true;
        }
      }
      return false;
    };

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
      const sport = detectSport(pick.category, pick.prop_type);
      const sportMap = sport === 'mlb' ? mlbMap : sport === 'nhl' ? nhlMap : nbaMap;
      const sportLabel = sport === 'mlb' ? 'mlb_player_game_logs' : sport === 'nhl' ? 'nhl_player_game_logs' : 'nba_player_game_logs';

      const normalizedPlayerName = normalizeName(pick.player_name);
      let gameLog = sportMap.map.get(normalizedPlayerName);
      let matchType = 'exact';

      // Fuzzy fallback: try last name + first 3 chars match
      if (!gameLog) {
        const lastName = getLastName(pick.player_name);
        const firstPrefix = getFirstInitial(pick.player_name);
        const candidates = sportMap.lastNameIdx.get(lastName) || [];
        
        if (candidates.length === 1) {
          gameLog = candidates[0];
          matchType = 'fuzzy_lastname_unique';
          results.fuzzyMatches++;
        } else if (candidates.length > 1 && firstPrefix.length >= 3) {
          const match = candidates.find((c: any) => {
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
        if (!hasSubstantialData) {
          // Revert no_data → pending if it was previously wrongly marked
          if (pick.outcome === 'no_data') {
            updates.push({ id: pick.id, actual_value: null, outcome: 'pending', settled_at: null as any, verified_source: '' });
          }
          results.pending++;
          results.details.push({
            player: pick.player_name, propType: pick.prop_type, sport, status: 'pending',
            reason: 'Insufficient game data in window — games may not have been played yet'
          });
          continue;
        }
        
        // Check if this sport specifically has data
        const sportHasData = sportMap.map.size >= 5;
        if (!sportHasData) {
          if (pick.outcome === 'no_data') {
            updates.push({ id: pick.id, actual_value: null, outcome: 'pending', settled_at: null as any, verified_source: '' });
          }
          results.pending++;
          results.details.push({
            player: pick.player_name, propType: pick.prop_type, sport, status: 'pending',
            reason: `No ${sport.toUpperCase()} game logs available in window`
          });
          continue;
        }

        // NEW: Check if the player's team actually played on this date
        // If team didn't play, revert to pending — they'll be settled when their game happens
        const teamPlayed = didTeamPlay(pick.player_name, sport);
        if (!teamPlayed) {
          if (pick.outcome === 'no_data') {
            updates.push({ id: pick.id, actual_value: null, outcome: 'pending', settled_at: null as any, verified_source: '' });
          }
          results.pending++;
          results.details.push({
            player: pick.player_name, propType: pick.prop_type, sport, status: 'pending',
            reason: 'Team did not play on this date — keeping pending for future settlement'
          });
          continue;
        }

        // Team played but player has no game log → DNP or name mismatch → no_data
        updates.push({
          id: pick.id, actual_value: null, outcome: 'no_data',
          settled_at: new Date().toISOString(), verified_source: sportLabel
        });
        results.noData++;
        results.details.push({
          player: pick.player_name, propType: pick.prop_type, sport, status: 'no_data',
          reason: 'No game log found — player likely did not play (DNP/injury)'
        });
        continue;
      }

      const actualValue = extractStatValue(gameLog, pick.prop_type, sport);
      
      if (actualValue === null) {
        updates.push({
          id: pick.id, actual_value: null, outcome: 'no_data',
          settled_at: new Date().toISOString(), verified_source: sportLabel
        });
        results.noData++;
        results.details.push({
          player: pick.player_name, propType: pick.prop_type, sport, status: 'no_data',
          reason: `Could not extract stat for prop type: ${pick.prop_type}`
        });
        continue;
      }

      const line = pick.actual_line ?? pick.recommended_line;
      if (line === null || line === undefined) {
        results.pending++;
        results.details.push({
          player: pick.player_name, propType: pick.prop_type, sport, status: 'pending',
          reason: 'No actual_line or recommended_line — skipping settlement'
        });
        continue;
      }
      const side = pick.recommended_side || 'over';
      const outcome = determineOutcome(actualValue, line, side);

      updates.push({
        id: pick.id, actual_value: actualValue, outcome,
        settled_at: new Date().toISOString(), verified_source: `${sportLabel} (${matchType})`
      });

      results.verified++;
      if (outcome === 'hit') results.hits++;
      else if (outcome === 'miss') results.misses++;
      else results.pushes++;

      results.details.push({
        player: pick.player_name, propType: pick.prop_type, sport, side, line,
        actual: actualValue, outcome, matchType, gameDate: gameLog.game_date,
        l10HitRate: pick.l10_hit_rate, confidence: pick.confidence_score
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
