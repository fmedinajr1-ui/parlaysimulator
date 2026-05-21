// Tests for parlayTeamLegsPerGame — blocks two team-market legs on the same game.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parlayTeamLegsPerGame } from "../filters.ts";
import type { CandidateLeg, Parlay } from "../models.ts";

function teamLeg(
  team: string,
  opponent: string,
  prop_type: string,
  side: string,
  line: number,
): CandidateLeg {
  return {
    sport: "MLB",
    player_name: null,
    team,
    opponent,
    prop_type,
    side,
    line,
    american_odds: -110,
    projected: line,
    confidence: 0.62,
    edge: 0.03,
    signal_source: prop_type === "Total" ? "GAME_TOTAL_OVER" : "TEAM_SPREAD_FAV",
    tipoff: new Date(Date.now() + 60 * 60 * 1000),
    projection_updated_at: new Date(),
    line_confirmed_on_book: true,
    player_active: true,
    defensive_context_updated_at: new Date(),
    selected_book: "fanduel",
  };
}

function playerLeg(team: string, opponent: string, player: string): CandidateLeg {
  return {
    sport: "MLB",
    player_name: player,
    team,
    opponent,
    prop_type: "Hits",
    side: "OVER",
    line: 0.5,
    american_odds: -150,
    projected: 0.8,
    confidence: 0.68,
    edge: 0.05,
    signal_source: "MLB_BATTER_HITS",
    tipoff: new Date(Date.now() + 60 * 60 * 1000),
    projection_updated_at: new Date(),
    line_confirmed_on_book: true,
    player_active: true,
    defensive_context_updated_at: new Date(),
    selected_book: "fanduel",
  };
}

function parlay(legs: CandidateLeg[]): Parlay {
  return {
    strategy: "mega_lottery_scanner",
    tier: "LOTTERY",
    legs,
    stake_units: 0.3,
    rationale: "test",
    generated_at: new Date(),
  };
}

Deno.test("two team-market legs on the same game are rejected", () => {
  const p = parlay([
    teamLeg("Cleveland Guardians", "Detroit Tigers", "Spread", "HOME", -1.5),
    teamLeg("Cleveland Guardians", "Detroit Tigers", "Total", "OVER", 8.5),
    playerLeg("Toronto Blue Jays", "New York Yankees", "Vladimir Guerrero Jr."),
  ]);
  const [ok, why] = parlayTeamLegsPerGame(p);
  assertEquals(ok, false);
  assertEquals(
    why,
    "team_legs_per_game:Cleveland Guardians|Detroit Tigers:2",
  );
});

Deno.test("one team-market leg per game passes", () => {
  const p = parlay([
    teamLeg("Cleveland Guardians", "Detroit Tigers", "Spread", "HOME", -1.5),
    teamLeg("Toronto Blue Jays", "New York Yankees", "Total", "OVER", 9.5),
    playerLeg("Boston Red Sox", "Tampa Bay Rays", "Rafael Devers"),
  ]);
  const [ok] = parlayTeamLegsPerGame(p);
  assertEquals(ok, true);
});

Deno.test("player legs on the same game do NOT count toward team cap", () => {
  const p = parlay([
    teamLeg("Cleveland Guardians", "Detroit Tigers", "Spread", "HOME", -1.5),
    playerLeg("Cleveland Guardians", "Detroit Tigers", "Jose Ramirez"),
    playerLeg("Cleveland Guardians", "Detroit Tigers", "Steven Kwan"),
  ]);
  const [ok] = parlayTeamLegsPerGame(p);
  assertEquals(ok, true);
});