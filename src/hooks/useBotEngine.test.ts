/**
 * useBotEngine.test.ts
 * 
 * Unit tests for bot engine logic functions
 */

import { describe, it, expect } from 'vitest';
import {
  adjustCategoryWeight,
  filterEligibleCategories,
  checkActivation,
  calculateKellyStake,
  BOT_RULES,
} from './useBotEngine';

describe('Bot Engine - Weight Adjustment', () => {
  it('increases weight on hit with no streak', () => {
    const result = adjustCategoryWeight(1.0, true, 0);
    expect(result.newWeight).toBeGreaterThan(1.0);
    expect(result.newWeight).toBeCloseTo(1.02, 2);
    expect(result.blocked).toBe(false);
    expect(result.newStreak).toBe(1);
  });

  it('increases weight more on hit with positive streak', () => {
    const result = adjustCategoryWeight(1.0, true, 3);
    // Should get 0.02 + (3-1) * 0.005 = 0.02 + 0.01 = 0.03 boost
    expect(result.newWeight).toBeCloseTo(1.03, 2);
    expect(result.newStreak).toBe(4);
  });

  it('decreases weight on miss with no streak', () => {
    const result = adjustCategoryWeight(1.0, false, 0);
    expect(result.newWeight).toBeLessThan(1.0);
    expect(result.newWeight).toBeCloseTo(0.97, 2);
    expect(result.blocked).toBe(false);
    expect(result.newStreak).toBe(-1);
  });

  it('decreases weight more on miss with negative streak', () => {
    const result = adjustCategoryWeight(1.0, false, -2);
    // Should get 0.03 + (2) * 0.01 = 0.05 penalty
    expect(result.newWeight).toBeCloseTo(0.95, 2);
    expect(result.newStreak).toBe(-3);
  });

  it('blocks category when weight drops below 0.5', () => {
    const result = adjustCategoryWeight(0.52, false, -3);
    expect(result.blocked).toBe(true);
    expect(result.newWeight).toBe(0);
  });

  it('caps weight at 1.5 maximum', () => {
    const result = adjustCategoryWeight(1.48, true, 5);
    expect(result.newWeight).toBe(1.5);
  });

  it('floors weight at 0.5 when not blocked', () => {
    const result = adjustCategoryWeight(0.54, false, 0);
    // Would be 0.51 but floors at 0.5
    expect(result.newWeight).toBeGreaterThanOrEqual(0.5);
    expect(result.blocked).toBe(false);
  });

  it('resets streak direction on outcome change', () => {
    // From negative streak to hit
    const result1 = adjustCategoryWeight(1.0, true, -3);
    expect(result1.newStreak).toBe(1);
    
    // From positive streak to miss
    const result2 = adjustCategoryWeight(1.0, false, 3);
    expect(result2.newStreak).toBe(-1);
  });
});

describe('Bot Engine - Category Filtering', () => {
  it('blocks categories below 55% hit rate', () => {
    const categories = filterEligibleCategories([
      { category: 'HIGH_ASSIST_UNDER', hitRate: 69, weight: 1.0 },
      { category: 'ROLE_PLAYER_REB', hitRate: 48, weight: 1.0 },
    ]);
    expect(categories.length).toBe(1);
    expect(categories[0].category).toBe('HIGH_ASSIST_UNDER');
  });

  it('blocks categories with weight < 0.8', () => {
    const categories = filterEligibleCategories([
      { category: 'HIGH_ASSIST_UNDER', hitRate: 69, weight: 1.0 },
      { category: 'BIG_ASSIST_OVER', hitRate: 60, weight: 0.6 },
    ]);
    expect(categories.length).toBe(1);
    expect(categories[0].category).toBe('HIGH_ASSIST_UNDER');
  });

  it('blocks explicitly blocked categories', () => {
    const categories = filterEligibleCategories([
      { category: 'HIGH_ASSIST_UNDER', hitRate: 69, weight: 1.0, is_blocked: false },
      { category: 'BAD_CATEGORY', hitRate: 70, weight: 1.0, is_blocked: true },
    ]);
    expect(categories.length).toBe(1);
    expect(categories[0].category).toBe('HIGH_ASSIST_UNDER');
  });

  it('includes categories at exactly 55% and 0.8 weight', () => {
    // hitRate is percentage (55 = 55%), threshold is 55 (BOT_RULES.MIN_HIT_RATE * 100)
    const categories = filterEligibleCategories([
      { category: 'EDGE_CASE', hitRate: 55.1, weight: 0.8 }, // Just above threshold
    ]);
    expect(categories.length).toBe(1);
  });

  it('returns empty array when no categories qualify', () => {
    const categories = filterEligibleCategories([
      { category: 'BAD1', hitRate: 40, weight: 1.0 },
      { category: 'BAD2', hitRate: 60, weight: 0.5 },
    ]);
    expect(categories.length).toBe(0);
  });

  it('filters multiple categories correctly', () => {
    const categories = filterEligibleCategories([
      { category: 'ELITE1', hitRate: 70, weight: 1.2 },
      { category: 'ELITE2', hitRate: 65, weight: 1.0 },
      { category: 'MARGINAL', hitRate: 56, weight: 0.85 },
      { category: 'BAD_RATE', hitRate: 50, weight: 1.0 },
      { category: 'BAD_WEIGHT', hitRate: 60, weight: 0.7 },
    ]);
    expect(categories.length).toBe(3);
    expect(categories.map(c => c.category)).toContain('ELITE1');
    expect(categories.map(c => c.category)).toContain('ELITE2');
    expect(categories.map(c => c.category)).toContain('MARGINAL');
  });
});

