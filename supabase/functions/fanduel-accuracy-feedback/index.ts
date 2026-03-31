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

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: unverified, error: fetchErr } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("*")
      .is("was_correct", null)
      .gte("created_at", sevenDaysAgo)
      .lte("created_at", twoHoursAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(300);

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

    // Group actionable predictions by event_id
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
      const { data: timeline } = await supabase
        .from("fanduel_line_timeline")
        .select("player_name, prop_type, line, snapshot_time")
        .eq("event_id", eventId)
        .order("snapshot_time", { ascending: false })
        .limit(500);

      if (!timeline || timeline.length === 0) continue;

      for (const pred of preds) {
        const playerTimeline = timeline.filter(
          t => t.player_name === pred.player_name && t.prop_type === pred.prop_type
        );
        if (playerTimeline.length === 0) continue;

        const closingLine = playerTimeline[0].line; // latest (sorted desc)
        const openingLine = playerTimeline[playerTimeline.length - 1].line; // earliest

        const sf = pred.signal_factors || {};
        let wasCorrect: boolean | null = null;
        let actualOutcome = "unverifiable";

        // ── VELOCITY SPIKE: did line continue moving in predicted direction? ──
        if (pred.signal_type === "velocity_spike") {
          const lineAtSignal = sf.line_to ?? sf.currentLine;
          if (lineAtSignal != null && closingLine != null) {
            if (pred.predicted_direction === "dropping") {
              wasCorrect = closingLine < lineAtSignal;
              actualOutcome = wasCorrect ? "CONTINUED_DROP" : "REVERSED_UP";
            } else if (pred.predicted_direction === "rising") {
              wasCorrect = closingLine > lineAtSignal;
              actualOutcome = wasCorrect ? "CONTINUED_RISE" : "REVERSED_DOWN";
            }
          }
        }

        // ── LINE ABOUT TO MOVE: did line continue in predicted direction? ──
        if (pred.signal_type === "line_about_to_move") {
          // signal_factors has: lineDiff, velocityPerHour, learnedAvgVelocity
          // predicted_direction is "dropping" or "rising"
          // Check if from signal time to close, line moved further in that direction
          const lineAtSignal = sf.line_to ?? sf.currentLine;
          if (lineAtSignal != null && closingLine != null) {
            if (pred.predicted_direction === "dropping") {
              wasCorrect = closingLine < lineAtSignal;
              actualOutcome = wasCorrect ? "CONTINUED_DROP" : "REVERSED_UP";
            } else if (pred.predicted_direction === "rising") {
              wasCorrect = closingLine > lineAtSignal;
              actualOutcome = wasCorrect ? "CONTINUED_RISE" : "REVERSED_DOWN";
            }
          }
          // Fallback: use lineDiff direction from signal_factors
          if (wasCorrect === null && sf.lineDiff != null && closingLine != null && openingLine != null) {
            const signalDirection = sf.lineDiff < 0 ? "dropping" : "rising";
            const closeDirection = closingLine < openingLine ? "dropping" : "rising";
            wasCorrect = signalDirection === closeDirection;
            actualOutcome = wasCorrect ? "MOVE_CONFIRMED" : "MOVE_REVERSED";
          }
        }

        // ── CASCADE: did the pending props also move? ──
        if (pred.signal_type === "cascade") {
          const pendingProps: string[] = sf.pending_props || [];
          const movedProps: string[] = sf.moved_props || [];
          if (pendingProps.length > 0) {
            // Check each pending prop — did it eventually move (any line change)?
            let pendingThatMoved = 0;
            for (const pp of pendingProps) {
              const ppTimeline = timeline.filter(
                t => t.player_name === pred.player_name && t.prop_type === pp
              );
              if (ppTimeline.length >= 2) {
                const ppClose = ppTimeline[0].line;
                const ppOpen = ppTimeline[ppTimeline.length - 1].line;
                if (Math.abs(ppClose - ppOpen) >= 0.5) pendingThatMoved++;
              }
            }
            const moveRate = pendingThatMoved / pendingProps.length;
            wasCorrect = moveRate >= 0.5; // at least half the pending props moved
            actualOutcome = wasCorrect
              ? `CASCADE_CONFIRMED (${pendingThatMoved}/${pendingProps.length} moved)`
              : `CASCADE_MISSED (${pendingThatMoved}/${pendingProps.length} moved)`;
          }
        }

        // ── LIVE LINE MOVING: did live movement continue? ──
        if (pred.signal_type === "live_line_moving") {
          const lineAtSignal = sf.line_to ?? sf.currentLine;
          if (lineAtSignal != null && closingLine != null) {
            if (pred.predicted_direction === "dropping") {
              wasCorrect = closingLine <= lineAtSignal;
              actualOutcome = wasCorrect ? "LIVE_DROP_CONFIRMED" : "LIVE_REVERSED";
            } else if (pred.predicted_direction === "rising") {
              wasCorrect = closingLine >= lineAtSignal;
              actualOutcome = wasCorrect ? "LIVE_RISE_CONFIRMED" : "LIVE_REVERSED";
            }
          }
        }

        // ── TAKE_IT_NOW: CLV check — did closing line move favorably for the recommended side? ──
        if (pred.signal_type === "take_it_now") {
          const sigCurrentLine = sf.current_line ?? sf.currentLine ?? sf.line_to;
          const sigOpeningLine = sf.opening_line ?? sf.openingLine;
          if (sigCurrentLine != null && closingLine != null) {
            // Extract recommended side from prediction text (e.g., "OVER 7.5" or "UNDER 4.5")
            const predText = (pred.prediction || "").toUpperCase();
            const isOver = predText.includes("OVER");
            const isUnder = predText.includes("UNDER");
            const isTake = predText.includes("TAKE") && !predText.includes("TAKE IT NOW");
            const isFade = predText.includes("FADE") || predText.includes("BACK");

            if (isOver || isUnder || isTake || isFade) {
              // CLV: closing line moved in a direction that makes our entry better
              // OVER 7.5 is confirmed if closing >= signal line (line rose = we got value)
              // UNDER 4.5 is confirmed if closing <= signal line (line dropped = we got value)
              if (isOver || isTake) {
                wasCorrect = closingLine >= sigCurrentLine;
                actualOutcome = wasCorrect ? "CLV_POSITIVE_OVER" : "CLV_NEGATIVE_OVER";
              } else {
                wasCorrect = closingLine <= sigCurrentLine;
                actualOutcome = wasCorrect ? "CLV_POSITIVE_UNDER" : "CLV_NEGATIVE_UNDER";
              }
            } else {
              // Fallback: infer direction from opening→current drift
              let dir = pred.predicted_direction;
              if (!dir || dir === "snapback" || dir === "revert") {
                if (sigOpeningLine != null) {
                  dir = sigCurrentLine < sigOpeningLine ? "dropping" : "rising";
                }
              }
              if (dir === "dropping") {
                wasCorrect = closingLine <= sigCurrentLine;
                actualOutcome = wasCorrect ? "ENTRY_CONFIRMED_DROP" : "ENTRY_REVERSED";
              } else if (dir === "rising") {
                wasCorrect = closingLine >= sigCurrentLine;
                actualOutcome = wasCorrect ? "ENTRY_CONFIRMED_RISE" : "ENTRY_REVERSED";
              }
            }
          }
        }

        // ── PERFECT LINE (perfect_line_perfect, perfect_line_strong, perfect_line_lean): CLV check ──
        if (pred.signal_type?.startsWith("perfect_line")) {
          const sigCurrentLine = sf.current_line ?? sf.currentLine ?? sf.line_to ?? sf.fanduel_line ?? sf.line;
          if (sigCurrentLine != null && closingLine != null) {
            const predText = (pred.prediction || "").toUpperCase();
            const isOver = predText.includes("OVER") || predText.includes("TAKE");
            const isUnder = predText.includes("UNDER") || predText.includes("FADE");

            if (isOver) {
              wasCorrect = closingLine >= sigCurrentLine;
              actualOutcome = wasCorrect ? "CLV_POSITIVE_OVER" : "CLV_NEGATIVE_OVER";
            } else if (isUnder) {
              wasCorrect = closingLine <= sigCurrentLine;
              actualOutcome = wasCorrect ? "CLV_POSITIVE_UNDER" : "CLV_NEGATIVE_UNDER";
            } else {
              // Fallback: infer from predicted_direction
              const dir = pred.predicted_direction;
              if (dir === "dropping") {
                wasCorrect = closingLine <= sigCurrentLine;
                actualOutcome = wasCorrect ? "CLV_POSITIVE_DROP" : "CLV_NEGATIVE_DROP";
              } else if (dir === "rising") {
                wasCorrect = closingLine >= sigCurrentLine;
                actualOutcome = wasCorrect ? "CLV_POSITIVE_RISE" : "CLV_NEGATIVE_RISE";
              }
            }
          }
        }

        // ── SNAPBACK: did line revert toward opening? ──
        if (pred.signal_type === "snapback") {
          const sigOpeningLine = sf.opening_line ?? openingLine;
          const sigCurrentLine = sf.current_line ?? sf.line_to;
          if (sigOpeningLine != null && sigCurrentLine != null && closingLine != null) {
            const driftAtSignal = Math.abs(sigCurrentLine - sigOpeningLine);
            const driftAtClose = Math.abs(closingLine - sigOpeningLine);
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

    // ── Compute accuracy by signal type and update behavior patterns ──
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

    // ── Telegram summary ──
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
