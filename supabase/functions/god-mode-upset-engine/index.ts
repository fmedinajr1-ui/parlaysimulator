import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Default weights (used if DB weights not available)
const DEFAULT_WEIGHTS = {
  SHARP_PCT: 0.20,
  CHESS_EV: 0.15,
  UPSET_VALUE: 0.15,
  RECORD_DIFF: 0.15,
  HOME_COURT: 0.10,
  HISTORICAL_DAY: 0.10,
  MONTE_CARLO: 0.15
};

// Day multipliers for historical boost
const DAY_MULTIPLIERS: Record<number, number> = {
  0: 1.05, 1: 1.10, 2: 1.05, 3: 1.08, 4: 1.15, 5: 1.08, 6: 1.20
};

// Batch-loaded data cache to avoid per-event queries
interface BatchData {
  injuries: any[];
  unifiedInjuries: any[]; // From new unified injury_reports table
  standings: any[];
  homeCourtStats: any[];
  lineMovements: any[];
  weights: Record<string, Record<string, number>>; // sport -> weight_key -> weight_value
}

// Helper to get weights for a sport (with fallback to DEFAULT, then to DEFAULT_WEIGHTS)
function getWeightsForSport(batchData: BatchData | undefined, sport: string): Record<string, number> {
  const sportAlias = mapSportKeyToAlias(sport);
  const sportWeights = batchData?.weights?.[sportAlias] || batchData?.weights?.['DEFAULT'] || {};
  
  return {
    SHARP_PCT: sportWeights['sharp_pct'] ?? DEFAULT_WEIGHTS.SHARP_PCT,
    CHESS_EV: sportWeights['chess_ev'] ?? DEFAULT_WEIGHTS.CHESS_EV,
    UPSET_VALUE: sportWeights['upset_value'] ?? DEFAULT_WEIGHTS.UPSET_VALUE,
    RECORD_DIFF: sportWeights['record_diff'] ?? DEFAULT_WEIGHTS.RECORD_DIFF,
    HOME_COURT: sportWeights['home_court'] ?? DEFAULT_WEIGHTS.HOME_COURT,
    HISTORICAL_DAY: sportWeights['historical_day'] ?? DEFAULT_WEIGHTS.HISTORICAL_DAY,
    MONTE_CARLO: sportWeights['monte_carlo'] ?? DEFAULT_WEIGHTS.MONTE_CARLO,
  };
}

