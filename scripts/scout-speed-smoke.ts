#!/usr/bin/env bun
/**
 * Scout Speed Edge — end-to-end smoke test.
 *
 * Posts a synthetic odds snapshot, then a live event that should beat the
 * book by enough to fire a lag edge. Verifies:
 *   1. market-snapshot-ingest accepts signed payload
 *   2. scout-live-edge accepts signed payload, evaluates, and fires
 *   3. lag_edges row was written
 *   4. Telegram alert dispatched (checked via edge response's `fired` count)
 *
 * Usage:
 *   ODDS_FEED_WEBHOOK_SECRET=... \
 *   LIVE_EVENT_WEBHOOK_SECRET=... \
 *   SUPABASE_SERVICE_ROLE_KEY=...  (optional — enables DB verify)
 *   bun scripts/scout-speed-smoke.ts
 *
 * Flags:
 *   --no-event       only post snapshot
 *   --no-snapshot    only post event (use existing snapshot)
 *   --game <id>      override game id (default: smoke-<timestamp>)
 *   --scenarios      run the strict-assertion scenario suite (fires + no-fires)
 */

import { createHmac } from "node:crypto";

const PROJECT_REF = "pajakaqphlxoqjtrxzmi";
const BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;

const ODDS_SECRET = process.env.ODDS_FEED_WEBHOOK_SECRET ?? "";
const EVENT_SECRET = process.env.LIVE_EVENT_WEBHOOK_SECRET ?? "";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const args = new Set(process.argv.slice(2));
const gameIdx = process.argv.indexOf("--game");
const GAME_ID =
  gameIdx !== -1 ? process.argv[gameIdx + 1] : `smoke-${Date.now()}`;
const PLAYER = "Smoke Tester";

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

async function post(path: string, body: unknown, secret: string) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) headers["X-Webhook-Signature"] = sign(raw, secret);
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body: raw });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

