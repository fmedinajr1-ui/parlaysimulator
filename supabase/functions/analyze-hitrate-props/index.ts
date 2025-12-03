import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Timeout for API calls (10 seconds)
const API_TIMEOUT = 10000;

// Cached NBA players list (populated once per invocation)
let nbaPlayersCache: Map<string, string> | null = null;

// NBA Stats API headers
const NBA_STATS_HEADERS = {
  'Accept': 'application/json',
  'Host': 'stats.nba.com',
  'Origin': 'https://www.nba.com',
  'Referer': 'https://www.nba.com/',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
};

const PROP_TO_STAT_MAP: Record<string, Record<string, string>> = {
  basketball_nba: {
    'player_points': 'PTS',
    'player_rebounds': 'REB',
    'player_assists': 'AST',
    'player_threes': 'FG3M',
  },
  americanfootball_nfl: {
    'player_pass_tds': 'passing_touchdowns',
    'player_pass_yds': 'passing_yards',
    'player_rush_yds': 'rushing_yards',
  },
  icehockey_nhl: {
    'player_goals': 'goals',
    'player_assists': 'assists',
    'player_points': 'points',
  }
};

// Fetch with timeout wrapper
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = API_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Load NBA players list ONCE and cache it
async function loadNBAPlayersCache(): Promise<boolean> {
  if (nbaPlayersCache && nbaPlayersCache.size > 0) return true;
  
  try {
    console.log('[NBA] Loading players list...');
    const url = 'https://stats.nba.com/stats/commonallplayers?IsOnlyCurrentSeason=1&LeagueID=00&Season=2024-25';
    // Use longer timeout for initial load (25 seconds)
    const response = await fetchWithTimeout(url, { headers: NBA_STATS_HEADERS }, 25000);
    
    if (!response.ok) {
      console.error('[NBA] Failed to load players list:', response.status);
      nbaPlayersCache = new Map();
      return false;
    }
    
    const data = await response.json();
    const players = data.resultSets?.[0]?.rowSet || [];
    const headers = data.resultSets?.[0]?.headers || [];
    
    const nameIdx = headers.indexOf('DISPLAY_FIRST_LAST');
    const idIdx = headers.indexOf('PERSON_ID');
    
    nbaPlayersCache = new Map();
    for (const player of players) {
      const name = (player[nameIdx] || '').toLowerCase().trim();
      const id = String(player[idIdx]);
      if (name && id) {
        nbaPlayersCache.set(name, id);
      }
    }
    
    console.log(`[NBA] Cached ${nbaPlayersCache.size} players`);
    return nbaPlayersCache.size > 0;
  } catch (error) {
    console.error('[NBA] Error loading players:', error);
    nbaPlayersCache = new Map();
    return false;
  }
}

// Fast NBA player ID lookup from cache
function getNBAPlayerId(playerName: string): string | null {
  if (!nbaPlayersCache) return null;
  
  const normalized = playerName.toLowerCase().trim();
  
  // Exact match
  if (nbaPlayersCache.has(normalized)) {
    return nbaPlayersCache.get(normalized)!;
  }
  
  // Partial match
  for (const [name, id] of nbaPlayersCache) {
    if (name.includes(normalized) || normalized.includes(name)) {
      return id;
    }
  }
  
  return null;
}

// Fetch NBA player game logs
async function fetchNBAGameLogs(playerId: string): Promise<any[]> {
  try {
    const url = `https://stats.nba.com/stats/playergamelog?PlayerID=${playerId}&Season=2024-25&SeasonType=Regular%20Season`;
    const response = await fetchWithTimeout(url, { headers: NBA_STATS_HEADERS });
    
    if (!response.ok) return [];
    
    const data = await response.json();
    const resultSet = data.resultSets?.[0];
    if (!resultSet) return [];
    
    const headers = resultSet.headers || [];
    const rows = resultSet.rowSet || [];
    
    const idx = {
      date: headers.indexOf('GAME_DATE'),
      matchup: headers.indexOf('MATCHUP'),
      pts: headers.indexOf('PTS'),
      reb: headers.indexOf('REB'),
      ast: headers.indexOf('AST'),
      fg3m: headers.indexOf('FG3M'),
    };
    
    return rows.slice(0, 5).map((row: any[]) => ({
      date: row[idx.date],
      opponent: row[idx.matchup],
      stats: {
        PTS: row[idx.pts] || 0,
        REB: row[idx.reb] || 0,
        AST: row[idx.ast] || 0,
        FG3M: row[idx.fg3m] || 0,
      }
    }));
  } catch {
    return [];
  }
}

