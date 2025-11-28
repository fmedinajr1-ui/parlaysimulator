import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ESPN API endpoints (free, no API key required)
const ESPN_ENDPOINTS: Record<string, string> = {
  'nfl': 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  'nba': 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  'mlb': 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
  'nhl': 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
  'ncaaf': 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
  'ncaab': 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard',
  'wnba': 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard',
};

interface GameResult {
  eventId: string;
  status: 'scheduled' | 'in_progress' | 'final' | 'postponed';
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  startTime: string;
  period?: string;
  clock?: string;
  winner?: string;
}

interface ESPNEvent {
  id: string;
  name: string;
  date: string;
  status: {
    type: {
      name: string;
      state: string;
      completed: boolean;
    };
    period?: number;
    displayClock?: string;
  };
  competitions: Array<{
    competitors: Array<{
      homeAway: string;
      team: {
        displayName: string;
        abbreviation: string;
      };
      score?: string;
      winner?: boolean;
    }>;
  }>;
}

function parseESPNStatus(status: ESPNEvent['status']): 'scheduled' | 'in_progress' | 'final' | 'postponed' {
  const state = status.type.state;
  if (state === 'pre') return 'scheduled';
  if (state === 'in') return 'in_progress';
  if (state === 'post') return 'final';
  if (status.type.name === 'STATUS_POSTPONED') return 'postponed';
  return 'scheduled';
}

function parseESPNEvent(event: ESPNEvent): GameResult {
  const competition = event.competitions[0];
  const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
  const awayTeam = competition.competitors.find(c => c.homeAway === 'away');
  
  const status = parseESPNStatus(event.status);
  
  return {
    eventId: event.id,
    status,
    homeTeam: homeTeam?.team.displayName || 'Unknown',
    awayTeam: awayTeam?.team.displayName || 'Unknown',
    homeScore: homeTeam?.score ? parseInt(homeTeam.score) : null,
    awayScore: awayTeam?.score ? parseInt(awayTeam.score) : null,
    startTime: event.date,
    period: event.status.period?.toString(),
    clock: event.status.displayClock,
    winner: status === 'final' 
      ? (homeTeam?.winner ? homeTeam.team.displayName : awayTeam?.team.displayName)
      : undefined,
  };
}

// Find a game by searching for team names in the description
function findGameForLeg(games: GameResult[], legDescription: string): GameResult | null {
  const desc = legDescription.toLowerCase();
  
  for (const game of games) {
    const homeMatch = game.homeTeam.toLowerCase();
    const awayMatch = game.awayTeam.toLowerCase();
    
    // Check if either team name appears in the description
    if (desc.includes(homeMatch) || desc.includes(awayMatch)) {
      return game;
    }
    
    // Also check for common abbreviations
    const homeAbbrev = game.homeTeam.split(' ').pop()?.toLowerCase() || '';
    const awayAbbrev = game.awayTeam.split(' ').pop()?.toLowerCase() || '';
    
    if (desc.includes(homeAbbrev) || desc.includes(awayAbbrev)) {
      return game;
    }
  }
  
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sport, legDescriptions, date } = await req.json();
    
    console.log(`Fetching scores for sport: ${sport}, date: ${date || 'today'}`);
    
    // Determine which sport endpoint to use
    const sportKey = sport?.toLowerCase() || 'nba';
    const endpoint = ESPN_ENDPOINTS[sportKey];
    
    if (!endpoint) {
      console.log(`Unknown sport: ${sport}, defaulting to checking all sports`);
    }
    
    // Fetch games from ESPN
    const sportsToCheck = endpoint ? [sportKey] : Object.keys(ESPN_ENDPOINTS);
    const allGames: GameResult[] = [];
    
    for (const sportToCheck of sportsToCheck) {
      try {
        const url = date 
          ? `${ESPN_ENDPOINTS[sportToCheck]}?dates=${date.replace(/-/g, '')}`
          : ESPN_ENDPOINTS[sportToCheck];
          
        console.log(`Fetching from: ${url}`);
        
        const response = await fetch(url);
        if (!response.ok) {
          console.log(`Failed to fetch ${sportToCheck}: ${response.status}`);
          continue;
        }
        
        const data = await response.json();
        const events = data.events || [];
        
        console.log(`Found ${events.length} events for ${sportToCheck}`);
        
        const games = events.map((event: ESPNEvent) => ({
          ...parseESPNEvent(event),
          sport: sportToCheck,
        }));
        
        allGames.push(...games);
      } catch (err) {
        console.error(`Error fetching ${sportToCheck}:`, err);
      }
    }
    
    // If leg descriptions provided, match games to legs
    let matchedGames: Record<number, GameResult | null> = {};
    
    if (legDescriptions && Array.isArray(legDescriptions)) {
      legDescriptions.forEach((desc: string, idx: number) => {
        matchedGames[idx] = findGameForLeg(allGames, desc);
        if (matchedGames[idx]) {
          console.log(`Matched leg ${idx} to game: ${matchedGames[idx]?.homeTeam} vs ${matchedGames[idx]?.awayTeam}`);
        }
      });
    }
    
    return new Response(
      JSON.stringify({
        games: allGames,
        matchedGames,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in fetch-game-scores:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
