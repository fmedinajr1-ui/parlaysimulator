import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NHL Team abbreviations
const NHL_TEAMS = [
  { abbrev: 'ANA', name: 'Anaheim Ducks' },
  { abbrev: 'ARI', name: 'Arizona Coyotes' },
  { abbrev: 'BOS', name: 'Boston Bruins' },
  { abbrev: 'BUF', name: 'Buffalo Sabres' },
  { abbrev: 'CGY', name: 'Calgary Flames' },
  { abbrev: 'CAR', name: 'Carolina Hurricanes' },
  { abbrev: 'CHI', name: 'Chicago Blackhawks' },
  { abbrev: 'COL', name: 'Colorado Avalanche' },
  { abbrev: 'CBJ', name: 'Columbus Blue Jackets' },
  { abbrev: 'DAL', name: 'Dallas Stars' },
  { abbrev: 'DET', name: 'Detroit Red Wings' },
  { abbrev: 'EDM', name: 'Edmonton Oilers' },
  { abbrev: 'FLA', name: 'Florida Panthers' },
  { abbrev: 'LAK', name: 'Los Angeles Kings' },
  { abbrev: 'MIN', name: 'Minnesota Wild' },
  { abbrev: 'MTL', name: 'Montreal Canadiens' },
  { abbrev: 'NSH', name: 'Nashville Predators' },
  { abbrev: 'NJD', name: 'New Jersey Devils' },
  { abbrev: 'NYI', name: 'New York Islanders' },
  { abbrev: 'NYR', name: 'New York Rangers' },
  { abbrev: 'OTT', name: 'Ottawa Senators' },
  { abbrev: 'PHI', name: 'Philadelphia Flyers' },
  { abbrev: 'PIT', name: 'Pittsburgh Penguins' },
  { abbrev: 'SJS', name: 'San Jose Sharks' },
  { abbrev: 'SEA', name: 'Seattle Kraken' },
  { abbrev: 'STL', name: 'St. Louis Blues' },
  { abbrev: 'TBL', name: 'Tampa Bay Lightning' },
  { abbrev: 'TOR', name: 'Toronto Maple Leafs' },
  { abbrev: 'UTA', name: 'Utah Hockey Club' },
  { abbrev: 'VAN', name: 'Vancouver Canucks' },
  { abbrev: 'VGK', name: 'Vegas Golden Knights' },
  { abbrev: 'WSH', name: 'Washington Capitals' },
  { abbrev: 'WPG', name: 'Winnipeg Jets' },
];

const NHL_API = "https://api-web.nhle.com/v1";

interface TeamPaceStats {
  team_abbrev: string;
  team_name: string;
  shots_for_per_game: number;
  shots_against_per_game: number;
  shot_differential: number;
  goals_for_per_game: number;
  goals_against_per_game: number;
  games_played: number;
  wins: number;
  losses: number;
  ot_losses: number;
  season: string;
  save_pct: number;
  win_pct: number;
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

    const { season = '20242025' } = await req.json().catch(() => ({}));
    
    console.log(`[NHL Team Stats Fetcher] Starting fetch for ${season} season...`);
    
    const allTeamStats: TeamPaceStats[] = [];
    const errors: string[] = [];
    
