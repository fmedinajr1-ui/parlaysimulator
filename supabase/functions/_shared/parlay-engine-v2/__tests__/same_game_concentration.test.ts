// Tests for parlaySameGameConcentration (loosened to 0.75) and the new
// parlayMinDistinctGames hard floor.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parlaySameGameConcentration,
  parlayMinDistinctGames,
} from "../filters.ts";
import type { CandidateLeg, Parlay } from "../models.ts";

function leg(team: string, opponent: string, player: string): CandidateLeg {
  return {
    sport: "NBA",
    player_name: player,
    team,
    opponent,
    prop_type: "Points",
    side: "OVER",
    line: 20.5,
    american_odds: -110,
    projected: 22,
    confidence: 0.6,
    edge: 0.05,
    signal_source: "TEST",
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
    strategy: "test",
    tier: "CORE",
    legs,
    stake_units: 1,
    rationale: "test",
    generated_at: new Date(),
  };
}

Deno.test("3-of-4 same-game passes at 0.75 threshold", () => {
  const p = parlay([
    leg("LAL", "GSW", "A"),
    leg("LAL", "GSW", "B"),
    leg("LAL", "GSW", "C"),
    leg("BOS", "MIA", "D"),
  ]);
  const [ok, why] = parlaySameGameConcentration(p);
  assertEquals(ok, true, `expected pass, got: ${why}`);
});

Deno.test("4-of-4 same-game still rejected at 0.75 threshold", () => {
  const p = parlay([
    leg("LAL", "GSW", "A"),
    leg("LAL", "GSW", "B"),
    leg("LAL", "GSW", "C"),
    leg("LAL", "GSW", "D"),
  ]);
  const [ok, why] = parlaySameGameConcentration(p);
  assertEquals(ok, false);
  assertEquals(why, "same_game_share_1.00");
});

Deno.test("parlayMinDistinctGames rejects 3-leg single-game parlay", () => {
  const p = parlay([
    leg("LAL", "GSW", "A"),
    leg("LAL", "GSW", "B"),
    leg("LAL", "GSW", "C"),
  ]);
  const [ok, why] = parlayMinDistinctGames(p);
  assertEquals(ok, false);
  assertEquals(why, "single_game_only");
});

Deno.test("parlayMinDistinctGames passes when legs span 2+ games", () => {
  const p = parlay([
    leg("LAL", "GSW", "A"),
    leg("LAL", "GSW", "B"),
    leg("BOS", "MIA", "C"),
  ]);
  const [ok] = parlayMinDistinctGames(p);
  assertEquals(ok, true);
});

Deno.test("parlayMinDistinctGames respects custom min", () => {
  const p = parlay([
    leg("LAL", "GSW", "A"),
    leg("BOS", "MIA", "B"),
    leg("PHI", "NYK", "C"),
  ]);
  const [okDefault] = parlayMinDistinctGames(p);
  assertEquals(okDefault, true);
  const [okStrict, why] = parlayMinDistinctGames(p, 4);
  assertEquals(okStrict, false);
  assertEquals(why, "single_game_only");
});