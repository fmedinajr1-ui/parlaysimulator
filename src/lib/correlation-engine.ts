/**
 * Correlation Engine for Parlay Leg Dependencies
 * 
 * Implements Gaussian Copula correlation modeling with Cholesky decomposition
 * for statistically-sound correlated Monte Carlo sampling.
 */

import { supabase } from '@/integrations/supabase/client';
import { ParlayLeg } from '@/types/parlay';

// ============= TYPES =============

export interface LegCorrelation {
  legIndex1: number;
  legIndex2: number;
  correlation: number;
  correlationType: 'same_game' | 'same_team' | 'same_player' | 'cross_game';
  sampleSize: number;
  confidence: 'high' | 'medium' | 'low' | 'estimated';
}

export interface CorrelationMatrix {
  matrix: number[][];
  legCount: number;
  correlations: LegCorrelation[];
  avgCorrelation: number;
  maxCorrelation: number;
  hasHighCorrelation: boolean;
}

export interface CorrelationData {
  sport: string;
  market_type_1: string;
  market_type_2: string;
  correlation_type: string;
  correlation_coefficient: number;
  sample_size: number;
}

// ============= DEFAULT CORRELATIONS =============

// Research-backed default correlations when DB doesn't have data
const DEFAULT_CORRELATIONS: Record<string, number> = {
  // Same-player correlations
  'player_points|player_assists': 0.35,
  'player_points|player_rebounds': 0.25,
  'player_rebounds|player_assists': 0.15,
  'player_pass_yds|player_pass_tds': 0.55,
  'player_rush_yds|player_rush_tds': 0.40,
  'player_rec_yds|player_receptions': 0.65,
  
  // Same-game correlations
  'spreads|totals': 0.15,
  'moneyline|spreads': 0.92,
  'player_points|team_totals': 0.45,
  
  // Cross-game (near independence)
  'cross_game_default': 0.05,
};

// ============= CORE FUNCTIONS =============

/**
 * Fetches correlation data from the database
 */
export async function fetchCorrelationData(sport?: string): Promise<CorrelationData[]> {
  try {
    let query = supabase
      .from('parlay_leg_correlations')
      .select('sport, market_type_1, market_type_2, correlation_type, correlation_coefficient, sample_size');
    
    if (sport) {
      query = query.eq('sport', sport);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error fetching correlations:', error);
      return [];
    }
    
    return (data || []) as CorrelationData[];
  } catch (err) {
    console.error('Failed to fetch correlation data:', err);
    return [];
  }
}

/**
 * Extracts market type from a leg description or bet type
 */
export function extractMarketType(leg: ParlayLeg): string {
  const desc = leg.description.toLowerCase();
  
  // Player props
  if (desc.includes('point') || desc.includes('pts')) return 'player_points';
  if (desc.includes('assist')) return 'player_assists';
  if (desc.includes('rebound')) return 'player_rebounds';
  if (desc.includes('passing yard') || desc.includes('pass yd')) return 'player_pass_yds';
  if (desc.includes('passing td') || desc.includes('pass td')) return 'player_pass_tds';
  if (desc.includes('rushing yard') || desc.includes('rush yd')) return 'player_rush_yds';
  if (desc.includes('rushing td') || desc.includes('rush td')) return 'player_rush_tds';
  if (desc.includes('receiving yard') || desc.includes('rec yd')) return 'player_rec_yds';
  if (desc.includes('reception')) return 'player_receptions';
  if (desc.includes('goal')) return 'player_goals';
  if (desc.includes('shot')) return 'player_shots';
  
  // Game markets
  if (desc.includes('spread') || desc.includes('handicap')) return 'spreads';
  if (desc.includes('total') || desc.includes('over') || desc.includes('under')) return 'totals';
  if (desc.includes('moneyline') || desc.includes('ml') || desc.includes('to win')) return 'moneyline';
  
  return 'other';
}

/**
 * Extracts player name from leg description
 */
