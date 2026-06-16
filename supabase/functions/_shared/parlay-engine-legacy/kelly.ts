// ============================================================================
// kelly.ts — Pluggable stake sizing (v2.5)
// Three sizers behind one getSizer(mode) interface.
// ============================================================================

import * as config from "./config.ts";
import {
  Parlay,
  avgLegConfidence,
  combinedDecimalOdds,
  combinedProbability,
} from "./models.ts";

export type Sizer = (parlay: Parlay) => number;

/** Flat: always returns the tier's base stake (1.0u CORE, 0.75u EDGE, etc.) */
export const flatSizer: Sizer = (p) => {
  return config.STAKE_BY_TIER[p.tier];
};

/** Kelly-lite: scale tier base by stakeMultiplier(avg confidence). */
export const kellyLiteSizer: Sizer = (p) => {
  const base = config.STAKE_BY_TIER[p.tier];
  const mult = config.stakeMultiplier(avgLegConfidence(p));
  return Math.round(base * mult * 1000) / 1000;
};

/**
 * Fractional Kelly: f* = (b·p - q)/b, then scaled by KELLY_FRACTION.
 * Capped at 2× the tier base so a hot parlay can't blow the bankroll.
 * Returns 0 for non-positive Kelly.
 */
export function fractionalKellySizer(opts?: { fraction?: number }): Sizer {
  const fraction = opts?.fraction ?? config.KELLY_FRACTION;
  return (p) => {
    const base = config.STAKE_BY_TIER[p.tier];
    const prob = combinedProbability(p);
    const dec = combinedDecimalOdds(p);
    const b = dec - 1.0;
    if (b <= 0) return 0;
    const q = 1 - prob;
    const fStar = (b * prob - q) / b;
    if (fStar <= 0) return 0;
    // Express Kelly in units relative to a 1u flat reference, then map onto tier base.
    const units = fStar * fraction * 4.0; // 4× because flat=1u≈25% of bankroll-sized swing
    const stake = base * Math.max(0, units);
    const capped = Math.min(stake, 2.0 * base);
    return Math.round(capped * 1000) / 1000;
  };
}

export function getSizer(mode: config.StakeSizingMode = config.STAKE_SIZING_MODE): Sizer {
  switch (mode) {
    case "flat":             return flatSizer;
    case "kelly_lite":       return kellyLiteSizer;
    case "fractional_kelly": return fractionalKellySizer();
    default:                 return kellyLiteSizer;
  }
}