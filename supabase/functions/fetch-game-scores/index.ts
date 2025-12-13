import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// The Odds API for live scores
const ODDS_API_KEY = Deno.env.get('THE_ODDS_API_KEY');
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// ESPN API endpoints (free fallback)
const ESPN_ENDPOINTS: Record<string, string> = {
  'nfl': 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  'nba': 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  'mlb': 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
  'nhl': 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
  'ncaaf': 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
  'ncaab': 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard',
  'wnba': 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard',
  'soccer': 'https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard',
  'mls': 'https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard',
  // Also accept full API format keys
  'americanfootball_nfl': 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  'basketball_nba': 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  'baseball_mlb': 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
  'icehockey_nhl': 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
  'americanfootball_ncaaf': 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
  'basketball_ncaab': 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard',
  'basketball_wnba': 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard',
};

// Sport key mapping for The Odds API
const ODDS_API_SPORTS: Record<string, string> = {
  'nfl': 'americanfootball_nfl',
  'nba': 'basketball_nba',
  'mlb': 'baseball_mlb',
  'nhl': 'icehockey_nhl',
  'ncaaf': 'americanfootball_ncaaf',
  'ncaab': 'basketball_ncaab',
  'wnba': 'basketball_wnba',
  'soccer': 'soccer_usa_mls',
  'mls': 'soccer_usa_mls',
  // Reverse mappings (API format to API format)
  'americanfootball_nfl': 'americanfootball_nfl',
  'basketball_nba': 'basketball_nba',
  'baseball_mlb': 'baseball_mlb',
  'icehockey_nhl': 'icehockey_nhl',
  'americanfootball_ncaaf': 'americanfootball_ncaaf',
  'basketball_ncaab': 'basketball_ncaab',
  'basketball_wnba': 'basketball_wnba',
};

// Normalize sport key to simple format
function normalizeSportKey(sport: string): string {
  if (!sport) return 'nba';
  const lower = sport.toLowerCase();
  
  const mappings: Record<string, string> = {
    'basketball_nba': 'nba',
    'basketball_ncaab': 'ncaab',
    'basketball_wnba': 'wnba',
    'americanfootball_nfl': 'nfl',
    'americanfootball_ncaaf': 'ncaaf',
    'icehockey_nhl': 'nhl',
    'baseball_mlb': 'mlb',
    'soccer_usa_mls': 'mls',
  };
  
  return mappings[lower] || lower;
}

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
  sport?: string;
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
        shortDisplayName?: string;
      };
      score?: string;
      winner?: boolean;
    }>;
  }>;
}

