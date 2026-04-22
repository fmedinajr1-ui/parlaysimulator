// ============================================================================
// parlay-engine-v2 — Phase A edge function
//
// On-demand parlay slate generation using the v2 engine. No cron, no Telegram.
// POST body: { dry_run?: boolean, date?: "YYYY-MM-DD" }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { etDateKey } from "../_shared/date-et.ts";
import {
  CandidateLeg,
  ParlayEngine,
  combinedAmericanOdds,
  combinedDecimalOdds,
  combinedProbability,
  expectedValueUnits,
} from "../_shared/parlay-engine-v2/index.ts";
import {
  BOOKMAKER_PRIORITY,
  MAX_BOOK_LINE_AGE_MIN,
  MAX_LINE_DRIFT,
} from "../_shared/parlay-engine-v2/config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ----- Signal source mapping (bot_daily_pick_pool.category → engine signal) ----
function normalizeSignalSource(category: string | null | undefined): string {
  if (!category) return "UNKNOWN";
  return category.trim().toUpperCase().replace(/\s+/g, "_");
}

// Map raw prop_type strings (Odds API + pool) to the canonical labels used in
// PROP_WHITELIST / PROP_BLACKLIST (e.g. "player_points" → "Points").
const PROP_TYPE_CANONICAL: Record<string, string> = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_threes: "3PM",
  player_steals: "Steals",
  player_blocks: "Blocks",
  player_rebounds_assists: "R+A",
  player_points_rebounds_assists: "PRA",
  player_points_rebounds: "P+R",
  player_points_assists: "P+A",
  player_turnovers: "TO",
  // Lower-case bare names used in some legacy refresh paths
  points: "Points", rebounds: "Rebounds", assists: "Assists", threes: "3PM",
  steals: "Steals", blocks: "Blocks",
};
function canonicalPropType(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  const k = raw.trim().toLowerCase();
  return PROP_TYPE_CANONICAL[k] ?? raw;
}

// Parse "Lakers @ Warriors" / "Lakers vs Warriors" into [team, opponent].
// Player's team is unknown from pick_pool alone; we use the home/away teams
// joined from unified_props.game_description as a best-effort.
function parseTeams(gameDescription: string | null): { team: string; opponent: string } {
  if (!gameDescription) return { team: "UNK", opponent: "UNK" };
  const m = gameDescription.match(/^(.+?)\s*(?:@|vs\.?|v\.?)\s*(.+?)$/i);
  if (!m) return { team: gameDescription, opponent: "UNK" };
  return { team: m[1].trim(), opponent: m[2].trim() };
}

function inferSport(propType: string | null): string {
  if (!propType) return "NBA";
  const p = propType.toLowerCase();
  if (p.includes("pitcher") || p.includes("batter") || p.includes("hits") || p.includes("rbi")) return "MLB";
  if (p.includes("sog") || p.includes("saves") || p.includes("hockey")) return "NHL";
  return "NBA";
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
  l10_hit_rate?: number | null;
  l10_avg?: number | null;
  l3_avg?: number | null;
  created_at: string;
}

interface PropRow {
  player_name: string | null;
  prop_type: string | null;
  current_line: number | null;
  over_price: number | null;
  under_price: number | null;
  is_active: boolean | null;
  sport: string | null;
  game_description: string | null;
  commence_time: string | null;
  updated_at: string | null;
  bookmaker?: string | null;
  odds_updated_at?: string | null;
}

/** Pick the first row whose bookmaker matches the priority list, in order. */
export function pickPreferredBook(
  rows: PropRow[],
  priority: string[] = BOOKMAKER_PRIORITY,
): PropRow | null {
  if (!rows || rows.length === 0) return null;
  for (const book of priority) {
    const match = rows.find(r => (r.bookmaker ?? "").toLowerCase() === book);
    if (match) return match;
  }
  // No preferred book matched — fall back to first active row
  return rows.find(r => r.is_active) ?? rows[0];
}

