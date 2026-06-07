// Fair-price + edge math (spec §4-5).

export function americanToImplied(odds: number): number {
  if (odds === 0) return NaN;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

// De-vig a two-way market by normalizing implied probs.
export function deVig(implied: number, oppositeImplied: number): number {
  const sum = implied + oppositeImplied;
  if (!Number.isFinite(sum) || sum <= 0) return NaN;
  return implied / sum;
}

export interface BookLine {
  bookId: string;
  market: "LIVE_ML";
  impliedDevig: number;     // already de-vigged
  lastMoveTs: number;       // monotonic ms when book last moved
  suspended?: boolean;
  limit?: number;
  acceptanceDelayMs?: number | null;
}

// Edge for LIVE_ML is simply WP_post − de-vigged book implied.
export function liveMlEdge(wpPost: number, book: BookLine): number {
  return wpPost - book.impliedDevig;
}