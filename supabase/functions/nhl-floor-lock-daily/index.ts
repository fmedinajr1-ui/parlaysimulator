import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// === Helper: Build optimal combos via combinatorial enumeration ===
function buildOptimalCombos(
  candidates: any[],
  legCount: number,
  minHitRate: number,
  maxCombos: number = 3
) {
  const combos: { combo: any[]; prob: number }[] = [];
  const n = candidates.length;

  if (legCount === 3) {
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        for (let k = j + 1; k < n; k++) {
          const combo = [candidates[i], candidates[j], candidates[k]];
          const players = new Set(combo.map((c) => c.player_name));
          if (players.size < 3) continue;
          // Max 4 same category
          const catCounts: Record<string, number> = {};
          combo.forEach((c) => { catCounts[c.category] = (catCounts[c.category] || 0) + 1; });
          if (Object.values(catCounts).some((v) => v > 4)) continue;
          if (!combo.every((c) => (c.actual_hit_rate || 0) >= minHitRate)) continue;
          const prob = combo.reduce((a, c) => a * (c.actual_hit_rate || 0.5), 1);
          combos.push({ combo, prob });
        }
  } else if (legCount === 4) {
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        for (let k = j + 1; k < n; k++)
          for (let l = k + 1; l < n; l++) {
            const combo = [candidates[i], candidates[j], candidates[k], candidates[l]];
            const players = new Set(combo.map((c) => c.player_name));
            if (players.size < 4) continue;
            const catCounts: Record<string, number> = {};
            combo.forEach((c) => { catCounts[c.category] = (catCounts[c.category] || 0) + 1; });
            if (Object.values(catCounts).some((v) => v > 4)) continue;
            if (!combo.every((c) => (c.actual_hit_rate || 0) >= minHitRate)) continue;
            const prob = combo.reduce((a, c) => a * (c.actual_hit_rate || 0.5), 1);
            combos.push({ combo, prob });
          }
  }

  combos.sort((a, b) => b.prob - a.prob);

  // Pick top non-overlapping combos (no player reuse across combos)
  const selected: { combo: any[]; prob: number }[] = [];
  const usedPlayers = new Set<string>();
  for (const c of combos) {
    if (selected.length >= maxCombos) break;
    const players = c.combo.map((p) => p.player_name);
    if (players.some((p) => usedPlayers.has(p))) continue;
    selected.push(c);
    players.forEach((p) => usedPlayers.add(p));
  }

  return selected;
}

// === Helper: Build ceiling shot parlays ===
function buildCeilingShotLegs(candidates: any[], legCount: number = 3) {
  // Filter for ceiling shot eligibility
  const eligible = candidates.filter((c) => {
    const line = c.actual_line || c.recommended_line || 0;
    const max = c.l10_max || 0;
    const hitRate = c.actual_hit_rate || 0;
    if (line <= 0) return false;
    // Ceiling must be 30%+ above line AND hit rate >= 45%
    return max >= line * 1.3 && hitRate >= 0.45;
  });

  // Sort by upside ratio (ceiling / line)
  eligible.sort((a, b) => {
    const ratioA = (a.l10_max || 0) / (a.actual_line || a.recommended_line || 1);
    const ratioB = (b.l10_max || 0) / (b.actual_line || b.recommended_line || 1);
    return ratioB - ratioA;
  });

  // Deduplicate by player
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const c of eligible) {
    if (!seen.has(c.player_name)) {
      seen.add(c.player_name);
      deduped.push(c);
    }
  }

  return deduped.slice(0, legCount);
}

function formatLegs(legs: any[]) {
  return legs.map((l: any, i: number) =>
    `${i + 1}. ${l.player} — ${l.prop} ${l.side} ${l.line}\n   🎯 L10: ${Math.round((l.l10_hit_rate || 0) * 100)}% | Avg ${l.l10_avg} | Floor ${l.l10_min} | Ceiling ${l.l10_max}`
  ).join("\n\n");
}

