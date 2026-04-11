import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// tennis-props-sync
//
// WHY THE OLD VERSION RETURNED 0 PICKS:
//   "No active tennis totals today" — the function was filtering on a specific
//   prop_type string (e.g., "total_games") that doesn't match what pp-props-scraper
//   actually writes. PrizePicks stores tennis totals under various stat_type
//   values ("fantasy_score", "games", "total games", etc.) and the sport key
//   varies between "tennis_atp", "tennis_wta", "tennis" or similar.
//
// WHAT THIS FUNCTION DOES:
//   1. Query unified_props with a BROAD sport filter (any sport key containing
//      "tennis") and NO prop_type filter — then log ALL unique prop_types found
//      so we can see exactly what's in the table.
//   2. From those props, identify tennis matches and their total-games lines
//      under any of the known stat_type variants.
//   3. Cross-reference each player against tennis_player_stats (L10 averages
//      by surface and tour — populated by tennis-games-analyzer).
//   4. Update tennis_match_model with the real PrizePicks line for today.
//   5. Update tennis_player_stats with any new data from settled matches in
//      category_sweet_spots (so the model gets sharper over time).
//   6. Output a diagnostic block so you can see exactly what prop_types are
//      present for tennis — this debug info will tell you what to adjust.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function getEasternMidnightUtc(): string {
  return `${getEasternDate()}T00:00:00-05:00`;
}

