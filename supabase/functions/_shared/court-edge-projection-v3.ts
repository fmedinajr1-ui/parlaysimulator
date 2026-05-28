// Court.Edge v3 — spec-exact parallel projection engine.
// Pure helpers, no I/O. Runs alongside the live Phase 2/3 engine and writes to
// the `v3_shadow` JSONB column on court_edge_picks for A/B audit.
//
// Spec source: user-provided "COURT.EDGE — Match Total Games Projection (Tennis)".

import type { TournamentTier } from "./court-edge-tournament-tier.ts";

export type TourV3 = "ATP" | "WTA";
export type SurfaceV3 = "clay" | "hard" | "grass";
export type VenueV3 = "outdoor" | "indoor";
export type SetsFormatV3 = "bo3" | "bo5";

// ---------- Named constants (from spec) ----------
export const WEIGHTS_L3 = [0.5, 0.3, 0.2] as const;
export const SURFACE_MULT: Record<SurfaceV3, number> = { clay: 1.00, hard: 1.00, grass: 0.97 };
export const SETS_MULT: Record<SetsFormatV3, number> = { bo3: 1.00, bo5: 1.47 };
export const SPREAD_ADJ_PER_10_AM_GAP = 0.30;
export const WEATHER_HEAT_THRESHOLD_C = 30;
export const WEATHER_HEAT_ADJ = -0.40;
export const WEATHER_WIND_THRESHOLD = 25;          // kph
export const WEATHER_WIND_ADJ = -0.30;
export const INDOOR_ADJ = +0.20;
export const WEAK_FIT_THRESHOLD = 0.55;
export const WEAK_FIT_PENALTY = -0.20;             // per player below threshold
export const STRONG_FIT_THRESHOLD = 0.75;
export const STRONG_FIT_BONUS = +0.15;             // per player above threshold
export const EDGE_BACK_THRESHOLD = +0.08;
export const EDGE_FADE_THRESHOLD = -0.08;
export const WEAK_FIT_GATE_COUNT = 2;

export interface WeatherV3 {
  temp_c?: number | null;
  wind_kph?: number | null;
  humidity?: number | null;
}

export interface ProjectionV3Input {
  tour: TourV3;
  tier: TournamentTier;                 // mapped from existing classifier
  surface: SurfaceV3;
  venue: VenueV3;
  ml_fav: number | null;                // American odds
  ml_dog: number | null;
  p1_L3_games: Array<number | null> | null;
  p2_L3_games: Array<number | null> | null;
  p1_surface_fit: number | null;        // [0,1] on active surface
  p2_surface_fit: number | null;
  weather: WeatherV3 | null;
}

export type VerdictV3 = "BACK_OVER" | "FADE_OVER" | "PASS";

export interface ProjectionV3Result {
  sets_format: SetsFormatV3;
  base_l3: number | null;
  surface_mult: number;
  sets_mult: number;
  spread_adj: number;
  weather_adj: number;
  indoor_adj: number;
  p1_role_adj: number;
  p2_role_adj: number;
  weak_fit_count: number;
  projection: number | null;
  edge_pct: number | null;
  verdict: VerdictV3;
  pass_reason: string | null;
}

// bo5 ONLY for ATP Grand Slams. All WTA matches and all non-GS ATP → bo3.
export function resolveSetsFormat(tour: TourV3, tier: TournamentTier): SetsFormatV3 {
  if (tour === "ATP" && tier === "grand_slam") return "bo5";
  return "bo3";
}

// Spec wL3: STRICT — requires 3 entries, all non-null. Returns null otherwise.
export function weightedL3(games: Array<number | null> | null | undefined): number | null {
  if (!games || games.length < 3) return null;
  const slice = games.slice(0, 3);
  for (const g of slice) {
    if (g == null || !Number.isFinite(g)) return null;
  }
  return (slice[0] as number) * WEIGHTS_L3[0]
       + (slice[1] as number) * WEIGHTS_L3[1]
       + (slice[2] as number) * WEIGHTS_L3[2];
}

// Spread adj: tighter ML (small gap) → more games (+adj); blowout (gap > 100) → −adj.
// gap = |abs(ml_fav) − abs(ml_dog)|, magnitude scaled by SPREAD_ADJ_PER_10_AM_GAP per 10pts.
export function spreadAdjV3(mlFav: number | null, mlDog: number | null): number {
  if (mlFav == null || mlDog == null || !Number.isFinite(mlFav) || !Number.isFinite(mlDog)) return 0;
  const gap = Math.abs(Math.abs(mlFav) - Math.abs(mlDog));
  const sign = gap > 100 ? -1 : +1;
  return (gap / 10) * SPREAD_ADJ_PER_10_AM_GAP * sign;
}

