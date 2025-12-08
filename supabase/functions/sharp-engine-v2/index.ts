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
  MW_EXTREME: number;
  MW_LARGE: number;
  MW_MODERATE: number;
  MW_SMALL: number;
  MW_MINIMAL: number;
  TW_LATE: number;
  TW_MID: number;
  TW_EARLY: number;
  SIGNAL_LINE_AND_JUICE: number;
  SIGNAL_STEAM_MOVE: number;
  SIGNAL_LATE_MONEY: number;
  SIGNAL_RLM: number;
  SIGNAL_CONSENSUS_HIGH: number;
  SIGNAL_CLV_POSITIVE: number;
  SIGNAL_MULTI_MARKET: number;
  TRAP_PRICE_ONLY: number;
  TRAP_EARLY_MORNING: number;
  TRAP_BOTH_SIDES: number;
  TRAP_INSIGNIFICANT: number;
  TRAP_FAVORITE_SHORT: number;
  TRAP_EXTREME_JUICE: number;
  TRAP_ISOLATED: number;
  TRAP_CLV_NEGATIVE: number;
}

interface SignalFlags {
  reverseLineMovement: boolean;
  priceOnlyMove: boolean;
  bothSidesMoved: boolean;
  singleSideOnly: boolean;
  extremeJuice: boolean;
  favoriteShortening: boolean;
  clvPositive: boolean;
  clvNegative: boolean;
  multiMarketAlignment: boolean;
}

interface MovementInput {
  priceChange: number;       // ΔJ - juice/price change in points
  lineChange: number;        // ΔL - spread/total line change
  hoursToGame: number;       // T_hours - hours until game starts
  booksCount: number;        // B - number of books moving same direction
  totalBooks: number;        // B_total - total books available
  currentPrice: number;      // Current odds price
  openingPrice: number;      // Opening odds price
  oppositeSideMoved: boolean;
  isSteamMove?: boolean;
  isPlayerProp?: boolean;
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
}

// Default config values
const DEFAULT_CONFIG: EngineConfig = {
  BASE_MOVE_SHARP: 40,
  BASE_NOISE: 25,
  PICK_SES_THRESHOLD: 30,
  FADE_SES_THRESHOLD: -30,
  PICK_SHARP_PCT: 65,
  FADE_SHARP_PCT: 35,
  LOGISTIC_K: 25,
  MW_EXTREME: 0.4,
  MW_LARGE: 1.0,
  MW_MODERATE: 0.7,
  MW_SMALL: 0.3,
  MW_MINIMAL: 0.1,
  TW_LATE: 1.25,
  TW_MID: 1.0,
  TW_EARLY: 0.6,
  SIGNAL_LINE_AND_JUICE: 25,
  SIGNAL_STEAM_MOVE: 20,
  SIGNAL_LATE_MONEY: 15,
  SIGNAL_RLM: 25,
  SIGNAL_CONSENSUS_HIGH: 20,
  SIGNAL_CLV_POSITIVE: 10,
  SIGNAL_MULTI_MARKET: 15,
  TRAP_PRICE_ONLY: 25,
  TRAP_EARLY_MORNING: 15,
  TRAP_BOTH_SIDES: 30,
  TRAP_INSIGNIFICANT: 20,
  TRAP_FAVORITE_SHORT: 20,
  TRAP_EXTREME_JUICE: 15,
  TRAP_ISOLATED: 20,
  TRAP_CLV_NEGATIVE: 10,
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
  if (absChange >= 50) return config.MW_EXTREME;
  if (absChange >= 30) return config.MW_LARGE;
  if (absChange >= 15) return config.MW_MODERATE;
  if (absChange >= 10) return config.MW_SMALL;
  return config.MW_MINIMAL;
}

function getTimeWeight(hoursToGame: number, config: EngineConfig): number {
  if (hoursToGame >= 1 && hoursToGame <= 3) return config.TW_LATE;
  if (hoursToGame > 3 && hoursToGame <= 6) return config.TW_MID;
  return config.TW_EARLY;
}

