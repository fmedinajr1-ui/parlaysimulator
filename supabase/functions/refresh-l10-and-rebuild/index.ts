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

const MIN_APPROVED_RISK_PICKS = 8;
// KILL SWITCH — risk layer is advisory, never gate the slate
const RISK_LAYER_BYPASSED = true;

async function getRiskPickCount(supabase: any, targetDate: string): Promise<number> {
  const { count } = await supabase
    .from("nba_risk_engine_picks")
    .select("id", { count: "exact", head: true })
    .eq("game_date", targetDate)
    .eq("mode", "full_slate")
    .is("rejection_reason", null);
  return count ?? 0;
}

async function getSweetSpotCount(supabase: any, targetDate: string): Promise<number> {
  const { count } = await supabase
    .from("category_sweet_spots")
    .select("id", { count: "exact", head: true })
    .eq("analysis_date", targetDate)
    .eq("is_active", true);
  return count ?? 0;
}

async function getParlayCount(supabase: any, targetDate: string): Promise<number> {
  const { count } = await supabase
    .from("bot_daily_parlays")
    .select("id", { count: "exact", head: true })
    .eq("parlay_date", targetDate)
    .eq("outcome", "pending");
  return count ?? 0;
}

async function getStraightCount(supabase: any, targetDate: string): Promise<number> {
  const { count } = await supabase
    .from("bot_straight_bets")
    .select("id", { count: "exact", head: true })
    .eq("bet_date", targetDate)
    .eq("outcome", "pending");
  return count ?? 0;
}

async function getUploadedPipelinePickCount(supabase: any, targetDate: string): Promise<number> {
  const { count } = await supabase
    .from("bot_daily_picks")
    .select("id", { count: "exact", head: true })
    .eq("pick_date", targetDate)
    .eq("generator", "uploaded-pipeline-v1")
    .eq("status", "locked");
  return count ?? 0;
}