export function extractPlayerName(leg: ParlayLeg): string | null {
  const desc = leg.description;
  
  // Common patterns: "Player Name Over/Under X.5"
  const overUnderMatch = desc.match(/^([A-Za-z\s\.'-]+?)\s+(Over|Under|O\/U|o\/u)/i);
  if (overUnderMatch) return overUnderMatch[1].trim();
  
  // Pattern: "Player Name - Market"
  const dashMatch = desc.match(/^([A-Za-z\s\.'-]+?)\s*[-–]/);
  if (dashMatch) return dashMatch[1].trim();
  
  return null;
}

/**
 * Extracts team name or game identifier from leg description
 */
export function extractGameContext(leg: ParlayLeg): { team?: string; game?: string } {
  const desc = leg.description;
  
  // Look for team abbreviations or full names
  const atMatch = desc.match(/@\s*([A-Z]{2,3})/);
  const vsMatch = desc.match(/vs\.?\s*([A-Z]{2,3})/);
  
  return {
    team: atMatch?.[1] || vsMatch?.[1],
    game: desc.substring(0, 50),
  };
}

/**
 * Determines correlation type between two legs
 */
export function getCorrelationType(leg1: ParlayLeg, leg2: ParlayLeg): 'same_player' | 'same_game' | 'same_team' | 'cross_game' {
  const player1 = extractPlayerName(leg1);
  const player2 = extractPlayerName(leg2);
  
  // Same player correlation (highest)
  if (player1 && player2 && player1.toLowerCase() === player2.toLowerCase()) {
    return 'same_player';
  }
  
  const context1 = extractGameContext(leg1);
  const context2 = extractGameContext(leg2);
  
  // Same game correlation
  if (context1.game && context2.game && 
      (context1.game.includes(context2.team || '') || context2.game.includes(context1.team || ''))) {
    return 'same_game';
  }
  
  // Same team correlation
  if (context1.team && context2.team && context1.team === context2.team) {
    return 'same_team';
  }
  
  return 'cross_game';
}

/**
 * Looks up correlation coefficient between two market types
 */
export function lookupCorrelation(
  market1: string,
  market2: string,
  correlationType: string,
  correlationData: CorrelationData[]
): { correlation: number; sampleSize: number; isEstimated: boolean } {
  // Normalize order for consistent lookup
  const [m1, m2] = [market1, market2].sort();
  
  // Search database correlations
  const dbMatch = correlationData.find(c => 
    ((c.market_type_1 === m1 && c.market_type_2 === m2) ||
     (c.market_type_1 === m2 && c.market_type_2 === m1)) &&
    c.correlation_type === correlationType
  );
  
  if (dbMatch) {
    return {
      correlation: Number(dbMatch.correlation_coefficient),
      sampleSize: dbMatch.sample_size,
      isEstimated: false,
    };
  }
  
  // Fall back to defaults
  const defaultKey = `${m1}|${m2}`;
  const defaultCorr = DEFAULT_CORRELATIONS[defaultKey] || DEFAULT_CORRELATIONS[`${m2}|${m1}`];
  
  if (defaultCorr !== undefined) {
    return {
      correlation: defaultCorr,
      sampleSize: 0,
      isEstimated: true,
    };
  }
  
  // No data available - use type-based defaults
  const typeDefaults: Record<string, number> = {
    'same_player': 0.30,
    'same_game': 0.20,
    'same_team': 0.15,
    'cross_game': 0.05,
  };
  
  return {
    correlation: typeDefaults[correlationType] || 0.05,
    sampleSize: 0,
    isEstimated: true,
  };
}

/**
 * Builds a correlation matrix for a set of parlay legs
 */
export async function buildCorrelationMatrix(
  legs: ParlayLeg[],
  sport?: string
): Promise<CorrelationMatrix> {
  const n = legs.length;
  const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
  const correlations: LegCorrelation[] = [];
  
  // Fetch correlation data from database
  const correlationData = await fetchCorrelationData(sport);
  
  // Fill matrix with correlations
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1; // Self-correlation is always 1
    
    for (let j = i + 1; j < n; j++) {
      const market1 = extractMarketType(legs[i]);
      const market2 = extractMarketType(legs[j]);
      const corrType = getCorrelationType(legs[i], legs[j]);
      
      const { correlation, sampleSize, isEstimated } = lookupCorrelation(
        market1,
        market2,
        corrType,
        correlationData
      );
      
      // Set symmetric correlation
      matrix[i][j] = correlation;
      matrix[j][i] = correlation;
      
      correlations.push({
        legIndex1: i,
        legIndex2: j,
        correlation,
        correlationType: corrType,
        sampleSize,
        confidence: sampleSize >= 100 ? 'high' : sampleSize >= 20 ? 'medium' : isEstimated ? 'estimated' : 'low',
      });
    }
  }
  
  // Calculate statistics
  const nonDiagonalCorrs = correlations.map(c => c.correlation);
  const avgCorrelation = nonDiagonalCorrs.length > 0 
    ? nonDiagonalCorrs.reduce((a, b) => a + b, 0) / nonDiagonalCorrs.length 
    : 0;
  const maxCorrelation = nonDiagonalCorrs.length > 0 
    ? Math.max(...nonDiagonalCorrs) 
    : 0;
  
  return {
    matrix,
    legCount: n,
    correlations,
    avgCorrelation,
    maxCorrelation,
    hasHighCorrelation: maxCorrelation > 0.3,
  };
}

// ============= CHOLESKY DECOMPOSITION =============

/**
 * Performs Cholesky decomposition on a correlation matrix
 * Returns lower triangular matrix L such that matrix = L * L^T
 */
export function choleskyDecomposition(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const L: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
  
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      
      if (i === j) {
        // Diagonal elements
        for (let k = 0; k < j; k++) {
          sum += L[j][k] * L[j][k];
        }
        const diag = matrix[j][j] - sum;
        
        // Handle numerical issues
        if (diag < 0) {
          console.warn('Matrix is not positive definite, using regularization');
          L[j][j] = Math.sqrt(Math.max(0.001, diag));
        } else {
          L[j][j] = Math.sqrt(diag);
        }
      } else {
        // Off-diagonal elements
        for (let k = 0; k < j; k++) {
          sum += L[i][k] * L[j][k];
        }
        if (L[j][j] === 0) {
          L[i][j] = 0;
        } else {
          L[i][j] = (matrix[i][j] - sum) / L[j][j];
        }
      }
    }
  }
  
  return L;
}

/**
 * Generates correlated uniform random numbers using Gaussian Copula
 * @param L - Cholesky decomposition of correlation matrix
 * @param n - Number of variables (legs)
 * @returns Array of correlated uniform [0,1] random numbers
 */
export function generateCorrelatedUniform(L: number[][]): number[] {
  const n = L.length;
  
  // Generate independent standard normal random numbers (Box-Muller)
  const Z: number[] = [];
  for (let i = 0; i < n; i++) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    Z.push(z);
  }
  
  // Apply Cholesky transformation to get correlated normals
  const X: number[] = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      X[i] += L[i][j] * Z[j];
    }
  }
  
  // Transform to uniform [0,1] using standard normal CDF
  return X.map(x => normalCDF(x));
}

