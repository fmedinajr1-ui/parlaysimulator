// Daily admin digest for MLB Fair-Price v1 measurement phase.
// Sends an admin-only Telegram summarizing fill rate + realized hit rate
// from mlb_fair_price_events over the last 24h (and a 7d rollup).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildFairPriceAdminPayload } from "../_shared/mlb-fair-price/alert-payload.ts";
import { etDateShort } from "../_shared/date-et.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Row {
  gate_decision: string;
  skip_reason: string | null;
  telegram_sent: boolean;
  edge: number | null;
  ev_pct: number | null;
  realized_hit: boolean | null;
  outcome_attached_at: string | null;
  closing_attached_at: string | null;
  clv_pct: number | null;
}

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return ((n / d) * 100).toFixed(1) + "%";
}

function summarize(rows: Row[], label: string): string {
  const total = rows.length;
  const fires = rows.filter((r) => r.gate_decision === "fire");
  const sent = fires.filter((r) => r.telegram_sent).length;
  const resolved = fires.filter((r) => r.outcome_attached_at && r.realized_hit !== null);
  const hits = resolved.filter((r) => r.realized_hit).length;
  const avgEdge = fires.length
    ? (fires.reduce((s, r) => s + (r.edge ?? 0), 0) / fires.length * 100).toFixed(2) + "%"
    : "—";
  const avgEv = fires.length
    ? (fires.reduce((s, r) => s + (r.ev_pct ?? 0), 0) / fires.length * 100).toFixed(2) + "%"
    : "—";

  const clvFires = fires.filter((r) => r.clv_pct != null) as (Row & { clv_pct: number })[];
  const avgClv = clvFires.length
    ? (clvFires.reduce((s, r) => s + r.clv_pct, 0) / clvFires.length * 100).toFixed(2) + "%"
    : "—";
  const posClv = clvFires.length
    ? pct(clvFires.filter((r) => r.clv_pct > 0).length, clvFires.length)
    : "—";
  const missingClosing = fires.filter((r) => r.outcome_attached_at && !r.closing_attached_at).length;

  const skips: Record<string, number> = {};
  for (const r of rows) {
    if (r.gate_decision === "skip" && r.skip_reason) {
      skips[r.skip_reason] = (skips[r.skip_reason] ?? 0) + 1;
    }
  }
  const skipLines = Object.entries(skips)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `   • \`${k}\`: ${v}`)
    .join("\n");

  return [
    `*${label}*`,
    `Evaluations: ${total} · FIRE: ${fires.length} · SKIP: ${total - fires.length}`,
    `Fill rate (sent/fire): ${pct(sent, fires.length)}`,
    `Realized hit rate: ${pct(hits, resolved.length)} (${resolved.length} resolved)`,
    `Avg edge: ${avgEdge} · Avg EV: ${avgEv}`,
    `CLV: avg ${avgClv} · positive ${posClv} (${clvFires.length} graded)`,
    `Closing line missing on ${missingClosing} resolved fires`,
    skipLines ? `Top skip reasons:\n${skipLines}` : "",
  ].filter(Boolean).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const since24 = new Date(Date.now() - 24 * 3600_000).toISOString();
  const since7d = new Date(Date.now() - 7 * 86400_000).toISOString();

  const { data, error } = await supabase
    .from("mlb_fair_price_events")
    .select("gate_decision, skip_reason, telegram_sent, edge, ev_pct, realized_hit, outcome_attached_at, closing_attached_at, clv_pct, created_at")
    .gte("created_at", since7d);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rows7d = (data ?? []) as (Row & { created_at: string })[];
  const rows24 = rows7d.filter((r) => r.created_at >= since24);

  const body = [
    `📊 *MLB Fair-Price v1 — Daily Digest*`,
    `_${etDateShort()} · measurement mode (WARN-only, uncalibrated WP)_`,
    ``,
    summarize(rows24, "Last 24h"),
    ``,
    summarize(rows7d, "Last 7d"),
    ``,
    `_Goal: ≥2 weeks of FIRE events with attached outcomes before refitting WP coefficients._`,
  ].join("\n");

  const payload = buildFairPriceAdminPayload(body);
  const tgRes = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/bot-send-telegram`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify(payload),
    },
  );
  const tgJson = await tgRes.json().catch(() => ({}));

  return new Response(JSON.stringify({
    ok: true,
    rows_24h: rows24.length,
    rows_7d: rows7d.length,
    telegram: tgJson,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});