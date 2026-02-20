import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// MODULE 2: SIGNAL DETECTION CONSTANTS
// ============================================================================
const SIGNALS = {
  JUICE_DIVERGENCE: 20, // Price ≥20 cents, NO line move
  LINE_MOVE_AGAINST_PUBLIC: 20, // Tickets ≥65% one side, line opposite
  EARLY_SHARP_SNAP: 25, // Meaningful move within 10min of open
  MULTI_BOOK_CONFIRMATION: 15, // ≥3 books same direction in 30min
  PROMO_TRAP: -20, // Promo + public heavy + inflated line
  LATE_CHASE: -10, // Heavy movement in final 60min with tickets
};

// Signal label thresholds
function getSignalLabel(score: number): string {
  if (score >= 80) return "STRONG_SHARP";
  if (score >= 60) return "SHARP_LEAN";
  if (score >= 40) return "NEUTRAL";
  return "PUBLIC_TRAP";
}

// ============================================================================
// MODULE 3: STAT-TYPE SAFETY FILTER (ROLE PLAYER-FIRST)
// ============================================================================
const STAT_SAFETY_RULES: Record<string, { prefer: string[]; avoid: string[] }> = {
  basketball_nba: {
    prefer: ["rebounds", "assists", "blocks", "steals", "turnovers"], // Reb/Ast first
    avoid: ["points", "3pt_made", "fantasy_points", "pra", "double_double"], // Points blocked
  },
  icehockey_nhl: {
    prefer: ["shots_on_goal", "blocked_shots", "hits", "faceoffs_won"],
    avoid: ["points", "goals", "power_play_points"],
  },
  soccer: {
    prefer: ["passes", "tackles", "interceptions", "shots", "crosses"],
    avoid: ["goals", "anytime_scorer", "first_scorer"],
  },
  tennis: {
    prefer: ["aces", "double_faults", "games_won", "total_sets"],
    avoid: ["set_winner", "tiebreak"],
  },
};

// STRICT ARCHETYPE-PROP BLOCKING (v3.0 Dream Team Rule)
// If archetype is in this map and prop is in blocked list → ALWAYS BLOCK
const ARCHETYPE_PROP_BLOCKED: Record<string, string[]> = {
  ELITE_REBOUNDER: ["points", "threes", "assists"], // Only rebounds/blocks allowed
  GLASS_CLEANER: ["points", "threes", "assists"], // Only rebounds allowed
  PURE_SHOOTER: ["rebounds", "assists", "blocks"], // Only points/threes allowed
  PLAYMAKER: ["rebounds", "blocks", "threes"], // Only assists/points allowed
  RIM_PROTECTOR: ["points", "threes", "assists"], // Only blocks/rebounds allowed
  ROLE_PLAYER: ["points", "threes", "rebounds", "assists", "blocks", "steals"], // ALL blocked
};

// Check if archetype-prop combination is BLOCKED (strict enforcement)
function isArchetypePropBlocked(playerName: string, propType: string): boolean {
  const archetype = getPlayerArchetype(playerName);
  if (!archetype || archetype === "UNKNOWN") return false;

  const blocked = ARCHETYPE_PROP_BLOCKED[archetype];
  if (!blocked) return false;

  const propLower = propType?.toLowerCase() || "";
  const propCategory = propLower.includes("rebound")
    ? "rebounds"
    : propLower.includes("assist")
      ? "assists"
      : propLower.includes("block")
        ? "blocks"
        : propLower.includes("three") || propLower.includes("3pt")
          ? "threes"
          : "points";

  return blocked.includes(propCategory);
}

// Category recommendations map (loaded from category_sweet_spots)
let categoryRecommendations: Map<string, { side: string; hit_rate: number }> = new Map();

async function loadCategoryRecommendations(supabase: any): Promise<void> {
  const today = getEasternDate();
  const { data } = await supabase
    .from("category_sweet_spots")
    .select("player_name, prop_type, recommended_side, l10_hit_rate")
    .gte("l10_hit_rate", 0.7); // Only use high-confidence categories (70%+)

  categoryRecommendations.clear();
  for (const c of data || []) {
    const propLower = c.prop_type?.toLowerCase() || "";
    const propCategory = propLower.includes("rebound")
      ? "rebounds"
      : propLower.includes("assist")
        ? "assists"
        : propLower.includes("block")
          ? "blocks"
          : propLower.includes("three") || propLower.includes("3pt")
            ? "threes"
            : "points";
    const key = `${c.player_name?.toLowerCase()}_${propCategory}`;
    categoryRecommendations.set(key, {
      side: c.recommended_side?.toLowerCase() || "over",
      hit_rate: c.l10_hit_rate,
    });
  }
  console.log(`[Heat Engine] Loaded ${categoryRecommendations.size} category recommendations (70%+ L10)`);
}

// Runtime archetype data (populated from database)
let archetypeMap: Record<string, string> = {};

// Runtime team data (populated from database)
let playerTeamMap: Record<string, string> = {};

async function loadArchetypes(supabase: any): Promise<void> {
  const { data } = await supabase.from("player_archetypes").select("player_name, primary_archetype");
  archetypeMap = {};
  for (const a of data || []) {
    archetypeMap[a.player_name.toLowerCase()] = a.primary_archetype;
  }
  console.log(`[Heat Engine] Loaded ${Object.keys(archetypeMap).length} archetypes from DB`);
}

async function loadPlayerTeams(supabase: any): Promise<void> {
  const { data: players } = await supabase.from("bdl_player_cache").select("player_name, team_name");

  playerTeamMap = {};
  for (const p of players || []) {
    if (p.player_name && p.team_name) {
      playerTeamMap[p.player_name.toLowerCase()] = p.team_name;
    }
  }
  console.log(`[Heat Engine] Loaded ${Object.keys(playerTeamMap).length} player-team mappings`);
}

function getPlayerTeam(playerName: string): string {
  return playerTeamMap[playerName?.toLowerCase()] || "UNKNOWN";
}

function getPlayerArchetype(playerName: string): string {
  return archetypeMap[playerName?.toLowerCase()] || "UNKNOWN";
}

