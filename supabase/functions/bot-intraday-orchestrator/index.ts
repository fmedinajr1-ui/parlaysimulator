import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getETNow(): { hour: number; minute: number; timeStr: string; dateStr: string } {
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const etDate = new Date(etStr);
  const hour = etDate.getHours();
  const minute = etDate.getMinutes();
  const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const dateStr = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return { hour, minute, timeStr, dateStr };
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const log = (msg: string) => console.log(`[Intraday Orchestrator] ${msg}`);

  try {
    const { hour, minute, timeStr, dateStr } = getETNow();
    const currentMinutes = hour * 60 + minute;
    log(`Current ET: ${timeStr} (${dateStr})`);

    // 1. Load active schedule windows
    const { data: windows, error: winErr } = await supabase
      .from("bot_daily_schedule")
      .select("*")
      .eq("is_active", true);

    if (winErr) throw winErr;
    if (!windows || windows.length === 0) {
      log("No active schedule windows");
      return new Response(JSON.stringify({ success: true, message: "No active windows" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Find which window we're currently in
    let activeWindow = null;
    for (const w of windows) {
      const start = timeToMinutes(w.window_start_et);
      let end = timeToMinutes(w.window_end_et);
      // Handle overnight windows (e.g., 22:00 - 00:00)
      if (end <= start) end += 24 * 60;
      let check = currentMinutes;
      if (currentMinutes < start && end > 24 * 60) check += 24 * 60;
      
      if (check >= start && check < end) {
        activeWindow = w;
        break;
      }
    }

    if (!activeWindow) {
      log(`No active window at ${timeStr} — sleeping`);
      return new Response(JSON.stringify({ success: true, message: `No window active at ${timeStr}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    log(`Active window: ${activeWindow.window_name} (${activeWindow.window_start_et}-${activeWindow.window_end_et})`);

    // 3. Check if this window already ran in the last 25 minutes (avoid double-runs on 30-min cron)
    const twentyFiveMinAgo = new Date(Date.now() - 25 * 60 * 1000).toISOString();
    const { data: recentRuns } = await supabase
      .from("bot_schedule_runs")
      .select("id")
      .eq("run_date", dateStr)
      .eq("window_name", activeWindow.window_name)
      .gte("started_at", twentyFiveMinAgo)
      .limit(1);

    if (recentRuns && recentRuns.length > 0) {
      log(`Window ${activeWindow.window_name} already ran recently — skipping`);
      return new Response(JSON.stringify({ success: true, message: "Window already ran recently" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Create schedule run record
    const { data: runRecord } = await supabase
      .from("bot_schedule_runs")
      .insert({
        run_date: dateStr,
        window_name: activeWindow.window_name,
        status: "running",
        actions_executed: [],
      })
      .select("id")
      .single();

    const runId = runRecord?.id;

    // 5. Execute each action in the window
    const actions: string[] = activeWindow.actions || [];
    const results: Record<string, { status: string; duration_ms: number }> = {};
    const actionsExecuted: string[] = [];

    for (const fnName of actions) {
      const stepStart = Date.now();
      log(`▶ Running: ${fnName}`);
      try {
        const { error } = await supabase.functions.invoke(fnName, { body: { source: "intraday-orchestrator", window: activeWindow.window_name } });
        const dur = Date.now() - stepStart;
        if (error) {
          log(`⚠ ${fnName} error (${dur}ms): ${JSON.stringify(error)}`);
          results[fnName] = { status: `error: ${error.message || JSON.stringify(error)}`, duration_ms: dur };
        } else {
          log(`✅ ${fnName} done (${dur}ms)`);
          results[fnName] = { status: "ok", duration_ms: dur };
          actionsExecuted.push(fnName);
        }
      } catch (e: any) {
        const dur = Date.now() - stepStart;
        log(`❌ ${fnName} exception (${dur}ms): ${e.message}`);
        results[fnName] = { status: `exception: ${e.message}`, duration_ms: dur };
      }
    }

    // 6. Run self-audit after actions
    let auditSummary: Record<string, unknown> = {};
    try {
      const { data: auditResult, error: auditErr } = await supabase.functions.invoke("bot-self-audit", { body: {} });
      if (auditErr) {
        log(`Self-audit error: ${JSON.stringify(auditErr)}`);
        auditSummary = { status: "error", error: auditErr.message || JSON.stringify(auditErr) };
      } else {
        auditSummary = auditResult || { status: "ok" };
        log(`Self-audit: ${JSON.stringify(auditSummary)}`);
      }
    } catch (e: any) {
      log(`Self-audit exception: ${e.message}`);
      auditSummary = { status: "exception", error: e.message };
    }

    // 7. Update schedule run record
    const allOk = Object.values(results).every((r) => r.status === "ok");
    if (runId) {
      await supabase
        .from("bot_schedule_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: allOk ? "completed" : "partial",
          results,
          actions_executed: actionsExecuted,
          audit_summary: auditSummary,
        })
        .eq("id", runId);
    }

    // 8. Telegram window summary
    const failedSteps = Object.entries(results).filter(([, r]) => r.status !== "ok");
    const statusLines = Object.entries(results).map(([fn, r]) =>
      `${r.status === "ok" ? "✅" : "❌"} ${fn} (${(r.duration_ms / 1000).toFixed(1)}s)`
    );
    const auditViolations = (auditSummary as any)?.violations || 0;

    const tgMsg = [
      `📅 *${activeWindow.window_name.replace(/_/g, " ").toUpperCase()}*`,
      `${allOk ? "✅ All actions passed" : `⚠️ ${failedSteps.length} failed`}`,
      ``,
      ...statusLines,
      ``,
      `🛡️ Audit: ${auditViolations} violation(s)`,
      `⏱ Window: ${activeWindow.window_start_et}-${activeWindow.window_end_et} ET`,
    ].join("\n");

    try {
      await supabase.functions.invoke("bot-send-telegram", {
        body: { message: tgMsg, parse_mode: "Markdown", admin_only: true },
      });
    } catch (_) { /* ignore */ }

    log(`Window ${activeWindow.window_name} complete: ${actionsExecuted.length}/${actions.length} actions`);

    return new Response(JSON.stringify({
      success: true,
      window: activeWindow.window_name,
      allOk,
      results,
      audit: auditSummary,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    log(`Fatal: ${err.message}`);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
