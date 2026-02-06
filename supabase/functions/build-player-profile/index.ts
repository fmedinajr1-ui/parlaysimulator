import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface QuarterStats {
  q1: number;
  q2: number;
  q3: number;
  q4: number;
}

interface MatchupRecord {
  opponent: string;
  stat: string;
  avg_vs: number;
  games: number;
}

interface PlayerProfile {
  player_name: string;
  team: string | null;
  three_pt_peak_quarters: QuarterStats | null;
  scoring_zone_preferences: Record<string, number> | null;
  clutch_performance_vs_average: number | null;
  avg_first_rest_time: string | null;
  avg_second_stint_start: string | null;
  avg_minutes_per_quarter: QuarterStats | null;
  blowout_minutes_reduction: number | null;
  best_matchups: MatchupRecord[];
  worst_matchups: MatchupRecord[];
  quarter_production: Record<string, Record<string, number>> | null;
  games_analyzed: number;
  profile_confidence: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { playerName, team, buildAll } = await req.json();

    console.log(`[build-player-profile] Starting for: ${playerName || 'ALL PLAYERS'}`);

    if (buildAll) {
      // Build profiles for all players with recent game logs
      const { data: players, error: playersError } = await supabase
        .from('nba_player_game_logs')
        .select('player_name, team')
        .gte('game_date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .order('game_date', { ascending: false });

      if (playersError) throw playersError;

      // Get unique players
      const uniquePlayers = new Map<string, string>();
      for (const p of players || []) {
        if (!uniquePlayers.has(p.player_name)) {
          uniquePlayers.set(p.player_name, p.team);
        }
      }

      console.log(`[build-player-profile] Found ${uniquePlayers.size} unique players to profile`);

      let successCount = 0;
      let errorCount = 0;

      for (const [name, playerTeam] of uniquePlayers) {
        try {
          const profile = await buildProfile(supabase, name, playerTeam);
          if (profile) {
            await upsertProfile(supabase, profile);
            successCount++;
          }
        } catch (err) {
          console.error(`[build-player-profile] Error for ${name}:`, err);
          errorCount++;
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          profiles_built: successCount,
          errors: errorCount,
          total_players: uniquePlayers.size,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Single player mode
    if (!playerName) {
      return new Response(
        JSON.stringify({ error: 'playerName required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const profile = await buildProfile(supabase, playerName, team);
    
    if (!profile) {
      return new Response(
        JSON.stringify({ error: 'Could not build profile - no data found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    await upsertProfile(supabase, profile);

    console.log(`[build-player-profile] Successfully built profile for ${playerName}`);

    return new Response(
      JSON.stringify({ success: true, profile }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[build-player-profile] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function buildProfile(
  supabase: any,
  playerName: string,
  team?: string
): Promise<PlayerProfile | null> {
  // 1. Fetch game logs (last 50 games)
  const { data: gameLogs, error: logsError } = await supabase
    .from('nba_player_game_logs')
    .select('*')
    .eq('player_name', playerName)
    .order('game_date', { ascending: false })
    .limit(50);

  if (logsError) {
    console.error(`[buildProfile] Error fetching game logs for ${playerName}:`, logsError);
    return null;
  }

  if (!gameLogs || gameLogs.length === 0) {
    console.log(`[buildProfile] No game logs found for ${playerName}`);
    return null;
  }

  const playerTeam = team || gameLogs[0]?.team || null;

  // 2. Analyze 3PT patterns by quarter (from quarter stats if available)
  const threePtPeakQuarters = await analyzeThreePtQuarters(supabase, playerName);

  // 3. Get zone preferences from player_zone_stats
  const zonePreferences = await getZonePreferences(supabase, playerName);

  // 4. Analyze matchup performance
  const { bestMatchups, worstMatchups } = analyzeMatchups(gameLogs);

  // 5. Calculate clutch performance
  const clutchDelta = calculateClutchPerformance(gameLogs);

  // 6. Analyze quarter-by-quarter production
  const quarterProduction = calculateQuarterProduction(gameLogs);

  // 7. Calculate rotation patterns (simplified from game logs)
  const rotationPatterns = analyzeRotationPatterns(gameLogs);

  // 8. Calculate profile confidence based on sample size
  const gamesAnalyzed = gameLogs.length;
  const profileConfidence = Math.min(100, Math.round((gamesAnalyzed / 30) * 100));

  return {
    player_name: playerName,
    team: playerTeam,
    three_pt_peak_quarters: threePtPeakQuarters,
    scoring_zone_preferences: zonePreferences,
    clutch_performance_vs_average: clutchDelta,
    avg_first_rest_time: rotationPatterns.avgFirstRestTime,
    avg_second_stint_start: rotationPatterns.avgSecondStintStart,
    avg_minutes_per_quarter: rotationPatterns.avgMinutesPerQuarter,
    blowout_minutes_reduction: rotationPatterns.blowoutReduction,
    best_matchups: bestMatchups,
    worst_matchups: worstMatchups,
    quarter_production: quarterProduction,
    games_analyzed: gamesAnalyzed,
    profile_confidence: profileConfidence,
  };
}

async function analyzeThreePtQuarters(supabase: any, playerName: string): Promise<QuarterStats | null> {
  // Try to get quarter-level data from quarter_snapshots or similar
  const { data: snapshots } = await supabase
    .from('quarter_snapshots')
    .select('quarter, stats')
    .eq('player_name', playerName)
    .order('created_at', { ascending: false })
    .limit(100);

  if (!snapshots || snapshots.length === 0) {
    return null;
  }

  const quarterTotals: Record<number, { threes: number; games: number }> = {
    1: { threes: 0, games: 0 },
    2: { threes: 0, games: 0 },
    3: { threes: 0, games: 0 },
    4: { threes: 0, games: 0 },
  };

  for (const snap of snapshots) {
    const q = snap.quarter;
    if (q >= 1 && q <= 4 && snap.stats?.threes_made !== undefined) {
      quarterTotals[q].threes += snap.stats.threes_made || 0;
      quarterTotals[q].games++;
    }
  }

  const totalThrees = Object.values(quarterTotals).reduce((sum, q) => sum + q.threes, 0);
  
  if (totalThrees === 0) return null;

  return {
    q1: Math.round((quarterTotals[1].threes / totalThrees) * 100),
    q2: Math.round((quarterTotals[2].threes / totalThrees) * 100),
    q3: Math.round((quarterTotals[3].threes / totalThrees) * 100),
    q4: Math.round((quarterTotals[4].threes / totalThrees) * 100),
  };
}

async function getZonePreferences(supabase: any, playerName: string): Promise<Record<string, number> | null> {
  const { data: zoneStats } = await supabase
    .from('player_zone_stats')
    .select('*')
    .eq('player_name', playerName)
    .single();

  if (!zoneStats) return null;

  const zones = ['restricted_area', 'paint', 'mid_range', 'corner_3', 'above_break_3'];
  const preferences: Record<string, number> = {};

  let total = 0;
  for (const zone of zones) {
    const freq = zoneStats[`${zone}_freq`] || 0;
    total += freq;
  }

  if (total === 0) return null;

  for (const zone of zones) {
    const freq = zoneStats[`${zone}_freq`] || 0;
    preferences[zone] = Math.round((freq / total) * 100);
  }

  return preferences;
}

function analyzeMatchups(gameLogs: any[]): { bestMatchups: MatchupRecord[]; worstMatchups: MatchupRecord[] } {
  const matchupMap = new Map<string, { points: number[]; rebounds: number[]; assists: number[] }>();

  for (const game of gameLogs) {
    const opponent = game.opponent;
    if (!opponent) continue;

    if (!matchupMap.has(opponent)) {
      matchupMap.set(opponent, { points: [], rebounds: [], assists: [] });
    }

    const data = matchupMap.get(opponent)!;
    if (game.points !== undefined) data.points.push(game.points);
    if (game.rebounds !== undefined) data.rebounds.push(game.rebounds);
    if (game.assists !== undefined) data.assists.push(game.assists);
  }

  const allAvg = gameLogs.length > 0 
    ? gameLogs.reduce((sum, g) => sum + (g.points || 0), 0) / gameLogs.length 
    : 0;

  const matchupRecords: MatchupRecord[] = [];

  for (const [opponent, stats] of matchupMap) {
    if (stats.points.length >= 2) {
      const avg = stats.points.reduce((a, b) => a + b, 0) / stats.points.length;
      matchupRecords.push({
        opponent,
        stat: 'points',
        avg_vs: Math.round(avg * 10) / 10,
        games: stats.points.length,
      });
    }
  }

  // Sort by avg_vs descending for best, ascending for worst
  matchupRecords.sort((a, b) => b.avg_vs - a.avg_vs);

  return {
    bestMatchups: matchupRecords.slice(0, 3),
    worstMatchups: matchupRecords.slice(-3).reverse(),
  };
}

function calculateClutchPerformance(gameLogs: any[]): number | null {
  // Simplified: compare 4th quarter performance to overall average
  // This is a placeholder - would need quarter-level data for accurate clutch analysis
  const avgPoints = gameLogs.reduce((sum, g) => sum + (g.points || 0), 0) / gameLogs.length;
  
  // Without quarter-level data, we can't calculate true clutch performance
  // Return null to indicate not enough data
  return null;
}

function calculateQuarterProduction(gameLogs: any[]): Record<string, Record<string, number>> | null {
  // Would need quarter-level data for accurate breakdown
  // For now, estimate based on typical NBA distribution
  if (gameLogs.length === 0) return null;

  const avgPts = gameLogs.reduce((sum, g) => sum + (g.points || 0), 0) / gameLogs.length;
  const avgReb = gameLogs.reduce((sum, g) => sum + (g.rebounds || 0), 0) / gameLogs.length;
  const avgAst = gameLogs.reduce((sum, g) => sum + (g.assists || 0), 0) / gameLogs.length;

  // Typical NBA distribution: Q1 ~22%, Q2 ~23%, Q3 ~27%, Q4 ~28%
  return {
    q1: { pts: Math.round(avgPts * 0.22 * 10) / 10, reb: Math.round(avgReb * 0.24 * 10) / 10, ast: Math.round(avgAst * 0.23 * 10) / 10 },
    q2: { pts: Math.round(avgPts * 0.23 * 10) / 10, reb: Math.round(avgReb * 0.24 * 10) / 10, ast: Math.round(avgAst * 0.24 * 10) / 10 },
    q3: { pts: Math.round(avgPts * 0.27 * 10) / 10, reb: Math.round(avgReb * 0.26 * 10) / 10, ast: Math.round(avgAst * 0.26 * 10) / 10 },
    q4: { pts: Math.round(avgPts * 0.28 * 10) / 10, reb: Math.round(avgReb * 0.26 * 10) / 10, ast: Math.round(avgAst * 0.27 * 10) / 10 },
  };
}

function analyzeRotationPatterns(gameLogs: any[]): {
  avgFirstRestTime: string | null;
  avgSecondStintStart: string | null;
  avgMinutesPerQuarter: QuarterStats | null;
  blowoutReduction: number | null;
} {
  if (gameLogs.length === 0) {
    return {
      avgFirstRestTime: null,
      avgSecondStintStart: null,
      avgMinutesPerQuarter: null,
      blowoutReduction: null,
    };
  }

  const avgMinutes = gameLogs.reduce((sum, g) => sum + (g.minutes || 0), 0) / gameLogs.length;

  // Typical NBA rotation: starters rest around 5:00-6:00 mark of Q1
  // These are estimates based on typical patterns
  const avgMinPerQuarter = avgMinutes / 4;

  // Detect blowout games (score differential > 20)
  const blowoutGames = gameLogs.filter(g => Math.abs(g.score_diff || 0) > 20);
  const normalGames = gameLogs.filter(g => Math.abs(g.score_diff || 0) <= 20);

  let blowoutReduction: number | null = null;
  if (blowoutGames.length >= 3 && normalGames.length >= 5) {
    const blowoutAvg = blowoutGames.reduce((sum, g) => sum + (g.minutes || 0), 0) / blowoutGames.length;
    const normalAvg = normalGames.reduce((sum, g) => sum + (g.minutes || 0), 0) / normalGames.length;
    blowoutReduction = Math.round((normalAvg - blowoutAvg) * 10) / 10;
  }

  return {
    avgFirstRestTime: avgMinutes >= 30 ? 'Q1 5:30' : 'Q1 6:30',
    avgSecondStintStart: avgMinutes >= 30 ? 'Q1 3:00' : 'Q2 10:00',
    avgMinutesPerQuarter: {
      q1: Math.round(avgMinPerQuarter * 10) / 10,
      q2: Math.round(avgMinPerQuarter * 10) / 10,
      q3: Math.round(avgMinPerQuarter * 10) / 10,
      q4: Math.round(avgMinPerQuarter * 10) / 10,
    },
    blowoutReduction,
  };
}

async function upsertProfile(supabase: any, profile: PlayerProfile): Promise<void> {
  const { error } = await supabase
    .from('player_behavior_profiles')
    .upsert({
      player_name: profile.player_name,
      team: profile.team,
      three_pt_peak_quarters: profile.three_pt_peak_quarters,
      scoring_zone_preferences: profile.scoring_zone_preferences,
      clutch_performance_vs_average: profile.clutch_performance_vs_average,
      avg_first_rest_time: profile.avg_first_rest_time,
      avg_second_stint_start: profile.avg_second_stint_start,
      avg_minutes_per_quarter: profile.avg_minutes_per_quarter,
      blowout_minutes_reduction: profile.blowout_minutes_reduction,
      best_matchups: profile.best_matchups,
      worst_matchups: profile.worst_matchups,
      quarter_production: profile.quarter_production,
      games_analyzed: profile.games_analyzed,
      profile_confidence: profile.profile_confidence,
      last_updated: new Date().toISOString(),
    }, {
      onConflict: 'player_name,team',
    });

  if (error) {
    console.error(`[upsertProfile] Error upserting profile for ${profile.player_name}:`, error);
    throw error;
  }
}
