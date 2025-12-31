import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// NBA Prop type to stat column mapping
const NBA_PROP_TO_STAT_MAP: Record<string, string | string[]> = {
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_threes': 'threes_made',
  'player_blocks': 'blocks',
  'player_steals': 'steals',
  'player_turnovers': 'turnovers',
  'Points': 'points',
  'Rebounds': 'rebounds',
  'Assists': 'assists',
  '3-Pointers': 'threes_made',
  'Threes': 'threes_made',
  'Blocks': 'blocks',
  'Steals': 'steals',
  'Turnovers': 'turnovers',
  'Pts+Reb+Ast': ['points', 'rebounds', 'assists'],
  'Pts+Reb': ['points', 'rebounds'],
  'Pts+Ast': ['points', 'assists'],
  'Reb+Ast': ['rebounds', 'assists'],
  'Steals+Blocks': ['steals', 'blocks'],
};

// NFL Prop type to stat column mapping
const NFL_PROP_TO_STAT_MAP: Record<string, string | string[]> = {
  'player_pass_yds': 'passing_yards',
  'player_pass_tds': 'passing_touchdowns',
  'player_rush_yds': 'rushing_yards',
  'player_rush_tds': 'rushing_touchdowns',
  'player_reception_yds': 'receiving_yards',
  'player_receptions': 'receptions',
  'player_rec_tds': 'receiving_touchdowns',
  'Passing Yards': 'passing_yards',
  'Passing TDs': 'passing_touchdowns',
  'Rushing Yards': 'rushing_yards',
  'Receiving Yards': 'receiving_yards',
  'Receptions': 'receptions',
};

// NHL Prop type to stat column mapping
const NHL_PROP_TO_STAT_MAP: Record<string, string | string[]> = {
  'player_goals': 'goals',
  'player_assists': 'assists',
  'player_shots': 'shots_on_goal',
  'player_points': ['goals', 'assists'],
  'Goals': 'goals',
  'Assists': 'assists',
  'Shots on Goal': 'shots_on_goal',
  'Points': ['goals', 'assists'],
};

// Team name aliases for matching
const TEAM_ALIASES: Record<string, string[]> = {
  'lakers': ['los angeles lakers', 'la lakers', 'lal'],
  'clippers': ['los angeles clippers', 'la clippers', 'lac'],
  'warriors': ['golden state warriors', 'golden state', 'gsw'],
  'celtics': ['boston celtics', 'boston', 'bos'],
  'heat': ['miami heat', 'miami', 'mia'],
  'bulls': ['chicago bulls', 'chicago', 'chi'],
  'knicks': ['new york knicks', 'ny knicks', 'nyk'],
  'nets': ['brooklyn nets', 'brooklyn', 'bkn'],
  'sixers': ['philadelphia 76ers', 'philadelphia', 'phi', '76ers'],
  'raptors': ['toronto raptors', 'toronto', 'tor'],
  'bucks': ['milwaukee bucks', 'milwaukee', 'mil'],
  'pacers': ['indiana pacers', 'indiana', 'ind'],
  'cavaliers': ['cleveland cavaliers', 'cleveland', 'cle', 'cavs'],
  'pistons': ['detroit pistons', 'detroit', 'det'],
  'hawks': ['atlanta hawks', 'atlanta', 'atl'],
  'magic': ['orlando magic', 'orlando', 'orl'],
  'wizards': ['washington wizards', 'washington', 'was'],
  'hornets': ['charlotte hornets', 'charlotte', 'cha'],
  'nuggets': ['denver nuggets', 'denver', 'den'],
  'timberwolves': ['minnesota timberwolves', 'minnesota', 'min', 'wolves'],
  'thunder': ['oklahoma city thunder', 'okc thunder', 'okc'],
  'blazers': ['portland trail blazers', 'portland', 'por', 'trail blazers'],
  'jazz': ['utah jazz', 'utah', 'uta'],
  'suns': ['phoenix suns', 'phoenix', 'phx'],
  'kings': ['sacramento kings', 'sacramento', 'sac'],
  'mavericks': ['dallas mavericks', 'dallas', 'dal', 'mavs'],
  'rockets': ['houston rockets', 'houston', 'hou'],
  'spurs': ['san antonio spurs', 'san antonio', 'sas'],
  'grizzlies': ['memphis grizzlies', 'memphis', 'mem'],
  'pelicans': ['new orleans pelicans', 'new orleans', 'nop'],
  // NFL teams
  'chiefs': ['kansas city chiefs', 'kansas city', 'kc'],
  'bills': ['buffalo bills', 'buffalo', 'buf'],
  'eagles': ['philadelphia eagles', 'philly eagles'],
  'cowboys': ['dallas cowboys'],
  'ravens': ['baltimore ravens', 'baltimore', 'bal'],
  'bengals': ['cincinnati bengals', 'cincinnati', 'cin'],
  'browns': ['cleveland browns'],
  'steelers': ['pittsburgh steelers', 'pittsburgh', 'pit'],
  'dolphins': ['miami dolphins'],
  'patriots': ['new england patriots', 'new england', 'ne'],
  'jets': ['new york jets', 'ny jets', 'nyj'],
  'titans': ['tennessee titans', 'tennessee', 'ten'],
  'colts': ['indianapolis colts', 'indianapolis', 'ind'],
  'texans': ['houston texans'],
  'jaguars': ['jacksonville jaguars', 'jacksonville', 'jax'],
  'broncos': ['denver broncos'],
  'chargers': ['los angeles chargers', 'la chargers'],
  'raiders': ['las vegas raiders', 'las vegas', 'lv'],
  'packers': ['green bay packers', 'green bay', 'gb'],
  'bears': ['chicago bears'],
  'lions': ['detroit lions'],
  'vikings': ['minnesota vikings'],
  'saints': ['new orleans saints'],
  'falcons': ['atlanta falcons'],
  'panthers': ['carolina panthers', 'carolina', 'car'],
  'buccaneers': ['tampa bay buccaneers', 'tampa bay', 'tb', 'bucs'],
  '49ers': ['san francisco 49ers', 'san francisco', 'sf'],
  'seahawks': ['seattle seahawks', 'seattle', 'sea'],
  'rams': ['los angeles rams', 'la rams'],
  'cardinals': ['arizona cardinals', 'arizona', 'ari'],
  'commanders': ['washington commanders'],
  'giants': ['new york giants', 'ny giants', 'nyg'],
};

