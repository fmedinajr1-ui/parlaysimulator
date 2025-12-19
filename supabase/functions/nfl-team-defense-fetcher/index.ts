import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ESPN NFL Team IDs and abbreviations
const NFL_TEAMS: { id: number; abbrev: string; name: string }[] = [
  { id: 1, abbrev: 'ATL', name: 'Atlanta Falcons' },
  { id: 2, abbrev: 'BUF', name: 'Buffalo Bills' },
  { id: 3, abbrev: 'CHI', name: 'Chicago Bears' },
  { id: 4, abbrev: 'CIN', name: 'Cincinnati Bengals' },
  { id: 5, abbrev: 'CLE', name: 'Cleveland Browns' },
  { id: 6, abbrev: 'DAL', name: 'Dallas Cowboys' },
  { id: 7, abbrev: 'DEN', name: 'Denver Broncos' },
  { id: 8, abbrev: 'DET', name: 'Detroit Lions' },
  { id: 9, abbrev: 'GB', name: 'Green Bay Packers' },
  { id: 10, abbrev: 'TEN', name: 'Tennessee Titans' },
  { id: 11, abbrev: 'IND', name: 'Indianapolis Colts' },
  { id: 12, abbrev: 'KC', name: 'Kansas City Chiefs' },
  { id: 13, abbrev: 'LV', name: 'Las Vegas Raiders' },
  { id: 14, abbrev: 'LAR', name: 'Los Angeles Rams' },
  { id: 15, abbrev: 'MIA', name: 'Miami Dolphins' },
  { id: 16, abbrev: 'MIN', name: 'Minnesota Vikings' },
  { id: 17, abbrev: 'NE', name: 'New England Patriots' },
  { id: 18, abbrev: 'NO', name: 'New Orleans Saints' },
  { id: 19, abbrev: 'NYG', name: 'New York Giants' },
  { id: 20, abbrev: 'NYJ', name: 'New York Jets' },
  { id: 21, abbrev: 'PHI', name: 'Philadelphia Eagles' },
  { id: 22, abbrev: 'ARI', name: 'Arizona Cardinals' },
  { id: 23, abbrev: 'PIT', name: 'Pittsburgh Steelers' },
  { id: 24, abbrev: 'LAC', name: 'Los Angeles Chargers' },
  { id: 25, abbrev: 'SF', name: 'San Francisco 49ers' },
  { id: 26, abbrev: 'SEA', name: 'Seattle Seahawks' },
  { id: 27, abbrev: 'TB', name: 'Tampa Bay Buccaneers' },
  { id: 28, abbrev: 'WSH', name: 'Washington Commanders' },
  { id: 29, abbrev: 'CAR', name: 'Carolina Panthers' },
  { id: 30, abbrev: 'JAX', name: 'Jacksonville Jaguars' },
  { id: 33, abbrev: 'BAL', name: 'Baltimore Ravens' },
  { id: 34, abbrev: 'HOU', name: 'Houston Texans' },
];

const ESPN_NFL_API = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

interface TeamDefenseStats {
  team_abbrev: string;
  team_name: string;
  rush_yards_allowed_per_game: number;
  rush_tds_allowed: number;
  rush_attempts_against: number;
  rush_yards_per_attempt_allowed: number;
  pass_yards_allowed_per_game: number;
  pass_tds_allowed: number;
  completions_allowed: number;
  interceptions_forced: number;
  total_yards_allowed_per_game: number;
  points_allowed_per_game: number;
  games_played: number;
  season: string;
}

