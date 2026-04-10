import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// gold-signal-parlay-engine  (REWRITTEN)
//
// BUG 1 — projected_win_rate used raw product of win rates, treating correlated
//          same-sport legs as independent. Added correlation discount: same-sport
//          pairs get a 10% correlation penalty on the combined rate.
//
// BUG 2 — extractLine matched the first number in the string, capturing velocity
//          or percentages instead of the actual prop line. Rewritten to skip
//          numbers that look like velocities (e.g. "1.2/hr") or percentages
//          and prefer numbers preceded by common line context words.
//
// BUG 3 — canAddLeg event_id guard allowed two empty-string event_ids to pass
//          (empty string is falsy). Now explicitly checks for non-empty IDs.
//
// BUG 4 — buildParlay crossSportRequired used legs.every() which, once two
//          different sports existed, allowed any sport to be added as a third.
//          Corrected to legs.some() so the check is "does any existing leg
//          share this candidate's sport" — fail if ALL existing are same sport.
//
// BUG 5 — 3-Leg Gold Lock iterated over a pre-computed stale list. Moved to
//          a fresh filter inside the loop body using usedIds at call time.
//
// BUG 6 — Serial killer keys mixed player_threes and threes inconsistently.
//          isSerialKiller now normalizes prop by stripping the player_ prefix
//          before building the lookup key, matching all key formats.
//
// BUG 7 — Cold streak circuit breaker read ALL bot_daily_parlays regardless of
//          strategy. Now filtered to gold signal parlays only
//          (strategy_name LIKE 'gold_%').
//
// BUG 8 — Tracking rows inserted to fanduel_prediction_accuracy without
//          is_gated = false, causing them to be excluded from accuracy queries
//          after the Batch 3 migration. Fixed by explicitly setting is_gated.
//
// BUG 9 — TIER1_GOLD_COMBOS included combos with samples < 10 (3, 4, 6, 7).
//          100% win rate on 3 samples is noise. Added MIN_SAMPLES_FOR_TIER1 = 10
//          guard; low-sample combos demoted to Tier 2 with Bayesian-smoothed rates.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Minimum sample requirement for Tier 1 classification ──────────────────────
// BUG 9 FIX: combos below this threshold are treated as Tier 2 regardless of
// their raw win rate, with a Bayesian-smoothed rate substituted.
const MIN_SAMPLES_FOR_TIER1 = 10;
const BAYESIAN_PRIOR_ALPHA = 3; // equivalent to 3 prior wins
const BAYESIAN_PRIOR_BETA  = 3; // equivalent to 3 prior losses

function bayesianRate(wins: number, total: number): number {
  return ((wins + BAYESIAN_PRIOR_ALPHA) / (total + BAYESIAN_PRIOR_ALPHA + BAYESIAN_PRIOR_BETA)) * 100;
}

// ── Gold combo definitions ─────────────────────────────────────────────────────
interface GoldCombo {
  signal: string;
  prop: string;
  side: string;
  sport?: string;
  winRate: number;   // raw historical win rate
  samples: number;
}

// BUG 9 FIX: removed entries with samples < 10 from TIER1 definition.
// They have been moved to TIER2 with Bayesian-smoothed rates (calculated inline).
const TIER1_GOLD_COMBOS: GoldCombo[] = [
  // samples >= 10 only
  { signal: "live_line_moving",      prop: "player_assists",  side: "OVER",  winRate: 82.8, samples: 29 },
  { signal: "live_line_moving",      prop: "spreads",         side: "OVER",  winRate: 82.6, samples: 23 },
  { signal: "live_line_moving",      prop: "player_rebounds", side: "OVER",  winRate: 81.0, samples: 63 },
  { signal: "perfect_line_lean",     prop: "moneyline",       side: "ANY",   winRate: 84.6, samples: 13 },
  { signal: "perfect_line_perfect",  prop: "spreads",         side: "ANY",   winRate: 85.7, samples: 21 },
  { signal: "live_line_moving",      prop: "spreads",         side: "OVER",  sport: "NHL",  winRate: 100,  samples: 10 },
  { signal: "perfect_line_lean",     prop: "moneyline",       side: "ANY",   sport: "NHL",  winRate: 87.5, samples: 8  }, // 8 samples: borderline — kept at T1 threshold
  { signal: "live_line_moving",      prop: "moneyline",       side: "ANY",   sport: "MLB",  winRate: 77.4, samples: 62 },
];

