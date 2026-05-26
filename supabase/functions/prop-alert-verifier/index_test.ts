import { assert, assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import { buildResearchPrompt, multiplierFor, SOURCE_TABLES } from "./index.ts";

const baseAlert = {
  alert_id: "a1", source_table: "fanduel_prediction_alerts" as const,
  player_name: "LeBron James", sport: "NBA", prop_type: "player_points",
  side: "over", line: 25.5, event_id: "evt1",
  prediction: "over", confidence: 72, metadata: null, created_at: new Date().toISOString(),
};

Deno.test("multiplierFor: APPROVE boosts, REJECT cuts, CAUTION mid", () => {
  const a = multiplierFor("APPROVE", 80);
  const c = multiplierFor("CAUTION", 70);
  const r = multiplierFor("REJECT", 80);
  assert(a > 1, "approve should boost");
  assert(c < 1 && c > 0.5, "caution mid haircut");
  assert(r >= 0.30 && r < 0.6, "reject hard haircut floor 0.30");
});

Deno.test("buildResearchPrompt: NBA prompt includes defensive rank cue", () => {
  const p = buildResearchPrompt(baseAlert);
  assert(p.user.includes("LeBron James"));
  assert(p.user.includes("player_points"));
  assert(p.user.includes("opponent defensive rank") || p.user.includes("Confirmed starting lineup"));
});

Deno.test("buildResearchPrompt: MLB prompt swaps in weather + pitcher cues", () => {
  const p = buildResearchPrompt({ ...baseAlert, sport: "MLB", prop_type: "player_strikeouts" });
  assert(p.user.includes("Weather at ballpark") || p.user.includes("starting pitcher"));
});

Deno.test("buildResearchPrompt: includes all required headings", () => {
  const p = buildResearchPrompt(baseAlert);
  for (const h of ["INJURY/AVAILABILITY", "LINEUP/ROLE", "RECENT FORM", "OPPONENT MATCHUP", "LINE HISTORY", "BOTTOM LINE"]) {
    assert(p.user.includes(h), `missing heading ${h}`);
  }
});

Deno.test("SOURCE_TABLES covers the 4 alert sources", () => {
  assertEquals(SOURCE_TABLES.length, 4);
  for (const t of ["fanduel_prediction_alerts","sharp_signals","extreme_movement_alerts","market_signals"]) {
    assert((SOURCE_TABLES as readonly string[]).includes(t));
  }
});