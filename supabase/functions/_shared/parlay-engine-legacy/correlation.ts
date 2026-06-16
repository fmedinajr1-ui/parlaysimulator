// ============================================================================
// correlation.ts — Pair-lift correlation model (v2.5)
// Port of correlation.py. Same-game scope only.
// ============================================================================

import { CandidateLeg, Parlay, combinedProbability, legPropKey } from "./models.ts";
import { ExposureTracker } from "./dedup.ts";

/** Pair key is order-independent: "A|B" with A<=B. */
function pairKey(a: string, b: string): string {
  return a <= b ? `${a}||${b}` : `${b}||${a}`;
}

function sameGame(a: CandidateLeg, b: CandidateLeg): boolean {
  return ExposureTracker.gameKey(a) === ExposureTracker.gameKey(b);
}

export interface CorrelationModel {
  /** Map of pairKey → multiplicative lift on combined probability. <1 = negative. */
  lift: Map<string, number>;
  pair_counts: Map<string, number>;
  min_pair_count: number;
}

export function emptyCorrelationModel(): CorrelationModel {
  return { lift: new Map(), pair_counts: new Map(), min_pair_count: 30 };
}

/**
 * Fit a pair-lift model from a flat list of historical legs that include an
 * `outcome` flag (true = leg hit). Pairs are formed within same-game leg sets
 * derived from the supplied parlays.
 */
export function fitCorrelationModel(
  parlays: Array<{ legs: Array<CandidateLeg & { outcome?: boolean }> }>,
  minPairCount = 30,
): CorrelationModel {
  const pair_hit = new Map<string, number>();
  const pair_total = new Map<string, number>();
  const single_hit = new Map<string, number>();
  const single_total = new Map<string, number>();

  for (const p of parlays) {
    for (const l of p.legs) {
      const k = legPropKey(l);
      single_total.set(k, (single_total.get(k) ?? 0) + 1);
      if (l.outcome) single_hit.set(k, (single_hit.get(k) ?? 0) + 1);
    }
    for (let i = 0; i < p.legs.length; i++) {
      for (let j = i + 1; j < p.legs.length; j++) {
        const a = p.legs[i], b = p.legs[j];
        if (!sameGame(a, b)) continue;
        const pk = pairKey(legPropKey(a), legPropKey(b));
        pair_total.set(pk, (pair_total.get(pk) ?? 0) + 1);
        if (a.outcome && b.outcome) pair_hit.set(pk, (pair_hit.get(pk) ?? 0) + 1);
      }
    }
  }

  const lift = new Map<string, number>();
  for (const [pk, total] of pair_total) {
    if (total < minPairCount) continue;
    const observed = (pair_hit.get(pk) ?? 0) / total;
    const [ka, kb] = pk.split("||");
    const pa = (single_hit.get(ka) ?? 0) / Math.max(1, single_total.get(ka) ?? 1);
    const pb = (single_hit.get(kb) ?? 0) / Math.max(1, single_total.get(kb) ?? 1);
    const expected = pa * pb;
    if (expected <= 0) continue;
    lift.set(pk, observed / expected);
  }

  return { lift, pair_counts: pair_total, min_pair_count: minPairCount };
}

/** Adjusted combined probability = base × geometric mean of pair lifts. */
export function adjustedCombinedProbability(p: Parlay, model: CorrelationModel): number {
  const base = combinedProbability(p);
  let logSum = 0;
  let pairs = 0;
  for (let i = 0; i < p.legs.length; i++) {
    for (let j = i + 1; j < p.legs.length; j++) {
      const a = p.legs[i], b = p.legs[j];
      if (!sameGame(a, b)) continue;
      const lift = model.lift.get(pairKey(legPropKey(a), legPropKey(b)));
      if (lift == null || lift <= 0) continue;
      logSum += Math.log(lift);
      pairs += 1;
    }
  }
  if (pairs === 0) return base;
  const meanLift = Math.exp(logSum / pairs);
  return Math.max(0, Math.min(1, base * meanLift));
}

export interface CorrelationWarning {
  pair: string;
  lift: number;
  same_game: boolean;
}

/** Returns warnings for any pair whose lift is below `negThreshold` (default 0.90). */
export function warningsFor(
  p: Parlay,
  model: CorrelationModel,
  negThreshold = 0.90,
): CorrelationWarning[] {
  const out: CorrelationWarning[] = [];
  for (let i = 0; i < p.legs.length; i++) {
    for (let j = i + 1; j < p.legs.length; j++) {
      const a = p.legs[i], b = p.legs[j];
      if (!sameGame(a, b)) continue;
      const pk = pairKey(legPropKey(a), legPropKey(b));
      const lift = model.lift.get(pk);
      if (lift != null && lift < negThreshold) {
        out.push({ pair: pk, lift, same_game: true });
      }
    }
  }
  return out;
}