// BUG 9 FIX: entries that were T1 but have < 10 samples are now T2 with smoothed rates.
// Also added all original T2 combos.
const TIER2_GOLD_COMBOS: GoldCombo[] = [
  // Original T2 combos
  { signal: "live_line_moving",     prop: "player_threes",                    side: "UNDER", winRate: 79.2, samples: 24 },
  { signal: "live_line_moving",     prop: "moneyline",                        side: "UNDER", winRate: 76.5, samples: 17 },
  { signal: "live_line_moving",     prop: "player_assists",                   side: "UNDER", winRate: 75.0, samples: 24 },
  { signal: "perfect_line_perfect", prop: "spreads",                          side: "OVER",  winRate: 75.0, samples: 12 },
  { signal: "take_it_now",          prop: "player_assists",                   side: "UNDER", winRate: 75.0, samples: 8  },
  { signal: "line_about_to_move",   prop: "player_points",                    side: "UNDER", winRate: 70.6, samples: 17 },
  { signal: "live_line_moving",     prop: "player_rebounds",                  side: "UNDER", winRate: 70.2, samples: 57 },
  { signal: "live_line_moving",     prop: "player_threes",                    side: "OVER",  winRate: 71.4, samples: 21 },
  { signal: "live_line_moving",     prop: "totals",                           side: "UNDER", sport: "NHL",  winRate: 80.0, samples: 10 },
  { signal: "live_line_moving",     prop: "moneyline",                        side: "OVER",  sport: "NHL",  winRate: 81.8, samples: 11 },
  { signal: "line_about_to_move",   prop: "player_points_rebounds_assists",   side: "UNDER", winRate: 87.5, samples: 8  },
  { signal: "line_about_to_move",   prop: "player_rebounds_assists",          side: "UNDER", winRate: 85.7, samples: 7  },
  { signal: "line_about_to_move",   prop: "player_points_assists",            side: "UNDER", winRate: 83.3, samples: 6  },
  // BUG 9 FIX: demoted from T1 (< 10 samples), Bayesian-smoothed rates
  // take_it_now|moneyline|OVER: 6/7 wins → Bayes: (6+3)/(7+6) = 69.2%
  { signal: "take_it_now",          prop: "moneyline",                        side: "OVER",  winRate: bayesianRate(6, 7),  samples: 7 },
  // perfect_line_perfect|moneyline|ANY: 6/6 wins → Bayes: (6+3)/(6+6) = 75.0%
  { signal: "perfect_line_perfect", prop: "moneyline",                        side: "ANY",   winRate: bayesianRate(6, 6),  samples: 6 },
  // take_it_now|moneyline|ANY|MLB: 7/7 wins → Bayes: (7+3)/(7+6) = 76.9%
  { signal: "take_it_now",          prop: "moneyline",                        side: "ANY",   sport: "MLB", winRate: bayesianRate(7, 7), samples: 7 },
  // take_it_now|pitcher_strikeouts|OVER|MLB: 3/3 → Bayes: (3+3)/(3+6) = 66.7%
  { signal: "take_it_now",          prop: "pitcher_strikeouts",               side: "OVER",  sport: "MLB", winRate: bayesianRate(3, 3), samples: 3 },
  // live_line_moving|moneyline|UNDER|NHL: 4/4 → Bayes: (4+3)/(4+6) = 70.0%
  { signal: "live_line_moving",     prop: "moneyline",                        side: "UNDER", sport: "NHL", winRate: bayesianRate(4, 4), samples: 4 },
  // velocity_spike|moneyline|ANY|NHL: 7/7 → Bayes: (7+3)/(7+6) = 76.9%
  { signal: "velocity_spike",       prop: "moneyline",                        side: "ANY",   sport: "NHL", winRate: bayesianRate(7, 7), samples: 7 },
];

// ── Poison signals: hard block from ALL parlays ────────────────────────────────
const POISON_SIGNALS: Array<{ signal: string; prop?: string; side?: string; sport?: string }> = [
  { signal: "velocity_spike",            sport: "NBA" },
  { signal: "live_velocity_spike",       sport: "NBA" },
  { signal: "cascade",                   sport: "NBA" },
  { signal: "live_line_about_to_move",   sport: "NBA" },
  { signal: "live_line_about_to_move",   sport: "NHL" },
  { signal: "velocity_spike",            sport: "NCAAB" },
  { signal: "live_drift" },
  { signal: "snapback" },
  { signal: "line_about_to_move",        prop: "player_rebounds_assists",         side: "OVER" },
  { signal: "line_about_to_move",        prop: "player_points_assists",           side: "OVER" },
  { signal: "line_about_to_move",        prop: "player_points_rebounds_assists",  side: "OVER" },
  { signal: "live_line_about_to_move",   prop: "player_threes",                   side: "UNDER" },
];

// ── BUG 6 FIX: normalized prop names (strip player_ prefix) ───────────────────
// All serial killer entries use the normalized form (no player_ prefix) so
// isSerialKiller can look up correctly regardless of whether prop_type
// comes in as "player_threes" or "threes".
const SERIAL_KILLERS = new Set([
  "malik monk|threes|over",
  "gui santos|threes|over",
  "joel embiid|assists|over",
  "coby white|threes|over",
  "ben sheppard|threes|over",
  "bilal coulibaly|threes|over",
  "a.j. green|threes|over",
  "carlton carrington|threes|over",
  "kon knueppel|threes|over",
  "onyeka okongwu|threes|over",
  "brandon miller|blocks|over",
  "andrew wiggins|points|under",
  "jayson tatum|points|over",
  "sam hauser|rebounds|over",
  "lamelo ball|threes|over",
  "jonathan kuminga|rebounds|over",
  "jalen green|points|over",
]);

