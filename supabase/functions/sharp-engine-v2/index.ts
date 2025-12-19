import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EngineConfig {
  BASE_MOVE_SHARP: number;
  BASE_NOISE: number;
  PICK_SES_THRESHOLD: number;
  FADE_SES_THRESHOLD: number;
  PICK_SHARP_PCT: number;
  FADE_SHARP_PCT: number;
  LOGISTIC_K: number;
  // INVERTED Movement Weights - minimal is now BEST
  MW_EXTREME: number;
  MW_LARGE: number;
  MW_MODERATE: number;
  MW_SMALL: number;
  MW_MINIMAL: number;
  // Time Weights
  TW_LATE: number;
  TW_MID: number;
  TW_EARLY: number;
  // Sharp Signals
  SIGNAL_LINE_AND_JUICE: number;
  SIGNAL_LATE_MONEY: number;
  SIGNAL_RLM: number;
  SIGNAL_CLV_POSITIVE: number;
  SIGNAL_MULTI_MARKET: number;
  SIGNAL_ISOLATED_SHARP: number;  // NEW: Isolated moves are sharp
  SIGNAL_UNDERDOG_STEAM: number;  // NEW: Steam toward underdog
  // Trap Signals (INVERTED from before)
  TRAP_PRICE_ONLY: number;
  TRAP_EARLY_MORNING: number;
  TRAP_BOTH_SIDES: number;
  TRAP_INSIGNIFICANT: number;
  TRAP_FAVORITE_SHORT: number;
  TRAP_EXTREME_JUICE: number;
  TRAP_CLV_NEGATIVE: number;
  TRAP_CONSENSUS_HIGH: number;    // NEW: High consensus is trap
  TRAP_STEAM_MOVE: number;        // MOVED: Steam is now trap
  TRAP_EXTREME_MOVEMENT: number;  // NEW: Extreme moves are traps
}

interface SignalFlags {
  reverseLineMovement: boolean;
  priceOnlyMove: boolean;
  bothSidesMoved: boolean;
  singleSideOnly: boolean;
  extremeJuice: boolean;
  favoriteShortening: boolean;
  underdogTightening: boolean;    // NEW
  clvPositive: boolean;
  clvNegative: boolean;
  multiMarketAlignment: boolean;
  isIsolatedMove: boolean;        // NEW
  isSteamMove: boolean;           // NEW
  isExtremeMove: boolean;         // NEW
  priceDirection: 'toward_favorite' | 'toward_underdog' | 'neutral';  // NEW
}

interface MovementInput {
  priceChange: number;
  lineChange: number;
  hoursToGame: number;
  booksCount: number;
  totalBooks: number;
  currentPrice: number;
  openingPrice: number;
  oppositeSideMoved: boolean;
  isSteamMove?: boolean;
  isPlayerProp?: boolean;
  sport?: string;
}

interface EngineResult {
  SP: number;
  SP_move: number;
  SP_signals: number;
  TP: number;
  TP_noise: number;
  TP_trap: number;
  SES: number;
  sharpPct: number;
  MW: number;
  TW: number;
  label: 'SHARP' | 'TRAP' | 'CAUTION';
  recommendation: 'pick' | 'fade' | 'caution';
  sharpSignals: string[];
  trapSignals: string[];
  allSignals: { type: 'sharp' | 'trap'; signal: string; value: number }[];
  consensusRatio: number;
  movementBucket: string;
  priceDirection: string;
  openingSide: string;
  sportAdjusted: boolean;
}

