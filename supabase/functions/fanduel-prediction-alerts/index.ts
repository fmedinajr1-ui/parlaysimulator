import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── ACCURACY-DRIVEN SIGNAL GATES ──
// Historical accuracy badges are now DYNAMIC — queried from fanduel_prediction_accuracy
// Priority tiers: P0 (perfect_line/scale_in) → P5 (velocity_spike) → P6 (cascade)
// All signal types are now ACTIVE — velocity_spike and cascade fully restored

const KILLED_VELOCITY_MARKETS = new Set(["spreads", "totals"]);
const PLAYER_PROP_TYPES = new Set([
  "player_points", "player_rebounds", "player_assists", "player_threes",
  "player_steals", "player_blocks", "player_turnovers",
  "player_points_rebounds_assists", "player_rebounds_assists",
  "player_points_assists", "player_points_rebounds",
  "player_fantasy_score", "player_double_double",
]);

function isPlayerPropType(propType: string): boolean {
  return PLAYER_PROP_TYPES.has(propType) || propType.startsWith("player_");
}

function isKilledSignal(signalType: string, propType: string, _direction?: string): boolean {
  // Gate velocity_spike on Spreads/Totals — 1-13 combined (7.7% accuracy)
  if (signalType === "velocity_spike" && KILLED_VELOCITY_MARKETS.has(propType)) return true;
  
  // KILL velocity_spike and line_about_to_move on ALL player props — toxic signals
  // FanDuel inflates player prop lines to trap public OVER bettors
  if (isPlayerPropType(propType)) {
    if (signalType === "velocity_spike" || signalType === "live_velocity_spike") return true;
    if (signalType === "line_about_to_move" || signalType === "live_line_about_to_move") return true;
  }
  
  return false;
}

const COMBO_PROPS = new Set([
  "player_points_rebounds_assists", "player_rebounds_assists",
  "player_points_assists", "player_points_rebounds",
]);
const CONTRARIAN_PROPS = new Set(["player_points", "player_threes"]);
const TEAM_MARKET_TYPES = new Set(["h2h", "moneyline", "spreads", "totals"]);

// Priority tiers for alert ordering (lower = sent first)
function getSignalPriority(record: any): number {
  const { signal_type, prop_type, predicted_direction } = record;
  // P0: perfect_line AND scale_in — matchup-based mispricing (highest priority)
  if (signal_type?.startsWith("perfect_line")) return 0;
  if (signal_type?.startsWith("scale_in")) return 0;
  // P1: take_it_now rebounds (95%) + spreads (94.9%)
  if (signal_type === "take_it_now" && (prop_type === "player_rebounds" || prop_type === "spreads")) return 1;
  // P2: combo props (85-100%)
  if (COMBO_PROPS.has(prop_type)) return 2;
  // P3: line_about_to_move points rising (75% w/ contrarian flip)
  if (signal_type === "line_about_to_move" && prop_type === "player_points") return 3;
  // P4: take_it_now moneyline (63.2%)
  if (signal_type === "take_it_now" && prop_type === "moneyline") return 4;
  // P5: velocity_spike (all markets)
  if (signal_type === "velocity_spike") return 5;
  // P6: take_it_now other props
  if (signal_type === "take_it_now") return 6;
  // P7: cascade
  if (signal_type === "cascade") return 7;
  // P8: everything else
  return 8;
}
// Minimum velocity gates by prop — lowered for faster detection
const PROP_MIN_VELOCITY: Record<string, number> = {
  player_points: 1.0,
  player_rebounds: 0.8,
  player_threes: 0.8,
  player_points_rebounds_assists: 0.8,
  player_rebounds_assists: 0.8,
  player_points_assists: 0.8,
  player_points_rebounds: 0.8,
};

// Minimum drift gates for take_it_now — lowered for earlier alerts
const PROP_MIN_DRIFT_PCT: Record<string, number> = {
  player_rebounds: 4,
  player_points: 4,
  player_threes: 5,
};

// Format American odds for display
function fmtOdds(price: number | null | undefined): string {
  if (!price) return "";
  return price > 0 ? `+${price}` : `${price}`;
}

// Build the FanDuel line badge with odds
function fdLineBadge(line: number, overPrice: number | null, underPrice: number | null, side: string, propType?: string): string {
  const isMoneyline = propType === "moneyline" || propType === "h2h";
  if (isMoneyline) {
    // For moneyline, line IS the odds — show it directly
    return `📗 *FanDuel Odds: ${fmtOdds(line)}*`;
  }
  const actionOdds = side === "OVER" ? overPrice : underPrice;
  const oddsStr = actionOdds ? ` (${fmtOdds(actionOdds)})` : "";
  return `📗 *FanDuel Line: ${line}${oddsStr}*`;
}