export function weatherAdjV3(w: WeatherV3 | null | undefined): number {
  if (!w) return 0;
  let adj = 0;
  if (typeof w.temp_c === "number" && w.temp_c >= WEATHER_HEAT_THRESHOLD_C) adj += WEATHER_HEAT_ADJ;
  if (typeof w.wind_kph === "number" && w.wind_kph >= WEATHER_WIND_THRESHOLD) adj += WEATHER_WIND_ADJ;
  return adj;
}

export function fitAdjV3(fit: number | null | undefined): number {
  if (fit == null || !Number.isFinite(fit)) return 0;
  if (fit < WEAK_FIT_THRESHOLD) return WEAK_FIT_PENALTY;
  if (fit >= STRONG_FIT_THRESHOLD) return STRONG_FIT_BONUS;
  return 0;
}

export function projectV3(input: ProjectionV3Input): ProjectionV3Result {
  const sets_format = resolveSetsFormat(input.tour, input.tier);
  const surface_mult = SURFACE_MULT[input.surface] ?? 1.0;
  const sets_mult = SETS_MULT[sets_format];

  const p1 = weightedL3(input.p1_L3_games);
  const p2 = weightedL3(input.p2_L3_games);

  const spread_adj = spreadAdjV3(input.ml_fav, input.ml_dog);
  const weather_adj = weatherAdjV3(input.weather);
  const indoor_adj = input.venue === "indoor" ? INDOOR_ADJ : 0;
  const p1_role_adj = fitAdjV3(input.p1_surface_fit);
  const p2_role_adj = fitAdjV3(input.p2_surface_fit);

  const weak_fit_count =
    (input.p1_surface_fit != null && input.p1_surface_fit < WEAK_FIT_THRESHOLD ? 1 : 0) +
    (input.p2_surface_fit != null && input.p2_surface_fit < WEAK_FIT_THRESHOLD ? 1 : 0);

  if (p1 == null || p2 == null) {
    return {
      sets_format,
      base_l3: null,
      surface_mult, sets_mult,
      spread_adj, weather_adj, indoor_adj,
      p1_role_adj, p2_role_adj,
      weak_fit_count,
      projection: null,
      edge_pct: null,
      verdict: "PASS",
      pass_reason: "insufficient_L3_data",
    };
  }

  const base_l3 = (p1 + p2) / 2;
  const projection =
    base_l3 * surface_mult * sets_mult +
    spread_adj + weather_adj + indoor_adj +
    p1_role_adj + p2_role_adj;

  return {
    sets_format,
    base_l3,
    surface_mult, sets_mult,
    spread_adj, weather_adj, indoor_adj,
    p1_role_adj, p2_role_adj,
    weak_fit_count,
    projection,
    edge_pct: null, // filled by gradeV3 once line is known
    verdict: "PASS",
    pass_reason: null,
  };
}

export function verdictV3(
  edgePct: number | null,
  weakFitCount: number,
): { verdict: VerdictV3; pass_reason: string | null } {
  if (edgePct == null || !Number.isFinite(edgePct)) {
    return { verdict: "PASS", pass_reason: "no_edge" };
  }
  let raw: VerdictV3 = "PASS";
  if (edgePct >= EDGE_BACK_THRESHOLD) raw = "BACK_OVER";
  else if (edgePct <= EDGE_FADE_THRESHOLD) raw = "FADE_OVER";

  if (raw !== "PASS" && weakFitCount >= WEAK_FIT_GATE_COUNT) {
    return { verdict: "PASS", pass_reason: `edge_gated_by_${weakFitCount}x_weak_fit` };
  }
  return { verdict: raw, pass_reason: null };
}

// Convenience: project + grade against a sportsbook line in one call.
export function gradeV3(input: ProjectionV3Input, line: number): ProjectionV3Result {
  const r = projectV3(input);
  if (r.projection == null || !Number.isFinite(line) || line <= 0) return r;
  const edge_pct = (r.projection - line) / line;
  const v = verdictV3(edge_pct, r.weak_fit_count);
  return { ...r, edge_pct, verdict: v.verdict, pass_reason: v.pass_reason };
}