export interface PVSProp {
  id: string;
  event_id: string;
  sport: string;
  game_description: string;
  player_name: string;
  prop_type: string;
  current_line: number;
  over_price: number | null;
  under_price: number | null;
  bookmaker: string;
  commence_time: string;
  // Standard scores
  hit_rate_score: number;
  sharp_money_score: number;
  trap_score: number;
  fatigue_score: number;
  upset_score: number;
  composite_score: number;
  confidence: number;
  recommendation: string;
  recommended_side: string;
  category: string;
  // PVS scores
  pvs_confidence_score: number;
  pvs_accuracy_score: number;
  pvs_value_score: number;
  pvs_matchup_score: number;
  pvs_pace_score: number;
  pvs_minutes_score: number;
  pvs_sharp_score: number;
  pvs_injury_tax: number;
  pvs_final_score: number;
  pvs_tier: PVSTier;
  true_line: number | null;
  true_line_diff: number;
  is_active: boolean;
}

export type PVSTier = 'GOD_TIER' | 'HIGH_VALUE' | 'MED_VOLATILITY' | 'RISKY' | 'FADE' | 'uncategorized';

export interface PVSParlay {
  id: string;
  parlay_type: 'safe_2leg' | 'value_3leg';
  legs: PVSParlayLeg[];
  combined_pvs_score: number;
  combined_probability: number;
  total_odds: number;
  is_active: boolean;
  expires_at: string;
  created_at: string;
}

export interface PVSParlayLeg {
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  pvs_score: number;
  pvs_tier: string;
  odds: number | null;
}

export const PVS_TIER_CONFIG: Record<PVSTier, {
  label: string;
  emoji: string;
  color: string;
  bgColor: string;
  description: string;
}> = {
  GOD_TIER: {
    label: 'GOD TIER',
    emoji: '🏆',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/20',
    description: 'Parlay Anchor - Highest confidence pick'
  },
  HIGH_VALUE: {
    label: 'HIGH VALUE',
    emoji: '⭐',
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    description: 'Strong Secondary Leg'
  },
  MED_VOLATILITY: {
    label: 'MED VOLATILITY',
    emoji: '⚠️',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/20',
    description: 'Use Carefully'
  },
  RISKY: {
    label: 'RISKY',
    emoji: '❌',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/20',
    description: 'Only in Longshot Parlays'
  },
  FADE: {
    label: 'FADE',
    emoji: '💀',
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    description: 'Remove Completely'
  },
  uncategorized: {
    label: 'UNCATEGORIZED',
    emoji: '❓',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/20',
    description: 'Insufficient data'
  }
};

export const PVS_SCORE_COMPONENTS = [
  { key: 'pvs_confidence_score', label: 'Confidence', weight: 0.25, description: 'Recent hit rate performance' },
  { key: 'pvs_accuracy_score', label: 'Accuracy', weight: 0.25, description: 'Weighted average from last 5, 10, and season' },
  { key: 'pvs_value_score', label: 'Value', weight: 0.20, description: 'True line vs book line difference' },
  { key: 'pvs_matchup_score', label: 'Matchup', weight: 0.10, description: 'Opponent defensive weakness' },
  { key: 'pvs_pace_score', label: 'Pace', weight: 0.10, description: 'Game pace projection' },
  { key: 'pvs_minutes_score', label: 'Minutes', weight: 0.10, description: 'Role and minutes stability' },
] as const;
