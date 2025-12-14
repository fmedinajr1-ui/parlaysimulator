/**
 * Calibration Engine - Brier Scores, Isotonic Regression, and Calibration Analysis
 * 
 * Provides tools for evaluating and improving probability calibration
 */

import { supabase } from '@/integrations/supabase/client';

// Types
export interface CalibrationDataPoint {
  predicted: number;
  actual: 0 | 1; // Binary outcome
  weight?: number;
}

export interface BrierDecomposition {
  brierScore: number;
  reliability: number;    // Lower is better - measures calibration
  resolution: number;     // Higher is better - measures discrimination
  uncertainty: number;    // Base rate uncertainty
  calibrationError: number; // Average calibration error
}

export interface CalibrationBucket {
  bucketStart: number;
  bucketEnd: number;
  predictedAvg: number;
  actualAvg: number;
  count: number;
  confidenceLower: number;
  confidenceUpper: number;
}

export interface IsotonicPoint {
  rawProbability: number;
  calibratedProbability: number;
}

// Calculate Brier Score: Mean squared error of probabilistic predictions
export function calculateBrierScore(predictions: CalibrationDataPoint[]): number {
  if (predictions.length === 0) return 0;
  
  const sumSquaredError = predictions.reduce((sum, p) => {
    return sum + Math.pow(p.predicted - p.actual, 2);
  }, 0);
  
  return sumSquaredError / predictions.length;
}

// Calculate Log Loss (Cross-Entropy Loss)
export function calculateLogLoss(predictions: CalibrationDataPoint[]): number {
  if (predictions.length === 0) return 0;
  
  const epsilon = 1e-15; // Prevent log(0)
  
  const sumLogLoss = predictions.reduce((sum, p) => {
    const clampedPred = Math.max(epsilon, Math.min(1 - epsilon, p.predicted));
    const loss = -(p.actual * Math.log(clampedPred) + (1 - p.actual) * Math.log(1 - clampedPred));
    return sum + loss;
  }, 0);
  
  return sumLogLoss / predictions.length;
}

// Full Brier Score Decomposition (Murphy Decomposition)
export function decomposeBrierScore(predictions: CalibrationDataPoint[], numBuckets = 10): BrierDecomposition {
  if (predictions.length === 0) {
    return { brierScore: 0, reliability: 0, resolution: 0, uncertainty: 0, calibrationError: 0 };
  }
  
  // Overall base rate
  const baseRate = predictions.reduce((sum, p) => sum + p.actual, 0) / predictions.length;
  const uncertainty = baseRate * (1 - baseRate);
  
  // Create buckets
  const buckets = createCalibrationBuckets(predictions, numBuckets);
  
  // Calculate reliability (calibration error)
  let reliability = 0;
  let resolution = 0;
  
  buckets.forEach(bucket => {
    if (bucket.count > 0) {
      const weight = bucket.count / predictions.length;
      // Reliability: weighted average of (predicted - actual)^2
      reliability += weight * Math.pow(bucket.predictedAvg - bucket.actualAvg, 2);
      // Resolution: weighted average of (actual - base_rate)^2
      resolution += weight * Math.pow(bucket.actualAvg - baseRate, 2);
    }
  });
  
  const brierScore = calculateBrierScore(predictions);
  const calibrationError = Math.sqrt(reliability);
  
  return {
    brierScore,
    reliability,
    resolution,
    uncertainty,
    calibrationError,
  };
}

