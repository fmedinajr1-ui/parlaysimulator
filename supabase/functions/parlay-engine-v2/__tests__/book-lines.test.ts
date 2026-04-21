// ============================================================================
// Phase D — book line gates: priority, freshness, drift, active flag, render
// ============================================================================

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pickPreferredBook } from "../index.ts";

const isoMinAgo = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

function makeProp(overrides: Record<string, unknown> = {}) {
  return {
    player_name: "Luka Doncic",
    prop_type: "Points",
    current_line: 28.5,
    over_price: -115,
    under_price: -105,
    is_active: true,
    sport: "NBA",
    game_description: "Mavs @ Warriors",
    commence_time: new Date(Date.now() + 6 * 3600_000).toISOString(),
    updated_at: isoMinAgo(2),
    bookmaker: "fanduel",
    odds_updated_at: isoMinAgo(2),
    ...overrides,
  } as any;
}

// 1. Bookmaker priority: FanDuel wins over BetMGM/DK
Deno.test("pickPreferredBook returns FanDuel row when all three are present", () => {
  const rows = [
    makeProp({ bookmaker: "betmgm", over_price: -120 }),
    makeProp({ bookmaker: "fanduel", over_price: -115 }),
    makeProp({ bookmaker: "draftkings", over_price: -110 }),
  ];
  const picked = pickPreferredBook(rows);
  assertEquals(picked?.bookmaker, "fanduel");
  assertEquals(picked?.over_price, -115);
});

// 2. Falls back to DraftKings when FanDuel missing
Deno.test("pickPreferredBook falls back to DraftKings without FanDuel", () => {
  const rows = [
    makeProp({ bookmaker: "betmgm" }),
    makeProp({ bookmaker: "draftkings" }),
  ];
  assertEquals(pickPreferredBook(rows)?.bookmaker, "draftkings");
});

// 3. Telegram message renders [FD] tag for fanduel-sourced legs
// 3. Falls back to first active row when no priority match
Deno.test("pickPreferredBook falls back to first active row when no priority match", () => {
  const rows = [
    makeProp({ bookmaker: "caesars", is_active: false }),
    makeProp({ bookmaker: "pointsbet", is_active: true }),
  ];
  assertEquals(pickPreferredBook(rows)?.bookmaker, "pointsbet");
});

// 4. Returns null on empty input
Deno.test("pickPreferredBook returns null on empty rows", () => {
  assertEquals(pickPreferredBook([]), null);
});

// 5. Custom priority order respected
Deno.test("pickPreferredBook respects a custom priority order", () => {
  const rows = [
    makeProp({ bookmaker: "fanduel" }),
    makeProp({ bookmaker: "betmgm" }),
  ];
  assertEquals(pickPreferredBook(rows, ["betmgm", "fanduel"])?.bookmaker, "betmgm");
});