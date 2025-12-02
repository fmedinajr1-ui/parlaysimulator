import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NBA Stats API headers required for requests
const NBA_STATS_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Host': 'stats.nba.com',
  'Origin': 'https://www.nba.com',
  'Referer': 'https://www.nba.com/',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
};

// Sport-specific stat mappings
const PROP_TO_STAT_MAP: Record<string, Record<string, string>> = {
  basketball_nba: {
    'player_points': 'PTS',
    'player_rebounds': 'REB',
    'player_assists': 'AST',
    'player_threes': 'FG3M',
    'player_points_rebounds_assists': 'PRA',
    'player_steals': 'STL',
    'player_blocks': 'BLK',
  },
  americanfootball_nfl: {
    'player_pass_tds': 'passing_touchdowns',
    'player_pass_yds': 'passing_yards',
    'player_rush_yds': 'rushing_yards',
    'player_receptions': 'receptions',
    'player_reception_yds': 'receiving_yards',
  },
  icehockey_nhl: {
    'player_goals': 'goals',
    'player_assists': 'assists',
    'player_points': 'points',
    'player_shots_on_goal': 'shots',
  }
};

const SPORT_KEYS = ['basketball_nba', 'americanfootball_nfl', 'icehockey_nhl'];

// Search for NBA player ID by name
async function searchNBAPlayerId(playerName: string): Promise<string | null> {
  try {
    const searchUrl = `https://stats.nba.com/stats/commonallplayers?IsOnlyCurrentSeason=1&LeagueID=00&Season=2024-25`;
    
    const response = await fetch(searchUrl, { headers: NBA_STATS_HEADERS });
    if (!response.ok) {
      console.error('Failed to fetch NBA players list:', response.status);
      return null;
    }
    
    const data = await response.json();
    const players = data.resultSets?.[0]?.rowSet || [];
    const headers = data.resultSets?.[0]?.headers || [];
    
    const displayNameIdx = headers.indexOf('DISPLAY_FIRST_LAST');
    const playerIdIdx = headers.indexOf('PERSON_ID');
    
    // Normalize the search name
    const normalizedSearch = playerName.toLowerCase().trim();
    
    // Find matching player
    for (const player of players) {
      const fullName = (player[displayNameIdx] || '').toLowerCase();
      if (fullName === normalizedSearch || fullName.includes(normalizedSearch)) {
        return String(player[playerIdIdx]);
      }
    }
    
    // Try partial match on last name
    const lastNameSearch = normalizedSearch.split(' ').pop();
    for (const player of players) {
      const fullName = (player[displayNameIdx] || '').toLowerCase();
      if (fullName.includes(lastNameSearch || '')) {
        return String(player[playerIdIdx]);
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error searching NBA player:', error);
    return null;
  }
}

// Fetch real NBA player game logs
async function fetchNBAPlayerGameLogs(playerId: string, numGames: number = 5): Promise<any[]> {
  try {
    const url = `https://stats.nba.com/stats/playergamelog?PlayerID=${playerId}&Season=2024-25&SeasonType=Regular%20Season`;
    
    console.log(`Fetching NBA game logs for player ${playerId}`);
    
    const response = await fetch(url, { headers: NBA_STATS_HEADERS });
    if (!response.ok) {
      console.error('Failed to fetch NBA game log:', response.status);
      return [];
    }
    
    const data = await response.json();
    const resultSet = data.resultSets?.[0];
    if (!resultSet) return [];
    
    const headers = resultSet.headers || [];
    const rows = resultSet.rowSet || [];
    
    // Map header indices
    const indices = {
      gameDate: headers.indexOf('GAME_DATE'),
      matchup: headers.indexOf('MATCHUP'),
      pts: headers.indexOf('PTS'),
      reb: headers.indexOf('REB'),
      ast: headers.indexOf('AST'),
      stl: headers.indexOf('STL'),
      blk: headers.indexOf('BLK'),
      fg3m: headers.indexOf('FG3M'),
    };
    
    // Get most recent games
    const gameLogs = rows.slice(0, numGames).map((row: any[], index: number) => ({
      game_number: index + 1,
      date: row[indices.gameDate],
      opponent: row[indices.matchup],
      stats: {
        PTS: row[indices.pts] || 0,
        REB: row[indices.reb] || 0,
        AST: row[indices.ast] || 0,
        STL: row[indices.stl] || 0,
        BLK: row[indices.blk] || 0,
        FG3M: row[indices.fg3m] || 0,
        PRA: (row[indices.pts] || 0) + (row[indices.reb] || 0) + (row[indices.ast] || 0),
      }
    }));
    
    console.log(`Found ${gameLogs.length} NBA games for player ${playerId}`);
    return gameLogs;
  } catch (error) {
    console.error('Error fetching NBA game logs:', error);
    return [];
  }
}

// Search for NFL player ID and fetch game logs via ESPN API
async function fetchNFLPlayerGameLogs(playerName: string, numGames: number = 5): Promise<any[]> {
  try {
    // First, search for player using ESPN's athlete search
    const normalizedName = playerName.toLowerCase().trim();
    const searchUrl = `https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(playerName)}&limit=10&type=player`;
    
    console.log(`Searching ESPN for NFL player: ${playerName}`);
    
    const searchRes = await fetch(searchUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    
    if (!searchRes.ok) {
      console.error('ESPN search failed:', searchRes.status);
      return [];
    }
    
    const searchData = await searchRes.json();
    const athletes = searchData.athletes || [];
    
    // Find NFL player
    let playerId: string | null = null;
    for (const athlete of athletes) {
      if (athlete.league?.slug === 'nfl') {
        const fullName = athlete.displayName?.toLowerCase() || '';
        if (fullName === normalizedName || fullName.includes(normalizedName)) {
          playerId = athlete.id;
          break;
        }
      }
    }
    
    if (!playerId) {
      console.log(`Could not find NFL player ID for: ${playerName}`);
      return [];
    }
    
    console.log(`Found NFL player ${playerName} with ID: ${playerId}`);
    
    // Fetch player game log from ESPN
    const gameLogUrl = `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${playerId}/gamelog`;
    
    const gameLogRes = await fetch(gameLogUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    
    if (!gameLogRes.ok) {
      console.error('ESPN game log fetch failed:', gameLogRes.status);
      return [];
    }
    
    const gameLogData = await gameLogRes.json();
    
    // Parse game log data
    const categories = gameLogData.categories || [];
    const events = gameLogData.events || {};
    const gameLogs: any[] = [];
    
    // Get stat labels and values
    const statMap: Record<number, {key: string, value: number}[]> = {};
    const gameIds: string[] = [];
    
    for (const category of categories) {
      const categoryName = category.name; // passing, rushing, receiving
      const labels = category.labels || [];
      const events = category.events || [];
      
      // Get game IDs from first category
      if (gameIds.length === 0) {
        for (const event of events) {
          if (event.eventId) gameIds.push(event.eventId);
        }
      }
      
      // Map stats by game
      for (let i = 0; i < events.length && i < numGames; i++) {
        const eventStats = events[i].stats || [];
        if (!statMap[i]) statMap[i] = [];
        
        for (let j = 0; j < labels.length; j++) {
          const label = labels[j];
          const value = parseFloat(eventStats[j]) || 0;
          
          // Map ESPN labels to our stat keys
          if (categoryName === 'passing') {
            if (label === 'YDS') statMap[i].push({ key: 'passing_yards', value });
            if (label === 'TD') statMap[i].push({ key: 'passing_touchdowns', value });
          } else if (categoryName === 'rushing') {
            if (label === 'YDS') statMap[i].push({ key: 'rushing_yards', value });
            if (label === 'TD') statMap[i].push({ key: 'rushing_touchdowns', value });
          } else if (categoryName === 'receiving') {
            if (label === 'YDS') statMap[i].push({ key: 'receiving_yards', value });
            if (label === 'REC') statMap[i].push({ key: 'receptions', value });
            if (label === 'TD') statMap[i].push({ key: 'receiving_touchdowns', value });
          }
        }
      }
    }
    
    // Build game logs
    const eventDetails = Object.values(events) as any[];
    for (let i = 0; i < Math.min(numGames, eventDetails.length); i++) {
      const event = eventDetails[i];
      const stats: Record<string, number> = {};
      
      // Aggregate stats for this game
      const gameStats = statMap[i] || [];
      for (const stat of gameStats) {
        if (stat && stat.key) {
          stats[stat.key] = stat.value;
        }
      }
      
      gameLogs.push({
        game_number: i + 1,
        date: event?.date || new Date().toISOString().split('T')[0],
        opponent: event?.opponent?.displayName || 'Unknown',
        playerId,
        stats
      });
    }
    
    console.log(`Found ${gameLogs.length} NFL games for ${playerName}`);
    return gameLogs;
  } catch (error) {
    console.error('Error fetching NFL game logs:', error);
    return [];
  }
}

// Fetch player stats from cache or API
async function fetchPlayerStats(playerName: string, sport: string, propType: string, supabase: any): Promise<any[]> {
  const statKey = PROP_TO_STAT_MAP[sport]?.[propType] || propType;
  
  // Check cache first (within last 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: cached } = await supabase
    .from('player_stats_cache')
    .select('*')
    .eq('player_name', playerName)
    .eq('sport', sport)
    .eq('stat_type', statKey)
    .gte('created_at', oneDayAgo)
    .order('game_date', { ascending: false })
    .limit(5);

  if (cached && cached.length >= 5) {
    console.log(`Using cached stats for ${playerName} (${statKey})`);
    return cached.map((c: any) => ({
      game_number: 0,
      date: c.game_date,
      stat_value: c.stat_value,
      opponent: c.opponent
    }));
  }

  // Fetch from API based on sport
  if (sport === 'basketball_nba') {
    const playerId = await searchNBAPlayerId(playerName);
    if (!playerId) {
      console.log(`Could not find NBA player ID for: ${playerName}`);
      return [];
    }
    
    const gameLogs = await fetchNBAPlayerGameLogs(playerId, 5);
    
    if (gameLogs.length > 0) {
      // Cache the results
      const cacheInserts = [];
      for (const game of gameLogs) {
        // Cache each stat type from this game
        for (const [statType, value] of Object.entries(game.stats)) {
          cacheInserts.push({
            player_name: playerName,
            player_id: playerId,
            sport: sport,
            game_date: game.date,
            opponent: game.opponent,
            stat_type: statType,
            stat_value: value,
          });
        }
      }
      
      // Upsert to cache
      const { error: cacheError } = await supabase
        .from('player_stats_cache')
        .upsert(cacheInserts, { 
          onConflict: 'player_name,sport,game_date,stat_type',
          ignoreDuplicates: true
        });
      
      if (cacheError) {
        console.error('Error caching player stats:', cacheError);
      }
      
      // Return the specific stat we need
      return gameLogs.map((game, idx) => ({
        game_number: idx + 1,
        date: game.date,
        stat_value: game.stats[statKey] || 0,
        opponent: game.opponent
      }));
    }
  }
  
  // NFL stats via ESPN API
  if (sport === 'americanfootball_nfl') {
    const gameLogs = await fetchNFLPlayerGameLogs(playerName, 5);
    
    if (gameLogs.length > 0) {
      // Cache the results
      const cacheInserts = [];
      for (const game of gameLogs) {
        for (const [statType, value] of Object.entries(game.stats)) {
          cacheInserts.push({
            player_name: playerName,
            player_id: game.playerId,
            sport: sport,
            game_date: game.date,
            opponent: game.opponent,
            stat_type: statType,
            stat_value: value,
          });
        }
      }
      
      const { error: cacheError } = await supabase
        .from('player_stats_cache')
        .upsert(cacheInserts, { 
          onConflict: 'player_name,sport,game_date,stat_type',
          ignoreDuplicates: true
        });
      
      if (cacheError) {
        console.error('Error caching NFL player stats:', cacheError);
      }
      
      return gameLogs.map((game, idx) => ({
        game_number: idx + 1,
        date: game.date,
        stat_value: game.stats[statKey] || 0,
        opponent: game.opponent
      }));
    }
  }
  
  // TODO: Add NHL API integration
  console.log(`No API integration for ${sport} or API call failed for ${playerName}`);
  return [];
}

// Calculate hit rate from game logs
function calculateHitRate(gameLogs: any[], line: number): { overHits: number; underHits: number; hitRateOver: number; hitRateUnder: number } {
  let overHits = 0;
  let underHits = 0;
  
  gameLogs.forEach(game => {
    const value = game.stat_value;
    if (value > line) overHits++;
    else if (value < line) underHits++;
  });
  
  const total = gameLogs.length;
  return {
    overHits,
    underHits,
    hitRateOver: total > 0 ? overHits / total : 0,
    hitRateUnder: total > 0 ? underHits / total : 0
  };
}

// Calculate confidence score based on consistency
function calculateConfidence(gameLogs: any[], line: number, hitRate: number): number {
  if (gameLogs.length === 0) return 0;
  
  // Base confidence from hit rate
  let confidence = hitRate * 100;
  
  // Calculate average margin
  const margins = gameLogs.map(g => Math.abs((g.stat_value || 0) - line));
  const avgMargin = margins.reduce((a, b) => a + b, 0) / margins.length;
  
  // Higher margin = more confident (capped at 15 bonus points)
  const marginBonus = Math.min(avgMargin / Math.max(line, 1) * 20, 15);
  confidence += marginBonus;
  
  // Consistency bonus (low standard deviation)
  const values = gameLogs.map(g => g.stat_value || 0);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const consistencyBonus = Math.max(0, 10 - (stdDev / Math.max(line, 1) * 10));
  confidence += consistencyBonus;
  
  return Math.min(Math.round(confidence), 100);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const THE_ODDS_API_KEY = Deno.env.get('THE_ODDS_API_KEY')!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const { sports = SPORT_KEYS, minHitRate = 0.8 } = await req.json().catch(() => ({}));

    console.log('Analyzing hit rate props for sports:', sports);

    const analyzedProps: any[] = [];
    const errors: string[] = [];
    const apiStats = { playersSearched: 0, gamesFound: 0, propsAnalyzed: 0 };

    for (const sport of sports) {
      try {
        // Fetch today's events
        const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${THE_ODDS_API_KEY}`;
        const eventsRes = await fetch(eventsUrl);
        
        if (!eventsRes.ok) {
          errors.push(`Failed to fetch events for ${sport}: ${eventsRes.status}`);
          continue;
        }

        const events = await eventsRes.json();
        console.log(`Found ${events.length} events for ${sport}`);

        // Filter events within next 24 hours
        const now = new Date();
        const upcomingEvents = events.filter((e: any) => {
          const commence = new Date(e.commence_time);
          const hoursUntil = (commence.getTime() - now.getTime()) / (1000 * 60 * 60);
          return hoursUntil > 0 && hoursUntil <= 24;
        }).slice(0, 5); // Limit to 5 events to save API calls

        console.log(`Processing ${upcomingEvents.length} upcoming events for ${sport}`);

        // Get prop markets for this sport
        const propMarkets = Object.keys(PROP_TO_STAT_MAP[sport] || {});
        if (propMarkets.length === 0) continue;

        for (const event of upcomingEvents) {
          // Fetch player props for this event
          const marketsToFetch = sport === 'basketball_nba' 
            ? ['player_points', 'player_rebounds', 'player_assists', 'player_threes']
            : propMarkets.slice(0, 3);
          
          const propsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds?apiKey=${THE_ODDS_API_KEY}&regions=us&markets=${marketsToFetch.join(',')}&oddsFormat=american`;
          
          try {
            const propsRes = await fetch(propsUrl);
            if (!propsRes.ok) {
              console.log(`Failed to fetch props for event ${event.id}`);
              continue;
            }

            const propsData = await propsRes.json();
            
            if (!propsData.bookmakers || propsData.bookmakers.length === 0) continue;

            // Process each bookmaker's props (limit to first 2 bookmakers)
            for (const bookmaker of propsData.bookmakers.slice(0, 2)) {
              for (const market of bookmaker.markets || []) {
                // Group outcomes by player
                const playerOutcomes: Record<string, any[]> = {};
                
                for (const outcome of market.outcomes || []) {
                  const playerName = outcome.description;
                  if (!playerName) continue;
                  
                  if (!playerOutcomes[playerName]) {
                    playerOutcomes[playerName] = [];
                  }
                  playerOutcomes[playerName].push(outcome);
                }

                // Analyze each player's prop
                for (const [playerName, outcomes] of Object.entries(playerOutcomes)) {
                  const overOutcome = outcomes.find((o: any) => o.name === 'Over');
                  const underOutcome = outcomes.find((o: any) => o.name === 'Under');
                  
                  if (!overOutcome || !underOutcome) continue;

                  const line = overOutcome.point || 0;
                  const overPrice = overOutcome.price;
                  const underPrice = underOutcome.price;

                  apiStats.playersSearched++;
                  
                  // Fetch real player stats from API
                  const gameLogs = await fetchPlayerStats(playerName, sport, market.key, supabase);
                  
                  if (gameLogs.length < 3) {
                    console.log(`Insufficient game data for ${playerName} (${gameLogs.length} games)`);
                    continue;
                  }

                  apiStats.gamesFound += gameLogs.length;
                  apiStats.propsAnalyzed++;

                  // Format game logs with hit/miss data
                  const formattedLogs = gameLogs.map((game, idx) => ({
                    game_number: idx + 1,
                    stat_value: game.stat_value,
                    date: game.date,
                    opponent: game.opponent,
                    hit_over: game.stat_value > line,
                    hit_under: game.stat_value < line,
                    margin: Math.round((game.stat_value - line) * 10) / 10
                  }));

                  // Calculate hit rates
                  const { overHits, underHits, hitRateOver, hitRateUnder } = calculateHitRate(formattedLogs, line);

                  // Determine recommended side
                  let recommendedSide: string | null = null;
                  let bestHitRate = 0;
                  
                  if (hitRateOver >= minHitRate) {
                    recommendedSide = 'over';
                    bestHitRate = hitRateOver;
                  } else if (hitRateUnder >= minHitRate) {
                    recommendedSide = 'under';
                    bestHitRate = hitRateUnder;
                  }

                  // Only save props with good hit rates
                  if (recommendedSide) {
                    const confidence = calculateConfidence(formattedLogs, line, bestHitRate);
                    
                    const propData = {
                      player_name: playerName,
                      sport: sport,
                      prop_type: market.key,
                      current_line: line,
                      over_price: overPrice,
                      under_price: underPrice,
                      games_analyzed: formattedLogs.length,
                      over_hits: overHits,
                      under_hits: underHits,
                      hit_rate_over: Math.round(hitRateOver * 100) / 100,
                      hit_rate_under: Math.round(hitRateUnder * 100) / 100,
                      game_logs: formattedLogs,
                      recommended_side: recommendedSide,
                      confidence_score: confidence,
                      event_id: event.id,
                      game_description: `${event.away_team} @ ${event.home_team}`,
                      bookmaker: bookmaker.key,
                      commence_time: event.commence_time,
                      analyzed_at: new Date().toISOString(),
                      expires_at: event.commence_time
                    };

                    // Upsert to database
                    const { error: upsertError } = await supabase
                      .from('player_prop_hitrates')
                      .upsert(propData, {
                        onConflict: 'player_name,sport,prop_type,current_line,event_id'
                      });

                    if (upsertError) {
                      console.error('Error upserting hit rate:', upsertError);
                    } else {
                      analyzedProps.push(propData);
                      console.log(`✓ ${playerName} ${market.key} ${line}: ${recommendedSide.toUpperCase()} ${Math.round(bestHitRate * 100)}% hit rate (${overHits}/${formattedLogs.length} games)`);
                    }
                  }
                }
              }
            }
          } catch (eventError) {
            console.error(`Error processing event ${event.id}:`, eventError);
          }
        }
      } catch (sportError) {
        errors.push(`Error processing ${sport}: ${sportError}`);
        console.error(`Error processing ${sport}:`, sportError);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      analyzed: analyzedProps.length,
      props: analyzedProps,
      apiStats,
      errors
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in analyze-hitrate-props:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
