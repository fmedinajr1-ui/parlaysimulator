/**
 * Hybrid Monte Carlo Simulation Engine
 * 
 * Combines parametric screening with deep Monte Carlo simulation
 * for accurate parlay probability estimation with contextual factors.
 */

import { 
  screenPropCandidate, 
  calculatePropProbability,
  applyContextualAdjustments,
  americanToImpliedProbability,
  ContextualFactors,
  ScreeningResult,
} from './parametric-models';
import { 
  CorrelationData,
  lookupCorrelation,
} from './correlation-engine';

// ============= LOCAL CORRELATION HELPERS =============

interface SimpleLeg {
  id: string;
  sport: string;
  marketType: string;
  teamName?: string;
  playerName: string;
  gameId?: string;
}

// Build correlation matrix locally for hybrid simulation
function buildLocalCorrelationMatrix(
  legs: SimpleLeg[],
  correlationData: CorrelationData[]
): number[][] {
  const n = legs.length;
  const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
  
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1; // Self-correlation
    
    for (let j = i + 1; j < n; j++) {
      const leg1 = legs[i];
      const leg2 = legs[j];
      
      // Determine correlation type
      let correlationType = 'cross_game';
      if (leg1.playerName && leg2.playerName && 
          leg1.playerName.toLowerCase() === leg2.playerName.toLowerCase()) {
        correlationType = 'same_player';
      } else if (leg1.gameId && leg2.gameId && leg1.gameId === leg2.gameId) {
        correlationType = 'same_game';
      } else if (leg1.teamName && leg2.teamName && leg1.teamName === leg2.teamName) {
        correlationType = 'same_team';
      }
      
      // Look up correlation
      const { correlation } = lookupCorrelation(
        leg1.marketType,
        leg2.marketType,
        correlationType,
        correlationData
      );
      
      matrix[i][j] = correlation;
      matrix[j][i] = correlation;
    }
  }
  
  return matrix;
}

// Cholesky decomposition for correlated sampling
function localCholeskyDecomposition(matrix: number[][]): number[][] {
  const n = matrix.length;
  const L: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
  
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      
      if (j === i) {
        for (let k = 0; k < j; k++) {
          sum += L[j][k] * L[j][k];
        }
        const val = matrix[i][i] - sum;
        L[i][j] = val > 0 ? Math.sqrt(val) : 0.001;
      } else {
        for (let k = 0; k < j; k++) {
          sum += L[i][k] * L[j][k];
        }
        L[i][j] = L[j][j] !== 0 ? (matrix[i][j] - sum) / L[j][j] : 0;
      }
    }
  }
  
  return L;
}

// ============= TYPES =============

export interface ParlayLegInput {
  id: string;
  propType: string;
  playerName: string;
  teamName?: string;
  line: number;
  side: 'over' | 'under';
  americanOdds: number;
  expectedValue?: number;      // If known from projections
  sport: string;
  gameId?: string;
  context?: ContextualFactors;
}

export interface HybridSimulationConfig {
  iterations?: number;           // Monte Carlo iterations (default: 50000)
  useCorrelations?: boolean;     // Apply leg correlations (default: true)
  parametricWeight?: number;     // Weight for parametric estimate (default: 0.4)
  monteCarloWeight?: number;     // Weight for MC estimate (default: 0.6)
  minEdgeThreshold?: number;     // Minimum edge to include leg (default: 0)
  correlationData?: CorrelationData[];
}

export interface LegSimulationResult {
  legId: string;
  parametricProbability: number;
  monteCarloHitRate: number;
  hybridProbability: number;
  screening: ScreeningResult;
  adjustedExpectedValue: number;
  correlationImpact: number;
}

export interface HybridSimulationResult {
  // Overall parlay results
  independentWinRate: number;
  correlatedWinRate: number;
  hybridWinRate: number;
  expectedValue: number;
  
  // Leg-by-leg analysis
  legResults: LegSimulationResult[];
  
  // Risk metrics
  variance: number;
  sharpeRatio: number;
  kellyFraction: number;
  
  // Recommendations
  overallEdge: number;
  recommendation: 'strong_bet' | 'value_bet' | 'skip' | 'fade';
  confidenceLevel: number;
  
