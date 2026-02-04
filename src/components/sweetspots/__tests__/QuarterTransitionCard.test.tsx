import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import { QuarterTransitionCard } from '../QuarterTransitionCard';
import type { DeepSweetSpot, QuarterTransitionAlert } from '@/types/sweetSpot';

// Mock data factories
function createMockTransition(overrides: Partial<QuarterTransitionAlert> = {}): QuarterTransitionAlert {
  return {
    type: 'quarter_transition',
    quarter: 1,
    headline: 'Q1 COMPLETE',
    status: 'on_track',
    quarterValue: 6,
    expectedQuarterValue: 6,
    paceGapPct: 0,
    currentTotal: 6,
    projectedFinal: 24,
    requiredRemaining: 18,
    requiredRate: 0.5,
    currentVelocity: 0.5,
    neededVelocity: 0.5,
    velocityDelta: 0,
    insight: 'On track. Stay patient through Q2.',
    action: '✓ HOLD - No action needed. 3 quarters remaining.',
    urgency: 'none',
    ...overrides,
  };
}

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
    ...overrides,
  };
}

describe('QuarterTransitionCard', () => {
  describe('headline rendering', () => {
    it('displays the transition headline', () => {
      const transition = createMockTransition({ headline: 'Q1 COMPLETE' });
      const spot = createMockSpot({ line: 24 });

      render(<QuarterTransitionCard transition={transition} spot={spot} />);

      expect(screen.getByText(/Q1 COMPLETE/)).toBeInTheDocument();
    });

    it('displays HALFTIME headline for Q2 transitions', () => {
      const transition = createMockTransition({
        quarter: 2,
        headline: 'HALFTIME',
      });
      const spot = createMockSpot();

      render(<QuarterTransitionCard transition={transition} spot={spot} />);

      expect(screen.getByText(/HALFTIME/)).toBeInTheDocument();
    });
  });

  describe('status badges', () => {
    it('shows AHEAD status with correct styling', () => {
      const transition = createMockTransition({
        status: 'ahead',
        paceGapPct: 25,
      });
      const spot = createMockSpot();

      render(<QuarterTransitionCard transition={transition} spot={spot} />);

      expect(screen.getByText('AHEAD')).toBeInTheDocument();
    });

    it('shows ON TRACK status', () => {
      const transition = createMockTransition({
        status: 'on_track',
        paceGapPct: 5,
      });
      const spot = createMockSpot();

      render(<QuarterTransitionCard transition={transition} spot={spot} />);

      expect(screen.getByText('ON TRACK')).toBeInTheDocument();
    });

    it('shows BEHIND status', () => {
      const transition = createMockTransition({
        status: 'behind',
        paceGapPct: -15,
      });
      const spot = createMockSpot();

      render(<QuarterTransitionCard transition={transition} spot={spot} />);

      expect(screen.getByText('BEHIND')).toBeInTheDocument();
    });

    it('shows CRITICAL status', () => {
      const transition = createMockTransition({
        status: 'critical',
        paceGapPct: -35,
      });
      const spot = createMockSpot();

      render(<QuarterTransitionCard transition={transition} spot={spot} />);

      expect(screen.getByText('CRITICAL')).toBeInTheDocument();
    });
  });

  describe('progress data display', () => {
    it('displays current total and line needed', () => {
      const transition = createMockTransition({
        quarter: 1,
        currentTotal: 8,
      });
      const spot = createMockSpot({ line: 24 });

      render(<QuarterTransitionCard transition={transition} spot={spot} />);

      expect(screen.getByText(/Q1:/)).toBeInTheDocument();
      expect(screen.getByText('8')).toBeInTheDocument();
      expect(screen.getByText('24')).toBeInTheDocument();
    });

    it('displays pace gap percentage', () => {
      const transition = createMockTransition({
        paceGapPct: 15,
      });
      const spot = createMockSpot();

      render(<QuarterTransitionCard transition={transition} spot={spot} />);

      expect(screen.getByText('+15%')).toBeInTheDocument();
    });

    it('displays negative pace gap correctly', () => {
      const transition = createMockTransition({
        paceGapPct: -20,
      });
      const spot = createMockSpot();

      render(<QuarterTransitionCard transition={transition} spot={spot} />);

      expect(screen.getByText('-20%')).toBeInTheDocument();
    });
  });

  describe('velocity comparison', () => {
    it('displays current velocity', () => {
      const transition = createMockTransition({
        currentVelocity: 0.67,
      });
      const spot = createMockSpot();

      render(<QuarterTransitionCard transition={transition} spot={spot} />);

      expect(screen.getByText('0.67')).toBeInTheDocument();
      // Multiple elements contain /min, use getAllByText
      expect(screen.getAllByText(/\/min/).length).toBeGreaterThan(0);
    });

    it('displays needed velocity', () => {
      const transition = createMockTransition({
        neededVelocity: 0.5,
      });
      const spot = createMockSpot();

      render(<QuarterTransitionCard transition={transition} spot={spot} />);

      // Multiple elements may show 0.50, check at least one exists
      expect(screen.getAllByText('0.50').length).toBeGreaterThan(0);
    });
  });

  describe('remaining stats', () => {
    it('displays required remaining value', () => {
      const transition = createMockTransition({
        requiredRemaining: 16,
      });
      const spot = createMockSpot();

      render(<QuarterTransitionCard transition={transition} spot={spot} />);

      expect(screen.getByText('16.0')).toBeInTheDocument();
    });

    it('displays projected final', () => {
      const transition = createMockTransition({
        projectedFinal: 28,
      });
      const spot = createMockSpot();

      render(<QuarterTransitionCard transition={transition} spot={spot} />);

      expect(screen.getByText('28.0')).toBeInTheDocument();
    });
  });

  describe('insight and action', () => {
    it('displays the insight message', () => {
      const transition = createMockTransition({
        insight: 'Strong Q1 start. Watch for Q2 continuation.',
      });
      const spot = createMockSpot();

      render(<QuarterTransitionCard transition={transition} spot={spot} />);

      expect(screen.getByText(/Strong Q1 start/)).toBeInTheDocument();
    });

    it('displays the action recommendation', () => {
      const transition = createMockTransition({
        action: '✓ HOLD - Strong position. 3 quarters remaining.',
      });
      const spot = createMockSpot();

      render(<QuarterTransitionCard transition={transition} spot={spot} />);

      expect(screen.getByText(/HOLD/)).toBeInTheDocument();
    });
  });

  describe('urgency styling', () => {
    it('applies high urgency styling', () => {
      const transition = createMockTransition({
        urgency: 'high',
        status: 'critical',
        action: '🚨 HEDGE RECOMMENDED',
      });
      const spot = createMockSpot();

      const { container } = render(
        <QuarterTransitionCard transition={transition} spot={spot} />
      );

      // Should have destructive styling for high urgency
      const actionDiv = container.querySelector('.bg-destructive\\/20');
      expect(actionDiv).toBeInTheDocument();
    });

    it('applies medium urgency styling', () => {
      const transition = createMockTransition({
        urgency: 'medium',
        status: 'behind',
        action: '⚠️ Watch Q2 closely',
      });
      const spot = createMockSpot();

      const { container } = render(
        <QuarterTransitionCard transition={transition} spot={spot} />
      );

      // Should have orange styling for medium urgency
      const actionDiv = container.querySelector('.bg-orange-500\\/20');
      expect(actionDiv).toBeInTheDocument();
    });

    it('applies low/none urgency styling', () => {
      const transition = createMockTransition({
        urgency: 'none',
        status: 'ahead',
        action: '✓ HOLD - Strong position',
      });
      const spot = createMockSpot();

      const { container } = render(
        <QuarterTransitionCard transition={transition} spot={spot} />
      );

      // Should have primary styling for low urgency
      const actionDiv = container.querySelector('.bg-primary\\/20');
      expect(actionDiv).toBeInTheDocument();
    });
  });
});
