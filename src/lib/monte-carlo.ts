import { ParlaySimulation, ParlayLeg } from '@/types/parlay';

export interface UpsetFactors {
  underdogBoost: number;      // Extra % chance for underdogs (+200 to +499)
  heavyUnderdogBoost: number; // Extra % for heavy underdogs (+500 or higher)
  favoriteVariance: number;   // % chance favorites fail unexpectedly
  chaosDayChance: number;     // Chance of "upset day" affecting multiple legs
  chaosDayMultiplier: number; // Boost multiplier on chaos days
}

export interface UpsetStats {
  totalUpsets: number;
  upsetWins: number;           // Wins that only happened due to upset boost
  pureOddsWinRate: number;     // Win rate without upset factors
  adjustedWinRate: number;     // Win rate with upset factors
  upsetImpact: number;         // Difference between adjusted and pure
  chaosDayWins: number;        // Wins on chaos day scenarios
  totalChaosDays: number;      // Total chaos day scenarios
}

export interface MonteCarloResult {
  parlayIndex: number;
  simulations: number;
  wins: number;
  losses: number;
  winRate: number;
  payoutDistribution: PayoutBucket[];
  profitDistribution: ProfitBucket[];
  expectedProfit: number;
  medianOutcome: number;
  percentiles: {
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  };
  upsetStats: UpsetStats;
}

export interface PayoutBucket {
  range: string;
  count: number;
  percentage: number;
  isWin: boolean;
}

export interface ProfitBucket {
  outcome: number;
  frequency: number;
  label: string;
}

// Default upset factors based on sports betting research
const DEFAULT_UPSET_FACTORS: UpsetFactors = {
  underdogBoost: 0.035,       // +3.5% for +200 to +499 underdogs
  heavyUnderdogBoost: 0.06,   // +6% for +500+ heavy underdogs
  favoriteVariance: 0.025,    // -2.5% for heavy favorites (-300 or better)
  chaosDayChance: 0.05,       // 5% of simulations are "chaos days"
  chaosDayMultiplier: 1.15,   // 15% boost on upset days for underdogs
};

// Calculate adjusted probability with upset factors
function calculateAdjustedProbability(
  leg: ParlayLeg, 
  isChaosDayActive: boolean,
  factors: UpsetFactors = DEFAULT_UPSET_FACTORS
): number {
  let adjustedProb = leg.impliedProbability;
  const odds = leg.odds;

  // Heavy underdog boost (+500 or higher)
  if (odds >= 500) {
    adjustedProb += factors.heavyUnderdogBoost;
  }
  // Underdog boost (+200 to +499)
  else if (odds >= 200) {
    adjustedProb += factors.underdogBoost;
  }
  // Slight underdog (+100 to +199)
  else if (odds > 0 && odds < 200) {
    adjustedProb += 0.02; // +2% boost
  }
  // Heavy favorite variance (-300 or better)
  else if (odds <= -300) {
    adjustedProb -= factors.favoriteVariance; // Risk of upset
  }
  // Moderate favorite (-200 to -299)
  else if (odds <= -200) {
    adjustedProb -= 0.015; // -1.5% upset risk
  }

  // Chaos day multiplier (underdogs get boosted on chaos days)
  if (isChaosDayActive && odds > 0) {
    adjustedProb *= factors.chaosDayMultiplier;
  }

  // Cap probability between 1% and 95%
  return Math.min(0.95, Math.max(0.01, adjustedProb));
}

