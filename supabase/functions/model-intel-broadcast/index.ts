// model-intel-broadcast
// Pull today's top model_predictions, render the AI Models Intelligence digest,
// and send via bot-send-telegram. Idempotent per (date_et, channel).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { etDateKey, etDateLong } from "../_shared/date-et.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHANNEL = "ai_models_intelligence";

function fmtElo(r: any): string {
  const side = r.side === "home" ? "Home" : "Away";
  return `• ${r.game_description} — *${side} ML* @ ${r.current_line ?? "?"} · ${r.edge_pct.toFixed(1)}% edge (${(r.prob * 100).toFixed(1)}%)`;
}
function fmtTotal(r: any): string {
  const side = r.side === "over" ? "Over" : "Under";
  return `• ${r.game_description} — *${side} ${r.current_line}* · ${r.edge_pct.toFixed(1)}% edge (${(r.prob * 100).toFixed(1)}%)`;
}
function fmtProp(r: any): string {
  const side = r.side === "over" ? "Over" : "Under";
  return `• ${r.player_name} — ${side} ${r.current_line} ${r.prop_type} · ${r.edge_pct.toFixed(1)}% edge (${(r.prob * 100).toFixed(1)}%)`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;
    const dateKey = etDateKey();

    // idempotency: skip if already broadcast today (unless dry run)
    if (!dryRun) {
      const { data: existing } = await supabase
        .from("model_intel_telegram_log")
        .select("id, status")
        .eq("date_et", dateKey).eq("channel", CHANNEL).maybeSingle();
      if (existing && existing.status === "sent") {
        return new Response(JSON.stringify({ success: true, skipped: "already_sent", date_et: dateKey }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: preds, error } = await supabase
      .from("model_predictions")
      .select("*")
      .eq("game_date_et", dateKey)
      .eq("has_real_line", true)
      .order("edge_pct", { ascending: false });
    if (error) throw new Error(`predictions: ${error.message}`);

    const elo = (preds ?? []).filter((r: any) => r.model === "elo").slice(0, 5);
    const totals = (preds ?? []).filter((r: any) => r.model === "poisson").slice(0, 3);
    const props = (preds ?? []).filter((r: any) => r.model === "xgb_prop").slice(0, 5);

    const totalIncluded = elo.length + totals.length + props.length;

    const sections: string[] = [];
    sections.push(`🤖 *AI Models Intelligence*\n${etDateLong()}`);
    if (elo.length) sections.push(`\n📊 *Elo Top Moneyline Edges*\n${elo.map(fmtElo).join("\n")}`);
    if (totals.length) sections.push(`\n🎯 *Poisson Totals Edges*\n${totals.map(fmtTotal).join("\n")}`);
    if (props.length) sections.push(`\n🧠 *XGBoost Prop Edges*\n${props.map(fmtProp).join("\n")}`);
    if (totalIncluded === 0) sections.push(`\n_No qualifying edges today. Models will reassess tomorrow._`);
    sections.push(`\n_Isolated ROI tracking — separate from Gold/Sweet Spot streams._`);

    const message = sections.join("\n");

    if (dryRun) {
      return new Response(JSON.stringify({ success: true, dry_run: true, predictions_included: totalIncluded, message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: sendResp, error: sendErr } = await supabase.functions.invoke("bot-send-telegram", {
      body: { message, parse_mode: "Markdown", admin_only: false, type: "ai_models_intelligence" },
    });
    if (sendErr) throw new Error(`telegram send: ${sendErr.message}`);

    await supabase.from("model_intel_telegram_log").upsert([{
      date_et: dateKey, channel: CHANNEL,
      message_text: message,
      predictions_included: totalIncluded,
      telegram_message_id: sendResp?.message_id ?? null,
      status: sendResp?.success ? "sent" : "failed",
      error: sendResp?.success ? null : (sendResp?.error ?? "unknown"),
    }], { onConflict: "date_et,channel" });

    return new Response(JSON.stringify({ success: true, predictions_included: totalIncluded, telegram: sendResp }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[model-intel-broadcast] fatal", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});