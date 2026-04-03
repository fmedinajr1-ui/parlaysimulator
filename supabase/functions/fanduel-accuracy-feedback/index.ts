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

  // Parse optional body for settle_all mode
  const body = await req.json().catch(() => ({}));
  const settleAll = body?.settle_all === true;

  try {
    log(`=== Starting accuracy feedback loop ${settleAll ? '(SETTLE ALL MODE)' : ''} ===`);

    const lookbackDays = settleAll ? 14 : 7;
    const lookbackDate = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    const queryLimit = settleAll ? 1000 : 300;

    let query = supabase
      .from("fanduel_prediction_accuracy")
      .select("*")
      .is("was_correct", null)
      .gte("created_at", lookbackDate)
      .order("created_at", { ascending: false })
      .limit(queryLimit);

    // Only apply the 2-hour age filter in normal mode
    if (!settleAll) {
      query = query.lte("created_at", twoHoursAgo.toISOString());
    }

    const { data: unverified, error: fetchErr } = await query;

    if (fetchErr) throw new Error(`Fetch unverified: ${fetchErr.message}`);
    log(`Found ${unverified?.length || 0} unverified predictions (2h+ old)`);

    // Mark trap warnings immediately
    const traps = (unverified || []).filter(p => p.signal_type === "trap_warning");
    const actionable = (unverified || []).filter(p => p.signal_type !== "trap_warning");

    for (const trap of traps) {
      await supabase
        .from("fanduel_prediction_accuracy")
        .update({ was_correct: true, actual_outcome: "informational", verified_at: now.toISOString() })
        .eq("id", trap.id);
    }
    if (traps.length > 0) log(`Settled ${traps.length} trap_warnings as informational`);

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
      // Check if the game has actually started by looking at commence_time
      const { data: commenceData } = await supabase
        .from("fanduel_line_timeline")
        .select("commence_time")
        .eq("event_id", eventId)
        .not("commence_time", "is", null)
        .limit(1);

      if (commenceData && commenceData.length > 0) {
        const gameStart = new Date(commenceData[0].commence_time);
        if (now < gameStart) {
          log(`Skipping event ${eventId} — game hasn't started yet (starts ${commenceData[0].commence_time})`);
          continue;
        }
        // For CLV-based signals, require game to be past start + guard time
        const guardHours = settleAll ? 0.5 : 3; // 30 min guard in settle_all, 3h normally
        const guardTime = new Date(gameStart.getTime() + guardHours * 60 * 60 * 1000);
        if (now < guardTime) {
          log(`Skipping event ${eventId} — game likely still in progress (started ${commenceData[0].commence_time})`);
          continue;
        }
      }

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

        // ── Helper: resolve line at signal time (from signal_factors or nearest timeline snapshot) ──
        const resolveLineAtSignal = (): number | null => {
          const fromSF = sf.line_to ?? sf.currentLine ?? sf.current_line;
          if (fromSF != null) return Number(fromSF);
          // Fallback: find the timeline snapshot closest to prediction created_at
          const predTime = new Date(pred.created_at).getTime();
          let closest: any = null;
          let closestDelta = Infinity;
          for (const t of playerTimeline) {
            const d = Math.abs(new Date(t.snapshot_time).getTime() - predTime);
            if (d < closestDelta) { closestDelta = d; closest = t; }
          }
          return closest ? Number(closest.line) : null;
        };

        // ── VELOCITY SPIKE: did line continue moving in predicted direction? ──
        if (pred.signal_type === "velocity_spike" || pred.signal_type === "live_velocity_spike") {
          const lineAtSignal = resolveLineAtSignal();
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
        if (pred.signal_type === "line_about_to_move" || pred.signal_type === "live_line_about_to_move") {
          const lineAtSignal = resolveLineAtSignal();
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
        if (pred.signal_type === "cascade" || pred.signal_type === "live_cascade") {
          const pendingProps: string[] = sf.pending_props || [];
          if (pendingProps.length > 0) {
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
            wasCorrect = moveRate >= 0.5;
            actualOutcome = wasCorrect
              ? `CASCADE_CONFIRMED (${pendingThatMoved}/${pendingProps.length} moved)`
              : `CASCADE_MISSED (${pendingThatMoved}/${pendingProps.length} moved)`;
          }
        }

        // ── LIVE DRIFT: CLV check or snapback verification ──
        if (pred.signal_type === "live_drift") {
          const sigCurrentLine = sf.current_line ?? sf.currentLine ?? sf.line_to;
          const sigOpeningLine = sf.opening_line ?? sf.openingLine;
          if (sigCurrentLine != null && closingLine != null) {
            const predText = (pred.prediction || "").toUpperCase();
            const isOver = predText.includes("OVER");
            const isUnder = predText.includes("UNDER");
            const isSnapback = pred.predicted_direction === "snapback";

            if (isSnapback && sigOpeningLine != null) {
              // Snapback = line drifted away from opening, we predict it reverts back
              const driftAtSignal = Math.abs(Number(sigCurrentLine) - Number(sigOpeningLine));
              const driftAtClose = Math.abs(closingLine - Number(sigOpeningLine));
              wasCorrect = driftAtClose < driftAtSignal;
              actualOutcome = wasCorrect ? "DRIFT_SNAPPED_BACK" : "DRIFT_CONTINUED";
            } else if (isOver) {
              wasCorrect = closingLine >= Number(sigCurrentLine);
              actualOutcome = wasCorrect ? "CLV_POSITIVE_OVER" : "CLV_NEGATIVE_OVER";
            } else if (isUnder) {
              wasCorrect = closingLine <= Number(sigCurrentLine);
              actualOutcome = wasCorrect ? "CLV_POSITIVE_UNDER" : "CLV_NEGATIVE_UNDER";
            } else if (isSnapback) {
              // Snapback without opening line: use prediction text to infer direction
              const lineMatch = predText.match(/([\d.]+)/);
              if (lineMatch) {
                const predLine = parseFloat(lineMatch[1]);
                // For snapback, "OVER X" means line dropped below X and should revert up
                wasCorrect = Math.abs(closingLine - predLine) < Math.abs(Number(sigCurrentLine) - predLine);
                actualOutcome = wasCorrect ? "DRIFT_SNAPPED_BACK" : "DRIFT_CONTINUED";
              }
            }
          }
        }

        // ── LIVE LINE MOVING: did live movement continue? ──
        if (pred.signal_type === "live_line_moving" || pred.signal_type === "live_cascade" || pred.signal_type === "live_velocity_spike") {
          if (wasCorrect === null) {
            const lineAtSignal = resolveLineAtSignal();
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
        }

        // ── TAKE_IT_NOW: CLV check + TRAP DETECTION ──
        if (pred.signal_type === "take_it_now") {
          const sigCurrentLine = sf.current_line ?? sf.currentLine ?? sf.line_to;
          const sigOpeningLine = sf.opening_line ?? sf.openingLine;

          // Gather all post-alert snapshots to detect reversals
          const alertTime = pred.alert_sent_at || pred.created_at;
          const postAlertSnapshots = playerTimeline.filter(
            t => new Date(t.snapshot_time) > new Date(alertTime)
          );
          const postAlertCount = postAlertSnapshots.length;
          const closingLineVal = playerTimeline[0].line; // latest snapshot

          // Calculate line movement after alert
          let lineMovementAfterAlert: number | null = null;
          let movementReversed = false;
          let reversalMagnitude: number | null = null;
          let trapType: string | null = null;
          let wasTrap = false;

          if (sigCurrentLine != null && closingLineVal != null) {
            lineMovementAfterAlert = closingLineVal - sigCurrentLine;

            // Detect reversal: line moved BACK toward opening after our alert
            if (sigOpeningLine != null) {
              const driftAtAlert = sigCurrentLine - sigOpeningLine; // e.g. -2.0 (dropped)
              const driftAtClose = closingLineVal - sigOpeningLine; // e.g. -0.5 (reversed up)

              // Reversal = closing drift is less extreme than alert drift (line came back)
              if (Math.abs(driftAtClose) < Math.abs(driftAtAlert) * 0.5) {
                movementReversed = true;
                reversalMagnitude = Math.abs(driftAtAlert) - Math.abs(driftAtClose);

                // Classify trap type
                const hoursBeforeTip = pred.hours_before_tip ?? pred.time_to_tip_hours;
                if (hoursBeforeTip != null && hoursBeforeTip < 2) {
                  trapType = "late_bait_and_reverse"; // FanDuel moved line close to tip then snapped back
                } else if (hoursBeforeTip != null && hoursBeforeTip >= 6) {
                  trapType = "early_steam_fake"; // Fake early movement to draw action
                } else {
                  trapType = "bait_and_reverse"; // Standard trap
                }
                wasTrap = true;
                log(`🪤 TRAP DETECTED: ${pred.player_name} ${pred.prop_type} — ${trapType} (reversed ${reversalMagnitude?.toFixed(1)} pts)`);
              }
            }
          }

          if (sigCurrentLine != null && closingLineVal != null) {
            const predText = (pred.prediction || "").toUpperCase();
            const isOver = predText.includes("OVER");
            const isUnder = predText.includes("UNDER");
            const isTake = predText.includes("TAKE") && !predText.includes("TAKE IT NOW");
            const isFade = predText.includes("FADE") || predText.includes("BACK");

            if (isOver || isUnder || isTake || isFade) {
              if (isOver || isTake) {
                wasCorrect = closingLineVal >= sigCurrentLine;
                actualOutcome = wasCorrect ? "CLV_POSITIVE_OVER" : "CLV_NEGATIVE_OVER";
              } else {
                wasCorrect = closingLineVal <= sigCurrentLine;
                actualOutcome = wasCorrect ? "CLV_POSITIVE_UNDER" : "CLV_NEGATIVE_UNDER";
              }
            } else {
              let dir = pred.predicted_direction;
              if (!dir || dir === "snapback" || dir === "revert") {
                if (sigOpeningLine != null) {
                  dir = sigCurrentLine < sigOpeningLine ? "dropping" : "rising";
                }
              }
              if (dir === "dropping") {
                wasCorrect = closingLineVal <= sigCurrentLine;
                actualOutcome = wasCorrect ? "ENTRY_CONFIRMED_DROP" : "ENTRY_REVERSED";
              } else if (dir === "rising") {
                wasCorrect = closingLineVal >= sigCurrentLine;
                actualOutcome = wasCorrect ? "ENTRY_CONFIRMED_RISE" : "ENTRY_REVERSED";
              }
            }
          }

          // Store enriched trap data alongside outcome
          if (wasCorrect !== null) {
            await supabase
              .from("fanduel_prediction_accuracy")
              .update({
                was_correct: wasCorrect,
                actual_outcome: actualOutcome,
                actual_value: closingLine,
                verified_at: now.toISOString(),
                closing_line: closingLineVal,
                line_movement_after_alert: lineMovementAfterAlert,
                movement_reversed: movementReversed,
                reversal_magnitude: reversalMagnitude,
                was_trap: wasTrap,
                trap_type: trapType,
                post_alert_snapshots: postAlertCount,
              })
              .eq("id", pred.id);

            verified++;
            if (wasCorrect) correct++;
            else incorrect++;
            continue; // Skip the generic update below
          }
        }

        // ── PERFECT LINE (perfect_line_perfect, perfect_line_strong, perfect_line_lean): CLV check ──
        if (pred.signal_type?.startsWith("perfect_line")) {
          // Try signal_factors first, then parse line from prediction text (e.g. "OVER 7.5")
          let sigCurrentLine = sf.current_line ?? sf.currentLine ?? sf.line_to ?? sf.fanduel_line ?? sf.line;
          if (sigCurrentLine == null) {
            const lineMatch = (pred.prediction || "").match(/([\d.]+)/);
            if (lineMatch) sigCurrentLine = parseFloat(lineMatch[1]);
          }
          if (sigCurrentLine != null && closingLine != null) {
            const predText = (pred.prediction || "").toUpperCase();
            const isOver = predText.includes("OVER") || predText.includes("TAKE") || predText.includes("COVER");
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
              if (dir === "dropping" || dir === "under" || dir === "fade") {
                // FADE = betting against this line (expect CLV drop or line was overpriced)
                wasCorrect = closingLine <= sigCurrentLine;
                actualOutcome = wasCorrect ? "CLV_POSITIVE_FADE" : "CLV_NEGATIVE_FADE";
              } else if (dir === "rising" || dir === "over" || dir === "back") {
                // BACK = betting on this line (expect CLV rise or line was underpriced)
                wasCorrect = closingLine >= sigCurrentLine;
                actualOutcome = wasCorrect ? "CLV_POSITIVE_BACK" : "CLV_NEGATIVE_BACK";
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

        // ── ACCURACY FLIP PARLAY LEGS: CLV check on OVER/UNDER prediction ──
        if (pred.signal_type === "flipped_accuracy_fade" || pred.signal_type === "accuracy_flip_best") {
          // Resolve line at signal time from signal_factors or line_at_alert
          let sigLine = sf.line ?? sf.fanduel_line ?? sf.current_line ?? sf.currentLine ?? pred.line_at_alert;
          if (sigLine == null) {
            const lineMatch = (pred.prediction || "").match(/([\d.]+)/);
            if (lineMatch) sigLine = parseFloat(lineMatch[1]);
          }
          if (sigLine != null && closingLine != null) {
            const predText = (pred.prediction || "").toUpperCase();
            const isOver = predText.includes("OVER");
            const isUnder = predText.includes("UNDER");
            const label = pred.signal_type === "flipped_accuracy_fade" ? "FLIP" : "BEST";

            if (isOver) {
              wasCorrect = closingLine >= Number(sigLine);
              actualOutcome = wasCorrect ? `CLV_POSITIVE_OVER_${label}` : `CLV_NEGATIVE_OVER_${label}`;
            } else if (isUnder) {
              wasCorrect = closingLine <= Number(sigLine);
              actualOutcome = wasCorrect ? `CLV_POSITIVE_UNDER_${label}` : `CLV_NEGATIVE_UNDER_${label}`;
            }
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