// INVERTED DEFAULT CONFIG - Based on outcome analysis
// Key insight: Lower SES performed BETTER, so we invert the logic
const DEFAULT_CONFIG: EngineConfig = {
  BASE_MOVE_SHARP: 40,
  BASE_NOISE: 25,
  // INVERTED thresholds - lower SES is now "pick", higher is "fade"
  PICK_SES_THRESHOLD: -20,
  FADE_SES_THRESHOLD: 20,
  PICK_SHARP_PCT: 35,   // Inverted
  FADE_SHARP_PCT: 65,   // Inverted
  LOGISTIC_K: 25,
  // INVERTED Movement Weights - minimal movements performed BEST
  MW_EXTREME: 0.1,      // Was 0.4 - extreme moves are TRAPS
  MW_LARGE: 0.3,        // Was 1.0
  MW_MODERATE: 0.5,     // Was 0.7
  MW_SMALL: 0.8,        // Was 0.3
  MW_MINIMAL: 1.0,      // Was 0.1 - minimal moves are SHARP
  // Time Weights
  TW_LATE: 1.25,
  TW_MID: 1.0,
  TW_EARLY: 0.6,
  // Sharp Signals
  SIGNAL_LINE_AND_JUICE: 15,      // Reduced - not as reliable
  SIGNAL_LATE_MONEY: 15,
  SIGNAL_RLM: 20,                 // Kept - still valuable
  SIGNAL_CLV_POSITIVE: 10,
  SIGNAL_MULTI_MARKET: 15,
  SIGNAL_ISOLATED_SHARP: 25,      // NEW: Isolated moves are sharp
  SIGNAL_UNDERDOG_STEAM: 20,      // NEW: Steam toward underdog is sharp
  // Trap Signals
  TRAP_PRICE_ONLY: 20,
  TRAP_EARLY_MORNING: 15,
  TRAP_BOTH_SIDES: 25,
  TRAP_INSIGNIFICANT: 15,
  TRAP_FAVORITE_SHORT: 25,        // Increased
  TRAP_EXTREME_JUICE: 15,
  TRAP_CLV_NEGATIVE: 10,
  TRAP_CONSENSUS_HIGH: 25,        // NEW: High consensus is trap
  TRAP_STEAM_MOVE: 20,            // MOVED: Steam is now trap (was sharp)
  TRAP_EXTREME_MOVEMENT: 20,      // NEW: Extreme moves are traps
};

function getMovementBucket(priceChange: number): string {
  const absChange = Math.abs(priceChange);
  if (absChange >= 50) return 'extreme';
  if (absChange >= 30) return 'large';
  if (absChange >= 15) return 'moderate';
  if (absChange >= 10) return 'small';
  return 'minimal';
}

function getMovementWeight(priceChange: number, config: EngineConfig): number {
  const absChange = Math.abs(priceChange);
  // INVERTED: Minimal movements get highest weight
  if (absChange >= 50) return config.MW_EXTREME;    // Lowest weight
  if (absChange >= 30) return config.MW_LARGE;
  if (absChange >= 15) return config.MW_MODERATE;
  if (absChange >= 10) return config.MW_SMALL;
  return config.MW_MINIMAL;                          // Highest weight
}

function getTimeWeight(hoursToGame: number, config: EngineConfig): number {
  if (hoursToGame >= 1 && hoursToGame <= 3) return config.TW_LATE;
  if (hoursToGame > 3 && hoursToGame <= 6) return config.TW_MID;
  return config.TW_EARLY;
}

function determinePriceDirection(currentPrice: number, openingPrice: number): 'toward_favorite' | 'toward_underdog' | 'neutral' {
  if (!currentPrice || !openingPrice) return 'neutral';
  
  // If price became more negative (e.g., -110 to -130), it moved toward favorite
  // If price became less negative or more positive (e.g., -110 to +100), it moved toward underdog
  const priceDiff = currentPrice - openingPrice;
  
  if (openingPrice < 0) {
    // Was on favorite side
    if (priceDiff < -10) return 'toward_favorite';  // Got more negative
    if (priceDiff > 10) return 'toward_underdog';   // Got less negative/more positive
  } else {
    // Was on underdog side
    if (priceDiff > 10) return 'toward_underdog';   // Got more positive
    if (priceDiff < -10) return 'toward_favorite';  // Got less positive/more negative
  }
  
  return 'neutral';
}

