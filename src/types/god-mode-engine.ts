// Sharp vs Vegas: GOD MODE Engine Types
// Pressure Intelligence Framework for detecting True Sharp Action, Public Traps, and Market Noise

// ==================== INPUT TYPES ====================

export interface MovementData {
  juiceMovementOver: number;      // ΔJ (juice movement in points) - over side
  juiceMovementUnder: number;     // ΔJ (juice movement in points) - under side
  lineMovement: number;           // ΔL (line movement in points/half-points)
  movementSpeed: number;          // Time between moves (minutes)
  movementTiming: number;         // Hours before game
}

export interface MarketStructure {
  booksShowingMovement: number;   // Number of books showing movement
  totalBooks: number;             // Total books tracked
  consensusRatio: number;         // CR = books aligned / total books
  divergenceStrength: number;     // Divergence strength between books (0-100)
  publicOverPct: number;          // Public % on over
  publicUnderPct: number;         // Public % on under
}

export interface ContextSignals {
  injuryUncertainty: boolean;
  backToBackFatigue: boolean;
  newsWindowActive: boolean;
  publicHeavyMatchup: boolean;
  chaosDayDetected: boolean;
  lowLimitWindow: boolean;
}

export interface DirectionalFlags {
  reverseLineMovement: boolean;   // RLM
  steamMoveDetected: boolean;     // ≥15 points
  optimalZoneMove: boolean;       // 30-49 points
  priceOnlyMove: boolean;         // Juice moved, line didn't
  favoriteShortening: boolean;    // Favorite getting shorter
  bothSidesMoved: boolean;        // Both over/under juiced
  clvPositive: boolean;           // Closing Line Value positive
  clvNegative: boolean;           // Closing Line Value negative
}

export interface GodModeInput {
  propId: string;
  openingLine: number;
  openingOverPrice: number;
  openingUnderPrice: number;
  currentLine: number;
  currentOverPrice: number;
  currentUnderPrice: number;
  sport: string;
  propType: string;
  commenceTime?: string;
  movement: MovementData;
  market: MarketStructure;
  context: ContextSignals;
  flags: DirectionalFlags;
}

// ==================== PRESSURE SIGNALS ====================

// Sharp Pressure Signal Weights
export const SHARP_PRESSURE_SIGNALS = {
  REVERSE_LINE_MOVEMENT: { 
    base: 40, 
    contextMultiplier: (publicPct: number) => publicPct > 65 ? 1.25 : 1.0,
    description: 'Line moving against expected public direction'
  },
  LINE_JUICE_ALIGNMENT: { 
    base: 35, 
    contextMultiplier: (hoursToGame: number) => hoursToGame < 3 ? 1.10 : 1.0,
    description: 'Line and juice moved together (confirmed action)'
  },
  STEAM_MOVE: { 
    base: 32, 
    contextMultiplier: (books: number) => books >= 2 ? 1.20 : 1.0,
    description: 'Steam move ≥15 points detected'
  },
  OPTIMAL_ZONE_MOVE: { 
    base: 28, 
    contextMultiplier: () => 1.30,
    description: 'Movement in optimal 30-49 point zone (historically strongest)'
  },
  LATE_MONEY: { 
    base: 26, 
    contextMultiplier: (injuryUnclear: boolean) => injuryUnclear ? 1.20 : 1.0,
    description: 'Late money 1-3 hours pregame'
  },
  CLV_COMPRESSION: { 
    base: 26, 
    contextMultiplier: (trending: boolean) => trending ? 1.25 : 1.0,
    description: 'CLV positive - current price better than projected close'
  },
  MARKET_CONSENSUS: { 
    base: 24, 
    contextMultiplier: (cr: number) => cr >= 0.6 ? 1.30 : 1.0,
    description: 'Market consensus across multiple books (CR ≥ 0.6)'
  },
  SINGLE_SIDE_MOVEMENT: { 
    base: 20, 
    contextMultiplier: (lineStatic: boolean) => lineStatic ? 1.15 : 1.0,
    description: 'Single side movement only (targeted action)'
  }
} as const;

