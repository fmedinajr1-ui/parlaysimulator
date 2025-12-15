/**
 * Kelly Criterion Calculator for Optimal Bet Sizing
 * 
 * The Kelly Criterion formula: f* = (bp - q) / b
 * where:
 *   f* = fraction of bankroll to bet
 *   b = decimal odds - 1 (net odds received on the bet)
 *   p = probability of winning
 *   q = probability of losing (1 - p)
 */

export interface KellyInput {
  winProbability: number; // 0 to 1
  decimalOdds: number;    // e.g., 2.5 for +150
  bankroll: number;       // Current bankroll amount
  kellyMultiplier?: number; // 1.0 = full, 0.5 = half, 0.25 = quarter
  maxBetPercent?: number;   // Maximum bet as % of bankroll (e.g., 0.05 = 5%)
}

export interface KellyResult {
  fullKellyFraction: number;
  adjustedKellyFraction: number;
  recommendedStake: number;
  expectedValue: number;
  edge: number;
  riskLevel: 'conservative' | 'moderate' | 'aggressive' | 'reckless';
  warning?: string;
}

export interface VarianceMetrics {
  expectedReturn: number;
  standardDeviation: number;
  sharpeRatio: number;
  worstCase95: number;
  bestCase95: number;
  riskOfRuin: number;
  maxDrawdownRisk: number;
}

export interface TiltAnalysis {
  isTilting: boolean;
  tiltReason?: string;
}

export interface KellyValidation {
  isValid: boolean;
  errors: string[];
}

/**
 * Validate Kelly inputs before calculation
 */
