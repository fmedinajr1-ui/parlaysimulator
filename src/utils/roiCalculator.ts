/**
 * Calculate betting ROI from parlay results
 */

export interface ParlayResult {
  outcome: string;
  totalOdds: number;
  stake?: number;
}

export interface ROIStats {
  totalStaked: number;
  totalReturned: number;
  netProfit: number;
  roiPercentage: number;
}

/**
 * Convert American odds to decimal odds
 */
export function americanToDecimal(americanOdds: number): number {
  if (americanOdds > 0) {
    return (americanOdds / 100) + 1;
  } else {
    return (100 / Math.abs(americanOdds)) + 1;
  }
}

/**
 * Calculate payout from American odds (assumes 1 unit stake)
 */
export function calculatePayout(americanOdds: number, stake: number = 1): number {
  const decimalOdds = americanToDecimal(americanOdds);
  return stake * decimalOdds;
}

/**
 * Calculate ROI from an array of parlay results
 */
export function calculateROI(parlays: ParlayResult[]): ROIStats {
  let totalStaked = 0;
  let totalReturned = 0;

  parlays.forEach((parlay) => {
    const stake = parlay.stake || 1;
    
    // Only count settled parlays
    if (parlay.outcome === 'won') {
      totalStaked += stake;
      totalReturned += calculatePayout(parlay.totalOdds, stake);
    } else if (parlay.outcome === 'lost') {
      totalStaked += stake;
      totalReturned += 0;
    } else if (parlay.outcome === 'push') {
      totalStaked += stake;
      totalReturned += stake; // Push returns stake
    }
    // pending, no_data, partial - don't count
  });

  const netProfit = totalReturned - totalStaked;
  const roiPercentage = totalStaked > 0 ? (netProfit / totalStaked) * 100 : 0;

  return {
    totalStaked,
    totalReturned,
    netProfit,
    roiPercentage,
  };
}

/**
 * Calculate current streak from sorted parlays (newest first)
 */
export function calculateStreak(parlays: ParlayResult[]): { type: 'W' | 'L' | 'none'; count: number } {
  const settled = parlays.filter(p => p.outcome === 'won' || p.outcome === 'lost');
  
  if (settled.length === 0) {
    return { type: 'none', count: 0 };
  }

  const firstOutcome = settled[0].outcome;
  let count = 0;

  for (const parlay of settled) {
    if (parlay.outcome === firstOutcome) {
      count++;
    } else {
      break;
    }
  }

  return {
    type: firstOutcome === 'won' ? 'W' : 'L',
    count,
  };
}

/**
 * Calculate best and worst streaks
 */
export function calculateBestWorstStreaks(parlays: ParlayResult[]): { bestWin: number; worstLoss: number } {
  const settled = parlays.filter(p => p.outcome === 'won' || p.outcome === 'lost');
  
  let bestWin = 0;
  let worstLoss = 0;
  let currentWin = 0;
  let currentLoss = 0;

  settled.forEach((parlay) => {
    if (parlay.outcome === 'won') {
      currentWin++;
      currentLoss = 0;
      bestWin = Math.max(bestWin, currentWin);
    } else {
      currentLoss++;
      currentWin = 0;
      worstLoss = Math.max(worstLoss, currentLoss);
    }
  });

  return { bestWin, worstLoss };
}

/**
 * Format units with + or - sign
 */
export function formatUnits(units: number): string {
  const formatted = Math.abs(units).toFixed(1);
  return units >= 0 ? `+${formatted}u` : `-${formatted}u`;
}