function isStarPlayer(playerName: string): boolean {
  const archetype = getPlayerArchetype(playerName);
  // Stars are ELITE_REBOUNDER, PLAYMAKER, PURE_SHOOTER, or COMBO_GUARD with high stats
  return ["ELITE_REBOUNDER", "PLAYMAKER", "PURE_SHOOTER", "COMBO_GUARD", "SCORING_WING"].includes(archetype);
}
// Infer player role from category_sweet_spots category (for fallback)
function inferRoleFromCategory(category: string): string {
  const cat = category?.toUpperCase() || "";
  if (cat.includes("STAR") || cat.includes("FLOOR")) return "STAR";
  if (cat.includes("ELITE")) return "ELITE_REBOUNDER";
  if (cat.includes("ROLE_PLAYER") || cat.includes("ROLE")) return "ROLE_PLAYER";
  if (cat.includes("ASSIST") || cat.includes("PLAYMAKER")) return "PLAYMAKER";
  if (cat.includes("BIG") || cat.includes("REB")) return "BIG";
  return "SECONDARY_GUARD";
}

// Check if archetype-prop is aligned (inverse of blocked)
function isArchetypeAligned(playerName: string, propType: string): boolean {
  return !isArchetypePropBlocked(playerName, propType);
}

// Stat priority for scoring (rebounds/assists >> points)
const STAT_PRIORITY: Record<string, number> = {
  rebounds: 10,
  assists: 9,
  blocks: 7,
  steals: 6,
  threes: 4,
  points: 2, // Lowest - deprioritized
};

function getStatPriorityScore(propType: string): number {
  const lower = propType?.toLowerCase() || "";
  for (const [stat, priority] of Object.entries(STAT_PRIORITY)) {
    if (lower.includes(stat)) return priority;
  }
  return 5;
}

// MEDIAN DEAD-ZONE FILTER: If line is within ±0.5 of median → no edge (coin-flip)
function isInMedianDeadZone(line: number, median: number): boolean {
  return Math.abs(line - median) <= 0.5;
}

// Star players with role-based exceptions
const NEVER_FADE_PRA = [
  "jaylen brown",
  "jayson tatum",
  "devin booker",
  "luka doncic",
  "nikola jokic",
  "giannis antetokounmpo",
];

// ============================================================================
// MODULE 4: ROLE/ROTATION VALIDATION
// ============================================================================
function passesRoleValidation(
  sport: string,
  side: string,
  projectedMinutes: number | null,
  playerRoleTag: string | null,
  playerName: string,
  marketType: string,
): { passes: boolean; reason?: string } {
  const lowerName = playerName.toLowerCase();

  // NBA minutes filter
  if (sport === "basketball_nba" && side === "over") {
    if (projectedMinutes && projectedMinutes < 24) {
      return { passes: false, reason: `Projected ${projectedMinutes} minutes < 24 min threshold` };
    }
  }

  // Never fade PRA for certain stars
  if (NEVER_FADE_PRA.includes(lowerName) && side === "under") {
    const praMarkets = ["points", "rebounds", "assists", "pra"];
    if (praMarkets.includes(marketType.toLowerCase())) {
      return { passes: false, reason: `Never fade ${playerName} ${marketType} under` };
    }
  }

  return { passes: true };
}

function passesStatSafety(
  sport: string,
  marketType: string,
  playerName?: string,
): { passes: boolean; reason?: string } {
  const rules = STAT_SAFETY_RULES[sport];
  if (!rules) return { passes: true };

  const lowerMarket = marketType.toLowerCase();

  // NEW: Hard block points for star players
  if (playerName && isStarPlayer(playerName)) {
    if (lowerMarket.includes("points") && !lowerMarket.includes("rebounds") && !lowerMarket.includes("assists")) {
      return { passes: false, reason: `Star player ${playerName} - use rebounds/assists instead of points` };
    }
  }

  // Check if in avoid list
  for (const avoided of rules.avoid) {
    if (lowerMarket.includes(avoided)) {
      return { passes: false, reason: `${marketType} is a high-variance stat type` };
    }
  }

  return { passes: true };
}

// ============================================================================
// MODULE 5: TIME-WEIGHTED CONFIDENCE DECAY
// ============================================================================
function calculateTimeDecay(hoursToStart: number, signalLabel: string): number {
  if (hoursToStart > 6) return 0;
  if (hoursToStart >= 2 && hoursToStart <= 6) return -3;
  if (hoursToStart < 2 && signalLabel !== "STRONG_SHARP") return -6;
  return 0;
}

// ============================================================================
// MODULE 2: SIGNAL SCORING
// ============================================================================
function calculateMarketSignalScore(
  lineDelta: number,
  priceDelta: number,
  publicPctTickets: number | null,
  promoFlag: boolean,
  hoursToGame: number,
  multiBookCount: number,
): { score: number; signals: string[] } {
  let score = 50; // Base score
  const signals: string[] = [];

  // A) JUICE DIVERGENCE: Price moves ≥20 cents with NO line move
  if (Math.abs(priceDelta) >= 20 && Math.abs(lineDelta) < 0.5) {
    score += SIGNALS.JUICE_DIVERGENCE;
    signals.push("JUICE_DIVERGENCE");
  }

  // B) LINE MOVE AGAINST PUBLIC
  if (publicPctTickets && publicPctTickets >= 65 && Math.abs(lineDelta) >= 0.5) {
    // Assuming line moved against public (would need direction data)
    score += SIGNALS.LINE_MOVE_AGAINST_PUBLIC;
    signals.push("LINE_MOVE_AGAINST_PUBLIC");
  }

  // C) EARLY SHARP SNAP (12-24h is optimal)
  if (hoursToGame >= 12 && hoursToGame <= 24 && Math.abs(lineDelta) >= 0.5) {
    score += SIGNALS.EARLY_SHARP_SNAP;
    signals.push("EARLY_SHARP_SNAP");
  }

  // D) MULTI-BOOK CONFIRMATION
  if (multiBookCount >= 3) {
    score += SIGNALS.MULTI_BOOK_CONFIRMATION;
    signals.push("MULTI_BOOK_CONFIRMATION");
  }

  // E) PROMO TRAP
  if (promoFlag && publicPctTickets && publicPctTickets >= 60) {
    score += SIGNALS.PROMO_TRAP;
    signals.push("PROMO_TRAP");
  }

  // F) LATE CHASE
  if (hoursToGame < 1 && publicPctTickets && publicPctTickets >= 60) {
    score += SIGNALS.LATE_CHASE;
    signals.push("LATE_CHASE");
  }

  return { score: Math.max(0, Math.min(100, score)), signals };
}

// ============================================================================
// BASE ROLE SCORE (0-50) - Now with role-based granularity
// ============================================================================
const ROLE_BASE_SCORES: Record<string, number> = {
  BALL_DOMINANT_STAR: 45,
  STAR: 42,
  SECONDARY_GUARD: 38,
  WING: 35,
  BIG: 40,
};

