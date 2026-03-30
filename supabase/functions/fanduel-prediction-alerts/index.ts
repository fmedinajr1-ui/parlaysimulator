import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── ACCURACY-DRIVEN SIGNAL GATES (updated 2026-03-30) ──
// VERIFIED WINNERS:
//   take_it_now (rebounds): 95.0%        → P1
//   take_it_now (spreads): 94.9%         → P1 (same tier!)
//   combo props (PRA etc): 85-100%       → P2
//   line_about_to_move (points rising): 75% → P3
//   take_it_now (moneyline): 63.2%       → P4
//   velocity_spike (ML dropping): 57.9%  → P5
// KILLED:
//   velocity_spike (totals): 0-8%        → KILLED
//   velocity_spike (spreads): 0%         → KILLED
//   cascade: 0-24%                       → KILLED
//   snapback (points/3s): 0%             → KILLED

const KILLED_SIGNALS = new Set(["cascade"]);
// velocity_spike is now conditionally killed (see below)
const KILLED_VELOCITY_MARKETS = new Set(["totals", "spreads", "player_points", "player_threes", "player_rebounds"]);
// velocity_spike ONLY survives for moneyline dropping (57.9%)
function isKilledSignal(signalType: string, propType: string, direction?: string): boolean {
  if (KILLED_SIGNALS.has(signalType)) return true;
  if (signalType === "velocity_spike") {
    // Only moneyline dropping survives
    if (propType === "moneyline" && direction === "dropping") return false;
    return true;
  }
  return false;
}

const COMBO_PROPS = new Set([
  "player_points_rebounds_assists", "player_rebounds_assists",
  "player_points_assists", "player_points_rebounds",
]);
const CONTRARIAN_PROPS = new Set(["player_points", "player_threes"]);
const TEAM_MARKET_TYPES = new Set(["h2h", "moneyline", "spreads", "totals"]);

// Priority tiers for alert ordering (lower = sent first)
function getSignalPriority(record: any): number {
  const { signal_type, prop_type, predicted_direction } = record;
  // P0: perfect_line — matchup-based mispricing (highest priority)
  if (signal_type?.startsWith("perfect_line")) return 0;
  // P1: take_it_now rebounds (95%) + spreads (94.9%)
  if (signal_type === "take_it_now" && (prop_type === "player_rebounds" || prop_type === "spreads")) return 1;
  // P2: combo props (85-100%)
  if (COMBO_PROPS.has(prop_type)) return 2;
  // P3: line_about_to_move points rising (75% w/ contrarian flip)
  if (signal_type === "line_about_to_move" && prop_type === "player_points") return 3;
  // P4: take_it_now moneyline (63.2%)
  if (signal_type === "take_it_now" && prop_type === "moneyline") return 4;
  // P5: velocity_spike moneyline dropping (57.9%)
  if (signal_type === "velocity_spike" && prop_type === "moneyline" && predicted_direction === "dropping") return 5;
  // P6: take_it_now other props
  if (signal_type === "take_it_now") return 6;
  // P7: everything else
  return 7;
}
// Minimum velocity gates by prop — lowered for faster detection
const PROP_MIN_VELOCITY: Record<string, number> = {
  player_points: 1.0,
  player_rebounds: 0.8,
  player_threes: 0.8,
  player_points_rebounds_assists: 0.8,
  player_rebounds_assists: 0.8,
  player_points_assists: 0.8,
  player_points_rebounds: 0.8,
};

// Minimum drift gates for take_it_now — lowered for earlier alerts
const PROP_MIN_DRIFT_PCT: Record<string, number> = {
  player_rebounds: 4,
  player_points: 4,
  player_threes: 5,
};

// Format American odds for display
function fmtOdds(price: number | null | undefined): string {
  if (!price) return "";
  return price > 0 ? `+${price}` : `${price}`;
}

