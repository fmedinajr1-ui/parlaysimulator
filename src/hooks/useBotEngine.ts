/**
 * useBotEngine.ts
 * 
 * Core bot logic hook that manages the autonomous betting bot lifecycle.
 * Handles generation, settlement, learning, and activation.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getEasternDate } from '@/lib/dateUtils';
import { 
  runHybridSimulation, 
  HybridSimulationResult, 
  ParlayLegInput,
  quickHybridAnalysis,
} from '@/lib/hybrid-monte-carlo';

// ============= TYPES =============

export interface BotLeg {
  id: string;
  player_name: string;
  team_name: string;
  prop_type: string;
  line: number;
  side: 'over' | 'under' | 'home' | 'away';
  category: string;
  weight: number;
  hit_rate: number;
  american_odds?: number;
  odds_value_score?: number;
  composite_score?: number;
  outcome?: 'hit' | 'miss' | 'push' | 'pending';
  actual_value?: number;
  // Team bet fields
  type?: 'player' | 'team';
  home_team?: string;
  away_team?: string;
  bet_type?: string; // spread, total, moneyline
  // Alternate line tracking (for aggressive parlays)
  original_line?: number;           // Main book line
  selected_line?: number;           // Line we picked (may be alt)
  line_selection_reason?: string;   // 'main_line' | 'aggressive_plus_money' | 'best_ev_alt'
  odds_improvement?: number;        // How much better than main line odds
  projection_buffer?: number;       // projection - selected_line
  projected_value?: number;         // Player's projected stat value
}

export interface BotParlay {
  id: string;
  parlay_date: string;
  legs: BotLeg[];
  leg_count: number;
  combined_probability: number;
  expected_odds: number;
  simulated_win_rate: number;
  simulated_edge: number;
  simulated_sharpe: number;
  strategy_name: string;
  strategy_version?: number;
  outcome: 'pending' | 'won' | 'lost' | 'partial' | 'push';
  legs_hit: number;
  legs_missed: number;
  is_simulated: boolean;
  simulated_stake: number;
  simulated_payout: number;
  profit_loss: number;
}

export interface CategoryWeight {
  id: string;
  category: string;
  side: string;
  weight: number;
  current_hit_rate: number;
  total_picks: number;
  total_hits: number;
  is_blocked: boolean;
  block_reason: string | null;
  current_streak: number;
  best_streak: number;
  worst_streak: number;
  updated_at?: string;
}

export interface BotStrategy {
  id: string;
  strategy_name: string;
  rules: {
    min_hit_rate: number;
    min_weight: number;
    min_sim_win_rate: number;
    min_edge: number;
    min_sharpe: number;
    max_legs: number;
    iterations: number;
  };
  times_used: number;
  times_won: number;
  win_rate: number;
  roi: number;
  is_active: boolean;
}

export interface BotActivationStatus {
  id: string;
  check_date: string;
  parlays_generated: number;
  parlays_won: number;
  parlays_lost: number;
  daily_profit_loss: number;
  is_profitable_day: boolean;
  consecutive_profitable_days: number;
  is_real_mode_ready: boolean;
  simulated_bankroll: number;
  real_bankroll: number;
}

export interface BotState {
  isLoading: boolean;
  mode: 'simulated' | 'real';
  consecutiveProfitDays: number;
  simulatedBankroll: number;
  realBankroll: number;
  isRealModeReady: boolean;
  todayParlays: BotParlay[];
  categoryWeights: CategoryWeight[];
  activeStrategy: BotStrategy | null;
  activationStatus: BotActivationStatus | null;
  overallWinRate: number;
  totalParlays: number;
}

export interface WeightAdjustmentResult {
  newWeight: number;
  blocked: boolean;
  newStreak: number;
}

// ============= CONSTANTS =============

export const BOT_RULES = {
  // Category filtering
  MIN_HIT_RATE: 0.55,        // 55% minimum category hit rate
  MIN_WEIGHT: 0.8,           // Minimum weight to include category
  
  // Simulation thresholds
  MIN_SIM_WIN_RATE: 0.12,    // 12% minimum simulated win rate
  MIN_EDGE: 0.03,            // 3% minimum edge
  MIN_SHARPE: 0.5,           // Minimum Sharpe ratio
  
  // Odds filtering (NEW)
  MIN_ODDS: -200,            // Don't bet on heavy favorites
  MAX_ODDS: 200,             // Don't bet on long shots
  PREFER_PLUS_MONEY: true,   // Prioritize plus-money lines
  MIN_ODDS_VALUE_SCORE: 45,  // Minimum odds value score
  
  // Volume rules (UPDATED)
  DAILY_PARLAYS_MIN: 8,      // Minimum parlays per day
  DAILY_PARLAYS_MAX: 10,     // Maximum parlays per day
  LEG_COUNTS: [3, 4, 5, 6],  // Varying leg counts
  MAX_LEGS: 6,               // Maximum legs per parlay
  
  // Stake management
  SIMULATED_STAKE: 50,       // Default stake in simulation
  ACTIVATION_DAYS: 3,        // Days needed for real mode
  ACTIVATION_WIN_RATE: 0.60, // 60% win rate needed
  MIN_PARLAYS_ACTIVATION: 5, // Minimum parlays before activation
  MAX_BANKROLL_RISK: 0.03,   // Max 3% of bankroll per bet
  
  // Deduplication (NEW)
  MAX_PLAYER_USAGE: 2,       // Max parlays per player per day
  MAX_SAME_CATEGORY: 3,      // Max legs from same category per parlay
  MAX_SAME_TEAM: 2,          // Max players from same team per parlay
};

// Parlay profiles for diverse generation with alternate line shopping
export const PARLAY_PROFILES = [
  // Conservative - NO line shopping
  { legs: 3, strategy: 'conservative', minOddsValue: 55, minHitRate: 68, useAltLines: false },
  { legs: 3, strategy: 'conservative', minOddsValue: 55, minHitRate: 68, useAltLines: false },
  // Balanced - NO line shopping
  { legs: 4, strategy: 'balanced', minOddsValue: 50, minHitRate: 62, useAltLines: false },
  { legs: 4, strategy: 'balanced', minOddsValue: 50, minHitRate: 62, useAltLines: false },
  // Standard - SOME line shopping (only for picks with sufficient buffer)
  { legs: 5, strategy: 'standard', minOddsValue: 45, minHitRate: 58, useAltLines: true, minBufferMultiplier: 1.5 },
  { legs: 5, strategy: 'standard', minOddsValue: 45, minHitRate: 58, useAltLines: true, minBufferMultiplier: 1.5 },
  { legs: 5, strategy: 'standard', minOddsValue: 45, minHitRate: 58, useAltLines: false },
  // Aggressive - AGGRESSIVE line shopping (plus money priority)
  { legs: 6, strategy: 'aggressive', minOddsValue: 40, minHitRate: 55, useAltLines: true, minBufferMultiplier: 1.2, preferPlusMoney: true },
  { legs: 6, strategy: 'aggressive', minOddsValue: 40, minHitRate: 55, useAltLines: true, minBufferMultiplier: 1.2, preferPlusMoney: true },
  { legs: 6, strategy: 'aggressive', minOddsValue: 40, minHitRate: 55, useAltLines: true, minBufferMultiplier: 1.2, preferPlusMoney: true },
];

// Minimum projection buffer by prop type for alternate line shopping
export const MIN_BUFFER_BY_PROP: Record<string, number> = {
  points: 4.0,
  rebounds: 2.5,
  assists: 2.0,
  threes: 1.0,
  pra: 6.0,
  pts_rebs: 4.5,
  pts_asts: 4.5,
  rebs_asts: 3.0,
  steals: 0.8,
  blocks: 0.8,
  turnovers: 1.0,
};

// ============= USAGE TRACKING TYPES =============

export interface UsageTracker {
  usedPicks: Set<string>;                    // "player_prop_side"
  playerUsageCount: Map<string, number>;     // player → count
  categoryUsageCount: Map<string, number>;   // category → count
}

export function createUsageTracker(): UsageTracker {
  return {
    usedPicks: new Set(),
    playerUsageCount: new Map(),
    categoryUsageCount: new Map(),
  };
}

export function createPickKey(playerName: string, propType: string, side: string): string {
  return `${playerName}_${propType}_${side}`.toLowerCase();
}

export function canUsePick(
  playerName: string,
  propType: string,
  side: string,
  tracker: UsageTracker
): boolean {
  const key = createPickKey(playerName, propType, side);
  
  // Never reuse same pick
  if (tracker.usedPicks.has(key)) return false;
  
  // Max parlays per player
  const playerCount = tracker.playerUsageCount.get(playerName) || 0;
  if (playerCount >= BOT_RULES.MAX_PLAYER_USAGE) return false;
  
  return true;
}

export function markPickUsed(
  playerName: string,
  propType: string,
  side: string,
  category: string,
  tracker: UsageTracker
): void {
  const key = createPickKey(playerName, propType, side);
  tracker.usedPicks.add(key);
  tracker.playerUsageCount.set(playerName, (tracker.playerUsageCount.get(playerName) || 0) + 1);
  tracker.categoryUsageCount.set(category, (tracker.categoryUsageCount.get(category) || 0) + 1);
}

// ============= LEARNING FUNCTIONS (Exported for testing) =============

/**
 * Adjust category weight based on outcome
 */
