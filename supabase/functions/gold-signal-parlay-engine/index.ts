import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============= GOLD SIGNAL CONFIGURATION =============
// Data-driven from historical accuracy analysis

// TIER 1: Anchor legs (80%+ win rate, 10+ samples)
const TIER1_GOLD_COMBOS: Array<{ signal: string; prop: string; side: string; sport?: string; winRate: number; samples: number }> = [
  { signal: "live_line_moving", prop: "player_assists", side: "OVER", winRate: 82.8, samples: 29 },
  { signal: "live_line_moving", prop: "spreads", side: "OVER", winRate: 82.6, samples: 23 },
  { signal: "live_line_moving", prop: "player_rebounds", side: "OVER", winRate: 81.0, samples: 63 },
  { signal: "take_it_now", prop: "moneyline", side: "OVER", winRate: 85.7, samples: 7 },
  { signal: "perfect_line_lean", prop: "moneyline", side: "ANY", winRate: 84.6, samples: 13 },
  { signal: "perfect_line_perfect", prop: "moneyline", side: "ANY", winRate: 100, samples: 6 },
  { signal: "perfect_line_perfect", prop: "spreads", side: "ANY", winRate: 85.7, samples: 21 },
  // NHL specific
  { signal: "live_line_moving", prop: "spreads", side: "OVER", sport: "NHL", winRate: 100, samples: 10 },
  { signal: "live_line_moving", prop: "moneyline", side: "UNDER", sport: "NHL", winRate: 100, samples: 4 },
  { signal: "velocity_spike", prop: "moneyline", side: "ANY", sport: "NHL", winRate: 100, samples: 7 },
  { signal: "perfect_line_lean", prop: "moneyline", side: "ANY", sport: "NHL", winRate: 87.5, samples: 8 },
  // MLB specific
  { signal: "take_it_now", prop: "moneyline", side: "ANY", sport: "MLB", winRate: 100, samples: 7 },
  { signal: "take_it_now", prop: "pitcher_strikeouts", side: "OVER", sport: "MLB", winRate: 100, samples: 3 },
  { signal: "live_line_moving", prop: "moneyline", side: "ANY", sport: "MLB", winRate: 77.4, samples: 62 },
];

// TIER 2: Support legs (70-80%)
const TIER2_GOLD_COMBOS: Array<{ signal: string; prop: string; side: string; sport?: string; winRate: number; samples: number }> = [
  { signal: "live_line_moving", prop: "player_threes", side: "UNDER", winRate: 79.2, samples: 24 },
  { signal: "live_line_moving", prop: "moneyline", side: "UNDER", winRate: 76.5, samples: 17 },
  { signal: "live_line_moving", prop: "player_assists", side: "UNDER", winRate: 75.0, samples: 24 },
  { signal: "perfect_line_perfect", prop: "spreads", side: "OVER", winRate: 75.0, samples: 12 },
  { signal: "take_it_now", prop: "player_assists", side: "UNDER", winRate: 75.0, samples: 8 },
  { signal: "line_about_to_move", prop: "player_points", side: "UNDER", winRate: 70.6, samples: 17 },
  { signal: "live_line_moving", prop: "player_rebounds", side: "UNDER", winRate: 70.2, samples: 57 },
  { signal: "live_line_moving", prop: "player_threes", side: "OVER", winRate: 71.4, samples: 21 },
  { signal: "live_line_moving", prop: "totals", side: "UNDER", sport: "NHL", winRate: 80.0, samples: 10 },
  { signal: "live_line_moving", prop: "moneyline", side: "OVER", sport: "NHL", winRate: 81.8, samples: 11 },
  { signal: "line_about_to_move", prop: "player_points_rebounds_assists", side: "UNDER", winRate: 87.5, samples: 8 },
  { signal: "line_about_to_move", prop: "player_rebounds_assists", side: "UNDER", winRate: 85.7, samples: 7 },
  { signal: "line_about_to_move", prop: "player_points_assists", side: "UNDER", winRate: 83.3, samples: 6 },
];

