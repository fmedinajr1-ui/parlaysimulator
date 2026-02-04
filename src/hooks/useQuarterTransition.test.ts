import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQuarterTransition, calculateQuarterTransition } from './useQuarterTransition';
import type { DeepSweetSpot, QuarterNumber } from '@/types/sweetSpot';

// Mock data factory
function createMockSpot(overrides: Partial<DeepSweetSpot> = {}): DeepSweetSpot {
  return {
    id: 'test-1',
    playerName: 'Test Player',
    teamName: 'Test Team',
    opponentName: 'Opponent Team',
    propType: 'points',
    side: 'over',
    line: 24.5,
    overPrice: -110,
    underPrice: -110,
    gameDescription: 'Test vs Opponent',
    gameTime: '2024-01-15T19:00:00Z',
    l10Stats: { min: 18, max: 32, avg: 25, median: 24, hitCount: 8, gamesPlayed: 10 },
    l5Stats: { avg: 26, gamesPlayed: 5 },
    floorProtection: 0.73,
    edge: 0.5,
    hitRateL10: 0.8,
    momentum: 'HOT',
    momentumRatio: 1.04,
    production: { statPerMinute: 0.75, avgMinutes: 34, minutesNeeded: 32.7, verdict: 'CAN_MEET' },
    h2h: null,
    h2hBoost: 0,
    juice: { price: -110, valueBoost: 0, isValuePlay: false, isTrap: false },
    usageRate: 28.5,
    usageBoost: 2,
    sweetSpotScore: 75,
    qualityTier: 'PREMIUM',
    analysisTimestamp: new Date().toISOString(),
    liveData: {
      isLive: true,
      gameStatus: 'in_progress',
      currentValue: 8,
      projectedFinal: 26,
      gameProgress: 25,
      period: '2',
      clock: '6:30',
      confidence: 65,
      riskFlags: [],
      trend: 'up',
      minutesPlayed: 12,
      ratePerMinute: 0.67,
      paceRating: 102,
      currentQuarter: 2,
      quarterHistory: [],
    },
    ...overrides,
  };
}

