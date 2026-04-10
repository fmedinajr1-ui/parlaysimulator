import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// tennis-games-analyzer
//
// Reads today's ATP/WTA total-games lines from unified_props (written by
// pp-props-scraper), applies gender + surface modelling, and writes qualifying
// picks to category_sweet_spots so they flow into the parlay + broadcast
// pipeline automatically.
//
// Model logic:
//   projected_total = avg(player_a_l10, player_b_l10)
//                     + gender_modifier
//                     + surface_modifier
//                     + h2h_modifier
//
//   edge_pct = |projected_total - pp_line| / pp_line * 100
//   pick emitted only when edge_pct >= MIN_EDGE_PCT
//
// Gender modifiers (empirical):
//   WTA: -1.5  (no 5th set, more breaks, shorter matches)
//   ATP: +0.5  (stronger serves, more holds, longer sets)
//
// Surface modifiers applied ON TOP of gender modifier:
//   clay  + WTA: -0.5 (extra break-heavy rallies)
//   clay  + ATP: -0.3 (longer rallies but still 5 sets possible)
//   grass + ATP: +0.5 (serve dominance, fast holds)
//   grass + WTA: +0.2 (faster surface = fewer break points)
//   hard / indoor: 0 (baseline surface)
//
// H2H modifier: if >= 3 H2H matches in tennis_player_stats,
//   use (h2h_avg_games - naive_projection) * 0.25 (partial blend)
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Constants ──────────────────────────────────────────────────────────────

const MIN_EDGE_PCT = 3.0;       // minimum edge % to emit a pick
const MIN_CONFIDENCE = 0.60;    // minimum confidence score
const FALLBACK_ATP_AVG = 38.5;  // ATP game average when no player stats available
const FALLBACK_WTA_AVG = 20.5;  // WTA game average when no player stats available

// Gender modifiers
const GENDER_MODIFIER: Record<string, number> = {
  ATP: +0.5,
  WTA: -1.5,
};

// Surface modifiers (indexed as `${tour}_${surface}`)
const SURFACE_MODIFIER: Record<string, number> = {
  WTA_clay:         -0.5,
  WTA_grass:        +0.2,
  WTA_hard:          0.0,
  WTA_indoor_hard:   0.0,
  ATP_clay:         -0.3,
  ATP_grass:        +0.5,
  ATP_hard:          0.0,
  ATP_indoor_hard:  +0.2,
};

// Stat type names that pp-props-scraper uses for tennis games lines
const TENNIS_GAMES_STAT_TYPES = new Set([
  "total games", "total_games", "games", "game total",
  "alternate total games", "total games played",
]);

// ── Type definitions ──────────────────────────────────────────────────────

interface TennisProp {
  id: string;
  player_name: string;         // "Swiatek vs Sabalenka" or "Jannik Sinner"
  prop_type: string;
  stat_type: string;
  line: number | null;
  fanduel_line: number | null;
  sport: string;               // "tennis_atp" | "tennis_wta"
  bookmaker: string | null;
  commence_time: string | null;
  event_description: string | null;
  opponent: string | null;
}

interface PlayerStats {
  avg_games_l10: number | null;
  avg_games_l5: number | null;
  surface: string | null;
}

