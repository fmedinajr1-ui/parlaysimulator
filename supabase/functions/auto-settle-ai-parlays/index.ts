import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LegResult {
  legIndex: number;
  description: string;
  outcome: 'won' | 'lost' | 'pending' | 'push';
  settlementMethod: string;
  actualValue?: number;
  line?: number;
  score?: { home: number; away: number };
  dataSource?: string;
  sport?: string;
  pendingReason?: string;
}

interface GameResult {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: 'completed' | 'in_progress' | 'scheduled' | 'final';
  winner?: string;
  sport?: string;
}

interface SettledParlayDetail {
  id: string;
  outcome: string;
  totalOdds: number;
  legs: LegResult[];
  strategy: string;
}

// Normalize sport key from various formats
function normalizeSportKey(sport: string): string {
  if (!sport) return 'nba';
  
  const lower = sport.toLowerCase();
  
  // Direct mappings from API format to simple format
  const mappings: Record<string, string> = {
    'basketball_nba': 'nba',
    'basketball_ncaab': 'ncaab',
    'basketball_wnba': 'wnba',
    'americanfootball_nfl': 'nfl',
    'americanfootball_ncaaf': 'ncaaf',
    'icehockey_nhl': 'nhl',
    'baseball_mlb': 'mlb',
    'mixed': 'all',
  };
  
  return mappings[lower] || lower;
}

// Detect sport from leg description
function detectSportFromDescription(description: string): string {
  const desc = description.toLowerCase();
  
  // NFL teams
  const nflTeams = ['chiefs', 'bills', 'ravens', 'dolphins', 'bengals', 'steelers', 'browns', 'texans', 'colts', 'jaguars', 'titans', 'broncos', 'chargers', 'raiders', 'cowboys', 'eagles', 'commanders', 'giants', 'lions', 'packers', 'vikings', 'bears', 'buccaneers', 'falcons', 'panthers', 'saints', '49ers', 'niners', 'seahawks', 'cardinals', 'rams', 'patriots', 'jets'];
  if (nflTeams.some(team => desc.includes(team))) return 'nfl';
  
  // NBA teams
  const nbaTeams = ['lakers', 'celtics', 'warriors', 'bucks', 'suns', 'heat', 'nuggets', '76ers', 'sixers', 'cavaliers', 'cavs', 'mavericks', 'mavs', 'thunder', 'timberwolves', 'wolves', 'knicks', 'kings', 'pacers', 'magic', 'rockets', 'pelicans', 'grizzlies', 'hawks', 'bulls', 'nets', 'raptors', 'spurs', 'blazers', 'jazz', 'pistons', 'hornets', 'wizards', 'clippers'];
  if (nbaTeams.some(team => desc.includes(team))) return 'nba';
  
  // NHL teams
  const nhlTeams = ['bruins', 'canadiens', 'maple leafs', 'sabres', 'panthers', 'lightning', 'penguins', 'capitals', 'rangers', 'islanders', 'devils', 'flyers', 'hurricanes', 'blue jackets', 'red wings', 'blackhawks', 'blues', 'predators', 'wild', 'jets', 'avalanche', 'stars', 'oilers', 'flames', 'canucks', 'kraken', 'sharks', 'ducks', 'golden knights', 'coyotes', 'kings'];
  if (nhlTeams.some(team => desc.includes(team))) return 'nhl';
  
  // MLB teams
  const mlbTeams = ['yankees', 'red sox', 'blue jays', 'orioles', 'rays', 'white sox', 'guardians', 'tigers', 'royals', 'twins', 'astros', 'rangers', 'mariners', 'angels', 'athletics', 'mets', 'braves', 'phillies', 'marlins', 'nationals', 'cubs', 'brewers', 'cardinals', 'reds', 'pirates', 'dodgers', 'giants', 'padres', 'diamondbacks', 'rockies'];
  if (mlbTeams.some(team => desc.includes(team))) return 'mlb';
  
  // College football indicators
  if (desc.includes('ncaaf') || desc.includes('college football') || desc.includes('cfb')) return 'ncaaf';
  
  // College basketball indicators
  if (desc.includes('ncaab') || desc.includes('college basketball') || desc.includes('cbb')) return 'ncaab';
  
  // Default to NBA
  return 'nba';
}

