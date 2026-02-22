/**
 * Standard Normal CDF approximation (Abramowitz & Stegun, formula 7.1.26).
 * Accurate to ~1.5×10⁻⁷.
 */
export function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;

  const t = 1.0 / (1.0 + p * z);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Calculate P(over) given projected stat, line, and remaining std deviation.
 * P_over = 1 - Φ((line - projected) / sigma_rem)
 */
export function calcPOver(projected: number, line: number, sigmaRem: number): number {
  if (sigmaRem <= 0) return projected >= line ? 0.99 : 0.01;
  const z = (line - projected) / sigmaRem;
  return Math.min(0.99, Math.max(0.01, 1 - normalCdf(z)));
}

/**
 * Calculate Edge Score = (P_over - ImpliedProb) * 100
 */
export function calcEdgeScore(pOver: number, impliedProb: number): number {
  return (pOver - impliedProb) * 100;
}

/**
 * Convert American odds to implied probability (0-1).
 */
export function americanToImplied(odds: number): number {
  if (odds === 0) return 0.5;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}
