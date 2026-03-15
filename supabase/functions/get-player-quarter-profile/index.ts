import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Fallback quarter distribution by tier (only used when no real snapshot data)
const TIER_DISTRIBUTIONS: Record<string, { q1: number; q2: number; q3: number; q4: number }> = {
  star:        { q1: 0.24, q2: 0.26, q3: 0.27, q4: 0.23 },
  starter:     { q1: 0.25, q2: 0.26, q3: 0.26, q4: 0.23 },
  role_player: { q1: 0.26, q2: 0.26, q3: 0.24, q4: 0.24 },
};

const Q1_PROP_MAP: Record<string, string> = {
  player_points_q1: 'points',
  player_rebounds_q1: 'rebounds',
  player_assists_q1: 'assists',
  player_threes_q1: 'threes',
  player_steals_q1: 'steals',
};

const PROP_MAP: Record<string, string> = {
  points: 'points', assists: 'assists', threes: 'threes_made',
  blocks: 'blocks', rebounds: 'rebounds', steals: 'steals',
};

function getPlayerTier(avgMinutes: number): string {
  if (avgMinutes >= 32) return 'star';
  if (avgMinutes >= 24) return 'starter';
  return 'role_player';
}

/** Build real per-quarter averages from quarter_player_snapshots for the last N distinct games */
function buildRealQuarterAvgs(
  snapshots: Array<{ event_id: string; quarter: number; points: number; rebounds: number; assists: number; threes: number; steals: number; blocks: number }>,
  maxGames: number
): Record<string, { q1: number; q2: number; q3: number; q4: number }> | null {
  // Get distinct event IDs (already ordered by captured_at desc from query)
  const seenEvents = new Set<string>();
  const recentEvents: string[] = [];
  for (const s of snapshots) {
    if (!seenEvents.has(s.event_id)) {
      seenEvents.add(s.event_id);
      recentEvents.push(s.event_id);
      if (recentEvents.length >= maxGames) break;
    }
  }

  if (recentEvents.length < 2) return null; // Not enough real data

  const eventSet = new Set(recentEvents);
  const filtered = snapshots.filter(s => eventSet.has(s.event_id));

  // Aggregate by quarter across games
  const statKeys = ['points', 'rebounds', 'assists', 'threes', 'steals', 'blocks'] as const;
  const result: Record<string, { q1: number; q2: number; q3: number; q4: number }> = {};

  for (const stat of statKeys) {
    const qSums = [0, 0, 0, 0];
    const qCounts = [0, 0, 0, 0];

    for (const s of filtered) {
      if (s.quarter >= 1 && s.quarter <= 4) {
        const idx = s.quarter - 1;
        qSums[idx] += (s as any)[stat] || 0;
        qCounts[idx]++;
      }
    }

    // Only include stat if we have data for at least Q1
    if (qCounts[0] > 0) {
      const propName = stat === 'threes_made' ? 'threes' : stat;
      result[propName] = {
        q1: qCounts[0] > 0 ? Math.round((qSums[0] / qCounts[0]) * 10) / 10 : 0,
        q2: qCounts[1] > 0 ? Math.round((qSums[1] / qCounts[1]) * 10) / 10 : 0,
        q3: qCounts[2] > 0 ? Math.round((qSums[2] / qCounts[2]) * 10) / 10 : 0,
        q4: qCounts[3] > 0 ? Math.round((qSums[3] / qCounts[3]) * 10) / 10 : 0,
      };
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { playerNames, opponent, propTypes } = await req.json() as {
      playerNames: string[];
      opponent?: string;
      propTypes?: string[];
    };

    if (!playerNames || playerNames.length === 0) {
      return new Response(JSON.stringify({ players: {} }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch L3 game logs + matchup history + real quarter snapshots + Q1 lines in parallel
    const [logsResult, matchupResult, snapshotsResult, q1LinesResult] = await Promise.all([
      // L3 game logs (fallback for quarter splits)
      supabase
        .from('nba_player_game_logs')
        .select('player_name, points, assists, threes_made, blocks, rebounds, steals, minutes_played, game_date')
        .in('player_name', playerNames)
        .order('game_date', { ascending: false })
        .limit(playerNames.length * 3),

      // Matchup history
      opponent
        ? supabase
            .from('matchup_history')
            .select('player_name, prop_type, opponent, avg_stat, games_played, hit_rate_over, hit_rate_under')
            .in('player_name', playerNames)
            .eq('opponent', opponent)
        : Promise.resolve({ data: [], error: null }),

      // Real per-quarter snapshots — get last ~30 rows per player (covers ~3 games × 4 quarters + buffer)
      supabase
        .from('quarter_player_snapshots')
        .select('player_name, event_id, quarter, points, rebounds, assists, threes, steals, blocks, captured_at')
        .in('player_name', playerNames)
        .order('captured_at', { ascending: false })
        .limit(playerNames.length * 30),

      // Q1 FanDuel lines
      supabase
        .from('unified_props')
        .select('player_name, prop_type, current_line, over_price, under_price')
        .in('prop_type', ['player_points_q1', 'player_rebounds_q1', 'player_assists_q1', 'player_threes_q1', 'player_steals_q1'])
        .eq('bookmaker', 'fanduel')
        .gte('scraped_at', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()),
    ]);

    if (logsResult.error) console.error('[get-player-quarter-profile] logs error:', logsResult.error);
    if (snapshotsResult.error) console.error('[get-player-quarter-profile] snapshots error:', snapshotsResult.error);

    const gameLogs = logsResult.data || [];
    const matchups = matchupResult.data || [];
    const snapshots = snapshotsResult.data || [];
    const q1Lines = q1LinesResult.data || [];

    // Group by player
    const logsByPlayer = new Map<string, typeof gameLogs>();
    for (const log of gameLogs) {
      const arr = logsByPlayer.get(log.player_name) || [];
      if (arr.length < 3) arr.push(log);
      logsByPlayer.set(log.player_name, arr);
    }

    const snapshotsByPlayer = new Map<string, typeof snapshots>();
    for (const s of snapshots) {
      const arr = snapshotsByPlayer.get(s.player_name) || [];
      arr.push(s);
      snapshotsByPlayer.set(s.player_name, arr);
    }

    // Build matchup lookup
    const matchupMap = new Map<string, any>();
    for (const m of matchups) {
      matchupMap.set(`${m.player_name}_${m.prop_type}`, m);
    }

    // Build Q1 lines lookup
    const q1LineMap = new Map<string, { line: number; overPrice: number; underPrice: number }>();
    for (const row of q1Lines) {
      const mappedProp = Q1_PROP_MAP[row.prop_type];
      if (mappedProp) {
        q1LineMap.set(`${row.player_name}_${mappedProp}`, {
          line: row.current_line,
          overPrice: row.over_price ?? -110,
          underPrice: row.under_price ?? -110,
        });
      }
    }

    // Build response per player
    const players: Record<string, {
      quarterAvgs: Record<string, { q1: number; q2: number; q3: number; q4: number }>;
      h2h: Record<string, { opponent: string; avgStat: number; gamesPlayed: number; hitRateOver: number; hitRateUnder: number }>;
      q1Lines: Record<string, { line: number; overPrice: number; underPrice: number }>;
    }> = {};

    for (const playerName of playerNames) {
      const logs = logsByPlayer.get(playerName) || [];
      const playerSnaps = snapshotsByPlayer.get(playerName) || [];
      let quarterAvgs: Record<string, { q1: number; q2: number; q3: number; q4: number }> = {};
      const h2h: Record<string, { opponent: string; avgStat: number; gamesPlayed: number; hitRateOver: number; hitRateUnder: number }> = {};
      const playerQ1Lines: Record<string, { line: number; overPrice: number; underPrice: number }> = {};

      // PRIORITY 1: Real per-quarter averages from snapshot data (L3 games)
      const realAvgs = buildRealQuarterAvgs(playerSnaps, 3);

      if (realAvgs) {
        quarterAvgs = realAvgs;
      } else if (logs.length >= 2) {
        // FALLBACK: Tier-based distribution using L3 game logs
        const avgMinutes = logs.reduce((s, l) => s + (l.minutes_played || 0), 0) / logs.length;
        const tier = getPlayerTier(avgMinutes);
        const dist = TIER_DISTRIBUTIONS[tier];

        for (const [propType, field] of Object.entries(PROP_MAP)) {
          const gameAvg = logs.reduce((s, l) => s + ((l as any)[field] || 0), 0) / logs.length;
          if (gameAvg > 0) {
            quarterAvgs[propType] = {
              q1: Math.round(gameAvg * dist.q1 * 10) / 10,
              q2: Math.round(gameAvg * dist.q2 * 10) / 10,
              q3: Math.round(gameAvg * dist.q3 * 10) / 10,
              q4: Math.round(gameAvg * dist.q4 * 10) / 10,
            };
          }
        }
      }

      // H2H data
      for (const propType of Object.keys(PROP_MAP)) {
        const m = matchupMap.get(`${playerName}_${propType}`);
        if (m) {
          h2h[propType] = {
            opponent: m.opponent,
            avgStat: m.avg_stat,
            gamesPlayed: m.games_played,
            hitRateOver: m.hit_rate_over ?? 0,
            hitRateUnder: m.hit_rate_under ?? 0,
          };
        }
      }

      // Q1 FanDuel lines
      for (const propType of ['points', 'rebounds', 'assists', 'threes', 'steals']) {
        const q1 = q1LineMap.get(`${playerName}_${propType}`);
        if (q1) playerQ1Lines[propType] = q1;
      }

      players[playerName] = { quarterAvgs, h2h, q1Lines: playerQ1Lines };
    }

    return new Response(JSON.stringify({ players }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[get-player-quarter-profile] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
