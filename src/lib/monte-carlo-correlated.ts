/**
 * Enhanced Monte Carlo Simulation with Correlation Modeling
 * 
 * Uses Gaussian Copulas and Cholesky decomposition for correlated sampling,
 * providing more realistic parlay probability estimates.
 */

import { ParlaySimulation, ParlayLeg } from '@/types/parlay';
import { 
  buildCorrelationMatrix, 
  choleskyDecomposition, 
  generateCorrelatedUniform,
  CorrelationMatrix,
  LegCorrelation 
} from './correlation-engine';
import { MonteCarloResult, UpsetFactors, UpsetStats, PayoutBucket, ProfitBucket } from './monte-carlo';

// ============= TYPES =============

export interface CorrelatedMonteCarloResult extends MonteCarloResult {
  correlationMatrix: CorrelationMatrix;
  independentWinRate: number;
  correlatedWinRate: number;
  correlationImpact: number;
  probabilityAdjustmentRatio: number;
}

export interface CorrelatedComparisonResult {
  results: CorrelatedMonteCarloResult[];
  comparisonData: CorrelatedComparisonDataPoint[];
  bestByWinRate: number;
  bestByExpectedProfit: number;
  averageCorrelationImpact: number;
}

export interface CorrelatedComparisonDataPoint {
  name: string;
  winRate: number;
  lossRate: number;
  independentWinRate: number;
  correlatedWinRate: number;
  correlationImpact: number;
  expectedProfit: number;
  potentialWin: number;
  stake: number;
  pureWinRate: number;
  upsetImpact: number;
  avgCorrelation: number;
  hasHighCorrelation: boolean;
}

// ============= DEFAULT FACTORS =============

const DEFAULT_UPSET_FACTORS: UpsetFactors = {
  underdogBoost: 0.035,
  heavyUnderdogBoost: 0.06,
  favoriteVariance: 0.025,
  chaosDayChance: 0.05,
  chaosDayMultiplier: 1.15,
};

// ============= CORE SIMULATION =============

/**
 * Calculate adjusted probability with upset factors
 */
function calculateAdjustedProbability(
  leg: ParlayLeg,
  isChaosDayActive: boolean,
  factors: UpsetFactors
): number {
  let adjustedProb = leg.impliedProbability;
  const odds = leg.odds;

  if (odds >= 500) {
    adjustedProb += factors.heavyUnderdogBoost;
  } else if (odds >= 200) {
    adjustedProb += factors.underdogBoost;
  } else if (odds > 0 && odds < 200) {
    adjustedProb += 0.02;
  } else if (odds <= -300) {
    adjustedProb -= factors.favoriteVariance;
  } else if (odds <= -200) {
    adjustedProb -= 0.015;
  }

  if (isChaosDayActive && odds > 0) {
    adjustedProb *= factors.chaosDayMultiplier;
  }

  return Math.min(0.95, Math.max(0.01, adjustedProb));
}

/**
 * Runs a correlated Monte Carlo simulation for a single parlay
 * using Gaussian Copula for leg dependency modeling
 */
