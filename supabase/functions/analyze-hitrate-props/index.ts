import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Map prop types to database columns
const PROP_TO_COLUMN: Record<string, string> = {
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_threes': 'threes_made',
  'player_blocks': 'blocks',
  'player_steals': 'steals',
  'player_points_rebounds_assists': 'pra', // Will calculate as sum
};

// Helper to normalize team names for matching
function normalizeTeamName(name: string): string {
  return name.toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract opponent team abbreviation from game description
function extractOpponent(gameDescription: string, playerTeam?: string): string {
  // Format: "Team A @ Team B" or "Team A vs Team B"
  const parts = gameDescription.split(/\s+(@|vs\.?)\s+/i);
  if (parts.length >= 3) {
    return normalizeTeamName(parts[2]);
  }
  return normalizeTeamName(gameDescription);
}

// Fetch player stats from our local nba_player_game_logs table
async function fetchPlayerStatsFromDB(
  playerName: string, 
  propType: string, 
  supabase: any,
  limit: number = 10
): Promise<any[]> {
  const column = PROP_TO_COLUMN[propType];
  if (!column) return [];
  
  // For PRA, we need multiple columns
  const selectColumns = propType === 'player_points_rebounds_assists'
    ? 'game_date, opponent, points, rebounds, assists, minutes_played'
    : `game_date, opponent, ${column}, minutes_played`;
  
  const { data: gameLogs, error } = await supabase
    .from('nba_player_game_logs')
    .select(selectColumns)
    .ilike('player_name', `%${playerName.split(' ').slice(-1)[0]}%`) // Match by last name for flexibility
    .order('game_date', { ascending: false })
    .limit(limit);
  
  if (error || !gameLogs || gameLogs.length === 0) {
    // Try exact match
    const { data: exactMatch } = await supabase
      .from('nba_player_game_logs')
      .select(selectColumns)
      .ilike('player_name', playerName)
      .order('game_date', { ascending: false })
      .limit(limit);
    
    if (!exactMatch || exactMatch.length === 0) return [];
    return exactMatch.map((g: any) => ({
      date: g.game_date,
      opponent: g.opponent,
      stat_value: propType === 'player_points_rebounds_assists' 
        ? (g.points || 0) + (g.rebounds || 0) + (g.assists || 0)
        : g[column] || 0,
      minutes: g.minutes_played || 0
    }));
  }
  
  return gameLogs.map((g: any) => ({
    date: g.game_date,
    opponent: g.opponent,
    stat_value: propType === 'player_points_rebounds_assists' 
      ? (g.points || 0) + (g.rebounds || 0) + (g.assists || 0)
      : g[column] || 0,
    minutes: g.minutes_played || 0
  }));
}

// Fetch games vs specific opponent
async function fetchVsOpponentStats(
  playerName: string, 
  opponent: string, 
  propType: string,
  supabase: any
): Promise<any[]> {
  const column = PROP_TO_COLUMN[propType];
  if (!column) return [];
  
  const selectColumns = propType === 'player_points_rebounds_assists'
    ? 'game_date, opponent, points, rebounds, assists, minutes_played'
    : `game_date, opponent, ${column}, minutes_played`;
  
  // Try multiple opponent name variations
  const opponentVariations = [
    opponent,
    opponent.split(' ').pop(), // Last word (e.g., "Lakers")
  ].filter(Boolean);
  
  for (const opp of opponentVariations) {
    const { data: vsGames } = await supabase
      .from('nba_player_game_logs')
      .select(selectColumns)
      .ilike('player_name', `%${playerName.split(' ').slice(-1)[0]}%`)
      .ilike('opponent', `%${opp}%`)
      .order('game_date', { ascending: false })
      .limit(5);
    
    if (vsGames && vsGames.length > 0) {
      return vsGames.map((g: any) => ({
        date: g.game_date,
        opponent: g.opponent,
        stat_value: propType === 'player_points_rebounds_assists' 
          ? (g.points || 0) + (g.rebounds || 0) + (g.assists || 0)
          : g[column] || 0,
        minutes: g.minutes_played || 0
      }));
    }
  }
  
  return [];
}

// Calculate enhanced hit rate with last 5 and vs opponent analysis
function calculateEnhancedHitRate(
  last5Games: any[], 
  vsOpponentGames: any[],
  line: number
) {
  // Last 5 games analysis
  const last5Results = last5Games.slice(0, 5).map(g => ({
    date: g.date,
    value: g.stat_value,
    opponent: g.opponent,
    hit: g.stat_value > line,
    margin: g.stat_value - line
  }));
  
  const last5HitCount = last5Results.filter(r => r.hit).length;
  const last5HitRate = last5Results.length > 0 ? last5HitCount / last5Results.length : 0;
  const last5Avg = last5Results.length > 0 
    ? last5Results.reduce((sum, r) => sum + r.value, 0) / last5Results.length 
    : 0;
  
  // VS Opponent analysis
  let vsOpponentHitRate: number | null = null;
  let vsOpponentAvg: number | null = null;
  let vsOpponentHitCount = 0;
  
  if (vsOpponentGames.length > 0) {
    vsOpponentHitCount = vsOpponentGames.filter(g => g.stat_value > line).length;
    vsOpponentHitRate = vsOpponentHitCount / vsOpponentGames.length;
    vsOpponentAvg = vsOpponentGames.reduce((sum, g) => sum + g.stat_value, 0) / vsOpponentGames.length;
  }
  
  // Calculate combined projected hit rate
  let projectedHitRate = last5HitRate;
  if (vsOpponentHitRate !== null && vsOpponentGames.length >= 2) {
    // Weight opponent-specific data higher when we have enough games
    projectedHitRate = (last5HitRate * 0.6) + (vsOpponentHitRate * 0.4);
  }
  
  // Calculate projected score
  let projectedValue = last5Avg;
  if (vsOpponentAvg !== null && vsOpponentGames.length >= 2) {
    projectedValue = (last5Avg * 0.6) + (vsOpponentAvg * 0.4);
  }
  
  const projectionMargin = projectedValue - line;
  
  // Determine hit streak pattern (X/5)
  const overIn5 = last5Results.filter(r => r.hit).length;
  const underIn5 = last5Results.filter(r => !r.hit).length;
  
  let hitStreak = '';
  let isPerfectStreak = false;
  
  if (last5Results.length >= 5) {
    if (overIn5 === 5) {
      hitStreak = '5/5';
      isPerfectStreak = true;
    } else if (underIn5 === 5) {
      hitStreak = '5/5';
      isPerfectStreak = true;
    } else {
      hitStreak = `${Math.max(overIn5, underIn5)}/5`;
    }
  } else if (last5Results.length >= 3) {
    hitStreak = `${Math.max(overIn5, underIn5)}/${last5Results.length}`;
    isPerfectStreak = overIn5 === last5Results.length || underIn5 === last5Results.length;
  }
  
  return {
    last5Results,
    last5HitRate,
    last5Avg,
    overIn5,
    underIn5,
    vsOpponentGames: vsOpponentGames.length,
    vsOpponentHitRate,
    vsOpponentAvg,
    projectedHitRate,
    projectedValue,
    projectionMargin,
    hitStreak,
    isPerfectStreak,
  };
}

// Calculate confidence score based on all data
function calculateConfidence(analysis: any, line: number): number {
  let confidence = analysis.projectedHitRate * 100;
  
  // Perfect streak bonus
  if (analysis.isPerfectStreak) {
    confidence += 15;
  } else if (analysis.hitStreak === '4/5') {
    confidence += 10;
  } else if (analysis.hitStreak === '3/5') {
    confidence += 5;
  }
  
  // Margin bonus - how much are they beating/missing the line on average
  const absMargin = Math.abs(analysis.projectionMargin);
  if (absMargin > 3) {
    confidence += 10;
  } else if (absMargin > 1.5) {
    confidence += 5;
  }
  
  // VS Opponent bonus - if opponent data supports the pick
  if (analysis.vsOpponentHitRate !== null && analysis.vsOpponentGames >= 2) {
    if (analysis.vsOpponentHitRate > 0.7) {
      confidence += 10;
    } else if (analysis.vsOpponentHitRate > 0.5) {
      confidence += 5;
    }
  }
  
  // Sample size penalty
  if (analysis.last5Results.length < 5) {
    confidence *= 0.85;
  }
  
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
    
    const { 
      sports = ['basketball_nba'], 
      limit = 30, 
      minHitRate = 0.4,
      streakFilter = null
    } = await req.json().catch(() => ({}));

    console.log(`[HitRate] Starting LOCAL DB analysis for ${sports.join(', ')}`);

    const analyzedProps: any[] = [];
    let propsChecked = 0;

    for (const sport of sports) {
      if (propsChecked >= limit) break;
      if (sport !== 'basketball_nba') continue; // Only NBA supported with local DB
      
      try {
        // Fetch events from The Odds API
        const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${THE_ODDS_API_KEY}`;
        const eventsRes = await fetch(eventsUrl);
        if (!eventsRes.ok) continue;

        const events = await eventsRes.json();
        const now = new Date();
        
        // Filter upcoming events (next 24h)
        const upcomingEvents = events
          .filter((e: any) => {
            const hours = (new Date(e.commence_time).getTime() - now.getTime()) / 3600000;
            return hours > 0 && hours <= 24;
          })
          .slice(0, 6);

        console.log(`[HitRate] ${sport}: ${upcomingEvents.length} upcoming events`);

        for (const event of upcomingEvents) {
          if (propsChecked >= limit) break;
          
          const markets = 'player_points,player_rebounds,player_assists,player_threes';
          const propsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds?apiKey=${THE_ODDS_API_KEY}&regions=us&markets=${markets}&oddsFormat=american`;
          
          try {
            const propsRes = await fetch(propsUrl);
            if (!propsRes.ok) continue;
            
            const propsData = await propsRes.json();
            const bookmaker = propsData.bookmakers?.[0];
            if (!bookmaker) continue;

            const gameDescription = `${event.away_team} @ ${event.home_team}`;
            const opponent = extractOpponent(gameDescription);

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

              const players = Object.entries(playerOutcomes).slice(0, 12);
              
              for (const [playerName, outcomes] of players) {
                if (propsChecked >= limit) break;
                
                const over = outcomes.find((o: any) => o.name === 'Over');
                const under = outcomes.find((o: any) => o.name === 'Under');
                if (!over || !under) continue;

                const line = over.point || 0;
                propsChecked++;

                // Fetch from LOCAL database instead of external API
                const last5Games = await fetchPlayerStatsFromDB(playerName, market.key, supabase, 10);
                if (last5Games.length < 3) {
                  console.log(`[HitRate] ${playerName}: Only ${last5Games.length} games in DB, skipping`);
                  continue;
                }

                // Fetch vs opponent data
                const vsOpponentGames = await fetchVsOpponentStats(playerName, opponent, market.key, supabase);

                // Calculate enhanced hit rate with opponent analysis
                const analysis = calculateEnhancedHitRate(last5Games, vsOpponentGames, line);
                
                // Determine recommended side
                let recommendedSide: string | null = null;
                let bestHitRate = 0;
                
                const overRate = analysis.overIn5 / Math.min(5, analysis.last5Results.length);
                const underRate = analysis.underIn5 / Math.min(5, analysis.last5Results.length);
                
                if (overRate >= minHitRate && overRate > underRate) {
                  recommendedSide = 'over';
                  bestHitRate = overRate;
                } else if (underRate >= minHitRate && underRate > overRate) {
                  recommendedSide = 'under';
                  bestHitRate = underRate;
                }
                
                // Apply streak filter if provided
                if (streakFilter && analysis.hitStreak !== streakFilter) {
                  continue;
                }

                if (recommendedSide) {
                  const confidenceScore = calculateConfidence(analysis, line);
                  
                  const propData = {
                    player_name: playerName,
                    sport,
                    prop_type: market.key,
                    current_line: line,
                    over_price: over.price,
                    under_price: under.price,
                    games_analyzed: last5Games.length,
                    over_hits: analysis.overIn5,
                    under_hits: analysis.underIn5,
                    hit_rate_over: Math.round(overRate * 100) / 100,
                    hit_rate_under: Math.round(underRate * 100) / 100,
                    game_logs: analysis.last5Results,
                    recommended_side: recommendedSide,
                    confidence_score: confidenceScore,
                    event_id: event.id,
                    game_description: gameDescription,
                    bookmaker: bookmaker.key,
                    commence_time: event.commence_time,
                    analyzed_at: new Date().toISOString(),
                    expires_at: event.commence_time,
                    hit_streak: analysis.hitStreak,
                    is_perfect_streak: analysis.isPerfectStreak,
                    // New enhanced fields
                    vs_opponent_games: analysis.vsOpponentGames,
                    vs_opponent_hit_rate: analysis.vsOpponentHitRate,
                    vs_opponent_avg: analysis.vsOpponentAvg,
                    projected_value: Math.round(analysis.projectedValue * 10) / 10,
                    projection_margin: Math.round(analysis.projectionMargin * 10) / 10,
                    last_5_avg: Math.round(analysis.last5Avg * 10) / 10,
                    last_5_results: analysis.last5Results,
                    opponent_name: opponent,
                  };

                  await supabase.from('player_prop_hitrates').upsert(propData, {
                    onConflict: 'player_name,sport,prop_type,current_line,event_id'
                  });

                  analyzedProps.push(propData);
                  
                  const vsInfo = analysis.vsOpponentGames > 0 
                    ? ` (vs ${opponent}: ${analysis.vsOpponentGames} games, ${Math.round((analysis.vsOpponentAvg || 0) * 10) / 10} avg)`
                    : '';
                  console.log(`✓ ${playerName} ${market.key} ${line}: ${recommendedSide.toUpperCase()} ${analysis.hitStreak} | Proj: ${analysis.projectedValue.toFixed(1)} | Conf: ${confidenceScore}%${vsInfo}`);
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
    console.log(`[HitRate] Complete: ${analyzedProps.length} props found in ${duration}ms (using LOCAL DB)`);

    // Group props by streak pattern
    const byStreak = {
      '5/5': analyzedProps.filter(p => p.hit_streak === '5/5'),
      '4/5': analyzedProps.filter(p => p.hit_streak === '4/5'),
      '3/5': analyzedProps.filter(p => p.hit_streak === '3/5'),
      '2/5': analyzedProps.filter(p => p.hit_streak === '2/5'),
    };

    return new Response(JSON.stringify({
      success: true,
      analyzed: analyzedProps.length,
      propsChecked,
      duration,
      dataSource: 'local_db',
      byStreak,
      props: analyzedProps
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in analyze-hitrate-props:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
