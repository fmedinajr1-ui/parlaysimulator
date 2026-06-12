// Soccer Sharp Market Engine — devig + edge math
// Power devig: solve k such that p_a^k + p_b^k = 1 with p_i = raw implied of each side.

export function americanToImplied(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return NaN;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

export function impliedToAmerican(p: number): number {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return 0;
  return p >= 0.5 ? Math.round(-(p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100);
}

/** Power devig two-way market. Returns fair probabilities summing to 1. */
export function powerDevig(oddsA: number, oddsB: number): { fairA: number; fairB: number } {
  const pa = americanToImplied(oddsA);
  const pb = americanToImplied(oddsB);
  if (!Number.isFinite(pa) || !Number.isFinite(pb) || pa <= 0 || pb <= 0) {
    return { fairA: NaN, fairB: NaN };
  }
  // Solve f(k) = pa^k + pb^k - 1 = 0 via bisection on k in [0.5, 2.0]
  let lo = 0.5;
  let hi = 2.0;
  const f = (k: number) => Math.pow(pa, k) + Math.pow(pb, k) - 1;
  if (f(lo) * f(hi) > 0) {
    // fall back to multiplicative devig
    const sum = pa + pb;
    return { fairA: pa / sum, fairB: pb / sum };
  }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid;
    else lo = mid;
  }
  const k = (lo + hi) / 2;
  const fairA = Math.pow(pa, k);
  const fairB = Math.pow(pb, k);
  return { fairA, fairB };
}

export type EdgeClassification = "PASS" | "LEAN" | "STRONG" | "HAMMER";

export function classifyEdge(edgePct: number): EdgeClassification {
  const e = edgePct;
  if (e >= 6) return "HAMMER";
  if (e >= 4) return "STRONG";
  if (e >= 2) return "LEAN";
  return "PASS";
}

/** Edge as percentage points: sharp_prob − book_prob, ×100. */
export function edgePct(sharpProb: number, bookProb: number): number {
  return (sharpProb - bookProb) * 100;
}

/** Expected value (decimal, e.g. 0.05 = +5%) of a bet at the book price given sharp probability. */
export function expectedValue(sharpProb: number, americanOdds: number): number {
  const payoutRatio = americanOdds > 0 ? americanOdds / 100 : 100 / Math.abs(americanOdds);
  return sharpProb * payoutRatio - (1 - sharpProb);
}