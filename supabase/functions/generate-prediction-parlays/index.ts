import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PredictionPick {
  id: string;
  player_name: string;
  prop_type: string;
  sport: string;
  prediction: string;
  signal_type: string;
  confidence_at_signal: number;
  edge_at_signal: number;
  event_id: string;
  created_at: string;
  signal_accuracy: number;
  signal_sample_size: number;
}

interface TwoLegParlay {
  id: string;
  leg1: PredictionPick;
  leg2: PredictionPick;
  combined_accuracy: number;
  combined_confidence: number;
  sports: string[];
  strategy: string;
}

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
    log("=== Generating 2-Leg Prediction Parlays ===");

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    // 1. Get accuracy stats per signal_type (only those with enough sample size)
    const { data: allVerified } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("signal_type, sport, prop_type, was_correct")
      .not("was_correct", "is", null);

    if (!allVerified || allVerified.length === 0) {
      return new Response(JSON.stringify({ success: true, parlays: [], reason: "No verified predictions yet" }), {
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

    log(`Signal accuracy stats: ${JSON.stringify(signalStats)}`);

    // Only consider signal types with >= 10 samples and >= 55% accuracy
    const qualifiedSignals = Object.entries(signalStats)
      .filter(([_, s]) => s.total >= 10 && s.accuracy >= 0.55)
      .map(([type, s]) => ({ type, ...s }))
      .sort((a, b) => b.accuracy - a.accuracy);

    log(`Qualified signals (≥55% acc, ≥10 sample): ${qualifiedSignals.map(s => `${s.type}=${(s.accuracy*100).toFixed(1)}%`).join(', ')}`);

    if (qualifiedSignals.length === 0) {
      return new Response(JSON.stringify({ success: true, parlays: [], reason: "No signal types meet accuracy threshold" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const qualifiedSignalTypes = qualifiedSignals.map(s => s.type);

    // 2. Get today's predictions from qualified signal types
    const { data: todayPredictions } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("*")
      .gte("created_at", todayStart.toISOString())
      .is("was_correct", null) // Not yet settled
      .in("signal_type", qualifiedSignalTypes)
      .not("player_name", "is", null)
      .order("confidence_at_signal", { ascending: false });

    if (!todayPredictions || todayPredictions.length < 2) {
      return new Response(JSON.stringify({ success: true, parlays: [], reason: "Not enough qualifying predictions today" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    log(`Found ${todayPredictions.length} today's predictions from qualified signals`);

    // Enrich with signal accuracy
    const enrichedPicks: PredictionPick[] = todayPredictions.map(p => {
      const stats = signalStats[p.signal_type] || { accuracy: 0, total: 0 };
      return {
        id: p.id,
        player_name: p.player_name || 'Unknown',
        prop_type: p.prop_type,
        sport: p.sport,
        prediction: p.prediction,
        signal_type: p.signal_type,
        confidence_at_signal: p.confidence_at_signal || 50,
        edge_at_signal: p.edge_at_signal || 0,
        event_id: p.event_id || '',
        created_at: p.created_at,
        signal_accuracy: stats.accuracy,
        signal_sample_size: stats.total,
      };
    });

    // Sort by (signal_accuracy * confidence) descending
    enrichedPicks.sort((a, b) => 
      (b.signal_accuracy * b.confidence_at_signal) - (a.signal_accuracy * a.confidence_at_signal)
    );

    // 3. Build 2-leg parlays: pair picks from DIFFERENT events for diversification
    const parlays: TwoLegParlay[] = [];
    const usedPickIds = new Set<string>();

    // Strategy 1: Cross-sport pairs (highest priority)
    for (let i = 0; i < enrichedPicks.length && parlays.length < 3; i++) {
      if (usedPickIds.has(enrichedPicks[i].id)) continue;
      for (let j = i + 1; j < enrichedPicks.length && parlays.length < 3; j++) {
        if (usedPickIds.has(enrichedPicks[j].id)) continue;
        const a = enrichedPicks[i];
        const b = enrichedPicks[j];

        // Must be different events
        if (a.event_id && b.event_id && a.event_id === b.event_id) continue;
        // Must be different players
        if (a.player_name === b.player_name) continue;

        // Cross-sport bonus
        const isCrossSport = a.sport !== b.sport;
        if (!isCrossSport) continue;

        const combinedAccuracy = (a.signal_accuracy + b.signal_accuracy) / 2;
        const combinedConfidence = (a.confidence_at_signal + b.confidence_at_signal) / 2;

        parlays.push({
          id: `pred-cross-${a.id.slice(0, 8)}-${b.id.slice(0, 8)}`,
          leg1: a,
          leg2: b,
          combined_accuracy: combinedAccuracy,
          combined_confidence: combinedConfidence,
          sports: [...new Set([a.sport, b.sport])],
          strategy: "cross-sport",
        });

        usedPickIds.add(a.id);
        usedPickIds.add(b.id);
        break;
      }
    }

    // Strategy 2: Same-sport but different games (fill remaining slots)
    for (let i = 0; i < enrichedPicks.length && parlays.length < 5; i++) {
      if (usedPickIds.has(enrichedPicks[i].id)) continue;
      for (let j = i + 1; j < enrichedPicks.length && parlays.length < 5; j++) {
        if (usedPickIds.has(enrichedPicks[j].id)) continue;
        const a = enrichedPicks[i];
        const b = enrichedPicks[j];

        if (a.event_id && b.event_id && a.event_id === b.event_id) continue;
        if (a.player_name === b.player_name) continue;

        const combinedAccuracy = (a.signal_accuracy + b.signal_accuracy) / 2;
        const combinedConfidence = (a.confidence_at_signal + b.confidence_at_signal) / 2;

        parlays.push({
          id: `pred-same-${a.id.slice(0, 8)}-${b.id.slice(0, 8)}`,
          leg1: a,
          leg2: b,
          combined_accuracy: combinedAccuracy,
          combined_confidence: combinedConfidence,
          sports: [...new Set([a.sport, b.sport])],
          strategy: a.sport === b.sport ? "same-sport" : "cross-sport",
        });

        usedPickIds.add(a.id);
        usedPickIds.add(b.id);
        break;
      }
    }

    // Sort parlays by combined accuracy
    parlays.sort((a, b) => b.combined_accuracy - a.combined_accuracy);

    log(`Generated ${parlays.length} 2-leg prediction parlays`);

    return new Response(JSON.stringify({ 
      success: true, 
      parlays,
      signal_stats: qualifiedSignals.map(s => ({
        signal_type: s.type,
        accuracy: Math.round(s.accuracy * 100),
        sample_size: s.total,
      })),
      total_predictions_today: todayPredictions.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    log(`Error: ${error.message}`);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
