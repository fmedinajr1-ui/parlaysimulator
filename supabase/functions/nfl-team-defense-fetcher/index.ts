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

// Extract stat from ESPN stats array - handles multiple formats
function extractStat(stats: any[], ...possibleNames: string[]): number {
  if (!stats || !Array.isArray(stats)) return 0;
  
  for (const name of possibleNames) {
    const stat = stats.find((s: any) => 
      s?.name?.toLowerCase() === name.toLowerCase() || 
      s?.displayName?.toLowerCase() === name.toLowerCase() ||
      s?.abbreviation?.toLowerCase() === name.toLowerCase()
    );
    if (stat?.value !== undefined) {
      return parseFloat(stat.value) || 0;
    }
    if (stat?.displayValue !== undefined) {
      return parseFloat(stat.displayValue.replace(/,/g, '')) || 0;
    }
  }
  return 0;
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
    
    // Use NFL team statistics endpoint that returns actual defensive stats
    for (const team of NFL_TEAMS) {
      try {
        // ESPN team stats endpoint for defense
        const statsUrl = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/types/2/teams/${team.id}/statistics`;
        console.log(`[NFL Defense] Fetching ${team.abbrev}...`);
        
        const res = await fetch(statsUrl);
        if (!res.ok) {
          console.log(`[NFL Defense] Primary endpoint failed for ${team.abbrev}: ${res.status}`);
          
          // Fallback to site API
          const fallbackUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.id}/statistics?season=${season}`;
          const fallbackRes = await fetch(fallbackUrl);
          
          if (!fallbackRes.ok) {
            console.log(`[NFL Defense] Fallback also failed for ${team.abbrev}`);
            continue;
          }
          
          const fallbackData = await fallbackRes.json();
          console.log(`[NFL Defense] ${team.abbrev} fallback response keys:`, Object.keys(fallbackData));
          
          // Parse site API format
          const categories = fallbackData.results?.stats || fallbackData.stats || [];
          let gamesPlayed = 17;
          let rushYards = 0, rushTds = 0, rushAttempts = 0;
          let passYards = 0, passTds = 0, completions = 0, interceptions = 0;
          let pointsAllowed = 0;
          
          for (const cat of categories) {
            const catName = (cat.name || cat.displayName || '').toLowerCase();
            const catStats = cat.stats || [];
            
            // Check for defensive stats
            if (catName.includes('defense') || catName.includes('defensive')) {
              gamesPlayed = extractStat(catStats, 'gamesPlayed', 'GP', 'games') || 17;
              
              // Rushing defense stats
              if (catName.includes('rush')) {
                rushYards = extractStat(catStats, 'rushingYardsAllowed', 'yardsAllowed', 'yards', 'YDS');
                rushTds = extractStat(catStats, 'rushingTouchdownsAllowed', 'TDAllowed', 'TD');
                rushAttempts = extractStat(catStats, 'rushingAttempts', 'attempts', 'ATT');
              }
              
              // Passing defense stats
              if (catName.includes('pass')) {
                passYards = extractStat(catStats, 'passingYardsAllowed', 'yardsAllowed', 'yards', 'YDS');
                passTds = extractStat(catStats, 'passingTouchdownsAllowed', 'TDAllowed', 'TD');
                completions = extractStat(catStats, 'completionsAllowed', 'completions', 'CMP');
                interceptions = extractStat(catStats, 'interceptions', 'INT');
              }
              
              // General defense
              if (catName === 'defense' || catName === 'defensive') {
                pointsAllowed = extractStat(catStats, 'pointsAllowed', 'points', 'PTS');
                interceptions = interceptions || extractStat(catStats, 'interceptions', 'INT');
              }
            }
          }
          
          const teamStats: TeamDefenseStats = {
            team_abbrev: team.abbrev,
            team_name: team.name,
            rush_yards_allowed_per_game: gamesPlayed > 0 ? rushYards / gamesPlayed : 0,
            rush_tds_allowed: rushTds,
            rush_attempts_against: rushAttempts,
            rush_yards_per_attempt_allowed: rushAttempts > 0 ? rushYards / rushAttempts : 0,
            pass_yards_allowed_per_game: gamesPlayed > 0 ? passYards / gamesPlayed : 0,
            pass_tds_allowed: passTds,
            completions_allowed: completions,
            interceptions_forced: interceptions,
            total_yards_allowed_per_game: gamesPlayed > 0 ? (rushYards + passYards) / gamesPlayed : 0,
            points_allowed_per_game: gamesPlayed > 0 ? pointsAllowed / gamesPlayed : 0,
            games_played: gamesPlayed,
            season,
          };
          
          allTeamStats.push(teamStats);
          await new Promise(resolve => setTimeout(resolve, 200));
          continue;
        }
        
        const data = await res.json();
        
        // Parse core API response structure
        let gamesPlayed = 17;
        let rushYards = 0, rushTds = 0, rushAttempts = 0;
        let passYards = 0, passTds = 0, completions = 0, interceptions = 0;
        let pointsAllowed = 0;
        
        // Core API structure uses splits
        const splits = data.splits?.categories || [];
        
        console.log(`[NFL Defense] ${team.abbrev} found ${splits.length} stat categories`);
        
        for (const category of splits) {
          const catName = (category.name || category.displayName || '').toLowerCase();
          const catStats = category.stats || [];
          
          console.log(`[NFL Defense] ${team.abbrev} category: ${catName}, stats count: ${catStats.length}`);
          
          // Games played
          if (catName.includes('general') || catName.includes('games')) {
            gamesPlayed = extractStat(catStats, 'gamesPlayed', 'GP', 'games') || 17;
          }
          
          // Rushing stats (look for opponent/allowed data)
          if (catName.includes('rushing')) {
            const yards = extractStat(catStats, 'rushingYardsAgainst', 'opponentRushingYards', 'yardsAllowed', 'rushingYards');
            if (yards > 0) rushYards = yards;
            
            const tds = extractStat(catStats, 'rushingTouchdownsAgainst', 'opponentRushingTD', 'rushingTouchdowns');
            if (tds > 0) rushTds = tds;
            
            const atts = extractStat(catStats, 'rushingAttemptsAgainst', 'opponentRushingAttempts', 'rushingAttempts');
            if (atts > 0) rushAttempts = atts;
          }
          
          // Passing stats
          if (catName.includes('passing')) {
            const yards = extractStat(catStats, 'passingYardsAgainst', 'opponentPassingYards', 'yardsAllowed', 'passingYards');
            if (yards > 0) passYards = yards;
            
            const tds = extractStat(catStats, 'passingTouchdownsAgainst', 'opponentPassingTD', 'passingTouchdowns');
            if (tds > 0) passTds = tds;
            
            const cmps = extractStat(catStats, 'completionsAgainst', 'opponentCompletions', 'completions');
            if (cmps > 0) completions = cmps;
          }
          
          // Defensive/turnover stats
          if (catName.includes('defense') || catName.includes('turnover') || catName.includes('interception')) {
            const ints = extractStat(catStats, 'interceptions', 'INT', 'defensiveInterceptions');
            if (ints > 0) interceptions = ints;
            
            const pts = extractStat(catStats, 'pointsAgainst', 'pointsAllowed', 'opponentPoints', 'points');
            if (pts > 0) pointsAllowed = pts;
          }
          
          // Scoring
          if (catName.includes('scoring') || catName.includes('points')) {
            const pts = extractStat(catStats, 'pointsAgainst', 'pointsAllowed', 'opponentPoints');
            if (pts > 0) pointsAllowed = pts;
          }
        }
        
        const teamStats: TeamDefenseStats = {
          team_abbrev: team.abbrev,
          team_name: team.name,
          rush_yards_allowed_per_game: gamesPlayed > 0 ? rushYards / gamesPlayed : 0,
          rush_tds_allowed: rushTds,
          rush_attempts_against: rushAttempts,
          rush_yards_per_attempt_allowed: rushAttempts > 0 ? rushYards / rushAttempts : 0,
          pass_yards_allowed_per_game: gamesPlayed > 0 ? passYards / gamesPlayed : 0,
          pass_tds_allowed: passTds,
          completions_allowed: completions,
          interceptions_forced: interceptions,
          total_yards_allowed_per_game: gamesPlayed > 0 ? (rushYards + passYards) / gamesPlayed : 0,
          points_allowed_per_game: gamesPlayed > 0 ? pointsAllowed / gamesPlayed : 0,
          games_played: gamesPlayed,
          season,
        };
        
        allTeamStats.push(teamStats);
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (teamError) {
        console.error(`[NFL Defense] Error for ${team.abbrev}:`, teamError);
        errors.push(`${team.abbrev}: ${teamError}`);
      }
    }
    
    console.log(`[NFL Defense Fetcher] Fetched stats for ${allTeamStats.length} teams`);
    
    // If we still have 0 data, use the standings API for basic defensive data
    if (allTeamStats.every(t => t.points_allowed_per_game === 0)) {
      console.log('[NFL Defense] No data from stats API, trying standings...');
      
      try {
        const standingsUrl = `https://site.api.espn.com/apis/v2/sports/football/nfl/standings?season=${season}`;
        const standingsRes = await fetch(standingsUrl);
        
        if (standingsRes.ok) {
          const standingsData = await standingsRes.json();
          const children = standingsData.children || [];
          
          for (const conf of children) {
            const divChildren = conf.standings?.entries || conf.children || [];
            
            for (const entry of divChildren) {
              const teamAbbrev = entry.team?.abbreviation;
              const stats = entry.stats || [];
              
              const matchedTeam = allTeamStats.find(t => t.team_abbrev === teamAbbrev);
              if (matchedTeam) {
                const pointsAgainst = stats.find((s: any) => s.name === 'pointsAgainst' || s.abbreviation === 'PA');
                const gamesPlayed = stats.find((s: any) => s.name === 'gamesPlayed' || s.abbreviation === 'GP');
                
                if (pointsAgainst?.value && gamesPlayed?.value) {
                  matchedTeam.points_allowed_per_game = parseFloat(pointsAgainst.value) / parseFloat(gamesPlayed.value);
                  matchedTeam.games_played = parseFloat(gamesPlayed.value);
                }
              }
            }
          }
        }
      } catch (standingsError) {
        console.error('[NFL Defense] Standings fetch error:', standingsError);
      }
    }
    
    // Calculate rankings (lower yards/points = better rank = lower number)
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
