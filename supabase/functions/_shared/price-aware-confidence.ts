// ============================================================================
// price-aware-confidence.ts
// Price-Aware Confidence — Modules A (de-vig), B (line guard), C (verdict).
// Pure functions, no I/O. Used by signal-alert-engine to:
//   (1) refuse to publish a confidence number when the priced row looks like
//       an ALT line rather than the MAIN line we're scoring;
//   (2) cap model confidence at the de-vigged fair probability + a small edge;
//   (3) (feature-flagged) emit a BACK / LEAN / FADE / PASS verdict alongside.
//
// Spec source: "Price-Aware Confidence Spec — Strikeout Props" (chat, 2026-05).
// Module C is gated behind the `enableVerdict` flag because the BACK/LEAN
// thresholds and global-cap rollout still need product sign-off.
// ============================================================================

export const MAX_EDGE_OVER_FAIR = 0.08;      // model may exceed fair by 8pp
export const HARD_CONFIDENCE_CAP = 0.85;     // absolute confidence ceiling
export const MIN_EDGE_TO_PLAY = 0.03;        // 3pp edge minimum for BACK
export const STRONG_EDGE = 0.06;             // ≥6pp post-cap = strong BACK
export const FADE_EDGE = -0.03;              // ≤−3pp post-cap = FADE
export const ONE_SIDED_VIG_ASSUMED = 0.045;  // assumed half-vig on missing side

// Anything beyond these thresholds is treated as an ALT line, not the MAIN line.
// Standard "main" K-line juice lives in [-180, +160]. Outside that range we
// refuse to score because the priced row almost certainly belongs to an alt.
export const MAIN_LINE_MAX_POS = 160;
export const MAIN_LINE_MIN_NEG = -180;

// Stale main-line prices can drift several pips; refuse to trust them.
export const PRICE_STALE_MS = 5 * 60 * 1000;

export type Side = 'Over' | 'Under';

// ─── Module A: De-vig ──────────────────────────────────────────────────────

export function americanToImplied(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 0.5;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

/** Two-sided de-vig by normalization. Returns null if a side is missing. */
export function devigPair(
  over: number | null | undefined,
  under: number | null | undefined,
): { fair_over: number; fair_under: number; vig: number } | null {
  if (over == null || under == null) return null;
  if (!Number.isFinite(over) || !Number.isFinite(under)) return null;
  const po = americanToImplied(over);
  const pu = americanToImplied(under);
  const sum = po + pu;
  if (sum <= 0) return null;
  return { fair_over: po / sum, fair_under: pu / sum, vig: sum - 1 };
}

/**
 * One-sided fallback: strip an assumed half-vig from the priced side's
 * implied prob. Returns a fair prob for the side that IS priced.
 */
export function devigOneSided(odds: number): number {
  const p = americanToImplied(odds);
  return Math.max(0.01, Math.min(0.99, p - ONE_SIDED_VIG_ASSUMED));
}

// ─── Module B: Line Guard ──────────────────────────────────────────────────

export type PriceResolution =
  | { ok: true; over: number; under: number; fresh: boolean }
  | { ok: false; reason: 'UNPRICED_MAIN' | 'STALE_PRICE' | 'ALT_LINE_SUSPECTED'; detail?: string };

/**
 * Refuses to score when the available price doesn't look like the MAIN line
 * for this pick. Two failure modes we have actually shipped to users:
 *   (a) only one side priced (the alt-line ladder shows just "Over +244")
 *   (b) extreme juice on a supposed main K-line (the +244 example)
 *   (c) prices older than PRICE_STALE_MS
 */
export function resolvePrice(
  over: number | null | undefined,
  under: number | null | undefined,
  pricedAt?: Date | string | null,
  now: Date = new Date(),
): PriceResolution {
  if (over == null || under == null) {
    return { ok: false, reason: 'UNPRICED_MAIN', detail: 'missing_side' };
  }
  if (!Number.isFinite(over) || !Number.isFinite(under)) {
    return { ok: false, reason: 'UNPRICED_MAIN', detail: 'non_finite' };
  }
  const outOfBand = (o: number) => o > MAIN_LINE_MAX_POS || o < MAIN_LINE_MIN_NEG;
  if (outOfBand(over) || outOfBand(under)) {
    return {
      ok: false,
      reason: 'ALT_LINE_SUSPECTED',
      detail: `odds out of main-line band over=${over} under=${under}`,
    };
  }
  let fresh = true;
  if (pricedAt) {
    const t = pricedAt instanceof Date ? pricedAt.getTime() : Date.parse(String(pricedAt));
    if (Number.isFinite(t)) {
      fresh = (now.getTime() - t) <= PRICE_STALE_MS;
    }
  }
  return { ok: true, over, under, fresh };
}

// ─── Module C: Confidence Ceiling + Verdict (feature-flagged caller) ───────

export type Verdict =
  | 'STRONG_BACK'
  | 'BACK'
  | 'LEAN_BACK'
  | 'PASS'
  | 'FADE';

export interface PriceAwareInput {
  side: Side;
  modelProb: number;       // 0..1 (e.g. raw confidence / 100)
  over: number;
  under: number;
}

export interface PriceAwareResult {
  fair_prob_side: number;       // de-vigged fair prob for `side`
  implied_prob_side: number;    // raw implied (with vig) for `side`
  capped_prob: number;          // model prob capped to fair + MAX_EDGE_OVER_FAIR, then hard cap
  edge_pp: number;              // capped_prob − fair_prob_side (signed)
  is_plus_ev: boolean;          // capped_prob > implied_prob_side
  verdict: Verdict;
}

export function evaluate(input: PriceAwareInput): PriceAwareResult {
  const dev = devigPair(input.over, input.under);
  if (!dev) {
    // Shouldn't happen if resolvePrice succeeded, but guard anyway.
    return {
      fair_prob_side: 0.5,
      implied_prob_side: 0.5,
      capped_prob: Math.min(input.modelProb, HARD_CONFIDENCE_CAP),
      edge_pp: 0,
      is_plus_ev: false,
      verdict: 'PASS',
    };
  }
  const fair = input.side === 'Over' ? dev.fair_over : dev.fair_under;
  const implied = americanToImplied(input.side === 'Over' ? input.over : input.under);
  const ceiling = Math.min(HARD_CONFIDENCE_CAP, fair + MAX_EDGE_OVER_FAIR);
  const capped = Math.max(0.01, Math.min(ceiling, input.modelProb));
  const edge = capped - fair;
  const isPlusEv = capped > implied;

  let verdict: Verdict = 'PASS';
  if (edge >= STRONG_EDGE && isPlusEv) verdict = 'STRONG_BACK';
  else if (edge >= MIN_EDGE_TO_PLAY && isPlusEv) verdict = 'BACK';
  else if (edge > 0 && isPlusEv) verdict = 'LEAN_BACK';
  else if (edge <= FADE_EDGE) verdict = 'FADE';

  return {
    fair_prob_side: fair,
    implied_prob_side: implied,
    capped_prob: capped,
    edge_pp: edge,
    is_plus_ev: isPlusEv,
    verdict,
  };
}