export async function runCorrelatedMonteCarloSimulation(
  simulation: ParlaySimulation,
  iterations: number = 100000,
  upsetFactors: UpsetFactors = DEFAULT_UPSET_FACTORS,
  prebuiltCorrelationMatrix?: CorrelationMatrix
): Promise<CorrelatedMonteCarloResult> {
  const outcomes: number[] = [];
  let correlatedWins = 0;
  let independentWins = 0;
  let losses = 0;
  
  // Upset tracking
  let pureWins = 0;
  let upsetWins = 0;
  let chaosDayWins = 0;
  let totalChaosDays = 0;
  let totalUpsets = 0;

  // Build correlation matrix for legs
  const correlationMatrix = prebuiltCorrelationMatrix || await buildCorrelationMatrix(simulation.legs);
  const L = choleskyDecomposition(correlationMatrix.matrix);
  
  // Get adjusted probabilities for each leg
  const legProbabilities = simulation.legs.map(leg => 
    calculateAdjustedProbability(leg, false, upsetFactors)
  );
  const pureProbabilities = simulation.legs.map(leg => leg.impliedProbability);

  for (let i = 0; i < iterations; i++) {
    const isChaosDayActive = Math.random() < upsetFactors.chaosDayChance;
    if (isChaosDayActive) totalChaosDays++;

    // Chaos day adjusts probabilities
    const currentProbs = simulation.legs.map(leg =>
      calculateAdjustedProbability(leg, isChaosDayActive, upsetFactors)
    );

    // Generate correlated random numbers using Gaussian Copula
    const correlatedRandom = L ? generateCorrelatedUniform(L) : simulation.legs.map(() => Math.random());
    
    // Check correlated outcome
    let allHitCorrelated = true;
    let allHitIndependent = true;
    let allHitPure = true;
    let hadUpsetHit = false;

    for (let j = 0; j < simulation.legs.length; j++) {
      const random = correlatedRandom[j];
      const independentRandom = Math.random();
      
      // Correlated check
      if (random > currentProbs[j]) {
        allHitCorrelated = false;
      } else if (random > pureProbabilities[j]) {
        hadUpsetHit = true;
        totalUpsets++;
      }
      
      // Independent check (for comparison)
      if (independentRandom > currentProbs[j]) {
        allHitIndependent = false;
      }
      
      // Pure odds check
      if (independentRandom > pureProbabilities[j]) {
        allHitPure = false;
      }
    }

    // Track wins
    if (allHitPure) pureWins++;
    if (allHitIndependent) independentWins++;
    
    if (allHitCorrelated) {
      correlatedWins++;
      outcomes.push(simulation.potentialPayout - simulation.stake);
      
      if (hadUpsetHit || (isChaosDayActive && !allHitPure)) {
        upsetWins++;
      }
      if (isChaosDayActive) {
        chaosDayWins++;
      }
    } else {
      losses++;
      outcomes.push(-simulation.stake);
    }
  }

  // Calculate statistics
  const sortedOutcomes = [...outcomes].sort((a, b) => a - b);
  const getPercentile = (arr: number[], p: number) => {
    const index = Math.ceil((p / 100) * arr.length) - 1;
    return arr[Math.max(0, index)];
  };

  const payoutDistribution: PayoutBucket[] = [
    {
      range: `Lose $${simulation.stake.toFixed(0)}`,
      count: losses,
      percentage: (losses / iterations) * 100,
      isWin: false,
    },
    {
      range: `Win $${(simulation.potentialPayout - simulation.stake).toFixed(0)}`,
      count: correlatedWins,
      percentage: (correlatedWins / iterations) * 100,
      isWin: true,
    },
  ];

  const profitDistribution: ProfitBucket[] = [
    { outcome: -simulation.stake, frequency: losses, label: 'Loss' },
    { outcome: simulation.potentialPayout - simulation.stake, frequency: correlatedWins, label: 'Win' },
  ];

  const expectedProfit = outcomes.reduce((a, b) => a + b, 0) / iterations;
  const pureOddsWinRate = (pureWins / iterations) * 100;
  const correlatedWinRate = (correlatedWins / iterations) * 100;
  const independentWinRate = (independentWins / iterations) * 100;
  const correlationImpact = correlatedWinRate - independentWinRate;

  const upsetStats: UpsetStats = {
    totalUpsets,
    upsetWins,
    pureOddsWinRate,
    adjustedWinRate: correlatedWinRate,
    upsetImpact: correlatedWinRate - pureOddsWinRate,
    chaosDayWins,
    totalChaosDays,
  };

  return {
    parlayIndex: 0,
    simulations: iterations,
    wins: correlatedWins,
    losses,
    winRate: correlatedWinRate,
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
    upsetStats,
    correlationMatrix,
    independentWinRate,
    correlatedWinRate,
    correlationImpact,
    probabilityAdjustmentRatio: independentWinRate > 0 ? correlatedWinRate / independentWinRate : 1,
  };
}

