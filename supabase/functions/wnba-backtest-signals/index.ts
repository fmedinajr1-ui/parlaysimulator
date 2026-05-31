// WNBA backtest signal replay.
// Joins wnba_historical_odds_snapshots × wnba_player_game_logs and writes
// graded rows into fanduel_prediction_accuracy with settlement_method='backtest'
// so live gates (take_it_now, etc.) can unlock for sport='wnba'.
//
// Trigger:
//   POST /functions/v1/wnba-backtest-signals
//   body: {
//     "signals": ["take_it_now"],         // default
//     "season":  2024,
//     "snapshot_tag": "t-2h",             // which snapshot to score from
//     "dry_run": false,
//     "limit": 100000
//   }
//
// take_it_now rule (mirrors signal-alert-engine):
//   - juice gap (|over_price - under_price|) >= TAKE_IT_NOW_MIN_GAP (30)
//   - prediction fades the favorite side (heavier juice)
//   - prop_type must map to one of the player markets we grade
//
// Rows are inserted (not upserted) — re-run after wiping if you want to regrade.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const TAKE_IT_NOW_MIN_GAP = 30;

// Map odds-api market key -> column in wnba_player_game_logs that supplies the actual
const MARKET_TO_STAT: Record<string, keyof BoxRow> = {
  player_points: "points",
  player_rebounds: "rebounds",
  player_assists: "assists",
  player_threes: "threes_made",
  player_steals: "steals",
  player_blocks: "blocks",
  player_turnovers: "turnovers",
};

interface BoxRow {
  player_name: string;
  game_date_et: string;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  threes_made: number | null;
  did_not_play: boolean;
}

interface OddsRow {
  event_id: string;
  game_start_ts: string;
  game_date_et: string;
  market: string;
  player_name: string;
  line: number;
  side: string;
  price: number;
  snapshot_ts: string;
  snapshot_tag: string;
}