// Team name aliases for matching
const teamAliases: Record<string, string[]> = {
  // NBA
  'los angeles lakers': ['lakers', 'la lakers', 'los angeles lakers'],
  'golden state warriors': ['warriors', 'golden state', 'gsw'],
  'boston celtics': ['celtics', 'boston'],
  'miami heat': ['heat', 'miami'],
  'phoenix suns': ['suns', 'phoenix'],
  'milwaukee bucks': ['bucks', 'milwaukee'],
  'denver nuggets': ['nuggets', 'denver'],
  'philadelphia 76ers': ['76ers', 'sixers', 'philadelphia'],
  'cleveland cavaliers': ['cavaliers', 'cavs', 'cleveland'],
  'dallas mavericks': ['mavericks', 'mavs', 'dallas'],
  'oklahoma city thunder': ['thunder', 'okc', 'oklahoma city'],
  'minnesota timberwolves': ['timberwolves', 'wolves', 'minnesota'],
  'new york knicks': ['knicks', 'new york', 'ny knicks'],
  'sacramento kings': ['kings', 'sacramento'],
  'indiana pacers': ['pacers', 'indiana'],
  'orlando magic': ['magic', 'orlando'],
  'houston rockets': ['rockets', 'houston'],
  'new orleans pelicans': ['pelicans', 'new orleans'],
  'memphis grizzlies': ['grizzlies', 'memphis'],
  'atlanta hawks': ['hawks', 'atlanta'],
  'chicago bulls': ['bulls', 'chicago'],
  'brooklyn nets': ['nets', 'brooklyn'],
  'toronto raptors': ['raptors', 'toronto'],
  'san antonio spurs': ['spurs', 'san antonio'],
  'portland trail blazers': ['trail blazers', 'blazers', 'portland'],
  'utah jazz': ['jazz', 'utah'],
  'detroit pistons': ['pistons', 'detroit'],
  'charlotte hornets': ['hornets', 'charlotte'],
  'washington wizards': ['wizards', 'washington'],
  'la clippers': ['clippers', 'la clippers', 'los angeles clippers'],
  // NFL
  'detroit lions': ['lions', 'detroit'],
  'los angeles rams': ['rams', 'la rams'],
  'kansas city chiefs': ['chiefs', 'kansas city', 'kc'],
  'buffalo bills': ['bills', 'buffalo'],
  'baltimore ravens': ['ravens', 'baltimore'],
  'san francisco 49ers': ['49ers', 'niners', 'san francisco', 'sf'],
  'green bay packers': ['packers', 'green bay', 'gb'],
  'dallas cowboys': ['cowboys', 'dallas'],
  'philadelphia eagles': ['eagles', 'philadelphia', 'philly'],
  'miami dolphins': ['dolphins', 'miami'],
  'cincinnati bengals': ['bengals', 'cincinnati'],
  'pittsburgh steelers': ['steelers', 'pittsburgh'],
  'new england patriots': ['patriots', 'pats', 'new england'],
  'tampa bay buccaneers': ['buccaneers', 'bucs', 'tampa bay'],
  'seattle seahawks': ['seahawks', 'seattle'],
  'minnesota vikings': ['vikings', 'minnesota'],
  'las vegas raiders': ['raiders', 'las vegas', 'vegas'],
  'los angeles chargers': ['chargers', 'la chargers'],
  'tennessee titans': ['titans', 'tennessee'],
  'jacksonville jaguars': ['jaguars', 'jacksonville', 'jags'],
  'denver broncos': ['broncos', 'denver'],
  'new york giants': ['giants', 'ny giants'],
  'new york jets': ['jets', 'ny jets'],
  'arizona cardinals': ['cardinals', 'arizona'],
  'atlanta falcons': ['falcons', 'atlanta'],
  'carolina panthers': ['panthers', 'carolina'],
  'new orleans saints': ['saints', 'new orleans'],
  'cleveland browns': ['browns', 'cleveland'],
  'indianapolis colts': ['colts', 'indianapolis', 'indy'],
  'houston texans': ['texans', 'houston'],
  'chicago bears': ['bears', 'chicago'],
  'washington commanders': ['commanders', 'washington'],
};

function normalizeTeamName(name: string): string {
  const lower = name.toLowerCase().trim();
  for (const [canonical, aliases] of Object.entries(teamAliases)) {
    if (aliases.some(alias => lower.includes(alias))) {
      return canonical;
    }
  }
  return lower;
}

// Clean description by removing hit rate info, confidence percentages, etc.
function cleanDescription(desc: string): string {
  return desc
    .replace(/\s*\([^)]*hit rate[^)]*\)/gi, '')
    .replace(/\s*\([^)]*confidence[^)]*\)/gi, '')
    .replace(/\s*\(\d+%\s*-\s*\d+\/\d+\)/gi, '') // Remove (100% - 5/5) patterns
    .replace(/\s*\(\d+%[^)]*\)/gi, '') // Remove percentage patterns
    .trim();
}

