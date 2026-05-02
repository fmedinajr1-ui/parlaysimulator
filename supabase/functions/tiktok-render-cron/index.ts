// @ts-nocheck
// Auto-cron driver for the TikTok Remotion render pipeline.
// Calls tiktok-render-orchestrator with empty body, which auto-picks the next
// approved script from the queue and dispatches it to the Remotion worker.
// Scheduled via pg_cron every 5 minutes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  const startedAt = Date.now();

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/tiktok-render-orchestrator`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));

    // Log run for observability — non-fatal if pipeline_runs schema differs.
    try {
      await sb.from("pipeline_runs").insert({
        run_type: "tiktok_render_cron",
        status: res.ok ? "success" : "error",
        message: data?.message ?? data?.error ?? `HTTP ${res.status}`,
        duration_ms: Date.now() - startedAt,
        metadata: { script_id: data?.script_id ?? null, render_id: data?.render_id ?? null, step: data?.step ?? null },
      });
    } catch (_) { /* ignore */ }

    return new Response(
      JSON.stringify({ ok: res.ok, orchestrator: data, durationMs: Date.now() - startedAt }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[tiktok-render-cron] failed", e);
    return new Response(
      JSON.stringify({ ok: false, error: e?.message ?? String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});