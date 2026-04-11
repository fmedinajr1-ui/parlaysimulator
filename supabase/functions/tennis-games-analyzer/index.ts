import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// tennis-games-analyzer (v3 — fixed column refs for unified_props)
//
// Reads today's ATP/WTA props from unified_props (written by tennis-props-sync
// via The Odds API), applies gender + surface modelling + H2H, and writes
// qualifying picks to category_sweet_spots.
//
// Supports prop_types: total_games, player_total_games, player_games_won,
// player_total_sets, alternate_total_games
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_EDGE_PCT = 3.0;
const MIN_CONFIDENCE = 0.60;
const FALLBACK_ATP_AVG = 38.5;
const FALLBACK_WTA_AVG = 20.5;

const GENDER_MODIFIER: Record<string, number> = { ATP: +0.5, WTA: -1.5 };

const SURFACE_MODIFIER: Record<string, number> = {
  WTA_clay: -0.5, WTA_grass: +0.2, WTA_hard: 0.0, WTA_indoor_hard: 0.0,
  ATP_clay: -0.3, ATP_grass: +0.5, ATP_hard: 0.0, ATP_indoor_hard: +0.2,
};

// All prop_types we consider as "total games" lines
const TOTAL_GAMES_PROP_TYPES = new Set([
  "total_games", "total games", "player_total_games", "alternate_total_games",
  "games", "game total", "total games played", "totals", "total",
]);

// Prop types that are per-player (not match total)
const PLAYER_PROP_TYPES = new Set([
  "player_games_won", "player_total_sets",
]);

interface UnifiedProp {
  id: string;
  player_name: string;
  prop_type: string;
  current_line: number | null;
  over_price: number | null;
  under_price: number | null;
  sport: string;
  bookmaker: string | null;
  commence_time: string | null;
  game_description: string | null;
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
  propType: string;
  sourcePropId: string;
}

function getEasternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function tourFromSport(sport: string): "ATP" | "WTA" | null {
  const lower = (sport || "").toLowerCase();
  if (lower.includes("wta")) return "WTA";
  if (lower.includes("atp") || lower.includes("tennis")) return "ATP";
  return null;
}

function detectSurface(desc: string | null): string {
  const text = (desc || "").toLowerCase();
  if (text.includes("roland garros") || text.includes("clay") || text.includes("french open") ||
      text.includes("monte") || text.includes("madrid") || text.includes("rome") ||
      text.includes("barcelona")) return "clay";
  if (text.includes("wimbledon") || text.includes("grass") || text.includes("queen") ||
      text.includes("halle")) return "grass";
  if (text.includes("indoor") || text.includes("rotterdam") || text.includes("sofia")) return "indoor_hard";
  return "hard";
}

function parseMatchPlayers(prop: UnifiedProp): [string, string] {
  // Try game_description "X vs Y"
  const vsMatch = (prop.game_description || "").match(/^(.+?)\s+(?:vs?\.?)\s+(.+?)(?:\s*[-–—]\s*.+)?$/i);
  if (vsMatch) return [vsMatch[1].trim(), vsMatch[2].trim()];

  // Try player_name "X vs Y"
  const vsInName = (prop.player_name || "").match(/^(.+?)\s+(?:vs?\.?)\s+(.+)$/i);
  if (vsInName) return [vsInName[1].trim(), vsInName[2].trim()];

  return [prop.player_name || "", ""];
}

function normName(name: string): string {
  return name.toLowerCase().replace(/[.']/g, "").replace(/\s+/g, " ").trim();
}

function buildNarrative(a: MatchAnalysis): string {
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
    if (a.tour === "WTA" && a.surface === "clay") return "Clay WTA — heavy break patterns expected.";
    if (a.tour === "ATP" && a.surface === "grass") return "Grass ATP — serve dominance, minimal breaks.";
    if (a.tour === "WTA") return "WTA match — no 5th set, more breaks vs ATP.";
    if (a.tour === "ATP" && a.surface === "clay") return "ATP clay — longer rallies but still 5-set potential.";
    return `${a.tour} ${surfaceLabel} court.`;
  })();

  return `${surfaceTendency} ${lineVsProj}.${stats}${h2hNote}`;
}