describe('calculateQuarterTransition', () => {
  describe('status determination for OVER bets', () => {
    it('returns "ahead" status when pace gap is >= 20%', () => {
      const spot = createMockSpot({
        side: 'over',
        line: 20,
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 8, // 8 at Q1 end, expected 5 = +60%
          projectedFinal: 32,
          gameProgress: 25,
          period: '2',
          clock: '12:00',
          confidence: 70,
          riskFlags: [],
          trend: 'up',
          minutesPlayed: 12,
          ratePerMinute: 0.67,
          paceRating: 105,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      const result = calculateQuarterTransition(spot, 1);

      expect(result.status).toBe('ahead');
      expect(result.urgency).toBe('none');
      expect(result.paceGapPct).toBeGreaterThan(20);
    });

    it('returns "on_track" status when pace gap is between -10% and 20%', () => {
      const spot = createMockSpot({
        side: 'over',
        line: 24,
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 6, // 6 at Q1 end, expected 6 = 0%
          projectedFinal: 24,
          gameProgress: 25,
          period: '2',
          clock: '12:00',
          confidence: 60,
          riskFlags: [],
          trend: 'stable',
          minutesPlayed: 12,
          ratePerMinute: 0.5,
          paceRating: 100,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      const result = calculateQuarterTransition(spot, 1);

      expect(result.status).toBe('on_track');
      expect(result.urgency).toBe('none');
    });

    it('returns "behind" status when pace gap is between -25% and -10%', () => {
      const spot = createMockSpot({
        side: 'over',
        line: 24,
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 4, // 4 at Q1 end, expected 6 = -33%
          projectedFinal: 16,
          gameProgress: 25,
          period: '2',
          clock: '12:00',
          confidence: 40,
          riskFlags: ['behind_pace'],
          trend: 'down',
          minutesPlayed: 12,
          ratePerMinute: 0.33,
          paceRating: 98,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      const result = calculateQuarterTransition(spot, 1);

      expect(result.status).toBe('critical');
      expect(result.urgency).toBe('high');
    });

    it('returns "critical" status when pace gap is < -25%', () => {
      const spot = createMockSpot({
        side: 'over',
        line: 32,
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 4, // 4 at Q1 end, expected 8 = -50%
          projectedFinal: 16,
          gameProgress: 25,
          period: '2',
          clock: '12:00',
          confidence: 25,
          riskFlags: ['critical_pace'],
          trend: 'down',
          minutesPlayed: 12,
          ratePerMinute: 0.33,
          paceRating: 95,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      const result = calculateQuarterTransition(spot, 1);

      expect(result.status).toBe('critical');
      expect(result.urgency).toBe('high');
    });
  });

  describe('status determination for UNDER bets', () => {
    it('returns "ahead" status when production is low (pace gap <= -20%)', () => {
      const spot = createMockSpot({
        side: 'under',
        line: 24,
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 3, // 3 at Q1 end, expected 6 = -50%
          projectedFinal: 12,
          gameProgress: 25,
          period: '2',
          clock: '12:00',
          confidence: 80,
          riskFlags: [],
          trend: 'stable',
          minutesPlayed: 12,
          ratePerMinute: 0.25,
          paceRating: 95,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      const result = calculateQuarterTransition(spot, 1);

      expect(result.status).toBe('ahead');
      expect(result.urgency).toBe('none');
    });

    it('returns "critical" status when production is too high for UNDER', () => {
      const spot = createMockSpot({
        side: 'under',
        line: 20,
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 10, // 10 at Q1 end, expected 5 = +100%
          projectedFinal: 40,
          gameProgress: 25,
          period: '2',
          clock: '12:00',
          confidence: 20,
          riskFlags: ['over_production'],
          trend: 'up',
          minutesPlayed: 12,
          ratePerMinute: 0.83,
          paceRating: 110,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      const result = calculateQuarterTransition(spot, 1);

      expect(result.status).toBe('critical');
      expect(result.urgency).toBe('high');
    });
  });

  describe('velocity calculations', () => {
    it('calculates current velocity correctly', () => {
      const spot = createMockSpot({
        line: 24,
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 12,
          projectedFinal: 24,
          gameProgress: 50,
          period: '3',
          clock: '12:00',
          confidence: 60,
          riskFlags: [],
          trend: 'stable',
          minutesPlayed: 24,
          ratePerMinute: 0.5,
          paceRating: 100,
          currentQuarter: 3,
          quarterHistory: [],
        },
      });

      const result = calculateQuarterTransition(spot, 2);

      // Current velocity: 12 points / 24 minutes = 0.5
      expect(result.currentVelocity).toBe(0.5);
    });

    it('calculates needed velocity for remaining quarters', () => {
      const spot = createMockSpot({
        line: 24,
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 6, // 6 points after Q1
          projectedFinal: 18,
          gameProgress: 25,
          period: '2',
          clock: '12:00',
          confidence: 50,
          riskFlags: [],
          trend: 'down',
          minutesPlayed: 12,
          ratePerMinute: 0.5,
          paceRating: 100,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      const result = calculateQuarterTransition(spot, 1);

      // Needed: (24 - 6) / (3 * 12) = 18 / 36 = 0.5
      expect(result.neededVelocity).toBe(0.5);
      expect(result.requiredRemaining).toBe(18);
    });
  });

  describe('quarter-specific insights', () => {
    it('generates Q1 insight for strong start', () => {
      const spot = createMockSpot({
        side: 'over',
        line: 20,
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 8,
          projectedFinal: 32,
          gameProgress: 25,
          period: '2',
          clock: '12:00',
          confidence: 75,
          riskFlags: [],
          trend: 'up',
          minutesPlayed: 12,
          ratePerMinute: 0.67,
          paceRating: 105,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      const result = calculateQuarterTransition(spot, 1);

      expect(result.insight).toContain('Q1');
      expect(result.quarter).toBe(1);
    });

    it('generates halftime-specific insight for Q2', () => {
      const spot = createMockSpot({
        side: 'over',
        line: 24,
        liveData: {
          isLive: true,
          gameStatus: 'halftime',
          currentValue: 14,
          projectedFinal: 28,
          gameProgress: 50,
          period: '2',
          clock: '0:00',
          confidence: 70,
          riskFlags: [],
          trend: 'up',
          minutesPlayed: 24,
          ratePerMinute: 0.58,
          paceRating: 102,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      const result = calculateQuarterTransition(spot, 2);

      expect(result.insight).toContain('half');
      expect(result.quarter).toBe(2);
    });
  });

  describe('action recommendations', () => {
    it('recommends HOLD when ahead', () => {
      const spot = createMockSpot({
        side: 'over',
        line: 20,
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 8,
          projectedFinal: 32,
          gameProgress: 25,
          period: '2',
          clock: '12:00',
          confidence: 75,
          riskFlags: [],
          trend: 'up',
          minutesPlayed: 12,
          ratePerMinute: 0.67,
          paceRating: 105,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      const result = calculateQuarterTransition(spot, 1);

      expect(result.action).toContain('HOLD');
    });

    it('recommends HEDGE when critical', () => {
      const spot = createMockSpot({
        side: 'over',
        line: 32,
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 4,
          projectedFinal: 16,
          gameProgress: 25,
          period: '2',
          clock: '12:00',
          confidence: 25,
          riskFlags: ['critical_pace'],
          trend: 'down',
          minutesPlayed: 12,
          ratePerMinute: 0.33,
          paceRating: 95,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      const result = calculateQuarterTransition(spot, 1);

      expect(result.action).toContain('HEDGE');
    });
  });
});

describe('useQuarterTransition hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns spots without transitions when no live data', () => {
    const spots = [createMockSpot({ liveData: undefined })];

    const { result } = renderHook(() => useQuarterTransition(spots));

    expect(result.current[0].liveData?.quarterTransition).toBeUndefined();
  });

  it('adds currentQuarter to live spots', () => {
    const spots = [createMockSpot()];

    const { result } = renderHook(() => useQuarterTransition(spots));

    expect(result.current[0].liveData?.currentQuarter).toBe(2);
  });

  it('handles halftime game status', () => {
    const spot = createMockSpot({
      liveData: {
        isLive: true,
        gameStatus: 'halftime',
        currentValue: 14,
        projectedFinal: 28,
        gameProgress: 50,
        period: '2',
        clock: '0:00',
        confidence: 65,
        riskFlags: [],
        trend: 'stable',
        minutesPlayed: 24,
        ratePerMinute: 0.58,
        paceRating: 100,
        currentQuarter: 2,
        quarterHistory: [],
      },
    });

    const { result } = renderHook(() => useQuarterTransition([spot]));

    // Should process halftime spots
    expect(result.current[0].liveData?.currentQuarter).toBe(2);
  });
});
