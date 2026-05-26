import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRelevant } from "../_shared/scout-speed/relevance.ts";
import { impactScore, scoreEdge, evPerUnit, halfKellyStake } from "../_shared/scout-speed/scoring.ts";
import { verifyHmac } from "../_shared/scout-speed/hmac.ts";
import { formatSpeedEdgeAlert } from "../_shared/scout-speed/telegram-format.ts";

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

  // 2) baselines
  const baseMap = new Map<string, number>();
  try {
    const { data: baselines } = await supabase.from("market_baselines").select("market_type, baseline_lag_seconds");
    for (const b of baselines ?? []) baseMap.set(b.market_type, Number(b.baseline_lag_seconds));
  } catch (e) {
    console.error("[scout-live-edge] baseline load failed", e);
  }

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
    const { prob, expectedMove } = scoreEdge(features);
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