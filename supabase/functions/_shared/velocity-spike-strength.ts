// ============================================================================
// velocity-spike-strength.ts
// Combined outcome + CLV strength meter for the "Slate Outlier" (velocity_spike)
// signal. Aggregates historical hit rates from fanduel_prediction_accuracy and
// produces a per-(sport, prop_type) recommendation: PLAY, FADE, or SKIP.
//
// Decision math (Bayesian-smoothed):
//   combined = (outcome_correct + clv_correct + alpha*prior)
//            / (outcome_n + clv_n + alpha)
// Defaults: prior = 0.50, alpha = 10. CLV and outcome rows weighted equally.
//
// Recommendation thresholds (require >= MIN_SAMPLE total rows to decide):
//   combined >= PLAY_THRESHOLD   → PLAY  (keep original side)
//   combined <= FADE_THRESHOLD   → FADE  (flip to opposite side)
//   otherwise                    → FADE_DEFAULT (insufficient sample / neutral)
//
// Why default FADE: global velocity_spike hit rate is 28.3% (91/321) — the
// natural side is a known loser, so when we lack a stronger per-cohort read,
// the safer prior is to fade.
// ============================================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type StrengthLabel =
  | 'STRONG_PLAY'
  | 'LEAN_PLAY'
  | 'NEUTRAL'
  | 'LEAN_FADE'
  | 'STRONG_FADE';

export type Recommendation = 'play' | 'fade' | 'skip';

export type StrengthVerdict = {
  recommendation: Recommendation;
  label: StrengthLabel;
  combined_hit_rate: number;   // 0..1 (smoothed)
  meter: number;               // 0..100 — confidence in the chosen direction
  outcome_n: number;
  outcome_correct: number;
  clv_n: number;
  clv_correct: number;
  cohort: 'sport+prop' | 'sport' | 'global';
  reason: string;
};

type Bucket = { n: number; c: number };
type StatsMap = {
  sportProp: Map<string, { outcome: Bucket; clv: Bucket }>;   // `${sport}|${prop_type}`
  sport: Map<string, { outcome: Bucket; clv: Bucket }>;       // `${sport}`
  global: { outcome: Bucket; clv: Bucket };
};

const PRIOR = 0.5;
const ALPHA = 10;
const PLAY_THRESHOLD = 0.55;
const FADE_THRESHOLD = 0.42;
const MIN_SAMPLE_COHORT = 20;
const MIN_SAMPLE_SPORT = 30;

function emptyStats(): StatsMap {
  return {
    sportProp: new Map(),
    sport: new Map(),
    global: { outcome: { n: 0, c: 0 }, clv: { n: 0, c: 0 } },
  };
}

function bump(b: Bucket, correct: boolean) {
  b.n += 1;
  if (correct) b.c += 1;
}

/** Load once per engine run. Failures return an empty map (engine falls back to default fade). */
export async function loadVelocitySpikeStrength(
  supabase: SupabaseClient,
): Promise<StatsMap> {
  const stats = emptyStats();
  try {
    const { data, error } = await supabase
      .from('fanduel_prediction_accuracy')
      .select('sport, prop_type, settlement_method, was_correct, actual_outcome')
      .eq('signal_type', 'velocity_spike')
      .not('was_correct', 'is', null)
      .neq('actual_outcome', 'informational_excluded')
      .limit(5000);
    if (error) {
      console.warn('[velocity-spike-strength] load error (using global fade default):', error.message);
      return stats;
    }
    for (const r of data ?? []) {
      const sport = (r.sport ?? 'UNKNOWN').toUpperCase();
      const propType = r.prop_type ?? 'unknown';
      const isClv = r.settlement_method === 'clv';
      const correct = !!r.was_correct;

      // global
      bump(isClv ? stats.global.clv : stats.global.outcome, correct);

      // sport
      const sBuckets = stats.sport.get(sport) ?? { outcome: { n: 0, c: 0 }, clv: { n: 0, c: 0 } };
      bump(isClv ? sBuckets.clv : sBuckets.outcome, correct);
      stats.sport.set(sport, sBuckets);

      // sport + prop
      const key = `${sport}|${propType}`;
      const cBuckets = stats.sportProp.get(key) ?? { outcome: { n: 0, c: 0 }, clv: { n: 0, c: 0 } };
      bump(isClv ? cBuckets.clv : cBuckets.outcome, correct);
      stats.sportProp.set(key, cBuckets);
    }
  } catch (e) {
    console.warn('[velocity-spike-strength] load threw (using global fade default):', e);
  }
  return stats;
}

