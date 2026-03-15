import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Quarter distribution patterns by player tier (based on NBA research)
const TIER_DISTRIBUTIONS: Record<string, { q1: number; q2: number; q3: number; q4: number }> = {
  star:        { q1: 0.23, q2: 0.27, q3: 0.27, q4: 0.23 },
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

function getPlayerTier(avgMinutes: number): string {
  if (avgMinutes >= 32) return 'star';
  if (avgMinutes >= 24) return 'starter';
  return 'role_player';
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

    const STAT_FIELDS = ['points', 'assists', 'threes_made', 'blocks', 'rebounds'];
    const PROP_MAP: Record<string, string> = {
      points: 'points', assists: 'assists', threes: 'threes_made',
      blocks: 'blocks', rebounds: 'rebounds',
    };

    // Fetch L10 game logs + matchup history + baselines + Q1 FanDuel lines in parallel
    const [logsResult, matchupResult, baselinesResult, q1LinesResult] = await Promise.all([
      supabase
        .from('nba_player_game_logs')
        .select('player_name, points, assists, threes_made, blocks, rebounds, minutes_played, game_date')
        .in('player_name', playerNames)
        .order('game_date', { ascending: false })
        .limit(playerNames.length * 10),

      opponent
        ? supabase
            .from('matchup_history')
            .select('player_name, prop_type, opponent, avg_stat, games_played, hit_rate_over, hit_rate_under')
            .in('player_name', playerNames)
            .eq('opponent', opponent)
        : Promise.resolve({ data: [], error: null }),

      supabase
        .from('player_quarter_baselines')
        .select('player_name, prop_type, q1_avg, q2_avg, q3_avg, q4_avg, q1_pct, q2_pct, q3_pct, q4_pct, player_tier')
        .in('player_name', playerNames),

      // Fetch Q1 FanDuel lines from unified_props
      supabase
        .from('unified_props')
        .select('player_name, prop_type, current_line, over_price, under_price')
        .in('prop_type', ['player_points_q1', 'player_rebounds_q1', 'player_assists_q1', 'player_threes_q1', 'player_steals_q1'])
        .eq('bookmaker', 'fanduel')
        .gte('scraped_at', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()),
    ]);

    if (logsResult.error) {
      console.error('[get-player-quarter-profile] logs error:', logsResult.error);
    }

    const gameLogs = logsResult.data || [];
    const matchups = matchupResult.data || [];
    const baselines = baselinesResult.data || [];
    const q1Lines = q1LinesResult.data || [];

    // Group logs by player (max 10 per player)
    const logsByPlayer = new Map<string, typeof gameLogs>();
    for (const log of gameLogs) {
      const arr = logsByPlayer.get(log.player_name) || [];
      if (arr.length < 10) arr.push(log);
      logsByPlayer.set(log.player_name, arr);
    }

    // Build baseline lookup
    const baselineMap = new Map<string, any>();
    for (const b of baselines) {
      baselineMap.set(`${b.player_name}_${b.prop_type}`, b);
    }

    // Build matchup lookup
    const matchupMap = new Map<string, any>();
    for (const m of matchups) {
      matchupMap.set(`${m.player_name}_${m.prop_type}`, m);
    }

    // Build Q1 lines lookup: playerName_propType -> { line, overPrice, underPrice }
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
      const quarterAvgs: Record<string, { q1: number; q2: number; q3: number; q4: number }> = {};
      const h2h: Record<string, { opponent: string; avgStat: number; gamesPlayed: number; hitRateOver: number; hitRateUnder: number }> = {};
      const playerQ1Lines: Record<string, { line: number; overPrice: number; underPrice: number }> = {};

      if (logs.length >= 3) {
        const avgMinutes = logs.reduce((s, l) => s + (l.minutes_played || 0), 0) / logs.length;
        const tier = getPlayerTier(avgMinutes);
        const dist = TIER_DISTRIBUTIONS[tier];

        for (const [propType, field] of Object.entries(PROP_MAP)) {
          const baseline = baselineMap.get(`${playerName}_${propType}`);
          if (baseline && baseline.q1_avg > 0) {
            quarterAvgs[propType] = {
              q1: Math.round(baseline.q1_avg * 10) / 10,
              q2: Math.round(baseline.q2_avg * 10) / 10,
              q3: Math.round(baseline.q3_avg * 10) / 10,
              q4: Math.round(baseline.q4_avg * 10) / 10,
            };
          } else {
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
      }

      // Add H2H data
      for (const [propType] of Object.entries(PROP_MAP)) {
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

      // Add Q1 FanDuel lines
      for (const propType of ['points', 'rebounds', 'assists']) {
        const q1 = q1LineMap.get(`${playerName}_${propType}`);
        if (q1) {
          playerQ1Lines[propType] = q1;
        }
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
