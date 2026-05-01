import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { baselineFor, baselineL3, isUnknownSurface } from "./court-edge-baseline.ts";

Deno.test("baselineFor returns sensible Bo3 clay value", () => {
  const r = baselineFor("clay", "best_of_3");
  assertEquals(r.confidence, "low");
  assert(r.player_total > 18 && r.player_total < 24, `clay Bo3 should be ~21, got ${r.player_total}`);
  assert(r.reason.includes("clay"));
});

Deno.test("baselineFor Bo5 is meaningfully larger than Bo3", () => {
  const bo3 = baselineFor("hard", "best_of_3").player_total;
  const bo5 = baselineFor("hard", "best_of_5").player_total;
  assert(bo5 > bo3 * 1.4, `Bo5 (${bo5}) should be >1.4× Bo3 (${bo3})`);
});

Deno.test("baselineFor falls back to unknown surface gracefully", () => {
  // @ts-expect-error intentional bad input
  const r = baselineFor("dirt", "best_of_3");
  assert(r.player_total > 18 && r.player_total < 24);
  assert(r.reason.includes("unknown"));
});

Deno.test("baselineL3 returns 3-entry array matching player_total", () => {
  const arr = baselineL3("grass", "best_of_3");
  assertEquals(arr.length, 3);
  const b = baselineFor("grass", "best_of_3");
  for (const v of arr) assertEquals(v, b.player_total);
});

Deno.test("isUnknownSurface flags only unsupported surfaces", () => {
  assertEquals(isUnknownSurface("clay"), false);
  assertEquals(isUnknownSurface("hard"), false);
  assertEquals(isUnknownSurface(null), true);
  assertEquals(isUnknownSurface("carpet"), true);
});