describe('Bot Engine - Activation Logic', () => {
  it('requires 3 consecutive profitable days', () => {
    expect(checkActivation({ consecutiveDays: 2, totalParlays: 10, winRate: 0.65 })).toBe(false);
    expect(checkActivation({ consecutiveDays: 3, totalParlays: 10, winRate: 0.65 })).toBe(true);
  });

  it('requires 60%+ overall win rate', () => {
    expect(checkActivation({ consecutiveDays: 3, totalParlays: 10, winRate: 0.55 })).toBe(false);
    expect(checkActivation({ consecutiveDays: 3, totalParlays: 10, winRate: 0.60 })).toBe(true);
  });

  it('requires minimum 5 parlays generated', () => {
    expect(checkActivation({ consecutiveDays: 3, totalParlays: 4, winRate: 0.65 })).toBe(false);
    expect(checkActivation({ consecutiveDays: 3, totalParlays: 5, winRate: 0.65 })).toBe(true);
  });

  it('fails when any condition is not met', () => {
    // Missing consecutive days
    expect(checkActivation({ consecutiveDays: 2, totalParlays: 10, winRate: 0.70 })).toBe(false);
    
    // Missing parlays
    expect(checkActivation({ consecutiveDays: 5, totalParlays: 3, winRate: 0.70 })).toBe(false);
    
    // Missing win rate
    expect(checkActivation({ consecutiveDays: 5, totalParlays: 10, winRate: 0.50 })).toBe(false);
  });

  it('passes when all conditions are met', () => {
    expect(checkActivation({ consecutiveDays: 3, totalParlays: 5, winRate: 0.60 })).toBe(true);
    expect(checkActivation({ consecutiveDays: 10, totalParlays: 50, winRate: 0.75 })).toBe(true);
  });
});

describe('Bot Engine - Kelly Stake Calculation', () => {
  it('calculates positive stake for positive edge', () => {
    // 50% win probability at +100 odds = 0 edge, should be near 0
    const stake = calculateKellyStake(0.55, 100, 1000);
    expect(stake).toBeGreaterThan(0);
  });

  it('returns 0 for negative edge', () => {
    // 40% win probability at +100 odds = negative edge
    const stake = calculateKellyStake(0.40, 100, 1000);
    expect(stake).toBe(0);
  });

  it('respects max risk cap', () => {
    // Very high edge should still cap at max risk
    const stake = calculateKellyStake(0.80, 100, 1000, 0.03);
    expect(stake).toBeLessThanOrEqual(30); // 3% of 1000
  });

  it('handles negative American odds', () => {
    // -150 odds with 70% probability should be positive edge
    // At -150: decimal = 1.667, kelly = ((0.667 * 0.70) - 0.30) / 0.667 = 0.25
    const stake = calculateKellyStake(0.70, -150, 1000);
    expect(stake).toBeGreaterThan(0);
  });

  it('scales with bankroll', () => {
    const stake1 = calculateKellyStake(0.55, 100, 1000);
    const stake2 = calculateKellyStake(0.55, 100, 2000);
    expect(stake2).toBeCloseTo(stake1 * 2, 1);
  });

  it('uses half-Kelly for safety', () => {
    // Full Kelly at 60% with +100 would be 20% of bankroll
    // Half-Kelly should be 10%, but capped at 3%
    const stake = calculateKellyStake(0.60, 100, 1000, 0.03);
    expect(stake).toBeLessThanOrEqual(30);
  });
});

describe('Bot Engine - Rule Constants', () => {
  it('has correct default values', () => {
    expect(BOT_RULES.MIN_HIT_RATE).toBe(0.55);
    expect(BOT_RULES.MIN_WEIGHT).toBe(0.8);
    expect(BOT_RULES.MIN_SIM_WIN_RATE).toBe(0.12);
    expect(BOT_RULES.MIN_EDGE).toBe(0.03);
    expect(BOT_RULES.ACTIVATION_DAYS).toBe(3);
    expect(BOT_RULES.ACTIVATION_WIN_RATE).toBe(0.60);
    expect(BOT_RULES.MIN_PARLAYS_ACTIVATION).toBe(5);
    expect(BOT_RULES.MAX_BANKROLL_RISK).toBe(0.03);
  });
});
