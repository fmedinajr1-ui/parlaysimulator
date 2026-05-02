import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { modelPitcherKOver } from "./mlb-pitcher-k-model.ts";

// 1) S tier — ace K9, strikeout-heavy lineup, deep IP
Deno.test("S tier: ace pitcher vs K-prone lineup", () => {
  const r = modelPitcherKOver({
    pitcherName: "Spencer Strider",
    team: "ATL",
    opponent: "Marlins",
    homeTeam: "ATL",
    line: 7.5,
    pitcherK9L5: 12.5,
    pitcherK9Season: 12.0,
    pitcherStartsSeason: 18,
    expectedIP: 6.0,
    oppKRateSeason: 0.250,
  });
  assertEquals(r.tier, "S");
  assert(r.pOver >= 0.68, `pOver=${r.pOver}`);
  assertEquals(r.blockReason, null);
});

// 2) A tier — solid edge but not ace-level
Deno.test("A tier: good K9 but moderate IP / opponent", () => {
  const r = modelPitcherKOver({
    pitcherName: "Logan Webb",
    team: "SF",
    opponent: "Padres",
    homeTeam: "SF",
    line: 5.5,
    pitcherK9L5: 9.5,
    pitcherK9Season: 9.0,
    pitcherStartsSeason: 20,
    expectedIP: 6.2,
    oppKRateSeason: 0.235,
  });
  assertEquals(r.tier, "A");
  assert(r.pOver >= 0.62 && r.pOver < 0.85, `pOver=${r.pOver}`);
  assert(r.edge >= 0.05, `edge=${r.edge}`);
});

// 3) PASS — small sample
Deno.test("PASS: rookie with <5 starts", () => {
  const r = modelPitcherKOver({
    pitcherName: "Rookie Arm",
    team: "DET",
    opponent: "CWS",
    homeTeam: "DET",
    line: 4.5,
    pitcherK9L5: 13.0,
    pitcherK9Season: 13.0,
    pitcherStartsSeason: 3,
    expectedIP: 5.0,
    oppKRateSeason: 0.260,
  });
  assertEquals(r.tier, "PASS");
  assertEquals(r.blockReason, "small_sample_lt_5_starts");
});

// 4) PASS — early hook risk (low IP)
Deno.test("PASS: opener / short-leash pitcher (IP < 4.5)", () => {
  const r = modelPitcherKOver({
    pitcherName: "Opener Guy",
    team: "TB",
    opponent: "BAL",
    homeTeam: "TB",
    line: 3.5,
    pitcherK9L5: 11.0,
    pitcherK9Season: 10.5,
    pitcherStartsSeason: 12,
    expectedIP: 3.5,
    oppKRateSeason: 0.230,
  });
  assertEquals(r.tier, "PASS");
  assertEquals(r.blockReason, "early_hook_risk_ip_lt_4_5");
});

// 5) PASS — weak K9 vs contact lineup, no edge
Deno.test("PASS: low K9 + line too high", () => {
  const r = modelPitcherKOver({
    pitcherName: "Contact Pitcher",
    team: "KC",
    opponent: "CLE",
    homeTeam: "KC",
    line: 6.5,
    pitcherK9L5: 6.5,
    pitcherK9Season: 6.8,
    pitcherStartsSeason: 22,
    expectedIP: 5.8,
    oppKRateSeason: 0.190,
  });
  assertEquals(r.tier, "PASS");
  assertEquals(r.blockReason, null);
  assert(r.pOver < 0.62, `pOver=${r.pOver}`);
});

// 6) Edge math sanity — implied prob at -115 is ~0.535
Deno.test("Edge calc: 70% pOver gives ~+16.5% edge over -115", () => {
  const r = modelPitcherKOver({
    pitcherName: "Test",
    team: "X",
    opponent: "Y",
    homeTeam: "X",
    line: 5.5,
    pitcherK9L5: 11.0,
    pitcherK9Season: 11.0,
    pitcherStartsSeason: 15,
    expectedIP: 6.0,
    oppKRateSeason: 0.245,
  });
  assert(r.edge > 0.10, `edge=${r.edge}`);
  assert(r.edge < 0.30, `edge=${r.edge}`);
});