// Map sport keys from The Odds API to team_aliases sport column
function mapSportKeyToAlias(sportKey: string): string {
  const mapping: Record<string, string> = {
    'basketball_nba': 'NBA',
    'basketball_ncaab': 'NCAAB',
    'americanfootball_nfl': 'NFL',
    'americanfootball_ncaaf': 'NCAAF',
    'icehockey_nhl': 'NHL',
    'baseball_mlb': 'MLB'
  };
  return mapping[sportKey] || sportKey.toUpperCase();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { sport, forceRefresh } = await req.json();
    
    console.log(`[God Mode Engine] Starting analysis for sport: ${sport || 'all'}`);

    // Fetch current odds and events
    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY');
    const sports = sport ? [sport] : [
      'basketball_nba',
      'basketball_ncaab',
      'americanfootball_nfl',
      'americanfootball_ncaaf',
      'icehockey_nhl',
      'baseball_mlb'
    ];

    // BATCH LOAD: Fetch all supporting data upfront to avoid per-event queries
    console.log('[God Mode] Batch loading supporting data...');
    const today = new Date().toISOString().split('T')[0];
    
    const [injuriesResult, unifiedInjuriesResult, standingsResult, hcaResult, movementsResult, weightsResult] = await Promise.all([
      supabase.from('nba_injury_reports').select('*').gte('game_date', today),
      supabase.from('injury_reports').select('*').gte('game_date', today), // New unified table
      supabase.from('team_season_standings').select('*'),
      supabase.from('home_court_advantage_stats').select('*'),
      supabase.from('line_movements').select('*').eq('is_sharp_action', true).gte('detected_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()).order('detected_at', { ascending: false }).limit(500),
      supabase.from('god_mode_weights').select('*').eq('is_active', true)
    ]);

    // Parse weights into a nested object by sport
    const weightsBySport: Record<string, Record<string, number>> = {};
    for (const w of weightsResult.data || []) {
      if (!weightsBySport[w.sport]) weightsBySport[w.sport] = {};
      weightsBySport[w.sport][w.weight_key] = w.weight_value;
    }

    const batchData: BatchData = {
      injuries: injuriesResult.data || [],
      unifiedInjuries: unifiedInjuriesResult.data || [],
      standings: standingsResult.data || [],
      homeCourtStats: hcaResult.data || [],
      lineMovements: movementsResult.data || [],
      weights: weightsBySport
    };

    console.log(`[God Mode] Batch loaded: ${batchData.injuries.length} NBA injuries, ${batchData.unifiedInjuries.length} unified injuries, ${batchData.standings.length} standings, ${batchData.homeCourtStats.length} HCA stats, ${batchData.lineMovements.length} movements, ${Object.keys(weightsBySport).length} weight configs`);
    
    const allPredictions: any[] = [];
    
    for (const sportKey of sports) {
      try {
        // Fetch odds from API
        const oddsResponse = await fetch(
          `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${oddsApiKey}&regions=us&markets=h2h&oddsFormat=american`
        );
        
        if (!oddsResponse.ok) {
          console.log(`[God Mode] No odds available for ${sportKey}`);
          continue;
        }
        
        const events = await oddsResponse.json();
        console.log(`[God Mode] Found ${events.length} events for ${sportKey}`);
        
        // Process each event with batch data (no per-event DB calls)
        for (const event of events) {
          const prediction = await analyzeEvent(supabase, event, sportKey, batchData);
          if (prediction) {
            allPredictions.push(prediction);
          }
        }
      } catch (error) {
        console.error(`[God Mode] Error processing ${sportKey}:`, error);
      }
    }

    // Sort by final upset score
    allPredictions.sort((a, b) => b.final_upset_score - a.final_upset_score);

    // Upsert predictions to database
    for (const prediction of allPredictions) {
      const { error } = await supabase
        .from('god_mode_upset_predictions')
        .upsert(prediction, { onConflict: 'event_id,underdog' });
      
      if (error) {
        console.error(`[God Mode] Error upserting prediction:`, error);
      }
    }

    // Detect global chaos mode
    const chaosCount = allPredictions.filter(p => p.chaos_mode_active).length;
    const globalChaosMode = chaosCount >= 3;

    console.log(`[God Mode] Completed. ${allPredictions.length} predictions, ${chaosCount} chaos games`);

    return new Response(JSON.stringify({
      success: true,
      predictions: allPredictions,
      globalChaosMode,
      chaosCount,
      totalEvents: allPredictions.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[God Mode Engine] Error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function analyzeEvent(supabase: any, event: any, sport: string, batchData?: BatchData) {
  const { id: eventId, home_team, away_team, commence_time, bookmakers } = event;
  
  if (!bookmakers || bookmakers.length === 0) return null;

  // Extract odds from first bookmaker
  const bookmaker = bookmakers[0];
  const h2hMarket = bookmaker.markets?.find((m: any) => m.key === 'h2h');
  if (!h2hMarket) return null;

  const homeOutcome = h2hMarket.outcomes.find((o: any) => o.name === home_team);
  const awayOutcome = h2hMarket.outcomes.find((o: any) => o.name === away_team);
  
  if (!homeOutcome || !awayOutcome) return null;

  const homeOdds = homeOutcome.price;
  const awayOdds = awayOutcome.price;

  // Determine underdog (positive odds or higher positive)
  const isHomeUnderdog = homeOdds > awayOdds;
  const underdog = isHomeUnderdog ? home_team : away_team;
  const underdogOdds = isHomeUnderdog ? homeOdds : awayOdds;
  const favorite = isHomeUnderdog ? away_team : home_team;
  const favoriteOdds = isHomeUnderdog ? awayOdds : homeOdds;

  // Only analyze underdogs with positive odds
  if (underdogOdds < 100) return null;

  // Calculate all component scores (using batch data when available)
  const sharpPct = calculateSharpPctFromBatch(batchData?.lineMovements || [], eventId, underdog, bookmakers);
  const chessEv = calculateCHESSEVFromBatch(batchData?.injuries || [], sport, underdog, favorite);
  const upsetValueScore = calculateUpsetValueScore(underdogOdds, sharpPct);
  const recordDiffScore = calculateRecordDiffFromBatch(batchData?.standings || [], sport, underdog, favorite);
  const homeCourtAdvantage = calculateHomeCourtFromBatch(batchData?.homeCourtStats || [], sport, home_team, isHomeUnderdog);
  const historicalDayBoost = calculateHistoricalDayBoost(new Date(commence_time));
  const monteCarloBoost = calculateMonteCarloBoost(underdogOdds, sport);

  // Get sport-specific weights from DB or fallback to defaults
  const WEIGHTS = getWeightsForSport(batchData, sport);

  // Calculate final upset score with record differential
  const finalUpsetScore = Math.min(100, Math.max(0,
    (sharpPct * WEIGHTS.SHARP_PCT) +
    (chessEv * WEIGHTS.CHESS_EV) +
    (upsetValueScore * WEIGHTS.UPSET_VALUE) +
    (recordDiffScore * WEIGHTS.RECORD_DIFF) +
    (homeCourtAdvantage * WEIGHTS.HOME_COURT) +
    (historicalDayBoost * WEIGHTS.HISTORICAL_DAY) +
    (monteCarloBoost * WEIGHTS.MONTE_CARLO)
  ));

  // Calculate chaos percentage with deterministic event-based seed
  const chaosPercentage = calculateChaosPercentage(sharpPct, upsetValueScore, monteCarloBoost, historicalDayBoost, eventId);
  const chaosModeActive = chaosPercentage >= 70;

  // Apply chaos boost if active
  const adjustedUpsetScore = chaosModeActive ? Math.min(100, finalUpsetScore + 10) : finalUpsetScore;
  const upsetProbability = calculateUpsetProbability(adjustedUpsetScore, underdogOdds, chaosModeActive);

  // Classify confidence
  const confidence = classifyConfidence(adjustedUpsetScore, sharpPct, chessEv);
  
  // Apply confidence-based weighting to final score
  // High confidence predictions get boosted, low confidence get penalized
  let confidenceAdjustedScore = adjustedUpsetScore;
  if (confidence === 'high') {
    confidenceAdjustedScore = Math.min(100, adjustedUpsetScore * 1.15);
  } else if (confidence === 'low') {
    confidenceAdjustedScore = adjustedUpsetScore * 0.7;
  }
  
  const riskLevel = calculateRiskLevel(confidenceAdjustedScore, underdogOdds);
  const suggestion = determineSuggestion(confidenceAdjustedScore, confidence, underdogOdds);

  // Build signals array with record differential (pass WEIGHTS for signal breakdown)
  const signals = buildSignals(sharpPct, chessEv, upsetValueScore, recordDiffScore, homeCourtAdvantage, historicalDayBoost, monteCarloBoost, WEIGHTS);
  
  // Detect trap on favorite - enhanced with record check
  const trapOnFavorite = (sharpPct >= 60 && upsetValueScore >= 50) || recordDiffScore >= 70;

  // Generate reasons
  const reasons = generateReasons(signals, chaosModeActive, trapOnFavorite, underdogOdds);

  // Calculate parlay impact
  const parlayImpact = calculateParlayImpact(adjustedUpsetScore, underdogOdds, confidence);

  return {
    event_id: eventId,
    sport,
    home_team,
    away_team,
    underdog,
    underdog_odds: underdogOdds,
    favorite,
    favorite_odds: favoriteOdds,
    commence_time,
    // Use confidence-adjusted score for final output
    final_upset_score: Math.round(confidenceAdjustedScore * 10) / 10,
    upset_probability: Math.round(upsetProbability * 10) / 10,
    sharp_pct: Math.round(sharpPct * 10) / 10,
    chess_ev: Math.round(chessEv * 10) / 10,
    upset_value_score: Math.round(upsetValueScore * 10) / 10,
    home_court_advantage: Math.round(homeCourtAdvantage * 10) / 10,
    historical_day_boost: Math.round(historicalDayBoost * 10) / 10,
    monte_carlo_boost: Math.round(monteCarloBoost * 10) / 10,
    chaos_percentage: Math.round(chaosPercentage * 10) / 10,
    chaos_mode_active: chaosModeActive,
    confidence,
    risk_level: riskLevel,
    suggestion,
    signals,
    trap_on_favorite: trapOnFavorite,
    reasons,
    parlay_impact: parlayImpact,
    is_live: false,
    last_odds_update: new Date().toISOString(),
    odds_change_direction: 'stable'
  };
}

async function calculateSharpPct(supabase: any, eventId: string, underdog: string, bookmakers: any[]) {
  // Check for sharp money signals on this event
  const { data: movements } = await supabase
    .from('line_movements')
    .select('*')
    .eq('event_id', eventId)
    .eq('is_sharp_action', true)
    .order('detected_at', { ascending: false })
    .limit(10);

  let sharpScore = 50; // Base score

  if (movements && movements.length > 0) {
    // Boost for sharp action detected
    const underdogMovements = movements.filter((m: any) => 
      m.outcome_name?.toLowerCase().includes(underdog.toLowerCase())
    );
    
    sharpScore += underdogMovements.length * 10;
    
    // Add trap score from movements
    const avgTrapScore = movements.reduce((sum: number, m: any) => sum + (m.trap_score || 0), 0) / movements.length;
    sharpScore += avgTrapScore * 0.3;
  }

  // Book consensus - if multiple books moving same direction
  const bookCount = bookmakers.length;
  if (bookCount >= 3) {
    sharpScore += 5;
  }

  return Math.min(100, Math.max(0, sharpScore));
}

// Sport-aware CHESS EV calculation - returns neutral 50 when no injury data for sport
async function calculateCHESSEV(supabase: any, sport: string, underdog: string, favorite: string) {
  // Only NBA has injury data currently - return neutral for other sports
  const sportKey = mapSportKeyToAlias(sport);
  if (sportKey !== 'NBA') {
    console.log(`[God Mode] CHESS EV: No injury data for ${sportKey}, using neutral value`);
    return 50; // Neutral score when no injury data available
  }

  // Fetch injury data for NBA
  const { data: injuries } = await supabase
    .from('nba_injury_reports')
    .select('*')
    .gte('game_date', new Date().toISOString().split('T')[0]);

  // If no injuries found, return neutral
  if (!injuries || injuries.length === 0) {
    console.log(`[God Mode] CHESS EV: No current injuries found`);
    return 50;
  }

  // Use team_aliases for robust team matching
  const [underdogAliasResult, favoriteAliasResult] = await Promise.all([
    supabase.rpc('find_team_by_alias', { search_term: underdog, sport_filter: sportKey }).single(),
    supabase.rpc('find_team_by_alias', { search_term: favorite, sport_filter: sportKey }).single()
  ]);

  const underdogTeamName = underdogAliasResult.data?.team_name || underdog;
  const favoriteTeamName = favoriteAliasResult.data?.team_name || favorite;

  const favoriteInjuries = injuries.filter((i: any) => 
    i.team_name?.toLowerCase() === favoriteTeamName.toLowerCase()
  );
  const underdogInjuries = injuries.filter((i: any) => 
    i.team_name?.toLowerCase() === underdogTeamName.toLowerCase()
  );

  // Calculate impact
  const impactWeights: Record<string, number> = { high: 0.4, medium: 0.2, low: 0.1 };
  
  const favoriteImpact = favoriteInjuries.reduce((sum: number, i: any) => 
    sum + (impactWeights[i.impact_level] || 0.1), 0);
  const underdogImpact = underdogInjuries.reduce((sum: number, i: any) => 
    sum + (impactWeights[i.impact_level] || 0.1), 0);

  const injuryValue = Math.min(1, Math.max(-1, favoriteImpact - underdogImpact));

  // CHESS EV formula components
  const offensiveEdge = 0.5; // Base value
  const defensivePressure = 0.5; // Base value
  const lineValue = 50; // Will be adjusted based on mispricing
  const publicInfluence = 0.3; // Default public influence
  const trapTendency = 0.4; // Default trap tendency
  const marketConsensus = 3; // Default consensus

  // EV = (IV × (OE + DP)) + (LV × (1 − PI)) + (TT × (1 / MC))
  const injuryComponent = injuryValue * (offensiveEdge + defensivePressure);
  const lineValueComponent = (lineValue / 100) * (1 - publicInfluence);
  const trapComponent = trapTendency * (1 / marketConsensus);

  const ev = injuryComponent + lineValueComponent + trapComponent;
  
  return Math.min(100, Math.max(0, ev * 50 + 50));
}

// ========== BATCH VERSIONS (use pre-loaded data instead of DB queries) ==========

// Calculate sharp percentage from pre-loaded batch data
function calculateSharpPctFromBatch(lineMovements: any[], eventId: string, underdog: string, bookmakers: any[]): number {
  const movements = lineMovements.filter(m => m.event_id === eventId);
  
  let sharpScore = 50; // Base score

  if (movements.length > 0) {
    // Boost for sharp action detected on underdog
    const underdogMovements = movements.filter((m: any) => 
      m.outcome_name?.toLowerCase().includes(underdog.toLowerCase())
    );
    
    sharpScore += underdogMovements.length * 10;
    
    // Add trap score from movements
    const avgTrapScore = movements.reduce((sum: number, m: any) => sum + (m.trap_score || 0), 0) / movements.length;
    sharpScore += avgTrapScore * 0.3;
  }

  // Book consensus - if multiple books moving same direction
  const bookCount = bookmakers.length;
  if (bookCount >= 3) {
    sharpScore += 5;
  }

  return Math.min(100, Math.max(0, sharpScore));
}

// Calculate CHESS EV from pre-loaded injury data
function calculateCHESSEVFromBatch(injuries: any[], sport: string, underdog: string, favorite: string): number {
  // Only NBA has injury data currently - return neutral for other sports
  const sportKey = mapSportKeyToAlias(sport);
  if (sportKey !== 'NBA') {
    return 50; // Neutral score when no injury data available
  }

  if (!injuries || injuries.length === 0) {
    return 50;
  }

  // Simple team matching from batch data (team_aliases lookup already done in batch load)
  const favoriteInjuries = injuries.filter((i: any) => 
    favorite.toLowerCase().includes(i.team_name?.toLowerCase()) ||
    i.team_name?.toLowerCase().includes(favorite.split(' ').pop()?.toLowerCase() || '')
  );
  const underdogInjuries = injuries.filter((i: any) => 
    underdog.toLowerCase().includes(i.team_name?.toLowerCase()) ||
    i.team_name?.toLowerCase().includes(underdog.split(' ').pop()?.toLowerCase() || '')
  );

  // Calculate impact
  const impactWeights: Record<string, number> = { high: 0.4, medium: 0.2, low: 0.1 };
  
  const favoriteImpact = favoriteInjuries.reduce((sum: number, i: any) => 
    sum + (impactWeights[i.impact_level] || 0.1), 0);
  const underdogImpact = underdogInjuries.reduce((sum: number, i: any) => 
    sum + (impactWeights[i.impact_level] || 0.1), 0);

  const injuryValue = Math.min(1, Math.max(-1, favoriteImpact - underdogImpact));

  // CHESS EV formula components
  const offensiveEdge = 0.5;
  const defensivePressure = 0.5;
  const lineValue = 50;
  const publicInfluence = 0.3;
  const trapTendency = 0.4;
  const marketConsensus = 3;

  const injuryComponent = injuryValue * (offensiveEdge + defensivePressure);
  const lineValueComponent = (lineValue / 100) * (1 - publicInfluence);
  const trapComponent = trapTendency * (1 / marketConsensus);

  const ev = injuryComponent + lineValueComponent + trapComponent;
  
  return Math.min(100, Math.max(0, ev * 50 + 50));
}

// Calculate record differential from pre-loaded standings data
function calculateRecordDiffFromBatch(standings: any[], sport: string, underdog: string, favorite: string): number {
  const standingsSport = mapSportKeyToAlias(sport);
  
  // Filter to this sport
  const sportStandings = standings.filter(s => s.sport === standingsSport);
  
  if (sportStandings.length === 0) {
    return 50; // Neutral if no data
  }

  // Find teams using flexible matching
  const findTeam = (teamName: string) => {
    return sportStandings.find((s: any) => 
      s.team_name?.toLowerCase() === teamName.toLowerCase() ||
      teamName.toLowerCase().includes(s.team_name?.split(' ').pop()?.toLowerCase() || '') ||
      s.team_name?.toLowerCase().includes(teamName.split(' ').pop()?.toLowerCase() || '')
    );
  };

  const underdogStanding = findTeam(underdog);
  const favoriteStanding = findTeam(favorite);

  if (!underdogStanding || !favoriteStanding) {
    return 50;
  }

  // Calculate score based on record differential
  const winPctDiff = (underdogStanding.win_pct || 0.5) - (favoriteStanding.win_pct || 0.5);
  const recordScore = 50 + (winPctDiff * 100);

  // Add point differential bonus
  const pdDiff = (underdogStanding.point_differential || 0) - (favoriteStanding.point_differential || 0);
  const pdBonus = Math.min(15, Math.max(-15, pdDiff / 2));

  return Math.min(100, Math.max(0, recordScore + pdBonus));
}

// Calculate home court advantage from pre-loaded stats
function calculateHomeCourtFromBatch(hcaStats: any[], sport: string, homeTeam: string, isUnderdogHome: boolean): number {
  // Find matching team stats
  const teamStats = hcaStats.find(s => 
    s.sport === sport && (
      s.team_name?.toLowerCase() === homeTeam.toLowerCase() ||
      homeTeam.toLowerCase().includes(s.team_name?.split(' ').pop()?.toLowerCase() || '')
    )
  );

  if (!teamStats) {
    // Default values if no data
    return isUnderdogHome ? 60 : 40;
  }

  if (isUnderdogHome) {
    // Underdog at home - significant boost
    return Math.min(100, (teamStats.home_upset_rate || 0.3) * 200 + 30);
  } else {
    // Underdog away - penalty based on home team strength
    const awayBoost = (teamStats.away_upset_rate || 0.25) * 150;
    const homePenalty = ((teamStats.home_win_rate || 0.5) - 0.5) * 50;
    return Math.min(100, Math.max(0, awayBoost - homePenalty + 40));
  }
}

function calculateUpsetValueScore(underdogOdds: number, sharpPct: number) {
  // Calculate odds sweetspot (optimal +150 to +400)
  let oddsSweetspot = 0;
  if (underdogOdds >= 150 && underdogOdds <= 250) {
    oddsSweetspot = 100;
  } else if (underdogOdds > 250 && underdogOdds <= 400) {
    oddsSweetspot = 100 - ((underdogOdds - 250) / 150 * 40);
  } else if (underdogOdds > 100 && underdogOdds < 150) {
    oddsSweetspot = (underdogOdds - 100) / 50 * 60;
  } else {
    oddsSweetspot = Math.max(0, 60 - ((underdogOdds - 400) / 200 * 60));
  }

  // Line value estimation
  const lineValue = (sharpPct - 50) * 2;
  
  // Trap pressure from sharp percentage
  const trapPressure = sharpPct >= 60 ? (sharpPct - 60) * 2.5 : 0;

  // UV = (LineValue × 2) + (TrapPressure × 1.2) + (OddsSweetspot × 1.5)
  const uv = (lineValue * 2) + (trapPressure * 1.2) + (oddsSweetspot * 1.5);
  
  return Math.min(100, Math.max(0, uv / 4.7 * 100));
}

async function calculateHomeCourtAdvantage(supabase: any, sport: string, homeTeam: string, isUnderdogHome: boolean) {
  // Use team_aliases for robust team matching
  const sportKey = mapSportKeyToAlias(sport);
  const { data: teamAlias } = await supabase
    .rpc('find_team_by_alias', { search_term: homeTeam, sport_filter: sportKey })
    .single();

  const teamName = teamAlias?.team_name || homeTeam;

  const { data: hcaStats } = await supabase
    .from('home_court_advantage_stats')
    .select('*')
    .eq('sport', sport)
    .eq('team_name', teamName)
    .single();

  if (!hcaStats) {
    // Default values if no data
    return isUnderdogHome ? 60 : 40;
  }

  if (isUnderdogHome) {
    // Underdog at home - significant boost
    return Math.min(100, hcaStats.home_upset_rate * 200 + 30);
  } else {
    // Underdog away - penalty based on home team strength
    const awayBoost = hcaStats.away_upset_rate * 150;
    const homePenalty = (hcaStats.home_win_rate - 0.5) * 50;
    return Math.min(100, Math.max(0, awayBoost - homePenalty + 40));
  }
}

// NOTE: mapSportKeyToAlias is defined at top of file in getWeightsForSport helper

function calculateHistoricalDayBoost(gameDate: Date) {
  const dayOfWeek = gameDate.getDay();
  const multiplier = DAY_MULTIPLIERS[dayOfWeek] || 1.0;
  
  // HDB = 50 × (dayMultiplier − 1.0) + 50
  return Math.min(100, Math.max(0, 50 * (multiplier - 1.0) + 50));
}

function calculateMonteCarloBoost(underdogOdds: number, sport: string) {
  // Simulate upset probability adjustments
  let boost = 50;

  // Odds tier boost
  if (underdogOdds >= 150 && underdogOdds <= 250) boost += 15;
  else if (underdogOdds > 250 && underdogOdds <= 400) boost += 10;
  else if (underdogOdds > 400) boost += 5;

  // Sport-specific chaos factor
  const sportChaosFactors: Record<string, number> = {
    'basketball_nba': 1.15,
    'basketball_ncaab': 1.25, // College basketball has more upsets
    'americanfootball_nfl': 1.20,
    'americanfootball_ncaaf': 1.30, // College football has even more upsets
    'baseball_mlb': 1.10,
    'icehockey_nhl': 1.12
  };

  const chaosFactor = sportChaosFactors[sport] || 1.1;
  boost *= chaosFactor;

  return Math.min(100, Math.max(0, boost));
}

// Use event-based deterministic seeding instead of Math.random() for reproducibility
function calculateChaosPercentage(sharpPct: number, upsetValue: number, monteCarlo: number, dayBoost: number, eventId?: string) {
  // Chaos indicators
  let chaos = 0;

  // Sharp divergence from public
  if (sharpPct >= 65) chaos += 20;
  else if (sharpPct >= 55) chaos += 10;

  // High upset value suggests mispricing
  if (upsetValue >= 70) chaos += 20;
  else if (upsetValue >= 50) chaos += 10;

  // Monte Carlo simulation suggests variance
  if (monteCarlo >= 70) chaos += 15;

  // Historical day patterns
  if (dayBoost >= 60) chaos += 15;

  // Deterministic volatility factor based on event hash instead of random
  // This ensures same event always gets same volatility boost
  const volatilityBoost = eventId ? hashToVolatility(eventId) : 10;
  chaos += volatilityBoost;

  return Math.min(100, chaos);
}

// Convert eventId to a deterministic volatility value (0-20)
function hashToVolatility(eventId: string): number {
  let hash = 0;
  for (let i = 0; i < eventId.length; i++) {
    const char = eventId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Map hash to 0-20 range
  return Math.abs(hash % 21);
}

function calculateUpsetProbability(upsetScore: number, underdogOdds: number, chaosModeActive: boolean) {
  // Base probability from implied odds
  const impliedProb = underdogOdds > 0 
    ? 100 / (underdogOdds + 100) * 100
    : Math.abs(underdogOdds) / (Math.abs(underdogOdds) + 100) * 100;

  // Adjust based on upset score
  const scoreAdjustment = (upsetScore - 50) * 0.5;
  
  // Chaos mode boost
  const chaosBoost = chaosModeActive ? 15 : 0;

  return Math.min(85, Math.max(5, impliedProb + scoreAdjustment + chaosBoost));
}

function classifyConfidence(upsetScore: number, sharpPct: number, chessEv: number): 'high' | 'medium' | 'low' {
  if (upsetScore >= 70 && sharpPct >= 65 && chessEv >= 50) {
    return 'high';
  } else if (upsetScore >= 45) {
    return 'medium';
  }
  return 'low';
}

function calculateRiskLevel(upsetScore: number, underdogOdds: number): 1 | 2 | 3 | 4 | 5 {
  if (upsetScore >= 75 && underdogOdds <= 250) return 1;
  if (upsetScore >= 60 && underdogOdds <= 350) return 2;
  if (upsetScore >= 45 && underdogOdds <= 450) return 3;
  if (upsetScore >= 30) return 4;
  return 5;
}

function determineSuggestion(upsetScore: number, confidence: string, underdogOdds: number): string {
  if (upsetScore >= 70 && confidence === 'high') return 'play';
  if (upsetScore >= 55 && underdogOdds >= 150 && underdogOdds <= 350) return 'parlay_add';
  if (upsetScore >= 45) return 'upset_alert';
  return 'avoid';
}

// Calculate record differential between underdog and favorite using team_aliases for robust matching
async function calculateRecordDifferential(supabase: any, sport: string, underdog: string, favorite: string): Promise<number> {
  try {
    const standingsSport = mapSportKeyToAlias(sport);

    // Use find_team_by_alias for robust team matching
    const [underdogAliasResult, favoriteAliasResult] = await Promise.all([
      supabase.rpc('find_team_by_alias', { search_term: underdog, sport_filter: standingsSport }).single(),
      supabase.rpc('find_team_by_alias', { search_term: favorite, sport_filter: standingsSport }).single()
    ]);

    const underdogTeamName = underdogAliasResult.data?.team_name || underdog;
    const favoriteTeamName = favoriteAliasResult.data?.team_name || favorite;

    // Fetch standings for both teams
    const { data: standings } = await supabase
      .from('team_season_standings')
      .select('team_name, win_pct, wins, losses, point_differential')
      .eq('sport', standingsSport)
      .in('team_name', [underdogTeamName, favoriteTeamName]);

    if (!standings || standings.length < 2) {
      console.log(`[God Mode] Missing standings for ${underdogTeamName} or ${favoriteTeamName}`);
      return 50; // Neutral if can't find teams
    }

    const underdogStanding = standings.find((s: any) => s.team_name === underdogTeamName);
    const favoriteStanding = standings.find((s: any) => s.team_name === favoriteTeamName);

    if (!underdogStanding || !favoriteStanding) {
      return 50; // Neutral if can't find teams
    }

    // Calculate score based on record differential
    // High score = underdog has BETTER record than favorite (trap favorite!)
    const winPctDiff = (underdogStanding.win_pct || 0.5) - (favoriteStanding.win_pct || 0.5);
    
    // Scale to 0-100 where:
    // 100 = underdog has significantly better record (major trap)
    // 50 = equal records
    // 0 = favorite has much better record (legitimate favorite)
    const recordScore = 50 + (winPctDiff * 100);

    // Add point differential bonus
    const pdDiff = (underdogStanding.point_differential || 0) - (favoriteStanding.point_differential || 0);
    const pdBonus = Math.min(15, Math.max(-15, pdDiff / 2));

    return Math.min(100, Math.max(0, recordScore + pdBonus));
  } catch (error) {
    console.error('[God Mode] Record differential error:', error);
    return 50;
  }
}

function buildSignals(sharpPct: number, chessEv: number, upsetValue: number, recordDiff: number, homeCourt: number, dayBoost: number, monteCarlo: number, WEIGHTS: Record<string, number>) {
  return [
    {
      name: 'Sharp Money',
      value: sharpPct,
      weight: WEIGHTS.SHARP_PCT,
      contribution: sharpPct * WEIGHTS.SHARP_PCT,
      description: sharpPct >= 65 ? 'Strong sharp action detected' : sharpPct >= 50 ? 'Moderate sharp interest' : 'Low sharp activity',
      isActive: sharpPct >= 55
    },
    {
      name: 'CHESS EV',
      value: chessEv,
      weight: WEIGHTS.CHESS_EV,
      contribution: chessEv * WEIGHTS.CHESS_EV,
      description: chessEv >= 60 ? 'Favorable injury leverage' : chessEv >= 40 ? 'Neutral injury situation' : 'Unfavorable injuries',
      isActive: chessEv >= 50
    },
    {
      name: 'Upset Value',
      value: upsetValue,
      weight: WEIGHTS.UPSET_VALUE,
      contribution: upsetValue * WEIGHTS.UPSET_VALUE,
      description: upsetValue >= 60 ? 'Strong line mispricing' : upsetValue >= 40 ? 'Moderate value detected' : 'Limited value',
      isActive: upsetValue >= 50
    },
    {
      name: 'Record Edge',
      value: recordDiff,
      weight: WEIGHTS.RECORD_DIFF,
      contribution: recordDiff * WEIGHTS.RECORD_DIFF,
      description: recordDiff >= 70 ? '⚠️ TRAP: Underdog has better record!' : recordDiff >= 55 ? 'Underdog record undervalued' : 'Favorite record justified',
      isActive: recordDiff >= 55
    },
    {
      name: 'Home Court',
      value: homeCourt,
      weight: WEIGHTS.HOME_COURT,
      contribution: homeCourt * WEIGHTS.HOME_COURT,
      description: homeCourt >= 60 ? 'Home court advantage active' : 'Neutral venue impact',
      isActive: homeCourt >= 55
    },
    {
      name: 'Day Pattern',
      value: dayBoost,
      weight: WEIGHTS.HISTORICAL_DAY,
      contribution: dayBoost * WEIGHTS.HISTORICAL_DAY,
      description: dayBoost >= 60 ? 'High upset day historically' : 'Normal upset patterns',
      isActive: dayBoost >= 55
    },
    {
      name: 'Monte Carlo',
      value: monteCarlo,
      weight: WEIGHTS.MONTE_CARLO,
      contribution: monteCarlo * WEIGHTS.MONTE_CARLO,
      description: monteCarlo >= 65 ? 'Simulation favors upset' : 'Neutral simulation results',
      isActive: monteCarlo >= 55
    }
  ];
}

function generateReasons(signals: any[], chaosModeActive: boolean, trapOnFavorite: boolean, underdogOdds: number) {
  const reasons: string[] = [];
  
  const activeSignals = signals.filter(s => s.isActive);
  
  if (activeSignals.length >= 4) {
    reasons.push('Multiple intelligence layers aligned');
  }
  
  const sharpSignal = signals.find(s => s.name === 'Sharp Money');
  if (sharpSignal?.isActive) {
    reasons.push(`Sharp money at ${Math.round(sharpSignal.value)}%`);
  }
  
  if (trapOnFavorite) {
    reasons.push('Trap detected on favorite');
  }
  
  if (chaosModeActive) {
    reasons.push('🌀 CHAOS MODE: High volatility day');
  }
  
  if (underdogOdds >= 150 && underdogOdds <= 300) {
    reasons.push('Odds in optimal upset sweetspot');
  }
  
  const chessSignal = signals.find(s => s.name === 'CHESS EV');
  if (chessSignal?.isActive) {
    reasons.push('Injury leverage advantage');
  }
  
  const homeSignal = signals.find(s => s.name === 'Home Court');
  if (homeSignal?.isActive) {
    reasons.push('Home court factor engaged');
  }

  return reasons.slice(0, 5);
}

function calculateParlayImpact(upsetScore: number, underdogOdds: number, confidence: string) {
  // EV impact based on score and odds
  const evImpact = (upsetScore - 50) * 0.02 * (underdogOdds / 100);
  
  // Risk reduction from confidence
  const riskReduction = confidence === 'high' ? 25 : confidence === 'medium' ? 10 : -5;
  
  // Synergy boost for correlation opportunities
  const synergyBoost = upsetScore >= 60 ? 15 : upsetScore >= 45 ? 8 : 0;

  return {
    evImpact: Math.round(evImpact * 100) / 100,
    riskReduction,
    synergyBoost
  };
}