export function validateKellyInputs(input: Partial<KellyInput>): KellyValidation {
  const errors: string[] = [];

  if (input.winProbability === undefined || input.winProbability === null) {
    errors.push('Win probability is required');
  } else if (input.winProbability <= 0 || input.winProbability >= 1) {
    errors.push('Win probability must be between 0.01 and 0.99');
  }

  if (input.decimalOdds === undefined || input.decimalOdds === null) {
    errors.push('Decimal odds are required');
  } else if (input.decimalOdds <= 1) {
    errors.push('Decimal odds must be greater than 1');
  }

  if (input.bankroll === undefined || input.bankroll === null) {
    errors.push('Bankroll is required');
  } else if (input.bankroll < 10) {
    errors.push('Minimum bankroll is $10');
  }

  if (input.kellyMultiplier !== undefined && (input.kellyMultiplier <= 0 || input.kellyMultiplier > 1)) {
    errors.push('Kelly multiplier must be between 0.01 and 1');
  }

  if (input.maxBetPercent !== undefined && (input.maxBetPercent <= 0 || input.maxBetPercent > 0.25)) {
    errors.push('Max bet percent must be between 0.01 and 0.25');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

export interface TiltAnalysis {
  suggestedAction: string;
  streakImpact: number;
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
 * Calculate implied probability from decimal odds
 */
export function impliedProbability(decimalOdds: number): number {
  return 1 / decimalOdds;
}

/**
 * Calculate the Kelly Criterion stake
 */
export function calculateKelly(input: KellyInput): KellyResult {
  const {
    winProbability,
    decimalOdds,
    bankroll,
    kellyMultiplier = 0.5,
    maxBetPercent = 0.05
  } = input;

  // b = decimal odds - 1 (net profit per dollar bet)
  const b = decimalOdds - 1;
  const p = winProbability;
  const q = 1 - p;

  // Kelly formula: f* = (bp - q) / b
  const fullKellyFraction = (b * p - q) / b;

  // Apply Kelly multiplier (fractional Kelly)
  let adjustedKellyFraction = fullKellyFraction * kellyMultiplier;

  // Cap at maximum bet percent
  adjustedKellyFraction = Math.min(adjustedKellyFraction, maxBetPercent);

  // Never bet negative (no edge)
  adjustedKellyFraction = Math.max(adjustedKellyFraction, 0);

  const recommendedStake = bankroll * adjustedKellyFraction;

  // Expected value = (win_prob * profit) - (lose_prob * stake)
  const expectedValue = (p * (recommendedStake * b)) - (q * recommendedStake);

  // Edge = (win_prob * odds) - 1 expressed as percentage
  const edge = (p * decimalOdds - 1) * 100;

  // Determine risk level
  let riskLevel: KellyResult['riskLevel'];
  if (adjustedKellyFraction <= 0.02) {
    riskLevel = 'conservative';
  } else if (adjustedKellyFraction <= 0.04) {
    riskLevel = 'moderate';
  } else if (adjustedKellyFraction <= 0.08) {
    riskLevel = 'aggressive';
  } else {
    riskLevel = 'reckless';
  }

  // Generate warnings
  let warning: string | undefined;
  if (fullKellyFraction <= 0) {
    warning = 'No edge detected - Kelly suggests no bet';
  } else if (fullKellyFraction > 0.25) {
    warning = 'Full Kelly suggests very aggressive sizing - use fractional Kelly';
  } else if (edge < 2) {
    warning = 'Thin edge (<2%) - consider passing or reducing stake';
  }

  return {
    fullKellyFraction,
    adjustedKellyFraction,
    recommendedStake,
    expectedValue,
    edge,
    riskLevel,
    warning
  };
}

/**
 * Calculate variance metrics for a bet
 */
export function calculateVariance(
  winProbability: number,
  stake: number,
  decimalOdds: number,
  bankroll: number
): VarianceMetrics {
  const b = decimalOdds - 1;
  const p = winProbability;
  const q = 1 - p;

  // Expected return
  const expectedReturn = p * (stake * b) - q * stake;

  // Variance = p * (win - mean)^2 + q * (loss - mean)^2
  const winAmount = stake * b;
  const lossAmount = -stake;
  const variance = p * Math.pow(winAmount - expectedReturn, 2) + 
                   q * Math.pow(lossAmount - expectedReturn, 2);
  const standardDeviation = Math.sqrt(variance);

  // Sharpe ratio (simplified - assuming risk-free rate = 0)
  const sharpeRatio = standardDeviation > 0 ? expectedReturn / standardDeviation : 0;

  // 95% confidence interval (approximately 2 standard deviations)
  const worstCase95 = expectedReturn - (1.96 * standardDeviation);
  const bestCase95 = expectedReturn + (1.96 * standardDeviation);

  // Risk of ruin (simplified approximation using Kelly)
  // RoR ≈ (q/p)^(bankroll/stake) when betting full Kelly
  const kellyFraction = stake / bankroll;
  const riskOfRuin = kellyFraction > 0 
    ? Math.pow(q / p, 1 / kellyFraction) * 100
    : 0;

  // Max drawdown risk as percentage of bankroll
  const maxDrawdownRisk = (stake / bankroll) * 100;

  return {
    expectedReturn,
    standardDeviation,
    sharpeRatio,
    worstCase95,
    bestCase95,
    riskOfRuin: Math.min(riskOfRuin, 100),
    maxDrawdownRisk
  };
}

/**
 * Analyze betting behavior for tilt detection
 */
export function analyzeTilt(
  currentWinStreak: number,
  currentLossStreak: number,
  proposedStake: number,
  bankroll: number,
  peakBankroll: number
): TiltAnalysis {
  const stakePercent = proposedStake / bankroll;
  const drawdownPercent = ((peakBankroll - bankroll) / peakBankroll) * 100;
  
  let isTilting = false;
  let tiltReason: string | undefined;
  let suggestedAction = 'Proceed with bet';
  let streakImpact = 0;

  // Check for loss-induced tilt
  if (currentLossStreak >= 3 && stakePercent > 0.03) {
    isTilting = true;
    tiltReason = `${currentLossStreak} consecutive losses - potential tilt detected`;
    suggestedAction = 'Consider taking a break or reducing stake by 50%';
    streakImpact = -currentLossStreak * 5;
  }

  // Check for overconfidence after wins
  if (currentWinStreak >= 4 && stakePercent > 0.06) {
    isTilting = true;
    tiltReason = `${currentWinStreak} consecutive wins - potential overconfidence`;
    suggestedAction = 'Stay disciplined - variance will regress';
    streakImpact = currentWinStreak * 2;
  }

  // Check for chasing losses (large drawdown + large bet)
  if (drawdownPercent > 20 && stakePercent > 0.04) {
    isTilting = true;
    tiltReason = `${drawdownPercent.toFixed(1)}% drawdown from peak - chasing losses`;
    suggestedAction = 'Reduce stake to rebuild bankroll gradually';
    streakImpact = -15;
  }

  return {
    isTilting,
    tiltReason,
    suggestedAction,
    streakImpact
  };
}

/**
 * Calculate multi-leg parlay Kelly stake
 * For parlays, we need to account for correlated probabilities
 */
export function calculateParlayKelly(
  legs: Array<{ winProbability: number; decimalOdds: number }>,
  bankroll: number,
  kellyMultiplier: number = 0.5,
  correlationFactor: number = 0.85 // Discount for leg correlation
): KellyResult {
  // Combined probability = product of individual probabilities * correlation discount
  const combinedProbability = legs.reduce(
    (acc, leg) => acc * leg.winProbability, 
    1
  ) * correlationFactor;

  // Combined odds = product of individual odds
  const combinedDecimalOdds = legs.reduce(
    (acc, leg) => acc * leg.decimalOdds, 
    1
  );

  return calculateKelly({
    winProbability: combinedProbability,
    decimalOdds: combinedDecimalOdds,
    bankroll,
    kellyMultiplier,
    maxBetPercent: 0.03 // Lower max for parlays due to higher variance
  });
}

/**
 * Compare user's stake to Kelly optimal
 */
export function compareToKelly(
  userStake: number,
  kellyRecommended: number
): {
  difference: number;
  percentDifference: number;
  assessment: 'under-betting' | 'optimal' | 'over-betting' | 'significantly-over';
  advice: string;
} {
  const difference = userStake - kellyRecommended;
  const percentDifference = kellyRecommended > 0 
    ? ((difference / kellyRecommended) * 100)
    : 0;

  let assessment: 'under-betting' | 'optimal' | 'over-betting' | 'significantly-over';
  let advice: string;

  if (percentDifference < -20) {
    assessment = 'under-betting';
    advice = 'Your stake is conservative. Consider increasing to capture more expected value.';
  } else if (percentDifference <= 20) {
    assessment = 'optimal';
    advice = 'Your stake is within optimal range. Good bankroll management!';
  } else if (percentDifference <= 100) {
    assessment = 'over-betting';
    advice = 'Your stake exceeds Kelly optimal. Consider reducing to manage variance.';
  } else {
    assessment = 'significantly-over';
    advice = 'Warning: Your stake is significantly above Kelly optimal. High risk of ruin!';
  }

  return { difference, percentDifference, assessment, advice };
}
