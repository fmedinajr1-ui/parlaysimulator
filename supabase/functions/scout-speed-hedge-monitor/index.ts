// Scout Speed Edge — Phase 2: auto-hedge on reverse.
// Cron (every minute) scans recently fired edges and, if the market has moved
// AGAINST the predicted direction by ≥ HEDGE_REVERSE_THRESHOLD, emits a hedge
// alert and stamps hedge_* columns on the edge.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { reverseDelta } from "../_shared/scout-speed/scoring.ts";
import { formatHedgeAlert } from "../_shared/scout-speed/telegram-format.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Look back at edges fired in the last 20 minutes (hedge windows are tight)
const LOOKBACK_MS = 20 * 60 * 1000;
// Min line units the market must move AGAINST us to trigger a hedge
const HEDGE_REVERSE_THRESHOLD = 0.5;
// Snapshot must be more recent than the fired snapshot by at least this
const MIN_SNAPSHOT_LAG_MS = 5_000;

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
        type: "scout_speed_hedge",
      },
    });
  } catch (e) {
    console.error("[scout-hedge-monitor] telegram send failed", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();

  const { data: candidates, error } = await supabase
    .from("lag_edges")
    .select("id, game_id, player_name, edge_type, intended_direction, fired_at, source_snapshot_id")
    .is("hedge_fired_at", null)
    .not("fired_at", "is", null)
    .not("intended_direction", "is", null)
    .gte("fired_at", since)
    .limit(200);

  if (error) return json({ ok: false, error: error.message }, 500);
  if (!candidates?.length) return json({ ok: true, scanned: 0, hedged: 0 });

  let hedged = 0;
  for (const edge of candidates) {
    if (!edge.source_snapshot_id) continue;

    // Original fired snapshot (line at fire time)
    const { data: fired } = await supabase
      .from("market_snapshot")
      .select("line, captured_at, market_type, player_name")
      .eq("id", edge.source_snapshot_id)
      .maybeSingle();
    if (!fired || fired.line == null) continue;

    // Most recent snapshot for same game/market/player
    let q = supabase
      .from("market_snapshot")
      .select("id, line, captured_at")
      .eq("game_id", edge.game_id)
      .eq("market_type", edge.edge_type)
      .gt("captured_at", new Date(Date.parse(fired.captured_at) + MIN_SNAPSHOT_LAG_MS).toISOString())
      .order("captured_at", { ascending: false })
      .limit(1);
    if (fired.player_name) q = q.eq("player_name", fired.player_name);
    const { data: latestArr } = await q;
    const latest = latestArr?.[0];
    if (!latest || latest.line == null) continue;

    const delta = reverseDelta(
      edge.intended_direction as "up" | "down",
      Number(fired.line),
      Number(latest.line),
    );
    if (delta < HEDGE_REVERSE_THRESHOLD) continue;

    // Stamp hedge first to be idempotent under concurrent runs
    const { error: updErr, data: updated } = await supabase
      .from("lag_edges")
      .update({
        hedge_fired_at: new Date().toISOString(),
        hedge_snapshot_id: latest.id,
        hedge_reverse_line: latest.line,
        hedge_reverse_delta: delta,
      })
      .eq("id", edge.id)
      .is("hedge_fired_at", null)
      .select()
      .maybeSingle();
    if (updErr || !updated) continue;

    await sendTelegram(
      formatHedgeAlert({
        player_name: edge.player_name,
        edge_type: edge.edge_type,
        intended_direction: edge.intended_direction as "up" | "down",
        fired_line: Number(fired.line),
        reverse_line: Number(latest.line),
        reverse_delta: delta,
      }),
    );
    hedged++;
  }

  return json({ ok: true, scanned: candidates.length, hedged });
});