// Fetch player stats with caching
async function fetchPlayerStats(playerName: string, sport: string, propType: string, supabase: any): Promise<any[]> {
  const statKey = PROP_TO_STAT_MAP[sport]?.[propType] || propType;
  
  // Check DB cache first
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

  if (cached && cached.length >= 3) {
    return cached.map((c: any) => ({
      date: c.game_date,
      stat_value: c.stat_value,
      opponent: c.opponent
    }));
  }

  // NBA - use cached player list
  if (sport === 'basketball_nba') {
    const playerId = getNBAPlayerId(playerName);
    if (!playerId) return [];
    
    const gameLogs = await fetchNBAGameLogs(playerId);
    if (gameLogs.length === 0) return [];
    
    // Cache results
    const cacheInserts = gameLogs.flatMap(game => 
      Object.entries(game.stats).map(([statType, value]) => ({
        player_name: playerName,
        player_id: playerId,
        sport,
        game_date: game.date,
        opponent: game.opponent,
        stat_type: statType,
        stat_value: value,
      }))
    );
    
    await supabase.from('player_stats_cache').upsert(cacheInserts, { 
      onConflict: 'player_name,sport,game_date,stat_type',
      ignoreDuplicates: true
    });
    
    return gameLogs.map((game, idx) => ({
      date: game.date,
      stat_value: game.stats[statKey] || 0,
      opponent: game.opponent
    }));
  }
  
  return [];
}

// Calculate hit rate
function calculateHitRate(gameLogs: any[], line: number) {
  let overHits = 0, underHits = 0;
  gameLogs.forEach(g => {
    if (g.stat_value > line) overHits++;
    else if (g.stat_value < line) underHits++;
  });
  const total = gameLogs.length;
  return {
    overHits,
    underHits,
    hitRateOver: total > 0 ? overHits / total : 0,
    hitRateUnder: total > 0 ? underHits / total : 0
  };
}

