/**
 * Tri-Signal Projection Engine
 * Blends three independent signals for more accurate in-game projections:
 *   1. Rate projection (existing pace-based)
 *   2. Book-implied projection (live market line)
 *   3. FG efficiency adjustment (regression-aware, scoring props only)
 */

export interface TriSignalInput {
  currentValue: number;
  ratePerMinute: number;
  remainingMinutes: number;
  gameProgress: number;        // 0-100
  propType: string;

  // Signal 2: Book line (optional)
  liveBookLine?: number;

  // Signal 3: FG efficiency (optional, scoring props only)
  fgPct?: number;              // Live FG% (0-1)
  baselineFgPct?: number;      // L10 baseline FG% (0-1)
}

export interface TriSignalResult {
  projectedFinal: number;
  confidence: number;
  signals: {
    rate: number;
    book: number | null;
    fgAdjusted: number | null;
  };
  weights: {
    rate: number;
    book: number;
    fg: number;
  };
}

/** Quarter-based weight schedules */
function getSignalWeights(gameProgress: number, hasFgData: boolean): { rate: number; book: number; fg: number } {
  let rate: number, book: number, fg: number;

  if (gameProgress < 25) {
    rate = 0.40; book = 0.45; fg = 0.15;
  } else if (gameProgress < 50) {
    rate = 0.45; book = 0.35; fg = 0.20;
  } else if (gameProgress < 75) {
    rate = 0.55; book = 0.25; fg = 0.20;
  } else {
    rate = 0.70; book = 0.15; fg = 0.15;
  }

  // If no FG data, redistribute fg weight to rate
  if (!hasFgData) {
    rate += fg;
    fg = 0;
  }

  return { rate, book, fg };
}

/** Scoring prop types that benefit from FG adjustment */
const SCORING_PROPS = new Set(['points', 'threes', 'player_points', 'player_threes']);

/**
 * Calculate a tri-signal blended projection.
 * Falls back gracefully when book or FG data is unavailable.
 */
export function calculateTriSignalProjection(input: TriSignalInput): TriSignalResult {
  const {
    currentValue,
    ratePerMinute,
    remainingMinutes,
    gameProgress,
    propType,
    liveBookLine,
    fgPct,
    baselineFgPct,
  } = input;

  // Signal 1: Rate-based projection (always available)
  const rateProjection = currentValue + ratePerMinute * remainingMinutes;

  // Signal 2: Book-implied projection
  const hasBookData = liveBookLine != null && liveBookLine > 0;
  const bookProjection = hasBookData ? liveBookLine! : null;

  // Signal 3: FG efficiency adjustment (scoring props only)
  const isScoringProp = SCORING_PROPS.has(propType.toLowerCase());
  const hasFgData = isScoringProp && fgPct != null && baselineFgPct != null && fgPct > 0;

  let fgAdjustedProjection: number | null = null;
  if (hasFgData) {
    // Soft regression: (baseline / live)^0.3
    // If shooting 60% on a 45% baseline → factor ~0.91 (slight regression)
    // If shooting 30% on a 45% baseline → factor ~1.14 (expected bounce-back)
    const regressionFactor = Math.pow(baselineFgPct! / fgPct!, 0.3);
    // Clamp regression factor to avoid wild swings
    const clampedFactor = Math.max(0.7, Math.min(1.4, regressionFactor));
    fgAdjustedProjection = currentValue + (ratePerMinute * clampedFactor) * remainingMinutes;
  }

  // Get weights based on game progress
  const weights = getSignalWeights(gameProgress, hasFgData);

  // If no book data, redistribute book weight to rate
  let effectiveWeights = { ...weights };
  if (!hasBookData) {
    effectiveWeights.rate += effectiveWeights.book;
    effectiveWeights.book = 0;
  }

  // Blend signals
  let projectedFinal = effectiveWeights.rate * rateProjection;

  if (hasBookData && bookProjection !== null) {
    projectedFinal += effectiveWeights.book * bookProjection;
  }

  if (hasFgData && fgAdjustedProjection !== null) {
    projectedFinal += effectiveWeights.fg * fgAdjustedProjection;
  }

  // Round to 1 decimal
  projectedFinal = Math.round(projectedFinal * 10) / 10;

  // Confidence boost when multiple signals agree
  let confidence = 50;
  if (hasBookData && bookProjection !== null) {
    const bookAgreement = 1 - Math.abs(rateProjection - bookProjection) / Math.max(rateProjection, 1);
    confidence += Math.round(bookAgreement * 20); // Up to +20 when rate & book agree
  }
  if (gameProgress > 50) confidence += 10; // More data = more confidence
  confidence = Math.max(10, Math.min(95, confidence));

  return {
    projectedFinal,
    confidence,
    signals: {
      rate: Math.round(rateProjection * 10) / 10,
      book: bookProjection,
      fgAdjusted: fgAdjustedProjection ? Math.round(fgAdjustedProjection * 10) / 10 : null,
    },
    weights: effectiveWeights,
  };
}
