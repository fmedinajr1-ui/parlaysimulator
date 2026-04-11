import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// hrb-nrfi-scanner  (v2 — pitcher-quality model)
//
// Cross-references actual pitcher quality from mlb_player_game_logs
// instead of arbitrary odds windows. Models NRFI probability from
// ERA, K rate, and walk rate of both starters.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SPORT = "baseball_mlb";
const MIN_EDGE_PCT = 3.0;

function getEasternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function normName(s: string): string {
  return (s || "").toLowerCase().replace(/[.']/g, "").replace(/\s+/g, " ").trim();
}

function americanToImplied(odds: number): number {
  if (odds >= 100) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

// Model pitcher NRFI hold rate from real game log stats
function modelPitcherNrfiRate(stats: {
  era: number; kPer9: number; bbPerStart: number; gamesPlayed: number;
}): number {
  const BASE = 0.65;
  const eraMod = stats.era < 2.50 ? 0.10 : stats.era < 3.00 ? 0.07
    : stats.era < 3.50 ? 0.04 : stats.era < 4.00 ? 0.00
    : stats.era < 4.50 ? -0.04 : stats.era < 5.00 ? -0.08 : -0.12;
  const kMod = stats.kPer9 >= 10.0 ? 0.06 : stats.kPer9 >= 8.5 ? 0.04
    : stats.kPer9 >= 7.0 ? 0.02 : stats.kPer9 >= 5.5 ? 0.00 : -0.03;
  const bbMod = stats.bbPerStart <= 1.5 ? 0.04 : stats.bbPerStart <= 2.5 ? 0.02
    : stats.bbPerStart <= 3.5 ? 0.00 : stats.bbPerStart <= 4.5 ? -0.04 : -0.08;
  const sampleDiscount = stats.gamesPlayed >= 10 ? 1.0
    : stats.gamesPlayed >= 5 ? 0.8 : stats.gamesPlayed >= 3 ? 0.5 : 0.2;
  const raw = BASE + (eraMod + kMod + bbMod) * sampleDiscount;
  return Math.min(0.88, Math.max(0.40, raw));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const log = (msg: string) => console.log(`[hrb-nrfi] ${msg}`);
  const now = new Date();
  const today = getEasternDate();

  try {
    log(`=== NRFI Scanner — ${today} ===`);

    // 1. Find today's MLB pitcher K props → identifies starters
    const { data: kProps, error: kErr } = await supabase
      .from("unified_props")
      .select("player_name, current_line, game_description, event_id, sport, over_price, under_price, bookmaker")
      .eq("sport", SPORT)
      .in("prop_type", ["pitcher_strikeouts", "strikeouts", "pitcher_ks"])
      .eq("is_active", true)
      .gte("commence_time", `${today}T00:00:00`);

    if (kErr) throw new Error(`K props fetch: ${kErr.message}`);
    log(`Found ${kProps?.length || 0} pitcher K props`);

    // 2. Find NRFI / first-inning props if they exist
    const { data: nrfiProps } = await supabase
      .from("unified_props")
      .select("event_id, game_description, current_line, over_price, under_price, bookmaker, prop_type")
      .eq("sport", SPORT)
      .or("prop_type.ilike.%first_inning%,prop_type.ilike.%nrfi%,prop_type.ilike.%1st_inning%,prop_type.eq.totals_1st_1_innings")
      .gte("commence_time", `${today}T00:00:00`);

    log(`Found ${nrfiProps?.length || 0} explicit NRFI props`);

    // 3. Game totals as fallback signal
    const { data: gameProps } = await supabase
      .from("unified_props")
      .select("event_id, current_line")
      .eq("sport", SPORT)
      .in("prop_type", ["totals", "game_total", "total"])
      .gte("commence_time", `${today}T00:00:00`);

    const gameTotalMap = new Map<string, number>();
    for (const g of gameProps || []) {
      if (g.event_id && g.current_line) gameTotalMap.set(g.event_id, Number(g.current_line));
    }

    // 4. Group K props by game
    const gameStartersMap = new Map<string, {
      gameDesc: string; eventId: string;
      pitchers: { name: string; kLine: number }[];
    }>();

    for (const p of kProps || []) {
      if (!p.event_id) continue;
      if (!gameStartersMap.has(p.event_id)) {
        gameStartersMap.set(p.event_id, {
          gameDesc: p.game_description || "", eventId: p.event_id, pitchers: [],
        });
      }
      gameStartersMap.get(p.event_id)!.pitchers.push({
        name: p.player_name, kLine: Number(p.current_line || 0),
      });
    }

    log(`Games with starters: ${gameStartersMap.size}`);

    // 5. Pull L10 game logs for all starters
    // mlb_player_game_logs has: player_name, innings_pitched, earned_runs,
    // pitcher_strikeouts, pitcher_hits_allowed, walks (as generic walks column)
    const allPitcherNames = new Set<string>();
    for (const [, game] of gameStartersMap) {
      for (const p of game.pitchers) allPitcherNames.add(p.name);
    }

    const pitcherStatsMap = new Map<string, {
      era: number; kPer9: number; bbPerStart: number; gamesPlayed: number;
    }>();

    if (allPitcherNames.size > 0) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const { data: gameLogs } = await supabase
        .from("mlb_player_game_logs")
        .select("player_name, innings_pitched, earned_runs, pitcher_strikeouts, walks, game_date")
        .in("player_name", [...allPitcherNames])
        .gte("game_date", thirtyDaysAgo)
        .not("innings_pitched", "is", null)
        .gt("innings_pitched", 0)
        .order("game_date", { ascending: false });

      // Aggregate per pitcher
      const pitcherAgg = new Map<string, { ips: number[]; ks: number[]; bbs: number[]; ers: number[] }>();
      for (const gl of gameLogs || []) {
        const key = gl.player_name;
        if (!pitcherAgg.has(key)) pitcherAgg.set(key, { ips: [], ks: [], bbs: [], ers: [] });
        const agg = pitcherAgg.get(key)!;
        if (gl.innings_pitched) agg.ips.push(Number(gl.innings_pitched));
        if (gl.earned_runs != null) agg.ers.push(Number(gl.earned_runs));
        if (gl.pitcher_strikeouts != null) agg.ks.push(Number(gl.pitcher_strikeouts));
        if (gl.walks != null) agg.bbs.push(Number(gl.walks));
      }

      for (const [key, agg] of pitcherAgg) {
        const gamesPlayed = agg.ips.length;
        if (gamesPlayed === 0) continue;
        const totalIP = agg.ips.reduce((a, b) => a + b, 0);
        const totalER = agg.ers.reduce((a, b) => a + b, 0);
        const totalK = agg.ks.reduce((a, b) => a + b, 0);
        const totalBB = agg.bbs.reduce((a, b) => a + b, 0);

        pitcherStatsMap.set(key, {
          era: totalIP > 0 ? (totalER / totalIP) * 9 : 4.50,
          kPer9: totalIP > 0 ? (totalK / totalIP) * 9 : 7.0,
          bbPerStart: gamesPlayed > 0 ? totalBB / gamesPlayed : 3.0,
          gamesPlayed,
        });
      }
      log(`Built stats for ${pitcherStatsMap.size} pitchers`);
    }

    // 6. NRFI prop lookup
    const nrfiPropMap = new Map<string, { underOdds: number; overOdds: number }>();
    for (const p of nrfiProps || []) {
      if (!p.event_id) continue;
      const line = Number(p.current_line || 0.5);
      if (line > 1.5) continue;
      nrfiPropMap.set(p.event_id, {
        underOdds: p.under_price || -150,
        overOdds: p.over_price || 130,
      });
    }

    // 7. Analyze each game
    const picks: any[] = [];

    for (const [eventId, game] of gameStartersMap) {
      const sorted = game.pitchers.sort((a, b) => b.kLine - a.kLine);
      const starter1 = sorted[0];
      const starter2 = sorted.length > 1 ? sorted[1] : null;
      if (!starter1) continue;

      const stats1 = pitcherStatsMap.get(starter1.name);
      const stats2 = starter2 ? pitcherStatsMap.get(starter2.name) : null;

      const rate1 = stats1
        ? modelPitcherNrfiRate(stats1)
        : modelPitcherNrfiRate({ era: 4.0, kPer9: starter1.kLine * 1.3, bbPerStart: 2.8, gamesPlayed: 3 });

      const rate2 = starter2
        ? (stats2
          ? modelPitcherNrfiRate(stats2)
          : modelPitcherNrfiRate({ era: 4.0, kPer9: starter2.kLine * 1.3, bbPerStart: 2.8, gamesPlayed: 3 }))
        : 0.65;

      let gameNrfiProb = rate1 * rate2;

      // Game total modifier
      const gameTotal = gameTotalMap.get(eventId);
      if (gameTotal) {
        if (gameTotal <= 7.0) gameNrfiProb = Math.min(0.85, gameNrfiProb * 1.06);
        else if (gameTotal <= 7.5) gameNrfiProb = Math.min(0.85, gameNrfiProb * 1.03);
        else if (gameTotal >= 10.0) gameNrfiProb = gameNrfiProb * 0.95;
      }

      const nrfiProp = nrfiPropMap.get(eventId);
      const marketImplied = nrfiProp ? americanToImplied(nrfiProp.underOdds) : 0.65;

      const edgePct = ((gameNrfiProb - marketImplied) / marketImplied) * 100;
      const side = edgePct > 0 ? "under" : "over";
      const absEdge = Math.abs(edgePct);

      if (absEdge < MIN_EDGE_PCT) continue;

      const s1Info = stats1 ? `ERA ${stats1.era.toFixed(2)}, K/9 ${stats1.kPer9.toFixed(1)}` : `K line ${starter1.kLine}`;
      const s2Info = starter2
        ? (stats2 ? `ERA ${stats2.era.toFixed(2)}, K/9 ${stats2.kPer9.toFixed(1)}` : `K line ${starter2.kLine}`)
        : "unknown";

      picks.push({
        event_id: eventId,
        game_desc: game.gameDesc,
        side,
        nrfi_prob: Math.round(gameNrfiProb * 100) / 100,
        market_implied: Math.round(marketImplied * 100) / 100,
        edge_pct: Math.round(absEdge * 10) / 10,
        confidence: absEdge >= 8 ? 0.78 : absEdge >= 5 ? 0.70 : 0.62,
        pitcher_1: starter1.name, pitcher_1_rate: Math.round(rate1 * 100) / 100,
        pitcher_1_info: s1Info,
        pitcher_2: starter2?.name || "TBD", pitcher_2_rate: Math.round(rate2 * 100) / 100,
        pitcher_2_info: s2Info,
        game_total: gameTotal || null,
        has_explicit_nrfi: !!nrfiProp,
        odds: nrfiProp ? (side === "under" ? nrfiProp.underOdds : nrfiProp.overOdds) : null,
      });
    }

    log(`Picks: ${picks.length} from ${gameStartersMap.size} games`);

    // 8. Write to category_sweet_spots
    if (picks.length > 0) {
      await supabase.from("category_sweet_spots")
        .delete().eq("analysis_date", today)
        .in("category", ["MLB_NRFI", "MLB_YRFI"]);

      const rows = picks.map(p => ({
        analysis_date: today,
        player_name: p.game_desc,
        prop_type: "nrfi",
        category: p.side === "under" ? "MLB_NRFI" : "MLB_YRFI",
        recommended_side: p.side,
        recommended_line: 0.5,
        actual_line: 0.5,
        confidence_score: p.confidence,
        l10_avg: p.nrfi_prob,
        is_active: true,
        risk_level: p.edge_pct >= 8 ? "LOW" : p.edge_pct >= 5 ? "MEDIUM" : "HIGH",
        recommendation: `${p.side === "under" ? "NRFI" : "YRFI"} — ${p.pitcher_1} (${(p.pitcher_1_rate * 100).toFixed(0)}%) + ${p.pitcher_2} (${(p.pitcher_2_rate * 100).toFixed(0)}%) | Edge: ${p.edge_pct.toFixed(1)}%`,
        projection_source: "NRFI_PITCHER_MODEL",
        eligibility_type: "MLB_FIRST_INNING",
      }));

      const { error: insertErr } = await supabase.from("category_sweet_spots").insert(rows);
      if (insertErr) log(`⚠ Insert error: ${insertErr.message}`);
      else log(`Inserted ${rows.length} NRFI/YRFI picks`);
    }

    // 9. Telegram
    if (picks.length > 0) {
      const lines = [`⚾ *MLB NRFI Scanner — ${picks.length} pick${picks.length !== 1 ? "s" : ""}*`, ""];
      for (const [i, p] of picks.entries()) {
        const label = p.side === "under" ? "NO RUN 1st INNING" : "YES RUN 1st INNING";
        const oddsStr = p.odds ? ` @ ${p.odds > 0 ? "+" : ""}${p.odds}` : "";
        lines.push(`${i + 1}. *${p.game_desc}* — ${label}`);
        lines.push(`   🧊 ${p.pitcher_1} (${p.pitcher_1_info}) + ${p.pitcher_2} (${p.pitcher_2_info})`);
        lines.push(`   📊 Model: ${(p.nrfi_prob * 100).toFixed(0)}% | Market: ${(p.market_implied * 100).toFixed(0)}% | Edge: ${p.edge_pct.toFixed(1)}%${oddsStr}`);
        lines.push("");
      }
      await supabase.functions.invoke("bot-send-telegram", {
        body: { message: lines.join("\n"), parse_mode: "Markdown", admin_only: true },
      }).catch(() => {});
    }

    const result = {
      success: true, picks: picks.length,
      games_scanned: gameStartersMap.size,
      pitchers_profiled: pitcherStatsMap.size,
    };

    await supabase.from("cron_job_history").insert({
      job_name: "hrb-nrfi-scanner", status: "completed",
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
