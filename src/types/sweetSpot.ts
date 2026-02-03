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