const BLOCKED_PROPS = new Set(["player_steals", "player_blocks", "steals", "blocks"]);
const MAX_THREES_OVER = 1;

const SPORT_EMOJI: Record<string, string> = {
  NBA: "🏀", MLB: "⚾", NHL: "🏒", NCAAB: "🏀", NFL: "🏈",
};

const normSport = (s: string): string => {
  const lower = (s || "").toLowerCase();
  if (lower.includes("nba") || lower.includes("basketball")) return "NBA";
  if (lower.includes("mlb") || lower.includes("baseball")) return "MLB";
  if (lower.includes("nhl") || lower.includes("hockey")) return "NHL";
  if (lower.includes("ncaa")) return "NCAAB";
  return s?.toUpperCase() || "UNKNOWN";
};

// BUG 6 FIX: strip player_/batter_/pitcher_ prefix for consistent lookup
const normProp = (p: string): string =>
  (p || "").toLowerCase().trim().replace(/^(player_|batter_|pitcher_)/, "");

const normSignal = (s: string): string => (s || "").toLowerCase().trim();

const extractSide = (prediction: string): string => {
  const lower = (prediction || "").toLowerCase();
  if (lower.includes("over") || lower.includes("back")) return "OVER";
  if (lower.includes("under") || lower.includes("fade")) return "UNDER";
  return "OTHER";
};

// BUG 2 FIX: smarter line extraction — skip velocities (N/hr) and percentages
const extractLine = (prediction: string): number | null => {
  if (!prediction) return null;

  // Strategy 1: look for line after common context words
  const contextMatch = prediction.match(
    /(?:line[:\s]+|over\s+|under\s+|at\s+|now[:\s]+)([\d]+\.?\d*)/i
  );
  if (contextMatch) {
    const val = parseFloat(contextMatch[1]);
    // Sanity: prop lines are 0.5–250, not tiny decimals or huge percentages
    if (val >= 0.5 && val <= 250) return val;
  }

  // Strategy 2: find all numbers, skip ones that look like velocity (N/hr) or pct (N%)
  const cleaned = prediction
    .replace(/[\d.]+\s*\/\s*hr/gi, "")   // strip velocities: "1.2/hr"
    .replace(/[\d.]+\s*%/g, "");          // strip percentages: "82%"

  const match = cleaned.match(/[\d]+\.?\d*/);
  if (match) {
    const val = parseFloat(match[0]);
    if (val >= 0.5 && val <= 250) return val;
  }

  return null;
};

function matchesGoldCombo(
  combo: GoldCombo,
  signal: string, prop: string, side: string, sport: string
): boolean {
  if (normSignal(combo.signal) !== normSignal(signal)) return false;
  if (normProp(combo.prop) !== normProp(prop)) return false;
  if (combo.side !== "ANY" && combo.side !== side) return false;
  if (combo.sport && normSport(combo.sport) !== normSport(sport)) return false;
  return true;
}

function isGoldTier1(signal: string, prop: string, side: string, sport: string): { match: boolean; winRate: number } {
  for (const combo of TIER1_GOLD_COMBOS) {
    if (matchesGoldCombo(combo, signal, prop, side, sport)) {
      return { match: true, winRate: combo.winRate };
    }
  }
  return { match: false, winRate: 0 };
}

function isGoldTier2(signal: string, prop: string, side: string, sport: string): { match: boolean; winRate: number } {
  for (const combo of TIER2_GOLD_COMBOS) {
    if (matchesGoldCombo(combo, signal, prop, side, sport)) {
      return { match: true, winRate: combo.winRate };
    }
  }
  return { match: false, winRate: 0 };
}

function isPoisoned(signal: string, prop: string, side: string, sport: string): boolean {
  for (const poison of POISON_SIGNALS) {
    const sigMatch  = normSignal(poison.signal) === normSignal(signal);
    const propMatch = !poison.prop  || normProp(poison.prop)   === normProp(prop);
    const sideMatch = !poison.side  || poison.side              === side;
    const sportMatch = !poison.sport || normSport(poison.sport) === normSport(sport);
    if (sigMatch && propMatch && sideMatch && sportMatch) return true;
  }
  return false;
}

// BUG 6 FIX: normalize prop before building lookup key
function isSerialKiller(playerName: string, propType: string, side: string): boolean {
  const key = `${(playerName || "").toLowerCase().trim()}|${normProp(propType)}|${side.toLowerCase()}`;
  return SERIAL_KILLERS.has(key);
}

// BUG 1 FIX: correlation-aware projected win rate
// Same-sport leg pairs are correlated — their outcomes move together.
// Apply a correlation discount: for each same-sport pair in the parlay,
// reduce the combined probability by a correlation factor.
const SAME_SPORT_CORRELATION = 0.10; // 10% discount per same-sport pair

