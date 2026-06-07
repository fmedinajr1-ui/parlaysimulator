import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRelevant } from "../_shared/scout-speed/relevance.ts";
import { impactScore, scoreEdge, evPerUnit, halfKellyStake, eventDirection } from "../_shared/scout-speed/scoring.ts";
import { verifyHmac } from "../_shared/scout-speed/hmac.ts";
import { formatSpeedEdgeAlert } from "../_shared/scout-speed/telegram-format.ts";
import { loadActiveModel } from "../_shared/scout-speed/model.ts";
import { winProb } from "../_shared/mlb-fair-price/win-prob.ts";
import { MIN_EV_PCT, MIN_LIQUIDITY, STALE_FEED_MS } from "../_shared/mlb-fair-price/constants.ts";
import { americanToImplied, deVig, liveMlEdge, type BookLine } from "../_shared/mlb-fair-price/edge.ts";
import type { GameState } from "../_shared/mlb-fair-price/state.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-signature",
};

const EV_FLOOR = 0.03;
const EDGE_WINDOW_MS = 15_000;
const SNAPSHOT_LOOKBACK_MS = 30_000;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendTelegram(message: string) {
  try {
    await supabase.functions.invoke("bot-send-telegram", {
      body: {
        message,
        parse_mode: "Markdown",
        admin_only: true,
        type: "scout_speed_edge",
      },
    });
  } catch (e) {
    console.error("[scout-live-edge] telegram send failed", e);
  }
}

// MLB Fair-Price (latency arb) v1 — admin-only WARN alerts, log-only.
// Spec: mlb_fair_price_spec.md. NEVER auto-bets, NEVER notifies customers.
async function sendFairPriceAdminAlert(message: string) {
  try {
    await supabase.functions.invoke("bot-send-telegram", {
      body: {
        message,
        parse_mode: "Markdown",
        admin_only: true,
        type: "mlb_fair_price",
      },
    });
  } catch (e) {
    console.error("[scout-live-edge] fair-price telegram send failed", e);
  }
}

async function evaluateMlbFairPrice(event: any, eventRowId: string) {
  const fp = event?.fair_price;
  if (!fp || fp.tier !== 1) return;
  const pre = fp.pre_state as GameState | undefined;
  const post = fp.post_state as GameState | undefined;
  const feedTs = Number(fp.feed_ts ?? Date.now());
  if (!pre || !post) return;

  // Stale-feed guard
  const age = Date.now() - feedTs;
  if (age > STALE_FEED_MS) {
    await logFp({ event, eventRowId, pre, post, feedTs, decision: "skip", skipReason: "stale_feed" });
    return;
  }

  // WP must be uncalibrated-allowed in v1 (WARN mode). Returns finite or null.
  const wpPre = winProb(pre, { allowUncalibrated: true });
  const wpPost = winProb(post, { allowUncalibrated: true });
  if (wpPre == null || wpPost == null) {
    await logFp({ event, eventRowId, pre, post, feedTs, decision: "skip", skipReason: "wp_null" });
    return;
  }

  // Pull latest LIVE_ML snapshot for this game (book line).
  let book: BookLine | null = null;
  try {
    const { data } = await supabase
      .from("market_snapshot")
      .select("*")
      .eq("game_id", String(event.game_id))
      .eq("market_type", "live_ml")
      .order("captured_at", { ascending: false })
      .limit(2);
    if (data && data.length > 0) {
      const top = data[0];
      const opp = data.find((r: any) => r.id !== top.id && r.sportsbook === top.sportsbook);
      const impliedA = americanToImplied(Number(top.american_odds ?? 0));
      const impliedB = opp ? americanToImplied(Number(opp.american_odds ?? 0)) : impliedA;
      const devig = deVig(impliedA, impliedB);
      const lastMoveTs = Date.parse(top.captured_at);
      book = {
        bookId: String(top.sportsbook ?? "unknown"),
        market: "LIVE_ML",
        impliedDevig: Number.isFinite(devig) ? devig : impliedA,
        lastMoveTs: Number.isFinite(lastMoveTs) ? lastMoveTs : 0,
        limit: Number(top.limit_amount ?? 0),
        suspended: !!top.suspended,
      };
    }
  } catch (e) {
    console.error("[scout-live-edge] fair-price book load failed", e);
  }

  if (!book || book.suspended) {
    await logFp({ event, eventRowId, pre, post, feedTs, wpPre, wpPost, decision: "skip", skipReason: "no_book_or_suspended" });
    return;
  }
  if (book.lastMoveTs > feedTs) {
    await logFp({ event, eventRowId, pre, post, feedTs, wpPre, wpPost, book, decision: "skip", skipReason: "book_reacted" });
    return;
  }
  if ((book.limit ?? 0) < MIN_LIQUIDITY) {
    await logFp({ event, eventRowId, pre, post, feedTs, wpPre, wpPost, book, decision: "skip", skipReason: "below_min_liquidity" });
    return;
  }

  const edge = liveMlEdge(wpPost, book);
  const fired = edge >= MIN_EV_PCT;
  await logFp({
    event, eventRowId, pre, post, feedTs, wpPre, wpPost, book, edge,
    decision: fired ? "fire" : "skip",
    skipReason: fired ? null : "below_min_ev",
  });

  if (fired) {
    const msg =
      `*[MLB Fair-Price WARN]* \`${event.event_type}\` ${event.game_id}\n` +
      `ΔWP ${(wpPost - wpPre).toFixed(3)} | fair ${(wpPost * 100).toFixed(1)}% vs book ${(book.impliedDevig * 100).toFixed(1)}%\n` +
      `edge ${(edge * 100).toFixed(2)}% · ${book.bookId} · limit $${book.limit ?? 0}\n` +
      `_uncalibrated WP — measurement only, do not bet_`;
    await sendFairPriceAdminAlert(msg);
  }
}

