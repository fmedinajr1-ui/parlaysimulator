import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALERT_KEY = "soccer_sharp_ingest_retry";
const WINDOW_MINUTES = 30;
const FRESHNESS_MINUTES = 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const now = new Date();

  // 1) Already have fresh sharp rows? Stop the loop.
  const freshCutoff = new Date(now.getTime() - FRESHNESS_MINUTES * 60_000).toISOString();
  const { count: freshRows } = await supabase
    .from("soccer_sharp_lines")
    .select("id", { count: "exact", head: true })
    .gte("updated_at", freshCutoff);

  if ((freshRows ?? 0) > 0) {
    await supabase.from("admin_alert_state").upsert({
      alert_key: ALERT_KEY,
      status: "satisfied",
      last_sent_at: now.toISOString(),
      payload: { fresh_rows: freshRows },
      updated_at: now.toISOString(),
    });
    return new Response(
      JSON.stringify({ ok: true, skipped: "fresh_rows_present", fresh_rows: freshRows }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // 2) Load / init retry window state.
  const { data: state } = await supabase
    .from("admin_alert_state")
    .select("*")
    .eq("alert_key", ALERT_KEY)
    .maybeSingle();

  const payload = (state?.payload ?? {}) as Record<string, unknown>;
  let windowStart = typeof payload.window_start === "string" ? new Date(payload.window_start) : null;
  // If the previous window already concluded (satisfied/timeout) and is older than the window, restart it.
  if (
    !windowStart ||
    state?.status === "satisfied" ||
    state?.status === "timeout" ||
    now.getTime() - windowStart.getTime() > WINDOW_MINUTES * 60_000
  ) {
    windowStart = now;
  }

  const elapsedMin = (now.getTime() - windowStart.getTime()) / 60_000;
  if (elapsedMin > WINDOW_MINUTES) {
    await supabase.from("admin_alert_state").upsert({
      alert_key: ALERT_KEY,
      status: "timeout",
      last_sent_at: now.toISOString(),
      payload: { ...payload, window_start: windowStart.toISOString(), elapsed_min: elapsedMin },
      updated_at: now.toISOString(),
    });
    return new Response(
      JSON.stringify({ ok: true, skipped: "timeout", elapsed_min: elapsedMin }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // 3) Invoke the ingest.
  const { data: ingest, error } = await supabase.functions.invoke("soccer-sharp-ingest", {
    body: {},
  });

  const attempts = (typeof payload.attempts === "number" ? payload.attempts : 0) + 1;
  const sharpRows = (ingest as any)?.stats?.sharpRows ?? 0;

  await supabase.from("admin_alert_state").upsert({
    alert_key: ALERT_KEY,
    status: sharpRows > 0 ? "satisfied" : "retrying",
    last_sent_at: now.toISOString(),
    payload: {
      window_start: windowStart.toISOString(),
      attempts,
      last_stats: (ingest as any)?.stats ?? null,
      last_error: error?.message ?? null,
    },
    updated_at: now.toISOString(),
  });

  return new Response(
    JSON.stringify({
      ok: !error,
      attempts,
      elapsed_min: elapsedMin,
      sharp_rows: sharpRows,
      stats: (ingest as any)?.stats ?? null,
      error: error?.message ?? null,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});