function determineOpeningSide(openingPrice: number): string {
  if (!openingPrice) return 'unknown';
  if (openingPrice <= -150) return 'heavy_favorite';
  if (openingPrice < -110) return 'slight_favorite';
  if (openingPrice >= 150) return 'heavy_underdog';
  if (openingPrice > 110) return 'slight_underdog';
  return 'pick_em';
}

function detectSignalFlags(input: MovementInput): SignalFlags {
  const { priceChange, lineChange, currentPrice, openingPrice, oppositeSideMoved, booksCount, totalBooks, isSteamMove } = input;
  
  const consensusRatio = totalBooks > 0 ? booksCount / totalBooks : 0;
  const absChange = Math.abs(priceChange);
  const priceDirection = determinePriceDirection(currentPrice, openingPrice);
  
  return {
    reverseLineMovement: (priceChange < -10 && lineChange > 0) || (priceChange > 10 && lineChange < 0),
    priceOnlyMove: Math.abs(lineChange) < 0.5 && absChange >= 8,
    bothSidesMoved: oppositeSideMoved,
    singleSideOnly: !oppositeSideMoved,
    extremeJuice: currentPrice <= -150,
    favoriteShortening: priceDirection === 'toward_favorite' && currentPrice <= -130,
    underdogTightening: priceDirection === 'toward_underdog' && openingPrice >= 100,
    clvPositive: currentPrice < openingPrice,
    clvNegative: currentPrice > openingPrice,
    multiMarketAlignment: false,
    isIsolatedMove: consensusRatio > 0 && consensusRatio < 0.4,  // Only 1-2 books moved
    isSteamMove: isSteamMove || (absChange >= 15 && input.hoursToGame <= 2),
    isExtremeMove: absChange >= 50,
    priceDirection,
  };
}

function calculateSharpPressure(
  input: MovementInput,
  flags: SignalFlags,
  config: EngineConfig
): { SP: number; SP_move: number; SP_signals: number; signals: { signal: string; value: number }[] } {
  const { priceChange, lineChange, hoursToGame, booksCount, totalBooks } = input;
  const consensusRatio = totalBooks > 0 ? booksCount / totalBooks : 0;
  
  const MW = getMovementWeight(priceChange, config);
  const TW = getTimeWeight(hoursToGame, config);
  const SP_move = MW * TW * config.BASE_MOVE_SHARP;
  
  const signals: { signal: string; value: number }[] = [];
  let SP_signals = 0;
  
  // LINE_AND_JUICE_MOVED - still valid but reduced weight
  if (Math.abs(lineChange) >= 0.5 && Math.abs(priceChange) >= 10) {
    SP_signals += config.SIGNAL_LINE_AND_JUICE;
    signals.push({ signal: 'LINE_AND_JUICE_MOVED', value: config.SIGNAL_LINE_AND_JUICE });
  }
  
  // LATE_MONEY_WINDOW
  if (hoursToGame >= 1 && hoursToGame <= 3) {
    SP_signals += config.SIGNAL_LATE_MONEY;
    signals.push({ signal: 'LATE_MONEY_WINDOW', value: config.SIGNAL_LATE_MONEY });
  }
  
  // REVERSE_LINE_MOVEMENT - still a sharp signal
  if (flags.reverseLineMovement) {
    SP_signals += config.SIGNAL_RLM;
    signals.push({ signal: 'REVERSE_LINE_MOVEMENT', value: config.SIGNAL_RLM });
  }
  
  // NEW: ISOLATED_SHARP - low consensus is sharp (inverted from before)
  if (flags.isIsolatedMove) {
    SP_signals += config.SIGNAL_ISOLATED_SHARP;
    signals.push({ signal: 'ISOLATED_SHARP', value: config.SIGNAL_ISOLATED_SHARP });
  }
  
  // NEW: UNDERDOG_STEAM - steam toward underdog is sharp
  if (flags.isSteamMove && flags.underdogTightening) {
    SP_signals += config.SIGNAL_UNDERDOG_STEAM;
    signals.push({ signal: 'UNDERDOG_STEAM', value: config.SIGNAL_UNDERDOG_STEAM });
  }
  
  // CLV_POSITIVE
  if (flags.clvPositive) {
    SP_signals += config.SIGNAL_CLV_POSITIVE;
    signals.push({ signal: 'CLV_POSITIVE', value: config.SIGNAL_CLV_POSITIVE });
  }
  
  // MULTI_MARKET_ALIGNMENT
  if (flags.multiMarketAlignment) {
    SP_signals += config.SIGNAL_MULTI_MARKET;
    signals.push({ signal: 'MULTI_MARKET_ALIGNMENT', value: config.SIGNAL_MULTI_MARKET });
  }
  
  // SINGLE_SIDE bonus for moderate moves
  if (flags.singleSideOnly && Math.abs(priceChange) >= 10 && Math.abs(priceChange) < 30) {
    const bonus = 10;
    SP_signals += bonus;
    signals.push({ signal: 'SINGLE_SIDE_MOVEMENT', value: bonus });
  }
  
  const SP = SP_move + SP_signals;
  return { SP, SP_move, SP_signals, signals };
}