// Trap Pressure Signal Weights
export const TRAP_PRESSURE_SIGNALS = {
  BOTH_SIDES_MOVED: { 
    base: 38, 
    severityModifier: 1.25,
    description: 'Both over and under prices juiced'
  },
  PRICE_ONLY_STEAM: { 
    base: 33, 
    severityModifier: 1.30,
    description: 'Price moved without line movement'
  },
  FAVORITE_SHORTENING: { 
    base: 28, 
    severityModifier: (odds: number) => odds <= -150 ? 1.40 : 1.0,
    description: 'Heavy favorite getting shorter (public pile-on)'
  },
  INSIGNIFICANT_MOVE: { 
    base: 22, 
    severityModifier: 1.00,
    description: 'Movement under 8 points (noise territory)'
  },
  EXTREME_JUICE_WARNING: { 
    base: 22, 
    severityModifier: 1.20,
    description: 'Extreme juice ≤ -150 detected'
  },
  VERY_EARLY_ACTION: { 
    base: 16, 
    severityModifier: 1.00,
    description: 'Very early action (>6 hours out)'
  }
} as const;

// ==================== OUTPUT TYPES ====================

export interface SharpSignalBreakdown {
  name: string;
  baseWeight: number;
  contextMultiplier: number;
  finalWeight: number;
  description: string;
  isActive: boolean;
}

export interface TrapSignalBreakdown {
  name: string;
  baseWeight: number;
  severityModifier: number;
  finalWeight: number;
  description: string;
  isActive: boolean;
}

export interface GodModeAnalysis {
  // Core Pressure Metrics
  sharpPressure: number;          // SP - Total sharp pressure
  trapPressure: number;           // TP - Total trap pressure
  marketNoise: number;            // NP - Market noise pressure
  eventVolatilityModifier: number; // EVM - Volatility factor (1.00 → 1.40)
  
  // Net Score
  nmes: number;                   // Net Market Edge Score
  
  // Probability Outputs
  sharpProbability: number;       // Sharp probability (0-100%)
  trapProbability: number;        // Trap probability (0-100%)
  neutralProbability: number;     // Neutral probability (0-100%)
  
  // Strategy Integration
  strategyBoost: number;          // Strategy value boost
  godModeScore: number;           // Final GOD_MODE_SCORE = NMES + StrategyBoost
  
  // Decision
  recommendation: 'pick' | 'fade' | 'caution';
  direction: 'over' | 'under';
  confidence: number;
  
  // Detailed Breakdowns
  sharpSignals: SharpSignalBreakdown[];
  trapSignals: TrapSignalBreakdown[];
  
  // Market Analysis
  consensusRatio: number;
  consensusStrength: 'strong' | 'moderate' | 'weak' | 'divergent';
  
  // Reasoning
  reasoning: string;
  explanation: string[];
  
  // Calibration
  calibrationApplied: boolean;
  calibrationFactor: number;
}

// ==================== THRESHOLDS ====================

export const GOD_MODE_THRESHOLDS = {
  // 🟢 SHARP PICK (Confirmed Sharp Action)
  PICK: {
    sharpProbMin: 62,       // SharpProb ≥ 62%
    nmesMin: 35,            // NMES ≥ +35
    consensusMin: 0.60,     // CR ≥ 60%
    maxTrapSignals: 0       // No major trap patterns active
  },
  // 🔴 FADE (Confirmed Trap)
  FADE: {
    sharpProbMax: 35,       // SharpProb ≤ 35%
    nmesMax: -25,           // NMES ≤ -25
    minTrapSignals: 2       // At least 2 trap signals active
  },
  // ⚠️ CAUTION
  CAUTION: {
    nmesMin: -25,           // −25 < NMES < +35
    nmesMax: 35
  }
} as const;

// ==================== STRATEGY BOOST ====================

export interface StrategyContext {
  alignsWithCHESSEV: boolean;
  isParlayAnchor: boolean;
  highVolatility: boolean;
  trapProbHigh: boolean;
}

export const STRATEGY_BOOST_VALUES = {
  CHESS_EV_ALIGNMENT: 10,    // +10 if aligns with CHESS EV
  PARLAY_ANCHOR: 15,         // +15 if used as parlay anchor
  HIGH_VOLATILITY: -10,      // -10 if high volatility
  TRAP_PROB_HIGH: -20        // -20 if trap probability high
} as const;

// ==================== CONSENSUS STRENGTH ====================

export const CONSENSUS_THRESHOLDS = {
  STRONG: 0.75,      // ≥75% books aligned
  MODERATE: 0.60,    // ≥60% books aligned
  WEAK: 0.40,        // ≥40% books aligned
  DIVERGENT: 0.40    // <40% books aligned
} as const;
