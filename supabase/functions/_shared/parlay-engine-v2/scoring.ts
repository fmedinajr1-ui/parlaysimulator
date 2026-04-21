// ============================================================================
// scoring.ts — Direct port of scoring.py
// Leg quality scoring + parlay ranking score (with FAT_PITCH 1.15x bonus)
// ============================================================================

import * as config from "./config.ts";
import {
  CandidateLeg,
  Parlay,
  combinedAmericanOdds,
  expectedValueUnits,
  legPropKey,
  signalNorm,
} from "./models.ts";

export function legQualityScore(leg: CandidateLeg): number {
  let score = leg.confidence;

  const sig = signalNorm(leg);
  if (config.SIGNAL_TIER_S.has(sig)) {
    score *= 1.25;
  } else if (config.SIGNAL_TIER_A.has(sig)) {
    score *= 1.10;
  } else if (config.SIGNAL_TIER_B.has(sig)) {
    score *= 1.00;
  } else if (config.SIGNAL_WATCHLIST.has(sig)) {
    score *= 1.05;
  } else {
    score *= 0.90;
  }

  // NBA prop hit-rate adjustment
  if (leg.sport === "NBA") {
    const k = legPropKey(leg);
    if (k in config.PROP_WHITELIST) {
      const emp = config.PROP_WHITELIST[k];
      score *= (0.7 + 0.5 * emp);
    }
  }

  // Edge bonus
  if (leg.edge && leg.edge > 0) {
    score *= 1.0 + Math.min(0.05, leg.edge * 0.01);
  }

  return score;
}

/** Stable sort by descending quality score. */
export function rankLegs(legs: CandidateLeg[]): CandidateLeg[] {
  return legs
    .map((l, i) => ({ l, i, s: legQualityScore(l) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map(x => x.l);
}

export function parlayEvScore(p: Parlay): number {
  return expectedValueUnits(p);
}

export function parlayRankingScore(p: Parlay): number {
  let base = parlayEvScore(p);

  const odds = combinedAmericanOdds(p);
  if (odds >= 800 && odds <= 1200) {
    base *= 1.15;
  } else if (odds >= 300 && odds < 800) {
    base *= 1.05;
  }

  let s_count = 0, a_count = 0;
  for (const l of p.legs) {
    const sig = signalNorm(l);
    if (config.SIGNAL_TIER_S.has(sig)) s_count++;
    else if (config.SIGNAL_TIER_A.has(sig)) a_count++;
  }
  const sig_bonus = 1.0 + 0.05 * s_count + 0.02 * a_count;
  base *= sig_bonus;

  return base;
}