function parsePlayerProp(description: string): { playerName: string; side: string; line: number; propType: string } | null {
  const cleaned = cleanDescription(description);
  
  // Multiple patterns to match various formats
  const patterns = [
    // "Player Name Over/Under X.X points"
    /(.+?)\s+(Over|Under)\s+(\d+\.?\d*)\s+(pts|points|reb|rebounds|ast|assists|threes|3pt|blocks|steals|stl|blk)/i,
    // "Player Name Over/Under X.X player_points"
    /(.+?)\s+(Over|Under)\s+(\d+\.?\d*)\s+player_(pts|points|reb|rebounds|ast|assists|threes|blocks|steals)/i,
    // Handle variations with prop type before line
    /(.+?)\s+(pts|points|reb|rebounds|ast|assists)\s+(Over|Under)\s+(\d+\.?\d*)/i,
    // NFL player props - passing/rushing/receiving yards
    /(.+?)\s+(Over|Under)\s+(\d+\.?\d*)\s+(passing yards|rushing yards|receiving yards|receptions|completions|pass completions|touchdowns|tds)/i,
  ];
  
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      // Handle different match group positions based on pattern
      if (pattern.source.includes('player_')) {
        return {
          playerName: match[1].trim(),
          side: match[2].toLowerCase(),
          line: parseFloat(match[3]),
          propType: normalizePropType(match[4])
        };
      } else if (match[3] && (match[3].toLowerCase() === 'over' || match[3].toLowerCase() === 'under')) {
        // Third pattern where side is in position 3
        return {
          playerName: match[1].trim(),
          side: match[3].toLowerCase(),
          line: parseFloat(match[4]),
          propType: normalizePropType(match[2])
        };
      } else {
        return {
          playerName: match[1].trim(),
          side: match[2].toLowerCase(),
          line: parseFloat(match[3]),
          propType: normalizePropType(match[4])
        };
      }
    }
  }
  
  return null;
}

function normalizePropType(prop: string): string {
  const lower = prop.toLowerCase();
  if (lower === 'pts' || lower === 'points') return 'points';
  if (lower === 'reb' || lower === 'rebounds') return 'rebounds';
  if (lower === 'ast' || lower === 'assists') return 'assists';
  if (lower === 'threes' || lower === '3pt') return 'threes_made';
  if (lower === 'blocks' || lower === 'blk') return 'blocks';
  if (lower === 'steals' || lower === 'stl') return 'steals';
  if (lower === 'passing yards') return 'passing_yards';
  if (lower === 'rushing yards') return 'rushing_yards';
  if (lower === 'receiving yards') return 'receiving_yards';
  if (lower === 'receptions') return 'receptions';
  if (lower === 'completions' || lower === 'pass completions') return 'completions';
  if (lower === 'touchdowns' || lower === 'tds') return 'touchdowns';
  return lower;
}

function parseMoneyline(description: string): { team: string } | null {
  const cleaned = cleanDescription(description);
  // Match: "Team ML" or "Team to win" or "Team +150"
  const match = cleaned.match(/(.+?)\s+(ML|moneyline|to win)/i);
  if (match) {
    return { team: match[1].trim() };
  }
  // Also check for team name followed by American odds
  const oddsMatch = cleaned.match(/^(.+?)\s+([+-]\d+)$/);
  if (oddsMatch) {
    return { team: oddsMatch[1].trim() };
  }
  // Check for "Team upset" patterns from God Mode
  const upsetMatch = cleaned.match(/(.+?)\s+(upset|edge|fatigue edge)/i);
  if (upsetMatch) {
    return { team: upsetMatch[1].trim() };
  }
  return null;
}

function parseSpread(description: string): { team: string; spread: number } | null {
  const cleaned = cleanDescription(description);
  // Match: "Team +5.5" or "Team -3.5"
  const match = cleaned.match(/(.+?)\s+([+-]\d+\.?\d*)\s*(spread)?/i);
  if (match && !cleaned.toLowerCase().includes('over') && !cleaned.toLowerCase().includes('under')) {
    return { team: match[1].trim(), spread: parseFloat(match[2]) };
  }
  return null;
}

function parseTotal(description: string): { side: string; total: number } | null {
  const cleaned = cleanDescription(description);
  // Match: "Over/Under X.X total" or "O/U X.X"
  const match = cleaned.match(/(over|under)\s+(\d+\.?\d*)\s*(total|pts)?/i);
  if (match && !cleaned.toLowerCase().includes('points') && !cleaned.toLowerCase().includes('rebounds')) {
    return { side: match[1].toLowerCase(), total: parseFloat(match[2]) };
  }
  return null;
}

