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
  // Lower std dev = more consistent = higher score
  // Normalize against typical NBA ranges
  const pointsScore = Math.max(0, 100 - (stdDevs.points / 10) * 100);
  const reboundsScore = Math.max(0, 100 - (stdDevs.rebounds / 4) * 100);
  const assistsScore = Math.max(0, 100 - (stdDevs.assists / 3) * 100);
  const threesScore = Math.max(0, 100 - (stdDevs.threes / 1.5) * 100);
  
  return Math.round((pointsScore + reboundsScore + assistsScore + threesScore) / 4);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log('[SeasonStats] Starting season stats calculation...');

    // Get all unique players from game logs
    const { data: players, error: playersError } = await supabase
      .from('nba_player_game_logs')
      .select('player_name')
      .order('player_name');

    if (playersError) throw playersError;

    const uniquePlayers = [...new Set(players?.map(p => p.player_name) || [])];
    console.log(`[SeasonStats] Found ${uniquePlayers.length} unique players`);

    let processed = 0;
    let updated = 0;
    const season = '2024-25';

    for (const playerName of uniquePlayers) {
      processed++;
      
      // Fetch all games for this player
      const { data: games, error: gamesError } = await supabase
        .from('nba_player_game_logs')
        .select('*')
        .eq('player_name', playerName)
        .order('game_date', { ascending: false });

      if (gamesError || !games || games.length < 3) continue;

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

      // Calculate standard deviations for consistency
      const pointsValues = games.map(g => g.points || 0);
      const reboundsValues = games.map(g => g.rebounds || 0);
      const assistsValues = games.map(g => g.assists || 0);
      const threesValues = games.map(g => g.threes_made || 0);

      const pointsStdDev = calculateStdDev(pointsValues);
      const reboundsStdDev = calculateStdDev(reboundsValues);
      const assistsStdDev = calculateStdDev(assistsValues);
      const threesStdDev = calculateStdDev(threesValues);

      // Calculate last 10 game averages for trend
      const last10 = games.slice(0, Math.min(10, games.length));
      const last10AvgPoints = last10.reduce((s, g) => s + (g.points || 0), 0) / last10.length;
      const last10AvgRebounds = last10.reduce((s, g) => s + (g.rebounds || 0), 0) / last10.length;
      const last10AvgAssists = last10.reduce((s, g) => s + (g.assists || 0), 0) / last10.length;
      const last10AvgThrees = last10.reduce((s, g) => s + (g.threes_made || 0), 0) / last10.length;

      // Calculate consistency score
      const consistencyScore = calculateConsistencyScore({
        points: pointsStdDev,
        rebounds: reboundsStdDev,
        assists: assistsStdDev,
        threes: threesStdDev
      });

      // Determine trend direction
      const trendDirection = getTrendDirection(avgPoints, last10AvgPoints);

      // Upsert player season stats
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
        consistency_score: consistencyScore,
        trend_direction: trendDirection,
        updated_at: new Date().toISOString()
      };

      const { error: upsertError } = await supabase
        .from('player_season_stats')
        .upsert(statsData, { onConflict: 'player_name,sport,season' });

      if (!upsertError) {
        updated++;
        if (updated % 50 === 0) {
          console.log(`[SeasonStats] Processed ${updated} players...`);
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[SeasonStats] Complete: ${updated} players updated in ${duration}ms`);

    // Log job to history
    await supabase.from('cron_job_history').insert({
      job_name: 'calculate-season-stats',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { playersProcessed: processed, playersUpdated: updated }
    });

    return new Response(JSON.stringify({
      success: true,
      playersProcessed: processed,
      playersUpdated: updated,
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
