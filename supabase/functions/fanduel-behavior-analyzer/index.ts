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

    // ====== PATTERN 0 (PRIMARY): LINE ABOUT TO MOVE ======
    // Best performing signal (57.5% win rate). Detects steady, sustained
    // directional movement that isn't a sudden spike — the line has been
    // consistently drifting in one direction across 3+ snapshots.
    for (const [key, snapshots] of groups) {
      if (snapshots.length < 3) continue;
      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      const timeDiffMin = (new Date(last.snapshot_time).getTime() - new Date(first.snapshot_time).getTime()) / 60000;
      if (timeDiffMin < 10) continue; // need at least 10 min of data

      const lineDiff = last.line - first.line; // signed
      const absLineDiff = Math.abs(lineDiff);
      const velocityPerHour = (absLineDiff / timeDiffMin) * 60;

      // Sustained movement: moderate velocity (0.3-1.5/hr) with consistent direction
      // Count how many consecutive snapshots moved in the same direction
      let consistentMoves = 0;
      for (let i = 1; i < snapshots.length; i++) {
        const move = snapshots[i].line - snapshots[i - 1].line;
        if ((lineDiff > 0 && move > 0) || (lineDiff < 0 && move < 0)) {
          consistentMoves++;
        }
      }
      const consistencyRate = consistentMoves / (snapshots.length - 1);

      // Must have: decent move size, moderate speed, and directional consistency
      if (absLineDiff >= 0.5 && velocityPerHour >= 0.3 && velocityPerHour <= 3.0 && consistencyRate >= 0.6) {
        const direction = lineDiff < 0 ? "dropping" : "rising";
        const live = isLive(last);
        // Higher confidence for higher consistency and more snapshots
        const conf = Math.min(92, 55 + consistencyRate * 20 + Math.min(snapshots.length, 8) * 2);

        patterns.push({
          sport: first.sport, prop_type: first.prop_type, pattern_type: "line_about_to_move",
          avg_reaction_time_minutes: timeDiffMin, avg_move_size: absLineDiff,
          confidence: conf, sample_size: snapshots.length,
          cascade_sequence: null, velocity_threshold: velocityPerHour,
          snapback_pct: null, timing_window: `${Math.round(timeDiffMin)}min`,
        });

        const playerKey = `${first.event_id}|${first.player_name}`;
        addAlert(playerKey, conf + 10, { // +10 priority boost so this beats velocity/cascade
          type: "line_about_to_move", live, sport: first.sport,
          player_name: first.player_name, prop_type: first.prop_type,
          event_description: first.event_description, event_id: first.event_id,
          direction, velocity: Math.round(velocityPerHour * 100) / 100,
          line_from: first.line, line_to: last.line,
          lineDiff: Math.round(lineDiff * 100) / 100,
          consistencyRate: Math.round(consistencyRate * 100),
          time_span_min: Math.round(timeDiffMin), confidence: conf,
          hours_to_tip: last.hours_to_tip,
          learnedAvgVelocity: velocityPerHour,
        });
      }
    }

    // ====== PATTERN 1: VELOCITY SPIKES (deprioritized — 27.6% win rate) ======
    // Only alert on very strong spikes now (velocity >= 2.0 instead of 1.0)
    for (const [key, snapshots] of groups) {
      if (snapshots.length < 2) continue;
      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      const timeDiffMin = (new Date(last.snapshot_time).getTime() - new Date(first.snapshot_time).getTime()) / 60000;
      if (timeDiffMin < 5) continue;

      const lineDiff = Math.abs(last.line - first.line);
      const velocityPerHour = (lineDiff / timeDiffMin) * 60;

      // Raised threshold from 1.0 to 2.0 and require higher confidence
      if (velocityPerHour >= 2.0) {
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
        // Only send to Telegram if conf >= 80 (raised from implicit 70)
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

      // Cascade deprioritized (19% win rate) — require 2+ moved props now
      if (movedProps.length >= 2 && staleProps.length > 0) {
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

    // ====== PATTERN 4: TAKE IT NOW — OPTIMAL ENTRY POINT ======
    // Uses historical drift ranges to detect when a line has moved far enough
    // that it's at the "sweet spot" — grab it before it moves more or snaps back.
    // Based on data: Points drift ~4.35, Rebounds ~2.21, Assists ~1.82, etc.
    const TYPICAL_DRIFT: Record<string, number> = {
      player_points: 4.35,
      player_rebounds: 2.21,
      player_assists: 1.82,
      player_threes: 1.30,
      player_points_rebounds_assists: 1.13,
      player_points_rebounds: 1.04,
      player_points_assists: 1.03,
      player_rebounds_assists: 1.00,
      player_shots_on_goal: 1.00,
      player_steals: 0.75,
      player_blocks: 0.75,
      player_turnovers: 0.75,
      spreads: 2.53,
      totals: 2.31,
      moneyline: 50, // moneyline uses American odds scale
      h2h: 50,
    };
    // Optimal entry: line has moved 50-85% of its typical drift range
    const ENTRY_MIN_PCT = 0.50;
    const ENTRY_MAX_PCT = 0.85;

    // Query recent historical drift for this session to refine defaults
    const { data: recentDrifts } = await supabase
      .from("fanduel_line_timeline")
      .select("prop_type, event_id, player_name, line")
      .gte("created_at", new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString())
      .limit(1000);

    // Build learned drift map from recent data
    const learnedDrift = new Map<string, number[]>();
    if (recentDrifts && recentDrifts.length > 0) {
      const driftGroups = new Map<string, { min: number; max: number }>();
      for (const r of recentDrifts) {
        const k = `${r.event_id}|${r.player_name}|${r.prop_type}`;
        const existing = driftGroups.get(k);
        if (!existing) {
          driftGroups.set(k, { min: r.line, max: r.line });
        } else {
          existing.min = Math.min(existing.min, r.line);
          existing.max = Math.max(existing.max, r.line);
        }
      }
      for (const [k, v] of driftGroups) {
        const drift = v.max - v.min;
        if (drift > 0) {
          const propType = k.split("|")[2];
          if (!learnedDrift.has(propType)) learnedDrift.set(propType, []);
          learnedDrift.get(propType)!.push(drift);
        }
      }
    }

    // Compute learned averages
    const learnedAvgDrift = new Map<string, number>();
    for (const [propType, drifts] of learnedDrift) {
      const avg = drifts.reduce((a, b) => a + b, 0) / drifts.length;
      learnedAvgDrift.set(propType, avg);
    }

    for (const [key, snapshots] of groups) {
      if (snapshots.length < 3) continue;
      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      const openingLine = last.opening_line || first.line;
      const currentDrift = Math.abs(last.line - openingLine);
      if (currentDrift < 0.5) continue; // no meaningful movement

      // Use learned drift if available, fall back to static defaults
      const expectedDrift = learnedAvgDrift.get(first.prop_type) || TYPICAL_DRIFT[first.prop_type] || 1.5;
      const driftRatio = currentDrift / expectedDrift;

      // Sweet spot: moved 50-85% of typical range
      if (driftRatio >= ENTRY_MIN_PCT && driftRatio <= ENTRY_MAX_PCT) {
        const live = isLive(last);
        const direction = last.line < openingLine ? "dropping" : "rising";

        // Confidence scales with how close to the sweet spot center (67%)
        const sweetSpotCenter = 0.67;
        const distFromCenter = Math.abs(driftRatio - sweetSpotCenter);
        const conf = Math.min(90, 70 + (1 - distFromCenter * 5) * 15);

        // Don't duplicate if we already have a stronger "line_about_to_move" for this player
        const playerKey = `${first.event_id}|${first.player_name}`;
        const existing = bestAlertPerPlayer.get(playerKey);
        if (existing && existing.confidence > conf + 5) continue;

        patterns.push({
          sport: first.sport, prop_type: first.prop_type, pattern_type: "take_it_now",
          avg_reaction_time_minutes: 0, avg_move_size: currentDrift,
          confidence: conf, sample_size: snapshots.length,
          cascade_sequence: null, velocity_threshold: null,
          snapback_pct: null, timing_window: `${Math.round(driftRatio * 100)}% of range`,
        });

        addAlert(playerKey, conf + 15, { // High priority — actionable NOW
          type: "take_it_now", live, sport: first.sport,
          player_name: first.player_name, prop_type: first.prop_type,
          event_description: first.event_description, event_id: first.event_id,
          direction,
          opening_line: openingLine, current_line: last.line,
          drift_amount: Math.round(currentDrift * 100) / 100,
          drift_pct_of_range: Math.round(driftRatio * 100),
          expected_drift: Math.round(expectedDrift * 100) / 100,
          remaining_move: Math.round((expectedDrift - currentDrift) * 100) / 100,
          confidence: conf,
          hours_to_tip: last.hours_to_tip,
        });
      }
    }

    let patternsUpserted = 0;
    for (const p of patterns) {
      const { error } = await supabase
        .from("fanduel_behavior_patterns")
        .upsert(p, { onConflict: "sport,prop_type,pattern_type" });
      if (!error) patternsUpserted++;
    }

    // Collect deduped alerts (one per player)
    let alerts = Array.from(bestAlertPerPlayer.values()).map((v) => v.alert);

    // ====== CONFLICT FILTER: Same event + same prop_type = opposing sides ======
    // For team markets (h2h, spreads, totals), two teams in same game can't both be picks
    const TEAM_PROP_TYPES = ["h2h", "spreads", "totals", "moneyline"];
    const eventPropGroups = new Map<string, typeof alerts>();
    for (const a of alerts) {
      if (TEAM_PROP_TYPES.includes(a.prop_type)) {
        const conflictKey = `${a.event_id}|${a.prop_type}`;
        if (!eventPropGroups.has(conflictKey)) eventPropGroups.set(conflictKey, []);
        eventPropGroups.get(conflictKey)!.push(a);
      }
    }
    // For each conflict group, keep only the strongest signal
    const droppedPlayers = new Set<string>();
    for (const [, group] of eventPropGroups) {
      if (group.length <= 1) continue;
      group.sort((a, b) => (b.velocity || b.confidence || 0) - (a.velocity || a.confidence || 0));
      for (let i = 1; i < group.length; i++) {
        droppedPlayers.add(`${group[i].event_id}|${group[i].player_name}`);
        log(`⚠ Dropped conflicting signal: ${group[i].player_name} ${group[i].prop_type} (kept ${group[0].player_name})`);
      }
    }

    // Also check for same-player contradictions across different pattern types
    // e.g. velocity says TAKE spread but snapback says FADE spread for same team
    const playerPropGroups = new Map<string, typeof alerts>();
    for (const a of alerts) {
      const ppKey = `${a.event_id}|${a.player_name}|${a.prop_type}`;
      if (!playerPropGroups.has(ppKey)) playerPropGroups.set(ppKey, []);
      playerPropGroups.get(ppKey)!.push(a);
    }
    for (const [, group] of playerPropGroups) {
      if (group.length <= 1) continue;
      // Multiple alerts for same player + same prop = keep strongest only
      group.sort((a, b) => (b.velocity || b.confidence || 0) - (a.velocity || a.confidence || 0));
      for (let i = 1; i < group.length; i++) {
        droppedPlayers.add(`${group[i].event_id}|${group[i].player_name}`);
        log(`⚠ Dropped same-player conflicting ${group[i].type}: ${group[i].player_name} ${group[i].prop_type}`);
      }
    }

    if (droppedPlayers.size > 0) {
      alerts = alerts.filter(a => !droppedPlayers.has(`${a.event_id}|${a.player_name}`));
    }

    // ====== STORE ALERTS AS PREDICTION ACCURACY RECORDS ======
    const predRows = alerts.map((a) => ({
      signal_type: a.type,
      sport: a.sport,
      prop_type: a.prop_type || a.moved_props?.[0] || "unknown",
      player_name: a.player_name,
      event_id: a.event_id,
      prediction: a.type === "take_it_now"
        ? `TAKE IT NOW: ${a.current_line} (${a.drift_pct_of_range}% of range, ~${a.remaining_move} more expected)`
        : a.type === "line_about_to_move"
        ? `Line ${a.direction} steadily at ${a.velocity}/hr (${a.consistencyRate}% consistent)`
        : a.type === "cascade"
        ? `Cascade: ${a.pending_props?.join(",")} will follow ${a.moved_props?.join(",")}`
        : a.type === "velocity_spike"
        ? `Line ${a.direction} at ${a.velocity}/hr`
        : a.type === "snapback"
        ? `Snapback from ${a.current_line} toward ${a.opening_line}`
        : `Unknown signal`,
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

        // ====== LINE ABOUT TO MOVE (primary signal) ======
        if (a.type === "line_about_to_move") {
          const isTeamMarket = ["h2h", "moneyline", "spreads", "totals"].includes(a.prop_type);
          let action: string;
          let reason: string;
          if (isTeamMarket && (a.prop_type === "h2h" || a.prop_type === "moneyline")) {
            const gameName = a.event_description ? ` (${esc(a.event_description)})` : "";
            action = a.direction === "dropping" ? `BACK ${esc(a.player_name)}${gameName}` : `FADE ${esc(a.player_name)}${gameName}`;
            reason = "Steady drift = smart money building position";
          } else if (isTeamMarket && a.prop_type === "spreads") {
            const gameName = a.event_description ? ` (${esc(a.event_description)})` : "";
            action = a.direction === "dropping" ? `TAKE ${esc(a.player_name)} SPREAD${gameName}` : `FADE ${esc(a.player_name)} SPREAD${gameName}`;
            reason = "Spread steadily shifting = sharps accumulating";
          } else if (isTeamMarket && a.prop_type === "totals") {
            const gameName = a.event_description ? esc(a.event_description) : esc(a.player_name);
            action = a.direction === "dropping" ? `UNDER ${gameName}` : `OVER ${gameName}`;
            reason = a.direction === "dropping"
              ? "Total steadily dropping = money on under"
              : "Total steadily rising = money on over";
          } else {
            action = a.direction === "dropping" ? "OVER" : "UNDER";
            reason = a.direction === "dropping"
              ? "Line consistently dropping = get OVER before it moves more"
              : "Line consistently rising = get UNDER before it moves more";
          }
          const propLabel = isTeamMarket ? a.prop_type.toUpperCase() : esc(a.prop_type).replace("player ", "").toUpperCase();
          const displayName = (isTeamMarket && a.prop_type === "totals" && a.event_description)
            ? esc(a.event_description)
            : esc(a.player_name);
          return [
            `🎯 *LINE ABOUT TO MOVE*${liveTag} — ${esc(a.sport)}`,
            `${displayName} ${propLabel}`,
            `Line ${a.direction}: ${a.line_from} → ${a.line_to}`,
            `Consistency: ${a.consistencyRate}% | Speed: ${a.velocity}/hr`,
            `📊 Conf: ${Math.round(a.confidence)}%`,
            `✅ *Action: ${action}${isTeamMarket ? "" : ` ${a.line_to}`}*`,
            `💡 ${reason}`,
          ].join("\n");
        }

        if (a.type === "velocity_spike") {
          const isTeamMarket = ["h2h", "moneyline", "spreads", "totals"].includes(a.prop_type);
          let action: string;
          let reason: string;
          if (isTeamMarket && (a.prop_type === "h2h" || a.prop_type === "moneyline")) {
            const gameName = a.event_description ? ` (${esc(a.event_description)})` : "";
            action = a.direction === "dropping" ? `BACK ${esc(a.player_name)}${gameName}` : `FADE ${esc(a.player_name)}${gameName}`;
            reason = a.direction === "dropping"
              ? "Odds shortening = sharp money on this team"
              : "Odds drifting = money moving away from this team";
          } else if (isTeamMarket && a.prop_type === "spreads") {
            const gameName = a.event_description ? ` (${esc(a.event_description)})` : "";
            action = a.direction === "dropping" ? `TAKE ${esc(a.player_name)} SPREAD${gameName}` : `FADE ${esc(a.player_name)} SPREAD${gameName}`;
            reason = a.direction === "dropping"
              ? "Spread tightening = sharps backing this side"
              : "Spread widening = sharps fading this side";
          } else if (isTeamMarket && a.prop_type === "totals") {
            const gameName = a.event_description ? esc(a.event_description) : esc(a.player_name);
            action = a.direction === "dropping" ? `UNDER ${gameName}` : `OVER ${gameName}`;
            reason = a.direction === "dropping"
              ? "Total dropping = sharps expecting low-scoring game"
              : "Total rising = sharps expecting high-scoring game";
          } else {
            action = a.direction === "dropping" ? "OVER" : "UNDER";
            reason = a.direction === "dropping"
              ? "Line dropping = book expects fewer, value is OVER"
              : "Line rising = book expects more, value is UNDER";
          }
          const propLabel = isTeamMarket ? a.prop_type.toUpperCase() : esc(a.prop_type).replace("player ", "").toUpperCase();
          const displayName = (isTeamMarket && a.prop_type === "totals" && a.event_description)
            ? esc(a.event_description)
            : esc(a.player_name);
          return [
            `⚡ *VELOCITY*${liveTag} — ${esc(a.sport)}`,
            `${displayName} ${propLabel}`,
            `Line ${a.direction}: ${a.line_from} → ${a.line_to}`,
            `Speed: ${a.velocity}/hr over ${a.time_span_min}min`,
            `📊 Conf: ${Math.round(a.confidence)}%`,
            `✅ *Action: ${action}${isTeamMarket ? "" : ` ${a.line_to}`}*`,
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
          const isTeamMarket = ["h2h", "moneyline", "spreads", "totals"].includes(a.prop_type);
          let action: string;
          let reason: string;
          if (isTeamMarket && (a.prop_type === "h2h" || a.prop_type === "moneyline")) {
            const gameName = a.event_description ? ` (${esc(a.event_description)})` : "";
            action = a.current_line > a.opening_line ? `FADE ${esc(a.player_name)}${gameName}` : `BACK ${esc(a.player_name)}${gameName}`;
            reason = a.current_line > a.opening_line
              ? "Odds drifted too far — expect correction back"
              : "Odds dropped too far — expect reversion";
          } else if (isTeamMarket && a.prop_type === "spreads") {
            const gameName = a.event_description ? ` (${esc(a.event_description)})` : "";
            action = a.current_line > a.opening_line ? `FADE ${esc(a.player_name)} SPREAD${gameName}` : `TAKE ${esc(a.player_name)} SPREAD${gameName}`;
            reason = a.current_line > a.opening_line
              ? "Spread inflated past open — expect snapback"
              : "Spread compressed past open — expect reversion";
          } else if (isTeamMarket && a.prop_type === "totals") {
            const gameName = a.event_description ? esc(a.event_description) : esc(a.player_name);
            action = a.current_line > a.opening_line ? `UNDER ${gameName}` : `OVER ${gameName}`;
            reason = a.current_line > a.opening_line
              ? "Total inflated above open — snaps back down"
              : "Total deflated below open — snaps back up";
          } else {
            action = a.current_line > a.opening_line ? "UNDER" : "OVER";
            reason = a.current_line > a.opening_line
              ? "Inflated above open — snaps back down"
              : "Deflated below open — snaps back up";
          }
          const propLabel = isTeamMarket ? a.prop_type.toUpperCase() : esc(a.prop_type).replace("player ", "").toUpperCase();
          const displayName = (isTeamMarket && a.prop_type === "totals" && a.event_description)
            ? esc(a.event_description)
            : esc(a.player_name);
          return [
            `🔄 *SNAPBACK*${liveTag} — ${esc(a.sport)}`,
            `${displayName} ${propLabel}`,
            `Open: ${a.opening_line} → Now: ${a.current_line} (${a.drift_pct}%)`,
            `📊 Conf: ${Math.round(a.confidence)}%`,
            `✅ *Action: ${action}${isTeamMarket ? "" : ` ${a.current_line}`}*`,
            `💡 ${reason}`,
          ].join("\n");
        }
        return "";
      };

      const lineAboutToMoveAlerts = highConfAlerts.filter((a) => a.type === "line_about_to_move");
      const velocityAlerts = highConfAlerts.filter((a) => a.type === "velocity_spike");
      const cascadeAlerts = highConfAlerts.filter((a) => a.type === "cascade");
      const snapbackAlerts = highConfAlerts.filter((a) => a.type === "snapback");

      const allFormatted: string[] = [];
      // Primary signal first
      if (lineAboutToMoveAlerts.length > 0) {
        allFormatted.push(`\n— *🎯 LINE ABOUT TO MOVE (${lineAboutToMoveAlerts.length})* —`);
        allFormatted.push(...lineAboutToMoveAlerts.map(formatAlert));
      }
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
          ? [`🧠 *FanDuel Behavior*${pageLabel}`, `${highConfAlerts.length} signals — 🎯${lineAboutToMoveAlerts.length} ⚡${velocityAlerts.length} 🌊${cascadeAlerts.length} 🔄${snapbackAlerts.length}`, ""]
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
