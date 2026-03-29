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

    // Query per-sport to avoid 1000-row default limit drowning out smaller sports
    const SPORTS = ["NBA", "NCAAB", "NHL", "MLB"];
    let activeTimeline: any[] = [];

    for (const sport of SPORTS) {
      const { data, error } = await supabase
        .from("fanduel_line_timeline")
        .select("*")
        .eq("sport", sport)
        .gte("snapshot_time", twoHoursAgo)
        .gt("hours_to_tip", -3) // Exclude finished games at DB level
        .order("snapshot_time", { ascending: true })
        .limit(1000);

      if (error) {
        log(`⚠ ${sport} fetch error: ${error.message}`);
        continue;
      }
      if (data && data.length > 0) {
        activeTimeline = activeTimeline.concat(data);
        log(`${sport}: ${data.length} active records`);
      }
    }

    log(`Total active records: ${activeTimeline.length}`);

    if (activeTimeline.length === 0) {
      log("No active data to analyze");
      return new Response(JSON.stringify({ success: true, patterns: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by event+player+prop for sequential analysis
    const groups = new Map<string, any[]>();
    for (const row of activeTimeline) {
      const key = `${row.event_id}|${row.player_name}|${row.prop_type}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    // Also group by event+player (all props) for cascade detection
    const playerGroups = new Map<string, any[]>();
    for (const row of activeTimeline) {
      const key = `${row.event_id}|${row.player_name}`;
      if (!playerGroups.has(key)) playerGroups.set(key, []);
      playerGroups.get(key)!.push(row);
    }

    const patterns: any[] = [];
    // Track best alert per player (dedup)
    const bestAlertPerPlayer = new Map<string, { confidence: number; alert: any }>();
    const addAlert = (playerKey: string, confidence: number, alert: any) => {
      const existing = bestAlertPerPlayer.get(playerKey);
      if (!existing || confidence > existing.confidence) {
        bestAlertPerPlayer.set(playerKey, { confidence, alert });
      }
    };

    const esc = (s: string) => (s || "").replace(/_/g, " ").replace(/\*/g, "").replace(/\[/g, "(").replace(/\]/g, ")");

    // Helper: is this row from a live game?
    const isLive = (r: any) => r.snapshot_phase === "live" || (typeof r.hours_to_tip === "number" && r.hours_to_tip <= 0);

    // ====== PATTERN 1: VELOCITY SPIKES ======
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
        const live = isLive(last);
        patterns.push({
          sport: first.sport, prop_type: first.prop_type, pattern_type: "velocity_spike",
          avg_reaction_time_minutes: timeDiffMin, avg_move_size: lineDiff,
          confidence: Math.min(95, 50 + velocityPerHour * 15), sample_size: snapshots.length,
          cascade_sequence: null, velocity_threshold: velocityPerHour,
          snapback_pct: null, timing_window: `${Math.round(timeDiffMin)}min`,
        });

        const conf = Math.min(95, 50 + velocityPerHour * 15);
        const playerKey = `${first.event_id}|${first.player_name}`;
        addAlert(playerKey, conf, {
          type: "velocity_spike", live, sport: first.sport,
          player_name: first.player_name, prop_type: first.prop_type,
          event_description: first.event_description, event_id: first.event_id,
          direction, velocity: Math.round(velocityPerHour * 100) / 100,
          line_from: first.line, line_to: last.line,
          time_span_min: Math.round(timeDiffMin), confidence: conf,
          hours_to_tip: last.hours_to_tip,
        });
      }
    }

    // ====== PATTERN 2: CASCADE DETECTION ======
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
        const live = isLive(sampleRow);
        const conf = Math.min(85, 40 + movedProps.length * 15);
        patterns.push({
          sport: sampleRow.sport, prop_type: movedProps[0], pattern_type: "cascade",
          avg_reaction_time_minutes: 0, avg_move_size: 0, confidence: conf,
          sample_size: allProps.length, cascade_sequence: { moved: movedProps, pending: staleProps },
          velocity_threshold: null, snapback_pct: null, timing_window: null,
        });
        const dedupKey = `${sampleRow.event_id}|${sampleRow.player_name}`;
        addAlert(dedupKey, conf, {
          type: "cascade", live, sport: sampleRow.sport,
          player_name: sampleRow.player_name, event_description: sampleRow.event_description,
          event_id: sampleRow.event_id, moved_props: movedProps, pending_props: staleProps,
          confidence: conf, hours_to_tip: sampleRow.hours_to_tip,
        });
      }
    }

    // ====== PATTERN 3: SNAPBACK DETECTION ======
    for (const [key, snapshots] of groups) {
      if (snapshots.length < 3) continue;
      const last = snapshots[snapshots.length - 1];
      const openingLine = last.opening_line;
      if (!openingLine) continue;
      const drift = Math.abs(last.line - openingLine);
      const driftPct = (drift / openingLine) * 100;

      if (driftPct >= 8) {
        const live = isLive(last);
        const conf = Math.min(80, 35 + driftPct * 2);
        patterns.push({
          sport: last.sport, prop_type: last.prop_type, pattern_type: "snapback_candidate",
          avg_reaction_time_minutes: 0, avg_move_size: drift, confidence: conf,
          sample_size: snapshots.length, cascade_sequence: null,
          velocity_threshold: null, snapback_pct: driftPct, timing_window: null,
        });
        const playerKey = `${last.event_id}|${last.player_name}`;
        addAlert(playerKey, conf, {
          type: "snapback", live, sport: last.sport,
          player_name: last.player_name, prop_type: last.prop_type,
          event_description: last.event_description, event_id: last.event_id,
          opening_line: openingLine, current_line: last.line,
          drift_pct: Math.round(driftPct * 10) / 10, confidence: conf,
          hours_to_tip: last.hours_to_tip,
        });
      }
    }

    // ====== UPSERT PATTERNS ======
    let patternsUpserted = 0;
    for (const p of patterns) {
      const { error } = await supabase
        .from("fanduel_behavior_patterns")
        .upsert(p, { onConflict: "sport,prop_type,pattern_type" });
      if (!error) patternsUpserted++;
    }

    // Collect deduped alerts (one per player)
    const alerts = Array.from(bestAlertPerPlayer.values()).map((v) => v.alert);

    // ====== STORE ALERTS AS PREDICTION ACCURACY RECORDS ======
    const predRows = alerts.map((a) => ({
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

    // ====== SEND TELEGRAM — DEDUPED, GROUPED, PAGINATED ======
    const highConfAlerts = alerts.filter((a) => a.confidence >= 70);
    if (highConfAlerts.length > 0) {
      const formatAlert = (a: any): string => {
        const liveTag = a.live ? " [🔴 LIVE]" : "";
        if (a.type === "velocity_spike") {
          const action = a.direction === "dropping" ? "OVER" : "UNDER";
          const reason = a.direction === "dropping"
            ? "Line dropping = book expects fewer, value is OVER"
            : "Line rising = book expects more, value is UNDER";
          return [
            `⚡ *VELOCITY*${liveTag} — ${esc(a.sport)}`,
            `${esc(a.player_name)} ${esc(a.prop_type).replace("player ", "").toUpperCase()}`,
            `Line ${a.direction}: ${a.line_from} → ${a.line_to}`,
            `Speed: ${a.velocity}/hr over ${a.time_span_min}min`,
            `📊 Conf: ${Math.round(a.confidence)}%`,
            `✅ *Action: ${action} ${a.line_to}*`,
            `💡 ${reason}`,
          ].join("\n");
        }
        if (a.type === "cascade") {
          return [
            `🌊 *CASCADE*${liveTag} — ${esc(a.sport)}`,
            `${esc(a.player_name)}`,
            `Moved: ${(a.moved_props || []).map(esc).join(", ")}`,
            `⏳ Pending: ${(a.pending_props || []).map(esc).join(", ")}`,
            `📊 Conf: ${Math.round(a.confidence)}%`,
            `✅ *Action: Grab pending props NOW*`,
            `💡 Related props follow within 5-15 min`,
          ].join("\n");
        }
        if (a.type === "snapback") {
          const action = a.current_line > a.opening_line ? "UNDER" : "OVER";
          const reason = a.current_line > a.opening_line
            ? "Inflated above open — snaps back down"
            : "Deflated below open — snaps back up";
          return [
            `🔄 *SNAPBACK*${liveTag} — ${esc(a.sport)}`,
            `${esc(a.player_name)} ${esc(a.prop_type).replace("player ", "").toUpperCase()}`,
            `Open: ${a.opening_line} → Now: ${a.current_line} (${a.drift_pct}%)`,
            `📊 Conf: ${Math.round(a.confidence)}%`,
            `✅ *Action: ${action} ${a.current_line}*`,
            `💡 ${reason}`,
          ].join("\n");
        }
        return "";
      };

      const velocityAlerts = highConfAlerts.filter((a) => a.type === "velocity_spike");
      const cascadeAlerts = highConfAlerts.filter((a) => a.type === "cascade");
      const snapbackAlerts = highConfAlerts.filter((a) => a.type === "snapback");

      const allFormatted: string[] = [];
      if (velocityAlerts.length > 0) {
        allFormatted.push(`\n— *VELOCITY SPIKES (${velocityAlerts.length})* —`);
        allFormatted.push(...velocityAlerts.map(formatAlert));
      }
      if (cascadeAlerts.length > 0) {
        allFormatted.push(`\n— *CASCADE OPPORTUNITIES (${cascadeAlerts.length})* —`);
        allFormatted.push(...cascadeAlerts.map(formatAlert));
      }
      if (snapbackAlerts.length > 0) {
        allFormatted.push(`\n— *SNAPBACK CANDIDATES (${snapbackAlerts.length})* —`);
        allFormatted.push(...snapbackAlerts.map(formatAlert));
      }

      // Paginate by character count
      const MAX_CHARS = 3800;
      const pages: string[][] = [];
      let currentPage: string[] = [];
      let currentLen = 0;

      for (const line of allFormatted) {
        const lineLen = line.length + 1;
        if (currentPage.length > 0 && !line.startsWith("\n—") && currentLen + lineLen > MAX_CHARS) {
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
          ? [`🧠 *FanDuel Behavior*${pageLabel}`, `${highConfAlerts.length} unique players — ⚡${velocityAlerts.length} 🌊${cascadeAlerts.length} 🔄${snapbackAlerts.length}`, ""]
          : [`🧠 *Behavior${pageLabel}*`, ""];

        const msg = [...header, ...pages[i]].join("\n");

        try {
          await supabase.functions.invoke("bot-send-telegram", {
            body: { message: msg, parse_mode: "Markdown", admin_only: true },
          });
        } catch (tgErr: any) {
          log(`Telegram error page ${i + 1}: ${tgErr.message}`);
        }
      }
    }

    log(`=== ANALYSIS COMPLETE: ${patterns.length} patterns, ${alerts.length} alerts (deduped), ${highConfAlerts.length} high-conf ===`);

    await supabase.from("cron_job_history").insert({
      job_name: "fanduel-behavior-analyzer",
      status: "completed",
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(),
      result: { patterns: patterns.length, alerts: alerts.length, highConf: highConfAlerts.length },
    });

    return new Response(
      JSON.stringify({ success: true, patterns: patterns.length, alerts: alerts.length }),
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