function calculateTrapPressure(
  input: MovementInput,
  flags: SignalFlags,
  config: EngineConfig
): { TP: number; TP_noise: number; TP_trap: number; signals: { signal: string; value: number }[] } {
  const { priceChange, lineChange, hoursToGame, booksCount, totalBooks } = input;
  const consensusRatio = totalBooks > 0 ? booksCount / totalBooks : 0;
  
  // INVERTED Noise Weight - large movements = high noise (public money)
  let NW: number;
  const absChange = Math.abs(priceChange);
  if (absChange < 10) NW = 0.3;       // Minimal movement = low noise (was 1.0)
  else if (absChange < 15) NW = 0.5;  
  else if (absChange < 30) NW = 0.7;  
  else if (absChange < 50) NW = 0.9;  
  else NW = 1.0;                       // Extreme = high noise (was 0.5)
  
  const EarlyFlag = hoursToGame > 6 ? 1 : 0;
  const TP_noise = NW * (0.5 + 0.5 * EarlyFlag) * config.BASE_NOISE;
  
  const signals: { signal: string; value: number }[] = [];
  let TP_trap = 0;
  
  // PRICE_ONLY_MOVE
  if (flags.priceOnlyMove) {
    TP_trap += config.TRAP_PRICE_ONLY;
    signals.push({ signal: 'PRICE_ONLY_MOVE', value: config.TRAP_PRICE_ONLY });
  }
  
  // EARLY_MORNING_ACTION
  if (hoursToGame > 6) {
    TP_trap += config.TRAP_EARLY_MORNING;
    signals.push({ signal: 'EARLY_MORNING_ACTION', value: config.TRAP_EARLY_MORNING });
  }
  
  // BOTH_SIDES_MOVED
  if (flags.bothSidesMoved) {
    TP_trap += config.TRAP_BOTH_SIDES;
    signals.push({ signal: 'BOTH_SIDES_MOVED', value: config.TRAP_BOTH_SIDES });
  }
  
  // INSIGNIFICANT_MOVEMENT
  if (absChange < 8) {
    TP_trap += config.TRAP_INSIGNIFICANT;
    signals.push({ signal: 'INSIGNIFICANT_MOVEMENT', value: config.TRAP_INSIGNIFICANT });
  }
  
  // FAVORITE_SHORTENING - strong trap signal
  if (flags.favoriteShortening) {
    TP_trap += config.TRAP_FAVORITE_SHORT;
    signals.push({ signal: 'FAVORITE_SHORTENING', value: config.TRAP_FAVORITE_SHORT });
  }
  
  // EXTREME_JUICE_WARNING
  if (flags.extremeJuice && !flags.favoriteShortening) {
    TP_trap += config.TRAP_EXTREME_JUICE;
    signals.push({ signal: 'EXTREME_JUICE_WARNING', value: config.TRAP_EXTREME_JUICE });
  }
  
  // CLV_NEGATIVE
  if (flags.clvNegative) {
    TP_trap += config.TRAP_CLV_NEGATIVE;
    signals.push({ signal: 'CLV_NEGATIVE', value: config.TRAP_CLV_NEGATIVE });
  }
  
  // NEW: HIGH_CONSENSUS_TRAP - high consensus is public money (inverted)
  if (consensusRatio >= 0.6) {
    TP_trap += config.TRAP_CONSENSUS_HIGH;
    signals.push({ signal: 'HIGH_CONSENSUS_TRAP', value: config.TRAP_CONSENSUS_HIGH });
  }
  
  // NEW: STEAM_MOVE_TRAP - steam is now a trap signal (inverted)
  if (flags.isSteamMove && !flags.underdogTightening) {
    TP_trap += config.TRAP_STEAM_MOVE;
    signals.push({ signal: 'STEAM_MOVE_TRAP', value: config.TRAP_STEAM_MOVE });
  }
  
  // NEW: EXTREME_MOVEMENT_TRAP - extreme moves are public overreaction
  if (flags.isExtremeMove) {
    TP_trap += config.TRAP_EXTREME_MOVEMENT;
    signals.push({ signal: 'EXTREME_MOVEMENT_TRAP', value: config.TRAP_EXTREME_MOVEMENT });
  }
  
  const TP = TP_noise + TP_trap;
  return { TP, TP_noise, TP_trap, signals };
}

