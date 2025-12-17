/**
 * Projection Aggregator
 * 
 * Aggregates projections from multiple sources and calculates
 * optimal line recommendations using parametric models.
 */

import {
  calculatePropProbability,
  normalCDF,
  normalOverUnder,
  poissonOverUnder,
  americanToImpliedProbability,
  impliedProbabilityToAmerican,
} from './parametric-models';

// ============= TYPES =============

export interface ProjectionSource {
  source: string;
  value: number;
  confidence: number;
  sampleSize: number;
  recency: number; // 0-1, where 1 is most recent
}

export interface AggregatedProjection {
  mean: number;
  median: number;
  stdDev: number;
  confidence: number;
  sources: ProjectionSource[];
  distribution: 'normal' | 'poisson';
  weightedMean: number;
  variance: number;
}

export interface LineRecommendation {
  originalLine: number;
  originalProbability: number;
  suggestedLine: number;
  suggestedProbability: number;
  probabilityGain: number;
  oddsImpact: string;
  action: 'adjust' | 'skip' | 'keep';
  reasoning: string;
}

export interface OptimizationResult {
  playerName: string;
  propType: string;
  projection: AggregatedProjection;
  currentLine: number;
  side: 'over' | 'under';
  currentProbability: number;
  recommendation: LineRecommendation;
  alternativeLines: LineRecommendation[];
  confidenceInterval: { lower: number; upper: number };
  lastUpdated: Date;
}

// ============= INVERSE NORMAL CDF =============

/**
 * Approximation of inverse standard normal CDF (probit function)
 * Using Abramowitz and Stegun approximation
 */
function inverseStandardNormal(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  const a = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.383577518672690e2,
    -3.066479806614716e1,
    2.506628277459239e0,
  ];

  const b = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1,
  ];

  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838e0,
    -2.549732539343734e0,
    4.374664141464968e0,
    2.938163982698783e0,
  ];

  const d = [
    7.784695709041462e-3,
    3.224671290700398e-1,
    2.445134137142996e0,
    3.754408661907416e0,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let q: number, r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
}

/**
 * Find the line for a target probability using inverse normal CDF
 * P(X > L) = targetProbability => L = mean - stdDev * Z(1 - targetProbability)
 */
export function normalInverseCDF(
  probability: number,
  mean: number,
  stdDev: number
): number {
  // For P(X > L) = probability, find L
  const z = inverseStandardNormal(1 - probability);
  return mean + z * stdDev;
}

// ============= AGGREGATION FUNCTIONS =============

/**
 * Aggregate projections from multiple sources with weighted averaging
 */