/**
 * Runs correlated Monte Carlo for multiple parlays with comparative analysis
 */
export async function runCorrelatedComparativeSimulation(
  simulations: ParlaySimulation[],
  iterations: number = 100000
): Promise<CorrelatedComparisonResult> {
  // Build all correlation matrices in parallel
  const correlationMatrices = await Promise.all(
    simulations.map(sim => buildCorrelationMatrix(sim.legs))
  );

  // Run simulations
  const results = await Promise.all(
    simulations.map((sim, idx) =>
      runCorrelatedMonteCarloSimulation(sim, iterations, DEFAULT_UPSET_FACTORS, correlationMatrices[idx])
        .then(result => {
          result.parlayIndex = idx;
          return result;
        })
    )
  );

  // Build comparison data
  const comparisonData: CorrelatedComparisonDataPoint[] = results.map((result, idx) => ({
    name: `Parlay ${idx + 1}`,
    winRate: result.winRate,
    lossRate: 100 - result.winRate,
    independentWinRate: result.independentWinRate,
    correlatedWinRate: result.correlatedWinRate,
    correlationImpact: result.correlationImpact,
    expectedProfit: result.expectedProfit,
    potentialWin: simulations[idx].potentialPayout - simulations[idx].stake,
    stake: simulations[idx].stake,
    pureWinRate: result.upsetStats.pureOddsWinRate,
    upsetImpact: result.upsetStats.upsetImpact,
    avgCorrelation: result.correlationMatrix.avgCorrelation,
    hasHighCorrelation: result.correlationMatrix.hasHighCorrelation,
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

  const averageCorrelationImpact = 
    comparisonData.reduce((sum, d) => sum + d.correlationImpact, 0) / comparisonData.length;

  return {
    results,
    comparisonData,
    bestByWinRate,
    bestByExpectedProfit,
    averageCorrelationImpact,
  };
}

/**
 * Quick correlation analysis without full Monte Carlo
 * Useful for fast UI feedback
 */
export async function quickCorrelationAnalysis(
  legs: ParlayLeg[]
): Promise<{
  correlationMatrix: CorrelationMatrix;
  independentProbability: number;
  estimatedCorrelatedProbability: number;
  correlationAdjustment: number;
  warnings: string[];
}> {
  const correlationMatrix = await buildCorrelationMatrix(legs);
  
  // Calculate independent probability
  const independentProbability = legs.reduce((prod, leg) => prod * leg.impliedProbability, 1);
  
  // Estimate correlation impact using average correlation
  // Higher correlation generally increases joint probability for positive correlations
  const avgCorr = correlationMatrix.avgCorrelation;
  
  // Simple adjustment formula based on research
  // Positive correlation → higher joint probability (legs tend to hit together)
  const correlationAdjustment = 1 + (avgCorr * 0.3 * (legs.length - 1) / legs.length);
  const estimatedCorrelatedProbability = Math.min(0.95, independentProbability * correlationAdjustment);
  
  // Generate warnings
  const warnings: string[] = [];
  
  if (correlationMatrix.hasHighCorrelation) {
    const highCorrs = correlationMatrix.correlations.filter(c => c.correlation > 0.3);
    for (const corr of highCorrs) {
      warnings.push(
        `Legs ${corr.legIndex1 + 1} & ${corr.legIndex2 + 1} are ${(corr.correlation * 100).toFixed(0)}% correlated (${corr.correlationType.replace('_', ' ')})`
      );
    }
  }
  
  if (avgCorr > 0.2) {
    warnings.push(`Average correlation of ${(avgCorr * 100).toFixed(0)}% detected - independent odds are misleading`);
  }
  
  return {
    correlationMatrix,
    independentProbability,
    estimatedCorrelatedProbability,
    correlationAdjustment,
    warnings,
  };
}