/**
 * Standard normal cumulative distribution function (CDF)
 * Uses approximation: Abramowitz and Stegun formula 26.2.23
 */
function normalCDF(x: number): number {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  
  return 0.5 * (1.0 + sign * y);
}

// ============= PROBABILITY ADJUSTMENTS =============

/**
 * Calculates the correlation-adjusted joint probability for a parlay
 * Using Gaussian Copula to properly account for leg dependencies
 */
export function calculateCorrelatedProbability(
  legProbabilities: number[],
  correlationMatrix: CorrelationMatrix
): {
  independentProbability: number;
  correlatedProbability: number;
  probabilityRatio: number;
  correlationImpact: number;
} {
  const n = legProbabilities.length;
  
  // Independent assumption (naive)
  const independentProbability = legProbabilities.reduce((prod, p) => prod * p, 1);
  
  // If no significant correlation, return independent
  if (!correlationMatrix.hasHighCorrelation || n < 2) {
    return {
      independentProbability,
      correlatedProbability: independentProbability,
      probabilityRatio: 1,
      correlationImpact: 0,
    };
  }
  
  // Monte Carlo estimation of correlated probability
  const simulations = 50000;
  const L = choleskyDecomposition(correlationMatrix.matrix);
  
  if (!L) {
    return {
      independentProbability,
      correlatedProbability: independentProbability,
      probabilityRatio: 1,
      correlationImpact: 0,
    };
  }
  
  let wins = 0;
  
  for (let sim = 0; sim < simulations; sim++) {
    const correlatedRandom = generateCorrelatedUniform(L);
    
    // Check if all legs hit
    let allHit = true;
    for (let i = 0; i < n; i++) {
      if (correlatedRandom[i] > legProbabilities[i]) {
        allHit = false;
        break;
      }
    }
    
    if (allHit) wins++;
  }
  
  const correlatedProbability = wins / simulations;
  const probabilityRatio = independentProbability > 0 
    ? correlatedProbability / independentProbability 
    : 1;
  const correlationImpact = (correlatedProbability - independentProbability) * 100;
  
  return {
    independentProbability,
    correlatedProbability,
    probabilityRatio,
    correlationImpact,
  };
}

// ============= UTILITY EXPORTS =============

export function formatCorrelationImpact(impact: number): string {
  if (Math.abs(impact) < 0.1) return 'No significant impact';
  if (impact > 0) return `+${impact.toFixed(2)}% more likely to hit`;
  return `${impact.toFixed(2)}% less likely to hit`;
}

export function getCorrelationSeverity(avgCorrelation: number): 'none' | 'low' | 'medium' | 'high' {
  if (avgCorrelation < 0.1) return 'none';
  if (avgCorrelation < 0.25) return 'low';
  if (avgCorrelation < 0.5) return 'medium';
  return 'high';
}
