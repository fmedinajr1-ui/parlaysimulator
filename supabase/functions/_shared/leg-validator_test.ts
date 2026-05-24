import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  emptyContext,
  validateLeg,
  validateTicket,
  type ValidationContext,
  type ValidationLeg,
} from "./leg-validator.ts";

const NOW = new Date("2026-05-24T18:00:00Z");

function ctxWith(partial: Partial<ValidationContext>): ValidationContext {
  return { ...emptyContext(NOW), ...partial };
}

Deno.test("hard: truncated team name rejected", () => {
  const leg: ValidationLeg = {
    sport: "icehockey_nhl",
    market_type: "moneyline",
    team: "Colorado A…alanche",
    commence_time: "2026-05-24T23:00:00Z",
  };
  const v = validateLeg(leg, ctxWith({}));
  assert(v.hardFails.some((f) => f.startsWith("unknown_team:")), v.hardFails.join(","));
});

Deno.test("hard: venue mismatch when HOME label disagrees with schedule", () => {
  const ctx = ctxWith({
    schedule: new Map([["evt-1", {
      event_id: "evt-1",
      home_team: "Texas Rangers",
      away_team: "Los Angeles Angels",
      start_time_utc: "2026-05-24T23:00:00Z",
    }]]),
  });
  const leg: ValidationLeg = {
    sport: "baseball_mlb",
    market_type: "moneyline",
    event_id: "evt-1",
    team: "Los Angeles Angels",
    home_away: "HOME",
    commence_time: "2026-05-24T23:00:00Z",
  };
  const v = validateLeg(leg, ctx);
  assert(v.hardFails.some((f) => f.startsWith("venue_mismatch_home")), v.hardFails.join(","));
});

Deno.test("hard: game already started rejected", () => {
  const leg: ValidationLeg = {
    sport: "baseball_mlb",
    market_type: "player",
    team: "Texas Rangers",
    player_name: "Corey Seager",
    commence_time: "2026-05-24T17:30:00Z", // 30 min before NOW
  };
  const v = validateLeg(leg, ctxWith({}));
  assertEquals(v.hardFails.includes("game_started_or_imminent"), true);
});

Deno.test("ticket: two legs from same game flagged", () => {
  const legs: ValidationLeg[] = [
    { sport: "mlb", event_id: "evt-1" },
    { sport: "mlb", event_id: "evt-1" },
  ];
  const r = validateTicket(legs);
  assert(r.hardFails[0]?.startsWith("multiple_legs_same_game"));
});

Deno.test("soft: weak team at heavy fav price → 25% haircut", () => {
  const ctx = ctxWith({
    records: new Map([["mlb|colorado rockies", 0.380]]),
  });
  const leg: ValidationLeg = {
    sport: "baseball_mlb",
    market_type: "moneyline",
    team: "Colorado Rockies",
    american_odds: -198,
    commence_time: "2026-05-24T23:00:00Z",
  };
  const v = validateLeg(leg, ctx);
  assertEquals(v.hardFails.length, 0);
  assert(v.softFails.some((f) => f.startsWith("weak_team_heavy_fav")));
  assertEquals(v.haircut, 0.25);
});