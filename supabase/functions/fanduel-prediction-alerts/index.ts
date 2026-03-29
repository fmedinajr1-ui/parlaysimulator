import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const log = (msg: string) => console.log(`[Prediction Alerts] ${msg}`);
  const now = new Date();

  try {
    log("=== Generating FanDuel prediction alerts ===");

    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
    const { data: recentData, error: fetchErr } = await supabase
      .from("fanduel_line_timeline")
      .select("*")
      .gte("snapshot_time", thirtyMinAgo)
      .order("snapshot_time", { ascending: true })
      .limit(3000);

    if (fetchErr) throw new Error(`Timeline fetch: ${fetchErr.message}`);

    const { data: patterns } = await supabase
      .from("fanduel_behavior_patterns")
      .select("*")
      .gte("sample_size", 3);

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: accuracyData } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("signal_type, was_correct")
      .gte("created_at", sevenDaysAgo)
      .not("was_correct", "is", null);

    const accuracyMap = new Map<string, { correct: number; total: number }>();
    for (const row of accuracyData || []) {
      const key = row.signal_type;
      if (!accuracyMap.has(key)) accuracyMap.set(key, { correct: 0, total: 0 });
      const entry = accuracyMap.get(key)!;
      entry.total++;
      if (row.was_correct) entry.correct++;
    }

    const getThreshold = (signalType: string): number => {
      const acc = accuracyMap.get(signalType);
      if (!acc || acc.total < 10) return 65;
      const rate = acc.correct / acc.total;
      if (rate > 0.6) return 55;
      if (rate < 0.4) return 80;
      return 65;
    };

    if (!recentData || recentData.length === 0) {
      log("No recent data for alerts");
      return new Response(JSON.stringify({ success: true, alerts: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Exclude finished games — only pregame + live get alerts
    const activeData = recentData.filter((r: any) =>
      typeof r.hours_to_tip !== "number" || r.hours_to_tip > -3
    );
    const excluded = recentData.length - activeData.length;
    log(`Filtered to ${activeData.length} active records (excluded ${excluded} finished games)`);

    const esc = (s: string) => (s || "").replace(/_/g, " ").replace(/\*/g, "");

    // ====== ANALYZE A TIER ======
    const analyzeTier = (data: any[], tierLabel: string) => {
      if (data.length === 0) return { alerts: [] as string[], records: [] as any[] };

      const groups = new Map<string, any[]>();
      for (const row of data) {
        const key = `${row.event_id}|${row.player_name}|${row.prop_type}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      }

      const bestSignalPerPlayer = new Map<string, { confidence: number; alert: string; record: any }>();
      const addSignal = (playerKey: string, confidence: number, alert: string, record: any) => {
        const existing = bestSignalPerPlayer.get(playerKey);
        if (!existing || confidence > existing.confidence) {
          bestSignalPerPlayer.set(playerKey, { confidence, alert, record });
        }
      };

      const tierTag = tierLabel === "LIVE" ? "🔴 LIVE" : tierLabel === "POSTGAME" ? "📋 RECAP" : "📡 PRE";
      const isActionable = tierLabel !== "POSTGAME";

      // SIGNAL 1: LINE ABOUT TO MOVE / LINE MOVING NOW
      const velocityThreshold = getThreshold("velocity_spike");
      for (const [key, snapshots] of groups) {
        if (snapshots.length < 2) continue;
        const first = snapshots[0];
        const last = snapshots[snapshots.length - 1];
        const timeDiffMin = (new Date(last.snapshot_time).getTime() - new Date(first.snapshot_time).getTime()) / 60000;
        if (timeDiffMin < 5) continue;

        const lineDiff = last.line - first.line;
        const absLineDiff = Math.abs(lineDiff);
        const velocityPerHour = (absLineDiff / timeDiffMin) * 60;

        const learnedPattern = (patterns || []).find(
          (p: any) => p.sport === first.sport && p.prop_type === first.prop_type && p.pattern_type === "velocity_spike"
        );
        const learnedAvgVelocity = learnedPattern?.velocity_threshold || 2.0;
        const isAboveNorm = velocityPerHour > learnedAvgVelocity * 0.8;

        if (velocityPerHour >= 1.5 && isAboveNorm) {
          const direction = lineDiff < 0 ? "DROPPING" : "RISING";
          const side = lineDiff < 0 ? "OVER" : "UNDER";
          const confidence = Math.min(92, 50 + velocityPerHour * 12);

          if (confidence >= (isActionable ? velocityThreshold : 80)) {
            const actionLabel = tierLabel === "LIVE"
              ? `🔮 *LINE MOVING NOW* [${tierTag}]`
              : tierLabel === "POSTGAME"
              ? `📝 *LINE MOVED* [${tierTag}]`
              : `🔮 *LINE ABOUT TO MOVE* [${tierTag}]`;

            const avgReaction = learnedPattern?.avg_reaction_time_minutes || 12;
            const elapsed = Math.round(timeDiffMin);
            const remaining = Math.max(0, avgReaction - elapsed);
            const reason = direction === "DROPPING"
              ? "Line dropping = book expects fewer, value is OVER"
              : "Line rising = book expects more, value is UNDER";

            const alertParts = [
              `${actionLabel} — ${esc(first.sport)}`,
              `${esc(first.player_name)} ${esc(first.prop_type).replace("player ", "").toUpperCase()}`,
              `Line ${direction}: ${first.line} → ${last.line}`,
              `Speed: ${velocityPerHour.toFixed(1)}/hr over ${elapsed}min`,
            ];
            if (isActionable) {
              alertParts.push(`⏱ ${tierLabel === "LIVE" ? "In-game shift" : `FanDuel avg reaction: ~${remaining}min remaining`}`);
              alertParts.push(`📊 Confidence: ${Math.round(confidence)}%`);
              alertParts.push(`✅ *Action: ${side} ${last.line}*`);
              alertParts.push(`💡 ${reason}`);
            } else {
              alertParts.push(`📊 Confidence: ${Math.round(confidence)}%`);
              alertParts.push(`📝 *Movement recorded for learning*`);
            }

            const record = {
              signal_type: tierLabel === "LIVE" ? "live_line_moving" : tierLabel === "POSTGAME" ? "postgame_recap" : "line_about_to_move",
              sport: first.sport, prop_type: first.prop_type,
              player_name: first.player_name, event_id: first.event_id,
              prediction: `${side} ${last.line}`,
              predicted_direction: direction.toLowerCase(),
              predicted_magnitude: absLineDiff,
              confidence_at_signal: confidence,
              velocity_at_signal: velocityPerHour,
              time_to_tip_hours: last.hours_to_tip,
              edge_at_signal: absLineDiff,
              signal_factors: { velocityPerHour, timeDiffMin, lineDiff, learnedAvgVelocity, tier: tierLabel },
            };

            const playerKey = `${first.event_id}|${first.player_name}`;
            addSignal(playerKey, confidence, alertParts.join("\n"), record);
          }
        }
      }

      // SIGNAL 2: TAKE IT NOW / LIVE DRIFT (Snapback)
      const snapbackThreshold = getThreshold("snapback");
      for (const [key, snapshots] of groups) {
        const last = snapshots[snapshots.length - 1];
        if (!last.opening_line) continue;
        const drift = last.line - last.opening_line;
        const absDrift = Math.abs(drift);
        const driftPct = (absDrift / last.opening_line) * 100;

        if (driftPct >= 6) {
          const snapDirection = drift > 0 ? "UNDER" : "OVER";
          const confidence = Math.min(85, 30 + driftPct * 3);

          if (confidence >= (isActionable ? snapbackThreshold : 80)) {
            const reason = snapDirection === "UNDER"
              ? "Line inflated above open — expect snapback down"
              : "Line deflated below open — expect snapback up";

            const label = tierLabel === "LIVE"
              ? `💰 *LIVE DRIFT* [${tierTag}]`
              : tierLabel === "POSTGAME"
              ? `📝 *DRIFT RECORDED* [${tierTag}]`
              : `💰 *TAKE IT NOW* [${tierTag}]`;

            const alertParts = [
              `${label} — ${esc(last.sport)}`,
              `${esc(last.player_name)} ${esc(last.prop_type).replace("player ", "").toUpperCase()}`,
              `Open: ${last.opening_line} → Now: ${last.line}`,
              `Drift: ${driftPct.toFixed(1)}%`,
              `📊 Confidence: ${Math.round(confidence)}%`,
            ];
            if (isActionable) {
              alertParts.push(`✅ *Action: ${snapDirection} ${last.line}*`);
              alertParts.push(`💡 ${reason}`);
            } else {
              alertParts.push(`📝 *Drift recorded for learning*`);
            }

            const record = {
              signal_type: tierLabel === "LIVE" ? "live_drift" : tierLabel === "POSTGAME" ? "postgame_drift" : "take_it_now",
              sport: last.sport, prop_type: last.prop_type,
              player_name: last.player_name, event_id: last.event_id,
              prediction: `${snapDirection} ${last.line}`,
              predicted_direction: "snapback",
              predicted_magnitude: absDrift,
              confidence_at_signal: confidence,
              time_to_tip_hours: last.hours_to_tip,
              edge_at_signal: driftPct,
              signal_factors: { openingLine: last.opening_line, currentLine: last.line, driftPct, tier: tierLabel },
            };

            const playerKey = `${last.event_id}|${last.player_name}`;
            addSignal(playerKey, confidence, alertParts.join("\n"), record);
          }
        }
      }

      // SIGNAL 3: TRAP WARNING (pregame + live only)
      if (isActionable) {
        for (const [key, snapshots] of groups) {
          if (snapshots.length < 3) continue;
          const mid = snapshots[Math.floor(snapshots.length / 2)];
          const first = snapshots[0];
          const last = snapshots[snapshots.length - 1];
          const firstHalfDir = mid.line - first.line;
          const secondHalfDir = last.line - mid.line;

          if (
            Math.abs(firstHalfDir) >= 0.5 &&
            Math.abs(secondHalfDir) >= 0.5 &&
            Math.sign(firstHalfDir) !== Math.sign(secondHalfDir)
          ) {
            const alertText = [
              `⚠️ *TRAP WARNING* [${tierTag}] — ${esc(first.sport)}`,
              `${esc(first.player_name)} ${esc(first.prop_type).replace("player ", "").toUpperCase()}`,
              `Line reversed: ${first.line} → ${mid.line} → ${last.line}`,
              `🚫 Sharp reversal pattern — DO NOT TOUCH`,
              `✅ *Action: STAY AWAY — both sides are dangerous*`,
              `💡 Book is manipulating this line to trap bettors`,
            ].join("\n");

            const record = {
              signal_type: "trap_warning",
              sport: first.sport, prop_type: first.prop_type,
              player_name: first.player_name, event_id: first.event_id,
              prediction: "TRAP — avoid",
              predicted_direction: "reversal",
              predicted_magnitude: Math.abs(firstHalfDir) + Math.abs(secondHalfDir),
              confidence_at_signal: 75,
              time_to_tip_hours: last.hours_to_tip,
              signal_factors: { firstLine: first.line, midLine: mid.line, lastLine: last.line, tier: tierLabel },
            };

            const playerKey = `${first.event_id}|${first.player_name}`;
            bestSignalPerPlayer.set(playerKey, { confidence: 99, alert: alertText, record });
          }
        }
      }

      const results: { alert: string; record: any }[] = [];
      for (const v of bestSignalPerPlayer.values()) results.push(v);
      return {
        alerts: results.map((r) => r.alert),
        records: results.map((r) => r.record),
      };
    };

    // Run on all three tiers
    const pregameResult = analyzeTier(pregameData, "PREGAME");
    const liveResult = analyzeTier(liveData, "LIVE");
    const finishedResult = analyzeTier(finishedData, "POSTGAME");

    // Store prediction records (pregame + live only)
    const allRecords = [...pregameResult.records, ...liveResult.records];
    if (allRecords.length > 0) {
      const { error } = await supabase.from("fanduel_prediction_accuracy").insert(allRecords);
      if (error) log(`⚠ Prediction insert error: ${error.message}`);
    }

    // Send Telegram per tier
    const sendAlerts = async (alerts: string[], tierName: string, emoji: string) => {
      if (alerts.length === 0) return;
      const MAX_CHARS = 3800;
      const pages: string[][] = [];
      let currentPage: string[] = [];
      let currentLen = 0;

      for (const alert of alerts) {
        const alertLen = alert.length + 2;
        if (currentPage.length > 0 && currentLen + alertLen > MAX_CHARS) {
          pages.push(currentPage);
          currentPage = [];
          currentLen = 0;
        }
        currentPage.push(alert);
        currentLen += alertLen;
      }
      if (currentPage.length > 0) pages.push(currentPage);

      for (let i = 0; i < pages.length; i++) {
        const pageLabel = pages.length > 1 ? ` (${i + 1}/${pages.length})` : "";
        const header = i === 0
          ? [`${emoji} *FanDuel ${tierName}*${pageLabel}`, `${alerts.length} signal(s)`, ""]
          : [`${emoji} *${tierName}${pageLabel}*`, ""];

        const msg = [...header, ...pages[i]].join("\n\n");
        try {
          await supabase.functions.invoke("bot-send-telegram", {
            body: { message: msg, parse_mode: "Markdown", admin_only: true },
          });
        } catch (tgErr: any) {
          log(`Telegram error ${tierName}: ${tgErr.message}`);
        }
      }
    };

    await sendAlerts(pregameResult.alerts, "Pregame Predictions", "🎯");
    await sendAlerts(liveResult.alerts, "🔴 Live Predictions", "🔴");
    // Only send postgame recap if there are significant movements
    if (finishedResult.alerts.length > 0) {
      await sendAlerts(finishedResult.alerts, "Post-Game Recap", "📋");
    }

    const totalAlerts = pregameResult.alerts.length + liveResult.alerts.length + finishedResult.alerts.length;
    log(`=== ALERTS COMPLETE: ${totalAlerts} total (pre:${pregameResult.alerts.length} live:${liveResult.alerts.length} post:${finishedResult.alerts.length}) ===`);

    await supabase.from("cron_job_history").insert({
      job_name: "fanduel-prediction-alerts",
      status: "completed",
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(),
      result: {
        total: totalAlerts,
        pregame: pregameResult.alerts.length,
        live: liveResult.alerts.length,
        postgame: finishedResult.alerts.length,
      },
    });

    return new Response(
      JSON.stringify({ success: true, alerts: totalAlerts }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    log(`❌ Fatal: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
