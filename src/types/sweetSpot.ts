/**
 * v8.1 Deep Sweet Spots Type Definitions
 * Cross-references book lines with L10 player performance floors
 * Now includes Shot Chart vs Defense analysis
 */

export type PropType = 'points' | 'assists' | 'threes' | 'blocks';

export type ZoneType = 'restricted_area' | 'paint' | 'mid_range' | 'corner_3' | 'above_break_3';

export type DefenseRating = 'elite' | 'good' | 'average' | 'poor' | 'weak';

export type MatchupGrade = 'advantage' | 'neutral' | 'disadvantage';

export interface ZoneMatchup {
  zone: ZoneType;
  playerFrequency: number; // % of shots from this zone
  playerFgPct: number; // Player's FG% in zone
  defenseRating: DefenseRating;
  defenseRank: number; // 1-30
  matchupGrade: MatchupGrade;
  impact: number; // -10 to +10 score modifier
}

export interface ShotChartAnalysis {
  playerName: string;
  opponentName: string;
  primaryZone: ZoneType; // Where player shoots most
  primaryZonePct: number;
  zones: ZoneMatchup[];
  overallMatchupScore: number; // Weighted sum of zone impacts
  recommendation: string; // "Paint-heavy scorer vs weak interior = BOOST" etc.
}

export type QualityTier = 'ELITE' | 'PREMIUM' | 'STRONG' | 'STANDARD' | 'AVOID';

export type MinutesVerdict = 'CAN_MEET' | 'RISKY' | 'UNLIKELY';

export type MomentumTier = 'HOT' | 'NORMAL' | 'COLD';

export type HedgeStatus = 'on_track' | 'monitor' | 'alert' | 'urgent' | 'profit_lock';

export type TrendDirection = 'improving' | 'worsening' | 'stable';

export interface EnhancedHedgeAction {
  status: HedgeStatus;
  headline: string;
  message: string;
  action: string;
  urgency: 'high' | 'medium' | 'low' | 'none';
  trendDirection: TrendDirection;
  hitProbability: number;
  rateNeeded: number;
  currentRate: number;
  timeRemaining: string;
  gapToLine: number;
}

export type PickSide = 'over' | 'under';

export interface L10Stats {
  min: number;
  max: number;
  avg: number;
  median: number;
  hitCount: number; // Games that would hit the line
  gamesPlayed: number;
}

export interface L5Stats {
  avg: number;
  gamesPlayed: number;
}

export interface ProductionMetrics {
  statPerMinute: number; // stat / minutes_played
  avgMinutes: number;
  minutesNeeded: number; // line / statPerMinute
  verdict: MinutesVerdict;
}

export interface H2HData {
  opponentName: string;
  avgStat: number;
  minStat: number;
  maxStat: number;
  gamesPlayed: number;
  hitRate: number; // How often they'd hit the current line vs this opponent
}

export interface JuiceAnalysis {
  price: number; // American odds (-110, +105, etc.)
  valueBoost: number; // Scoring boost/penalty based on juice
  isValuePlay: boolean; // Plus money or light juice
  isTrap: boolean; // Heavy juice indicating book confidence
}

// Live prop data from unified-player-feed
export interface LivePropData {
  isLive: boolean;
  gameStatus?: 'in_progress' | 'halftime' | 'scheduled' | 'final';
  currentValue: number;
  projectedFinal: number;
  gameProgress: number; // 0-100
  period: string;
  clock: string;
  confidence: number;
  riskFlags: string[];
  trend: 'up' | 'down' | 'stable';
  minutesPlayed: number;
  ratePerMinute: number;
  paceRating: number; // Game pace relative to league average
  shotChartMatchup?: ShotChartAnalysis; // Zone-based matchup analysis
  currentQuarter: number;
  quarterHistory: QuarterSnapshot[];
  quarterTransition?: QuarterTransitionAlert;
  halftimeRecalibration?: HalftimeRecalibration;
  
  // Live line tracking (v7.2)
  liveBookLine?: number;        // Current book line (may differ from original)
  lineMovement?: number;        // liveBookLine - originalLine (+ = line went up, - = dropped)
  lastLineUpdate?: string;      // ISO timestamp of last line fetch
  bookmaker?: string;           // Which book the line is from (e.g., "fanduel")
  
  // Computed hedge status (v8.2)
  hedgeStatus?: HedgeStatus;    // on_track, monitor, alert, urgent, profit_lock
}

// Middle opportunity detection for hedge recommendations
export interface MiddleOpportunity {
  type: 'middle';
  lowerBound: number;           // Lower line (for UNDER hedge)
  upperBound: number;           // Upper line (for OVER original)
  profitWindow: string;         // e.g., "26 to 28"
  recommendation: string;       // Action text
}

export interface HalftimeRecalibration {
  // 1st Half Analysis
  actual1H: number;
  expected1H: number;          // Historical baseline for 1H
  variance1H: number;          // Actual - Expected as %
  
  // Baseline Patterns
  historical1HRate: number;    // Per minute rate in 1H (from L10)
  historical2HRate: number;    // Per minute rate in 2H (estimated)
  halfDistribution: number;    // % typically scored in 1H (default 0.50)
  regressionFactor: number;    // How much 2H typically drops from 1H
  
  // 2nd Half Projection
  linearProjection: number;    // Simple extrapolation
  recalibratedProjection: number; // With historical adjustments
  projectionDelta: number;     // Linear - Recalibrated
  