export function aggregateProjections(sources: ProjectionSource[]): AggregatedProjection {
  if (sources.length === 0) {
    return {
      mean: 0,
      median: 0,
      stdDev: 0,
      confidence: 0,
      sources: [],
      distribution: 'normal',
      weightedMean: 0,
      variance: 0,
    };
  }

  // Calculate weights based on confidence, sample size, and recency
  const weights = sources.map((s) => {
    const sampleWeight = Math.log(s.sampleSize + 1) / Math.log(100); // Normalize to ~1
    const recencyWeight = 0.5 + 0.5 * s.recency; // 0.5-1.0 range
    return s.confidence * sampleWeight * recencyWeight;
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const normalizedWeights = weights.map((w) => w / totalWeight);

  // Weighted mean
  const weightedMean = sources.reduce(
    (sum, s, i) => sum + s.value * normalizedWeights[i],
    0
  );

  // Simple mean
  const mean = sources.reduce((sum, s) => sum + s.value, 0) / sources.length;

  // Median
  const sortedValues = [...sources].sort((a, b) => a.value - b.value);
  const mid = Math.floor(sortedValues.length / 2);
  const median =
    sortedValues.length % 2 !== 0
      ? sortedValues[mid].value
      : (sortedValues[mid - 1].value + sortedValues[mid].value) / 2;

  // Weighted variance
  const variance = sources.reduce(
    (sum, s, i) => sum + normalizedWeights[i] * Math.pow(s.value - weightedMean, 2),
    0
  );
  const stdDev = Math.sqrt(variance);

  // Overall confidence
  const avgConfidence =
    sources.reduce((sum, s) => sum + s.confidence, 0) / sources.length;

  // Determine distribution type
  const distribution = weightedMean < 10 ? 'poisson' : 'normal';

  return {
    mean,
    median,
    stdDev: Math.max(stdDev, weightedMean * 0.15), // Minimum 15% stdDev
    confidence: avgConfidence,
    sources,
    distribution,
    weightedMean,
    variance,
  };
}

// ============= PROBABILITY CALCULATIONS =============

/**
 * Calculate probability at a given line using the aggregated projection
 */
export function calculateProbabilityAtLine(
  projection: AggregatedProjection,
  line: number,
  side: 'over' | 'under'
): number {
  if (projection.distribution === 'poisson') {
    return poissonOverUnder(projection.weightedMean, line, side);
  }
  return normalOverUnder(projection.weightedMean, projection.stdDev, line, side);
}

/**
 * Find the optimal line for a target probability
 * Binary search for Poisson, analytical for Normal
 */
export function findOptimalLine(
  projection: AggregatedProjection,
  targetProbability: number,
  side: 'over' | 'under'
): number {
  if (projection.distribution === 'normal') {
    // Analytical solution for Normal distribution
    if (side === 'over') {
      // P(X > L) = targetProbability => L = mean - stdDev * Z(1-targetProbability)
      return normalInverseCDF(targetProbability, projection.weightedMean, projection.stdDev);
    } else {
      // P(X < L) = targetProbability => L = mean + stdDev * Z(targetProbability)
      return normalInverseCDF(1 - targetProbability, projection.weightedMean, projection.stdDev);
    }
  }

  // Binary search for Poisson distribution
  let low = 0;
  let high = projection.weightedMean * 3;
  const tolerance = 0.25; // Half-point precision

  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2;
    const prob = calculateProbabilityAtLine(projection, mid, side);

    if (Math.abs(prob - targetProbability) < 0.01) {
      return Math.round(mid * 2) / 2; // Round to nearest 0.5
    }

    if (side === 'over') {
      if (prob > targetProbability) {
        low = mid; // Need higher line to reduce probability
      } else {
        high = mid;
      }
    } else {
      if (prob > targetProbability) {
        high = mid; // Need lower line to reduce probability
      } else {
        low = mid;
      }
    }

    if (high - low < tolerance) break;
  }

  return Math.round(((low + high) / 2) * 2) / 2;
}

// ============= LINE RECOMMENDATIONS =============

/**
 * Generate line recommendation based on projection and target probability
 */
export function generateLineRecommendation(
  projection: AggregatedProjection,
  currentLine: number,
  side: 'over' | 'under',
  targetProbability: number = 0.6,
  currentOdds: number = -110
): LineRecommendation {
  const currentProbability = calculateProbabilityAtLine(projection, currentLine, side);
  const suggestedLine = findOptimalLine(projection, targetProbability, side);
  const suggestedProbability = calculateProbabilityAtLine(projection, suggestedLine, side);

  // Estimate odds change (rough approximation: ~10 points per 2.5% probability)
  const probDiff = suggestedProbability - currentProbability;
  const oddsAdjustment = Math.round(probDiff * 400); // Rough conversion
  const newOdds = currentOdds - oddsAdjustment;
  const oddsImpact = `${currentOdds} → ${newOdds > 0 ? '+' : ''}${newOdds}`;

  // Determine action
  let action: 'adjust' | 'skip' | 'keep';
  let reasoning: string;

  if (currentProbability >= targetProbability - 0.02) {
    action = 'keep';
    reasoning = `Current line already meets ${Math.round(targetProbability * 100)}% target`;
  } else if (Math.abs(suggestedLine - currentLine) > 5) {
    action = 'skip';
    reasoning = `Line adjustment too large (${Math.abs(suggestedLine - currentLine).toFixed(1)} points) - skip this prop`;
  } else {
    action = 'adjust';
    reasoning = `Adjust ${side === 'over' ? 'down' : 'up'} ${Math.abs(suggestedLine - currentLine).toFixed(1)} points to reach ${Math.round(targetProbability * 100)}%`;
  }

  return {
    originalLine: currentLine,
    originalProbability: currentProbability,
    suggestedLine,
    suggestedProbability,
    probabilityGain: suggestedProbability - currentProbability,
    oddsImpact,
    action,
    reasoning,
  };
}

/**
 * Generate multiple alternative line options
 */
export function generateAlternativeLines(
  projection: AggregatedProjection,
  currentLine: number,
  side: 'over' | 'under',
  currentOdds: number = -110
): LineRecommendation[] {
  const alternatives: LineRecommendation[] = [];
  const targetProbabilities = [0.55, 0.60, 0.65, 0.70];

  for (const target of targetProbabilities) {
    const recommendation = generateLineRecommendation(
      projection,
      currentLine,
      side,
      target,
      currentOdds
    );

    // Only add if different from current line
    if (Math.abs(recommendation.suggestedLine - currentLine) >= 0.5) {
      alternatives.push(recommendation);
    }
  }

  // Remove duplicates and sort by probability gain
  const uniqueLines = new Map<number, LineRecommendation>();
  for (const alt of alternatives) {
    const key = alt.suggestedLine;
    if (!uniqueLines.has(key) || uniqueLines.get(key)!.probabilityGain < alt.probabilityGain) {
      uniqueLines.set(key, alt);
    }
  }

  return Array.from(uniqueLines.values()).sort((a, b) => b.probabilityGain - a.probabilityGain);
}

// ============= FULL OPTIMIZATION =============

/**
 * Complete optimization for a player prop
 */
export function optimizePlayerProp(
  playerName: string,
  propType: string,
  sources: ProjectionSource[],
  currentLine: number,
  side: 'over' | 'under',
  targetProbability: number = 0.6,
  currentOdds: number = -110
): OptimizationResult {
  const projection = aggregateProjections(sources);
  const currentProbability = calculateProbabilityAtLine(projection, currentLine, side);
  const recommendation = generateLineRecommendation(
    projection,
    currentLine,
    side,
    targetProbability,
    currentOdds
  );
  const alternativeLines = generateAlternativeLines(
    projection,
    currentLine,
    side,
    currentOdds
  );

  // Calculate 95% confidence interval
  const zScore = 1.96;
  const confidenceInterval = {
    lower: projection.weightedMean - zScore * projection.stdDev,
    upper: projection.weightedMean + zScore * projection.stdDev,
  };

  return {
    playerName,
    propType,
    projection,
    currentLine,
    side,
    currentProbability,
    recommendation,
    alternativeLines,
    confidenceInterval,
    lastUpdated: new Date(),
  };
}

// ============= PARLAY OPTIMIZATION =============

export interface ParlayLegOptimization {
  legIndex: number;
  playerName: string;
  propType: string;
  originalProbability: number;
  optimizedProbability: number;
  originalLine: number;
  optimizedLine: number;
  action: 'adjust' | 'skip' | 'keep';
}

export interface ParlayOptimizationResult {
  originalParlayProbability: number;
  optimizedParlayProbability: number;
  probabilityImprovement: number;
  legs: ParlayLegOptimization[];
  recommendations: string[];
}

/**
 * Optimize an entire parlay by adjusting each leg
 */
export function optimizeParlay(
  legs: {
    playerName: string;
    propType: string;
    sources: ProjectionSource[];
    line: number;
    side: 'over' | 'under';
    odds: number;
  }[],
  targetLegProbability: number = 0.6
): ParlayOptimizationResult {
  const optimizedLegs: ParlayLegOptimization[] = [];
  const recommendations: string[] = [];

  let originalParlayProb = 1;
  let optimizedParlayProb = 1;

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const result = optimizePlayerProp(
      leg.playerName,
      leg.propType,
      leg.sources,
      leg.line,
      leg.side,
      targetLegProbability,
      leg.odds
    );

    const legOpt: ParlayLegOptimization = {
      legIndex: i,
      playerName: leg.playerName,
      propType: leg.propType,
      originalProbability: result.currentProbability,
      optimizedProbability: result.recommendation.suggestedProbability,
      originalLine: leg.line,
      optimizedLine: result.recommendation.suggestedLine,
      action: result.recommendation.action,
    };

    optimizedLegs.push(legOpt);
    originalParlayProb *= result.currentProbability;

    if (result.recommendation.action === 'skip') {
      recommendations.push(
        `⚠️ Consider removing ${leg.playerName} ${leg.propType} - no viable alternative line`
      );
      optimizedParlayProb *= result.currentProbability;
    } else if (result.recommendation.action === 'adjust') {
      recommendations.push(
        `📊 ${leg.playerName} ${leg.propType}: ${leg.side.toUpperCase()} ${leg.line} → ${result.recommendation.suggestedLine} (+${Math.round(result.recommendation.probabilityGain * 100)}%)`
      );
      optimizedParlayProb *= result.recommendation.suggestedProbability;
    } else {
      optimizedParlayProb *= result.currentProbability;
    }
  }

  return {
    originalParlayProbability: originalParlayProb,
    optimizedParlayProbability: optimizedParlayProb,
    probabilityImprovement: optimizedParlayProb - originalParlayProb,
    legs: optimizedLegs,
    recommendations,
  };
}