// Extract stat value from ESPN stats array
function extractStat(stats: any[], statName: string): number {
  const stat = stats?.find((s: any) => s.name === statName || s.displayName === statName);
  return stat ? parseFloat(stat.value) || 0 : 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { season = '2024' } = await req.json().catch(() => ({}));
    
    console.log(`[NFL Defense Fetcher] Starting fetch for ${season} season...`);
    
    const allTeamStats: TeamDefenseStats[] = [];
    const errors: string[] = [];
    
    // Fetch each team's defensive stats
    for (const team of NFL_TEAMS) {
      try {
        const statsUrl = `${ESPN_NFL_API}/teams/${team.id}/statistics?season=${season}`;
        console.log(`[NFL Defense] Fetching ${team.abbrev}...`);
        
        const res = await fetch(statsUrl);
        if (!res.ok) {
          console.log(`[NFL Defense] Failed for ${team.abbrev}: ${res.status}`);
          continue;
        }
        
        const data = await res.json();
        const splits = data.results?.stats?.categories || data.stats?.categories || [];
        
        // Find defensive categories
        let rushDefense: any[] = [];
        let passDefense: any[] = [];
        let defense: any[] = [];
        
        for (const category of splits) {
          const catName = category.name?.toLowerCase() || '';
          if (catName.includes('rushing') && catName.includes('defense')) {
            rushDefense = category.stats || [];
          } else if (catName.includes('passing') && catName.includes('defense')) {
            passDefense = category.stats || [];
          } else if (catName === 'defense' || catName.includes('defensive')) {
            defense = category.stats || [];
          }
        }
        
        // Calculate per-game stats
        const gamesPlayed = extractStat(defense, 'gamesPlayed') || 
                           extractStat(rushDefense, 'gamesPlayed') || 17;
        
        const rushYardsAllowed = extractStat(rushDefense, 'rushingYardsAllowed') || 
                                  extractStat(rushDefense, 'rushingYards') || 0;
        const rushTdsAllowed = extractStat(rushDefense, 'rushingTouchdownsAllowed') ||
                               extractStat(rushDefense, 'rushingTouchdowns') || 0;
        const rushAttempts = extractStat(rushDefense, 'rushingAttempts') || 0;
        
        const passYardsAllowed = extractStat(passDefense, 'passingYardsAllowed') ||
                                  extractStat(passDefense, 'passingYards') || 0;
        const passTdsAllowed = extractStat(passDefense, 'passingTouchdownsAllowed') ||
                               extractStat(passDefense, 'passingTouchdowns') || 0;
        const completions = extractStat(passDefense, 'completions') || 0;
        const interceptions = extractStat(passDefense, 'interceptions') || 
                             extractStat(defense, 'interceptions') || 0;
        
        const pointsAllowed = extractStat(defense, 'pointsAllowed') || 
                              extractStat(defense, 'totalPointsAllowed') || 0;
        
        const teamStats: TeamDefenseStats = {
          team_abbrev: team.abbrev,
          team_name: team.name,
          rush_yards_allowed_per_game: gamesPlayed > 0 ? rushYardsAllowed / gamesPlayed : 0,
          rush_tds_allowed: rushTdsAllowed,
          rush_attempts_against: rushAttempts,
          rush_yards_per_attempt_allowed: rushAttempts > 0 ? rushYardsAllowed / rushAttempts : 0,
          pass_yards_allowed_per_game: gamesPlayed > 0 ? passYardsAllowed / gamesPlayed : 0,
          pass_tds_allowed: passTdsAllowed,
          completions_allowed: completions,
          interceptions_forced: interceptions,
          total_yards_allowed_per_game: gamesPlayed > 0 ? (rushYardsAllowed + passYardsAllowed) / gamesPlayed : 0,
          points_allowed_per_game: gamesPlayed > 0 ? pointsAllowed / gamesPlayed : 0,
          games_played: gamesPlayed,
          season,
        };
        
        allTeamStats.push(teamStats);
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 150));
        
      } catch (teamError) {
        console.error(`[NFL Defense] Error for ${team.abbrev}:`, teamError);
        errors.push(`${team.abbrev}: ${teamError}`);
      }
    }
    
    console.log(`[NFL Defense Fetcher] Fetched stats for ${allTeamStats.length} teams`);
    
    // Calculate rankings
    const sortedByRush = [...allTeamStats].sort((a, b) => a.rush_yards_allowed_per_game - b.rush_yards_allowed_per_game);
    const sortedByPass = [...allTeamStats].sort((a, b) => a.pass_yards_allowed_per_game - b.pass_yards_allowed_per_game);
    const sortedByTotal = [...allTeamStats].sort((a, b) => a.total_yards_allowed_per_game - b.total_yards_allowed_per_game);
    const sortedByPoints = [...allTeamStats].sort((a, b) => a.points_allowed_per_game - b.points_allowed_per_game);
    
    // Add rankings to each team
    const rankedStats = allTeamStats.map(team => ({
      ...team,
      rush_defense_rank: sortedByRush.findIndex(t => t.team_abbrev === team.team_abbrev) + 1,
      pass_defense_rank: sortedByPass.findIndex(t => t.team_abbrev === team.team_abbrev) + 1,
      overall_defense_rank: sortedByTotal.findIndex(t => t.team_abbrev === team.team_abbrev) + 1,
      // Positional ranks (estimate based on overall)
      vs_qb_rank: sortedByPass.findIndex(t => t.team_abbrev === team.team_abbrev) + 1,
      vs_rb_rank: sortedByRush.findIndex(t => t.team_abbrev === team.team_abbrev) + 1,
      vs_wr_rank: sortedByPass.findIndex(t => t.team_abbrev === team.team_abbrev) + 1,
      vs_te_rank: Math.round((sortedByPass.findIndex(t => t.team_abbrev === team.team_abbrev) + sortedByPoints.findIndex(t => t.team_abbrev === team.team_abbrev)) / 2) + 1,
      updated_at: new Date().toISOString(),
    }));
    
    // Upsert to database
    const { error: upsertError } = await supabase
      .from('nfl_team_defense_stats')
      .upsert(rankedStats, { 
        onConflict: 'team_abbrev',
        ignoreDuplicates: false 
      });
    
    if (upsertError) {
      console.error('[NFL Defense Fetcher] Upsert error:', upsertError);
      errors.push(upsertError.message);
    }
    
    const duration = Date.now() - startTime;
    console.log(`[NFL Defense Fetcher] Complete: ${rankedStats.length} teams in ${duration}ms`);

    // Log job history
    await supabase.from('cron_job_history').insert({
      job_name: 'nfl-team-defense-fetcher',
      status: errors.length > 0 ? 'partial' : 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { teamsProcessed: rankedStats.length, errors: errors.slice(0, 5) },
    });

    return new Response(
      JSON.stringify({
        success: true,
        teamsProcessed: rankedStats.length,
        duration,
        errors: errors.slice(0, 5),
        sample: rankedStats.slice(0, 3),
        message: `Fetched defense stats for ${rankedStats.length} NFL teams`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[NFL Defense Fetcher] Fatal error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});