/**
 * Parametric Models for Sports Betting
 * 
 * Provides fast probability estimates using statistical distributions:
 * - Poisson models for game totals, scores, and discrete events
 * - Normal/Gaussian models for player props and spreads
 * - Log-normal models for highly variable stats
 */

// ============= POISSON MODELS =============

// Factorial with memoization for Poisson calculations
const factorialCache: Map<number, number> = new Map();
function factorial(n: number): number {
  if (n <= 1) return 1;
  if (factorialCache.has(n)) return factorialCache.get(n)!;
  const result = n * factorial(n - 1);
  factorialCache.set(n, result);
  return result;
}

// Poisson probability mass function: P(X = k)
export function poissonPMF(lambda: number, k: number): number {
  if (lambda <= 0 || k < 0) return 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(Math.floor(k));
}

// Poisson cumulative distribution function: P(X <= k)
export function poissonCDF(lambda: number, k: number): number {
  let sum = 0;
  for (let i = 0; i <= Math.floor(k); i++) {
    sum += poissonPMF(lambda, i);
  }
  return sum;
}

// Probability of over/under for a Poisson-distributed variable
export function poissonOverUnder(
  expectedValue: number,
  line: number,
  side: 'over' | 'under'
): number {
  // For over: P(X > line) = 1 - P(X <= line)
  // For under: P(X < line) = P(X <= line - 1)
  // Handle half-point lines
  const isHalfPoint = line % 1 !== 0;
  
  if (side === 'over') {
    if (isHalfPoint) {
      return 1 - poissonCDF(expectedValue, Math.floor(line));
    }
    return 1 - poissonCDF(expectedValue, line);
  } else {
    if (isHalfPoint) {
      return poissonCDF(expectedValue, Math.floor(line));
    }
    return poissonCDF(expectedValue, line - 1);
  }
}

// ============= NORMAL (GAUSSIAN) MODELS =============

// Standard normal CDF using error function approximation
function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

// Standard normal CDF: Φ(z)
export function normalCDF(z: number): number {
  return 0.5 * (1 + erf(z / Math.sqrt(2)));
}

// Normal CDF with mean and standard deviation
export function normalCDFWithParams(x: number, mean: number, stdDev: number): number {
  if (stdDev <= 0) return x >= mean ? 1 : 0;
  return normalCDF((x - mean) / stdDev);
}

// Probability of over/under for a normally-distributed variable
export function normalOverUnder(
  expectedValue: number,
  stdDev: number,
  line: number,
  side: 'over' | 'under'
): number {
  const zScore = (line - expectedValue) / stdDev;
  
  if (side === 'over') {
    return 1 - normalCDF(zScore);
  } else {
    return normalCDF(zScore);
  }
}

// ============= SPORT-SPECIFIC MODELS =============

export interface PropProjection {
  expectedValue: number;
  stdDev: number;
  distribution: 'poisson' | 'normal' | 'lognormal';
}

export interface ParametricResult {
  probability: number;
  confidence: number;
  model: string;
  expectedValue: number;
  edge?: number;
}

// Default standard deviations by prop type (as percentage of expected value)
const PROP_STD_DEV_MULTIPLIERS: Record<string, number> = {
  // NBA
  'player_points': 0.35,
  'player_rebounds': 0.40,
  'player_assists': 0.45,
  'player_threes': 0.55,
  'player_blocks': 0.60,
  'player_steals': 0.60,
  'player_turnovers': 0.50,
  'player_pra': 0.30,    // Points + Rebounds + Assists (less variable)
  
  // NFL
  'player_passing_yards': 0.30,
  'player_rushing_yards': 0.45,
  'player_receiving_yards': 0.50,
  'player_passing_tds': 0.60,
  'player_receptions': 0.40,
  
  // NHL
  'player_shots': 0.40,
  'player_goals': 0.70,
  'player_assists_nhl': 0.65,
  'player_points_nhl': 0.55,
  
  // MLB
  'player_hits': 0.50,
  'player_total_bases': 0.45,
  'player_strikeouts_pitcher': 0.30,
  
  // Default
  'default': 0.40,
};

// Determine distribution type for a prop
function getDistributionType(propType: string, expectedValue: number): 'poisson' | 'normal' {
  // Use Poisson for discrete, low-count events
  const poissonProps = [
    'player_threes', 'player_blocks', 'player_steals', 'player_turnovers',
    'player_goals', 'player_passing_tds', 'player_rushing_tds', 'player_receiving_tds',
    'player_hits', 'player_home_runs'
  ];
  
  if (poissonProps.some(p => propType.includes(p))) {
    return 'poisson';
  }
  
  // Use Poisson for low expected values (< 10)
  if (expectedValue < 10) {
    return 'poisson';
  }
  
  // Use Normal for continuous/high-count variables
  return 'normal';
}