function log(label: string, obj: unknown) {
  console.log(`\n── ${label} ──`);
  console.log(typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
}

async function main() {
  if (args.has("--scenarios")) return runScenarios();

  if (!ODDS_SECRET) console.warn("⚠️  ODDS_FEED_WEBHOOK_SECRET not set — request will be rejected if secret is configured on server");
  if (!EVENT_SECRET) console.warn("⚠️  LIVE_EVENT_WEBHOOK_SECRET not set — request will be rejected if secret is configured on server");

  console.log(`Game ID: ${GAME_ID}`);

  // Snapshot timestamp ~12s in the past so excess_lag = (event - snapshot) - baseline
  // = 12 - 3 ≈ 9s, easily clears the 2s floor and EV_FLOOR=0.03.
  const snapshotCapturedAt = new Date(Date.now() - 12_000).toISOString();
  const eventTime = new Date().toISOString();

  if (!args.has("--no-snapshot")) {
    const snap = {
      snapshots: [
        {
          book: "SmokeBook",
          game_id: GAME_ID,
          market_type: "player_pts",
          player_name: PLAYER,
          line: 22.5,
          odds: -110,
          captured_at: snapshotCapturedAt,
        },
      ],
    };
    const r = await post("/market-snapshot-ingest", snap, ODDS_SECRET);
    log(`POST /market-snapshot-ingest → ${r.status}`, r.body);
    if (r.status !== 200) process.exit(1);
  }

  if (!args.has("--no-event")) {
    const evt = {
      sport: "NBA",
      game_id: GAME_ID,
      event_time: eventTime,
      event_type: "SHOT_MADE",
      player_name: PLAYER,
      team: "SMK",
      raw_data: { minutes_remaining: 18, points: 3 },
    };
    const r = await post("/scout-live-edge", evt, EVENT_SECRET);
    log(`POST /scout-live-edge → ${r.status}`, r.body);
    if (r.status !== 200) process.exit(1);
    if (r.body?.fired === 0) {
      console.warn("\n⚠️  No edge fired. Likely causes: snapshot not visible yet, EV below floor, or relevance map mismatch.");
    } else {
      console.log(`\n✅ Fired ${r.body.fired} edge(s) — Telegram alert should be in admin chat.`);
    }
  }

  if (SERVICE_ROLE) {
    const dbRes = await fetch(
      `${SUPABASE_URL}/rest/v1/lag_edges?game_id=eq.${encodeURIComponent(GAME_ID)}&select=id,edge_type,player_name,model_edge,stake_units,status,fired_at`,
      { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
    );
    const rows = await dbRes.json().catch(() => []);
    log(`DB verify — lag_edges where game_id=${GAME_ID}`, rows);
    if (Array.isArray(rows) && rows.length > 0) console.log("✅ DB write confirmed.");
    else console.warn("⚠️  No lag_edges rows found for this game_id.");
  } else {
    console.log("\n(Skip DB verify — set SUPABASE_SERVICE_ROLE_KEY to enable.)");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

// ────────────────────────────────────────────────────────────────────────────
// Scenario suite — strict assertions for fire / no-fire cases.
// ────────────────────────────────────────────────────────────────────────────

type Snap = {
  market_type: string;
  player_name?: string | null;
  line: number;
  odds: number;
  ageMs: number; // how far in the past captured_at should be
  book?: string;
};
type Evt = {
  event_type: string;
  player_name?: string | null;
  sport?: string;
  raw?: Record<string, unknown>;
};
type Scenario = {
  name: string;
  expectFire: boolean;
  snapshots: Snap[]; // [] = no snapshot posted
  event: Evt;
  note?: string;
};

const SCENARIOS: Scenario[] = [
  {
    name: "POS: stale player_pts + SHOT_MADE should fire",
    expectFire: true,
    snapshots: [{ market_type: "player_pts", player_name: PLAYER, line: 22.5, odds: -110, ageMs: 12_000 }],
    event: { event_type: "SHOT_MADE", player_name: PLAYER, raw: { minutes_remaining: 18, points: 3 } },
  },
  {
    name: "POS: stale player_ast + ASSIST should fire",
    expectFire: true,
    snapshots: [{ market_type: "player_ast", player_name: PLAYER, line: 6.5, odds: -115, ageMs: 14_000 }],
    event: { event_type: "ASSIST", player_name: PLAYER, raw: { minutes_remaining: 20 } },
  },
  {
    name: "NEG: fresh snapshot (under excess-lag floor) should NOT fire",
    expectFire: false,
    snapshots: [{ market_type: "player_pts", player_name: PLAYER, line: 22.5, odds: -110, ageMs: 1_500 }],
    event: { event_type: "SHOT_MADE", player_name: PLAYER, raw: { minutes_remaining: 18 } },
    note: "lag ≈ 1.5s, baseline ≥ 2s → excess_lag < 2s gate",
  },
  {
    name: "NEG: irrelevant event type (TIMEOUT vs player_pts) should NOT fire",
    expectFire: false,
    snapshots: [{ market_type: "player_pts", player_name: PLAYER, line: 22.5, odds: -110, ageMs: 12_000 }],
    event: { event_type: "TIMEOUT", player_name: null, raw: { minutes_remaining: 10 } },
  },
  {
    name: "NEG: player mismatch on player_* market should NOT fire",
    expectFire: false,
    snapshots: [{ market_type: "player_pts", player_name: PLAYER, line: 22.5, odds: -110, ageMs: 12_000 }],
    event: { event_type: "SHOT_MADE", player_name: "Other Person", raw: { minutes_remaining: 18 } },
  },
  {
    name: "NEG: no snapshot at all should NOT fire",
    expectFire: false,
    snapshots: [],
    event: { event_type: "SHOT_MADE", player_name: PLAYER, raw: { minutes_remaining: 18 } },
  },
];

async function fetchEdges(gameId: string): Promise<any[]> {
  if (!SERVICE_ROLE) return [];
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/lag_edges?game_id=eq.${encodeURIComponent(gameId)}&select=id,edge_type,player_name,model_edge,status,fired_at`,
    { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
  );
  const body = await res.json().catch(() => []);
  return Array.isArray(body) ? body : [];
}

async function runOne(s: Scenario, idx: number): Promise<{ ok: boolean; detail: string }> {
  const gameId = `smoke-scn-${Date.now()}-${idx}`;
  const eventTime = new Date().toISOString();

  // 1) Post snapshots (if any)
  if (s.snapshots.length > 0) {
    const snap = {
      snapshots: s.snapshots.map((sn) => ({
        book: sn.book ?? "SmokeBook",
        game_id: gameId,
        market_type: sn.market_type,
        player_name: sn.player_name ?? null,
        line: sn.line,
        odds: sn.odds,
        captured_at: new Date(Date.now() - sn.ageMs).toISOString(),
      })),
    };
    const r = await post("/market-snapshot-ingest", snap, ODDS_SECRET);
    if (r.status !== 200) return { ok: false, detail: `snapshot ingest failed: ${r.status} ${JSON.stringify(r.body)}` };
  }

  // 2) Post event
  const evt = {
    sport: s.event.sport ?? "NBA",
    game_id: gameId,
    event_time: eventTime,
    event_type: s.event.event_type,
    player_name: s.event.player_name ?? null,
    team: "SMK",
    raw_data: s.event.raw ?? {},
  };
  const r = await post("/scout-live-edge", evt, EVENT_SECRET);
  if (r.status !== 200) return { ok: false, detail: `event post failed: ${r.status} ${JSON.stringify(r.body)}` };

  const fired = Number(r.body?.fired ?? 0);

  // Strict assertion on `fired`
  if (s.expectFire && fired < 1) return { ok: false, detail: `expected fired≥1, got ${fired}. response=${JSON.stringify(r.body)}` };
  if (!s.expectFire && fired !== 0) return { ok: false, detail: `expected fired=0, got ${fired}. response=${JSON.stringify(r.body)}` };

  // DB cross-check when service role available
  if (SERVICE_ROLE) {
    const rows = await fetchEdges(gameId);
    if (s.expectFire && rows.length < 1) return { ok: false, detail: `expected ≥1 lag_edges row, got 0` };
    if (!s.expectFire && rows.length !== 0) return { ok: false, detail: `expected 0 lag_edges rows, got ${rows.length}` };
  }

  return { ok: true, detail: `fired=${fired}` };
}

async function runScenarios() {
  if (!ODDS_SECRET || !EVENT_SECRET) {
    console.error("❌ Both ODDS_FEED_WEBHOOK_SECRET and LIVE_EVENT_WEBHOOK_SECRET are required for scenarios.");
    process.exit(1);
  }
  if (!SERVICE_ROLE) {
    console.warn("⚠️  SUPABASE_SERVICE_ROLE_KEY not set — DB row assertions will be skipped.");
  }

  console.log(`\n🎯 Running ${SCENARIOS.length} Scout Speed Edge scenarios\n`);
  let passed = 0;
  const failures: string[] = [];

  for (let i = 0; i < SCENARIOS.length; i++) {
    const s = SCENARIOS[i];
    process.stdout.write(`[${i + 1}/${SCENARIOS.length}] ${s.name} ... `);
    try {
      const res = await runOne(s, i);
      if (res.ok) { console.log(`✅ PASS (${res.detail})`); passed++; }
      else { console.log(`❌ FAIL — ${res.detail}`); failures.push(`${s.name}\n   ${res.detail}`); }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`❌ ERROR — ${msg}`);
      failures.push(`${s.name}\n   ${msg}`);
    }
    // tiny gap so snapshots from scenario N don't pollute scenario N+1's window
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Result: ${passed}/${SCENARIOS.length} passed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(" • " + f);
    process.exit(1);
  }
  console.log("✅ All scenarios passed.");
}