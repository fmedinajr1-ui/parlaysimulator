import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// SHARP VS VEGAS: GOD MODE ENGINE
// Pressure Intelligence Framework
// ============================================================================

interface AnalysisInput {
  id: string;
  opening_line: number;
  opening_over_price: number;
  opening_under_price: number;
  current_line: number;
  current_over_price: number;
  current_under_price: number;
  sport: string;
  prop_type: string;
  commence_time?: string;
}

interface SharpSignal {
  name: string;
  baseWeight: number;
  contextMultiplier: number;
  finalWeight: number;
  description: string;
  isActive: boolean;
}

interface TrapSignal {
  name: string;
  baseWeight: number;
  severityModifier: number;
  finalWeight: number;
  description: string;
  isActive: boolean;
}

interface GodModeResult {
  // Pressure Metrics
  sharpPressure: number;
  trapPressure: number;
  marketNoise: number;
  eventVolatilityModifier: number;
  nmes: number;
  
  // Probabilities
  sharpProbability: number;
  trapProbability: number;
  neutralProbability: number;
  
  // Final Score
  strategyBoost: number;
  godModeScore: number;
  
  // Decision
  recommendation: 'pick' | 'fade' | 'caution';
  direction: 'over' | 'under';
  confidence: number;
  
  // Signals
  sharpSignals: SharpSignal[];
  trapSignals: TrapSignal[];
  
  // Market
  consensusRatio: number;
  consensusStrength: string;
  
  // Reasoning
  reasoning: string;
  explanation: string[];
}

// ============================================================================
// SHARP PRESSURE SIGNALS (SP)
// ============================================================================

const SHARP_SIGNALS = {
  REVERSE_LINE_MOVEMENT: { 
    base: 40, 
    getMultiplier: (publicPct: number) => publicPct > 65 ? 1.25 : 1.0,
    description: 'Line moving against expected public direction'
  },
  LINE_JUICE_ALIGNMENT: { 
    base: 35, 
    getMultiplier: (hoursToGame: number) => hoursToGame < 3 ? 1.10 : 1.0,
    description: 'Line and juice moved together'
  },
  STEAM_MOVE: { 
    base: 32, 
    getMultiplier: (books: number) => books >= 2 ? 1.20 : 1.0,
    description: 'Steam move ≥15 points'
  },
  OPTIMAL_ZONE_MOVE: { 
    base: 28, 
    getMultiplier: () => 1.30,
    description: 'Optimal 30-49 point movement zone'
  },
  LATE_MONEY: { 
    base: 26, 
    getMultiplier: (injuryUnclear: boolean) => injuryUnclear ? 1.20 : 1.0,
    description: 'Late money 1-3 hours pregame'
  },
  CLV_COMPRESSION: { 
    base: 26, 
    getMultiplier: (trending: boolean) => trending ? 1.25 : 1.0,
    description: 'CLV positive opportunity'
  },
  MARKET_CONSENSUS: { 
    base: 24, 
    getMultiplier: (cr: number) => cr >= 0.6 ? 1.30 : 1.0,
    description: 'Market consensus CR ≥ 60%'
  },
  SINGLE_SIDE_MOVEMENT: { 
    base: 20, 
    getMultiplier: (lineStatic: boolean) => lineStatic ? 1.15 : 1.0,
    description: 'Single side movement only'
  }
};

// ============================================================================
// TRAP PRESSURE SIGNALS (TP)
// ============================================================================

