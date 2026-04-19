// _shared/edge-calc.ts
// Analytical helpers. All input assumptions documented.

import type { Pick, PickRecency } from './constants.ts';

// ─── American odds helpers ────────────────────────────────────────────────

/** American odds → implied probability (0-1). Handles +/- correctly. */
export function americanOddsToImpliedProb(odds: number): number {
  if (odds === 0) return 0.5;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

/** Implied probability (0-1) → American odds. */
export function impliedProbToAmerican(p: number): number {
  if (p <= 0 || p >= 1) throw new Error(`Invalid probability: ${p}`);
  return p >= 0.5
    ? Math.round(-(p / (1 - p)) * 100)
    : Math.round(((1 - p) / p) * 100);
}

/** Format American odds with sign. '-110' / '+165'. Safe with undefined. */
export function formatAmerican(odds?: number | null): string {
  if (odds == null || !Number.isFinite(odds)) return '-110';
  const n = Math.round(odds);
  return n > 0 ? `+${n}` : `${n}`;
}

/** Decimal payout from stake + American odds. Returns total return (stake + profit). */
export function americanPayout(stake: number, odds: number): number {
  if (odds > 0) return stake + (stake * odds) / 100;
  return stake + (stake * 100) / Math.abs(odds);
}

// ─── Edge / EV ────────────────────────────────────────────────────────────

/** EV as percentage of stake. e.g. 0.05 = +5% EV. */
export function expectedValuePct(trueProb: number, americanOdds: number): number {
  const payoutRatio = americanOdds > 0
    ? americanOdds / 100
    : 100 / Math.abs(americanOdds);
  return trueProb * payoutRatio - (1 - trueProb);
}

/** Edge percent: how much our true probability exceeds the book's implied. */
export function edgePct(trueProb: number, americanOdds: number): number {
  return (trueProb - americanOddsToImpliedProb(americanOdds)) * 100;
}

// ─── Recency ──────────────────────────────────────────────────────────────

/**
 * Returns a warning string if recent form diverges meaningfully from long-term.
 * Fixes v1 bug M3: fires on MORE EXTREME divergence, not just the narrow band.
 *
 *   ratio = l3 / l10
 *   if betting OVER and ratio < 0.80 → player has cooled significantly, warning
 *   if betting UNDER and ratio > 1.20 → player has heated up, warning
 *
 * Returns empty string if no warning is warranted.
 */
export function recencyWarning(recency: PickRecency | undefined, side: 'over' | 'under'): string {
  if (!recency) return '';
  const { l3_avg, l10_avg } = recency;
  if (l3_avg == null || l10_avg == null || l10_avg <= 0) return '';
  const ratio = l3_avg / l10_avg;
  if (side === 'over' && ratio < 0.80) {
    const pct = Math.round((1 - ratio) * 100);
    return `⚠️ Cooling: L3 ${l3_avg.toFixed(1)} is ${pct}% below L10 (${l10_avg.toFixed(1)})`;
  }
  if (side === 'under' && ratio > 1.20) {
    const pct = Math.round((ratio - 1) * 100);
    return `⚠️ Heating up: L3 ${l3_avg.toFixed(1)} is ${pct}% above L10 (${l10_avg.toFixed(1)})`;
  }
  return '';
}

/** Short trend indicator: '📈' / '📉' / '➡️' based on L3 vs L10. */
export function recencyTrend(recency: PickRecency | undefined): string {
  if (!recency?.l3_avg || !recency?.l10_avg || recency.l10_avg <= 0) return '';
  const ratio = recency.l3_avg / recency.l10_avg;
  if (ratio > 1.10) return '📈';
  if (ratio < 0.90) return '📉';
  return '➡️';
}

// ─── Stake sizing ─────────────────────────────────────────────────────────

/**
 * Fractional Kelly stake, clamped. Given confidence 0-100 and odds.
 * Uses half-Kelly to reduce variance. Never exceeds 3% of bankroll regardless
 * of Kelly output. Always rounds down to integer dollars.
 */
export function suggestedStake(confidence: number, americanOdds: number, bankroll: number): number {
  if (bankroll <= 0 || confidence <= 50) return 0;
  const trueProb = confidence / 100;
  const b = americanOdds > 0 ? americanOdds / 100 : 100 / Math.abs(americanOdds);
  // Kelly: f* = (b*p - q) / b  where q = 1-p
  const kelly = (b * trueProb - (1 - trueProb)) / b;
  if (kelly <= 0) return 0;
  const halfKelly = kelly * 0.5;
  const clamped = Math.min(halfKelly, 0.03); // max 3% of bankroll
  return Math.max(1, Math.floor(bankroll * clamped));
}

/** Sanity check: does this pick's confidence imply edge against the posted odds? */
export function hasMeaningfulEdge(pick: Pick): boolean {
  if (!pick.american_odds || pick.confidence == null) return false;
  const trueProb = pick.confidence / 100;
  const edge = edgePct(trueProb, pick.american_odds);
  return edge >= 3; // at least 3% edge to count
}

// ─── Tier classification ──────────────────────────────────────────────────

export function classifyTier(pick: Pick): 'elite' | 'high' | 'medium' | 'exploration' {
  if (pick.tier) return pick.tier;
  const c = pick.confidence;
  if (c >= 80) return 'elite';
  if (c >= 70) return 'high';
  if (c >= 60) return 'medium';
  return 'exploration';
}

export function tierEmoji(tier: Pick['tier']): string {
  switch (tier) {
    case 'elite': return '🏆';
    case 'high': return '🔥';
    case 'medium': return '📊';
    case 'exploration': return '🎲';
    default: return '📊';
  }
}

export function tierLabel(tier: Pick['tier']): string {
  switch (tier) {
    case 'elite': return 'Elite';
    case 'high': return 'High conviction';
    case 'medium': return 'Solid';
    case 'exploration': return 'Longshot';
    default: return 'Standard';
  }
}