function calculateSES(SP: number, TP: number): number {
  return SP - TP;
}

function calculateSharpProbability(SES: number, K: number): number {
  // INVERTED: Lower SES = higher probability of being sharp
  // Original: 1 / (1 + exp(-SES / K))
  // Inverted: 1 / (1 + exp(SES / K))
  const prob = 1 / (1 + Math.exp(SES / K));
  return Math.round(prob * 100);
}

function classifyMovement(
  SES: number,
  sharpPct: number,
  config: EngineConfig
): { label: 'SHARP' | 'TRAP' | 'CAUTION'; recommendation: 'pick' | 'fade' | 'caution' } {
  // INVERTED logic: Lower SES = SHARP, Higher SES = TRAP
  // SHARP PICK: SES <= -20 AND Sharp% >= 65 (inverted)
  if (SES <= config.PICK_SES_THRESHOLD && sharpPct >= 65) {
    return { label: 'SHARP', recommendation: 'pick' };
  }
  
  // TRAP / FADE: SES >= +20 AND Sharp% <= 35 (inverted)
  if (SES >= config.FADE_SES_THRESHOLD && sharpPct <= 35) {
    return { label: 'TRAP', recommendation: 'fade' };
  }
  
  // CAUTION / MIXED SIGNALS
  return { label: 'CAUTION', recommendation: 'caution' };
}