const TRAP_SIGNALS = {
  BOTH_SIDES_MOVED: { 
    base: 38, 
    getSeverity: () => 1.25,
    description: 'Both sides juiced'
  },
  PRICE_ONLY_STEAM: { 
    base: 33, 
    getSeverity: () => 1.30,
    description: 'Price moved without line'
  },
  FAVORITE_SHORTENING: { 
    base: 28, 
    getSeverity: (odds: number) => odds <= -150 ? 1.40 : 1.0,
    description: 'Heavy favorite shortening'
  },
  INSIGNIFICANT_MOVE: { 
    base: 22, 
    getSeverity: () => 1.00,
    description: 'Movement < 8 points'
  },
  EXTREME_JUICE_WARNING: { 
    base: 22, 
    getSeverity: () => 1.20,
    description: 'Extreme juice ≤ -150'
  },
  VERY_EARLY_ACTION: { 
    base: 16, 
    getSeverity: () => 1.00,
    description: 'Very early action > 6 hours'
  }
};

// ============================================================================
// CORE CALCULATION FUNCTIONS
// ============================================================================

function calculateSharpPressure(
  overPriceChange: number,
  underPriceChange: number,
  lineChange: number,
  hoursToGame: number,
  consensusRatio: number,
  booksAligned: number,
  currentOverPrice: number,
  injuryUncertain: boolean,
  publicOverPct: number
): { total: number; signals: SharpSignal[] } {
  const signals: SharpSignal[] = [];
  let totalPressure = 0;
  const maxPriceChange = Math.max(Math.abs(overPriceChange), Math.abs(underPriceChange));
  const lineStatic = Math.abs(lineChange) < 0.5;

  // 1. Reverse Line Movement (RLM)
  const isRLM = (overPriceChange < -10 && lineChange > 0) || (underPriceChange < -10 && lineChange < 0);
  const rlmMultiplier = SHARP_SIGNALS.REVERSE_LINE_MOVEMENT.getMultiplier(publicOverPct);
  const rlmWeight = isRLM ? SHARP_SIGNALS.REVERSE_LINE_MOVEMENT.base * rlmMultiplier : 0;
  signals.push({
    name: 'REVERSE_LINE_MOVEMENT',
    baseWeight: SHARP_SIGNALS.REVERSE_LINE_MOVEMENT.base,
    contextMultiplier: rlmMultiplier,
    finalWeight: rlmWeight,
    description: SHARP_SIGNALS.REVERSE_LINE_MOVEMENT.description,
    isActive: isRLM
  });
  totalPressure += rlmWeight;

  // 2. Line & Juice Alignment
  const isLineJuiceAlign = Math.abs(lineChange) >= 0.5 && maxPriceChange >= 10;
  const ljMultiplier = SHARP_SIGNALS.LINE_JUICE_ALIGNMENT.getMultiplier(hoursToGame);
  const ljWeight = isLineJuiceAlign ? SHARP_SIGNALS.LINE_JUICE_ALIGNMENT.base * ljMultiplier : 0;
  signals.push({
    name: 'LINE_JUICE_ALIGNMENT',
    baseWeight: SHARP_SIGNALS.LINE_JUICE_ALIGNMENT.base,
    contextMultiplier: ljMultiplier,
    finalWeight: ljWeight,
    description: SHARP_SIGNALS.LINE_JUICE_ALIGNMENT.description,
    isActive: isLineJuiceAlign
  });
  totalPressure += ljWeight;

  // 3. Steam Move (≥15 points)
  const isSteam = maxPriceChange >= 15;
  const steamMultiplier = SHARP_SIGNALS.STEAM_MOVE.getMultiplier(booksAligned);
  const steamWeight = isSteam ? SHARP_SIGNALS.STEAM_MOVE.base * steamMultiplier : 0;
  signals.push({
    name: 'STEAM_MOVE',
    baseWeight: SHARP_SIGNALS.STEAM_MOVE.base,
    contextMultiplier: steamMultiplier,
    finalWeight: steamWeight,
    description: SHARP_SIGNALS.STEAM_MOVE.description,
    isActive: isSteam
  });
  totalPressure += steamWeight;

  // 4. Optimal Zone Move (30-49 points) - Historically strongest
  const isOptimalZone = maxPriceChange >= 30 && maxPriceChange < 50;
  const optimalMultiplier = SHARP_SIGNALS.OPTIMAL_ZONE_MOVE.getMultiplier();
  const optimalWeight = isOptimalZone ? SHARP_SIGNALS.OPTIMAL_ZONE_MOVE.base * optimalMultiplier : 0;
  signals.push({
    name: 'OPTIMAL_ZONE_MOVE',
    baseWeight: SHARP_SIGNALS.OPTIMAL_ZONE_MOVE.base,
    contextMultiplier: optimalMultiplier,
    finalWeight: optimalWeight,
    description: SHARP_SIGNALS.OPTIMAL_ZONE_MOVE.description,
    isActive: isOptimalZone
  });
  totalPressure += optimalWeight;

  // 5. Late Money (1-3 hours pregame)
  const isLateMoney = hoursToGame >= 1 && hoursToGame <= 3;
  const lateMultiplier = SHARP_SIGNALS.LATE_MONEY.getMultiplier(injuryUncertain);
  const lateWeight = isLateMoney ? SHARP_SIGNALS.LATE_MONEY.base * lateMultiplier : 0;
  signals.push({
    name: 'LATE_MONEY',
    baseWeight: SHARP_SIGNALS.LATE_MONEY.base,
    contextMultiplier: lateMultiplier,
    finalWeight: lateWeight,
    description: SHARP_SIGNALS.LATE_MONEY.description,
    isActive: isLateMoney
  });
  totalPressure += lateWeight;

  // 6. CLV Compression (moved ≥15, still favorable price)
  const hasCLV = (currentOverPrice >= -115 && overPriceChange < -15) || 
                  (currentOverPrice >= -115 && underPriceChange < -15);
  const clvTrending = maxPriceChange >= 20;
  const clvMultiplier = SHARP_SIGNALS.CLV_COMPRESSION.getMultiplier(clvTrending);
  const clvWeight = hasCLV ? SHARP_SIGNALS.CLV_COMPRESSION.base * clvMultiplier : 0;
  signals.push({
    name: 'CLV_COMPRESSION',
    baseWeight: SHARP_SIGNALS.CLV_COMPRESSION.base,
    contextMultiplier: clvMultiplier,
    finalWeight: clvWeight,
    description: SHARP_SIGNALS.CLV_COMPRESSION.description,
    isActive: hasCLV
  });
  totalPressure += clvWeight;

  // 7. Market Consensus (CR ≥ 0.6)
  const hasConsensus = consensusRatio >= 0.6;
  const consensusMultiplier = SHARP_SIGNALS.MARKET_CONSENSUS.getMultiplier(consensusRatio);
  const consensusWeight = hasConsensus ? SHARP_SIGNALS.MARKET_CONSENSUS.base * consensusMultiplier : 0;
  signals.push({
    name: 'MARKET_CONSENSUS',
    baseWeight: SHARP_SIGNALS.MARKET_CONSENSUS.base,
    contextMultiplier: consensusMultiplier,
    finalWeight: consensusWeight,
    description: SHARP_SIGNALS.MARKET_CONSENSUS.description,
    isActive: hasConsensus
  });
  totalPressure += consensusWeight;

  // 8. Single-Side Movement
  const isSingleSide = Math.abs(overPriceChange) >= 10 && 
                        Math.abs(underPriceChange - (-overPriceChange)) > 10;
  const singleMultiplier = SHARP_SIGNALS.SINGLE_SIDE_MOVEMENT.getMultiplier(lineStatic);
  const singleWeight = isSingleSide ? SHARP_SIGNALS.SINGLE_SIDE_MOVEMENT.base * singleMultiplier : 0;
  signals.push({
    name: 'SINGLE_SIDE_MOVEMENT',
    baseWeight: SHARP_SIGNALS.SINGLE_SIDE_MOVEMENT.base,
    contextMultiplier: singleMultiplier,
    finalWeight: singleWeight,
    description: SHARP_SIGNALS.SINGLE_SIDE_MOVEMENT.description,
    isActive: isSingleSide
  });
  totalPressure += singleWeight;

  return { total: totalPressure, signals };
}

