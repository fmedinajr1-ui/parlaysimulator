export const V6_MODEL_VERSION = "v6-minutes-context";
export const MINUTES_FORECAST_VERSION = "minutes-v1";

export interface MinutesRecord {
  game_date: string;
  projected_minutes: number;
  actual_minutes: number | null;
  status: string;
}

/** Only the latest three fully settled slates count. Missing/DNP rows are excluded. */
export function minutesAccuracy(rows: MinutesRecord[]) {
  const dates = [...new Set(rows.map((r) => r.game_date))].sort().reverse();
  const completed = dates.filter((d) => {
    const slate = rows.filter((r) => r.game_date === d);
    return !slate.some((r) => r.status === "open") && slate.some((r) => r.status === "graded" && Number(r.actual_minutes) > 0);
  }).slice(0, 3);
  const valid = rows.filter((r) => completed.includes(r.game_date) && r.status === "graded" &&
    Number.isFinite(Number(r.actual_minutes)) && Number(r.actual_minutes) > 0 && Number.isFinite(Number(r.projected_minutes)));
  const mae = valid.length ? valid.reduce((n, r) => n + Math.abs(Number(r.projected_minutes) - Number(r.actual_minutes)), 0) / valid.length : null;
  return { slates: completed.length, samples: valid.length, mae, ready: completed.length === 3 && mae != null && mae <= 2,
    pending: rows.filter((r) => r.status === "open").length, dates: completed };
}

/** Shrink minutes-driven production changes and cap their influence at ±8%. */
export function minutesElasticity(projected: number, baseline: number, elasticity: number): number {
  if (!(projected > 0) || !(baseline > 0) || !Number.isFinite(projected + baseline + elasticity)) return 1;
  return Math.min(1.08, Math.max(0.92, 1 + Math.min(1, Math.max(0, elasticity)) * (projected / baseline - 1)));
}