async function logFp(params: {
  event: any;
  eventRowId: string;
  pre: GameState;
  post: GameState;
  feedTs: number;
  wpPre?: number | null;
  wpPost?: number | null;
  book?: BookLine | null;
  edge?: number;
  decision: "fire" | "skip";
  skipReason?: string | null;
}) {
  try {
    await supabase.from("mlb_fair_price_events").insert({
      game_id: String(params.event.game_id),
      event_type: String(params.event.event_type),
      feed_ts: params.feedTs,
      event_time: params.event.event_time,
      pre_state: params.pre,
      post_state: params.post,
      wp_pre: params.wpPre ?? null,
      wp_post: params.wpPost ?? null,
      delta_wp: (params.wpPre != null && params.wpPost != null) ? params.wpPost - params.wpPre : null,
      market: "LIVE_ML",
      book_id: params.book?.bookId ?? null,
      book_implied: null,
      book_implied_devig: params.book?.impliedDevig ?? null,
      book_last_move_ts: params.book?.lastMoveTs ?? null,
      edge: params.edge ?? null,
      ev_pct: params.edge ?? null,
      ttl_ms: null,
      gate_decision: params.decision,
      skip_reason: params.skipReason ?? null,
      severity: "WARN",
      telegram_sent: params.decision === "fire",
      telegram_admin_only: true,
    });
  } catch (e) {
    console.error("[scout-live-edge] mlb_fair_price_events insert failed", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const raw = await req.text();

  // ping short-circuit BEFORE HMAC so warm-keeper can be unauthenticated
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return json({ error: "invalid json" }, 400); }
  if (parsed?.ping) return json({ ok: true, pong: true });

  const ok = await verifyHmac(
    raw,
    req.headers.get("x-webhook-signature"),
    Deno.env.get("LIVE_EVENT_WEBHOOK_SECRET"),
  );
  if (!ok) return json({ error: "invalid signature" }, 401);

  const event = parsed;
  if (!event?.game_id || !event?.event_type || !event?.event_time) {
    return json({ error: "missing required fields" }, 400);
  }

  // 1) persist event
  let storedEvent: any;
  try {
    const { data, error } = await supabase
      .from("live_events")
      .insert({
        sport: event.sport ?? "UNKNOWN",
        game_id: String(event.game_id),
        event_time: event.event_time,
        event_type: event.event_type,
        player_name: event.player_name ?? null,
        team: event.team ?? null,
        raw_data: event,
      })
      .select()
      .single();
    if (error) return json({ error: error.message }, 500);
    storedEvent = data;
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "event insert failed" }, 500);
  }

  // 1b) MLB Fair-Price layer (admin-only WARN, log-only). Best-effort.
  if (event.sport === "MLB" && event.fair_price) {
    try { await evaluateMlbFairPrice(event, storedEvent.id); }
    catch (e) { console.error("[scout-live-edge] fair-price block failed", e); }
  }

  // 2) baselines
  const baseMap = new Map<string, number>();
  try {
    const { data: baselines } = await supabase.from("market_baselines").select("market_type, baseline_lag_seconds");
    for (const b of baselines ?? []) baseMap.set(b.market_type, Number(b.baseline_lag_seconds));
  } catch (e) {
    console.error("[scout-live-edge] baseline load failed", e);
  }

  // 2b) active learned model (null → heuristic fallback in scoreEdge)
  const activeModel = await loadActiveModel(supabase);

  // 3) recent snapshots
  let markets: any[] = [];
  try {
    const { data } = await supabase
      .from("market_snapshot")
      .select("*")
      .eq("game_id", String(event.game_id))
      .gte("captured_at", new Date(Date.now() - SNAPSHOT_LOOKBACK_MS).toISOString())
      .order("captured_at", { ascending: false });
    markets = data ?? [];
  } catch (e) {
    console.error("[scout-live-edge] snapshot load failed", e);
  }

  let fired = 0;
  let evaluated = 0;

  for (const market of markets) {
    if (!isRelevant(event.event_type, market.market_type)) continue;
    if (market.market_type.startsWith("player_") && market.player_name !== event.player_name) continue;
    evaluated++;

    const lagSec = (Date.parse(event.event_time) - Date.parse(market.captured_at)) / 1000;
    const baseline = baseMap.get(market.market_type) ?? 3;
    const excessLag = lagSec - baseline;
    if (excessLag < 2) continue;

    const features = {
      excess_lag: excessLag,
      event_impact: impactScore(event.event_type),
      time_remaining: event?.raw_data?.minutes_remaining ?? 24,
    };
    const { prob, expectedMove } = scoreEdge(features, activeModel?.coefficients ?? null);
    const ev = evPerUnit(prob, expectedMove);
    if (ev < EV_FLOOR) continue;

    const stake = halfKellyStake(prob, expectedMove);
    const expiresAt = new Date(Date.now() + EDGE_WINDOW_MS).toISOString();

    try {
      const { data: edge, error } = await supabase
        .from("lag_edges")
        .insert({
          game_id: String(event.game_id),
          player_name: event.player_name ?? null,
          edge_type: market.market_type,
          market_delay_seconds: lagSec,
          excess_lag_seconds: excessLag,
          event_impact: features.event_impact,
          confidence: prob,
          expected_move: expectedMove,
          model_edge: ev,
          stake_units: stake,
          status: "active",
          expires_at: expiresAt,
          intended_direction: eventDirection(event.event_type, market.market_type),
          source_event_id: storedEvent.id,
          source_snapshot_id: market.id,
        })
        .select()
        .single();

      if (error) {
        if ((error as any).code === "23505") continue; // dedupe
        console.error("[scout-live-edge] edge insert failed", error);
        continue;
      }
      if (!edge) continue;

      const msg = formatSpeedEdgeAlert(edge, event.event_type, {
        sportsbook: market.sportsbook,
        line: market.line,
      });
      await sendTelegram(msg);
      await supabase.from("lag_edges").update({ fired_at: new Date().toISOString() }).eq("id", edge.id);
      fired++;
    } catch (e) {
      console.error("[scout-live-edge] edge pipeline error", e);
    }
  }

  return json({ ok: true, event_id: storedEvent.id, evaluated, fired });
});