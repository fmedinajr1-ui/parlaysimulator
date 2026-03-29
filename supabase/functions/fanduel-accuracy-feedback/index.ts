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
    log("=== Starting accuracy feedback loop ===");

    // 1. Get unverified predictions (up to 7 days old for backfill)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: unverified, error: fetchErr } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("*")
      .is("was_correct", null)
      .gte("created_at", sevenDaysAgo)
      .limit(500);

    if (fetchErr) throw new Error(`Fetch unverified: ${fetchErr.message}`);
    log(`Found ${unverified?.length || 0} unverified predictions`);

    let verified = 0;
    let correct = 0;
    let incorrect = 0;

    for (const pred of unverified || []) {
      // Skip trap warnings — informational only
      if (pred.signal_type === "trap_warning") {
        await supabase
          .from("fanduel_prediction_accuracy")
          .update({ was_correct: null, actual_outcome: "informational", verified_at: now.toISOString() })
          .eq("id", pred.id);
        continue;
      }

      // Only verify predictions for games that have ended (hours_to_tip should be very negative by now)
      const predAge = (now.getTime() - new Date(pred.created_at).getTime()) / (1000 * 60 * 60);
      if (predAge < 4) continue; // Wait at least 4 hours for game to finish and closing data to settle

      // Get closing line: the LAST snapshot for this player+event+prop
      const { data: closingSnaps } = await supabase
        .from("fanduel_line_timeline")
        .select("line, over_price, under_price, snapshot_phase, opening_line, snapshot_time, hours_to_tip")
        .eq("event_id", pred.event_id)
        .eq("player_name", pred.player_name)
        .eq("prop_type", pred.prop_type)
        .order("snapshot_time", { ascending: false })
        .limit(1);

      if (!closingSnaps || closingSnaps.length === 0) continue;
      const closing = closingSnaps[0];

      // Get the opening/earliest snapshot for this prop
      const { data: openingSnaps } = await supabase
        .from("fanduel_line_timeline")
        .select("line, over_price, under_price, snapshot_time")
        .eq("event_id", pred.event_id)
        .eq("player_name", pred.player_name)
        .eq("prop_type", pred.prop_type)
        .order("snapshot_time", { ascending: true })
        .limit(1);

      const opening = openingSnaps?.[0];

      // Extract signal details
      const signalFactors = pred.signal_factors || {};
      const lineAtSignal = signalFactors.line_to || signalFactors.currentLine;
      const lineAtOpen = signalFactors.line_from || opening?.line;
      const closingLine = closing.line;
      const predictedDir = pred.predicted_direction;

      let wasCorrect: boolean | null = null;
      let actualOutcome = "unverifiable";
      let actualValue: number | null = closingLine;

      // --- VELOCITY SPIKE / LINE_ABOUT_TO_MOVE ---
      // Verify: did the line continue moving in the predicted direction?
      if (pred.signal_type === "velocity_spike" || pred.signal_type === "line_about_to_move") {
        if (lineAtSignal != null && closingLine != null) {
          if (predictedDir === "dropping") {
            wasCorrect = closingLine < lineAtSignal;
            actualOutcome = closingLine < lineAtSignal ? "CONTINUED_DROP" : "REVERSED_UP";
          } else if (predictedDir === "rising") {
            wasCorrect = closingLine > lineAtSignal;
            actualOutcome = closingLine > lineAtSignal ? "CONTINUED_RISE" : "REVERSED_DOWN";
          }
        }
      }

      // --- CASCADE ---
      // Verify: did the cascade prediction hold? (multiple props moved = real sharp action)
      if (pred.signal_type === "cascade") {
        if (lineAtSignal != null && closingLine != null && lineAtOpen != null) {
          // A cascade is "correct" if the closing line drifted further from opening than at signal time
          const driftAtSignal = Math.abs(lineAtSignal - lineAtOpen);
          const driftAtClose = Math.abs(closingLine - lineAtOpen);
          wasCorrect = driftAtClose >= driftAtSignal;
          actualOutcome = wasCorrect ? "CASCADE_CONFIRMED" : "CASCADE_REVERSED";
        }
      }

      // --- LIVE LINE MOVING ---
      // Verify: did the live movement continue?
      if (pred.signal_type === "live_line_moving") {
        if (lineAtSignal != null && closingLine != null) {
          if (predictedDir === "dropping") {
            wasCorrect = closingLine <= lineAtSignal;
            actualOutcome = closingLine <= lineAtSignal ? "LIVE_DROP_CONFIRMED" : "LIVE_REVERSED";
          } else if (predictedDir === "rising") {
            wasCorrect = closingLine >= lineAtSignal;
            actualOutcome = closingLine >= lineAtSignal ? "LIVE_RISE_CONFIRMED" : "LIVE_REVERSED";
          }
        }
      }

      // --- TAKE IT NOW (snapback) ---
      if (pred.signal_type === "take_it_now") {
        if (lineAtOpen != null && lineAtSignal != null && closingLine != null) {
          const driftAtSignal = Math.abs(lineAtSignal - lineAtOpen);
          const driftAtClose = Math.abs(closingLine - lineAtOpen);
          wasCorrect = driftAtClose < driftAtSignal;
          actualOutcome = wasCorrect ? "SNAPPED_BACK" : "CONTINUED_DRIFT";
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

    // 2. Compute accuracy by signal type and update behavior patterns
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

    // 3. Send Telegram summary
    const overallAccuracy = verified > 0 ? Math.round((correct / verified) * 100) : 0;
    const msg = [
      `📊 *FanDuel Accuracy Report*`,
      ``,
      `Verified: ${verified} predictions`,
      `✅ Correct: ${correct} (${overallAccuracy}%)`,
      `❌ Incorrect: ${incorrect}`,
      `📈 Patterns updated: ${patternsUpdated}`,
      ``,
      ...Array.from(buckets.entries())
        .filter(([, s]) => s.total >= 3)
        .slice(0, 8)
        .map(([k, s]) => {
          const [sig, sport, prop] = k.split("|");
          const acc = Math.round((s.correct / s.total) * 100);
          return `${acc >= 55 ? "✅" : acc < 45 ? "❌" : "⚠️"} ${sig} ${prop} (${sport}): ${acc}% (n=${s.total})`;
        }),
    ].join("\n");

    if (verified > 0) {
      try {
        await supabase.functions.invoke("bot-send-telegram", {
          body: { message: msg, parse_mode: "Markdown", admin_only: true },
        });
      } catch (tgErr: any) {
        log(`Telegram error: ${tgErr.message}`);
      }
    }

    log(`=== COMPLETE: ${verified} verified, ${correct} correct, ${patternsUpdated} patterns ===`);

    // 4. Cleanup old timeline data (30 day retention)
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