function normalizePlayerName(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeTeamName(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function fuzzyMatchPlayerName(targetName: string, candidateName: string): number {
  const target = normalizePlayerName(targetName);
  const candidate = normalizePlayerName(candidateName);
  
  if (target === candidate) return 1.0;
  if (target.includes(candidate) || candidate.includes(target)) return 0.9;
  
  const targetParts = target.split(' ');
  const candidateParts = candidate.split(' ');
  const targetLast = targetParts[targetParts.length - 1];
  const candidateLast = candidateParts[candidateParts.length - 1];
  
  if (targetLast === candidateLast) {
    const targetFirst = targetParts[0]?.[0] || '';
    const candidateFirst = candidateParts[0]?.[0] || '';
    if (targetFirst === candidateFirst) return 0.85;
    return 0.7;
  }
  
  return 0;
}

function fuzzyMatchTeam(target: string, candidate: string): boolean {
  const t = normalizeTeamName(target);
  const c = normalizeTeamName(candidate);
  
  // Exact match
  if (t === c) return true;
  
  // Partial match - one contains the other
  if (t.includes(c) || c.includes(t)) return true;
  
  // Last word match (nickname)
  const tWords = t.split(' ');
  const cWords = c.split(' ');
  const tLast = tWords[tWords.length - 1];
  const cLast = cWords[cWords.length - 1];
  if (tLast === cLast && tLast.length > 3) return true;
  
  // Check aliases
  for (const [nickname, aliases] of Object.entries(TEAM_ALIASES)) {
    const normalizedNickname = normalizeTeamName(nickname);
    const normalizedAliases = aliases.map(a => normalizeTeamName(a));
    
    const tMatchesNickname = t.includes(normalizedNickname) || normalizedAliases.some(a => t.includes(a) || a.includes(t));
    const cMatchesNickname = c.includes(normalizedNickname) || normalizedAliases.some(a => c.includes(a) || a.includes(c));
    
    if (tMatchesNickname && cMatchesNickname) return true;
  }
  
  return false;
}

// Parse leg description like "LeBron James OVER 27.5 Points"
function parseLegDescription(description: string): { playerName: string; side: string; line: number; propType: string } | null {
  // Pattern: "Player Name OVER/UNDER X.X PropType"
  const match = description.match(/^(.+?)\s+(OVER|UNDER|O|U)\s+([\d.]+)\s+(.+)$/i);
  if (match) {
    return {
      playerName: match[1].trim(),
      side: match[2].toUpperCase().startsWith('O') ? 'OVER' : 'UNDER',
      line: parseFloat(match[3]),
      propType: match[4].trim(),
    };
  }
  return null;
}

// Extract team name from description for game bets
function extractTeamFromDescription(description: string): string | null {
  // Patterns:
  // "Cincinnati Bengals ML" -> Cincinnati Bengals
  // "LA Chargers -3.5" -> LA Chargers
  // "Chiefs vs Broncos OVER 45.5" -> null (totals don't pick a team)
  // "Kansas City Chiefs ML vs Arizona Cardinals" -> Kansas City Chiefs
  
  const desc = description.trim();
  
  // ML pattern: "Team Name ML" or "Team Name ML vs Other Team"
  const mlMatch = desc.match(/^(.+?)\s+ML(?:\s+vs|\s+@|\s*$)/i);
  if (mlMatch) return mlMatch[1].trim();
  
  // Spread pattern: "Team Name -X.X" or "Team Name +X.X"
  const spreadMatch = desc.match(/^(.+?)\s+([+-][\d.]+)(?:\s+vs|\s+@|\s*$)/i);
  if (spreadMatch) return spreadMatch[1].trim();
  
  // Moneyline at end: "Team Name Moneyline"
  const moneylineMatch = desc.match(/^(.+?)\s+moneyline/i);
  if (moneylineMatch) return moneylineMatch[1].trim();
  
  return null;
}

// Parse line from description
function parseLineFromDescription(description: string): number | null {
  // Match patterns like "-3.5", "+7", "OVER 225.5", "UNDER 45.5"
  const overUnderMatch = description.match(/(?:OVER|UNDER|O|U)\s+([\d.]+)/i);
  if (overUnderMatch) return parseFloat(overUnderMatch[1]);
  
  const spreadMatch = description.match(/([+-][\d.]+)/);
  if (spreadMatch) return parseFloat(spreadMatch[1]);
  
  return null;
}

// Determine if description is OVER or UNDER for totals
function getSideFromDescription(description: string): 'OVER' | 'UNDER' | null {
  const lower = description.toLowerCase();
  if (lower.includes('over') || lower.includes(' o ')) return 'OVER';
  if (lower.includes('under') || lower.includes(' u ')) return 'UNDER';
  return null;
}

// Find matching game in game scores
function findGameForLeg(
  description: string,
  sport: string,
  gameScores: any[]
): any | null {
  const teamName = extractTeamFromDescription(description);
  const desc = description.toLowerCase();
  
  // Filter by sport if possible
  const sportLower = (sport || '').toLowerCase();
  let candidates = gameScores;
  
  if (sportLower.includes('nba') || sportLower.includes('basketball')) {
    candidates = gameScores.filter(g => (g.sport || '').toLowerCase().includes('basketball'));
  } else if (sportLower.includes('nfl') || sportLower.includes('football')) {
    candidates = gameScores.filter(g => (g.sport || '').toLowerCase().includes('football'));
  } else if (sportLower.includes('nhl') || sportLower.includes('hockey')) {
    candidates = gameScores.filter(g => (g.sport || '').toLowerCase().includes('hockey'));
  } else if (sportLower.includes('ncaa') || sportLower.includes('college')) {
    candidates = gameScores.filter(g => 
      (g.sport || '').toLowerCase().includes('college') ||
      (g.sport || '').toLowerCase().includes('ncaa')
    );
  }
  
  // If we extracted a specific team, find that game
  if (teamName) {
    for (const game of candidates) {
      if (fuzzyMatchTeam(teamName, game.home_team || '') || 
          fuzzyMatchTeam(teamName, game.away_team || '')) {
        return game;
      }
    }
  }
  
  // For totals without a picked team, try to find game by both team names in description
  for (const game of candidates) {
    const homeMatch = fuzzyMatchTeam(game.home_team || '', desc);
    const awayMatch = fuzzyMatchTeam(game.away_team || '', desc);
    if (homeMatch || awayMatch) return game;
  }
  
  return null;
}

// Verify game-level bet (moneyline, spread, totals)
function verifyGameBet(
  leg: any,
  gameScores: any[]
): { outcome: string; actualValue: number | null; details: string } {
  const betType = (leg.betType || leg.prop_type || leg.bet_type || '').toLowerCase();
  const description = leg.description || '';
  const sport = leg.sport || '';
  const line = leg.line || leg.currentLine || parseLineFromDescription(description);
  
  // Find the matching game
  const game = findGameForLeg(description, sport, gameScores);
  
  if (!game) {
    console.log(`No game found for: ${description}`);
    return { outcome: 'no_data', actualValue: null, details: 'Game not found' };
  }
  
  // Check if game is final
  const gameStatus = (game.game_status || game.status || '').toLowerCase();
  if (!gameStatus.includes('final') && !gameStatus.includes('completed') && !gameStatus.includes('ended')) {
    console.log(`Game not final: ${game.home_team} vs ${game.away_team}, status: ${gameStatus}`);
    return { outcome: 'no_data', actualValue: null, details: `Game status: ${gameStatus}` };
  }
  
  const homeScore = parseFloat(game.home_score) || 0;
  const awayScore = parseFloat(game.away_score) || 0;
  const totalScore = homeScore + awayScore;
  
  console.log(`Game found: ${game.away_team} ${awayScore} @ ${game.home_team} ${homeScore}`);
  
  // Handle Moneyline
  if (betType === 'moneyline' || betType === 'h2h' || betType === 'ml' || 
      description.toLowerCase().includes(' ml') || description.toLowerCase().includes('moneyline')) {
    
    const pickedTeam = extractTeamFromDescription(description);
    if (!pickedTeam) {
      return { outcome: 'no_data', actualValue: null, details: 'Could not extract picked team' };
    }
    
    const isHome = fuzzyMatchTeam(pickedTeam, game.home_team || '');
    const isAway = fuzzyMatchTeam(pickedTeam, game.away_team || '');
    
    if (!isHome && !isAway) {
      return { outcome: 'no_data', actualValue: null, details: `Could not match team: ${pickedTeam}` };
    }
    
    // Check for tie
    if (homeScore === awayScore) {
      return { 
        outcome: 'push', 
        actualValue: isHome ? homeScore : awayScore, 
        details: `${game.away_team} ${awayScore} @ ${game.home_team} ${homeScore} (Tie)` 
      };
    }
    
    const pickedWon = isHome ? homeScore > awayScore : awayScore > homeScore;
    
    return {
      outcome: pickedWon ? 'hit' : 'miss',
      actualValue: isHome ? homeScore : awayScore,
      details: `${game.away_team} ${awayScore} @ ${game.home_team} ${homeScore}`,
    };
  }
  
  // Handle Totals (Over/Under)
  if (betType === 'totals' || betType === 'total' || betType === 'over/under' ||
      description.toLowerCase().includes('over') || description.toLowerCase().includes('under')) {
    
    const side = getSideFromDescription(description);
    
    if (!line) {
      return { outcome: 'no_data', actualValue: totalScore, details: 'Missing line for totals' };
    }
    
    if (!side) {
      return { outcome: 'no_data', actualValue: totalScore, details: 'Could not determine OVER/UNDER' };
    }
    
    if (totalScore === line) {
      return { outcome: 'push', actualValue: totalScore, details: `Total: ${totalScore} (push at ${line})` };
    }
    
    const hit = side === 'OVER' ? totalScore > line : totalScore < line;
    
    return {
      outcome: hit ? 'hit' : 'miss',
      actualValue: totalScore,
      details: `Total: ${totalScore} vs ${side} ${line}`,
    };
  }
  
  // Handle Spreads
  if (betType === 'spreads' || betType === 'spread' || betType === 'point_spread' ||
      (line !== null && !description.toLowerCase().includes('over') && !description.toLowerCase().includes('under'))) {
    
    const pickedTeam = extractTeamFromDescription(description);
    if (!pickedTeam) {
      return { outcome: 'no_data', actualValue: null, details: 'Could not extract picked team for spread' };
    }
    
    if (line === null) {
      return { outcome: 'no_data', actualValue: null, details: 'Missing spread line' };
    }
    
    const isHome = fuzzyMatchTeam(pickedTeam, game.home_team || '');
    const isAway = fuzzyMatchTeam(pickedTeam, game.away_team || '');
    
    if (!isHome && !isAway) {
      return { outcome: 'no_data', actualValue: null, details: `Could not match team: ${pickedTeam}` };
    }
    
    // Calculate margin from picked team's perspective
    const margin = isHome ? homeScore - awayScore : awayScore - homeScore;
    const adjustedMargin = margin + line; // line is typically negative for favorites
    
    if (adjustedMargin === 0) {
      return { outcome: 'push', actualValue: margin, details: `Margin: ${margin}, spread: ${line} (push)` };
    }
    
    const covered = adjustedMargin > 0;
    
    return {
      outcome: covered ? 'hit' : 'miss',
      actualValue: margin,
      details: `${pickedTeam} margin: ${margin} vs spread ${line}`,
    };
  }
  
  return { outcome: 'no_data', actualValue: null, details: `Unknown bet type: ${betType}` };
}

// Check if a leg is a game-level bet (not a player prop)
function isGameLevelBet(leg: any): boolean {
  const betType = (leg.betType || leg.prop_type || leg.bet_type || '').toLowerCase();
  const description = (leg.description || '').toLowerCase();
  
  // Explicit game bet types
  if (['moneyline', 'h2h', 'ml', 'totals', 'total', 'spreads', 'spread', 'point_spread', 'over/under'].includes(betType)) {
    return true;
  }
  
  // Description patterns for game bets
  if (description.includes(' ml') || description.includes('moneyline')) return true;
  if (description.match(/[+-]\d+\.?\d*\s*(vs|@|\s*$)/)) return true; // Spread pattern
  if (description.match(/(over|under)\s+\d+\.?\d*/i) && !leg.playerName && !leg.player_name) return true;
  
  return false;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const startTime = Date.now();
  
  const results = {
    parlaysProcessed: 0,
    parlaysVerified: 0,
    parlaysWon: 0,
    parlaysLost: 0,
    parlaysNoData: 0,
    gameBetsVerified: 0,
    playerPropsVerified: 0,
    errors: [] as string[],
  };

  try {
    console.log('=== Starting Suggested Parlay Outcome Verification ===');
    
    // Fetch pending suggested parlays that have expired
    const { data: pendingParlays, error: fetchError } = await supabase
      .from('suggested_parlays')
      .select('*')
      .eq('outcome', 'pending')
      .lt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(100);

    if (fetchError) {
      throw new Error(`Failed to fetch pending parlays: ${fetchError.message}`);
    }

    console.log(`Found ${pendingParlays?.length || 0} expired suggested parlays to verify`);

    if (!pendingParlays || pendingParlays.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No pending parlays to verify',
        results 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get date range for lookups
    const oldestParlay = pendingParlays[pendingParlays.length - 1];
    const dateStart = new Date(new Date(oldestParlay.expires_at).getTime() - 3 * 24 * 60 * 60 * 1000);
    
    // Fetch NBA game logs
    const { data: nbaGameLogs, error: nbaLogsError } = await supabase
      .from('nba_player_game_logs')
      .select('*')
      .gte('game_date', dateStart.toISOString().split('T')[0]);
    
    if (nbaLogsError) {
      console.error(`Error fetching NBA game logs: ${nbaLogsError.message}`);
    }
    console.log(`Loaded ${nbaGameLogs?.length || 0} NBA game log records`);
    
    // Fetch NFL game logs
    const { data: nflGameLogs, error: nflLogsError } = await supabase
      .from('nfl_player_game_logs')
      .select('*')
      .gte('game_date', dateStart.toISOString().split('T')[0]);
    
    if (nflLogsError) {
      console.error(`Error fetching NFL game logs: ${nflLogsError.message}`);
    }
    console.log(`Loaded ${nflGameLogs?.length || 0} NFL game log records`);
    
    // Fetch NHL game logs
    const { data: nhlGameLogs, error: nhlLogsError } = await supabase
      .from('nhl_player_game_logs')
      .select('*')
      .gte('game_date', dateStart.toISOString().split('T')[0]);
    
    if (nhlLogsError) {
      console.error(`Error fetching NHL game logs: ${nhlLogsError.message}`);
    }
    console.log(`Loaded ${nhlGameLogs?.length || 0} NHL game log records`);
    
    // Fetch final game scores for game-level bets
    const { data: gameScores, error: scoresError } = await supabase
      .from('live_game_scores')
      .select('*')
      .gte('start_time', dateStart.toISOString());
    
    if (scoresError) {
      console.error(`Error fetching game scores: ${scoresError.message}`);
    }
    
    // Filter for final games only
    const finalGameScores = (gameScores || []).filter(g => {
      const status = (g.game_status || g.status || '').toLowerCase();
      return status.includes('final') || status.includes('completed') || status.includes('ended');
    });
    
    console.log(`Loaded ${finalGameScores.length} final game scores (from ${gameScores?.length || 0} total)`);
    
    // Create lookup maps by date for player props
    const createLogsByDateMap = (logs: any[] | null) => {
      const map = new Map<string, any[]>();
      for (const log of logs || []) {
        const date = log.game_date;
        if (!map.has(date)) {
          map.set(date, []);
        }
        map.get(date)!.push(log);
      }
      return map;
    };
    
    const nbaLogsByDate = createLogsByDateMap(nbaGameLogs);
    const nflLogsByDate = createLogsByDateMap(nflGameLogs);
    const nhlLogsByDate = createLogsByDateMap(nhlGameLogs);

    for (const parlay of pendingParlays) {
      results.parlaysProcessed++;
      
      try {
        const legs = parlay.legs as any[];
        if (!legs || legs.length === 0) {
          console.log(`Parlay ${parlay.id} has no legs, skipping`);
          continue;
        }

        const legOutcomes: any[] = [];
        let allHit = true;
        let anyMissed = false;
        let verifiedCount = 0;

        for (let i = 0; i < legs.length; i++) {
          const leg = legs[i];
          const sport = (leg.sport || parlay.sport || '').toUpperCase();
          
          // Check if this is a game-level bet
          if (isGameLevelBet(leg)) {
            const result = verifyGameBet(leg, finalGameScores);
            
            legOutcomes.push({
              legIndex: i,
              betType: leg.betType || leg.prop_type || 'game',
              description: leg.description,
              outcome: result.outcome,
              actualValue: result.actualValue,
              details: result.details,
            });
            
            if (result.outcome === 'hit') {
              verifiedCount++;
              results.gameBetsVerified++;
            } else if (result.outcome === 'miss') {
              anyMissed = true;
              allHit = false;
              results.gameBetsVerified++;
            } else if (result.outcome === 'push') {
              verifiedCount++;
              results.gameBetsVerified++;
            } else {
              allHit = false;
            }
            
            console.log(`Game bet ${i}: ${leg.description} -> ${result.outcome} (${result.details})`);
            continue;
          }
          
          // Handle player props
          let playerName = leg.playerName || leg.player_name || leg.player || '';
          let propType = leg.propType || leg.prop_type || leg.betType || '';
          let line = parseFloat(leg.line || leg.currentLine || 0);
          let side = leg.side || leg.bet_side || 'OVER';
          
          // If we don't have structured data, try parsing description
          if (!playerName && leg.description) {
            const parsed = parseLegDescription(leg.description);
            if (parsed) {
              playerName = parsed.playerName;
              propType = parsed.propType;
              line = parsed.line;
              side = parsed.side;
            }
          }
          
          if (!playerName) {
            legOutcomes.push({ legIndex: i, outcome: 'no_data', actualValue: null, details: 'No player name' });
            allHit = false;
            continue;
          }

          // Get appropriate stat mapping and game logs based on sport
          let statMapping: string | string[] | undefined;
          let gameLogsByDate: Map<string, any[]>;
          
          if (sport.includes('NFL') || sport.includes('FOOTBALL')) {
            statMapping = NFL_PROP_TO_STAT_MAP[propType];
            gameLogsByDate = nflLogsByDate;
          } else if (sport.includes('NHL') || sport.includes('HOCKEY')) {
            statMapping = NHL_PROP_TO_STAT_MAP[propType];
            gameLogsByDate = nhlLogsByDate;
          } else {
            // Default to NBA
            statMapping = NBA_PROP_TO_STAT_MAP[propType];
            gameLogsByDate = nbaLogsByDate;
          }
          
          if (!statMapping) {
            console.log(`Unknown prop type: ${propType} for sport ${sport}`);
            legOutcomes.push({ legIndex: i, playerName, propType, outcome: 'unknown_prop', actualValue: null });
            allHit = false;
            continue;
          }

          // Search for player game log around expires_at date
          const expiryDate = new Date(parlay.expires_at);
          const searchDates = [
            expiryDate.toISOString().split('T')[0],
            new Date(expiryDate.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            new Date(expiryDate.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          ];

          let playerLog: any = null;
          let matchScore = 0;
          
          for (const searchDate of searchDates) {
            const logsForDate = gameLogsByDate.get(searchDate) || [];
            
            for (const log of logsForDate) {
              const score = fuzzyMatchPlayerName(playerName, log.player_name);
              if (score > matchScore && score >= 0.7) {
                matchScore = score;
                playerLog = log;
                if (score === 1.0) break;
              }
            }
            if (matchScore === 1.0) break;
          }

          if (!playerLog) {
            console.log(`No game log found for ${playerName} (${sport})`);
            legOutcomes.push({ legIndex: i, playerName, propType, line, side, outcome: 'no_data', actualValue: null });
            allHit = false;
            continue;
          }

          // Calculate actual value
          let actualValue: number;
          if (Array.isArray(statMapping)) {
            actualValue = statMapping.reduce((sum, col) => sum + (parseFloat(playerLog[col]) || 0), 0);
          } else {
            actualValue = parseFloat(playerLog[statMapping]) || 0;
          }

          // Determine outcome
          let legOutcome: string;
          const sideUpper = side.toUpperCase();
          
          if (actualValue === line) {
            legOutcome = 'push';
          } else if (sideUpper === 'OVER' || sideUpper === 'O') {
            legOutcome = actualValue > line ? 'hit' : 'miss';
          } else {
            legOutcome = actualValue < line ? 'hit' : 'miss';
          }

          console.log(`Player prop ${i}: ${playerName} ${propType} ${side} ${line} -> Actual: ${actualValue} = ${legOutcome}`);

          legOutcomes.push({
            legIndex: i,
            playerName,
            propType,
            line,
            side,
            outcome: legOutcome,
            actualValue,
          });

          verifiedCount++;
          results.playerPropsVerified++;
          
          if (legOutcome === 'miss') {
            anyMissed = true;
            allHit = false;
          } else if (legOutcome !== 'hit' && legOutcome !== 'push') {
            allHit = false;
          }
        }

        // Determine overall parlay outcome
        let parlayOutcome: string;
        if (verifiedCount === 0) {
          parlayOutcome = 'no_data';
          results.parlaysNoData++;
        } else if (anyMissed) {
          parlayOutcome = 'lost';
          results.parlaysLost++;
        } else if (allHit && verifiedCount === legs.length) {
          parlayOutcome = 'won';
          results.parlaysWon++;
        } else {
          // Some legs verified but not all, and no misses - still pending more data
          parlayOutcome = 'pending';
          continue; // Skip update, wait for more data
        }

        console.log(`Parlay ${parlay.id}: ${parlayOutcome} (${verifiedCount}/${legs.length} legs verified)`);

        // Update the parlay with outcome
        const { error: updateError } = await supabase
          .from('suggested_parlays')
          .update({
            outcome: parlayOutcome,
            settled_at: new Date().toISOString(),
            leg_outcomes: legOutcomes,
          })
          .eq('id', parlay.id);

        if (updateError) {
          console.error(`Failed to update parlay ${parlay.id}:`, updateError);
          results.errors.push(`Update failed: ${updateError.message}`);
        } else {
          results.parlaysVerified++;
        }

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`Error processing parlay ${parlay.id}:`, err);
        results.errors.push(`Parlay ${parlay.id}: ${errMsg}`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`=== Verification Complete in ${duration}ms ===`);
    console.log(`Results: ${JSON.stringify(results)}`);

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'verify-suggested-parlay-outcomes',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: results,
    });

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Fatal error:', error);
    
    await supabase.from('cron_job_history').insert({
      job_name: 'verify-suggested-parlay-outcomes',
      status: 'error',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      error_message: errorMsg,
    });

    return new Response(JSON.stringify({ success: false, error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
