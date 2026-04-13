import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// fanduel-prediction-alerts  v3.0 — CLEAN ACCURACY REWRITE
//
// BUGS FIXED:
//
// BUG 1 — Signal classification race condition: isCascade and isVelocitySpike
//   are NOT mutually exclusive. A cascade with velocity ≥ 4.0/hr was classified
//   as velocity_spike, hitting the wrong kill gate. Fixed by checking isCascade
//   FIRST — a consistent multi-snapshot cascade is more informative than raw
//   velocity alone, so cascade always wins when both conditions are true.
//
// BUG 2 — isKilledSignal called AFTER classification, not before, meaning a
//   killed signal still computed confidence, built the alert, and entered
//   addSignal before being dropped. The gate is now a pure pre-check that
//   returns early immediately after classification, before any expensive work.
//
// BUG 3 — pctEdge division by zero on NBA cross-reference gate (line ~734):
//   `const pctEdge = (avgVsLine / line) * 100` — when line === 0 this produces
//   Infinity, bypassing both block conditions silently. Fixed with a zero guard.
//
// BUG 4 — learnedAvgVelocity filter fires at wrong point: it was applied
//   AFTER classification but BEFORE kill gates, blocking line_about_to_move
//   signals that have lower velocity than a learned velocity_spike threshold
//   even when the signal would correctly classify as line_about_to_move (not
//   a velocity spike). Filter now only applies to velocity_spike signals.
//
// BUG 5 — Team market conflict strength comparison mixes incommensurable units:
//   `confidence_at_signal (0-100) + velocity_at_signal * 0.1` — velocity_at_signal
//   is in units/hr and varies wildly by prop type. A totals velocity of 3.0
//   contributes only 0.3 while a points velocity of 1.0 also contributes 0.1,
//   making the comparison arbitrary. Fixed: use confidence_at_signal only;
//   velocity_at_signal is only used as a tiebreaker when confidence is equal.
//
// BUG 6 — `var confidence` inside an if-block at Take-It-Now NBA path creates
//   function-scoped variable that leaks across signal classifiers. All
//   confidence declarations unified to `const` scoped per-block.
//
// BUG 7 — alreadyRecommended set is built from bestSignalPerPlayer BEFORE the
//   accuracy gate loop, so signals that will later be gated are still counted
//   as "already recommended" and block trap warnings for those players.
//   alreadyRecommended is now built AFTER the accuracy gate loop from only
//   the signals that actually passed.
//
// BUG 8 — accuracyMap (used by shouldFlip) does not exclude is_gated=false
//   rows. Gated records (wrong outcomes) contaminate flip detection, causing
//   the flip logic to fire on signals that are gated for good reason.
//   Fixed: accuracyRows query adds .eq("is_gated", false) filter.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

// BUG 1+2 FIX: classify signal type first, then kill-check immediately
function classifySignalType(
  snapshots: any[],
  velocityPerHour: number,
  lineDiff: number,
  live: boolean
): string {
  // Cascade: ≥3 snapshots, ≥80% directional consistency
  const isCascade = snapshots.length >= 3 && (() => {
    const diffs: number[] = [];
    for (let i = 1; i < snapshots.length; i++) diffs.push(snapshots[i].line - snapshots[i - 1].line);
    const allSame = diffs.every(d => d > 0) || diffs.every(d => d < 0);
    const consistency = diffs.filter(d => Math.sign(d) === Math.sign(lineDiff)).length / diffs.length;
    return allSame || consistency >= 0.8;
  })();

  // BUG 1 FIX: cascade wins over velocity_spike when both conditions are true.
  // Cascade = confirmed directional structure; velocity_spike = raw speed.
  // If it's structured AND fast, trust the structure over the speed.
  if (isCascade) return live ? "live_cascade" : "cascade";

  // Velocity spike: high velocity with sufficient snapshots
  const isVelocitySpike = velocityPerHour >= 4.0 && snapshots.length >= 3;
  if (isVelocitySpike) return live ? "live_velocity_spike" : "velocity_spike";

  return live ? "live_line_about_to_move" : "line_about_to_move";
}

