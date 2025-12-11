import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NFL team name mappings for better matching
const NFL_TEAMS: Record<string, string[]> = {
  'Arizona Cardinals': ['ARI', 'Cardinals', 'Arizona'],
  'Atlanta Falcons': ['ATL', 'Falcons', 'Atlanta'],
  'Baltimore Ravens': ['BAL', 'Ravens', 'Baltimore'],
  'Buffalo Bills': ['BUF', 'Bills', 'Buffalo'],
  'Carolina Panthers': ['CAR', 'Panthers', 'Carolina'],
  'Chicago Bears': ['CHI', 'Bears', 'Chicago'],
  'Cincinnati Bengals': ['CIN', 'Bengals', 'Cincinnati'],
  'Cleveland Browns': ['CLE', 'Browns', 'Cleveland'],
  'Dallas Cowboys': ['DAL', 'Cowboys', 'Dallas'],
  'Denver Broncos': ['DEN', 'Broncos', 'Denver'],
  'Detroit Lions': ['DET', 'Lions', 'Detroit'],
  'Green Bay Packers': ['GB', 'Packers', 'Green Bay'],
  'Houston Texans': ['HOU', 'Texans', 'Houston'],
  'Indianapolis Colts': ['IND', 'Colts', 'Indianapolis'],
  'Jacksonville Jaguars': ['JAX', 'Jaguars', 'Jacksonville'],
  'Kansas City Chiefs': ['KC', 'Chiefs', 'Kansas City'],
  'Las Vegas Raiders': ['LV', 'Raiders', 'Las Vegas'],
  'Los Angeles Chargers': ['LAC', 'Chargers', 'LA Chargers'],
  'Los Angeles Rams': ['LAR', 'Rams', 'LA Rams'],
  'Miami Dolphins': ['MIA', 'Dolphins', 'Miami'],
  'Minnesota Vikings': ['MIN', 'Vikings', 'Minnesota'],
  'New England Patriots': ['NE', 'Patriots', 'New England'],
  'New Orleans Saints': ['NO', 'Saints', 'New Orleans'],
  'New York Giants': ['NYG', 'Giants', 'NY Giants'],
  'New York Jets': ['NYJ', 'Jets', 'NY Jets'],
  'Philadelphia Eagles': ['PHI', 'Eagles', 'Philadelphia'],
  'Pittsburgh Steelers': ['PIT', 'Steelers', 'Pittsburgh'],
  'San Francisco 49ers': ['SF', '49ers', 'San Francisco'],
  'Seattle Seahawks': ['SEA', 'Seahawks', 'Seattle'],
  'Tampa Bay Buccaneers': ['TB', 'Buccaneers', 'Tampa Bay'],
  'Tennessee Titans': ['TEN', 'Titans', 'Tennessee'],
  'Washington Commanders': ['WAS', 'Commanders', 'Washington'],
};

function normalizeTeamName(name: string): string {
  const normalized = name.toLowerCase().trim();
  for (const [fullName, aliases] of Object.entries(NFL_TEAMS)) {
    if (fullName.toLowerCase().includes(normalized) || 
        aliases.some(a => a.toLowerCase() === normalized)) {
      return fullName;
    }
  }
  return name;
}

function calculateStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function getTrendDirection(seasonAvg: number, last5Avg: number): string {
  if (seasonAvg === 0) return 'stable';
  const pctChange = ((last5Avg - seasonAvg) / seasonAvg) * 100;
  if (pctChange > 15) return 'hot';
  if (pctChange < -15) return 'cold';
  return 'stable';
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

    const { mode = 'fetch_stats', playerNames = [] } = await req.json().catch(() => ({}));
    console.log(`[NFL Stats] Mode: ${mode}, Players: ${playerNames.length}`);

    if (mode === 'calculate_season_stats') {
      // Calculate season stats from game logs
      const { data: players } = await supabase
        .from('nfl_player_game_logs')
        .select('player_name')
        .order('player_name');
      
      const uniquePlayers = [...new Set(players?.map(p => p.player_name) || [])];
      console.log(`[NFL Stats] Calculating season stats for ${uniquePlayers.length} players`);

      let processed = 0;
      for (const playerName of uniquePlayers) {
        const { data: gameLogs } = await supabase
          .from('nfl_player_game_logs')
          .select('*')
          .eq('player_name', playerName)
          .order('game_date', { ascending: false });

        if (!gameLogs || gameLogs.length < 2) continue;

        const homeGames = gameLogs.filter(g => g.is_home);
        const awayGames = gameLogs.filter(g => !g.is_home);
        const last5 = gameLogs.slice(0, 5);

        // Calculate averages
        const passingYards = gameLogs.map(g => g.passing_yards || 0);
        const rushingYards = gameLogs.map(g => g.rushing_yards || 0);
        const receptions = gameLogs.map(g => g.receptions || 0);
        const receivingYards = gameLogs.map(g => g.receiving_yards || 0);
        const passingTds = gameLogs.map(g => g.passing_tds || 0);

        const seasonStats = {
          player_name: playerName,
          team: gameLogs[0]?.team || null,
          games_played: gameLogs.length,
          passing_yards_avg: passingYards.reduce((a, b) => a + b, 0) / gameLogs.length,
          passing_yards_std: calculateStdDev(passingYards),
          passing_tds_avg: passingTds.reduce((a, b) => a + b, 0) / gameLogs.length,
          rushing_yards_avg: rushingYards.reduce((a, b) => a + b, 0) / gameLogs.length,
          rushing_yards_std: calculateStdDev(rushingYards),
          receptions_avg: receptions.reduce((a, b) => a + b, 0) / gameLogs.length,
          receptions_std: calculateStdDev(receptions),
          receiving_yards_avg: receivingYards.reduce((a, b) => a + b, 0) / gameLogs.length,
          receiving_yards_std: calculateStdDev(receivingYards),
          home_passing_yards_avg: homeGames.length > 0 ? homeGames.reduce((a, g) => a + (g.passing_yards || 0), 0) / homeGames.length : 0,
          away_passing_yards_avg: awayGames.length > 0 ? awayGames.reduce((a, g) => a + (g.passing_yards || 0), 0) / awayGames.length : 0,
          home_rushing_yards_avg: homeGames.length > 0 ? homeGames.reduce((a, g) => a + (g.rushing_yards || 0), 0) / homeGames.length : 0,
          away_rushing_yards_avg: awayGames.length > 0 ? awayGames.reduce((a, g) => a + (g.rushing_yards || 0), 0) / awayGames.length : 0,
          home_receptions_avg: homeGames.length > 0 ? homeGames.reduce((a, g) => a + (g.receptions || 0), 0) / homeGames.length : 0,
          away_receptions_avg: awayGames.length > 0 ? awayGames.reduce((a, g) => a + (g.receptions || 0), 0) / awayGames.length : 0,
          last10_passing_yards_avg: last5.reduce((a, g) => a + (g.passing_yards || 0), 0) / Math.max(last5.length, 1),
          last10_rushing_yards_avg: last5.reduce((a, g) => a + (g.rushing_yards || 0), 0) / Math.max(last5.length, 1),
          last10_receptions_avg: last5.reduce((a, g) => a + (g.receptions || 0), 0) / Math.max(last5.length, 1),
          consistency_score: 100 - Math.min(100, (calculateStdDev(passingYards) + calculateStdDev(rushingYards) + calculateStdDev(receptions)) / 3),
          trend_direction: getTrendDirection(
            passingYards.reduce((a, b) => a + b, 0) / gameLogs.length,
            last5.reduce((a, g) => a + (g.passing_yards || 0), 0) / Math.max(last5.length, 1)
          ),
          updated_at: new Date().toISOString(),
        };

        await supabase
          .from('nfl_player_season_stats')
          .upsert(seasonStats, { onConflict: 'player_name' });
        
        processed++;
      }

      console.log(`[NFL Stats] Calculated season stats for ${processed} players`);

      return new Response(JSON.stringify({
        success: true,
        mode,
        playersProcessed: processed,
        duration: Date.now() - startTime,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Default mode: log job for manual data entry reminder
    // Since we don't have a free NFL stats API, we'll need to seed data manually
    // or integrate with a paid API in the future
    console.log(`[NFL Stats] To populate NFL data, use manual CSV import or integrate with paid API`);
    console.log(`[NFL Stats] Suggested APIs: ESPN API, SportsDataIO, TheRundown, MySportsFeeds`);

    // Log job history
    await supabase.from('cron_job_history').insert({
      job_name: 'nfl-stats-fetcher',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      result: { mode, message: 'Ready for NFL data. Use calculate_season_stats after populating game logs.' },
    });

    return new Response(JSON.stringify({
      success: true,
      mode,
      message: 'NFL stats fetcher ready. Populate nfl_player_game_logs table with game data, then call with mode=calculate_season_stats',
      duration: Date.now() - startTime,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[NFL Stats] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
