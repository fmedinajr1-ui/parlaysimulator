import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// hrb-nrfi-scanner  (v2 — pitcher-quality model)
//
// WHY THE OLD VERSION RETURNED 0 PICKS:
//   Filtered NRFI props by American odds in an arbitrary "value" window
//   (e.g., -130 to +110). NRFI markets are always juiced to -150 or heavier,
//   so the window was never satisfied.
//
// NEW APPROACH:
//   1. Find today's MLB starters via pitcher_strikeouts lines in unified_props
//   2. Pull each starter's L10 game logs from mlb_player_game_logs
//   3. Compute per-pitcher NRFI hold rate: % of starts where they allowed 0
//      runs in the 1st inning (proxy: low ERA + high K/9 + low BB/start)
//   4. Combine both starters' hold rates → game NRFI probability
//   5. Compare to market implied probability → emit pick if edge ≥ 3%
//   6. Fallback: if no explicit NRFI props, use game totals (low total → NRFI lean)
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

function getEasternMidnightUtc(): string {
  return `${getEasternDate()}T00:00:00-05:00`;
}

function normName(s: string): string {
  return (s || "").toLowerCase().replace(/[.']/g, "").replace(/\s+/g, " ").trim();
}

function americanToImplied(odds: number): number {
  if (odds >= 100) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

// Parse "Away @ Home" or "Away vs Home" from event_description
function parseTeams(desc: string): { away: string; home: string } | null {
  const m = (desc || "").match(/^(.+?)\s+(?:@|vs?\.?)\s+(.+?)$/i);
  return m ? { away: m[1].trim(), home: m[2].trim() } : null;
}

// Model pitcher NRFI hold rate from game log stats
// Better pitchers (low ERA, high K/9, low walks) hold the 1st inning clean more often
function modelPitcherNrfiRate(stats: {
  era: number;
  kPer9: number;
  bbPerStart: number;
  gamesPlayed: number;
}): number {
  // League average NRFI hold rate is ~65%
  const BASE = 0.65;

  // ERA modifier: sub-3.00 ERA → bonus, above 4.50 → penalty
  const eraMod = stats.era < 2.50 ? 0.10
    : stats.era < 3.00 ? 0.07
    : stats.era < 3.50 ? 0.04
    : stats.era < 4.00 ? 0.00
    : stats.era < 4.50 ? -0.04
    : stats.era < 5.00 ? -0.08
    : -0.12;

  // K/9 modifier: high strikeout pitchers control innings better
  const kMod = stats.kPer9 >= 10.0 ? 0.06
    : stats.kPer9 >= 8.5 ? 0.04
    : stats.kPer9 >= 7.0 ? 0.02
    : stats.kPer9 >= 5.5 ? 0.00
    : -0.03;

  // Walk modifier: wild pitchers let runners on
  const bbMod = stats.bbPerStart <= 1.5 ? 0.04
    : stats.bbPerStart <= 2.5 ? 0.02
    : stats.bbPerStart <= 3.5 ? 0.00
    : stats.bbPerStart <= 4.5 ? -0.04
    : -0.08;

  // Sample size discount: fewer than 5 games → regression to mean
  const sampleDiscount = stats.gamesPlayed >= 10 ? 1.0
    : stats.gamesPlayed >= 5 ? 0.8
    : stats.gamesPlayed >= 3 ? 0.5
    : 0.2;

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
  const todayStartUtc = getEasternMidnightUtc();

  try {
    log(`=== NRFI Scanner — ${today} ===`);

    // ── 1. Find today's MLB pitcher_strikeouts props → identifies starters ──
    const { data: kProps, error: kErr } = await supabase
      .from("unified_props")
      .select("player_name, current_line, line, event_description, event_id, sport, over_price, under_price, bookmaker")
      .eq("sport", SPORT)
      .in("prop_type", ["pitcher_strikeouts", "strikeouts", "pitcher_ks"])
      .eq("is_active", true)
      .gte("commence_time", todayStartUtc);

    if (kErr) throw new Error(`K props fetch: ${kErr.message}`);
    log(`Found ${kProps?.length || 0} pitcher K props (starters)`);

    // ── 2. Find NRFI / first-inning props if they exist ──────────────────
    const { data: nrfiProps } = await supabase
      .from("unified_props")
      .select("event_id, event_description, current_line, over_price, under_price, bookmaker, prop_type")
      .eq("sport", SPORT)
      .or("prop_type.ilike.%first_inning%,prop_type.ilike.%nrfi%,prop_type.ilike.%1st_inning%,prop_type.eq.totals_1st_1_innings")
      .gte("commence_time", todayStartUtc);

    log(`Found ${nrfiProps?.length || 0} explicit NRFI/1st-inning props`);

    // ── 3. Find game totals as fallback (low total → NRFI lean) ──────────
    const { data: gameProps } = await supabase
      .from("unified_props")
      .select("event_id, event_description, current_line, over_price, under_price")
      .eq("sport", SPORT)
      .in("prop_type", ["totals", "game_total", "total"])
      .gte("commence_time", todayStartUtc);

    // Build game total lookup
    const gameTotalMap = new Map<string, number>();
    for (const g of gameProps || []) {
      if (g.event_id && g.current_line) {
        gameTotalMap.set(g.event_id, Number(g.current_line));
      }
    }

    // ── 4. Group pitcher K props by game (event_id) ──────────────────────
    const gameStartersMap = new Map<string, {
      eventDesc: string;
      eventId: string;
      pitchers: { name: string; kLine: number }[];
    }>();

    for (const p of kProps || []) {
      if (!p.event_id) continue;
      if (!gameStartersMap.has(p.event_id)) {
        gameStartersMap.set(p.event_id, {
          eventDesc: p.event_description || "",
          eventId: p.event_id,
          pitchers: [],
        });
      }
      gameStartersMap.get(p.event_id)!.pitchers.push({
        name: p.player_name,
        kLine: Number(p.current_line || p.line || 0),
      });
    }

    log(`Games with identified starters: ${gameStartersMap.size}`);

    // ── 5. Pull L10 game logs for all identified starters ────────────────
    const allPitcherNames = new Set<string>();
    for (const [, game] of gameStartersMap) {
      for (const p of game.pitchers) allPitcherNames.add(normName(p.name));
    }

    const pitcherStatsMap = new Map<string, {
      era: number; kPer9: number; bbPerStart: number; gamesPlayed: number;
    }>();

    if (allPitcherNames.size > 0) {
      // Query mlb_player_game_logs for these pitchers' recent stats
      const { data: gameLogs } = await supabase
        .from("mlb_player_game_logs")
        .select("player_name, stat_type, stat_value, game_date")
        .in("player_name", [...allPitcherNames])
        .gte("game_date", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
        .order("game_date", { ascending: false });

      // Also try case-insensitive match if direct match fails
      const { data: gameLogsAlt } = await supabase
        .from("mlb_player_game_logs")
        .select("player_name, stat_type, stat_value, game_date")
        .gte("game_date", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
        .order("game_date", { ascending: false })
        .limit(500);

      // Merge both queries
      const allLogs = [...(gameLogs || []), ...(gameLogsAlt || [])];

      // Aggregate per pitcher
      const pitcherAgg = new Map<string, { ips: number[]; ks: number[]; bbs: number[]; ers: number[]; starts: number }>();
      for (const gl of allLogs) {
        const key = normName(gl.player_name);
        if (!allPitcherNames.has(key)) continue;

        if (!pitcherAgg.has(key)) pitcherAgg.set(key, { ips: [], ks: [], bbs: [], ers: [], starts: 0 });
        const agg = pitcherAgg.get(key)!;

        const st = (gl.stat_type || "").toLowerCase();
        const val = Number(gl.stat_value || 0);

        if (st.includes("ip") || st.includes("innings")) agg.ips.push(val);
        if (st.includes("strikeout") || st === "k" || st === "ks" || st === "so") agg.ks.push(val);
        if (st.includes("walk") || st === "bb") agg.bbs.push(val);
        if (st.includes("earned") || st === "er") agg.ers.push(val);
        if (st.includes("start") || st.includes("game")) agg.starts++;
      }

      for (const [key, agg] of pitcherAgg) {
        const gamesPlayed = Math.max(1, Math.floor(agg.starts / 4)); // rough games (each game has ~4 stat rows)
        const totalIP = agg.ips.reduce((a, b) => a + b, 0) || gamesPlayed * 5.5;
        const totalER = agg.ers.reduce((a, b) => a + b, 0);
        const totalK = agg.ks.reduce((a, b) => a + b, 0);
        const totalBB = agg.bbs.reduce((a, b) => a + b, 0);

        const era = totalIP > 0 ? (totalER / totalIP) * 9 : 4.50;
        const kPer9 = totalIP > 0 ? (totalK / totalIP) * 9 : 7.0;
        const bbPerStart = gamesPlayed > 0 ? totalBB / gamesPlayed : 3.0;

        pitcherStatsMap.set(key, { era, kPer9, bbPerStart, gamesPlayed });
      }

      log(`Built stats for ${pitcherStatsMap.size} pitchers from game logs`);
    }

    // ── 6. Build NRFI prop lookup ────────────────────────────────────────
    const nrfiPropMap = new Map<string, { underOdds: number; overOdds: number; line: number }>();
    for (const p of nrfiProps || []) {
      if (!p.event_id) continue;
      const line = Number(p.current_line || 0.5);
      if (line > 1.5) continue; // only care about 0.5 lines
      nrfiPropMap.set(p.event_id, {
        underOdds: p.under_price || -150,
        overOdds: p.over_price || 130,
        line,
      });
    }

    // ── 7. Analyze each game ─────────────────────────────────────────────
    const picks: any[] = [];

    for (const [eventId, game] of gameStartersMap) {
      // Get the two starters with highest K lines (most likely actual starters)
      const sorted = game.pitchers.sort((a, b) => b.kLine - a.kLine);
      const starter1 = sorted[0];
      const starter2 = sorted.length > 1 ? sorted[1] : null;

      if (!starter1) continue;

      // Get pitcher stats
      const stats1 = pitcherStatsMap.get(normName(starter1.name));
      const stats2 = starter2 ? pitcherStatsMap.get(normName(starter2.name)) : null;

      // Model NRFI hold rate per pitcher
      const rate1 = stats1
        ? modelPitcherNrfiRate(stats1)
        : modelPitcherNrfiRate({ era: 4.0, kPer9: starter1.kLine * 1.3, bbPerStart: 2.8, gamesPlayed: 3 });

      const rate2 = starter2
        ? (stats2
          ? modelPitcherNrfiRate(stats2)
          : modelPitcherNrfiRate({ era: 4.0, kPer9: starter2.kLine * 1.3, bbPerStart: 2.8, gamesPlayed: 3 }))
        : 0.65; // league average if we only have one starter

      // Game NRFI probability = both pitchers hold the 1st inning
      let gameNrfiProb = rate1 * rate2;

      // Game total modifier: very low total (≤7.5) → boost NRFI probability
      const gameTotal = gameTotalMap.get(eventId);
      if (gameTotal) {
        if (gameTotal <= 7.0) gameNrfiProb = Math.min(0.85, gameNrfiProb * 1.06);
        else if (gameTotal <= 7.5) gameNrfiProb = Math.min(0.85, gameNrfiProb * 1.03);
        else if (gameTotal >= 10.0) gameNrfiProb = gameNrfiProb * 0.95;
      }

      // Market implied probability
      const nrfiProp = nrfiPropMap.get(eventId);
      let marketImplied: number;
      if (nrfiProp) {
        marketImplied = americanToImplied(nrfiProp.underOdds);
      } else {
        // No explicit NRFI prop — use default market implied (~65%)
        marketImplied = 0.65;
      }

      // Edge calculation
      const edgePct = ((gameNrfiProb - marketImplied) / marketImplied) * 100;

      // Determine side: positive edge → NRFI (under), negative edge → YRFI (over)
      const side = edgePct > 0 ? "under" : "over";
      const absEdge = Math.abs(edgePct);

      if (absEdge < MIN_EDGE_PCT) {
        log(`SKIP ${game.eventDesc}: edge ${edgePct.toFixed(1)}%`);
        continue;
      }

      // Build narrative
      const s1Stats = stats1
        ? `ERA ${stats1.era.toFixed(2)}, K/9 ${stats1.kPer9.toFixed(1)}`
        : `K line ${starter1.kLine}`;
      const s2Stats = starter2
        ? (stats2
          ? `ERA ${stats2.era.toFixed(2)}, K/9 ${stats2.kPer9.toFixed(1)}`
          : `K line ${starter2.kLine}`)
        : "unknown";

      const narrative = side === "under"
        ? `🧊 ${starter1.name} (${s1Stats}) + ${starter2?.name || "TBD"} (${s2Stats}) = ${(gameNrfiProb * 100).toFixed(0)}% NRFI prob vs ${(marketImplied * 100).toFixed(0)}% market`
        : `🔥 Pitchers project ${((1 - gameNrfiProb) * 100).toFixed(0)}% YRFI vs ${((1 - marketImplied) * 100).toFixed(0)}% market`;

      const confidence = absEdge >= 8 ? 0.78
        : absEdge >= 5 ? 0.70
        : 0.62;

      picks.push({
        event_id: eventId,
        event_description: game.eventDesc,
        side,
        nrfi_prob: Math.round(gameNrfiProb * 100) / 100,
        market_implied: Math.round(marketImplied * 100) / 100,
        edge_pct: Math.round(absEdge * 10) / 10,
        confidence,
        pitcher_1: starter1.name,
        pitcher_1_rate: Math.round(rate1 * 100) / 100,
        pitcher_2: starter2?.name || "TBD",
        pitcher_2_rate: Math.round(rate2 * 100) / 100,
        game_total: gameTotal || null,
        has_explicit_nrfi: !!nrfiProp,
        odds: nrfiProp ? (side === "under" ? nrfiProp.underOdds : nrfiProp.overOdds) : null,
        narrative,
      });
    }

    log(`Picks: ${picks.length} from ${gameStartersMap.size} games`);

    // ── 8. Write to category_sweet_spots ──────────────────────────────────
    if (picks.length > 0) {
      await supabase.from("category_sweet_spots")
        .delete().eq("analysis_date", today)
        .in("category", ["MLB_NRFI", "MLB_YRFI"]);

      const rows = picks.map(p => ({
        analysis_date: today,
        player_name: p.event_description,
        prop_type: "nrfi",
        category: p.side === "under" ? "MLB_NRFI" : "MLB_YRFI",
        recommended_side: p.side,
        recommended_line: 0.5,
        actual_line: 0.5,
        confidence_score: p.confidence,
        l10_avg: p.nrfi_prob,
        is_active: true,
        risk_level: p.edge_pct >= 8 ? "LOW" : p.edge_pct >= 5 ? "MEDIUM" : "HIGH",
        recommendation: `${p.side === "under" ? "NRFI" : "YRFI"} — ${p.pitcher_1} (${(p.pitcher_1_rate * 100).toFixed(0)}% hold) + ${p.pitcher_2} (${(p.pitcher_2_rate * 100).toFixed(0)}% hold) | Edge: ${p.edge_pct.toFixed(1)}%`,
        projection_source: "NRFI_PITCHER_MODEL",
        eligibility_type: "MLB_FIRST_INNING",
        signal_factors: JSON.stringify({
          pitcher_1: p.pitcher_1,
          pitcher_1_rate: p.pitcher_1_rate,
          pitcher_2: p.pitcher_2,
          pitcher_2_rate: p.pitcher_2_rate,
          nrfi_prob: p.nrfi_prob,
          market_implied: p.market_implied,
          edge_pct: p.edge_pct,
          game_total: p.game_total,
          has_explicit_nrfi: p.has_explicit_nrfi,
          odds: p.odds,
        }),
      }));

      const { error: insertErr } = await supabase.from("category_sweet_spots").insert(rows);
      if (insertErr) log(`⚠ Insert error: ${insertErr.message}`);
      else log(`Inserted ${rows.length} NRFI/YRFI sweet spots`);
    }

    // ── 9. Telegram alert ────────────────────────────────────────────────
    if (picks.length > 0) {
      const lines = [`⚾ *MLB NRFI Scanner — ${picks.length} pick${picks.length !== 1 ? "s" : ""}*`, ""];
      for (const [i, p] of picks.entries()) {
        const label = p.side === "under" ? "NO RUN 1st INNING" : "YES RUN 1st INNING";
        const emoji = p.side === "under" ? "🧊" : "🔥";
        const oddsStr = p.odds ? ` @ ${p.odds > 0 ? "+" : ""}${p.odds}` : "";
        lines.push(`${i + 1}. ${emoji} *${p.event_description}* — ${label}`);
        lines.push(`   ${p.narrative}`);
        lines.push(`   📊 Model: ${(p.nrfi_prob * 100).toFixed(0)}% | Market: ${(p.market_implied * 100).toFixed(0)}% | Edge: ${p.edge_pct.toFixed(1)}%${oddsStr}`);
        lines.push(`   ${p.game_total ? `Game total: ${p.game_total} | ` : ""}Confidence: ${(p.confidence * 100).toFixed(0)}%`);
        lines.push("");
      }
      await supabase.functions.invoke("bot-send-telegram", {
        body: { message: lines.join("\n"), parse_mode: "Markdown", admin_only: true },
      }).catch(() => {});
    }

    const result = {
      success: true,
      picks: picks.length,
      games_scanned: gameStartersMap.size,
      pitchers_profiled: pitcherStatsMap.size,
      explicit_nrfi_props: nrfiPropMap.size,
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