function runSharpEngineV2(input: MovementInput, config: EngineConfig): EngineResult {
  // Handle null/undefined values gracefully
  const safeInput: MovementInput = {
    priceChange: input.priceChange ?? 0,
    lineChange: input.lineChange ?? 0,
    hoursToGame: Math.max(0, input.hoursToGame ?? 12),
    booksCount: input.booksCount ?? 1,
    totalBooks: input.totalBooks ?? 5,
    currentPrice: input.currentPrice ?? -110,
    openingPrice: input.openingPrice ?? -110,
    oppositeSideMoved: input.oppositeSideMoved ?? false,
    isSteamMove: input.isSteamMove ?? false,
    isPlayerProp: input.isPlayerProp ?? false,
    sport: input.sport,
  };
  
  const consensusRatio = safeInput.totalBooks > 0 ? safeInput.booksCount / safeInput.totalBooks : 0;
  const flags = detectSignalFlags(safeInput);
  
  const sharpResult = calculateSharpPressure(safeInput, flags, config);
  const trapResult = calculateTrapPressure(safeInput, flags, config);
  const SES = calculateSES(sharpResult.SP, trapResult.TP);
  const sharpPct = calculateSharpProbability(SES, config.LOGISTIC_K);
  const classification = classifyMovement(SES, sharpPct, config);
  
  const allSignals = [
    ...sharpResult.signals.map(s => ({ type: 'sharp' as const, ...s })),
    ...trapResult.signals.map(s => ({ type: 'trap' as const, ...s })),
  ];
  
  return {
    SP: sharpResult.SP,
    SP_move: sharpResult.SP_move,
    SP_signals: sharpResult.SP_signals,
    TP: trapResult.TP,
    TP_noise: trapResult.TP_noise,
    TP_trap: trapResult.TP_trap,
    SES,
    sharpPct,
    MW: getMovementWeight(safeInput.priceChange, config),
    TW: getTimeWeight(safeInput.hoursToGame, config),
    label: classification.label,
    recommendation: classification.recommendation,
    sharpSignals: sharpResult.signals.map(s => s.signal),
    trapSignals: trapResult.signals.map(s => s.signal),
    allSignals,
    consensusRatio,
    movementBucket: getMovementBucket(safeInput.priceChange),
    priceDirection: flags.priceDirection,
    openingSide: determineOpeningSide(safeInput.openingPrice),
    sportAdjusted: false,
  };
}

async function loadConfig(supabase: any, sport?: string): Promise<EngineConfig> {
  // First load base config
  const { data: configRows } = await supabase
    .from('sharp_engine_config')
    .select('config_key, config_value');
  
  const config = { ...DEFAULT_CONFIG };
  
  if (configRows && configRows.length > 0) {
    for (const row of configRows as { config_key: string; config_value: number }[]) {
      if (row.config_key in config) {
        (config as Record<string, number>)[row.config_key] = Number(row.config_value);
      }
    }
  }
  
  // Then overlay sport-specific config if available
  if (sport) {
    const { data: sportConfigRows } = await supabase
      .from('sharp_engine_sport_config')
      .select('config_key, config_value')
      .eq('sport', sport);
    
    if (sportConfigRows && sportConfigRows.length > 0) {
      console.log(`Loaded ${sportConfigRows.length} sport-specific overrides for ${sport}`);
      for (const row of sportConfigRows as { config_key: string; config_value: number }[]) {
        if (row.config_key in config) {
          (config as Record<string, number>)[row.config_key] = Number(row.config_value);
        }
      }
    }
  }
  
  return config;
}