function calculateBaseRoleScore(
  sport: string,
  marketType: string,
  playerRoleTag: string | null,
  playerRole?: string | null, // From nba_risk_engine_picks.player_role
  playerName?: string | null, // For star check
  confidenceScore?: number, // NEW: for score variance
  hoursToGame?: number, // NEW: for time-based variance
): number {
  const rules = STAT_SAFETY_RULES[sport];

  // Start with role-based score for granularity (range: 35-45)
  let baseScore = playerRole ? ROLE_BASE_SCORES[playerRole] || 38 : 38;

  if (!rules) return Math.min(baseScore, 85); // Cap at 85 to ensure watchlist range

  const lowerMarket = marketType.toLowerCase();

  // Stat priority adjustments (range: -10 to +15)
  const statPriority = getStatPriorityScore(marketType);
  if (statPriority >= 9)
    baseScore += 15; // Rebounds/Assists: +15
  else if (statPriority >= 7)
    baseScore += 8; // Blocks/Steals: +8
  else if (statPriority >= 4)
    baseScore += 0; // Threes: neutral
  else if (statPriority <= 2) baseScore -= 10; // Points: -10

  // Star player + points = heavy penalty
  if (playerName && isStarPlayer(playerName) && lowerMarket.includes("points")) {
    baseScore -= 15;
  }

  // NEW: Confidence-based variance (range: -8 to +10)
  if (confidenceScore !== undefined) {
    if (confidenceScore >= 9.5) baseScore += 10;
    else if (confidenceScore >= 9.0) baseScore += 6;
    else if (confidenceScore >= 8.5) baseScore += 3;
    else if (confidenceScore >= 8.0) baseScore += 0;
    else if (confidenceScore >= 7.5) baseScore -= 4;
    else baseScore -= 8; // Low confidence penalty
  }

  // NEW: Time-to-game variance (range: -5 to +5)
  if (hoursToGame !== undefined) {
    if (hoursToGame >= 4 && hoursToGame <= 8)
      baseScore += 5; // Optimal window
    else if (hoursToGame >= 2 && hoursToGame < 4) baseScore += 2;
    else if (hoursToGame > 8)
      baseScore -= 3; // Too early
    else if (hoursToGame < 2) baseScore -= 5; // Too late
  }

  // Bonus for preferred stats (+8-12)
  for (const preferred of rules.prefer) {
    if (lowerMarket.includes(preferred)) {
      const preferBonus = playerRoleTag === "star" ? 12 : 8;
      baseScore += preferBonus;
      break; // Only apply once
    }
  }

  // Penalty for avoided stats (-15)
  for (const avoided of rules.avoid) {
    if (lowerMarket.includes(avoided)) {
      baseScore -= 15;
      break; // Only apply once
    }
  }

  // Clamp final score to ensure proper distribution (30-95)
  return Math.max(30, Math.min(95, baseScore));
}

// ============================================================================
// DERIVE SIGNAL FROM RISK ENGINE DATA (ENHANCED FOR UNDER VALIDATION)
// ============================================================================
function deriveSignalFromPick(pick: any): { label: string; score: number } {
  const confidence = pick.confidence_score || 0;
  const lineDelta = pick.line_delta || (pick.current_line && pick.line ? pick.current_line - pick.line : 0);
  const isBallDominant = pick.is_ball_dominant || pick.player_role === "BALL_DOMINANT_STAR";
  const isPra = pick.is_pra || pick.prop_type?.toLowerCase().includes("pra");
  const gameScript = pick.game_script || "competitive";
  const side = pick.side?.toLowerCase() || "over";
  const trueMedian = pick.true_median || pick.rolling_median || 0;
  const line = pick.current_line || pick.line || 0;

  // CRITICAL: For UNDER bets, validate median is BELOW line
  // If median > line for under bet → PUBLIC_TRAP (player exceeds line on average)
  if (side === "under" && trueMedian > 0 && line > 0) {
    if (trueMedian > line) {
      // Median is above line for an UNDER bet → This is a trap!
      return { label: "PUBLIC_TRAP", score: 25 };
    }

    // For valid unders: reward when median is significantly below line
    const underEdge = line - trueMedian;
    if (underEdge >= 2.0) {
      // Strong under edge: median is 2+ below line
      if (confidence >= 8.5) {
        return { label: "STRONG_SHARP", score: 88 };
      }
      return { label: "SHARP_LEAN", score: 72 };
    }
  }

  // High confidence with line movement = SHARP_LEAN
  if (confidence >= 8.5 && Math.abs(lineDelta) >= 0.5) {
    return { label: "SHARP_LEAN", score: 70 };
  }

  // Very high confidence = STRONG_SHARP
  if (confidence >= 9.0) {
    return { label: "STRONG_SHARP", score: 85 };
  }

  // Good confidence = SHARP_LEAN
  if (confidence >= 8.0) {
    return { label: "SHARP_LEAN", score: 65 };
  }

  // Ball-dominant star on competitive game with public appeal = PUBLIC_LEAN
  if (isBallDominant && gameScript === "competitive" && isPra) {
    return { label: "PUBLIC_LEAN", score: 45 };
  }

  // Low confidence with high public appeal (PRA) = PUBLIC_TRAP
  if (confidence < 7.5 && isPra) {
    return { label: "PUBLIC_TRAP", score: 30 };
  }

  // Default neutral
  return { label: "NEUTRAL", score: 50 };
}

// ============================================================================
// MODULE 6: PARLAY BUILDING
// ============================================================================
interface ParlayLeg {
  player_name: string;
  team: string; // Player's team for diversity enforcement
  market_type: string;
  line: number;
  side: string;
  book_name: string;
  final_score: number;
  signal_label: string;
  reason: string;
  event_id: string;
  sport: string;
  // v4.0: Projection fields
  projected_value?: number;
  actual_line?: number;
  edge?: number;
}

// Projection lookup map (populated at build time)
let projectionMap: Map<string, { projectedValue: number; actualLine: number }> = new Map();

async function loadProjections(supabase: any): Promise<void> {
  const today = getEasternDate();
  const { data } = await supabase
    .from("category_sweet_spots")
    .select("player_name, prop_type, projected_value, actual_line")
    .eq("analysis_date", today)
    .not("projected_value", "is", null);

  projectionMap.clear();
  for (const p of data || []) {
    // Normalize prop_type: 'player_rebounds' -> 'rebounds'
    const propLower = p.prop_type?.toLowerCase().replace("player_", "") || "";
    const key = `${p.player_name?.toLowerCase()}_${propLower}`;
    projectionMap.set(key, {
      projectedValue: p.projected_value,
      actualLine: p.actual_line || p.recommended_line,
    });
  }
  console.log(`[Heat Engine] Loaded ${projectionMap.size} projections from category_sweet_spots`);
}

