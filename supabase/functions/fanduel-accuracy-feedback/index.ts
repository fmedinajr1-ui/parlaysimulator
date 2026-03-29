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
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  try {
    log("=== Starting accuracy feedback loop ===");

    // Get unverified predictions older than 2 hours (game should be done)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: unverified, error: fetchErr } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("*")
      .is("was_correct", null)
      .gte("created_at", sevenDaysAgo)
      .lte("created_at", twoHoursAgo.toISOString())
      .limit(200);

    if (fetchErr) throw new Error(`Fetch unverified: ${fetchErr.message}`);
    log(`Found ${unverified?.length || 0} unverified predictions (2h+ old)`);

    // Mark trap warnings immediately
    const traps = (unverified || []).filter(p => p.signal_type === "trap_warning");
    const actionable = (unverified || []).filter(p => p.signal_type !== "trap_warning");

    for (const trap of traps) {
      await supabase
        .from("fanduel_prediction_accuracy")
        .update({ actual_outcome: "informational", verified_at: now.toISOString() })
        .eq("id", trap.id);
    }

    // Group actionable predictions by event_id for efficient timeline lookups
    const byEvent = new Map<string, typeof actionable>();
    for (const pred of actionable) {
      const key = pred.event_id;
      if (!byEvent.has(key)) byEvent.set(key, []);
      byEvent.get(key)!.push(pred);
    }

    let verified = 0;
    let correct = 0;
    let incorrect = 0;

    for (const [eventId, preds] of byEvent) {
      // Get ALL timeline data for this event in one query
      const { data: timeline } = await supabase
        .from("fanduel_line_timeline")
        .select("player_name, prop_type, line, snapshot_time")
        .eq("event_id", eventId)
        .order("snapshot_time", { ascending: false })
        .limit(500);

      if (!timeline || timeline.length === 0) continue;

      for (const pred of preds) {
        // Find closing line (latest snapshot for this player+prop)
        const closing = timeline.find(
          t => t.player_name === pred.player_name && t.prop_type === pred.prop_type
        );
        if (!closing) continue;

        // Find opening line (earliest snapshot)
        const opening = [...timeline]
          .filter(t => t.player_name === pred.player_name && t.prop_type === pred.prop_type)
          .pop(); // last item since sorted desc = earliest

        const signalFactors = pred.signal_factors || {};
        const lineAtSignal = signalFactors.line_to || signalFactors.currentLine;
        const lineAtOpen = signalFactors.line_from || opening?.line;
        const closingLine = closing.line;
        const predictedDir = pred.predicted_direction;

        let wasCorrect: boolean | null = null;
        let actualOutcome = "unverifiable";

        // VELOCITY SPIKE / LINE_ABOUT_TO_MOVE: did line continue moving?
        if (pred.signal_type === "velocity_spike" || pred.signal_type === "line_about_to_move") {
          if (lineAtSignal != null && closingLine != null) {
            if (predictedDir === "dropping") {
              wasCorrect = closingLine < lineAtSignal;
              actualOutcome = wasCorrect ? "CONTINUED_DROP" : "REVERSED_UP";
            } else if (predictedDir === "rising") {
              wasCorrect = closingLine > lineAtSignal;
              actualOutcome = wasCorrect ? "CONTINUED_RISE" : "REVERSED_DOWN";
            }
          }
        }

        // CASCADE: did drift continue from opening?
        if (pred.signal_type === "cascade") {
          if (lineAtSignal != null && closingLine != null && lineAtOpen != null) {
            const driftAtSignal = Math.abs(lineAtSignal - lineAtOpen);
            const driftAtClose = Math.abs(closingLine - lineAtOpen);
            wasCorrect = driftAtClose >= driftAtSignal;
            actualOutcome = wasCorrect ? "CASCADE_CONFIRMED" : "CASCADE_REVERSED";
          }
        }

        // LIVE LINE MOVING: did live movement continue?
        if (pred.signal_type === "live_line_moving") {
          if (lineAtSignal != null && closingLine != null) {
            if (predictedDir === "dropping") {
              wasCorrect = closingLine <= lineAtSignal;
              actualOutcome = wasCorrect ? "LIVE_DROP_CONFIRMED" : "LIVE_REVERSED";
            } else if (predictedDir === "rising") {
              wasCorrect = closingLine >= lineAtSignal;
              actualOutcome = wasCorrect ? "LIVE_RISE_CONFIRMED" : "LIVE_REVERSED";
            }
          }
        }

        // TAKE IT NOW (snapback)
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
              actual_value: closingLine,
              verified_at: now.toISOString(),
            })
            .eq("id", pred.id);

          verified++;
          if (wasCorrect) correct++;
          else incorrect++;
        }
      }
    }

    // Compute accuracy by signal type
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

    let patternsUpdated = 0;
    for (const [key, stats] of buckets) {
      const [signalType, sport, propType] = key.split("|");
      const accuracy = stats.total > 0 ? stats.correct / stats.total : 0;
      const avgVelocity = stats.velocities.length > 0
        ? stats.velocities.reduce((a, b) => a + b, 0) / stats.velocities.length
        : null;

      const { error } = await supabase
        .from("fanduel_behavior_patterns")
        .upsert({
          sport, prop_type: propType, pattern_type: signalType,
          confidence: Math.round(accuracy * 100),
          sample_size: stats.total,
          velocity_threshold: avgVelocity,
          last_updated: now.toISOString(),
        }, { onConflict: "sport,prop_type,pattern_type" });
      if (!error) patternsUpdated++;
    }

    // Telegram summary
    const overallAccuracy = verified > 0 ? Math.round((correct / verified) * 100) : 0;
    if (verified > 0) {
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

      try {
        await supabase.functions.invoke("bot-send-telegram", {
          body: { message: msg, parse_mode: "Markdown", admin_only: true },
        });
      } catch (tgErr: any) {
        log(`Telegram error: ${tgErr.message}`);
      }
    }

    log(`=== COMPLETE: ${verified} verified, ${correct} correct, ${patternsUpdated} patterns ===`);

    // Cleanup old timeline (30 day retention)
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