export function adjustCategoryWeight(
  currentWeight: number,
  hit: boolean,
  currentStreak: number
): WeightAdjustmentResult {
  let newStreak = currentStreak;
  
  if (hit) {
    // Boost on hits, more boost for streaks
    newStreak = Math.max(1, currentStreak + 1);
    const boost = 0.02 + (Math.max(0, newStreak - 1) * 0.005);
    return {
      newWeight: Math.min(currentWeight + boost, 1.5),
      blocked: false,
      newStreak,
    };
  } else {
    // Penalty on misses
    newStreak = Math.min(-1, currentStreak - 1);
    const absStreak = Math.abs(newStreak);
    const penalty = 0.03 + ((absStreak - 1) * 0.01);
    const newWeight = currentWeight - penalty;
    
    // Auto-block if weight drops below 0.5
    if (newWeight < 0.5) {
      return { newWeight: 0, blocked: true, newStreak };
    }
    return { newWeight: Math.max(newWeight, 0.5), blocked: false, newStreak };
  }
}

/**
 * Filter categories eligible for bot picks
 */
export function filterEligibleCategories(
  categories: Array<{ category: string; hitRate: number; weight: number; is_blocked?: boolean }>
): Array<{ category: string; hitRate: number; weight: number }> {
  return categories.filter(cat => 
    cat.hitRate >= BOT_RULES.MIN_HIT_RATE * 100 && // MIN_HIT_RATE is 0.55, hitRate is in percent (55)
    cat.weight >= BOT_RULES.MIN_WEIGHT &&
    !cat.is_blocked
  );
}