// Helper to categorize prop types for diversity
function getPropCategory(propType: string): string {
  const lower = propType?.toLowerCase() || "";
  if (lower.includes("rebound")) return "rebounds";
  if (lower.includes("assist")) return "assists";
  if (lower.includes("point") && !lower.includes("rebound") && !lower.includes("assist")) return "points";
  if (lower.includes("three") || lower.includes("3pt")) return "threes";
  if (lower.includes("block")) return "blocks";
  if (lower.includes("steal")) return "steals";
  return "other";
}

function buildParlays(
  eligibleProps: any[],
  parlayType: "CORE" | "UPSIDE",
  excludePlayerNames: string[] = [], // Exclude these players (used for UPSIDE to avoid CORE overlap)
): { leg_1: ParlayLeg; leg_2: ParlayLeg; summary: string; risk_level: string; team_diversity: number } | null {
  const minScore = parlayType === "CORE" ? 78 : 70;

  // Filter by score threshold AND exclude already-used players
  let candidates = eligibleProps.filter(
    (p) => p.final_score >= minScore && !excludePlayerNames.includes(p.player_name),
  );

  // CORE: Reject PUBLIC_TRAP, prefer low-variance stats
  if (parlayType === "CORE") {
    candidates = candidates.filter((p) => p.signal_label !== "PUBLIC_TRAP");
    // Sort by stat priority first (rebounds/assists > points), then score
    // CRITICAL FIX: Added stable tie-breakers (player_name, event_id) to ensure deterministic ordering
    candidates.sort((a, b) => {
      const aPriority = getStatPriorityScore(a.market_type);
      const bPriority = getStatPriorityScore(b.market_type);
      if (bPriority !== aPriority) return bPriority - aPriority;
      if (b.final_score !== a.final_score) return b.final_score - a.final_score;
      // Stable tie-breaker: player name (alphabetical)
      const nameCompare = (a.player_name || "").localeCompare(b.player_name || "");
      if (nameCompare !== 0) return nameCompare;
      // Final tie-breaker: event_id for complete determinism
      return (a.event_id || "").localeCompare(b.event_id || "");
    });
  }

  // UPSIDE: Prioritize sharp-confirmed legs for variety
  if (parlayType === "UPSIDE") {
    // Boost STRONG_SHARP and SHARP_LEAN to the top, then sort by stat priority, then score
    // CRITICAL FIX: Added stable tie-breakers (player_name, event_id) to ensure deterministic ordering
    candidates.sort((a, b) => {
      const aSharp = ["STRONG_SHARP", "SHARP_LEAN"].includes(a.signal_label) ? 1 : 0;
      const bSharp = ["STRONG_SHARP", "SHARP_LEAN"].includes(b.signal_label) ? 1 : 0;
      if (bSharp !== aSharp) return bSharp - aSharp;
      const aPriority = getStatPriorityScore(a.market_type);
      const bPriority = getStatPriorityScore(b.market_type);
      if (bPriority !== aPriority) return bPriority - aPriority;
      if (b.final_score !== a.final_score) return b.final_score - a.final_score;
      // Stable tie-breaker: player name (alphabetical)
      const nameCompare = (a.player_name || "").localeCompare(b.player_name || "");
      if (nameCompare !== 0) return nameCompare;
      // Final tie-breaker: event_id for complete determinism
      return (a.event_id || "").localeCompare(b.event_id || "");
    });
  }

  if (candidates.length < 2) return null;

  // NEW: Prop type diversity requirement - try to get different prop types
  const propCategories = new Set<string>();
  let leg1 = candidates[0];
  propCategories.add(getPropCategory(leg1.market_type));
  const leg1IsStar = isStarPlayer(leg1.player_name);
  const leg1Team = getPlayerTeam(leg1.player_name);

  // Find leg2: different player, different team, respect one-star limit, PREFER different prop type
  let leg2 = candidates.find((c) => {
    if (c.player_name === leg1.player_name) return false;
    if (c.event_id === leg1.event_id) return false; // Different games preferred

    // NEW: Team diversity enforcement - must be different team
    const candidateTeam = getPlayerTeam(c.player_name);
    if (candidateTeam === leg1Team && candidateTeam !== "UNKNOWN" && leg1Team !== "UNKNOWN") {
      console.log(`[Heat Engine] Skipping ${c.player_name} (${candidateTeam}) - same team as ${leg1.player_name}`);
      return false;
    }

    const isStar = isStarPlayer(c.player_name);
    if (leg1IsStar && isStar) return false;

    // DIVERSITY: MUST be different prop type for 2-leg parlays (strict enforcement)
    const category = getPropCategory(c.market_type);
    if (propCategories.has(category)) {
      console.log(`[Heat Engine] Skipping ${c.player_name} ${c.market_type} - same prop type (${category}) as leg1`);
      return false;
    }
    return true;
  });

  // If no diverse option found with different team, fall back to any valid leg with different team
  if (!leg2) {
    leg2 = candidates.find((c) => {
      if (c.player_name === leg1.player_name) return false;

      // Still enforce team diversity in fallback
      const candidateTeam = getPlayerTeam(c.player_name);
      if (candidateTeam === leg1Team && candidateTeam !== "UNKNOWN" && leg1Team !== "UNKNOWN") {
        return false;
      }

      const isStar = isStarPlayer(c.player_name);
      if (leg1IsStar && isStar) return false;
      return true;
    });
  }

  // Last resort: if still no leg2 found, accept any different player (log warning)
  if (!leg2) {
    leg2 = candidates.find((c) => {
      if (c.player_name === leg1.player_name) return false;
      const isStar = isStarPlayer(c.player_name);
      if (leg1IsStar && isStar) return false;
      return true;
    });
    if (leg2) {
      console.warn(`[Heat Engine] Warning: ${parlayType} parlay has same-team players - no team diversity available`);
    }
  }

  if (!leg2) return null;

  const formatLeg = (p: any): ParlayLeg => {
    // Lookup projection data
    const marketLower = p.market_type?.toLowerCase().replace("player_", "") || "";
    const projKey = `${p.player_name?.toLowerCase()}_${marketLower}`;
    const projection = projectionMap.get(projKey);
    const side = p.side?.toLowerCase() || "over";

    // Calculate edge: OVER = projected - line, UNDER = line - projected
    let edge: number | undefined;
    if (projection?.projectedValue != null && projection?.actualLine != null) {
      edge =
        side === "over"
          ? projection.projectedValue - projection.actualLine
          : projection.actualLine - projection.projectedValue;
    }

    return {
      player_name: p.player_name,
      team: getPlayerTeam(p.player_name),
      market_type: p.market_type,
      line: p.latest_line,
      side: p.side,
      book_name: p.book_name,
      final_score: p.final_score,
      signal_label: p.signal_label,
      reason: generateLegReason(p),
      event_id: p.event_id,
      sport: p.sport,
      // v4.0: Include projection data
      projected_value: projection?.projectedValue,
      actual_line: projection?.actualLine,
      edge,
    };
  };

  // Calculate team diversity
  const leg2Team = getPlayerTeam(leg2.player_name);
  const teamDiversity = leg1Team !== leg2Team && leg1Team !== "UNKNOWN" && leg2Team !== "UNKNOWN" ? 2 : 1;

  // Log diversity status
  const leg1Cat = getPropCategory(leg1.market_type);
  const leg2Cat = getPropCategory(leg2.market_type);
  console.log(
    `[Heat Engine] ${parlayType} parlay: ${leg1Cat} + ${leg2Cat} (diverse: ${leg1Cat !== leg2Cat}), teams: ${leg1Team} + ${leg2Team}`,
  );

  return {
    leg_1: formatLeg(leg1),
    leg_2: formatLeg(leg2),
    summary:
      parlayType === "CORE"
        ? `Role player ${leg1Cat}/${leg2Cat} with strong market signals`
        : `Higher upside with sharp-confirmed legs (${leg1Cat}/${leg2Cat})`,
    risk_level: parlayType === "CORE" ? "Low" : "Med",
    team_diversity: teamDiversity,
  };
}