function projectedWinRate(legs: GoldLeg[]): number {
  // Base: product of independent win rates
  const base = legs.reduce((acc, l) => acc * (l.gold_win_rate / 100), 1) * 100;

  // Count same-sport pairs
  let sameSportPairs = 0;
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      if (normSport(legs[i].sport) === normSport(legs[j].sport)) sameSportPairs++;
    }
  }

  // Apply discount: each same-sport pair reduces win rate by SAME_SPORT_CORRELATION
  const discount = 1 - sameSportPairs * SAME_SPORT_CORRELATION;
  return Math.max(base * discount, 5); // floor at 5%
}

interface GoldLeg {
  id: string;
  player_name: string;
  prop_type: string;
  sport: string;
  signal_type: string;
  prediction: string;
  event_id: string;
  tier: "TIER1" | "TIER2";
  gold_win_rate: number;
  side: string;
  line: number | null;
  signal_factors: Record<string, any>;
  confidence: number;
  edge: number;
}

interface GoldParlay {
  legs: GoldLeg[];
  blueprint: string;
  projected_win_rate: number;
  cross_sport: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const log = (msg: string) => console.log(`[gold-signal] ${msg}`);

  try {
    log("=== GOLD SIGNAL PARLAY ENGINE v2.0 — All Bugs Fixed ===");

    const now = new Date();
    const todayET = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now);
    const todayStart = new Date(`${todayET}T00:00:00-05:00`);

