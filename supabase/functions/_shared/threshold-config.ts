// Loader for tunable cascade alert thresholds.
// Reads from public.alert_thresholds, falls back to hardcoded v2 defaults.
// Cached in module scope; auto-refreshes when system_config.thresholds_version changes
// (and at most every TTL ms).

// deno-lint-ignore no-explicit-any
type Sb = any;

export type AxisKey = 'form' | 'defense' | 'pace' | 'juice' | 'model_edge';

export interface AxisThresholds {
  aligned_over: number;
  aligned_under: number;
  against_over: number;
  against_under: number;
  neutral_band: number | null;
}

export type ThresholdSet = Record<AxisKey, AxisThresholds>;

// v2 defaults — must match the values seeded in the migration.
export const DEFAULT_THRESHOLDS: Record<string, ThresholdSet> = {
  ALL: {
    form:       { aligned_over: 0.55, aligned_under: 0.55, against_over: 0.25, against_under: 0.25, neutral_band: null },
    defense:    { aligned_over: 20,   aligned_under: 13,   against_over: 12,   against_under: 20,   neutral_band: null },
    pace:       { aligned_over: 220,  aligned_under: 213,  against_over: 213,  against_under: 220,  neutral_band: null },
    juice:      { aligned_over: 20,   aligned_under: 20,   against_over: 5,    against_under: 5,    neutral_band: null },
    model_edge: { aligned_over: 0.5,  aligned_under: 0.5,  against_over: -0.5, against_under: -0.5, neutral_band: null },
  },
  MLB: {
    form:       { aligned_over: 0.55, aligned_under: 0.55, against_over: 0.25, against_under: 0.25, neutral_band: null },
    defense:    { aligned_over: 20,   aligned_under: 13,   against_over: 12,   against_under: 20,   neutral_band: null },
    pace:       { aligned_over: 9,    aligned_under: 7.5,  against_over: 7.5,  against_under: 9,    neutral_band: null },
    juice:      { aligned_over: 20,   aligned_under: 20,   against_over: 5,    against_under: 5,    neutral_band: null },
    model_edge: { aligned_over: 0.5,  aligned_under: 0.5,  against_over: -0.5, against_under: -0.5, neutral_band: null },
  },
};

const TTL_MS = 60_000;
let _cache: { rows: any[]; version: number; loadedAt: number } | null = null;

export function invalidateThresholdCache() {
  _cache = null;
}

async function fetchAll(supabase: Sb): Promise<{ rows: any[]; version: number }> {
  let version = 0;
  try {
    const { data: ver } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'thresholds_version')
      .maybeSingle();
    if (ver?.value != null) version = Number(ver.value) || 0;
  } catch (_e) {
    // non-fatal
  }
  let rows: any[] = [];
  try {
    const { data } = await supabase
      .from('alert_thresholds')
      .select('sport, axis, aligned_over, aligned_under, against_over, against_under, neutral_band');
    rows = Array.isArray(data) ? data : [];
  } catch (_e) {
    rows = [];
  }
  return { rows, version };
}

function defaultsForSport(sport: string): ThresholdSet {
  const upper = (sport || 'ALL').toUpperCase();
  const base = DEFAULT_THRESHOLDS.ALL;
  const sportDef = DEFAULT_THRESHOLDS[upper];
  if (!sportDef) return { ...base };
  return {
    form: sportDef.form ?? base.form,
    defense: sportDef.defense ?? base.defense,
    pace: sportDef.pace ?? base.pace,
    juice: sportDef.juice ?? base.juice,
    model_edge: sportDef.model_edge ?? base.model_edge,
  };
}

function buildSet(rows: any[], sport: string): ThresholdSet {
  const upper = (sport || 'ALL').toUpperCase();
  const def = defaultsForSport(upper);
  const out: ThresholdSet = {
    form: { ...def.form },
    defense: { ...def.defense },
    pace: { ...def.pace },
    juice: { ...def.juice },
    model_edge: { ...def.model_edge },
  };
  // Apply ALL first, then sport-specific overrides
  for (const scope of ['ALL', upper]) {
    for (const r of rows) {
      if ((r.sport || '').toUpperCase() !== scope) continue;
      const axis = r.axis as AxisKey;
      if (!out[axis]) continue;
      out[axis] = {
        aligned_over:  num(r.aligned_over,  out[axis].aligned_over),
        aligned_under: num(r.aligned_under, out[axis].aligned_under),
        against_over:  num(r.against_over,  out[axis].against_over),
        against_under: num(r.against_under, out[axis].against_under),
        neutral_band:  r.neutral_band == null ? out[axis].neutral_band : Number(r.neutral_band),
      };
    }
  }
  return out;
}

function num(v: any, fallback: number): number {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function getThresholds(supabase: Sb, sport: string): Promise<ThresholdSet> {
  const now = Date.now();
  const stale = !_cache || (now - _cache.loadedAt) > TTL_MS;
  if (stale) {
    try {
      const { rows, version } = await fetchAll(supabase);
      _cache = { rows, version, loadedAt: now };
    } catch (_e) {
      if (!_cache) _cache = { rows: [], version: 0, loadedAt: now };
    }
  }
  if (!_cache || _cache.rows.length === 0) return defaultsForSport(sport);
  return buildSet(_cache.rows, sport);
}

// Synchronous helpers for tests / direct callers that already have the rows.
export function buildThresholdSetFromRows(rows: any[], sport: string): ThresholdSet {
  if (!rows || rows.length === 0) return defaultsForSport(sport);
  return buildSet(rows, sport);
}

export const AXIS_KEYS: AxisKey[] = ['form', 'defense', 'pace', 'juice', 'model_edge'];
export const FIELD_KEYS = ['aligned_over', 'aligned_under', 'against_over', 'against_under', 'neutral_band'] as const;
export type FieldKey = typeof FIELD_KEYS[number];

// Sanity bounds for validation when accepting writes from Telegram.
export const FIELD_BOUNDS: Record<AxisKey, { min: number; max: number }> = {
  form:       { min: 0,    max: 1 },
  defense:    { min: 1,    max: 32 },
  pace:       { min: 0,    max: 500 },
  juice:      { min: -200, max: 200 },
  model_edge: { min: -5,   max: 5 },
};

export function validateFieldValue(axis: AxisKey, value: number): { ok: boolean; error?: string } {
  const b = FIELD_BOUNDS[axis];
  if (!b) return { ok: false, error: `unknown axis ${axis}` };
  if (!Number.isFinite(value)) return { ok: false, error: 'value not finite' };
  if (value < b.min || value > b.max) return { ok: false, error: `value out of bounds [${b.min}, ${b.max}]` };
  return { ok: true };
}