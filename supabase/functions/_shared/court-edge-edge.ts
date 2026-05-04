// Court.Edge — devigged probability-edge math.
// Pure helpers, no I/O. Phase 1 of the Court.Edge edge-math fix.
//
// edge_pp = model_prob_side − devigged_implied_side, in PROBABILITY POINTS
// (e.g. 0.04 = 4 percentage points).  Anything > 12pp is treated as a model
// bug and routed to QUARANTINE upstream.

export const EDGE_HARD_CAP_PP = 0.12;

// Per-tour, per-format game-total standard deviation used by modelProbOver.
// Starting points; will be re-tuned in Phase 2 once projection bugs are fixed.
export const SIGMA_GAMES = {
  wta_bo3: 3.5,
  atp_bo3: 4.0,
  wta_bo5: 4.5, // placeholder — WTA doesn't play bo5
  atp_bo5: 5.5,
} as const;

export type Tour = "wta" | "atp" | "unknown";
export type SetsKey = "bo3" | "bo5";

export function pickSigma(tour: Tour, sets: SetsKey): number {
  if (tour === "atp") return sets === "bo5" ? SIGMA_GAMES.atp_bo5 : SIGMA_GAMES.atp_bo3;
  // unknown → conservative WTA bo3
  return sets === "bo5" ? SIGMA_GAMES.wta_bo5 : SIGMA_GAMES.wta_bo3;
}

// American odds → implied probability (with vig).
export function americanToImplied(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 0.5;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

// Strip vig by simple normalization. Returns null if either side is unusable.
export function devigPair(over: number | null | undefined, under: number | null | undefined):
  { p_over_fair: number; p_under_fair: number } | null {
  if (over == null || under == null || !Number.isFinite(over) || !Number.isFinite(under)) return null;
  const po = americanToImplied(over);
  const pu = americanToImplied(under);
  const sum = po + pu;
  if (sum <= 0) return null;
  return { p_over_fair: po / sum, p_under_fair: pu / sum };
}

// Standard normal CDF (Abramowitz & Stegun 7.1.26). Local copy so this file
// has zero cross-package dependencies.
function normalCdf(x: number): number {
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

// P(total games > line) given projection, line, sigma in games.
export function modelProbOver(projection: number, line: number, sigma: number): number {
  if (!Number.isFinite(projection) || !Number.isFinite(line)) return 0.5;
  if (!Number.isFinite(sigma) || sigma <= 0) return projection > line ? 0.99 : 0.01;
  const z = (line - projection) / sigma;
  const p = 1 - normalCdf(z);
  return Math.min(0.99, Math.max(0.01, p));
}