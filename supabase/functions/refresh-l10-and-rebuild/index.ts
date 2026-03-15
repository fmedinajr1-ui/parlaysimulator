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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const log = (msg: string) => console.log(`[refresh-l10-and-rebuild] ${msg}`);
  const results: Record<string, string> = {};

  const invokeStep = async (name: string, fnName: string, body: object = {}) => {
    log(`▶ ${name}`);
    try {
      const { error } = await supabase.functions.invoke(fnName, { body });
      if (error) {
        log(`⚠ ${name} error: ${JSON.stringify(error)}`);
        results[fnName] = `error: ${error.message || JSON.stringify(error)}`;
      } else {
        log(`✅ ${name} done`);
        results[fnName] = "ok";
      }
    } catch (e) {
      log(`❌ ${name} exception: ${e.message}`);
      results[fnName] = `exception: ${e.message}`;
    }
  };

  try {
    // === PHASE 0: Refresh lineup/injury data ===
    log("=== PHASE 0: Refreshing lineup & injury data ===");
    await invokeStep(
      "Refreshing lineups & injuries",
      "firecrawl-lineup-scraper",
      {}
    );
    // Brief delay to let injury data propagate
    await new Promise(r => setTimeout(r, 5000));

    // === PHASE 1: Refresh game logs ===
    log("=== PHASE 1: Syncing fresh NBA game logs ===");
    await invokeStep(
      "Syncing game logs (ESPN)",
      "nba-stats-fetcher",
      { mode: "sync", daysBack: 5, useESPN: true, includeParlayPlayers: true }
    );

    // === PHASE 1.5: Scrape real quarter stats from StatMuse ===
    log("=== PHASE 1.5: Scraping real quarter stats (StatMuse) ===");
    // Get today's slate players from unified_props
    const { data: slateProps } = await supabase
      .from("unified_props")
      .select("player_name")
      .gte("scraped_at", new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString());
    
    const slatePlayers = [...new Set((slateProps || []).map(p => p.player_name).filter(Boolean))];
    if (slatePlayers.length > 0) {
      // Batch into groups of 10 to stay within Firecrawl limits
      const batches = [];
      for (let i = 0; i < slatePlayers.length; i += 10) {
        batches.push(slatePlayers.slice(i, i + 10));
      }
      for (let i = 0; i < batches.length; i++) {
        await invokeStep(
          `StatMuse quarter stats batch ${i + 1}/${batches.length}`,
          "scrape-statmuse-quarter-stats",
          { playerNames: batches[i] }
        );
      }
      log(`StatMuse: scraped ${slatePlayers.length} slate players in ${batches.length} batches`);
    } else {
      log("No slate players found, skipping StatMuse scrape");
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

    // Void stale pending parlays
    log("Voiding stale pending parlays...");
    const { error: voidError } = await supabase
      .from("bot_daily_parlays")
      .update({ outcome: "void", lesson_learned: "Voided for L10-fresh rebuild" })
      .eq("parlay_date", today)
      .or("outcome.eq.pending,outcome.is.null");
    if (voidError) log(`Void error: ${JSON.stringify(voidError)}`);
    results["void_pending"] = voidError ? "error" : "ok";

    const rebuildSteps: [string, string, object?][] = [
      ["Cleaning stale props", "cleanup-stale-props", { immediate: true }],
      ["Scanning defensive matchups", "bot-matchup-defense-scanner", {}],
      ["Detecting mispriced lines", "detect-mispriced-lines", {}],
      ["Running risk engine", "nba-player-prop-risk-engine", { action: "analyze_slate", mode: "full_slate" }],
      ["Quality-gated generation", "bot-quality-regen-loop", { target_hit_rate: 35, max_attempts: 3, skip_void: true, adaptive_target: true }],
      ["Running curated pipeline", "bot-curated-pipeline", {}],
      ["Force fresh mispriced parlays", "bot-force-fresh-parlays", {}],
      ["Building sharp parlays", "sharp-parlay-builder", { action: "build" }],
      ["Scanning heat tracker", "heat-prop-engine", { action: "scan" }],
      ["Building heat parlays", "heat-prop-engine", { action: "build" }],
      ["Ladder challenge", "nba-ladder-challenge", {}],
      ["Diversity rebalance", "bot-daily-diversity-rebalance", {}],
      ["Sending slate status", "bot-slate-status-update", {}],
    ];

    for (const [name, fn, body] of rebuildSteps) {
      await invokeStep(name, fn, body || {});
    }

    log("=== ALL PHASES COMPLETE ===");

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    log(`Fatal error: ${err.message}`);
    return new Response(JSON.stringify({ success: false, error: err.message, results }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