function computeConfidence(a: {
  edgePct: number; playerAL10: number | null; playerBL10: number | null;
  h2hSampleSize: number; h2hAvg: number | null; ppLine: number;
  recommendedSide: "over" | "under";
}): number {
  let conf = 0.50 + Math.min(a.edgePct * 0.025, 0.20);
  if (a.playerAL10 !== null && a.playerBL10 !== null) conf += 0.08;
  else conf -= 0.05;

  if (a.h2hSampleSize >= 3 && a.h2hAvg !== null) {
    const h2hSupports = a.recommendedSide === "under" ? a.h2hAvg < a.ppLine : a.h2hAvg > a.ppLine;
    conf += h2hSupports ? 0.06 : -0.04;
  }

  if (a.recommendedSide === "under") conf += 0.03;
  return Math.min(0.92, Math.max(0.35, conf));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const log = (msg: string) => console.log(`[tennis-games-analyzer] ${msg}`);
  const now = new Date();
  const today = getEasternDate();

  try {
    log(`=== Tennis Games Analyzer v3 — ${today} ===`);

    // ── 1. Fetch today's tennis props from unified_props ────────────────
    // CORRECT columns: prop_type (not stat_type), current_line (not line),
    // game_description (not event_description). No "opponent" column.
    const { data: rawProps, error: propsErr } = await supabase
      .from("unified_props")
      .select("id, player_name, prop_type, current_line, over_price, under_price, sport, bookmaker, commence_time, game_description")
      .gte("commence_time", `${today}T00:00:00`)
      .or("sport.ilike.%tennis%,sport.ilike.%atp%,sport.ilike.%wta%")
      .not("current_line", "is", null);

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

    // Log diagnostic: unique prop_types and sports found
    const propTypesFound = [...new Set(rawProps.map(p => p.prop_type).filter(Boolean))];
    const sportsFound = [...new Set(rawProps.map(p => p.sport).filter(Boolean))];
    log(`Prop types in DB: ${propTypesFound.join(", ")}`);
    log(`Sports in DB: ${sportsFound.join(", ")}`);

    // Filter to total-games props (match-level analysis)
    const gamesProps = rawProps.filter(p => {
      const pt = (p.prop_type || "").toLowerCase().trim();
      return TOTAL_GAMES_PROP_TYPES.has(pt) || pt.includes("game") || pt.includes("total");
    });

    // Also collect per-player props for additional signals
    const playerProps = rawProps.filter(p => {
      const pt = (p.prop_type || "").toLowerCase().trim();
      return PLAYER_PROP_TYPES.has(pt);
    });

    log(`Total-games props: ${gamesProps.length} | Player props: ${playerProps.length}`);

    // Fallback: if no explicit games props, try any prop with line 10-60
    const workingProps = gamesProps.length > 0 ? gamesProps : rawProps.filter(p => {
      const line = Number(p.current_line || 0);
      return line > 10 && line < 60;
    });

    if (workingProps.length === 0) {
      log("No total-games lines found today");
      return new Response(JSON.stringify({ success: true, picks: 0, reason: "no_games_lines", prop_types_seen: propTypesFound }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── 2. Load tennis_player_stats ─────────────────────────────────────
    const { data: playerStatsRows } = await supabase
      .from("tennis_player_stats")
      .select("player_name, tour, surface, avg_games_l10, avg_games_l5, avg_sets_per_match, break_rate");

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

    function getPlayerStats(playerName: string, surface: string): PlayerStats | null {
      const key = normName(playerName);
      const surfaceMap = playerStatsMap.get(key);
      if (!surfaceMap) return null;
      return surfaceMap.get(surface) || surfaceMap.get("all") || null;
    }

    // ── 3. De-duplicate matches ─────────────────────────────────────────
    const matchMap = new Map<string, UnifiedProp>();
    for (const prop of workingProps) {
      const [pA, pB] = parseMatchPlayers(prop as UnifiedProp);
      if (!pA) continue;
      const sorted = [normName(pA), normName(pB || "")].sort().join("||");
      const tour = tourFromSport(prop.sport);
      if (!tour) continue;
      const dedupeKey = `${sorted}__${tour}`;
      if (!matchMap.has(dedupeKey)) {
        matchMap.set(dedupeKey, prop as UnifiedProp);
      }
    }

    log(`Unique matches: ${matchMap.size}`);

    // ── 4. Analyse each match ───────────────────────────────────────────
    const analyses: MatchAnalysis[] = [];

    for (const [, prop] of matchMap) {
      const [pA, pB] = parseMatchPlayers(prop);
      const tour = tourFromSport(prop.sport)!;
      const ppLine = Number(prop.current_line ?? 0);
      if (ppLine <= 0) continue;

      const surface = detectSurface(prop.game_description);

      const statsA = getPlayerStats(pA, surface);
      const statsB = pB ? getPlayerStats(pB, surface) : null;

      const fallback = tour === "WTA" ? FALLBACK_WTA_AVG : FALLBACK_ATP_AVG;

      const pAL10 = statsA?.avg_games_l10 ?? null;
      const pBL10 = statsB?.avg_games_l10 ?? null;
      const pAL5 = statsA?.avg_games_l5 ?? null;
      const pBL5 = statsB?.avg_games_l5 ?? null;

      let naiveProjection: number;
      if (pAL10 !== null && pBL10 !== null) naiveProjection = (pAL10 + pBL10) / 2;
      else if (pAL10 !== null) naiveProjection = pAL10;
      else if (pBL10 !== null) naiveProjection = pBL10;
      else naiveProjection = fallback;

      const genderMod = GENDER_MODIFIER[tour] ?? 0;
      const surfaceMod = SURFACE_MODIFIER[`${tour}_${surface}`] ?? 0;

      // H2H
      let h2hAvg: number | null = null;
      let h2hSampleSize = 0;
      const h2hMap = playerStatsMap.get(normName(`${pA} vs ${pB}`)) || playerStatsMap.get(normName(`${pB} vs ${pA}`));
      if (h2hMap) {
        const h2hStats = h2hMap.get("all") || h2hMap.get(surface) || null;
        if (h2hStats?.avg_games_l10 != null) {
          h2hAvg = h2hStats.avg_games_l10;
          h2hSampleSize = h2hStats.avg_games_l5 !== null ? 5 : 3;
        }
      }

      let h2hMod = 0;
      if (h2hSampleSize >= 3 && h2hAvg !== null) {
        h2hMod = (h2hAvg - (naiveProjection + genderMod + surfaceMod)) * 0.25;
      }

      const projectedTotal = Math.round((naiveProjection + genderMod + surfaceMod + h2hMod) * 2) / 2;
      const diff = projectedTotal - ppLine;
      const edgePct = Math.abs(diff) / ppLine * 100;

      if (edgePct < MIN_EDGE_PCT) {
        log(`SKIP ${pA} vs ${pB}: edge ${edgePct.toFixed(1)}% < ${MIN_EDGE_PCT}%`);
        continue;
      }

      const recommendedSide: "over" | "under" = diff > 0 ? "over" : "under";
      const confidence = computeConfidence({ edgePct, playerAL10: pAL10, playerBL10: pBL10, h2hSampleSize, h2hAvg, ppLine, recommendedSide });

      if (confidence < MIN_CONFIDENCE) {
        log(`SKIP ${pA} vs ${pB}: confidence ${confidence.toFixed(2)} < ${MIN_CONFIDENCE}`);
        continue;
      }

      const analysis: MatchAnalysis = {
        playerA: pA, playerB: pB || "TBD", tour, surface, ppLine, projectedTotal,
        genderMod, surfaceMod, h2hMod, playerAL10: pAL10, playerBL10: pBL10,
        playerAL5: pAL5, playerBL5: pBL5, h2hAvg, h2hSampleSize,
        edgePct: Math.round(edgePct * 10) / 10, recommendedSide, confidence,
        narrative: "", propType: prop.prop_type, sourcePropId: prop.id,
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

    // ── 5. Write to tennis_match_model ──────────────────────────────────
    const modelRows = analyses.map(a => ({
      analysis_date: today,
      player_a: a.playerA,
      player_b: a.playerB,
      tour: a.tour,
      surface: a.surface,
      pp_total_games_line: a.ppLine,
      projected_total_games: a.projectedTotal,
      recommended_side: a.recommendedSide,
      edge_pct: a.edgePct,
      gender_modifier: a.genderMod,
      surface_modifier: a.surfaceMod,
      player_a_avg_games_l10: a.playerAL10,
      player_b_avg_games_l10: a.playerBL10,
      player_a_avg_games_l5: a.playerAL5,
      player_b_avg_games_l5: a.playerBL5,
      h2h_avg_games: a.h2hAvg,
      h2h_sample_size: a.h2hSampleSize,
      confidence_score: a.confidence,
      narrative: a.narrative,
      source_prop_id: a.sourcePropId,
    }));

    const { error: modelErr } = await supabase
      .from("tennis_match_model")
      .upsert(modelRows, { onConflict: "analysis_date,player_a,player_b,tour" });

    if (modelErr) log(`⚠ tennis_match_model upsert error: ${modelErr.message}`);
    else log(`Upserted ${modelRows.length} rows to tennis_match_model`);

    // ── 6. Write to category_sweet_spots ────────────────────────────────
    const sweetSpotRows = analyses.map(a => ({
      analysis_date: today,
      player_name: `${a.playerA} vs ${a.playerB}`,
      prop_type: "total_games",
      category: a.recommendedSide === "over" ? "TENNIS_GAMES_OVER" : "TENNIS_GAMES_UNDER",
      recommended_side: a.recommendedSide,
      recommended_line: a.ppLine,
      actual_line: a.ppLine,
      confidence_score: Math.round(a.confidence * 100) / 100,
      l10_avg: a.projectedTotal,
      l10_median: a.projectedTotal,
      is_active: true,
      risk_level: a.edgePct >= 8 ? "LOW" : a.edgePct >= 5 ? "MEDIUM" : "HIGH",
      recommendation: `${a.recommendedSide.toUpperCase()} ${a.ppLine} total games — ${a.edgePct.toFixed(1)}% edge`,
      quality_tier: a.confidence >= 0.80 ? "ELITE" : a.confidence >= 0.70 ? "PREMIUM" : "STANDARD",
      projected_value: a.projectedTotal,
      projection_source: "TENNIS_GENDER_SURFACE_MODEL",
      eligibility_type: "TENNIS_MATCH",
      signal_factors: JSON.stringify({
        tour: a.tour, surface: a.surface, gender_mod: a.genderMod, surface_mod: a.surfaceMod,
        h2h_mod: a.h2hMod, player_a_l10: a.playerAL10, player_b_l10: a.playerBL10,
        h2h_avg: a.h2hAvg, h2h_samples: a.h2hSampleSize, pp_line: a.ppLine,
        projected: a.projectedTotal, edge_pct: a.edgePct,
      }),
    }));

    await supabase.from("category_sweet_spots").delete()
      .eq("analysis_date", today)
      .in("category", ["TENNIS_GAMES_OVER", "TENNIS_GAMES_UNDER"]);

    const { error: sweetErr } = await supabase.from("category_sweet_spots").insert(sweetSpotRows);
    if (sweetErr) log(`⚠ category_sweet_spots insert error: ${sweetErr.message}`);
    else log(`Inserted ${sweetSpotRows.length} tennis picks to category_sweet_spots`);

    // ── 7. Telegram ─────────────────────────────────────────────────────
    const lines: string[] = [
      `🎾 *Tennis Total Games — ${analyses.length} pick${analyses.length !== 1 ? "s" : ""} found*`,
      "",
    ];

    analyses.sort((a, b) => b.edgePct - a.edgePct).forEach((a, i) => {
      const emoji = i === 0 ? "1️⃣" : i === 1 ? "2️⃣" : i === 2 ? "3️⃣" : `${i + 1}.`;
      const sideTag = a.recommendedSide === "under" ? "UNDER" : "OVER";
      const surfaceEmoji = a.surface === "clay" ? "🧱" : a.surface === "grass" ? "🌿" : "🎾";
      lines.push(`${emoji} *${a.playerA} vs ${a.playerB}* — ${sideTag} ${a.ppLine} games`);
      lines.push(`   ${surfaceEmoji} ${a.tour} ${a.surface} — ${a.narrative}`);
      lines.push(`   📊 Edge: ${a.edgePct.toFixed(1)}% | Confidence: ${Math.round(a.confidence * 100)}%`);
      lines.push("");
    });

    lines.push(`_Picks written to category sweet spots — flows into parlay pipeline automatically._`);

    try {
      await supabase.functions.invoke("bot-send-telegram", {
        body: { message: lines.join("\n"), parse_mode: "Markdown", admin_only: true },
      });
      log("Telegram sent ✅");
    } catch (tgErr: any) {
      log(`Telegram error: ${tgErr.message}`);
    }

    // ── 8. Log ──────────────────────────────────────────────────────────
    await supabase.from("cron_job_history").insert({
      job_name: "tennis-games-analyzer", status: "completed",
      started_at: now.toISOString(), completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(),
      result: {
        picks: analyses.length, matches_analysed: matchMap.size,
        raw_props: rawProps.length, prop_types_seen: propTypesFound,
        atp: analyses.filter(a => a.tour === "ATP").length,
        wta: analyses.filter(a => a.tour === "WTA").length,
      },
    });

    return new Response(JSON.stringify({
      success: true, picks: analyses.length, matches_analysed: matchMap.size,
      details: analyses.map(a => ({
        match: `${a.playerA} vs ${a.playerB}`, tour: a.tour, surface: a.surface,
        side: a.recommendedSide, line: a.ppLine, projected: a.projectedTotal,
        edge_pct: a.edgePct, confidence: Math.round(a.confidence * 100),
      })),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
