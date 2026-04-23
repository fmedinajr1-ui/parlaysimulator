import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { etDateKey } from "../_shared/date-et.ts";
import { loadDirectPickRows } from "../_shared/direct-pick-sources.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BOOKMAKER_PRIORITY = ["fanduel", "draftkings", "betmgm"];
const FRESH_WINDOW_MINUTES = 120;
const DEFAULT_STALE_THRESHOLD_MINUTES = 360;
const MAX_LINE_DRIFT = 0.5;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

interface RiskPickRow {
  id?: string;
  player_name: string | null;
  prop_type: string | null;
  side: string | null;
  line: number | null;
  confidence_score: number | null;
  edge: number | null;
  l10_hit_rate: number | null;
  true_median: number | null;
  l10_avg: number | null;
  rejection_reason: string | null;
  created_at: string | null;
  game_date: string;
  mode: string | null;
}

interface PoolRow {
  id: string;
  pick_date: string;
  player_name: string;
  prop_type: string | null;
  recommended_side: string | null;
  recommended_line: number | null;
  confidence_score: number | null;
  composite_score: number | null;
  projected_value: number | null;
  category: string | null;
  l10_hit_rate: number | null;
  l10_avg: number | null;
  l3_avg: number | null;
  created_at: string;
}

interface PropRow {
  id?: string;
  player_name: string | null;
  prop_type: string | null;
  bookmaker: string | null;
  current_line: number | null;
  over_price: number | null;
  under_price: number | null;
  is_active: boolean | null;
  odds_updated_at: string | null;
  updated_at: string | null;
  created_at?: string | null;
  game_description: string | null;
  commence_time: string | null;
  sport?: string | null;
}

interface ParlayRow {
  id: string;
  strategy_name: string | null;
  tier: string | null;
  outcome: string | null;
  expected_odds: number | null;
  combined_probability: number | null;
  created_at: string | null;
}

interface StraightRow {
  id: string;
  player_name: string | null;
  prop_type: string | null;
  side: string | null;
  line: number | null;
  bet_type: string | null;
  line_source: string | null;
  american_odds: number | null;
  outcome: string | null;
  created_at: string | null;
}

