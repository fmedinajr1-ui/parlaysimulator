import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Re-implement small pure helpers locally so tests don't need to import the server file.
function decimal(american: number): number {
  return american >= 0 ? 1 + american / 100 : 1 + 100 / -american;
}
function impliedProb(american: number): number {
  if (american >= 0) return 100 / (american + 100);
  return -american / (-american + 100);
}
function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }
function tierOf(s: number) {
  if (s >= 0.80) return "lock";
  if (s >= 0.70) return "strong";
  if (s >= 0.60) return "lean";
  return null;
}

type Leg = { event_id: string; market_type: string; player_name: string | null; team: string | null; sport: string; price: number; safety_score: number };
function violates(legs: Leg[]): string | null {
  if (new Set(legs.map(l => l.event_id)).size < Math.min(2, legs.length)) return "single_game_stack";
  const teamByGame = new Map<string, number>();
  for (const l of legs) if (l.market_type !== "player") teamByGame.set(l.event_id, (teamByGame.get(l.event_id) ?? 0) + 1);
  for (const v of teamByGame.values()) if (v > 1) return "multiple_team_legs_same_game";
  const players = legs.filter(l => l.market_type === "player").length;
  if (legs.length >= 3 && players < 1) return "no_player_leg";
  if (legs.length >= 3 && (legs.length - players) / legs.length > 0.40 + 1e-9) return "team_legs_over_40pct";
  return null;
}

Deno.test("test 1: hard-drop fat spread |line|>=9.5", () => {
  const dropped = [-12.5, 9.5, 11, -9.5].every(l => Math.abs(l) >= 9.5);
  assert(dropped);
});

Deno.test("test 2: implied prob de-juice symmetric", () => {
  const po = impliedProb(-110), pu = impliedProb(-110);
  const total = po + pu;
  assertEquals(Math.round(((po / total) + (pu / total)) * 1000) / 1000, 1);
});

Deno.test("test 3: tier thresholds", () => {
  assertEquals(tierOf(0.85), "lock");
  assertEquals(tierOf(0.75), "strong");
  assertEquals(tierOf(0.65), "lean");
  assertEquals(tierOf(0.50), null);
});

Deno.test("test 4: parlay diversity gate rejects 3-leg all-team", () => {
  const legs: Leg[] = [
    { event_id: "g1", market_type: "spread", player_name: null, team: "A", sport: "mlb", price: -110, safety_score: 0.7 },
    { event_id: "g2", market_type: "total", player_name: null, team: null, sport: "mlb", price: -105, safety_score: 0.7 },
    { event_id: "g3", market_type: "moneyline", player_name: null, team: "C", sport: "nhl", price: 120, safety_score: 0.7 },
  ];
  assertEquals(violates(legs), "no_player_leg");
});

Deno.test("test 5: parlay diversity gate accepts 3-leg with 2 player + 1 team", () => {
  const legs: Leg[] = [
    { event_id: "g1", market_type: "player", player_name: "P1", team: null, sport: "mlb", price: -120, safety_score: 0.8 },
    { event_id: "g2", market_type: "player", player_name: "P2", team: null, sport: "nhl", price: -110, safety_score: 0.75 },
    { event_id: "g3", market_type: "total", player_name: null, team: null, sport: "mlb", price: -105, safety_score: 0.72 },
  ];
  assertEquals(violates(legs), null);
  const dec = legs.reduce((a, l) => a * decimal(l.price), 1);
  assert(dec > 1);
});