function generateLegReason(prop: any): string {
  const parts: string[] = [];

  if (prop.signal_label === "STRONG_SHARP") {
    parts.push("Strong sharp action detected");
  } else if (prop.signal_label === "SHARP_LEAN") {
    parts.push("Sharp lean confirmed");
  }

  if (prop.line_delta && Math.abs(prop.line_delta) >= 0.5) {
    const dir = prop.line_delta > 0 ? "up" : "down";
    parts.push(`Line moved ${Math.abs(prop.line_delta).toFixed(1)} ${dir}`);
  }

  const rules = STAT_SAFETY_RULES[prop.sport];
  if (rules) {
    const lowerMarket = prop.market_type.toLowerCase();
    for (const pref of rules.prefer) {
      if (lowerMarket.includes(pref)) {
        parts.push(`Volume stat (${pref})`);
        break;
      }
    }
  }

  return parts.length > 0 ? parts.join("; ") : "Meets all validation rules";
}

// Helper function to get today's date in Eastern Time (NBA game time)
function getEasternDate(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now); // Returns 'YYYY-MM-DD'
}

// ============================================================================
// MAIN ENGINE
// ============================================================================
async function runHeatEngine(supabase: any, action: string, sport?: string) {
  const today = getEasternDate();
  const now = new Date();

  // Load runtime data at start
  await loadArchetypes(supabase);
  await loadPlayerTeams(supabase);
  await loadCategoryRecommendations(supabase);
  await loadProjections(supabase); // v4.0: Load projections for parlay legs

  // MATCHUP INTELLIGENCE INTEGRATION: Fetch blocked picks first
  const { data: blockedPicks, error: blockedError } = await supabase
    .from("matchup_intelligence")
    .select("player_name, prop_type, side, line, block_reason")
    .eq("game_date", today)
    .eq("is_blocked", true);

  if (blockedError) {
    console.warn("[Heat Engine] Warning: Could not fetch blocked picks:", blockedError.message);
  }

  // Create lookup set for blocked picks
  const blockedSet = new Set(
    (blockedPicks || []).map(
      (p: any) => `${p.player_name?.toLowerCase()}_${p.prop_type?.toLowerCase()}_${p.side?.toLowerCase()}_${p.line}`,
    ),
  );

  console.log(`[Heat Engine] Loaded ${blockedSet.size} blocked picks from matchup intelligence`);

  // Stats for v3.0 rule tracking
  let archetypeBlockedCount = 0;
  let categorySideBlockedCount = 0;

  console.log(`[Heat Prop Engine] Running action: ${action}, sport: ${sport || "all"}, date: ${today}`);

  if (action === "scan" || action === "ingest") {
    const nowISO = now.toISOString();

    // First, verify we have source data (unified_props with NBA games)
    const { data: nbaProps, error: propsCheckError } = await supabase
      .from("unified_props")
      .select("event_id")
      .eq("sport", "basketball_nba")
      .gt("commence_time", nowISO) // Only FUTURE games
      .limit(1);

    if (propsCheckError) {
      console.error("[Heat Engine] Error checking unified_props:", propsCheckError);
    }

    if (!nbaProps || nbaProps.length === 0) {
      console.warn("[Heat Engine] NO NBA PROPS in unified_props - run refresh-todays-props first");
      return {
        success: false,
        error: "NO_SOURCE_DATA",
        message: "No NBA props available. Run refresh-todays-props for basketball_nba first.",
      };
    }

    // CRITICAL: Fetch actual commence times from unified_props (source of truth)
    const { data: unifiedPropsData } = await supabase
      .from("unified_props")
      .select("player_name, prop_type, commence_time, event_id")
      .eq("sport", "basketball_nba")
      .gt("commence_time", nowISO); // Only FUTURE games

    // Build lookup map for commence times (player+prop -> commence_time)
    const commenceTimeMap: Record<string, { commence_time: string; event_id: string }> = {};
    for (const p of unifiedPropsData || []) {
      const key = `${p.player_name?.toLowerCase()}|${p.prop_type?.toLowerCase()}`;
      commenceTimeMap[key] = {
        commence_time: p.commence_time,
        event_id: p.event_id,
      };
    }
    console.log(`[Heat Engine] Loaded ${Object.keys(commenceTimeMap).length} future props from unified_props`);

    // Fetch props from nba_risk_engine_picks as source data
    // Filter by mode='full_slate' and no rejection_reason (these are approved picks)
    const { data: picks, error: picksError } = await supabase
      .from("nba_risk_engine_picks")
      .select("*")
      .gte("game_date", today)
      .eq("mode", "full_slate")
      .is("rejection_reason", null);

    if (picksError) {
      console.error("Error fetching picks:", picksError);
      return { success: false, error: picksError.message };
    }

    console.log(`[Heat Engine] Found ${picks?.length || 0} approved picks from Risk Engine`);

    // FALLBACK: If Risk Engine has no data, use category_sweet_spots
    let fallbackUsed = false;
    let processablePicks = picks || [];

    if (!picks || picks.length === 0) {
      console.log("[Heat Engine] No Risk Engine picks, using category_sweet_spots as fallback");

      const { data: sweetSpotPicks, error: sweetSpotError } = await supabase
        .from("category_sweet_spots")
        .select("*")
        .eq("analysis_date", today)
        .gte("confidence_score", 0.7)
        .not("actual_line", "is", null)
        .eq("is_active", true);

      if (sweetSpotError) {
        console.error("[Heat Engine] Error fetching category_sweet_spots:", sweetSpotError);
        return { success: false, error: sweetSpotError.message };
      }

      if (!sweetSpotPicks || sweetSpotPicks.length === 0) {
        return {
          success: false,
          error: "NO_SOURCE_DATA",
          message: "No approved picks from Risk Engine and no category_sweet_spots available for today.",
          processed: 0,
        };
      }

      // Convert category_sweet_spots to Risk Engine-compatible format
      processablePicks = sweetSpotPicks.map((p: any) => ({
        player_name: p.player_name,
        prop_type: p.prop_type,
        line: p.actual_line,
        current_line: p.actual_line,
        side: p.recommended_side || "over",
        confidence_score: (p.confidence_score || 0.7) * 10, // Scale 0.8 -> 8.0
        game_date: today,
        player_role: inferRoleFromCategory(p.category),
        avg_minutes: null,
        true_median: p.l10_avg,
        rolling_median: p.l10_avg,
        l10_hit_rate: p.l10_hit_rate,
        category: p.category,
        // These won't exist in category data, but needed for compatibility
        mode: "category_fallback",
        rejection_reason: null,
      }));

      fallbackUsed = true;
      console.log(`[Heat Engine] FALLBACK: Using ${processablePicks.length} picks from category_sweet_spots`);
    }

    // Process each pick and upsert to heat_prop_tracker
    const trackerUpserts: any[] = [];
    let skippedStale = 0;

    for (const pick of processablePicks) {
      // MATCHUP INTELLIGENCE: Skip blocked picks
      const blockKey = `${pick.player_name?.toLowerCase()}_${pick.prop_type?.toLowerCase()}_${(pick.side || "over")?.toLowerCase()}_${pick.line}`;
      if (blockedSet.has(blockKey)) {
        const blockReason =
          blockedPicks?.find(
            (bp: any) =>
              bp.player_name?.toLowerCase() === pick.player_name?.toLowerCase() &&
              bp.prop_type?.toLowerCase() === pick.prop_type?.toLowerCase(),
          )?.block_reason || "Blocked by matchup intelligence";
        console.log(`[Heat Engine] BLOCKED: ${pick.player_name} ${pick.prop_type} ${pick.side} - ${blockReason}`);
        continue;
      }

      // v3.0 RULE: STRICT ARCHETYPE-PROP BLOCKING (before any other rules)
      if (isArchetypePropBlocked(pick.player_name, pick.prop_type)) {
        const archetype = getPlayerArchetype(pick.player_name);
        console.log(`[Heat Engine] ARCHETYPE BLOCKED: ${pick.player_name} (${archetype}) for ${pick.prop_type}`);
        archetypeBlockedCount++;
        continue;
      }

      // v3.0 RULE: CATEGORY-SIDE ENFORCEMENT
      const propLower = pick.prop_type?.toLowerCase() || "";
      const propCategory = propLower.includes("rebound")
        ? "rebounds"
        : propLower.includes("assist")
          ? "assists"
          : propLower.includes("block")
            ? "blocks"
            : propLower.includes("three") || propLower.includes("3pt")
              ? "threes"
              : "points";
      const categoryKey = `${pick.player_name?.toLowerCase()}_${propCategory}`;
      const categoryRec = categoryRecommendations.get(categoryKey);
      const pickSide = (pick.side || "over").toLowerCase();

      if (categoryRec && categoryRec.side !== pickSide) {
        console.log(
          `[Heat Engine] CATEGORY CONFLICT: ${pick.player_name} ${pick.prop_type} - category says ${categoryRec.side.toUpperCase()} (${Math.round(categoryRec.hit_rate * 100)}% L10), pick says ${pickSide.toUpperCase()}`,
        );
        categorySideBlockedCount++;
        continue;
      }

      // CRITICAL: Get real commence time from unified_props
      const propKey = `${pick.player_name?.toLowerCase()}|${pick.prop_type?.toLowerCase()}`;
      const commenceInfo = commenceTimeMap[propKey];

      // Skip props where game has already started or no commence time found
      if (!commenceInfo) {
        console.log(`[Heat] Skipping ${pick.player_name} ${pick.prop_type} - no future game found`);
        skippedStale++;
        continue;
      }

      const gameStartTime = new Date(commenceInfo.commence_time);
      if (gameStartTime <= now) {
        console.log(`[Heat] Skipping ${pick.player_name} - game already started at ${commenceInfo.commence_time}`);
        skippedStale++;
        continue;
      }

      const hoursToGame = (gameStartTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Map fields from nba_risk_engine_picks schema
      const sport = "basketball_nba";
      const side = pick.side?.toLowerCase() || "over";
      const lineDelta = pick.current_line && pick.line ? pick.current_line - pick.line : 0;
      const priceDelta = 0; // Not available in source
      const projectedMinutes = pick.avg_minutes || null;
      const roleTag = pick.player_role || null;

      // Derive signal from Risk Engine data first (for better accuracy)
      const derivedSignal = deriveSignalFromPick(pick);

      // Calculate market signals (will be combined with derived signal)
      const { score: marketSignalScore, signals } = calculateMarketSignalScore(
        lineDelta,
        priceDelta,
        null, // public_pct not available
        false, // is_promo not available
        hoursToGame,
        1, // confirming_books default
      );

      // Use better of derived signal score or market signal score
      const signalScore = Math.max(derivedSignal.score, marketSignalScore);
      const signalLabel = derivedSignal.label !== "NEUTRAL" ? derivedSignal.label : getSignalLabel(marketSignalScore);

      // Calculate base role score with player role for granularity
      const baseRoleScore = calculateBaseRoleScore(
        sport,
        pick.prop_type,
        roleTag,
        pick.player_role, // Pass player role for score variation
        pick.player_name, // Pass player name for star check
        pick.confidence_score, // NEW: Pass confidence for score variance
        hoursToGame, // NEW: Pass hours to game for time variance
      );

      // Calculate time decay
      const timeDecay = calculateTimeDecay(hoursToGame, signalLabel);

      // Final score (now has more variance)
      const finalScore = Math.min(100, Math.max(0, baseRoleScore + signalScore + timeDecay));

      // Validation (now includes star player check)
      const statSafety = passesStatSafety(sport, pick.prop_type, pick.player_name);
      const roleValidation = passesRoleValidation(
        sport,
        side,
        projectedMinutes,
        roleTag,
        pick.player_name,
        pick.prop_type,
      );

      // MEDIAN DEAD-ZONE FILTER (±0.5): If line is within ±0.5 of median → no edge
      const rollingMedian = pick.rolling_median || pick.median_l10;
      const currentLine = pick.line + lineDelta;
      const inDeadZone = rollingMedian && isInMedianDeadZone(currentLine, rollingMedian);

      if (inDeadZone) {
        console.log(`[Heat] Dead zone skip: ${pick.player_name} line ${currentLine} vs median ${rollingMedian}`);
      }

      // Eligibility (now includes dead-zone filter)
      const isEligibleCore =
        finalScore >= 78 && statSafety.passes && roleValidation.passes && signalLabel !== "PUBLIC_TRAP" && !inDeadZone;

      const isEligibleUpside =
        finalScore >= 70 &&
        roleValidation.passes &&
        (signalLabel === "STRONG_SHARP" || signalLabel === "SHARP_LEAN" || statSafety.passes) &&
        !inDeadZone;

      trackerUpserts.push({
        event_id: commenceInfo.event_id || pick.event_id || `${pick.player_name}-${pick.prop_type}-${today}`,
        sport: sport,
        league: "NBA",
        start_time_utc: commenceInfo.commence_time, // Use REAL game time from unified_props
        home_team: null, // Not available in source
        away_team: null, // Not available in source
        player_name: pick.player_name,
        market_type: pick.prop_type,
        opening_line: pick.line,
        opening_price: pick.odds || -110,
        opening_time: now.toISOString(),
        latest_line: pick.line + lineDelta,
        latest_price: (pick.odds || -110) + priceDelta,
        latest_time: now.toISOString(),
        line_delta: lineDelta,
        price_delta: priceDelta,
        update_count: 1,
        projected_minutes: pick.projected_minutes,
        player_role_tag: pick.role_tag,
        market_signal_score: signalScore,
        signal_label: signalLabel,
        base_role_score: baseRoleScore,
        final_score: finalScore,
        passes_stat_safety: statSafety.passes,
        passes_role_validation: roleValidation.passes,
        is_eligible_core: isEligibleCore,
        is_eligible_upside: isEligibleUpside,
        book_name: pick.bookmaker || "fanduel",
        side: pick.pick_side?.toLowerCase() || "over",
        updated_at: now.toISOString(),
      });
    }

    // Upsert to tracker
    if (trackerUpserts.length > 0) {
      const { error: upsertError } = await supabase.from("heat_prop_tracker").upsert(trackerUpserts, {
        onConflict: "event_id,player_name,market_type,book_name,side",
      });

      if (upsertError) {
        console.error("Error upserting tracker:", upsertError);
        return { success: false, error: upsertError.message };
      }
    }

    console.log(`[Heat Engine] Upserted ${trackerUpserts.length} props to tracker, skipped ${skippedStale} stale`);

    return {
      success: true,
      processed: trackerUpserts.length,
      skipped_stale: skippedStale,
      eligible_core: trackerUpserts.filter((t) => t.is_eligible_core).length,
      eligible_upside: trackerUpserts.filter((t) => t.is_eligible_upside).length,
    };
  }

  if (action === "build") {
    const nowISO = now.toISOString();

    // CRITICAL: Clear stale parlays FIRST before rebuilding
    // This prevents yesterday's settled parlays from showing as today's
    console.log(`[Heat Engine] Clearing stale data for ${today}...`);

    const { error: clearParlaysError } = await supabase.from("heat_parlays").delete().eq("parlay_date", today);

    if (clearParlaysError) {
      console.error("[Heat Engine] Error clearing parlays:", clearParlaysError);
    }

    // CRITICAL: Delete ALL tracker entries for games that have ALREADY STARTED (UTC-aware)
    const { error: cleanupError, count: cleanedCount } = await supabase
      .from("heat_prop_tracker")
      .delete()
      .lt("start_time_utc", nowISO);

    console.log(`[Heat Engine] Cleaned ${cleanedCount || 0} stale tracker entries (games started before ${nowISO})`);

    // Fetch eligible props from tracker - only FUTURE games
    const { data: eligibleProps, error: fetchError } = await supabase
      .from("heat_prop_tracker")
      .select("*")
      .gt("start_time_utc", nowISO) // Only games that haven't started yet
      .or("is_eligible_core.eq.true,is_eligible_upside.eq.true")
      .order("final_score", { ascending: false });

    if (fetchError) {
      console.error("Error fetching eligible props:", fetchError);
      return { success: false, error: fetchError.message };
    }

    console.log(`[Heat Engine] Found ${eligibleProps?.length || 0} eligible props for today`);

    // MINIMUM PROJECTION BUFFER GATE (0.3) - filter out thin edges before building
    const bufferedProps = eligibleProps?.filter((p: any) => {
      const projKey = `${p.player_name?.toLowerCase()}_${(p.market_type || '').toLowerCase().replace('player_', '')}`;
      const projection = projectionMap.get(projKey);
      if (projection?.projectedValue && projection?.actualLine) {
        const side = (p.side || 'over').toLowerCase();
        const buffer = side === 'over' ? projection.projectedValue - projection.actualLine : projection.actualLine - projection.projectedValue;
        if (Math.abs(buffer) < 0.3) {
          console.log(`[Heat BufferGate] Blocked ${p.player_name} ${p.market_type} (buffer: ${buffer.toFixed(2)} < 0.3)`);
          return false;
        }
      }
      return true;
    }) || [];

    console.log(`[Heat Engine] ${bufferedProps.length} props passed buffer gate (from ${eligibleProps?.length || 0})`);

    if (bufferedProps.length < 2) {
      // Clear today's supporting data
      await supabase.from("heat_watchlist").delete().eq("watchlist_date", today);
      await supabase.from("heat_do_not_bet").delete().eq("dnb_date", today);

      return {
        success: false,
        error: "INSUFFICIENT_PROPS",
        message: "NO CORE PLAY TODAY - insufficient eligible props after buffer gate. Need at least 2 eligible props.",
        core_parlay: null,
        upside_parlay: null,
        watchlist: [],
        do_not_bet: [],
      };
    }

    // Build CORE parlay first
    const coreParlay = buildParlays(
      bufferedProps.filter((p: any) => p.is_eligible_core),
      "CORE",
      [], // No exclusions for CORE
    );

    // Extract CORE player names to exclude from UPSIDE
    const corePlayerNames = coreParlay ? [coreParlay.leg_1.player_name, coreParlay.leg_2.player_name] : [];

    console.log(`[Heat Engine] CORE players to exclude from UPSIDE: ${corePlayerNames.join(", ")}`);

    // Build UPSIDE parlay with CORE players excluded for variety
    const upsideParlay = buildParlays(
      bufferedProps.filter((p: any) => p.is_eligible_upside),
      "UPSIDE",
      corePlayerNames, // Exclude CORE players for differentiation
    );

    // Build Watchlist (top 5 approaching entry) - range 70-84 (just below CORE threshold)
    const todayStart = `${today}T00:00:00Z`;
    const { data: allTrackedForWatchlist, error: watchlistError } = await supabase
      .from("heat_prop_tracker")
      .select("*")
      .gte("start_time_utc", todayStart)
      .gte("final_score", 70)
      .lt("final_score", 85)
      .neq("signal_label", "PUBLIC_TRAP")
      .order("final_score", { ascending: false })
      .limit(5);

    console.log(
      `[Heat Engine] Watchlist query result: ${allTrackedForWatchlist?.length || 0} items, error: ${watchlistError?.message || "none"}`,
    );

    const watchlistCandidates = (allTrackedForWatchlist || []).map((p: any) => ({
      watchlist_date: today,
      player_name: p.player_name,
      market_type: p.market_type,
      line: p.latest_line,
      side: p.side,
      sport: p.sport,
      event_id: p.event_id,
      signal_label: p.signal_label,
      approaching_entry: p.final_score >= 78,
      final_score: p.final_score,
      reason: `Score ${p.final_score}/100, needs ${85 - p.final_score} more for CORE entry`,
    }));

    console.log(`[Heat Engine] Watchlist candidates: ${watchlistCandidates.length}`);

    // Build Do-Not-Bet list (PUBLIC_TRAP + PUBLIC_LEAN + failed stat safety)
    const { data: trapProps } = await supabase
      .from("heat_prop_tracker")
      .select("*")
      .gte("start_time_utc", today)
      .in("signal_label", ["PUBLIC_TRAP", "PUBLIC_LEAN"])
      .order("final_score", { ascending: true })
      .limit(3);

    const { data: failedSafetyProps } = await supabase
      .from("heat_prop_tracker")
      .select("*")
      .gte("start_time_utc", today)
      .eq("passes_stat_safety", false)
      .order("final_score", { ascending: true })
      .limit(3);

    // Combine and deduplicate
    const allDnbCandidates = [...(trapProps || []), ...(failedSafetyProps || [])];
    const uniqueDnb = allDnbCandidates
      .reduce((acc: any[], p: any) => {
        if (!acc.find((x) => x.player_name === p.player_name && x.market_type === p.market_type)) {
          acc.push(p);
        }
        return acc;
      }, [])
      .slice(0, 5);

    const dnbList = uniqueDnb.map((p: any) => {
      let trapReason = "";
      if (p.signal_label === "PUBLIC_TRAP") {
        trapReason = `PUBLIC_TRAP - High public exposure, low sharp action`;
      } else if (p.signal_label === "PUBLIC_LEAN") {
        trapReason = `PUBLIC_LEAN - Popular pick, proceed with caution`;
      } else if (!p.passes_stat_safety) {
        trapReason = `HIGH_VARIANCE - ${p.market_type} is a volatile stat type`;
      } else {
        trapReason = `AVOID - Score ${p.final_score}/100, risky profile`;
      }

      return {
        dnb_date: today,
        player_name: p.player_name,
        market_type: p.market_type,
        line: p.latest_line,
        side: p.side,
        sport: p.sport,
        event_id: p.event_id,
        trap_reason: trapReason,
        final_score: p.final_score,
      };
    });

    console.log(`[Heat Engine] Do-Not-Bet candidates: ${dnbList.length}`);

    // Save parlays
    const parlaysToSave: any[] = [];

    if (coreParlay) {
      parlaysToSave.push({
        parlay_date: today,
        parlay_type: "CORE",
        leg_1: coreParlay.leg_1,
        leg_2: coreParlay.leg_2,
        summary: coreParlay.summary,
        risk_level: coreParlay.risk_level,
        no_bet_flags: [],
        team_diversity: coreParlay.team_diversity, // Track team diversity
        engine_version: "v1",
      });
    }

    if (upsideParlay) {
      parlaysToSave.push({
        parlay_date: today,
        parlay_type: "UPSIDE",
        leg_1: upsideParlay.leg_1,
        leg_2: upsideParlay.leg_2,
        summary: upsideParlay.summary,
        risk_level: upsideParlay.risk_level,
        no_bet_flags: [],
        team_diversity: upsideParlay.team_diversity, // Track team diversity
        engine_version: "v1",
      });
    }

    // Clear and insert
    await supabase.from("heat_parlays").delete().eq("parlay_date", today);
    await supabase.from("heat_watchlist").delete().eq("watchlist_date", today);
    await supabase.from("heat_do_not_bet").delete().eq("dnb_date", today);

    if (parlaysToSave.length > 0) {
      await supabase.from("heat_parlays").insert(parlaysToSave);
    }

    if (watchlistCandidates.length > 0) {
      await supabase.from("heat_watchlist").insert(watchlistCandidates);
    }

    if (dnbList.length > 0) {
      await supabase.from("heat_do_not_bet").insert(dnbList);
    }

    return {
      success: true,
      core_parlay: coreParlay,
      upside_parlay: upsideParlay,
      watchlist: watchlistCandidates,
      do_not_bet: dnbList,
    };
  }

  if (action === "fetch") {
    // Fetch today's parlays
    const { data: parlays } = await supabase.from("heat_parlays").select("*").eq("parlay_date", today);

    const { data: watchlist } = await supabase
      .from("heat_watchlist")
      .select("*")
      .eq("watchlist_date", today)
      .order("final_score", { ascending: false });

    const { data: dnb } = await supabase.from("heat_do_not_bet").select("*").eq("dnb_date", today);

    const coreParlay = parlays?.find((p: any) => p.parlay_type === "CORE");
    const upsideParlay = parlays?.find((p: any) => p.parlay_type === "UPSIDE");

    return {
      success: true,
      core_parlay: coreParlay || null,
      upside_parlay: upsideParlay || null,
      watchlist: watchlist || [],
      do_not_bet: dnb || [],
    };
  }

  return { success: false, error: "Invalid action" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { action = "fetch", sport } = body;

    console.log(`[Heat Prop Engine] Request: ${action}, sport: ${sport || "all"}`);

    const result = await runHeatEngine(supabase, action, sport);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[Heat Prop Engine] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
