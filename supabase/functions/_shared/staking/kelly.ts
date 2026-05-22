// ============================================================================
// kelly.ts — Bankroll math for parlay sizing & strategy gating.
//
// Implements:
//   - Bayesian-smoothed hit rate (so small samples don't lock in a bad p̂)
//   - Fractional-Kelly stake (¼-Kelly default) clamped to [0, cap × bankroll]
//   - Breakeven & cushioned-min decimal odds for per-strategy gating
//
// All inputs are pure numbers; this file does not touch Supabase, so the
// shared util is trivially testable in Deno tests and importable from both
// the parlay generator and the settler refresh job.
// ============================================================================

export interface KellyResult {
  /** Optimal full-Kelly fraction of bankroll. May be 0 (no edge) or negative
   *  (negative edge) — callers should treat <=0 as "skip this ticket". */
  fStar: number;
  /** Fraction of bankroll to actually risk after applying `cap` (¼-Kelly default). */
  fractionApplied: number;
  /** Stake in units, == fractionApplied × bankrollUnits, rounded to 3dp. */
  stakeUnits: number;
}

/**
 * Bayesian hit-rate smoother. With α priors weighted at `pPrior`, a strategy
 * with 1-of-3 (33%) and a 0.40 prior, α=10 settles around 0.392 instead of
 * 0.333 — preventing the math from over-reacting to thin samples.
 */
export function bayesianHitRate(
  wins: number,
  n: number,
  pPrior: number,
  alpha = 10,
): number {
  if (!Number.isFinite(wins) || !Number.isFinite(n) || n < 0) return pPrior;
  const num = wins + alpha * pPrior;
  const den = n + alpha;
  if (den <= 0) return pPrior;
  return Math.max(0, Math.min(1, num / den));
}

/** Breakeven decimal odds at probability p (no juice). D = 1 / p. */
export function breakevenDecimal(p: number): number {
  if (p <= 0) return Number.POSITIVE_INFINITY;
  return 1 / p;
}

/**
 * Minimum decimal odds required at probability p with a safety cushion.
 * Default cushion = 10 %, so we only fire when book offers ≥ 1.10 × breakeven.
 */
export function requiredDecimal(p: number, cushion = 0.10): number {
  return breakevenDecimal(p) * (1 + cushion);
}

/**
 * Quarter-Kelly stake (default cap=0.25) for a binary outcome at probability p
 * and decimal odds D against a bankroll measured in units.
 *
 *   f*  = (D·p − 1) / (D − 1)           — full Kelly for binary outcome
 *   f   = max(0, f*) × cap              — fractional Kelly, never negative
 *   stake = round3(f × bankroll)
 */
export function quarterKellyStake(
  p: number,
  decimalOdds: number,
  bankrollUnits: number,
  cap = 0.25,
): KellyResult {
  if (!Number.isFinite(p) || !Number.isFinite(decimalOdds) || decimalOdds <= 1) {
    return { fStar: 0, fractionApplied: 0, stakeUnits: 0 };
  }
  const fStar = (decimalOdds * p - 1) / (decimalOdds - 1);
  const fractionApplied = Math.max(0, fStar) * cap;
  const stakeUnits = Math.round(fractionApplied * bankrollUnits * 1000) / 1000;
  return { fStar, fractionApplied, stakeUnits };
}

/**
 * Expected ROI per unit staked given p and decimal odds.
 * Positive means +EV at this price; we use it for the per-strategy gate.
 */
export function evPerUnit(p: number, decimalOdds: number): number {
  return p * (decimalOdds - 1) - (1 - p);
}

/** Default Bayesian priors per leg-count class. */
export const PRIOR_HIT_RATE: Record<string, number> = {
  single: 0.52,
  leg_3: 0.55,
  leg_4: 0.40,
  leg_5: 0.25,
  leg_8: 0.04,
};

export function priorForLegCount(n: number): number {
  if (n <= 1) return PRIOR_HIT_RATE.single;
  if (n === 3) return PRIOR_HIT_RATE.leg_3;
  if (n === 4) return PRIOR_HIT_RATE.leg_4;
  if (n === 5) return PRIOR_HIT_RATE.leg_5;
  if (n >= 8) return PRIOR_HIT_RATE.leg_8;
  // Linear interpolation for in-between leg counts.
  if (n === 2) return 0.55;
  if (n === 6) return 0.15;
  if (n === 7) return 0.08;
  return 0.10;
}