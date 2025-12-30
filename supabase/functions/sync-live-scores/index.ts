import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ESPN API endpoints for live scores
const ESPN_ENDPOINTS: Record<string, string> = {
  'NBA': 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  'NFL': 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  'NHL': 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
  'MLB': 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
  'NCAAB': 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard',
  'NCAAF': 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
};

interface LiveGameScore {
  event_id: string;
  sport: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  game_status: string;
  period: string | null;
  clock: string | null;
  start_time: string;
  player_stats: any[];
  quarter_scores: Record<string, any>;
}

function parseESPNStatus(statusType: any): string {
  const state = statusType?.state?.toLowerCase();
  if (state === 'in') return 'in_progress';
  if (state === 'post') return 'final';
  if (state === 'pre') return 'scheduled';
  if (statusType?.description?.toLowerCase().includes('halftime')) return 'halftime';
  if (statusType?.description?.toLowerCase().includes('postponed')) return 'postponed';
  return 'scheduled';
}

function parseESPNPeriod(competition: any, sport: string): string | null {
  const status = competition?.status;
  if (!status) return null;
  
  const period = status.period;
  const displayClock = status.displayClock;
  
  if (sport === 'NBA' || sport === 'NCAAB') {
    if (period === 1) return 'Q1';
    if (period === 2) return 'Q2';
    if (period === 3) return 'Q3';
    if (period === 4) return 'Q4';
    if (period > 4) return `OT${period - 4}`;
  } else if (sport === 'NFL' || sport === 'NCAAF') {
    if (period === 1) return '1Q';
    if (period === 2) return '2Q';
    if (period === 3) return '3Q';
    if (period === 4) return '4Q';
    if (period > 4) return 'OT';
  } else if (sport === 'NHL') {
    if (period === 1) return 'P1';
    if (period === 2) return 'P2';
    if (period === 3) return 'P3';
    if (period > 3) return 'OT';
  } else if (sport === 'MLB') {
    return `${period}`;
  }
  
  return period?.toString() || null;
}

function parseQuarterScores(competitors: any[], sport: string): Record<string, any> {
  const quarters: Record<string, any> = {};
  
  for (const competitor of competitors) {
    const teamName = competitor.team?.abbreviation || competitor.team?.shortDisplayName || 'Unknown';
    const linescores = competitor.linescores || [];
    
    quarters[teamName] = linescores.map((ls: any, idx: number) => ({
      period: idx + 1,
      score: parseInt(ls.value) || 0,
    }));
  }
  
  return quarters;
}