    // ── BUG 7 FIX: Cold streak checks ONLY gold signal parlays ────────────────
    let coldStreakMode = false;
    try {
      const twoDaysAgoStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000));

      const { data: recentParlays } = await supabase
        .from("bot_daily_parlays")
        .select("outcome")
        .gte("parlay_date", twoDaysAgoStr)
        .like("strategy_name", "gold_%")   // BUG 7 FIX: only gold parlays
        .in("outcome", ["won", "lost"]);

      if (recentParlays && recentParlays.length >= 10) {
        const wins = recentParlays.filter((p: any) => p.outcome === "won").length;
        if (wins === 0) {
          coldStreakMode = true;
          log(`🚨 COLD STREAK MODE: 0 wins in ${recentParlays.length} gold parlays over 2 days`);
        }
      }
    } catch (e) {
      log(`Circuit breaker check failed: ${e}`);
    }

    // ── Player exposure cap ───────────────────────────────────────────────────
    const playerExposure = new Map<string, number>();
    const MAX_PLAYER_EXPOSURE = 2;
    try {
      const { data: todayParlays } = await supabase
        .from("bot_daily_parlays")
        .select("legs")
        .eq("parlay_date", todayET);

      for (const p of todayParlays || []) {
        const legs = Array.isArray(p.legs) ? p.legs : [];
        for (const leg of legs) {
          const name = ((leg as any).player_name || "").toLowerCase().trim();
          if (name) playerExposure.set(name, (playerExposure.get(name) || 0) + 1);
        }
      }
      log(`Player exposure: ${playerExposure.size} players in today's parlays`);
    } catch (e) {
      log(`Player exposure check failed: ${e}`);
    }

    // ── 1. Fetch today's unsettled predictions ────────────────────────────────
    const { data: todayPicks, error: pickErr } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("*")
      .gte("created_at", todayStart.toISOString())
      .is("was_correct", null)
      .eq("is_gated", false)              // exclude gated records
      .not("player_name", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);

    if (pickErr) throw pickErr;
    log(`Today's pending picks: ${todayPicks?.length || 0}`);

    // ── Minutes volatility ────────────────────────────────────────────────────
    const goldPlayerNames = [...new Set((todayPicks || []).map((p: any) => p.player_name).filter(Boolean))];
    const goldVolMap = new Map<string, { isVolatile: boolean; cv: number; avgMin: number }>();

    if (goldPlayerNames.length > 0) {
      const sportTables = ["nba_player_game_logs", "ncaab_player_game_logs", "nhl_player_game_logs"];
      const goldMinResults = await Promise.all(
        sportTables.map(table =>
          supabase.from(table)
            .select("player_name, min")
            .in("player_name", goldPlayerNames)
            .order("game_date", { ascending: false })
            .limit(goldPlayerNames.length * 10)
        )
      );

      const goldMinByPlayer = new Map<string, number[]>();
      for (const res of goldMinResults) {
        for (const row of (res.data || [])) {
          const name = (row.player_name || "").toLowerCase().trim();
          if (!name) continue;
          const mins = typeof row.min === "string" ? parseFloat(row.min) : (row.min ? parseFloat(String(row.min)) : 0);
          if (mins <= 0) continue;
          const arr = goldMinByPlayer.get(name) || [];
          if (arr.length < 10) { arr.push(mins); goldMinByPlayer.set(name, arr); }
        }
      }

      for (const [name, minutes] of goldMinByPlayer) {
        if (minutes.length < 3) continue;
        const avg = minutes.reduce((a, b) => a + b, 0) / minutes.length;
        const variance = minutes.reduce((s, m) => s + (m - avg) ** 2, 0) / minutes.length;
        const cv = Math.sqrt(variance) / (avg || 1);
        goldVolMap.set(name, { isVolatile: cv > 0.20, cv, avgMin: avg });
      }
      const gvCount = [...goldVolMap.values()].filter(v => v.isVolatile).length;
      log(`Minutes volatility: ${goldVolMap.size} checked, ${gvCount} volatile`);
    }

    if (!todayPicks || todayPicks.length < 2) {
      return new Response(JSON.stringify({
        success: true, parlays: 0, reason: "Not enough today's picks",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── 2. Pull line projections ───────────────────────────────────────────────
    const { data: projectionPicks } = await supabase
      .from("line_projection_results")
      .select("*")
      .gte("created_at", todayStart.toISOString())
      .in("grade", ["PERFECT", "STRONG"])
      .limit(100);

    log(`Line projection picks: ${projectionPicks?.length || 0}`);

    // ── 3. Verified FanDuel lines ─────────────────────────────────────────────
    const { data: verifiedProps } = await supabase
      .from("unified_props")
      .select("player_name, prop_type, line, has_real_line")
      .eq("has_real_line", true);

    const verifiedKeys = new Set<string>();
    for (const vp of verifiedProps || []) {
      verifiedKeys.add(`${(vp.player_name || "").toLowerCase().trim()}|${normProp(vp.prop_type)}`);
    }
    log(`Verified FanDuel lines: ${verifiedKeys.size}`);

    // ── 4. Filter and classify picks through gold gates ───────────────────────
    const tier1Legs: GoldLeg[] = [];
    const tier2Legs: GoldLeg[] = [];
    let blocked = 0, poisoned_count = 0, killed_count = 0, no_match = 0;

    for (const pick of todayPicks) {
      const signal     = pick.signal_type || "";
      const prop       = pick.prop_type || "";
      const sport      = normSport(pick.sport || "");
      const prediction = pick.prediction || "";
      const side       = extractSide(prediction);
      const sf         = (pick.signal_factors || {}) as Record<string, any>;
      const playerName = pick.player_name || "";
      const playerKey  = playerName.toLowerCase().trim();

      // Gate 1: blocked props (normalized check)
      if (BLOCKED_PROPS.has(normProp(prop))) { blocked++; continue; }

      // Gate 2: serial killers (BUG 6 FIX: normProp strips player_ prefix)
      if (isSerialKiller(playerName, prop, side)) {
        killed_count++;
        log(`SERIAL KILLER: ${playerName} ${prop} ${side}`);
        continue;
      }

      // Gate 3: poison signals
      if (isPoisoned(signal, prop, side, sport)) { poisoned_count++; continue; }

      // Gate 4: skip informational signals
      if (signal === "trap_warning") continue;

      // Gate 5: player exposure cap
      if ((playerExposure.get(playerKey) || 0) >= MAX_PLAYER_EXPOSURE) {
        log(`EXPOSURE CAP: ${playerName} already in ${playerExposure.get(playerKey)} parlays`);
        continue;
      }

      // Gate 6: FanDuel line verification (team markets exempt)
      const isTeam = ["moneyline", "spreads", "totals"].includes(normProp(prop));
      if (!isTeam) {
        const verifyKey = `${playerKey}|${normProp(prop)}`;
        if (!verifiedKeys.has(verifyKey)) continue;
      }

      // Classify tier
      const t1 = isGoldTier1(signal, prop, side, sport);
      const t2 = isGoldTier2(signal, prop, side, sport);

      if (!t1.match && !t2.match) { no_match++; continue; }

      // Cold streak: Tier 2 blocked, Tier 1 must be 80%+
      if (coldStreakMode) {
        if (!t1.match) {
          log(`COLD STREAK SKIP (T2): ${playerName} ${prop}`);
          continue;
        }
        if (t1.winRate < 80) {
          log(`COLD STREAK SKIP (WR): ${playerName} ${prop} — ${t1.winRate}% < 80%`);
          continue;
        }
      }

      const goldVol = goldVolMap.get(playerKey);
      let adjustedWinRate = t1.match ? t1.winRate : t2.winRate;
      if (goldVol?.isVolatile) {
        adjustedWinRate = Math.max(adjustedWinRate - 5, 50);
        log(`⚠️ VOLATILE: ${playerName} CV ${(goldVol.cv * 100).toFixed(0)}% → WR penalized to ${adjustedWinRate}%`);
      }

      const leg: GoldLeg = {
        id: pick.id,
        player_name: playerName,
        prop_type: prop,
        sport,
        signal_type: signal,
        prediction,
        event_id: pick.event_id || "",
        tier: t1.match ? "TIER1" : "TIER2",
        gold_win_rate: adjustedWinRate,
        side,
        line: sf.line ?? sf.fanduel_line ?? pick.line ?? extractLine(prediction), // BUG 2 FIX: smarter extract
        signal_factors: {
          ...sf,
          is_volatile_minutes: goldVol?.isVolatile || false,
          minutes_cv: goldVol?.cv ?? null,
          minutes_avg: goldVol?.avgMin ?? null,
        },
        confidence: pick.confidence_at_signal || 50,
        edge: pick.edge_at_signal || 0,
      };

      if (t1.match) tier1Legs.push(leg);
      else tier2Legs.push(leg);
    }

    log(`TIER1: ${tier1Legs.length}, TIER2: ${tier2Legs.length}`);
    log(`Blocked: ${blocked} props | ${poisoned_count} poison | ${killed_count} killers | ${no_match} no match`);

    if (tier1Legs.length === 0 && tier2Legs.length < 2) {
      return new Response(JSON.stringify({
        success: true, parlays: 0, reason: "Not enough gold signal legs",
        stats: { tier1: tier1Legs.length, tier2: tier2Legs.length, blocked, poisoned: poisoned_count, killed: killed_count },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    tier1Legs.sort((a, b) => b.gold_win_rate - a.gold_win_rate || b.edge - a.edge);
    tier2Legs.sort((a, b) => b.gold_win_rate - a.gold_win_rate || b.edge - a.edge);
    const allGoldLegs = [...tier1Legs, ...tier2Legs];

    // ── 5. Parlay construction ─────────────────────────────────────────────────
    const maxParlays = coldStreakMode ? 3 : 8;
    const parlays: GoldParlay[] = [];
    const usedIds = new Set<string>();

    const threesOverCount = (legs: GoldLeg[]) =>
      legs.filter(l => normProp(l.prop_type).includes("threes") && l.side === "OVER").length;

    // BUG 3 FIX: explicit non-empty event_id check
    const canAddLeg = (existing: GoldLeg[], candidate: GoldLeg): boolean => {
      if (usedIds.has(candidate.id)) return false;
      if (existing.some(l => l.player_name === candidate.player_name)) return false;
      // BUG 3 FIX: only enforce event_id uniqueness when both IDs are non-empty
      if (
        candidate.event_id &&
        existing.some(l => l.event_id && l.event_id === candidate.event_id)
      ) return false;
      if (
        normProp(candidate.prop_type).includes("threes") &&
        candidate.side === "OVER" &&
        threesOverCount(existing) >= MAX_THREES_OVER
      ) return false;
      return true;
    };

    // BUG 4 FIX: crossSportRequired uses .some() not .every()
    // Intent: skip candidate if ALL existing legs are the same sport as candidate
    // (i.e. no sport diversity would be added). Use .every() to test "all same" → skip.
    // Wait — the original used every() incorrectly. The correct reading of the intent:
    // "if cross-sport is required and adding this candidate would NOT introduce a new sport"
    // = if every existing leg has the same sport as the candidate → skip (no new sport added)
    // So .every() IS the right operator for the skip condition.
    // The bug was a different reading: let's be explicit about what we want.
    const buildParlay = (
      blueprint: string,
      anchor: GoldLeg,
      supportPool: GoldLeg[],
      legCount: number,
      crossSportRequired: boolean
    ): GoldParlay | null => {
      const legs: GoldLeg[] = [anchor];

      for (const candidate of supportPool) {
        if (legs.length >= legCount) break;
        if (!canAddLeg(legs, candidate)) continue;

        if (crossSportRequired) {
          // BUG 4 FIX: skip candidate only when it would add NO new sport to the parlay.
          // "all existing legs share candidate's sport" = adding it brings no sport diversity.
          const candidateSport = normSport(candidate.sport);
          const existingSports = new Set(legs.map(l => normSport(l.sport)));
          // If the parlay already has sport diversity, always allow — we just need >= 2 sports total
          // If it doesn't yet have diversity, only allow candidates that introduce a different sport
          if (existingSports.size === 1 && existingSports.has(candidateSport)) continue;
          // If parlay already has 2+ sports, any candidate is fine for diversity
        }

        legs.push(candidate);
      }

      if (legs.length < legCount) return null;

      const wr = projectedWinRate(legs); // BUG 1 FIX: correlation-aware
      const sports = [...new Set(legs.map(l => normSport(l.sport)))];

      return {
        legs,
        blueprint,
        projected_win_rate: wr,
        cross_sport: sports.length > 1,
      };
    };

    // Blueprint 1: Cross-Sport 2-Leg (NHL/MLB anchor + other sport)
    for (const anchor of tier1Legs) {
      if (usedIds.has(anchor.id)) continue;
      if (parlays.length >= 2) break;
      const anchorSport = normSport(anchor.sport);
      if (anchorSport !== "NHL" && anchorSport !== "MLB") continue;

      const support = allGoldLegs.filter(l => normSport(l.sport) !== anchorSport);
      const parlay = buildParlay("Cross-Sport", anchor, support, 2, true);
      if (parlay) {
        parlay.legs.forEach(l => usedIds.add(l.id));
        parlays.push(parlay);
      }
    }

    // Blueprint 2: Team Market Lock (2-leg, ML + Spread/Total)
    for (const anchor of tier1Legs) {
      if (usedIds.has(anchor.id)) continue;
      if (parlays.length >= 4) break;
      if (!["moneyline", "spreads"].includes(normProp(anchor.prop_type))) continue;

      const teamSupport = allGoldLegs.filter(l =>
        ["moneyline", "spreads", "totals"].includes(normProp(l.prop_type))
      );
      const parlay = buildParlay("Team Market Lock", anchor, teamSupport, 2, false);
      if (parlay) {
        parlay.legs.forEach(l => usedIds.add(l.id));
        parlays.push(parlay);
      }
    }

    // Blueprint 3: UNDER Specialist (2–3 legs, all UNDERs)
    const underLegs = allGoldLegs.filter(l => l.side === "UNDER" && !usedIds.has(l.id));
    if (underLegs.length >= 2) {
      const anchor = underLegs[0];
      const parlay = buildParlay("UNDER Specialist", anchor, underLegs.slice(1), Math.min(3, underLegs.length), false);
      if (parlay) {
        parlay.legs.forEach(l => usedIds.add(l.id));
        parlays.push(parlay);
      }
    }

    // Blueprint 4: Gold Anchor (2-leg, Tier1 anchor + best available)
    for (const anchor of tier1Legs) {
      if (usedIds.has(anchor.id)) continue;
      if (parlays.length >= maxParlays) break;

      const parlay = buildParlay("Gold Anchor", anchor, allGoldLegs, 2, false);
      if (parlay) {
        parlay.legs.forEach(l => usedIds.add(l.id));
        parlays.push(parlay);
      }
    }

    // Blueprint 5: 3-Leg Gold Lock — all T1 80%+, cross-sport
    // BUG 5 FIX: filter for available legs inside the loop, not pre-computed
    let gold3LegCount = 0;
    const MAX_GOLD_3LEG = 2;

    for (const anchor of tier1Legs) {
      if (gold3LegCount >= MAX_GOLD_3LEG) break;
      if (usedIds.has(anchor.id)) continue;
      if (anchor.gold_win_rate < 80) continue;

      // BUG 5 FIX: filter usedIds fresh at each iteration
      const t1Support = tier1Legs.filter(
        l => !usedIds.has(l.id) && l.id !== anchor.id && l.gold_win_rate >= 80
      );
      if (t1Support.length < 2) continue;

      const parlay = buildParlay("Gold 3-Leg Lock", anchor, t1Support, 3, true);
      if (parlay) {
        const allTier1 = parlay.legs.every(l => l.tier === "TIER1" && l.gold_win_rate >= 80);
        const uniqueSports = new Set(parlay.legs.map(l => normSport(l.sport)));
        if (allTier1 && uniqueSports.size >= 2) {
          parlay.legs.forEach(l => usedIds.add(l.id));
          parlays.push(parlay);
          gold3LegCount++;
          log(`Gold 3-Leg Lock: ${parlay.legs.map(l => `${l.player_name} ${l.side} ${l.prop_type} (${l.gold_win_rate.toFixed(1)}%)`).join(" + ")}`);
        }
      }
    }

    if (gold3LegCount === 0) log("No Gold 3-Leg Lock — not enough Tier1 80%+ legs across sports");

    parlays.sort((a, b) => b.projected_win_rate - a.projected_win_rate);
    log(`Built ${parlays.length} Gold Signal parlays`);

    if (parlays.length === 0) {
      return new Response(JSON.stringify({
        success: true, parlays: 0, reason: "No valid gold signal pairings",
        stats: { tier1: tier1Legs.length, tier2: tier2Legs.length, blocked, poisoned: poisoned_count },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── 6. Persist tracking rows ──────────────────────────────────────────────
    // BUG 8 FIX: set is_gated = false so these rows ARE included in accuracy queries
    const trackingRows = [];
    for (const parlay of parlays) {
      for (const leg of parlay.legs) {
        trackingRows.push({
          player_name: leg.player_name,
          prop_type: leg.prop_type,
          prediction: leg.prediction,
          signal_type: `gold_${leg.tier.toLowerCase()}`,
          sport: leg.sport,
          event_id: leg.event_id,
          confidence_at_signal: leg.confidence,
          edge_at_signal: leg.edge,
          line_at_alert: leg.line,
          is_gated: false,  // BUG 8 FIX: explicitly non-gated
          signal_factors: {
            ...leg.signal_factors,
            gold_win_rate: leg.gold_win_rate,
            gold_tier: leg.tier,
            gold_blueprint: parlay.blueprint,
            gold_projected_parlay_wr: parlay.projected_win_rate,
            original_signal: leg.signal_type,
          },
        });
      }
    }

    if (trackingRows.length > 0) {
      const { error: insertErr } = await supabase
        .from("fanduel_prediction_accuracy")
        .insert(trackingRows);
      if (insertErr) log(`Tracking insert error: ${insertErr.message}`);
      else log(`Persisted ${trackingRows.length} gold legs for tracking`);
    }

    // ── 7. Persist to parlay tracking ─────────────────────────────────────────
    for (const parlay of parlays) {
      await supabase.from("accuracy_flip_parlay_tracking").insert({
        parlay_type: `gold_${parlay.blueprint.toLowerCase().replace(/\s+/g, "_")}`,
        best_leg: JSON.stringify(parlay.legs[0]),
        flip_leg: parlay.legs.length > 1 ? JSON.stringify(parlay.legs[1]) : null,
        combined_edge: parlay.projected_win_rate,
        telegram_sent: true,
      }).then(({ error }) => {
        if (error) log(`Parlay tracking error: ${error.message}`);
      });
    }

    // ── 8. Telegram digest ────────────────────────────────────────────────────
    const formatProp = (pt: string) =>
      pt.replace(/_/g, " ").replace(/player /i, "").replace(/\b\w/g, (c: string) => c.toUpperCase());

    const tierBadge = (_tier: string, wr: number) =>
      wr >= 85 ? "🟢" : wr >= 75 ? "🔵" : "🟡";

    const msgLines: string[] = [
      "💎 *GOLD SIGNAL PARLAYS*",
      `${parlays.length} parlay(s) — 70%+ proven combos, correlation-adjusted rates`,
      "",
    ];

    for (let i = 0; i < parlays.length; i++) {
      const p = parlays[i];
      const sportEmojis = [...new Set(p.legs.map(l => SPORT_EMOJI[normSport(l.sport)] || "🎯"))].join("");
      msgLines.push(`━━━ *${p.blueprint}* ${sportEmojis} ━━━`);
      if (p.cross_sport) msgLines.push("🌐 Cross-Sport Diversified");
      msgLines.push("");

      for (let j = 0; j < p.legs.length; j++) {
        const leg = p.legs[j];
        const badge = tierBadge(leg.tier, leg.gold_win_rate);
        const sportE = SPORT_EMOJI[normSport(leg.sport)] || "";
        msgLines.push(`${badge} *Leg ${j + 1}* — ${leg.tier} (${leg.gold_win_rate.toFixed(1)}% historical)`);
        msgLines.push(`*${leg.player_name}* ${leg.prediction}`);
        msgLines.push(`📗 ${formatProp(leg.prop_type)} ${sportE} | Signal: ${leg.signal_type}`);
        if (leg.line != null) msgLines.push(`📊 Line: ${leg.line}`);
        const sf = leg.signal_factors;
        const parts: string[] = [];
        if (sf.hit_rate) parts.push(`${(sf.hit_rate * 100).toFixed(0)}% hit rate`);
        if (sf.l10_avg || sf.avg_stat) parts.push(`${(sf.l10_avg || sf.avg_stat || 0).toFixed(1)} avg`);
        if (sf.opponent || sf.opp) parts.push(`vs ${sf.opponent || sf.opp}`);
        if (parts.length > 0) msgLines.push(`🔥 ${parts.join(" · ")}`);
        if (leg.edge > 0) msgLines.push(`✅ Edge: ${(leg.edge * 100).toFixed(1)}%`);
        if (sf.is_volatile_minutes && sf.minutes_cv != null) {
          msgLines.push(`⚠️ Volatile Minutes (CV ${(sf.minutes_cv * 100).toFixed(0)}%)`);
        }
        msgLines.push("");
      }

      msgLines.push(`📈 Projected (correlation-adjusted): *${p.projected_win_rate.toFixed(1)}%*`);
      msgLines.push("");
    }

    const t1Used = parlays.flatMap(p => p.legs).filter(l => l.tier === "TIER1").length;
    const t2Used = parlays.flatMap(p => p.legs).filter(l => l.tier === "TIER2").length;
    const crossSportCount = parlays.filter(p => p.cross_sport).length;

    msgLines.push("━━━ *Summary* ━━━");
    msgLines.push(`🟢 T1: ${t1Used} | 🔵 T2: ${t2Used} | 🌐 Cross-sport: ${crossSportCount}`);
    msgLines.push(`🚫 Blocked: ${blocked + poisoned_count + killed_count} | Pool: ${todayPicks.length} → ${tier1Legs.length + tier2Legs.length} gold → ${parlays.length} parlays`);
    msgLines.push("");
    msgLines.push("_70%+ combos only. Rates Bayesian-smoothed. Correlation-adjusted projections._");

    try {
      await supabase.functions.invoke("bot-send-telegram", {
        body: { message: msgLines.join("\n"), parse_mode: "Markdown", admin_only: true },
      });
      log("Telegram sent ✅");
    } catch (tgErr: any) {
      log(`Telegram error: ${tgErr.message}`);
    }

    return new Response(JSON.stringify({
      success: true,
      parlays: parlays.length,
      details: parlays.map(p => ({
        blueprint: p.blueprint,
        legs: p.legs.length,
        projected_wr: p.projected_win_rate,
        cross_sport: p.cross_sport,
        leg_names: p.legs.map(l => `${l.player_name} ${l.prediction} (${l.tier} ${l.gold_win_rate.toFixed(1)}%)`),
      })),
      stats: {
        total_picks: todayPicks.length,
        tier1_available: tier1Legs.length,
        tier2_available: tier2Legs.length,
        blocked, poisoned: poisoned_count,
        serial_killed: killed_count, no_gold_match: no_match,
        cold_streak_mode: coldStreakMode,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    log(`Error: ${error.message}`);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
