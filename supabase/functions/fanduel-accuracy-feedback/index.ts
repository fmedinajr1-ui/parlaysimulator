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

  const log = (msg: string) => console.log(`[Accuracy Feedback] ${msg}`);
  const now = new Date();

  try {
    log("=== Starting nightly accuracy feedback loop ===");

    // 1. Get unverified predictions from the last 48 hours
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const { data: unverified, error: fetchErr } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("*")
      .is("was_correct", null)
      .gte("created_at", twoDaysAgo)
      .limit(500);

    if (fetchErr) throw new Error(`Fetch unverified: ${fetchErr.message}`);

    log(`Found ${unverified?.length || 0} unverified predictions`);

    // 2. For each prediction, try to verify against settled data
    let verified = 0;
    let correct = 0;
    let incorrect = 0;

    for (const pred of unverified || []) {
      // Skip trap warnings — they're informational, not directional predictions
      if (pred.signal_type === "trap_warning") {
        await supabase
          .from("fanduel_prediction_accuracy")
          .update({ was_correct: null, actual_outcome: "informational", verified_at: now.toISOString() })
          .eq("id", pred.id);
        continue;
      }

      // Look up the closing line from timeline (latest snapshot for this event+player+prop)
      const { data: closingSnaps } = await supabase
        .from("fanduel_line_timeline")
        .select("line, over_price, under_price, snapshot_phase, opening_line")
        .eq("event_id", pred.event_id)
        .eq("player_name", pred.player_name)
        .eq("prop_type", pred.prop_type)
        .order("snapshot_time", { ascending: false })
        .limit(1);

      if (!closingSnaps || closingSnaps.length === 0) continue;

      const closing = closingSnaps[0];

      // Also check actual game results from player_game_logs if available
      const { data: gameLog } = await supabase
        .from("player_game_logs")
        .select("pts, reb, ast, fg3m, blk, stl")
        .ilike("player_name", `%${pred.player_name}%`)
        .gte("game_date", twoDaysAgo)
        .limit(1);

      // Map prop_type to stat column
      const statMap: Record<string, string> = {
        player_points: "pts",
        player_rebounds: "reb",
        player_assists: "ast",
        player_threes: "fg3m",
        player_blocks: "blk",
        player_steals: "stl",
      };

      let wasCorrect: boolean | null = null;
      let actualValue: number | null = null;
      let actualOutcome = "unverifiable";

      if (gameLog && gameLog.length > 0) {
        const statCol = statMap[pred.prop_type];
        if (statCol && gameLog[0][statCol] !== undefined && gameLog[0][statCol] !== null) {
          actualValue = Number(gameLog[0][statCol]);

          // Parse the prediction to determine if it was OVER or UNDER
          const predText = (pred.prediction || "").toUpperCase();
          const signalFactors = pred.signal_factors || {};
          const lineAtSignal = signalFactors.currentLine || signalFactors.line_to || closing.line;

          if (predText.includes("OVER")) {
            wasCorrect = actualValue > lineAtSignal;
            actualOutcome = actualValue > lineAtSignal ? "OVER_HIT" : "OVER_MISS";
          } else if (predText.includes("UNDER")) {
            wasCorrect = actualValue < lineAtSignal;
            actualOutcome = actualValue < lineAtSignal ? "UNDER_HIT" : "UNDER_MISS";
          }
        }
      }

      // For velocity/cascade predictions, verify if the line continued moving in predicted direction
      if (wasCorrect === null && pred.signal_type === "line_about_to_move") {
        const signalFactors = pred.signal_factors || {};
        const predictedDir = pred.predicted_direction;
        const lineAtSignal = signalFactors.line_to || signalFactors.currentLine;
        const closingLine = closing.line;

        if (lineAtSignal && closingLine) {
          if (predictedDir === "dropping") {
            wasCorrect = closingLine < lineAtSignal;
            actualOutcome = closingLine < lineAtSignal ? "CONTINUED_DROP" : "REVERSED";
          } else if (predictedDir === "rising") {
            wasCorrect = closingLine > lineAtSignal;
            actualOutcome = closingLine > lineAtSignal ? "CONTINUED_RISE" : "REVERSED";
          }
          actualValue = closingLine;
        }
      }

      // For snapback predictions, verify if line moved back toward opening
      if (wasCorrect === null && pred.signal_type === "take_it_now") {
        const signalFactors = pred.signal_factors || {};
        const openLine = signalFactors.openingLine;
        const signalLine = signalFactors.currentLine;
        const closingLine = closing.line;

        if (openLine && signalLine && closingLine) {
          const driftAtSignal = Math.abs(signalLine - openLine);
          const driftAtClose = Math.abs(closingLine - openLine);
          wasCorrect = driftAtClose < driftAtSignal; // Line moved back toward opening
          actualOutcome = wasCorrect ? "SNAPPED_BACK" : "CONTINUED_DRIFT";
          actualValue = closingLine;
        }
      }

      if (wasCorrect !== null) {
        await supabase
          .from("fanduel_prediction_accuracy")
          .update({
            was_correct: wasCorrect,
            actual_outcome: actualOutcome,
            actual_value: actualValue,
            verified_at: now.toISOString(),
          })
          .eq("id", pred.id);

        verified++;
        if (wasCorrect) correct++;
        else incorrect++;
      }
    }

    // 3. Compute accuracy by signal type and update behavior patterns
    const { data: allVerified } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("signal_type, sport, prop_type, was_correct, velocity_at_signal")
      .not("was_correct", "is", null)
      .gte("created_at", new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString());

    const buckets = new Map<string, { correct: number; total: number; velocities: number[] }>();
    for (const row of allVerified || []) {
      const key = `${row.signal_type}|${row.sport}|${row.prop_type}`;
      if (!buckets.has(key)) buckets.set(key, { correct: 0, total: 0, velocities: [] });
      const b = buckets.get(key)!;
      b.total++;
      if (row.was_correct) b.correct++;
      if (row.velocity_at_signal) b.velocities.push(row.velocity_at_signal);
    }

    // Update behavior patterns with accuracy-adjusted confidence
    let patternsUpdated = 0;
    for (const [key, stats] of buckets) {
      const [signalType, sport, propType] = key.split("|");
      const accuracy = stats.total > 0 ? stats.correct / stats.total : 0;

      // Adjust confidence in behavior patterns based on real accuracy
      const newConfidence = Math.round(accuracy * 100);
      const avgVelocity = stats.velocities.length > 0
        ? stats.velocities.reduce((a, b) => a + b, 0) / stats.velocities.length
        : null;

      const { error } = await supabase
        .from("fanduel_behavior_patterns")
        .upsert(
          {
            sport,
            prop_type: propType,
            pattern_type: signalType,
            confidence: newConfidence,
            sample_size: stats.total,
            velocity_threshold: avgVelocity,
            last_updated: now.toISOString(),
          },
          { onConflict: "sport,prop_type,pattern_type" }
        );

      if (!error) patternsUpdated++;
    }

    // 4. Update sharp_signal_calibration weights based on accuracy
    for (const [key, stats] of buckets) {
      if (stats.total < 5) continue; // Need minimum sample
      const accuracy = stats.correct / stats.total;
      const [signalType, sport] = key.split("|");

      // If signal accuracy < 45%, reduce its weight in the calibration
      // If > 55%, boost it
      const weightAdj = accuracy < 0.45 ? -0.1 : accuracy > 0.55 ? 0.1 : 0;

      if (weightAdj !== 0) {
        const { data: existing } = await supabase
          .from("sharp_signal_calibration")
          .select("weight")
          .eq("signal_type", signalType)
          .eq("sport", sport)
          .limit(1);

        if (existing && existing.length > 0) {
          const newWeight = Math.max(0.1, Math.min(2.0, (existing[0].weight || 1.0) + weightAdj));
          await supabase
            .from("sharp_signal_calibration")
            .update({ weight: newWeight })
            .eq("signal_type", signalType)
            .eq("sport", sport);
        }
      }
    }

    // 5. Send Telegram summary
    const overallAccuracy = verified > 0 ? Math.round((correct / verified) * 100) : 0;
    const msg = [
      `📊 *FanDuel Accuracy Feedback*`,
      ``,
      `Verified: ${verified} predictions`,
      `✅ Correct: ${correct} (${overallAccuracy}%)`,
      `❌ Incorrect: ${incorrect}`,
      `📈 Patterns updated: ${patternsUpdated}`,
      ``,
      ...Array.from(buckets.entries())
        .filter(([, s]) => s.total >= 3)
        .slice(0, 5)
        .map(([k, s]) => {
          const [sig, sport] = k.split("|");
          const acc = Math.round((s.correct / s.total) * 100);
          return `${acc >= 55 ? "✅" : acc < 45 ? "❌" : "⚠️"} ${sig} (${sport}): ${acc}% (n=${s.total})`;
        }),
    ].join("\n");

    try {
      await supabase.functions.invoke("bot-send-telegram", {
        body: { message: msg, parse_mode: "Markdown", admin_only: true },
      });
    } catch (tgErr: any) {
      log(`Telegram error: ${tgErr.message}`);
    }

    log(`=== FEEDBACK COMPLETE: ${verified} verified, ${correct} correct, ${patternsUpdated} patterns updated ===`);

    // 6. Cleanup old timeline data (30 day retention)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("fanduel_line_timeline").delete().lt("created_at", thirtyDaysAgo);

    await supabase.from("cron_job_history").insert({
      job_name: "fanduel-accuracy-feedback",
      status: "completed",
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(),
      result: { verified, correct, incorrect, overallAccuracy, patternsUpdated },
    });

    return new Response(
      JSON.stringify({ success: true, verified, correct, incorrect, overallAccuracy, patternsUpdated }),
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
