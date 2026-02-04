import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import { HalftimeRecalibrationCard } from '../HalftimeRecalibrationCard';
import type { DeepSweetSpot, HalftimeRecalibration } from '@/types/sweetSpot';

// Mock data factories
function createMockRecalibration(overrides: Partial<HalftimeRecalibration> = {}): HalftimeRecalibration {
  return {
    actual1H: 14,
    expected1H: 12.5,
    variance1H: 12,
    historical1HRate: 0.52,
    historical2HRate: 0.48,
    halfDistribution: 0.5,
    regressionFactor: 0.92,
    linearProjection: 28,
    recalibratedProjection: 26,
    projectionDelta: 2,
    fatigueAdjustment: 0,
    paceAdjustment: 0.02,
    minutesAdjustment: 0,
    confidenceBoost: 5,
    insight: 'Player exceeded 1H baseline by 12%. Historical data shows 8% regression in 2H.',
    recommendation: 'Strong 1H suggests OVER likely to hit. Consider profit lock.',
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
    ...overrides,
  };
}

describe('HalftimeRecalibrationCard', () => {
  describe('header rendering', () => {
    it('displays HALFTIME RECALIBRATION header', () => {
      const recalibration = createMockRecalibration();
      const spot = createMockSpot();

      render(<HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />);

      expect(screen.getByText('HALFTIME RECALIBRATION')).toBeInTheDocument();
    });

    it('displays player name and bet info', () => {
      const recalibration = createMockRecalibration();
      const spot = createMockSpot({
        playerName: 'LeBron James',
        side: 'over',
        line: 25.5,
      });

      render(<HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />);

      expect(screen.getByText(/LeBron James/)).toBeInTheDocument();
      expect(screen.getByText(/OVER 25.5/)).toBeInTheDocument();
    });
  });

  describe('1st half analysis section', () => {
    it('displays actual 1H value', () => {
      const recalibration = createMockRecalibration({ actual1H: 16 });
      const spot = createMockSpot();

      render(<HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />);

      expect(screen.getByText('16')).toBeInTheDocument();
    });

    it('displays expected 1H value', () => {
      const recalibration = createMockRecalibration({ expected1H: 12.5 });
      const spot = createMockSpot();

      render(<HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />);

      expect(screen.getByText('12.5')).toBeInTheDocument();
    });

    it('displays positive variance correctly', () => {
      const recalibration = createMockRecalibration({ variance1H: 20 });
      const spot = createMockSpot();

      render(<HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />);

      expect(screen.getByText('+20%')).toBeInTheDocument();
    });

    it('displays negative variance correctly', () => {
      const recalibration = createMockRecalibration({ variance1H: -15 });
      const spot = createMockSpot();

      render(<HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />);

      expect(screen.getByText('-15%')).toBeInTheDocument();
    });
  });

  describe('2nd half projection section', () => {
    it('displays linear projection', () => {
      const recalibration = createMockRecalibration({ linearProjection: 30 });
      const spot = createMockSpot();

      render(<HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />);

      expect(screen.getByText('30')).toBeInTheDocument();
      expect(screen.getByText('(current pace)')).toBeInTheDocument();
    });

    it('displays recalibrated projection', () => {
      const recalibration = createMockRecalibration({ recalibratedProjection: 27 });
      const spot = createMockSpot();

      render(<HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />);

      expect(screen.getByText('27')).toBeInTheDocument();
      expect(screen.getByText('(history-weighted)')).toBeInTheDocument();
    });

    it('shows positive styling when recalibrated projection beats line', () => {
      const recalibration = createMockRecalibration({ recalibratedProjection: 28 });
      const spot = createMockSpot({ line: 24 });

      const { container } = render(
        <HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />
      );

      // Should have primary color for projection above line
      expect(container.querySelector('.text-primary')).toBeInTheDocument();
    });

    it('shows negative styling when recalibrated projection misses line', () => {
      const recalibration = createMockRecalibration({ recalibratedProjection: 20 });
      const spot = createMockSpot({ line: 24 });

      const { container } = render(
        <HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />
      );

      // Should have destructive color for projection below line
      expect(container.querySelector('.text-destructive')).toBeInTheDocument();
    });
  });

  describe('recalibration factors', () => {
    it('displays 1H rate', () => {
      const recalibration = createMockRecalibration({ historical1HRate: 0.58 });
      const spot = createMockSpot();

      render(<HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />);

      expect(screen.getByText('0.58/min')).toBeInTheDocument();
    });

    it('displays 2H rate', () => {
      const recalibration = createMockRecalibration({ 
        historical1HRate: 0.55, // Different from 2H to avoid collision
        historical2HRate: 0.48 
      });
      const spot = createMockSpot();

      render(<HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />);

      expect(screen.getByText('0.48/min')).toBeInTheDocument();
    });

    it('displays regression factor as percentage', () => {
      const recalibration = createMockRecalibration({ regressionFactor: 0.92 });
      const spot = createMockSpot();

      render(<HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />);

      // 1 - 0.92 = 0.08 = 8%
      expect(screen.getByText('8%')).toBeInTheDocument();
    });
  });

  describe('pace adjustment display', () => {
    it('shows pace factor when significant (>= 0.02)', () => {
      const recalibration = createMockRecalibration({ paceAdjustment: 0.05 });
      const spot = createMockSpot();

      render(<HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />);

      expect(screen.getByText('+5%')).toBeInTheDocument();
      expect(screen.getByText('(fast pace boost)')).toBeInTheDocument();
    });

    it('shows negative pace factor', () => {
      const recalibration = createMockRecalibration({ paceAdjustment: -0.04 });
      const spot = createMockSpot();

      render(<HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />);

      expect(screen.getByText('-4%')).toBeInTheDocument();
      expect(screen.getByText('(slow pace penalty)')).toBeInTheDocument();
    });

    it('hides pace factor when insignificant (< 0.02)', () => {
      const recalibration = createMockRecalibration({ paceAdjustment: 0.01 });
      const spot = createMockSpot();

      render(<HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />);

      expect(screen.queryByText('Pace Factor:')).not.toBeInTheDocument();
    });
  });

  describe('insight and recommendation', () => {
    it('displays the insight message', () => {
      const recalibration = createMockRecalibration({
        insight: 'Player exceeded 1H baseline by 15%. Expect 8% regression in 2H.',
      });
      const spot = createMockSpot();

      render(<HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />);

      expect(screen.getByText(/exceeded 1H baseline/)).toBeInTheDocument();
    });

    it('displays the recommendation with positive boost styling', () => {
      const recalibration = createMockRecalibration({
        confidenceBoost: 5,
        recommendation: 'Strong 1H suggests OVER likely to hit.',
      });
      const spot = createMockSpot();

      const { container } = render(
        <HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />
      );

      expect(screen.getByText(/Strong 1H suggests OVER/)).toBeInTheDocument();
      // Should have primary background for positive boost
      expect(container.querySelector('.bg-primary\\/20')).toBeInTheDocument();
    });

    it('displays the recommendation with negative boost styling', () => {
      const recalibration = createMockRecalibration({
        confidenceBoost: -10,
        recommendation: 'Behind at half. Need 2H burst or consider hedge.',
      });
      const spot = createMockSpot();

      const { container } = render(
        <HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />
      );

      expect(screen.getByText(/Behind at half/)).toBeInTheDocument();
      // Should have destructive background for negative boost
      expect(container.querySelector('.bg-destructive\\/20')).toBeInTheDocument();
    });

    it('displays neutral recommendation styling', () => {
      const recalibration = createMockRecalibration({
        confidenceBoost: 0,
        recommendation: 'On track. No action needed.',
      });
      const spot = createMockSpot();

      const { container } = render(
        <HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />
      );

      expect(screen.getByText(/On track/)).toBeInTheDocument();
      // Should have muted background for neutral boost
      expect(container.querySelector('.bg-muted\\/20')).toBeInTheDocument();
    });
  });

  describe('progress bar', () => {
    it('displays progress toward line', () => {
      const recalibration = createMockRecalibration({ actual1H: 12 });
      const spot = createMockSpot({ line: 24 });

      render(<HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />);

      // 12/24 = 50%
      expect(screen.getByText('12 / 24')).toBeInTheDocument();
      expect(screen.getByText('50% complete')).toBeInTheDocument();
    });

    it('caps progress at 100%', () => {
      const recalibration = createMockRecalibration({ actual1H: 28 });
      const spot = createMockSpot({ line: 24 });

      render(<HalftimeRecalibrationCard recalibration={recalibration} spot={spot} />);

      expect(screen.getByText('100% complete')).toBeInTheDocument();
    });
  });
});