// Run Monte Carlo simulation for a single parlay with upset factors
export function runMonteCarloSimulation(
  simulation: ParlaySimulation,
  iterations: number = 100000,
  upsetFactors: UpsetFactors = DEFAULT_UPSET_FACTORS
): MonteCarloResult {
  const outcomes: number[] = [];
  let wins = 0;
  let losses = 0;
  
  // Pure odds tracking (without upset factors)
  let pureWins = 0;
  
  // Upset tracking
  let upsetWins = 0;
  let chaosDayWins = 0;
  let totalChaosDays = 0;
  let totalUpsets = 0;

  for (let i = 0; i < iterations; i++) {
    // Determine if this is a "chaos day" (5% chance)
    const isChaosDayActive = Math.random() < upsetFactors.chaosDayChance;
    if (isChaosDayActive) totalChaosDays++;

    // Track both pure and adjusted outcomes
    let allLegsHitPure = true;
    let allLegsHitAdjusted = true;
    let hadUpsetHit = false;

    for (const leg of simulation.legs) {
      const random = Math.random();
      const pureProb = leg.impliedProbability;
      const adjustedProb = calculateAdjustedProbability(leg, isChaosDayActive, upsetFactors);

      // Pure odds check
      if (random > pureProb) {
        allLegsHitPure = false;
      }

      // Adjusted odds check
      if (random > adjustedProb) {
        allLegsHitAdjusted = false;
      } else if (random > pureProb && random <= adjustedProb) {
        // This leg hit only because of upset boost
        hadUpsetHit = true;
        totalUpsets++;
      }
    }

    // Track pure wins
    if (allLegsHitPure) {
      pureWins++;
    }

    // Track adjusted wins
    if (allLegsHitAdjusted) {
      wins++;
      outcomes.push(simulation.potentialPayout - simulation.stake);
      
      // Was this a win due to upset factor?
      if (hadUpsetHit || (isChaosDayActive && !allLegsHitPure)) {
        upsetWins++;
      }
      
      // Chaos day win tracking
      if (isChaosDayActive) {
        chaosDayWins++;
      }
    } else {
      losses++;
      outcomes.push(-simulation.stake);
    }
  }

  // Sort outcomes for percentile calculation
  const sortedOutcomes = [...outcomes].sort((a, b) => a - b);
  
  // Calculate percentiles
  const getPercentile = (arr: number[], p: number) => {
    const index = Math.ceil((p / 100) * arr.length) - 1;
    return arr[Math.max(0, index)];
  };

  // Create payout distribution buckets
  const payoutDistribution: PayoutBucket[] = [
    {
      range: `Lose $${simulation.stake.toFixed(0)}`,
      count: losses,
      percentage: (losses / iterations) * 100,
      isWin: false,
    },
    {
      range: `Win $${(simulation.potentialPayout - simulation.stake).toFixed(0)}`,
      count: wins,
      percentage: (wins / iterations) * 100,
      isWin: true,
    },
  ];

  // Create profit distribution for chart
  const profitDistribution: ProfitBucket[] = [
    {
      outcome: -simulation.stake,
      frequency: losses,
      label: 'Loss',
    },
    {
      outcome: simulation.potentialPayout - simulation.stake,
      frequency: wins,
      label: 'Win',
    },
  ];

  // Calculate expected profit from simulation
  const expectedProfit = outcomes.reduce((a, b) => a + b, 0) / iterations;
  
  // Calculate win rates
  const pureOddsWinRate = (pureWins / iterations) * 100;
  const adjustedWinRate = (wins / iterations) * 100;

  return {
    parlayIndex: 0,
    simulations: iterations,
    wins,
    losses,
    winRate: adjustedWinRate,
    payoutDistribution,
    profitDistribution,
    expectedProfit,
    medianOutcome: getPercentile(sortedOutcomes, 50),
    percentiles: {
      p5: getPercentile(sortedOutcomes, 5),
      p25: getPercentile(sortedOutcomes, 25),
      p50: getPercentile(sortedOutcomes, 50),
      p75: getPercentile(sortedOutcomes, 75),
      p95: getPercentile(sortedOutcomes, 95),
    },
    upsetStats: {
      totalUpsets,
      upsetWins,
      pureOddsWinRate,
      adjustedWinRate,
      upsetImpact: adjustedWinRate - pureOddsWinRate,
      chaosDayWins,
      totalChaosDays,
    },
  };
}

// Run Monte Carlo for multiple parlays and generate comparative data
export function runComparativeSimulation(
  simulations: ParlaySimulation[],
  iterations: number = 100000
): {
  results: MonteCarloResult[];
  comparisonData: ComparisonDataPoint[];
  bestByWinRate: number;
  bestByExpectedProfit: number;
} {
  const results = simulations.map((sim, idx) => {
    const result = runMonteCarloSimulation(sim, iterations);
    result.parlayIndex = idx;
    return result;
  });

  // Create comparison data for stacked visualization
  const comparisonData: ComparisonDataPoint[] = results.map((result, idx) => ({
    name: `Parlay ${idx + 1}`,
    winRate: result.winRate,
    lossRate: 100 - result.winRate,
    expectedProfit: result.expectedProfit,
    potentialWin: simulations[idx].potentialPayout - simulations[idx].stake,
    stake: simulations[idx].stake,
    pureWinRate: result.upsetStats.pureOddsWinRate,
    upsetImpact: result.upsetStats.upsetImpact,
  }));

  // Find best parlays
  const bestByWinRate = results.reduce(
    (best, curr, idx) => (curr.winRate > results[best].winRate ? idx : best),
    0
  );

  const bestByExpectedProfit = results.reduce(
    (best, curr, idx) => (curr.expectedProfit > results[best].expectedProfit ? idx : best),
    0
  );

  return {
    results,
    comparisonData,
    bestByWinRate,
    bestByExpectedProfit,
  };
}

export interface ComparisonDataPoint {
  name: string;
  winRate: number;
  lossRate: number;
  expectedProfit: number;
  potentialWin: number;
  stake: number;
  pureWinRate: number;
  upsetImpact: number;
}
