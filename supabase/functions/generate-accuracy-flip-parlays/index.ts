import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// === Kill Gate + Auto-Flip logic (aligned with fanduel-prediction-alerts) ===

// Markets where velocity_spike is killed (spreads/totals only)
const KILLED_VELOCITY_MARKETS = new Set(["spreads", "totals", "spread", "total"]);

// All player prop types
const PLAYER_PROP_TYPES = new Set([
  "player_points", "player_rebounds", "player_assists",
  "player_threes", "player_blocks", "player_steals",
  "player_turnovers", "player_pts_rebs_asts",
  "player_pts_rebs", "player_pts_asts", "player_rebs_asts",
  "player_fantasy_score", "player_double_double",
  "Points", "Rebounds", "Assists", "3-Pointers Made",
  "Blocks", "Steals", "Turnovers", "Pts+Rebs+Asts",
  "Pts+Rebs", "Pts+Asts", "Rebs+Asts", "Fantasy Score",
  "Double Double",
]);

const isPlayerPropType = (propType: string): boolean => {
  if (PLAYER_PROP_TYPES.has(propType)) return true;
  const lower = (propType || "").toLowerCase();
  return lower.includes("player_") || lower.includes("points") ||
    lower.includes("rebounds") || lower.includes("assists") ||
    lower.includes("threes") || lower.includes("blocks") ||
    lower.includes("steals") || lower.includes("turnovers");
};

// Exact same kill logic as fanduel-prediction-alerts
const isKilledSignal = (signalType: string, propType: string): boolean => {
  // Kill velocity_spike on spreads/totals
  if (signalType === "velocity_spike" && KILLED_VELOCITY_MARKETS.has((propType || "").toLowerCase())) return true;
  // Kill all toxic signals on player props
  if (isPlayerPropType(propType)) {
    if (["velocity_spike", "live_velocity_spike", "line_about_to_move", "live_line_about_to_move"].includes(signalType)) return true;
  }
  return false;
};