async function getLatestSourceTimestamp(
  supabase: any,
  table: string,
  selectColumn: string,
  filters: Array<[string, string | boolean]>,
): Promise<string | null> {
  let query = supabase.from(table).select(selectColumn).order(selectColumn, { ascending: false }).limit(1);
  for (const [column, value] of filters) {
    query = query.eq(column, value);
  }
  const { data, error } = await query;
  if (error) return null;
  return data?.[0]?.[selectColumn] ?? null;
}

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
  const statmuseDiagnostics: Record<string, number | string> = {};

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

    const [freshFdPropsRes, allFdPropsRes, riskRes, sweetSpotRes, todayParlaysRes, todayStraightsRes, latestFdFreshnessAt, latestAnyBookFreshnessAt, latestRiskAt, latestSweetSpotAt] = await Promise.all([
      supabase
        .from("unified_props")
        .select("id", { count: "exact", head: true })
        .eq("bookmaker", "fanduel")
        .or(`odds_updated_at.gte.${freshWindow},updated_at.gte.${freshWindow},created_at.gte.${freshWindow}`),
      supabase
        .from("unified_props")
        .select("id", { count: "exact", head: true })
        .eq("bookmaker", "fanduel"),
      supabase
        .from("nba_risk_engine_picks")
        .select("id", { count: "exact", head: true })
        .eq("game_date", targetDate)
        .eq("mode", "full_slate")
        .is("rejection_reason", null),
      supabase
        .from("category_sweet_spots")
        .select("id", { count: "exact", head: true })
        .eq("analysis_date", targetDate)
        .eq("is_active", true),
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
      getLatestSourceTimestamp(supabase, "unified_props", "odds_updated_at", [["bookmaker", "fanduel"]]),
      getLatestSourceTimestamp(supabase, "unified_props", "updated_at", []),
      getLatestSourceTimestamp(supabase, "nba_risk_engine_picks", "created_at", [["game_date", targetDate], ["mode", "full_slate"]]),
      getLatestSourceTimestamp(supabase, "category_sweet_spots", "created_at", [["analysis_date", targetDate], ["is_active", true]]),
    ]);

    const parlays = todayParlaysRes.data ?? [];

    const freshFdCount = freshFdPropsRes.count ?? 0;
    const totalFdCount = allFdPropsRes.count ?? 0;
    const riskCount = riskRes.count ?? 0;
    const sweetSpotCount = sweetSpotRes.count ?? 0;

    // Risk layer is now advisory. Only block on (1) no fresh props at all, or
    // (2) no usable matches downstream. Risk thin/empty = soft warning.
    const blockCode = freshFdCount === 0
      ? (totalFdCount === 0 ? "blocked:no_props_for_today" : "blocked:stale_odds")
      : ((todayParlaysRes.count ?? 0) + (todayStraightsRes.count ?? 0)) === 0
        ? "blocked:no_usable_matches"
        : "ready";

    const riskLayerStatus = riskCount === 0
      ? "empty"
      : riskCount < MIN_APPROVED_RISK_PICKS
        ? "thin"
        : "active";

    return {
      target_date: targetDate,
      block_code: blockCode,
      risk_layer_status: riskLayerStatus,
      risk_layer_bypassed: RISK_LAYER_BYPASSED,
      input_quality: {
        fresh_fanduel_props_2h: freshFdCount,
        total_fanduel_props: totalFdCount,
        direct_risk_candidates: riskCount,
        direct_fallback_candidates: sweetSpotCount,
      },
      generated_counts: {
        parlays_total: todayParlaysRes.count ?? 0,
        lottery_parlays: parlays.filter((row: any) => row.tier === "lottery").length,
        straight_bets_total: todayStraightsRes.count ?? 0,
      },
      freshness: {
        latest_fanduel_update_at: latestFdFreshnessAt,
        latest_any_book_update_at: latestAnyBookFreshnessAt,
        latest_risk_update_at: latestRiskAt,
        latest_sweet_spot_update_at: latestSweetSpotAt,
      },
      pipeline_health: {
        direct_sources_ready: (riskCount + sweetSpotCount) > 0,
        parlay_output_ready: (todayParlaysRes.count ?? 0) > 0,
        ready: blockCode === "ready",
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
        const freshnessWindow = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
        const recentBaselineWindow = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const PHASE_BUDGET_MS = 45_000;
        const BATCH_SIZE = 4;
        const MAX_PLAYERS_PER_RUN = 12;
        const phaseStartedAt = Date.now();

        const { data: slateProps, error: slatePropsError } = await supabase
          .from("unified_props")
          .select("player_name")
          .or(`odds_updated_at.gte.${freshnessWindow},updated_at.gte.${freshnessWindow},created_at.gte.${freshnessWindow}`);

        if (slatePropsError) {
          const reason = `slate props lookup failed: ${slatePropsError.message}`;
          warnings.push(`StatMuse phase: ${reason}`);
          results["scrape-statmuse-quarter-stats"] = `warning:${reason}`;
          statmuseDiagnostics.statmuse_phase_status = "slate_lookup_failed";
          log(`⚠ ${reason}`);
          return;
        }

        const slatePlayers = [...new Set((slateProps || []).map((p: any) => p.player_name).filter(Boolean))];
        statmuseDiagnostics.slate_players_total = slatePlayers.length;

        if (slatePlayers.length === 0) {
          statmuseDiagnostics.statmuse_phase_status = "no_slate_players";
          log("No slate players found, skipping StatMuse scrape");
          return;
        }

        const { data: recentBaselines, error: recentBaselinesError } = await supabase
          .from("player_quarter_baselines")
          .select("player_name, updated_at, data_source")
          .in("player_name", slatePlayers)
          .eq("data_source", "statmuse")
          .gte("updated_at", recentBaselineWindow);

        if (recentBaselinesError) {
          const reason = `baseline coverage lookup failed: ${recentBaselinesError.message}`;
          warnings.push(`StatMuse phase: ${reason}`);
          results["scrape-statmuse-quarter-stats"] = `warning:${reason}`;
          statmuseDiagnostics.statmuse_phase_status = "baseline_lookup_failed";
          log(`⚠ ${reason}`);
          return;
        }

        const coveredPlayers = new Set((recentBaselines || []).map((row: any) => row.player_name).filter(Boolean));
        const missingPlayers = slatePlayers.filter(player => !coveredPlayers.has(player));
        const playersToAttempt = missingPlayers.slice(0, MAX_PLAYERS_PER_RUN);

        statmuseDiagnostics.statmuse_recent_baseline_players = coveredPlayers.size;
        statmuseDiagnostics.statmuse_missing_players = missingPlayers.length;
        statmuseDiagnostics.statmuse_players_capped = Math.max(0, missingPlayers.length - playersToAttempt.length);

        if (playersToAttempt.length === 0) {
          statmuseDiagnostics.statmuse_phase_status = "no_missing_players";
          results["scrape-statmuse-quarter-stats"] = "ok:no_missing_players";
          log(`StatMuse: ${coveredPlayers.size}/${slatePlayers.length} slate players already covered by recent baselines`);
          return;
        }

        let attemptedBatches = 0;
        let processedPlayers = 0;
        let failedPlayers = 0;
        let completedAllBatches = true;

        for (let i = 0; i < playersToAttempt.length; i += BATCH_SIZE) {
          const batch = playersToAttempt.slice(i, i + BATCH_SIZE);
          const phaseElapsed = Date.now() - phaseStartedAt;
          if (!hasTime() || phaseElapsed >= PHASE_BUDGET_MS) {
            completedAllBatches = false;
            log(`⏭ Skipping remaining StatMuse batches (${i}/${playersToAttempt.length}) — phase budget hit at ${phaseElapsed}ms`);
            break;
          }

          attemptedBatches += 1;
          log(`▶ StatMuse quarter stats batch ${attemptedBatches}: ${batch.join(", ")}`);

          try {
            const { data, error } = await supabase.functions.invoke("scrape-statmuse-quarter-stats", {
              body: { playerNames: batch },
            });

            if (error) {
              failedPlayers += batch.length;
              completedAllBatches = false;
              const errMsg = error.message || JSON.stringify(error);
              warnings.push(`StatMuse batch ${attemptedBatches} failed: ${errMsg}`);
              log(`⚠ StatMuse batch ${attemptedBatches} failed: ${errMsg}`);
              continue;
            }

            const playerResults = (data && typeof data === "object" && data.results && typeof data.results === "object")
              ? data.results as Record<string, string>
              : {};

            for (const playerName of batch) {
              const status = playerResults[playerName] || "unknown";
              if (status.startsWith("ok")) {
                processedPlayers += 1;
              } else {
                failedPlayers += 1;
              }
            }
          } catch (e: any) {
            failedPlayers += batch.length;
            completedAllBatches = false;
            const errMsg = e?.message || "Unknown exception";
            warnings.push(`StatMuse batch ${attemptedBatches} exception: ${errMsg}`);
            log(`❌ StatMuse batch ${attemptedBatches} exception: ${errMsg}`);
          }
        }

        statmuseDiagnostics.statmuse_batches_attempted = attemptedBatches;
        statmuseDiagnostics.statmuse_players_attempted = playersToAttempt.length;
        statmuseDiagnostics.statmuse_players_processed = processedPlayers;
        statmuseDiagnostics.statmuse_players_failed = failedPlayers;
        statmuseDiagnostics.statmuse_phase_budget_ms = PHASE_BUDGET_MS;
        statmuseDiagnostics.statmuse_phase_elapsed_ms = Date.now() - phaseStartedAt;

        if (processedPlayers === 0 && failedPlayers > 0) {
          statmuseDiagnostics.statmuse_phase_status = completedAllBatches ? "failed" : "skipped_timeout";
          results["scrape-statmuse-quarter-stats"] = `warning:${failedPlayers}_players_failed`;
        } else if (!completedAllBatches || failedPlayers > 0) {
          statmuseDiagnostics.statmuse_phase_status = !completedAllBatches ? "partial_timeout" : "partial";
          results["scrape-statmuse-quarter-stats"] = `partial:${processedPlayers}_ok:${failedPlayers}_failed`;
        } else {
          statmuseDiagnostics.statmuse_phase_status = "completed";
          results["scrape-statmuse-quarter-stats"] = `ok:${processedPlayers}_players`;
        }
      },
    },
    {
      id: "phase2",
      label: "Refresh upstream prop and stats inputs",
      run: async () => {
        log("=== PHASE 2: Refreshing upstream prop and stats inputs ===");
        await invokeParallel([
          ["Refreshing today props", "refresh-todays-props", {}],
          ["Refreshing PVS inputs", "pvs-data-ingestion", { mode: "live" }],
        ]);
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
        await invokeStep("Cleaning stale props", "cleanup-stale-props", { immediate: true });
        markUnavailable("bot-matchup-defense-scanner", "legacy matchup defense scanner is not deployed");
        markUnavailable("detect-mispriced-lines", "legacy mispriced-line feeder is not deployed");
        markUnavailable("matchup-intelligence-analyzer", "legacy matchup intelligence feeder is not deployed");
      },
    },
    {
      id: "phase3b",
      label: "Risk engine",
      run: async () => {
        const targetDate = todayET();
        const { data, error } = await supabase.functions.invoke("nba-player-prop-risk-engine", {
          body: {
            action: "analyze_slate",
            mode: "full_slate",
            use_live_odds: true,
            thin_day_fallback: true,
            minimum_approved_picks: MIN_APPROVED_RISK_PICKS,
          },
        });

        if (error) {
          const errMsg = error.message || "Unknown risk engine error";
          log(`⚠ Running risk engine error: ${errMsg}`);
          results["nba-player-prop-risk-engine"] = `error: ${errMsg}`;
          await sendPipelineAlert(
            `🚨 *Pipeline Step Error*\n\n*Step:* Risk engine\n*Function:* \`nba-player-prop-risk-engine\`\n*Error:* ${errMsg}\n*Elapsed:* ${(elapsed()/1000).toFixed(1)}s\n*Run:* \`${currentRunId.slice(0,8)}\``,
          );
          return;
        }

        const blockedReason = data?.blockedReason as string | undefined;
        const rejectionSummary = Array.isArray(data?.diagnostics?.topRejectionReasons)
          ? data.diagnostics.topRejectionReasons.slice(0, 5).map((item: any) => `${item.reason}: ${item.count}`).join(" | ")
          : "none";

        results["nba-player-prop-risk-engine"] = blockedReason
          ? `${blockedReason}:${data?.approvedCount ?? 0}`
          : "ok";

        const approvedCount = await getRiskPickCount(supabase, targetDate);
        if (approvedCount < MIN_APPROVED_RISK_PICKS) {
          warnings.push(`Risk engine produced only ${approvedCount} approved picks for ${targetDate}`);
          results["nba-player-prop-risk-engine"] = blockedReason || `warning:thin_output:${approvedCount}`;
          await sendPipelineAlert(
            `⚠️ *Risk Engine Thin Output*\n\n*Date:* ${targetDate}\n*Approved picks:* ${approvedCount}\n*Minimum target:* ${MIN_APPROVED_RISK_PICKS}\n*Block:* ${blockedReason || 'warning:thin_output'}\n*Top rejections:* ${rejectionSummary}\n*Run:* \`${currentRunId.slice(0,8)}\``,
          );
        }
      },
    },
    {
      id: "phase3_odds_gate",
      label: "FanDuel odds freshness gate",
      run: async () => {
        log("=== PRE-GENERATION GATE: Checking FanDuel odds freshness ===");
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const [{ count: freshFdProps, error: gateErr }, { data: latestFdRows }] = await Promise.all([
          supabase
          .from("unified_props")
          .select("*", { count: "exact", head: true })
          .eq("bookmaker", "fanduel")
          .or(`odds_updated_at.gte.${twoHoursAgo},updated_at.gte.${twoHoursAgo},created_at.gte.${twoHoursAgo}`),
          supabase
            .from("unified_props")
            .select("bookmaker, odds_updated_at, updated_at")
            .eq("bookmaker", "fanduel")
            .order("odds_updated_at", { ascending: false })
            .limit(1),
        ]);

        const latestFdUpdateAt = latestFdRows?.[0]?.odds_updated_at || latestFdRows?.[0]?.updated_at || null;

        if (gateErr) {
          log(`⚠ Odds gate query error: ${gateErr.message} — proceeding anyway`);
          results["odds_gate"] = `query_error: ${gateErr.message}`;
          return;
        }

        const freshCount = freshFdProps || 0;
        if (freshCount < 50) {
          log(`⚠ Only ${freshCount} fresh FanDuel props (need 50+) — attempting odds refresh`);
          await invokeStep("Emergency prop refresh", "refresh-todays-props", {});

          const { count: retryCount } = await supabase
            .from("unified_props")
            .select("*", { count: "exact", head: true })
            .eq("bookmaker", "fanduel")
            .or(`odds_updated_at.gte.${new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()},updated_at.gte.${new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()},created_at.gte.${new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()}`);

          const afterScrape = retryCount || 0;
          if (afterScrape < 50) {
            log(`❌ GATE BLOCKED: Still only ${afterScrape} FanDuel props — skipping generation`);
            results["odds_gate"] = `blocked:stale_odds:${afterScrape}_props`;

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
          results["odds_gate"] = `recovered:${afterScrape}_props:last_${latestFdUpdateAt || 'unknown'}`;
        } else {
          log(`✅ Odds gate passed: ${freshCount} fresh FanDuel props`);
          results["odds_gate"] = `passed:${freshCount}_props:last_${latestFdUpdateAt || 'unknown'}`;
        }
      },
    },
    {
      id: "phase3b_uploaded",
      label: "Generate uploaded pipeline picks",
      run: async () => {
        if (oddsGateBlocked) {
          log("⏭ Skipping uploaded pipeline picks — odds gate blocked");
          return;
        }

        const targetDate = todayET();
        const riskCount = await getRiskPickCount(supabase, targetDate);
        const sweetSpotCount = await getSweetSpotCount(supabase, targetDate);

        if (riskCount === 0 && sweetSpotCount === 0) {
          // RISK LAYER BYPASSED — fall through to raw_props source instead of blocking
          warnings.push(`Uploaded pipeline: no risk/sweet rows — falling back to raw unified_props (risk_layer:bypassed)`);
          log(`ℹ Risk + fallback empty; proceeding with raw_props source`);
        }

        await invokeStep("Generating uploaded pipeline picks", "uploaded-pipeline-generator", {
          dry_run: false,
          limit: 12,
          allow_raw_props_fallback: true,
        });

        const uploadedCount = await getUploadedPipelinePickCount(supabase, targetDate);
        if ((uploadedCount || 0) === 0) {
          await sendPipelineAlert(
            `⚠️ *Zero Output Warning*\n\nUploaded pipeline generation completed but produced *0 uploaded-pipeline picks* for ${targetDate}.\n\nCheck: multi-book coverage in unified_props, historical prop_candidates, and manual override alignment.`,
          );
        } else {
          results["uploaded-pipeline-generator"] = `ok:${uploadedCount}`;
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

        const targetDate = todayET();
        const riskCount = await getRiskPickCount(supabase, targetDate);
        const sweetSpotCount = await getSweetSpotCount(supabase, targetDate);
        if ((riskCount || 0) === 0 && (sweetSpotCount || 0) === 0) {
          const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
          const { count: freshFdProps } = await supabase
            .from("unified_props")
            .select("*", { count: "exact", head: true })
            .eq("bookmaker", "fanduel")
            .or(`odds_updated_at.gte.${twoHoursAgo},updated_at.gte.${twoHoursAgo},created_at.gte.${twoHoursAgo}`);

          results["parlay-engine-v2"] = `blocked:no_sources:risk_${riskCount || 0}:fallback_${sweetSpotCount || 0}`;
          warnings.push(`Parlay generation blocked: no direct sources (${riskCount || 0} risk, ${sweetSpotCount || 0} fallback)`);
          await sendPipelineAlert(
            `⚠️ *Parlay Generation Blocked*

*Date:* ${targetDate}
*Fresh props:* ${freshFdProps || 0}
*Risk picks:* ${riskCount || 0}
*Fallback sweet spots:* ${sweetSpotCount || 0}
*Cause:* no direct source rows available
*Run:* \`${currentRunId.slice(0,8)}\``
          );
          return;
        }

        await invokeStep("Generating parlays", "parlay-engine-v2", { dry_run: false, date: targetDate });

        const todayP = todayET();
        const parlayCount = await getParlayCount(supabase, todayP);
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
        const todayS = todayET();
        const riskCount = await getRiskPickCount(supabase, todayS);
        const sweetSpotCount = await getSweetSpotCount(supabase, todayS);
        if ((riskCount || 0) === 0 && (sweetSpotCount || 0) === 0) {
          results["bot-generate-straight-bets"] = `blocked:no_sources:risk_${riskCount || 0}:fallback_${sweetSpotCount || 0}`;
          warnings.push(`Straight bet generation blocked: no direct sources (${riskCount || 0} risk, ${sweetSpotCount || 0} fallback)`);
          sendPipelineAlert(
            `⚠️ *Straight Generation Blocked*\n\n*Date:* ${todayS}\n*Risk picks:* ${riskCount || 0}\n*Fallback sweet spots:* ${sweetSpotCount || 0}\n*Cause:* no direct source rows available\n*Run:* \`${currentRunId.slice(0,8)}\``,
          );
          return;
        }

        await invokeStep("Generating straight bets", "bot-generate-straight-bets", { date: todayS, dry_run: false });

        const straightCount = await getStraightCount(supabase, todayS);
        if ((straightCount || 0) === 0) {
          sendPipelineAlert(
            `⚠️ *Zero Output Warning*\n\nStraight bet generation completed but produced *0 straight bets* for ${todayS}.\n\nCheck: FanDuel line matching, unified_props freshness.`,
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

    // End-of-run failure summary
    const failedSteps = Object.entries(results).filter(
      ([, v]) => v.startsWith("error:") || v.startsWith("exception:") || v.startsWith("forced_error:")
    );
    const unavailableSteps = Object.entries(results).filter(([, v]) => v.startsWith("unavailable:"));
    const optionalFailures = [
      ...failedSteps.filter(([fn]) => NON_FATAL_STEPS.has(fn)),
      ...unavailableSteps,
    ];
    const requiredFailures = failedSteps.filter(([fn]) => !NON_FATAL_STEPS.has(fn));
    const diagnostics = await collectDataQualityDiagnostics();

    if (failedSteps.length > 0) {
      const failList = failedSteps.map(([fn, status]) => `❌ \`${fn}\`: ${status}`).join("\n");
      const okCount = Object.values(results).filter(v => v === "ok" || v === "ok:forced").length;
      sendPipelineAlert(
        `⚠️ *Pipeline Run Complete With Errors*\n\n*Run:* \`${currentRunId.slice(0,8)}\` | Attempt ${currentAttempt}/${MAX_ATTEMPTS}\n\n${failList}\n\n✅ ${okCount} steps OK | ⏭ ${skipped.length} skipped\n*Duration:* ${(elapsed()/1000).toFixed(1)}s`
      );
    }

    const preflightChecks = [
      {
        name: 'Fresh FanDuel odds',
        passed: (diagnostics.input_quality?.fresh_fanduel_props_2h ?? 0) > 0,
        detail: `${diagnostics.input_quality?.fresh_fanduel_props_2h ?? 0} fresh / ${diagnostics.input_quality?.total_fanduel_props ?? 0} total`,
      },
      {
        name: 'Risk candidates',
        passed: (diagnostics.input_quality?.direct_risk_candidates ?? 0) >= MIN_APPROVED_RISK_PICKS,
        detail: `${diagnostics.input_quality?.direct_risk_candidates ?? 0} approved rows`,
      },
      {
        name: 'Fallback candidates',
        passed: (diagnostics.input_quality?.direct_fallback_candidates ?? 0) > 0,
        detail: `${diagnostics.input_quality?.direct_fallback_candidates ?? 0} active sweet spots`,
      },
    ];

    await supabase.from('bot_activity_log').insert({
      event_type: 'preflight_check',
      severity: diagnostics.block_code === 'ready' ? 'info' : 'warning',
      message: `Pipeline preflight ${diagnostics.block_code}`,
      metadata: {
        ready: diagnostics.block_code === 'ready',
        block_code: diagnostics.block_code,
        blockers: diagnostics.block_code === 'ready' ? [] : [diagnostics.block_code],
        checks: preflightChecks,
        freshness: diagnostics.freshness,
        generated_counts: diagnostics.generated_counts,
        input_quality: diagnostics.input_quality,
      },
    }).catch((insertError: any) => {
      log(`⚠ Failed to store preflight_check log: ${insertError.message || insertError}`);
    });

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
      success: requiredFailures.length === 0,
      completed: skipped.length === 0,
      run_id: currentRunId,
      attempt: currentAttempt,
      last_completed: lastCompleted,
      results,
      warnings,
      skipped,
      required_failures: requiredFailures,
      optional_failures: optionalFailures,
      diagnostics,
      statmuse_diagnostics: statmuseDiagnostics,
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