import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  weightedL3,
  spreadAdj,
  spreadAdjV2,
  weatherAdj,
  project,
  verdictFromEdgePp,
} from "./court-edge-projection.ts";
import { priorFor } from "./court-edge-prior.ts";

Deno.test("weightedL3: 0.5/0.3/0.2 weighted average", () => {
  // 22 most recent, then 20, then 18
  // = 22*0.5 + 20*0.3 + 18*0.2 = 11 + 6 + 3.6 = 20.6
  assertAlmostEquals(weightedL3([22, 20, 18]), 20.6, 0.0001);
});

Deno.test("spreadAdj: symmetric for flipped favourite/underdog", () => {
  const a = spreadAdj(-150, 130);
  const b = spreadAdj(130, -150);
  assertAlmostEquals(a, b, 0.0001);
  // both should be negative (favourites shorten matches)
  assertEquals(a < 0, true);
});

Deno.test("weatherAdj: hot + windy + humid stack", () => {
  // 90F (+0.3), 18mph wind (-0.5), 80% humidity (-0.2) = -0.4
  const adj = weatherAdj({ temp_f: 90, wind_mph: 18, humidity: 80 });
  assertAlmostEquals(adj, -0.4, 0.0001);
});

Deno.test("project (Phase 2): no OVER drift on evenly-matched ATP hard Bo3", () => {
  // L3 == prior mean for both players; no spread, no weather, no roles.
  // Projection should land within ±0.5 of prior.mu, NOT 22.68.
  const prior = priorFor("atp", "bo3", "hard");
  const r = project({
    p1_l3: [22, 22, 22],
    p2_l3: [22, 22, 22],
    surface: "hard",
    sets_format: "bo3",
    ml_home: null,
    ml_away: null,
    weather: null,
    indoor: false,
    tour: "atp",
  });
  assertEquals(Math.abs(r.projection - prior.mu) <= 0.5, true);
  assertEquals(r.clamped, false);
});

Deno.test("verdictFromEdgePp: tier boundaries (probability points)", () => {
  // Phase 1 thresholds: 2pp LEAN, 4pp STRONG, 12pp QUARANTINE.
  assertEquals(verdictFromEdgePp(0.019), "PASS");
  assertEquals(verdictFromEdgePp(0.021), "LEAN_OVER");
  assertEquals(verdictFromEdgePp(-0.021), "LEAN_UNDER");
  assertEquals(verdictFromEdgePp(0.039), "LEAN_OVER");
  assertEquals(verdictFromEdgePp(0.041), "STRONG_OVER");
  assertEquals(verdictFromEdgePp(-0.041), "STRONG_UNDER");
  assertEquals(verdictFromEdgePp(0.13), "QUARANTINE");
  assertEquals(verdictFromEdgePp(-0.13), "QUARANTINE");
});

Deno.test("project: role adjustments are pure additives, no double-counting", () => {
  const base = {
    p1_l3: [21, 21, 21],
    p2_l3: [21, 21, 21],
    surface: "clay" as const,
    sets_format: "bo3" as const,
    ml_home: null,
    ml_away: null,
    weather: null,
    indoor: false,
  };
  const a = project(base);
  const b = project({ ...base, role_adj_home: 0.4, role_adj_away: -0.6 });
  assertAlmostEquals(b.projection - a.projection, -0.2, 0.0001);
  assertEquals(b.role_adj_home, 0.4);
  assertEquals(b.role_adj_away, -0.6);
});

Deno.test("project (Phase 2): blowout-recency penalty triggers on ≤14-game last match (Bo3)", () => {
  const a = project({
    p1_l3: [22, 22, 22], p2_l3: [22, 22, 22],
    surface: "hard", sets_format: "bo3",
    ml_home: null, ml_away: null, weather: null, indoor: false, tour: "atp",
  });
  const b = project({
    p1_l3: [13, 13, 13], p2_l3: [22, 22, 22],
    surface: "hard", sets_format: "bo3",
    ml_home: null, ml_away: null, weather: null, indoor: false, tour: "atp",
  });
  assertEquals(b.blowout_adj < 0, true);
  assertEquals(a.projection - b.projection >= 1.0, true);
});

Deno.test("spreadAdjV2: coin-flip → +0.6, lopsided → −3.0 cap", () => {
  assertAlmostEquals(spreadAdjV2(-110, -110), 0.6, 0.0001);
  // 90/10 implied → diff ≈ 0.80 → adj capped at -3.0
  const lop = spreadAdjV2(-900, 700);
  assertEquals(lop <= -3.0 + 1e-9, true);
  assertEquals(lop >= -3.0 - 1e-9, true);
});

Deno.test("project (Phase 2): Bayesian shrink dominates with tiny sample", () => {
  // Single match each — shrink toward prior should keep us within 1 game.
  const prior = priorFor("atp", "bo3", "hard");
  const r = project({
    p1_l3: [30], p2_l3: [30],
    surface: "hard", sets_format: "bo3",
    ml_home: null, ml_away: null, weather: null, indoor: false, tour: "atp",
  });
  // Without shrink we'd be ~30; with k=4 and n_eff=2, shrunk ≈ (2*30 + 4*22)/6 ≈ 24.67.
  assertEquals(r.shrunk < 30, true);
  assertEquals(Math.abs(r.shrunk - prior.mu) < (30 - prior.mu), true);
});

Deno.test("project (Phase 2): pathological L3 is clamped to prior ± 3σ", () => {
  const prior = priorFor("atp", "bo3", "hard");
  const r = project({
    p1_l3: [40, 40, 40], p2_l3: [40, 40, 40],
    surface: "hard", sets_format: "bo3",
    ml_home: null, ml_away: null, weather: null, indoor: false, tour: "atp",
  });
  assertEquals(r.clamped, true);
  assertEquals(r.projection <= prior.mu + 3 * prior.sd + 1e-9, true);
});