interface OddsAPIScore {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: Array<{
    name: string;
    score: string;
  }> | null;
  last_update: string | null;
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

function parseOddsAPIScore(score: OddsAPIScore): GameResult {
  const homeScore = score.scores?.find(s => s.name === score.home_team);
  const awayScore = score.scores?.find(s => s.name === score.away_team);
  
  const homeScoreNum = homeScore?.score ? parseInt(homeScore.score) : null;
  const awayScoreNum = awayScore?.score ? parseInt(awayScore.score) : null;
  
  let winner: string | undefined;
  if (score.completed && homeScoreNum !== null && awayScoreNum !== null) {
    winner = homeScoreNum > awayScoreNum ? score.home_team : score.away_team;
  }
  
  return {
    eventId: score.id,
    status: score.completed ? 'final' : (score.scores ? 'in_progress' : 'scheduled'),
    homeTeam: score.home_team,
    awayTeam: score.away_team,
    homeScore: homeScoreNum,
    awayScore: awayScoreNum,
    startTime: score.commence_time,
    winner,
  };
}

// Normalize team name for matching
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Common team name variations
const TEAM_ALIASES: Record<string, string[]> = {
  'los angeles lakers': ['lakers', 'la lakers', 'l.a. lakers'],
  'los angeles clippers': ['clippers', 'la clippers', 'l.a. clippers'],
  'golden state warriors': ['warriors', 'gsw', 'gs warriors'],
  'new york knicks': ['knicks', 'ny knicks', 'nyknicks'],
  'brooklyn nets': ['nets', 'bkn', 'brooklyn'],
  'philadelphia 76ers': ['76ers', 'sixers', 'philly'],
  'oklahoma city thunder': ['thunder', 'okc'],
  'portland trail blazers': ['blazers', 'portland', 'trailblazers'],
  'san antonio spurs': ['spurs', 'san antonio'],
  'new orleans pelicans': ['pelicans', 'nola'],
  'minnesota timberwolves': ['timberwolves', 'wolves', 'twolves'],
  // NFL
  'kansas city chiefs': ['chiefs', 'kc chiefs', 'kansas city'],
  'san francisco 49ers': ['49ers', 'niners', 'sf 49ers'],
  'new england patriots': ['patriots', 'pats', 'new england'],
  'green bay packers': ['packers', 'gb packers', 'green bay'],
  'tampa bay buccaneers': ['bucs', 'buccaneers', 'tampa bay'],
  'new york giants': ['giants', 'ny giants', 'nygiants'],
  'new york jets': ['jets', 'ny jets', 'nyjets'],
  'los angeles rams': ['rams', 'la rams'],
  'los angeles chargers': ['chargers', 'la chargers'],
  'las vegas raiders': ['raiders', 'lv raiders', 'vegas'],
  'detroit lions': ['lions', 'detroit'],
  // MLB
  'new york yankees': ['yankees', 'ny yankees', 'nyy'],
  'new york mets': ['mets', 'ny mets', 'nym'],
  'los angeles dodgers': ['dodgers', 'la dodgers', 'lad'],
  'los angeles angels': ['angels', 'la angels', 'laa'],
  'san francisco giants': ['giants', 'sf giants'],
  'boston red sox': ['red sox', 'redsox', 'boston'],
  'chicago white sox': ['white sox', 'whitesox', 'sox'],
  'chicago cubs': ['cubs'],
};

// Find a game by searching for team names in the description
function findGameForLeg(games: GameResult[], legDescription: string): GameResult | null {
  const desc = normalizeTeamName(legDescription);
  
  for (const game of games) {
    const homeNorm = normalizeTeamName(game.homeTeam);
    const awayNorm = normalizeTeamName(game.awayTeam);
    
    // Direct match
    if (desc.includes(homeNorm) || desc.includes(awayNorm)) {
      return game;
    }
    
    // Check last word (often the team name)
    const homeLastWord = homeNorm.split(' ').pop() || '';
    const awayLastWord = awayNorm.split(' ').pop() || '';
    
    if (homeLastWord.length > 3 && desc.includes(homeLastWord)) {
      return game;
    }
    if (awayLastWord.length > 3 && desc.includes(awayLastWord)) {
      return game;
    }
    
    // Check aliases
    for (const [fullName, aliases] of Object.entries(TEAM_ALIASES)) {
      if (homeNorm.includes(fullName) || awayNorm.includes(fullName)) {
        for (const alias of aliases) {
          if (desc.includes(alias)) {
            return game;
          }
        }
      }
    }
  }
  
  return null;
}

// Fetch scores from The Odds API
async function fetchFromOddsAPI(sport: string): Promise<GameResult[]> {
  if (!ODDS_API_KEY) {
    console.log('No Odds API key configured, skipping');
    return [];
  }
  
  const sportKey = ODDS_API_SPORTS[sport.toLowerCase()];
  if (!sportKey) {
    console.log(`No Odds API mapping for sport: ${sport}`);
    return [];
  }
  
  try {
    const url = `${ODDS_API_BASE}/sports/${sportKey}/scores/?apiKey=${ODDS_API_KEY}&daysFrom=3`;
    console.log(`Fetching from Odds API: ${sportKey}`);
    
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`Odds API error: ${response.status}`);
      return [];
    }
    
    const data: OddsAPIScore[] = await response.json();
    const normalizedSport = normalizeSportKey(sport);
    console.log(`Odds API returned ${data.length} games for ${sport} (normalized: ${normalizedSport})`);
    
    return data.map(score => ({
      ...parseOddsAPIScore(score),
      sport: normalizedSport,
    }));
  } catch (err) {
    console.error(`Error fetching from Odds API:`, err);
    return [];
  }
}

