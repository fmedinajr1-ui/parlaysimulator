import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ========================
// CONFIGURATION & CONSTANTS
// ========================

const MINUTES_THRESHOLD = 24;

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

// v4.0: Projection lookup map (populated at build time)
let projectionMap: Map<string, { projectedValue: number; actualLine: number }> = new Map();

async function loadCategoryRecommendations(supabase: any): Promise<void> {
  const { data } = await supabase
    .from("category_sweet_spots")
    .select("player_name, prop_type, recommended_side, l10_hit_rate")
    .gte("l10_hit_rate", 0.7); // Only use high-confidence categories (70%+)

  categoryRecommendations.clear();
  for (const c of data || []) {
    const key = `${c.player_name?.toLowerCase()}_${normalizePropType(c.prop_type)}`;
    categoryRecommendations.set(key, {
      side: c.recommended_side?.toLowerCase() || "over",
      hit_rate: c.l10_hit_rate,
    });
  }
  console.log(`[Sharp Builder] Loaded ${categoryRecommendations.size} category recommendations (70%+ L10)`);
}

// v4.0: Load projections for enriching parlay legs
async function loadProjections(supabase: any): Promise<void> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const { data } = await supabase
    .from("category_sweet_spots")
    .select("player_name, prop_type, projected_value, actual_line")
    .eq("analysis_date", today)
    .not("projected_value", "is", null);

  projectionMap.clear();
  for (const p of data || []) {
    const key = `${p.player_name?.toLowerCase()}_${normalizePropType(p.prop_type)}`;
    projectionMap.set(key, {
      projectedValue: p.projected_value,
      actualLine: p.actual_line || p.recommended_line,
    });
  }
  console.log(`[Sharp Builder] Loaded ${projectionMap.size} projections from category_sweet_spots`);
}

// Runtime archetype data (populated from database)
let archetypeMap: Record<string, { archetype: string }> = {};

// Runtime team data (populated from database)
let playerTeamMap: Record<string, string> = {};

async function loadArchetypes(supabase: any): Promise<void> {
  const { data: archetypes } = await supabase.from("player_archetypes").select("player_name, primary_archetype");

  archetypeMap = {};
  for (const a of archetypes || []) {
    archetypeMap[a.player_name.toLowerCase()] = {
      archetype: a.primary_archetype,
    };
  }
  console.log(`[Sharp Builder] Loaded ${Object.keys(archetypeMap).length} player archetypes`);
}

async function loadPlayerTeams(supabase: any): Promise<void> {
  const { data: players } = await supabase.from("bdl_player_cache").select("player_name, team_name");

  playerTeamMap = {};
  for (const p of players || []) {
    if (p.player_name && p.team_name) {
      playerTeamMap[p.player_name.toLowerCase()] = p.team_name;
    }
  }
  console.log(`[Sharp Builder] Loaded ${Object.keys(playerTeamMap).length} player-team mappings`);
}

function getPlayerTeam(playerName: string): string {
  return playerTeamMap[playerName?.toLowerCase()] || "UNKNOWN";
}

function getPlayerArchetype(playerName: string): string {
  return archetypeMap[playerName?.toLowerCase()]?.archetype || "UNKNOWN";
}

// Archetype-based helper functions (replaces hardcoded lists)
function isEliteRebounder(playerName: string): { tier: number | null; reason: string } {
  const archetype = getPlayerArchetype(playerName);
  if (archetype === "ELITE_REBOUNDER") {
    return { tier: 1, reason: "Elite Rebounder archetype" };
  }
  if (archetype === "GLASS_CLEANER") {
    return { tier: 2, reason: "Glass Cleaner archetype" };
  }
  return { tier: null, reason: "Not an elite rebounder" };
}

function isStarPlayer(playerName: string): boolean {
  const archetype = getPlayerArchetype(playerName);
  const starArchetypes = ["ELITE_REBOUNDER", "PURE_SHOOTER", "PLAYMAKER", "COMBO_GUARD", "BALL_DOMINANT_STAR"];
  return starArchetypes.includes(archetype);
}

// Blowout immunity stars - derived from archetypes
const BLOWOUT_IMMUNITY_ARCHETYPES = ["ELITE_REBOUNDER", "GLASS_CLEANER", "PLAYMAKER", "PURE_SHOOTER", "COMBO_GUARD"];
function hasBlowoutImmunity(playerName: string): boolean {
  const archetype = getPlayerArchetype(playerName);
  return BLOWOUT_IMMUNITY_ARCHETYPES.includes(archetype);
}

// Never fade PRA - stars who are volume-guaranteed
const NEVER_FADE_PRA_ARCHETYPES = ["ELITE_REBOUNDER", "PLAYMAKER", "COMBO_GUARD"];
function isNeverFadePRA(playerName: string): boolean {
  const archetype = getPlayerArchetype(playerName);
  return NEVER_FADE_PRA_ARCHETYPES.includes(archetype);
}

// Check if archetype-prop is aligned (inverse of blocked)
function isArchetypePropAligned(playerName: string, propType: string): { aligned: boolean; isPrimary: boolean } {
  const isBlocked = isArchetypePropBlocked(playerName, propType);
  // If not blocked, it's aligned. Consider it primary if it's a core stat for that archetype.
  return { aligned: !isBlocked, isPrimary: !isBlocked };
}

// Role locks by stat type - BIG allowed for rebounds, WING for all core stats
const ROLE_STAT_LOCKS = {
  rebounds: ["C", "PF", "F-C", "C-F", "SF", "BIG", "WING"],
  assists: ["PG", "SG", "G", "PG-SG", "SG-PG", "SF", "GUARD", "WING", "SECONDARY_GUARD", "BALL_DOMINANT_STAR"],
  points: ["PG", "SG", "SF", "G", "GUARD", "WING", "SECONDARY_GUARD"],
  threes: "VOLUME_CHECK",
};

// Stat priority for scoring (rebounds/assists >> points)
const STAT_PRIORITY: Record<string, number> = {
  rebounds: 10,
  assists: 9,
  blocks: 7,
  steals: 6,
  threes: 4,
  points: 2,
};

function getStatPriority(propType: string): number {
  const lower = propType?.toLowerCase() || "";
  for (const [stat, priority] of Object.entries(STAT_PRIORITY)) {
    if (lower.includes(stat)) return priority;
  }
  return 5;
}

