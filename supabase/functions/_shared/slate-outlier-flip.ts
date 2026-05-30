// ============================================================================
// slate-outlier-flip.ts
// Shared flip contract for velocity_spike / slate-outlier alerts.
//
// CONTRACT (see mem://logic/betting/slate-outlier-side-flip):
//   fanduel_prediction_alerts rows with signal_type='velocity_spike' store
//   `prediction` (and metadata.original_side) as the ORIGINAL PUBLIC side.
//   When metadata.mode === 'fade', the actual bet is the OPPOSITE side and
//   the relevant odds are the OPPOSITE-side price.
//
// Every downstream consumer (parlay generators, telegram broadcasters, ROI
// trackers) MUST go through these helpers — DO NOT read `prediction` or
// `over_price`/`under_price` directly to decide what side/price to play.
// ============================================================================

export type Side = 'Over' | 'Under';

export type SlateAlertLike = {
  prediction?: string | null;
  metadata?: {
    mode?: string | null;
    original_side?: string | null;
    over_price?: number | string | null;
    under_price?: number | string | null;
    [k: string]: unknown;
  } | null;
};

function normalizeSide(raw: unknown): Side {
  return String(raw ?? '').toLowerCase() === 'over' ? 'Over' : 'Under';
}

/** Returns the side we should actually BET (post-flip when mode='fade'). */
export function playSide(a: SlateAlertLike): Side {
  const original = normalizeSide(a.metadata?.original_side ?? a.prediction);
  const mode = String(a.metadata?.mode ?? '').toLowerCase();
  if (mode === 'fade') return original === 'Over' ? 'Under' : 'Over';
  return original;
}

/** Returns the original public/market side (pre-flip). */
export function publicSide(a: SlateAlertLike): Side {
  return normalizeSide(a.metadata?.original_side ?? a.prediction);
}

/** Returns the American odds for the play side (post-flip). */
export function playAmericanOdds(a: SlateAlertLike): number | null {
  const side = playSide(a);
  const raw = side === 'Over' ? a.metadata?.over_price : a.metadata?.under_price;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** Converts American odds to decimal. Falls back to -110 (1.91) when missing. */
export function americanToDecimal(odds: number | null | undefined): number {
  if (odds === null || odds === undefined) return 1.91;
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return 1.91;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

/** Decimal price for the play side (post-flip). */
export function playDecimalPrice(a: SlateAlertLike): number {
  return americanToDecimal(playAmericanOdds(a));
}