// Check if a prop is a moneyline/h2h market
function isMoneylineProp(propType: string): boolean {
  return propType === "moneyline" || propType === "h2h";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const log = (msg: string) => console.log(`[Prediction Alerts] ${msg}`);
  const now = new Date();

  // ====== OWNER RULES ENGINE — load rules for this function ======
  let ownerRules: Array<{ rule_key: string; rule_logic: Record<string, unknown>; enforcement: string }> = [];
  try {
    const { data: rulesData } = await supabase
      .from("bot_owner_rules")
      .select("rule_key, rule_logic, enforcement")
      .eq("is_active", true)
      .contains("applies_to", ["fanduel-prediction-alerts"]);
    ownerRules = (rulesData || []) as any;
    if (ownerRules.length > 0) log(`Loaded ${ownerRules.length} owner rules`);
  } catch (_) { /* rules are advisory */ }

  try {
    log("=== Generating FanDuel prediction alerts (accuracy-gated v2) ===");

    const thirtyMinAgo = new Date(now.getTime() - 20 * 60 * 1000).toISOString(); // 20min window for faster detection
    const { data: recentData, error: fetchErr } = await supabase
      .from("fanduel_line_timeline")
      .select("*")
      .gte("snapshot_time", thirtyMinAgo)
      .order("snapshot_time", { ascending: true })
      .limit(3000);

    if (fetchErr) throw new Error(`Timeline fetch: ${fetchErr.message}`);

    const { data: patterns } = await supabase
      .from("fanduel_behavior_patterns")
      .select("*")
      .gte("sample_size", 3);

    // ── Dynamic accuracy lookup from verified predictions ──
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: accuracyRows } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("signal_type, prop_type, was_correct")
      .not("was_correct", "is", null)
      .gte("created_at", thirtyDaysAgo);

    const accuracyMap = new Map<string, { correct: number; total: number }>();
    for (const row of accuracyRows || []) {
      const key = `${row.signal_type}|${row.prop_type}`;
      if (!accuracyMap.has(key)) accuracyMap.set(key, { correct: 0, total: 0 });
      const b = accuracyMap.get(key)!;
      b.total++;
      if (row.was_correct) b.correct++;
    }

    function dynamicAccBadge(signalType: string, propType: string): string {
      const key = `${signalType}|${propType}`;
      const stats = accuracyMap.get(key);
      if (!stats || stats.total < 5) return "";
      const pct = ((stats.correct / stats.total) * 100).toFixed(1);
      const emoji = stats.correct / stats.total >= 0.6 ? "🔥" : stats.correct / stats.total >= 0.5 ? "📈" : "⚠️";
      return `${emoji} Historical: ${pct}% (${stats.correct}/${stats.total} verified)`;
    }

    // ── 70% ACCURACY GATE — block any signal+prop combo below 70% with sufficient data ──
    const ACCURACY_GATE_MIN_SAMPLES = 10;
    const ACCURACY_GATE_THRESHOLD = 0.70;
    // ── FLIP LOGIC: if a signal consistently loses (<40%, n>=15), flip the side ──
    const FLIP_MIN_SAMPLES = 15;
    const FLIP_THRESHOLD = 0.40; // must be consistently on the downside
    // Force-flip props with extreme downside (skip L10 validation)
    const FORCE_FLIP_THRESHOLD = 0.35; // <35% accuracy
    const FORCE_FLIP_MIN_SAMPLES = 50; // need strong evidence
    const FORCE_FLIP_PROP_TYPES = new Set(["player_rebounds", "player_assists", "player_rebounds_assists"]);
    function isAccuracyGated(signalType: string, propType: string): boolean {
      const key = `${signalType}|${propType}`;
      const stats = accuracyMap.get(key);
      if (!stats || stats.total < ACCURACY_GATE_MIN_SAMPLES) return false; // not enough data, allow through
      const rate = stats.correct / stats.total;
      if (rate < ACCURACY_GATE_THRESHOLD) {
        log(`🚫 ACCURACY GATE: ${signalType}|${propType} blocked (${(rate*100).toFixed(1)}% < 70%, n=${stats.total})`);
        return true;
      }
      return false;
    }
    function shouldFlip(signalType: string, propType: string): { flip: boolean; winRate: number; samples: number } {
      const key = `${signalType}|${propType}`;
      const stats = accuracyMap.get(key);
      if (!stats || stats.total < FLIP_MIN_SAMPLES) return { flip: false, winRate: 0, samples: 0 };
      const rate = stats.correct / stats.total;
      if (rate < FLIP_THRESHOLD) {
        log(`🔄 FLIP CANDIDATE: ${signalType}|${propType} (${(rate*100).toFixed(1)}% win rate, n=${stats.total}) — consistent downside`);
        return { flip: true, winRate: rate, samples: stats.total };
      }
      return { flip: false, winRate: rate, samples: stats.total };
    }
    function flipSide(side: string): string {
      return side === "OVER" ? "UNDER" : side === "UNDER" ? "OVER" : side === "BACK" ? "FADE" : side === "FADE" ? "BACK" : side;
    }
    function flipPrediction(prediction: string): string {
      if (prediction.startsWith("OVER")) return prediction.replace("OVER", "UNDER");
      if (prediction.startsWith("UNDER")) return prediction.replace("UNDER", "OVER");
      if (prediction.startsWith("BACK")) return prediction.replace("BACK", "FADE");
      if (prediction.startsWith("FADE")) return prediction.replace("FADE", "BACK");
      return prediction;
    }

    if (!recentData || recentData.length === 0) {
      log("No recent data for alerts");
      return new Response(JSON.stringify({ success: true, alerts: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Exclude FINISHED games only (hours_to_tip <= -3)
    const activeData = recentData.filter((r: any) =>
      typeof r.hours_to_tip !== "number" || r.hours_to_tip > -3
    );
    log(`Filtered to ${activeData.length} active records (excluded ${recentData.length - activeData.length} finished)`);

    if (activeData.length === 0) {
      return new Response(JSON.stringify({ success: true, alerts: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const groups = new Map<string, any[]>();
    for (const row of activeData) {
      const key = `${row.event_id}|${row.player_name}|${row.prop_type}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    // ══════════════════════════════════════════════════════════════
    // MATCHUP CROSS-REFERENCE GATE — validate lines before alerting
    // ══════════════════════════════════════════════════════════════
    const STAT_FIELD_MAP: Record<string, string> = {
      player_points: "points",
      player_rebounds: "rebounds",
      player_assists: "assists",
      player_threes: "threes_made",
      pitcher_strikeouts: "pitcher_strikeouts",
      pitcher_outs: "pitcher_outs",
    };
    // For combo props, sum these fields
    const COMBO_STAT_FIELDS: Record<string, string[]> = {
      player_points_rebounds_assists: ["points", "rebounds", "assists"],
      player_points_rebounds: ["points", "rebounds"],
      player_points_assists: ["points", "assists"],
      player_rebounds_assists: ["rebounds", "assists"],
    };

    // MLB prop types that need mlb_player_game_logs
    const MLB_PROP_TYPES = new Set([
      "pitcher_strikeouts", "pitcher_outs", "pitcher_hits_allowed", "pitcher_earned_runs",
      "hits", "total_bases", "runs", "rbis", "stolen_bases", "batter_home_runs",
      "batter_hits", "batter_rbis", "batter_runs_scored", "batter_total_bases",
      "batter_stolen_bases", "batter_walks",
    ]);

    const allPlayerNames = [...new Set(
      activeData
        .filter((r: any) => !TEAM_MARKET_TYPES.has(r.prop_type))
        .map((r: any) => r.player_name)
        .filter(Boolean)
    )];

    // Identify MLB players (pitcher/batter props)
    const mlbPlayerNames = [...new Set(
      activeData
        .filter((r: any) => MLB_PROP_TYPES.has(r.prop_type))
        .map((r: any) => r.player_name)
        .filter(Boolean)
    )];

    // Fetch L10 game logs + matchup history for all players in parallel
    const [l10LogsRes, matchupHistRes, mlbLogsRes] = await Promise.all([
      allPlayerNames.length > 0
        ? supabase
            .from("nba_player_game_logs")
            .select("player_name, opponent, game_date, points, rebounds, assists, threes_made")
            .in("player_name", allPlayerNames)
            .order("game_date", { ascending: false })
            .limit(5000)
        : Promise.resolve({ data: [] }),
      allPlayerNames.length > 0
        ? supabase
            .from("matchup_history")
            .select("player_name, opponent, prop_type, avg_stat, hit_rate_over, hit_rate_under, games_played, min_stat, max_stat")
            .in("player_name", allPlayerNames)
        : Promise.resolve({ data: [] }),
      mlbPlayerNames.length > 0
        ? supabase
            .from("mlb_player_game_logs")
            .select("player_name, opponent, game_date, pitcher_strikeouts, innings_pitched, hits, runs, rbis, total_bases, home_runs, stolen_bases, walks, strikeouts, earned_runs, pitcher_hits_allowed, at_bats")
            .in("player_name", mlbPlayerNames)
            .order("game_date", { ascending: false })
            .limit(mlbPlayerNames.length * 15)
        : Promise.resolve({ data: [] }),
    ]);

    // Build L10 lookup: player → last 10 game stats
    const playerL10 = new Map<string, any[]>();
    for (const gl of (l10LogsRes.data || [])) {
      const key = gl.player_name?.toLowerCase();
      if (!key) continue;
      if (!playerL10.has(key)) playerL10.set(key, []);
      const arr = playerL10.get(key)!;
      if (arr.length < 10) arr.push(gl);
    }

    // Build MLB L10 + L3 lookup: player → game logs (pitcher stats)
    const MLB_STAT_MAP: Record<string, string> = {
      pitcher_strikeouts: "pitcher_strikeouts",
      pitcher_outs: "pitcher_outs",
      pitcher_hits_allowed: "pitcher_hits_allowed",
      pitcher_earned_runs: "earned_runs",
      hits: "hits", batter_hits: "hits",
      total_bases: "total_bases", batter_total_bases: "total_bases",
      runs: "runs", batter_runs_scored: "runs",
      rbis: "rbis", batter_rbis: "rbis",
      stolen_bases: "stolen_bases", batter_stolen_bases: "stolen_bases",
      batter_home_runs: "home_runs",
      batter_walks: "walks",
    };

    const mlbPlayerLogs = new Map<string, any[]>();
    for (const gl of (mlbLogsRes.data || [])) {
      const key = gl.player_name?.toLowerCase();
      if (!key) continue;
      if (!mlbPlayerLogs.has(key)) mlbPlayerLogs.set(key, []);
      mlbPlayerLogs.get(key)!.push(gl);
    }
    log(`MLB game logs loaded: ${mlbPlayerLogs.size} players`);

    // ══════════════════════════════════════════════════════════════
    // MINUTES VOLATILITY GATE — flag high-CV players across all signals
    // ══════════════════════════════════════════════════════════════
    interface VolatilityInfo { isVolatile: boolean; cv: number; avgMin: number; gamesUsed: number; }
    const volatilityMap = new Map<string, VolatilityInfo>();

    // Fetch L10 minutes from multiple sport game logs
    const sportLogTables = ["nba_player_game_logs", "ncaab_player_game_logs", "nhl_player_game_logs"];
    const minLogResults = await Promise.all(
      sportLogTables.map(table =>
        allPlayerNames.length > 0
          ? supabase.from(table).select("player_name, min").in("player_name", allPlayerNames).order("game_date", { ascending: false }).limit(allPlayerNames.length * 10)
          : Promise.resolve({ data: [] })
      )
    );

    const minByPlayer = new Map<string, number[]>();
    for (const res of minLogResults) {
      for (const row of (res.data || [])) {
        const name = (row.player_name || "").toLowerCase().trim();
        if (!name) continue;
        const mins = typeof row.min === "string" ? parseFloat(row.min) : (row.min ? parseFloat(String(row.min)) : 0);
        if (mins <= 0) continue;
        const existing = minByPlayer.get(name) || [];
        if (existing.length < 10) { existing.push(mins); minByPlayer.set(name, existing); }
      }
    }

    for (const [name, minutes] of minByPlayer) {
      if (minutes.length < 3) {
        volatilityMap.set(name, { isVolatile: false, cv: 0, avgMin: 0, gamesUsed: minutes.length });
        continue;
      }
      const avg = minutes.reduce((a, b) => a + b, 0) / minutes.length;
      const variance = minutes.reduce((s, m) => s + (m - avg) ** 2, 0) / minutes.length;
      const std = Math.sqrt(variance);
      const cv = avg > 0 ? std / avg : 0;
      volatilityMap.set(name, { isVolatile: cv > 0.20, cv, avgMin: avg, gamesUsed: minutes.length });
    }

    const volatileCount = [...volatilityMap.values()].filter(v => v.isVolatile).length;
    log(`Minutes volatility: ${volatilityMap.size} players checked, ${volatileCount} volatile (CV>20%)`);

    // Helper: get volatility warning text for a player
    function getVolatilityWarning(playerName: string): string {
      const v = volatilityMap.get((playerName || "").toLowerCase().trim());
      if (!v || !v.isVolatile) return "";
      return `⚠️ VOLATILE MINUTES — L10 avg ${v.avgMin.toFixed(0)}min (CV ${(v.cv * 100).toFixed(0)}%)`;
    }

    // ── Real Alt Line Fetcher (FanDuel via The Odds API) ──
    const SPORT_KEY_MAP: Record<string, string> = {
      NBA: "basketball_nba", NCAAB: "basketball_ncaab",
      MLB: "baseball_mlb", NHL: "icehockey_nhl", NFL: "americanfootball_nfl",
    };
    const PROP_TO_ALT_KEY: Record<string, string> = {
      player_points: "points", player_rebounds: "rebounds", player_assists: "assists",
      player_threes: "threes", player_points_rebounds_assists: "pra",
      player_points_rebounds: "pts_rebs", player_points_assists: "pts_asts",
      player_rebounds_assists: "rebs_asts", player_steals: "steals",
      player_blocks: "blocks", player_turnovers: "turnovers",
      spreads: "spreads", totals: "totals",
    };

    const altLineCache = new Map<string, { line: number; odds: number } | null>();

    async function fetchRealAltLine(
      eventId: string, playerName: string, propType: string,
      side: string, currentLine: number, sport: string
    ): Promise<{ line: number; odds: number } | null> {
      // Skip moneyline — no alt lines exist
      if (isMoneylineProp(propType)) return null;

      const cacheKey = `${eventId}|${playerName}|${propType}`;
      if (altLineCache.has(cacheKey)) {
        const cached = altLineCache.get(cacheKey)!;
        // Re-pick best line for the requested side from cached data
        return cached;
      }

      const altPropKey = PROP_TO_ALT_KEY[propType];
      if (!altPropKey) { altLineCache.set(cacheKey, null); return null; }

      const sportKey = SPORT_KEY_MAP[sport?.toUpperCase()] || SPORT_KEY_MAP[sport] || "basketball_nba";
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/fetch-alternate-lines`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ eventId, playerName, propType: altPropKey, sport: sportKey }),
        });
        if (!resp.ok) { altLineCache.set(cacheKey, null); return null; }
        const data = await resp.json();
        const lines: { line: number; overOdds: number; underOdds: number }[] = data.lines || [];
        if (lines.length === 0) { altLineCache.set(cacheKey, null); return null; }

        // Pick the best alt line for the side
        const picked = pickBestAltLine(lines, side, currentLine);
        altLineCache.set(cacheKey, picked);
        return picked;
      } catch (e) {
        console.error(`[AltLine] fetch error for ${playerName}:`, e);
        altLineCache.set(cacheKey, null);
        return null;
      }
    }

    function pickBestAltLine(
      lines: { line: number; overOdds: number; underOdds: number }[],
      side: string, currentLine: number
    ): { line: number; odds: number } | null {
      if (side === "OVER") {
        // For OVER, find highest line BELOW current (easier to hit)
        const candidates = lines.filter(l => l.line < currentLine).sort((a, b) => b.line - a.line);
        if (candidates.length > 0) return { line: candidates[0].line, odds: candidates[0].overOdds };
      } else if (side === "UNDER") {
        // For UNDER, find lowest line ABOVE current (easier to hit)
        const candidates = lines.filter(l => l.line > currentLine).sort((a, b) => a.line - b.line);
        if (candidates.length > 0) return { line: candidates[0].line, odds: candidates[0].underOdds };
      }
      return null;
    }

    function fmtAltOdds(odds: number): string {
      return odds > 0 ? `+${odds}` : `${odds}`;
    }

    async function getAltLineText(
      currentLine: number | null, side: string, propType: string,
      playerName: string, eventId: string, sport: string
    ): Promise<string> {
      if (currentLine == null) return "";
      const alt = await fetchRealAltLine(eventId, playerName, propType, side, currentLine, sport);
      if (!alt) return "🎯 Alt Line: unavailable";
      return `🎯 Alt Line (FanDuel): ${side} ${alt.line} (${fmtAltOdds(alt.odds)})`;
    }

    // Build matchup lookup: player|opponent|prop_type → matchup data
    const matchupLookup = new Map<string, any>();
    for (const m of (matchupHistRes.data || [])) {
      matchupLookup.set(
        `${m.player_name.toLowerCase()}|${m.opponent?.toLowerCase()}|${m.prop_type}`,
        m
      );
    }

    /**
     * Cross-reference gate: checks if the player's L10 avg supports the recommended side/line.
     * For MLB pitcher strikeouts: uses mlb_player_game_logs with L3/L10 + vs-opponent matchup.
     * Returns { pass, l10Avg, hitRate, matchupAvg, reason } 
     */
    function crossReferenceGate(playerName: string, propType: string, line: number, side: string, eventDesc: string): {
      pass: boolean; l10Avg: number | null; l10HitRate: number | null; matchupAvg: number | null; reason: string; badge: string;
      l3Avg?: number | null;
    } {
      const pLower = playerName.toLowerCase();
      const noData = { pass: true, l10Avg: null, l10HitRate: null, matchupAvg: null, reason: "no_data", badge: "", l3Avg: null };

      // ── MLB PROPS: use mlb_player_game_logs ──
      const mlbStatCol = MLB_STAT_MAP[propType];
      if (mlbStatCol) {
        const logs = mlbPlayerLogs.get(pLower) || [];
        // For pitcher props, filter to games where they actually pitched
        const isPitcherProp = propType.startsWith("pitcher_");
        const relevantLogs = isPitcherProp
          ? logs.filter((l: any) => l.pitcher_strikeouts != null && l.innings_pitched != null && l.innings_pitched > 0)
          : logs;
        
        if (relevantLogs.length < 3) return noData;

        const l10Logs = relevantLogs.slice(0, 10);
        const l3Logs = relevantLogs.slice(0, 3);
        const l10Values = l10Logs.map((gl: any) => Number(gl[mlbStatCol]) || 0);
        const l3Values = l3Logs.map((gl: any) => Number(gl[mlbStatCol]) || 0);
        const l10Avg = l10Values.reduce((a: number, b: number) => a + b, 0) / l10Values.length;
        const l3Avg = l3Values.reduce((a: number, b: number) => a + b, 0) / l3Values.length;

        // L10 hit rate
        const l10Hits = l10Values.filter((v: number) => side === "OVER" ? v > line : v < line).length;
        const l10HitRate = l10Hits / l10Values.length;

        // Matchup: how this pitcher/batter performs vs this specific opponent
        let matchupAvg: number | null = null;
        let matchupGames = 0;
        const edLower = (eventDesc || "").toLowerCase();
        // Extract opponent from game logs — check which opponent appears in event description
        const oppPerf: number[] = [];
        for (const gl of relevantLogs) {
          const opp = (gl.opponent || "").toLowerCase();
          if (opp && edLower.includes(opp)) {
            oppPerf.push(Number(gl[mlbStatCol]) || 0);
          }
        }
        if (oppPerf.length > 0) {
          matchupAvg = oppPerf.reduce((a, b) => a + b, 0) / oppPerf.length;
          matchupGames = oppPerf.length;
        }

        // Also check matchup_history table
        if (matchupAvg === null) {
          for (const [mKey, m] of matchupLookup) {
            if (!mKey.startsWith(`${pLower}|`)) continue;
            if (!mKey.endsWith(`|${propType}`)) continue;
            const oppName = mKey.split("|")[1];
            const oppWords = oppName.split(/\s+/);
            if (oppWords.some((w: string) => w.length > 3 && edLower.includes(w))) {
              matchupAvg = Number(m.avg_stat);
              matchupGames = Number(m.games_played || 0);
              break;
            }
          }
        }

        // For pitcher K props: also factor in innings pitched context
        let avgIP: number | null = null;
        if (isPitcherProp) {
          const ipValues = l10Logs.map((gl: any) => Number(gl.innings_pitched) || 0);
          avgIP = ipValues.reduce((a: number, b: number) => a + b, 0) / ipValues.length;
        }

        // GATE LOGIC for pitcher strikeouts — tighter than NBA
        const isOver = side === "OVER";
        const avgVsLine = isOver ? l10Avg - line : line - l10Avg;
        const pctEdge = line > 0 ? (avgVsLine / line) * 100 : 0;

        // Hard block: L10 avg goes strongly AGAINST + L3 trend confirms
        if (pctEdge < -10 && l10HitRate < 0.30) {
          return {
            pass: false, l10Avg, l10HitRate, matchupAvg, l3Avg,
            reason: `L10 avg ${l10Avg.toFixed(1)} | L3 avg ${l3Avg.toFixed(1)} — ${(l10HitRate * 100).toFixed(0)}% hit rate vs line ${line}`,
            badge: "",
          };
        }

        // Pitcher K specific: if L3 trend is trending away hard AND matchup doesn't support
        if (isPitcherProp && l3Values.length >= 3) {
          const l3VsLine = isOver ? l3Avg - line : line - l3Avg;
          const l3Edge = line > 0 ? (l3VsLine / line) * 100 : 0;
          if (l3Edge < -15 && (matchupAvg === null || (isOver ? matchupAvg < line : matchupAvg > line))) {
            return {
              pass: false, l10Avg, l10HitRate, matchupAvg, l3Avg,
              reason: `Pitcher K gate: L3 avg ${l3Avg.toFixed(1)} trending away from ${side} ${line} | matchup ${matchupAvg?.toFixed(1) ?? "N/A"}`,
              badge: "",
            };
          }
        }

        // Soft block: both L10 and matchup against the line
        if (pctEdge < -5 && l10HitRate < 0.40 && matchupAvg !== null && (isOver ? matchupAvg < line : matchupAvg > line)) {
          return {
            pass: false, l10Avg, l10HitRate, matchupAvg, l3Avg,
            reason: `L10 avg ${l10Avg.toFixed(1)} + vs opp avg ${matchupAvg.toFixed(1)} both fail vs ${side} ${line}`,
            badge: "",
          };
        }

        // Build rich validation badge
        let badge = `📊 L10 Avg: ${l10Avg.toFixed(1)} | L3 Avg: ${l3Avg.toFixed(1)} | L10 Hit: ${(l10HitRate * 100).toFixed(0)}%`;
        if (matchupAvg !== null) {
          badge += ` | vs Opp: ${matchupAvg.toFixed(1)} (${matchupGames}g)`;
        }
        if (avgIP !== null) {
          badge += ` | Avg IP: ${avgIP.toFixed(1)}`;
        }
        if (l10HitRate >= 0.70) badge += " ✅";
        else if (l10HitRate >= 0.50) badge += " ⚠️";
        else badge += " 🔻";

        return { pass: true, l10Avg, l10HitRate, matchupAvg, reason: "validated", badge, l3Avg };
      }

      // ── NBA/NCAAB PROPS: use nba_player_game_logs (existing logic) ──
      const logs = playerL10.get(pLower) || [];
      if (logs.length < 3) return noData;

      const statFields = COMBO_STAT_FIELDS[propType] || (STAT_FIELD_MAP[propType] ? [STAT_FIELD_MAP[propType]] : null);
      if (!statFields) return noData;

      const l10Values = logs.slice(0, 10).map((gl: any) =>
        statFields.reduce((sum: number, f: string) => sum + (Number(gl[f]) || 0), 0)
      );
      const l10Avg = l10Values.reduce((a: number, b: number) => a + b, 0) / l10Values.length;

      const l10Hits = l10Values.filter((v: number) =>
        side === "OVER" ? v > line : v < line
      ).length;
      const l10HitRate = l10Hits / l10Values.length;

      let matchupAvg: number | null = null;
      let matchupHitRate: number | null = null;
      const edLower = (eventDesc || "").toLowerCase();
      for (const [mKey, m] of matchupLookup) {
        if (!mKey.startsWith(`${pLower}|`)) continue;
        if (!mKey.endsWith(`|${propType}`)) continue;
        const oppName = mKey.split("|")[1];
        const oppWords = oppName.split(/\s+/);
        if (oppWords.some((w: string) => w.length > 3 && edLower.includes(w))) {
          matchupAvg = Number(m.avg_stat);
          matchupHitRate = side === "OVER" ? Number(m.hit_rate_over || 0) : Number(m.hit_rate_under || 0);
          break;
        }
      }

      const isOver = side === "OVER";
      const avgVsLine = isOver ? l10Avg - line : line - l10Avg;
      const pctEdge = (avgVsLine / line) * 100;

      if (pctEdge < -10 && l10HitRate < 0.30) {
        return {
          pass: false, l10Avg, l10HitRate, matchupAvg,
          reason: `L10 avg ${l10Avg.toFixed(1)} ${isOver ? "below" : "above"} line ${line} — ${(l10HitRate * 100).toFixed(0)}% hit rate`,
          badge: "",
        };
      }

      if (pctEdge < -5 && l10HitRate < 0.40 && matchupHitRate !== null && matchupHitRate < 0.40) {
        return {
          pass: false, l10Avg, l10HitRate, matchupAvg,
          reason: `L10 avg ${l10Avg.toFixed(1)} + matchup ${matchupAvg?.toFixed(1)} both fail vs line ${line}`,
          badge: "",
        };
      }

      let badge = `📊 L10 Avg: ${l10Avg.toFixed(1)} | L10 Hit: ${(l10HitRate * 100).toFixed(0)}%`;
      if (matchupAvg !== null) {
        badge += ` | vs Opp: ${matchupAvg.toFixed(1)} avg`;
      }
      if (l10HitRate >= 0.70) badge += " ✅";
      else if (l10HitRate >= 0.50) badge += " ⚠️";
      else badge += " 🔻";

      return { pass: true, l10Avg, l10HitRate, matchupAvg, reason: "validated", badge };
    }

    // ══════════════════════════════════════════════════════════════
    // TEAM MARKET CROSS-REFERENCE GATE — validate team signals
    // ══════════════════════════════════════════════════════════════
    const [standingsRes, aliasesRes, nhlTeamsRes] = await Promise.all([
      supabase.from("team_season_standings").select("team_name, sport, wins, losses, win_pct, points_for, points_against"),
      supabase.from("team_aliases").select("team_name, aliases, team_abbreviation"),
      supabase.from("nhl_team_pace_stats").select("team_name, goals_for_per_game, goals_against_per_game, wins, losses, ot_losses"),
    ]);

    const teamStatsMap = new Map<string, any>();
    for (const s of (standingsRes.data || [])) {
      teamStatsMap.set(s.team_name.toLowerCase(), {
        team_name: s.team_name, sport: s.sport,
        wins: s.wins, losses: s.losses,
        win_pct: Number(s.win_pct || 0),
        ppg: s.points_for ? Number(s.points_for) : null,
        oppg: s.points_against ? Number(s.points_against) : null,
      });
    }
    for (const t of (nhlTeamsRes.data || [])) {
      const total = (t.wins || 0) + (t.losses || 0) + (t.ot_losses || 0);
      teamStatsMap.set(t.team_name.toLowerCase(), {
        team_name: t.team_name, sport: "NHL",
        wins: t.wins, losses: t.losses,
        win_pct: total > 0 ? t.wins / total : 0,
        ppg: Number(t.goals_for_per_game || 0),
        oppg: Number(t.goals_against_per_game || 0),
      });
    }

    // Alias resolver
    const aliasToTeamName = new Map<string, string>();
    for (const a of (aliasesRes.data || [])) {
      aliasToTeamName.set(a.team_name.toLowerCase(), a.team_name);
      if (a.team_abbreviation) aliasToTeamName.set(a.team_abbreviation.toLowerCase(), a.team_name);
      if (a.aliases) {
        try {
          const list = typeof a.aliases === "string" ? JSON.parse(a.aliases) : a.aliases;
          for (const al of list) {
            if (typeof al === "string") aliasToTeamName.set(al.toLowerCase(), a.team_name);
          }
        } catch {}
      }
    }

    function resolveTeamName(name: string): string | null {
      const lower = name.toLowerCase();
      if (aliasToTeamName.has(lower)) return aliasToTeamName.get(lower)!;
      for (const [alias, canonical] of aliasToTeamName) {
        if (lower.includes(alias) || alias.includes(lower)) return canonical;
      }
      return null;
    }

    function teamCrossReferenceGate(teamName: string, propType: string, line: number, side: string, eventDesc: string): {
      pass: boolean; reason: string; badge: string;
    } {
      const resolved = resolveTeamName(teamName);
      if (!resolved) return { pass: true, reason: "no_team_data", badge: "" };

      const stats = teamStatsMap.get(resolved.toLowerCase());
      if (!stats) return { pass: true, reason: "no_stats", badge: "" };

      // Find opponent from event description
      const parts = (eventDesc || "").split(/\s+vs?\s+/i);
      let oppStats: any = null;
      if (parts.length === 2) {
        const opp0 = resolveTeamName(parts[0].trim());
        const opp1 = resolveTeamName(parts[1].trim());
        const oppName = opp0?.toLowerCase() === resolved.toLowerCase() ? opp1 : opp0;
        if (oppName) oppStats = teamStatsMap.get(oppName.toLowerCase());
      }

      if (propType === "moneyline" || propType === "h2h") {
        const winPct = stats.win_pct;
        const oppWinPct = oppStats?.win_pct || 0.5;
        const winPctDiff = winPct - oppWinPct; // positive = our team is better

        if (side === "OVER" || side === "BACK") {
          // Block backing a sub-.500 team against a better opponent
          if (winPct < 0.50 && oppWinPct >= 0.50) {
            return { pass: false, reason: `${resolved} ${(winPct*100).toFixed(0)}% W vs ${(oppWinPct*100).toFixed(0)}% opp — sub-.500 underdog ML is a trap`, badge: "" };
          }
          // Block backing any team that's significantly worse than opponent (>10% gap)
          if (winPctDiff < -0.10) {
            return { pass: false, reason: `${resolved} ${(winPct*100).toFixed(0)}% W vs ${(oppWinPct*100).toFixed(0)}% opp — ${Math.abs(winPctDiff*100).toFixed(0)}% gap too wide`, badge: "" };
          }
        }
        if (side === "UNDER" || side === "FADE") {
          // Block fading a team with >55% win rate (was 60%, tightened)
          if (winPct > 0.55) {
            return { pass: false, reason: `${resolved} ${(winPct*100).toFixed(0)}% win rate — fading a winning team`, badge: "" };
          }
          // Block fading if opponent is actually worse
          if (oppWinPct < winPct && winPct >= 0.50) {
            return { pass: false, reason: `${resolved} ${(winPct*100).toFixed(0)}% W vs weaker ${(oppWinPct*100).toFixed(0)}% opp — don't fade the better team`, badge: "" };
          }
        }

        const verdict = winPctDiff > 0.05 ? " ✅" : winPctDiff < -0.05 ? " ⚠️" : "";
        const badge = `📊 ${resolved}: ${(winPct*100).toFixed(0)}% W${oppStats ? ` | Opp: ${(oppWinPct*100).toFixed(0)}% W` : ""}${verdict}`;
        return { pass: true, reason: "validated", badge };

      } else if (propType === "totals") {
        if (!stats.ppg || !oppStats?.ppg) return { pass: true, reason: "missing_ppg", badge: "" };

        const projectedTotal = stats.ppg + oppStats.ppg;
        const isOver = side === "OVER";
        const edge = isOver ? projectedTotal - line : line - projectedTotal;
        const pctEdge = (edge / line) * 100;

        // Block if projected total strongly contradicts the side (>8% against)
        if (pctEdge < -8) {
          return { pass: false, reason: `Projected ${projectedTotal.toFixed(1)} ${isOver ? "below" : "above"} line ${line} by ${Math.abs(pctEdge).toFixed(1)}%`, badge: "" };
        }

        const badge = `📊 Projected: ${projectedTotal.toFixed(1)} (${stats.ppg.toFixed(1)} + ${oppStats.ppg.toFixed(1)})${pctEdge > 0 ? " ✅" : " ⚠️"}`;
        return { pass: true, reason: "validated", badge };

      } else if (propType === "spreads") {
        if (!stats.ppg || !stats.oppg) return { pass: true, reason: "missing_diff", badge: "" };

        const ptDiff = stats.ppg - stats.oppg;
        const oppPtDiff = oppStats ? (oppStats.ppg || 0) - (oppStats.oppg || 0) : 0;
        const projMargin = (ptDiff - oppPtDiff) / 2;
        const spreadLine = line;
        const edge = projMargin - (-spreadLine);

        // ACCURACY FILTER: Block COVER on large spreads (>=10 pts) — 0% historical accuracy
        const absSpread = Math.abs(spreadLine);
        if (side === "COVER" && absSpread >= 10) {
          return { pass: false, reason: `COVER blocked on large spread ${spreadLine} — historically poor accuracy`, badge: "" };
        }

        // Block if projected margin strongly contradicts the recommended side (>5pt against)
        if (side === "COVER" && edge < -5) {
          return { pass: false, reason: `Projected margin ${projMargin.toFixed(1)} doesn't cover ${spreadLine}`, badge: "" };
        }
        if (side === "FADE" && edge > 5) {
          return { pass: false, reason: `Projected margin ${projMargin.toFixed(1)} suggests cover, not fade`, badge: "" };
        }

        // ACCURACY FILTER: COVER needs stronger edge confirmation than FADE
        if (side === "COVER" && Math.abs(edge) < 3) {
          return { pass: false, reason: `COVER edge too thin (${edge.toFixed(1)} pts) — FADEs outperform`, badge: "" };
        }

        const badge = `📊 Margin: ${projMargin > 0 ? "+" : ""}${projMargin.toFixed(1)} | Spread: ${spreadLine}${Math.abs(edge) > 2 ? " ✅" : " ⚠️"}`;
        return { pass: true, reason: "validated", badge };
      }

      return { pass: true, reason: "unknown_market", badge: "" };
    }

    // Build matchup lookup
    const eventTeams = new Map<string, Set<string>>();
    for (const row of activeData) {
      if (TEAM_MARKET_TYPES.has(row.prop_type) && row.player_name !== "Game Total") {
        if (!eventTeams.has(row.event_id)) eventTeams.set(row.event_id, new Set());
        eventTeams.get(row.event_id)!.add(row.player_name);
      }
    }
    const eventMatchup = new Map<string, string>();
    for (const [eid, teams] of eventTeams) {
      const arr = Array.from(teams);
      eventMatchup.set(eid, arr.length >= 2 ? `${arr[0]} vs ${arr[1]}` : arr[0] || "Unknown");
    }

    // Track best signal per player
    const bestSignalPerPlayer = new Map<string, { confidence: number; alert: string; record: any }>();
    const addSignal = (playerKey: string, confidence: number, alert: string, record: any) => {
      const existing = bestSignalPerPlayer.get(playerKey);
      if (!existing || confidence > existing.confidence) {
        bestSignalPerPlayer.set(playerKey, { confidence, alert, record });
      }
    };

    const esc = (s: string) => (s || "").replace(/_/g, " ").replace(/\*/g, "");
    const isLive = (r: any) => r.snapshot_phase === "live" || (typeof r.hours_to_tip === "number" && r.hours_to_tip <= 0);

    // ====== SIGNAL: LINE ABOUT TO MOVE / VELOCITY SPIKE / CASCADE ======
    // All signal types restored — velocity_spike and cascade fully active
    for (const [key, snapshots] of groups) {
      if (snapshots.length < 2) continue;

      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      const timeDiffMin = (new Date(last.snapshot_time).getTime() - new Date(first.snapshot_time).getTime()) / 60000;
      if (timeDiffMin < 3) continue; // reduced from 5 for faster detection

      const lineDiff = last.line - first.line;
      const absLineDiff = Math.abs(lineDiff);
      const velocityPerHour = (absLineDiff / timeDiffMin) * 60;

      const minVelocity = PROP_MIN_VELOCITY[first.prop_type] || 1.5;
      if (velocityPerHour < minVelocity) continue;

      const learnedPattern = (patterns || []).find(
        (p: any) => p.sport === first.sport && p.prop_type === first.prop_type && p.pattern_type === "velocity_spike"
      );
      const learnedAvgVelocity = learnedPattern?.velocity_threshold || 2.0;
      if (velocityPerHour <= learnedAvgVelocity * 0.8) continue;

      const direction = lineDiff < 0 ? "DROPPING" : "RISING";
      // Follow market movement: dropping = UNDER, rising = OVER
      let side = lineDiff < 0 ? "UNDER" : "OVER";
      const isCombo = COMBO_PROPS.has(first.prop_type);
      const comboBoost = isCombo ? 15 : 0;
      const confidence = Math.min(95, 50 + velocityPerHour * 12 + comboBoost);

      // ── CLASSIFY SIGNAL TYPE: velocity_spike vs cascade vs line_about_to_move ──
      // Cascade: ≥3 snapshots all moving in same direction (consistent drift)
      const isCascade = snapshots.length >= 3 && (() => {
        const diffs = [];
        for (let i = 1; i < snapshots.length; i++) {
          diffs.push(snapshots[i].line - snapshots[i - 1].line);
        }
        const allSameDir = diffs.every(d => d > 0) || diffs.every(d => d < 0);
        const consistency = diffs.filter(d => Math.sign(d) === Math.sign(lineDiff)).length / diffs.length;
        return allSameDir || consistency >= 0.8;
      })();
      // Velocity spike: high velocity (≥4.0/hr) with ≥3 snapshots and ≥50% directional consistency
      const isVelocitySpike = velocityPerHour >= 4.0 && snapshots.length >= 3;
      
      let classifiedSignalType: string;
      if (isVelocitySpike) {
        classifiedSignalType = "velocity_spike";
      } else if (isCascade) {
        classifiedSignalType = "cascade";
      } else {
        classifiedSignalType = "line_about_to_move";
      }

      // Apply kill gates for specific signal/market combos
      if (isKilledSignal(classifiedSignalType, first.prop_type)) {
        log(`🚫 KILLED ${classifiedSignalType} on ${first.prop_type}`);
        continue;
      }

      // Auto-flip removed — base direction now correctly follows market movement
      const autoFlipped = false;
      const live = isLive(last);

      // ── CROSS-REFERENCE GATE (player props + team markets) ──
      const isPlayerProp = !TEAM_MARKET_TYPES.has(first.prop_type);
      let crossRefBadge = "";
      if (isPlayerProp) {
        const gate = crossReferenceGate(first.player_name, first.prop_type, last.line, side, last.event_description || "");
        if (!gate.pass) {
          log(`🚫 BLOCKED ${first.player_name} ${first.prop_type} ${side} ${last.line}: ${gate.reason}`);
          continue;
        }
        crossRefBadge = gate.badge;
      } else {
        // Team market cross-reference
        const teamGate = teamCrossReferenceGate(first.player_name, first.prop_type, last.line, side, last.event_description || "");
        if (!teamGate.pass) {
          log(`🚫 BLOCKED TEAM ${first.player_name} ${first.prop_type} ${side} ${last.line}: ${teamGate.reason}`);
          continue;
        }
        crossRefBadge = teamGate.badge;
      }

      // Minimum confidence gate
      if (confidence < 60) continue;

      const elapsed = Math.round(timeDiffMin);
      const avgReaction = learnedPattern?.avg_reaction_time_minutes || 12;
      const remaining = Math.max(0, avgReaction - elapsed);

      // Dynamic accuracy badge uses the classified signal type
      const accuracyBadge = dynamicAccBadge(classifiedSignalType, first.prop_type);

      const reason = direction === "DROPPING"
        ? "Line dropping = sharp money expects under"
        : "Line rising = sharp money expects over";
      const liveTag = live ? " [🔴 LIVE]" : "";

      const isTeamMarket = TEAM_MARKET_TYPES.has(first.prop_type);
      const matchupLine = isTeamMarket ? eventMatchup.get(first.event_id) : null;
      const marketLabel = isTeamMarket
        ? `${esc(first.player_name)} ${esc(first.prop_type).toUpperCase()}`
        : `${esc(first.player_name)} ${esc(first.prop_type).replace("player ", "").toUpperCase()}`;

      // Signal-specific label and emoji
      const signalLabel = classifiedSignalType === "velocity_spike"
        ? "VELOCITY SPIKE"
        : classifiedSignalType === "cascade"
        ? "CASCADE ALERT"
        : (live ? "LINE MOVING NOW" : "LINE ABOUT TO MOVE");
      const signalEmoji = classifiedSignalType === "velocity_spike" ? "⚡" 
        : classifiedSignalType === "cascade" ? "🌊" : "🔮";

      const volWarning = getVolatilityWarning(first.player_name);
      const altLineText = getAltLineText(last.line, side, first.prop_type, first.player_name);
      const volInfo = volatilityMap.get((first.player_name || "").toLowerCase().trim());

      const alertText = [
        `${signalEmoji} *${signalLabel}*${liveTag} — ${esc(first.sport)}`,
        matchupLine ? `🏟 ${esc(matchupLine)}` : null,
        marketLabel,
        fdLineBadge(last.line, last.over_price, last.under_price, side, first.prop_type),
        `Line ${direction}: ${first.line} → ${last.line}`,
        `Speed: ${velocityPerHour.toFixed(1)}/hr over ${elapsed}min`,
        live ? `⏱ In-game shift detected` : `⏱ ~${remaining}min window remaining`,
        `📊 Confidence: ${Math.round(confidence)}%`,
        accuracyBadge || null,
        crossRefBadge || null,
        volWarning || null,
        altLineText || null,
        isMoneylineProp(first.prop_type)
          ? `✅ *Action: ${side === "OVER" ? "TAKE" : "FADE"} ${esc(first.player_name)} (${fmtOdds(last.line)})*`
          : `✅ *Action: ${side} ${last.line} ${fmtOdds(side === "OVER" ? last.over_price : last.under_price)}*`,
        autoFlipped ? `🪤 *AUTO-FLIPPED: Cascade OVER → UNDER (FanDuel trap)*` : null,
        `💡 ${reason}`,
        isCombo ? `🔥 *COMBO PROP* — 85-100% historical accuracy` : null,
      ].filter(Boolean).join("\n");

      const liveSignalType = live ? `live_${classifiedSignalType}` : classifiedSignalType;
      const record = {
        signal_type: liveSignalType,
        sport: first.sport, prop_type: first.prop_type,
        player_name: first.player_name, event_id: first.event_id,
        prediction: `${side} ${last.line}`,
        predicted_direction: direction.toLowerCase(),
        predicted_magnitude: absLineDiff,
        confidence_at_signal: confidence,
        velocity_at_signal: velocityPerHour,
        time_to_tip_hours: last.hours_to_tip,
        edge_at_signal: absLineDiff,
        signal_factors: {
          velocityPerHour, timeDiffMin, lineDiff, learnedAvgVelocity, classifiedSignalType,
          currentLine: last.line, line_to: last.line, opening_line: first.line,
          is_volatile_minutes: volInfo?.isVolatile || false,
          minutes_cv: volInfo?.cv ?? null,
          minutes_avg: volInfo?.avgMin ?? null,
          alt_line_buffer: getAltBuffer(first.prop_type, first.player_name),
          recommended_alt_line: calcAltLine(last.line, side, first.prop_type, first.player_name),
        },
      };

      addSignal(`${first.event_id}|${first.player_name}`, confidence, alertText, record);
    }

    // ====== SIGNAL: TAKE IT NOW (Snapback — 95% on rebounds) ======
    // KILLED for player_points (0% accuracy on snapback)
    // Only rebounds and combos survive
    const SNAPBACK_BLOCKED_PROPS = new Set(["player_points", "player_threes"]);

    for (const [key, snapshots] of groups) {
      const last = snapshots[snapshots.length - 1];
      if (!last.opening_line) continue;

      // Block snapback for points/3s — 0% and no data
      if (SNAPBACK_BLOCKED_PROPS.has(last.prop_type)) continue;

      const drift = last.line - last.opening_line;
      const absDrift = Math.abs(drift);
      const driftPct = (absDrift / last.opening_line) * 100;
      const minDrift = PROP_MIN_DRIFT_PCT[last.prop_type] || 6;

      if (driftPct < minDrift) continue;

      // Sport-aware direction logic:
      // NBA player props → data-driven (L10/L3 stats determine direction)
      // Everything else (NHL, MLB, NCAAB, pitcher props, team markets) → follow market direction
      const isPitcherProp = last.prop_type?.startsWith("pitcher_");
      const isNbaPlayerProp = last.sport === "NBA" && !TEAM_MARKET_TYPES.has(last.prop_type) && !isPitcherProp;

      // ── NBA DATA-DRIVEN DIRECTION ──
      let snapDirection: string;
      let directionMethod: string; // "l10_data" | "l3_trend" | "market_follow"
      let directionReason: string;

      if (isNbaPlayerProp) {
        const pKey = (last.player_name || "").toLowerCase().trim();
        const logs = playerL10.get(pKey) || [];
        const currentLine = last.line;

        // Extract stat values from game logs based on prop type
        const statKey = last.prop_type?.replace("player_", "") || "";
        const statValues: number[] = [];
        for (const g of logs) {
          let val = 0;
          if (statKey === "points") val = g.pts ?? g.points ?? 0;
          else if (statKey === "rebounds") val = g.reb ?? g.rebounds ?? 0;
          else if (statKey === "assists") val = g.ast ?? g.assists ?? 0;
          else if (statKey === "threes") val = g.fg3m ?? g.threes ?? 0;
          else if (statKey === "steals") val = g.stl ?? g.steals ?? 0;
          else if (statKey === "blocks") val = g.blk ?? g.blocks ?? 0;
          else if (statKey === "points_rebounds_assists") val = (g.pts ?? 0) + (g.reb ?? 0) + (g.ast ?? 0);
          else if (statKey === "points_rebounds") val = (g.pts ?? 0) + (g.reb ?? 0);
          else if (statKey === "points_assists") val = (g.pts ?? 0) + (g.ast ?? 0);
          else if (statKey === "rebounds_assists") val = (g.reb ?? 0) + (g.ast ?? 0);
          else if (statKey === "turnovers") val = g.turnover ?? g.turnovers ?? 0;
          else val = g.pts ?? 0; // fallback
          statValues.push(val);
        }

        const l10Vals = statValues.slice(0, 10);
        const l3Vals = statValues.slice(0, 3);
        const l10Avg = l10Vals.length >= 3 ? l10Vals.reduce((a, b) => a + b, 0) / l10Vals.length : null;
        const l3Avg = l3Vals.length >= 3 ? l3Vals.reduce((a, b) => a + b, 0) / l3Vals.length : null;
        const overHits = l10Vals.filter(v => v > currentLine).length;
        const underHits = l10Vals.filter(v => v < currentLine).length;
        const overRate = l10Vals.length > 0 ? overHits / l10Vals.length : 0;
        const underRate = l10Vals.length > 0 ? underHits / l10Vals.length : 0;

        // Minutes gate for NBA
        const volInfo = volatilityMap.get(pKey);
        const avgMin = volInfo?.avgMin ?? 0;
        const minCV = volInfo?.cv ?? 0;

        if (avgMin > 0 && avgMin < 15) {
          log(`🚫 BLOCKED (TIN minutes) ${last.player_name} — L10 avg ${avgMin.toFixed(0)}min < 15`);
          continue; // Hard block: not enough minutes
        }

        // Determine direction from data
        if (l10Avg !== null && l10Avg > currentLine && overRate >= 0.50) {
          snapDirection = "OVER";
          directionMethod = "l10_data";
          directionReason = `L10 avg ${l10Avg.toFixed(1)} clears line ${currentLine} (${(overRate * 100).toFixed(0)}% hit rate)`;
        } else if (l10Avg !== null && l10Avg < currentLine && underRate >= 0.50) {
          snapDirection = "UNDER";
          directionMethod = "l10_data";
          directionReason = `L10 avg ${l10Avg.toFixed(1)} below line ${currentLine} (${(underRate * 100).toFixed(0)}% hit rate)`;
        } else if (l3Avg !== null && l10Avg !== null && volInfo?.isVolatile && Math.abs(l3Avg - l10Avg) / l10Avg > 0.15) {
          // Volatile player with L3 diverging from L10 — follow recent trend
          snapDirection = l3Avg > currentLine ? "OVER" : "UNDER";
          directionMethod = "l3_trend";
          directionReason = `Volatile: L3 avg ${l3Avg.toFixed(1)} vs L10 avg ${l10Avg.toFixed(1)} — ${l3Avg > l10Avg ? "hot" : "cold"} streak`;
        } else {
          // Fallback: follow market direction (no more blind regression)
          snapDirection = drift > 0 ? "OVER" : "UNDER";
          directionMethod = "market_follow";
          directionReason = `No clear data edge — following market direction (${snapDirection})`;
        }

        // Minutes warnings for confidence adjustment
        let minutesPenalty = 0;
        if (avgMin > 0 && avgMin < 20) {
          directionReason += ` | ⚠️ Low minutes (${avgMin.toFixed(0)}min)`;
          minutesPenalty = 5;
        }
        if (minCV > 0.30) {
          minutesPenalty += 10;
        }

        const isCombo = COMBO_PROPS.has(last.prop_type);
        const comboBoost = isCombo ? 10 : 0;
        var confidence = Math.min(92, 30 + driftPct * 3 + comboBoost - minutesPenalty);
      } else if (isMoneylineProp(last.prop_type) && (last.sport === "MLB" || last.sport === "baseball_mlb")) {
        // ── MLB MONEYLINE: TAKE/FADE with pitcher context ──
        // Line shortening (odds getting more negative or less positive) = market backing = TAKE
        // Line lengthening (odds getting more positive or less negative) = market fading = FADE
        const isShortening = drift < 0; // e.g. +168 → +154 or -110 → -130
        snapDirection = isShortening ? "OVER" : "UNDER"; // internal: OVER=TAKE, UNDER=FADE
        directionMethod = "market_follow";

        // Pitcher quality context from mlb_player_game_logs
        let pitcherContext = "";
        let pitcherConfidenceAdj = 0;
        const teamName = (last.player_name || "").toLowerCase().trim();
        
        // Look for pitchers associated with this event via active props
        const eventPitchers: { name: string; era: number; k9: number; ip: number; games: number }[] = [];
        for (const [, snaps] of groups) {
          const s = snaps[0];
          if (s.event_id !== last.event_id) continue;
          if (!s.prop_type?.startsWith("pitcher_")) continue;
          const pName = (s.player_name || "").toLowerCase().trim();
          const pLogs = mlbPlayerLogs.get(pName);
          if (!pLogs || pLogs.length < 3) continue;
          const l10 = pLogs.slice(0, 10);
          const totalIP = l10.reduce((s, g) => s + (g.innings_pitched || 0), 0);
          const totalER = l10.reduce((s, g) => s + (g.earned_runs || 0), 0);
          const totalK = l10.reduce((s, g) => s + (g.pitcher_strikeouts || g.strikeouts || 0), 0);
          const avgIP = totalIP / l10.length;
          const era = avgIP > 0 ? (totalER / totalIP) * 9 : 99;
          const k9 = avgIP > 0 ? (totalK / totalIP) * 9 : 0;
          eventPitchers.push({ name: s.player_name, era, k9, ip: avgIP, games: l10.length });
        }

        // Identify if pitcher is ace or struggling
        if (eventPitchers.length > 0) {
          for (const p of eventPitchers) {
            const isAce = p.era < 3.5 && p.k9 > 7.0;
            const isStruggling = p.era > 5.0 || (p.ip < 4.5 && p.games >= 5);
            const isRookie = p.games <= 5 && p.ip < 4.0;
            if (isAce) {
              pitcherContext += `\n⚾ SP: ${esc(p.name)} — 🔥 Ace (${p.era.toFixed(2)} ERA, ${p.k9.toFixed(1)} K/9 L10)`;
              pitcherConfidenceAdj += 10;
            } else if (isStruggling || isRookie) {
              pitcherContext += `\n⚾ SP: ${esc(p.name)} — ⚠️ ${isRookie ? "Rookie" : "Struggling"} (${p.era.toFixed(2)} ERA, ${p.ip.toFixed(1)} IP/gm L10)`;
              pitcherConfidenceAdj -= 10;
            } else {
              pitcherContext += `\n⚾ SP: ${esc(p.name)} (${p.era.toFixed(2)} ERA, ${p.k9.toFixed(1)} K/9 L10)`;
            }
          }
        }

        const action = isShortening ? "TAKE" : "FADE";
        directionReason = isShortening
          ? `Odds shortening ${fmtOdds(last.opening_line)} → ${fmtOdds(last.line)} — market backing ${esc(last.player_name)} (${action})`
          : `Odds lengthening ${fmtOdds(last.opening_line)} → ${fmtOdds(last.line)} — market fading ${esc(last.player_name)} (${action})`;
        if (pitcherContext) directionReason += pitcherContext;

        const isCombo = COMBO_PROPS.has(last.prop_type);
        const comboBoost = isCombo ? 10 : 0;
        var confidence = Math.min(92, 30 + driftPct * 3 + comboBoost + pitcherConfidenceAdj);
      } else if (isMoneylineProp(last.prop_type)) {
        // ── Non-MLB Moneyline: TAKE/FADE ──
        const isShortening = drift < 0;
        snapDirection = isShortening ? "OVER" : "UNDER";
        directionMethod = "market_follow";
        const action = isShortening ? "TAKE" : "FADE";
        directionReason = isShortening
          ? `Odds shortening — market signals ${action} ${esc(last.player_name)} (${esc(last.sport)})`
          : `Odds lengthening — market signals ${action} ${esc(last.player_name)} (${esc(last.sport)})`;
        const isCombo = COMBO_PROPS.has(last.prop_type);
        const comboBoost = isCombo ? 10 : 0;
        var confidence = Math.min(92, 30 + driftPct * 3 + comboBoost);
      } else {
        // Non-NBA non-moneyline: follow market direction (unchanged)
        snapDirection = drift > 0 ? "OVER" : "UNDER";
        directionMethod = "market_follow";
        directionReason = snapDirection === "OVER"
          ? `Line rising — market signals OVER (${esc(last.sport)})`
          : `Line dropping — market signals UNDER (${esc(last.sport)})`;
        const isCombo = COMBO_PROPS.has(last.prop_type);
        const comboBoost = isCombo ? 10 : 0;
        var confidence = Math.min(92, 30 + driftPct * 3 + comboBoost);
      }
      const live = isLive(last);

      // ── CROSS-REFERENCE GATE (player props + team markets) ──
      const isPlayerPropTIN = !TEAM_MARKET_TYPES.has(last.prop_type);
      let crossRefBadgeTIN = "";
      if (isPlayerPropTIN) {
        const gate = crossReferenceGate(last.player_name, last.prop_type, last.line, snapDirection, last.event_description || "");
        if (!gate.pass) {
          log(`🚫 BLOCKED (TIN) ${last.player_name} ${last.prop_type} ${snapDirection} ${last.line}: ${gate.reason}`);
          continue;
        }
        crossRefBadgeTIN = gate.badge;
      } else {
        const teamGate = teamCrossReferenceGate(last.player_name, last.prop_type, last.line, snapDirection, last.event_description || "");
        if (!teamGate.pass) {
          log(`🚫 BLOCKED TEAM (TIN) ${last.player_name} ${last.prop_type} ${snapDirection} ${last.line}: ${teamGate.reason}`);
          continue;
        }
        crossRefBadgeTIN = teamGate.badge;
      }

      if (confidence < 55) continue;

      const reason = directionReason;
      const liveTag = live ? " [🔴 LIVE]" : "";

      // Dynamic accuracy badge from real verified data
      const accBadge = dynamicAccBadge(live ? "live_drift" : "take_it_now", last.prop_type);

      const isTeamMarket = TEAM_MARKET_TYPES.has(last.prop_type);
      const matchupLine = isTeamMarket ? eventMatchup.get(last.event_id) : null;
      const marketLabel = isTeamMarket
        ? `${esc(last.player_name)} ${esc(last.prop_type).toUpperCase()}`
        : `${esc(last.player_name)} ${esc(last.prop_type).replace("player ", "").toUpperCase()}`;

      const volWarningTIN = getVolatilityWarning(last.player_name);
      const altLineTextTIN = getAltLineText(last.line, snapDirection, last.prop_type, last.player_name);
      const volInfoTIN = volatilityMap.get((last.player_name || "").toLowerCase().trim());

      // Minutes badge for NBA
      let minutesBadge: string | null = null;
      if (isNbaPlayerProp && volInfoTIN && volInfoTIN.avgMin > 0) {
        const minStability = volInfoTIN.cv > 0.30 ? "VOLATILE" : volInfoTIN.cv > 0.20 ? "unstable" : "stable";
        if (volInfoTIN.avgMin < 20) {
          minutesBadge = `⚠️ L10 Min: ${volInfoTIN.avgMin.toFixed(1)} avg — minutes risk (${minStability})`;
        } else {
          minutesBadge = `🕐 L10 Min: ${volInfoTIN.avgMin.toFixed(1)} avg (${minStability})`;
        }
      }

      const alertText = [
        `💰 *${live ? "LIVE DRIFT" : "TAKE IT NOW"}*${liveTag} — ${esc(last.sport)}`,
        matchupLine ? `🏟 ${esc(matchupLine)}` : null,
        marketLabel,
        fdLineBadge(last.line, last.over_price, last.under_price, snapDirection, last.prop_type),
        isMoneylineProp(last.prop_type)
          ? `Open: ${fmtOdds(last.opening_line)} → Now: ${fmtOdds(last.line)}`
          : `Open: ${last.opening_line} → Now: ${last.line}`,
        `Drift: ${driftPct.toFixed(1)}% — ${directionMethod === "l10_data" ? "L10 data-driven" : directionMethod === "l3_trend" ? "L3 trend signal" : "market conviction signal"}`,
        `📊 Confidence: ${Math.round(confidence)}%`,
        accBadge || null,
        crossRefBadgeTIN || null,
        volWarningTIN || null,
        minutesBadge || null,
        altLineTextTIN || null,
        isMoneylineProp(last.prop_type)
          ? `✅ *Action: ${snapDirection === "OVER" ? "TAKE" : "FADE"} ${esc(last.player_name)} (${fmtOdds(last.line)})*`
          : `✅ *Action: ${snapDirection} ${last.line} ${fmtOdds(snapDirection === "OVER" ? last.over_price : last.under_price)}*`,
        `💡 ${reason}`,
      ].filter(Boolean).join("\n");

      const record = {
        signal_type: live ? "live_drift" : "take_it_now",
        sport: last.sport, prop_type: last.prop_type,
        player_name: last.player_name, event_id: last.event_id,
        prediction: isMoneylineProp(last.prop_type) ? `${snapDirection === "OVER" ? "TAKE" : "FADE"} ${last.player_name}` : `${snapDirection} ${last.line}`,
        predicted_direction: directionMethod,
        predicted_magnitude: absDrift,
        confidence_at_signal: confidence,
        time_to_tip_hours: last.hours_to_tip,
        edge_at_signal: driftPct,
        signal_factors: {
          opening_line: last.opening_line, current_line: last.line, driftPct,
          is_volatile_minutes: volInfoTIN?.isVolatile || false,
          minutes_cv: volInfoTIN?.cv ?? null,
          minutes_avg: volInfoTIN?.avgMin ?? null,
          alt_line_buffer: getAltBuffer(last.prop_type, last.player_name),
          recommended_alt_line: calcAltLine(last.line, snapDirection, last.prop_type, last.player_name),
        },
        // Trap detection fields
        line_at_alert: last.line,
        hours_before_tip: last.hours_to_tip,
        alert_sent_at: new Date().toISOString(),
        drift_pct_at_alert: driftPct,
      };

      addSignal(`${last.event_id}|${last.player_name}`, confidence, alertText, record);
    }

    // ====== SIGNAL: TRAP WARNING — fires faster, skips already-recommended lines ======
    // Collect player keys we already recommended a side on
    const alreadyRecommended = new Set<string>();
    for (const [pKey, entry] of bestSignalPerPlayer) {
      if (entry.record?.signal_type !== "trap_warning") {
        alreadyRecommended.add(pKey);
      }
    }

    for (const [key, snapshots] of groups) {
      if (snapshots.length < 2) continue; // reduced from 3 for faster detection

      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      const playerKey = `${first.event_id}|${first.player_name}`;

      // Skip trap warning if we already sent a pick/take-it-now for this player+event
      if (alreadyRecommended.has(playerKey)) continue;

      const live = isLive(last);
      const liveTag = live ? " [🔴 LIVE]" : "";

      // Detect reversal with lower threshold (0.3 instead of 0.5)
      if (snapshots.length >= 3) {
        const mid = snapshots[Math.floor(snapshots.length / 2)];
        const firstHalfDir = mid.line - first.line;
        const secondHalfDir = last.line - mid.line;

        if (
          Math.abs(firstHalfDir) >= 0.3 &&
          Math.abs(secondHalfDir) >= 0.3 &&
          Math.sign(firstHalfDir) !== Math.sign(secondHalfDir)
        ) {
          const isTeamMarket = TEAM_MARKET_TYPES.has(first.prop_type);
          const matchupLine = isTeamMarket ? eventMatchup.get(first.event_id) : null;
          const marketLabel = isTeamMarket
            ? `${esc(first.player_name)} ${esc(first.prop_type).toUpperCase()}`
            : `${esc(first.player_name)} ${esc(first.prop_type).replace("player ", "").toUpperCase()}`;

          const volWarningTrap = getVolatilityWarning(first.player_name);
          const volInfoTrap = volatilityMap.get((first.player_name || "").toLowerCase().trim());

          const alertText = [
            `⚠️ *TRAP WARNING*${liveTag} — ${esc(first.sport)}`,
            matchupLine ? `🏟 ${esc(matchupLine)}` : null,
            marketLabel,
            `Line reversed: ${first.line} → ${mid.line} → ${last.line}`,
            `🚫 Sharp reversal pattern — DO NOT TOUCH`,
            volWarningTrap || null,
            `✅ *Action: STAY AWAY — both sides are dangerous*`,
            `💡 Book is manipulating this line to trap bettors`,
          ].filter(Boolean).join("\n");

          const record = {
            signal_type: "trap_warning",
            sport: first.sport, prop_type: first.prop_type,
            player_name: first.player_name, event_id: first.event_id,
            prediction: "TRAP — avoid",
            predicted_direction: "reversal",
            predicted_magnitude: Math.abs(firstHalfDir) + Math.abs(secondHalfDir),
            confidence_at_signal: 75,
            time_to_tip_hours: last.hours_to_tip,
            signal_factors: {
              firstLine: first.line, midLine: mid.line, lastLine: last.line,
              is_volatile_minutes: volInfoTrap?.isVolatile || false,
              minutes_cv: volInfoTrap?.cv ?? null,
              minutes_avg: volInfoTrap?.avgMin ?? null,
            },
          };

          bestSignalPerPlayer.set(playerKey, { confidence: 99, alert: alertText, record });
        }
      }
    }

    // Team market conflict guard
    const chosenTeamMarketSignals = new Map<string, { confidence: number; alert: string; record: any }>();
    const nonTeamSignals: Array<{ confidence: number; alert: string; record: any }> = [];

    for (const entry of bestSignalPerPlayer.values()) {
      const propType = entry.record?.prop_type;
      const eventId = entry.record?.event_id;

      if (!eventId || !TEAM_MARKET_TYPES.has(propType)) {
        nonTeamSignals.push(entry);
        continue;
      }

      const conflictKey = `${eventId}|${propType}`;
      const strength = Number(entry.record?.confidence_at_signal ?? entry.confidence ?? 0)
        + Number(entry.record?.velocity_at_signal ?? 0) * 0.1;

      const existing = chosenTeamMarketSignals.get(conflictKey);
      if (!existing || strength > existing.confidence) {
        chosenTeamMarketSignals.set(conflictKey, { ...entry, confidence: strength });
      }
    }

    // ── SORT BY PRIORITY: highest-accuracy signals first ──
    const selectedSignals = [
      ...nonTeamSignals,
      ...Array.from(chosenTeamMarketSignals.values()),
    ].sort((a, b) => getSignalPriority(a.record) - getSignalPriority(b.record));

    const telegramAlerts: string[] = [];
    const predictionRecords: any[] = [];
    const gatedRecords: any[] = []; // Still recorded in DB for flip-logic tracking
    let gatedCount = 0;
    let flippedCount = 0;
    for (const { alert, record } of selectedSignals) {
      // ── 70% ACCURACY GATE: record in DB but suppress from Telegram ──
      if (isAccuracyGated(record?.signal_type, record?.prop_type)) {
        gatedCount++;

        // ── FLIP LOGIC: if consistent downside history, flip and send ──
        const flipCheck = shouldFlip(record?.signal_type, record?.prop_type);
        if (flipCheck.flip && record?.prediction) {
          const origPrediction = record.prediction;
          const origSide = origPrediction.split(" ")[0]; // "OVER", "UNDER", "BACK", "FADE"
          const flippedSideStr = flipSide(origSide);
          const flippedPred = flipPrediction(origPrediction);

          // Validate flip with L10 data for player props (skip team markets)
          const isTeamMarket = TEAM_MARKET_TYPES.has(record.prop_type);
          let flipValidated = isTeamMarket; // team markets auto-validate (no L10)

          if (!isTeamMarket) {
            const { data: propsData } = await supabase
              .from("unified_props")
              .select("l10_avg, l10_hit_rate_over, l10_hit_rate_under, fanduel_line")
              .eq("player_name", record.player_name)
              .eq("prop_type", record.prop_type)
              .order("last_updated", { ascending: false })
              .limit(1);

            if (propsData && propsData.length > 0) {
              const p = propsData[0];
              const line = Number(record.prediction.split(" ")[1]) || p.fanduel_line;
              if (flippedSideStr === "OVER" && p.l10_avg != null && p.l10_avg > line && (p.l10_hit_rate_over ?? 0) >= 0.5) {
                flipValidated = true;
              } else if (flippedSideStr === "UNDER" && p.l10_avg != null && p.l10_avg < line && (p.l10_hit_rate_under ?? 0) >= 0.5) {
                flipValidated = true;
              }
            }
          }

          // Force-flip override: extreme downside NBA player props skip L10 validation
          const isForceFlip = !isTeamMarket && 
            FORCE_FLIP_PROP_TYPES.has(record.prop_type) && 
            flipCheck.samples >= FORCE_FLIP_MIN_SAMPLES && 
            flipCheck.winRate < FORCE_FLIP_THRESHOLD &&
            (record.sport || "").toUpperCase().includes("NBA");

          if (flipValidated || isForceFlip) {
            flippedCount++;
            const flipLabel = isForceFlip && !flipValidated ? "FORCE-FLIP" : "FLIPPED";
            log(`🔄 ${flipLabel}: ${record.player_name} ${record.prop_type} ${origSide} → ${flippedSideStr} (original ${(flipCheck.winRate*100).toFixed(0)}% in ${flipCheck.samples} samples)`);

            // Build flipped alert text
            const flippedAlert = [
              `🔄 *${isForceFlip ? "FORCE FLIP" : "FLIP SIGNAL"}* — ${esc(record.sport)}`,
              `${esc(record.player_name)} ${esc(record.prop_type).replace("player_", "").toUpperCase()}`,
              `Original ${origSide} was ${(flipCheck.winRate*100).toFixed(0)}% accuracy (${flipCheck.samples} samples)`,
              `✅ *Action: ${flippedPred}*`,
              isForceFlip ? `🎯 Extreme downside pattern — forced flip (NBA rebounds/assists)` : `💡 Consistent miss pattern — flipped to opposite side`,
              `⚠️ _Flip signal — lower confidence, use with caution_`,
            ].filter(Boolean).join("\n");

            telegramAlerts.push(flippedAlert);
            // Record the flipped version
            record.prediction = flippedPred;
            record.predicted_direction = `flipped_${record.predicted_direction || "unknown"}`;
            record.signal_type = `flipped_${record.signal_type}`;
            predictionRecords.push(record);
            continue;
          } else {
            log(`🔄 FLIP BLOCKED: ${record.player_name} ${record.prop_type} — L10 doesn't support ${flippedSideStr}`);
          }
        }

        record.gated = true; // mark as accuracy-gated
        gatedRecords.push(record);
        continue;
      }
      telegramAlerts.push(alert);
      predictionRecords.push(record);
    }
    if (gatedCount > 0) log(`🚫 Accuracy gate suppressed ${gatedCount} alerts (${flippedCount} flipped, rest recorded for tracking)`);

    // ====== CROSS-RUN DEDUP: Don't re-insert same player+prop+signal within 2 hours ======
    const allRecordsForDb = [...predictionRecords, ...gatedRecords];
    let dedupedRecords = allRecordsForDb;
    if (allRecordsForDb.length > 0) {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data: recentPreds } = await supabase
        .from("fanduel_prediction_accuracy")
        .select("player_name, prop_type, signal_type, event_id")
        .gte("created_at", twoHoursAgo)
        .limit(1000);

      const recentKeys = new Set(
        (recentPreds || []).map((r: any) => `${r.event_id}|${r.player_name}|${r.prop_type}|${r.signal_type}`)
      );

      dedupedRecords = allRecordsForDb.filter(r => {
        const key = `${r.event_id}|${r.player_name}|${r.prop_type}|${r.signal_type}`;
        if (recentKeys.has(key)) {
          log(`⏭ Dedup: skipping ${r.player_name} ${r.prop_type} ${r.signal_type}`);
          return false;
        }
        return true;
      });

      log(`Dedup: ${allRecordsForDb.length} → ${dedupedRecords.length} records (${allRecordsForDb.length - dedupedRecords.length} skipped)`);
    }

    // Store ALL prediction records (including gated ones) for accuracy tracking
    if (dedupedRecords.length > 0) {
      // Strip the 'gated' flag before insert (not a DB column)
      const cleanRecords = dedupedRecords.map(({ gated, ...rest }) => rest);
      const { error } = await supabase.from("fanduel_prediction_accuracy").insert(cleanRecords);
      if (error) log(`⚠ Prediction insert error: ${error.message}`);
    }

    // ====== OWNER RULES FILTER — remove alerts that violate rules before Telegram ======
    let rulesBlocked = 0;
    const filteredTelegramAlerts = telegramAlerts.filter((alertText: string) => {
      for (const rule of ownerRules) {
        if (rule.rule_key === "pitcher_k_follow_market") {
          const kTypes = ((rule.rule_logic as any).prop_types || []) as string[];
          const hasK = kTypes.some((k: string) => alertText.toLowerCase().includes(k.replace("_", " ")));
          if (hasK) {
            // Check: rising + UNDER or dropping + OVER
            const lower = alertText.toLowerCase();
            if ((lower.includes("rising") && lower.includes("under")) || 
                (lower.includes("dropping") && lower.includes("over"))) {
              log(`🚫 RULE BLOCKED [${rule.rule_key}]: pitcher K direction violation in alert`);
              rulesBlocked++;
              supabase.from("bot_audit_log").insert({
                rule_key: rule.rule_key,
                violation_description: "Pitcher K direction violation in prediction alert",
                action_taken: "blocked",
                affected_table: "prediction_alerts",
              }).then(() => {});
              return false;
            }
          }
        }
      }
      return true;
    });
    if (rulesBlocked > 0) log(`Owner rules blocked ${rulesBlocked} prediction alert(s)`);

    // Send Telegram alerts — paginated, priority-ordered
    if (filteredTelegramAlerts.length > 0) {
      const MAX_CHARS = 3800;
      const pages: string[][] = [];
      let currentPage: string[] = [];
      let currentLen = 0;

      for (const alert of filteredTelegramAlerts) {
        const alertLen = alert.length + 2;
        if (currentPage.length > 0 && currentLen + alertLen > MAX_CHARS) {
          pages.push(currentPage);
          currentPage = [];
          currentLen = 0;
        }
        currentPage.push(alert);
        currentLen += alertLen;
      }
      if (currentPage.length > 0) pages.push(currentPage);

      for (let i = 0; i < pages.length; i++) {
        const pageLabel = pages.length > 1 ? ` (${i + 1}/${pages.length})` : "";
        const header = i === 0
          ? [`🎯 *FanDuel Predictions*${pageLabel}`, `${filteredTelegramAlerts.length} signal(s) — sorted by accuracy`, ""]
          : [`🎯 *Predictions${pageLabel}*`, ""];

        const msg = [...header, ...pages[i]].join("\n\n");

        try {
          await supabase.functions.invoke("bot-send-telegram", {
            body: { message: msg, parse_mode: "Markdown", admin_only: true },
          });
        } catch (tgErr: any) {
          log(`Telegram error page ${i + 1}: ${tgErr.message}`);
        }
      }
    }

    log(`=== ALERTS COMPLETE: ${telegramAlerts.length} alerts, ${predictionRecords.length} predictions ===`);

    // Trigger 2-leg prediction parlays digest after predictions are stored
    try {
      await supabase.functions.invoke("generate-prediction-parlays");
      log("2-leg prediction parlays digest triggered ✅");
    } catch (parlayErr: any) {
      log(`⚠ Prediction parlays trigger error: ${parlayErr.message}`);
    }

    await supabase.from("cron_job_history").insert({
      job_name: "fanduel-prediction-alerts",
      status: "completed",
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(),
      result: { alerts: telegramAlerts.length, predictions: predictionRecords.length },
    });

    return new Response(
      JSON.stringify({ success: true, alerts: telegramAlerts.length, predictions: predictionRecords.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    log(`❌ Fatal: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
