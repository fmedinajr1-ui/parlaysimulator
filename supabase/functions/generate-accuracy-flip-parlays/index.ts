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

  const log = (msg: string) => console.log(`[accuracy-flip-parlays] ${msg}`);

  try {
    log("=== Generating Accuracy-Based Flip 2-Leg Parlays ===");

    // 1. Get historical accuracy by signal_type + prop_type + sport (min 5 settled)
    const { data: allSettled, error: accErr } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("signal_type, prop_type, sport, was_correct, prediction")
      .not("was_correct", "is", null)
      .not("signal_type", "eq", "trap_warning"); // trap_warning is informational

    if (accErr) throw accErr;

    // Build accuracy map
    interface AccuracyEntry {
      signal_type: string;
      prop_type: string;
      sport: string;
      wins: number;
      losses: number;
      total: number;
      accuracy: number;
    }

    const accMap = new Map<string, AccuracyEntry>();
    for (const r of allSettled || []) {
      const key = `${r.signal_type}|${r.prop_type}|${r.sport}`;
      if (!accMap.has(key)) {
        accMap.set(key, {
          signal_type: r.signal_type,
          prop_type: r.prop_type,
          sport: r.sport,
          wins: 0, losses: 0, total: 0, accuracy: 0,
        });
      }
      const entry = accMap.get(key)!;
      entry.total++;
      if (r.was_correct) entry.wins++;
      else entry.losses++;
    }

    // Calculate accuracy and filter min 5 samples
    const accuracyList: AccuracyEntry[] = [];
    for (const entry of accMap.values()) {
      if (entry.total >= 5) {
        entry.accuracy = (entry.wins / entry.total) * 100;
        accuracyList.push(entry);
      }
    }

    accuracyList.sort((a, b) => b.accuracy - a.accuracy);

    // Top performers (>= 70% accuracy) and bottom performers (<= 40% accuracy for flip)
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

    // 3. Classify today's picks into "best accuracy" and "worst accuracy (flip candidates)"
    const topAccKeys = new Set(topPerformers.map(a => `${a.signal_type}|${a.prop_type}|${a.sport}`));
    const bottomAccMap = new Map(bottomPerformers.map(a => [`${a.signal_type}|${a.prop_type}|${a.sport}`, a]));

    interface EnrichedPick {
      id: string;
      player_name: string;
      prop_type: string;
      sport: string;
      signal_type: string;
      prediction: string;
      event_id: string;
      accuracy: number;
      accuracy_record: string;
      signal_factors: Record<string, any>;
      is_flip: boolean;
      flipped_prediction: string;
      line: number | null;
      over_price: number | null;
      under_price: number | null;
    }

    const bestLegs: EnrichedPick[] = [];
    const flipLegs: EnrichedPick[] = [];

    for (const pick of todayPicks) {
      const accKey = `${pick.signal_type}|${pick.prop_type}|${pick.sport}`;
      const sf = (pick.signal_factors || {}) as Record<string, any>;

      const predLower = (pick.prediction || "").toLowerCase();
      const isOver = predLower.includes("over");
      const flippedPrediction = isOver
        ? pick.prediction.replace(/over/i, "UNDER")
        : pick.prediction.replace(/under/i, "OVER");

      const enriched: EnrichedPick = {
        id: pick.id,
        player_name: pick.player_name || "Unknown",
        prop_type: pick.prop_type || "",
        sport: pick.sport || "",
        signal_type: pick.signal_type || "",
        prediction: pick.prediction || "",
        event_id: pick.event_id || "",
        accuracy: 0,
        accuracy_record: "",
        signal_factors: sf,
        is_flip: false,
        flipped_prediction: flippedPrediction,
        line: sf.line ?? sf.fanduel_line ?? null,
        over_price: sf.over_price ?? null,
        under_price: sf.under_price ?? null,
      };

      // Check if this pick falls in a top-accuracy bucket
      if (topAccKeys.has(accKey)) {
        const acc = accuracyList.find(a => `${a.signal_type}|${a.prop_type}|${a.sport}` === accKey)!;
        enriched.accuracy = acc.accuracy;
        enriched.accuracy_record = `${acc.wins}-${acc.losses}`;
        enriched.is_flip = false;
        bestLegs.push(enriched);
      }

      // Check if this pick falls in a bottom-accuracy bucket (flip candidate)
      if (bottomAccMap.has(accKey)) {
        const acc = bottomAccMap.get(accKey)!;
        enriched.accuracy = acc.accuracy;
        enriched.accuracy_record = `${acc.wins}-${acc.losses}`;
        enriched.is_flip = true;
        flipLegs.push(enriched);
      }
    }

    // Sort best by accuracy desc, flips by accuracy asc (worst first = best flip)
    bestLegs.sort((a, b) => b.accuracy - a.accuracy);
    flipLegs.sort((a, b) => a.accuracy - b.accuracy);

    log(`Best legs (verified, >=70%): ${bestLegs.length}, Flip legs (verified, <=40%): ${flipLegs.length}`);

    if (bestLegs.length === 0 || flipLegs.length === 0) {
      return new Response(JSON.stringify({
        success: true, parlays: 0,
        reason: `Need both high-accuracy (${bestLegs.length}) and low-accuracy flip (${flipLegs.length}) legs`,
        top_performers: topPerformers.slice(0, 5).map(t => `${t.signal_type}|${t.prop_type}|${t.sport}: ${t.accuracy.toFixed(1)}%`),
        bottom_performers: bottomPerformers.slice(0, 5).map(b => `${b.signal_type}|${b.prop_type}|${b.sport}: ${b.accuracy.toFixed(1)}%`),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Build parlays: pair best + flip, different events/players
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

    // 6. Build Telegram message
    const SPORT_EMOJI: Record<string, string> = { NBA: "🏀", MLB: "⚾", NHL: "🏒", NCAAB: "🏀", NFL: "🏈" };

    const formatProp = (pt: string) =>
      pt.replace(/_/g, " ").replace(/player /i, "").replace(/\b\w/g, c => c.toUpperCase());

    const formatOdds = (price: number | null) => {
      if (price == null) return "";
      return price > 0 ? `+${price}` : `${price}`;
    };

    const msgLines: string[] = [
      `🎯🔄 *Accuracy + Flip 2-Leg Parlays*`,
      `_Leg 1: Highest accuracy signal | Leg 2: Lowest accuracy FLIPPED_`,
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
      msgLines.push(`📊 Signal: ${p.bestLeg.signal_type.replace(/_/g, " ")} | *${p.bestLeg.accuracy.toFixed(1)}%* accuracy (${p.bestLeg.accuracy_record})`);
      if (p.bestLeg.line != null) {
        msgLines.push(`📗 FanDuel Line: ${p.bestLeg.line}`);
      }
      if (bestSf.avg_stat != null || bestSf.l10_avg != null) {
        const avg = bestSf.avg_stat ?? bestSf.l10_avg;
        msgLines.push(`📈 Avg: ${avg.toFixed ? avg.toFixed(1) : avg}${bestSf.hit_rate != null ? ` | Hit Rate: ${(bestSf.hit_rate * 100).toFixed(0)}%` : ""}`);
      }
      msgLines.push("");

      // Leg 2: Flipped (faded)
      msgLines.push(`🔄 *LEG 2 — FLIPPED (FADE)* ${flipSport}`);
      msgLines.push(`*${p.flipLeg.player_name}* ${p.flipLeg.flipped_prediction} ${formatProp(p.flipLeg.prop_type)}${flipOdds ? ` (${flipOdds})` : ""}`);
      msgLines.push(`📊 Original signal: ${p.flipLeg.signal_type.replace(/_/g, " ")} was *${p.flipLeg.accuracy.toFixed(1)}%* (${p.flipLeg.accuracy_record}) — FADING IT`);
      if (p.flipLeg.line != null) {
        msgLines.push(`📗 FanDuel Line: ${p.flipLeg.line}`);
      }
      if (flipSf.avg_stat != null || flipSf.l10_avg != null) {
        const avg = flipSf.avg_stat ?? flipSf.l10_avg;
        msgLines.push(`📈 Avg: ${avg.toFixed ? avg.toFixed(1) : avg}${flipSf.hit_rate != null ? ` | Hit Rate: ${(flipSf.hit_rate * 100).toFixed(0)}%` : ""}`);
      }
      msgLines.push("");
    }

    msgLines.push(`_Strategy: Ride the best, fade the worst_`);
    msgLines.push(`_${bestLegs.length} high-accuracy + ${flipLegs.length} flip candidates available_`);

    const message = msgLines.join("\n");

    // 7. Save to tracking table for calibration
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

    if (trackErr) {
      log(`Tracking insert error: ${trackErr.message}`);
    } else {
      log(`Saved ${trackingRows.length} parlays to tracking table ✅`);
    }

    // 8. Send via Telegram
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
      tracked: !trackErr,
      pairs: parlays.map(p => ({
        best: `${p.bestLeg.player_name} ${p.bestLeg.prediction} (${p.bestLeg.accuracy.toFixed(1)}%)`,
        flip: `${p.flipLeg.player_name} ${p.flipLeg.flipped_prediction} (fading ${p.flipLeg.accuracy.toFixed(1)}%)`,
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
