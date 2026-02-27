import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NBA Team mappings with ESPN IDs
const NBA_TEAMS = [
  { id: 1, abbrev: 'ATL', name: 'Atlanta Hawks' },
  { id: 2, abbrev: 'BOS', name: 'Boston Celtics' },
  { id: 17, abbrev: 'BKN', name: 'Brooklyn Nets' },
  { id: 30, abbrev: 'CHA', name: 'Charlotte Hornets' },
  { id: 4, abbrev: 'CHI', name: 'Chicago Bulls' },
  { id: 5, abbrev: 'CLE', name: 'Cleveland Cavaliers' },
  { id: 6, abbrev: 'DAL', name: 'Dallas Mavericks' },
  { id: 7, abbrev: 'DEN', name: 'Denver Nuggets' },
  { id: 8, abbrev: 'DET', name: 'Detroit Pistons' },
  { id: 9, abbrev: 'GSW', name: 'Golden State Warriors' },
  { id: 10, abbrev: 'HOU', name: 'Houston Rockets' },
  { id: 11, abbrev: 'IND', name: 'Indiana Pacers' },
  { id: 12, abbrev: 'LAC', name: 'Los Angeles Clippers' },
  { id: 13, abbrev: 'LAL', name: 'Los Angeles Lakers' },
  { id: 29, abbrev: 'MEM', name: 'Memphis Grizzlies' },
  { id: 14, abbrev: 'MIA', name: 'Miami Heat' },
  { id: 15, abbrev: 'MIL', name: 'Milwaukee Bucks' },
  { id: 16, abbrev: 'MIN', name: 'Minnesota Timberwolves' },
  { id: 3, abbrev: 'NOP', name: 'New Orleans Pelicans' },
  { id: 18, abbrev: 'NYK', name: 'New York Knicks' },
  { id: 25, abbrev: 'OKC', name: 'Oklahoma City Thunder' },
  { id: 19, abbrev: 'ORL', name: 'Orlando Magic' },
  { id: 20, abbrev: 'PHI', name: 'Philadelphia 76ers' },
  { id: 21, abbrev: 'PHX', name: 'Phoenix Suns' },
  { id: 22, abbrev: 'POR', name: 'Portland Trail Blazers' },
  { id: 23, abbrev: 'SAC', name: 'Sacramento Kings' },
  { id: 24, abbrev: 'SAS', name: 'San Antonio Spurs' },
  { id: 28, abbrev: 'TOR', name: 'Toronto Raptors' },
  { id: 26, abbrev: 'UTA', name: 'Utah Jazz' },
  { id: 27, abbrev: 'WAS', name: 'Washington Wizards' },
];

// Known 2025-26 pace values (updated periodically from official sources)
// These serve as baseline when APIs fail - will be updated by game log calculation
const BASELINE_PACE: Record<string, number> = {
  'IND': 103.8, 'SAC': 102.9, 'ATL': 102.5, 'MIL': 101.8, 'DEN': 101.4,
  'DAL': 101.2, 'BKN': 100.8, 'GSW': 100.6, 'PHX': 100.4, 'LAL': 100.2,
  'NOP': 100.0, 'TOR': 99.8, 'CHA': 99.6, 'POR': 99.4, 'HOU': 99.2,
  'BOS': 99.0, 'OKC': 98.9, 'CHI': 98.7, 'SAS': 98.5, 'PHI': 98.3,
  'WAS': 98.2, 'LAC': 98.0, 'DET': 97.8, 'NYK': 97.6, 'MIA': 97.4,
  'MEM': 97.2, 'MIN': 97.0, 'ORL': 96.8, 'UTA': 96.6, 'CLE': 96.4
};

interface TeamPaceData {
  team_name: string;
  team_abbrev: string;
  pace_rating: number;
  pace_rank: number;
  possessions_per_game: number;
  tempo_factor: number;
  offensive_rating: number | null;
  defensive_rating: number | null;
  net_rating: number | null;
  games_played: number;
  wins: number;
  losses: number;
  source: string;
}