    // Fetch standings first to get basic stats
    try {
      const standingsUrl = `${NHL_API}/standings/now`;
      console.log('[NHL Team Stats] Fetching standings...');
      
      const standingsRes = await fetch(standingsUrl);
      if (!standingsRes.ok) {
        throw new Error(`Standings fetch failed: ${standingsRes.status}`);
      }
      
      const standingsData = await standingsRes.json();
      const standings = standingsData.standings || [];
      
      console.log(`[NHL Team Stats] Found ${standings.length} teams in standings`);
      
      for (const team of standings) {
        const teamAbbrev = team.teamAbbrev?.default || team.teamAbbrev;
        const teamName = team.teamName?.default || team.teamName || teamAbbrev;
        const gamesPlayed = team.gamesPlayed || 0;
        
        // Goals from standings
        const goalsFor = team.goalFor || 0;
        const goalsAgainst = team.goalAgainst || 0;
        
        // Get team stats for shots
        let shotsFor = 0;
        let shotsAgainst = 0;
        
        try {
          const teamStatsUrl = `${NHL_API}/club-stats/${teamAbbrev}/now`;
          const teamStatsRes = await fetch(teamStatsUrl);
          
          if (teamStatsRes.ok) {
            const teamStatsData = await teamStatsRes.json();
            
            // Sum up shots from all skaters
            const skaters = teamStatsData.skaters || [];
            for (const skater of skaters) {
              shotsFor += skater.shots || 0;
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (e) {
          console.log(`[NHL Team Stats] Could not fetch detailed stats for ${teamAbbrev}`);
        }
        
        // Estimate shots against based on goal ratio (rough estimate if no direct data)
        if (shotsFor > 0 && gamesPlayed > 0) {
          // League average is ~30 shots per game
          const leagueAvgShots = 30;
          const goalRatio = goalsAgainst > 0 ? goalsFor / goalsAgainst : 1;
          shotsAgainst = Math.round(shotsFor / goalRatio) || shotsFor;
        }
        
        const saPerGame = gamesPlayed > 0 ? shotsAgainst / gamesPlayed : 30;
        const gaPerGame = gamesPlayed > 0 ? goalsAgainst / gamesPlayed : 3;
        const savePct = saPerGame > 0 ? 1 - (gaPerGame / saPerGame) : 0.900;
        const winPct = gamesPlayed > 0 ? (team.wins || 0) / gamesPlayed : 0;

        const teamStats: TeamPaceStats = {
          team_abbrev: teamAbbrev,
          team_name: teamName,
          shots_for_per_game: gamesPlayed > 0 ? shotsFor / gamesPlayed : 0,
          shots_against_per_game: gamesPlayed > 0 ? shotsAgainst / gamesPlayed : 0,
          shot_differential: gamesPlayed > 0 ? (shotsFor - shotsAgainst) / gamesPlayed : 0,
          goals_for_per_game: gamesPlayed > 0 ? goalsFor / gamesPlayed : 0,
          goals_against_per_game: gamesPlayed > 0 ? goalsAgainst / gamesPlayed : 0,
          games_played: gamesPlayed,
          wins: team.wins || 0,
          losses: team.losses || 0,
          ot_losses: team.otLosses || 0,
          season,
          save_pct: Math.round(savePct * 1000) / 1000,
          win_pct: Math.round(winPct * 1000) / 1000,
        };
        
        allTeamStats.push(teamStats);
      }
      
    } catch (standingsError) {
      console.error('[NHL Team Stats] Standings error:', standingsError);
      errors.push(`Standings: ${standingsError}`);
    }
    
    // Also try ESPN API for shot data
    try {
      console.log('[NHL Team Stats] Fetching from ESPN backup...');
      const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams`;
      const espnRes = await fetch(espnUrl);
      
      if (espnRes.ok) {
        const espnData = await espnRes.json();
        const espnTeams = espnData.sports?.[0]?.leagues?.[0]?.teams || [];
        
        for (const espnTeam of espnTeams) {
          const abbrev = espnTeam.team?.abbreviation;
          const existing = allTeamStats.find(t => t.team_abbrev === abbrev);
          
          if (existing && espnTeam.team?.record?.items?.[0]) {
            const record = espnTeam.team.record.items[0];
            const stats = record.stats || [];
            
            // Look for shot stats in ESPN data
            for (const stat of stats) {
              if (stat.name === 'shotsFor' || stat.displayName === 'Shots For') {
                existing.shots_for_per_game = stat.value || existing.shots_for_per_game;
              }
              if (stat.name === 'shotsAgainst' || stat.displayName === 'Shots Against') {
                existing.shots_against_per_game = stat.value || existing.shots_against_per_game;
              }
            }
          }
        }
      }
    } catch (espnError) {
      console.log('[NHL Team Stats] ESPN backup failed:', espnError);
    }
    
    console.log(`[NHL Team Stats Fetcher] Processed ${allTeamStats.length} teams`);
    
    // Calculate rankings
    const sortedByGeneration = [...allTeamStats].sort((a, b) => b.shots_for_per_game - a.shots_for_per_game);
    const sortedBySuppression = [...allTeamStats].sort((a, b) => a.shots_against_per_game - b.shots_against_per_game);
    
    // Add rankings to each team
    const rankedStats = allTeamStats.map(team => ({
      ...team,
      shot_generation_rank: sortedByGeneration.findIndex(t => t.team_abbrev === team.team_abbrev) + 1,
      shot_suppression_rank: sortedBySuppression.findIndex(t => t.team_abbrev === team.team_abbrev) + 1,
      updated_at: new Date().toISOString(),
    }));
    
    // Upsert to database
    const { error: upsertError } = await supabase
      .from('nhl_team_pace_stats')
      .upsert(rankedStats, { 
        onConflict: 'team_abbrev',
        ignoreDuplicates: false 
      });
    
    if (upsertError) {
      console.error('[NHL Team Stats Fetcher] Upsert error:', upsertError);
      errors.push(upsertError.message);
    }
    
    const duration = Date.now() - startTime;
    console.log(`[NHL Team Stats Fetcher] Complete: ${rankedStats.length} teams in ${duration}ms`);

    // Log job history
    await supabase.from('cron_job_history').insert({
      job_name: 'nhl-team-stats-fetcher',
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
        message: `Fetched pace stats for ${rankedStats.length} NHL teams`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[NHL Team Stats Fetcher] Fatal error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});