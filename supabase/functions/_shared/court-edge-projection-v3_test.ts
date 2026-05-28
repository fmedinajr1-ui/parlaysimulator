import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveSetsFormat,
  weightedL3,
  spreadAdjV3,
  weatherAdjV3,
  projectV3,
  verdictV3,
  gradeV3,
} from "./court-edge-projection-v3.ts";

Deno.test("v3: resolveSetsFormat — only ATP+GS is bo5", () => {
  assertEquals(resolveSetsFormat("ATP", "grand_slam"), "bo5");
  assertEquals(resolveSetsFormat("WTA", "grand_slam"), "bo3");
  assertEquals(resolveSetsFormat("ATP", "masters_1000"), "bo3");
  assertEquals(resolveSetsFormat("WTA", "wta_250"), "bo3");
});

Deno.test("v3: weightedL3 — strict 0.5/0.3/0.2; null on short/sparse", () => {
  assertAlmostEquals(weightedL3([22, 20, 18])!, 22 * 0.5 + 20 * 0.3 + 18 * 0.2, 1e-9);
  assertEquals(weightedL3([22, 20]), null);
  assertEquals(weightedL3([22, null, 18]), null);
  assertEquals(weightedL3(null), null);
});

Deno.test("v3: projectV3 — known inputs produce expected projection", () => {
  // Both players wL3 = 22; clay (×1.00) × bo3 (×1.00) = 22 base.
  // Pick-em moneylines → spread_adj = 0. No weather, outdoor, neutral fit.
  const r = projectV3({
    tour: "ATP", tier: "masters_1000", surface: "clay", venue: "outdoor",
    ml_fav: -110, ml_dog: -110,
    p1_L3_games: [22, 22, 22], p2_L3_games: [22, 22, 22],
    p1_surface_fit: 0.65, p2_surface_fit: 0.65,
    weather: null,
  });
  assertEquals(r.sets_format, "bo3");
  assertAlmostEquals(r.projection!, 22.0, 0.01);
  assertEquals(r.weak_fit_count, 0);
});

Deno.test("v3: verdictV3 — boundary edges + weak-fit gate downgrade", () => {
  assertEquals(verdictV3(0.08, 0).verdict, "BACK_OVER");
  assertEquals(verdictV3(0.079, 0).verdict, "PASS");
  assertEquals(verdictV3(-0.08, 0).verdict, "FADE_OVER");
  assertEquals(verdictV3(-0.0799, 0).verdict, "PASS");
  // Strong over edge but both players weak-fit → downgrade with reason.
  const gated = verdictV3(0.20, 2);
  assertEquals(gated.verdict, "PASS");
  assertEquals(gated.pass_reason, "edge_gated_by_2x_weak_fit");
  // One weak-fit only → no downgrade.
  assertEquals(verdictV3(0.20, 1).verdict, "BACK_OVER");
});

Deno.test("v3: spread/weather/indoor stacking with gradeV3", () => {
  // Closer match (gap=0) → spread_adj=0; hot+windy → -0.70; indoor → +0.20.
  // Note: venue=indoor implies no outdoor weather, but we still test math stacking.
  const r = gradeV3({
    tour: "WTA", tier: "wta_500", surface: "hard", venue: "indoor",
    ml_fav: -130, ml_dog: 110,
    p1_L3_games: [20, 20, 20], p2_L3_games: [20, 20, 20],
    p1_surface_fit: 0.80, p2_surface_fit: 0.40,
    weather: { temp_c: 31, wind_kph: 28, humidity: 50 },
  }, 20.0);
  // base = 20; surface_mult=1, sets_mult=1 → 20.
  // spread_adj: gap=|130-110|=20 → (20/10)*0.30*+1 = +0.60.
  // weather_adj = -0.70. indoor_adj = +0.20.
  // p1_role_adj = +0.15 (strong), p2_role_adj = -0.20 (weak).
  // total = 20 + 0.60 - 0.70 + 0.20 + 0.15 - 0.20 = 20.05.
  assertAlmostEquals(r.projection!, 20.05, 0.01);
  assertAlmostEquals(spreadAdjV3(-130, 110), 0.60, 1e-9);
  assertAlmostEquals(weatherAdjV3({ temp_c: 31, wind_kph: 28 }), -0.70, 1e-9);
  assertEquals(r.weak_fit_count, 1);
  // edge_pct = (20.05 - 20)/20 = +0.0025 → PASS.
  assertEquals(r.verdict, "PASS");
});