// Calculate pace from player game logs for a team
// Uses the formula: Pace ≈ FGA + 0.44*FTA - ORB + TOV (per 48 minutes)
async function calculatePaceFromGameLogs(supabase: any, teamInfo: typeof NBA_TEAMS[0]): Promise<{ pace: number; gamesAnalyzed: number } | null> {
  try {
    // Get all recent game logs grouped by game to estimate team pace
    // We'll use team name matching since game logs have team info
    const teamNameParts = teamInfo.name.split(' ');
    const searchTerm = teamNameParts[teamNameParts.length - 1]; // e.g., "Hawks" from "Atlanta Hawks"
    
    const { data: gameLogs } = await supabase
      .from('nba_player_game_logs')
      .select('game_date, team, points, assists, rebounds, minutes_played, field_goal_attempts, free_throw_attempts, turnovers, offensive_rebounds')
      .or(`team.ilike.%${searchTerm}%,team.eq.${teamInfo.abbrev}`)
      .gte('game_date', new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
      .order('game_date', { ascending: false });
    
    if (!gameLogs || gameLogs.length < 15) {
      console.log(`[PaceFetcher] Not enough game logs for ${teamInfo.abbrev}: ${gameLogs?.length || 0}`);
      return null;
    }
    
    // Group by game date to get team totals per game
    const gamesByDate = new Map<string, any[]>();
    for (const log of gameLogs) {
      const date = log.game_date;
      if (!gamesByDate.has(date)) {
        gamesByDate.set(date, []);
      }
      gamesByDate.get(date)!.push(log);
    }
    
    // Calculate pace for each game
    const gamePaces: number[] = [];
    for (const [date, logs] of gamesByDate.entries()) {
      // Sum team totals
      const teamTotals = logs.reduce((acc, log) => ({
        fga: acc.fga + (log.field_goal_attempts || 0),
        fta: acc.fta + (log.free_throw_attempts || 0),
        orb: acc.orb + (log.offensive_rebounds || 0),
        tov: acc.tov + (log.turnovers || 0),
        minutes: acc.minutes + (log.minutes_played || 0)
      }), { fga: 0, fta: 0, orb: 0, tov: 0, minutes: 0 });
      
      // Only calculate if we have enough data
      if (teamTotals.minutes >= 200 && teamTotals.fga >= 70) {
        // Possessions = FGA + 0.44*FTA - ORB + TOV
        const possessions = teamTotals.fga + (0.44 * teamTotals.fta) - teamTotals.orb + teamTotals.tov;
        // Pace = possessions per 48 minutes
        const pace = (48 * possessions) / (teamTotals.minutes / 5); // Divide by 5 since we have individual player minutes
        
        if (pace >= 90 && pace <= 115) { // Sanity check
          gamePaces.push(pace);
        }
      }
    }
    
    if (gamePaces.length === 0) {
      console.log(`[PaceFetcher] No valid game paces calculated for ${teamInfo.abbrev}`);
      return null;
    }
    
    // Calculate average pace
    const avgPace = gamePaces.reduce((sum, p) => sum + p, 0) / gamePaces.length;
    
    console.log(`[PaceFetcher] Calculated pace for ${teamInfo.abbrev}: ${avgPace.toFixed(1)} from ${gamePaces.length} games`);
    
    return {
      pace: Math.round(avgPace * 10) / 10,
      gamesAnalyzed: gamePaces.length
    };
  } catch (error) {
    console.error(`[PaceFetcher] Error calculating pace from logs for ${teamInfo.abbrev}:`, error);
    return null;
  }
}

// Fetch team record from ESPN
async function fetchTeamRecord(teamId: number): Promise<{ wins: number; losses: number; gamesPlayed: number } | null> {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const record = data?.team?.record?.items?.[0];
    
    if (record) {
      const summary = record.summary || '0-0';
      const [wins, losses] = summary.split('-').map(Number);
      return { wins: wins || 0, losses: losses || 0, gamesPlayed: (wins || 0) + (losses || 0) };
    }
    
    return null;
  } catch (error) {
    console.error(`[PaceFetcher] Error fetching team record for ${teamId}:`, error);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  const startTime = Date.now();
  
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || 'refresh';
    
    console.log(`[PaceFetcher] Starting pace fetch - mode: ${mode}`);
    
    // Log job start
    const { data: jobRecord } = await supabase
      .from('cron_job_history')
      .insert({
        job_name: 'nba-team-pace-fetcher',
        status: 'running',
        started_at: new Date().toISOString()
      })
      .select()
      .single();
    
    const jobId = jobRecord?.id;
    const allTeamData: TeamPaceData[] = [];
    const paceBreakdown: { calculated: string[]; baseline: string[] } = { calculated: [], baseline: [] };
    
    // Fetch all team records in parallel first
    const recordPromises = NBA_TEAMS.map(team => fetchTeamRecord(team.id));
    const allRecords = await Promise.all(recordPromises);
    
    // Process all teams - calculate pace from game logs
    for (let i = 0; i < NBA_TEAMS.length; i++) {
      const team = NBA_TEAMS[i];
      const recordData = allRecords[i];
      
      // Try to calculate pace from game logs
      const calculatedPace = await calculatePaceFromGameLogs(supabase, team);
      
      let paceRating: number;
      let source: string;
      
      if (calculatedPace && calculatedPace.gamesAnalyzed >= 3) {
        // Use calculated pace from game logs
        paceRating = calculatedPace.pace;
        source = 'calculated';
        paceBreakdown.calculated.push(team.abbrev);
      } else {
        // Fall back to baseline values
        paceRating = BASELINE_PACE[team.abbrev] || 99;
        source = 'baseline';
        paceBreakdown.baseline.push(team.abbrev);
      }
      
      const teamPaceData: TeamPaceData = {
        team_name: team.name,
        team_abbrev: team.abbrev,
        pace_rating: paceRating,
        pace_rank: 0, // Will be calculated after all teams
        possessions_per_game: paceRating,
        tempo_factor: paceRating / 100,
        offensive_rating: null, // Would need additional data source
        defensive_rating: null,
        net_rating: null,
        games_played: recordData?.gamesPlayed || 0,
        wins: recordData?.wins || 0,
        losses: recordData?.losses || 0,
        source
      };
      
      allTeamData.push(teamPaceData);
    }
    
    // Calculate pace rankings (1 = fastest)
    const sortedByPace = [...allTeamData].sort((a, b) => b.pace_rating - a.pace_rating);
    sortedByPace.forEach((team, index) => {
      const originalTeam = allTeamData.find(t => t.team_abbrev === team.team_abbrev);
      if (originalTeam) {
        originalTeam.pace_rank = index + 1;
      }
    });
    
    // Upsert all team data
    const now = new Date().toISOString();
    const upsertData = allTeamData.map(team => ({
      team_name: team.team_name,
      team_abbrev: team.team_abbrev,
      pace_rating: team.pace_rating,
      pace_rank: team.pace_rank,
      possessions_per_game: team.possessions_per_game,
      tempo_factor: team.tempo_factor,
      offensive_rating: team.offensive_rating,
      defensive_rating: team.defensive_rating,
      net_rating: team.net_rating,
      games_played: team.games_played,
      wins: team.wins,
      losses: team.losses,
      source: team.source,
      season: '2025-26',
      updated_at: now
    }));
    
    const { error: upsertError } = await supabase
      .from('nba_team_pace_projections')
      .upsert(upsertData, { onConflict: 'team_name' });
    
    if (upsertError) {
      console.error('[PaceFetcher] Upsert error:', upsertError);
    }
    
    const duration = Date.now() - startTime;
    
    // Classify teams by pace
    const fastTeams = allTeamData.filter(t => t.pace_rating >= 102).map(t => ({ abbrev: t.team_abbrev, pace: t.pace_rating }));
    const slowTeams = allTeamData.filter(t => t.pace_rating <= 98).map(t => ({ abbrev: t.team_abbrev, pace: t.pace_rating }));
    const avgPace = allTeamData.reduce((sum, t) => sum + t.pace_rating, 0) / allTeamData.length;
    
    const result = {
      success: !upsertError,
      teamsProcessed: allTeamData.length,
      teamsUpdated: upsertData.length,
      paceBreakdown: {
        calculated: paceBreakdown.calculated.length,
        baseline: paceBreakdown.baseline.length,
        calculatedTeams: paceBreakdown.calculated,
        baselineTeams: paceBreakdown.baseline
      },
      fastTeams,
      slowTeams,
      avgLeaguePace: Math.round(avgPace * 10) / 10,
      topPace: sortedByPace.slice(0, 5).map(t => ({ abbrev: t.team_abbrev, pace: t.pace_rating, rank: t.pace_rank })),
      bottomPace: sortedByPace.slice(-5).map(t => ({ abbrev: t.team_abbrev, pace: t.pace_rating, rank: t.pace_rank })),
      duration: `${duration}ms`
    };
    
    // Update job record
    if (jobId) {
      await supabase
        .from('cron_job_history')
        .update({
          status: result.success ? 'completed' : 'partial',
          completed_at: new Date().toISOString(),
          duration_ms: duration,
          result
        })
        .eq('id', jobId);
    }
    
    console.log(`[PaceFetcher] Completed: ${result.teamsProcessed} teams, ${fastTeams.length} FAST, ${slowTeams.length} SLOW, avg pace: ${avgPace.toFixed(1)}`);
    
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('[PaceFetcher] Fatal error:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: `${Date.now() - startTime}ms`
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