// Create calibration buckets for visualization
export function createCalibrationBuckets(
  predictions: CalibrationDataPoint[],
  numBuckets = 10
): CalibrationBucket[] {
  const bucketSize = 1 / numBuckets;
  const buckets: CalibrationBucket[] = [];
  
  for (let i = 0; i < numBuckets; i++) {
    const bucketStart = i * bucketSize;
    const bucketEnd = (i + 1) * bucketSize;
    
    const bucketPreds = predictions.filter(
      p => p.predicted >= bucketStart && p.predicted < bucketEnd
    );
    
    if (bucketPreds.length > 0) {
      const predictedSum = bucketPreds.reduce((sum, p) => sum + p.predicted, 0);
      const actualSum = bucketPreds.reduce((sum, p) => sum + p.actual, 0);
      const predictedAvg = predictedSum / bucketPreds.length;
      const actualAvg = actualSum / bucketPreds.length;
      
      // Wilson score confidence interval for actual rate
      const n = bucketPreds.length;
      const z = 1.96; // 95% confidence
      const phat = actualAvg;
      const denominator = 1 + z * z / n;
      const center = (phat + z * z / (2 * n)) / denominator;
      const margin = (z * Math.sqrt((phat * (1 - phat) + z * z / (4 * n)) / n)) / denominator;
      
      buckets.push({
        bucketStart,
        bucketEnd,
        predictedAvg,
        actualAvg,
        count: bucketPreds.length,
        confidenceLower: Math.max(0, center - margin),
        confidenceUpper: Math.min(1, center + margin),
      });
    }
  }
  
  return buckets;
}

// Isotonic Regression for probability calibration
// Uses Pool Adjacent Violators Algorithm (PAVA)
export function isotonicRegression(predictions: CalibrationDataPoint[]): IsotonicPoint[] {
  if (predictions.length === 0) return [];
  
  // Sort by predicted probability
  const sorted = [...predictions].sort((a, b) => a.predicted - b.predicted);
  
  // Initialize blocks: each prediction starts as its own block
  interface Block {
    predicted: number[];
    actual: number[];
    weight: number;
    value: number;
  }
  
  let blocks: Block[] = sorted.map(p => ({
    predicted: [p.predicted],
    actual: [p.actual],
    weight: p.weight || 1,
    value: p.actual,
  }));
  
  // Pool Adjacent Violators
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < blocks.length - 1; i++) {
      if (blocks[i].value > blocks[i + 1].value) {
        // Merge blocks
        const totalWeight = blocks[i].weight + blocks[i + 1].weight;
        const mergedValue = (blocks[i].value * blocks[i].weight + blocks[i + 1].value * blocks[i + 1].weight) / totalWeight;
        
        blocks[i] = {
          predicted: [...blocks[i].predicted, ...blocks[i + 1].predicted],
          actual: [...blocks[i].actual, ...blocks[i + 1].actual],
          weight: totalWeight,
          value: mergedValue,
        };
        blocks.splice(i + 1, 1);
        changed = true;
        break;
      }
    }
  }
  
  // Create mapping from raw to calibrated probabilities
  const result: IsotonicPoint[] = [];
  blocks.forEach(block => {
    const avgPredicted = block.predicted.reduce((a, b) => a + b, 0) / block.predicted.length;
    result.push({
      rawProbability: avgPredicted,
      calibratedProbability: block.value,
    });
  });
  
  return result;
}

// Apply isotonic calibration to a new probability
export function applyCalibratedProbability(
  rawProbability: number,
  isotonicMapping: IsotonicPoint[]
): number {
  if (isotonicMapping.length === 0) return rawProbability;
  
  // Find surrounding points and interpolate
  const sorted = [...isotonicMapping].sort((a, b) => a.rawProbability - b.rawProbability);
  
  // Handle edge cases
  if (rawProbability <= sorted[0].rawProbability) {
    return sorted[0].calibratedProbability;
  }
  if (rawProbability >= sorted[sorted.length - 1].rawProbability) {
    return sorted[sorted.length - 1].calibratedProbability;
  }
  
  // Linear interpolation between surrounding points
  for (let i = 0; i < sorted.length - 1; i++) {
    if (rawProbability >= sorted[i].rawProbability && rawProbability < sorted[i + 1].rawProbability) {
      const t = (rawProbability - sorted[i].rawProbability) / 
                (sorted[i + 1].rawProbability - sorted[i].rawProbability);
      return sorted[i].calibratedProbability + t * (sorted[i + 1].calibratedProbability - sorted[i].calibratedProbability);
    }
  }
  
  return rawProbability;
}

