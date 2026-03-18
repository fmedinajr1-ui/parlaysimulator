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

  const TIMEOUT_MS = 240_000; // 240s safety limit (edge fn max ~300s)
  const functionStartTime = Date.now();

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const log = (msg: string) => console.log(`[refresh-l10-and-rebuild] ${msg}`);
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

  try {
    // === PHASE 0: Refresh lineup/injury data & games cache ===
    log("=== PHASE 0: Refreshing lineup & injury data ===");
    await invokeParallel([
      ["Refreshing lineups & injuries", "firecrawl-lineup-scraper", {}],
      ["Refreshing games cache", "game-news-aggregator", { sport: "basketball_nba" }],
    ]);
    // Brief delay to let injury data propagate
    await new Promise(r => setTimeout(r, 3000));

    // === PHASE 1: Refresh game logs ===
    log("=== PHASE 1: Syncing fresh NBA game logs ===");
    await invokeStep(
      "Syncing game logs (ESPN)",
      "nba-stats-fetcher",
      { mode: "sync", daysBack: 5, useESPN: true, includeParlayPlayers: true }
    );

    // === PHASE 1.5: Scrape real quarter stats from StatMuse ===
    if (hasTime()) {
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
    }

    // === PHASE 2: Recompute L10 stats ===
    log("=== PHASE 2: Recomputing category sweet spots ===");
    await invokeStep(
      "Analyzing categories",
      "category-props-analyzer",
      { forceRefresh: true }
    );

    // === PHASE 3: Full parlay rebuild pipeline ===
    log("=== PHASE 3: Full parlay rebuild ===");

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

    // v6.0: REMOVED blanket void — downstream quality regen loop handles dedup/exposure/daily caps
    // Previously this voided ALL pending parlays before regenerating, causing 100% void rates
    log("⏭ Skipping blanket void (v6.0) — quality regen loop handles caps & dedup");
    results["void_pending"] = "skipped:v6_additive_generation";

    // Step 3a: Independent pre-generation tasks (parallel)
    await invokeParallel([
      ["Cleaning stale props", "cleanup-stale-props", { immediate: true }],
      ["Scanning defensive matchups", "bot-matchup-defense-scanner", {}],
      ["Detecting mispriced lines", "detect-mispriced-lines", {}],
    ]);

    // Step 3b: Risk engine (depends on matchups + mispriced)
    await invokeStep("Running risk engine", "nba-player-prop-risk-engine", { action: "analyze_slate", mode: "full_slate" });

    // Step 3c: Wide generate → rank → select top 25 (v6.0 paradigm)
    await invokeStep("Wide generate + rank + select", "bot-quality-regen-loop", { final_cap: 25 });
    await invokeStep("Running curated pipeline", "bot-curated-pipeline", {});
    await invokeStep("Force fresh mispriced parlays", "bot-force-fresh-parlays", {});

    // Step 3d: Post-generation engines (parallel — independent of each other)
    await invokeParallel([
      ["Building sharp parlays", "sharp-parlay-builder", { action: "build" }],
      ["Scanning heat tracker", "heat-prop-engine", { action: "scan" }],
    ]);

    // Step 3e: Heat build (depends on scan)
    await invokeStep("Building heat parlays", "heat-prop-engine", { action: "build" });

    // Step 3f: Final steps (parallel — independent)
    await invokeParallel([
      ["Ladder challenge", "nba-ladder-challenge", {}],
      ["Diversity rebalance", "bot-daily-diversity-rebalance", {}],
    ]);

    // Step 3g: Final status
    await invokeStep("Sending slate status", "bot-slate-status-update", {});

    log(`=== ALL PHASES COMPLETE (${elapsed()}ms) ===`);
    if (skipped.length > 0) {
      log(`⚠ Skipped ${skipped.length} steps due to timeout: ${skipped.join(", ")}`);
    }

    return new Response(JSON.stringify({ success: true, results, skipped, elapsed: elapsed() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    log(`Fatal error (${elapsed()}ms): ${err.message}`);
    return new Response(JSON.stringify({ success: false, error: err.message, results, skipped, elapsed: elapsed() }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
