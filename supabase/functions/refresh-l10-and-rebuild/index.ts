import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// refresh-l10-and-rebuild  v2.0
//
// BUG 1 — new Date().toISOString().split("T")[0] returns UTC midnight.
//   On a UTC server this is the WRONG day when run between midnight UTC and
//   midnight ET (e.g. 11 PM ET = UTC next day). All four date locations now
//   call getEasternDate(). Affected phases: phase3c, phase3g, phase3i,
//   phase3_lottery zero-output checks.
//
// BUG 2 — (globalThis as any).__oddsGateBlocked written in phase3_odds_gate
//   and read in phase3c + phase3_lottery. Two problems:
//   (a) Deno isolates are reused across invocations — a blocked gate from
//       a previous run leaves the flag permanently true for the isolate's
//       lifetime, silently blocking ALL future generation runs.
//   (b) Concurrent invocations share globalThis — two simultaneous runs
//       corrupt each other's flag.
//   Fixed: replaced with a closure-scoped boolean local to each request.
//
// BUG 3 — bot-quality-regen-loop is called with { final_cap: 25 }.
//   The regen-loop v7.0 reads body.final_cap and logs it as the cap but
//   then uses the hardcoded FINAL_PARLAY_CAP = 50 for all actual logic.
//   Passing 25 produces a misleading log entry with zero behavioural effect.
//   Removed the stale parameter.
//
// BUG 4 — Forced DNA audit check: results["score-parlays-dna"] !== "ok"
//   incorrectly triggers a force-retry when the first forced retry already
//   succeeded and stored "ok:forced". Fixed to treat both "ok" and "ok:forced"
//   as success. Also fixed: the forced invoke didn't check the returned error —
//   a silent error would log success. Now inspects the invoke result properly.
//
// BUG 5 — invokeParallel used steps.filter(() => hasTime()) which always
//   returns ALL steps because the predicate ignores its index argument — it's
//   a closure over hasTime() called once per item but always returns the same
//   value as of the moment filter runs, not checking between each step.
//   The intent was to skip the batch if time is short. Fixed: single hasTime()
//   guard at the top of invokeParallel, consistent with invokeStep's behaviour.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// BUG 1 FIX: canonical ET date helper — all "today" date references use this
function getEasternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const TIMEOUT_MS = 240_000;
  const functionStartTime = Date.now();
  const MAX_ATTEMPTS = 4;
  const MAX_REGEN = 2;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const body = await req.json().catch(() => ({}));
  const resumeAfter: string | null = body.resume_after || null;
  const currentRunId: string = body.run_id || crypto.randomUUID();
  const currentAttempt: number = body.attempt || 1;
  const regenAttempt: number = body.regen_attempt || 0;

  const log = (msg: string) =>
    console.log(`[refresh-l10-and-rebuild][run:${currentRunId.slice(0,8)}][attempt:${currentAttempt}] ${msg}`);

  const results: Record<string, string> = {};
  const skipped: string[] = [];
  const warnings: string[] = [];

  // BUG 2 FIX: closure-scoped flag — not shared between invocations or
  // across concurrent runs, and automatically reset for every fresh request.
  let oddsGateBlocked = false;

  const sendPipelineAlert = async (message: string) => {
    try {
      await supabase.functions.invoke("bot-send-telegram", {
        body: { message, parse_mode: "Markdown", admin_only: true },
      });
    } catch (_) { /* never break pipeline */ }
  };

  const elapsed = () => Date.now() - functionStartTime;
  const hasTime = () => elapsed() < TIMEOUT_MS;
  const todayET = () => getEasternDate();

  const markUnavailable = (fnName: string, reason: string, isOptional = true) => {
    results[fnName] = `unavailable: ${reason}`;
    const message = `${fnName}: ${reason}`;
    warnings.push(message);
    log(`ℹ ${message}`);
    if (!isOptional) {
      skipped.push(fnName);
    }
  };

  const collectDataQualityDiagnostics = async () => {
    const freshWindow = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const targetDate = todayET();

    const [freshFdPropsRes, pickPoolRes, todayParlaysRes, todayStraightsRes] = await Promise.all([
      supabase
        .from("unified_props")
        .select("id", { count: "exact", head: true })
        .eq("bookmaker", "fanduel")
        .gte("scraped_at", freshWindow),
      supabase
        .from("bot_daily_pick_pool")
        .select("id", { count: "exact", head: true })
        .eq("pick_date", targetDate),
      supabase
        .from("bot_daily_parlays")
        .select("id, tier", { count: "exact" })
        .eq("parlay_date", targetDate)
        .eq("outcome", "pending"),
      supabase
        .from("bot_straight_bets")
        .select("id", { count: "exact", head: true })
        .eq("bet_date", targetDate)
        .eq("outcome", "pending"),
    ]);

    const parlays = todayParlaysRes.data ?? [];

    return {
      target_date: targetDate,
      input_quality: {
        fresh_fanduel_props_2h: freshFdPropsRes.count ?? 0,
        pick_pool_candidates: pickPoolRes.count ?? 0,
      },
      generated_counts: {
        parlays_total: todayParlaysRes.count ?? 0,
        lottery_parlays: parlays.filter((row: any) => row.tier === "lottery").length,
        straight_bets_total: todayStraightsRes.count ?? 0,
      },
    };
  };

  // Non-fatal steps: log warning but don't send pipeline failure alert
  const NON_FATAL_STEPS = new Set([
    'nba-mega-parlay-scanner', 'hrb-nrfi-scanner', 'hrb-mlb-hr-scanner',
    'hrb-mlb-rbi-scanner', 'hrb-mlb-rbi-analyzer', 'tennis-props-sync',
    'tennis-games-analyzer', 'mma-props-sync', 'mma-rounds-analyzer',
    'broadcast-sweet-spots', 'bot-slate-status-update', 'engine-tracker-sync',
  ]);

  const invokeStep = async (name: string, fnName: string, stepBody: object = {}) => {
    if (!hasTime()) {
      log(`⏭ SKIPPED ${name} — timeout approaching (${elapsed()}ms)`);
      results[fnName] = "skipped:timeout";
      skipped.push(fnName);
      return;
    }
    log(`▶ ${name} (${elapsed()}ms elapsed)`);
    try {
      const { data, error } = await supabase.functions.invoke(fnName, { body: stepBody });
      if (error) {
        // Extract the real error from the response body if available
        let errMsg = error.message || JSON.stringify(error);
        if (typeof data === 'object' && data?.error) {
          errMsg = `${data.error} (${errMsg})`;
        }
        log(`⚠ ${name} error: ${errMsg}`);
        results[fnName] = `error: ${errMsg}`;

        if (NON_FATAL_STEPS.has(fnName)) {
          log(`ℹ ${name} is non-fatal — continuing pipeline`);
        } else {
          sendPipelineAlert(
            `🚨 *Pipeline Step Error*\n\n*Step:* ${name}\n*Function:* \`${fnName}\`\n*Error:* ${errMsg}\n*Elapsed:* ${(elapsed()/1000).toFixed(1)}s\n*Run:* \`${currentRunId.slice(0,8)}\``
          );
        }
      } else {
        log(`✅ ${name} done (${elapsed()}ms total)`);
        results[fnName] = "ok";
      }
    } catch (e: any) {
      const errMsg = e.message || 'Unknown exception';
      log(`❌ ${name} exception: ${errMsg}`);
      results[fnName] = `exception: ${errMsg}`;

      if (NON_FATAL_STEPS.has(fnName)) {
        log(`ℹ ${name} is non-fatal — continuing pipeline`);
      } else {
        sendPipelineAlert(
          `🚨 *Pipeline Step Exception*\n\n*Step:* ${name}\n*Function:* \`${fnName}\`\n*Error:* ${errMsg}\n*Elapsed:* ${(elapsed()/1000).toFixed(1)}s\n*Run:* \`${currentRunId.slice(0,8)}\``
        );
      }
    }
  };

  // BUG 5 FIX: single upfront hasTime() check — skip the whole batch if
  // we're already over budget rather than the broken per-item filter predicate
  const invokeParallel = async (steps: [string, string, object?][]) => {
    if (!hasTime()) {
      for (const [name, fn] of steps) {
        log(`⏭ SKIPPED ${name} — timeout approaching`);
        results[fn] = "skipped:timeout";
        skipped.push(fn);
      }
      return;
    }
    log(`▶ Running ${steps.length} steps in parallel (${elapsed()}ms elapsed)`);
    await Promise.all(steps.map(([name, fn, b]) => invokeStep(name, fn, b || {})));
  };

  // ── Phase definitions ──────────────────────────────────────────────────────
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
      label: "Sync NBA + MLB game logs",
      run: async () => {
        log("=== PHASE 1: Syncing fresh NBA + MLB game logs ===");
        await invokeParallel([
          ["Syncing NBA game logs (ESPN)", "nba-stats-fetcher", { mode: "sync", daysBack: 5, useESPN: true, includeParlayPlayers: true }],
          ["Syncing MLB game logs (ESPN)", "mlb-data-ingestion", { days_back: 3, fetch_all: true }],
        ]);
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

        const slatePlayers = [...new Set((slateProps || []).map((p: any) => p.player_name).filter(Boolean))];
        if (slatePlayers.length > 0) {
          for (let i = 0; i < slatePlayers.length; i++) {
            if (!hasTime()) {
              log(`⏭ Skipping remaining StatMuse batches (${i}/${slatePlayers.length}) — timeout`);
              break;
            }
            await invokeStep(
              `StatMuse quarter stats batch ${i + 1}/${slatePlayers.length}`,
              "scrape-statmuse-quarter-stats",
              { playerNames: [slatePlayers[i]] }
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
      label: "Void check (skipped — quality regen handles dedup)",
      run: async () => {
        log("⏭ Skipping blanket void — quality regen loop handles caps & dedup (v7)");
        results["void_pending"] = "skipped:v7_no_selection_void";
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
      id: "phase3_odds_gate",
      label: "FanDuel odds freshness gate",
      run: async () => {
        log("=== PRE-GENERATION GATE: Checking FanDuel odds freshness ===");
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const { count: freshFdProps, error: gateErr } = await supabase
          .from("unified_props")
          .select("*", { count: "exact", head: true })
          .eq("bookmaker", "fanduel")
          .gte("scraped_at", twoHoursAgo);

        if (gateErr) {
          log(`⚠ Odds gate query error: ${gateErr.message} — proceeding anyway`);
          results["odds_gate"] = `query_error: ${gateErr.message}`;
          return;
        }

        const freshCount = freshFdProps || 0;
        if (freshCount < 50) {
          log(`⚠ Only ${freshCount} fresh FanDuel props (need 50+) — attempting odds refresh`);
          await invokeStep("Emergency odds scrape", "whale-odds-scraper", { mode: "full" });

          const { count: retryCount } = await supabase
            .from("unified_props")
            .select("*", { count: "exact", head: true })
            .eq("bookmaker", "fanduel")
            .gte("scraped_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

          const afterScrape = retryCount || 0;
          if (afterScrape < 50) {
            log(`❌ GATE BLOCKED: Still only ${afterScrape} FanDuel props — skipping generation`);
            results["odds_gate"] = `blocked:${afterScrape}_props`;

            // BUG 2 FIX: closure-scoped flag, never persists across invocations
            oddsGateBlocked = true;

            await supabase.functions.invoke("bot-send-telegram", {
              body: {
                message: `🚫 *Odds Gate Blocked*\n\nOnly ${afterScrape} fresh FanDuel props found after emergency scrape.\n\nParlay generation skipped to prevent stale-data parlays.\n\n⚠️ Check whale-odds-scraper and The Odds API status.`,
                parse_mode: "Markdown",
                admin_only: true,
              },
            }).catch(() => {});
            return;
          }

          log(`✅ Emergency scrape recovered: ${afterScrape} fresh FanDuel props — proceeding`);
          results["odds_gate"] = `recovered:${afterScrape}_props`;
        } else {
          log(`✅ Odds gate passed: ${freshCount} fresh FanDuel props`);
          results["odds_gate"] = `passed:${freshCount}_props`;
        }
      },
    },
    {
      id: "phase3c",
      label: "Generate parlays with live engine",
      run: async () => {
        // BUG 2 FIX: reads closure-scoped variable, not globalThis
        if (oddsGateBlocked) {
          log("⏭ Skipping generation — odds gate blocked");
          return;
        }

        await invokeStep("Generating parlays", "parlay-engine-v2", { dry_run: false, date: todayET() });

        // BUG 1 FIX: ET date — parlays are stored with ET parlay_date
        const todayP = todayET();
        const { count: parlayCount } = await supabase
          .from("bot_daily_parlays")
          .select("*", { count: "exact", head: true })
          .eq("parlay_date", todayP)
          .eq("outcome", "pending");
        if ((parlayCount || 0) === 0) {
          sendPipelineAlert(
            `⚠️ *Zero Output Warning*\n\nParlay generation completed but produced *0 parlays* for ${todayP}.\n\nCheck: odds freshness, FanDuel line availability, injury gates.`
          );
        }
      },
    },
    {
      id: "phase3d",
      label: "Sharp + heat scan",
      run: async () => {
        markUnavailable("sharp-parlay-builder", "legacy sharp parlay function is not deployed");
        await invokeStep("Scanning heat tracker", "heat-prop-engine", { action: "scan" });
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
        await invokeStep("Ladder challenge", "nba-ladder-challenge", {});
        markUnavailable("bot-daily-diversity-rebalance", "legacy diversity rebalance function is not deployed");
      },
    },
    {
      id: "phase3_lottery",
      label: "Lottery scanner (mega parlay)",
      run: async () => {
        // BUG 2 FIX: closure-scoped flag
        if (oddsGateBlocked) {
          log("⏭ Skipping lottery — odds gate blocked");
          return;
        }
        await invokeStep("Lottery mega-parlay scanner", "nba-mega-parlay-scanner", {});

        // BUG 1 FIX: ET date
        const todayL = getEasternDate();
        const { count: lotteryCount } = await supabase
          .from("bot_daily_parlays")
          .select("*", { count: "exact", head: true })
          .eq("parlay_date", todayL)
          .eq("tier", "lottery");
        if ((lotteryCount || 0) === 0) {
          sendPipelineAlert(
            `⚠️ *Zero Output Warning*\n\nLottery scanner completed but produced *0 lottery tickets* for ${todayL}.\n\nCheck: mega-parlay scanner, FanDuel lines, minimum leg requirements.`
          );
        }
      },
    },
    {
      id: "phase3_gold",
      label: "Gold Signal Parlay Engine (FanDuel predictions)",
      run: async () => {
        markUnavailable("gold-signal-parlay-engine", "legacy gold signal generator is not deployed");
      },
    },
    {
      id: "phase3_verdict",
      label: "Final Verdict cross-engine consensus",
      run: async () => {
        markUnavailable("final-verdict-engine", "legacy verdict engine is not deployed");
      },
    },
    {
      id: "phase3g",
      label: "DNA audit (mandatory post-generation)",
      run: async () => {
        markUnavailable("score-parlays-dna", "legacy DNA audit function is not deployed");

        // BUG 1 FIX: ET date for post-DNA graded-parlay check
        const todayStr = todayET();
        const { data: gradedParlays } = await supabase
          .from("bot_daily_parlays")
          .select("id")
          .eq("parlay_date", todayStr)
          .eq("outcome", "pending")
          .not("dna_grade", "is", null)
          .limit(1);

        const hasGraded = (gradedParlays || []).length > 0;

        if (!hasGraded && regenAttempt < MAX_REGEN) {
          log(`⚠ ZERO graded pending parlays after DNA audit — triggering regen attempt ${regenAttempt + 1}/${MAX_REGEN}`);
          supabase.functions.invoke("refresh-l10-and-rebuild", {
            body: {
              resume_after: "phase3b",
              run_id: currentRunId,
              attempt: currentAttempt,
              regen_attempt: regenAttempt + 1,
            },
          }).catch((e: any) => log(`⚠ Regen invoke failed: ${e.message}`));
          results["regen_triggered"] = `attempt_${regenAttempt + 1}`;
        } else if (!hasGraded) {
          log(`⚠ ZERO graded pending parlays after ${MAX_REGEN} regen attempts — giving up`);
          results["regen_exhausted"] = `${MAX_REGEN}_attempts_no_graded_parlays`;
        } else {
          log(`✅ ${(gradedParlays || []).length}+ graded pending parlays survive DNA audit`);
        }
      },
    },
    {
      id: "phase3i",
      label: "Generate straight bets",
      run: async () => {
        markUnavailable("bot-generate-straight-bets", "straight bet generator is not deployed in the current backend");

        // BUG 1 FIX: ET date
        const todayS = todayET();
        const { count: straightCount } = await supabase
          .from("bot_straight_bets")
          .select("*", { count: "exact", head: true })
          .eq("bet_date", todayS);
        if ((straightCount || 0) === 0) {
          sendPipelineAlert(
            `⚠️ *Zero Output Warning*\n\nStraight bet generation completed but produced *0 straight bets* for ${todayS}.\n\nCheck: FanDuel line matching, unified_props freshness.`
          );
        }
      },
    },
    {
      id: "phase3h",
      label: "Slate status",
      run: async () => {
        markUnavailable("bot-slate-status-update", "customer slate status broadcaster is not deployed");
      },
    },
    {
      id: "phase3j",
      label: "Broadcast sweet spot picks",
      run: async () => {
        markUnavailable("broadcast-sweet-spots", "sweet spot broadcaster is not deployed");
      },
    },
    {
      id: "phase3k",
      label: "Sync all engines to tracker",
      run: async () => {
        markUnavailable("engine-tracker-sync", "engine tracker sync is not deployed");
      },
    },
  ];

  // Determine start index
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

    // BUG 4 FIX: both "ok" and "ok:forced" are valid success states.
    // Also properly inspects the invoke return value instead of swallowing errors.
    const dnaResult = results["score-parlays-dna"] ?? "";
    const dnaSucceeded = dnaResult === "ok" || dnaResult === "ok:forced";
    if (!dnaSucceeded) {
      log(`⚠ DNA audit did not complete (stored status: "${dnaResult}") — forcing standalone run`);
      try {
        const { error: forcedDnaErr } = await supabase.functions.invoke("score-parlays-dna", { body: {} });
        if (forcedDnaErr) {
          results["score-parlays-dna"] = `forced_error: ${forcedDnaErr.message}`;
          log(`❌ Forced DNA audit returned error: ${forcedDnaErr.message}`);
          sendPipelineAlert(
            `🚨 *DNA Audit Failed*\n\nForced retry returned an error.\n*Error:* ${forcedDnaErr.message}\n*Run:* \`${currentRunId.slice(0,8)}\``
          );
        } else {
          results["score-parlays-dna"] = "ok:forced";
          log("✅ Forced DNA audit completed");
        }
      } catch (dnaErr: any) {
        results["score-parlays-dna"] = `forced_error: ${dnaErr.message}`;
        log(`❌ Forced DNA audit threw: ${dnaErr.message}`);
        sendPipelineAlert(
          `🚨 *DNA Audit Failed*\n\nForced retry also threw.\n*Error:* ${dnaErr.message}\n*Run:* \`${currentRunId.slice(0,8)}\``
        );
      }
    }

    // End-of-run failure summary
    const failedSteps = Object.entries(results).filter(
      ([, v]) => v.startsWith("error:") || v.startsWith("exception:") || v.startsWith("forced_error:")
    );
    if (failedSteps.length > 0) {
      const failList = failedSteps.map(([fn, status]) => `❌ \`${fn}\`: ${status}`).join("\n");
      const okCount = Object.values(results).filter(v => v === "ok" || v === "ok:forced").length;
      sendPipelineAlert(
        `⚠️ *Pipeline Run Complete With Errors*\n\n*Run:* \`${currentRunId.slice(0,8)}\` | Attempt ${currentAttempt}/${MAX_ATTEMPTS}\n\n${failList}\n\n✅ ${okCount} steps OK | ⏭ ${skipped.length} skipped\n*Duration:* ${(elapsed()/1000).toFixed(1)}s`
      );
    }

    // Auto-resume if phases were skipped
    if (skipped.length > 0 && currentAttempt < MAX_ATTEMPTS && lastCompleted) {
      log(`🔄 Auto-continuing: attempt ${currentAttempt + 1}/${MAX_ATTEMPTS}, resuming after "${lastCompleted}"`);
      supabase.functions.invoke("refresh-l10-and-rebuild", {
        body: { resume_after: lastCompleted, run_id: currentRunId, attempt: currentAttempt + 1 },
      }).catch((e: any) => log(`⚠ Continuation invoke failed: ${e.message}`));
    } else if (skipped.length > 0) {
      log(`⚠ Max attempts (${MAX_ATTEMPTS}) reached with ${skipped.length} phases still skipped: ${skipped.join(", ")}`);
    } else {
      log(`✅ ALL PHASES COMPLETE — no continuation needed`);
    }

    return new Response(JSON.stringify({
      success: true, run_id: currentRunId, attempt: currentAttempt,
      last_completed: lastCompleted, results, skipped,
      will_continue: skipped.length > 0 && currentAttempt < MAX_ATTEMPTS,
      elapsed: elapsed(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    log(`Fatal error (${elapsed()}ms): ${err.message}`);
    await sendPipelineAlert(
      `🔴 *FATAL PIPELINE CRASH*\n\n*Error:* ${err.message}\n*Run:* \`${currentRunId.slice(0,8)}\` | Attempt ${currentAttempt}\n*Last completed:* ${lastCompleted || "none"}\n*Duration:* ${(elapsed()/1000).toFixed(1)}s`
    );
    return new Response(JSON.stringify({
      success: false, error: err.message, run_id: currentRunId,
      attempt: currentAttempt, last_completed: lastCompleted, results, skipped, elapsed: elapsed(),
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});