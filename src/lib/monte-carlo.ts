import { ParlaySimulation } from '@/types/parlay';

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

// Run Monte Carlo simulation for a single parlay
export function runMonteCarloSimulation(
  simulation: ParlaySimulation,
  iterations: number = 10000
): MonteCarloResult {
  const outcomes: number[] = [];
  let wins = 0;
  let losses = 0;

  for (let i = 0; i < iterations; i++) {
    // Simulate each leg
    let allLegsHit = true;
    
    for (const leg of simulation.legs) {
      const random = Math.random();
      if (random > leg.impliedProbability) {
        allLegsHit = false;
        break;
      }
    }

    if (allLegsHit) {
      wins++;
      outcomes.push(simulation.potentialPayout - simulation.stake);
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

  return {
    parlayIndex: 0,
    simulations: iterations,
    wins,
    losses,
    winRate: (wins / iterations) * 100,
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
  };
}

// Run Monte Carlo for multiple parlays and generate comparative data
export function runComparativeSimulation(
  simulations: ParlaySimulation[],
  iterations: number = 10000
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
}