  // Simulation metadata
  iterations: number;
  correlationsApplied: boolean;
  parametricWeight: number;
}

// ============= MONTE CARLO CORE =============

// Generate correlated uniform random variables using Cholesky decomposition
function generateCorrelatedUniforms(
  correlationMatrix: number[][],
  choleskyL: number[][]
): number[] {
  const n = correlationMatrix.length;
  
  // Generate independent standard normals using Box-Muller
  const independentNormals: number[] = [];
  for (let i = 0; i < n; i++) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    independentNormals.push(z);
  }
  
  // Apply Cholesky transformation to create correlated normals
  const correlatedNormals: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      correlatedNormals[i] += choleskyL[i][j] * independentNormals[j];
    }
  }
  
  // Convert to uniform using normal CDF
  return correlatedNormals.map(z => {
    // Standard normal CDF approximation
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = z < 0 ? -1 : 1;
    const absZ = Math.abs(z);
    const t = 1.0 / (1.0 + p * absZ);
    const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absZ * absZ);
    return 0.5 * (1 + sign * y);
  });
}

// Run hybrid Monte Carlo simulation
export function runHybridSimulation(
  legs: ParlayLegInput[],
  config: HybridSimulationConfig = {}
): HybridSimulationResult {
  const {
    iterations = 50000,
    useCorrelations = true,
    parametricWeight = 0.4,
    monteCarloWeight = 0.6,
    minEdgeThreshold = 0,
    correlationData = [],
  } = config;

  if (legs.length === 0) {
    return createEmptyResult(config);
  }

  // Step 1: Parametric screening and probability estimation
  const legResults: LegSimulationResult[] = legs.map(leg => {
    const impliedProb = americanToImpliedProbability(leg.americanOdds);
    
    // Estimate expected value if not provided
    const baseEV = leg.expectedValue || estimateExpectedValue(leg);
    const adjustedEV = leg.context 
      ? applyContextualAdjustments(baseEV, leg.context)
      : baseEV;
    
    const screening = screenPropCandidate(
      leg.propType,
      adjustedEV,
      leg.line,
      leg.side,
      impliedProb,
      minEdgeThreshold,
      leg.context
    );
    
    return {
      legId: leg.id,
      parametricProbability: screening.parametricProbability,
      monteCarloHitRate: 0, // Will be filled by simulation
      hybridProbability: 0,
      screening,
      adjustedExpectedValue: adjustedEV,
      correlationImpact: 0,
    };
  });

  // Step 2: Build correlation matrix
  let correlationMatrix: number[][] = [];
  let choleskyL: number[][] = [];
  
  if (useCorrelations && legs.length > 1) {
    correlationMatrix = buildLocalCorrelationMatrix(
      legs.map(l => ({
        id: l.id,
        sport: l.sport,
        marketType: l.propType,
        teamName: l.teamName,
        playerName: l.playerName,
        gameId: l.gameId,
      })),
      correlationData
    );
    choleskyL = localCholeskyDecomposition(correlationMatrix);
  } else {
    // Identity matrix for independent simulation
    correlationMatrix = legs.map((_, i) => 
      legs.map((_, j) => i === j ? 1 : 0)
    );
    choleskyL = correlationMatrix;
  }

  // Step 3: Monte Carlo simulation
  let wins = 0;
  let independentWins = 0;
  const legHits = new Array(legs.length).fill(0);
  
  for (let i = 0; i < iterations; i++) {
    // Generate correlated random draws
    const correlatedDraws = generateCorrelatedUniforms(correlationMatrix, choleskyL);
    const independentDraws = legs.map(() => Math.random());
    
    // Check if each leg hits
    let allHitCorrelated = true;
    let allHitIndependent = true;
    
    for (let j = 0; j < legs.length; j++) {
      const prob = legResults[j].parametricProbability;
      
      // Correlated check
      if (correlatedDraws[j] > prob) {
        allHitCorrelated = false;
      } else {
        legHits[j]++;
      }
      
      // Independent check
      if (independentDraws[j] > prob) {
        allHitIndependent = false;
      }
    }
    
    if (allHitCorrelated) wins++;
    if (allHitIndependent) independentWins++;
  }

  // Step 4: Calculate results
  const correlatedWinRate = wins / iterations;
  const independentWinRate = independentWins / iterations;
  
  // Update leg results with MC hit rates
  for (let j = 0; j < legs.length; j++) {
    legResults[j].monteCarloHitRate = legHits[j] / iterations;
    legResults[j].hybridProbability = 
      (parametricWeight * legResults[j].parametricProbability) +
      (monteCarloWeight * legResults[j].monteCarloHitRate);
    
    // Calculate correlation impact
    if (useCorrelations) {
      const independentProb = legResults[j].parametricProbability;
      const correlatedProb = legResults[j].monteCarloHitRate;
      legResults[j].correlationImpact = correlatedProb - independentProb;
    }
  }

  // Hybrid win rate
  const hybridWinRate = (parametricWeight * independentWinRate) + (monteCarloWeight * correlatedWinRate);

  // Calculate expected value and risk metrics
  const totalOdds = legs.reduce((acc, leg) => {
    const decimal = leg.americanOdds > 0 
      ? (leg.americanOdds / 100) + 1 
      : (100 / Math.abs(leg.americanOdds)) + 1;
    return acc * decimal;
  }, 1);

  const expectedValue = (hybridWinRate * (totalOdds - 1)) - (1 - hybridWinRate);
  const variance = hybridWinRate * (1 - hybridWinRate) * Math.pow(totalOdds - 1, 2);
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? expectedValue / stdDev : 0;
  
  // Kelly criterion fraction
  const impliedOdds = totalOdds - 1;
  const kellyFraction = Math.max(0, (hybridWinRate * impliedOdds - (1 - hybridWinRate)) / impliedOdds);

  // Overall edge vs implied probability
  const parlayImpliedProb = 1 / totalOdds;
  const overallEdge = hybridWinRate - parlayImpliedProb;

  // Confidence level based on sample size and variance
  const confidenceLevel = Math.min(0.95, 0.5 + (iterations / 100000) + (1 / (1 + variance)));

  // Recommendation
  let recommendation: HybridSimulationResult['recommendation'];
  if (overallEdge >= 0.08 && confidenceLevel >= 0.7) {
    recommendation = 'strong_bet';
  } else if (overallEdge >= 0.03) {
    recommendation = 'value_bet';
  } else if (overallEdge <= -0.05) {
    recommendation = 'fade';
  } else {
    recommendation = 'skip';
  }

  return {
    independentWinRate,
    correlatedWinRate,
    hybridWinRate,
    expectedValue,
    legResults,
    variance,
    sharpeRatio,
    kellyFraction,
    overallEdge,
    recommendation,
    confidenceLevel,
    iterations,
    correlationsApplied: useCorrelations,
    parametricWeight,
  };
}