// Calculate probability for a player prop
export function calculatePropProbability(
  propType: string,
  expectedValue: number,
  line: number,
  side: 'over' | 'under',
  customStdDev?: number
): ParametricResult {
  const distribution = getDistributionType(propType, expectedValue);
  const stdDevMultiplier = PROP_STD_DEV_MULTIPLIERS[propType] || PROP_STD_DEV_MULTIPLIERS['default'];
  const stdDev = customStdDev || expectedValue * stdDevMultiplier;
  
  let probability: number;
  
  if (distribution === 'poisson') {
    probability = poissonOverUnder(expectedValue, line, side);
  } else {
    probability = normalOverUnder(expectedValue, stdDev, line, side);
  }
  
  // Calculate edge vs implied probability (assuming -110 juice = 52.4%)
  const impliedProb = 0.524;
  const edge = probability - impliedProb;
  
  // Confidence based on sample quality and edge magnitude
  const confidence = Math.min(0.95, Math.max(0.3, 0.5 + Math.abs(edge) * 2));
  
  return {
    probability: Math.max(0.01, Math.min(0.99, probability)),
    confidence,
    model: distribution,
    expectedValue,
    edge,
  };
}

// ============= GAME TOTALS MODEL =============

export interface GameTotalsInput {
  homeExpectedScore: number;
  awayExpectedScore: number;
  totalLine: number;
  spreadLine?: number;
  homeStdDev?: number;
  awayStdDev?: number;
  correlation?: number; // Score correlation between teams
}

export interface GameTotalsResult {
  overProbability: number;
  underProbability: number;
  homeMLProbability: number;
  awayMLProbability: number;
  homeCoverProbability?: number;
  awayCoverProbability?: number;
  expectedTotal: number;
  expectedSpread: number;
}

// Calculate game totals and spreads using bivariate normal
export function calculateGameProbabilities(input: GameTotalsInput): GameTotalsResult {
  const { 
    homeExpectedScore, 
    awayExpectedScore, 
    totalLine,
    spreadLine,
    homeStdDev = homeExpectedScore * 0.15,
    awayStdDev = awayExpectedScore * 0.15,
    correlation = 0.3, // Positive correlation (high-scoring games tend to have both teams score more)
  } = input;
  
  const expectedTotal = homeExpectedScore + awayExpectedScore;
  const expectedSpread = awayExpectedScore - homeExpectedScore; // Negative means home favorite
  
  // Total variance: Var(X+Y) = Var(X) + Var(Y) + 2*Cov(X,Y)
  const covariance = correlation * homeStdDev * awayStdDev;
  const totalStdDev = Math.sqrt(homeStdDev ** 2 + awayStdDev ** 2 + 2 * covariance);
  
  // Spread variance: Var(X-Y) = Var(X) + Var(Y) - 2*Cov(X,Y)
  const spreadStdDev = Math.sqrt(homeStdDev ** 2 + awayStdDev ** 2 - 2 * covariance);
  
  // Over/Under probabilities
  const overProbability = normalOverUnder(expectedTotal, totalStdDev, totalLine, 'over');
  const underProbability = 1 - overProbability;
  
  // Moneyline probabilities (home wins if spread < 0)
  const homeMLProbability = normalCDFWithParams(0, expectedSpread, spreadStdDev);
  const awayMLProbability = 1 - homeMLProbability;
  
  // Spread cover probabilities
  let homeCoverProbability: number | undefined;
  let awayCoverProbability: number | undefined;
  
  if (spreadLine !== undefined) {
    // Home covers if (away - home) < spreadLine
    homeCoverProbability = normalCDFWithParams(spreadLine, expectedSpread, spreadStdDev);
    awayCoverProbability = 1 - homeCoverProbability;
  }
  
  return {
    overProbability,
    underProbability,
    homeMLProbability,
    awayMLProbability,
    homeCoverProbability,
    awayCoverProbability,
    expectedTotal,
    expectedSpread,
  };
}

// ============= CONTEXTUAL ADJUSTMENTS =============

export interface ContextualFactors {
  restDays?: number;           // Days since last game
  travelMiles?: number;        // Distance traveled
  isBackToBack?: boolean;      // Back-to-back game
  isHome?: boolean;            // Home game
  altitude?: number;           // Venue altitude (feet)
  temperature?: number;        // Outdoor temp (F)
  windSpeed?: number;          // Wind speed (mph)
  injuryImpact?: number;       // -1 to 0 scale of team injury impact
  recentForm?: number;         // Recent performance vs average (0.8 = 20% below, 1.2 = 20% above)
  defenseRating?: number;      // Opponent defense rating (1.0 = average)
  paceAdjustment?: number;     // Pace factor adjustment
}

