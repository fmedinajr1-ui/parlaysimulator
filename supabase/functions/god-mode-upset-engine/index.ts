import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// God Mode weights
const WEIGHTS = {
  SHARP_PCT: 0.35,
  CHESS_EV: 0.25,
  UPSET_VALUE: 0.20,
  HOME_COURT: 0.05,
  HISTORICAL_DAY: 0.05,
  MONTE_CARLO: 0.10
};

// Day multipliers for historical boost
const DAY_MULTIPLIERS: Record<number, number> = {
  0: 1.05, 1: 1.10, 2: 1.05, 3: 1.08, 4: 1.15, 5: 1.08, 6: 1.20
};

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
        
        // Process each event
        for (const event of events) {
          const prediction = await analyzeEvent(supabase, event, sportKey);
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

async function analyzeEvent(supabase: any, event: any, sport: string) {
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

  // Calculate all component scores
  const sharpPct = await calculateSharpPct(supabase, eventId, underdog, bookmakers);
  const chessEv = await calculateCHESSEV(supabase, sport, underdog, favorite);
  const upsetValueScore = calculateUpsetValueScore(underdogOdds, sharpPct);
  const homeCourtAdvantage = await calculateHomeCourtAdvantage(supabase, sport, home_team, isHomeUnderdog);
  const historicalDayBoost = calculateHistoricalDayBoost(new Date(commence_time));
  const monteCarloBoost = calculateMonteCarloBoost(underdogOdds, sport);

  // Calculate final upset score
  const finalUpsetScore = Math.min(100, Math.max(0,
    (sharpPct * WEIGHTS.SHARP_PCT) +
    (chessEv * WEIGHTS.CHESS_EV) +
    (upsetValueScore * WEIGHTS.UPSET_VALUE) +
    (homeCourtAdvantage * WEIGHTS.HOME_COURT) +
    (historicalDayBoost * WEIGHTS.HISTORICAL_DAY) +
    (monteCarloBoost * WEIGHTS.MONTE_CARLO)
  ));

  // Calculate chaos percentage
  const chaosPercentage = calculateChaosPercentage(sharpPct, upsetValueScore, monteCarloBoost, historicalDayBoost);
  const chaosModeActive = chaosPercentage >= 70;

  // Apply chaos boost if active
  const adjustedUpsetScore = chaosModeActive ? Math.min(100, finalUpsetScore + 10) : finalUpsetScore;
  const upsetProbability = calculateUpsetProbability(adjustedUpsetScore, underdogOdds, chaosModeActive);

  // Classify confidence
  const confidence = classifyConfidence(adjustedUpsetScore, sharpPct, chessEv);
  const riskLevel = calculateRiskLevel(adjustedUpsetScore, underdogOdds);
  const suggestion = determineSuggestion(adjustedUpsetScore, confidence, underdogOdds);

  // Build signals array
  const signals = buildSignals(sharpPct, chessEv, upsetValueScore, homeCourtAdvantage, historicalDayBoost, monteCarloBoost);
  
  // Detect trap on favorite
  const trapOnFavorite = sharpPct >= 60 && upsetValueScore >= 50;

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
    final_upset_score: Math.round(adjustedUpsetScore * 10) / 10,
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

async function calculateCHESSEV(supabase: any, sport: string, underdog: string, favorite: string) {
  // Fetch injury data
  const { data: injuries } = await supabase
    .from('nba_injury_reports')
    .select('*')
    .gte('game_date', new Date().toISOString().split('T')[0]);

  let injuryValue = 0;
  
  if (injuries && injuries.length > 0) {
    const favoriteInjuries = injuries.filter((i: any) => 
      favorite.toLowerCase().includes(i.team_name?.toLowerCase())
    );
    const underdogInjuries = injuries.filter((i: any) => 
      underdog.toLowerCase().includes(i.team_name?.toLowerCase())
    );

    // Calculate impact
    const impactWeights: Record<string, number> = { high: 0.4, medium: 0.2, low: 0.1 };
    
    const favoriteImpact = favoriteInjuries.reduce((sum: number, i: any) => 
      sum + (impactWeights[i.impact_level] || 0.1), 0);
    const underdogImpact = underdogInjuries.reduce((sum: number, i: any) => 
      sum + (impactWeights[i.impact_level] || 0.1), 0);

    injuryValue = Math.min(1, Math.max(-1, favoriteImpact - underdogImpact));
  }

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
  const { data: hcaStats } = await supabase
    .from('home_court_advantage_stats')
    .select('*')
    .eq('sport', sport)
    .ilike('team_name', `%${homeTeam.split(' ').pop()}%`)
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

function calculateChaosPercentage(sharpPct: number, upsetValue: number, monteCarlo: number, dayBoost: number) {
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

  // Random volatility factor
  chaos += Math.random() * 20;

  return Math.min(100, chaos);
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

function buildSignals(sharpPct: number, chessEv: number, upsetValue: number, homeCourt: number, dayBoost: number, monteCarlo: number) {
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