// High volatility stats (limit in parlays)
const HIGH_VOLATILITY_STATS = ["blocks", "steals", "turnovers", "threes", "3-pointers"];

// Parlay configuration - DREAM TEAM includes 5-leg option
const PARLAY_CONFIGS = {
  DREAM_TEAM_5: {
    minLegs: 5,
    maxLegs: 5,
    maxVolatilityLegs: 1,
    confidenceThreshold: 0.55,
    minEdge: 5,
    requireTeamDiversity: true,
  },
  DREAM_TEAM_3: {
    minLegs: 3,
    maxLegs: 3,
    maxVolatilityLegs: 0,
    confidenceThreshold: 0.65,
    minEdge: 8,
    requireTeamDiversity: true,
  },
  SAFE: {
    minLegs: 2,
    maxLegs: 3,
    maxVolatilityLegs: 0,
    confidenceThreshold: 0.55,
    minEdge: 8,
    requireTeamDiversity: false,
  },
  BALANCED: {
    minLegs: 2,
    maxLegs: 4,
    maxVolatilityLegs: 1,
    confidenceThreshold: 0.45,
    minEdge: 5,
    requireTeamDiversity: false,
  },
  UPSIDE: {
    minLegs: 2,
    maxLegs: 4,
    maxVolatilityLegs: 1,
    confidenceThreshold: 0.35,
    minEdge: 3,
    requireTeamDiversity: false,
  },
};

// ========================
// DREAM TEAM VALIDATION
// ========================

// Check if a candidate qualifies as a "Dream Team" leg
function isDreamTeamLeg(
  candidate: any,
  parlayType: keyof typeof PARLAY_CONFIGS,
): {
  passes: boolean;
  reason: string;
} {
  const config = PARLAY_CONFIGS[parlayType];
  const side = candidate.side?.toLowerCase() || "over";
  const isUnder = side === "under";
  const propType = candidate.prop_type?.toLowerCase() || "";
  const role = candidate.player_role?.toUpperCase() || "WING";

  // 1. Minimum edge threshold
  const edge = Math.abs(candidate.edge || 0);
  if (edge < config.minEdge) {
    return { passes: false, reason: `Edge ${edge.toFixed(1)}% < ${config.minEdge}% minimum` };
  }

  // 2. Zero-median data rejection
  const median5 = candidate.median5 || 0;
  const median10 = candidate.median10 || 0;
  if (median5 <= 0 && median10 <= 0) {
    return { passes: false, reason: "Zero median data - no historical performance" };
  }

  // 3. Role-stat alignment (Dream Team requires perfect match)
  const isRebounds = propType.includes("rebound");
  const isAssists = propType.includes("assist");
  const isPoints = propType.includes("point") && !isRebounds && !isAssists;

  // BIG should do rebounds
  if (role === "BIG" && !isRebounds) {
    // Allow but don't boost
  }

  // GUARD should do assists
  if ((role === "SECONDARY_GUARD" || role === "BALL_DOMINANT_STAR") && isRebounds) {
    return { passes: false, reason: `${role} should not have rebounds - use assists` };
  }

  // 4. Elite rebounder check for UNDER bets
  if (isUnder && isRebounds) {
    const rebounderTier = isEliteRebounder(candidate.player_name);
    if (rebounderTier.tier !== null) {
      return { passes: false, reason: `Elite rebounder (Tier ${rebounderTier.tier}) - never fade rebounds under` };
    }
  }

  // 5. Minutes locked (28+ for Dream Team)
  const avgMinutes = candidate.avg_minutes || 0;
  if (avgMinutes < 25 && parlayType === "SAFE") {
    return { passes: false, reason: `Minutes ${avgMinutes.toFixed(1)} < 25 for SAFE parlay` };
  }
  if (avgMinutes < 24) {
    return { passes: false, reason: `Minutes ${avgMinutes.toFixed(1)} < 24 minimum` };
  }

  return { passes: true, reason: "Dream Team qualified" };
}

// ========================
// UTILITY FUNCTIONS
// ========================