function normName(s: string): string {
  return (s || "").toLowerCase().replace(/[.']/g, "").replace(/\s+/g, " ").trim();
}

// All possible tennis total-games stat type strings PrizePicks / bookmakers use
const TENNIS_GAMES_STAT_TYPES = new Set([
  "total games", "total_games", "games", "game total", "games played",
  "total games played", "alternate total games", "games (sets)",
  // PrizePicks often calls it "fantasy_score" for tennis total points/games
  "fantasy_score",
  // Sometimes stored as the prop_type directly
  "player_total_games", "match_total_games",
]);

// Known tennis sport keys — broaden this to catch anything
const TENNIS_SPORT_KEYS = [
  "tennis_atp", "tennis_wta", "tennis", "tennis_atp_singles", "tennis_wta_singles",
  "tennis_challenger", "tennis_itf",
];

// Parse "Player A vs Player B" from event_description
function parseMatchup(desc: string): [string, string] | null {
  const m = (desc || "").match(/^(.+?)\s+(?:vs?\.?)\s+(.+?)(?:\s*[-–—]\s*.+)?$/i);
  return m ? [m[1].trim(), m[2].trim()] : null;
}

// Infer tour (ATP/WTA) from sport key or player context
function inferTour(sport: string, eventDesc: string): "ATP" | "WTA" | null {
  const s = (sport || "").toLowerCase();
  if (s.includes("wta")) return "WTA";
  if (s.includes("atp")) return "ATP";
  // WTA players typically have shorter matches — heuristic by line value
  // Lines < 22 are almost certainly WTA; lines > 35 almost certainly ATP
  return null; // caller will try to infer from line value
}

function inferTourFromLine(line: number): "ATP" | "WTA" {
  return line < 28 ? "WTA" : "ATP";
}

// Detect court surface from tournament name in event_description
function detectSurface(eventDesc: string): string {
  const t = (eventDesc || "").toLowerCase();
  if (t.includes("roland garros") || t.includes("clay") || t.includes("french open") ||
      t.includes("monte") || t.includes("madrid") || t.includes("rome") ||
      t.includes("barcelona") || t.includes("hamburg") || t.includes("buenos")) return "clay";
  if (t.includes("wimbledon") || t.includes("grass") || t.includes("queen") ||
      t.includes("halle") || t.includes("'s-hertogenbosch") || t.includes("eastbourne")) return "grass";
  if (t.includes("indoor") || t.includes("covered") || t.includes("rotterdam") ||
      t.includes("lyon") || t.includes("sofia") || t.includes("montpellier")) return "indoor_hard";
  return "hard";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const log = (msg: string) => console.log(`[tennis-props-sync] ${msg}`);
  const now = new Date();
  const today = getEasternDate();
  const todayStartUtc = getEasternMidnightUtc();

  try {
    log(`=== Tennis Props Sync — ${today} ===`);

    // ── 1. BROAD QUERY — find ALL tennis props regardless of prop_type ─────
    // This is the fix: don't filter by prop_type first, see what's actually there
    const { data: allTennisProps, error: propsErr } = await supabase
      .from("unified_props")
      .select("id, player_name, prop_type, stat_type, current_line, fanduel_line, line, over_price, under_price, bookmaker, event_id, event_description, sport, commence_time, opponent")
      .gte("commence_time", todayStartUtc)
      .or(TENNIS_SPORT_KEYS.map(k => `sport.eq.${k}`).join(","));

    if (propsErr) {
      // If the OR query syntax fails, try a simpler ilike
      const { data: fallbackProps, error: fallbackErr } = await supabase
        .from("unified_props")
        .select("id, player_name, prop_type, stat_type, current_line, fanduel_line, line, over_price, under_price, bookmaker, event_id, event_description, sport, commence_time, opponent")
        .gte("commence_time", todayStartUtc)
        .ilike("sport", "%tennis%");

      if (fallbackErr) throw new Error(`Tennis props fetch: ${fallbackErr.message}`);

      if (!fallbackProps || fallbackProps.length === 0) {
        log("No tennis props found via sport ILIKE '%tennis%' — checking if pp-props-scraper ran");
        const result = {
          success: true,
          tennis_props_found: 0,
          prop_types_seen: [],
          sport_keys_seen: [],
          matches_synced: 0,
          player_stats_updated: 0,
          reason: "No tennis props found for today. Check: (1) pp-props-scraper ran this morning, (2) It is a tournament week (ATP/WTA events scheduled), (3) The sport key in unified_props matches the TENNIS_SPORT_KEYS list in this function.",
          diagnosis: "Run SELECT DISTINCT sport, prop_type FROM unified_props WHERE commence_time >= NOW() LIMIT 50 in your Supabase SQL editor to see what sport keys are actually being stored.",
        };
        await supabase.from("cron_job_history").insert({
          job_name: "tennis-props-sync", status: "completed",
          started_at: now.toISOString(), completed_at: new Date().toISOString(),
          duration_ms: Date.now() - now.getTime(), result,
        });
        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      allTennisProps!.push(...fallbackProps);
    }

    const totalFound = (allTennisProps || []).length;
    log(`Total tennis props found: ${totalFound}`);

    // ── 2. DIAGNOSTIC: log every unique prop_type and stat_type seen ──────
    const propTypesFound = [...new Set((allTennisProps || []).map((p: any) => p.prop_type).filter(Boolean))];
    const statTypesFound = [...new Set((allTennisProps || []).map((p: any) => p.stat_type).filter(Boolean))];
    const sportKeysFound = [...new Set((allTennisProps || []).map((p: any) => p.sport).filter(Boolean))];

    log(`Sport keys present: ${sportKeysFound.join(", ")}`);
    log(`Prop types present: ${propTypesFound.join(", ")}`);
    log(`Stat types present: ${statTypesFound.join(", ")}`);

    if (totalFound === 0) {
      const result = {
        success: true,
        tennis_props_found: 0,
        sport_keys_seen: sportKeysFound,
        prop_types_seen: propTypesFound,
        matches_synced: 0,
        player_stats_updated: 0,
        reason: "No tennis props in unified_props today. Either no tournaments scheduled or scraper did not run.",
      };
      await supabase.from("cron_job_history").insert({
        job_name: "tennis-props-sync", status: "completed",
        started_at: now.toISOString(), completed_at: new Date().toISOString(),
        duration_ms: Date.now() - now.getTime(), result,
      });
      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── 3. Filter to total-games props using ALL known variants ───────────
    // Check both prop_type and stat_type fields
    const totalGamesProps = (allTennisProps || []).filter((p: any) => {
      const pt = (p.prop_type || "").toLowerCase().trim();
      const st = (p.stat_type || "").toLowerCase().trim();
      return TENNIS_GAMES_STAT_TYPES.has(pt) || TENNIS_GAMES_STAT_TYPES.has(st) ||
        pt.includes("game") || pt.includes("total") || st.includes("game") || st.includes("total");
    });

    log(`Total-games props (after filtering): ${totalGamesProps.length}`);

    // If still 0, log what we have and use all tennis props with a line
    const workingProps = totalGamesProps.length > 0
      ? totalGamesProps
      : (allTennisProps || []).filter((p: any) => {
          const line = Number(p.current_line || p.fanduel_line || p.line || 0);
          return line > 10 && line < 60; // reasonable range for tennis game totals
        });

    log(`Working props for analysis: ${workingProps.length}`);

    // ── 4. De-duplicate by match (event_id or player_name+opponent) ───────
    const matchMap = new Map<string, any>();
    for (const prop of workingProps) {
      const line = Number(prop.current_line || prop.fanduel_line || prop.line || 0);
      if (line <= 0) continue;

      let matchKey: string;
      const matchup = parseMatchup(prop.event_description || "");
      if (matchup) {
        const sorted = [normName(matchup[0]), normName(matchup[1])].sort().join("||");
        matchKey = `${sorted}__${prop.sport || "tennis"}`;
      } else if (prop.player_name && prop.opponent) {
        const sorted = [normName(prop.player_name), normName(prop.opponent)].sort().join("||");
        matchKey = `${sorted}__${prop.sport || "tennis"}`;
      } else {
        matchKey = `${prop.event_id || prop.player_name || "unknown"}__${prop.sport}`;
      }

      if (!matchMap.has(matchKey)) {
        matchMap.set(matchKey, { prop, line, matchup });
      }
    }

    log(`Unique tennis matches found: ${matchMap.size}`);

    // ── 5. Load existing tennis_player_stats ─────────────────────────────
    const { data: playerStatsRows } = await supabase
      .from("tennis_player_stats")
      .select("player_name, tour, surface, avg_games_l10, avg_games_l5, games_sample_size, last_updated");

    const playerStatsMap = new Map<string, Map<string, any>>();
    for (const row of playerStatsRows || []) {
      const key = normName(row.player_name);
      if (!playerStatsMap.has(key)) playerStatsMap.set(key, new Map());
      playerStatsMap.get(key)!.set(row.surface || "all", row);
    }
    log(`Loaded tennis_player_stats for ${playerStatsMap.size} players`);

    // ── 6. Load settled tennis picks to update player stats ───────────────
    const { data: settledPicks } = await supabase
      .from("tennis_match_model")
      .select("player_a, player_b, tour, surface, actual_total_games, pp_total_games_line, recommended_side, outcome, settled_at")
      .not("outcome", "is", null)
      .not("actual_total_games", "is", null)
      .gte("analysis_date", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]);

    log(`Loaded ${settledPicks?.length || 0} settled tennis match results`);

    // Build per-player game totals by surface from settled history
    const playerGameHistory = new Map<string, {
      all: number[]; hard: number[]; clay: number[]; grass: number[]; indoor_hard: number[];
    }>();

    for (const pick of settledPicks || []) {
      if (!pick.actual_total_games) continue;
      const games = Number(pick.actual_total_games);

      for (const playerName of [pick.player_a, pick.player_b]) {
        if (!playerName) continue;
        const key = normName(playerName);
        if (!playerGameHistory.has(key)) {
          playerGameHistory.set(key, { all: [], hard: [], clay: [], grass: [], indoor_hard: [] });
        }
        const hist = playerGameHistory.get(key)!;
        hist.all.push(games);
        const surf = (pick.surface || "hard").toLowerCase() as keyof typeof hist;
        if (hist[surf]) hist[surf].push(games);
      }
    }

    // ── 7. Update tennis_player_stats from settled history ────────────────
    const playerStatsUpdates: any[] = [];
    const SURFACES = ["all", "hard", "clay", "grass", "indoor_hard"] as const;

    for (const [playerKey, history] of playerGameHistory) {
      // Find the canonical player name (use the original casing from the first settled pick)
      const canonicalName = settledPicks?.find(p =>
        normName(p.player_a) === playerKey || normName(p.player_b) === playerKey
      );
      const playerName = (normName(canonicalName?.player_a || "") === playerKey
        ? canonicalName?.player_a
        : canonicalName?.player_b) || playerKey;

      // Detect tour from settled picks
      const playerPicks = (settledPicks || []).filter(p =>
        normName(p.player_a) === playerKey || normName(p.player_b) === playerKey
      );
      const tour = playerPicks[0]?.tour || (history.all.length > 0 && history.all.reduce((a, b) => a + b, 0) / history.all.length < 28 ? "WTA" : "ATP");

      for (const surface of SURFACES) {
        const games = history[surface];
        if (games.length < 2) continue;

        const sorted = [...games].sort((a, b) => a - b); // use all available history
        const avgAll = sorted.reduce((a, b) => a + b, 0) / sorted.length;

        // L10 and L5 (most recent first — but we don't have timestamps here, use most recent settlements)
        const l10 = games.slice(-10);
        const l5  = games.slice(-5);
        const avgL10 = l10.reduce((a, b) => a + b, 0) / l10.length;
        const avgL5  = l5.length >= 2 ? l5.reduce((a, b) => a + b, 0) / l5.length : null;

        playerStatsUpdates.push({
          player_name:        playerName,
          tour,
          surface,
          games_sample_size:  games.length,
          avg_games_per_match: Math.round(avgAll * 10) / 10,
          avg_games_l10:      Math.round(avgL10 * 10) / 10,
          avg_games_l5:       avgL5 !== null ? Math.round(avgL5 * 10) / 10 : null,
          last_updated:       new Date().toISOString(),
        });
      }
    }

    let playerStatsUpdated = 0;
    if (playerStatsUpdates.length > 0) {
      const { error: statsErr } = await supabase
        .from("tennis_player_stats")
        .upsert(playerStatsUpdates, { onConflict: "player_name,tour,surface" });
      if (statsErr) log(`⚠ Player stats upsert error: ${statsErr.message}`);
      else {
        playerStatsUpdated = playerStatsUpdates.length;
        log(`Updated tennis_player_stats: ${playerStatsUpdated} entries`);
      }
    }

    // ── 8. Sync today's matches to tennis_match_model ─────────────────────
    const modelRows: any[] = [];
    let matchesSynced = 0;

    for (const [, { prop, line, matchup }] of matchMap) {
      const sport = prop.sport || "tennis";
      let tour = inferTour(sport, prop.event_description || "");
      if (!tour) tour = inferTourFromLine(line);

      const surface = detectSurface(prop.event_description || "");

      let playerA: string, playerB: string;
      if (matchup) {
        [playerA, playerB] = matchup;
      } else if (prop.player_name && prop.opponent) {
        playerA = prop.player_name;
        playerB = prop.opponent;
      } else if (prop.player_name) {
        playerA = prop.player_name;
        playerB = "TBD";
      } else {
        continue; // can't identify players
      }

      // Look up player stats from our table
      const statsA = playerStatsMap.get(normName(playerA))?.get(surface)
               || playerStatsMap.get(normName(playerA))?.get("all") || null;
      const statsB = playerStatsMap.get(normName(playerB))?.get(surface)
               || playerStatsMap.get(normName(playerB))?.get("all") || null;

      // Gender modifiers (from tennis-games-analyzer constants)
      const GENDER_MODIFIER: Record<string, number> = { ATP: 0.5, WTA: -1.5 };
      const SURFACE_MODIFIER: Record<string, number> = {
        WTA_clay: -0.5, WTA_grass: 0.2, WTA_hard: 0.0, WTA_indoor_hard: 0.0,
        ATP_clay: -0.3, ATP_grass: 0.5, ATP_hard: 0.0, ATP_indoor_hard: 0.2,
      };

      const genderMod  = GENDER_MODIFIER[tour] ?? 0;
      const surfaceMod = SURFACE_MODIFIER[`${tour}_${surface}`] ?? 0;

      const fallback = tour === "WTA" ? 20.5 : 38.5;
      const aL10 = statsA?.avg_games_l10 ?? null;
      const bL10 = statsB?.avg_games_l10 ?? null;

      let naiveProjection: number;
      if (aL10 !== null && bL10 !== null) naiveProjection = (aL10 + bL10) / 2;
      else if (aL10 !== null) naiveProjection = aL10;
      else if (bL10 !== null) naiveProjection = bL10;
      else naiveProjection = fallback;

      const projected = Math.round((naiveProjection + genderMod + surfaceMod) * 2) / 2;
      const diff      = projected - line;
      const edgePct   = line > 0 ? Math.abs(diff) / line * 100 : 0;
      const recommendedSide: "over" | "under" = diff > 0 ? "over" : "under";

      modelRows.push({
        analysis_date:          today,
        player_a:               playerA,
        player_b:               playerB,
        tour,
        surface,
        pp_total_games_line:    line,
        projected_total_games:  projected,
        recommended_side:       recommendedSide,
        edge_pct:               Math.round(edgePct * 10) / 10,
        gender_modifier:        genderMod,
        surface_modifier:       surfaceMod,
        player_a_avg_games_l10: aL10,
        player_b_avg_games_l10: bL10,
        player_a_avg_games_l5:  statsA?.avg_games_l5 ?? null,
        player_b_avg_games_l5:  statsB?.avg_games_l5 ?? null,
        h2h_avg_games:          null,
        h2h_sample_size:        0,
        confidence_score:       (aL10 !== null || bL10 !== null) ? 0.65 : 0.55,
        narrative:              `${tour} ${surface} | Line ${line} | Projected ${projected} | Edge ${edgePct.toFixed(1)}%${aL10 || bL10 ? ` | ${playerA} L10: ${aL10 ?? "N/A"}, ${playerB} L10: ${bL10 ?? "N/A"}` : " (using tour defaults)"}`,
        source_prop_id:         prop.id || null,
      });

      matchesSynced++;
    }

    if (modelRows.length > 0) {
      const { error: modelErr } = await supabase
        .from("tennis_match_model")
        .upsert(modelRows, { onConflict: "analysis_date,player_a,player_b,tour" });
      if (modelErr) log(`⚠ tennis_match_model upsert error: ${modelErr.message}`);
      else log(`Synced ${modelRows.length} matches to tennis_match_model`);
    }

    // ── 9. Update category_sweet_spots for any qualifying picks ───────────
    // Picks with edge >= 3% get written so they flow into parlay pipeline
    const MIN_EDGE = 3.0;
    const qualifyingRows = modelRows.filter(r => r.edge_pct >= MIN_EDGE);

    if (qualifyingRows.length > 0) {
      await supabase.from("category_sweet_spots")
        .delete().eq("analysis_date", today)
        .in("category", ["TENNIS_GAMES_OVER", "TENNIS_GAMES_UNDER"]);

      const sweetSpotRows = qualifyingRows.map(r => ({
        analysis_date:      today,
        player_name:        `${r.player_a} vs ${r.player_b}`,
        prop_type:          "total_games",
        category:           r.recommended_side === "over" ? "TENNIS_GAMES_OVER" : "TENNIS_GAMES_UNDER",
        recommended_side:   r.recommended_side,
        recommended_line:   r.pp_total_games_line,
        actual_line:        r.pp_total_games_line,
        confidence_score:   r.confidence_score,
        l10_avg:            r.projected_total_games,
        l10_median:         r.projected_total_games,
        is_active:          true,
        risk_level:         r.edge_pct >= 8 ? "LOW" : r.edge_pct >= 5 ? "MEDIUM" : "HIGH",
        recommendation:     `${r.recommended_side.toUpperCase()} ${r.pp_total_games_line} total games — ${r.edge_pct.toFixed(1)}% edge`,
        projection_source:  "TENNIS_SYNC_MODEL",
        eligibility_type:   "TENNIS_MATCH",
        signal_factors: JSON.stringify({
          tour:           r.tour,
          surface:        r.surface,
          gender_mod:     r.gender_modifier,
          surface_mod:    r.surface_modifier,
          player_a_l10:   r.player_a_avg_games_l10,
          player_b_l10:   r.player_b_avg_games_l10,
          pp_line:        r.pp_total_games_line,
          projected:      r.projected_total_games,
          edge_pct:       r.edge_pct,
        }),
      }));

      const { error: sweetErr } = await supabase
        .from("category_sweet_spots").insert(sweetSpotRows);
      if (sweetErr) log(`⚠ Sweet spots insert error: ${sweetErr.message}`);
      else log(`Inserted ${sweetSpotRows.length} tennis picks to category_sweet_spots`);
    }

    // ── 10. Telegram summary ──────────────────────────────────────────────
    const telegramLines = [
      `🎾 *Tennis Props Sync — ${today}*`,
      `Found: ${totalFound} props | Matches: ${matchesSynced} | Picks: ${qualifyingRows.length}`,
      `Sport keys: ${sportKeysFound.join(", ") || "none"}`,
      `Prop types: ${propTypesFound.slice(0, 5).join(", ")}${propTypesFound.length > 5 ? "..." : ""}`,
      `Player stats updated: ${playerStatsUpdated}`,
      "",
    ];

    if (qualifyingRows.length > 0) {
      telegramLines.push("📊 *Qualifying picks:*");
      for (const r of qualifyingRows.slice(0, 5)) {
        const side = r.recommended_side === "over" ? "OVER" : "UNDER";
        telegramLines.push(`• ${r.player_a} vs ${r.player_b} — ${side} ${r.pp_total_games_line} | Edge: ${r.edge_pct.toFixed(1)}%`);
      }
    } else if (matchesSynced > 0) {
      telegramLines.push("_No picks exceeded the 3% edge threshold today — matches synced for tracking only._");
    }

    if (totalFound > 0 && matchesSynced === 0) {
      telegramLines.push("");
      telegramLines.push(`⚠️ Props found but no matches could be parsed. Prop types in DB: ${propTypesFound.join(", ")}`);
      telegramLines.push("Check that event_description contains 'Player A vs Player B' format.");
    }

    await supabase.functions.invoke("bot-send-telegram", {
      body: { message: telegramLines.join("\n"), parse_mode: "Markdown", admin_only: true },
    }).catch(() => {});

    const result = {
      success: true,
      tennis_props_found: totalFound,
      sport_keys_seen: sportKeysFound,
      prop_types_seen: propTypesFound,
      stat_types_seen: statTypesFound,
      matches_synced: matchesSynced,
      picks_qualifying: qualifyingRows.length,
      player_stats_updated: playerStatsUpdated,
    };

    await supabase.from("cron_job_history").insert({
      job_name: "tennis-props-sync", status: "completed",
      started_at: now.toISOString(), completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(), result,
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    log(`❌ Fatal: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