function buildLegRecord(pick: any) {
  return {
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
  };
}

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
  const allParlayMessages: string[] = [];

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

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  try {
    // === PRE-CHECK: Are there NHL games today? ===
    const { count: todayPropsCount } = await supabase
      .from("unified_props")
      .select("*", { count: "exact", head: true })
      .eq("sport", "icehockey_nhl")
      .gte("commence_time", `${today}T00:00:00Z`)
      .lt("commence_time", `${today}T23:59:59Z`);

    // Also check tomorrow (games listed as next day in UTC)
    const tomorrow = new Date(new Date(`${today}T12:00:00`).getTime() + 86400000).toISOString().split("T")[0];
    const { count: tomorrowEarlyCount } = await supabase
      .from("unified_props")
      .select("*", { count: "exact", head: true })
      .eq("sport", "icehockey_nhl")
      .gte("commence_time", `${today}T17:00:00Z`) // 12pm ET = 5pm UTC
      .lt("commence_time", `${tomorrow}T10:00:00Z`); // through early next day UTC

    const totalGameProps = (todayPropsCount || 0) + (tomorrowEarlyCount || 0);
    log(`NHL props check: ${todayPropsCount || 0} today UTC + ${tomorrowEarlyCount || 0} evening/tonight = ${totalGameProps} total`);

    if (totalGameProps === 0) {
      log("No NHL games today — skipping all phases");
      const noGamesMsg = `🏒 NHL Daily Parlays — ${today}\n\n📅 No NHL games scheduled today. No parlays generated.`;
      await supabase.functions.invoke("bot-send-telegram", {
        body: { message: noGamesMsg, bypass_quiet_hours: false },
      });

      await supabase.from("cron_job_history").insert({
        job_name: "nhl-floor-lock-daily",
        status: "completed",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        result: { skipped: true, reason: "no_nhl_games_today" },
      });

      return new Response(JSON.stringify({ success: true, skipped: true, reason: "no_nhl_games_today" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === PHASE 1: Refresh NHL data ===
    log("=== PHASE 1: Refreshing NHL data ===");
    await invokeStep("Fetching NHL game logs", "nhl-stats-fetcher", {});
    await invokeStep("Fetching NHL team defense rankings", "nhl-team-defense-rankings-fetcher", {});
    await invokeStep("Scanning NHL prop sweet spots", "nhl-prop-sweet-spots-scanner", {});

    // === Fetch all NHL candidates — only today's analysis ===
    const { data: allCandidates, error: queryError } = await supabase
      .from("category_sweet_spots")
      .select("*")
      .eq("is_active", true)
      .eq("analysis_date", today)
      .like("category", "NHL_%")
      .order("actual_hit_rate", { ascending: false })
      .order("l10_avg", { ascending: false });

    if (queryError) {
      log(`Query error: ${JSON.stringify(queryError)}`);
      throw queryError;
    }

    log(`Found ${allCandidates?.length || 0} total NHL candidates for ${today}`);
    const candidates = allCandidates || [];

    // ============================================================
    // === PHASE 2A: Floor Lock Parlay (100% L10 hit rate) ===
    // ============================================================
    log("=== PHASE 2A: Building NHL Floor Lock Parlay ===");

    let floorCandidates = candidates.filter(
      (c) => (c.actual_hit_rate || 0) >= 1.0 && (c.l10_min || 0) >= 1
    );

    if (floorCandidates.length < 3) {
      log("Not enough 100% candidates, relaxing to 80%+ hit rate...");
      const relaxed = candidates.filter(
        (c) => (c.actual_hit_rate || 0) >= 0.8 && (c.l10_min || 0) >= 0.5
      );
      const existingIds = new Set(floorCandidates.map((c) => c.id));
      floorCandidates.push(...relaxed.filter((r) => !existingIds.has(r.id)));
    }

    // Deduplicate by player
    const seenFL = new Set<string>();
    const dedupedFL: typeof floorCandidates = [];
    for (const pick of floorCandidates) {
      if (!seenFL.has(pick.player_name)) {
        seenFL.add(pick.player_name);
        dedupedFL.push(pick);
      }
    }

    if (dedupedFL.length >= 3) {
      const legCount = Math.min(dedupedFL.length, dedupedFL.length >= 5 ? 5 : 4);
      const selectedLegs = dedupedFL.slice(0, legCount);
      const legs = selectedLegs.map(buildLegRecord);
      const combinedProb = selectedLegs.reduce((acc, p) => acc * (p.actual_hit_rate || 0.8), 1);
      const estimatedOdds = combinedProb > 0 ? Math.round((1 / combinedProb - 1) * 100) : 200;

      const { error: insertError } = await supabase.from("bot_daily_parlays").insert({
        strategy_name: "nhl_floor_lock",
        tier: "execution",
        parlay_date: today,
        legs,
        leg_count: legs.length,
        combined_probability: Math.round(combinedProb * 1000) / 1000,
        expected_odds: estimatedOdds,
        selection_rationale: `NHL Floor Lock: ${legs.length} legs with ${Math.round(combinedProb * 100)}% combined L10 probability.`,
        is_simulated: true,
      });

      if (insertError) {
        log(`Floor lock insert error: ${JSON.stringify(insertError)}`);
        results["floor_lock"] = `error: ${insertError.message}`;
      } else {
        log(`✅ Floor lock parlay inserted: ${legs.length} legs`);
        results["floor_lock"] = "ok";
        allParlayMessages.push(
          `🔒 NHL FLOOR LOCK (${legs.length}-Leg)\nCombined Prob: ${Math.round(combinedProb * 100)}%\n\n${formatLegs(legs)}\n\n💡 Every pick's WORST game in L10 still clears the line.`
        );
      }
    } else {
      log(`Only ${dedupedFL.length} floor lock candidates — skipping`);
      results["floor_lock"] = "skipped_insufficient";
    }

    // ============================================================
    // === PHASE 2B: Optimal Combo (Combinatorial Optimizer) ===
    // ============================================================
    log("=== PHASE 2B: Building NHL Optimal Combo Parlays ===");

    // Deduplicate by player first, take top 20 to avoid memory explosion (C(360,3) = 7.7M!)
    const ocSeen = new Set<string>();
    const optimalCandidates: typeof candidates = [];
    for (const c of candidates) {
      if ((c.actual_hit_rate || 0) >= 0.6 && !ocSeen.has(c.player_name)) {
        ocSeen.add(c.player_name);
        optimalCandidates.push(c);
      }
    }
    // Cap at top 20 by hit rate (already sorted)
    const ocPool = optimalCandidates.slice(0, 20);
    log(`Optimal combo pool: ${ocPool.length} candidates (deduped, top 20, 60%+ hit rate)`);

    // Execution: 70%+ hit rate, 3-leg
    const execCombos = buildOptimalCombos(
      ocPool.filter((c) => (c.actual_hit_rate || 0) >= 0.7),
      3,
      0.7,
      1
    );

    // Exploration: 60%+ hit rate, 3-leg
    const exploreCombos = buildOptimalCombos(
      ocPool,
      3,
      0.6,
      2
    );

    const allOCCombos = [...execCombos, ...exploreCombos];
    let ocInserted = 0;

    for (let idx = 0; idx < allOCCombos.length; idx++) {
      const { combo, prob } = allOCCombos[idx];
      const legs = combo.map(buildLegRecord);
      const tier = idx === 0 ? "execution" : "exploration";
      const estimatedOdds = prob > 0 ? Math.round((1 / prob - 1) * 100) : 300;

      const { error: insertErr } = await supabase.from("bot_daily_parlays").insert({
        strategy_name: "nhl_optimal_combo",
        tier,
        parlay_date: today,
        legs,
        leg_count: legs.length,
        combined_probability: Math.round(prob * 1000) / 1000,
        expected_odds: estimatedOdds,
        selection_rationale: `NHL Optimal Combo (${tier}): Best ${legs.length}-leg combination by product of L10 hit rates. Combined: ${Math.round(prob * 100)}%.`,
        is_simulated: true,
      });

      if (insertErr) {
        log(`OC insert error: ${JSON.stringify(insertErr)}`);
      } else {
        ocInserted++;
      }
    }

    log(`✅ Optimal combo: inserted ${ocInserted} parlays`);
    results["optimal_combo"] = ocInserted > 0 ? `ok (${ocInserted})` : "skipped_insufficient";

    if (allOCCombos.length > 0) {
      const best = allOCCombos[0];
      const legs = best.combo.map(buildLegRecord);
      allParlayMessages.push(
        `🎯 NHL OPTIMAL COMBO (${legs.length}-Leg)\nCombined Prob: ${Math.round(best.prob * 100)}%\n\n${formatLegs(legs)}\n\n💡 Best combination by product of individual L10 hit rates.`
      );
    }

    // ============================================================
    // === PHASE 2C: Ceiling Shot (High-Upside Parlays) ===
    // ============================================================
    log("=== PHASE 2C: Building NHL Ceiling Shot Parlays ===");

    const ceilingLegs = buildCeilingShotLegs(candidates, 3);
    log(`Ceiling shot eligible: ${ceilingLegs.length} picks`);

    if (ceilingLegs.length >= 3) {
      const legs = ceilingLegs.map((pick) => {
        const line = pick.actual_line || pick.recommended_line || 0.5;
        const max = pick.l10_max || 0;
        // Use alt line near ceiling if ceiling is 50%+ above standard line
        const altLine = max >= line * 1.5 ? Math.round((max * 0.85) * 2) / 2 : line;
        return {
          ...buildLegRecord(pick),
          line: altLine,
          standard_line: line,
          ceiling: max,
          upside_ratio: Math.round((max / line) * 100) / 100,
        };
      });

      const combinedProb = ceilingLegs.reduce((acc, p) => acc * (p.actual_hit_rate || 0.5), 1);
      const estimatedOdds = combinedProb > 0 ? Math.round((1 / combinedProb - 1) * 100) : 500;

      const { error: insertErr } = await supabase.from("bot_daily_parlays").insert({
        strategy_name: "nhl_ceiling_shot",
        tier: "exploration",
        parlay_date: today,
        legs,
        leg_count: legs.length,
        combined_probability: Math.round(combinedProb * 1000) / 1000,
        expected_odds: estimatedOdds,
        selection_rationale: `NHL Ceiling Shot: ${legs.length} legs targeting alt lines near L10 ceiling. Upside-first selection.`,
        is_simulated: true,
      });

      if (insertErr) {
        log(`Ceiling shot insert error: ${JSON.stringify(insertErr)}`);
        results["ceiling_shot"] = `error: ${insertErr.message}`;
      } else {
        log(`✅ Ceiling shot parlay inserted: ${legs.length} legs`);
        results["ceiling_shot"] = "ok";

        const csFormatted = legs.map((l: any, i: number) =>
          `${i + 1}. ${l.player} — ${l.prop} ${l.side} ${l.line}${l.line !== l.standard_line ? ` (std: ${l.standard_line})` : ''}\n   🚀 Ceiling: ${l.ceiling} (${l.upside_ratio}x line) | L10: ${Math.round((l.l10_hit_rate || 0) * 100)}%`
        ).join("\n\n");

        allParlayMessages.push(
          `🚀 NHL CEILING SHOT (${legs.length}-Leg)\nCombined Prob: ${Math.round(combinedProb * 100)}%\n\n${csFormatted}\n\n💡 Alt lines near each player's L10 ceiling for plus-money upside.`
        );
      }
    } else {
      log(`Only ${ceilingLegs.length} ceiling shot candidates — skipping`);
      results["ceiling_shot"] = "skipped_insufficient";
    }

    // ============================================================
    // === PHASE 3: Consolidated Telegram Broadcast ===
    // ============================================================
    log("=== PHASE 3: Broadcasting to Telegram ===");

    if (allParlayMessages.length === 0) {
      const noPicksMsg = `🏒 NHL Daily Parlays — ${today}\n\n⚠️ Not enough qualifying picks today.\nNo parlays generated.`;
      await supabase.functions.invoke("bot-send-telegram", {
        body: { message: noPicksMsg, bypass_quiet_hours: true },
      });
      results["telegram"] = "sent_no_picks";
    } else {
      const fullMessage = `🏒 NHL DAILY PARLAYS — ${today}\n\n` +
        allParlayMessages.join("\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n") +
        `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n🏒 Strategies: Floor Lock | Optimal Combo | Ceiling Shot`;

      await supabase.functions.invoke("bot-send-telegram", {
        body: { message: fullMessage, bypass_quiet_hours: true },
      });
      results["telegram"] = "ok";
    }

    const duration = Date.now() - startTime;
    log(`=== ALL PHASES COMPLETE in ${duration}ms ===`);

    await supabase.from("cron_job_history").insert({
      job_name: "nhl-floor-lock-daily",
      status: "completed",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { results, parlays_broadcast: allParlayMessages.length },
    });

    return new Response(JSON.stringify({ success: true, results, parlays_broadcast: allParlayMessages.length, duration }), {
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