function buildCandidates(
  pool: PoolRow[],
  props: PropRow[],
  now: Date,
): { candidates: CandidateLeg[]; mappingNotes: string[]; rejections: Record<string, number> } {
  const propsByKey = new Map<string, PropRow[]>();
  for (const p of props) {
    if (!p.player_name || !p.prop_type) continue;
    const k = `${p.player_name.toLowerCase()}|${p.prop_type.toLowerCase()}`;
    const arr = propsByKey.get(k) ?? [];
    arr.push(p);
    propsByKey.set(k, arr);
  }

  const notes: string[] = [];
  const candidates: CandidateLeg[] = [];
  const rejections: Record<string, number> = {};
  const bump = (k: string) => { rejections[k] = (rejections[k] ?? 0) + 1; };

  for (const row of pool) {
    if (!row.prop_type || !row.recommended_side || row.recommended_line == null) continue;
    const side = row.recommended_side.toUpperCase();
    const propRows = propsByKey.get(`${row.player_name.toLowerCase()}|${row.prop_type.toLowerCase()}`) ?? [];
    const matchedProp = pickPreferredBook(propRows);

    if (!matchedProp) { bump("leg:no_book_line"); continue; }

    // (d) is_active gate — explicit, before anything else
    if (matchedProp.is_active === false) { bump("leg:book_line_inactive"); continue; }

    // (b) freshness gate
    const oddsTs = matchedProp.odds_updated_at ?? matchedProp.updated_at;
    if (oddsTs) {
      const ageMin = (now.getTime() - new Date(oddsTs).getTime()) / 60_000;
      if (ageMin > MAX_BOOK_LINE_AGE_MIN) { bump("leg:stale_book_line"); continue; }
    } else {
      bump("leg:stale_book_line"); continue;
    }

    // (c) line drift gate
    if (matchedProp.current_line != null
        && Math.abs(Number(matchedProp.current_line) - Number(row.recommended_line)) > MAX_LINE_DRIFT) {
      bump("leg:line_moved"); continue;
    }

    const american =
      side === "OVER"  ? matchedProp.over_price :
      side === "UNDER" ? matchedProp.under_price :
      null;
    if (american == null) { bump("leg:no_price_for_side"); continue; }

    const sport = (matchedProp.sport ?? inferSport(row.prop_type)).toUpperCase();
    const { team, opponent } = parseTeams(matchedProp.game_description ?? null);
    const tipoff = matchedProp.commence_time
      ? new Date(matchedProp.commence_time)
      : new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const projectionUpdated = matchedProp.updated_at
      ? new Date(matchedProp.updated_at)
      : new Date(row.created_at);

    const confidenceRaw = row.confidence_score ?? row.composite_score ?? 65;
    const confidence = Math.max(0, Math.min(1, confidenceRaw / 100));
    const projected = row.projected_value ?? row.recommended_line;
    const edge = projected - row.recommended_line;
    const selectedBook = (matchedProp.bookmaker ?? "").toLowerCase() || null;

    candidates.push({
      sport: sport === "BASKETBALL_NBA" ? "NBA" : sport,
      player_name: row.player_name,
      team,
      opponent,
      prop_type: canonicalPropType(row.prop_type),
      side,
      line: row.recommended_line,
      american_odds: Math.round(american),
      projected,
      confidence,
      edge,
      signal_source: normalizeSignalSource(row.category),
      tipoff,
      projection_updated_at: projectionUpdated,
      line_confirmed_on_book: !!(matchedProp.is_active && american != null),
      player_active: true, // no injury feed yet
      defensive_context_updated_at: null, // gate skipped this phase
      selected_book: selectedBook,
    });
  }

  notes.push("player_active: assumed true (no injury feed wired in Phase A)");
  notes.push("defensive_context gate: skipped (no canonical defense_updated_at)");
  notes.push(`book priority: ${BOOKMAKER_PRIORITY.join(" > ")}; max_age=${MAX_BOOK_LINE_AGE_MIN}m; max_drift=${MAX_LINE_DRIFT}`);

  return { candidates, mappingNotes: notes, rejections };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body: { dry_run?: boolean; date?: string } = {};
    try { body = await req.json(); } catch { /* allow empty */ }
    const dryRun = body.dry_run !== false; // default to dry_run for safety
    const targetDate = body.date ?? etDateKey();

    // Load candidate pool
    const { data: pool, error: poolErr } = await sb
      .from("bot_daily_pick_pool")
      .select("id, pick_date, player_name, prop_type, recommended_side, recommended_line, confidence_score, composite_score, projected_value, category, l10_hit_rate, l10_avg, l3_avg, created_at")
      .eq("pick_date", targetDate);
    if (poolErr) throw poolErr;

    // Load matching props for odds + game context
    const playerNames = Array.from(new Set((pool ?? []).map(p => p.player_name).filter(Boolean)));
    let props: PropRow[] = [];
    if (playerNames.length > 0) {
      const { data: propData, error: propErr } = await sb
        .from("unified_props")
        .select("player_name, prop_type, current_line, over_price, under_price, is_active, sport, game_description, commence_time, updated_at, bookmaker, odds_updated_at")
        .in("player_name", playerNames);
      if (propErr) throw propErr;
      props = propData ?? [];
    }

    const now = new Date();
    const { candidates, mappingNotes, rejections } = buildCandidates(pool ?? [], props, now);

    const engine = new ParlayEngine();
    const slate = engine.generateSlate(candidates, now);

    // Merge book-line rejections into the engine's rejection_reasons report
    for (const [k, v] of Object.entries(rejections)) {
      slate.report.rejection_reasons[k] = (slate.report.rejection_reasons[k] ?? 0) + v;
    }

    // Lightweight per-strategy eligibility diagnostic so empty days are debuggable.
    const eligibility: Record<string, number> = {};
    {
      // Re-run the leg-level whitelist filter the strategies use, post-validation.
      const SIG_S_OR_A = new Set([
        ...Array.from((await import("../_shared/parlay-engine-v2/config.ts")).SIGNAL_TIER_S),
        ...Array.from((await import("../_shared/parlay-engine-v2/config.ts")).SIGNAL_TIER_A),
      ]);
      const PROP_WL = (await import("../_shared/parlay-engine-v2/config.ts")).PROP_WHITELIST;
      const propKey = (l: any) => `${l.prop_type}|${l.side}`;
      eligibility.mispriced_edge = candidates.filter(l =>
        l.sport === "NBA" && l.confidence >= 0.70 && (propKey(l) in PROP_WL)).length;
      eligibility.grind_stack = candidates.filter(l =>
        l.sport === "NBA" && SIG_S_OR_A.has(l.signal_source) && l.confidence >= 0.68).length;
      eligibility.cross_sport_distinct_sports = new Set(
        candidates.filter(l => l.confidence >= 0.68).map(l => l.sport)).size;
    }

    const zeroPool = (pool ?? []).length === 0;
    const zeroCandidates = candidates.length === 0;
    const degradedReason = zeroPool
      ? "empty_pick_pool"
      : zeroCandidates
        ? "no_book_matched_candidates"
        : slate.parlays.length === 0
          ? "no_valid_parlays_built"
          : null;

    if (dryRun) {
      return new Response(JSON.stringify({
        success: !degradedReason,
        degraded: !!degradedReason,
        degraded_reason: degradedReason,
        dry_run: true,
        target_date: targetDate,
        pool_rows_loaded: (pool ?? []).length,
        candidates_in: candidates.length,
        mapping_notes: mappingNotes,
        eligibility,
        report: slate.report,
        parlays_preview: slate.parlays.slice(0, 5).map(p => ({
          strategy: p.strategy,
          tier: p.tier,
          legs: p.legs.length,
          combined_american_odds: combinedAmericanOdds(p),
          stake_units: p.stake_units,
          rationale: p.rationale,
          legs_detail: p.legs.map(l => ({
            player: l.player_name,
            prop: l.prop_type,
            side: l.side,
            line: l.line,
            odds: l.american_odds,
            sport: l.sport,
            confidence: l.confidence,
            signal: l.signal_source,
          })),
        })),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (degradedReason) {
      const status = zeroPool ? 409 : 422;
      return new Response(JSON.stringify({
        success: false,
        degraded: true,
        degraded_reason: degradedReason,
        target_date: targetDate,
        pool_rows_loaded: (pool ?? []).length,
        candidates_in: candidates.length,
        eligibility,
        mapping_notes: mappingNotes,
        report: slate.report,
      }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Live insert into bot_daily_parlays
    const rows = slate.parlays.map(p => ({
      strategy_name: p.strategy,
      tier: p.tier,
      legs: p.legs.map(l => ({
        player_name: l.player_name,
        prop_type: l.prop_type,
        line: l.line,
        side: l.side,
        american_odds: l.american_odds,
        sport: l.sport,
        confidence: l.confidence,
        signal_source: l.signal_source,
      })),
      leg_count: p.legs.length,
      combined_probability: combinedProbability(p),
      expected_odds: combinedAmericanOdds(p),
      simulated_stake: p.stake_units,
      simulated_edge: combinedProbability(p) / (1.0 / combinedDecimalOdds(p)) - 1.0,
      simulated_payout: p.stake_units * (combinedDecimalOdds(p) - 1.0),
      simulated_win_rate: combinedProbability(p),
      selection_rationale: p.rationale,
      outcome: "pending",
      is_simulated: true,
      parlay_date: targetDate,
      strategy_version: 2,
    }));

    let inserted = 0;
    if (rows.length > 0) {
      const { error: insErr, count } = await sb
        .from("bot_daily_parlays")
        .insert(rows, { count: "exact" });
      if (insErr) throw insErr;
      inserted = count ?? rows.length;
    }

    return new Response(JSON.stringify({
      success: true,
      degraded: false,
      dry_run: false,
      target_date: targetDate,
      pool_rows_loaded: (pool ?? []).length,
      candidates_in: candidates.length,
      inserted,
      report: slate.report,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[parlay-engine-v2] Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});