async function fetchPlayerStats(eventId: string, sport: string): Promise<any[]> {
  try {
    const sportPath = sport === 'NBA' ? 'basketball/nba' : 
                      sport === 'NFL' ? 'football/nfl' :
                      sport === 'NHL' ? 'hockey/nhl' :
                      sport === 'MLB' ? 'baseball/mlb' :
                      sport === 'NCAAB' ? 'basketball/mens-college-basketball' :
                      sport === 'NCAAF' ? 'football/college-football' : null;
    
    if (!sportPath) return [];
    
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${eventId}`;
    const response = await fetch(url);
    
    if (!response.ok) return [];
    
    const data = await response.json();
    const boxscore = data?.boxscore;
    
    if (!boxscore?.players) return [];
    
    const playerStats: any[] = [];
    
    for (const teamPlayers of boxscore.players) {
      const teamName = teamPlayers.team?.abbreviation || 'Unknown';
      
      for (const statCategory of (teamPlayers.statistics || [])) {
        const labels = statCategory.labels || [];
        
        for (const athlete of (statCategory.athletes || [])) {
          const stats: Record<string, any> = {
            playerId: athlete.athlete?.id,
            playerName: athlete.athlete?.displayName,
            team: teamName,
            position: athlete.athlete?.position?.abbreviation,
          };
          
          // Parse stats based on labels
          (athlete.stats || []).forEach((value: string, idx: number) => {
            const label = labels[idx];
            if (label) {
              stats[label.toLowerCase()] = value;
            }
          });
          
          // Extract key stats for display
          if (sport === 'NBA' || sport === 'NCAAB') {
            stats.points = parseInt(stats.pts) || 0;
            stats.rebounds = parseInt(stats.reb) || 0;
            stats.assists = parseInt(stats.ast) || 0;
            stats.minutes = stats.min || '0';
          } else if (sport === 'NFL' || sport === 'NCAAF') {
            stats.passingYards = parseInt(stats.yds) || 0;
            stats.rushingYards = parseInt(stats.rush) || 0;
            stats.receivingYards = parseInt(stats.rec) || 0;
          }
          
          playerStats.push(stats);
        }
      }
    }
    
    return playerStats;
  } catch (error) {
    console.error(`Error fetching player stats for ${eventId}:`, error);
    return [];
  }
}

async function fetchLiveScores(sport: string): Promise<LiveGameScore[]> {
  const endpoint = ESPN_ENDPOINTS[sport];
  if (!endpoint) return [];
  
  try {
    console.log(`Fetching ${sport} scores from ESPN...`);
    const response = await fetch(endpoint);
    
    if (!response.ok) {
      console.error(`ESPN API error for ${sport}: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    const events = data?.events || [];
    const games: LiveGameScore[] = [];
    
    for (const event of events) {
      const competition = event.competitions?.[0];
      if (!competition) continue;
      
      const competitors = competition.competitors || [];
      const homeTeam = competitors.find((c: any) => c.homeAway === 'home');
      const awayTeam = competitors.find((c: any) => c.homeAway === 'away');
      
      if (!homeTeam || !awayTeam) continue;
      
      const status = parseESPNStatus(competition.status?.type);
      const period = parseESPNPeriod(competition, sport);
      const clock = competition.status?.displayClock || null;
      
      // Fetch player stats for in-progress games
      let playerStats: any[] = [];
      if (status === 'in_progress' || status === 'halftime') {
        playerStats = await fetchPlayerStats(event.id, sport);
      }
      
      games.push({
        event_id: event.id,
        sport,
        home_team: homeTeam.team?.displayName || homeTeam.team?.shortDisplayName || 'Unknown',
        away_team: awayTeam.team?.displayName || awayTeam.team?.shortDisplayName || 'Unknown',
        home_score: parseInt(homeTeam.score) || 0,
        away_score: parseInt(awayTeam.score) || 0,
        game_status: status,
        period,
        clock: status === 'in_progress' ? clock : null,
        start_time: event.date || new Date().toISOString(),
        player_stats: playerStats,
        quarter_scores: parseQuarterScores(competitors, sport),
      });
    }
    
    console.log(`Found ${games.length} ${sport} games, ${games.filter(g => g.game_status === 'in_progress').length} in progress`);
    return games;
  } catch (error) {
    console.error(`Error fetching ${sport} scores:`, error);
    return [];
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    console.log('Starting live score sync...');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Parse request body for specific sport filter
    let sportFilter: string | null = null;
    try {
      const body = await req.json();
      sportFilter = body?.sport || null;
    } catch {
      // No body or invalid JSON, sync all sports
    }
    
    const sportsToSync = sportFilter 
      ? [sportFilter.toUpperCase()] 
      : ['NBA', 'NFL', 'NHL', 'MLB', 'NCAAB'];
    
    let totalGames = 0;
    let liveGames = 0;
    let errors: string[] = [];
    
    for (const sport of sportsToSync) {
      try {
        const games = await fetchLiveScores(sport);
        totalGames += games.length;
        liveGames += games.filter(g => g.game_status === 'in_progress' || g.game_status === 'halftime').length;
        
        // Upsert all games
        for (const game of games) {
          const { error } = await supabase
            .from('live_game_scores')
            .upsert({
              ...game,
              last_updated: new Date().toISOString(),
            }, {
              onConflict: 'event_id',
            });
          
          if (error) {
            console.error(`Error upserting game ${game.event_id}:`, error);
            errors.push(`${game.event_id}: ${error.message}`);
          }
        }
      } catch (err) {
        console.error(`Error processing ${sport}:`, err);
        errors.push(`${sport}: ${err}`);
      }
    }
    
    // Clean up old games (older than 24 hours and final)
    const { error: cleanupError } = await supabase
      .from('live_game_scores')
      .delete()
      .eq('game_status', 'final')
      .lt('last_updated', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    
    if (cleanupError) {
      console.error('Error cleaning up old games:', cleanupError);
    }
    
    console.log(`Sync complete: ${totalGames} total games, ${liveGames} live`);
    
    return new Response(JSON.stringify({
      success: true,
      totalGames,
      liveGames,
      sports: sportsToSync,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Sync error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});