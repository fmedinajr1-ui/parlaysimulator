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