// Build the FanDuel line badge with odds
function fdLineBadge(line: number, overPrice: number | null, underPrice: number | null, side: string): string {
  const actionOdds = side === "OVER" ? overPrice : underPrice;
  const oddsStr = actionOdds ? ` (${fmtOdds(actionOdds)})` : "";
  return `📗 *FanDuel Line: ${line}${oddsStr}*`;
}

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
    log("=== Generating FanDuel prediction alerts (accuracy-gated v2) ===");

    const thirtyMinAgo = new Date(now.getTime() - 20 * 60 * 1000).toISOString(); // 20min window for faster detection
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

    if (!recentData || recentData.length === 0) {
      log("No recent data for alerts");
      return new Response(JSON.stringify({ success: true, alerts: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Exclude FINISHED games only (hours_to_tip <= -3)
    const activeData = recentData.filter((r: any) =>
      typeof r.hours_to_tip !== "number" || r.hours_to_tip > -3
    );
    log(`Filtered to ${activeData.length} active records (excluded ${recentData.length - activeData.length} finished)`);

    if (activeData.length === 0) {
      return new Response(JSON.stringify({ success: true, alerts: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const groups = new Map<string, any[]>();
    for (const row of activeData) {
      const key = `${row.event_id}|${row.player_name}|${row.prop_type}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    // Build matchup lookup
    const eventTeams = new Map<string, Set<string>>();
    for (const row of activeData) {
      if (TEAM_MARKET_TYPES.has(row.prop_type) && row.player_name !== "Game Total") {
        if (!eventTeams.has(row.event_id)) eventTeams.set(row.event_id, new Set());
        eventTeams.get(row.event_id)!.add(row.player_name);
      }
    }
    const eventMatchup = new Map<string, string>();
    for (const [eid, teams] of eventTeams) {
      const arr = Array.from(teams);
      eventMatchup.set(eid, arr.length >= 2 ? `${arr[0]} vs ${arr[1]}` : arr[0] || "Unknown");
    }

    // Track best signal per player
    const bestSignalPerPlayer = new Map<string, { confidence: number; alert: string; record: any }>();
    const addSignal = (playerKey: string, confidence: number, alert: string, record: any) => {
      const existing = bestSignalPerPlayer.get(playerKey);
      if (!existing || confidence > existing.confidence) {
        bestSignalPerPlayer.set(playerKey, { confidence, alert, record });
      }
    };

    const esc = (s: string) => (s || "").replace(/_/g, " ").replace(/\*/g, "");
    const isLive = (r: any) => r.snapshot_phase === "live" || (typeof r.hours_to_tip === "number" && r.hours_to_tip <= 0);

    // ====== SIGNAL: LINE ABOUT TO MOVE (accuracy-gated) ======
    // KILLED: velocity_spike and cascade — 15-36% and 11-24% accuracy
    // Only line_about_to_move survives for directional signals
    for (const [key, snapshots] of groups) {
      if (snapshots.length < 2) continue;

      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      const timeDiffMin = (new Date(last.snapshot_time).getTime() - new Date(first.snapshot_time).getTime()) / 60000;
      if (timeDiffMin < 3) continue; // reduced from 5 for faster detection

      const lineDiff = last.line - first.line;
      const absLineDiff = Math.abs(lineDiff);
      const velocityPerHour = (absLineDiff / timeDiffMin) * 60;

      const minVelocity = PROP_MIN_VELOCITY[first.prop_type] || 1.5;
      if (velocityPerHour < minVelocity) continue;

      const learnedPattern = (patterns || []).find(
        (p: any) => p.sport === first.sport && p.prop_type === first.prop_type && p.pattern_type === "velocity_spike"
      );
      const learnedAvgVelocity = learnedPattern?.velocity_threshold || 2.0;
      if (velocityPerHour <= learnedAvgVelocity * 0.8) continue;

      const direction = lineDiff < 0 ? "DROPPING" : "RISING";
      const isContrarian = CONTRARIAN_PROPS.has(first.prop_type);
      const rawSide = lineDiff < 0 ? "OVER" : "UNDER";
      const side = isContrarian ? (rawSide === "OVER" ? "UNDER" : "OVER") : rawSide;
      const isCombo = COMBO_PROPS.has(first.prop_type);
      const comboBoost = isCombo ? 15 : 0;
      const confidence = Math.min(95, 50 + velocityPerHour * 12 + comboBoost);
      const live = isLive(last);

      // Minimum confidence gate
      if (confidence < 60) continue;

      const elapsed = Math.round(timeDiffMin);
      const avgReaction = learnedPattern?.avg_reaction_time_minutes || 12;
      const remaining = Math.max(0, avgReaction - elapsed);

      // Accuracy badge based on historical data
      let accuracyBadge = "";
      if (first.prop_type === "player_rebounds" && first.signal_type !== "take_it_now") {
        accuracyBadge = "📈 Historical: 50-52%";
      } else if (first.prop_type === "player_points" && direction === "RISING") {
        accuracyBadge = "📈 Historical: 75% (contrarian rising)";
      } else if (first.prop_type === "player_points" && direction === "DROPPING") {
        accuracyBadge = "📈 Historical: 45% (contrarian dropping)";
      } else if (isCombo) {
        accuracyBadge = "🔥 Historical: 85-100% (combo prop)";
      }

      const reason = isContrarian
        ? (side === "UNDER"
          ? "🔄 Contrarian: line dropping historically favors UNDER"
          : "🔄 Contrarian: line rising historically favors OVER")
        : (direction === "DROPPING"
          ? "Line dropping = book expects fewer, value is OVER"
          : "Line rising = book expects more, value is UNDER");
      const liveTag = live ? " [🔴 LIVE]" : "";

      const isTeamMarket = TEAM_MARKET_TYPES.has(first.prop_type);
      const matchupLine = isTeamMarket ? eventMatchup.get(first.event_id) : null;
      const marketLabel = isTeamMarket
        ? `${esc(first.player_name)} ${esc(first.prop_type).toUpperCase()}`
        : `${esc(first.player_name)} ${esc(first.prop_type).replace("player ", "").toUpperCase()}`;

      const alertText = [
        `🔮 *${live ? "LINE MOVING NOW" : "LINE ABOUT TO MOVE"}*${liveTag} — ${esc(first.sport)}`,
        matchupLine ? `🏟 ${esc(matchupLine)}` : null,
        marketLabel,
        fdLineBadge(last.line, last.over_price, last.under_price, side),
        `Line ${direction}: ${first.line} → ${last.line}`,
        `Speed: ${velocityPerHour.toFixed(1)}/hr over ${elapsed}min`,
        live ? `⏱ In-game shift detected` : `⏱ ~${remaining}min window remaining`,
        `📊 Confidence: ${Math.round(confidence)}%`,
        accuracyBadge || null,
        `✅ *Action: ${side} ${last.line} ${fmtOdds(side === "OVER" ? last.over_price : last.under_price)}*`,
        `💡 ${reason}`,
        isCombo ? `🔥 *COMBO PROP* — 85-100% historical accuracy` : null,
      ].filter(Boolean).join("\n");

      const record = {
        signal_type: live ? "live_line_moving" : "line_about_to_move",
        sport: first.sport, prop_type: first.prop_type,
        player_name: first.player_name, event_id: first.event_id,
        prediction: `${side} ${last.line}`,
        predicted_direction: isContrarian ? (side === "OVER" ? "rising" : "dropping") : direction.toLowerCase(),
        predicted_magnitude: absLineDiff,
        confidence_at_signal: confidence,
        velocity_at_signal: velocityPerHour,
        time_to_tip_hours: last.hours_to_tip,
        edge_at_signal: absLineDiff,
        signal_factors: { velocityPerHour, timeDiffMin, lineDiff, learnedAvgVelocity },
      };

      addSignal(`${first.event_id}|${first.player_name}`, confidence, alertText, record);
    }

    // ====== SIGNAL: TAKE IT NOW (Snapback — 95% on rebounds) ======
    // KILLED for player_points (0% accuracy on snapback)
    // Only rebounds and combos survive
    const SNAPBACK_BLOCKED_PROPS = new Set(["player_points", "player_threes"]);

    for (const [key, snapshots] of groups) {
      const last = snapshots[snapshots.length - 1];
      if (!last.opening_line) continue;

      // Block snapback for points/3s — 0% and no data
      if (SNAPBACK_BLOCKED_PROPS.has(last.prop_type)) continue;

      const drift = last.line - last.opening_line;
      const absDrift = Math.abs(drift);
      const driftPct = (absDrift / last.opening_line) * 100;
      const minDrift = PROP_MIN_DRIFT_PCT[last.prop_type] || 6;

      if (driftPct < minDrift) continue;

      const snapDirection = drift > 0 ? "UNDER" : "OVER";
      const isCombo = COMBO_PROPS.has(last.prop_type);
      const comboBoost = isCombo ? 10 : 0;
      const confidence = Math.min(92, 30 + driftPct * 3 + comboBoost);
      const live = isLive(last);

      if (confidence < 55) continue;

      const reason = snapDirection === "UNDER"
        ? "Line inflated above open — expect snapback down"
        : "Line deflated below open — expect snapback up";
      const liveTag = live ? " [🔴 LIVE]" : "";

      // Accuracy badge
      const accBadge = last.prop_type === "player_rebounds"
        ? "🔥 Historical: 95.0% (37/39 verified)"
        : last.prop_type === "spreads"
        ? "🔥 Historical: 94.9% (37/39 verified)"
        : last.prop_type === "moneyline"
        ? "📈 Historical: 63.2% (12/19 verified)"
        : isCombo
        ? "🔥 Historical: 85-100% (combo prop snapback)"
        : "";

      const isTeamMarket = TEAM_MARKET_TYPES.has(last.prop_type);
      const matchupLine = isTeamMarket ? eventMatchup.get(last.event_id) : null;
      const marketLabel = isTeamMarket
        ? `${esc(last.player_name)} ${esc(last.prop_type).toUpperCase()}`
        : `${esc(last.player_name)} ${esc(last.prop_type).replace("player ", "").toUpperCase()}`;

      const alertText = [
        `💰 *${live ? "LIVE DRIFT" : "TAKE IT NOW"}*${liveTag} — ${esc(last.sport)}`,
        matchupLine ? `🏟 ${esc(matchupLine)}` : null,
        marketLabel,
        fdLineBadge(last.line, last.over_price, last.under_price, snapDirection),
        `Open: ${last.opening_line} → Now: ${last.line}`,
        `Drift: ${driftPct.toFixed(1)}% — historically snaps back`,
        `📊 Confidence: ${Math.round(confidence)}%`,
        accBadge || null,
        `✅ *Action: ${snapDirection} ${last.line} ${fmtOdds(snapDirection === "OVER" ? last.over_price : last.under_price)}*`,
        `💡 ${reason}`,
      ].filter(Boolean).join("\n");

      const record = {
        signal_type: live ? "live_drift" : "take_it_now",
        sport: last.sport, prop_type: last.prop_type,
        player_name: last.player_name, event_id: last.event_id,
        prediction: `${snapDirection} ${last.line}`,
        predicted_direction: "snapback",
        predicted_magnitude: absDrift,
        confidence_at_signal: confidence,
        time_to_tip_hours: last.hours_to_tip,
        edge_at_signal: driftPct,
        signal_factors: { opening_line: last.opening_line, current_line: last.line, driftPct },
      };

      addSignal(`${last.event_id}|${last.player_name}`, confidence, alertText, record);
    }

    // ====== SIGNAL: TRAP WARNING — fires faster, skips already-recommended lines ======
    // Collect player keys we already recommended a side on
    const alreadyRecommended = new Set<string>();
    for (const [pKey, entry] of bestSignalPerPlayer) {
      if (entry.record?.signal_type !== "trap_warning") {
        alreadyRecommended.add(pKey);
      }
    }

    for (const [key, snapshots] of groups) {
      if (snapshots.length < 2) continue; // reduced from 3 for faster detection

      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      const playerKey = `${first.event_id}|${first.player_name}`;

      // Skip trap warning if we already sent a pick/take-it-now for this player+event
      if (alreadyRecommended.has(playerKey)) continue;

      const live = isLive(last);
      const liveTag = live ? " [🔴 LIVE]" : "";

      // Detect reversal with lower threshold (0.3 instead of 0.5)
      if (snapshots.length >= 3) {
        const mid = snapshots[Math.floor(snapshots.length / 2)];
        const firstHalfDir = mid.line - first.line;
        const secondHalfDir = last.line - mid.line;

        if (
          Math.abs(firstHalfDir) >= 0.3 &&
          Math.abs(secondHalfDir) >= 0.3 &&
          Math.sign(firstHalfDir) !== Math.sign(secondHalfDir)
        ) {
          const isTeamMarket = TEAM_MARKET_TYPES.has(first.prop_type);
          const matchupLine = isTeamMarket ? eventMatchup.get(first.event_id) : null;
          const marketLabel = isTeamMarket
            ? `${esc(first.player_name)} ${esc(first.prop_type).toUpperCase()}`
            : `${esc(first.player_name)} ${esc(first.prop_type).replace("player ", "").toUpperCase()}`;

          const alertText = [
            `⚠️ *TRAP WARNING*${liveTag} — ${esc(first.sport)}`,
            matchupLine ? `🏟 ${esc(matchupLine)}` : null,
            marketLabel,
            `Line reversed: ${first.line} → ${mid.line} → ${last.line}`,
            `🚫 Sharp reversal pattern — DO NOT TOUCH`,
            `✅ *Action: STAY AWAY — both sides are dangerous*`,
            `💡 Book is manipulating this line to trap bettors`,
          ].filter(Boolean).join("\n");

          const record = {
            signal_type: "trap_warning",
            sport: first.sport, prop_type: first.prop_type,
            player_name: first.player_name, event_id: first.event_id,
            prediction: "TRAP — avoid",
            predicted_direction: "reversal",
            predicted_magnitude: Math.abs(firstHalfDir) + Math.abs(secondHalfDir),
            confidence_at_signal: 75,
            time_to_tip_hours: last.hours_to_tip,
            signal_factors: { firstLine: first.line, midLine: mid.line, lastLine: last.line },
          };

          bestSignalPerPlayer.set(playerKey, { confidence: 99, alert: alertText, record });
        }
      }
    }

    // Team market conflict guard
    const chosenTeamMarketSignals = new Map<string, { confidence: number; alert: string; record: any }>();
    const nonTeamSignals: Array<{ confidence: number; alert: string; record: any }> = [];

    for (const entry of bestSignalPerPlayer.values()) {
      const propType = entry.record?.prop_type;
      const eventId = entry.record?.event_id;

      if (!eventId || !TEAM_MARKET_TYPES.has(propType)) {
        nonTeamSignals.push(entry);
        continue;
      }

      const conflictKey = `${eventId}|${propType}`;
      const strength = Number(entry.record?.confidence_at_signal ?? entry.confidence ?? 0)
        + Number(entry.record?.velocity_at_signal ?? 0) * 0.1;

      const existing = chosenTeamMarketSignals.get(conflictKey);
      if (!existing || strength > existing.confidence) {
        chosenTeamMarketSignals.set(conflictKey, { ...entry, confidence: strength });
      }
    }

    // ── SORT BY PRIORITY: highest-accuracy signals first ──
    const selectedSignals = [
      ...nonTeamSignals,
      ...Array.from(chosenTeamMarketSignals.values()),
    ].sort((a, b) => getSignalPriority(a.record) - getSignalPriority(b.record));

    const telegramAlerts: string[] = [];
    const predictionRecords: any[] = [];
    for (const { alert, record } of selectedSignals) {
      telegramAlerts.push(alert);
      predictionRecords.push(record);
    }

    // Store prediction records
    if (predictionRecords.length > 0) {
      const { error } = await supabase.from("fanduel_prediction_accuracy").insert(predictionRecords);
      if (error) log(`⚠ Prediction insert error: ${error.message}`);
    }

    // Send Telegram alerts — paginated, priority-ordered
    if (telegramAlerts.length > 0) {
      const MAX_CHARS = 3800;
      const pages: string[][] = [];
      let currentPage: string[] = [];
      let currentLen = 0;

      for (const alert of telegramAlerts) {
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
          ? [`🎯 *FanDuel Predictions*${pageLabel}`, `${telegramAlerts.length} signal(s) — sorted by accuracy`, ""]
          : [`🎯 *Predictions${pageLabel}*`, ""];

        const msg = [...header, ...pages[i]].join("\n\n");

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