interface MatchAnalysis {
  playerA: string;
  playerB: string;
  tour: "ATP" | "WTA";
  surface: string;
  ppLine: number;
  projectedTotal: number;
  genderMod: number;
  surfaceMod: number;
  h2hMod: number;
  playerAL10: number | null;
  playerBL10: number | null;
  playerAL5: number | null;
  playerBL5: number | null;
  h2hAvg: number | null;
  h2hSampleSize: number;
  edgePct: number;
  recommendedSide: "over" | "under";
  confidence: number;
  narrative: string;
  sourcePropId: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getEasternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function getEasternMidnightUtc(): string {
  return `${getEasternDate()}T00:00:00-05:00`;
}

/** Determine tour from sport key */
function tourFromSport(sport: string): "ATP" | "WTA" | null {
  const lower = (sport || "").toLowerCase();
  if (lower.includes("wta")) return "WTA";
  if (lower.includes("atp") || lower.includes("tennis")) return "ATP";
  return null;
}

/**
 * Extract surface from event_description or prop metadata.
 * PrizePicks events often include "Roland Garros", "Wimbledon", "US Open" etc.
 */
function detectSurface(eventDesc: string | null, propName: string | null): string {
  const text = ((eventDesc || "") + " " + (propName || "")).toLowerCase();
  if (text.includes("roland garros") || text.includes("clay") || text.includes("french open")) return "clay";
  if (text.includes("wimbledon") || text.includes("grass") || text.includes("queens")) return "grass";
  if (text.includes("indoor") || text.includes("covered")) return "indoor_hard";
  return "hard"; // default: hard court
}

/**
 * Parse player names from a PrizePicks line.
 * PrizePicks formats: "Iga Swiatek" (single) or embedded in event_description "Swiatek vs Sabalenka"
 * Returns [playerA, playerB] — playerB may be empty if we only have one name.
 */
function parseMatchPlayers(prop: TennisProp): [string, string] {
  // First check event_description for "X vs Y" format
  const vsMatch = (prop.event_description || "").match(/^(.+?)\s+(?:vs?\.?)\s+(.+?)(?:\s*[-–]\s*.+)?$/i);
  if (vsMatch) {
    return [vsMatch[1].trim(), vsMatch[2].trim()];
  }

  // player_name might be "Swiatek vs Sabalenka"
  const vsInName = (prop.player_name || "").match(/^(.+?)\s+(?:vs?\.?)\s+(.+)$/i);
  if (vsInName) {
    return [vsInName[1].trim(), vsInName[2].trim()];
  }

  // opponent field
  const pA = (prop.player_name || "").trim();
  const pB = (prop.opponent || "").trim();
  return [pA, pB];
}

/** Normalize player name for DB lookup */
function normName(name: string): string {
  return name.toLowerCase().replace(/[.']/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Build a narrative string for the Telegram alert.
 * Deliberately concise and informative — not excessive.
 */
function buildNarrative(a: MatchAnalysis): string {
  const tourLabel = a.tour === "WTA" ? "WTA" : "ATP";
  const surfaceLabel = a.surface === "indoor_hard" ? "indoor hard" : a.surface;
  const lineVsProj = a.recommendedSide === "under"
    ? `Line ${a.ppLine} sits above projected ${a.projectedTotal.toFixed(1)}`
    : `Line ${a.ppLine} sits below projected ${a.projectedTotal.toFixed(1)}`;

  const stats = a.playerAL10 !== null && a.playerBL10 !== null
    ? ` L10 avg total: ${((a.playerAL10 + a.playerBL10) / 2).toFixed(1)} games.`
    : "";

  const h2hNote = a.h2hSampleSize >= 3
    ? ` H2H avg: ${(a.h2hAvg || 0).toFixed(1)} games (${a.h2hSampleSize} matches).`
    : "";

  const surfaceTendency = (() => {
    if (a.tour === "WTA" && a.surface === "clay") return "Clay WTA match — heavy break patterns expected.";
    if (a.tour === "ATP" && a.surface === "grass") return "Grass ATP — serve dominance, minimal breaks.";
    if (a.tour === "WTA") return "WTA match — no 5th set, more breaks vs ATP.";
    if (a.tour === "ATP" && a.surface === "clay") return "ATP clay — longer rallies but still 5-set potential.";
    return `${tourLabel} ${surfaceLabel} court.`;
  })();

  return `${surfaceTendency} ${lineVsProj}.${stats}${h2hNote}`;
}

/**
 * Compute confidence score based on:
 * - edge magnitude (higher edge = higher confidence)
 * - data quality (whether we have real player L10 stats)
 * - H2H confirmation (whether H2H supports the same direction)
 */
function computeConfidence(a: {
  edgePct: number;
  playerAL10: number | null;
  playerBL10: number | null;
  h2hSampleSize: number;
  h2hAvg: number | null;
  projectedTotal: number;
  ppLine: number;
  recommendedSide: "over" | "under";
}): number {
  // Base: edge drives confidence
  let conf = 0.50 + Math.min(a.edgePct * 0.025, 0.20); // max +0.20 from edge alone

  // Data quality bonus
  if (a.playerAL10 !== null && a.playerBL10 !== null) conf += 0.08; // have real stats
  else conf -= 0.05; // using fallbacks — lower confidence

  // H2H confirmation bonus
  if (a.h2hSampleSize >= 3 && a.h2hAvg !== null) {
    const h2hSupports = a.recommendedSide === "under"
      ? a.h2hAvg < a.ppLine
      : a.h2hAvg > a.ppLine;
    conf += h2hSupports ? 0.06 : -0.04; // H2H confirmation or contradiction
  }

  // Gender model is more reliable for WTA (no 5th set is structural)
  // Slight bonus for WTA under picks
  if (a.recommendedSide === "under") conf += 0.03;

  return Math.min(0.92, Math.max(0.35, conf));
}

// ── Main handler ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const log = (msg: string) => console.log(`[tennis-games-analyzer] ${msg}`);
  const now = new Date();
  const today = getEasternDate();
  const todayStartUtc = getEasternMidnightUtc();

  try {
    log(`=== Tennis Total Games Analyzer — ${today} ===`);

    // ── 1. Fetch today's tennis total-games props from unified_props ──────
    // pp-props-scraper writes into unified_props with sport = tennis_atp | tennis_wta
    const { data: rawProps, error: propsErr } = await supabase
      .from("unified_props")
      .select("id, player_name, prop_type, stat_type, line, fanduel_line, sport, bookmaker, commence_time, event_description, opponent")
      .gte("commence_time", todayStartUtc)
      .in("sport", ["tennis_atp", "tennis_wta"])
      .not("line", "is", null);

    if (propsErr) throw new Error(`Props fetch: ${propsErr.message}`);

    if (!rawProps || rawProps.length === 0) {
      log("No tennis props found for today");
      await supabase.from("cron_job_history").insert({
        job_name: "tennis-games-analyzer", status: "completed",
        started_at: now.toISOString(), completed_at: new Date().toISOString(),
        duration_ms: Date.now() - now.getTime(),
        result: { picks: 0, reason: "no_tennis_props" },
      });
      return new Response(JSON.stringify({ success: true, picks: 0, reason: "no_tennis_props" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    log(`Raw tennis props: ${rawProps.length}`);

    // Filter to total-games props only
    const gamesProps = (rawProps as TennisProp[]).filter(p => {
      const st = (p.stat_type || p.prop_type || "").toLowerCase().trim();
      return TENNIS_GAMES_STAT_TYPES.has(st) || st.includes("game");
    });

    log(`Total-games props: ${gamesProps.length}`);

    if (gamesProps.length === 0) {
      log("No total-games lines found today");
      return new Response(JSON.stringify({ success: true, picks: 0, reason: "no_games_lines" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── 2. Load tennis_player_stats for all referenced players ───────────
    const allPlayerNames = new Set<string>();
    for (const prop of gamesProps) {
      const [pA, pB] = parseMatchPlayers(prop);
      if (pA) allPlayerNames.add(pA);
      if (pB) allPlayerNames.add(pB);
    }

    const { data: playerStatsRows } = await supabase
      .from("tennis_player_stats")
      .select("player_name, tour, surface, avg_games_l10, avg_games_l5, avg_sets_per_match, break_rate");

    // Build lookup: normName → { surface → stats }
    const playerStatsMap = new Map<string, Map<string, PlayerStats>>();
    for (const row of playerStatsRows || []) {
      const key = normName(row.player_name);
      if (!playerStatsMap.has(key)) playerStatsMap.set(key, new Map());
      playerStatsMap.get(key)!.set(row.surface || "all", {
        avg_games_l10: row.avg_games_l10,
        avg_games_l5: row.avg_games_l5,
        surface: row.surface,
      });
    }

    log(`Player stats loaded: ${playerStatsMap.size} players`);

    /** Lookup player stats for a given surface (falls back to 'all') */
    function getPlayerStats(playerName: string, surface: string): PlayerStats | null {
      const key = normName(playerName);
      const surfaceMap = playerStatsMap.get(key);
      if (!surfaceMap) return null;
      return surfaceMap.get(surface) || surfaceMap.get("all") || null;
    }

    // ── 3. De-duplicate matches (same match may appear as multiple props) ─
    // Key: normalise player names alphabetically so A vs B = B vs A
    const matchMap = new Map<string, TennisProp>();
    for (const prop of gamesProps) {
      const [pA, pB] = parseMatchPlayers(prop);
      if (!pA) continue;
      const sorted = [normName(pA), normName(pB || "")].sort().join("||");
      const tour = tourFromSport(prop.sport);
      if (!tour) continue;
      const dedupeKey = `${sorted}__${tour}`;
      // Prefer props with actual line values; keep first found otherwise
      if (!matchMap.has(dedupeKey)) {
        matchMap.set(dedupeKey, prop);
      }
    }

    log(`Unique matches: ${matchMap.size}`);

    // ── 4. Analyse each match ─────────────────────────────────────────────
    const analyses: MatchAnalysis[] = [];

    for (const [, prop] of matchMap) {
      const [pA, pB] = parseMatchPlayers(prop);
      const tour = tourFromSport(prop.sport)!;
      const ppLine = Number(prop.line ?? prop.fanduel_line ?? 0);
      if (ppLine <= 0) continue;

      const surface = detectSurface(prop.event_description, prop.player_name);

      // Retrieve player stats
      const statsA = getPlayerStats(pA, surface);
      const statsB = pB ? getPlayerStats(pB, surface) : null;

      const fallback = tour === "WTA" ? FALLBACK_WTA_AVG : FALLBACK_ATP_AVG;

      const pAL10 = statsA?.avg_games_l10 ?? null;
      const pBL10 = statsB?.avg_games_l10 ?? null;
      const pAL5 = statsA?.avg_games_l5 ?? null;
      const pBL5 = statsB?.avg_games_l5 ?? null;

      // Naive projection: average of player L10 game totals (per-match, not per-player)
      // Each player's L10 "games" should represent games played IN that match,
      // i.e. total games the match had (both players combined).
      // If we only have one player's stats, use their value directly.
      // If neither has stats, use the tour fallback.
      let naiveProjection: number;
      if (pAL10 !== null && pBL10 !== null) {
        naiveProjection = (pAL10 + pBL10) / 2;
      } else if (pAL10 !== null) {
        naiveProjection = pAL10;
      } else if (pBL10 !== null) {
        naiveProjection = pBL10;
      } else {
        naiveProjection = fallback;
      }

      // Gender modifier
      const genderMod = GENDER_MODIFIER[tour] ?? 0;

      // Surface modifier
      const surfaceKey = `${tour}_${surface}`;
      const surfaceMod = SURFACE_MODIFIER[surfaceKey] ?? 0;

      // H2H modifier — look up head-to-head if we can
      // tennis_player_stats stores H2H under player_name = "PlayerA vs PlayerB"
      // We check both orderings
      let h2hAvg: number | null = null;
      let h2hSampleSize = 0;
      const h2hKeyAB = normName(`${pA} vs ${pB}`);
      const h2hKeyBA = normName(`${pB} vs ${pA}`);
      const h2hMap = playerStatsMap.get(h2hKeyAB) || playerStatsMap.get(h2hKeyBA);
      if (h2hMap) {
        const h2hStats = h2hMap.get("all") || h2hMap.get(surface) || null;
        if (h2hStats?.avg_games_l10 !== null && h2hStats?.avg_games_l10 !== undefined) {
          h2hAvg = h2hStats.avg_games_l10!;
          // games_sample_size isn't in the select above for simplicity — use L5 presence as proxy
          h2hSampleSize = h2hStats.avg_games_l5 !== null ? 5 : 3;
        }
      }

      // H2H modifier: partial blend if we have H2H data
      let h2hMod = 0;
      if (h2hSampleSize >= 3 && h2hAvg !== null) {
        const naiveWithGenSurf = naiveProjection + genderMod + surfaceMod;
        h2hMod = (h2hAvg - naiveWithGenSurf) * 0.25; // blend 25% toward H2H
      }

      const projectedTotal = Math.round((naiveProjection + genderMod + surfaceMod + h2hMod) * 2) / 2;

      // Compute edge
      const diff = projectedTotal - ppLine;
      const edgePct = Math.abs(diff) / ppLine * 100;

      // Only emit if edge exceeds minimum
      if (edgePct < MIN_EDGE_PCT) {
        log(`SKIP ${pA} vs ${pB}: edge ${edgePct.toFixed(1)}% < ${MIN_EDGE_PCT}%`);
        continue;
      }

      const recommendedSide: "over" | "under" = diff > 0 ? "over" : "under";

      const confidenceInput = { edgePct, playerAL10: pAL10, playerBL10: pBL10, h2hSampleSize, h2hAvg, projectedTotal, ppLine, recommendedSide };
      const confidence = computeConfidence(confidenceInput);

      if (confidence < MIN_CONFIDENCE) {
        log(`SKIP ${pA} vs ${pB}: confidence ${confidence.toFixed(2)} < ${MIN_CONFIDENCE}`);
        continue;
      }

      const analysis: MatchAnalysis = {
        playerA: pA, playerB: pB || "TBD", tour, surface, ppLine, projectedTotal,
        genderMod, surfaceMod, h2hMod, playerAL10: pAL10, playerBL10: pBL10,
        playerAL5: pAL5, playerBL5: pBL5, h2hAvg, h2hSampleSize,
        edgePct: Math.round(edgePct * 10) / 10, recommendedSide, confidence,
        narrative: "", sourcePropId: prop.id,
      };
      analysis.narrative = buildNarrative(analysis);

      analyses.push(analysis);
      log(`PICK: ${pA} vs ${pB} — ${recommendedSide.toUpperCase()} ${ppLine} | proj ${projectedTotal} | edge ${edgePct.toFixed(1)}% | conf ${(confidence * 100).toFixed(0)}%`);
    }

    log(`Qualifying picks: ${analyses.length}`);

    if (analyses.length === 0) {
      await supabase.from("cron_job_history").insert({
        job_name: "tennis-games-analyzer", status: "completed",
        started_at: now.toISOString(), completed_at: new Date().toISOString(),
        duration_ms: Date.now() - now.getTime(),
        result: { picks: 0, reason: "edge_below_threshold", matches_analysed: matchMap.size },
      });
      return new Response(JSON.stringify({ success: true, picks: 0, matches_analysed: matchMap.size }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── 5. Write to tennis_match_model ────────────────────────────────────
    const modelRows = analyses.map(a => ({
      analysis_date:          today,
      player_a:               a.playerA,
      player_b:               a.playerB,
      tour:                   a.tour,
      surface:                a.surface,
      pp_total_games_line:    a.ppLine,
      projected_total_games:  a.projectedTotal,
      recommended_side:       a.recommendedSide,
      edge_pct:               a.edgePct,
      gender_modifier:        a.genderMod,
      surface_modifier:       a.surfaceMod,
      player_a_avg_games_l10: a.playerAL10,
      player_b_avg_games_l10: a.playerBL10,
      player_a_avg_games_l5:  a.playerAL5,
      player_b_avg_games_l5:  a.playerBL5,
      h2h_avg_games:          a.h2hAvg,
      h2h_sample_size:        a.h2hSampleSize,
      confidence_score:       a.confidence,
      narrative:              a.narrative,
      source_prop_id:         a.sourcePropId,
    }));

    // Upsert — unique index on (analysis_date, player_a, player_b, tour)
    const { error: modelErr } = await supabase
      .from("tennis_match_model")
      .upsert(modelRows, { onConflict: "analysis_date,player_a,player_b,tour" });

    if (modelErr) log(`⚠ tennis_match_model upsert error: ${modelErr.message}`);
    else log(`Upserted ${modelRows.length} rows to tennis_match_model`);

    // ── 6. Write to category_sweet_spots (pipeline pick-up) ───────────────
    // Use the combined match as the "player_name" field so parlay generators
    // display it cleanly.  prop_type = "total_games", category = TENNIS_GAMES_OVER/UNDER.
    const sweetSpotRows = analyses.map(a => ({
      analysis_date:      today,
      player_name:        `${a.playerA} vs ${a.playerB}`,
      prop_type:          "total_games",
      category:           a.recommendedSide === "over" ? "TENNIS_GAMES_OVER" : "TENNIS_GAMES_UNDER",
      recommended_side:   a.recommendedSide,
      recommended_line:   a.ppLine,
      actual_line:        a.ppLine,
      confidence_score:   Math.round(a.confidence * 100) / 100,
      l10_hit_rate:       null,      // accumulates over time as tennis_match_model settles
      l10_avg:            a.projectedTotal,
      l10_median:         a.projectedTotal,
      l3_avg:             null,
      games_played:       (a.playerAL10 !== null || a.playerBL10 !== null) ? 10 : 0,
      is_active:          true,
      risk_level:         a.edgePct >= 8 ? "LOW" : a.edgePct >= 5 ? "MEDIUM" : "HIGH",
      recommendation:     `${a.recommendedSide.toUpperCase()} ${a.ppLine} total games — ${a.edgePct.toFixed(1)}% edge`,
      quality_tier:       a.confidence >= 0.80 ? "ELITE" : a.confidence >= 0.70 ? "PREMIUM" : "STANDARD",
      projected_value:    a.projectedTotal,
      projection_source:  "TENNIS_GENDER_SURFACE_MODEL",
      eligibility_type:   "TENNIS_MATCH",
      // Store full model context for parlay generators
      signal_factors: JSON.stringify({
        tour:           a.tour,
        surface:        a.surface,
        gender_mod:     a.genderMod,
        surface_mod:    a.surfaceMod,
        h2h_mod:        a.h2hMod,
        player_a_l10:   a.playerAL10,
        player_b_l10:   a.playerBL10,
        h2h_avg:        a.h2hAvg,
        h2h_samples:    a.h2hSampleSize,
        pp_line:        a.ppLine,
        projected:      a.projectedTotal,
        edge_pct:       a.edgePct,
      }),
    }));

    // Delete today's existing tennis sweet spots first (clean slate per run)
    await supabase
      .from("category_sweet_spots")
      .delete()
      .eq("analysis_date", today)
      .in("category", ["TENNIS_GAMES_OVER", "TENNIS_GAMES_UNDER"]);

    const { error: sweetErr } = await supabase
      .from("category_sweet_spots")
      .insert(sweetSpotRows);

    if (sweetErr) log(`⚠ category_sweet_spots insert error: ${sweetErr.message}`);
    else log(`Inserted ${sweetSpotRows.length} tennis picks to category_sweet_spots`);

    // ── 7. Send Telegram summary ──────────────────────────────────────────
    const lines: string[] = [
      `🎾 *Tennis Total Games — ${analyses.length} pick${analyses.length !== 1 ? "s" : ""} found*`,
      "",
    ];

    analyses
      .sort((a, b) => b.edgePct - a.edgePct) // highest edge first
      .forEach((a, i) => {
        const emoji = i === 0 ? "1️⃣" : i === 1 ? "2️⃣" : i === 2 ? "3️⃣" : `${i + 1}.`;
        const sideTag = a.recommendedSide === "under" ? "UNDER" : "OVER";
        const surfaceEmoji = a.surface === "clay" ? "🧱" : a.surface === "grass" ? "🌿" : "🎾";
        const tourTag = a.tour === "WTA" ? "WTA" : "ATP";
        const hasStat = a.playerAL10 !== null && a.playerBL10 !== null;
        const statsLine = hasStat
          ? `   📈 L10 avg total: ${((a.playerAL10! + a.playerBL10!) / 2).toFixed(1)} games`
          : `   📈 Projected: ${a.projectedTotal} games (model-only)`;

        lines.push(`${emoji} *${a.playerA} vs ${a.playerB}* — ${sideTag} ${a.ppLine} games`);
        lines.push(`   ${surfaceEmoji} ${tourTag} ${a.surface} — ${a.narrative}`);
        lines.push(statsLine);
        lines.push(`   📊 Edge: ${a.edgePct.toFixed(1)}% | Confidence: ${Math.round(a.confidence * 100)}%`);
        lines.push("");
      });

    lines.push(`_Picks written to category sweet spots — flows into parlay pipeline automatically._`);

    const message = lines.join("\n");

    try {
      await supabase.functions.invoke("bot-send-telegram", {
        body: { message, parse_mode: "Markdown", admin_only: true },
      });
      log("Telegram sent ✅");
    } catch (tgErr: any) {
      log(`Telegram error: ${tgErr.message}`);
    }

    // ── 8. Log to cron_job_history ────────────────────────────────────────
    await supabase.from("cron_job_history").insert({
      job_name: "tennis-games-analyzer",
      status: "completed",
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(),
      result: {
        picks: analyses.length,
        matches_analysed: matchMap.size,
        raw_props: rawProps.length,
        atp: analyses.filter(a => a.tour === "ATP").length,
        wta: analyses.filter(a => a.tour === "WTA").length,
        over: analyses.filter(a => a.recommendedSide === "over").length,
        under: analyses.filter(a => a.recommendedSide === "under").length,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        picks: analyses.length,
        matches_analysed: matchMap.size,
        details: analyses.map(a => ({
          match: `${a.playerA} vs ${a.playerB}`,
          tour: a.tour,
          surface: a.surface,
          side: a.recommendedSide,
          line: a.ppLine,
          projected: a.projectedTotal,
          edge_pct: a.edgePct,
          confidence: Math.round(a.confidence * 100),
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    log(`❌ Fatal: ${err.message}`);
    try {
      await supabase.from("cron_job_history").insert({
        job_name: "tennis-games-analyzer", status: "failed",
        started_at: now.toISOString(), completed_at: new Date().toISOString(),
        duration_ms: Date.now() - now.getTime(), result: { error: err.message },
      });
    } catch (_) {}
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