// ============= HELPER FUNCTIONS =============

function estimateExpectedValue(leg: ParlayLegInput): number {
  // Estimate EV from line and odds
  // If betting the over at -110, line is close to expected value
  // Adjust based on juice direction
  const impliedProb = americanToImpliedProbability(leg.americanOdds);
  
  if (leg.side === 'over') {
    // If over is juiced (lower odds), EV is likely below line
    if (impliedProb > 0.52) {
      return leg.line * 0.95;
    } else {
      return leg.line * 1.05;
    }
  } else {
    // Under juiced means EV likely above line
    if (impliedProb > 0.52) {
      return leg.line * 1.05;
    } else {
      return leg.line * 0.95;
    }
  }
}

function createEmptyResult(config: HybridSimulationConfig): HybridSimulationResult {
  return {
    independentWinRate: 0,
    correlatedWinRate: 0,
    hybridWinRate: 0,
    expectedValue: 0,
    legResults: [],
    variance: 0,
    sharpeRatio: 0,
    kellyFraction: 0,
    overallEdge: 0,
    recommendation: 'skip',
    confidenceLevel: 0,
    iterations: config.iterations || 50000,
    correlationsApplied: config.useCorrelations ?? true,
    parametricWeight: config.parametricWeight || 0.4,
  };
}

// ============= BATCH SCREENING =============

export interface BatchScreeningResult {
  totalCandidates: number;
  passedScreen: ParlayLegInput[];
  strongPicks: ParlayLegInput[];
  avoided: ParlayLegInput[];
  screeningDetails: Map<string, ScreeningResult>;
}

