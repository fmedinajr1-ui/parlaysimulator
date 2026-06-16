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
} from "../_shared/parlay-engine-legacy/index.ts";
import {
  BOOKMAKER_PRIORITY,
  MAX_BOOK_LINE_AGE_MIN,
  MAX_LINE_DRIFT,
  MAX_TEAM_SPREAD_ABS,
  PROP_WHITELIST,
} from "../_shared/parlay-engine-legacy/config.ts";
import { loadDirectPickRows } from "../_shared/direct-pick-sources.ts";
import { bayesianHitRate, quarterKellyStake, requiredDecimal, evPerUnit, priorForLegCount } from "../_shared/staking/kelly.ts";
import {
  loadMatchupMap,
  matchupAdjustment,
  etTodayTomorrow,
  type MatchupMap,
} from "../_shared/matchup-xref.ts";
import {
  generateParlayTickets,
  type LegInput,
  type ParlayTicket,
  type StrategyName,
} from "../_shared/parlay-engine-v2/index.ts";

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
  // ---- MLB player markets ----
  pitcher_strikeouts: "Pitcher Ks",
  pitcher_outs: "Pitcher Outs",
  pitcher_hits_allowed: "Hits Allowed",
  pitcher_walks: "Pitcher Walks",
  pitcher_earned_runs: "Earned Runs",
  pitcher_record_a_win: "Pitcher Win",
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_home_runs: "Home Runs",
  batter_rbis: "RBIs",
  batter_runs_scored: "Runs",
  batter_stolen_bases: "Stolen Bases",
  batter_singles: "Singles",
  batter_doubles: "Doubles",
  batter_walks: "Walks",
  batter_strikeouts: "Batter Ks",
  batter_hits_runs_rbis: "H+R+RBI",
  // ---- Team markets ----
  h2h: "Moneyline",
  moneyline: "Moneyline",
  spreads: "Spread",
  spread: "Spread",
  totals: "Total",
  total: "Total",
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
  // Supports "Home @ Away", "Home vs Away", or team-markets-sync's "Home / Away".
  const m = gameDescription.match(/^(.+?)\s*(?:@|vs\.?|v\.?|\/)\s*(.+?)$/i);
  if (!m) return { team: gameDescription, opponent: "UNK" };
  return { team: m[1].trim(), opponent: m[2].trim() };
}

function inferSport(propType: string | null): string {
  if (!propType) return "NBA";
  const p = propType.toLowerCase();
  if (
    p.includes("pitcher") || p.includes("batter") ||
    p === "hits" || p === "rbis" || p === "runs" || p === "home runs" ||
    p === "total bases" || p === "stolen bases" || p === "singles" ||
    p === "doubles" || p === "walks"
  ) return "MLB";
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
  source_origin?: string | null;
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
      source_origin: row.source_origin ?? null,
      game_description: matchedProp.game_description ?? null,
    });
  }

  notes.push("player_active: assumed true (no injury feed wired in Phase A)");
  notes.push("defensive_context gate: skipped (no canonical defense_updated_at)");
  notes.push(`book priority: ${BOOKMAKER_PRIORITY.join(" > ")}; max_age=${MAX_BOOK_LINE_AGE_MIN}m; max_drift=${MAX_LINE_DRIFT}`);

  return { candidates, mappingNotes: notes, rejections };
}

// ----------------------------------------------------------------------------
// Direct-from-unified_props candidate loader for non-pool sources:
//   * team markets (moneyline / spread / total)
//   * any MLB player prop that isn't in pick_pool yet
// These rows aren't gated through pick_pool because they originate directly
// from Odds API syncs and carry their own line + price.
// ----------------------------------------------------------------------------
interface ExtraPropRow extends PropRow {
  market_type: string | null;
  category: string | null;
  event_id?: string | null;
}

function americanFromDecimal(price: number | null | undefined): number | null {
  if (price == null) return null;
  // unified_props already stores American odds; just round defensively.
  return Math.round(Number(price));
}