// ============= CHANGE DETECTION =============

export interface ProjectionChange {
  playerName: string;
  propType: string;
  previousProjection: number;
  newProjection: number;
  changePercent: number;
  previousProbability: number;
  newProbability: number;
  isSignificant: boolean;
  reason: string;
}

/**
 * Detect significant changes between projections
 */
export function detectProjectionChange(
  playerName: string,
  propType: string,
  previousSources: ProjectionSource[],
  newSources: ProjectionSource[],
  line: number,
  side: 'over' | 'under',
  significantThreshold: number = 0.05 // 5% probability change
): ProjectionChange | null {
  const previousProjection = aggregateProjections(previousSources);
  const newProjection = aggregateProjections(newSources);

  const previousProb = calculateProbabilityAtLine(previousProjection, line, side);
  const newProb = calculateProbabilityAtLine(newProjection, line, side);
  const probChange = newProb - previousProb;

  const prevMean = previousProjection.weightedMean;
  const newMean = newProjection.weightedMean;
  const changePercent = prevMean > 0 ? ((newMean - prevMean) / prevMean) * 100 : 0;

  const isSignificant = Math.abs(probChange) >= significantThreshold;

  if (!isSignificant && Math.abs(changePercent) < 5) {
    return null;
  }

  // Determine reason for change
  let reason = '';
  if (newSources.length > previousSources.length) {
    reason = 'New data source added';
  } else if (Math.abs(changePercent) > 10) {
    reason = changePercent > 0 ? 'Strong upward trend in recent data' : 'Strong downward trend in recent data';
  } else {
    reason = 'Projection updated with latest data';
  }

  return {
    playerName,
    propType,
    previousProjection: prevMean,
    newProjection: newMean,
    changePercent,
    previousProbability: previousProb,
    newProbability: newProb,
    isSignificant,
    reason,
  };
}