const TEAM_MARKETS = ["moneyline", "spreads", "totals", "spread", "total", "money_line"];
const isTeamMarket = (propType: string) =>
  TEAM_MARKETS.some(m => (propType || "").toLowerCase().includes(m));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const log = (msg: string) => console.log(`[accuracy-flip-parlays] ${msg}`);

  try {
    log("=== Generating Accuracy-Based Flip 2-Leg Parlays (Kill Gate + Auto-Flip Aligned) ===");

    // 1. Get historical accuracy by signal_type + prop_type + sport (min 5 settled)
    const { data: allSettled, error: accErr } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("signal_type, prop_type, sport, was_correct, prediction")
      .not("was_correct", "is", null)
      .not("signal_type", "eq", "trap_warning");

    if (accErr) throw accErr;

    // Also get recent line movements to understand where money is going
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: recentMovements } = await supabase
      .from("line_movements")
      .select("event_id, description, market_type, bookmaker, price_change, point_change, drift_direction, books_consensus")
      .gte("detected_at", twoHoursAgo)
      .order("detected_at", { ascending: false })
      .limit(200);

    // Build money flow map: event_id → direction summary
    const moneyFlowMap = new Map<string, { direction: string; consensus: number; magnitude: number }>();
    if (recentMovements) {
      for (const mv of recentMovements) {
        if (!mv.event_id) continue;
        const existing = moneyFlowMap.get(mv.event_id);
        const mag = Math.abs(mv.price_change || 0);
        if (!existing || mag > existing.magnitude) {
          moneyFlowMap.set(mv.event_id, {
            direction: mv.drift_direction || (mv.price_change > 0 ? "up" : "down"),
            consensus: mv.books_consensus || 1,
            magnitude: mag,
          });
        }
      }
    }
    log(`Money flow data: ${moneyFlowMap.size} events tracked`);

    // Build accuracy map with side-level granularity (over vs under)
    interface AccuracyEntry {
      signal_type: string;
      prop_type: string;
      sport: string;
      wins: number;
      losses: number;
      total: number;
      accuracy: number;
      over_wins: number;
      over_total: number;
      under_wins: number;
      under_total: number;
    }

    const accMap = new Map<string, AccuracyEntry>();
    for (const r of allSettled || []) {
      const key = `${r.signal_type}|${r.prop_type}|${r.sport}`;
      if (!accMap.has(key)) {
        accMap.set(key, {
          signal_type: r.signal_type, prop_type: r.prop_type, sport: r.sport,
          wins: 0, losses: 0, total: 0, accuracy: 0,
          over_wins: 0, over_total: 0, under_wins: 0, under_total: 0,
        });
      }
      const entry = accMap.get(key)!;
      entry.total++;
      const isOver = (r.prediction || "").toLowerCase().includes("over");
      if (isOver) {
        entry.over_total++;
        if (r.was_correct) { entry.wins++; entry.over_wins++; }
        else entry.losses++;
      } else {
        entry.under_total++;
        if (r.was_correct) { entry.wins++; entry.under_wins++; }
        else entry.losses++;
      }
    }

    const accuracyList: AccuracyEntry[] = [];
    for (const entry of accMap.values()) {
      if (entry.total >= 5) {
        entry.accuracy = (entry.wins / entry.total) * 100;
        accuracyList.push(entry);
      }
    }
    accuracyList.sort((a, b) => b.accuracy - a.accuracy);

    const topPerformers = accuracyList.filter(a => a.accuracy >= 70);
    const bottomPerformers = accuracyList.filter(a => a.accuracy <= 40);

    log(`Top performers (>=70%): ${topPerformers.length}, Bottom performers (<=40%): ${bottomPerformers.length}`);

    if (topPerformers.length === 0 || bottomPerformers.length === 0) {
      return new Response(JSON.stringify({ success: true, parlays: 0, reason: "Not enough accuracy data" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Get today's unsettled predictions
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const { data: todayPicks, error: pickErr } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("*")
      .gte("created_at", todayStart.toISOString())
      .is("was_correct", null)
      .not("player_name", "is", null);

    if (pickErr) throw pickErr;

    log(`Today's pending picks: ${todayPicks?.length || 0}`);

    if (!todayPicks || todayPicks.length < 2) {
      return new Response(JSON.stringify({ success: true, parlays: 0, reason: "Not enough today's picks" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Classify picks with market trap awareness
    const topAccKeys = new Set(topPerformers.map(a => `${a.signal_type}|${a.prop_type}|${a.sport}`));
    const bottomAccMap = new Map(bottomPerformers.map(a => [`${a.signal_type}|${a.prop_type}|${a.sport}`, a]));

    interface EnrichedPick {
      id: string;
      player_name: string;
      prop_type: string;
      sport: string;
      signal_type: string;
      prediction: string;
      original_prediction: string; // what the signal originally said before any flip
      event_id: string;
      accuracy: number;
      accuracy_record: string;
      signal_factors: Record<string, any>;
      is_flip: boolean;
      flipped_prediction: string;
      line: number | null;
      over_price: number | null;
      under_price: number | null;
      trap_flag: string; // "none" | "auto_flipped" | "kill_gate_faded"
      money_direction: string; // where money is flowing
      over_accuracy: number | null;
      under_accuracy: number | null;
    }

    const bestLegs: EnrichedPick[] = [];
    const flipLegs: EnrichedPick[] = [];
    let trapFlips = 0;
    let trapSuppressed = 0;

    for (const pick of todayPicks) {
      const signalType = pick.signal_type || "";
      const propType = pick.prop_type || "";
      const accKey = `${signalType}|${propType}|${pick.sport}`;
      const sf = (pick.signal_factors || {}) as Record<string, any>;
      const predLower = (pick.prediction || "").toLowerCase();
      const isOver = predLower.includes("over");
      const isPlayerProp = isPlayerPropType(propType);

      // === KILL GATE: toxic signals on player props → route to flip bucket as fades ===
      // === Kill velocity_spike on spreads/totals → skip entirely (no value even as fade) ===
      if (signalType === "velocity_spike" && KILLED_VELOCITY_MARKETS.has(propType.toLowerCase())) {
        trapSuppressed++;
        log(`KILLED (team market velocity): ${pick.player_name} ${pick.prediction} ${propType} (${signalType}) — skipped`);
        continue;
      }

      const isKilledPlayerProp = isPlayerPropType(propType) &&
        ["velocity_spike", "live_velocity_spike", "line_about_to_move", "live_line_about_to_move"].includes(signalType);

      if (isKilledPlayerProp) {
        // Don't skip — route to flip bucket as a fade candidate
        const flippedPred = isOver
          ? (pick.prediction || "").replace(/over/i, "UNDER")
          : (pick.prediction || "").replace(/under/i, "OVER");

        const flow = moneyFlowMap.get(pick.event_id || "");
        const moneyDir = flow
          ? `${flow.direction} (${flow.consensus} book${flow.consensus > 1 ? "s" : ""}, Δ${flow.magnitude})`
          : "no data";
        const accEntry = accMap.get(accKey);
        const overAcc = accEntry && accEntry.over_total >= 3 ? (accEntry.over_wins / accEntry.over_total) * 100 : null;
        const underAcc = accEntry && accEntry.under_total >= 3 ? (accEntry.under_wins / accEntry.under_total) * 100 : null;

        const enriched: EnrichedPick = {
          id: pick.id,
          player_name: pick.player_name || "Unknown",
          prop_type: propType,
          sport: pick.sport || "",
          signal_type: signalType,
          prediction: flippedPred,
          original_prediction: pick.prediction || "",
          event_id: pick.event_id || "",
          accuracy: accEntry ? (accEntry.wins / accEntry.total) * 100 : 0,
          accuracy_record: accEntry ? `${accEntry.wins}-${accEntry.losses}` : "0-0",
          signal_factors: sf,
          is_flip: true,
          flipped_prediction: flippedPred,
          line: sf.line ?? sf.fanduel_line ?? null,
          over_price: sf.over_price ?? null,
          under_price: sf.under_price ?? null,
          trap_flag: "kill_gate_faded",
          money_direction: moneyDir,
          over_accuracy: overAcc,
          under_accuracy: underAcc,
        };
        trapFlips++;
        flipLegs.push(enriched);
        log(`KILL→FADE: ${pick.player_name} ${pick.prediction} → ${flippedPred} ${propType} (${signalType})`);
        continue;
      }

      // === CASCADE AUTO-FLIP: cascade + player prop + OVER → force to UNDER ===
      let effectivePrediction = pick.prediction || "";
      let effectiveIsOver = isOver;
      let autoFlipped = false;

      if (signalType === "cascade" && isPlayerProp && isOver) {
        effectivePrediction = effectivePrediction.replace(/over/i, "UNDER");
        effectiveIsOver = false;
        autoFlipped = true;
        trapFlips++;
        log(`CASCADE AUTO-FLIP: ${pick.player_name} ${pick.prediction} → ${effectivePrediction} (${propType})`);
      }

      const flippedPrediction = effectiveIsOver
        ? effectivePrediction.replace(/over/i, "UNDER")
        : effectivePrediction.replace(/under/i, "OVER");

      // Money flow context
      const flow = moneyFlowMap.get(pick.event_id || "");
      const moneyDir = flow
        ? `${flow.direction} (${flow.consensus} book${flow.consensus > 1 ? "s" : ""}, Δ${flow.magnitude})`
        : "no data";

      // Side-level accuracy from the map
      const accEntry = accMap.get(accKey);
      const overAcc = accEntry && accEntry.over_total >= 3
        ? (accEntry.over_wins / accEntry.over_total) * 100 : null;
      const underAcc = accEntry && accEntry.under_total >= 3
        ? (accEntry.under_wins / accEntry.under_total) * 100 : null;

      const trapFlag = autoFlipped ? "auto_flipped" : "none";

      const enriched: EnrichedPick = {
        id: pick.id,
        player_name: pick.player_name || "Unknown",
        prop_type: propType,
        sport: pick.sport || "",
        signal_type: signalType,
        prediction: effectivePrediction,
        original_prediction: pick.prediction || "",
        event_id: pick.event_id || "",
        accuracy: 0,
        accuracy_record: "",
        signal_factors: sf,
        is_flip: false,
        flipped_prediction: flippedPrediction,
        line: sf.line ?? sf.fanduel_line ?? null,
        over_price: sf.over_price ?? null,
        under_price: sf.under_price ?? null,
        trap_flag: trapFlag,
        money_direction: moneyDir,
        over_accuracy: overAcc,
        under_accuracy: underAcc,
      };

      // If auto-flipped cascade, route directly to flip bucket
      if (autoFlipped) {
        const acc = accMap.get(accKey);
        if (acc) {
          enriched.accuracy = (acc.wins / acc.total) * 100;
          enriched.accuracy_record = `${acc.wins}-${acc.losses}`;
        }
        enriched.is_flip = true;
        flipLegs.push(enriched);
        continue;
      }

      // Normal classification: best legs (high accuracy) or flip legs (low accuracy)
      if (topAccKeys.has(accKey)) {
        const acc = accuracyList.find(a => `${a.signal_type}|${a.prop_type}|${a.sport}` === accKey)!;
        enriched.accuracy = acc.accuracy;
        enriched.accuracy_record = `${acc.wins}-${acc.losses}`;
        enriched.is_flip = false;
        bestLegs.push(enriched);
      }

      if (bottomAccMap.has(accKey)) {
        const acc = bottomAccMap.get(accKey)!;
        enriched.accuracy = acc.accuracy;
        enriched.accuracy_record = `${acc.wins}-${acc.losses}`;
        enriched.is_flip = true;
        flipLegs.push(enriched);
      }
    }

    bestLegs.sort((a, b) => b.accuracy - a.accuracy);
    flipLegs.sort((a, b) => a.accuracy - b.accuracy);

    log(`Best legs: ${bestLegs.length}, Flip legs: ${flipLegs.length} (${trapFlips} trap-flipped, ${trapSuppressed} trap-suppressed)`);

    if (bestLegs.length === 0 || flipLegs.length === 0) {
      return new Response(JSON.stringify({
        success: true, parlays: 0,
        reason: `Need both high-accuracy (${bestLegs.length}) and flip (${flipLegs.length}) legs`,
        trap_flips: trapFlips,
        trap_suppressed: trapSuppressed,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Build parlays: pair best + flip, different events/players
    interface AccuracyFlipParlay {
      bestLeg: EnrichedPick;
      flipLeg: EnrichedPick;
    }

    const parlays: AccuracyFlipParlay[] = [];
    const usedIds = new Set<string>();

    for (const best of bestLegs) {
      if (usedIds.has(best.id)) continue;
      if (parlays.length >= 5) break;

      for (const flip of flipLegs) {
        if (usedIds.has(flip.id)) continue;
        if (best.player_name === flip.player_name) continue;
        if (best.event_id && flip.event_id && best.event_id === flip.event_id) continue;

        parlays.push({ bestLeg: best, flipLeg: flip });
        usedIds.add(best.id);
        usedIds.add(flip.id);
        break;
      }
    }

    log(`Built ${parlays.length} accuracy-flip parlays`);

    if (parlays.length === 0) {
      return new Response(JSON.stringify({ success: true, parlays: 0, reason: "No valid pairs found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Build Telegram message with money flow + trap context
    const SPORT_EMOJI: Record<string, string> = { NBA: "🏀", MLB: "⚾", NHL: "🏒", NCAAB: "🏀", NFL: "🏈" };

    const formatProp = (pt: string) =>
      pt.replace(/_/g, " ").replace(/player /i, "").replace(/\b\w/g, c => c.toUpperCase());

    const formatOdds = (price: number | null) => {
      if (price == null) return "";
      return price > 0 ? `+${price}` : `${price}`;
    };

    const trapLabel = (flag: string) => {
      if (flag === "auto_flipped") return " 🪤 TRAP→FLIP";
      if (flag === "kill_gate_faded") return " 🚫→🔄 KILL GATE FADE";
      if (flag === "trap_suppressed") return " 🪤 TRAP FADE";
      return "";
    };

    const msgLines: string[] = [
      `🎯🔄 *Accuracy + Flip 2-Leg Parlays*`,
      `_Leg 1: Best accuracy | Leg 2: Worst accuracy FLIPPED_`,
      `_🪤 Market trap logic active: player prop overs from velocity/cascade auto-faded_`,
      "",
    ];

    for (let i = 0; i < parlays.length; i++) {
      const p = parlays[i];
      const bestSf = p.bestLeg.signal_factors;
      const flipSf = p.flipLeg.signal_factors;

      const bestPredLower = (p.bestLeg.prediction || "").toLowerCase();
      const bestIsOver = bestPredLower.includes("over");
      const bestOdds = bestIsOver ? formatOdds(p.bestLeg.over_price) : formatOdds(p.bestLeg.under_price);

      const flipPredLower = (p.flipLeg.flipped_prediction || "").toLowerCase();
      const flipIsOver = flipPredLower.includes("over");
      const flipOdds = flipIsOver ? formatOdds(p.flipLeg.over_price) : formatOdds(p.flipLeg.under_price);

      const bestSport = SPORT_EMOJI[p.bestLeg.sport] || "🎯";
      const flipSport = SPORT_EMOJI[p.flipLeg.sport] || "🎯";
      const isCrossSport = p.bestLeg.sport !== p.flipLeg.sport;

      msgLines.push(`━━━ *Pair ${i + 1}* ${isCrossSport ? "🌍 Cross-Sport" : "🏟 Same-Sport"} ━━━`);
      msgLines.push("");

      // Leg 1: Best accuracy
      msgLines.push(`✅ *LEG 1 — BEST ACCURACY* ${bestSport}`);
      msgLines.push(`*${p.bestLeg.player_name}* ${p.bestLeg.prediction} ${formatProp(p.bestLeg.prop_type)}${bestOdds ? ` (${bestOdds})` : ""}`);
      msgLines.push(`📊 Signal: ${p.bestLeg.signal_type.replace(/_/g, " ")} | *${p.bestLeg.accuracy.toFixed(1)}%* (${p.bestLeg.accuracy_record})`);
      if (p.bestLeg.line != null) msgLines.push(`📗 FanDuel Line: ${p.bestLeg.line}`);
      if (p.bestLeg.over_accuracy != null && p.bestLeg.under_accuracy != null) {
        msgLines.push(`📉 Side accuracy: Over ${p.bestLeg.over_accuracy.toFixed(0)}% | Under ${p.bestLeg.under_accuracy.toFixed(0)}%`);
      }
      if (bestSf.avg_stat != null || bestSf.l10_avg != null) {
        const avg = bestSf.avg_stat ?? bestSf.l10_avg;
        msgLines.push(`📈 Avg: ${avg.toFixed ? avg.toFixed(1) : avg}${bestSf.hit_rate != null ? ` | Hit: ${(bestSf.hit_rate * 100).toFixed(0)}%` : ""}`);
      }
      if (p.bestLeg.money_direction !== "no data") {
        msgLines.push(`💰 Money flow: ${p.bestLeg.money_direction}`);
      }
      msgLines.push("");

      // Leg 2: Flipped (faded) — show original → flipped clearly
      const flipTrapLabel = trapLabel(p.flipLeg.trap_flag);
      const originalSide = (p.flipLeg.original_prediction || "").replace(/[0-9.]+/g, "").trim().toUpperCase();
      const flippedSide = (p.flipLeg.flipped_prediction || p.flipLeg.prediction || "").replace(/[0-9.]+/g, "").trim().toUpperCase();
      const lineVal = p.flipLeg.line != null ? ` ${p.flipLeg.line}` : "";

      msgLines.push(`🔄 *LEG 2 — FLIPPED (FADE)*${flipTrapLabel} ${flipSport}`);
      msgLines.push(`*${p.flipLeg.player_name}* ~${originalSide}~ → *${flippedSide}*${lineVal} ${formatProp(p.flipLeg.prop_type)}${flipOdds ? ` (${flipOdds})` : ""}`);
      msgLines.push(`📊 Original: ${p.flipLeg.signal_type.replace(/_/g, " ")} was *${p.flipLeg.accuracy.toFixed(1)}%* (${p.flipLeg.accuracy_record}) — FADING`);
      if (p.flipLeg.line != null) msgLines.push(`📗 FanDuel Line: ${p.flipLeg.line}`);
      if (p.flipLeg.over_accuracy != null && p.flipLeg.under_accuracy != null) {
        msgLines.push(`📉 Side accuracy: Over ${p.flipLeg.over_accuracy.toFixed(0)}% | Under ${p.flipLeg.under_accuracy.toFixed(0)}%`);
      }
      if (flipSf.avg_stat != null || flipSf.l10_avg != null) {
        const avg = flipSf.avg_stat ?? flipSf.l10_avg;
        msgLines.push(`📈 Avg: ${avg.toFixed ? avg.toFixed(1) : avg}${flipSf.hit_rate != null ? ` | Hit: ${(flipSf.hit_rate * 100).toFixed(0)}%` : ""}`);
      }
      if (p.flipLeg.money_direction !== "no data") {
        msgLines.push(`💰 Money flow: ${p.flipLeg.money_direction}`);
      }
      msgLines.push("");
    }

    msgLines.push(`_Strategy: Ride the best, fade the worst + trap-aware_`);
    msgLines.push(`_${bestLegs.length} high-acc + ${flipLegs.length} flip legs (${trapFlips} trap-flipped)_`);

    const message = msgLines.join("\n");

    // 6. Save to tracking table
    const trackingRows = parlays.map(p => ({
      parlay_date: new Date().toISOString().split("T")[0],
      best_leg_player: p.bestLeg.player_name,
      best_leg_prop_type: p.bestLeg.prop_type,
      best_leg_sport: p.bestLeg.sport,
      best_leg_signal_type: p.bestLeg.signal_type,
      best_leg_prediction: p.bestLeg.prediction,
      best_leg_accuracy: p.bestLeg.accuracy,
      best_leg_line: p.bestLeg.line,
      flip_leg_player: p.flipLeg.player_name,
      flip_leg_prop_type: p.flipLeg.prop_type,
      flip_leg_sport: p.flipLeg.sport,
      flip_leg_signal_type: p.flipLeg.signal_type,
      flip_leg_original_prediction: p.flipLeg.prediction,
      flip_leg_flipped_prediction: p.flipLeg.flipped_prediction,
      flip_leg_original_accuracy: p.flipLeg.accuracy,
      flip_leg_line: p.flipLeg.line,
    }));

    const { error: trackErr } = await supabase
      .from("accuracy_flip_parlay_tracking")
      .insert(trackingRows);

    if (trackErr) log(`Tracking insert error: ${trackErr.message}`);
    else log(`Saved ${trackingRows.length} parlays to tracking ✅`);

    // 7. Send via Telegram
    try {
      await supabase.functions.invoke("bot-send-telegram", {
        body: { message, parse_mode: "Markdown", admin_only: true },
      });
      log("Telegram digest sent ✅");
    } catch (tgErr: any) {
      log(`Telegram send error: ${tgErr.message}`);
    }

    return new Response(JSON.stringify({
      success: true,
      parlays: parlays.length,
      best_legs_available: bestLegs.length,
      flip_legs_available: flipLegs.length,
      trap_flips: trapFlips,
      trap_suppressed: trapSuppressed,
      tracked: !trackErr,
      pairs: parlays.map(p => ({
        best: `${p.bestLeg.player_name} ${p.bestLeg.prediction} (${p.bestLeg.accuracy.toFixed(1)}%)`,
        flip: `${p.flipLeg.player_name} ${p.flipLeg.flipped_prediction} (fading ${p.flipLeg.accuracy.toFixed(1)}%)${p.flipLeg.trap_flag !== "none" ? " 🪤" : ""}`,
      })),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    log(`Error: ${error.message}`);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
