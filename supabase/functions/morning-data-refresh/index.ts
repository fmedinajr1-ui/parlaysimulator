import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const startTime = Date.now();
  const log = (msg: string) => console.log(`[morning-data-refresh] ${msg}`);
  const results: Record<string, { status: string; duration_ms: number }> = {};

  const invokeStep = async (label: string, fnName: string, body: object = {}) => {
    const stepStart = Date.now();
    log(`▶ ${label}`);
    try {
      const { error } = await supabase.functions.invoke(fnName, { body });
      const dur = Date.now() - stepStart;
      if (error) {
        log(`⚠ ${label} error (${dur}ms): ${JSON.stringify(error)}`);
        results[fnName] = { status: `error: ${error.message || JSON.stringify(error)}`, duration_ms: dur };
      } else {
        log(`✅ ${label} done (${dur}ms)`);
        results[fnName] = { status: "ok", duration_ms: dur };
      }
    } catch (e) {
      const dur = Date.now() - stepStart;
      log(`❌ ${label} exception (${dur}ms): ${e.message}`);
      results[fnName] = { status: `exception: ${e.message}`, duration_ms: dur };
    }
  };

  try {
    log("=== MORNING DATA REFRESH — ALL SPORTS ===");

    // 1. NBA
    await invokeStep("NBA game logs (ESPN, 5d back)", "nba-stats-fetcher", {
      mode: "sync", daysBack: 5, useESPN: true, includeParlayPlayers: true,
    });

    // 2. NHL
    await invokeStep("NHL game logs", "nhl-stats-fetcher", {});

    // 3. MLB (current season game logs)
    await invokeStep("MLB game logs (ESPN)", "mlb-data-ingestion", { days_back: 3, fetch_all: true });

    const totalDuration = Date.now() - startTime;
    const allOk = Object.values(results).every((r) => r.status === "ok");
    const failedSteps = Object.entries(results).filter(([, r]) => r.status !== "ok");

    log(`=== COMPLETE (${totalDuration}ms) — ${allOk ? "ALL OK" : `${failedSteps.length} FAILED`} ===`);

    // Log to cron_job_history
    await supabase.from("cron_job_history").insert({
      job_name: "morning-data-refresh",
      status: allOk ? "completed" : "partial",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: totalDuration,
      result: results,
    });

    // Telegram summary
    const statusLines = Object.entries(results).map(([fn, r]) =>
      `${r.status === "ok" ? "✅" : "❌"} ${fn} (${(r.duration_ms / 1000).toFixed(1)}s)`
    );
    const telegramMsg = [
      `☀️ *Morning Data Refresh*`,
      `${allOk ? "✅ All 3 sports refreshed" : `⚠️ ${failedSteps.length} sport(s) failed`}`,
      ``,
      ...statusLines,
      ``,
      `⏱ Total: ${(totalDuration / 1000).toFixed(1)}s`,
    ].join("\n");

    try {
      await supabase.functions.invoke("bot-send-telegram", {
        body: { message: telegramMsg, parse_mode: "Markdown", admin_only: true },
      });
    } catch (tgErr) {
      log(`Telegram notify failed: ${tgErr.message}`);
    }

    return new Response(JSON.stringify({ success: true, allOk, results, duration_ms: totalDuration }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    log(`Fatal error: ${err.message}`);
    return new Response(JSON.stringify({ success: false, error: err.message, results }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
