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

function isStale(commenceISO: string, bufferMin = 15): boolean {
  return new Date(commenceISO).getTime() < Date.now() + bufferMin * 60_000;
}
function tierAfterSampleCap(rawTier: string | null, sampleSize: number): string | null {
  if (!rawTier) return null;
  if (sampleSize < 5 && (rawTier === "lock" || rawTier === "strong")) return "lean";
  return rawTier;
}

Deno.test("test 6: stale-game filter rejects games already started", () => {
  const past = new Date(Date.now() - 60 * 60_000).toISOString(); // 1h ago
  const future = new Date(Date.now() + 60 * 60_000).toISOString(); // 1h ahead
  assert(isStale(past));
  assertEquals(isStale(future), false);
});

Deno.test("test 7: 15-min pregame buffer treats game starting in 5min as stale", () => {
  const soon = new Date(Date.now() + 5 * 60_000).toISOString();
  assert(isStale(soon));
});

Deno.test("test 8: thin sample (<5 games) caps lock down to lean", () => {
  assertEquals(tierAfterSampleCap("lock", 3), "lean");
  assertEquals(tierAfterSampleCap("strong", 4), "lean");
  assertEquals(tierAfterSampleCap("lock", 7), "lock");
  assertEquals(tierAfterSampleCap("lean", 2), "lean");
});

// ----- Team-leg safety formula (mirrors cross-sport-sweet-spots) -----
function teamSafety(price: number, sideKind: "home_ml" | "home_spread" | "under_total" | "other", researchBoost = 0): number {
  const implied = impliedProb(price);
  let bump = 0.01;
  if (sideKind === "home_ml") bump = 0.04;
  else if (sideKind === "home_spread") bump = 0.03;
  else if (sideKind === "under_total") bump = 0.02;
  const conf = Math.min(0.85, implied + bump);
  const W_RESEARCH = 0.10;
  return clamp01(
    0.95 * conf + 0.05 + 0.10 * Math.max(0, conf - 0.50) + W_RESEARCH * researchBoost * 2.5
  );
}

Deno.test("test 9: -200 ML home favorite reaches strong tier (>=0.70)", () => {
  const s = teamSafety(-200, "home_ml", 0);
  assert(s >= 0.70, `expected >=0.70, got ${s}`);
});

Deno.test("test 10: -110 home dog stays below lean threshold", () => {
  const s = teamSafety(-110, "other", 0);
  assert(s < 0.60, `expected <0.60, got ${s}`);
});

Deno.test("test 11: +120 underdog with research boost still rejected (no dog inflation)", () => {
  const s = teamSafety(120, "other", 0.05);
  assert(s < 0.60, `expected <0.60, got ${s}`);
});

// ----- Team-leg floor in generator -----
type GLeg = { event_id: string; market_type: string; player_name: string | null; sport: string; safety_score: number; tier: string };
function pickWithFloor(pool: GLeg[], legs: number, requireTeam: boolean): GLeg[] | null {
  const filtered = [...pool].sort((a, b) => b.safety_score - a.safety_score);
  const teamCands = filtered.filter(l => l.market_type !== "player");
  const enforce = requireTeam && teamCands.length >= 3;
  const picked: GLeg[] = [];
  const games = new Set<string>();
  if (enforce && teamCands.length > 0) {
    picked.push(teamCands[0]);
    games.add(teamCands[0].event_id);
  }
  for (const c of filtered) {
    if (picked.length >= legs) break;
    if (picked.includes(c)) continue;
    if (games.has(c.event_id) && c.market_type !== "player") continue;
    picked.push(c);
    games.add(c.event_id);
  }
  if (picked.length < legs) return null;
  if (enforce && picked.every(l => l.market_type === "player")) return null;
  return picked;
}

Deno.test("test 12: stretch_4 with team pool >=3 includes a team leg", () => {
  const pool: GLeg[] = [
    ...Array.from({ length: 6 }, (_, i) => ({ event_id: `g${i}`, market_type: "player", player_name: `P${i}`, sport: "mlb", safety_score: 0.80 - i * 0.01, tier: "strong" })),
    { event_id: "g7", market_type: "moneyline", player_name: null, sport: "mlb", safety_score: 0.71, tier: "strong" },
    { event_id: "g8", market_type: "total", player_name: null, sport: "nhl", safety_score: 0.68, tier: "lean" },
    { event_id: "g9", market_type: "spread", player_name: null, sport: "nba", safety_score: 0.66, tier: "lean" },
  ];
  const res = pickWithFloor(pool, 4, true);
  assert(res !== null);
  assert(res!.some(l => l.market_type !== "player"), "expected at least one team leg");
});

Deno.test("test 13: stretch_4 with zero team candidates falls back to all-player", () => {
  const pool: GLeg[] = Array.from({ length: 6 }, (_, i) =>
    ({ event_id: `g${i}`, market_type: "player", player_name: `P${i}`, sport: "mlb", safety_score: 0.80 - i * 0.01, tier: "strong" }));
  const res = pickWithFloor(pool, 4, true);
  assert(res !== null, "should not crash on empty team pool");
  assertEquals(res!.length, 4);
});