async function updateSignalAccuracy(supabase: any, signals: string[], signalType: 'sharp' | 'trap', wasCorrect: boolean, sport?: string) {
  for (const signal of signals) {
    await supabase
      .from('sharp_signal_accuracy')
      .upsert({
        signal_name: signal,
        signal_type: signalType,
        sport: sport || 'all',
        total_occurrences: 1,
        correct_when_present: wasCorrect ? 1 : 0,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'signal_name,sport',
        ignoreDuplicates: false,
      });
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { action, movementData, movementId, sport } = body;

    // Load config with optional sport-specific overrides
    const config = await loadConfig(supabase, sport);
    console.log('Sharp Engine V2 (INVERTED) - Loaded config for sport:', sport || 'default');

    if (action === 'analyze') {
      if (!movementData) {
        return new Response(
          JSON.stringify({ error: 'movementData required for analyze action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const result = runSharpEngineV2({ ...movementData, sport }, config);
      
      console.log('Sharp Engine V2 INVERTED Result:', {
        SES: result.SES,
        sharpPct: result.sharpPct,
        label: result.label,
        recommendation: result.recommendation,
        priceDirection: result.priceDirection,
        movementBucket: result.movementBucket,
      });

      if (movementId) {
        const { error: updateError } = await supabase
          .from('line_movements')
          .update({
            sharp_pressure: result.SP,
            trap_pressure: result.TP,
            sharp_edge_score: result.SES,
            sharp_probability: result.sharpPct,
            movement_weight: result.MW,
            time_weight: result.TW,
            detected_signals: result.allSignals,
            engine_version: 'v2.1-inverted',
            movement_authenticity: result.label === 'SHARP' ? 'real' : result.label === 'TRAP' ? 'fake' : 'uncertain',
            recommendation: result.recommendation,
            authenticity_confidence: result.sharpPct / 100,
            consensus_ratio: result.consensusRatio,
            price_direction: result.priceDirection,
            opening_side: result.openingSide,
            movement_bucket: result.movementBucket,
            sport_adjusted: !!sport,
          })
          .eq('id', movementId);

        if (updateError) {
          console.error('Error updating movement:', updateError);
        }
      }

      return new Response(
        JSON.stringify({ success: true, result, config, engineVersion: 'v2.1-inverted' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'batch_reanalyze') {
      const { limit = 100, sportFilter } = body;
      
      let query = supabase
        .from('line_movements')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(Math.min(limit, 500));
      
      if (sportFilter) {
        query = query.eq('sport', sportFilter);
      }
      
      const { data: movements, error: fetchError } = await query;

      if (fetchError) {
        throw fetchError;
      }

      const results = [];
      const batchSize = 25;
      
      for (let i = 0; i < (movements || []).length; i += batchSize) {
        const batch = (movements || []).slice(i, i + batchSize);
        
        for (const movement of batch) {
          // Skip if prices are null
          if (movement.new_price === null || movement.old_price === null) {
            console.log(`Skipping movement ${movement.id} - null prices`);
            continue;
          }
          
          const hoursToGame = movement.commence_time 
            ? (new Date(movement.commence_time).getTime() - new Date(movement.detected_at).getTime()) / (1000 * 60 * 60)
            : 12;

          // Load sport-specific config for this movement
          const movementConfig = await loadConfig(supabase, movement.sport);

          const input: MovementInput = {
            priceChange: movement.price_change || 0,
            lineChange: movement.point_change || 0,
            hoursToGame: Math.max(0, hoursToGame),
            booksCount: movement.books_consensus || 1,
            totalBooks: 5,
            currentPrice: movement.new_price,
            openingPrice: movement.old_price,
            oppositeSideMoved: movement.opposite_side_moved || false,
            isSteamMove: movement.sharp_indicator?.includes('STEAM'),
            sport: movement.sport,
          };

          const result = runSharpEngineV2(input, movementConfig);

          const { error: updateError } = await supabase
            .from('line_movements')
            .update({
              sharp_pressure: result.SP,
              trap_pressure: result.TP,
              sharp_edge_score: result.SES,
              sharp_probability: result.sharpPct,
              movement_weight: result.MW,
              time_weight: result.TW,
              detected_signals: result.allSignals,
              engine_version: 'v2.1-inverted',
              movement_authenticity: result.label === 'SHARP' ? 'real' : result.label === 'TRAP' ? 'fake' : 'uncertain',
              recommendation: result.recommendation,
              authenticity_confidence: result.sharpPct / 100,
              consensus_ratio: result.consensusRatio,
              price_direction: result.priceDirection,
              opening_side: result.openingSide,
              movement_bucket: result.movementBucket,
              sport_adjusted: !!movement.sport,
            })
            .eq('id', movement.id);

          if (!updateError) {
            results.push({ 
              id: movement.id, 
              label: result.label, 
              SES: result.SES,
              recommendation: result.recommendation,
              priceDirection: result.priceDirection,
            });
          }
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          processed: results.length, 
          results,
          engineVersion: 'v2.1-inverted',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'get_config') {
      return new Response(
        JSON.stringify({ success: true, config, engineVersion: 'v2.1-inverted' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action. Use: analyze, batch_reanalyze, or get_config' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Sharp Engine V2 Error:', error);
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