// Fetch calibration buckets from database
export async function fetchCalibrationBuckets(engineName?: string, sport?: string): Promise<CalibrationBucket[]> {
  let query = supabase
    .from('calibration_buckets')
    .select('*')
    .order('bucket_start', { ascending: true });
  
  if (engineName) {
    query = query.eq('engine_name', engineName);
  }
  if (sport) {
    query = query.eq('sport', sport);
  }
  
  const { data, error } = await query;
  
  if (error || !data) {
    console.error('Error fetching calibration buckets:', error);
    return [];
  }
  
  return data.map(row => ({
    bucketStart: Number(row.bucket_start),
    bucketEnd: Number(row.bucket_end),
    predictedAvg: Number(row.predicted_avg),
    actualAvg: Number(row.actual_avg),
    count: row.sample_count,
    confidenceLower: Number(row.confidence_lower) || 0,
    confidenceUpper: Number(row.confidence_upper) || 1,
  }));
}

// Fetch Brier scores from database
export async function fetchBrierScores(engineName?: string): Promise<BrierDecomposition[]> {
  let query = supabase
    .from('engine_brier_scores')
    .select('*')
    .order('brier_score', { ascending: true });
  
  if (engineName) {
    query = query.eq('engine_name', engineName);
  }
  
  const { data, error } = await query;
  
  if (error || !data) {
    console.error('Error fetching Brier scores:', error);
    return [];
  }
  
  return data.map(row => ({
    brierScore: Number(row.brier_score),
    reliability: Number(row.reliability_score) || 0,
    resolution: Number(row.resolution_score) || 0,
    uncertainty: 0.25, // Default for binary outcomes
    calibrationError: Number(row.calibration_error) || 0,
  }));
}

// Fetch isotonic calibration mapping from database
export async function fetchIsotonicMapping(
  engineName: string,
  sport?: string,
  betType?: string
): Promise<IsotonicPoint[]> {
  let query = supabase
    .from('isotonic_calibration')
    .select('*')
    .eq('engine_name', engineName)
    .order('raw_probability', { ascending: true });
  
  if (sport) {
    query = query.eq('sport', sport);
  }
  if (betType) {
    query = query.eq('bet_type', betType);
  }
  
  const { data, error } = await query;
  
  if (error || !data) {
    console.error('Error fetching isotonic mapping:', error);
    return [];
  }
  
  return data.map(row => ({
    rawProbability: Number(row.raw_probability),
    calibratedProbability: Number(row.calibrated_probability),
  }));
}

// Get calibration grade based on Brier score
export function getCalibrationGrade(brierScore: number): {
  grade: string;
  label: string;
  color: string;
} {
  if (brierScore <= 0.1) {
    return { grade: 'A+', label: 'Excellent', color: 'text-green-500' };
  } else if (brierScore <= 0.15) {
    return { grade: 'A', label: 'Very Good', color: 'text-green-400' };
  } else if (brierScore <= 0.2) {
    return { grade: 'B', label: 'Good', color: 'text-blue-500' };
  } else if (brierScore <= 0.25) {
    return { grade: 'C', label: 'Average', color: 'text-yellow-500' };
  } else if (brierScore <= 0.3) {
    return { grade: 'D', label: 'Below Average', color: 'text-orange-500' };
  } else {
    return { grade: 'F', label: 'Poor', color: 'text-red-500' };
  }
}

// Calculate Expected Calibration Error (ECE)
export function calculateECE(buckets: CalibrationBucket[]): number {
  const totalCount = buckets.reduce((sum, b) => sum + b.count, 0);
  if (totalCount === 0) return 0;
  
  return buckets.reduce((sum, bucket) => {
    const weight = bucket.count / totalCount;
    const error = Math.abs(bucket.predictedAvg - bucket.actualAvg);
    return sum + weight * error;
  }, 0);
}

// Calculate Maximum Calibration Error (MCE)
export function calculateMCE(buckets: CalibrationBucket[]): number {
  if (buckets.length === 0) return 0;
  
  return Math.max(...buckets.map(b => Math.abs(b.predictedAvg - b.actualAvg)));
}