async function fetchGameScores(supabase: any, sport: string, legDescriptions: string[]): Promise<GameResult[]> {
  try {
    const normalizedSport = normalizeSportKey(sport);
    console.log(`📡 Fetching game scores for ${sport} (normalized: ${normalizedSport})...`);
    
    const { data, error } = await supabase.functions.invoke('fetch-game-scores', {
      body: { 
        sport: normalizedSport, 
        legDescriptions 
      }
    });
    
    if (error) throw error;
    
    const games = data?.games || [];
    console.log(`✅ Got ${games.length} games from fetch-game-scores for ${normalizedSport}`);
    
    // Normalize status field (API returns 'final', we need 'completed')
    return games.map((g: any) => ({
      ...g,
      status: g.status === 'final' ? 'completed' : g.status
    }));
  } catch (e) {
    console.error(`Error fetching game scores for ${sport}:`, e);
    return [];
  }
}

async function fetchAllSportsGames(supabase: any, legDescriptions: string[]): Promise<Record<string, GameResult[]>> {
  const sports = ['nba', 'nfl', 'nhl', 'mlb', 'ncaaf', 'ncaab'];
  const allGames: Record<string, GameResult[]> = {};
  
  console.log('📡 Fetching games for ALL sports (mixed parlay)...');
  
  // Fetch all sports in parallel
  const results = await Promise.all(
    sports.map(async sport => {
      const games = await fetchGameScores(supabase, sport, legDescriptions);
      return { sport, games };
    })
  );
  
  for (const { sport, games } of results) {
    allGames[sport] = games;
    console.log(`  - ${sport}: ${games.length} games`);
  }
  
  return allGames;
}

// Returns stats with the date they're from for validation
interface PlayerStatsResult {
  stats: any;
  statsDate: string;
  source: string;
}

async function fetchPlayerStats(
  supabase: any, 
  playerName: string, 
  targetGameDate: string, // Now expects ONLY the specific game date
  sport: string
): Promise<PlayerStatsResult | null> {
  // Extract last name for fuzzy matching
  const nameParts = playerName.split(' ');
  const lastName = nameParts[nameParts.length - 1];
  const firstName = nameParts[0];
  
  console.log(`🔍 Searching stats for ${playerName} on EXACT date: ${targetGameDate} (${sport})...`);
  
  // Determine which table to query based on sport
  const tableMap: Record<string, string> = {
    'nba': 'nba_player_game_logs',
    'nfl': 'nfl_player_game_logs',
    'nhl': 'nhl_player_game_logs',
  };
  
  const tableName = tableMap[sport] || 'nba_player_game_logs';
  
  // ONLY query the exact game date - no fallback to other dates
  const { data: logs, error } = await supabase
    .from(tableName)
    .select('*')
    .ilike('player_name', `%${lastName}%`)
    .eq('game_date', targetGameDate)
    .limit(5);
  
  if (error) {
    console.log(`⚠️ Error querying ${tableName}:`, error.message);
    return null;
  }
  
  if (logs && logs.length > 0) {
    // Find best match by first name
    const bestMatch = logs.find((l: any) => 
      l.player_name.toLowerCase().includes(firstName.toLowerCase())
    ) || logs[0];
    console.log(`✅ Found stats in ${tableName}: ${bestMatch.player_name} on ${targetGameDate}`);
    return {
      stats: bestMatch,
      statsDate: targetGameDate,
      source: tableName
    };
  }
  
  // Try player_stats_cache as fallback for same date only
  const { data: cache } = await supabase
    .from('player_stats_cache')
    .select('*')
    .ilike('player_name', `%${lastName}%`)
    .eq('game_date', targetGameDate)
    .limit(5);
  
  if (cache && cache.length > 0) {
    const bestMatch = cache.find((c: any) => 
      c.player_name.toLowerCase().includes(firstName.toLowerCase())
    ) || cache[0];
    console.log(`✅ Found stats in cache: ${bestMatch.player_name} on ${targetGameDate}`);
    return {
      stats: bestMatch,
      statsDate: targetGameDate,
      source: 'player_stats_cache'
    };
  }
  
  console.log(`⚠️ No stats found for ${playerName} on ${targetGameDate} - data may not be available yet`);
  return null;
}

