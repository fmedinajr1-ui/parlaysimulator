// CHESS vs Vegas: God Mode Upset Engine Types

export interface GodModeSignal {
  name: string;
  value: number;
  weight: number;
  contribution: number;
  description: string;
  isActive: boolean;
}

export interface GodModeParlayImpact {
  evImpact: number;
  riskReduction: number;
  synergyBoost: number;
}

export interface GodModeUpsetPrediction {
  id: string;
  event_id: string;
  sport: string;
  home_team: string;
  away_team: string;
  underdog: string;
  underdog_odds: number;
  favorite: string;
  favorite_odds: number;
  commence_time: string;
  
  // Core Scores (0-100)
  final_upset_score: number;
  upset_probability: number;
  
  // Component Scores
  sharp_pct: number;
  chess_ev: number;
  upset_value_score: number;
  home_court_advantage: number;
  historical_day_boost: number;
  monte_carlo_boost: number;
  
  // Chaos Mode
  chaos_percentage: number;
  chaos_mode_active: boolean;
  
  // Classification
  confidence: 'high' | 'medium' | 'low';
  risk_level: 1 | 2 | 3 | 4 | 5;
  suggestion: 'play' | 'avoid' | 'parlay_add' | 'upset_alert';
  
  // Signals
  signals: GodModeSignal[];
  trap_on_favorite: boolean;
  
  // AI Reasoning
  ai_reasoning: string | null;
  reasons: string[];
  
  // Parlay Integration
  parlay_impact: GodModeParlayImpact;
  
  // Real-time tracking
  is_live: boolean;
  last_odds_update: string;
  odds_change_direction: 'up' | 'down' | 'stable';
  previous_odds: number | null;
  
  // Outcome tracking
  game_completed: boolean;
  was_upset: boolean | null;
  verified_at: string | null;
  
  // Timestamps
  created_at: string;
  updated_at: string;
}

export interface HomeCourtAdvantageStats {
  id: string;
  team_name: string;
  sport: string;
  home_win_rate: number;
  home_cover_rate: number;
  home_over_rate: number;
  avg_home_margin: number;
  home_upset_rate: number;
  away_upset_rate: number;
  venue_name: string | null;
  sample_size: number;
}

export interface GodModeAccuracyMetrics {
  id: string;
  sport: string | null;
  confidence_level: string;
  chaos_mode_active: boolean;
  total_predictions: number;
  correct_predictions: number;
  accuracy_rate: number;
  avg_upset_score: number;
  roi_percentage: number;
}

// God Mode calculation weights
export const GOD_MODE_WEIGHTS = {
  SHARP_PCT: 0.35,
  CHESS_EV: 0.25,
  UPSET_VALUE: 0.20,
  HOME_COURT: 0.05,
  HISTORICAL_DAY: 0.05,
  MONTE_CARLO: 0.10
} as const;

// Confidence thresholds
export const CONFIDENCE_THRESHOLDS = {
  HIGH: { minScore: 70, minSharp: 65, minChessEv: 0 },
  MEDIUM: { minScore: 45, maxScore: 69 },
  LOW: { maxScore: 44 }
} as const;

// Day-of-week multipliers
export const DAY_MULTIPLIERS: Record<number, number> = {
  0: 1.05,  // Sunday
  1: 1.10,  // Monday
  2: 1.05,  // Tuesday
  3: 1.08,  // Wednesday
  4: 1.15,  // Thursday
  5: 1.08,  // Friday
  6: 1.20   // Saturday
};

// Chaos mode threshold
export const CHAOS_THRESHOLD = 70;

// Odds sweetspot range
export const ODDS_SWEETSPOT = {
  MIN: 150,
  MAX: 400,
  OPTIMAL: 250
} as const;
