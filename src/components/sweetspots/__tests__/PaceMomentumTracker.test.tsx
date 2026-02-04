import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import { PaceMomentumTracker, PaceMomentumMini } from '../PaceMomentumTracker';
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
      paceRating: 102,
      currentQuarter: 2,
      quarterHistory: [],
    },
    ...overrides,
  };
}

describe('PaceMomentumTracker', () => {
  describe('rendering conditions', () => {
    it('renders for live games', () => {
      const spot = createMockSpot();
      render(<PaceMomentumTracker spot={spot} />);

      expect(screen.getByText('Pace Momentum')).toBeInTheDocument();
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
          paceRating: 105,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      render(<PaceMomentumTracker spot={spot} />);

      expect(screen.getByText('Pace Momentum')).toBeInTheDocument();
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

      const { container } = render(<PaceMomentumTracker spot={spot} />);

      expect(container.firstChild).toBeNull();
    });
  });

  describe('pace classification', () => {
    it('shows FAST label for high pace (>= 105)', () => {
      const spot = createMockSpot({
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 14,
          projectedFinal: 28,
          gameProgress: 50,
          period: '2',
          clock: '6:00',
          confidence: 70,
          riskFlags: [],
          trend: 'up',
          minutesPlayed: 24,
          ratePerMinute: 0.58,
          paceRating: 110,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      render(<PaceMomentumTracker spot={spot} />);

      // Multiple elements may have the pace value, use getAllByText
      expect(screen.getAllByText('110').length).toBeGreaterThan(0);
      expect(screen.getByText('(FAST)')).toBeInTheDocument();
    });

    it('shows AVG+ label for average-high pace (100-105)', () => {
      const spot = createMockSpot({
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
          paceRating: 102,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      render(<PaceMomentumTracker spot={spot} />);

      expect(screen.getAllByText('102').length).toBeGreaterThan(0);
      expect(screen.getByText('(AVG+)')).toBeInTheDocument();
    });

    it('shows AVG- label for average-low pace (95-100)', () => {
      const spot = createMockSpot({
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 10,
          projectedFinal: 20,
          gameProgress: 50,
          period: '2',
          clock: '6:00',
          confidence: 55,
          riskFlags: [],
          trend: 'stable',
          minutesPlayed: 24,
          ratePerMinute: 0.42,
          paceRating: 97,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      render(<PaceMomentumTracker spot={spot} />);

      expect(screen.getByText('97')).toBeInTheDocument();
      expect(screen.getByText('(AVG-)')).toBeInTheDocument();
    });

    it('shows SLOW label for low pace (< 95)', () => {
      const spot = createMockSpot({
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 8,
          projectedFinal: 16,
          gameProgress: 50,
          period: '2',
          clock: '6:00',
          confidence: 45,
          riskFlags: [],
          trend: 'down',
          minutesPlayed: 24,
          ratePerMinute: 0.33,
          paceRating: 90,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      render(<PaceMomentumTracker spot={spot} />);

      expect(screen.getByText('90')).toBeInTheDocument();
      expect(screen.getByText('(SLOW)')).toBeInTheDocument();
    });
  });

  describe('quarter labels', () => {
    it('displays all four quarter labels plus 2H prediction', () => {
      const spot = createMockSpot();
      render(<PaceMomentumTracker spot={spot} />);

      expect(screen.getByText('Q1')).toBeInTheDocument();
      expect(screen.getByText('Q2')).toBeInTheDocument();
      expect(screen.getByText('Q3')).toBeInTheDocument();
      expect(screen.getByText('Q4')).toBeInTheDocument();
      expect(screen.getByText('2H')).toBeInTheDocument();
    });
  });

  describe('prediction confidence', () => {
    it('shows high confidence at halftime with normal pace', () => {
      const spot = createMockSpot({
        liveData: {
          isLive: true,
          gameStatus: 'halftime',
          currentValue: 12,
          projectedFinal: 24,
          gameProgress: 50,
          period: '2',
          clock: '0:00',
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

      render(<PaceMomentumTracker spot={spot} />);

      expect(screen.getByText('high')).toBeInTheDocument();
    });

    it('shows medium confidence with high pace', () => {
      const spot = createMockSpot({
        liveData: {
          isLive: true,
          gameStatus: 'halftime',
          currentValue: 16,
          projectedFinal: 32,
          gameProgress: 50,
          period: '2',
          clock: '0:00',
          confidence: 70,
          riskFlags: [],
          trend: 'up',
          minutesPlayed: 24,
          ratePerMinute: 0.67,
          paceRating: 112,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      render(<PaceMomentumTracker spot={spot} />);

      expect(screen.getByText('medium')).toBeInTheDocument();
    });

    it('shows low confidence early in game', () => {
      const spot = createMockSpot({
        liveData: {
          isLive: true,
          gameStatus: 'in_progress',
          currentValue: 6,
          projectedFinal: 24,
          gameProgress: 12,
          period: '1',
          clock: '6:00',
          confidence: 50,
          riskFlags: [],
          trend: 'stable',
          minutesPlayed: 6,
          ratePerMinute: 1.0,
          paceRating: 105,
          currentQuarter: 1,
          quarterHistory: [],
        },
      });

      render(<PaceMomentumTracker spot={spot} />);

      expect(screen.getByText('low')).toBeInTheDocument();
    });
  });

  describe('pace impact messaging', () => {
    it('shows positive message for OVER with fast pace', () => {
      const spot = createMockSpot({
        side: 'over',
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
          paceRating: 108,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      render(<PaceMomentumTracker spot={spot} />);

      expect(screen.getByText(/Fast pace favors OVER/)).toBeInTheDocument();
    });

    it('shows warning message for UNDER with fast pace', () => {
      const spot = createMockSpot({
        side: 'under',
        liveData: {
          isLive: true,
          gameStatus: 'halftime',
          currentValue: 14,
          projectedFinal: 28,
          gameProgress: 50,
          period: '2',
          clock: '0:00',
          confidence: 45,
          riskFlags: ['high_pace'],
          trend: 'up',
          minutesPlayed: 24,
          ratePerMinute: 0.58,
          paceRating: 108,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      render(<PaceMomentumTracker spot={spot} />);

      expect(screen.getByText(/Fast pace challenges UNDER/)).toBeInTheDocument();
    });

    it('shows positive message for UNDER with slow pace', () => {
      const spot = createMockSpot({
        side: 'under',
        liveData: {
          isLive: true,
          gameStatus: 'halftime',
          currentValue: 8,
          projectedFinal: 16,
          gameProgress: 50,
          period: '2',
          clock: '0:00',
          confidence: 75,
          riskFlags: [],
          trend: 'stable',
          minutesPlayed: 24,
          ratePerMinute: 0.33,
          paceRating: 92,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      render(<PaceMomentumTracker spot={spot} />);

      expect(screen.getByText(/Slow pace supports UNDER/)).toBeInTheDocument();
    });

    it('shows warning message for OVER with slow pace', () => {
      const spot = createMockSpot({
        side: 'over',
        liveData: {
          isLive: true,
          gameStatus: 'halftime',
          currentValue: 8,
          projectedFinal: 16,
          gameProgress: 50,
          period: '2',
          clock: '0:00',
          confidence: 40,
          riskFlags: ['slow_pace'],
          trend: 'down',
          minutesPlayed: 24,
          ratePerMinute: 0.33,
          paceRating: 92,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      render(<PaceMomentumTracker spot={spot} />);

      expect(screen.getByText(/Slow pace challenges OVER/)).toBeInTheDocument();
    });
  });
});

describe('PaceMomentumMini', () => {
  describe('rendering conditions', () => {
    it('renders pace value for live games', () => {
      const spot = createMockSpot({
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
          paceRating: 105,
          currentQuarter: 2,
          quarterHistory: [],
        },
      });

      render(<PaceMomentumMini spot={spot} />);

      expect(screen.getByText('105')).toBeInTheDocument();
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

      const { container } = render(<PaceMomentumMini spot={spot} />);

      expect(container.firstChild).toBeNull();
    });
  });
});
