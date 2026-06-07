// MLB Fair-Price constants (spec §6). Numbers are intentionally conservative
// while we're in WARN/measurement mode — do not retune without 2 weeks of logs.
export const MIN_EV_PCT = 0.03;
export const MAX_SCORE_DIFF = 8;
export const REG_INNINGS = 9;
export const MIN_LIQUIDITY = 50;
export const STALE_FEED_MS = 4000;

// LAG_WINDOW_MS is NOT a constant — pull p90 per (book, sport, market).
// acceptanceDelayMs is measured per book (submit→confirm), not assumed.