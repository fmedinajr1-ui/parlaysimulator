import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSnapshotRows, norm, type HrEvent } from "./index.ts";

const map = new Map([
  ["newyorkyankees@bostonredsox", { pk: 12345, home: "Boston Red Sox", away: "New York Yankees" }],
]);

Deno.test("norm strips punctuation and case", () => {
  assertEquals(norm("New York Yankees"), "newyorkyankees");
  assertEquals(norm("St. Louis Cardinals"), "stlouiscardinals");
});

Deno.test("buildSnapshotRows matches and emits 2 rows per game", () => {
  const events: HrEvent[] = [{
    event_id: "1", home_team: "Boston Red Sox", away_team: "New York Yankees",
    home_price: -120, away_price: 110, captured_at: "2026-06-08T20:00:00Z",
  }];
  const { rows, matched, unmatched } = buildSnapshotRows(events, map);
  assertEquals(matched, 1);
  assertEquals(unmatched, 0);
  assertEquals(rows.length, 2);
  assert(rows.every((r) => r.sportsbook === "hardrockbet" && r.market_type === "live_ml" && r.game_id === "mlb_12345"));
});

Deno.test("buildSnapshotRows drops unmatched events", () => {
  const events: HrEvent[] = [{
    event_id: "2", home_team: "Texas Rangers", away_team: "Seattle Mariners",
    home_price: 100, away_price: -110, captured_at: "x",
  }];
  const { rows, matched, unmatched } = buildSnapshotRows(events, map);
  assertEquals(matched, 0);
  assertEquals(unmatched, 1);
  assertEquals(rows.length, 0);
});

Deno.test("buildSnapshotRows empty input → 0 rows", () => {
  const { rows, matched, unmatched } = buildSnapshotRows([], map);
  assertEquals(rows.length, 0);
  assertEquals(matched, 0);
  assertEquals(unmatched, 0);
});

Deno.test("buildSnapshotRows preserves captured_at and prices", () => {
  const events: HrEvent[] = [{
    event_id: "3", home_team: "Boston Red Sox", away_team: "New York Yankees",
    home_price: -135, away_price: 125, captured_at: "2026-06-08T21:30:00Z",
  }];
  const { rows } = buildSnapshotRows(events, map);
  const home = rows.find((r) => r.player_name === "Boston Red Sox");
  const away = rows.find((r) => r.player_name === "New York Yankees");
  assertEquals(home?.odds, -135);
  assertEquals(away?.odds, 125);
  assertEquals(home?.captured_at, "2026-06-08T21:30:00Z");
});