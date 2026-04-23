// @ts-nocheck
// Polls Telegram getUpdates via the connector gateway, then forwards each
// update to the telegram-prop-scanner edge function for handling.
// Designed to be invoked every minute by pg_cron; long-polls for ~50s per
// iteration and runs for a max of ~55s per invocation so calls don't overlap.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";
const MAX_RUNTIME_MS = 55_000;
const MIN_REMAINING_MS = 5_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing_env", details: {
        LOVABLE_API_KEY: !!LOVABLE_API_KEY,
        TELEGRAM_API_KEY: !!TELEGRAM_API_KEY,
        SUPABASE_URL: !!SUPABASE_URL,
        SERVICE_ROLE: !!SERVICE_ROLE,
      }}),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Read offset
  const { data: state, error: stateErr } = await supabase
    .from("telegram_bot_state")
    .select("update_offset")
    .eq("id", 1)
    .single();
  if (stateErr) {
    return new Response(JSON.stringify({ ok: false, error: stateErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let currentOffset: number = Number(state?.update_offset ?? 0);
  let totalProcessed = 0;
  let iterations = 0;
  const handlerUrl = `${SUPABASE_URL}/functions/v1/telegram-prop-scanner`;

  while (true) {
    const elapsed = Date.now() - startedAt;
    const remainingMs = MAX_RUNTIME_MS - elapsed;
    if (remainingMs < MIN_REMAINING_MS) break;
    const timeout = Math.min(50, Math.floor(remainingMs / 1000) - 5);
    if (timeout < 1) break;

    iterations++;

    let updates: any[] = [];
    try {
      const res = await fetch(`${GATEWAY_URL}/getUpdates`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": TELEGRAM_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          offset: currentOffset,
          timeout,
          allowed_updates: ["message", "edited_message", "callback_query"],
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        console.error("[telegram-poll] getUpdates failed", res.status, data);
        return new Response(
          JSON.stringify({ ok: false, error: "getUpdates_failed", status: res.status, data }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      updates = Array.isArray(data.result) ? data.result : [];
    } catch (e) {
      console.error("[telegram-poll] network error", e);
      break;
    }

    if (updates.length === 0) continue;

    // Dispatch each update to the existing handler. Run them sequentially to
    // keep ordering stable per chat.
    for (const update of updates) {
      try {
        await fetch(handlerUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_ROLE}`,
          },
          body: JSON.stringify(update),
        });
      } catch (e) {
        console.error("[telegram-poll] handler dispatch failed", e);
      }
    }

    totalProcessed += updates.length;

    // Advance offset only after we've dispatched everything
    const maxId = Math.max(...updates.map((u: any) => Number(u.update_id)));
    const newOffset = maxId + 1;
    const { error: offsetErr } = await supabase
      .from("telegram_bot_state")
      .update({ update_offset: newOffset, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (offsetErr) {
      console.error("[telegram-poll] failed to persist offset", offsetErr);
      return new Response(JSON.stringify({ ok: false, error: offsetErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    currentOffset = newOffset;
  }

  return new Response(
    JSON.stringify({ ok: true, processed: totalProcessed, iterations, finalOffset: currentOffset, durationMs: Date.now() - startedAt }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});