function isKilledSignal(signalType: string, propType: string): boolean {
  if (signalType === "velocity_spike" && KILLED_VELOCITY_MARKETS.has(propType)) return true;
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
const TEAM_MARKET_TYPES = new Set(["h2h", "moneyline", "spreads", "totals"]);

function getSignalPriority(record: any): number {
  const { signal_type, prop_type } = record;
  if (signal_type?.startsWith("perfect_line")) return 0;
  if (signal_type?.startsWith("scale_in")) return 0;
  if (signal_type === "take_it_now" && (prop_type === "player_rebounds" || prop_type === "spreads")) return 1;
  if (COMBO_PROPS.has(prop_type)) return 2;
  if (signal_type === "line_about_to_move" && prop_type === "player_points") return 3;
  if (signal_type === "take_it_now" && prop_type === "moneyline") return 4;
  if (signal_type === "velocity_spike") return 5;
  if (signal_type === "take_it_now") return 6;
  if (signal_type === "cascade") return 7;
  return 8;
}

const PROP_MIN_VELOCITY: Record<string, number> = {
  player_points: 1.0, player_rebounds: 0.8, player_threes: 0.8,
  player_points_rebounds_assists: 0.8, player_rebounds_assists: 0.8,
  player_points_assists: 0.8, player_points_rebounds: 0.8,
  h2h_mma: 3.0, totals_soccer: 0.5, spreads_soccer: 0.5,
  h2h_soccer: 1.5, h2h_lacrosse: 1.5,
};

const PROP_MIN_DRIFT_PCT: Record<string, number> = {
  player_rebounds: 4, player_points: 4, player_threes: 5,
};

function fmtOdds(price: number | null | undefined): string {
  if (!price) return "";
  return price > 0 ? `+${price}` : `${price}`;
}

function fdLineBadge(line: number, overPrice: number | null, underPrice: number | null, side: string, propType?: string): string {
  if (propType === "moneyline" || propType === "h2h") return `📗 *FanDuel Odds: ${fmtOdds(line)}*`;
  const actionOdds = side === "OVER" ? overPrice : underPrice;
  const oddsStr = actionOdds ? ` (${fmtOdds(actionOdds)})` : "";
  return `📗 *FanDuel Line: ${line}${oddsStr}*`;
}

function isMoneylineProp(propType: string): boolean {
  return propType === "moneyline" || propType === "h2h";
}

function fmtAltOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const log = (msg: string) => console.log(`[Prediction Alerts] ${msg}`);
  const now = new Date();

  // Owner rules
  let ownerRules: Array<{ rule_key: string; rule_logic: Record<string, unknown>; enforcement: string }> = [];
  try {
    const { data: rulesData } = await supabase
      .from("bot_owner_rules").select("rule_key, rule_logic, enforcement")
      .eq("is_active", true).contains("applies_to", ["fanduel-prediction-alerts"]);
    ownerRules = (rulesData || []) as any;
    if (ownerRules.length > 0) log(`Loaded ${ownerRules.length} owner rules`);
  } catch (_) {}

  try {
    log("=== FanDuel Prediction Alerts v3.0 ===");

    const ALERT_WINDOW_MS = 20 * 60 * 1000;
    const windowAgo = new Date(now.getTime() - ALERT_WINDOW_MS).toISOString();

    const [timelineRes, patternsRes, accuracyRes] = await Promise.all([
      supabase.from("fanduel_line_timeline").select("*")
        .gte("snapshot_time", windowAgo)
        .order("snapshot_time", { ascending: true })
        .limit(3000),
      supabase.from("fanduel_behavior_patterns").select("*").gte("sample_size", 3),
      // BUG 8 FIX: exclude is_gated rows from accuracy so flip logic isn't poisoned
      supabase.from("fanduel_prediction_accuracy")
        .select("signal_type, prop_type, was_correct, settlement_method")
        .not("was_correct", "is", null)
        .gte("created_at", new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .neq("actual_outcome", "informational_excluded")
        .eq("is_gated", false),  // BUG 8 FIX
    ]);

    if (timelineRes.error) throw new Error(`Timeline fetch: ${timelineRes.error.message}`);

    const recentData = timelineRes.data || [];
    const patterns = patternsRes.data || [];

    // Build split accuracy maps (CLV vs outcome)
    const accuracyMap = new Map<string, { correct: number; total: number }>();
    const clvAccuracyMap = new Map<string, { correct: number; total: number }>();
    const outcomeAccuracyMap = new Map<string, { correct: number; total: number }>();

    for (const row of accuracyRes.data || []) {
      const key = `${row.signal_type}|${row.prop_type}`;
      const inc = (m: Map<string, any>, k: string, hit: boolean) => {
        if (!m.has(k)) m.set(k, { correct: 0, total: 0 });
        const e = m.get(k)!; e.total++; if (hit) e.correct++;
      };
      inc(accuracyMap, key, row.was_correct);
      if (row.settlement_method === "outcome") inc(outcomeAccuracyMap, key, row.was_correct);
      else inc(clvAccuracyMap, key, row.was_correct);
    }

    function dynamicAccBadge(signalType: string, propType: string): string {
      const key = `${signalType}|${propType}`;
      const outcome = outcomeAccuracyMap.get(key);
      const clv = clvAccuracyMap.get(key);
      const combined = accuracyMap.get(key);
      const best = (outcome && outcome.total >= 5) ? { ...outcome, method: "outcome" }
        : (clv && clv.total >= 5) ? { ...clv, method: "CLV" }
        : (combined && combined.total >= 5) ? { ...combined, method: "mixed" }
        : null;
      if (!best) return "";
      const pct = ((best.correct / best.total) * 100).toFixed(1);
      const rate = best.correct / best.total;
      const emoji = rate >= 0.6 ? "🔥" : rate >= 0.5 ? "📈" : "⚠️";
      const tag = best.method !== "mixed" ? ` [${best.method}]` : "";
      return `${emoji} Historical: ${pct}% (${best.correct}/${best.total}${tag})`;
    }

    const ACCURACY_GATE_MIN_SAMPLES = 10;
    const ACCURACY_GATE_THRESHOLD = 0.70;
    const FLIP_MIN_SAMPLES = 15;
    const FLIP_THRESHOLD = 0.40;
    const FORCE_FLIP_THRESHOLD = 0.35;
    const FORCE_FLIP_MIN_SAMPLES = 50;
    const FORCE_FLIP_PROP_TYPES = new Set(["player_rebounds", "player_assists", "player_rebounds_assists"]);

    function isAccuracyGated(signalType: string, propType: string): boolean {
      const key = `${signalType}|${propType}`;
      for (const [map, label] of [[outcomeAccuracyMap, "outcome"], [clvAccuracyMap, "CLV"], [accuracyMap, "combined"]] as const) {
        const s = (map as Map<string, any>).get(key);
        if (s && s.total >= ACCURACY_GATE_MIN_SAMPLES) {
          const rate = s.correct / s.total;
          if (rate < ACCURACY_GATE_THRESHOLD) {
            log(`🚫 GATE (${label}): ${key} → ${(rate*100).toFixed(1)}% < 70% (n=${s.total})`);
            return true;
          }
        }
      }
      return false;
    }

    function shouldFlip(signalType: string, propType: string): { flip: boolean; winRate: number; samples: number } {
      const key = `${signalType}|${propType}`;
      const stats = accuracyMap.get(key);
      if (!stats || stats.total < FLIP_MIN_SAMPLES) return { flip: false, winRate: 0, samples: 0 };
      const rate = stats.correct / stats.total;
      if (rate < FLIP_THRESHOLD) return { flip: true, winRate: rate, samples: stats.total };
      return { flip: false, winRate: rate, samples: stats.total };
    }

    function flipSide(side: string): string {
      return side === "OVER" ? "UNDER" : side === "UNDER" ? "OVER"
        : side === "BACK" ? "FADE" : side === "FADE" ? "BACK" : side;
    }

    function flipPrediction(prediction: string, currentLine?: number): string {
      if (prediction.startsWith("OVER ")) return prediction.replace("OVER ", "UNDER ");
      if (prediction.startsWith("UNDER ")) return prediction.replace("UNDER ", "OVER ");
      if (prediction.startsWith("BACK ")) return prediction.replace("BACK ", "FADE ");
      if (prediction.startsWith("FADE ")) return prediction.replace("FADE ", "BACK ");
      const upper = prediction.toUpperCase();
      if (upper.includes("DROPPING") || upper.includes("UNDER")) {
        return currentLine != null ? `OVER ${currentLine} (flipped)` : `OVER (flipped — ${prediction.substring(0, 40)})`;
      }
      if (upper.includes("RISING") || upper.includes("OVER")) {
        return currentLine != null ? `UNDER ${currentLine} (flipped)` : `UNDER (flipped — ${prediction.substring(0, 40)})`;
      }
      return prediction;
    }

    if (recentData.length === 0) {
      log("No recent data");
      return new Response(JSON.stringify({ success: true, alerts: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const activeData = recentData.filter((r: any) =>
      typeof r.hours_to_tip !== "number" || r.hours_to_tip > -3
    );
    log(`Active records: ${activeData.length} (excluded ${recentData.length - activeData.length} finished)`);

    if (activeData.length === 0) {
      return new Response(JSON.stringify({ success: true, alerts: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Group by event|player|prop
    const groups = new Map<string, any[]>();
    for (const row of activeData) {
      const key = `${row.event_id}|${row.player_name}|${row.prop_type}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    // ── Stat field maps ──
    const STAT_FIELD_MAP: Record<string, string> = {
      player_points: "points", player_rebounds: "rebounds",
      player_assists: "assists", player_threes: "threes_made",
      pitcher_strikeouts: "pitcher_strikeouts", pitcher_outs: "pitcher_outs",
    };
    const COMBO_STAT_FIELDS: Record<string, string[]> = {
      player_points_rebounds_assists: ["points", "rebounds", "assists"],
      player_points_rebounds: ["points", "rebounds"],
      player_points_assists: ["points", "assists"],
      player_rebounds_assists: ["rebounds", "assists"],
    };
    const MLB_PROP_TYPES = new Set([
      "pitcher_strikeouts", "pitcher_outs", "pitcher_hits_allowed", "pitcher_earned_runs",
      "hits", "total_bases", "runs", "rbis", "stolen_bases", "batter_home_runs",
      "batter_hits", "batter_rbis", "batter_runs_scored", "batter_total_bases",
      "batter_stolen_bases", "batter_walks",
    ]);
    const MLB_STAT_MAP: Record<string, string> = {
      pitcher_strikeouts: "pitcher_strikeouts", pitcher_outs: "pitcher_outs",
      pitcher_hits_allowed: "pitcher_hits_allowed", pitcher_earned_runs: "earned_runs",
      hits: "hits", batter_hits: "hits", total_bases: "total_bases",
      batter_total_bases: "total_bases", runs: "runs", batter_runs_scored: "runs",
      rbis: "rbis", batter_rbis: "rbis", stolen_bases: "stolen_bases",
      batter_stolen_bases: "stolen_bases", batter_home_runs: "home_runs", batter_walks: "walks",
    };

    const allPlayerNames = [...new Set(
      activeData.filter((r: any) => !TEAM_MARKET_TYPES.has(r.prop_type))
        .map((r: any) => r.player_name).filter(Boolean)
    )];
    const mlbPlayerNames = [...new Set(
      activeData.filter((r: any) => MLB_PROP_TYPES.has(r.prop_type))
        .map((r: any) => r.player_name).filter(Boolean)
    )];

    // Fetch game logs + matchup history + standings in parallel
    const [l10LogsRes, matchupHistRes, mlbLogsRes, standingsRes, aliasesRes, nhlTeamsRes] = await Promise.all([
      allPlayerNames.length > 0
        ? supabase.from("nba_player_game_logs")
          .select("player_name, opponent, game_date, points, rebounds, assists, threes_made")
          .in("player_name", allPlayerNames).order("game_date", { ascending: false }).limit(5000)
        : Promise.resolve({ data: [] }),
      allPlayerNames.length > 0
        ? supabase.from("matchup_history")
          .select("player_name, opponent, prop_type, avg_stat, hit_rate_over, hit_rate_under, games_played, min_stat, max_stat")
          .in("player_name", allPlayerNames)
        : Promise.resolve({ data: [] }),
      mlbPlayerNames.length > 0
        ? supabase.from("mlb_player_game_logs")
          .select("player_name, opponent, game_date, pitcher_strikeouts, innings_pitched, hits, runs, rbis, total_bases, home_runs, stolen_bases, walks, strikeouts, earned_runs, pitcher_hits_allowed, at_bats")
          .in("player_name", mlbPlayerNames).order("game_date", { ascending: false })
          .limit(mlbPlayerNames.length * 15)
        : Promise.resolve({ data: [] }),
      supabase.from("team_season_standings").select("team_name, sport, wins, losses, win_pct, points_for, points_against"),
      supabase.from("team_aliases").select("team_name, aliases, team_abbreviation"),
      supabase.from("nhl_team_pace_stats").select("team_name, goals_for_per_game, goals_against_per_game, wins, losses, ot_losses"),
    ]);

    // Build player L10 lookup
    const playerL10 = new Map<string, any[]>();
    for (const gl of (l10LogsRes.data || [])) {
      const key = gl.player_name?.toLowerCase();
      if (!key) continue;
      if (!playerL10.has(key)) playerL10.set(key, []);
      if (playerL10.get(key)!.length < 10) playerL10.get(key)!.push(gl);
    }

    // Build MLB player logs lookup
    const mlbPlayerLogs = new Map<string, any[]>();
    for (const gl of (mlbLogsRes.data || [])) {
      const key = gl.player_name?.toLowerCase();
      if (!key) continue;
      if (!mlbPlayerLogs.has(key)) mlbPlayerLogs.set(key, []);
      mlbPlayerLogs.get(key)!.push(gl);
    }

    // Build matchup lookup
    const matchupLookup = new Map<string, any>();
    for (const m of (matchupHistRes.data || [])) {
      matchupLookup.set(`${m.player_name.toLowerCase()}|${m.opponent?.toLowerCase()}|${m.prop_type}`, m);
    }

    // Build team stats map
    const teamStatsMap = new Map<string, any>();
    for (const s of (standingsRes.data || [])) {
      teamStatsMap.set(s.team_name.toLowerCase(), {
        win_pct: Number(s.win_pct || 0),
        ppg: s.points_for ? Number(s.points_for) : null,
        oppg: s.points_against ? Number(s.points_against) : null,
      });
    }
    for (const t of (nhlTeamsRes.data || [])) {
      const total = (t.wins || 0) + (t.losses || 0) + (t.ot_losses || 0);
      teamStatsMap.set(t.team_name.toLowerCase(), {
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

    // Minutes volatility
    const sportLogTables = ["nba_player_game_logs", "ncaab_player_game_logs", "nhl_player_game_logs"];
    const minLogResults = await Promise.all(
      sportLogTables.map(table =>
        allPlayerNames.length > 0
          ? supabase.from(table).select("player_name, min").in("player_name", allPlayerNames)
            .order("game_date", { ascending: false }).limit(allPlayerNames.length * 10)
          : Promise.resolve({ data: [] })
      )
    );

    const volatilityMap = new Map<string, { isVolatile: boolean; cv: number; avgMin: number }>();
    const minByPlayer = new Map<string, number[]>();
    for (const res of minLogResults) {
      for (const row of (res.data || [])) {
        const name = (row.player_name || "").toLowerCase().trim();
        if (!name) continue;
        const mins = typeof row.min === "string" ? parseFloat(row.min) : (row.min ? parseFloat(String(row.min)) : 0);
        if (mins <= 0) continue;
        const arr = minByPlayer.get(name) || [];
        if (arr.length < 10) { arr.push(mins); minByPlayer.set(name, arr); }
      }
    }
    for (const [name, minutes] of minByPlayer) {
      if (minutes.length < 3) continue;
      const avg = minutes.reduce((a, b) => a + b, 0) / minutes.length;
      const variance = minutes.reduce((s, m) => s + (m - avg) ** 2, 0) / minutes.length;
      const cv = Math.sqrt(variance) / (avg || 1);
      volatilityMap.set(name, { isVolatile: cv > 0.20, cv, avgMin: avg });
    }

    function getVolatilityWarning(playerName: string): string {
      const v = volatilityMap.get((playerName || "").toLowerCase().trim());
      if (!v || !v.isVolatile) return "";
      return `⚠️ VOLATILE MINUTES — L10 avg ${v.avgMin.toFixed(0)}min (CV ${(v.cv * 100).toFixed(0)}%)`;
    }

    // Alt line fetcher with cache
    const SPORT_KEY_MAP: Record<string, string> = {
      NBA: "basketball_nba", NCAAB: "basketball_ncaab", MLB: "baseball_mlb",
      NHL: "icehockey_nhl", NFL: "americanfootball_nfl", MMA: "mma_mixed_martial_arts",
      UFC: "mma_mixed_martial_arts", MLS: "soccer_usa_mls", EPL: "soccer_epl",
      SOCCER: "soccer_usa_mls", LACROSSE: "lacrosse_pll", PLL: "lacrosse_pll",
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
      if (isMoneylineProp(propType)) return null;
      const cacheKey = `${eventId}|${playerName}|${propType}`;
      if (altLineCache.has(cacheKey)) return altLineCache.get(cacheKey)!;
      const altPropKey = PROP_TO_ALT_KEY[propType];
      if (!altPropKey) { altLineCache.set(cacheKey, null); return null; }
      const sportKey = SPORT_KEY_MAP[sport?.toUpperCase()] || "basketball_nba";
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/fetch-alternate-lines`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ eventId, playerName, propType: altPropKey, sport: sportKey }),
        });
        if (!resp.ok) { altLineCache.set(cacheKey, null); return null; }
        const data = await resp.json();
        const lines: any[] = data.lines || [];
        if (lines.length === 0) { altLineCache.set(cacheKey, null); return null; }
        let picked: { line: number; odds: number } | null = null;
        if (side === "OVER") {
          const candidates = lines.filter(l => l.line < currentLine).sort((a, b) => b.line - a.line);
          if (candidates.length > 0) picked = { line: candidates[0].line, odds: candidates[0].overOdds };
        } else if (side === "UNDER") {
          const candidates = lines.filter(l => l.line > currentLine).sort((a, b) => a.line - b.line);
          if (candidates.length > 0) picked = { line: candidates[0].line, odds: candidates[0].underOdds };
        }
        altLineCache.set(cacheKey, picked);
        return picked;
      } catch {
        altLineCache.set(cacheKey, null);
        return null;
      }
    }

    async function getAltLineText(currentLine: number | null, side: string, propType: string, playerName: string, eventId: string, sport: string): Promise<string> {
      if (currentLine == null) return "";
      const alt = await fetchRealAltLine(eventId, playerName, propType, side, currentLine, sport);
      if (!alt) return "🎯 Alt Line: unavailable";
      return `🎯 Alt Line (FanDuel): ${side} ${alt.line} (${fmtAltOdds(alt.odds)})`;
    }

    // ── Cross-reference gate (player props) ──
    function crossReferenceGate(playerName: string, propType: string, line: number, side: string, eventDesc: string): {
      pass: boolean; l10Avg: number | null; l10HitRate: number | null; matchupAvg: number | null; reason: string; badge: string; l3Avg?: number | null;
    } {
      const pLower = playerName.toLowerCase();
      const noData = { pass: true, l10Avg: null, l10HitRate: null, matchupAvg: null, reason: "no_data", badge: "", l3Avg: null };

      // MLB
      const mlbStatCol = MLB_STAT_MAP[propType];
      if (mlbStatCol) {
        const logs = mlbPlayerLogs.get(pLower) || [];
        const isPitcherProp = propType.startsWith("pitcher_");
        const relevantLogs = isPitcherProp
          ? logs.filter((l: any) => l.pitcher_strikeouts != null && l.innings_pitched != null && l.innings_pitched > 0)
          : logs;
        if (relevantLogs.length < 3) return noData;
        const l10Logs = relevantLogs.slice(0, 10);
        const l3Logs = relevantLogs.slice(0, 3);
        const l10Values = l10Logs.map((gl: any) => Number(gl[mlbStatCol]) || 0);
        const l3Values = l3Logs.map((gl: any) => Number(gl[mlbStatCol]) || 0);
        const l10Avg = l10Values.reduce((a, b) => a + b, 0) / l10Values.length;
        const l3Avg = l3Values.reduce((a, b) => a + b, 0) / l3Values.length;
        const l10Hits = l10Values.filter((v) => side === "OVER" ? v > line : v < line).length;
        const l10HitRate = l10Hits / l10Values.length;
        const isOver = side === "OVER";
        const avgVsLine = isOver ? l10Avg - line : line - l10Avg;
        // BUG 3 FIX: guard against line=0 division
        const pctEdge = line > 0 ? (avgVsLine / line) * 100 : 0;
        if (pctEdge < -10 && l10HitRate < 0.30) {
          return { pass: false, l10Avg, l10HitRate, matchupAvg: null, l3Avg, reason: `L10 avg ${l10Avg.toFixed(1)} | L3 avg ${l3Avg.toFixed(1)} — ${(l10HitRate * 100).toFixed(0)}% hit rate vs line ${line}`, badge: "" };
        }
        if (isPitcherProp && l3Values.length >= 3) {
          const l3VsLine = isOver ? l3Avg - line : line - l3Avg;
          const l3Edge = line > 0 ? (l3VsLine / line) * 100 : 0;
          if (l3Edge < -15) {
            return { pass: false, l10Avg, l10HitRate, matchupAvg: null, l3Avg, reason: `Pitcher K gate: L3 avg ${l3Avg.toFixed(1)} trending away from ${side} ${line}`, badge: "" };
          }
        }
        let badge = `📊 L10 Avg: ${l10Avg.toFixed(1)} | L3 Avg: ${l3Avg.toFixed(1)} | L10 Hit: ${(l10HitRate * 100).toFixed(0)}%`;
        if (l10HitRate >= 0.70) badge += " ✅"; else if (l10HitRate >= 0.50) badge += " ⚠️"; else badge += " 🔻";
        return { pass: true, l10Avg, l10HitRate, matchupAvg: null, reason: "validated", badge, l3Avg };
      }

      // NBA/NCAAB
      const logs = playerL10.get(pLower) || [];
      if (logs.length < 3) return noData;
      const statFields = COMBO_STAT_FIELDS[propType] || (STAT_FIELD_MAP[propType] ? [STAT_FIELD_MAP[propType]] : null);
      if (!statFields) return noData;
      const l10Values = logs.slice(0, 10).map((gl: any) =>
        statFields.reduce((sum: number, f: string) => sum + (Number(gl[f]) || 0), 0)
      );
      const l10Avg = l10Values.reduce((a, b) => a + b, 0) / l10Values.length;
      const l10Hits = l10Values.filter((v) => side === "OVER" ? v > line : v < line).length;
      const l10HitRate = l10Hits / l10Values.length;
      const isOver = side === "OVER";
      const avgVsLine = isOver ? l10Avg - line : line - l10Avg;
      // BUG 3 FIX: guard against line=0
      const pctEdge = line > 0 ? (avgVsLine / line) * 100 : 0;
      let matchupAvg: number | null = null;
      let matchupHitRate: number | null = null;
      const edLower = (eventDesc || "").toLowerCase();
      for (const [mKey, m] of matchupLookup) {
        if (!mKey.startsWith(`${pLower}|`)) continue;
        if (!mKey.endsWith(`|${propType}`)) continue;
        const oppWords = mKey.split("|")[1].split(/\s+/);
        if (oppWords.some((w: string) => w.length > 3 && edLower.includes(w))) {
          matchupAvg = Number(m.avg_stat);
          matchupHitRate = side === "OVER" ? Number(m.hit_rate_over || 0) : Number(m.hit_rate_under || 0);
          break;
        }
      }
      if (pctEdge < -10 && l10HitRate < 0.30) {
        return { pass: false, l10Avg, l10HitRate, matchupAvg, reason: `L10 avg ${l10Avg.toFixed(1)} — ${(l10HitRate * 100).toFixed(0)}% hit rate vs line ${line}`, badge: "" };
      }
      if (pctEdge < -5 && l10HitRate < 0.40 && matchupHitRate !== null && matchupHitRate < 0.40) {
        return { pass: false, l10Avg, l10HitRate, matchupAvg, reason: `L10 + matchup both fail vs line ${line}`, badge: "" };
      }
      let badge = `📊 L10 Avg: ${l10Avg.toFixed(1)} | L10 Hit: ${(l10HitRate * 100).toFixed(0)}%`;
      if (matchupAvg !== null) badge += ` | vs Opp: ${matchupAvg.toFixed(1)}`;
      if (l10HitRate >= 0.70) badge += " ✅"; else if (l10HitRate >= 0.50) badge += " ⚠️"; else badge += " 🔻";
      return { pass: true, l10Avg, l10HitRate, matchupAvg, reason: "validated", badge };
    }

    // ── Team cross-reference gate ──
    function teamCrossReferenceGate(teamName: string, propType: string, line: number, side: string, eventDesc: string): { pass: boolean; reason: string; badge: string } {
      const resolved = resolveTeamName(teamName);
      if (!resolved) return { pass: true, reason: "no_team_data", badge: "" };
      const stats = teamStatsMap.get(resolved.toLowerCase());
      if (!stats) return { pass: true, reason: "no_stats", badge: "" };
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
        const diff = winPct - oppWinPct;
        if ((side === "OVER" || side === "BACK") && winPct < 0.50 && oppWinPct >= 0.50)
          return { pass: false, reason: `${resolved} sub-.500 underdog ML trap`, badge: "" };
        if ((side === "OVER" || side === "BACK") && diff < -0.10)
          return { pass: false, reason: `${resolved} ${Math.abs(diff*100).toFixed(0)}% gap too wide`, badge: "" };
        if ((side === "UNDER" || side === "FADE") && winPct > 0.55)
          return { pass: false, reason: `${resolved} ${(winPct*100).toFixed(0)}% WR — fading a winning team`, badge: "" };
        const verdict = diff > 0.05 ? " ✅" : diff < -0.05 ? " ⚠️" : "";
        return { pass: true, reason: "validated", badge: `📊 ${resolved}: ${(winPct*100).toFixed(0)}% W${oppStats ? ` | Opp: ${(oppStats.win_pct*100).toFixed(0)}% W` : ""}${verdict}` };
      }
      if (propType === "totals") {
        if (!stats.ppg || !oppStats?.ppg) return { pass: true, reason: "missing_ppg", badge: "" };
        const projTotal = stats.ppg + oppStats.ppg;
        const edge = side === "OVER" ? projTotal - line : line - projTotal;
        // BUG 3 FIX: guard against line=0
        const pctEdge = line > 0 ? (edge / line) * 100 : 0;
        if (pctEdge < -8) return { pass: false, reason: `Projected ${projTotal.toFixed(1)} contradicts ${side} ${line}`, badge: "" };
        return { pass: true, reason: "validated", badge: `📊 Projected: ${projTotal.toFixed(1)}${pctEdge > 0 ? " ✅" : " ⚠️"}` };
      }
      if (propType === "spreads") {
        if (!stats.ppg || !stats.oppg) return { pass: true, reason: "missing_diff", badge: "" };
        const ptDiff = stats.ppg - stats.oppg;
        const oppPtDiff = oppStats ? (oppStats.ppg || 0) - (oppStats.oppg || 0) : 0;
        const projMargin = (ptDiff - oppPtDiff) / 2;
        const edge = projMargin - (-line);
        if (side === "COVER" && Math.abs(line) >= 10) return { pass: false, reason: `COVER blocked on spread ${line} — 0% historical`, badge: "" };
        if (side === "COVER" && edge < -5) return { pass: false, reason: `Margin ${projMargin.toFixed(1)} doesn't cover ${line}`, badge: "" };
        if (side === "FADE" && edge > 5) return { pass: false, reason: `Margin ${projMargin.toFixed(1)} suggests cover not fade`, badge: "" };
        if (side === "COVER" && Math.abs(edge) < 3) return { pass: false, reason: `COVER edge too thin (${edge.toFixed(1)} pts)`, badge: "" };
        return { pass: true, reason: "validated", badge: `📊 Margin: ${projMargin > 0 ? "+" : ""}${projMargin.toFixed(1)} | Spread: ${line}${Math.abs(edge) > 2 ? " ✅" : " ⚠️"}` };
      }
      return { pass: true, reason: "unknown_market", badge: "" };
    }

    // Build event matchup labels
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

    const esc = (s: string) => (s || "").replace(/_/g, " ").replace(/\*/g, "");
    const isLive = (r: any) => r.snapshot_phase === "live" || (typeof r.hours_to_tip === "number" && r.hours_to_tip <= 0);

    // Readable prop labels for user-facing messages
    const READABLE_PROP_LABELS: Record<string, string> = {
      player_points: "Points", player_rebounds: "Rebounds", player_assists: "Assists",
      player_threes: "3-Pointers", player_blocks: "Blocks", player_steals: "Steals",
      player_turnovers: "Turnovers", player_points_rebounds_assists: "Pts + Reb + Ast",
      player_points_rebounds: "Pts + Reb", player_points_assists: "Pts + Ast",
      player_rebounds_assists: "Reb + Ast", player_fantasy_score: "Fantasy Score",
      player_double_double: "Double-Double",
      pitcher_strikeouts: "Strikeouts", pitcher_outs: "Outs",
      batter_hits: "Hits", batter_rbis: "RBI", batter_runs_scored: "Runs",
      batter_total_bases: "Total Bases", batter_home_runs: "Home Runs",
      batter_stolen_bases: "Stolen Bases", batter_walks: "Walks",
      h2h: "Moneyline", moneyline: "Moneyline", spreads: "Spread", totals: "Total",
    };
    function readablePropLabel(propType: string): string {
      return READABLE_PROP_LABELS[propType] || propType.replace(/^(player_|batter_|pitcher_)/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    }
    function getSportEmojiAlert(sport: string): string {
      const s = (sport || "").toUpperCase();
      if (s.includes("NBA") || s.includes("NCAAB")) return "🏀";
      if (s.includes("MLB") || s.includes("BASEBALL")) return "⚾";
      if (s.includes("NHL") || s.includes("HOCKEY")) return "🏒";
      if (s.includes("NFL") || s.includes("NCAAF")) return "🏈";
      if (s.includes("MMA") || s.includes("UFC")) return "🥊";
      if (s.includes("SOCCER") || s.includes("MLS") || s.includes("EPL")) return "⚽";
      return "🎯";
    }

    const bestSignalPerPlayer = new Map<string, { confidence: number; alert: string; record: any }>();
    const addSignal = (playerKey: string, confidence: number, alert: string, record: any) => {
      const existing = bestSignalPerPlayer.get(playerKey);
      if (!existing || confidence > existing.confidence) bestSignalPerPlayer.set(playerKey, { confidence, alert, record });
    };

    // ════════════════════════════════════════════════════════
    // SIGNAL: LINE ABOUT TO MOVE / VELOCITY SPIKE / CASCADE
    // ════════════════════════════════════════════════════════
    for (const [, snapshots] of groups) {
      if (snapshots.length < 2) continue;
      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      const timeDiffMin = (new Date(last.snapshot_time).getTime() - new Date(first.snapshot_time).getTime()) / 60000;
      if (timeDiffMin < 3) continue;

      const lineDiff = last.line - first.line;
      const absLineDiff = Math.abs(lineDiff);
      const velocityPerHour = (absLineDiff / timeDiffMin) * 60;

      const minVelocity = PROP_MIN_VELOCITY[first.prop_type] || 1.5;
      if (velocityPerHour < minVelocity) continue;

      const live = isLive(last);

      // BUG 1+2 FIX: classify FIRST, kill-check immediately BEFORE any other work
      const classifiedSignalType = classifySignalType(snapshots, velocityPerHour, lineDiff, live);
      if (isKilledSignal(classifiedSignalType, first.prop_type)) {
        log(`🚫 KILLED ${classifiedSignalType} on ${first.prop_type}`);
        continue;
      }

      // BUG 4 FIX: only apply learnedAvgVelocity filter to velocity_spike signals
      const learnedPattern = (patterns || []).find(
        (p: any) => p.sport === first.sport && p.prop_type === first.prop_type && p.pattern_type === "velocity_spike"
      );
      const learnedAvgVelocity = learnedPattern?.velocity_threshold || 2.0;
      if (classifiedSignalType.includes("velocity_spike") && velocityPerHour <= learnedAvgVelocity * 0.8) {
        continue;
      }

      const direction = lineDiff < 0 ? "DROPPING" : "RISING";
      const side = lineDiff < 0 ? "UNDER" : "OVER";
      const isCombo = COMBO_PROPS.has(first.prop_type);

      // Cross-reference gate
      const isPlayerProp = !TEAM_MARKET_TYPES.has(first.prop_type);
      let crossRefBadge = "";
      if (isPlayerProp) {
        const gate = crossReferenceGate(first.player_name, first.prop_type, last.line, side, last.event_description || "");
        if (!gate.pass) { log(`🚫 BLOCKED ${first.player_name} ${first.prop_type}: ${gate.reason}`); continue; }
        crossRefBadge = gate.badge;
      } else {
        const tGate = teamCrossReferenceGate(first.player_name, first.prop_type, last.line, side, last.event_description || "");
        if (!tGate.pass) { log(`🚫 BLOCKED TEAM ${first.player_name} ${first.prop_type}: ${tGate.reason}`); continue; }
        crossRefBadge = tGate.badge;
      }

      // BUG 6 FIX: use const for all confidence computations
      const comboBoost = isCombo ? 15 : 0;
      const confidence = Math.min(95, 50 + velocityPerHour * 12 + comboBoost);
      if (confidence < 60) continue;

      const elapsed = Math.round(timeDiffMin);
      const avgReaction = learnedPattern?.avg_reaction_time_minutes || 12;
      const remaining = Math.max(0, avgReaction - elapsed);
      const accuracyBadge = dynamicAccBadge(classifiedSignalType, first.prop_type);
      const volWarning = getVolatilityWarning(first.player_name);
      const altLineText = await getAltLineText(last.line, side, first.prop_type, first.player_name, first.event_id, first.sport);
      const volInfo = volatilityMap.get((first.player_name || "").toLowerCase().trim());
      const isTeamMarket = TEAM_MARKET_TYPES.has(first.prop_type);
      const matchupLine = isTeamMarket ? eventMatchup.get(first.event_id) : null;

      // Readable prop + signal labels
      const readableProp = readablePropLabel(first.prop_type);
      const sportEmoji = getSportEmojiAlert(first.sport);
      const signalLabel = classifiedSignalType.includes("velocity_spike") ? "SHARP MONEY SPIKE"
        : classifiedSignalType.includes("cascade") ? "SUSTAINED LINE MOVE"
        : live ? "LINE MOVING NOW" : "EARLY LINE SIGNAL";
      const signalEmoji = classifiedSignalType.includes("velocity_spike") ? "⚡"
        : classifiedSignalType.includes("cascade") ? "🌊" : "🔮";
      const liveTag = live ? " [🔴 LIVE]" : "";

      // Why this matters — contextual narrative per signal type
      const whyNarrative = classifiedSignalType.includes("velocity_spike")
        ? `Sharp money is pushing this ${side} hard — line jumped ${absLineDiff.toFixed(1)} pts in ${elapsed} min. Books are adjusting because they're exposed.`
        : classifiedSignalType.includes("cascade")
        ? `This isn't a one-time blip — the line has moved consistently across ${snapshots.length} snapshots. Institutional money is building a position ${side.toLowerCase()}.`
        : `Line is drifting ${direction.toLowerCase()} ahead of game time. Early movers usually have an information edge — this is the window to act.`;

      // L10 context line
      const crossRefData = crossReferenceGate(first.player_name, first.prop_type, last.line, side, last.event_description || "");
      const l10Context = crossRefData.l10Avg != null && crossRefData.l10HitRate != null
        ? `📊 L10 avg ${crossRefData.l10Avg.toFixed(1)} | Clears line ${(crossRefData.l10HitRate * 100).toFixed(0)}% of games`
        : null;

      const alertText = [
        `${signalEmoji} *${signalLabel}*${liveTag} — ${esc(first.sport)}`,
        matchupLine ? `🏟 ${esc(matchupLine)}` : null,
        ``,
        `${sportEmoji} *${esc(first.player_name)}* — ${readableProp}`,
        isMoneylineProp(first.prop_type)
          ? `📍 ${fmtOdds(last.line)}`
          : `📍 ${last.line} (was ${first.line}) — moved ${direction.toLowerCase()}`,
        ``,
        `🧠 *Why this matters:*`,
        whyNarrative,
        ``,
        l10Context || null,
        live ? `⏱ In-game shift detected` : remaining > 0 ? `⏱ ~${remaining} min before line locks` : null,
        volWarning || null,
        altLineText || null,
        ``,
        isMoneylineProp(first.prop_type)
          ? `✅ *Play: ${side === "OVER" ? "TAKE" : "FADE"} ${esc(first.player_name)} (${fmtOdds(last.line)})*`
          : `✅ *Play: ${side} ${last.line} (${fmtOdds(side === "OVER" ? last.over_price : last.under_price)})*`,
        isCombo ? `🔥 *COMBO PROP* — 85-100% historical accuracy` : null,
      ].filter(Boolean).join("\n");

      const record = {
        signal_type: classifiedSignalType, sport: first.sport, prop_type: first.prop_type,
        player_name: first.player_name, event_id: first.event_id,
        prediction: `${side} ${last.line}`, predicted_direction: direction.toLowerCase(),
        predicted_magnitude: absLineDiff, confidence_at_signal: confidence,
        velocity_at_signal: velocityPerHour, time_to_tip_hours: last.hours_to_tip,
        edge_at_signal: absLineDiff,
        signal_factors: {
          velocityPerHour, timeDiffMin, lineDiff, learnedAvgVelocity, classifiedSignalType,
          currentLine: last.line, line_to: last.line, opening_line: first.line,
          is_volatile_minutes: volInfo?.isVolatile || false,
          minutes_cv: volInfo?.cv ?? null, minutes_avg: volInfo?.avgMin ?? null,
          alt_line_source: "fanduel_real",
          recommended_alt_line: (await fetchRealAltLine(first.event_id, first.player_name, first.prop_type, side, last.line, first.sport))?.line ?? null,
        },
      };

      addSignal(`${first.event_id}|${first.player_name}`, confidence, alertText, record);
    }

    // ════════════════════════════════════════════════════════
    // SIGNAL: TAKE IT NOW (Snapback)
    // ════════════════════════════════════════════════════════
    const SNAPBACK_BLOCKED_PROPS = new Set(["player_points", "player_threes"]);

    for (const [, snapshots] of groups) {
      const last = snapshots[snapshots.length - 1];
      if (!last.opening_line) continue;
      if (SNAPBACK_BLOCKED_PROPS.has(last.prop_type)) continue;

      const drift = last.line - last.opening_line;
      const absDrift = Math.abs(drift);
      const driftPct = (absDrift / last.opening_line) * 100;
      const minDrift = PROP_MIN_DRIFT_PCT[last.prop_type] || 6;
      if (driftPct < minDrift) continue;

      const isPitcherProp = last.prop_type?.startsWith("pitcher_");
      const isNbaPlayerProp = last.sport === "NBA" && !TEAM_MARKET_TYPES.has(last.prop_type) && !isPitcherProp;
      const live = isLive(last);
      const liveTag = live ? " [🔴 LIVE]" : "";

      let snapDirection: string;
      let directionReason: string;

      if (isNbaPlayerProp) {
        const pKey = (last.player_name || "").toLowerCase().trim();
        const logs = playerL10.get(pKey) || [];
        const currentLine = last.line;
        const statKey = last.prop_type?.replace("player_", "") || "";
        const statValues: number[] = [];
        for (const g of logs) {
          let val = 0;
          if (statKey === "points") val = g.pts ?? g.points ?? 0;
          else if (statKey === "rebounds") val = g.reb ?? g.rebounds ?? 0;
          else if (statKey === "assists") val = g.ast ?? g.assists ?? 0;
          else if (statKey === "threes") val = g.fg3m ?? g.threes ?? 0;
          else if (statKey === "points_rebounds_assists") val = (g.pts ?? 0) + (g.reb ?? 0) + (g.ast ?? 0);
          else if (statKey === "points_rebounds") val = (g.pts ?? 0) + (g.reb ?? 0);
          else if (statKey === "points_assists") val = (g.pts ?? 0) + (g.ast ?? 0);
          else if (statKey === "rebounds_assists") val = (g.reb ?? 0) + (g.ast ?? 0);
          else val = g.pts ?? 0;
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
        const volInfo = volatilityMap.get(pKey);
        const avgMin = volInfo?.avgMin ?? 0;
        if (avgMin > 0 && avgMin < 15) { log(`🚫 BLOCKED (TIN minutes) ${last.player_name}`); continue; }

        if (l10Avg !== null && l10Avg > currentLine && overRate >= 0.50) {
          snapDirection = "OVER";
          directionReason = `L10 avg ${l10Avg.toFixed(1)} clears line ${currentLine} (${(overRate * 100).toFixed(0)}% hit)`;
        } else if (l10Avg !== null && l10Avg < currentLine && underRate >= 0.50) {
          snapDirection = "UNDER";
          directionReason = `L10 avg ${l10Avg.toFixed(1)} below line ${currentLine} (${(underRate * 100).toFixed(0)}% hit)`;
        } else if (l3Avg !== null && l10Avg !== null && volInfo?.isVolatile && Math.abs(l3Avg - l10Avg) / l10Avg > 0.15) {
          snapDirection = l3Avg > currentLine ? "OVER" : "UNDER";
          directionReason = `Volatile: L3 ${l3Avg.toFixed(1)} vs L10 ${l10Avg.toFixed(1)} — ${l3Avg > l10Avg ? "hot" : "cold"}`;
        } else {
          snapDirection = drift > 0 ? "OVER" : "UNDER";
          directionReason = `Following market direction (${snapDirection})`;
        }
      } else {
        snapDirection = drift > 0 ? "OVER" : "UNDER";
        directionReason = `Market shift: ${last.opening_line} → ${last.line} — ${snapDirection}`;
      }

      const crossRef = crossReferenceGate(last.player_name, last.prop_type, last.line, snapDirection, last.event_description || "");
      if (!crossRef.pass) { log(`🚫 BLOCKED TIN ${last.player_name}: ${crossRef.reason}`); continue; }

      const isCombo = COMBO_PROPS.has(last.prop_type);
      const comboBoost = isCombo ? 10 : 0;
      // BUG 6 FIX: const not var
      const confidence = Math.min(92, 30 + driftPct * 3 + comboBoost);

      if (isAccuracyGated("take_it_now", last.prop_type)) { log(`🚫 GATED TIN ${last.player_name} ${last.prop_type}`); continue; }

      const volWarning = getVolatilityWarning(last.player_name);
      const altLineText = await getAltLineText(last.line, snapDirection, last.prop_type, last.player_name, last.event_id, last.sport);
      const isTeamMarket = TEAM_MARKET_TYPES.has(last.prop_type);

      // Favorites-only gate for team market snapbacks (underdogs historically 0%)
      const isMLProp = last.prop_type === 'h2h' || last.prop_type === 'moneyline';
      if (isTeamMarket && isMLProp && last.line > 0) {
        log(`🚫 BLOCKED TIN underdog: ${last.player_name} (${last.line}) — favorites only`);
        continue;
      }

      // Kill gate: spread snapbacks historically ≤50% across all ranges
      if (isTeamMarket && last.prop_type === 'spreads') {
        log(`🚫 KILLED TIN spread: ${last.player_name} (${last.line}) — below breakeven`);
        continue;
      }

      // Flip totals snapbacks: unders historically 0% — contrarian OVER
      if (isTeamMarket && last.prop_type === 'totals' && snapDirection === 'UNDER') {
        snapDirection = 'OVER';
        directionReason = `Contrarian flip: totals unders historically 0% — taking OVER`;
        log(`🔄 FLIPPED TIN totals to OVER: ${last.player_name} (${last.line})`);
      }

      const matchupLine = isTeamMarket ? eventMatchup.get(last.event_id) : null;
      const volInfo = volatilityMap.get((last.player_name || "").toLowerCase().trim());
      const readableProp = readablePropLabel(last.prop_type);
      const sportEmoji = getSportEmojiAlert(last.sport);

      // Snapback narrative
      const snapNarrative = `Line opened at ${last.opening_line} and drifted ${driftPct.toFixed(0)}% — that's a snapback opportunity. ${directionReason}`;

      const alertText = [
        `🎯 *SNAPBACK VALUE PLAY*${liveTag} — ${esc(last.sport)}`,
        matchupLine ? `🏟 ${esc(matchupLine)}` : null,
        ``,
        `${sportEmoji} *${esc(last.player_name)}* — ${readableProp}`,
        `📍 ${last.line} (opened ${last.opening_line})`,
        ``,
        `🧠 *Why this matters:*`,
        snapNarrative,
        ``,
        crossRef.badge || null,
        volWarning || null,
        altLineText || null,
        ``,
        isMoneylineProp(last.prop_type)
          ? `✅ *Play: ${snapDirection === "OVER" ? "TAKE" : "FADE"} ${esc(last.player_name)} (${fmtOdds(last.line)})*`
          : `✅ *Play: ${snapDirection} ${last.line}*`,
        isCombo ? `🔥 *COMBO PROP* — 85-100% historical accuracy` : null,
      ].filter(Boolean).join("\n");

      const record = {
        signal_type: "take_it_now", sport: last.sport, prop_type: last.prop_type,
        player_name: last.player_name, event_id: last.event_id,
        prediction: `${snapDirection} ${last.line}`,
        predicted_direction: snapDirection.toLowerCase(),
        predicted_magnitude: absDrift, confidence_at_signal: confidence,
        time_to_tip_hours: last.hours_to_tip, edge_at_signal: absDrift,
        signal_factors: {
          snapDirection, driftPct, openingLine: last.opening_line, currentLine: last.line,
          drift, directionReason, is_volatile_minutes: volInfo?.isVolatile || false,
          minutes_cv: volInfo?.cv ?? null, minutes_avg: volInfo?.avgMin ?? null,
          recommended_alt_line: (await fetchRealAltLine(last.event_id, last.player_name, last.prop_type, snapDirection, last.line, last.sport))?.line ?? null,
        },
        line_at_alert: last.line, hours_before_tip: last.hours_to_tip,
        alert_sent_at: new Date().toISOString(), drift_pct_at_alert: driftPct,
      };

      addSignal(`${last.event_id}|${last.player_name}`, confidence, alertText, record);
    }

    // ════════════════════════════════════════════════════════
    // SIGNAL: TRAP WARNING
    // ════════════════════════════════════════════════════════
    // BUG 7 FIX: trap warning check uses bestSignalPerPlayer only — but
    // alreadyRecommended must be built AFTER the accuracy gate loop because
    // signals that get gated should NOT block trap warnings for those players.
    // We defer building alreadyRecommended until after gate processing.
    // For now collect trap candidates and apply alreadyRecommended filter later.
    const trapCandidates: Array<{ playerKey: string; alert: string; record: any }> = [];

    for (const [, snapshots] of groups) {
      if (snapshots.length < 3) continue;
      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      const playerKey = `${first.event_id}|${first.player_name}`;
      const mid = snapshots[Math.floor(snapshots.length / 2)];
      const firstHalfDir = mid.line - first.line;
      const secondHalfDir = last.line - mid.line;

      if (
        Math.abs(firstHalfDir) >= 0.3 && Math.abs(secondHalfDir) >= 0.3 &&
        Math.sign(firstHalfDir) !== Math.sign(secondHalfDir)
      ) {
        const isTeamMarket = TEAM_MARKET_TYPES.has(first.prop_type);
        const matchupLine = isTeamMarket ? eventMatchup.get(first.event_id) : null;
        const live = isLive(last);
        const liveTag = live ? " [🔴 LIVE]" : "";
        const volWarning = getVolatilityWarning(first.player_name);
        const volInfo = volatilityMap.get((first.player_name || "").toLowerCase().trim());

        const readableProp = readablePropLabel(first.prop_type);
        const sportEmoji = getSportEmojiAlert(first.sport);
        const alertText = [
          `🚨 *TRAP ALERT*${liveTag} — ${esc(first.sport)}`,
          matchupLine ? `🏟 ${esc(matchupLine)}` : null,
          ``,
          `${sportEmoji} *${esc(first.player_name)}* — ${readableProp}`,
          `📍 ${first.line} → ${mid.line} → ${last.line}`,
          ``,
          `🧠 *Why this matters:*`,
          `Line moved one direction then snapped back — classic book manipulation. They're trying to bait action on both sides. Stay away.`,
          ``,
          volWarning || null,
          `🚫 *Action: STAY AWAY — both sides are dangerous*`,
        ].filter(Boolean).join("\n");

        const record = {
          signal_type: "trap_warning", sport: first.sport, prop_type: first.prop_type,
          player_name: first.player_name, event_id: first.event_id,
          prediction: "TRAP — avoid", predicted_direction: "reversal",
          predicted_magnitude: Math.abs(firstHalfDir) + Math.abs(secondHalfDir),
          confidence_at_signal: 75, time_to_tip_hours: last.hours_to_tip,
          signal_factors: { firstLine: first.line, midLine: mid.line, lastLine: last.line,
            is_volatile_minutes: volInfo?.isVolatile || false, minutes_cv: volInfo?.cv ?? null },
        };

        trapCandidates.push({ playerKey, alert: alertText, record });
      }
    }

    // ── Team market conflict resolution ──
    const chosenTeamMarketSignals = new Map<string, { confidence: number; alert: string; record: any }>();
    const nonTeamSignals: Array<{ confidence: number; alert: string; record: any }> = [];

    for (const entry of bestSignalPerPlayer.values()) {
      const { prop_type: propType, event_id: eventId } = entry.record || {};
      if (!eventId || !TEAM_MARKET_TYPES.has(propType)) { nonTeamSignals.push(entry); continue; }
      const conflictKey = `${eventId}|${propType}`;
      // BUG 5 FIX: use confidence only as primary comparator; velocity as pure tiebreaker
      const primaryStrength = Number(entry.record?.confidence_at_signal ?? entry.confidence ?? 0);
      const tiebreaker = Number(entry.record?.velocity_at_signal ?? 0) * 0.001; // negligible weight
      const strength = primaryStrength + tiebreaker;
      const existing = chosenTeamMarketSignals.get(conflictKey);
      if (!existing || strength > existing.confidence) {
        chosenTeamMarketSignals.set(conflictKey, { ...entry, confidence: strength });
      }
    }

    const selectedSignals = [
      ...nonTeamSignals,
      ...Array.from(chosenTeamMarketSignals.values()),
    ].sort((a, b) => getSignalPriority(a.record) - getSignalPriority(b.record));

    // ── Accuracy gate loop ──
    const telegramAlerts: string[] = [];
    const predictionRecords: any[] = [];
    const gatedRecords: any[] = [];
    let gatedCount = 0;
    let flippedCount = 0;

    for (const { alert, record } of selectedSignals) {
      if (isAccuracyGated(record?.signal_type, record?.prop_type)) {
        gatedCount++;
        const flipCheck = shouldFlip(record?.signal_type, record?.prop_type);
        if (flipCheck.flip && record?.prediction) {
          const origSide = record.prediction.split(" ")[0];
          const flippedSideStr = flipSide(origSide);
          const currentLine = record.signal_factors?.current_line ?? record.signal_factors?.line_to ?? null;
          const flippedPred = flipPrediction(record.prediction, currentLine);

          const isTeamMarket = TEAM_MARKET_TYPES.has(record.prop_type);
          let flipValidated = isTeamMarket;
          if (!isTeamMarket) {
            const { data: propsData } = await supabase
              .from("unified_props").select("l10_avg, l10_hit_rate_over, l10_hit_rate_under, fanduel_line")
              .eq("player_name", record.player_name).eq("prop_type", record.prop_type)
              .order("last_updated", { ascending: false }).limit(1);
            if (propsData?.length > 0) {
              const p = propsData[0];
              const line = Number(record.prediction.split(" ")[1]) || p.fanduel_line;
              if (flippedSideStr === "OVER" && p.l10_avg != null && p.l10_avg > line && (p.l10_hit_rate_over ?? 0) >= 0.5) flipValidated = true;
              else if (flippedSideStr === "UNDER" && p.l10_avg != null && p.l10_avg < line && (p.l10_hit_rate_under ?? 0) >= 0.5) flipValidated = true;
            }
          }
          const isForceFlip = !isTeamMarket && FORCE_FLIP_PROP_TYPES.has(record.prop_type)
            && flipCheck.samples >= FORCE_FLIP_MIN_SAMPLES && flipCheck.winRate < FORCE_FLIP_THRESHOLD
            && (record.sport || "").toUpperCase().includes("NBA");

          if (flipValidated || isForceFlip) {
            flippedCount++;
            const flipLabel = isForceFlip && !flipValidated ? "FORCE-FLIP" : "FLIPPED";
            log(`🔄 ${flipLabel}: ${record.player_name} ${record.prop_type} ${origSide} → ${flippedSideStr}`);
            const flippedAlert = [
              `🔄 *${isForceFlip ? "FORCE FLIP" : "FLIP SIGNAL"}* — ${esc(record.sport)}`,
              `${esc(record.player_name)} ${esc(record.prop_type).replace("player_", "").toUpperCase()}`,
              `Original ${origSide} was ${(flipCheck.winRate*100).toFixed(0)}% accuracy (${flipCheck.samples} samples)`,
              `✅ *Action: ${flippedPred}*`,
              isForceFlip ? `🎯 Extreme downside — forced flip` : `💡 Consistent miss — flipped to opposite side`,
              `⚠️ _Flip signal — lower confidence, use with caution_`,
            ].join("\n");
            telegramAlerts.push(flippedAlert);
            record.prediction = flippedPred;
            record.predicted_direction = `flipped_${record.predicted_direction || "unknown"}`;
            record.signal_type = `flipped_${record.signal_type}`;
            predictionRecords.push(record);
            continue;
          }
        }
        record.gated = true;
        gatedRecords.push(record);
        continue;
      }
      telegramAlerts.push(alert);
      predictionRecords.push(record);
    }
    if (gatedCount > 0) log(`🚫 Gate suppressed ${gatedCount} (${flippedCount} flipped)`);

    // BUG 7 FIX: build alreadyRecommended AFTER gate loop — only from signals that actually passed
    const alreadyRecommended = new Set<string>();
    for (const rec of predictionRecords) {
      if (rec.signal_type !== "trap_warning") {
        alreadyRecommended.add(`${rec.event_id}|${rec.player_name}`);
      }
    }

    // Add trap warnings only where no passing signal exists
    for (const { playerKey, alert, record } of trapCandidates) {
      if (!alreadyRecommended.has(playerKey)) {
        bestSignalPerPlayer.set(playerKey, { confidence: 99, alert, record });
        telegramAlerts.push(alert);
        predictionRecords.push(record);
      }
    }

    // Cross-run dedup
    const allRecordsForDb = [...predictionRecords, ...gatedRecords];
    let dedupedRecords = allRecordsForDb;
    if (allRecordsForDb.length > 0) {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data: recentPreds } = await supabase
        .from("fanduel_prediction_accuracy")
        .select("player_name, prop_type, signal_type, event_id")
        .gte("created_at", twoHoursAgo).limit(1000);

      const recentKeys = new Set(
        (recentPreds || []).map((r: any) => `${r.event_id}|${r.player_name}|${r.prop_type}|${r.signal_type}`)
      );
      dedupedRecords = allRecordsForDb.filter(r => {
        const key = `${r.event_id}|${r.player_name}|${r.prop_type}|${r.signal_type}`;
        if (recentKeys.has(key)) { log(`⏭ Dedup: ${r.player_name} ${r.prop_type}`); return false; }
        return true;
      });
      log(`Dedup: ${allRecordsForDb.length} → ${dedupedRecords.length}`);
    }

    // DB insert — gated records tagged is_gated=true
    if (dedupedRecords.length > 0) {
      const cleanRecords = dedupedRecords.map(({ gated, ...rest }) => ({ ...rest, is_gated: gated === true }));
      const sent = cleanRecords.filter(r => !r.is_gated);
      const gatedOnly = cleanRecords.filter(r => r.is_gated);
      if (sent.length > 0) {
        const { error } = await supabase.from("fanduel_prediction_accuracy").insert(sent);
        if (error) log(`⚠ Insert error: ${error.message}`);
      }
      if (gatedOnly.length > 0) {
        const { error } = await supabase.from("fanduel_prediction_accuracy").insert(gatedOnly);
        if (error) log(`⚠ Gated insert error: ${error.message}`);
      }
    }

    // Owner rules filter
    let rulesBlocked = 0;
    const filteredAlerts = telegramAlerts.filter((alertText: string) => {
      for (const rule of ownerRules) {
        if (rule.rule_key === "pitcher_k_follow_market") {
          const kTypes = ((rule.rule_logic as any).prop_types || []) as string[];
          const hasK = kTypes.some((k: string) => alertText.toLowerCase().includes(k.replace("_", " ")));
          if (hasK) {
            const lower = alertText.toLowerCase();
            if ((lower.includes("rising") && lower.includes("under")) ||
                (lower.includes("dropping") && lower.includes("over"))) {
              rulesBlocked++;
              supabase.from("bot_audit_log").insert({ rule_key: rule.rule_key, action_taken: "blocked", affected_table: "prediction_alerts" }).then(() => {});
              return false;
            }
          }
        }
      }
      return true;
    });
    if (rulesBlocked > 0) log(`Rules blocked ${rulesBlocked} alert(s)`);

    // Paginated Telegram send
    if (filteredAlerts.length > 0) {
      const MAX_CHARS = 3800;
      const pages: string[][] = [];
      let currentPage: string[] = [];
      let currentLen = 0;
      for (const alert of filteredAlerts) {
        const alertLen = alert.length + 2;
        if (currentPage.length > 0 && currentLen + alertLen > MAX_CHARS) {
          pages.push(currentPage); currentPage = []; currentLen = 0;
        }
        currentPage.push(alert); currentLen += alertLen;
      }
      if (currentPage.length > 0) pages.push(currentPage);

      for (let i = 0; i < pages.length; i++) {
        const pageLabel = pages.length > 1 ? ` (${i + 1}/${pages.length})` : "";
        const header = i === 0
          ? [`🎯 *FanDuel Predictions*${pageLabel}`, `${filteredAlerts.length} signal(s) — sorted by accuracy`, ""]
          : [`🎯 *Predictions${pageLabel}*`, ""];
        try {
          await supabase.functions.invoke("bot-send-telegram", {
            body: { message: [...header, ...pages[i]].join("\n\n"), parse_mode: "Markdown", admin_only: true },
          });
        } catch (tgErr: any) { log(`Telegram error p${i + 1}: ${tgErr.message}`); }
      }
    }

    log(`=== COMPLETE: ${telegramAlerts.length} alerts, ${predictionRecords.length} predictions ===`);

    try {
      await supabase.functions.invoke("generate-prediction-parlays");
      log("Prediction parlays triggered ✅");
    } catch (parlayErr: any) { log(`⚠ Parlays trigger: ${parlayErr.message}`); }

    await supabase.from("cron_job_history").insert({
      job_name: "fanduel-prediction-alerts", status: "completed",
      started_at: now.toISOString(), completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(),
      result: { alerts: telegramAlerts.length, predictions: predictionRecords.length },
    });

    return new Response(
      JSON.stringify({ success: true, alerts: telegramAlerts.length, predictions: predictionRecords.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    log(`❌ Fatal: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