function calculateTrapPressure(
  overPriceChange: number,
  underPriceChange: number,
  lineChange: number,
  hoursToGame: number,
  currentOverPrice: number,
  currentUnderPrice: number,
  openingOverPrice: number
): { total: number; signals: TrapSignal[] } {
  const signals: TrapSignal[] = [];
  let totalPressure = 0;
  const maxPriceChange = Math.max(Math.abs(overPriceChange), Math.abs(underPriceChange));

  // 1. Both Sides Moved
  const bothSidesMoved = overPriceChange < -5 && underPriceChange < -5;
  const bothSeverity = TRAP_SIGNALS.BOTH_SIDES_MOVED.getSeverity();
  const bothWeight = bothSidesMoved ? TRAP_SIGNALS.BOTH_SIDES_MOVED.base * bothSeverity : 0;
  signals.push({
    name: 'BOTH_SIDES_MOVED',
    baseWeight: TRAP_SIGNALS.BOTH_SIDES_MOVED.base,
    severityModifier: bothSeverity,
    finalWeight: bothWeight,
    description: TRAP_SIGNALS.BOTH_SIDES_MOVED.description,
    isActive: bothSidesMoved
  });
  totalPressure += bothWeight;

  // 2. Price-Only Steam (no line move)
  const priceOnlySteam = Math.abs(lineChange) < 0.5 && maxPriceChange >= 10;
  const priceSeverity = TRAP_SIGNALS.PRICE_ONLY_STEAM.getSeverity();
  const priceWeight = priceOnlySteam ? TRAP_SIGNALS.PRICE_ONLY_STEAM.base * priceSeverity : 0;
  signals.push({
    name: 'PRICE_ONLY_STEAM',
    baseWeight: TRAP_SIGNALS.PRICE_ONLY_STEAM.base,
    severityModifier: priceSeverity,
    finalWeight: priceWeight,
    description: TRAP_SIGNALS.PRICE_ONLY_STEAM.description,
    isActive: priceOnlySteam
  });
  totalPressure += priceWeight;

  // 3. Favorite Shortening (≤ -150)
  const favShortening = openingOverPrice <= -150 && overPriceChange < -10;
  const favSeverity = TRAP_SIGNALS.FAVORITE_SHORTENING.getSeverity(openingOverPrice);
  const favWeight = favShortening ? TRAP_SIGNALS.FAVORITE_SHORTENING.base * favSeverity : 0;
  signals.push({
    name: 'FAVORITE_SHORTENING',
    baseWeight: TRAP_SIGNALS.FAVORITE_SHORTENING.base,
    severityModifier: favSeverity,
    finalWeight: favWeight,
    description: TRAP_SIGNALS.FAVORITE_SHORTENING.description,
    isActive: favShortening
  });
  totalPressure += favWeight;

  // 4. Insignificant Move (<8 pts)
  const insignificant = maxPriceChange < 8;
  const insignifSeverity = TRAP_SIGNALS.INSIGNIFICANT_MOVE.getSeverity();
  const insignifWeight = insignificant ? TRAP_SIGNALS.INSIGNIFICANT_MOVE.base * insignifSeverity : 0;
  signals.push({
    name: 'INSIGNIFICANT_MOVE',
    baseWeight: TRAP_SIGNALS.INSIGNIFICANT_MOVE.base,
    severityModifier: insignifSeverity,
    finalWeight: insignifWeight,
    description: TRAP_SIGNALS.INSIGNIFICANT_MOVE.description,
    isActive: insignificant
  });
  totalPressure += insignifWeight;

  // 5. Extreme Juice Warning (≤ -150)
  const extremeJuice = currentOverPrice <= -150 || currentUnderPrice <= -150;
  const extremeSeverity = TRAP_SIGNALS.EXTREME_JUICE_WARNING.getSeverity();
  const extremeWeight = extremeJuice ? TRAP_SIGNALS.EXTREME_JUICE_WARNING.base * extremeSeverity : 0;
  signals.push({
    name: 'EXTREME_JUICE_WARNING',
    baseWeight: TRAP_SIGNALS.EXTREME_JUICE_WARNING.base,
    severityModifier: extremeSeverity,
    finalWeight: extremeWeight,
    description: TRAP_SIGNALS.EXTREME_JUICE_WARNING.description,
    isActive: extremeJuice
  });
  totalPressure += extremeWeight;

  // 6. Very Early Action (>6 hrs)
  const veryEarly = hoursToGame > 6;
  const earlySeverity = TRAP_SIGNALS.VERY_EARLY_ACTION.getSeverity();
  const earlyWeight = veryEarly ? TRAP_SIGNALS.VERY_EARLY_ACTION.base * earlySeverity : 0;
  signals.push({
    name: 'VERY_EARLY_ACTION',
    baseWeight: TRAP_SIGNALS.VERY_EARLY_ACTION.base,
    severityModifier: earlySeverity,
    finalWeight: earlyWeight,
    description: TRAP_SIGNALS.VERY_EARLY_ACTION.description,
    isActive: veryEarly
  });
  totalPressure += earlyWeight;

  return { total: totalPressure, signals };
}