function smoothed(outcome: Bucket, clv: Bucket): { rate: number; n: number; c: number } {
  const n = outcome.n + clv.n;
  const c = outcome.c + clv.c;
  const rate = (c + ALPHA * PRIOR) / (n + ALPHA);
  return { rate, n, c };
}

function labelFor(rate: number, n: number, minSample: number): StrengthLabel {
  if (n < minSample) return 'NEUTRAL';
  if (rate >= 0.62) return 'STRONG_PLAY';
  if (rate >= PLAY_THRESHOLD) return 'LEAN_PLAY';
  if (rate <= 0.32) return 'STRONG_FADE';
  if (rate <= FADE_THRESHOLD) return 'LEAN_FADE';
  return 'NEUTRAL';
}

/**
 * Score one candidate. Falls back through cohort tiers:
 *   sport+prop_type (≥20)  →  sport (≥30)  →  global
 */
export function scoreVelocitySpike(
  stats: StatsMap,
  sport: string,
  propType: string | null,
): StrengthVerdict {
  const s = (sport ?? 'UNKNOWN').toUpperCase();
  const p = propType ?? 'unknown';

  const tiers: Array<{
    cohort: StrengthVerdict['cohort'];
    buckets: { outcome: Bucket; clv: Bucket } | undefined;
    minSample: number;
    reason: string;
  }> = [
    { cohort: 'sport+prop', buckets: stats.sportProp.get(`${s}|${p}`), minSample: MIN_SAMPLE_COHORT, reason: `${s} ${p}` },
    { cohort: 'sport',      buckets: stats.sport.get(s),                minSample: MIN_SAMPLE_SPORT,  reason: `${s} all props` },
    { cohort: 'global',     buckets: stats.global,                       minSample: 0,                 reason: 'global velocity_spike baseline' },
  ];

  for (const tier of tiers) {
    if (!tier.buckets) continue;
    const { rate, n, c } = smoothed(tier.buckets.outcome, tier.buckets.clv);
    if (n < tier.minSample && tier.cohort !== 'global') continue;

    const lab = labelFor(rate, n, tier.cohort === 'global' ? 0 : tier.minSample);

    let rec: Recommendation;
    if (lab === 'STRONG_PLAY' || lab === 'LEAN_PLAY') rec = 'play';
    else if (lab === 'STRONG_FADE' || lab === 'LEAN_FADE') rec = 'fade';
    else {
      // Neutral / insufficient: default to FADE because global = 28%.
      rec = 'fade';
    }

    // Meter: confidence in the chosen direction, 0..100.
    // play  → rate * 100
    // fade  → (1 - rate) * 100
    const meter = rec === 'play' ? Math.round(rate * 100) : Math.round((1 - rate) * 100);

    return {
      recommendation: rec,
      label: lab,
      combined_hit_rate: Math.round(rate * 1000) / 1000,
      meter,
      outcome_n: tier.buckets.outcome.n,
      outcome_correct: tier.buckets.outcome.c,
      clv_n: tier.buckets.clv.n,
      clv_correct: tier.buckets.clv.c,
      cohort: tier.cohort,
      reason: `${tier.reason}: ${c}/${n} smoothed → ${Math.round(rate * 100)}%`,
    };
  }

  // Should be unreachable (global tier always present), but stay safe.
  return {
    recommendation: 'fade',
    label: 'NEUTRAL',
    combined_hit_rate: PRIOR,
    meter: 50,
    outcome_n: 0, outcome_correct: 0, clv_n: 0, clv_correct: 0,
    cohort: 'global',
    reason: 'no data — defaulting to fade (global baseline 28%)',
  };
}

/** Human-friendly emoji bar (10 cells). */
export function meterBar(meter: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(meter / 10)));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}