function detectSignalFlags(input: MovementInput): SignalFlags {
  const { priceChange, lineChange, currentPrice, openingPrice, oppositeSideMoved } = input;
  
  return {
    reverseLineMovement: (priceChange < -10 && lineChange > 0) || (priceChange > 10 && lineChange < 0),
    priceOnlyMove: Math.abs(lineChange) < 0.5 && Math.abs(priceChange) >= 8,
    bothSidesMoved: oppositeSideMoved,
    singleSideOnly: !oppositeSideMoved,
    extremeJuice: currentPrice <= -150,
    favoriteShortening: currentPrice < openingPrice && currentPrice <= -200,
    clvPositive: currentPrice < openingPrice, // Got better price than opening
    clvNegative: currentPrice > openingPrice, // Got worse price
    multiMarketAlignment: false, // Would need additional market data
  };
}

function calculateSharpPressure(
  input: MovementInput,
  flags: SignalFlags,
  config: EngineConfig
): { SP: number; SP_move: number; SP_signals: number; signals: { signal: string; value: number }[] } {
  const { priceChange, lineChange, hoursToGame, booksCount, totalBooks, isSteamMove } = input;
  const consensusRatio = totalBooks > 0 ? booksCount / totalBooks : 0;
  
  // A. Movement Weight (MW) based on ΔJ bucket
  const MW = getMovementWeight(priceChange, config);
  
  // B. Time Weight (TW) based on T_hours
  const TW = getTimeWeight(hoursToGame, config);
  
  // C. SP_move = MW × TW × BaseMoveSharp
  const SP_move = MW * TW * config.BASE_MOVE_SHARP;
  
  // D. Sharp Signal Bonuses
  const signals: { signal: string; value: number }[] = [];
  let SP_signals = 0;
  
  // LINE_AND_JUICE_MOVED: ΔL ≥ 0.5 & ΔJ ≥ 10
  if (Math.abs(lineChange) >= 0.5 && Math.abs(priceChange) >= 10) {
    SP_signals += config.SIGNAL_LINE_AND_JUICE;
    signals.push({ signal: 'LINE_AND_JUICE_MOVED', value: config.SIGNAL_LINE_AND_JUICE });
  }
  
  // STEAM_MOVE_DETECTED: ΔJ ≥ 15 within 2 hours
  if ((isSteamMove || Math.abs(priceChange) >= 15) && hoursToGame <= 2) {
    SP_signals += config.SIGNAL_STEAM_MOVE;
    signals.push({ signal: 'STEAM_MOVE_DETECTED', value: config.SIGNAL_STEAM_MOVE });
  }
  
  // LATE_MONEY_WINDOW: 1-3 hours before game
  if (hoursToGame >= 1 && hoursToGame <= 3) {
    SP_signals += config.SIGNAL_LATE_MONEY;
    signals.push({ signal: 'LATE_MONEY_WINDOW', value: config.SIGNAL_LATE_MONEY });
  }
  
  // REVERSE_LINE_MOVEMENT
  if (flags.reverseLineMovement) {
    SP_signals += config.SIGNAL_RLM;
    signals.push({ signal: 'REVERSE_LINE_MOVEMENT', value: config.SIGNAL_RLM });
  }
  
  // MARKET_CONSENSUS_HIGH: CR ≥ 0.6
  if (consensusRatio >= 0.6) {
    SP_signals += config.SIGNAL_CONSENSUS_HIGH;
    signals.push({ signal: 'MARKET_CONSENSUS_HIGH', value: config.SIGNAL_CONSENSUS_HIGH });
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
  
  // SINGLE_SIDE_ONLY bonus
  if (flags.singleSideOnly && Math.abs(priceChange) >= 10) {
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
  
  // A. Noise Weight (NW) - inverse relationship with movement strength
  let NW: number;
  const absChange = Math.abs(priceChange);
  if (absChange < 10) NW = 1.0;       // Minimal movement = high noise
  else if (absChange < 15) NW = 0.7;  // Small
  else if (absChange < 30) NW = 0.4;  // Moderate
  else if (absChange < 50) NW = 0.2;  // Large
  else NW = 0.5;                       // Extreme (suspicious)
  
  // B. Early flag
  const EarlyFlag = hoursToGame > 6 ? 1 : 0;
  
  // C. TP_noise = NW × (0.5 + 0.5·EarlyFlag) × BaseNoise
  const TP_noise = NW * (0.5 + 0.5 * EarlyFlag) * config.BASE_NOISE;
  
  // D. Trap Signal Penalties
  const signals: { signal: string; value: number }[] = [];
  let TP_trap = 0;
  
  // PRICE_ONLY_MOVE: |ΔL| < 0.5 && |ΔJ| >= 8
  if (flags.priceOnlyMove) {
    TP_trap += config.TRAP_PRICE_ONLY;
    signals.push({ signal: 'PRICE_ONLY_MOVE', value: config.TRAP_PRICE_ONLY });
  }
  
  // EARLY_MORNING_ACTION: T_hours > 6
  if (hoursToGame > 6) {
    TP_trap += config.TRAP_EARLY_MORNING;
    signals.push({ signal: 'EARLY_MORNING_ACTION', value: config.TRAP_EARLY_MORNING });
  }
  
  // BOTH_SIDES_MOVED
  if (flags.bothSidesMoved) {
    TP_trap += config.TRAP_BOTH_SIDES;
    signals.push({ signal: 'BOTH_SIDES_MOVED', value: config.TRAP_BOTH_SIDES });
  }
  
  // INSIGNIFICANT_MOVEMENT: ΔJ < 8
  if (absChange < 8) {
    TP_trap += config.TRAP_INSIGNIFICANT;
    signals.push({ signal: 'INSIGNIFICANT_MOVEMENT', value: config.TRAP_INSIGNIFICANT });
  }
  
  // FAVORITE_SHORTENING with extreme juice
  if (flags.favoriteShortening && flags.extremeJuice) {
    TP_trap += config.TRAP_FAVORITE_SHORT;
    signals.push({ signal: 'FAVORITE_SHORTENING', value: config.TRAP_FAVORITE_SHORT });
  }
  
  // EXTREME_JUICE_WARNING
  if (flags.extremeJuice && !flags.favoriteShortening) {
    TP_trap += config.TRAP_EXTREME_JUICE;
    signals.push({ signal: 'EXTREME_JUICE_WARNING', value: config.TRAP_EXTREME_JUICE });
  }
  
  // ISOLATED_SIGNAL: CR < 0.4
  if (consensusRatio < 0.4 && consensusRatio > 0) {
    TP_trap += config.TRAP_ISOLATED;
    signals.push({ signal: 'ISOLATED_SIGNAL', value: config.TRAP_ISOLATED });
  }
  
  // CLV_NEGATIVE
  if (flags.clvNegative) {
    TP_trap += config.TRAP_CLV_NEGATIVE;
    signals.push({ signal: 'CLV_NEGATIVE', value: config.TRAP_CLV_NEGATIVE });
  }
  
  const TP = TP_noise + TP_trap;
  return { TP, TP_noise, TP_trap, signals };
}

function calculateSES(SP: number, TP: number): number {
  return SP - TP;
}

function calculateSharpProbability(SES: number, K: number): number {
  // Logistic function: SharpProb = 1 / (1 + exp(−SES / K))
  const prob = 1 / (1 + Math.exp(-SES / K));
  return Math.round(prob * 100);
}

function classifyMovement(
  SES: number,
  sharpPct: number,
  config: EngineConfig
): { label: 'SHARP' | 'TRAP' | 'CAUTION'; recommendation: 'pick' | 'fade' | 'caution' } {
  // SHARP PICK: SES ≥ +30 AND Sharp% ≥ 65
  if (SES >= config.PICK_SES_THRESHOLD && sharpPct >= config.PICK_SHARP_PCT) {
    return { label: 'SHARP', recommendation: 'pick' };
  }
  
  // TRAP / FADE: SES ≤ −30 AND Sharp% ≤ 35
  if (SES <= config.FADE_SES_THRESHOLD && sharpPct <= config.FADE_SHARP_PCT) {
    return { label: 'TRAP', recommendation: 'fade' };
  }
  
  // CAUTION / MIXED SIGNALS: −30 < SES < +30
  return { label: 'CAUTION', recommendation: 'caution' };
}

function runSharpEngineV2(input: MovementInput, config: EngineConfig): EngineResult {
  const consensusRatio = input.totalBooks > 0 ? input.booksCount / input.totalBooks : 0;
  const flags = detectSignalFlags(input);
  
  // Calculate Sharp Pressure
  const sharpResult = calculateSharpPressure(input, flags, config);
  
  // Calculate Trap Pressure
  const trapResult = calculateTrapPressure(input, flags, config);
  
  // Calculate Sharp Edge Score
  const SES = calculateSES(sharpResult.SP, trapResult.TP);
  
  // Calculate Sharp Probability
  const sharpPct = calculateSharpProbability(SES, config.LOGISTIC_K);
  
  // Classify movement
  const classification = classifyMovement(SES, sharpPct, config);
  
  // Build all signals array
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
    MW: getMovementWeight(input.priceChange, config),
    TW: getTimeWeight(input.hoursToGame, config),
    label: classification.label,
    recommendation: classification.recommendation,
    sharpSignals: sharpResult.signals.map(s => s.signal),
    trapSignals: trapResult.signals.map(s => s.signal),
    allSignals,
    consensusRatio,
    movementBucket: getMovementBucket(input.priceChange),
  };
}

async function loadConfig(supabase: any): Promise<EngineConfig> {
  const { data: configRows } = await supabase
    .from('sharp_engine_config')
    .select('config_key, config_value');
  
  if (!configRows || configRows.length === 0) {
    console.log('No config found, using defaults');
    return DEFAULT_CONFIG;
  }
  
  const config = { ...DEFAULT_CONFIG };
  
  for (const row of configRows as { config_key: string; config_value: number }[]) {
    if (row.config_key in config) {
      (config as Record<string, number>)[row.config_key] = Number(row.config_value);
    }
  }
  
  return config;
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
    const { action, movementData, movementId } = body;

    // Load current config from database
    const config = await loadConfig(supabase);
    console.log('Loaded engine config:', config);

    if (action === 'analyze') {
      // Analyze a single movement
      if (!movementData) {
        return new Response(
          JSON.stringify({ error: 'movementData required for analyze action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const result = runSharpEngineV2(movementData, config);
      
      console.log('Sharp Engine V2 Result:', {
        SES: result.SES,
        sharpPct: result.sharpPct,
        label: result.label,
        SP: result.SP,
        TP: result.TP,
      });

      // If movementId provided, update the record
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
            engine_version: 'v2',
            movement_authenticity: result.label === 'SHARP' ? 'real' : result.label === 'TRAP' ? 'fake' : 'uncertain',
            recommendation: result.recommendation,
            authenticity_confidence: result.sharpPct / 100,
          })
          .eq('id', movementId);

        if (updateError) {
          console.error('Error updating movement:', updateError);
        }
      }

      return new Response(
        JSON.stringify({ success: true, result, config }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'batch_reanalyze') {
      // Re-analyze recent movements with v2 engine
      const { data: movements, error: fetchError } = await supabase
        .from('line_movements')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(100);

      if (fetchError) {
        throw fetchError;
      }

      const results = [];
      for (const movement of movements || []) {
        const hoursToGame = movement.commence_time 
          ? (new Date(movement.commence_time).getTime() - new Date(movement.detected_at).getTime()) / (1000 * 60 * 60)
          : 12;

        const input: MovementInput = {
          priceChange: movement.price_change || 0,
          lineChange: movement.point_change || 0,
          hoursToGame: Math.max(0, hoursToGame),
          booksCount: movement.books_consensus || 1,
          totalBooks: 5, // Assume 5 major books
          currentPrice: movement.new_price,
          openingPrice: movement.old_price,
          oppositeSideMoved: movement.opposite_side_moved || false,
          isSteamMove: movement.sharp_indicator?.includes('STEAM'),
        };

        const result = runSharpEngineV2(input, config);

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
            engine_version: 'v2',
            movement_authenticity: result.label === 'SHARP' ? 'real' : result.label === 'TRAP' ? 'fake' : 'uncertain',
            recommendation: result.recommendation,
            authenticity_confidence: result.sharpPct / 100,
          })
          .eq('id', movement.id);

        if (!updateError) {
          results.push({ id: movement.id, label: result.label, SES: result.SES });
        }
      }

      return new Response(
        JSON.stringify({ success: true, processed: results.length, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'get_config') {
      return new Response(
        JSON.stringify({ success: true, config }),
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
