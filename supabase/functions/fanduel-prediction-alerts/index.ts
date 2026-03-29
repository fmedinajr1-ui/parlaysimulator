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

    // Get recent timeline snapshots (last 30 min for velocity)
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
    const { data: recentData, error: fetchErr } = await supabase
      .from("fanduel_line_timeline")
      .select("*")
      .gte("snapshot_time", thirtyMinAgo)
      .order("snapshot_time", { ascending: true })
      .limit(3000);

    if (fetchErr) throw new Error(`Timeline fetch: ${fetchErr.message}`);

    // Get learned behavior patterns
    const { data: patterns } = await supabase
      .from("fanduel_behavior_patterns")
      .select("*")
      .gte("sample_size", 3);

    // Get prediction accuracy to adjust thresholds
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: accuracyData } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("signal_type, was_correct")
      .gte("created_at", sevenDaysAgo)
      .not("was_correct", "is", null);

    // Compute accuracy by signal type for threshold adjustment
    const accuracyMap = new Map<string, { correct: number; total: number }>();
    for (const row of accuracyData || []) {
      const key = row.signal_type;
      if (!accuracyMap.has(key)) accuracyMap.set(key, { correct: 0, total: 0 });
      const entry = accuracyMap.get(key)!;
      entry.total++;
      if (row.was_correct) entry.correct++;
    }

    // Dynamic confidence threshold: lower for accurate signals, higher for inaccurate ones
    const getThreshold = (signalType: string): number => {
      const acc = accuracyMap.get(signalType);
      if (!acc || acc.total < 10) return 65; // Default
      const rate = acc.correct / acc.total;
      if (rate > 0.6) return 55; // Lower threshold for proven signals
      if (rate < 0.4) return 80; // Raise threshold for poor signals
      return 65;
    };

    if (!recentData || recentData.length === 0) {
      log("No recent data for alerts");
      return new Response(JSON.stringify({ success: true, alerts: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by event+player+prop
    const groups = new Map<string, any[]>();
    for (const row of recentData) {
      const key = `${row.event_id}|${row.player_name}|${row.prop_type}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    // Also group by event+player for cross-prop
    const playerGroups = new Map<string, any[]>();
    for (const row of recentData) {
      const key = `${row.event_id}|${row.player_name}`;
      if (!playerGroups.has(key)) playerGroups.set(key, []);
      playerGroups.get(key)!.push(row);
    }

    const telegramAlerts: string[] = [];
    const predictionRecords: any[] = [];

    // ====== SIGNAL 1: LINE ABOUT TO MOVE ======
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

      // Check against learned patterns for this sport+prop
      const learnedPattern = (patterns || []).find(
        (p: any) => p.sport === first.sport && p.prop_type === first.prop_type && p.pattern_type === "velocity_spike"
      );
      const learnedAvgVelocity = learnedPattern?.velocity_threshold || 2.0;
      const isAboveNorm = velocityPerHour > learnedAvgVelocity * 0.8;

      if (velocityPerHour >= 1.5 && isAboveNorm) {
        const direction = lineDiff < 0 ? "DROPPING" : "RISING";
        const side = lineDiff < 0 ? "OVER" : "UNDER";
        const confidence = Math.min(92, 50 + velocityPerHour * 12);

        if (confidence >= velocityThreshold) {
          // Estimate remaining reaction time from learned data
          const avgReaction = learnedPattern?.avg_reaction_time_minutes || 12;
          const elapsed = Math.round(timeDiffMin);
          const remaining = Math.max(0, avgReaction - elapsed);

          const esc = (s: string) => (s || "").replace(/_/g, " ").replace(/\*/g, "");
          const reason = direction === "DROPPING"
            ? "Line dropping = book expects fewer, value is OVER"
            : "Line rising = book expects more, value is UNDER";
          telegramAlerts.push(
            [
              `🔮 *LINE ABOUT TO MOVE* — ${esc(first.sport)}`,
              `${esc(first.player_name)} ${esc(first.prop_type).replace("player ", "").toUpperCase()}`,
              `Line ${direction}: ${first.line} → ${last.line}`,
              `Speed: ${velocityPerHour.toFixed(1)}/hr over ${elapsed}min`,
              `⏱ FanDuel avg reaction: ~${remaining}min remaining`,
              `📊 Confidence: ${Math.round(confidence)}%`,
              `✅ *Action: ${side} ${last.line}*`,
              `💡 ${reason}`,
            ].join("\n")
          );

          predictionRecords.push({
            signal_type: "line_about_to_move",
            sport: first.sport,
            prop_type: first.prop_type,
            player_name: first.player_name,
            event_id: first.event_id,
            prediction: `${side} ${last.line}`,
            predicted_direction: direction.toLowerCase(),
            predicted_magnitude: absLineDiff,
            confidence_at_signal: confidence,
            velocity_at_signal: velocityPerHour,
            time_to_tip_hours: last.hours_to_tip,
            edge_at_signal: absLineDiff,
            signal_factors: { velocityPerHour, timeDiffMin, lineDiff, learnedAvgVelocity },
          });
        }
      }
    }

    // ====== SIGNAL 2: TAKE IT NOW (Snapback opportunity) ======
    const snapbackThreshold = getThreshold("snapback");
    for (const [key, snapshots] of groups) {
      const last = snapshots[snapshots.length - 1];
      if (!last.opening_line) continue;

      const drift = last.line - last.opening_line;
      const absDrift = Math.abs(drift);
      const driftPct = (absDrift / last.opening_line) * 100;

      if (driftPct >= 6 && last.hours_to_tip && last.hours_to_tip > 0.5) {
        const snapDirection = drift > 0 ? "UNDER" : "OVER";
        const confidence = Math.min(85, 30 + driftPct * 3);

        if (confidence >= snapbackThreshold) {
          const esc2 = (s: string) => (s || "").replace(/_/g, " ").replace(/\*/g, "");
          telegramAlerts.push(
            [
              `💰 *TAKE IT NOW* — ${esc2(last.sport)}`,
              `${esc2(last.player_name)} ${esc2(last.prop_type).replace("player ", "").toUpperCase()}`,
              `Open: ${last.opening_line} → Now: ${last.line}`,
              `Drift: ${driftPct.toFixed(1)}% — historically snaps back`,
              `Action: ${snapDirection} ${last.line}`,
              `Window: ~${Math.round((last.hours_to_tip || 1) * 60)}min to tip`,
              `Confidence: ${Math.round(confidence)}%`,
            ].join("\n")
          );

          predictionRecords.push({
            signal_type: "take_it_now",
            sport: last.sport,
            prop_type: last.prop_type,
            player_name: last.player_name,
            event_id: last.event_id,
            prediction: `${snapDirection} ${last.line}`,
            predicted_direction: "snapback",
            predicted_magnitude: absDrift,
            confidence_at_signal: confidence,
            time_to_tip_hours: last.hours_to_tip,
            edge_at_signal: driftPct,
            signal_factors: { openingLine: last.opening_line, currentLine: last.line, driftPct },
          });
        }
      }
    }

    // ====== SIGNAL 3: TRAP WARNING ======
    for (const [key, snapshots] of groups) {
      if (snapshots.length < 3) continue;

      // Detect reversal: line moved one way then reversed
      const mid = snapshots[Math.floor(snapshots.length / 2)];
      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];

      const firstHalfDir = mid.line - first.line;
      const secondHalfDir = last.line - mid.line;

      // Reversal: significant move in opposite directions
      if (
        Math.abs(firstHalfDir) >= 0.5 &&
        Math.abs(secondHalfDir) >= 0.5 &&
        Math.sign(firstHalfDir) !== Math.sign(secondHalfDir)
      ) {
        const esc3 = (s: string) => (s || "").replace(/_/g, " ").replace(/\*/g, "");
        telegramAlerts.push(
          [
            `⚠️ *TRAP WARNING* — ${esc3(first.sport)}`,
            `${esc3(first.player_name)} ${esc3(first.prop_type).replace("player ", "").toUpperCase()}`,
            `Line reversed: ${first.line} → ${mid.line} → ${last.line}`,
            `Sharp reversal pattern — DO NOT TOUCH`,
          ].join("\n")
        );

        predictionRecords.push({
          signal_type: "trap_warning",
          sport: first.sport,
          prop_type: first.prop_type,
          player_name: first.player_name,
          event_id: first.event_id,
          prediction: "TRAP — avoid",
          predicted_direction: "reversal",
          predicted_magnitude: Math.abs(firstHalfDir) + Math.abs(secondHalfDir),
          confidence_at_signal: 75,
          time_to_tip_hours: last.hours_to_tip,
          signal_factors: { firstLine: first.line, midLine: mid.line, lastLine: last.line },
        });
      }
    }

    // Store prediction records
    if (predictionRecords.length > 0) {
      const { error } = await supabase.from("fanduel_prediction_accuracy").insert(predictionRecords);
      if (error) log(`⚠ Prediction insert error: ${error.message}`);
    }

    // Send Telegram alerts — paginated, all signals shown
    if (telegramAlerts.length > 0) {
      const ALERTS_PER_MSG = 6;
      const totalPages = Math.ceil(telegramAlerts.length / ALERTS_PER_MSG);

      for (let i = 0; i < totalPages; i++) {
        const pageAlerts = telegramAlerts.slice(i * ALERTS_PER_MSG, (i + 1) * ALERTS_PER_MSG);
        const pageLabel = totalPages > 1 ? ` (${i + 1}/${totalPages})` : "";
        const header = i === 0
          ? [`🎯 *FanDuel Prediction Engine*${pageLabel}`, `${telegramAlerts.length} signal(s) detected`, ""]
          : [`🎯 *Predictions${pageLabel}*`, ""];

        const msg = [...header, ...pageAlerts].join("\n\n");

        try {
          await supabase.functions.invoke("bot-send-telegram", {
            body: { message: msg, parse_mode: "Markdown", admin_only: true },
          });
        } catch (tgErr: any) {
          log(`Telegram error page ${i + 1}: ${tgErr.message}`);
        }
      }
    }

    log(`=== ALERTS COMPLETE: ${telegramAlerts.length} alerts, ${predictionRecords.length} predictions ===`);

    await supabase.from("cron_job_history").insert({
      job_name: "fanduel-prediction-alerts",
      status: "completed",
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(),
      result: { alerts: telegramAlerts.length, predictions: predictionRecords.length },
    });

    return new Response(
      JSON.stringify({ success: true, alerts: telegramAlerts.length, predictions: predictionRecords.length }),
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
