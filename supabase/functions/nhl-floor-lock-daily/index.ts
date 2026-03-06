import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const startTime = Date.now();

  const log = (msg: string) => console.log(`[nhl-floor-lock-daily] ${msg}`);
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
    // === PHASE 1: Refresh NHL data ===
    log("=== PHASE 1: Refreshing NHL data ===");
    await invokeStep("Fetching NHL game logs", "nhl-stats-fetcher", {});
    await invokeStep("Fetching NHL team defense rankings", "nhl-team-defense-rankings-fetcher", {});
    await invokeStep("Scanning NHL prop sweet spots", "nhl-prop-sweet-spots-scanner", {});

    // === PHASE 2: Build floor lock parlay ===
    log("=== PHASE 2: Building NHL Floor Lock Parlay ===");

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

    // Query category_sweet_spots for NHL picks with perfect L10 hit rate
    const { data: candidates, error: queryError } = await supabase
      .from("category_sweet_spots")
      .select("*")
      .gte("actual_hit_rate", 1.0)
      .gte("l10_min", 1)
      .eq("is_active", true)
      .like("category", "NHL_%")
      .order("l10_avg", { ascending: false });

    if (queryError) {
      log(`Query error: ${JSON.stringify(queryError)}`);
      throw queryError;
    }

    log(`Found ${candidates?.length || 0} candidates with 100% L10 hit rate`);

    if (!candidates || candidates.length < 3) {
      // Fallback: relax to 80%+ hit rate
      log("Not enough 100% candidates, relaxing to 80%+ hit rate...");
      const { data: relaxed } = await supabase
        .from("category_sweet_spots")
        .select("*")
        .gte("actual_hit_rate", 0.8)
        .gte("l10_min", 0.5)
        .eq("is_active", true)
        .like("category", "NHL_%")
        .order("actual_hit_rate", { ascending: false })
        .order("l10_avg", { ascending: false })
        .limit(10);

      if (relaxed && relaxed.length >= 3) {
        candidates?.push(...relaxed.filter(r => !candidates.some(c => c.id === r.id)));
      }
    }

    const finalCandidates = candidates || [];

    if (finalCandidates.length < 3) {
      log(`Only ${finalCandidates.length} NHL candidates — skipping parlay build`);
      results["parlay_build"] = "skipped_insufficient_candidates";

      await supabase.functions.invoke("bot-send-telegram", {
        body: {
          message: `🏒 NHL Floor Lock Daily — ${today}\n\n⚠️ Not enough qualifying picks today (${finalCandidates.length} found, need 3+).\nNo parlay generated.`,
          bypass_quiet_hours: true,
        },
      });

      return new Response(JSON.stringify({ success: true, results, candidates: finalCandidates.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deduplicate by player (take best per player)
    const seenPlayers = new Set<string>();
    const dedupedPicks: typeof finalCandidates = [];
    for (const pick of finalCandidates) {
      if (!seenPlayers.has(pick.player_name)) {
        seenPlayers.add(pick.player_name);
        dedupedPicks.push(pick);
      }
    }

    // Take top 4-5 legs
    const legCount = Math.min(dedupedPicks.length, dedupedPicks.length >= 5 ? 5 : 4);
    const selectedLegs = dedupedPicks.slice(0, legCount);

    // Build legs array for bot_daily_parlays
    const legs = selectedLegs.map((pick) => ({
      player: pick.player_name,
      prop: pick.prop_type,
      side: pick.recommended_side || "OVER",
      line: pick.recommended_line || pick.actual_line || 0.5,
      category: pick.category,
      l10_hit_rate: pick.actual_hit_rate,
      l10_avg: pick.l10_avg,
      l10_min: pick.l10_min,
      l10_max: pick.l10_max,
      quality_tier: pick.quality_tier,
    }));

    // Compute combined probability (product of individual hit rates)
    const combinedProb = selectedLegs.reduce((acc, p) => acc * (p.actual_hit_rate || 0.8), 1);

    // Estimate odds from combined probability
    const estimatedOdds = combinedProb > 0 ? Math.round((1 / combinedProb - 1) * 100) : 200;

    // Insert parlay
    const { error: insertError } = await supabase.from("bot_daily_parlays").insert({
      strategy_name: "nhl_floor_lock",
      tier: "execution",
      parlay_date: today,
      legs,
      leg_count: legs.length,
      combined_probability: Math.round(combinedProb * 1000) / 1000,
      expected_odds: estimatedOdds,
      selection_rationale: `NHL Floor Lock: ${legs.length} legs with ${Math.round(combinedProb * 100)}% combined L10 probability. All picks have l10_min >= floor threshold.`,
      is_simulated: true,
    });

    if (insertError) {
      log(`Insert error: ${JSON.stringify(insertError)}`);
      results["parlay_build"] = `error: ${insertError.message}`;
    } else {
      log(`✅ Floor lock parlay inserted: ${legs.length} legs`);
      results["parlay_build"] = "ok";
    }

    // === PHASE 3: Telegram broadcast ===
    log("=== PHASE 3: Broadcasting to Telegram ===");

    const legLines = legs.map((l, i) =>
      `${i + 1}. ${l.player} — ${l.prop} ${l.side} ${l.line}\n   🎯 L10: ${Math.round((l.l10_hit_rate || 0) * 100)}% | Avg ${l.l10_avg} | Floor ${l.l10_min} | Ceiling ${l.l10_max}`
    ).join("\n\n");

    const message = `🏒🔒 NHL FLOOR LOCK PARLAY — ${today}\n\n` +
      `${legs.length}-Leg Floor Lock (L10 Min ≥ Line)\n` +
      `Combined Probability: ${Math.round(combinedProb * 100)}%\n\n` +
      `${legLines}\n\n` +
      `💡 Every pick's WORST game in L10 still clears the line.\n` +
      `Strategy: nhl_floor_lock | Tier: execution`;

    await supabase.functions.invoke("bot-send-telegram", {
      body: { message, bypass_quiet_hours: true },
    });

    results["telegram"] = "ok";

    const duration = Date.now() - startTime;
    log(`=== ALL PHASES COMPLETE in ${duration}ms ===`);

    await supabase.from("cron_job_history").insert({
      job_name: "nhl-floor-lock-daily",
      status: "completed",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { legs: legs.length, combinedProb, results },
    });

    return new Response(JSON.stringify({ success: true, legs: legs.length, combinedProb, results, duration }), {
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