function calculateMarketNoise(avgJuiceChange: number, consensusRatio: number): number {
  // NP = NoiseWeight × (1 − ConsensusRatio)
  if (avgJuiceChange >= 10) return 0; // Significant movement = not noise
  const noiseWeight = avgJuiceChange;
  return noiseWeight * (1 - consensusRatio);
}

function calculateEventVolatilityModifier(context: {
  injuryUncertainty: boolean;
  backToBackFatigue: boolean;
  publicImbalance: number;
  lowLimitWindow: boolean;
  chaosDayDetected: boolean;
}): number {
  // EVM = 1 + volatilityFactor (Range: 1.00 → 1.40)
  let volatility = 0;
  if (context.injuryUncertainty) volatility += 0.10;
  if (context.backToBackFatigue) volatility += 0.08;
  if (context.publicImbalance > 70) volatility += 0.07;
  if (context.lowLimitWindow) volatility += 0.05;
  if (context.chaosDayDetected) volatility += 0.10;
  return Math.min(1.40, 1 + volatility);
}

function calculateSharpProbability(nmes: number): number {
  // Logistic function: SharpProb = 1 / (1 + e^(− NMES / 22))
  return 1 / (1 + Math.exp(-nmes / 22));
}

function calculateStrategyBoost(context: {
  alignsWithCHESSEV: boolean;
  isParlayAnchor: boolean;
  highVolatility: boolean;
  trapProbHigh: boolean;
}): number {
  let boost = 0;
  if (context.alignsWithCHESSEV) boost += 10;
  if (context.isParlayAnchor) boost += 15;
  if (context.highVolatility) boost -= 10;
  if (context.trapProbHigh) boost -= 20;
  return boost;
}