// POISON signals: HARD BLOCK from all parlays
const POISON_SIGNALS: Array<{ signal: string; prop?: string; side?: string; sport?: string }> = [
  { signal: "velocity_spike", sport: "NBA" },
  { signal: "live_velocity_spike", sport: "NBA" },
  { signal: "cascade", sport: "NBA" },
  { signal: "live_line_about_to_move", sport: "NBA" },
  { signal: "live_line_about_to_move", sport: "NHL" },
  { signal: "velocity_spike", sport: "NCAAB" },
  { signal: "live_drift" },
  { signal: "snapback" },
  { signal: "line_about_to_move", prop: "player_rebounds_assists", side: "OVER" },
  { signal: "line_about_to_move", prop: "player_points_assists", side: "OVER" },
  { signal: "line_about_to_move", prop: "player_points_rebounds_assists", side: "OVER" },
  { signal: "live_line_about_to_move", prop: "player_threes", side: "UNDER" },
];

// SERIAL KILLER players: blacklisted from parlays
const SERIAL_KILLERS = new Set([
  "malik monk|player_threes|over",
  "gui santos|player_threes|over",
  "joel embiid|assists|over",
  "joel embiid|player_assists|over",
  "coby white|player_threes|over",
  "ben sheppard|threes|over",
  "bilal coulibaly|player_threes|over",
  "a.j. green|threes|over",
  "carlton carrington|threes|over",
  "kon knueppel|threes|over",
  "onyeka okongwu|player_threes|over",
  "brandon miller|player_blocks|over",
  // Cold streak offenders (Apr 1-3 data)
  "andrew wiggins|player_points|under",
  "andrew wiggins|points|under",
  "jayson tatum|player_points|over",
  "jayson tatum|points|over",
  "sam hauser|player_rebounds|over",
  "sam hauser|rebounds|over",
  "lamelo ball|player_threes|over",
  "lamelo ball|threes|over",
  "jonathan kuminga|player_rebounds|over",
  "jonathan kuminga|rebounds|over",
  "jalen green|player_points|over",
  "jalen green|points|over",
]);

// BLOCKED prop types
const BLOCKED_PROPS = new Set(["player_steals", "player_blocks"]);

// Max threes OVER legs per parlay
const MAX_THREES_OVER = 1;

const SPORT_EMOJI: Record<string, string> = {
  NBA: "🏀", MLB: "⚾", NHL: "🏒", NCAAB: "🏀", NFL: "🏈",
  basketball_nba: "🏀", baseball_mlb: "⚾", ice_hockey_nhl: "🏒",
};

const normSport = (s: string) => {
  const lower = (s || "").toLowerCase();
  if (lower.includes("nba") || lower.includes("basketball")) return "NBA";
  if (lower.includes("mlb") || lower.includes("baseball")) return "MLB";
  if (lower.includes("nhl") || lower.includes("hockey")) return "NHL";
  if (lower.includes("ncaa")) return "NCAAB";
  return s?.toUpperCase() || "UNKNOWN";
};

const normProp = (p: string) => (p || "").toLowerCase().trim();
const normSignal = (s: string) => (s || "").toLowerCase().trim();

const extractSide = (prediction: string): string => {
  const lower = (prediction || "").toLowerCase();
  if (lower.includes("over") || lower.includes("back")) return "OVER";
  if (lower.includes("under") || lower.includes("fade")) return "UNDER";
  return "OTHER";
};

const extractLine = (prediction: string): number | null => {
  const match = (prediction || "").match(/[\d]+\.?\d*/);
  return match ? parseFloat(match[0]) : null;
};

// Check if a signal matches a gold combo
function matchesGoldCombo(
  combo: { signal: string; prop: string; side: string; sport?: string },
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
    if (matchesGoldCombo(combo, signal, prop, side, sport)) return { match: true, winRate: combo.winRate };
  }
  return { match: false, winRate: 0 };
}