/**
 * Check if bot can activate real mode
 */
export function checkActivation(params: {
  consecutiveDays: number;
  totalParlays: number;
  winRate: number;
}): boolean {
  return (
    params.consecutiveDays >= BOT_RULES.ACTIVATION_DAYS &&
    params.totalParlays >= BOT_RULES.MIN_PARLAYS_ACTIVATION &&
    params.winRate >= BOT_RULES.ACTIVATION_WIN_RATE
  );
}

/**
 * Calculate Kelly stake
 */
export function calculateKellyStake(
  winProbability: number,
  odds: number,
  bankroll: number,
  maxRisk: number = BOT_RULES.MAX_BANKROLL_RISK
): number {
  // Convert American odds to decimal
  const decimalOdds = odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
  
  // Kelly formula: (bp - q) / b where b = decimal odds - 1, p = win prob, q = 1 - p
  const b = decimalOdds - 1;
  const kelly = ((b * winProbability) - (1 - winProbability)) / b;
  
  // Half-Kelly for safety, capped at max risk
  const halfKelly = Math.max(0, kelly / 2);
  const stake = Math.min(halfKelly, maxRisk) * bankroll;
  
  return Math.round(stake * 100) / 100;
}

// ============= HOOK =============

export function useBotEngine() {
  const queryClient = useQueryClient();
  
  // Fetch today's parlays
  const { data: todayParlays = [], isLoading: parlaysLoading } = useQuery({
    queryKey: ['bot-parlays-today'],
    queryFn: async () => {
      const today = getEasternDate();
      const { data, error } = await supabase
        .from('bot_daily_parlays')
        .select('*')
        .eq('parlay_date', today)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return (data || []).map(p => ({
        ...p,
        legs: Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs as string),
      })) as BotParlay[];
    },
  });
  
  // Fetch category weights
  const { data: categoryWeights = [], isLoading: weightsLoading } = useQuery({
    queryKey: ['bot-category-weights'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bot_category_weights')
        .select('*')
        .order('weight', { ascending: false });
      
      if (error) throw error;
      return data as CategoryWeight[];
    },
  });
  
  // Fetch active strategy
  const { data: activeStrategy, isLoading: strategyLoading } = useQuery({
    queryKey: ['bot-active-strategy'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bot_strategies')
        .select('*')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      if (!data) return null;
      
      return {
        ...data,
        rules: typeof data.rules === 'string' ? JSON.parse(data.rules) : data.rules,
      } as BotStrategy;
    },
  });
  
  // Fetch activation status
  const { data: activationStatus, isLoading: activationLoading } = useQuery({
    queryKey: ['bot-activation-status'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bot_activation_status')
        .select('*')
        .order('check_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      return data as BotActivationStatus | null;
    },
  });
  
  // Fetch all parlays for stats
  const { data: allParlays = [] } = useQuery({
    queryKey: ['bot-all-parlays'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bot_daily_parlays')
        .select('outcome')
        .neq('outcome', 'pending');
      
      if (error) throw error;
      return data || [];
    },
  });
  
  // Calculate stats
  const stats = useMemo(() => {
    const total = allParlays.length;
    const wins = allParlays.filter(p => p.outcome === 'won').length;
    return {
      totalParlays: total,
      overallWinRate: total > 0 ? wins / total : 0,
    };
  }, [allParlays]);
  
  // Trigger parlay generation
  const generateParlaysMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('bot-generate-daily-parlays', {
        body: { date: getEasternDate() },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bot-parlays-today'] });
      queryClient.invalidateQueries({ queryKey: ['bot-activation-status'] });
    },
  });
  
  // Trigger settlement
  const settleParlaysMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('bot-settle-and-learn', {
        body: {},
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bot-parlays-today'] });
      queryClient.invalidateQueries({ queryKey: ['bot-category-weights'] });
      queryClient.invalidateQueries({ queryKey: ['bot-activation-status'] });
      queryClient.invalidateQueries({ queryKey: ['bot-all-parlays'] });
    },
  });
  
  // Determine mode
  const mode = activationStatus?.is_real_mode_ready ? 'real' : 'simulated';
  
  // Build state
  const state: BotState = {
    isLoading: parlaysLoading || weightsLoading || strategyLoading || activationLoading,
    mode,
    consecutiveProfitDays: activationStatus?.consecutive_profitable_days || 0,
    simulatedBankroll: activationStatus?.simulated_bankroll || 1000,
    realBankroll: activationStatus?.real_bankroll || 0,
    isRealModeReady: activationStatus?.is_real_mode_ready || false,
    todayParlays,
    categoryWeights,
    activeStrategy,
    activationStatus,
    overallWinRate: stats.overallWinRate,
    totalParlays: stats.totalParlays,
  };
  
  return {
    state,
    generateParlays: generateParlaysMutation.mutateAsync,
    settleParlays: settleParlaysMutation.mutateAsync,
    isGenerating: generateParlaysMutation.isPending,
    isSettling: settleParlaysMutation.isPending,
    refetch: () => {
      queryClient.invalidateQueries({ queryKey: ['bot-parlays-today'] });
      queryClient.invalidateQueries({ queryKey: ['bot-category-weights'] });
      queryClient.invalidateQueries({ queryKey: ['bot-activation-status'] });
    },
  };
}
