import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  weightedL3,
  spreadAdj,
  weatherAdj,
  project,
  verdictFromEdgePct,
} from "./court-edge-projection.ts";

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

Deno.test("project: Madrid clay Bo3 golden case", () => {
  // both players: weighted L3 = 21.0
  // base 21, clay 1.08, bo3 1.0, no spread, no weather, outdoor
  // = 21 * 1.08 = 22.68
  const r = project({
    p1_l3: [21, 21, 21],
    p2_l3: [21, 21, 21],
    surface: "clay",
    sets_format: "bo3",
    ml_home: null,
    ml_away: null,
    weather: null,
    indoor: false,
  });
  assertAlmostEquals(r.projection, 22.68, 0.0001);
});

Deno.test("verdictFromEdgePct: tier boundaries", () => {
  assertEquals(verdictFromEdgePct(2.99), "PASS");
  assertEquals(verdictFromEdgePct(3.01), "LEAN_OVER");
  assertEquals(verdictFromEdgePct(-3.01), "LEAN_UNDER");
  assertEquals(verdictFromEdgePct(5.99), "LEAN_OVER");
  assertEquals(verdictFromEdgePct(6.01), "STRONG_OVER");
  assertEquals(verdictFromEdgePct(-6.01), "STRONG_UNDER");
});