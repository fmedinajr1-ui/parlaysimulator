import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import { QuarterProgressSparkline, QuarterProgressMini } from '../QuarterProgressSparkline';
import type { DeepSweetSpot } from '@/types/sweetSpot';

// Mock data factory
function createMockSpot(overrides: Partial<DeepSweetSpot> = {}): DeepSweetSpot {
  return {
    id: 'test-1',
    playerName: 'Test Player',
    teamName: 'Test Team',
    opponentName: 'Opponent Team',
    propType: 'points',
    side: 'over',
    line: 24,
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
      currentValue: 12,
      projectedFinal: 24,
      gameProgress: 50,
      period: '2',
      clock: '6:00',
      confidence: 65,
      riskFlags: [],
      trend: 'stable',
      minutesPlayed: 24,
      ratePerMinute: 0.5,
      paceRating: 100,
      currentQuarter: 2,
      quarterHistory: [],
    },
    ...overrides,
  };
}

describe('QuarterProgressSparkline', () => {
  describe('rendering conditions', () => {
    it('renders for live games', () => {
      const spot = createMockSpot();
      render(<QuarterProgressSparkline spot={spot} />);

      expect(screen.getByText('Quarter Progress')).toBeInTheDocument();
    });

    it('renders for halftime games', () => {
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

      render(<QuarterProgressSparkline spot={spot} />);

      expect(screen.getByText('Quarter Progress')).toBeInTheDocument();
    });

    it('does not render when not live', () => {
      const spot = createMockSpot({
        liveData: {
          isLive: false,
          gameStatus: 'scheduled',
          currentValue: 0,
          projectedFinal: 0,
          gameProgress: 0,
          period: '0',
          clock: '',
          confidence: 50,
          riskFlags: [],
          trend: 'stable',
          minutesPlayed: 0,
          ratePerMinute: 0,
          paceRating: 100,
          currentQuarter: 0,
          quarterHistory: [],
        },
      });

      const { container } = render(<QuarterProgressSparkline spot={spot} />);

      expect(container.firstChild).toBeNull();
    });

    it('does not render when liveData is undefined', () => {
      const spot = createMockSpot({ liveData: undefined });

      const { container } = render(<QuarterProgressSparkline spot={spot} />);

      expect(container.firstChild).toBeNull();
    });
  });

  describe('quarter labels', () => {
    it('displays all four quarter labels', () => {
      const spot = createMockSpot();
      render(<QuarterProgressSparkline spot={spot} />);

      expect(screen.getByText('Q1')).toBeInTheDocument();
      expect(screen.getByText('Q2')).toBeInTheDocument();
      expect(screen.getByText('Q3')).toBeInTheDocument();
      expect(screen.getByText('Q4')).toBeInTheDocument();
    });
  });

  describe('pace percentage calculation', () => {
    it('shows pace percentage at 100% when on track', () => {
      // Line: 24, at Q2 expected 12, actual 12 = 100%
      const spot = createMockSpot({
        line: 24,
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 12,
          projectedFinal: 24,
          gameProgress: 50,
          period: '2',
          clock: '6:00',
          confidence: 60,
          riskFlags: [],
          trend: 'stable',
          minutesPlayed: 24,
          ratePerMinute: 0.5,
          paceRating: 100,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      render(<QuarterProgressSparkline spot={spot} />);

      expect(screen.getByText('100% pace')).toBeInTheDocument();
    });

    it('shows pace percentage above 100% when ahead', () => {
      // Line: 24, at Q2 expected 12, actual 16 = 133%
      const spot = createMockSpot({
        line: 24,
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 16,
          projectedFinal: 32,
          gameProgress: 50,
          period: '2',
          clock: '6:00',
          confidence: 75,
          riskFlags: [],
          trend: 'up',
          minutesPlayed: 24,
          ratePerMinute: 0.67,
          paceRating: 105,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      render(<QuarterProgressSparkline spot={spot} />);

      expect(screen.getByText('133% pace')).toBeInTheDocument();
    });

    it('shows pace percentage below 100% when behind', () => {
      // Line: 24, at Q2 expected 12, actual 8 = 67%
      const spot = createMockSpot({
        line: 24,
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 8,
          projectedFinal: 16,
          gameProgress: 50,
          period: '2',
          clock: '6:00',
          confidence: 40,
          riskFlags: ['behind_pace'],
          trend: 'down',
          minutesPlayed: 24,
          ratePerMinute: 0.33,
          paceRating: 95,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      render(<QuarterProgressSparkline spot={spot} />);

      expect(screen.getByText('67% pace')).toBeInTheDocument();
    });
  });

  describe('expected per quarter display', () => {
    it('shows expected per quarter value in legend', () => {
      const spot = createMockSpot({ line: 24 }); // 24/4 = 6.0 per quarter

      render(<QuarterProgressSparkline spot={spot} />);

      expect(screen.getByText('Expected: 6.0/Q')).toBeInTheDocument();
    });

    it('handles decimal lines correctly', () => {
      const spot = createMockSpot({ line: 25.5 }); // 25.5/4 = 6.375 per quarter

      render(<QuarterProgressSparkline spot={spot} />);

      expect(screen.getByText('Expected: 6.4/Q')).toBeInTheDocument();
    });
  });
});

describe('QuarterProgressMini', () => {
  describe('rendering conditions', () => {
    it('renders for live games', () => {
      const spot = createMockSpot();
      const { container } = render(<QuarterProgressMini spot={spot} />);

      // Should render 4 quarter dots
      const dots = container.querySelectorAll('.rounded-full');
      expect(dots.length).toBe(4);
    });

    it('does not render when not live', () => {
      const spot = createMockSpot({
        liveData: {
          isLive: false,
          gameStatus: 'scheduled',
          currentValue: 0,
          projectedFinal: 0,
          gameProgress: 0,
          period: '0',
          clock: '',
          confidence: 50,
          riskFlags: [],
          trend: 'stable',
          minutesPlayed: 0,
          ratePerMinute: 0,
          paceRating: 100,
          currentQuarter: 0,
          quarterHistory: [],
        },
      });

      const { container } = render(<QuarterProgressMini spot={spot} />);

      expect(container.firstChild).toBeNull();
    });
  });

  describe('dot styling', () => {
    it('highlights current quarter with ring', () => {
      const spot = createMockSpot({
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 8,
          projectedFinal: 24,
          gameProgress: 25,
          period: '2',
          clock: '6:00',
          confidence: 60,
          riskFlags: [],
          trend: 'stable',
          minutesPlayed: 12,
          ratePerMinute: 0.67,
          paceRating: 100,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      const { container } = render(<QuarterProgressMini spot={spot} />);

      // Second dot (Q2) should have ring class
      const dots = container.querySelectorAll('.rounded-full');
      expect(dots[1]).toHaveClass('ring-1');
    });
  });
});
