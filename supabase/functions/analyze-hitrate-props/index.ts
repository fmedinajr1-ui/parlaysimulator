import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Map prop types to database columns and season stats fields
const PROP_TO_COLUMN: Record<string, Record<string, string>> = {
  'basketball_nba': {
    'player_points': 'points',
    'player_rebounds': 'rebounds',
    'player_assists': 'assists',
    'player_threes': 'threes_made',
    'player_blocks': 'blocks',
    'player_steals': 'steals',
    'player_points_rebounds_assists': 'pra',
  },
  'icehockey_nhl': {
    'player_points': 'points',
    'player_assists': 'assists',
    'player_shots_on_goal': 'shots_on_goal',
    'player_blocked_shots': 'blocked_shots',
    'player_power_play_points': 'power_play_points',
  },
  'americanfootball_nfl': {
    'player_pass_yds': 'passing_yards',
    'player_rush_yds': 'rushing_yards',
    'player_receptions': 'receptions',
    'player_reception_yds': 'receiving_yards',
    'player_pass_tds': 'passing_tds',
    'player_rush_attempts': 'attempts',
    'player_pass_completions': 'completions',
    'player_interceptions': 'interceptions',
  }
};

const PROP_TO_SEASON_AVG: Record<string, string> = {
  'player_points': 'avg_points',
  'player_rebounds': 'avg_rebounds',
  'player_assists': 'avg_assists',
  'player_threes': 'avg_threes',
  'player_blocks': 'avg_blocks',
  'player_steals': 'avg_steals',
  'player_shots_on_goal': 'avg_shots_on_goal',
  'player_blocked_shots': 'avg_blocked_shots',
  'player_power_play_points': 'avg_power_play_points',
  // NFL mappings
  'player_pass_yds': 'passing_yards_avg',
  'player_rush_yds': 'rushing_yards_avg',
  'player_receptions': 'receptions_avg',
  'player_reception_yds': 'receiving_yards_avg',
  'player_pass_tds': 'passing_tds_avg',
};

const PROP_TO_SEASON_STD: Record<string, string> = {
  'player_points': 'points_std_dev',
  'player_rebounds': 'rebounds_std_dev',
  'player_assists': 'assists_std_dev',
  'player_threes': 'threes_std_dev',
  // NFL mappings
  'player_pass_yds': 'passing_yards_std',
  'player_rush_yds': 'rushing_yards_std',
  'player_receptions': 'receptions_std',
  'player_reception_yds': 'receiving_yards_std',
};

const PROP_TO_HOME_AVG: Record<string, string> = {
  'player_points': 'home_avg_points',
  'player_rebounds': 'home_avg_rebounds',
  'player_assists': 'home_avg_assists',
  'player_threes': 'home_avg_threes',
  // NFL mappings
  'player_pass_yds': 'home_passing_yards_avg',
  'player_rush_yds': 'home_rushing_yards_avg',
  'player_receptions': 'home_receptions_avg',
};

const PROP_TO_AWAY_AVG: Record<string, string> = {
  'player_points': 'away_avg_points',
  'player_rebounds': 'away_avg_rebounds',
  'player_assists': 'away_avg_assists',
  'player_threes': 'away_avg_threes',
  // NFL mappings
  'player_pass_yds': 'away_passing_yards_avg',
  'player_rush_yds': 'away_rushing_yards_avg',
  'player_receptions': 'away_receptions_avg',
};

const PROP_TO_LAST10_AVG: Record<string, string> = {
  'player_points': 'last_10_avg_points',
  'player_rebounds': 'last_10_avg_rebounds',
  'player_assists': 'last_10_avg_assists',
  'player_threes': 'last_10_avg_threes',
  // NFL mappings
  'player_pass_yds': 'last10_passing_yards_avg',
  'player_rush_yds': 'last10_rushing_yards_avg',
  'player_receptions': 'last10_receptions_avg',
};

// Sport-specific markets
const SPORT_MARKETS: Record<string, string[]> = {
  'basketball_nba': ['player_points', 'player_rebounds', 'player_assists', 'player_threes'],
  'icehockey_nhl': ['player_points', 'player_assists', 'player_shots_on_goal', 'player_blocked_shots', 'player_power_play_points'],
  'americanfootball_nfl': ['player_pass_yds', 'player_rush_yds', 'player_receptions', 'player_reception_yds', 'player_pass_tds'],
};