// Fetch scores from ESPN
async function fetchFromESPN(sport: string, date?: string): Promise<GameResult[]> {
  // Try both original sport key and normalized version
  let endpoint = ESPN_ENDPOINTS[sport.toLowerCase()];
  if (!endpoint) {
    const normalizedSport = normalizeSportKey(sport);
    endpoint = ESPN_ENDPOINTS[normalizedSport];
  }
  
  if (!endpoint) {
    console.log(`No ESPN endpoint for sport: ${sport}`);
    return [];
  }
  
  try {
    const url = date 
      ? `${endpoint}?dates=${date.replace(/-/g, '')}`
      : endpoint;
      
    console.log(`Fetching from ESPN: ${url}`);
    
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`ESPN error: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    const events = data.events || [];
    
    const normalizedSport = normalizeSportKey(sport);
    console.log(`ESPN returned ${events.length} games for ${sport} (normalized: ${normalizedSport})`);
    
    return events.map((event: ESPNEvent) => ({
      ...parseESPNEvent(event),
      sport: normalizedSport,
    }));
  } catch (err) {
    console.error(`Error fetching from ESPN:`, err);
    return [];
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sport, legDescriptions, date } = await req.json();
    
    const normalizedSport = sport ? normalizeSportKey(sport) : null;
    
    console.log(`Fetching scores for sport: ${sport || 'all'} (normalized: ${normalizedSport || 'all'}), date: ${date || 'today'}, legs: ${legDescriptions?.length || 0}`);
    
    const allGames: GameResult[] = [];
    const sportsToCheck = normalizedSport && normalizedSport !== 'all'
      ? [normalizedSport] 
      : ['nba', 'nfl', 'mlb', 'nhl', 'ncaaf', 'ncaab'];
    
    console.log(`Sports to check: ${sportsToCheck.join(', ')}`);
    
    // Fetch from both APIs for better coverage
    for (const sportToCheck of sportsToCheck) {
      // Try Odds API first (more reliable for completed games)
      const oddsGames = await fetchFromOddsAPI(sportToCheck);
      allGames.push(...oddsGames);
      
      // Also fetch from ESPN for more coverage (multiple dates)
      const datesToCheck = date ? [date] : [];
      if (!date) {
        // Check today and past 3 days
        for (let i = 0; i < 4; i++) {
          const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
          datesToCheck.push(d.toISOString().split('T')[0]);
        }
      }
      
      for (const checkDate of datesToCheck) {
        const espnGames = await fetchFromESPN(sportToCheck, checkDate);
        
        // Add ESPN games that aren't already in the list
        for (const espnGame of espnGames) {
          const existing = allGames.find(g => 
            normalizeTeamName(g.homeTeam) === normalizeTeamName(espnGame.homeTeam) &&
            normalizeTeamName(g.awayTeam) === normalizeTeamName(espnGame.awayTeam)
          );
          if (!existing) {
            allGames.push(espnGame);
          }
        }
      }
    }
    
    console.log(`Total games fetched: ${allGames.length}`);
    
    // If leg descriptions provided, match games to legs
    const matchedGames: Record<number, GameResult | null> = {};
    
    if (legDescriptions && Array.isArray(legDescriptions)) {
      legDescriptions.forEach((desc: string, idx: number) => {
        matchedGames[idx] = findGameForLeg(allGames, desc);
        if (matchedGames[idx]) {
          console.log(`✓ Matched leg ${idx}: "${desc.substring(0, 50)}..." → ${matchedGames[idx]?.homeTeam} vs ${matchedGames[idx]?.awayTeam} (${matchedGames[idx]?.status})`);
        } else {
          console.log(`✗ No match for leg ${idx}: "${desc.substring(0, 50)}..."`);
        }
      });
    }
    
    // Summary stats
    const finalGames = allGames.filter(g => g.status === 'final').length;
    const inProgressGames = allGames.filter(g => g.status === 'in_progress').length;
    const scheduledGames = allGames.filter(g => g.status === 'scheduled').length;
    
    console.log(`Game status breakdown: ${finalGames} final, ${inProgressGames} in progress, ${scheduledGames} scheduled`);
    
    return new Response(
      JSON.stringify({
        games: allGames,
        matchedGames,
        summary: {
          total: allGames.length,
          final: finalGames,
          inProgress: inProgressGames,
          scheduled: scheduledGames,
        },
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