// Calculate confidence score
function calculateConfidence(gameLogs: any[], line: number, hitRate: number): number {
  if (gameLogs.length === 0) return 0;
  let confidence = hitRate * 100;
  const margins = gameLogs.map(g => Math.abs((g.stat_value || 0) - line));
  const avgMargin = margins.reduce((a, b) => a + b, 0) / margins.length;
  confidence += Math.min(avgMargin / Math.max(line, 1) * 20, 15);
  return Math.min(Math.round(confidence), 100);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const THE_ODDS_API_KEY = Deno.env.get('THE_ODDS_API_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const { sports = ['basketball_nba'], limit = 20, minHitRate = 0.75 } = await req.json().catch(() => ({}));

    console.log(`[HitRate] Starting analysis for ${sports.join(', ')} (limit: ${limit})`);

    // Pre-load NBA players cache if needed
    let nbaAvailable = true;
    if (sports.includes('basketball_nba')) {
      nbaAvailable = await loadNBAPlayersCache();
      if (!nbaAvailable) {
        console.log('[HitRate] NBA API unavailable - will only use cached player data');
      }
    }

    const analyzedProps: any[] = [];
    let propsChecked = 0;

    for (const sport of sports) {
      if (propsChecked >= limit) break;
      
      try {
        // Fetch events
        const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${THE_ODDS_API_KEY}`;
        const eventsRes = await fetchWithTimeout(eventsUrl);
        if (!eventsRes.ok) continue;

        const events = await eventsRes.json();
        const now = new Date();
        
        // Filter upcoming events (next 24h), limit to 3
        const upcomingEvents = events
          .filter((e: any) => {
            const hours = (new Date(e.commence_time).getTime() - now.getTime()) / 3600000;
            return hours > 0 && hours <= 24;
          })
          .slice(0, 3);

        console.log(`[HitRate] ${sport}: ${upcomingEvents.length} upcoming events`);

        for (const event of upcomingEvents) {
          if (propsChecked >= limit) break;
          
          // Fetch props (limit markets)
          const markets = sport === 'basketball_nba' ? 'player_points,player_rebounds' : 'player_points';
          const propsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds?apiKey=${THE_ODDS_API_KEY}&regions=us&markets=${markets}&oddsFormat=american`;
          
          try {
            const propsRes = await fetchWithTimeout(propsUrl);
            if (!propsRes.ok) continue;
            
            const propsData = await propsRes.json();
            const bookmaker = propsData.bookmakers?.[0];
            if (!bookmaker) continue;

            for (const market of bookmaker.markets || []) {
              if (propsChecked >= limit) break;
              
              // Group by player
              const playerOutcomes: Record<string, any[]> = {};
              for (const outcome of market.outcomes || []) {
                const name = outcome.description;
                if (!name) continue;
                if (!playerOutcomes[name]) playerOutcomes[name] = [];
                playerOutcomes[name].push(outcome);
              }

              // Process players (batch of 5 at a time)
              const players = Object.entries(playerOutcomes).slice(0, 10);
              
              for (const [playerName, outcomes] of players) {
                if (propsChecked >= limit) break;
                
                const over = outcomes.find((o: any) => o.name === 'Over');
                const under = outcomes.find((o: any) => o.name === 'Under');
                if (!over || !under) continue;

                const line = over.point || 0;
                propsChecked++;

                const gameLogs = await fetchPlayerStats(playerName, sport, market.key, supabase);
                if (gameLogs.length < 3) continue;

                const { overHits, underHits, hitRateOver, hitRateUnder } = calculateHitRate(gameLogs, line);
                
                let recommendedSide: string | null = null;
                let bestHitRate = 0;
                
                if (hitRateOver >= minHitRate) {
                  recommendedSide = 'over';
                  bestHitRate = hitRateOver;
                } else if (hitRateUnder >= minHitRate) {
                  recommendedSide = 'under';
                  bestHitRate = hitRateUnder;
                }

                if (recommendedSide) {
                  const propData = {
                    player_name: playerName,
                    sport,
                    prop_type: market.key,
                    current_line: line,
                    over_price: over.price,
                    under_price: under.price,
                    games_analyzed: gameLogs.length,
                    over_hits: overHits,
                    under_hits: underHits,
                    hit_rate_over: Math.round(hitRateOver * 100) / 100,
                    hit_rate_under: Math.round(hitRateUnder * 100) / 100,
                    game_logs: gameLogs,
                    recommended_side: recommendedSide,
                    confidence_score: calculateConfidence(gameLogs, line, bestHitRate),
                    event_id: event.id,
                    game_description: `${event.away_team} @ ${event.home_team}`,
                    bookmaker: bookmaker.key,
                    commence_time: event.commence_time,
                    analyzed_at: new Date().toISOString(),
                    expires_at: event.commence_time
                  };

                  await supabase.from('player_prop_hitrates').upsert(propData, {
                    onConflict: 'player_name,sport,prop_type,current_line,event_id'
                  });

                  analyzedProps.push(propData);
                  console.log(`✓ ${playerName} ${market.key} ${line}: ${recommendedSide.toUpperCase()} ${Math.round(bestHitRate * 100)}%`);
                }
              }
            }
          } catch (e) {
            console.error(`Event error:`, e);
          }
        }
      } catch (e) {
        console.error(`Sport error ${sport}:`, e);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[HitRate] Complete: ${analyzedProps.length} props found in ${duration}ms`);

    return new Response(JSON.stringify({
      success: true,
      analyzed: analyzedProps.length,
      propsChecked,
      duration,
      props: analyzedProps
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[HitRate] Fatal error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