// Screen multiple candidates quickly using parametric models
export function batchScreenCandidates(
  candidates: ParlayLegInput[],
  minEdge: number = 0.03
): BatchScreeningResult {
  const passed: ParlayLegInput[] = [];
  const strong: ParlayLegInput[] = [];
  const avoided: ParlayLegInput[] = [];
  const details = new Map<string, ScreeningResult>();

  for (const candidate of candidates) {
    const impliedProb = americanToImpliedProbability(candidate.americanOdds);
    const baseEV = candidate.expectedValue || estimateExpectedValue(candidate);
    const adjustedEV = candidate.context 
      ? applyContextualAdjustments(baseEV, candidate.context)
      : baseEV;

    const screening = screenPropCandidate(
      candidate.propType,
      adjustedEV,
      candidate.line,
      candidate.side,
      impliedProb,
      minEdge,
      candidate.context
    );

    details.set(candidate.id, screening);

    if (screening.recommendation === 'strong_pick') {
      strong.push(candidate);
      passed.push(candidate);
    } else if (screening.passedScreen) {
      passed.push(candidate);
    } else if (screening.recommendation === 'avoid') {
      avoided.push(candidate);
    }
  }

  return {
    totalCandidates: candidates.length,
    passedScreen: passed,
    strongPicks: strong,
    avoided,
    screeningDetails: details,
  };
}

// ============= QUICK ANALYSIS =============

export interface QuickAnalysisResult {
  winProbability: number;
  edge: number;
  recommendation: string;
  keyInsights: string[];
}

// Quick hybrid analysis without full MC simulation
export function quickHybridAnalysis(legs: ParlayLegInput[]): QuickAnalysisResult {
  if (legs.length === 0) {
    return {
      winProbability: 0,
      edge: 0,
      recommendation: 'No legs provided',
      keyInsights: [],
    };
  }

  const insights: string[] = [];
  
  // Calculate individual probabilities
  let combinedProb = 1;
  let totalEdge = 0;
  let strongLegs = 0;
  let weakLegs = 0;

  for (const leg of legs) {
    const impliedProb = americanToImpliedProbability(leg.americanOdds);
    const baseEV = leg.expectedValue || estimateExpectedValue(leg);
    const result = calculatePropProbability(leg.propType, baseEV, leg.line, leg.side);
    
    combinedProb *= result.probability;
    const legEdge = result.probability - impliedProb;
    totalEdge += legEdge;

    if (legEdge >= 0.05) {
      strongLegs++;
    } else if (legEdge <= -0.03) {
      weakLegs++;
    }
  }

  // Apply correlation adjustment (approximate)
  const hasCorrelatedLegs = legs.some((l1, i) => 
    legs.some((l2, j) => i !== j && l1.gameId === l2.gameId)
  );
  
  if (hasCorrelatedLegs) {
    combinedProb *= 1.05; // Positive correlation boost
    insights.push('Same-game correlation detected (+5% boost)');
  }

  // Calculate overall parlay implied prob
  const totalOdds = legs.reduce((acc, leg) => {
    const decimal = leg.americanOdds > 0 
      ? (leg.americanOdds / 100) + 1 
      : (100 / Math.abs(leg.americanOdds)) + 1;
    return acc * decimal;
  }, 1);
  const parlayImpliedProb = 1 / totalOdds;
  const overallEdge = combinedProb - parlayImpliedProb;

  // Generate insights
  if (strongLegs > 0) {
    insights.push(`${strongLegs} leg(s) with strong edge (5%+)`);
  }
  if (weakLegs > 0) {
    insights.push(`${weakLegs} leg(s) with negative edge`);
  }
  if (legs.length >= 4) {
    insights.push('High variance: 4+ leg parlay');
  }

  // Recommendation
  let recommendation: string;
  if (overallEdge >= 0.08) {
    recommendation = 'Strong value - consider betting';
  } else if (overallEdge >= 0.03) {
    recommendation = 'Slight edge - proceed with caution';
  } else if (overallEdge <= -0.05) {
    recommendation = 'Negative edge - consider fading';
  } else {
    recommendation = 'Near fair odds - skip or reduce stake';
  }

  return {
    winProbability: combinedProb,
    edge: overallEdge,
    recommendation,
    keyInsights: insights,
  };
}