async function evaluateLeg(
  supabase: any, 
  leg: any, 
  allGames: Record<string, GameResult[]>, 
  gameDates: string[],
  defaultSport: string
): Promise<LegResult> {
  const description = leg.description || '';
  const legIndex = leg.legIndex || 0;
  
  // Detect sport from description
  const detectedSport = detectSportFromDescription(description);
  const sport = detectedSport !== 'nba' ? detectedSport : normalizeSportKey(defaultSport);
  
  // Get games for this sport
  const games = allGames[sport] || allGames['nba'] || [];
  
  // Extract the EXACT game date from the leg's commence_time
  const commenceTime = leg.commence_time || leg.commenceTime;
  let targetGameDate: string | null = null;
  
  if (commenceTime) {
    const gameDateTime = new Date(commenceTime);
    targetGameDate = gameDateTime.toISOString().split('T')[0];
    
    // CRITICAL: Check if game has likely finished (at least 3 hours after start)
    const now = new Date();
    const hoursSinceStart = (now.getTime() - gameDateTime.getTime()) / (1000 * 60 * 60);
    
    if (hoursSinceStart < 3) {
      console.log(`⏳ Game may still be in progress (started ${hoursSinceStart.toFixed(1)}h ago): ${description.substring(0, 50)}...`);
      return { 
        legIndex, 
        description, 
        outcome: 'pending', 
        settlementMethod: 'game_in_progress', 
        dataSource: 'none',
        sport,
        pendingReason: `Game started ${hoursSinceStart.toFixed(1)}h ago - likely still in progress`
      };
    }
    
    console.log(`📅 Target game date from commence_time: ${targetGameDate} (${hoursSinceStart.toFixed(1)}h ago)`);
  } else {
    console.log(`⚠️ No commence_time found for leg, using fallback dates`);
  }
  
  console.log(`📋 Evaluating leg ${legIndex}: ${description.substring(0, 60)}... (sport: ${sport}, games: ${games.length}, gameDate: ${targetGameDate})`);
  
  // Check if it's a player prop
  const propData = parsePlayerProp(description);
  if (propData) {
    console.log(`🎯 Player prop detected: ${propData.playerName} ${propData.side} ${propData.line} ${propData.propType}`);
    
    // Only fetch stats for the EXACT game date
    if (!targetGameDate) {
      return { 
        legIndex, 
        description, 
        outcome: 'pending', 
        settlementMethod: 'no_game_date', 
        dataSource: 'none',
        sport,
        pendingReason: `No commence_time available to determine game date`
      };
    }
    
    const statsResult = await fetchPlayerStats(supabase, propData.playerName, targetGameDate, sport);
    
    if (statsResult) {
      const actualValue = statsResult.stats[propData.propType] || 0;
      const won = propData.side === 'over' ? actualValue > propData.line : actualValue < propData.line;
      const push = actualValue === propData.line;
      
      console.log(`📊 Result: ${actualValue} ${propData.side === 'over' ? '>' : '<'} ${propData.line} = ${won ? 'WON' : push ? 'PUSH' : 'LOST'} (stats from ${statsResult.statsDate})`);
      
      return {
        legIndex,
        description,
        outcome: push ? 'push' : won ? 'won' : 'lost',
        settlementMethod: 'player_stats',
        actualValue,
        line: propData.line,
        dataSource: `${statsResult.source}`,
        sport
      };
    }
    
    return { 
      legIndex, 
      description, 
      outcome: 'pending', 
      settlementMethod: 'player_prop_no_data', 
      dataSource: 'none',
      sport,
      pendingReason: `No stats for ${propData.playerName} on ${targetGameDate} - stats not yet available`
    };
  }
  
  // Check if it's a moneyline bet
  const mlData = parseMoneyline(description);
  if (mlData) {
    const teamNorm = normalizeTeamName(mlData.team);
    console.log(`🏈 Moneyline detected: ${mlData.team} (normalized: ${teamNorm})`);
    
    const game = games.find(g => 
      normalizeTeamName(g.homeTeam) === teamNorm || 
      normalizeTeamName(g.awayTeam) === teamNorm
    );
    
    if (!game) {
      console.log(`⚠️ No game found for team: ${mlData.team}`);
      return { 
        legIndex, 
        description, 
        outcome: 'pending', 
        settlementMethod: 'moneyline_no_game',
        sport,
        pendingReason: `No game found for ${mlData.team} in ${sport} (${games.length} games available)`
      };
    }
    
    if (game.status !== 'completed') {
      console.log(`⏳ Game not completed: ${game.homeTeam} vs ${game.awayTeam} (${game.status})`);
      return { 
        legIndex, 
        description, 
        outcome: 'pending', 
        settlementMethod: 'moneyline_game_not_complete',
        sport,
        pendingReason: `Game ${game.homeTeam} vs ${game.awayTeam} status: ${game.status}`
      };
    }
    
    const teamWon = normalizeTeamName(game.winner || '') === teamNorm ||
      (normalizeTeamName(game.homeTeam) === teamNorm && game.homeScore > game.awayScore) ||
      (normalizeTeamName(game.awayTeam) === teamNorm && game.awayScore > game.homeScore);
    
    console.log(`📊 ML Result: ${game.homeTeam} ${game.homeScore} - ${game.awayScore} ${game.awayTeam} = ${teamWon ? 'WON' : 'LOST'}`);
    
    return {
      legIndex,
      description,
      outcome: teamWon ? 'won' : 'lost',
      settlementMethod: 'game_score',
      score: { home: game.homeScore, away: game.awayScore },
      dataSource: `${sport}_scores`,
      sport
    };
  }
  
  // Check if it's a spread bet
  const spreadData = parseSpread(description);
  if (spreadData) {
    const teamNorm = normalizeTeamName(spreadData.team);
    const game = games.find(g => 
      normalizeTeamName(g.homeTeam) === teamNorm || 
      normalizeTeamName(g.awayTeam) === teamNorm
    );
    
    if (!game || game.status !== 'completed') {
      return { 
        legIndex, 
        description, 
        outcome: 'pending', 
        settlementMethod: 'spread_pending',
        sport,
        pendingReason: game ? `Game status: ${game.status}` : `No game found for ${spreadData.team}`
      };
    }
    
    const isHome = normalizeTeamName(game.homeTeam) === teamNorm;
    const teamScore = isHome ? game.homeScore : game.awayScore;
    const oppScore = isHome ? game.awayScore : game.homeScore;
    const adjustedScore = teamScore + spreadData.spread;
    
    const covered = adjustedScore > oppScore;
    const push = adjustedScore === oppScore;
    
    return {
      legIndex,
      description,
      outcome: push ? 'push' : covered ? 'won' : 'lost',
      settlementMethod: 'spread_calculation',
      score: { home: game.homeScore, away: game.awayScore },
      dataSource: `${sport}_scores`,
      sport
    };
  }
  
  // Check if it's a total bet
  const totalData = parseTotal(description);
  if (totalData) {
    // Find any matching game from the description
    const game = games.find(g => g.status === 'completed');
    
    if (!game) {
      return { 
        legIndex, 
        description, 
        outcome: 'pending', 
        settlementMethod: 'total_pending',
        sport,
        pendingReason: `No completed games found for totals`
      };
    }
    
    const actualTotal = game.homeScore + game.awayScore;
    const won = totalData.side === 'over' ? actualTotal > totalData.total : actualTotal < totalData.total;
    const push = actualTotal === totalData.total;
    
    return {
      legIndex,
      description,
      outcome: push ? 'push' : won ? 'won' : 'lost',
      settlementMethod: 'total_calculation',
      actualValue: actualTotal,
      line: totalData.total,
      dataSource: `${sport}_scores`,
      sport
    };
  }
  
  // Fallback: check if description contains team-like info for upset/fatigue bets
  const teamMatch = description.match(/(\w+(?:\s+\w+)*)\s+(ML|moneyline|upset|fatigue|edge|value)/i);
  if (teamMatch) {
    const teamNorm = normalizeTeamName(teamMatch[1]);
    const game = games.find(g => 
      normalizeTeamName(g.homeTeam) === teamNorm || 
      normalizeTeamName(g.awayTeam) === teamNorm
    );
    
    if (game && game.status === 'completed') {
      const isHome = normalizeTeamName(game.homeTeam) === teamNorm;
      const teamWon = isHome ? game.homeScore > game.awayScore : game.awayScore > game.homeScore;
      
      return {
        legIndex,
        description,
        outcome: teamWon ? 'won' : 'lost',
        settlementMethod: 'team_outcome',
        score: { home: game.homeScore, away: game.awayScore },
        dataSource: `${sport}_scores`,
        sport
      };
    }
  }
  
  return { 
    legIndex, 
    description, 
    outcome: 'pending', 
    settlementMethod: 'unable_to_parse', 
    dataSource: 'none',
    sport,
    pendingReason: 'Could not parse bet type from description'
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // Parse request body for force mode
    let force = false;
    try {
      const body = await req.json();
      force = body?.force === true;
    } catch {
      // No body or invalid JSON, use defaults
    }
    
    console.log(`🎰 Starting AI Parlay Auto-Settlement... (force=${force})`);
    
    // Build query - skip 4-hour cutoff if force mode
    let query = supabase
      .from('ai_generated_parlays')
      .select('*')
      .eq('outcome', 'pending')
      .limit(200); // Increased limit
    
    if (!force) {
      // Only apply 4-hour cutoff if not forcing
      const cutoffTime = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      query = query.lt('created_at', cutoffTime);
    }
    
    const { data: pendingParlays, error: fetchError } = await query;

    if (fetchError) throw fetchError;

    console.log(`📊 Found ${pendingParlays?.length || 0} pending parlays to settle (force=${force})`);

    if (!pendingParlays || pendingParlays.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: force ? 'No pending parlays to settle' : 'No parlays old enough to settle (4hr cutoff)',
        processed: 0,
        settled: 0,
        settledDetails: []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const results = {
      processed: 0,
      settled: 0,
      won: 0,
      lost: 0,
      stillPending: 0,
      errors: 0,
      learningTriggered: false,
      settledDetails: [] as SettledParlayDetail[],
      diagnostics: {
        sportBreakdown: {} as Record<string, number>,
        pendingReasons: {} as Record<string, number>,
        gamesFound: {} as Record<string, number>,
        dataFreshness: {} as Record<string, string>,
        staleDataWarning: false
      }
    };

    // Check data freshness for each sport's player stats
    const today = new Date().toISOString().split('T')[0];
    const sportTables = ['nba_player_game_logs', 'nfl_player_game_logs', 'nhl_player_game_logs'];
    
    for (const table of sportTables) {
      const { data: latestStats } = await supabase
        .from(table)
        .select('game_date')
        .order('game_date', { ascending: false })
        .limit(1);
      
      const latestDate = latestStats?.[0]?.game_date || 'none';
      results.diagnostics.dataFreshness[table] = latestDate;
      
      if (latestDate !== 'none' && latestDate < today) {
        console.log(`⚠️ STALE DATA WARNING: ${table} latest data is from ${latestDate}, today is ${today}`);
        results.diagnostics.staleDataWarning = true;
      } else {
        console.log(`✅ ${table} data freshness: ${latestDate}`);
      }
    }

    // Group parlays by sport for efficient score fetching
    const parlaysBySport: Record<string, typeof pendingParlays> = {};
    for (const parlay of pendingParlays) {
      const sport = parlay.sport || 'basketball_nba';
      if (!parlaysBySport[sport]) parlaysBySport[sport] = [];
      parlaysBySport[sport].push(parlay);
      
      // Track sport breakdown
      const normalizedSport = normalizeSportKey(sport);
      results.diagnostics.sportBreakdown[normalizedSport] = (results.diagnostics.sportBreakdown[normalizedSport] || 0) + 1;
    }

    console.log(`📊 Sport breakdown: ${JSON.stringify(results.diagnostics.sportBreakdown)}`);

    // Calculate multiple game dates to check - expand to 7 days for better coverage
    const gameDates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      gameDates.push(date.toISOString().split('T')[0]);
    }
    console.log(`📅 Checking dates: ${gameDates.join(', ')}`);

    // Collect all leg descriptions for batch score fetching
    const allDescriptions: string[] = [];
    for (const parlay of pendingParlays) {
      const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
      legs.forEach((leg: any) => {
        if (leg.description) allDescriptions.push(leg.description);
      });
    }

    // For mixed sport parlays or when we have diverse parlays, fetch all sports
    const hasMixedSport = parlaysBySport['mixed'] || Object.keys(parlaysBySport).length > 2;
    
    let allGames: Record<string, GameResult[]> = {};
    
    if (hasMixedSport) {
      // Fetch all sports
      allGames = await fetchAllSportsGames(supabase, allDescriptions);
    } else {
      // Fetch only needed sports
      for (const sport of Object.keys(parlaysBySport)) {
        const normalizedSport = normalizeSportKey(sport);
        allGames[normalizedSport] = await fetchGameScores(supabase, normalizedSport, allDescriptions);
      }
    }

    // Track games found
    for (const [sport, games] of Object.entries(allGames)) {
      results.diagnostics.gamesFound[sport] = games.length;
      const completedGames = games.filter((g: GameResult) => g.status === 'completed').length;
      console.log(`📺 ${sport}: ${games.length} total, ${completedGames} completed`);
    }

    // Process each parlay
    for (const [sport, sportParlays] of Object.entries(parlaysBySport)) {
      const normalizedSport = normalizeSportKey(sport);
      console.log(`\n🏀 Processing ${sportParlays.length} parlays for ${sport} (normalized: ${normalizedSport})...`);

      for (const parlay of sportParlays) {
        results.processed++;
        
        try {
          const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
          const legResults: LegResult[] = [];
          
          console.log(`\n🎯 Processing parlay ${parlay.id.substring(0, 8)}... (${legs.length} legs)`);
          
          // Evaluate each leg
          for (let i = 0; i < legs.length; i++) {
            const leg = { ...legs[i], legIndex: i };
            const result = await evaluateLeg(supabase, leg, allGames, gameDates, normalizedSport);
            legResults.push(result);
            
            // Track pending reasons
            if (result.outcome === 'pending' && result.pendingReason) {
              const reason = result.settlementMethod;
              results.diagnostics.pendingReasons[reason] = (results.diagnostics.pendingReasons[reason] || 0) + 1;
            }
          }

          // Determine parlay outcome
          const pendingLegs = legResults.filter(r => r.outcome === 'pending');
          const lostLegs = legResults.filter(r => r.outcome === 'lost');
          const pushLegs = legResults.filter(r => r.outcome === 'push');
          const wonLegs = legResults.filter(r => r.outcome === 'won');
          
          console.log(`📊 Leg summary: ${wonLegs.length}W / ${lostLegs.length}L / ${pushLegs.length}P / ${pendingLegs.length} pending`);
          
          let parlayOutcome: 'won' | 'lost' | 'pending' | 'push' = 'pending';
          
          if (lostLegs.length > 0) {
            // Any lost leg = parlay lost
            parlayOutcome = 'lost';
          } else if (pendingLegs.length === 0) {
            // All legs resolved, no losses
            if (pushLegs.length === legResults.length) {
              parlayOutcome = 'push';
            } else {
              parlayOutcome = 'won';
            }
          }

          console.log(`🎰 Parlay outcome: ${parlayOutcome.toUpperCase()}`);

          // Only update if we have a final outcome
          if (parlayOutcome !== 'pending') {
            const settlementData = {
              outcome: parlayOutcome,
              settled_at: new Date().toISOString(),
              ai_reasoning: JSON.stringify({
                settlement_type: 'auto_settle',
                force_mode: force,
                leg_results: legResults,
                settlement_time: new Date().toISOString(),
                games_checked: Object.values(allGames).flat().length,
                dates_checked: gameDates
              })
            };

            const { error: updateError } = await supabase
              .from('ai_generated_parlays')
              .update(settlementData)
              .eq('id', parlay.id);

            if (updateError) {
              console.error(`Error updating parlay ${parlay.id}:`, updateError);
              results.errors++;
            } else {
              results.settled++;
              if (parlayOutcome === 'won') results.won++;
              if (parlayOutcome === 'lost') results.lost++;
              
              // Add to settled details for UI display
              results.settledDetails.push({
                id: parlay.id,
                outcome: parlayOutcome,
                totalOdds: parlay.total_odds,
                legs: legResults,
                strategy: parlay.strategy_used
              });
              
              // Trigger learning engine for this settlement
              try {
                await supabase.functions.invoke('ai-learning-engine', {
                  body: {
                    action: 'process_settlement',
                    parlayId: parlay.id,
                    outcome: parlayOutcome,
                    legResults: legResults
                  }
                });
              } catch (learnError) {
                console.error('Learning engine error:', learnError);
              }
            }
          } else {
            results.stillPending++;
          }
        } catch (parlayError) {
          console.error(`Error processing parlay ${parlay.id}:`, parlayError);
          results.errors++;
        }
      }
    }

    // Run full learning cycle if we settled any parlays and capture results
    let learningResults: any = null;
    if (results.settled > 0) {
      try {
        console.log('🧠 Starting full learning cycle...');
        const { data: learnData, error: learnError } = await supabase.functions.invoke('ai-learning-engine', {
          body: { action: 'full_learning_cycle' }
        });
        
        if (learnError) {
          console.error('Learning cycle error:', learnError);
        } else {
          learningResults = learnData;
          results.learningTriggered = true;
          console.log('🧠 Learning cycle complete:', JSON.stringify(learnData, null, 2));
        }
      } catch (learnError) {
        console.error('Full learning cycle error:', learnError);
      }
    }

    const duration = Date.now() - startTime;

    // Log to cron_job_history
    await supabase.from('cron_job_history').insert({
      job_name: 'auto-settle-ai-parlays',
      status: results.errors > 0 ? 'completed_with_errors' : 'completed',
      duration_ms: duration,
      result: {
        ...results,
        force_mode: force,
        settledDetails: results.settledDetails.slice(0, 10),
        learningResults
      }
    });

    console.log(`\n✅ Settlement complete: ${results.settled} settled, ${results.won}W/${results.lost}L, ${results.stillPending} still pending`);
    console.log(`📊 Diagnostics: Sports=${JSON.stringify(results.diagnostics.sportBreakdown)}, Games=${JSON.stringify(results.diagnostics.gamesFound)}`);
    console.log(`⏳ Pending reasons: ${JSON.stringify(results.diagnostics.pendingReasons)}`);
    
    if (learningResults) {
      console.log(`🧠 Learning: ${learningResults.weights_updated?.weights_updated || 0} weights updated, ${learningResults.avoid_patterns?.patterns_updated || 0} avoid patterns, ${learningResults.compound_formulas?.formulas_updated || 0} compound formulas`);
    }

    return new Response(JSON.stringify({
      success: true,
      ...results,
      learningResults,
      duration_ms: duration
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Settlement error:', error);
    
    await supabase.from('cron_job_history').insert({
      job_name: 'auto-settle-ai-parlays',
      status: 'failed',
      duration_ms: Date.now() - startTime,
      error_message: errorMessage
    });

    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
