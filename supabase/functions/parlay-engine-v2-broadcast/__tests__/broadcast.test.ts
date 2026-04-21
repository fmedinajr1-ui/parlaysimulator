// ============================================================================
// Tests for parlay-engine-v2-broadcast: message builder + dry-run + dedup logic.
// We test the pure message builder by importing it from the function module.
// ============================================================================

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildMessage } from "../index.ts";

function makeRow(overrides: Partial<Parameters<typeof buildMessage>[0]> = {}): Parameters<typeof buildMessage>[0] {
  return {
    id: "p1",
    parlay_date: "2026-04-21",
    strategy_name: "mispriced_edge",
    tier: "CORE",
    legs: [
      {
        player_name: "Luka Doncic", prop_type: "Points", side: "OVER",
        line: 28.5, american_odds: -115, sport: "NBA",
        confidence: 0.78, signal_source: "VOLUME_SCORER", projected: 31.2,
      },
      {
        player_name: "Jayson Tatum", prop_type: "PTS", side: "OVER",
        line: 27.5, american_odds: -110, sport: "NBA",
        confidence: 0.74, signal_source: "VOLUME_SCORER", projected: 29.5,
      },
    ],
    leg_count: 2,
    combined_probability: 0.55,
    expected_odds: 245,
    simulated_stake: 1.33,
    simulated_edge: 0.12,
    selection_rationale: "NBA whitelist alignment, fat-pitch odds band, 0.76 avg confidence.",
    ...overrides,
  } as any;
}

// 1. Message builder shows full prop names, line, odds, stake, EV.
Deno.test("buildMessage formats full prop names, line, odds, and stake", () => {
  const text = buildMessage(makeRow());
  assert(text.includes("Luka Doncic"), `missing player: ${text}`);
  assert(text.includes("Points OVER 28.5"), `missing prop+line: ${text}`);
  // Standardized: "PTS" should be expanded to "Points" in leg 2
  assert(text.includes("Points OVER 27.5"), `PTS not expanded: ${text}`);
  assert(text.includes("(-115)"), `missing odds: ${text}`);
  assert(text.includes("1.33u"), `missing stake: ${text}`);
  assert(text.includes("+245"), `missing combined odds: ${text}`);
});

// 2. Correlation note only when warnings present
Deno.test("buildMessage includes correlation note iff warnings exist", () => {
  const noNote = buildMessage(makeRow({ correlation_warnings: [] }));
  assert(!noNote.includes("Correlation note"), "should not include note");

  const withNote = buildMessage(makeRow({
    correlation_warnings: [{ pair: "Rebounds|OVER||Rebounds|OVER", lift: 0.80, same_game: true }],
  }));
  assert(withNote.includes("Correlation note"), `should include note: ${withNote}`);
  assert(withNote.includes("0.80x"), `should show lift: ${withNote}`);
});

// 3. Rationale shown when present, omitted when null
Deno.test("buildMessage shows rationale when provided, omits when null", () => {
  const a = buildMessage(makeRow({ selection_rationale: "Top edge play" }));
  assert(a.includes("Why this hits"), "expected 'Why this hits' line");
  assert(a.includes("Top edge play"), "expected rationale text");

  const b = buildMessage(makeRow({ selection_rationale: null as any }));
  assert(!b.includes("Why this hits"), "should not include rationale line when null");
});

// 4. Header reflects strategy + tier + leg count
Deno.test("buildMessage header reflects strategy, tier, leg count", () => {
  const text = buildMessage(makeRow({ strategy_name: "grind_stack", tier: "EDGE", leg_count: 3 }));
  assert(text.includes("ParlayIQ — grind_stack"), "missing strategy");
  assert(text.includes("(EDGE)"), "missing tier");
  assert(text.includes("3 legs"), "missing leg count");
});

// 5. HTML-special characters in player/strategy names get escaped
Deno.test("buildMessage escapes HTML-special characters", () => {
  const text = buildMessage(makeRow({
    strategy_name: "edge & lock",
    legs: [{ player_name: "<bad>", prop_type: "Points", side: "OVER", line: 20, american_odds: -110 }],
    leg_count: 1,
  }));
  assert(text.includes("edge &amp; lock"), `expected escaped &: ${text}`);
  assert(text.includes("&lt;bad&gt;"), `expected escaped angle brackets: ${text}`);
});