  // Adjustments Applied
  fatigueAdjustment: number;   // Fatigue decay factor
  paceAdjustment: number;      // Pace boost/penalty
  minutesAdjustment: number;   // Expected 2H minutes vs 1H
  
  // Final Assessment
  confidenceBoost: number;     // +/- to base confidence
  insight: string;
  recommendation: string;
}

export type QuarterNumber = 1 | 2 | 3 | 4;

export interface QuarterSnapshot {
  quarter: QuarterNumber;
  value: number;           // Stat value at end of quarter
  expectedValue: number;   // What we expected (line / 4)
  velocity: number;        // Rate in that quarter
  paceGap: number;         // +/- vs expected
  cumulative: number;      // Running total
  percentComplete: number; // 25, 50, 75, 100
}

export interface QuarterTransitionAlert {
  type: 'quarter_transition';
  quarter: QuarterNumber;
  headline: string;
  status: 'ahead' | 'on_track' | 'behind' | 'critical';
  
  // Quarter data
  quarterValue: number;
  expectedQuarterValue: number;
  paceGapPct: number;       // +22% ahead, -15% behind
  
  // Projection data
  currentTotal: number;
  projectedFinal: number;
  requiredRemaining: number;
  requiredRate: number;
  
  // Velocity comparison
  currentVelocity: number;  // Rate this quarter
  neededVelocity: number;   // Rate needed for remaining
  velocityDelta: number;    // Current vs needed
  
  // Guidance
  insight: string;
  action: string;
  urgency: 'none' | 'low' | 'medium' | 'high';
}

// v8.0: Profile-based insights derived from player behavior profiles
export interface ProfileData {
  peakQuarters: { q1: number; q2: number; q3: number; q4: number } | null;
  hasFatigueTendency: boolean;
  filmSamples: number;
  profileConfidence: number;
  matchupAdvantage: 'favorable' | 'unfavorable' | null;
  profileFlags: string[];
}

export interface DeepSweetSpot {
  id: string;
  playerName: string;
  teamName: string;
  opponentName: string;
  propType: PropType;
  side: PickSide;
  
  // Line data
  line: number;
  overPrice: number;
  underPrice: number;
  gameDescription: string;
  gameTime: string;
  
  // L10 Analysis
  l10Stats: L10Stats;
  floorProtection: number; // L10_min / line (1.0+ = perfect floor)
  edge: number; // L10_avg - line for OVER, line - L10_avg for UNDER
  hitRateL10: number; // Percentage 0-1
  
  // L5 Momentum
  l5Stats: L5Stats;
  momentum: MomentumTier;
  momentumRatio: number; // L5_avg / L10_avg
  
  // Production Analysis
  production: ProductionMetrics;
  
  // H2H Matchup
  h2h: H2HData | null;
  h2hBoost: number;
  
  // Juice/Value
  juice: JuiceAnalysis;
  
  // Usage boost (high usage = reliable volume)
  usageRate: number | null;
  usageBoost: number;
  
  // Final Scoring
  sweetSpotScore: number; // 0-100 composite score
  qualityTier: QualityTier;
  
  // Metadata
  analysisTimestamp: string;
  
  // Live data (optional - populated when game is in progress)
  liveData?: LivePropData;
  
  // v8.0: Profile-based insights (optional - populated if profile exists)
  profileData?: ProfileData;
}

export interface SweetSpotStats {
  totalPicks: number;
  eliteCount: number;
  premiumCount: number;
  strongCount: number;
  standardCount: number;
  avoidCount: number;
  uniqueTeams: number;
  byPropType: Record<PropType, number>;
}

export interface SweetSpotFilters {
  propType: PropType | 'all';
  qualityTier: QualityTier | 'all';
  sortBy: 'score' | 'floor' | 'edge' | 'juice';
  sortDirection: 'asc' | 'desc';
}

// Prop type configuration mapping
export const PROP_TYPE_CONFIG: Record<PropType, { 
  gameLogField: string; 
  matchupKey: string;
  label: string;
  shortLabel: string;
}> = {
  points: { 
    gameLogField: 'points', 
    matchupKey: 'player_points',
    label: 'Points',
    shortLabel: 'PTS'
  },
  assists: { 
    gameLogField: 'assists', 
    matchupKey: 'player_assists',
    label: 'Assists',
    shortLabel: 'AST'
  },
  threes: { 
    gameLogField: 'threes_made', 
    matchupKey: 'player_threes',
    label: '3-Pointers',
    shortLabel: '3PT'
  },
  blocks: { 
    gameLogField: 'blocks', 
    matchupKey: 'player_blocks',
    label: 'Blocks',
    shortLabel: 'BLK'
  },
};

// Quality tier thresholds
export const QUALITY_THRESHOLDS = {
  ELITE: { minFloor: 1.0, minHitRate: 1.0 },
  PREMIUM: { minFloor: 1.0, minHitRate: 0.9 },
  STRONG: { minHitRate: 0.8 },
  STANDARD: { minHitRate: 0.7 },
} as const;

// Juice value thresholds (American odds)
export const JUICE_THRESHOLDS = {
  VALUE: 100, // Plus money threshold
  LIGHT: -120, // Light juice max
  MEDIUM: -140, // Medium juice max
  // Below -140 is considered heavy/trap
} as const;
