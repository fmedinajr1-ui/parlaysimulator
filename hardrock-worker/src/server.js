// Hard Rock Bet stealth worker — runs alongside fanduel-worker on a VPS in
// a legal HR state. Exposes:
//   GET  /health           → public liveness probe
//   POST /scrape/mlb       → Bearer auth; returns MLB moneylines
//   POST /scrape/nba       → Bearer auth; returns NBA player props
//
// When SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set, each /scrape/*
// call also inserts rows directly into `market_snapshot` so you can skip
// the bridge edge function in setups that want one fewer hop.

import express from "express";
import { requireBearer } from "./auth.js";
import { scrapeMlbMoneylines } from "./scrape-mlb.js";
import { scrapeNbaPlayerProps } from "./scrape-nba.js";
import { uploadMarketSnapshot } from "./supabase.js";
import { shutdownBrowser } from "./browser.js";

const PORT = parseInt(process.env.PORT ?? "8081", 10);

const app = express();
app.use(express.json({ limit: "256kb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    supabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    auth: Boolean(process.env.HARDROCK_WORKER_SECRET),
  });
});

function mlbEventsToSnapshotRows(events) {
  // game_id mapping (mlb_<gamePk>) happens in the bridge function; the
  // direct-upload path here uses HR's own event_id as the game_id so the
  // worker doesn't need an MLB schedule lookup.
  const rows = [];
  for (const ev of events) {
    const game_id = `hr_mlb_${ev.event_id}`;
    rows.push({
      sportsbook: "hardrockbet", game_id, market_type: "live_ml",
      player_name: ev.home_team, line: null, odds: ev.home_price, captured_at: ev.captured_at,
    });
    rows.push({
      sportsbook: "hardrockbet", game_id, market_type: "live_ml",
      player_name: ev.away_team, line: null, odds: ev.away_price, captured_at: ev.captured_at,
    });
  }
  return rows;
}

function nbaPropsToSnapshotRows(props) {
  const rows = [];
  for (const p of props) {
    const game_id = `hr_nba_${p.event_id}`;
    if (p.over_price != null) {
      rows.push({
        sportsbook: "hardrockbet", game_id, market_type: p.prop_type,
        player_name: `${p.player} Over`, line: p.line, odds: p.over_price, captured_at: p.captured_at,
      });
    }
    if (p.under_price != null) {
      rows.push({
        sportsbook: "hardrockbet", game_id, market_type: p.prop_type,
        player_name: `${p.player} Under`, line: p.line, odds: p.under_price, captured_at: p.captured_at,
      });
    }
  }
  return rows;
}

app.post("/scrape/mlb", requireBearer, async (_req, res) => {
  const t0 = Date.now();
  try {
    const events = await scrapeMlbMoneylines();
    const upload = await uploadMarketSnapshot(mlbEventsToSnapshotRows(events));
    const ms = Date.now() - t0;
    console.log(`[hr-worker] /scrape/mlb ${events.length} events, uploaded=${upload.uploaded} in ${ms}ms`);
    res.json({ ok: true, ms, events, upload });
  } catch (e) {
    const ms = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[hr-worker] /scrape/mlb failed in ${ms}ms: ${msg}`);
    res.status(502).json({ ok: false, ms, error: msg });
  }
});

app.post("/scrape/nba", requireBearer, async (req, res) => {
  const t0 = Date.now();
  const maxEvents = Math.min(Number(req.body?.maxEvents) || 20, 40);
  try {
    const props = await scrapeNbaPlayerProps({ maxEvents });
    const upload = await uploadMarketSnapshot(nbaPropsToSnapshotRows(props));
    const ms = Date.now() - t0;
    console.log(`[hr-worker] /scrape/nba ${props.length} props, uploaded=${upload.uploaded} in ${ms}ms`);
    res.json({ ok: true, ms, props, upload });
  } catch (e) {
    const ms = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[hr-worker] /scrape/nba failed in ${ms}ms: ${msg}`);
    res.status(502).json({ ok: false, ms, error: msg });
  }
});

app.listen(PORT, () => {
  console.log(`[hr-worker] listening on :${PORT}`);
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    console.log(`[hr-worker] ${sig} received, closing`);
    await shutdownBrowser();
    process.exit(0);
  });
}