// Sport-specific game logs tables
const SPORT_GAME_LOGS_TABLE: Record<string, string> = {
  'basketball_nba': 'nba_player_game_logs',
  'icehockey_nhl': 'nhl_player_game_logs',
  'americanfootball_nfl': 'nfl_player_game_logs',
};

// Sport-specific season stats tables
const SPORT_SEASON_STATS_TABLE: Record<string, string> = {
  'basketball_nba': 'player_season_stats',
  'icehockey_nhl': 'player_season_stats',
  'americanfootball_nfl': 'nfl_player_season_stats',
};

function normalizeTeamName(name: string): string {
  return name.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

function extractOpponent(gameDescription: string): string {
  const parts = gameDescription.split(/\s+(@|vs\.?)\s+/i);
  if (parts.length >= 3) return normalizeTeamName(parts[2]);
  return normalizeTeamName(gameDescription);
}

async function fetchSeasonStats(playerName: string, sport: string, supabase: any): Promise<any | null> {
  const lastName = playerName.split(' ').slice(-1)[0];
  const tableName = SPORT_SEASON_STATS_TABLE[sport] || 'player_season_stats';
  
  if (sport === 'americanfootball_nfl') {
    // NFL uses a different table structure
    const { data } = await supabase
      .from(tableName)
      .select('*')
      .ilike('player_name', `%${lastName}%`)
      .order('games_played', { ascending: false })
      .limit(1);
    return data?.[0] || null;
  }
  
  const { data } = await supabase
    .from(tableName)
    .select('*')
    .ilike('player_name', `%${lastName}%`)
    .eq('sport', sport)
    .order('games_played', { ascending: false })
    .limit(1);
  return data?.[0] || null;
}

async function fetchOpponentDefenseRank(opponentName: string, supabase: any): Promise<number | null> {
  const oppLastWord = opponentName.split(' ').pop() || opponentName;
  const { data } = await supabase
    .from('nba_opponent_defense_stats')
    .select('defense_rank')
    .ilike('team_name', `%${oppLastWord}%`)
    .limit(1);
  return data?.[0]?.defense_rank || null;
}

function calculateLineValue(line: number, seasonAvg: number, stdDev: number, isHomeGame: boolean, homeAvg: number, awayAvg: number, side: 'over' | 'under') {
  const relevantAvg = isHomeGame && homeAvg > 0 ? homeAvg : awayAvg > 0 ? awayAvg : seasonAvg;
  const lineVsSeasonPct = seasonAvg > 0 ? ((line - seasonAvg) / seasonAvg) * 100 : 0;
  let score = 50, label = 'neutral';
  if (side === 'over') {
    if (lineVsSeasonPct <= -10) { score = 90; label = 'excellent'; }
    else if (lineVsSeasonPct <= -5) { score = 75; label = 'good'; }
    else if (lineVsSeasonPct > 5) { score = 25; label = 'poor'; }
  } else {
    if (lineVsSeasonPct >= 10) { score = 90; label = 'excellent'; }
    else if (lineVsSeasonPct >= 5) { score = 75; label = 'good'; }
    else if (lineVsSeasonPct < -5) { score = 25; label = 'poor'; }
  }
  return { score, label, pct: Math.round(lineVsSeasonPct * 10) / 10 };
}

async function fetchPlayerStatsFromDB(playerName: string, propType: string, sport: string, supabase: any, limit = 10): Promise<any[]> {
  const sportColumns = PROP_TO_COLUMN[sport] || PROP_TO_COLUMN['basketball_nba'];
  const column = sportColumns[propType];
  if (!column) {
    console.log(`[HitRate] No column mapping for propType: ${propType}`);
    return [];
  }
  const tableName = SPORT_GAME_LOGS_TABLE[sport] || 'nba_player_game_logs';
  const selectColumns = propType === 'player_points_rebounds_assists'
    ? 'game_date, opponent, points, rebounds, assists, minutes_played'
    : `game_date, opponent, ${column}, minutes_played`;
  
  // Try exact match first, then fall back to last name match
  let gameLogs = null;
  
  // Exact match (most accurate)
  const { data: exactMatch } = await supabase
    .from(tableName)
    .select(selectColumns)
    .ilike('player_name', playerName)
    .order('game_date', { ascending: false })
    .limit(limit);
  
  if (exactMatch && exactMatch.length > 0) {
    gameLogs = exactMatch;
    console.log(`[HitRate] Exact match found for ${playerName}: ${gameLogs.length} games`);
  } else {
    // Fall back to last name search but with first name initial check
    const nameParts = playerName.split(' ');
    const lastName = nameParts.slice(-1)[0];
    const firstInitial = nameParts[0]?.[0];
    
    const { data: lastNameMatch } = await supabase
      .from(tableName)
      .select(selectColumns + ', player_name')
      .ilike('player_name', `%${lastName}`)
      .order('game_date', { ascending: false })
      .limit(limit * 3); // Get more to filter
    
    if (lastNameMatch && lastNameMatch.length > 0) {
      // Filter to players whose first name starts with the same letter
      const filtered = lastNameMatch.filter((g: any) => {
        const dbFirstInitial = g.player_name?.split(' ')[0]?.[0]?.toUpperCase();
        return dbFirstInitial === firstInitial?.toUpperCase();
      });
      gameLogs = filtered.length > 0 ? filtered.slice(0, limit) : lastNameMatch.slice(0, limit);
      console.log(`[HitRate] Last name match for ${playerName} (${lastName}): ${gameLogs.length} games`);
    }
  }
  
  if (!gameLogs || gameLogs.length === 0) {
    console.log(`[HitRate] No games found for ${playerName}`);
    return [];
  }
  
  return gameLogs.map((g: any) => ({
    date: g.game_date,
    opponent: g.opponent,
    stat_value: propType === 'player_points_rebounds_assists' ? (g.points || 0) + (g.rebounds || 0) + (g.assists || 0) : g[column] || 0,
    minutes: g.minutes_played || 0
  }));
}

async function fetchVsOpponentStats(playerName: string, opponent: string, propType: string, sport: string, supabase: any): Promise<any[]> {
  const sportColumns = PROP_TO_COLUMN[sport] || PROP_TO_COLUMN['basketball_nba'];
  const column = sportColumns[propType];
  if (!column) return [];
  const tableName = SPORT_GAME_LOGS_TABLE[sport] || 'nba_player_game_logs';
  const { data: vsGames } = await supabase
    .from(tableName)
    .select('*')
    .ilike('player_name', `%${playerName.split(' ').slice(-1)[0]}%`)
    .ilike('opponent', `%${opponent.split(' ').pop()}%`)
    .order('game_date', { ascending: false })
    .limit(5);
  if (!vsGames) return [];
  return vsGames.map((g: any) => ({
    date: g.game_date, opponent: g.opponent,
    stat_value: propType === 'player_points_rebounds_assists' ? (g.points||0)+(g.rebounds||0)+(g.assists||0) : g[column]||0
  }));
}

function calculateEnhancedHitRate(last5Games: any[], vsOpponentGames: any[], line: number) {
  const last5Results = last5Games.slice(0, 5).map(g => ({ date: g.date, value: g.stat_value, opponent: g.opponent, hit: g.stat_value > line, margin: g.stat_value - line }));
  const last5HitRate = last5Results.length > 0 ? last5Results.filter(r => r.hit).length / last5Results.length : 0;
  const last5Avg = last5Results.length > 0 ? last5Results.reduce((s, r) => s + r.value, 0) / last5Results.length : 0;
  const overIn5 = last5Results.filter(r => r.hit).length;
  const underIn5 = last5Results.filter(r => !r.hit).length;
  let vsOpponentHitRate: number | null = null, vsOpponentAvg: number | null = null;
  if (vsOpponentGames.length > 0) {
    vsOpponentHitRate = vsOpponentGames.filter(g => g.stat_value > line).length / vsOpponentGames.length;
    vsOpponentAvg = vsOpponentGames.reduce((s, g) => s + g.stat_value, 0) / vsOpponentGames.length;
  }
  let projectedHitRate = last5HitRate;
  let projectedValue = last5Avg;
  if (vsOpponentHitRate !== null && vsOpponentGames.length >= 2) {
    projectedHitRate = (last5HitRate * 0.6) + (vsOpponentHitRate * 0.4);
    projectedValue = (last5Avg * 0.6) + ((vsOpponentAvg || 0) * 0.4);
  }
  let hitStreak = '', isPerfectStreak = false;
  if (last5Results.length >= 5) {
    if (overIn5 === 5 || underIn5 === 5) { hitStreak = '5/5'; isPerfectStreak = true; }
    else hitStreak = `${Math.max(overIn5, underIn5)}/5`;
  } else if (last5Results.length >= 3) {
    hitStreak = `${Math.max(overIn5, underIn5)}/${last5Results.length}`;
    isPerfectStreak = overIn5 === last5Results.length || underIn5 === last5Results.length;
  }
  return { last5Results, last5HitRate, last5Avg, overIn5, underIn5, vsOpponentGames: vsOpponentGames.length, vsOpponentHitRate, vsOpponentAvg, projectedHitRate, projectedValue, projectionMargin: projectedValue - line, hitStreak, isPerfectStreak };
}

function calculateConfidence(analysis: any, line: number): number {
  let confidence = analysis.projectedHitRate * 100;
  if (analysis.isPerfectStreak) confidence += 15;
  else if (analysis.hitStreak === '4/5') confidence += 10;
  else if (analysis.hitStreak === '3/5') confidence += 5;
  if (Math.abs(analysis.projectionMargin) > 3) confidence += 10;
  else if (Math.abs(analysis.projectionMargin) > 1.5) confidence += 5;
  if (analysis.vsOpponentHitRate !== null && analysis.vsOpponentGames >= 2 && analysis.vsOpponentHitRate > 0.7) confidence += 10;
  if (analysis.last5Results.length < 5) confidence *= 0.85;
  return Math.min(Math.round(confidence), 100);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const startTime = Date.now();
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const THE_ODDS_API_KEY = Deno.env.get('THE_ODDS_API_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { sports = ['basketball_nba', 'icehockey_nhl', 'americanfootball_nfl'], limit = 200, minHitRate = 0.4, streakFilter = null } = await req.json().catch(() => ({}));
    console.log(`[HitRate] Starting analysis for sports: ${sports.join(', ')}...`);
    const analyzedProps: any[] = [];
    let propsChecked = 0;
    for (const sport of sports) {
      if (propsChecked >= limit) continue;
      // Skip unsupported sports
      if (!SPORT_MARKETS[sport]) {
        console.log(`[HitRate] Skipping unsupported sport: ${sport}`);
        continue;
      }
      const eventsRes = await fetch(`https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${THE_ODDS_API_KEY}`);
      if (!eventsRes.ok) {
        console.log(`[HitRate] Failed to fetch events for ${sport}: ${eventsRes.status}`);
        continue;
      }
      const events = await eventsRes.json();
      console.log(`[HitRate] Found ${events.length} events for ${sport}`);
      // Get ALL games within next 24 hours (no limit)
      const upcomingEvents = events.filter((e: any) => { const h = (new Date(e.commence_time).getTime() - Date.now()) / 3600000; return h > 0 && h <= 24; });
      console.log(`[HitRate] ${upcomingEvents.length} events in the next 24 hours for ${sport}`);
      let eventsWithNoBookmakers = 0;
      let eventsWithNoMarkets = 0;
      let playersNotFound = 0;
      let playersInsufficientGames = 0;
      
      for (const event of upcomingEvents) {
        if (propsChecked >= limit) break;
        const markets = SPORT_MARKETS[sport].join(',');
        console.log(`[HitRate] Fetching props for: ${event.home_team} vs ${event.away_team} (${event.id})`);
        
        const propsRes = await fetch(`https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds?apiKey=${THE_ODDS_API_KEY}&regions=us&markets=${markets}&oddsFormat=american`);
        
        if (!propsRes.ok) {
          console.log(`[HitRate] Props API failed: ${propsRes.status} ${propsRes.statusText}`);
          continue;
        }
        
        const propsData = await propsRes.json();
        console.log(`[HitRate] Bookmakers returned: ${propsData.bookmakers?.length || 0}`);
        
        const bookmaker = propsData.bookmakers?.[0];
        if (!bookmaker) {
          eventsWithNoBookmakers++;
          console.log(`[HitRate] No bookmaker has props for this event`);
          continue;
        }
        
        console.log(`[HitRate] Using bookmaker: ${bookmaker.key}, markets: ${bookmaker.markets?.length || 0}`);
        
        if (!bookmaker.markets || bookmaker.markets.length === 0) {
          eventsWithNoMarkets++;
          console.log(`[HitRate] Bookmaker has no markets`);
          continue;
        }
        
        const gameDescription = `${event.away_team} @ ${event.home_team}`;
        const opponent = extractOpponent(gameDescription);
        
        for (const market of bookmaker.markets) {
          if (propsChecked >= limit) break;
          const playerOutcomes: Record<string, any[]> = {};
          for (const outcome of market.outcomes || []) { 
            if (outcome.description) { 
              if (!playerOutcomes[outcome.description]) playerOutcomes[outcome.description] = []; 
              playerOutcomes[outcome.description].push(outcome); 
            } 
          }
          
          console.log(`[HitRate] Market ${market.key}: ${Object.keys(playerOutcomes).length} players`);
          
          for (const [playerName, outcomes] of Object.entries(playerOutcomes).slice(0, 20)) {
            if (propsChecked >= limit) break;
            const over = (outcomes as any[]).find((o: any) => o.name === 'Over');
            const under = (outcomes as any[]).find((o: any) => o.name === 'Under');
            if (!over || !under) continue;
            const line = over.point || 0;
            propsChecked++;
            const last5Games = await fetchPlayerStatsFromDB(playerName, market.key, sport, supabase, 10);
            // NHL needs less history since season is shorter - allow 2 games minimum
            const minGamesRequired = sport === 'icehockey_nhl' ? 2 : 3;
            if (last5Games.length < minGamesRequired) {
              if (last5Games.length === 0) playersNotFound++;
              else playersInsufficientGames++;
              continue;
            }
            const vsOpponentGames = await fetchVsOpponentStats(playerName, opponent, market.key, sport, supabase);
            const analysis = calculateEnhancedHitRate(last5Games, vsOpponentGames, line);
            const overRate = analysis.overIn5 / Math.min(5, analysis.last5Results.length);
            const underRate = analysis.underIn5 / Math.min(5, analysis.last5Results.length);
            let recommendedSide: string | null = null;
            if (overRate >= minHitRate && overRate > underRate) recommendedSide = 'over';
            else if (underRate >= minHitRate && underRate > overRate) recommendedSide = 'under';
            if (streakFilter && analysis.hitStreak !== streakFilter) continue;
            if (recommendedSide) {
              const seasonStats = await fetchSeasonStats(playerName, sport, supabase);
              const opponentDefenseRank = sport === 'basketball_nba' ? await fetchOpponentDefenseRank(opponent, supabase) : null;
              let seasonAvg: number | null = null, lineValue = { score: 50, label: 'neutral', pct: 0 }, consistencyScore = 50, seasonTrendPct = 0, trendDirection = 'stable', homeAwayAdjustment = 0;
              if (seasonStats) {
                seasonAvg = seasonStats[PROP_TO_SEASON_AVG[market.key]] || null;
                const stdDev = seasonStats[PROP_TO_SEASON_STD[market.key]] || 0;
                const homeAvg = seasonStats[PROP_TO_HOME_AVG[market.key]] || 0;
                const awayAvg = seasonStats[PROP_TO_AWAY_AVG[market.key]] || 0;
                const last10Avg = seasonStats[PROP_TO_LAST10_AVG[market.key]] || 0;
                const isHomeGame = !gameDescription.split('@')[0].toLowerCase().includes(playerName.split(' ').slice(-1)[0].toLowerCase());
                if (seasonAvg && seasonAvg > 0) {
                  lineValue = calculateLineValue(line, seasonAvg, stdDev, isHomeGame, homeAvg, awayAvg, recommendedSide as 'over' | 'under');
                  homeAwayAdjustment = isHomeGame ? homeAvg - seasonAvg : awayAvg - seasonAvg;
                  if (last10Avg > 0) { seasonTrendPct = ((last10Avg - seasonAvg) / seasonAvg) * 100; if (seasonTrendPct > 10) trendDirection = 'hot'; else if (seasonTrendPct < -10) trendDirection = 'cold'; }
                }
                consistencyScore = seasonStats.consistency_score || 50;
              }
              let adjustedConfidence = calculateConfidence(analysis, line);
              if (lineValue.score >= 75) adjustedConfidence += 5;
              if (lineValue.score <= 30) adjustedConfidence -= 5;
              if (consistencyScore >= 70) adjustedConfidence += 5;
              adjustedConfidence = Math.min(100, Math.max(0, adjustedConfidence));
              const propData = {
                player_name: playerName, sport, prop_type: market.key, current_line: line, over_price: over.price, under_price: under.price,
                games_analyzed: last5Games.length, over_hits: analysis.overIn5, under_hits: analysis.underIn5,
                hit_rate_over: Math.round(overRate * 100) / 100, hit_rate_under: Math.round(underRate * 100) / 100,
                game_logs: analysis.last5Results, recommended_side: recommendedSide, confidence_score: adjustedConfidence,
                event_id: event.id, game_description: gameDescription, bookmaker: bookmaker.key,
                commence_time: event.commence_time, analyzed_at: new Date().toISOString(), expires_at: event.commence_time,
                hit_streak: analysis.hitStreak, is_perfect_streak: analysis.isPerfectStreak,
                vs_opponent_games: analysis.vsOpponentGames, vs_opponent_hit_rate: analysis.vsOpponentHitRate,
                vs_opponent_avg: analysis.vsOpponentAvg, projected_value: Math.round(analysis.projectedValue * 10) / 10,
                projection_margin: Math.round(analysis.projectionMargin * 10) / 10, last_5_avg: Math.round(analysis.last5Avg * 10) / 10,
                last_5_results: analysis.last5Results, opponent_name: opponent,
                season_avg: seasonAvg, season_games_played: seasonStats?.games_played || 0, line_vs_season_pct: lineValue.pct,
                line_value_score: lineValue.score, line_value_label: lineValue.label, home_away_adjustment: Math.round(homeAwayAdjustment * 10) / 10,
                opponent_defense_rank: opponentDefenseRank, consistency_score: consistencyScore, trend_direction: trendDirection, season_trend_pct: Math.round(seasonTrendPct * 10) / 10,
              };
              await supabase.from('player_prop_hitrates').upsert(propData, { onConflict: 'player_name,sport,prop_type,current_line,event_id' });
              analyzedProps.push(propData);
              console.log(`✓ ${playerName} ${market.key} ${line}: ${recommendedSide.toUpperCase()} ${analysis.hitStreak} | Value: ${lineValue.label}`);
            }
          }
        }
      }
    }
    const duration = Date.now() - startTime;
    
    // Summary logging
    console.log(`[HitRate] ========== SCAN COMPLETE ==========`);
    console.log(`[HitRate] Props checked: ${propsChecked}`);
    console.log(`[HitRate] Props that passed filters: ${analyzedProps.length}`);
    console.log(`[HitRate] Duration: ${duration}ms`);
    
    const byStreak = { '5/5': analyzedProps.filter(p => p.hit_streak === '5/5'), '4/5': analyzedProps.filter(p => p.hit_streak === '4/5'), '3/5': analyzedProps.filter(p => p.hit_streak === '3/5'), '2/5': analyzedProps.filter(p => p.hit_streak === '2/5') };
    
    // Return with reason if no props
    const noPropsReason = propsChecked === 0 
      ? 'No player props available from bookmakers - they may not have posted props for upcoming games yet' 
      : analyzedProps.length === 0 
        ? 'Props were checked but none met the hit rate threshold' 
        : null;
    
    return new Response(JSON.stringify({ 
      success: true, 
      analyzed: analyzedProps.length, 
      propsChecked, 
      duration, 
      byStreak, 
      props: analyzedProps,
      noPropsReason
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