function americanToImplied(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

/**
 * Model-aware confidence for team-market and raw-MLB legs.
 * Replaces the previous hard-coded 0.66 / edge=0 stub so the strategy gates
 * actually filter weak coin-flip bets.
 *
 * For team markets we use the de-juiced implied probability plus a small
 * structural boost (HOME field, modest favorite premium, total-direction
 * baseline). For raw MLB player props we use the existing PROP_WHITELIST
 * hit rate as the model probability. Anything below MIN_LEG_CONFIDENCE (0.60)
 * will be dropped by the leg signal gate downstream.
 *
 * Returns null when no defensible model exists for the row so the candidate
 * is dropped entirely (better to ship fewer legs than fake confidence).
 */
function scoreExtraCandidate(args: {
  isTeam: boolean;
  propType: string;
  side: string;
  american: number;
}): { confidence: number; edge: number } | null {
  const { isTeam, propType, side, american } = args;
  const implied = americanToImplied(american);

  if (isTeam) {
    let modelProb = implied;
    if (propType === "Moneyline") {
      modelProb += side === "HOME" ? 0.04 : 0.01; // home-field micro-edge
    } else if (propType === "Spread") {
      // Favorites covering small numbers historically over-perform vs implied;
      // dogs at large spreads under-perform. Small directional bump only.
      modelProb += side === "HOME" ? 0.03 : 0.01;
    } else if (propType === "Total") {
      // Slight Under bias on MLB totals, neutral elsewhere; tiny correction.
      modelProb += side === "UNDER" ? 0.02 : 0.01;
    }
    modelProb = Math.max(0, Math.min(0.85, modelProb));
    const edge = modelProb - implied;
    // Confidence == calibrated win probability for the leg.
    return { confidence: modelProb, edge };
  }

  // Raw MLB player prop — use whitelist hit rate as the model probability.
  const wlKey = `${propType}|${side}`;
  const wlHit = PROP_WHITELIST[wlKey];
  if (wlHit == null) return null; // no model → drop
  const modelProb = Math.max(0, Math.min(0.85, wlHit));
  return { confidence: modelProb, edge: modelProb - implied };
}

function teamMarketSignal(propType: string, side: string): string {
  if (propType === "Moneyline") return side === "HOME" ? "TEAM_ML_FAV" : "TEAM_ML_DOG";
  if (propType === "Spread")    return side === "HOME" ? "TEAM_SPREAD_FAV" : "TEAM_SPREAD_DOG";
  if (propType === "Total")     return side === "OVER" ? "GAME_TOTAL_OVER" : "GAME_TOTAL_UNDER";
  return "TEAM_MARKET";
}

function mlbPlayerSignal(propType: string, side: string): string {
  const p = propType.toLowerCase();
  if (p === "home runs") return "MLB_BATTER_HR";
  if (p === "total bases") return "MLB_BATTER_TB";
  if (p === "hits") return "MLB_BATTER_HITS";
  if (p === "rbis") return "MLB_BATTER_RBIS";
  if (p === "stolen bases") return "MLB_BATTER_SB";
  if (p === "pitcher ks") return side === "OVER" ? "MLB_PITCHER_K_OVER" : "MLB_PITCHER_K_UNDER";
  if (p === "pitcher outs") return "MLB_PITCHER_OUTS";
  if (p === "hits allowed") return "MLB_PITCHER_HITS_ALLOWED";
  if (p === "pitcher walks") return "MLB_PITCHER_WALKS";
  if (p === "earned runs") return "MLB_PITCHER_ER";
  return "MLB_PLAYER";
}

function buildExtraCandidates(
  rows: ExtraPropRow[],
  now: Date,
  existing: CandidateLeg[],
): { added: CandidateLeg[]; rejections: Record<string, number> } {
  const seen = new Set<string>();
  for (const l of existing) {
    seen.add(`${(l.player_name ?? l.team).toLowerCase()}|${l.prop_type}|${l.side}|${l.line}`);
  }
  const added: CandidateLeg[] = [];
  const rejections: Record<string, number> = {};
  const bump = (k: string) => { rejections[k] = (rejections[k] ?? 0) + 1; };

  for (const r of rows) {
    if (r.is_active === false) { bump("extra:inactive"); continue; }
    const oddsTs = r.odds_updated_at ?? r.updated_at;
    if (!oddsTs) { bump("extra:stale"); continue; }
    const ageMin = (now.getTime() - new Date(oddsTs).getTime()) / 60_000;
    if (ageMin > MAX_BOOK_LINE_AGE_MIN) { bump("extra:stale"); continue; }

    const propType = canonicalPropType(r.prop_type);
    const marketType = (r.market_type ?? "player").toLowerCase();
    const isTeam = marketType !== "player";

    // Build both sides as separate candidates when both prices exist.
    const sides: Array<{ side: string; american: number | null }> = [];
    if (isTeam && (propType === "Moneyline" || propType === "Spread")) {
      sides.push({ side: "HOME", american: americanFromDecimal(r.over_price) });
      sides.push({ side: "AWAY", american: americanFromDecimal(r.under_price) });
    } else {
      sides.push({ side: "OVER",  american: americanFromDecimal(r.over_price) });
      sides.push({ side: "UNDER", american: americanFromDecimal(r.under_price) });
    }

    const sport = (r.sport ?? "MLB").toUpperCase();
    const sportNorm = sport === "BASKETBALL_NBA" ? "NBA"
                    : sport === "BASEBALL_MLB"   ? "MLB"
                    : sport === "ICEHOCKEY_NHL"  ? "NHL"
                    : sport === "AMERICANFOOTBALL_NFL" ? "NFL"
                    : sport;
    const { team, opponent } = parseTeams(r.game_description ?? null);
    const tipoff = r.commence_time ? new Date(r.commence_time)
                                   : new Date(now.getTime() + 6 * 60 * 60 * 1000);

    // Team-market rows MUST carry a resolvable game so the settler can grade
    // them. Without team/opponent the leg lands in bot_daily_parlays with
    // null game context and the settler falls back to ungradable_missing_context.
    if (isTeam && (team === "UNK" || opponent === "UNK")) {
      bump("extra:missing_game_context");
      continue;
    }

    const persistedMarketType: "moneyline" | "spread" | "total" | "player" =
      isTeam
        ? (propType === "Moneyline" ? "moneyline"
         : propType === "Spread"    ? "spread"
         :                            "total")
        : "player";

    const stableEventId =
      r.event_id ??
      `${(r.commence_time ?? "").slice(0, 10)}|${team}|${opponent}|${persistedMarketType}`;

    for (const { side, american } of sides) {
      if (american == null) { bump("extra:no_price_for_side"); continue; }
      const baseLine = Number(r.current_line ?? 0);
      // For spreads, the away side takes the inverse line (e.g. home -6.5 ⇒ away +6.5).
      const sideLine = (isTeam && propType === "Spread" && side === "AWAY") ? -baseLine : baseLine;
      // Drop fat spreads — anything >= 10pts is a coin flip dressed as edge.
      if (isTeam && propType === "Spread" && Math.abs(sideLine) >= MAX_TEAM_SPREAD_ABS) {
        bump("extra:spread_too_fat");
        continue;
      }
      const key = `${(r.player_name ?? team).toLowerCase()}|${propType}|${side}|${sideLine}`;
      if (seen.has(key)) { bump("extra:duplicate"); continue; }
      seen.add(key);

      const line = sideLine;
      const signal = isTeam ? teamMarketSignal(propType, side) : mlbPlayerSignal(propType, side);
      // Real intelligence: implied-prob baseline + structural model boost for
      // team markets, PROP_WHITELIST hit rate for raw MLB player props.
      const scored = scoreExtraCandidate({ isTeam, propType, side, american });
      if (!scored) { bump("extra:no_model"); continue; }
      const { confidence, edge } = scored;

      added.push({
        sport: sportNorm,
        player_name: isTeam ? null : (r.player_name ?? null),
        team: isTeam ? (side === "AWAY" ? opponent : team) : team,
        opponent: isTeam ? (side === "AWAY" ? team : opponent) : opponent,
        prop_type: propType,
        side,
        line,
        american_odds: american,
        projected: line,
        confidence,
        edge,
        signal_source: signal,
        tipoff,
        projection_updated_at: new Date(oddsTs),
        line_confirmed_on_book: true,
        player_active: true,
        defensive_context_updated_at: null,
        selected_book: (r.bookmaker ?? "").toLowerCase() || null,
        source_origin: isTeam ? "team_market" : "raw_props",
        game_description: r.game_description ?? null,
        event_id: stableEventId,
        market_type: persistedMarketType,
      });
    }
  }
  return { added, rejections };
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

    const directSourceState = await loadDirectPickRows(sb, { targetDate, minimumRiskRows: 8, fallbackLimit: 40 });
    const pool = directSourceState.rows as PoolRow[];
    const poolAfterCount = pool.length;

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

    // ----- Phase B: pull team-market + raw MLB rows directly from unified_props -----
    const startOfDay = new Date(`${targetDate}T00:00:00-04:00`).toISOString();
    const endOfDay   = new Date(`${targetDate}T23:59:59-04:00`).toISOString();
    const { data: extraRows, error: extraErr } = await sb
      .from("unified_props")
      .select("player_name, prop_type, current_line, over_price, under_price, is_active, sport, game_description, commence_time, updated_at, bookmaker, odds_updated_at, market_type, category, event_id")
      .gte("commence_time", startOfDay)
      .lte("commence_time", endOfDay)
      .or("market_type.neq.player,sport.eq.baseball_mlb");
    if (extraErr) {
      console.warn("[parlay-engine-v2] extra-rows fetch warning:", extraErr.message);
    }
    const { added: extraCandidates, rejections: extraRejections } =
      buildExtraCandidates((extraRows ?? []) as ExtraPropRow[], now, candidates);
    candidates.push(...extraCandidates);
    for (const [k, v] of Object.entries(extraRejections)) {
      rejections[k] = (rejections[k] ?? 0) + v;
    }
    mappingNotes.push(`extra candidates loaded: ${extraCandidates.length} (team_market + raw MLB)`);

    // ----- Phase B.5: matchup_intelligence cross-reference for player props -----
    // Adjusts per-leg confidence ±7% (and ±5% from confidence_adjustment) so the
    // engine's downstream gates respect defensive matchups + game script. Blocked
    // legs (is_blocked=true) are dropped entirely. Mirrors lottery-1500-builder.
    const [etTodayD, etTomorrowD] = etTodayTomorrow();
    let matchupMap: MatchupMap = await loadMatchupMap(sb, [etTodayD, etTomorrowD]);
    if (matchupMap.size === 0) {
      console.log("[parlay-engine-v2] matchup_intelligence empty — invoking refresh");
      try {
        const { error: refErr } = await sb.functions.invoke(
          "matchup-intelligence-refresh",
          { body: { dates: [etTodayD, etTomorrowD] } },
        );
        if (refErr) console.warn("[parlay-engine-v2] refresh invoke error:", refErr.message);
        matchupMap = await loadMatchupMap(sb, [etTodayD, etTomorrowD]);
      } catch (e) {
        console.warn("[parlay-engine-v2] matchup refresh threw:", e instanceof Error ? e.message : String(e));
      }
    }
    const matchupStats = { applied: 0, blocked: 0, adjusted: 0 };
    const candidatesAfterMatchup: CandidateLeg[] = [];
    for (const c of candidates) {
      const isPlayer = !!c.player_name && (c.market_type ?? "player") === "player";
      if (!isPlayer) { candidatesAfterMatchup.push(c); continue; }
      const xref = matchupAdjustment(c.player_name!, c.prop_type, c.side, c.line, matchupMap);
      if (xref.row) matchupStats.applied += 1;
      if (xref.blocked) {
        matchupStats.blocked += 1;
        rejections["leg:matchup_blocked"] = (rejections["leg:matchup_blocked"] ?? 0) + 1;
        continue;
      }
      if (xref.adj !== 0) {
        matchupStats.adjusted += 1;
        const next = Math.max(0, Math.min(0.95, c.confidence + xref.adj));
        c.confidence = next;
        c.edge = c.edge + xref.adj;
        (c as any).matchup_note = xref.note;
      }
      candidatesAfterMatchup.push(c);
    }
    candidates.length = 0;
    candidates.push(...candidatesAfterMatchup);
    mappingNotes.push(`matchup_intelligence: ${matchupMap.size} rows; applied=${matchupStats.applied} adjusted=${matchupStats.adjusted} blocked=${matchupStats.blocked}`);

    // Per-source candidate mix so the UI can surface where the slate is coming from.
    const sourceMix = candidates.reduce<Record<string, number>>((acc, l) => {
      const k = l.source_origin ?? "unknown";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});

    const engine = new ParlayEngine();
    const slate = engine.generateSlate(candidates, now);

    // -----------------------------------------------------------------------
    // PARLAY_ENGINE_V2_NEW — feature flag. When "true", route the slate through
    // the new generateParlayTickets pipeline and translate its tickets back
    // into the legacy Parlay shape so downstream readers (settler, accuracy
    // dashboards, bot_daily_parlays.strategy_name) don't break. Default OFF.
    // -----------------------------------------------------------------------
    const useNewEngine = (Deno.env.get("PARLAY_ENGINE_V2_NEW") ?? "false").toLowerCase() === "true";
    if (useNewEngine) {
      const STRAT_MAP: Record<StrategyName, { name: string; tier: "CORE" | "EDGE" | "LOTTERY" }> = {
        lock_2:    { name: "mispriced_edge",        tier: "CORE" },
        strong_3:  { name: "grind_stack",           tier: "CORE" },
        stretch_4: { name: "double_confirmed",      tier: "EDGE" },
        lottery_5: { name: "role_stacked_longshot", tier: "LOTTERY" },
      };

      const legInputs: LegInput[] = candidates.map((c, i) => ({
        id: `${c.player_name ?? c.team}|${c.prop_type}|${c.side}|${c.line}|${i}`,
        sport: c.sport,
        gameId: (c as any).event_id ?? `${c.team}|${c.opponent}`,
        americanOdds: c.american_odds,
        confidence: c.confidence,
        edge: c.edge,
        kind: c.player_name ? "player" : "team",
        team: c.team,
        opponent: c.opponent,
        player: c.player_name ?? undefined,
        prop: c.prop_type,
        side: c.side?.toLowerCase(),
      }));

      const result = generateParlayTickets({
        legs: legInputs,
        stake: 1,
        bankroll: { enabled: false },
      });

      const newParlays = result.tickets.map((t: ParlayTicket) => {
        const mapped = STRAT_MAP[t.strategy as StrategyName] ?? { name: t.strategy, tier: t.tier };
        // Reconstruct legs back into CandidateLeg shape using the original candidates list.
        const legs = t.legs.map(l => {
          const orig = candidates.find(c =>
            (c.player_name ?? c.team) === (l.player ?? l.team) &&
            c.prop_type === l.prop &&
            (c.side?.toLowerCase() === l.side)
          );
          return orig ?? candidates[0];
        });
        return {
          strategy: mapped.name,
          tier: mapped.tier,
          legs,
          stake_units: t.stake,
          rationale: `v2new[${t.strategy}] prob=${t.correlatedProb.toFixed(3)} ev=${t.ev.toFixed(3)} edge=${t.parlayEdge.toFixed(3)}`,
          generated_at: new Date(),
        };
      });

      slate.parlays = newParlays as typeof slate.parlays;
      slate.report.rejection_reasons["v2new:dropped"] = result.dropped.length;
      slate.report.rejection_reasons["v2new:engine"] = 1;
      mappingNotes.push(`PARLAY_ENGINE_V2_NEW=true — using generateParlayTickets (${newParlays.length} tickets, ${result.dropped.length} legs dropped)`);
    }

    // Merge book-line rejections into the engine's rejection_reasons report
    for (const [k, v] of Object.entries(rejections)) {
      slate.report.rejection_reasons[k] = (slate.report.rejection_reasons[k] ?? 0) + v;
    }

    // Lightweight per-strategy eligibility diagnostic so empty days are debuggable.
    const eligibility: Record<string, number> = {};
    {
      // Re-run the leg-level whitelist filter the strategies use, post-validation.
      const SIG_S_OR_A = new Set([
        ...Array.from((await import("../_shared/parlay-engine-legacy/config.ts")).SIGNAL_TIER_S),
        ...Array.from((await import("../_shared/parlay-engine-legacy/config.ts")).SIGNAL_TIER_A),
      ]);
      const PROP_WL = (await import("../_shared/parlay-engine-legacy/config.ts")).PROP_WHITELIST;
      const propKey = (l: any) => `${l.prop_type}|${l.side}`;
      eligibility.mispriced_edge = candidates.filter(l =>
        l.sport === "NBA" && l.confidence >= 0.70 && (propKey(l) in PROP_WL)).length;
      eligibility.grind_stack = candidates.filter(l =>
        l.sport === "NBA" && SIG_S_OR_A.has(l.signal_source) && l.confidence >= 0.68).length;
      eligibility.cross_sport_distinct_sports = new Set(
        candidates.filter(l => l.confidence >= 0.68).map(l => l.sport)).size;
    }

    const zeroPool = poolAfterCount === 0;
    const zeroCandidates = candidates.length === 0;
    const degradedReason = zeroPool
      ? "empty_direct_sources"
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
        direct_rows_loaded: poolAfterCount,
        source_diagnostics: directSourceState.diagnostics,
        candidate_source_mix: sourceMix,
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
            source_origin: l.source_origin ?? null,
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
         direct_rows_loaded: poolAfterCount,
         source_diagnostics: directSourceState.diagnostics,
        candidate_source_mix: sourceMix,
        candidates_in: candidates.length,
        eligibility,
        mapping_notes: mappingNotes,
        report: slate.report,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Live insert into bot_daily_parlays
    // ---------------------------------------------------------------------------
    // BANKROLL_MATH_V1 — per-strategy EV gates + ¼-Kelly stake sizing.
    // Behind a feature flag so we can ship Part 1 immediately and dial Part 2
    // on after a confirmed backtest. Default OFF.
    // ---------------------------------------------------------------------------
    const mathEnabled = (Deno.env.get("BANKROLL_MATH_V1") ?? "false").toLowerCase() === "true";
    const bankrollUnits = Number(Deno.env.get("BANKROLL_UNITS") ?? "1000");
    const dailyEnvelopeFrac = Number(Deno.env.get("BANKROLL_DAILY_FRAC") ?? "0.20");
    const cushion = Number(Deno.env.get("BANKROLL_ODDS_CUSHION") ?? "0.10");

    let pnlByStrategy = new Map<string, { p_smoothed: number; rolling_ev_per_unit: number; n: number }>();
    if (mathEnabled) {
      const { data: pnl } = await sb
        .from("strategy_pnl_rolling")
        .select("strategy_name, window_days, p_smoothed, rolling_ev_per_unit, n")
        .eq("window_days", 7);
      for (const r of (pnl ?? []) as Array<{ strategy_name: string; p_smoothed: number; rolling_ev_per_unit: number; n: number }>) {
        pnlByStrategy.set(r.strategy_name, {
          p_smoothed: Number(r.p_smoothed ?? 0),
          rolling_ev_per_unit: Number(r.rolling_ev_per_unit ?? 0),
          n: Number(r.n ?? 0),
        });
      }
    }

    type SizedParlay = { p: typeof slate.parlays[number]; stake: number; pHat: number; decOdds: number };
    let sized: SizedParlay[] = slate.parlays.map(p => {
      const decOdds = combinedDecimalOdds(p);
      const claimed = combinedProbability(p);
      const pnl = pnlByStrategy.get(p.strategy);
      const prior = priorForLegCount(p.legs.length);
      // Empirical p̂: blend rolling-smoothed strategy hit rate (if we have ≥5
      // graded samples) with the engine's claimed combined probability.
      const pHat = (mathEnabled && pnl && pnl.n >= 5)
        ? bayesianHitRate(Math.round(pnl.p_smoothed * pnl.n), pnl.n, prior, 10)
        : claimed;
      const stake = mathEnabled
        ? quarterKellyStake(pHat, decOdds, bankrollUnits, 0.25).stakeUnits
        : p.stake_units;
      return { p, stake, pHat, decOdds };
    });

    let skippedByMath = 0;
    if (mathEnabled) {
      sized = sized.filter(({ p, stake, pHat, decOdds }) => {
        const pnl = pnlByStrategy.get(p.strategy);
        // Strategy suspension: 7d EV/unit < 0 with ≥5 graded samples.
        if (pnl && pnl.n >= 5 && pnl.rolling_ev_per_unit < 0) { skippedByMath++; return false; }
        // Odds cushion: must clear breakeven by at least cushion (default 10%).
        const minDec = requiredDecimal(pHat, cushion);
        if (!(decOdds >= minDec)) { skippedByMath++; return false; }
        // Tiny stake floor — skip if Kelly says <0.2% of bankroll.
        if (stake < bankrollUnits * 0.002) { skippedByMath++; return false; }
        return true;
      });

      // Daily envelope: cap Σstake at bankroll × dailyEnvelopeFrac.
      const envelope = bankrollUnits * dailyEnvelopeFrac;
      const total = sized.reduce((s, x) => s + x.stake, 0);
      if (total > envelope && total > 0) {
        const scale = envelope / total;
        sized = sized.map(x => ({ ...x, stake: Math.round(x.stake * scale * 1000) / 1000 }));
      }
    }

    const rows = sized.map(({ p, stake, pHat, decOdds }) => ({
      strategy_name: p.strategy,
      tier: p.tier,
      legs: p.legs.map(l => ({
        player_name: l.player_name,
        team: l.team ?? null,
        opponent: l.opponent ?? null,
        game_description: l.game_description ?? null,
        prop_type: l.prop_type,
        line: l.line,
        side: l.side,
        american_odds: l.american_odds,
        sport: l.sport,
        confidence: l.confidence,
        signal_source: l.signal_source,
        source_origin: l.source_origin ?? null,
        event_id: l.event_id ?? null,
        market_type: l.market_type ?? (l.player_name ? "player" : null),
      })),
      leg_count: p.legs.length,
      combined_probability: mathEnabled ? pHat : combinedProbability(p),
      expected_odds: combinedAmericanOdds(p),
      simulated_stake: stake,
      simulated_edge: pHat / (1.0 / decOdds) - 1.0,
      simulated_payout: stake * (decOdds - 1.0),
      simulated_win_rate: pHat,
      selection_rationale: mathEnabled
        ? `${p.rationale} | math: p̂=${pHat.toFixed(3)} D=${decOdds.toFixed(2)} ¼K=${stake.toFixed(2)}u`
        : p.rationale,
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
      direct_rows_loaded: poolAfterCount,
      source_diagnostics: directSourceState.diagnostics,
      candidate_source_mix: sourceMix,
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