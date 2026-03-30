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

  const log = (msg: string) => console.log(`[prediction-parlays] ${msg}`);

  try {
    log("=== Generating 2-Leg Prediction Parlays (Telegram Digest) ===");

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    // 1. Get accuracy stats per signal_type (≥10 samples)
    const { data: allVerified } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("signal_type, sport, prop_type, was_correct")
      .not("was_correct", "is", null);

    if (!allVerified || allVerified.length === 0) {
      log("No verified predictions yet — skipping");
      return new Response(JSON.stringify({ success: true, parlays: 0, reason: "No verified data" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate accuracy by signal_type
    const signalStats: Record<string, { wins: number; total: number; accuracy: number }> = {};
    for (const row of allVerified) {
      const key = row.signal_type;
      if (!signalStats[key]) signalStats[key] = { wins: 0, total: 0, accuracy: 0 };
      signalStats[key].total++;
      if (row.was_correct) signalStats[key].wins++;
    }
    for (const key of Object.keys(signalStats)) {
      signalStats[key].accuracy = signalStats[key].total > 0
        ? signalStats[key].wins / signalStats[key].total
        : 0;
    }

    // Only signal types with ≥10 samples and ≥55% accuracy
    const qualifiedSignals = Object.entries(signalStats)
      .filter(([_, s]) => s.total >= 10 && s.accuracy >= 0.55)
      .map(([type, s]) => ({ type, ...s }))
      .sort((a, b) => b.accuracy - a.accuracy);

    log(`Qualified signals: ${qualifiedSignals.map(s => `${s.type}=${(s.accuracy * 100).toFixed(1)}%`).join(', ')}`);

    if (qualifiedSignals.length === 0) {
      log("No signal types meet accuracy threshold");
      return new Response(JSON.stringify({ success: true, parlays: 0, reason: "No qualified signals" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const qualifiedSignalTypes = qualifiedSignals.map(s => s.type);

    // 2. Get today's unsettled predictions from qualified signal types
    const { data: todayPredictions } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("*")
      .gte("created_at", todayStart.toISOString())
      .is("was_correct", null)
      .in("signal_type", qualifiedSignalTypes)
      .not("player_name", "is", null)
      .order("confidence_at_signal", { ascending: false });

    if (!todayPredictions || todayPredictions.length < 2) {
      log(`Only ${todayPredictions?.length || 0} predictions today — need ≥2`);
      return new Response(JSON.stringify({ success: true, parlays: 0, reason: "Not enough predictions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    log(`Found ${todayPredictions.length} today's predictions from qualified signals`);

    // 2b. Cross-reference against unified_props for REAL verified FanDuel lines
    const { data: verifiedProps } = await supabase
      .from("unified_props")
      .select("player_name, prop_type, line, has_real_line")
      .eq("has_real_line", true);

    const verifiedLineKeys = new Set<string>();
    if (verifiedProps) {
      for (const vp of verifiedProps) {
        const key = `${(vp.player_name || "").toLowerCase().trim()}|${(vp.prop_type || "").toLowerCase().trim()}`;
        verifiedLineKeys.add(key);
      }
    }
    log(`Verified FanDuel lines in unified_props: ${verifiedLineKeys.size}`);

    // Filter predictions to only those with verified real FanDuel lines
    const verifiedPredictions = todayPredictions.filter(p => {
      const playerName = (p.player_name || "").toLowerCase().trim();
      const propType = (p.prop_type || "").toLowerCase().trim();
      const key = `${playerName}|${propType}`;
      return verifiedLineKeys.has(key);
    });

    log(`After FanDuel line verification: ${verifiedPredictions.length}/${todayPredictions.length} predictions have real lines`);

    if (verifiedPredictions.length < 2) {
      log(`Only ${verifiedPredictions.length} verified predictions — need ≥2`);
      return new Response(JSON.stringify({ success: true, parlays: 0, reason: "Not enough verified FanDuel lines" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Enrich picks
    interface EnrichedPick {
      id: string;
      player_name: string;
      prop_type: string;
      sport: string;
      prediction: string;
      signal_type: string;
      confidence: number;
      edge: number;
      event_id: string;
      signal_accuracy: number;
      signal_sample: number;
    }

    const picks: EnrichedPick[] = todayPredictions.map(p => {
      const stats = signalStats[p.signal_type] || { accuracy: 0, total: 0 };
      return {
        id: p.id,
        player_name: p.player_name || "Unknown",
        prop_type: p.prop_type,
        sport: p.sport,
        prediction: p.prediction,
        signal_type: p.signal_type,
        confidence: p.confidence_at_signal || 50,
        edge: p.edge_at_signal || 0,
        event_id: p.event_id || "",
        signal_accuracy: stats.accuracy,
        signal_sample: stats.total,
      };
    });

    // Sort by composite score (accuracy × confidence)
    picks.sort((a, b) =>
      (b.signal_accuracy * b.confidence) - (a.signal_accuracy * a.confidence)
    );

    // 3. Build 2-leg parlays: different events, different players
    interface TwoLegParlay {
      leg1: EnrichedPick;
      leg2: EnrichedPick;
      combined_accuracy: number;
      strategy: string;
    }

    const parlays: TwoLegParlay[] = [];
    const usedIds = new Set<string>();

    const tryPair = (strategy: string, crossSportOnly: boolean, maxParlays: number) => {
      for (let i = 0; i < picks.length && parlays.length < maxParlays; i++) {
        if (usedIds.has(picks[i].id)) continue;
        for (let j = i + 1; j < picks.length && parlays.length < maxParlays; j++) {
          if (usedIds.has(picks[j].id)) continue;
          const a = picks[i], b = picks[j];

          // Different events
          if (a.event_id && b.event_id && a.event_id === b.event_id) continue;
          // Different players
          if (a.player_name === b.player_name) continue;
          // Cross-sport filter
          if (crossSportOnly && a.sport === b.sport) continue;

          parlays.push({
            leg1: a,
            leg2: b,
            combined_accuracy: (a.signal_accuracy + b.signal_accuracy) / 2,
            strategy,
          });
          usedIds.add(a.id);
          usedIds.add(b.id);
          break;
        }
      }
    };

    // Priority: cross-sport pairs first, then same-sport
    tryPair("Cross-Sport", true, 3);
    tryPair("Same-Sport", false, 5);

    parlays.sort((a, b) => b.combined_accuracy - a.combined_accuracy);

    log(`Built ${parlays.length} 2-leg prediction parlays`);

    if (parlays.length === 0) {
      return new Response(JSON.stringify({ success: true, parlays: 0, reason: "No valid pairs" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Build Telegram digest
    const SPORT_EMOJI: Record<string, string> = {
      NBA: "🏀", MLB: "⚾", NHL: "🏒", NCAAB: "🏀", NFL: "🏈",
    };

    const formatProp = (pt: string) =>
      pt.replace(/_/g, " ").replace(/player /i, "").replace(/\b\w/g, c => c.toUpperCase());

    const lines: string[] = [
      `🎯 *2-Leg Prediction Parlays*`,
      `${parlays.length} pair(s) from top-accuracy FanDuel signals`,
      "",
    ];

    // Signal accuracy overview
    const statsLine = qualifiedSignals
      .slice(0, 5)
      .map(s => `${s.type}: ${(s.accuracy * 100).toFixed(0)}% (n=${s.total})`)
      .join(" · ");
    lines.push(`📊 _${statsLine}_`);
    lines.push("");

    for (let i = 0; i < parlays.length; i++) {
      const p = parlays[i];
      const { leg1, leg2 } = p;

      const e1 = SPORT_EMOJI[leg1.sport] || "🎯";
      const e2 = SPORT_EMOJI[leg2.sport] || "🎯";

      const formatPropLabel = (leg: EnrichedPick) => {
        const pt = leg.prop_type
          ? leg.prop_type.replace(/_/g, " ").replace(/player /i, "").replace(/\b\w/g, c => c.toUpperCase())
          : "";
        return pt ? ` ${pt}` : "";
      };

      lines.push(`━━━ *Pair ${i + 1}* — ${p.strategy} ━━━`);
      lines.push(
        `${e1} *${leg1.player_name}* (${leg1.sport})`,
        `   ${leg1.prediction}${formatPropLabel(leg1)}`,
        `   Signal: ${leg1.signal_type} · ${(leg1.signal_accuracy * 100).toFixed(0)}% acc · Edge: ${leg1.edge > 0 ? "+" : ""}${leg1.edge.toFixed(1)}`,
        "",
        `${e2} *${leg2.player_name}* (${leg2.sport})`,
        `   ${leg2.prediction}${formatPropLabel(leg2)}`,
        `   Signal: ${leg2.signal_type} · ${(leg2.signal_accuracy * 100).toFixed(0)}% acc · Edge: ${leg2.edge > 0 ? "+" : ""}${leg2.edge.toFixed(1)}`,
        "",
        `Combined Accuracy: *${(p.combined_accuracy * 100).toFixed(0)}%*`,
        ""
      );
    }

    lines.push(`_Generated from ${todayPredictions.length} active predictions_`);

    const message = lines.join("\n");

    // 5. Send via Telegram
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
      predictions_used: todayPredictions.length,
      qualified_signals: qualifiedSignals.length,
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