// Apply contextual adjustments to expected value
export function applyContextualAdjustments(
  baseExpectedValue: number,
  factors: ContextualFactors
): number {
  let multiplier = 1.0;
  
  // Rest days adjustment
  if (factors.restDays !== undefined) {
    if (factors.restDays === 0) {
      multiplier *= 0.95; // Back-to-back penalty
    } else if (factors.restDays >= 3) {
      multiplier *= 1.02; // Well-rested bonus
    }
  }
  
  // Travel fatigue
  if (factors.travelMiles !== undefined && factors.travelMiles > 1000) {
    multiplier *= 1 - (factors.travelMiles / 50000); // Up to 6% reduction for cross-country
  }
  
  // Home court advantage
  if (factors.isHome === true) {
    multiplier *= 1.03;
  } else if (factors.isHome === false) {
    multiplier *= 0.97;
  }
  
  // Altitude adjustment (Denver effect)
  if (factors.altitude !== undefined && factors.altitude > 5000) {
    multiplier *= 1 + ((factors.altitude - 5000) / 50000); // Small boost for altitude
  }
  
  // Weather adjustments (outdoor sports)
  if (factors.windSpeed !== undefined && factors.windSpeed > 15) {
    multiplier *= 1 - ((factors.windSpeed - 15) / 100); // Reduce for windy conditions
  }
  
  // Injury impact
  if (factors.injuryImpact !== undefined) {
    multiplier *= 1 + factors.injuryImpact; // Negative impact reduces EV
  }
  
  // Recent form
  if (factors.recentForm !== undefined) {
    multiplier *= factors.recentForm;
  }
  
  // Defense rating adjustment
  if (factors.defenseRating !== undefined) {
    multiplier *= 1 / factors.defenseRating; // Good defense (>1) reduces EV
  }
  
  // Pace adjustment
  if (factors.paceAdjustment !== undefined) {
    multiplier *= factors.paceAdjustment;
  }
  
  return baseExpectedValue * multiplier;
}

// ============= HYBRID SCREENING =============

export interface ScreeningResult {
  passedScreen: boolean;
  parametricProbability: number;
  edgeEstimate: number;
  confidence: number;
  model: string;
  recommendation: 'strong_pick' | 'consider' | 'avoid' | 'neutral';
}

// Quick parametric screen to filter candidates for deep Monte Carlo analysis
export function screenPropCandidate(
  propType: string,
  expectedValue: number,
  line: number,
  side: 'over' | 'under',
  impliedProbability: number,
  minEdge: number = 0.03,
  context?: ContextualFactors
): ScreeningResult {
  // Apply contextual adjustments if provided
  const adjustedEV = context 
    ? applyContextualAdjustments(expectedValue, context)
    : expectedValue;
  
  const result = calculatePropProbability(propType, adjustedEV, line, side);
  const edge = result.probability - impliedProbability;
  
  // Determine recommendation
  let recommendation: ScreeningResult['recommendation'];
  if (edge >= 0.08 && result.confidence >= 0.6) {
    recommendation = 'strong_pick';
  } else if (edge >= minEdge && result.confidence >= 0.5) {
    recommendation = 'consider';
  } else if (edge <= -0.05) {
    recommendation = 'avoid';
  } else {
    recommendation = 'neutral';
  }
  
  return {
    passedScreen: edge >= minEdge,
    parametricProbability: result.probability,
    edgeEstimate: edge,
    confidence: result.confidence,
    model: result.model,
    recommendation,
  };
}

// ============= AMERICAN ODDS CONVERSION =============

export function americanToImpliedProbability(odds: number): number {
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
}

export function impliedProbabilityToAmerican(prob: number): number {
  if (prob >= 0.5) {
    return Math.round(-100 * prob / (1 - prob));
  } else {
    return Math.round(100 * (1 - prob) / prob);
  }
}

// Calculate fair odds given true probability
export function calculateFairOdds(trueProbability: number): number {
  return impliedProbabilityToAmerican(trueProbability);
}

// Calculate expected value of a bet
export function calculateExpectedValue(
  trueProbability: number,
  americanOdds: number,
  stake: number = 100
): number {
  const decimalOdds = americanOdds > 0 
    ? (americanOdds / 100) + 1 
    : (100 / Math.abs(americanOdds)) + 1;
  
  const potentialProfit = stake * (decimalOdds - 1);
  const expectedValue = (trueProbability * potentialProfit) - ((1 - trueProbability) * stake);
  
  return expectedValue;
}