function isGoldTier2(signal: string, prop: string, side: string, sport: string): { match: boolean; winRate: number } {
  for (const combo of TIER2_GOLD_COMBOS) {
    if (matchesGoldCombo(combo, signal, prop, side, sport)) return { match: true, winRate: combo.winRate };
  }
  return { match: false, winRate: 0 };
}

function isPoisoned(signal: string, prop: string, side: string, sport: string): boolean {
  for (const poison of POISON_SIGNALS) {
    const sigMatch = normSignal(poison.signal) === normSignal(signal);
    const propMatch = !poison.prop || normProp(poison.prop) === normProp(prop);
    const sideMatch = !poison.side || poison.side === side;
    const sportMatch = !poison.sport || normSport(poison.sport) === normSport(sport);
    if (sigMatch && propMatch && sideMatch && sportMatch) return true;
  }
  return false;
}

function isSerialKiller(playerName: string, propType: string, side: string): boolean {
  const key = `${(playerName || "").toLowerCase().trim()}|${normProp(propType)}|${side.toLowerCase()}`;
  return SERIAL_KILLERS.has(key);
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
    log("=== GOLD SIGNAL PARLAY ENGINE v1.1 — Cold Streak Fix ===");

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    // ============= COLD-STREAK CIRCUIT BREAKER =============
    // Check last 2 days of results. If 0 wins in 10+ parlays, tighten gates.
    let coldStreakMode = false;
    try {
      const twoDaysAgo = new Date(now);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const twoDaysAgoStr = twoDaysAgo.toISOString().split("T")[0];

      const { data: recentParlays } = await supabase
        .from("bot_daily_parlays")
        .select("outcome")
        .gte("parlay_date", twoDaysAgoStr)
        .in("outcome", ["won", "lost"]);

      if (recentParlays && recentParlays.length >= 10) {
        const wins = recentParlays.filter((p: any) => p.outcome === "won").length;
        if (wins === 0) {
          coldStreakMode = true;
          log(`🚨 COLD STREAK MODE ACTIVE: 0 wins in ${recentParlays.length} settled parlays over last 2 days`);
        }
      }
    } catch (e) {
      log(`Circuit breaker check failed: ${e}`);
    }

    // ============= PLAYER EXPOSURE CAP =============
    // Track how many parlays each player is already in today (across all strategies)
    const playerExposure = new Map<string, number>();
    const MAX_PLAYER_EXPOSURE = 2;
    try {
      const { data: todayParlays } = await supabase
        .from("bot_daily_parlays")
        .select("legs")
        .eq("parlay_date", todayStart.toISOString().split("T")[0]);

      if (todayParlays) {
        for (const p of todayParlays) {
          const legs = Array.isArray(p.legs) ? p.legs : [];
          for (const leg of legs) {
            const name = ((leg as any).player_name || "").toLowerCase().trim();
            if (name) playerExposure.set(name, (playerExposure.get(name) || 0) + 1);
          }
        }
      }
      log(`Player exposure loaded: ${playerExposure.size} players already in today's parlays`);
    } catch (e) {
      log(`Player exposure check failed: ${e}`);
    }

    // 1. Get ALL today's unsettled predictions across all signal types
    const { data: todayPicks, error: pickErr } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("*")
      .gte("created_at", todayStart.toISOString())
      .is("was_correct", null)
      .not("player_name", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);

    if (pickErr) throw pickErr;
    log(`Today's pending picks: ${todayPicks?.length || 0}`);

    if (!todayPicks || todayPicks.length < 2) {
      return new Response(JSON.stringify({
        success: true, parlays: 0, reason: "Not enough today's picks",
        stats: { total_picks: todayPicks?.length || 0 },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. Also pull from line_projection_results for PERFECT/STRONG signals
    const { data: projectionPicks } = await supabase
      .from("line_projection_results")
      .select("*")
      .gte("created_at", todayStart.toISOString())
      .in("grade", ["PERFECT", "STRONG"])
      .limit(100);

    log(`Line projection PERFECT/STRONG picks: ${projectionPicks?.length || 0}`);

    // 3. Cross-reference against unified_props for verified FanDuel lines
    const { data: verifiedProps } = await supabase
      .from("unified_props")
      .select("player_name, prop_type, line, has_real_line")
      .eq("has_real_line", true);

    const verifiedKeys = new Set<string>();
    if (verifiedProps) {
      for (const vp of verifiedProps) {
        verifiedKeys.add(`${(vp.player_name || "").toLowerCase().trim()}|${normProp(vp.prop_type)}`);
      }
    }
    log(`Verified FanDuel lines: ${verifiedKeys.size}`);

    // 4. Filter and classify legs through Gold Signal gates
    const tier1Legs: GoldLeg[] = [];
    const tier2Legs: GoldLeg[] = [];
    let blocked = 0, poisoned_count = 0, killed_count = 0, no_match = 0;

    for (const pick of todayPicks) {
      const signal = pick.signal_type || "";
      const prop = pick.prop_type || "";
      const sport = normSport(pick.sport || "");
      const prediction = pick.prediction || "";
      const side = extractSide(prediction);
      const sf = (pick.signal_factors || {}) as Record<string, any>;
      const playerName = pick.player_name || "";

      // Gate 1: Block banned props
      if (BLOCKED_PROPS.has(normProp(prop))) {
        blocked++;
        continue;
      }

      // Gate 2: Block serial killer players
      if (isSerialKiller(playerName, prop, side)) {
        killed_count++;
        log(`SERIAL KILLER BLOCKED: ${playerName} ${prop} ${side}`);
        continue;
      }

      // Gate 3: Block poison signal combos
      if (isPoisoned(signal, prop, side, sport)) {
        poisoned_count++;
        continue;
      }

      // Gate 4: Skip trap_warning signals (informational only)
      if (signal === "trap_warning") continue;

      // Gate 5: Player exposure cap — skip players already in 2+ parlays today
      const playerKey = playerName.toLowerCase().trim();
      if ((playerExposure.get(playerKey) || 0) >= MAX_PLAYER_EXPOSURE) {
        log(`EXPOSURE CAP: ${playerName} already in ${playerExposure.get(playerKey)} parlays today`);
        continue;
      }

      // Gate 6: Cold streak mode — skip Tier 2 legs entirely
      // (checked after tier classification below)

      // Gate 7: Verify FanDuel line exists (team markets exempt)
      const isTeam = ["moneyline", "spreads", "totals"].includes(normProp(prop));
      if (!isTeam) {
        const verifyKey = `${playerName.toLowerCase().trim()}|${normProp(prop)}`;
        if (!verifiedKeys.has(verifyKey)) continue;
      }

      // Classify into tier
      const t1 = isGoldTier1(signal, prop, side, sport);
      const t2 = isGoldTier2(signal, prop, side, sport);

      if (!t1.match && !t2.match) {
        no_match++;
        continue;
      }

      // Cold streak mode: skip Tier 2, require 80%+ win rate for Tier 1
      if (coldStreakMode) {
        if (!t1.match) {
          log(`COLD STREAK SKIP: ${playerName} ${prop} — Tier 2 blocked in cold streak mode`);
          continue;
        }
        if (t1.winRate < 80) {
          log(`COLD STREAK SKIP: ${playerName} ${prop} — Tier 1 win rate ${t1.winRate}% < 80% threshold`);
          continue;
        }
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
        gold_win_rate: t1.match ? t1.winRate : t2.winRate,
        side,
        line: sf.line ?? sf.fanduel_line ?? pick.line ?? extractLine(prediction),
        signal_factors: sf,
        confidence: pick.confidence_at_signal || 50,
        edge: pick.edge_at_signal || 0,
      };

      if (t1.match) tier1Legs.push(leg);
      else tier2Legs.push(leg);
    }

    log(`TIER 1 legs: ${tier1Legs.length}, TIER 2 legs: ${tier2Legs.length}`);
    log(`Blocked: ${blocked} props, ${poisoned_count} poison, ${killed_count} serial killers, ${no_match} no gold match`);

    if (tier1Legs.length === 0 && tier2Legs.length < 2) {
      return new Response(JSON.stringify({
        success: true, parlays: 0, reason: "Not enough gold signal legs",
        stats: { tier1: tier1Legs.length, tier2: tier2Legs.length, blocked, poisoned: poisoned_count, killed: killed_count },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 5. Sort by gold win rate then edge
    tier1Legs.sort((a, b) => b.gold_win_rate - a.gold_win_rate || b.edge - a.edge);
    tier2Legs.sort((a, b) => b.gold_win_rate - a.gold_win_rate || b.edge - a.edge);

    const allGoldLegs = [...tier1Legs, ...tier2Legs];

    // 6. Build parlays using blueprints
    const maxParlays = coldStreakMode ? 3 : 8; // Reduce volume 50%+ in cold streak
    const parlays: GoldParlay[] = [];
    const usedIds = new Set<string>();

    // Helper: check threes OVER cap
    const threesOverCount = (legs: GoldLeg[]) =>
      legs.filter(l => normProp(l.prop_type).includes("threes") && l.side === "OVER").length;

    const canAddLeg = (existing: GoldLeg[], candidate: GoldLeg): boolean => {
      // Different events
      if (existing.some(l => l.event_id && candidate.event_id && l.event_id === candidate.event_id)) return false;
      // Different players
      if (existing.some(l => l.player_name === candidate.player_name)) return false;
      // Threes OVER cap
      if (normProp(candidate.prop_type).includes("threes") && candidate.side === "OVER" && threesOverCount(existing) >= MAX_THREES_OVER) return false;
      // Not already used
      if (usedIds.has(candidate.id)) return false;
      return true;
    };

    const buildParlay = (blueprint: string, anchor: GoldLeg, supportPool: GoldLeg[], legCount: number, crossSportRequired: boolean): GoldParlay | null => {
      const legs: GoldLeg[] = [anchor];
      
      for (const candidate of supportPool) {
        if (legs.length >= legCount) break;
        if (!canAddLeg(legs, candidate)) continue;
        if (crossSportRequired && legs.every(l => normSport(l.sport) === normSport(candidate.sport))) continue;
        legs.push(candidate);
      }

      if (legs.length < legCount) return null;

      const projected = legs.reduce((acc, l) => acc * (l.gold_win_rate / 100), 1) * 100;

      return { legs, blueprint, projected_win_rate: projected, cross_sport: legs.map(l => normSport(l.sport)).filter((v, i, a) => a.indexOf(v) === i).length > 1 };
    };

    // Blueprint 1: Cross-Sport 2-Leg (NHL/MLB anchor + NBA support)
    for (const anchor of tier1Legs) {
      if (usedIds.has(anchor.id)) continue;
      const anchorSport = normSport(anchor.sport);
      if (anchorSport !== "NHL" && anchorSport !== "MLB") continue;

      const support = allGoldLegs.filter(l => normSport(l.sport) !== anchorSport);
      const parlay = buildParlay("Cross-Sport", anchor, support, 2, true);
      if (parlay) {
        parlay.legs.forEach(l => usedIds.add(l.id));
        parlays.push(parlay);
        if (parlays.length >= 2) break;
      }
    }

    // Blueprint 2: Team Market Lock (2-leg, ML + Spreads)
    for (const anchor of tier1Legs) {
      if (usedIds.has(anchor.id)) continue;
      if (!["moneyline", "spreads"].includes(normProp(anchor.prop_type))) continue;

      const teamSupport = allGoldLegs.filter(l => ["moneyline", "spreads", "totals"].includes(normProp(l.prop_type)));
      const parlay = buildParlay("Team Market Lock", anchor, teamSupport, 2, false);
      if (parlay) {
        parlay.legs.forEach(l => usedIds.add(l.id));
        parlays.push(parlay);
        if (parlays.length >= 4) break;
      }
    }

    // Blueprint 3: UNDER Specialist (2-3 legs, all UNDERs from Tier 1+2)
    const underLegs = allGoldLegs.filter(l => l.side === "UNDER" && !usedIds.has(l.id));
    if (underLegs.length >= 2) {
      const anchor = underLegs[0];
      const parlay = buildParlay("UNDER Specialist", anchor, underLegs.slice(1), Math.min(3, underLegs.length), false);
      if (parlay) {
        parlay.legs.forEach(l => usedIds.add(l.id));
        parlays.push(parlay);
      }
    }

    // Blueprint 4: Anchor + Best Available (2-leg, any Tier1 anchor + best Tier1/2 support)
    for (const anchor of tier1Legs) {
      if (usedIds.has(anchor.id)) continue;
      if (parlays.length >= maxParlays) break;

      const parlay = buildParlay("Gold Anchor", anchor, allGoldLegs, 2, false);
      if (parlay) {
        parlay.legs.forEach(l => usedIds.add(l.id));
        parlays.push(parlay);
      }
    }

    // Blueprint 5: 3-Leg Gold (only if enough high-quality legs)
    const remainingT1 = tier1Legs.filter(l => !usedIds.has(l.id));
    if (remainingT1.length >= 1 && allGoldLegs.filter(l => !usedIds.has(l.id)).length >= 2) {
      const anchor = remainingT1[0];
      const remaining = allGoldLegs.filter(l => !usedIds.has(l.id));
      const parlay = buildParlay("Gold 3-Leg", anchor, remaining, 3, false);
      if (parlay && parlay.projected_win_rate >= 40) {
        parlay.legs.forEach(l => usedIds.add(l.id));
        parlays.push(parlay);
      }
    }

    parlays.sort((a, b) => b.projected_win_rate - a.projected_win_rate);
    log(`Built ${parlays.length} Gold Signal parlays`);

    if (parlays.length === 0) {
      return new Response(JSON.stringify({
        success: true, parlays: 0, reason: "No valid gold signal pairings found",
        stats: { tier1: tier1Legs.length, tier2: tier2Legs.length, blocked, poisoned: poisoned_count },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 7. Persist to accuracy tracking
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
      else log(`Persisted ${trackingRows.length} gold signal legs for tracking`);
    }

    // 8. Persist parlays to accuracy_flip_parlay_tracking
    for (const parlay of parlays) {
      const { error: parlayErr } = await supabase
        .from("accuracy_flip_parlay_tracking")
        .insert({
          parlay_type: `gold_${parlay.blueprint.toLowerCase().replace(/\s+/g, "_")}`,
          best_leg: JSON.stringify(parlay.legs[0]),
          flip_leg: parlay.legs.length > 1 ? JSON.stringify(parlay.legs[1]) : null,
          combined_edge: parlay.projected_win_rate,
          telegram_sent: true,
        });
      if (parlayErr) log(`Parlay tracking error: ${parlayErr.message}`);
    }

    // 9. Build Telegram digest
    const formatProp = (pt: string) =>
      pt.replace(/_/g, " ").replace(/player /i, "").replace(/\b\w/g, (c: string) => c.toUpperCase());

    const tierBadge = (tier: string, wr: number) => {
      if (wr >= 85) return "🟢";
      if (wr >= 75) return "🔵";
      return "🟡";
    };

    const msgLines: string[] = [
      "💎 *GOLD SIGNAL PARLAYS*",
      `${parlays.length} parlay(s) from proven 70%+ combos only`,
      "",
    ];

    for (let i = 0; i < parlays.length; i++) {
      const p = parlays[i];
      const sportEmojis = p.legs.map(l => SPORT_EMOJI[l.sport] || SPORT_EMOJI[normSport(l.sport)] || "🎯").join("");
      
      msgLines.push(`━━━ *${p.blueprint}* ${sportEmojis} ━━━`);
      if (p.cross_sport) msgLines.push("🌐 Cross-Sport Diversified");
      msgLines.push("");

      for (let j = 0; j < p.legs.length; j++) {
        const leg = p.legs[j];
        const badge = tierBadge(leg.tier, leg.gold_win_rate);
        const sportE = SPORT_EMOJI[leg.sport] || SPORT_EMOJI[normSport(leg.sport)] || "";
        
        msgLines.push(`${badge} *Leg ${j + 1}* — ${leg.tier} (${leg.gold_win_rate}% historical)`);
        msgLines.push(`*${leg.player_name}* ${leg.prediction}`);
        msgLines.push(`📗 ${formatProp(leg.prop_type)} ${sportE} | Signal: ${leg.signal_type}`);
        
        if (leg.line != null) {
          msgLines.push(`📊 Line: ${leg.line}`);
        }

        const sf = leg.signal_factors;
        if (sf.hit_rate || sf.l10_avg || sf.avg_stat) {
          const parts: string[] = [];
          if (sf.hit_rate) parts.push(`${(sf.hit_rate * 100).toFixed(0)}% hit rate`);
          if (sf.l10_avg || sf.avg_stat) parts.push(`${(sf.l10_avg || sf.avg_stat).toFixed(1)} avg`);
          if (sf.opponent || sf.opp) parts.push(`vs ${sf.opponent || sf.opp}`);
          msgLines.push(`🔥 ${parts.join(" · ")}`);
        }

        if (leg.edge > 0) {
          msgLines.push(`✅ Edge: ${(leg.edge * 100).toFixed(1)}%`);
        }
        msgLines.push("");
      }

      msgLines.push(`📈 Projected parlay win rate: *${p.projected_win_rate.toFixed(1)}%*`);
      msgLines.push("");
    }

    // Summary footer
    const t1Used = parlays.flatMap(p => p.legs).filter(l => l.tier === "TIER1").length;
    const t2Used = parlays.flatMap(p => p.legs).filter(l => l.tier === "TIER2").length;
    const crossSportCount = parlays.filter(p => p.cross_sport).length;

    msgLines.push("━━━ *Gold Signal Summary* ━━━");
    msgLines.push(`🟢 Tier 1 legs: ${t1Used} | 🔵 Tier 2 legs: ${t2Used}`);
    msgLines.push(`🌐 Cross-sport: ${crossSportCount} | 🚫 Blocked: ${blocked + poisoned_count + killed_count}`);
    msgLines.push(`📊 Pool: ${todayPicks.length} picks → ${tier1Legs.length + tier2Legs.length} gold → ${parlays.length} parlays`);
    msgLines.push("");
    msgLines.push("_Only proven 70%+ signal combos. No poison signals. No serial killers._");

    const message = msgLines.join("\n");

    try {
      await supabase.functions.invoke("bot-send-telegram", {
        body: { message, parse_mode: "Markdown", admin_only: true },
      });
      log("Telegram digest sent ✅");
    } catch (tgErr: any) {
      log(`Telegram send error: ${tgErr.message}`);
    }

    return new Response(JSON.stringify({
      success: true,
      parlays: parlays.length,
      details: parlays.map(p => ({
        blueprint: p.blueprint,
        legs: p.legs.length,
        projected_wr: p.projected_win_rate,
        cross_sport: p.cross_sport,
        leg_names: p.legs.map(l => `${l.player_name} ${l.prediction} (${l.tier} ${l.gold_win_rate}%)`),
      })),
      stats: {
        total_picks: todayPicks.length,
        tier1_available: tier1Legs.length,
        tier2_available: tier2Legs.length,
        blocked,
        poisoned: poisoned_count,
        serial_killed: killed_count,
        no_gold_match: no_match,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    log(`Error: ${error.message}`);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
