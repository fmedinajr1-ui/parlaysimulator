import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

async function sendTelegram(text: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID") || Deno.env.get("TELEGRAM_GROUP_CHAT_ID");

  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY || !chatId) {
    console.log("[PostAlertMonitor] Telegram not configured, skipping alert");
    return;
  }

  try {
    const resp = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TELEGRAM_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[PostAlertMonitor] Telegram send failed: ${err}`);
    }
  } catch (e) {
    console.error(`[PostAlertMonitor] Telegram error: ${e}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const log = (msg: string) => console.log(`[PostAlertMonitor] ${msg}`);
  const now = new Date();

  try {
    log("=== Starting post-alert line monitoring ===");

    // Get unsettled Take It Now predictions from last 12 hours that have alert timestamps
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
    const { data: activePredictions, error: fetchErr } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("*")
      .is("was_correct", null)
      .eq("signal_type", "take_it_now")
      .not("alert_sent_at", "is", null)
      .gte("alert_sent_at", twelveHoursAgo)
      .order("alert_sent_at", { ascending: false })
      .limit(100);

    if (fetchErr) throw new Error(`Fetch active predictions: ${fetchErr.message}`);
    log(`Found ${activePredictions?.length || 0} active Take It Now signals to monitor`);

    if (!activePredictions || activePredictions.length === 0) {
      return new Response(JSON.stringify({ success: true, monitored: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let reversals = 0;
    let upgrades = 0;
    let stable = 0;

    for (const pred of activePredictions) {
      const alertTime = pred.alert_sent_at;
      const alertLine = pred.line_at_alert || pred.predicted_line;
      const sf = pred.signal_factors || {};
      const openingLine = sf.opening_line || alertLine;
      const driftAtAlert = pred.drift_pct_at_alert || 0;
      const previousStatus = pred.recommendation_status || "ACTIVE";

      // Skip if already sent a reversal alert (dedup)
      if (previousStatus === "REVERSED" || previousStatus === "DEAD") {
        continue;
      }

      // Query timeline snapshots AFTER the alert was sent
      const { data: postAlertSnapshots } = await supabase
        .from("fanduel_line_timeline")
        .select("line, snapshot_time, over_price, under_price, drift_velocity")
        .eq("event_id", pred.event_id)
        .eq("player_name", pred.player_name)
        .eq("prop_type", pred.prop_type)
        .gt("snapshot_time", alertTime)
        .order("snapshot_time", { ascending: true })
        .limit(200);

      if (!postAlertSnapshots || postAlertSnapshots.length === 0) {
        continue; // No new data since alert
      }

      // Build trajectory
      const trajectory = postAlertSnapshots.map((snap) => ({
        line: Number(snap.line),
        time: snap.snapshot_time,
        delta_from_alert: Number(snap.line) - Number(alertLine),
        over_price: snap.over_price,
        under_price: snap.under_price,
      }));

      // Count distinct line changes
      const distinctLines = new Set(postAlertSnapshots.map((s) => Number(s.line)));
      const lineChanges = distinctLines.size;

      const currentLine = Number(postAlertSnapshots[postAlertSnapshots.length - 1].line);
      const currentOverPrice = postAlertSnapshots[postAlertSnapshots.length - 1].over_price;
      const currentUnderPrice = postAlertSnapshots[postAlertSnapshots.length - 1].under_price;

      // Determine drift direction from alert
      // driftAtAlert > 0 means line was moving UP from open
      // If current line moved BACK toward opening, that's a reversal
      const driftFromAlertToNow = currentLine - Number(alertLine);
      const driftFromOpenToAlert = Number(alertLine) - Number(openingLine);

      let newStatus = "ACTIVE";
      let alertMessage = "";

      if (Math.abs(driftFromOpenToAlert) > 0) {
        // Check if line reversed back toward opener
        const currentDriftFromOpen = currentLine - Number(openingLine);
        const alertDriftFromOpen = Number(alertLine) - Number(openingLine);

        // Reversal: current drift is <60% of alert drift (line came back >40%)
        if (
          Math.abs(alertDriftFromOpen) > 0.1 &&
          Math.abs(currentDriftFromOpen) < Math.abs(alertDriftFromOpen) * 0.6
        ) {
          newStatus = "REVERSED";
          reversals++;

          const predText = (pred.prediction || "").toUpperCase();
          const originalSide = predText.includes("OVER") || predText.includes("TAKE") ? "OVER" : "UNDER";
          const oppositeSide = originalSide === "OVER" ? "UNDER" : "OVER";
          const minutesSinceAlert = Math.round(
            (now.getTime() - new Date(alertTime).getTime()) / 60000
          );
          const reversalPct = Math.round(
            (1 - Math.abs(currentDriftFromOpen) / Math.abs(alertDriftFromOpen)) * 100
          );

          // ── AUTO-FLIP VALIDATION: Check L10 stats for opposite side ──
          let flipValidated = false;
          let flipReason = "";
          let flipL10Avg: number | null = null;
          let flipHitRate: number | null = null;

          const isTeamMarket = ["spreads", "totals", "moneyline"].includes(pred.prop_type || "");

          if (!isTeamMarket) {
            // Query unified_props for L10 data on this player+prop
            const { data: propsData } = await supabase
              .from("unified_props")
              .select("l10_avg, l10_hit_rate_over, l10_hit_rate_under, fanduel_line")
              .eq("player_name", pred.player_name)
              .eq("prop_type", pred.prop_type)
              .order("last_updated", { ascending: false })
              .limit(1);

            if (propsData && propsData.length > 0) {
              const p = propsData[0];
              flipL10Avg = p.l10_avg;
              const flipLine = currentLine;

              if (oppositeSide === "OVER") {
                flipHitRate = p.l10_hit_rate_over;
                // Validate: L10 avg should be ABOVE the line for OVER
                if (flipL10Avg != null && flipL10Avg > flipLine && (flipHitRate ?? 0) >= 0.5) {
                  flipValidated = true;
                  flipReason = `L10 avg ${flipL10Avg.toFixed(1)} > line ${flipLine} | Hit rate: ${((flipHitRate ?? 0) * 100).toFixed(0)}%`;
                }
              } else {
                flipHitRate = p.l10_hit_rate_under;
                // Validate: L10 avg should be BELOW the line for UNDER
                if (flipL10Avg != null && flipL10Avg < flipLine && (flipHitRate ?? 0) >= 0.5) {
                  flipValidated = true;
                  flipReason = `L10 avg ${flipL10Avg.toFixed(1)} < line ${flipLine} | Hit rate: ${((flipHitRate ?? 0) * 100).toFixed(0)}%`;
                }
              }
            }
          }

          // Build alert message
          const flipBlock = flipValidated
            ? [
                ``,
                `✅ *FLIP VALIDATED: ${oppositeSide} ${currentLine}*`,
                `📊 ${flipReason}`,
                `💡 Opposite side has statistical edge — consider flipping`,
              ].join("\n")
            : Math.abs(currentDriftFromOpen) > 0.1
            ? `\n⚠️ Flip to ${oppositeSide} ${currentLine} possible but *NOT confirmed* by L10 data`
            : "";

          alertMessage = [
            `⚠️ *LINE REVERSED* — Take It Now Update`,
            ``,
            `🔄 ${pred.player_name} ${originalSide} ${alertLine} ${pred.prop_type}`,
            `📗 Line moved: ${alertLine} → ${currentLine} (${lineChanges} changes in ${minutesSinceAlert}min)`,
            `📊 Reversed ${reversalPct}% back toward opener (${openingLine})`,
            `❌ Original recommendation NO LONGER VALID`,
            flipBlock,
            ``,
            `_Odds: O ${currentOverPrice || "N/A"} / U ${currentUnderPrice || "N/A"}_`,
          ]
            .filter(Boolean)
            .join("\n");
        }
        // Upgraded: line kept drifting in same direction (edge grew)
        else if (
          Math.sign(currentDriftFromOpen) === Math.sign(alertDriftFromOpen) &&
          Math.abs(currentDriftFromOpen) > Math.abs(alertDriftFromOpen) * 1.2
        ) {
          newStatus = "UPGRADED";
          upgrades++;
          // Don't send alert for upgrades, just track
        }
        // Stable
        else {
          stable++;
        }
      } else {
        stable++;
      }

      // Update prediction record
      const updateData: Record<string, any> = {
        line_changes_after_alert: lineChanges,
        line_trajectory: trajectory,
        recommendation_status: newStatus,
      };

      if (newStatus !== previousStatus) {
        updateData.recommendation_updated_at = now.toISOString();
      }

      await supabase
        .from("fanduel_prediction_accuracy")
        .update(updateData)
        .eq("id", pred.id);

      // Send Telegram alert for reversals (only once per prediction)
      if (newStatus === "REVERSED" && alertMessage) {
        await sendTelegram(alertMessage);
      }
    }

    const summary = { monitored: activePredictions.length, reversals, upgrades, stable };
    log(`Results: ${JSON.stringify(summary)}`);

    // Log to cron history
    await supabase.from("cron_job_history").insert({
      job_name: "post-alert-line-monitor",
      status: "completed",
      result: summary,
    });

    return new Response(JSON.stringify({ success: true, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    log(`ERROR: ${error}`);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