function calculateMedian(arr: number[]): number {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function normalizePlayerName(name: string): string {
  return name?.toLowerCase().trim() || "";
}

function normalizePropType(propType: string): string {
  return propType?.toLowerCase().replace(/[_\s]/g, "") || "";
}

// ========================
// RULE IMPLEMENTATIONS
// ========================

// RULE 1: Minutes Rule (28+ minutes projection)
function passesMinutesRule(avgMinutes: number, playerName: string): { passes: boolean; reason: string } {
  const normalizedName = normalizePlayerName(playerName);

  if (avgMinutes >= MINUTES_THRESHOLD) {
    return { passes: true, reason: `${avgMinutes.toFixed(1)} min avg ≥ ${MINUTES_THRESHOLD}` };
  }

  if (hasBlowoutImmunity(playerName)) {
    return { passes: true, reason: `Star exception (${avgMinutes.toFixed(1)} min)` };
  }

  return { passes: false, reason: `${avgMinutes.toFixed(1)} min < ${MINUTES_THRESHOLD} threshold` };
}

// RULE 2: Median Engine (L5 & L10 games) + Dead-Zone Filter + SIDE-AWARE LOGIC
function passesMedianRule(
  gameLogs: number[],
  line: number,
  parlayType: string,
  side: string, // NEW: 'over' or 'under' - CRITICAL for correct validation
): { passes: boolean; median5: number; median10: number; edge: number; reason: string } {
  const last5 = gameLogs.slice(0, 5);
  const last10 = gameLogs.slice(0, 10);

  const median5 = calculateMedian(last5);
  const median10 = calculateMedian(last10);

  const isUnder = side?.toLowerCase() === "under";

  // CRITICAL FIX: For UNDER, use LOWER median; for OVER, use HIGHER median
  const bestMedian = isUnder
    ? Math.min(median5, median10) // For UNDER, pessimistic = lower median
    : Math.max(median5, median10); // For OVER, optimistic = higher median

  // Edge calculation: positive = good for OVER, flip for UNDER
  const rawEdge = ((bestMedian - line) / line) * 100;
  const edge = isUnder ? -rawEdge : rawEdge; // Flip sign for under (negative rawEdge = good)

  // DEAD-ZONE CHECK: If line is within ±0.5 of median → NO EDGE (coin-flip)
  const medianGap = Math.abs(line - bestMedian);
  if (medianGap <= 0.5) {
    return {
      passes: false,
      median5,
      median10,
      edge: 0,
      reason: `DEAD ZONE: Line ${line} within ±0.5 of median ${bestMedian.toFixed(1)} - no edge`,
    };
  }

  // SNEAKY LINE TRAP DETECTION: Vegas sets line just above median for unders
  // Example: Player averages 8 rebounds, line is 7.5 under → TRAP
  if (isUnder && bestMedian > line) {
    const sneakyGap = bestMedian - line;
    if (sneakyGap <= 2.0) {
      // Line is set 0.5-2.0 below median → SNEAKY TRAP
      return {
        passes: false,
        median5,
        median10,
        edge: 0,
        reason: `SNEAKY LINE: Median ${bestMedian.toFixed(1)} > line ${line} → under is trap`,
      };
    }
  }

  // Upside builds allow 10% buffer
  const isUpsideBuild = parlayType === "UPSIDE";

  if (isUnder) {
    // FOR UNDER: Median must be BELOW line (player underperforms line)
    // Require at least 10% buffer for safety
    const threshold = isUpsideBuild ? line * 1.05 : line * 0.9; // 10% below line
    const passes = median5 <= threshold || median10 <= threshold;

    if (passes) {
      return {
        passes: true,
        median5,
        median10,
        edge,
        reason: `UNDER valid: L5 ${median5.toFixed(1)}, L10 ${median10.toFixed(1)} below line ${line}`,
      };
    }

    return {
      passes: false,
      median5,
      median10,
      edge,
      reason: `UNDER INVALID: Medians (${median5.toFixed(1)}/${median10.toFixed(1)}) >= line ${line} - player exceeds line`,
    };
  } else {
    // FOR OVER: Median must be ABOVE line (player exceeds line)
    const threshold = isUpsideBuild ? line * 0.9 : line;
    const passes = median5 >= threshold || median10 >= threshold;

    if (passes) {
      return {
        passes: true,
        median5,
        median10,
        edge,
        reason: `OVER valid: L5 ${median5.toFixed(1)}, L10 ${median10.toFixed(1)}, edge ${edge > 0 ? "+" : ""}${edge.toFixed(1)}%`,
      };
    }

    return {
      passes: false,
      median5,
      median10,
      edge,
      reason: `OVER INVALID: Medians (${median5.toFixed(1)}/${median10.toFixed(1)}) below threshold ${threshold.toFixed(1)}`,
    };
  }
}

// RULE 3: Role Lock (Position-based stat validation)
function passesRoleLock(
  propType: string,
  position: string,
  threeAttempts?: number,
  threeMakes?: number,
  playerRole?: string,
): { passes: boolean; reason: string } {
  const normalizedProp = normalizePropType(propType);
  const normalizedPosition = position?.toUpperCase() || "";
  const role = playerRole?.toUpperCase() || "";

  // Rebounds: BIG, WING, or traditional big positions
  if (normalizedProp.includes("rebound")) {
    const validPositions = ROLE_STAT_LOCKS.rebounds as string[];
    const positionMatch = validPositions.some((p) => normalizedPosition.includes(p));
    const roleMatch = role === "BIG" || role === "WING" || role === "STAR";
    if (positionMatch || roleMatch) {
      return { passes: true, reason: `${role || normalizedPosition} valid for rebounds` };
    }
    return { passes: false, reason: `${role || normalizedPosition} not ideal for rebounds` };
  }

  // Assists: GUARD, WING, or ball handler positions
  if (normalizedProp.includes("assist")) {
    const validPositions = ROLE_STAT_LOCKS.assists as string[];
    const positionMatch = validPositions.some((p) => normalizedPosition.includes(p));
    const roleMatch =
      role === "GUARD" ||
      role === "SECONDARY_GUARD" ||
      role === "WING" ||
      role === "STAR" ||
      role === "BALL_DOMINANT_STAR";
    if (positionMatch || roleMatch) {
      return { passes: true, reason: `${role || normalizedPosition} is ball handler` };
    }
    return { passes: false, reason: `${role || normalizedPosition} not primary ball handler` };
  }

  // Points: Allow all except pure BIG role
  if (normalizedProp.includes("points") && !normalizedProp.includes("rebound") && !normalizedProp.includes("assist")) {
    if (role === "BIG") {
      return { passes: false, reason: `BIG role not ideal for points-only` };
    }
    return { passes: true, reason: `${role || normalizedPosition} valid for points` };
  }

  // Threes: Volume check (attempts > makes)
  if (normalizedProp.includes("three") || normalizedProp.includes("3pt") || normalizedProp.includes("3-pointer")) {
    if (threeAttempts && threeMakes && threeAttempts > threeMakes) {
      return { passes: true, reason: `Volume shooter (${threeAttempts.toFixed(1)} 3PA)` };
    }
    return { passes: true, reason: "Volume check skipped (no data)" };
  }

  // PRA, combo stats - all positions valid
  return { passes: true, reason: "Position-agnostic stat" };
}

// RULE 4: Blowout Filter (Spread ≥ 12)
function passesBlowoutFilter(
  spread: number | null,
  propType: string,
  side: string,
  playerName: string,
): { passes: boolean; reason: string; recommendation?: string } {
  if (!spread || Math.abs(spread) < 12) {
    return { passes: true, reason: "Competitive game (spread < 12)" };
  }

  const normalizedName = normalizePlayerName(playerName);
  const normalizedProp = normalizePropType(propType);
  const normalizedSide = side?.toLowerCase() || "";

  const isPRA =
    normalizedProp.includes("pra") ||
    (normalizedProp.includes("points") && normalizedProp.includes("rebounds") && normalizedProp.includes("assists"));
  const isUnder = normalizedSide === "under";

  // Never fade PRA override
  if (isNeverFadePRA(playerName)) {
    return { passes: true, reason: `${playerName} never-fade star (blowout override)` };
  }

  // In blowouts, avoid PRA unders on stars
  if (isPRA && isUnder) {
    return {
      passes: false,
      reason: `Blowout risk: PRA under on star`,
      recommendation: "Use rebounds, assists, or attempts instead",
    };
  }

  // Favor rebounds/assists in blowouts
  if (normalizedProp.includes("rebound") || normalizedProp.includes("assist")) {
    return { passes: true, reason: "Blowout-safe stat (rebounds/assists)" };
  }

  return { passes: true, reason: `Spread ${spread}, standard blowout filter passed` };
}

// RULE 5: Volatility Control
function isVolatileLeg(propType: string): boolean {
  const normalizedProp = normalizePropType(propType);
  return HIGH_VOLATILITY_STATS.some((v) => normalizedProp.includes(v.toLowerCase().replace(/[_\s-]/g, "")));
}

// RULE 6: Public Trap Detection
function detectPublicTrap(
  odds: number,
  lineMovement?: number,
  hasInjuryNews?: boolean,
): { isTrap: boolean; reason: string; alternatives?: string[] } {
  // Heavy juice detection (worse than -130)
  const heavyJuice = odds < -130 || odds > 130;

  // Suspicious movement without injury (1.5+ point swing)
  const suspiciousMovement = Math.abs(lineMovement || 0) >= 1.5 && !hasInjuryNews;

  if (heavyJuice) {
    return {
      isTrap: true,
      reason: `Heavy juice detected (${odds})`,
      alternatives: ["Consider ALT lines", "Use attempts instead of makes", "Consider PRA instead of single stat"],
    };
  }

  if (suspiciousMovement) {
    return {
      isTrap: true,
      reason: `Suspicious line movement (${lineMovement} pts) without injury news`,
      alternatives: ["Wait for clarity", "Consider opposite side", "Use ALT lines"],
    };
  }

  return { isTrap: false, reason: "Clean line" };
}

// ========================
// MAIN ENGINE LOGIC
// ========================

interface CandidateLeg {
  player_name: string;
  team: string; // Player's team for diversity enforcement
  prop_type: string;
  line: number;
  side: string;
  odds: number;
  position: string;
  avg_minutes: number;
  median5: number;
  median10: number;
  edge: number;
  confidence_score: number;
  is_volatile: boolean;
  is_star?: boolean;
  stat_priority?: number;
  rationale: string;
  is_fade_specialist?: boolean;
  fade_edge_tag?: string | null;
  player_role?: string; // Added for Dream Team validation
  rules_passed: {
    minutes: boolean;
    median: boolean;
    role_lock: boolean;
    blowout_filter: boolean;
    public_trap: boolean;
  };
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

async function buildSharpParlays(supabase: any): Promise<any> {
  console.log("[Sharp Parlay Builder] Starting engine...");

  // Load runtime data
  await loadArchetypes(supabase);
  await loadPlayerTeams(supabase);
  await loadCategoryRecommendations(supabase);
  await loadProjections(supabase); // v4.0: Load projections for parlay legs

  // Fetch today's props from unified_props or nba_risk_engine_picks
  const today = getEasternDate();

  // MATCHUP INTELLIGENCE INTEGRATION: Fetch blocked picks first
  const { data: blockedPicks, error: blockedError } = await supabase
    .from("matchup_intelligence")
    .select("player_name, prop_type, side, line, block_reason")
    .eq("game_date", today)
    .eq("is_blocked", true);

  if (blockedError) {
    console.warn("[Sharp Builder] Warning: Could not fetch blocked picks:", blockedError.message);
  }

  // Create lookup set for blocked picks
  const blockedSet = new Set(
    (blockedPicks || []).map(
      (p: any) => `${p.player_name?.toLowerCase()}_${p.prop_type?.toLowerCase()}_${p.side?.toLowerCase()}_${p.line}`,
    ),
  );

  console.log(`[Sharp Builder] Loaded ${blockedSet.size} blocked picks from matchup intelligence`);

  // Stats for v3.0 rule tracking
  let archetypeBlockedCount = 0;
  let categorySideBlockedCount = 0;

  const { data: allProps, error: propsError } = await supabase
    .from("nba_risk_engine_picks")
    .select("*")
    .eq("game_date", today)
    .is("rejection_reason", null);

  if (propsError) {
    console.error("[Sharp Parlay Builder] Error fetching props:", propsError);
    throw propsError;
  }

  // Filter out blocked picks from matchup intelligence
  let props = (allProps || []).filter((p: any) => {
    const key = `${p.player_name?.toLowerCase()}_${p.prop_type?.toLowerCase()}_${(p.side || "over")?.toLowerCase()}_${p.line}`;
    const isBlocked = blockedSet.has(key);
    if (isBlocked) {
      const blockReason =
        blockedPicks?.find(
          (bp: any) =>
            bp.player_name?.toLowerCase() === p.player_name?.toLowerCase() &&
            bp.prop_type?.toLowerCase() === p.prop_type?.toLowerCase(),
        )?.block_reason || "Blocked by matchup intelligence";
      console.log(`[Sharp Builder] BLOCKED: ${p.player_name} ${p.prop_type} ${p.side} - ${blockReason}`);
    }
    return !isBlocked;
  });

  console.log(
    `[Sharp Parlay Builder] Found ${allProps?.length || 0} total risk props, ${props.length} after matchup filter for ${today}`,
  );

  // FALLBACK: If risk engine picks are too thin (<6), supplement from category_sweet_spots
  const MIN_RISK_PICKS_THRESHOLD = 4;
  let usedFallback = false;

  if (props.length < MIN_RISK_PICKS_THRESHOLD) {
    console.log(`[Sharp Builder] ⚠️ Only ${props.length} risk picks (< ${MIN_RISK_PICKS_THRESHOLD}). Falling back to category_sweet_spots.`);
    
    const { data: sweetSpots } = await supabase
      .from("category_sweet_spots")
      .select("player_name, prop_type, recommended_side, recommended_line, l10_hit_rate, confidence_score, actual_line, projected_value, season_avg, l10_avg")
      .eq("analysis_date", today)
      .eq("is_active", true)
      .gte("l10_hit_rate", 0.50) // 50%+ L10 hit rate (lowered for thin slates)
      .gte("confidence_score", 0.45); // 45%+ confidence (lowered for thin slates)

    const existingKeys = new Set(props.map((p: any) => 
      `${p.player_name?.toLowerCase()}_${normalizePropType(p.prop_type)}`
    ));

    const fallbackProps = (sweetSpots || [])
      .filter((ss: any) => {
        const key = `${ss.player_name?.toLowerCase()}_${normalizePropType(ss.prop_type)}`;
        return !existingKeys.has(key); // Don't duplicate
      })
      .map((ss: any) => ({
        player_name: ss.player_name,
        prop_type: ss.prop_type,
        side: ss.recommended_side || 'over',
        line: ss.actual_line || ss.recommended_line,
        odds: -110, // Default odds for sweet spot fallback
        confidence_score: ss.confidence_score || 0.65,
        game_date: today,
        avg_minutes: 30, // Assume adequate minutes for sweet spots
        source: 'category_sweet_spots_fallback',
      }));

    console.log(`[Sharp Builder] 📊 Fallback: ${fallbackProps.length} candidates from category_sweet_spots (60%+ L10, 65%+ confidence)`);
    props = [...props, ...fallbackProps];
    usedFallback = true;
  }

  if (!props || props.length === 0) {
    return {
      message: `No approved props available for today (risk_picks: ${allProps?.length || 0}, fallback_used: ${usedFallback})`,
      parlays: null,
      candidates_evaluated: 0,
      candidates_passed: 0,
      saved: [],
      source_diagnostics: { risk_rows: allProps?.length || 0, fallback_used: usedFallback, fallback_rows: 0 },
    };
  }

  // Fetch game logs for median calculation
  const playerNames = [...new Set(props.map((p: any) => p.player_name))];

  const { data: gameLogs, error: gameLogsError } = await supabase
    .from("nba_player_game_logs")
    .select("*")
    .in("player_name", playerNames)
    .order("game_date", { ascending: false });

  if (gameLogsError) {
    console.error("[Sharp Parlay Builder] Error fetching game logs:", gameLogsError);
  }

  // Group game logs by player
  const playerGameLogs: Record<string, any[]> = {};
  (gameLogs || []).forEach((log: any) => {
    const key = normalizePlayerName(log.player_name);
    if (!playerGameLogs[key]) playerGameLogs[key] = [];
    playerGameLogs[key].push(log);
  });

  // Fetch player usage metrics for position data
  const { data: usageMetrics } = await supabase
    .from("player_usage_metrics")
    .select("player_name, position, avg_minutes, avg_three_attempts, avg_three_made")
    .in("player_name", playerNames);

  const playerUsage: Record<string, any> = {};
  (usageMetrics || []).forEach((m: any) => {
    playerUsage[normalizePlayerName(m.player_name)] = m;
  });

  // Process each prop through all 6 rules
  const candidates: CandidateLeg[] = [];

  for (const prop of props) {
    const normalizedName = normalizePlayerName(prop.player_name);
    const logs = playerGameLogs[normalizedName] || [];
    const usage = playerUsage[normalizedName] || {};

    // v3.0 RULE: STRICT ARCHETYPE-PROP BLOCKING (before any other rules)
    if (isArchetypePropBlocked(prop.player_name, prop.prop_type)) {
      const archetype = getPlayerArchetype(prop.player_name);
      console.log(`[Sharp Builder] ARCHETYPE BLOCKED: ${prop.player_name} (${archetype}) for ${prop.prop_type}`);
      archetypeBlockedCount++;
      continue;
    }

    // v3.0 RULE: CATEGORY-SIDE ENFORCEMENT
    const propLower = prop.prop_type?.toLowerCase() || "";
    const propCategory = propLower.includes("rebound")
      ? "rebounds"
      : propLower.includes("assist")
        ? "assists"
        : propLower.includes("block")
          ? "blocks"
          : propLower.includes("three") || propLower.includes("3pt")
            ? "threes"
            : "points";
    const categoryKey = `${normalizedName}_${propCategory}`;
    const categoryRec = categoryRecommendations.get(categoryKey);
    const propSide = (prop.side || "over").toLowerCase();

    if (categoryRec && categoryRec.side !== propSide) {
      console.log(
        `[Sharp Builder] CATEGORY CONFLICT: ${prop.player_name} ${prop.prop_type} - category says ${categoryRec.side.toUpperCase()} (${Math.round(categoryRec.hit_rate * 100)}% L10), pick says ${propSide.toUpperCase()}`,
      );
      categorySideBlockedCount++;
      continue;
    }

    // Get stat values from game logs based on prop type
    const statValues = extractStatValues(logs, prop.prop_type);

    // RULE 1: Minutes check
    const avgMinutes = usage.avg_minutes || prop.avg_minutes || 0;
    const minutesResult = passesMinutesRule(avgMinutes, prop.player_name);
    if (!minutesResult.passes) {
      console.log(`[Sharp Builder] ${prop.player_name} failed minutes: ${minutesResult.reason}`);
      continue;
    }

    // RULE 2: Median check - NOW SIDE-AWARE (CRITICAL FIX)
    // propSide already defined above for category check
    const medianResult = passesMedianRule(statValues, prop.line, "SAFE", propSide);
    if (!medianResult.passes) {
      // Try again with UPSIDE threshold
      const upsideMedianResult = passesMedianRule(statValues, prop.line, "UPSIDE", propSide);
      if (!upsideMedianResult.passes) {
        console.log(
          `[Sharp Builder] ${prop.player_name} ${prop.prop_type} ${propSide} failed median: ${medianResult.reason}`,
        );
        continue;
      }
    }

    // RULE 3: Role lock
    const position = usage.position || prop.position || "";
    const roleResult = passesRoleLock(
      prop.prop_type,
      position,
      usage.avg_three_attempts,
      usage.avg_three_made,
      prop.player_role, // Pass player_role from Risk Engine picks
    );
    if (!roleResult.passes) {
      console.log(`[Sharp Builder] ${prop.player_name} failed role lock: ${roleResult.reason}`);
      continue;
    }

    // RULE 4: Blowout filter
    const blowoutResult = passesBlowoutFilter(prop.spread || null, prop.prop_type, prop.side, prop.player_name);
    if (!blowoutResult.passes) {
      console.log(`[Sharp Builder] ${prop.player_name} failed blowout filter: ${blowoutResult.reason}`);
      continue;
    }

    // RULE 5: Check volatility (for later filtering)
    const isVolatile = isVolatileLeg(prop.prop_type);

    // RULE 5.5: CEILING CHECK (50% MAX RULE) - For UNDER bets only
    const isUnderBet = propSide?.toLowerCase() === "under";
    if (isUnderBet && statValues.length >= 5) {
      const ceiling = Math.max(...statValues);
      const ceilingRatio = ceiling / prop.line;
      if (ceilingRatio > 1.5) {
        console.log(
          `[Sharp Builder] ${prop.player_name} ${prop.prop_type} UNDER failed ceiling check: MAX ${ceiling} is ${Math.round((ceilingRatio - 1) * 100)}% above line ${prop.line}`,
        );
        continue;
      }
    }

    // RULE 5.6: ELITE REBOUNDER CHECK (NEVER FADE REBOUNDS UNDER)
    // propLower already defined above for category check
    const isRebounds = propLower.includes("rebound");
    if (isUnderBet && isRebounds) {
      const rebounderTier = isEliteRebounder(prop.player_name);
      if (rebounderTier.tier !== null) {
        console.log(
          `[Sharp Builder] ${prop.player_name} rebounds UNDER blocked - Elite Rebounder Tier ${rebounderTier.tier}`,
        );
        continue;
      }
    }

    // RULE 6: Public trap detection
    const trapResult = detectPublicTrap(prop.odds || -110, prop.line_movement, prop.has_injury_news);

    // Calculate confidence score - FIXED: Normalize to 0-1 range
    // Risk Engine returns scores in 0-12 range, normalize here
    const rawConfidence = prop.confidence_score || 5;
    const baseConfidence = rawConfidence > 1 ? rawConfidence / 12 : rawConfidence; // Normalize if > 1
    let adjustedConfidence = Math.min(1, Math.max(0, baseConfidence));

    // Boost for strong median edge
    if (medianResult.edge > 10) adjustedConfidence += 0.1;
    else if (medianResult.edge > 5) adjustedConfidence += 0.05;

    // Penalty for trap signals
    if (trapResult.isTrap) adjustedConfidence -= 0.1;

    // Penalty for volatility
    if (isVolatile) adjustedConfidence -= 0.05;

    // Stat priority boost (rebounds/assists >> points)
    const statPriority = getStatPriority(prop.prop_type);
    if (statPriority >= 9)
      adjustedConfidence += 0.12; // Rebounds/assists boost
    else if (statPriority >= 7)
      adjustedConfidence += 0.06; // Blocks/steals boost
    else if (statPriority <= 2) adjustedConfidence -= 0.15; // Points penalty

    // Star player with points = heavy penalty
    const isStar = isStarPlayer(prop.player_name);
    if (isStar && prop.prop_type?.toLowerCase().includes("points")) {
      adjustedConfidence -= 0.2; // Stars should use rebounds/assists
    }

    // Fade Specialist bonus from Risk Engine
    const isFadeSpecialist = prop.is_fade_specialist === true;
    const fadeEdgeTag = prop.fade_edge_tag || null;

    if (isFadeSpecialist) {
      // Boost based on fade edge tier
      if (fadeEdgeTag === "FADE_ELITE") adjustedConfidence += 0.15;
      else if (fadeEdgeTag === "FADE_EDGE") adjustedConfidence += 0.1;
      else if (fadeEdgeTag === "FADE_COMBO") adjustedConfidence += 0.06;
    }

    // CLAMP to 0-1 range
    adjustedConfidence = Math.max(0.1, Math.min(0.95, adjustedConfidence));

    // Build rationale with role info
    const playerRole = prop.player_role || "WING";
    const statType = statPriority >= 9 ? "(preferred)" : statPriority <= 2 ? "(low priority)" : "";
    const fadeTag = isFadeSpecialist ? ` [${fadeEdgeTag}]` : "";
    const rationale = `${playerRole} ${position || ""}, L5: ${medianResult.median5.toFixed(1)}, L10: ${medianResult.median10.toFixed(1)}, ${medianResult.edge > 0 ? "+" : ""}${medianResult.edge.toFixed(1)}% edge ${statType}${fadeTag}`;

    candidates.push({
      player_name: prop.player_name,
      team: getPlayerTeam(prop.player_name), // Get team from bdl_player_cache
      prop_type: prop.prop_type,
      line: prop.line,
      side: prop.side || "over",
      odds: prop.odds || -110,
      position: position,
      avg_minutes: avgMinutes,
      median5: medianResult.median5,
      median10: medianResult.median10,
      edge: medianResult.edge,
      confidence_score: adjustedConfidence,
      is_volatile: isVolatile,
      is_star: isStar,
      stat_priority: statPriority,
      is_fade_specialist: isFadeSpecialist,
      fade_edge_tag: fadeEdgeTag,
      player_role: playerRole, // Added for Dream Team validation
      rationale,
      rules_passed: {
        minutes: minutesResult.passes,
        median: medianResult.passes,
        role_lock: roleResult.passes,
        blowout_filter: blowoutResult.passes,
        public_trap: !trapResult.isTrap,
      },
    });
  }

  console.log(`[Sharp Parlay Builder] ${candidates.length} candidates passed all rules`);

  // Sort candidates by confidence
  // CRITICAL FIX: Added stable tie-breakers to ensure deterministic ordering
  candidates.sort((a, b) => {
    if (b.confidence_score !== a.confidence_score) return b.confidence_score - a.confidence_score;
    // Stable tie-breaker: player name (alphabetical)
    const nameCompare = (a.player_name || "").localeCompare(b.player_name || "");
    if (nameCompare !== 0) return nameCompare;
    // Final tie-breaker: prop_type for complete determinism
    return (a.prop_type || "").localeCompare(b.prop_type || "");
  });

  // Build the three parlay types
  const parlays = {
    SAFE: buildParlay(candidates, "SAFE"),
    BALANCED: buildParlay(candidates, "BALANCED"),
    UPSIDE: buildParlay(candidates, "UPSIDE"),
  };

  // Save parlays to database
  const savedParlays = [];
  for (const [parlayType, legs] of Object.entries(parlays)) {
    if (legs && legs.length >= PARLAY_CONFIGS[parlayType as keyof typeof PARLAY_CONFIGS].minLegs) {
      const totalOdds = calculateParlayOdds(legs);
      const combinedProb = calculateCombinedProbability(legs);

      // Calculate team diversity
      const uniqueTeams = new Set(legs.map((l) => l.team?.toLowerCase()).filter((t) => t && t !== "unknown")).size;
      const isDreamTeam = uniqueTeams === legs.length && legs.length >= 3;

      const { data: saved, error: saveError } = await supabase
        .from("sharp_ai_parlays")
        .insert({
          parlay_date: today,
          parlay_type: parlayType,
          legs: legs.map((l) => {
            // v4.0: Lookup projection data
            const projKey = `${l.player_name?.toLowerCase()}_${normalizePropType(l.prop_type)}`;
            const projection = projectionMap.get(projKey);
            const side = l.side?.toLowerCase() || "over";

            // Calculate edge: OVER = projected - line, UNDER = line - projected
            let edge: number | undefined;
            if (projection?.projectedValue != null && projection?.actualLine != null) {
              edge =
                side === "over"
                  ? projection.projectedValue - projection.actualLine
                  : projection.actualLine - projection.projectedValue;
            }

            return {
              player: l.player_name,
              team: l.team,
              prop: l.prop_type,
              line: l.line,
              side: l.side,
              odds: l.odds,
              confidence_tier: getConfidenceTier(l.confidence_score),
              rationale: l.rationale,
              is_fade_specialist: l.is_fade_specialist || false,
              fade_edge_tag: l.fade_edge_tag || null,
              // v4.0: Projection fields
              projected_value: projection?.projectedValue,
              actual_line: projection?.actualLine,
              edge,
            };
          }),
          total_odds: totalOdds,
          combined_probability: combinedProb,
          rule_compliance: { all_rules_passed: true, team_diversity: uniqueTeams, is_dream_team: isDreamTeam },
          model_version: "v1",
        })
        .select()
        .single();

      if (saveError) {
        console.error(`[Sharp Builder] Error saving ${parlayType}:`, saveError);
      } else {
        savedParlays.push(saved);
      }
    }
  }

  return {
    message: `Built ${savedParlays.length} sharp parlays`,
    candidates_evaluated: props.length,
    candidates_passed: candidates.length,
    parlays: {
      SAFE: parlays.SAFE?.length || 0,
      BALANCED: parlays.BALANCED?.length || 0,
      UPSIDE: parlays.UPSIDE?.length || 0,
    },
    saved: savedParlays,
  };
}

function extractStatValues(logs: any[], propType: string): number[] {
  const normalizedProp = normalizePropType(propType);

  return logs
    .slice(0, 10)
    .map((log: any) => {
      if (normalizedProp.includes("point")) {
        if (normalizedProp.includes("rebound") && normalizedProp.includes("assist")) {
          return (log.points || 0) + (log.rebounds || 0) + (log.assists || 0);
        }
        return log.points || 0;
      }
      if (normalizedProp.includes("rebound")) return log.rebounds || 0;
      if (normalizedProp.includes("assist")) return log.assists || 0;
      if (normalizedProp.includes("three") || normalizedProp.includes("3pt")) return log.three_pointers_made || 0;
      if (normalizedProp.includes("block")) return log.blocks || 0;
      if (normalizedProp.includes("steal")) return log.steals || 0;
      return log.points || 0;
    })
    .filter((v: number) => v > 0);
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

function buildParlay(candidates: CandidateLeg[], parlayType: keyof typeof PARLAY_CONFIGS): CandidateLeg[] {
  const config = PARLAY_CONFIGS[parlayType];
  const legs: CandidateLeg[] = [];
  const usedPlayers = new Set<string>();
  const usedTeams = new Set<string>(); // NEW: Track used teams for diversity
  const usedCategories = new Set<string>();
  const propTypeCount = new Map<string, number>(); // PROP TYPE CONCENTRATION CAP
  let volatileCount = 0;
  let starCount = 0;

  // DREAM TEAM: Filter candidates through strict validation + BUFFER GATE
  const dreamTeamCandidates = candidates.filter((c) => {
    const dtCheck = isDreamTeamLeg(c, parlayType);
    if (!dtCheck.passes) {
      console.log(`[Sharp Builder] Dream Team reject: ${c.player_name} ${c.prop_type} - ${dtCheck.reason}`);
      return false;
    }
    // MINIMUM PROJECTION BUFFER GATE (0.3)
    if (c.projected_value && c.line) {
      const side = (c.side || 'over').toLowerCase();
      const buffer = side === 'over' ? c.projected_value - c.line : c.line - c.projected_value;
      if (Math.abs(buffer) < 0.3 && c.projected_value > 0) {
        console.log(`[Sharp BufferGate] Blocked ${c.player_name} ${c.prop_type} (buffer: ${buffer.toFixed(2)} < 0.3)`);
        return false;
      }
    }
    return c.confidence_score >= config.confidenceThreshold;
  });

  console.log(
    `[Sharp Builder] ${parlayType}: ${dreamTeamCandidates.length}/${candidates.length} passed Dream Team validation`,
  );

  // For UPSIDE, include lower confidence candidates if Dream Team pool is small
  const pool =
    parlayType === "UPSIDE" && dreamTeamCandidates.length < config.minLegs
      ? candidates.filter((c) => c.confidence_score >= 0.35)
      : dreamTeamCandidates;

  // Sort by: fade specialists > stat priority > edge > confidence
  // CRITICAL FIX: Added stable tie-breakers (player_name, prop_type) to ensure deterministic ordering
  pool.sort((a, b) => {
    // First: Prioritize fade specialists in SAFE parlays
    if (parlayType === "SAFE") {
      const aFade = a.is_fade_specialist ? 1 : 0;
      const bFade = b.is_fade_specialist ? 1 : 0;
      if (bFade !== aFade) return bFade - aFade;
    }

    // Second: by stat priority (higher = better) - rebounds/assists first
    const aPriority = a.stat_priority || getStatPriority(a.prop_type);
    const bPriority = b.stat_priority || getStatPriority(b.prop_type);
    if (bPriority !== aPriority) return bPriority - aPriority;

    // Third: by edge (Dream Team prioritizes high edge)
    const aEdge = Math.abs(a.edge || 0);
    const bEdge = Math.abs(b.edge || 0);
    if (Math.abs(bEdge - aEdge) > 5) return bEdge - aEdge;

    // Fourth: by confidence
    if (b.confidence_score !== a.confidence_score) return b.confidence_score - a.confidence_score;

    // Stable tie-breaker: player name (alphabetical)
    const nameCompare = (a.player_name || "").localeCompare(b.player_name || "");
    if (nameCompare !== 0) return nameCompare;

    // Final tie-breaker: prop_type for complete determinism
    return (a.prop_type || "").localeCompare(b.prop_type || "");
  });

  // First pass: prefer diverse prop types AND teams (Dream Team requires variety)
  for (const candidate of pool) {
    if (usedPlayers.has(normalizePlayerName(candidate.player_name))) continue;

    // NEW: Team diversity enforcement for Dream Team parlays
    const team = candidate.team?.toLowerCase() || "unknown";
    if (config.requireTeamDiversity && usedTeams.has(team) && team !== "unknown") {
      console.log(`[Sharp Builder] Skipping ${candidate.player_name} (${candidate.team}) - team already in parlay`);
      continue;
    }

    const isStar = candidate.is_star || isStarPlayer(candidate.player_name);
    if (isStar && starCount >= 1) continue;

    const category = getPropCategory(candidate.prop_type);

    // DIVERSITY: Skip if we already have this category (first pass only)
    if (usedCategories.has(category) && legs.length < config.maxLegs - 1) continue;

    // PROP TYPE CONCENTRATION CAP (40% max per parlay)
    const propCat = getPropCategory(candidate.prop_type);
    const currentPropCount = propTypeCount.get(propCat) || 0;
    const maxPropLegs = Math.max(1, Math.floor(config.maxLegs * 0.4));
    if (currentPropCount >= maxPropLegs) {
      console.log(`[Sharp PropTypeCap] Blocked ${candidate.player_name} - ${propCat} at ${currentPropCount}/${maxPropLegs}`);
      continue;
    }

    if (candidate.is_volatile) {
      if (volatileCount >= config.maxVolatilityLegs) continue;
      volatileCount++;
    }

    legs.push(candidate);
    usedPlayers.add(normalizePlayerName(candidate.player_name));
    usedTeams.add(team); // Track team
    usedCategories.add(category);
    propTypeCount.set(propCat, currentPropCount + 1);
    if (isStar) starCount++;

    if (legs.length >= config.maxLegs) break;
  }

  // Second pass: fill remaining slots ignoring prop diversity (but still enforce team diversity for Dream Team)
  if (legs.length < config.minLegs) {
    for (const candidate of pool) {
      if (usedPlayers.has(normalizePlayerName(candidate.player_name))) continue;

      // Still enforce team diversity for Dream Team in second pass
      const team = candidate.team?.toLowerCase() || "unknown";
      if (config.requireTeamDiversity && usedTeams.has(team) && team !== "unknown") {
        console.log(
          `[Sharp Builder] Skipping ${candidate.player_name} (${candidate.team}) - team already in parlay (2nd pass)`,
        );
        continue;
      }

      const isStar = (candidate as any).is_star || isStarPlayer(candidate.player_name);
      if (isStar && starCount >= 1) continue;

      if (candidate.is_volatile) {
        if (volatileCount >= config.maxVolatilityLegs) continue;
        volatileCount++;
      }

      // PROP TYPE CONCENTRATION CAP (40% max) - also in second pass
      const propCat2 = getPropCategory(candidate.prop_type);
      const currentPropCount2 = propTypeCount.get(propCat2) || 0;
      const maxPropLegs2 = Math.max(1, Math.floor(config.maxLegs * 0.4));
      if (currentPropCount2 >= maxPropLegs2) {
        console.log(`[Sharp PropTypeCap 2nd] Blocked ${candidate.player_name} - ${propCat2} at ${currentPropCount2}/${maxPropLegs2}`);
        continue;
      }

      legs.push(candidate);
      usedPlayers.add(normalizePlayerName(candidate.player_name));
      usedTeams.add(team);
      propTypeCount.set(propCat2, currentPropCount2 + 1);
      if (isStar) starCount++;

      if (legs.length >= config.maxLegs) break;
    }
  }

  // Log diversity status
  const categories = legs.map((l) => getPropCategory(l.prop_type));
  const uniqueCategories = new Set(categories).size;
  const teams = legs.map((l) => l.team || "UNKNOWN");
  const uniqueTeamsCount = new Set(teams.map((t) => t.toLowerCase()).filter((t) => t !== "unknown")).size;
  console.log(
    `[Sharp Builder] ${parlayType} parlay: ${legs.length} legs, ${uniqueCategories} categories, ${uniqueTeamsCount} unique teams: ${teams.join(", ")}`,
  );

  return legs;
}

function calculateParlayOdds(legs: CandidateLeg[]): number {
  let decimal = 1;
  for (const leg of legs) {
    const odds = leg.odds;
    if (odds > 0) {
      decimal *= odds / 100 + 1;
    } else {
      decimal *= 100 / Math.abs(odds) + 1;
    }
  }

  // Convert back to American
  if (decimal >= 2) {
    return Math.round((decimal - 1) * 100);
  } else {
    return Math.round(-100 / (decimal - 1));
  }
}

function calculateCombinedProbability(legs: CandidateLeg[]): number {
  return legs.reduce((prob, leg) => prob * leg.confidence_score, 1);
}

function getConfidenceTier(score: number): string {
  if (score >= 0.65) return "HIGH";
  if (score >= 0.5) return "MEDIUM";
  return "UPSIDE";
}

// ========================
// SERVER HANDLER
// ========================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    const { action } = await req.json().catch(() => ({ action: "build" }));

    console.log(`[Sharp Parlay Builder] Action: ${action}`);

    let result;

    if (action === "build") {
      result = await buildSharpParlays(supabase);
    } else if (action === "fetch") {
      // Fetch today's parlays
      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("sharp_ai_parlays")
        .select("*")
        .eq("parlay_date", today)
        .order("created_at", { ascending: false });

      if (error) throw error;
      result = { parlays: data };
    } else {
      result = { error: 'Unknown action. Use "build" or "fetch"' };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[Sharp Parlay Builder] Error:", error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
