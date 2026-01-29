import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Calculate standard deviation
function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

// Determine trend direction
function getTrendDirection(seasonAvg: number, last10Avg: number): string {
  const diff = ((last10Avg - seasonAvg) / seasonAvg) * 100;
  if (diff > 10) return 'hot';
  if (diff < -10) return 'cold';
  return 'stable';
}

// Calculate consistency score (higher = more consistent)
function calculateConsistencyScore(stdDevs: { points: number; rebounds: number; assists: number; threes: number }): number {
  const pointsScore = Math.max(0, 100 - (stdDevs.points / 10) * 100);
  const reboundsScore = Math.max(0, 100 - (stdDevs.rebounds / 4) * 100);
  const assistsScore = Math.max(0, 100 - (stdDevs.assists / 3) * 100);
  const threesScore = Math.max(0, 100 - (stdDevs.threes / 1.5) * 100);
  return Math.round((pointsScore + reboundsScore + assistsScore + threesScore) / 4);
}

interface ProcessResult {
  playerName: string;
  success: boolean;
  error?: string;
}

interface GameLog {
  player_name: string;
  game_date: string;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  threes_made: number | null;
  blocks: number | null;
  steals: number | null;
  minutes_played: number | null;
  is_home: boolean | null;
}

// Process a single player's season stats
async function processPlayer(
  supabase: any,
  playerName: string,
  season: string
): Promise<ProcessResult> {
  try {
    const { data: games, error: gamesError } = await supabase
      .from('nba_player_game_logs')
      .select('*')
      .eq('player_name', playerName)
      .order('game_date', { ascending: false }) as { data: GameLog[] | null; error: any };

    if (gamesError) throw gamesError;
    if (!games || games.length < 3) {
      return { playerName, success: false, error: 'Insufficient games' };
    }

    const gamesPlayed = games.length;

    // Calculate overall averages
    const avgPoints = games.reduce((s, g) => s + (g.points || 0), 0) / gamesPlayed;
    const avgRebounds = games.reduce((s, g) => s + (g.rebounds || 0), 0) / gamesPlayed;
    const avgAssists = games.reduce((s, g) => s + (g.assists || 0), 0) / gamesPlayed;
    const avgThrees = games.reduce((s, g) => s + (g.threes_made || 0), 0) / gamesPlayed;
    const avgBlocks = games.reduce((s, g) => s + (g.blocks || 0), 0) / gamesPlayed;
    const avgSteals = games.reduce((s, g) => s + (g.steals || 0), 0) / gamesPlayed;
    const avgMinutes = games.reduce((s, g) => s + (g.minutes_played || 0), 0) / gamesPlayed;

    // Calculate home/away splits
    const homeGames = games.filter(g => g.is_home === true);
    const awayGames = games.filter(g => g.is_home === false);

    const homeAvgPoints = homeGames.length > 0 
      ? homeGames.reduce((s, g) => s + (g.points || 0), 0) / homeGames.length : avgPoints;
    const homeAvgRebounds = homeGames.length > 0 
      ? homeGames.reduce((s, g) => s + (g.rebounds || 0), 0) / homeGames.length : avgRebounds;
    const homeAvgAssists = homeGames.length > 0 
      ? homeGames.reduce((s, g) => s + (g.assists || 0), 0) / homeGames.length : avgAssists;
    const homeAvgThrees = homeGames.length > 0 
      ? homeGames.reduce((s, g) => s + (g.threes_made || 0), 0) / homeGames.length : avgThrees;

    const awayAvgPoints = awayGames.length > 0 
      ? awayGames.reduce((s, g) => s + (g.points || 0), 0) / awayGames.length : avgPoints;
    const awayAvgRebounds = awayGames.length > 0 
      ? awayGames.reduce((s, g) => s + (g.rebounds || 0), 0) / awayGames.length : avgRebounds;
    const awayAvgAssists = awayGames.length > 0 
      ? awayGames.reduce((s, g) => s + (g.assists || 0), 0) / awayGames.length : avgAssists;
    const awayAvgThrees = awayGames.length > 0 
      ? awayGames.reduce((s, g) => s + (g.threes_made || 0), 0) / awayGames.length : avgThrees;

    // Calculate standard deviations
    const pointsStdDev = calculateStdDev(games.map(g => g.points || 0));
    const reboundsStdDev = calculateStdDev(games.map(g => g.rebounds || 0));
    const assistsStdDev = calculateStdDev(games.map(g => g.assists || 0));
    const threesStdDev = calculateStdDev(games.map(g => g.threes_made || 0));

    // Calculate last 10 game averages
    const last10 = games.slice(0, Math.min(10, games.length));
    const last10AvgPoints = last10.reduce((s, g) => s + (g.points || 0), 0) / last10.length;
    const last10AvgRebounds = last10.reduce((s, g) => s + (g.rebounds || 0), 0) / last10.length;
    const last10AvgAssists = last10.reduce((s, g) => s + (g.assists || 0), 0) / last10.length;
    const last10AvgThrees = last10.reduce((s, g) => s + (g.threes_made || 0), 0) / last10.length;

    // Calculate last 5 game averages for hot/cold detection
    const last5 = games.slice(0, Math.min(5, games.length));
    const last5AvgPoints = last5.length > 0 ? last5.reduce((s, g) => s + (g.points || 0), 0) / last5.length : last10AvgPoints;
    const last5AvgRebounds = last5.length > 0 ? last5.reduce((s, g) => s + (g.rebounds || 0), 0) / last5.length : last10AvgRebounds;
    const last5AvgAssists = last5.length > 0 ? last5.reduce((s, g) => s + (g.assists || 0), 0) / last5.length : last10AvgAssists;
    const last5AvgThrees = last5.length > 0 ? last5.reduce((s, g) => s + (g.threes_made || 0), 0) / last5.length : last10AvgThrees;

    // Calculate consistency score and trend
    const consistencyScore = calculateConsistencyScore({
      points: pointsStdDev,
      rebounds: reboundsStdDev,
      assists: assistsStdDev,
      threes: threesStdDev
    });
    const trendDirection = getTrendDirection(avgPoints, last10AvgPoints);

    const statsData = {
      player_name: playerName,
      sport: 'basketball_nba',
      season,
      games_played: gamesPlayed,
      avg_minutes: Math.round(avgMinutes * 10) / 10,
      avg_points: Math.round(avgPoints * 10) / 10,
      avg_rebounds: Math.round(avgRebounds * 10) / 10,
      avg_assists: Math.round(avgAssists * 10) / 10,
      avg_threes: Math.round(avgThrees * 10) / 10,
      avg_blocks: Math.round(avgBlocks * 10) / 10,
      avg_steals: Math.round(avgSteals * 10) / 10,
      home_games: homeGames.length,
      home_avg_points: Math.round(homeAvgPoints * 10) / 10,
      home_avg_rebounds: Math.round(homeAvgRebounds * 10) / 10,
      home_avg_assists: Math.round(homeAvgAssists * 10) / 10,
      home_avg_threes: Math.round(homeAvgThrees * 10) / 10,
      away_games: awayGames.length,
      away_avg_points: Math.round(awayAvgPoints * 10) / 10,
      away_avg_rebounds: Math.round(awayAvgRebounds * 10) / 10,
      away_avg_assists: Math.round(awayAvgAssists * 10) / 10,
      away_avg_threes: Math.round(awayAvgThrees * 10) / 10,
      points_std_dev: Math.round(pointsStdDev * 100) / 100,
      rebounds_std_dev: Math.round(reboundsStdDev * 100) / 100,
      assists_std_dev: Math.round(assistsStdDev * 100) / 100,
      threes_std_dev: Math.round(threesStdDev * 100) / 100,
      last_10_avg_points: Math.round(last10AvgPoints * 10) / 10,
      last_10_avg_rebounds: Math.round(last10AvgRebounds * 10) / 10,
      last_10_avg_assists: Math.round(last10AvgAssists * 10) / 10,
      last_10_avg_threes: Math.round(last10AvgThrees * 10) / 10,
      // Hot/Cold detection columns (v6.0)
      last_5_avg_points: Math.round(last5AvgPoints * 10) / 10,
      last_5_avg_rebounds: Math.round(last5AvgRebounds * 10) / 10,
      last_5_avg_assists: Math.round(last5AvgAssists * 10) / 10,
      last_5_avg_threes: Math.round(last5AvgThrees * 10) / 10,
      consistency_score: consistencyScore,
      trend_direction: trendDirection,
      updated_at: new Date().toISOString()
    };

    const { error: upsertError } = await supabase
      .from('player_season_stats')
      .upsert(statsData, { onConflict: 'player_name,sport,season' });

    if (upsertError) throw upsertError;
    return { playerName, success: true };
  } catch (error) {
    return { 
      playerName, 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const PARALLEL_BATCH_SIZE = 10;
  const MAX_DURATION_MS = 140000; // 140 seconds buffer

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log('[SeasonStats] Starting with view-based player lookup...');

    // Fetch all players with 3+ games using the database view
    const { data: playerSummary, error: summaryError } = await supabase
      .from('v_player_game_summary')
      .select('player_name, games_played')
      .gte('games_played', 3);

    if (summaryError) throw summaryError;

    const uniquePlayers = playerSummary?.map(p => p.player_name) || [];
    console.log(`[SeasonStats] Found ${uniquePlayers.length} players with 3+ games via view`);

    let processed = 0;
    let updated = 0;
    let skipped = 0;
    const errors: { player: string; error: string }[] = [];
    const season = '2024-25';
    const totalBatches = Math.ceil(uniquePlayers.length / PARALLEL_BATCH_SIZE);

    // Process in parallel batches
    for (let i = 0; i < uniquePlayers.length; i += PARALLEL_BATCH_SIZE) {
      // Timeout check
      if (Date.now() - startTime > MAX_DURATION_MS) {
        console.warn(`[SeasonStats] Approaching timeout at ${processed} players`);
        break;
      }

      const batch = uniquePlayers.slice(i, i + PARALLEL_BATCH_SIZE);
      const batchNumber = Math.floor(i / PARALLEL_BATCH_SIZE) + 1;

      // Process batch in parallel
      const results = await Promise.all(
        batch.map(playerName => processPlayer(supabase, playerName, season))
      );

      // Aggregate results
      for (const result of results) {
        processed++;
        if (result.success) {
          updated++;
        } else if (result.error === 'Insufficient games') {
          skipped++;
        } else if (result.error) {
          errors.push({ player: result.playerName, error: result.error });
        }
      }

      // Progress every 5 batches
      if (batchNumber % 5 === 0 || batchNumber === totalBatches) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`[SeasonStats] Batch ${batchNumber}/${totalBatches} | ${updated} updated | ${elapsed}s`);
      }
    }

    const duration = Date.now() - startTime;
    const speed = Math.round(processed / (duration / 1000));
    
    console.log(`[SeasonStats] ✅ Complete!`);
    console.log(`  - Players: ${uniquePlayers.length} | Processed: ${processed} | Updated: ${updated}`);
    console.log(`  - Skipped (<3 games): ${skipped} | Errors: ${errors.length}`);
    console.log(`  - Duration: ${duration}ms | Speed: ${speed} players/sec`);

    // Log job
    await supabase.from('cron_job_history').insert({
      job_name: 'calculate-season-stats',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { 
        totalPlayers: uniquePlayers.length,
        processed, 
        updated, 
        skipped,
        errors: errors.length,
        speed: `${speed}/sec`
      }
    });

    return new Response(JSON.stringify({
      success: true,
      totalPlayers: uniquePlayers.length,
      processed,
      updated,
      skipped,
      errors: errors.length,
      duration
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[SeasonStats] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
