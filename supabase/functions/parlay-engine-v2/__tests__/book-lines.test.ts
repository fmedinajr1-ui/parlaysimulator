// ============================================================================
// Phase D — book line gates: priority, freshness, drift, active flag, render
// ============================================================================

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pickPreferredBook } from "../index.ts";
import { buildMessage } from "../../parlay-engine-v2-broadcast/index.ts";

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
Deno.test("buildMessage appends [FD] tag for fanduel-sourced legs", () => {
  const text = buildMessage({
    id: "p1", parlay_date: "2026-04-21",
    strategy_name: "mispriced_edge", tier: "CORE",
    legs: [{
      player_name: "Luka Doncic", prop_type: "Points", side: "OVER",
      line: 28.5, american_odds: -115, selected_book: "fanduel",
    } as any],
    leg_count: 1, combined_probability: 0.55, expected_odds: -115,
    simulated_stake: 1.0, simulated_edge: 0.1, selection_rationale: null as any,
  } as any);
  assert(text.includes("[FD]"), `expected [FD] tag in: ${text}`);
});

// 4. Telegram message renders [DK] tag for draftkings
Deno.test("buildMessage appends [DK] tag for draftkings legs", () => {
  const text = buildMessage({
    id: "p1", parlay_date: "2026-04-21",
    strategy_name: "x", tier: "CORE",
    legs: [{ player_name: "X", prop_type: "Points", side: "OVER", line: 20, american_odds: -110, selected_book: "draftkings" } as any],
    leg_count: 1, combined_probability: 0.5, expected_odds: -110,
    simulated_stake: 1, simulated_edge: 0, selection_rationale: null as any,
  } as any);
  assert(text.includes("[DK]"), `expected [DK] tag in: ${text}`);
});

// 5. No tag rendered when selected_book absent (backward compat)
Deno.test("buildMessage omits book tag when selected_book is null/missing", () => {
  const text = buildMessage({
    id: "p1", parlay_date: "2026-04-21",
    strategy_name: "x", tier: "CORE",
    legs: [{ player_name: "X", prop_type: "Points", side: "OVER", line: 20, american_odds: -110 } as any],
    leg_count: 1, combined_probability: 0.5, expected_odds: -110,
    simulated_stake: 1, simulated_edge: 0, selection_rationale: null as any,
  } as any);
  assert(!text.includes("[FD]") && !text.includes("[DK]") && !text.includes("[MGM]"),
    `expected no book tag: ${text}`);
});