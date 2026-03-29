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

  const log = (msg: string) => console.log(`[Behavior Analyzer] ${msg}`);
  const now = new Date();

  try {
    log("=== Starting FanDuel behavior analysis ===");

    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: recentTimeline, error: tlError } = await supabase
      .from("fanduel_line_timeline")
      .select("*")
      .gte("snapshot_time", twoHoursAgo)
      .order("snapshot_time", { ascending: true })
      .limit(5000);

    if (tlError) throw new Error(`Timeline fetch: ${tlError.message}`);
    if (!recentTimeline || recentTimeline.length === 0) {
      log("No recent timeline data to analyze");
      return new Response(JSON.stringify({ success: true, patterns: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Exclude finished games — only pregame + live
    const activeTimeline = recentTimeline.filter((r: any) =>
      typeof r.hours_to_tip !== "number" || r.hours_to_tip > -3
    );
    const excluded = recentTimeline.length - activeTimeline.length;
    log(`Analyzing ${activeTimeline.length} active records (excluded ${excluded} finished games)`);

    const esc = (s: string) => (s || "").replace(/_/g, " ").replace(/\*/g, "").replace(/\[/g, "(").replace(/\]/g, ")");

    // ====== ANALYZE A TIER ======
    const analyzeTier = (data: any[], tierLabel: string) => {
      const groups = new Map<string, any[]>();
      for (const row of data) {
        const key = `${row.event_id}|${row.player_name}|${row.prop_type}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      }

      const playerGroups = new Map<string, any[]>();
      for (const row of data) {
        const key = `${row.event_id}|${row.player_name}`;
        if (!playerGroups.has(key)) playerGroups.set(key, []);
        playerGroups.get(key)!.push(row);
      }

      const patterns: any[] = [];
      const bestAlertPerPlayer = new Map<string, { confidence: number; alert: any }>();
      const addAlert = (playerKey: string, confidence: number, alert: any) => {
        const existing = bestAlertPerPlayer.get(playerKey);
        if (!existing || confidence > existing.confidence) {
          bestAlertPerPlayer.set(playerKey, { confidence, alert });
        }
      };

      // VELOCITY SPIKES
      for (const [key, snapshots] of groups) {
        if (snapshots.length < 2) continue;
        const first = snapshots[0];
        const last = snapshots[snapshots.length - 1];
        const timeDiffMin = (new Date(last.snapshot_time).getTime() - new Date(first.snapshot_time).getTime()) / 60000;
        if (timeDiffMin < 5) continue;
        const lineDiff = Math.abs(last.line - first.line);
        const velocityPerHour = (lineDiff / timeDiffMin) * 60;

        if (velocityPerHour >= 1.0) {
          const direction = last.line < first.line ? "dropping" : "rising";
          const conf = Math.min(95, 50 + velocityPerHour * 15);
          patterns.push({
            sport: first.sport, prop_type: first.prop_type, pattern_type: "velocity_spike",
            avg_reaction_time_minutes: timeDiffMin, avg_move_size: lineDiff,
            confidence: conf, sample_size: snapshots.length,
            cascade_sequence: null, velocity_threshold: velocityPerHour,
            snapback_pct: null, timing_window: `${Math.round(timeDiffMin)}min`,
          });

          const playerKey = `${first.event_id}|${first.player_name}`;
          addAlert(playerKey, conf, {
            type: "velocity_spike", tier: tierLabel, sport: first.sport,
            player_name: first.player_name, prop_type: first.prop_type,
            event_description: first.event_description, event_id: first.event_id,
            direction, velocity: Math.round(velocityPerHour * 100) / 100,
            line_from: first.line, line_to: last.line,
            time_span_min: Math.round(timeDiffMin), confidence: conf,
            hours_to_tip: last.hours_to_tip,
          });
        }
      }

      // CASCADE DETECTION
      for (const [playerKey, allProps] of playerGroups) {
        const propMap = new Map<string, any[]>();
        for (const row of allProps) {
          if (!propMap.has(row.prop_type)) propMap.set(row.prop_type, []);
          propMap.get(row.prop_type)!.push(row);
        }
        if (propMap.size < 2) continue;
        const movedProps: string[] = [];
        const staleProps: string[] = [];
        for (const [propType, snapshots] of propMap) {
          if (snapshots.length < 2) { staleProps.push(propType); continue; }
          const f = snapshots[0]; const l = snapshots[snapshots.length - 1];
          Math.abs(l.line - f.line) >= 0.5 ? movedProps.push(propType) : staleProps.push(propType);
        }
        if (movedProps.length > 0 && staleProps.length > 0) {
          const sampleRow = allProps[0];
          const conf = Math.min(85, 40 + movedProps.length * 15);
          patterns.push({
            sport: sampleRow.sport, prop_type: movedProps[0], pattern_type: "cascade",
            avg_reaction_time_minutes: 0, avg_move_size: 0, confidence: conf,
            sample_size: allProps.length, cascade_sequence: { moved: movedProps, pending: staleProps },
            velocity_threshold: null, snapback_pct: null, timing_window: null,
          });
          const dedupKey = `${sampleRow.event_id}|${sampleRow.player_name}`;
          addAlert(dedupKey, conf, {
            type: "cascade", tier: tierLabel, sport: sampleRow.sport,
            player_name: sampleRow.player_name, event_description: sampleRow.event_description,
            event_id: sampleRow.event_id, moved_props: movedProps, pending_props: staleProps,
            confidence: conf, hours_to_tip: sampleRow.hours_to_tip,
          });
        }
      }

      // SNAPBACK DETECTION
      for (const [key, snapshots] of groups) {
        if (snapshots.length < 3) continue;
        const last = snapshots[snapshots.length - 1];
        const openingLine = last.opening_line;
        if (!openingLine) continue;
        const drift = Math.abs(last.line - openingLine);
        const driftPct = (drift / openingLine) * 100;
        if (driftPct >= 8) {
          const conf = Math.min(80, 35 + driftPct * 2);
          patterns.push({
            sport: last.sport, prop_type: last.prop_type, pattern_type: "snapback_candidate",
            avg_reaction_time_minutes: 0, avg_move_size: drift, confidence: conf,
            sample_size: snapshots.length, cascade_sequence: null,
            velocity_threshold: null, snapback_pct: driftPct, timing_window: null,
          });
          const playerKey = `${last.event_id}|${last.player_name}`;
          addAlert(playerKey, conf, {
            type: "snapback", tier: tierLabel, sport: last.sport,
            player_name: last.player_name, prop_type: last.prop_type,
            event_description: last.event_description, event_id: last.event_id,
            opening_line: openingLine, current_line: last.line,
            drift_pct: Math.round(driftPct * 10) / 10, confidence: conf,
            hours_to_tip: last.hours_to_tip,
          });
        }
      }

      return { patterns, alerts: Array.from(bestAlertPerPlayer.values()).map((v) => v.alert) };
    };

    // Run analysis on each tier
    const pregameResult = analyzeTier(pregameData, "PREGAME");
    const liveResult = analyzeTier(liveData, "LIVE");
    const finishedResult = analyzeTier(finishedData, "POSTGAME");

    const allPatterns = [...pregameResult.patterns, ...liveResult.patterns, ...finishedResult.patterns];

    // Upsert patterns
    let patternsUpserted = 0;
    for (const p of allPatterns) {
      const { error } = await supabase
        .from("fanduel_behavior_patterns")
        .upsert(p, { onConflict: "sport,prop_type,pattern_type" });
      if (!error) patternsUpserted++;
    }

    // Store prediction accuracy records for pregame + live (not postgame)
    const allActionableAlerts = [...pregameResult.alerts, ...liveResult.alerts];
    const predRows = allActionableAlerts.map((a) => ({
      signal_type: a.type,
      sport: a.sport,
      prop_type: a.prop_type || a.moved_props?.[0] || "unknown",
      player_name: a.player_name,
      event_id: a.event_id,
      prediction: a.type === "cascade"
        ? `Cascade: ${a.pending_props?.join(",")} will follow ${a.moved_props?.join(",")}`
        : a.type === "velocity_spike"
        ? `Line ${a.direction} at ${a.velocity}/hr`
        : `Snapback from ${a.current_line} toward ${a.opening_line}`,
      predicted_direction: a.direction || (a.type === "snapback" ? "revert" : null),
      predicted_magnitude: a.velocity || a.drift_pct || null,
      confidence_at_signal: a.confidence,
      velocity_at_signal: a.velocity || null,
      time_to_tip_hours: a.hours_to_tip,
      signal_factors: a,
    }));

    if (predRows.length > 0) {
      const { error } = await supabase.from("fanduel_prediction_accuracy").insert(predRows);
      if (error) log(`⚠ Prediction insert error: ${error.message}`);
    }

    // ====== FORMAT ALERTS PER TIER ======
    const formatAlert = (a: any): string => {
      const tierTag = a.tier === "LIVE" ? "🔴 LIVE" : a.tier === "POSTGAME" ? "📋 RECAP" : "📡 PRE";
      if (a.type === "velocity_spike") {
        const action = a.direction === "dropping" ? "OVER" : "UNDER";
        const reason = a.direction === "dropping"
          ? "Line dropping = book expects fewer, value is OVER"
          : "Line rising = book expects more, value is UNDER";
        return [
          `⚡ *VELOCITY* [${tierTag}] — ${esc(a.sport)}`,
          `${esc(a.player_name)} ${esc(a.prop_type).replace("player ", "").toUpperCase()}`,
          `Line ${a.direction}: ${a.line_from} → ${a.line_to}`,
          `Speed: ${a.velocity}/hr over ${a.time_span_min}min`,
          `📊 Conf: ${Math.round(a.confidence)}%`,
          a.tier !== "POSTGAME" ? `✅ *Action: ${action} ${a.line_to}*` : `📝 *Movement recorded for learning*`,
          a.tier !== "POSTGAME" ? `💡 ${reason}` : "",
        ].filter(Boolean).join("\n");
      }
      if (a.type === "cascade") {
        return [
          `🌊 *CASCADE* [${tierTag}] — ${esc(a.sport)}`,
          `${esc(a.player_name)}`,
          `Moved: ${(a.moved_props || []).map(esc).join(", ")}`,
          `⏳ Pending: ${(a.pending_props || []).map(esc).join(", ")}`,
          `📊 Conf: ${Math.round(a.confidence)}%`,
          a.tier !== "POSTGAME" ? `✅ *Action: Grab pending props NOW*` : `📝 *Cascade recorded*`,
        ].join("\n");
      }
      if (a.type === "snapback") {
        const action = a.current_line > a.opening_line ? "UNDER" : "OVER";
        return [
          `🔄 *SNAPBACK* [${tierTag}] — ${esc(a.sport)}`,
          `${esc(a.player_name)} ${esc(a.prop_type).replace("player ", "").toUpperCase()}`,
          `Open: ${a.opening_line} → Now: ${a.current_line} (${a.drift_pct}%)`,
          `📊 Conf: ${Math.round(a.confidence)}%`,
          a.tier !== "POSTGAME" ? `✅ *Action: ${action} ${a.current_line}*` : `📝 *Drift recorded*`,
        ].join("\n");
      }
      return "";
    };

    // Send Telegram — separated by tier
    const sendTierAlerts = async (alerts: any[], tierName: string, emoji: string, minConf: number) => {
      const highConf = alerts.filter((a) => a.confidence >= minConf);
      if (highConf.length === 0) return;

      const formatted = highConf.map(formatAlert).filter(Boolean);
      const MAX_CHARS = 3800;
      const pages: string[][] = [];
      let currentPage: string[] = [];
      let currentLen = 0;

      for (const line of formatted) {
        const lineLen = line.length + 2;
        if (currentPage.length > 0 && currentLen + lineLen > MAX_CHARS) {
          pages.push(currentPage);
          currentPage = [];
          currentLen = 0;
        }
        currentPage.push(line);
        currentLen += lineLen;
      }
      if (currentPage.length > 0) pages.push(currentPage);

      for (let i = 0; i < pages.length; i++) {
        const pageLabel = pages.length > 1 ? ` (${i + 1}/${pages.length})` : "";
        const header = i === 0
          ? [`${emoji} *FanDuel ${tierName}*${pageLabel}`, `${highConf.length} signals`, ""]
          : [`${emoji} *${tierName}${pageLabel}*`, ""];

        const msg = [...header, ...pages[i]].join("\n\n");
        try {
          await supabase.functions.invoke("bot-send-telegram", {
            body: { message: msg, parse_mode: "Markdown", admin_only: true },
          });
        } catch (tgErr: any) {
          log(`Telegram error ${tierName} page ${i + 1}: ${tgErr.message}`);
        }
      }
    };

    // Pregame: high-conf only (70+)
    await sendTierAlerts(pregameResult.alerts, "Pregame Behavior", "📡", 70);
    // Live: slightly lower threshold (60+) — time-sensitive
    await sendTierAlerts(liveResult.alerts, "🔴 Live Line Movement", "🔴", 60);
    // Postgame: summary of biggest movers only (80+)
    await sendTierAlerts(finishedResult.alerts, "Post-Game Recap", "📋", 80);

    const totalAlerts = pregameResult.alerts.length + liveResult.alerts.length + finishedResult.alerts.length;
    log(`=== ANALYSIS COMPLETE: ${allPatterns.length} patterns, ${totalAlerts} alerts (pre:${pregameResult.alerts.length} live:${liveResult.alerts.length} post:${finishedResult.alerts.length}) ===`);

    await supabase.from("cron_job_history").insert({
      job_name: "fanduel-behavior-analyzer",
      status: "completed",
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(),
      result: {
        patterns: allPatterns.length, totalAlerts,
        pregame: pregameResult.alerts.length,
        live: liveResult.alerts.length,
        postgame: finishedResult.alerts.length,
      },
    });

    return new Response(
      JSON.stringify({ success: true, patterns: allPatterns.length, alerts: totalAlerts }),
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
