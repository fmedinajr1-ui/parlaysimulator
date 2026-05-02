import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { modelRbiUnder, RbiUnderInput } from "./mlb-rbi-under-model.ts";

function base(): RbiUnderInput {
  return {
    playerName: "Test Batter",
    team: "TST",
    opponent: "OPP",
    homeTeam: "TST",
    park: "Generic Park",
    line: 0.5,
    rbiPerPaL15: 0.06,
    rbiPerPaSeason: 0.08,
    paSeason: 200,
    l3Rbis: 0,
    l3Pa: 12,
    l10RbiPerPa: 0.05,
    lineupSpot: 8,
    pitcherEra: 3.10,
    pitcherK9: 9.5,
    parkRbiMult: 0.95,
  };
}

Deno.test("Test 1: cold 8-hole batter vs ace pitcher passes A, C, D", () => {
  const r = modelRbiUnder(base());
  assertEquals(r.blockReason, null);
  assert(r.variantsPassed.includes("A"), "should pass A");
  assert(r.variantsPassed.includes("C"), "should pass C");
  assert(r.variantsPassed.includes("D"), "should pass D");
  // B passes too here (l3=0 <= 0.6) — that's fine; spec just says A/C/D minimum
  assert(r.pUnder >= 0.7, `pUnder=${r.pUnder} should be high`);
});

Deno.test("Test 2: hot 4-hole batter vs weak pitcher is hard-blocked", () => {
  const r = modelRbiUnder({
    ...base(),
    lineupSpot: 4,
    l10RbiPerPa: 0.22,
    pitcherEra: 5.10,
    rbiPerPaL15: 0.20,
    rbiPerPaSeason: 0.18,
    l3Rbis: 4,
  });
  assertEquals(r.blockReason, "hot_middle_order_bat");
  assertEquals(r.variantsPassed.length, 0);
});

Deno.test("Test 3: Coors Field is universally hard-blocked", () => {
  const r = modelRbiUnder({ ...base(), park: "Coors Field" });
  assertEquals(r.blockReason, "park_coors_field");
  assertEquals(r.variantsPassed.length, 0);
});

Deno.test("Test 4: borderline pUnder=0.65 / edge<0.05 kept by none", () => {
  // tune RBI/PA so expected_RBI lands near 0.43 -> P(K=0|0.43) ≈ 0.65
  const r = modelRbiUnder({
    ...base(),
    rbiPerPaL15: 0.10,
    rbiPerPaSeason: 0.11,
    pitcherEra: 4.20,
    parkRbiMult: 1.0,
    lineupSpot: 6,
    l3Rbis: 1,
    l3Pa: 12,
  });
  assert(r.variantsPassed.length === 0, `expected zero variants, got ${r.variantsPassed.join(",")} pUnder=${r.pUnder} edge=${r.edge}`);
});

Deno.test("Test 5: missing line returns no_line_posted block", () => {
  const r = modelRbiUnder({ ...base(), line: null });
  assertEquals(r.blockReason, "no_line_posted");
  assertEquals(r.pUnder, 0);
  assertEquals(r.variantsPassed.length, 0);
});