function normalizeName(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeProp(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function normalizeSide(value: string | null | undefined): string | null {
  if (!value) return null;
  const side = value.trim().toLowerCase();
  return side === "over" || side === "under" ? side : null;
}

function buildKey(playerName: string | null | undefined, propType: string | null | undefined): string {
  return `${normalizeName(playerName)}|${normalizeProp(propType)}`;
}

function ageMinutes(timestamp: string | null | undefined, now = new Date()): number | null {
  if (!timestamp) return null;
  const ms = new Date(timestamp).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.round(((now.getTime() - ms) / 60_000) * 10) / 10;
}

function topCounts(map: Record<string, number>, limit = 10) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function pickPreferredBook(rows: PropRow[]): PropRow | null {
  if (!rows.length) return null;
  for (const book of BOOKMAKER_PRIORITY) {
    const match = rows.find((row) => (row.bookmaker ?? "").toLowerCase() === book);
    if (match) return match;
  }
  return rows.find((row) => row.is_active) ?? rows[0];
}

function parseBody(body: unknown): { date: string; bookmaker: string | null; playerSearch: string | null; failedOnly: boolean } {
  const payload = typeof body === "object" && body ? body as Record<string, unknown> : {};
  return {
    date: typeof payload.date === "string" && payload.date ? payload.date : etDateKey(),
    bookmaker: typeof payload.bookmaker === "string" && payload.bookmaker ? payload.bookmaker.toLowerCase() : null,
    playerSearch: typeof payload.player_search === "string" && payload.player_search.trim() ? payload.player_search.trim().toLowerCase() : null,
    failedOnly: payload.failed_only === true,
  };
}

function summarizeBookRows(props: PropRow[], now: Date) {
  const bookmakerCounts: Record<string, number> = {};
  const bookmakerFreshCounts: Record<string, number> = {};
  const bookmakerLatestSeen: Record<string, string> = {};
  let freshCount = 0;
  let staleCount = 0;
  let fanduelFreshCount = 0;

  for (const prop of props) {
    const book = (prop.bookmaker ?? "unknown").toLowerCase();
    bookmakerCounts[book] = (bookmakerCounts[book] ?? 0) + 1;

    const ts = prop.odds_updated_at ?? prop.updated_at ?? prop.created_at;
    if (ts && (!bookmakerLatestSeen[book] || new Date(ts).getTime() > new Date(bookmakerLatestSeen[book]).getTime())) {
      bookmakerLatestSeen[book] = ts;
    }

    const age = ageMinutes(ts, now);
    if (age != null && age <= FRESH_WINDOW_MINUTES) {
      freshCount += 1;
      bookmakerFreshCounts[book] = (bookmakerFreshCounts[book] ?? 0) + 1;
      if (book === "fanduel") fanduelFreshCount += 1;
    } else {
      staleCount += 1;
    }
  }

  return {
    total_rows: props.length,
    fresh_rows_2h: freshCount,
    stale_rows: staleCount,
    fanduel_rows_2h: fanduelFreshCount,
    by_bookmaker: Object.entries(bookmakerCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([bookmaker, count]) => ({ bookmaker, count, fresh_count_2h: bookmakerFreshCounts[bookmaker] ?? 0, latest_seen_at: bookmakerLatestSeen[bookmaker] ?? null })),
  };
}

function computeLegStatus(row: PoolRow, propRows: PropRow[], now: Date) {
  const matched = pickPreferredBook(propRows);
  if (!matched) {
    return {
      status: "no_book_match",
      failure_reason: "No live book row matched player + prop",
      matched_bookmaker: null,
      live_line: null,
      line_drift: null,
      age_minutes: null,
      is_fresh: false,
      over_price: null,
      under_price: null,
      game_description: null,
      commence_time: null,
      is_active: null,
    };
  }

  const ts = matched.odds_updated_at ?? matched.updated_at ?? matched.created_at;
  const age = ageMinutes(ts, now);
  const lineDrift = matched.current_line != null && row.recommended_line != null
    ? Math.round(Math.abs(Number(matched.current_line) - Number(row.recommended_line)) * 100) / 100
    : null;
  const side = normalizeSide(row.recommended_side);
  const sidePrice = side === "over" ? matched.over_price : side === "under" ? matched.under_price : null;

  let status = "matched_fresh";
  let failureReason = null as string | null;

  if (matched.is_active === false) {
    status = "matched_inactive";
    failureReason = "Book row exists but is inactive";
  } else if (age == null || age > DEFAULT_STALE_THRESHOLD_MINUTES) {
    status = "matched_stale";
    failureReason = `Book line age ${age ?? "unknown"}m exceeds ${DEFAULT_STALE_THRESHOLD_MINUTES}m threshold`;
  } else if (lineDrift != null && lineDrift > MAX_LINE_DRIFT) {
    status = "matched_line_moved";
    failureReason = `Book line drift ${lineDrift} exceeds ${MAX_LINE_DRIFT}`;
  } else if (sidePrice == null) {
    status = "matched_missing_price";
    failureReason = "Matched book row missing price for selected side";
  }

  return {
    status,
    failure_reason: failureReason,
    matched_bookmaker: matched.bookmaker ?? null,
    live_line: matched.current_line,
    line_drift: lineDrift,
    age_minutes: age,
    is_fresh: age != null && age <= FRESH_WINDOW_MINUTES,
    over_price: matched.over_price,
    under_price: matched.under_price,
    game_description: matched.game_description,
    commence_time: matched.commence_time,
    is_active: matched.is_active,
  };
}

function jsonResponse(payload: Record<string, Json>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const parsed = parseBody(await req.json().catch(() => ({})));
    const now = new Date();

    const [riskRes, parlayRes, straightRes, directSourceState, sweetSpotRes] = await Promise.all([
      supabase
        .from("nba_risk_engine_picks")
        .select("id, player_name, prop_type, side, line, confidence_score, edge, l10_hit_rate, true_median, l10_avg, rejection_reason, created_at, game_date, mode")
        .eq("game_date", parsed.date)
        .eq("mode", "full_slate")
        .order("created_at", { ascending: false }),
      supabase
        .from("bot_daily_parlays")
        .select("id, strategy_name, tier, outcome, expected_odds, combined_probability, created_at")
        .eq("parlay_date", parsed.date)
        .eq("outcome", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("bot_straight_bets")
        .select("id, player_name, prop_type, side, line, bet_type, line_source, american_odds, outcome, created_at")
        .eq("bet_date", parsed.date)
        .eq("outcome", "pending")
        .order("created_at", { ascending: false }),
      loadDirectPickRows(supabase, { targetDate: parsed.date, minimumRiskRows: 8, fallbackLimit: 40 }),
      supabase
        .from("category_sweet_spots")
        .select("id", { count: "exact", head: true })
        .eq("analysis_date", parsed.date)
        .eq("is_active", true),
    ]);

    if (riskRes.error) throw riskRes.error;
    if (parlayRes.error) throw parlayRes.error;
    if (straightRes.error) throw straightRes.error;

    let poolRows = (directSourceState.rows ?? []) as PoolRow[];

    if (parsed.playerSearch) {
      poolRows = poolRows.filter((row) => row.player_name.toLowerCase().includes(parsed.playerSearch!));
    }

    const playerNames = Array.from(new Set(poolRows.map((row) => row.player_name).filter(Boolean)));
    let propsQuery = supabase
      .from("unified_props")
      .select("id, player_name, prop_type, bookmaker, current_line, over_price, under_price, is_active, odds_updated_at, updated_at, created_at, game_description, commence_time, sport")
      .in("player_name", playerNames.length ? playerNames : ["__none__"]);

    if (parsed.bookmaker) {
      propsQuery = propsQuery.eq("bookmaker", parsed.bookmaker);
    }

    const { data: propsData, error: propsError } = await propsQuery;
    if (propsError) throw propsError;

    const props = (propsData ?? []) as PropRow[];
    const propsByKey = new Map<string, PropRow[]>();
    for (const prop of props) {
      const key = buildKey(prop.player_name, prop.prop_type);
      const rows = propsByKey.get(key) ?? [];
      rows.push(prop);
      propsByKey.set(key, rows);
    }

    const rejectionCounts: Record<string, number> = {};
    const approvedRiskRows: RiskPickRow[] = [];
    const rejectedRiskRows: RiskPickRow[] = [];

    for (const row of (riskRes.data ?? []) as RiskPickRow[]) {
      if (parsed.playerSearch && !normalizeName(row.player_name).includes(parsed.playerSearch)) continue;
      if (row.rejection_reason) {
        rejectedRiskRows.push(row);
        rejectionCounts[row.rejection_reason] = (rejectionCounts[row.rejection_reason] ?? 0) + 1;
      } else {
        approvedRiskRows.push(row);
      }
    }

    const poolWithStatus = poolRows.map((row) => {
      const status = computeLegStatus(row, propsByKey.get(buildKey(row.player_name, row.prop_type)) ?? [], now);
      return {
        id: row.id,
        player_name: row.player_name,
        prop_type: row.prop_type,
        recommended_side: row.recommended_side,
        recommended_line: row.recommended_line,
        category: row.category,
        confidence_score: row.confidence_score,
        composite_score: row.composite_score,
        projected_value: row.projected_value,
        l10_hit_rate: row.l10_hit_rate,
        l10_avg: row.l10_avg,
        l3_avg: row.l3_avg,
        created_at: row.created_at,
        ...status,
      };
    });

    const filteredPool = parsed.failedOnly
      ? poolWithStatus.filter((row) => row.status !== "matched_fresh")
      : poolWithStatus;

    const blockerCounts: Record<string, number> = {};
    for (const row of poolWithStatus) {
      blockerCounts[row.status] = (blockerCounts[row.status] ?? 0) + 1;
    }

    const bookHealth = summarizeBookRows(props, now);
    const poolReady = poolRows.length >= 12;
    const matchedFreshCount = blockerCounts.matched_fresh ?? 0;

    const primaryBlocker = topCounts(blockerCounts, 1)[0]?.label ?? null;
    const finalReason = poolRows.length === 0
      ? "empty_pick_pool"
      : poolRows.length < 12
        ? "thin_pick_pool"
        : matchedFreshCount === 0
          ? "no_book_matched_candidates"
          : ((parlayRes.data ?? []).length === 0 && (straightRes.data ?? []).length === 0)
            ? primaryBlocker === "matched_stale"
              ? "stale_book_lines_dominant"
              : "no_valid_outputs"
            : "outputs_present";

    const payload: Record<string, Json> = {
      success: true,
      target_date: parsed.date,
      filters: {
        bookmaker: parsed.bookmaker,
        player_search: parsed.playerSearch,
        failed_only: parsed.failedOnly,
      },
      source_health: {
        risk_source_rows: directSourceState.diagnostics?.direct_rows_from_risk ?? 0,
        fallback_source_rows: directSourceState.diagnostics?.direct_rows_from_fallback ?? 0,
        source_status: directSourceState.diagnostics?.source_status ?? "empty",
        sweet_spot_rows_active: sweetSpotRes.count ?? 0,
      },
      summary: {
        risk_rows_total: approvedRiskRows.length + rejectedRiskRows.length,
        risk_rows_approved: approvedRiskRows.length,
        risk_rows_rejected: rejectedRiskRows.length,
        pool_rows_total: poolRows.length,
        pool_rows_ready: poolReady,
        pool_rows_failing: poolWithStatus.filter((row) => row.status !== "matched_fresh").length,
        matched_fresh_rows: matchedFreshCount,
        pending_parlays: (parlayRes.data ?? []).length,
        pending_straight_bets: (straightRes.data ?? []).length,
        final_reason: finalReason,
        primary_blocker: primaryBlocker,
        scanning_books: props.length > 0,
        scanned_bookmakers: bookHealth.by_bookmaker,
      },
      engine_start: {
        engine_name: "nba-player-prop-risk-engine",
        approved_count: approvedRiskRows.length,
        rejected_count: rejectedRiskRows.length,
        top_rejection_reasons: topCounts(rejectionCounts, 12),
        approved_rows: approvedRiskRows.slice(0, 100).map((row) => ({
          player_name: row.player_name,
          prop_type: row.prop_type,
          side: row.side,
          line: row.line,
          confidence_score: row.confidence_score,
          edge: row.edge,
          l10_hit_rate: row.l10_hit_rate,
          true_median: row.true_median,
          l10_avg: row.l10_avg,
          created_at: row.created_at,
        })),
        rejected_rows: rejectedRiskRows.slice(0, 100).map((row) => ({
          player_name: row.player_name,
          prop_type: row.prop_type,
          side: row.side,
          line: row.line,
          confidence_score: row.confidence_score,
          edge: row.edge,
          rejection_reason: row.rejection_reason,
          created_at: row.created_at,
        })),
      },
      pick_pool: {
        status: poolRows.length >= 12 ? "ready" : poolRows.length > 0 ? "thin" : "empty",
        total_rows: poolRows.length,
        failed_rows: poolWithStatus.filter((row) => row.status !== "matched_fresh").length,
        blocker_breakdown: topCounts(blockerCounts, 12),
        rows: filteredPool.slice(0, 250),
        diagnostics: directSourceState.diagnostics,
      },
      book_scan: {
        ...bookHealth,
        matched_pool_candidates: poolWithStatus.filter((row) => row.status !== "no_book_match").length,
        unmatched_pool_candidates: poolWithStatus.filter((row) => row.status === "no_book_match").length,
        latest_rows: props
          .slice()
          .sort((a, b) => new Date(b.odds_updated_at ?? b.updated_at ?? b.created_at ?? 0).getTime() - new Date(a.odds_updated_at ?? a.updated_at ?? a.created_at ?? 0).getTime())
          .slice(0, 250)
          .map((row) => ({
            player_name: row.player_name,
            prop_type: row.prop_type,
            bookmaker: row.bookmaker,
            current_line: row.current_line,
            over_price: row.over_price,
            under_price: row.under_price,
            is_active: row.is_active,
            age_minutes: ageMinutes(row.odds_updated_at ?? row.updated_at ?? row.created_at, now),
            odds_updated_at: row.odds_updated_at,
            updated_at: row.updated_at,
            game_description: row.game_description,
            commence_time: row.commence_time,
          })),
      },
      generation_blockers: {
        stale_threshold_minutes: DEFAULT_STALE_THRESHOLD_MINUTES,
        fresh_window_minutes: FRESH_WINDOW_MINUTES,
        line_drift_threshold: MAX_LINE_DRIFT,
        blocker_breakdown: topCounts(blockerCounts, 12),
        diagnostics: {
          thin_risk_output: approvedRiskRows.length < 8,
          thin_pool: poolRows.length > 0 && poolRows.length < 12,
          empty_pool: poolRows.length === 0,
          empty_sweet_spots: (sweetSpotRes.count ?? 0) === 0,
          no_book_matches: (blockerCounts.no_book_match ?? 0) === poolRows.length && poolRows.length > 0,
          stale_lines: (blockerCounts.matched_stale ?? 0) > 0,
          drifted_lines: (blockerCounts.matched_line_moved ?? 0) > 0,
          inactive_lines: (blockerCounts.matched_inactive ?? 0) > 0,
          missing_prices: (blockerCounts.matched_missing_price ?? 0) > 0,
        },
      },
      outputs: {
        parlays: ((parlayRes.data ?? []) as ParlayRow[]).slice(0, 50),
        straight_bets: ((straightRes.data ?? []) as StraightRow[]).slice(0, 50),
      },
    };

    return jsonResponse(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown diagnostics failure";
    return jsonResponse({ success: false, error: message }, 500);
  }
});