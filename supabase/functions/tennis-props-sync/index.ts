import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// tennis-props-sync (v2 — broad prop_type search + diagnostics)
//
// Queries unified_props with NO prop_type filter first, logs all unique
// prop_types found, then filters against 10+ known tennis-games variants.
// Falls back to any prop with line 10–60. Self-heals player stats from
// settled tennis_match_model records.
//
// Uses actual DB columns:
//   unified_props: game_description (not event_description), current_line (not line)
//   tennis_player_stats: player_name, surface, games_won, games_lost, etc.
//   tennis_match_model: player_a, player_b, tour, surface, etc.
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

function normName(s: string): string {
  return (s || "").toLowerCase().replace(/[.']/g, "").replace(/\s+/g, " ").trim();
}

const TENNIS_GAMES_PROP_TYPES = new Set([
  "total games", "total_games", "games", "game total", "games played",
  "total games played", "alternate total games", "games (sets)",
  "fantasy_score", "player_total_games", "match_total_games",
  "totals", "total",
]);

const TENNIS_SPORT_KEYS = [
  "tennis_atp", "tennis_wta", "tennis", "tennis_atp_singles", "tennis_wta_singles",
];

function parseMatchup(desc: string): [string, string] | null {
  const m = (desc || "").match(/^(.+?)\s+(?:vs?\.?)\s+(.+?)(?:\s*[-–—]\s*.+)?$/i);
  return m ? [m[1].trim(), m[2].trim()] : null;
}

function inferTour(sport: string): "ATP" | "WTA" | null {
  const s = (sport || "").toLowerCase();
  if (s.includes("wta")) return "WTA";
  if (s.includes("atp")) return "ATP";
  return null;
}

function inferTourFromLine(line: number): "ATP" | "WTA" {
  return line < 28 ? "WTA" : "ATP";
}

function detectSurface(desc: string): string {
  const t = (desc || "").toLowerCase();
  if (t.includes("roland garros") || t.includes("clay") || t.includes("french open") ||
      t.includes("monte") || t.includes("madrid") || t.includes("rome") ||
      t.includes("barcelona")) return "clay";
  if (t.includes("wimbledon") || t.includes("grass") || t.includes("queen") ||
      t.includes("halle")) return "grass";
  if (t.includes("indoor") || t.includes("rotterdam") || t.includes("sofia")) return "indoor_hard";
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

  try {
    log(`=== Tennis Props Sync — ${today} ===`);

    // 1. BROAD query — all tennis props regardless of prop_type
    // unified_props uses game_description, not event_description
    const { data: allTennisProps, error: propsErr } = await supabase
      .from("unified_props")
      .select("id, player_name, prop_type, current_line, over_price, under_price, bookmaker, event_id, game_description, sport, commence_time")
      .gte("commence_time", `${today}T00:00:00`)
      .in("sport", TENNIS_SPORT_KEYS);

    if (propsErr) {
      // Fallback to ilike
      const { data: fallback, error: fbErr } = await supabase
        .from("unified_props")
        .select("id, player_name, prop_type, current_line, over_price, under_price, bookmaker, event_id, game_description, sport, commence_time")
        .gte("commence_time", `${today}T00:00:00`)
        .ilike("sport", "%tennis%");

      if (fbErr) throw new Error(`Tennis props fetch: ${fbErr.message}`);
      if (!fallback || fallback.length === 0) {
        const result = { success: true, tennis_props_found: 0, matches_synced: 0, reason: "No tennis props today" };
        await supabase.from("cron_job_history").insert({
          job_name: "tennis-props-sync", status: "completed",
          started_at: now.toISOString(), completed_at: new Date().toISOString(),
          duration_ms: Date.now() - now.getTime(), result,
        });
        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      (allTennisProps as any[]).push(...fallback);
    }

    const totalFound = (allTennisProps || []).length;
    log(`Total tennis props found: ${totalFound}`);

    // 2. Diagnostic: log unique prop_types and sport keys
    const propTypesFound = [...new Set((allTennisProps || []).map((p: any) => p.prop_type).filter(Boolean))];
    const sportKeysFound = [...new Set((allTennisProps || []).map((p: any) => p.sport).filter(Boolean))];
    log(`Sport keys: ${sportKeysFound.join(", ")}`);
    log(`Prop types: ${propTypesFound.join(", ")}`);

    if (totalFound === 0) {
      const result = { success: true, tennis_props_found: 0, sport_keys_seen: sportKeysFound, prop_types_seen: propTypesFound, matches_synced: 0 };
      await supabase.from("cron_job_history").insert({
        job_name: "tennis-props-sync", status: "completed",
        started_at: now.toISOString(), completed_at: new Date().toISOString(),
        duration_ms: Date.now() - now.getTime(), result,
      });
      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3. Filter to total-games props
    const totalGamesProps = (allTennisProps || []).filter((p: any) => {
      const pt = (p.prop_type || "").toLowerCase().trim();
      return TENNIS_GAMES_PROP_TYPES.has(pt) || pt.includes("game") || pt.includes("total");
    });

    log(`Total-games props: ${totalGamesProps.length}`);

    // Fallback: any tennis prop with line 10-60 (valid tennis games range)
    const workingProps = totalGamesProps.length > 0
      ? totalGamesProps
      : (allTennisProps || []).filter((p: any) => {
          const line = Number(p.current_line || 0);
          return line > 10 && line < 60;
        });

    log(`Working props: ${workingProps.length}`);

    // 4. De-duplicate by match
    const matchMap = new Map<string, any>();
    for (const prop of workingProps) {
      const line = Number(prop.current_line || 0);
      if (line <= 0) continue;

      const matchup = parseMatchup(prop.game_description || "");
      let matchKey: string;
      if (matchup) {
        matchKey = [normName(matchup[0]), normName(matchup[1])].sort().join("||");
      } else {
        matchKey = prop.event_id || prop.player_name || `unknown_${prop.id}`;
      }

      if (!matchMap.has(matchKey)) {
        matchMap.set(matchKey, { prop, line, matchup });
      }
    }

    log(`Unique matches: ${matchMap.size}`);

    // 5. Load settled tennis_match_model for self-healing stats
    const { data: settledPicks } = await supabase
      .from("tennis_match_model")
      .select("player_a, player_b, tour, surface, actual_total_games, pp_total_games_line, recommended_side, outcome, settled_at")
      .not("outcome", "is", null)
      .not("actual_total_games", "is", null)
      .gte("analysis_date", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]);

    log(`Settled tennis results: ${settledPicks?.length || 0}`);

    // Build per-player avg games from settled history
    const playerAvgGames = new Map<string, { total: number; count: number }>();
    for (const pick of settledPicks || []) {
      const games = Number(pick.actual_total_games);
      if (!games) continue;
      for (const name of [pick.player_a, pick.player_b]) {
        if (!name) continue;
        const key = normName(name);
        if (!playerAvgGames.has(key)) playerAvgGames.set(key, { total: 0, count: 0 });
        const e = playerAvgGames.get(key)!;
        e.total += games;
        e.count++;
      }
    }

    // 6. Sync matches to tennis_match_model
    const modelRows: any[] = [];
    let matchesSynced = 0;

    const GENDER_MOD: Record<string, number> = { ATP: 0.5, WTA: -1.5 };
    const SURFACE_MOD: Record<string, number> = {
      WTA_clay: -0.5, WTA_grass: 0.2, WTA_hard: 0.0,
      ATP_clay: -0.3, ATP_grass: 0.5, ATP_hard: 0.0, ATP_indoor_hard: 0.2,
    };

    for (const [, { prop, line, matchup }] of matchMap) {
      let tour = inferTour(prop.sport || "");
      if (!tour) tour = inferTourFromLine(line);
      const surface = detectSurface(prop.game_description || "");

      let playerA: string, playerB: string;
      if (matchup) {
        [playerA, playerB] = matchup;
      } else if (prop.player_name) {
        playerA = prop.player_name;
        playerB = "TBD";
      } else continue;

      const genderMod = GENDER_MOD[tour] ?? 0;
      const surfaceMod = SURFACE_MOD[`${tour}_${surface}`] ?? 0;
      const fallback = tour === "WTA" ? 20.5 : 38.5;

      // Use settled history for L10 avg if available
      const aHist = playerAvgGames.get(normName(playerA));
      const bHist = playerAvgGames.get(normName(playerB));
      const aL10 = aHist && aHist.count >= 2 ? Math.round((aHist.total / aHist.count) * 10) / 10 : null;
      const bL10 = bHist && bHist.count >= 2 ? Math.round((bHist.total / bHist.count) * 10) / 10 : null;

      let naiveProjection: number;
      if (aL10 !== null && bL10 !== null) naiveProjection = (aL10 + bL10) / 2;
      else if (aL10 !== null) naiveProjection = aL10;
      else if (bL10 !== null) naiveProjection = bL10;
      else naiveProjection = fallback;

      const projected = Math.round((naiveProjection + genderMod + surfaceMod) * 2) / 2;
      const diff = projected - line;
      const edgePct = line > 0 ? Math.abs(diff) / line * 100 : 0;
      const recommendedSide: "over" | "under" = diff > 0 ? "over" : "under";

      modelRows.push({
        analysis_date: today,
        player_a: playerA,
        player_b: playerB,
        tour,
        surface,
        pp_total_games_line: line,
        projected_total_games: projected,
        recommended_side: recommendedSide,
        edge_pct: Math.round(edgePct * 10) / 10,
        gender_modifier: genderMod,
        surface_modifier: surfaceMod,
        player_a_avg_games_l10: aL10,
        player_b_avg_games_l10: bL10,
        confidence_score: (aL10 !== null || bL10 !== null) ? 0.65 : 0.55,
      });

      matchesSynced++;
    }

    if (modelRows.length > 0) {
      const { error: modelErr } = await supabase
        .from("tennis_match_model")
        .upsert(modelRows, { onConflict: "analysis_date,player_a,player_b,tour" });
      if (modelErr) log(`⚠ Model upsert error: ${modelErr.message}`);
      else log(`Synced ${modelRows.length} matches to tennis_match_model`);
    }

    // 7. Write qualifying picks (edge ≥ 3%) to category_sweet_spots
    const MIN_EDGE = 3.0;
    const qualifyingRows = modelRows.filter(r => r.edge_pct >= MIN_EDGE);

    if (qualifyingRows.length > 0) {
      await supabase.from("category_sweet_spots")
        .delete().eq("analysis_date", today)
        .in("category", ["TENNIS_GAMES_OVER", "TENNIS_GAMES_UNDER"]);

      const sweetSpots = qualifyingRows.map(r => ({
        analysis_date: today,
        player_name: `${r.player_a} vs ${r.player_b}`,
        prop_type: "total_games",
        category: r.recommended_side === "over" ? "TENNIS_GAMES_OVER" : "TENNIS_GAMES_UNDER",
        recommended_side: r.recommended_side,
        recommended_line: r.pp_total_games_line,
        actual_line: r.pp_total_games_line,
        confidence_score: r.confidence_score,
        l10_avg: r.projected_total_games,
        l10_median: r.projected_total_games,
        is_active: true,
        risk_level: r.edge_pct >= 8 ? "LOW" : r.edge_pct >= 5 ? "MEDIUM" : "HIGH",
        recommendation: `${r.recommended_side.toUpperCase()} ${r.pp_total_games_line} total games — ${r.edge_pct.toFixed(1)}% edge`,
        projection_source: "TENNIS_SYNC_MODEL",
        eligibility_type: "TENNIS_MATCH",
      }));

      const { error: ssErr } = await supabase.from("category_sweet_spots").insert(sweetSpots);
      if (ssErr) log(`⚠ Sweet spots error: ${ssErr.message}`);
      else log(`Inserted ${sweetSpots.length} tennis picks`);
    }

    // 8. Telegram
    const telegramLines = [
      `🎾 *Tennis Props Sync — ${today}*`,
      `Found: ${totalFound} props | Matches: ${matchesSynced} | Picks: ${qualifyingRows.length}`,
      `Sports: ${sportKeysFound.join(", ") || "none"}`,
      `Prop types: ${propTypesFound.slice(0, 5).join(", ")}`,
    ];
    if (qualifyingRows.length > 0) {
      telegramLines.push("", "📊 *Picks:*");
      for (const r of qualifyingRows.slice(0, 5)) {
        telegramLines.push(`• ${r.player_a} vs ${r.player_b} — ${r.recommended_side.toUpperCase()} ${r.pp_total_games_line} | Edge: ${r.edge_pct.toFixed(1)}%`);
      }
    }
    await supabase.functions.invoke("bot-send-telegram", {
      body: { message: telegramLines.join("\n"), parse_mode: "Markdown", admin_only: true },
    }).catch(() => {});

    const result = {
      success: true,
      tennis_props_found: totalFound,
      sport_keys_seen: sportKeysFound,
      prop_types_seen: propTypesFound,
      matches_synced: matchesSynced,
      picks_qualifying: qualifyingRows.length,
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