function americanToProb(p: number): number {
  return p >= 0 ? 100 / (p + 100) : -p / (-p + 100);
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function loadOdds(season: number, snapshotTag: string, limit: number): Promise<OddsRow[]> {
  const seasonStart = `${season}-01-01`;
  const seasonEnd   = `${season + 1}-01-01`;
  const out: OddsRow[] = [];
  let from = 0;
  const page = 1000;
  while (out.length < limit) {
    const { data, error } = await sb.from("wnba_historical_odds_snapshots")
      .select("event_id, game_start_ts, game_date_et, market, player_name, line, side, price, snapshot_ts, snapshot_tag")
      .gte("game_date_et", seasonStart)
      .lt("game_date_et", seasonEnd)
      .eq("snapshot_tag", snapshotTag)
      .in("market", Object.keys(MARKET_TO_STAT))
      .range(from, from + page - 1);
    if (error) throw new Error(`odds load: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as OddsRow[]));
    if (data.length < page) break;
    from += page;
  }
  return out.slice(0, limit);
}

async function loadBoxIndex(season: number): Promise<Map<string, BoxRow>> {
  const seasonStart = `${season}-01-01`;
  const seasonEnd   = `${season + 1}-01-01`;
  const out = new Map<string, BoxRow>();
  let from = 0;
  const page = 1000;
  while (true) {
    const { data, error } = await sb.from("wnba_player_game_logs")
      .select("player_name, game_date_et, points, rebounds, assists, steals, blocks, turnovers, threes_made, did_not_play")
      .gte("game_date_et", seasonStart)
      .lt("game_date_et", seasonEnd)
      .range(from, from + page - 1);
    if (error) throw new Error(`box load: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as BoxRow[]) {
      const key = `${normalizeName(r.player_name)}|${r.game_date_et}`;
      out.set(key, r);
    }
    if (data.length < page) break;
    from += page;
  }
  return out;
}

function gradeTakeItNow(
  overRow: OddsRow,
  underRow: OddsRow,
  box: BoxRow,
): { prediction: "over" | "under"; was_correct: boolean | null; gap: number; edge: number } | null {
  if (overRow.price == null || underRow.price == null) return null;
  const gap = Math.abs(overRow.price - underRow.price);
  if (gap < TAKE_IT_NOW_MIN_GAP) return null;

  // Fade the favored side (lower (more negative) american odds = bigger favorite)
  const overImp  = americanToProb(overRow.price);
  const underImp = americanToProb(underRow.price);
  const prediction: "over" | "under" = overImp > underImp ? "under" : "over";

  const statCol = MARKET_TO_STAT[overRow.market];
  if (!statCol) return null;
  if (box.did_not_play) return { prediction, was_correct: null, gap, edge: Math.abs(overImp - underImp) };
  const actual = Number(box[statCol] ?? 0);
  let hit: boolean;
  if (prediction === "over") hit = actual > overRow.line;
  else hit = actual < overRow.line;
  return { prediction, was_correct: hit, gap, edge: Math.abs(overImp - underImp) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  const signals: string[] = body.signals ?? ["take_it_now"];
  const season  = Number(body.season ?? 2024);
  const snapshotTag: string = body.snapshot_tag ?? "t-2h";
  const dryRun = !!body.dry_run;
  const limit  = Number(body.limit ?? 100000);

  if (!signals.includes("take_it_now")) {
    return new Response(JSON.stringify({ ok: false, error: "Only take_it_now implemented in v1" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const t0 = Date.now();
  const [oddsRows, boxIdx] = await Promise.all([
    loadOdds(season, snapshotTag, limit),
    loadBoxIndex(season),
  ]);

  // Group over/under pairs by (event, market, player, line)
  type Key = string;
  const pairs = new Map<Key, { over?: OddsRow; under?: OddsRow }>();
  for (const r of oddsRows) {
    if (!r.player_name) continue;
    const k = `${r.event_id}|${r.market}|${normalizeName(r.player_name)}|${r.line}`;
    const cur = pairs.get(k) ?? {};
    if (r.side === "over") cur.over = r;
    else if (r.side === "under") cur.under = r;
    pairs.set(k, cur);
  }

  let evaluated = 0;
  let triggered = 0;
  let graded = 0;
  let voided = 0;
  let hits = 0;
  const toInsert: any[] = [];

  for (const [_, pair] of pairs) {
    if (!pair.over || !pair.under) continue;
    evaluated += 1;
    const ov = pair.over;
    const boxKey = `${normalizeName(ov.player_name)}|${ov.game_date_et}`;
    const box = boxIdx.get(boxKey);
    if (!box) continue; // unmatched player/date — skip
    const g = gradeTakeItNow(pair.over, pair.under, box);
    if (!g) continue;
    triggered += 1;
    if (g.was_correct === null) { voided += 1; continue; }
    graded += 1;
    if (g.was_correct) hits += 1;

    toInsert.push({
      signal_type: "take_it_now",
      sport: "wnba",
      prop_type: ov.market,
      player_name: ov.player_name,
      event_id: ov.event_id,
      prediction: g.prediction,
      predicted_direction: g.prediction,
      edge_at_signal: g.edge,
      confidence_at_signal: 0.9,
      line_at_alert: ov.line,
      was_correct: g.was_correct,
      actual_outcome: g.was_correct ? "hit" : "miss",
      settlement_method: "backtest",
      is_gated: false,
      verified_at: ov.game_start_ts,
      alert_sent_at: ov.snapshot_ts,
      hours_before_tip: 2,
      signal_factors: {
        backfill: true,
        season,
        snapshot_tag: ov.snapshot_tag,
        juice_gap: g.gap,
        over_price: pair.over.price,
        under_price: pair.under.price,
      },
    });
  }

  if (!dryRun && toInsert.length > 0) {
    // Insert in chunks
    const chunkSize = 1000;
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize);
      const { error } = await sb.from("fanduel_prediction_accuracy").insert(chunk);
      if (error) {
        console.warn(`[wnba-backtest] insert chunk ${i} err:`, error.message);
      }
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    dry_run: dryRun,
    season,
    snapshot_tag: snapshotTag,
    odds_rows: oddsRows.length,
    box_rows: boxIdx.size,
    pairs_evaluated: evaluated,
    triggered,
    graded,
    voided_dnp: voided,
    hits,
    hit_rate: graded > 0 ? hits / graded : null,
    rows_inserted: dryRun ? 0 : toInsert.length,
    elapsed_ms: Date.now() - t0,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});