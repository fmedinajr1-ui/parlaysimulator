import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dangerBandCheck, formatRoleLine, type PlayerRoleContext } from "./player-role-context.ts";

function ctx(over: Partial<PlayerRoleContext>): PlayerRoleContext {
  return {
    player_name: "Test Player",
    archetype: "GLASS_CLEANER",
    role_tier: "STARTER",
    avg_minutes: 30,
    baseline_mean: 7,
    baseline_std: 2,
    baseline_source: "l10",
    ...over,
  };
}

Deno.test("Over with mean BELOW line and inside band → drop (miss-by-1 risk)", () => {
  // Okongwu O 6.5 rebounds, mean 6.0, std 2 → band = max(0.6, 1.0) = 1.0, distance = 0.5 < 1.0 → DROP
  const r = dangerBandCheck({ side: "Over", line: 6.5, ctx: ctx({ baseline_mean: 6.0, baseline_std: 2 }) });
  assertEquals(r.drop, true);
  assert(r.reason && r.reason.includes("miss_by_1_risk"));
});

Deno.test("Over with mean WELL ABOVE line → keep", () => {
  // mean 9.0, line 6.5 → distance 2.5, band 1.0 → keep
  const r = dangerBandCheck({ side: "Over", line: 6.5, ctx: ctx({ baseline_mean: 9.0, baseline_std: 2 }) });
  assertEquals(r.drop, false);
});

Deno.test("Under with mean ABOVE line and inside band → drop", () => {
  // U 6.5 rebounds with mean 7.0, std 2 → wrong side, distance 0.5 < band 1.0 → DROP
  const r = dangerBandCheck({ side: "Under", line: 6.5, ctx: ctx({ baseline_mean: 7.0, baseline_std: 2 }) });
  assertEquals(r.drop, true);
});

Deno.test("BENCH player uses stricter 0.75 std band", () => {
  // mean 6.0, std 2, bench → band = max(0.6, 1.5) = 1.5, distance 0.5 → DROP
  const r = dangerBandCheck({
    side: "Over",
    line: 6.5,
    ctx: ctx({ baseline_mean: 6.0, baseline_std: 2, role_tier: "BENCH", avg_minutes: 18 }),
  });
  assertEquals(r.drop, true);
  assert(r.reason && (r.reason.includes("BENCH") || r.reason.includes("low_minutes")));
});

Deno.test("very low minutes triggers volume-floor drop even when band passes", () => {
  // mean 9 vs line 6.5 → would normally pass, but mpg 12 < bench floor 14 → drop
  const r = dangerBandCheck({
    side: "Over",
    line: 6.5,
    ctx: ctx({ baseline_mean: 9, baseline_std: 2, role_tier: "BENCH", avg_minutes: 12 }),
  });
  assertEquals(r.drop, true);
  assert(r.reason && r.reason.includes("low_minutes"));
});

Deno.test("formatRoleLine renders archetype + tier + mpg", () => {
  const line = formatRoleLine(ctx({ archetype: "GLASS_CLEANER", role_tier: "BENCH", avg_minutes: 18.4 }));
  assert(line && line.includes("GLASS_CLEANER"));
  assert(line && line.includes("BENCH"));
  assert(line && line.includes("18.4"));
});