function determineConsensusStrength(cr: number): string {
  if (cr >= 0.75) return 'strong';
  if (cr >= 0.60) return 'moderate';
  if (cr >= 0.40) return 'weak';
  return 'divergent';
}

function determineRecommendation(
  sharpProb: number,
  nmes: number,
  cr: number,
  activeTrapSignals: number,
  sharpPressure: number,
  trapPressure: number
): 'pick' | 'fade' | 'caution' {
  // 🟢 SHARP PICK
  if (sharpProb >= 0.62 && nmes >= 35 && cr >= 0.60 && activeTrapSignals === 0) {
    return 'pick';
  }
  // 🔴 FADE
  if (sharpProb <= 0.35 && nmes <= -25 && trapPressure > sharpPressure && activeTrapSignals >= 2) {
    return 'fade';
  }
  // ⚠️ CAUTION
  return 'caution';
}

function buildExplanation(
  recommendation: 'pick' | 'fade' | 'caution',
  direction: string,
  sharpSignals: SharpSignal[],
  trapSignals: TrapSignal[],
  nmes: number,
  sharpProb: number,
  trapProb: number,
  godModeScore: number
): string[] {
  const explanations: string[] = [];
  
  const activeSharp = sharpSignals.filter(s => s.isActive);
  const activeTrap = trapSignals.filter(s => s.isActive);

  if (recommendation === 'pick') {
    explanations.push(`🟢 SHARP PICK confirmed on ${direction.toUpperCase()}`);
    explanations.push(`Sharp probability: ${(sharpProb * 100).toFixed(1)}%`);
    if (activeSharp.length > 0) {
      explanations.push(`Active sharp signals: ${activeSharp.map(s => s.name).join(', ')}`);
    }
  } else if (recommendation === 'fade') {
    explanations.push(`🔴 FADE detected - bet ${direction.toUpperCase()} against movement`);
    explanations.push(`Trap probability: ${(trapProb * 100).toFixed(1)}%`);
    if (activeTrap.length > 0) {
      explanations.push(`Active trap signals: ${activeTrap.map(s => s.name).join(', ')}`);
    }
  } else {
    explanations.push(`⚠️ CAUTION - Mixed signals, lean ${direction.toUpperCase()}`);
    explanations.push(`NMES in neutral zone: ${nmes.toFixed(1)}`);
  }
  
  explanations.push(`GOD MODE Score: ${godModeScore.toFixed(1)}`);
  
  return explanations;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const input: AnalysisInput = await req.json();
    console.log('[GOD MODE Engine] Analyzing:', input);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Calculate movement metrics
    const lineChange = input.current_line - input.opening_line;
    const overPriceChange = input.current_over_price - input.opening_over_price;
    const underPriceChange = input.current_under_price - input.opening_under_price;
    const maxPriceChange = Math.max(Math.abs(overPriceChange), Math.abs(underPriceChange));
    const avgJuiceChange = (Math.abs(overPriceChange) + Math.abs(underPriceChange)) / 2;

    // Determine hours to game
    let hoursToGame = 24;
    if (input.commence_time) {
      const gameTime = new Date(input.commence_time);
      const now = new Date();
      hoursToGame = Math.max(0, (gameTime.getTime() - now.getTime()) / (1000 * 60 * 60));
    }

    // Fetch market consensus data
    let consensusRatio = 0.5;
    let booksAligned = 1;
    let consensusDirection: 'over' | 'under' | null = null;
    
    const { data: oddsSnapshots } = await supabase
      .from('odds_snapshots')
      .select('bookmaker, price, outcome_name')
      .eq('sport', input.sport)
      .gte('snapshot_time', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
      .limit(50);

    if (oddsSnapshots && oddsSnapshots.length > 0) {
      const bookmakers = new Set(oddsSnapshots.map(s => s.bookmaker));
      const totalBooks = bookmakers.size;
      
      const overBooks = oddsSnapshots.filter(s => 
        s.outcome_name?.toLowerCase().includes('over') && s.price < -115
      ).length;
      const underBooks = oddsSnapshots.filter(s => 
        s.outcome_name?.toLowerCase().includes('under') && s.price < -115
      ).length;
      
      const maxBooks = Math.max(overBooks, underBooks);
      booksAligned = maxBooks;
      consensusRatio = totalBooks > 0 ? maxBooks / totalBooks : 0.5;
      
      if (overBooks > underBooks * 1.5) consensusDirection = 'over';
      else if (underBooks > overBooks * 1.5) consensusDirection = 'under';
    }

    // Detect context signals
    const injuryUncertain = false; // Would need injury data
    const backToBackFatigue = false; // Would need schedule data
    const publicOverPct = 50; // Would need public betting data
    const publicImbalance = Math.abs(publicOverPct - 50);
    const lowLimitWindow = hoursToGame < 1;
    const dayOfWeek = new Date().getDay();
    const chaosDayDetected = dayOfWeek === 6 || dayOfWeek === 4; // Saturday or Thursday

    // ========== CALCULATE SHARP PRESSURE (SP) ==========
    const sharpResult = calculateSharpPressure(
      overPriceChange,
      underPriceChange,
      lineChange,
      hoursToGame,
      consensusRatio,
      booksAligned,
      input.current_over_price,
      injuryUncertain,
      publicOverPct
    );
    const sharpPressure = sharpResult.total;
    const sharpSignals = sharpResult.signals;

    // ========== CALCULATE TRAP PRESSURE (TP) ==========
    const trapResult = calculateTrapPressure(
      overPriceChange,
      underPriceChange,
      lineChange,
      hoursToGame,
      input.current_over_price,
      input.current_under_price,
      input.opening_over_price
    );
    const trapPressure = trapResult.total;
    const trapSignals = trapResult.signals;

    // ========== CALCULATE MARKET NOISE (NP) ==========
    const marketNoise = calculateMarketNoise(avgJuiceChange, consensusRatio);

    // ========== CALCULATE EVENT VOLATILITY MODIFIER (EVM) ==========
    const eventVolatilityModifier = calculateEventVolatilityModifier({
      injuryUncertainty: injuryUncertain,
      backToBackFatigue,
      publicImbalance,
      lowLimitWindow,
      chaosDayDetected
    });

    // ========== CALCULATE NET MARKET EDGE SCORE (NMES) ==========
    const nmes = (sharpPressure - trapPressure - marketNoise) * eventVolatilityModifier;

    // ========== CALCULATE PROBABILITIES ==========
    const sharpProbability = calculateSharpProbability(nmes);
    const trapProbability = 1 - sharpProbability;
    const neutralProbability = Math.max(0, 1 - Math.abs(sharpProbability - 0.5) * 2);

    // ========== CALCULATE STRATEGY BOOST ==========
    const strategyBoost = calculateStrategyBoost({
      alignsWithCHESSEV: nmes > 20,
      isParlayAnchor: sharpProbability >= 0.65,
      highVolatility: eventVolatilityModifier > 1.25,
      trapProbHigh: trapProbability > 0.65
    });

    // ========== FINAL GOD MODE SCORE ==========
    const godModeScore = nmes + strategyBoost;

    // ========== DETERMINE DIRECTION ==========
    let direction: 'over' | 'under' = 'over';
    if (overPriceChange < 0) {
      direction = 'over';
    } else if (underPriceChange < 0) {
      direction = 'under';
    } else if (Math.abs(overPriceChange) > Math.abs(underPriceChange)) {
      direction = overPriceChange < 0 ? 'over' : 'under';
    } else {
      direction = underPriceChange < 0 ? 'under' : 'over';
    }

    // ========== DETERMINE RECOMMENDATION ==========
    const activeTrapSignals = trapSignals.filter(s => s.isActive).length;
    let recommendation = determineRecommendation(
      sharpProbability,
      nmes,
      consensusRatio,
      activeTrapSignals,
      sharpPressure,
      trapPressure
    );

    // If fade, flip direction
    if (recommendation === 'fade') {
      direction = direction === 'over' ? 'under' : 'over';
    }

    // Calculate confidence
    let confidence = sharpProbability;
    if (recommendation === 'fade') {
      confidence = trapProbability;
    } else if (recommendation === 'caution') {
      confidence = 0.35 + Math.abs(nmes) / 150;
    }

    // ========== BUILD EXPLANATION ==========
    const explanation = buildExplanation(
      recommendation,
      direction,
      sharpSignals,
      trapSignals,
      nmes,
      sharpProbability,
      trapProbability,
      godModeScore
    );

    // Build reasoning summary
    let reasoning = '';
    if (recommendation === 'pick') {
      reasoning = `🟢 GOD MODE: SHARP PICK on ${direction.toUpperCase()}. `;
      reasoning += `SP=${sharpPressure.toFixed(0)}, TP=${trapPressure.toFixed(0)}, NMES=${nmes.toFixed(1)}. `;
      reasoning += `Sharp probability: ${(sharpProbability * 100).toFixed(0)}%. `;
      const activeSharp = sharpSignals.filter(s => s.isActive).slice(0, 2);
      if (activeSharp.length > 0) {
        reasoning += `Signals: ${activeSharp.map(s => s.name).join(', ')}. `;
      }
    } else if (recommendation === 'fade') {
      reasoning = `🔴 GOD MODE: FADE detected - bet ${direction.toUpperCase()}. `;
      reasoning += `SP=${sharpPressure.toFixed(0)}, TP=${trapPressure.toFixed(0)}, NMES=${nmes.toFixed(1)}. `;
      reasoning += `Trap probability: ${(trapProbability * 100).toFixed(0)}%. `;
      const activeTrap = trapSignals.filter(s => s.isActive).slice(0, 2);
      if (activeTrap.length > 0) {
        reasoning += `Traps: ${activeTrap.map(s => s.name).join(', ')}. `;
      }
    } else {
      reasoning = `⚠️ GOD MODE: CAUTION - lean ${direction.toUpperCase()}. `;
      reasoning += `SP=${sharpPressure.toFixed(0)}, TP=${trapPressure.toFixed(0)}, NMES=${nmes.toFixed(1)}. `;
      reasoning += `Mixed signals, confidence ${(confidence * 100).toFixed(0)}%. `;
    }
    reasoning += `GOD MODE Score: ${godModeScore.toFixed(1)}`;

    const result: GodModeResult = {
      sharpPressure,
      trapPressure,
      marketNoise,
      eventVolatilityModifier,
      nmes,
      sharpProbability,
      trapProbability,
      neutralProbability,
      strategyBoost,
      godModeScore,
      recommendation,
      direction,
      confidence,
      sharpSignals,
      trapSignals,
      consensusRatio,
      consensusStrength: determineConsensusStrength(consensusRatio),
      reasoning,
      explanation
    };

    console.log('[GOD MODE Engine] Result:', {
      SP: sharpPressure,
      TP: trapPressure,
      NP: marketNoise,
      EVM: eventVolatilityModifier,
      NMES: nmes,
      SharpProb: sharpProbability,
      GodModeScore: godModeScore,
      Recommendation: recommendation
    });

    // Update the database record with GOD MODE analysis
    const { error: updateError } = await supabase
      .from('sharp_line_tracker')
      .update({
        ai_recommendation: result.recommendation,
        ai_direction: result.direction,
        ai_confidence: result.confidence,
        ai_reasoning: result.reasoning,
        ai_signals: {
          godMode: true,
          sharpPressure: result.sharpPressure,
          trapPressure: result.trapPressure,
          marketNoise: result.marketNoise,
          eventVolatilityModifier: result.eventVolatilityModifier,
          nmes: result.nmes,
          sharpProbability: result.sharpProbability,
          trapProbability: result.trapProbability,
          godModeScore: result.godModeScore,
          consensusRatio: result.consensusRatio,
          consensusStrength: result.consensusStrength,
          strategyBoost: result.strategyBoost,
          sharpSignals: result.sharpSignals,
          trapSignals: result.trapSignals,
          explanation: result.explanation
        },
        status: 'analyzed'
      })
      .eq('id', input.id);

    if (updateError) {
      console.error('[GOD MODE Engine] Error updating record:', updateError);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[GOD MODE Engine] Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
