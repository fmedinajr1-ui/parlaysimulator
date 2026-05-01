import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { modelTeamNoHR } from "./mlb-no-hr-team-model.ts";

// Test 1: S tier — low-power team, ace pitcher, pitcher park
Deno.test("S tier: Giants @ Marlins vs ace", () => {
  const r = modelTeamNoHR({
    team: "San Francisco Giants",
    opponent: "Miami Marlins",
    homeTeam: "Miami Marlins",
    teamHRPerGameL30: 0.78,
    teamGamesL30: 30,
    teamHRPerGameSeason: 0.85,
    pitcherHR9: 0.7,
    pitcherSampleIP: 80,
  });
  assertEquals(r.tier, "S");
  assert(r.pNoHR >= 0.62, `expected pNoHR>=0.62, got ${r.pNoHR}`);
  assertEquals(r.blockReason, null);
});

// Test 2: PASS — Yankees power team blocked
Deno.test("PASS: power team L30 >= 1.5 HR/g blocked", () => {
  const r = modelTeamNoHR({
    team: "New York Yankees",
    opponent: "Tampa Bay Rays",
    homeTeam: "Tampa Bay Rays",
    teamHRPerGameL30: 1.7,
    teamGamesL30: 30,
    teamHRPerGameSeason: 1.5,
    pitcherHR9: 1.0,
    pitcherSampleIP: 60,
  });
  assertEquals(r.tier, "PASS");
  assertEquals(r.blockReason, "power_team_l30");
});

// Test 3: PASS — Coors / HR park environment blocked
Deno.test("PASS: Coors HR-friendly park blocked", () => {
  const r = modelTeamNoHR({
    team: "Arizona Diamondbacks",
    opponent: "Colorado Rockies",
    homeTeam: "Colorado Rockies",
    teamHRPerGameL30: 1.0,
    teamGamesL30: 30,
    teamHRPerGameSeason: 1.1,
    pitcherHR9: 1.4,
    pitcherSampleIP: 50,
    weatherMult: 1.05,
  });
  assertEquals(r.tier, "PASS");
  assertEquals(r.blockReason, "hr_friendly_park_env");
});

// Test 4: PASS — missing pitcher data blocked
Deno.test("PASS: missing pitcher data blocked", () => {
  const r = modelTeamNoHR({
    team: "Boston Red Sox",
    opponent: "Detroit Tigers",
    homeTeam: "Detroit Tigers",
    teamHRPerGameL30: 0.8,
    teamGamesL30: 30,
    teamHRPerGameSeason: 0.9,
    pitcherHR9: null,
    pitcherSampleIP: 0,
  });
  assertEquals(r.tier, "PASS");
  assertEquals(r.blockReason, "missing_pitcher_data");
});

// Test 5: A tier — solid edge but not S-level
Deno.test("A tier: decent matchup, not ace-level", () => {
  const r = modelTeamNoHR({
    team: "Pittsburgh Pirates",
    opponent: "Cleveland Guardians",
    homeTeam: "Cleveland Guardians",
    teamHRPerGameL30: 0.70,
    teamGamesL30: 30,
    teamHRPerGameSeason: 0.75,
    pitcherHR9: 1.0,
    pitcherSampleIP: 80,
  });
  assertEquals(r.tier, "A");
  assert(r.pNoHR >= 0.55 && r.pNoHR < 0.70, `pNoHR=${r.pNoHR}`);
  assertEquals(r.blockReason, null);
});

// Bonus test 6: hot bats vs gopher pitcher blocked
Deno.test("PASS: hot bats vs gopher pitcher blocked", () => {
  const r = modelTeamNoHR({
    team: "Atlanta Braves",
    opponent: "Washington Nationals",
    homeTeam: "Washington Nationals",
    teamHRPerGameL30: 1.1,
    teamGamesL30: 30,
    teamHRPerGameSeason: 1.2,
    pitcherHR9: 1.8,
    pitcherSampleIP: 50,
    teamL7HRPerGame: 1.4,
  });
  assertEquals(r.tier, "PASS");
  assertEquals(r.blockReason, "hot_bats_vs_gopher_pitcher");
});