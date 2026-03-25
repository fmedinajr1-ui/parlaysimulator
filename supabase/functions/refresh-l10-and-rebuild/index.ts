import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const TIMEOUT_MS = 240_000;
  const functionStartTime = Date.now();
  const MAX_ATTEMPTS = 4;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Parse resume params
  const body = await req.json().catch(() => ({}));
  const resumeAfter: string | null = body.resume_after || null;
  const currentRunId: string = body.run_id || crypto.randomUUID();
  const currentAttempt: number = body.attempt || 1;
  const regenAttempt: number = body.regen_attempt || 0;
  const MAX_REGEN = 2;

  const log = (msg: string) => console.log(`[refresh-l10-and-rebuild][run:${currentRunId.slice(0,8)}][attempt:${currentAttempt}] ${msg}`);
  const results: Record<string, string> = {};
  const skipped: string[] = [];

  const elapsed = () => Date.now() - functionStartTime;
  const hasTime = () => elapsed() < TIMEOUT_MS;

  const invokeStep = async (name: string, fnName: string, body: object = {}) => {
    if (!hasTime()) {
      log(`⏭ SKIPPED ${name} — timeout approaching (${elapsed()}ms)`);
      results[fnName] = "skipped:timeout";
      skipped.push(fnName);
      return;
    }
    log(`▶ ${name} (${elapsed()}ms elapsed)`);
    try {
      const { error } = await supabase.functions.invoke(fnName, { body });
      if (error) {
        log(`⚠ ${name} error: ${JSON.stringify(error)}`);
        results[fnName] = `error: ${error.message || JSON.stringify(error)}`;
      } else {
        log(`✅ ${name} done (${elapsed()}ms total)`);
        results[fnName] = "ok";
      }
    } catch (e) {
      log(`❌ ${name} exception: ${e.message}`);
      results[fnName] = `exception: ${e.message}`;
    }
  };

  const invokeParallel = async (steps: [string, string, object?][]) => {
    const eligible = steps.filter(() => hasTime());
    const skippedSteps = steps.slice(eligible.length);
    for (const [name, fn] of skippedSteps) {
      log(`⏭ SKIPPED ${name} — timeout approaching`);
      results[fn] = "skipped:timeout";
      skipped.push(fn);
    }
    if (eligible.length === 0) return;
    log(`▶ Running ${eligible.length} steps in parallel (${elapsed()}ms elapsed)`);
    await Promise.all(
      eligible.map(([name, fn, body]) => invokeStep(name, fn, body || {}))
    );
  };

  // === PHASE DEFINITIONS ===
  // Each phase has: id, label, executor function
  const ALL_PHASES: { id: string; label: string; run: () => Promise<void> }[] = [
    {
      id: "phase0",
      label: "Refresh lineup & injury data + games cache",
      run: async () => {
        log("=== PHASE 0: Refreshing lineup & injury data ===");
        await invokeParallel([
          ["Refreshing lineups & injuries", "firecrawl-lineup-scraper", {}],
          ["Refreshing games cache", "game-news-aggregator", { sport: "basketball_nba" }],
        ]);
        await new Promise(r => setTimeout(r, 3000));
      },
    },
    {
      id: "phase1",
      label: "Sync NBA game logs",
      run: async () => {
        log("=== PHASE 1: Syncing fresh NBA game logs ===");
        await invokeStep(
          "Syncing game logs (ESPN)",
          "nba-stats-fetcher",
          { mode: "sync", daysBack: 5, useESPN: true, includeParlayPlayers: true }
        );
      },
    },
    {
      id: "phase1_5",
      label: "Scrape StatMuse quarter stats",
      run: async () => {
        log("=== PHASE 1.5: Scraping real quarter stats (StatMuse) ===");
        const { data: slateProps } = await supabase
          .from("unified_props")
          .select("player_name")
          .gte("scraped_at", new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString());

        const slatePlayers = [...new Set((slateProps || []).map(p => p.player_name).filter(Boolean))];
        if (slatePlayers.length > 0) {
          const batches = slatePlayers.map(p => [p]);
          for (let i = 0; i < batches.length; i++) {
            if (!hasTime()) {
              log(`⏭ Skipping remaining StatMuse batches (${i}/${batches.length}) — timeout`);
              break;
            }
            await invokeStep(
              `StatMuse quarter stats batch ${i + 1}/${batches.length}`,
              "scrape-statmuse-quarter-stats",
              { playerNames: batches[i] }
            );
          }
          log(`StatMuse: processed ${slatePlayers.length} slate players`);
        } else {
          log("No slate players found, skipping StatMuse scrape");
        }
      },
    },
    {
      id: "phase2",
      label: "Recompute category sweet spots",
      run: async () => {
        log("=== PHASE 2: Recomputing category sweet spots ===");
        await invokeStep("Analyzing categories", "category-props-analyzer", { forceRefresh: true });
      },
    },
    {
      id: "phase3_void",
      label: "Void check (skipped v6.0)",
      run: async () => {
        log("⏭ Skipping blanket void (v6.0) — quality regen loop handles caps & dedup");
        results["void_pending"] = "skipped:v6_additive_generation";
      },
    },
    {
      id: "phase3a",
      label: "Pre-generation tasks",
      run: async () => {
        await invokeParallel([
          ["Cleaning stale props", "cleanup-stale-props", { immediate: true }],
          ["Scanning defensive matchups", "bot-matchup-defense-scanner", {}],
          ["Detecting mispriced lines", "detect-mispriced-lines", {}],
          ["Matchup intelligence analysis", "matchup-intelligence-analyzer", { action: "analyze_batch" }],
        ]);
      },
    },
    {
      id: "phase3b",
      label: "Risk engine",
      run: async () => {
        await invokeStep("Running risk engine", "nba-player-prop-risk-engine", { action: "analyze_slate", mode: "full_slate" });
      },
    },
    {
      id: "phase3c",
      label: "Wide generate + rank + curated + force fresh",
      run: async () => {
        await invokeStep("Wide generate + rank + select", "bot-quality-regen-loop", { final_cap: 25 });
        await invokeStep("Running curated pipeline", "bot-curated-pipeline", {});
        await invokeStep("Force fresh mispriced parlays", "bot-force-fresh-parlays", {});
      },
    },
    {
      id: "phase3d",
      label: "Sharp + heat scan",
      run: async () => {
        await invokeParallel([
          ["Building sharp parlays", "sharp-parlay-builder", { action: "build" }],
          ["Scanning heat tracker", "heat-prop-engine", { action: "scan" }],
        ]);
      },
    },
    {
      id: "phase3e",
      label: "Heat build",
      run: async () => {
        await invokeStep("Building heat parlays", "heat-prop-engine", { action: "build" });
      },
    },
    {
      id: "phase3f",
      label: "Ladder + diversity",
      run: async () => {
        await invokeParallel([
          ["Ladder challenge", "nba-ladder-challenge", {}],
          ["Diversity rebalance", "bot-daily-diversity-rebalance", {}],
        ]);
      },
    },
    {
      id: "phase3g",
      label: "DNA audit (mandatory post-generation)",
      run: async () => {
        await invokeStep("DNA parlay audit", "score-parlays-dna", {});
      },
    },
    {
      id: "phase3h",
      label: "Slate status",
      run: async () => {
        await invokeStep("Sending slate status", "bot-slate-status-update", {});
      },
    },
  ];

  // Determine start index based on resume_after
  let startIndex = 0;
  if (resumeAfter) {
    const idx = ALL_PHASES.findIndex(p => p.id === resumeAfter);
    if (idx >= 0) {
      startIndex = idx + 1;
      log(`🔄 RESUMING after "${resumeAfter}" (phase ${startIndex}/${ALL_PHASES.length}), attempt ${currentAttempt}/${MAX_ATTEMPTS}`);
    } else {
      log(`⚠ Unknown resume_after "${resumeAfter}", starting from beginning`);
    }
  } else {
    log(`🚀 Starting fresh run (attempt ${currentAttempt}/${MAX_ATTEMPTS})`);
  }

  let lastCompleted: string | null = resumeAfter;

  try {
    for (let i = startIndex; i < ALL_PHASES.length; i++) {
      const phase = ALL_PHASES[i];

      if (!hasTime()) {
        // Mark all remaining phases as skipped
        for (let j = i; j < ALL_PHASES.length; j++) {
          const sp = ALL_PHASES[j];
          log(`⏭ SKIPPED phase "${sp.id}" (${sp.label}) — timeout approaching (${elapsed()}ms)`);
          skipped.push(sp.id);
        }
        break;
      }

      log(`--- Phase "${phase.id}": ${phase.label} (${elapsed()}ms) ---`);
      await phase.run();
      lastCompleted = phase.id;
    }

    log(`=== RUN COMPLETE (${elapsed()}ms) — ${skipped.length} phases skipped ===`);

    // === AUTO-RESUME: self-invoke if phases were skipped ===
    if (skipped.length > 0 && currentAttempt < MAX_ATTEMPTS && lastCompleted) {
      log(`🔄 Auto-continuing: attempt ${currentAttempt + 1}/${MAX_ATTEMPTS}, resuming after "${lastCompleted}"`);
      // Fire-and-forget — don't await
      supabase.functions.invoke("refresh-l10-and-rebuild", {
        body: {
          resume_after: lastCompleted,
          run_id: currentRunId,
          attempt: currentAttempt + 1,
        },
      }).catch(e => log(`⚠ Continuation invoke failed: ${e.message}`));
    } else if (skipped.length > 0) {
      log(`⚠ Max attempts (${MAX_ATTEMPTS}) reached with ${skipped.length} phases still skipped: ${skipped.join(", ")}`);
    } else {
      log(`✅ ALL PHASES COMPLETE — no continuation needed`);
    }

    return new Response(JSON.stringify({
      success: true,
      run_id: currentRunId,
      attempt: currentAttempt,
      last_completed: lastCompleted,
      results,
      skipped,
      will_continue: skipped.length > 0 && currentAttempt < MAX_ATTEMPTS,
      elapsed: elapsed(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    log(`Fatal error (${elapsed()}ms): ${err.message}`);
    return new Response(JSON.stringify({
      success: false,
      error: err.message,
      run_id: currentRunId,
      attempt: currentAttempt,
      last_completed: lastCompleted,
      results,
      skipped,
      elapsed: elapsed(),
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
