import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// 🏀 NBA RISK ENGINE v3.1 - SWEET SPOT OPTIMIZATION SYSTEM
// ============================================================================
// 6-LAYER SHARP FUNNEL:
// Layer 1: Elite Player Archetype Classification
// Layer 2: Role-Prop Alignment Enforcement
// Layer 3: Head-to-Head Matchup Analysis
// Layer 4: Stricter Statistical Contingencies
// Layer 5: Balanced Over/Under Distribution
// Layer 6: Sweet Spot Confidence Calibration (NEW)
// ============================================================================
// SWEET SPOT RANGES (based on historical analysis):
// - Points: 8.5-9.5 confidence = 80% hit rate (optimal)
// - Rebounds: 9.0-9.8 confidence = 71%+ hit rate (optimal)
// - Points MID tier (15-21.5 lines) = 42.9% hit rate (AVOID unless edge ≥2.0)
// - Points confidence 8.2 = 0% hit rate (BLOCK)
// ============================================================================

// ============ SWEET SPOT CONFIGURATION ============
const SWEET_SPOT_CONFIG = {
  points: { min: 8.5, max: 9.5, scaleHigh: true },
  rebounds: { min: 9.0, max: 9.8, scaleHigh: false },
  assists: { min: 7.5, max: 9.0, scaleHigh: false }
};

// Prop-type specific minimum confidence thresholds
const MIN_CONFIDENCE_BY_TYPE: Record<string, number> = {
  'points': 5.5,      // Lower min for points (best performer historically)
  'rebounds': 7.0,    // Higher min for rebounds (needs more filtering)
  'assists': 6.5,     // Standard for assists
  'default': 6.5
};

// Points line tiers based on historical performance
const POINTS_LINE_TIERS = {
  LOW: { min: 0, max: 14.5, hitRate: 57.9, edgeRequired: 1.0 },
  MID: { min: 15, max: 21.5, hitRate: 42.9, edgeRequired: 2.0 },  // TRAP ZONE
  HIGH: { min: 22, max: 50, hitRate: 66.7, edgeRequired: 1.0 }
};

// Confidence values to block (0% hit rate historically)
const BLOCKED_CONFIDENCE_VALUES = [8.2];  // Points at 8.2 = 0% hit rate

// ============ PROP TYPE PERFORMANCE TIERS (BASED ON HISTORICAL HIT RATES) ============
// Points: 55.2% hit rate → ELITE
// Assists: 50.0% hit rate → SOLID
// Rebounds: 45.9% hit rate → RISKY (55% of volume but underperforming)
const PROP_TYPE_PERFORMANCE_TIERS: Record<string, { 
  tier: 'ELITE' | 'SOLID' | 'RISKY', 
  confidenceBonus: number,
  minEdgeRequired: number,
  maxEdgeAllowed?: number  // Optional cap on edge (high edge can be a trap)
}> = {
  'points': { tier: 'ELITE', confidenceBonus: 0.5, minEdgeRequired: 1.0 },
  'assists': { tier: 'SOLID', confidenceBonus: 0, minEdgeRequired: 1.5 },
  'rebounds': { tier: 'RISKY', confidenceBonus: -1.0, minEdgeRequired: 1.5, maxEdgeAllowed: 2.5 },  // Updated: lower min, cap max
  'threes': { tier: 'SOLID', confidenceBonus: 0, minEdgeRequired: 1.5 },
  'threes_made': { tier: 'SOLID', confidenceBonus: 0, minEdgeRequired: 1.5 },
  'blocks': { tier: 'RISKY', confidenceBonus: -0.5, minEdgeRequired: 2.0 },
  'steals': { tier: 'RISKY', confidenceBonus: -0.5, minEdgeRequired: 2.0 },
  'pts_rebs_asts': { tier: 'RISKY', confidenceBonus: -1.0, minEdgeRequired: 3.0 },
  'pts_reb_ast': { tier: 'RISKY', confidenceBonus: -1.0, minEdgeRequired: 3.0 },
  'pts_rebs': { tier: 'SOLID', confidenceBonus: 0, minEdgeRequired: 1.5 },
  'pts_reb': { tier: 'SOLID', confidenceBonus: 0, minEdgeRequired: 1.5 },
  'rebs_asts': { tier: 'RISKY', confidenceBonus: -0.5, minEdgeRequired: 2.0 },
  'reb_ast': { tier: 'RISKY', confidenceBonus: -0.5, minEdgeRequired: 2.0 }
};

// ============ REBOUNDS-SPECIFIC VALIDATION ============
// Based on historical analysis:
// - High edge (3+) = 37.7% hit rate (TRAP)
// - Zero median = 41.7% hit rate (BAD DATA)
// - Lines 7-9.5 = 30.8% hit rate (DEAD ZONE)
// - Lines 10+ with ELITE_REBOUNDER = 71.4% hit rate (BEST)
interface ReboundsValidation {
  approved: boolean;
  reason: string;
  confidenceAdjust: number;
}

function validateReboundsProp(
  line: number,
  edge: number,
  trueMedian: number,
  archetype: string,
  side: string
): ReboundsValidation {
  
  // RULE 1: Block Zero Median Props (hit 8% lower than normal)
  if (trueMedian <= 0) {
    return { 
      approved: false, 
      reason: 'REB_ZERO_MEDIAN: No valid median data - blocks pick', 
      confidenceAdjust: 0 
    };
  }
  
  // RULE 2: Block "Dead Zone" Lines (7-9.5) - Only 30.8% hit rate historically
  if (line >= 7 && line <= 9.5) {
    return { 
      approved: false, 
      reason: `REB_DEAD_ZONE: Line ${line} in volatile 7-9.5 range (30.8% hit rate)`, 
      confidenceAdjust: 0 
    };
  }
  
  // RULE 3: Cap Edge at 2.5 (Edge >= 3 only hits 37.7% - TRAP signal)
  if (Math.abs(edge) > 2.5) {
    return { 
      approved: false, 
      reason: `REB_EDGE_TRAP: Edge ${Math.abs(edge).toFixed(1)} > 2.5 cap (high edge = trap)`, 
      confidenceAdjust: 0 
    };
  }
  
  // RULE 4: Boost Elite Rebounders (Lines 10+) - 71.4% hit rate
  if (line >= 10 && archetype === 'ELITE_REBOUNDER') {
    return { 
      approved: true, 
      reason: 'REB_ELITE_BOOST: Elite rebounder with high line (71.4% hit rate)', 
      confidenceAdjust: +1.0 
    };
  }
  
  // RULE 5: Require Tighter Edge for Mid-Volume Lines (4-6.5)
  if (line >= 4 && line <= 6.5) {
    if (Math.abs(edge) < 1.5) {
      return { 
        approved: false, 
        reason: `REB_MID_THIN: Mid-volume line ${line} needs edge ≥1.5, got ${Math.abs(edge).toFixed(1)}`, 
        confidenceAdjust: 0 
      };
    }
  }
  
  // RULE 6: Glass Cleaners get slight boost for lines 6+
  if (line >= 6 && archetype === 'GLASS_CLEANER') {
    return { 
      approved: true, 
      reason: 'REB_GLASS_CLEANER: Glass cleaner approved for rebounds', 
      confidenceAdjust: +0.5 
    };
  }
  
  return { 
    approved: true, 
    reason: 'REB_STANDARD_PASS: Rebounds passed specialized validation', 
    confidenceAdjust: 0 
  };
}

// ============ BIG POINTS PROP VALIDATION ============
// Based on historical analysis: bigs have volatile scoring
interface BigPointsValidation {
  approved: boolean;
  reason: string;
  confidenceAdjust: number;
  altLineRecommendation: number | null;
}

function validateBigPointsProp(
  line: number,
  edge: number,
  trueMedian: number,
  archetype: PlayerArchetype,
  side: string,
  statValues: number[],
  overPrice: number | null,
  underPrice: number | null
): BigPointsValidation {
  const BIG_ARCHETYPES: PlayerArchetype[] = ['ELITE_REBOUNDER', 'GLASS_CLEANER', 'RIM_PROTECTOR'];
  const isBig = BIG_ARCHETYPES.includes(archetype);
  
  if (!isBig) {
    return { approved: true, reason: 'Not a big - standard points validation', confidenceAdjust: 0, altLineRecommendation: null };
  }
  
  const isOver = side.toLowerCase() === 'over';
  
  // RULE 1: Block high-line OVERS for non-stretch bigs (18+ points = volatile)
  if (isOver && line >= 18 && archetype !== 'STRETCH_BIG') {
    return {
      approved: false,
      reason: `BIG_POINTS_HIGH_LINE: ${archetype} OVER ${line} pts blocked (high variance)`,
      confidenceAdjust: 0,
      altLineRecommendation: Math.floor(line - 3) + 0.5
    };
  }
  
  // RULE 2: Block mid-tier OVERS for GLASS_CLEANER (10-17.5 range volatile)
  if (isOver && archetype === 'GLASS_CLEANER' && line >= 10 && line <= 17.5) {
    return {
      approved: false,
      reason: `BIG_POINTS_MID_TRAP: GLASS_CLEANER mid-tier OVER ${line} blocked (volatile scoring)`,
      confidenceAdjust: 0,
      altLineRecommendation: Math.floor(line - 2) + 0.5
    };
  }
  
  // RULE 3: Block UNDERS when ceiling is too high (>180% of line)
  if (!isOver && statValues.length > 0) {
    const ceiling = Math.max(...statValues);
    if (ceiling >= line * 1.8) {
      return {
        approved: false,
        reason: `BIG_POINTS_CEILING_TRAP: Ceiling ${ceiling} is ${Math.round((ceiling/line - 1) * 100)}% above line`,
        confidenceAdjust: 0,
        altLineRecommendation: Math.ceil(ceiling * 0.85) + 0.5
      };
    }
  }
  
  // RULE 4: Apply confidence penalty for all big Points props
  // STRETCH_BIG gets lighter penalty (they're floor spacers)
  const confidenceAdjust = archetype === 'STRETCH_BIG' ? -0.5 : -1.0;
  
  return {
    approved: true,
    reason: `BIG_POINTS_PASS: ${archetype} points allowed with ${confidenceAdjust} confidence penalty`,
    confidenceAdjust,
    altLineRecommendation: null
  };
}

// ============ JUICED LINE DETECTION ============
// Detect heavily juiced lines and recommend alternatives
interface JuicedLineCheck {
  isJuiced: boolean;
  juiceDirection: 'over' | 'under' | null;
  juiceMagnitude: number;
  recommendedAltLine: number | null;
  reason: string;
}

function detectJuicedLine(
  line: number,
  overPrice: number | null,
  underPrice: number | null,
  side: string
): JuicedLineCheck {
  const HEAVY_JUICE_THRESHOLD = -150;  // Odds worse than -150 = heavily juiced
  
  if (!overPrice || !underPrice) {
    return { isJuiced: false, juiceDirection: null, juiceMagnitude: 0, recommendedAltLine: null, reason: 'No odds data' };
  }
  
  const isOver = side.toLowerCase() === 'over';
  const ourPrice = isOver ? overPrice : underPrice;
  const oppositePrice = isOver ? underPrice : overPrice;
  
  // Check if our side is heavily juiced against us
  if (ourPrice < HEAVY_JUICE_THRESHOLD) {
    const juiceMagnitude = Math.abs(ourPrice);
    
    // Alt line: go 2.5 points in safer direction
    const altLineAdjust = isOver ? -2.5 : 2.5;
    const recommendedAltLine = line + altLineAdjust;
    
    return {
      isJuiced: true,
      juiceDirection: isOver ? 'over' : 'under',
      juiceMagnitude,
      recommendedAltLine,
      reason: `Line juiced at ${ourPrice}. Consider ALT ${side.toUpperCase()} ${recommendedAltLine} for better value.`
    };
  }
  
  // Check for trap juice (opposite side is way too good - +150 or better)
  if (oppositePrice >= 150) {
    const altLineAdjust = isOver ? -2 : 2;
    return {
      isJuiced: true,
      juiceDirection: isOver ? 'under' : 'over',
      juiceMagnitude: oppositePrice,
      recommendedAltLine: line + altLineAdjust,
      reason: `Opposite side at +${oppositePrice} suggests books expect ${isOver ? 'under' : 'over'}. Consider ALT line.`
    };
  }
  
  return { isJuiced: false, juiceDirection: null, juiceMagnitude: 0, recommendedAltLine: null, reason: 'Line not juiced' };
}

// ============ LINE SANITY CHECK (PREVENTS BAD BOOKMAKER DATA) ============
// Rejects lines that are wildly off from the true median (bad data)
function isLineSane(
  playerName: string,
  propType: string,
  line: number,
  trueMedian: number
): { sane: boolean; reason: string } {
  // Skip check if we don't have median data
  if (!trueMedian || trueMedian <= 0) {
    return { sane: true, reason: 'No median for comparison' };
  }
  
  // Calculate deviation percentage
  const deviation = Math.abs(line - trueMedian) / trueMedian;
  
  // Reject lines more than 60% off from true median (obvious bad data)
  if (deviation > 0.6) {
    return { 
      sane: false, 
      reason: `LINE_INSANE: ${playerName} ${propType} line=${line} is ${(deviation * 100).toFixed(0)}% off from median=${trueMedian.toFixed(1)} (max 60%)` 
    };
  }
  
  // Extra check for points: star players shouldn't have lines below 15
  const normalizedProp = propType.toLowerCase().replace('player_', '');
  if (normalizedProp === 'points' && trueMedian > 20 && line < 15) {
    return { 
      sane: false, 
      reason: `POINTS_LINE_TOO_LOW: ${playerName} median=${trueMedian.toFixed(1)} but line=${line} (suspect bad data)` 
    };
  }
  
  return { sane: true, reason: 'Line within acceptable range' };
}

// Max percentage for any single prop type to prevent volume imbalance
const MAX_PROP_TYPE_PCT = 0.35; // Max 35% can be any one prop type

// Helper to normalize prop type for lookup
function normalizePropTypeForTier(propType: string): string {
  const normalized = propType.toLowerCase()
    .replace(/\s+/g, '_')
    .replace('player_', '')
    .replace('_over', '')
    .replace('_under', '');
  
  if (normalized.includes('point') && normalized.includes('rebound') && normalized.includes('assist')) {
    return 'pts_reb_ast';
  }
  if (normalized.includes('point') && normalized.includes('rebound')) return 'pts_reb';
  if (normalized.includes('point') && normalized.includes('assist')) return 'pts_ast';
  if (normalized.includes('rebound') && normalized.includes('assist')) return 'reb_ast';
  if (normalized.includes('point')) return 'points';
  if (normalized.includes('rebound')) return 'rebounds';
  if (normalized.includes('assist')) return 'assists';
  if (normalized.includes('three') || normalized.includes('3pt')) return 'threes';
  if (normalized.includes('block')) return 'blocks';
  if (normalized.includes('steal')) return 'steals';
  
  return normalized;
}

// ============ LAYER 1: ELITE PLAYER ARCHETYPE SYSTEM ============
type PlayerArchetype = 
  | 'ELITE_REBOUNDER'      // avg >= 9 reb (Drummond, Gobert, Jokic)
  | 'GLASS_CLEANER'        // avg 6-9 reb (High-ceiling rebounders)
  | 'PURE_SHOOTER'         // Points specialists (Curry, Booker, Lillard)
  | 'PLAYMAKER'            // Primary playmakers (Haliburton, Trae, CP3)
  | 'SCORING_GUARD'        // Scoring guards (Mitchell, Maxey, Edwards)
  | 'COMBO_GUARD'          // Balanced scoring + playmaking
  | 'TWO_WAY_WING'         // Versatile wings (Butler, Tatum)
  | 'STRETCH_BIG'          // Floor-spacing bigs (3PT attempts >= 4)
  | 'RIM_PROTECTOR'        // Shot blockers (blocks >= 1.5)
  | 'ROLE_PLAYER';         // Bench/rotation players

// Archetype-to-Prop alignment matrix - FULLY EXPANDED for maximum coverage
// Key principle: Allow most props through, let statistical checks filter
const ARCHETYPE_PROP_ALLOWED: Record<PlayerArchetype, { over: string[], under: string[] }> = {
  'ELITE_REBOUNDER': {
    over: ['rebounds', 'points', 'blocks', 'pts_rebs_asts', 'pts_rebs', 'rebs_asts', 'steals', 'assists', 'threes'],
    under: ['assists', 'threes', 'points', 'steals', 'blocks', 'rebounds']
  },
  'GLASS_CLEANER': {
    over: ['rebounds', 'blocks', 'pts_rebs', 'rebs_asts', 'points', 'steals', 'assists', 'threes'],
    under: ['points', 'assists', 'threes', 'steals', 'blocks', 'rebounds']
  },
  'PURE_SHOOTER': {
    over: ['points', 'threes', 'pts_rebs_asts', 'assists', 'steals', 'rebounds', 'blocks'],
    under: ['rebounds', 'assists', 'blocks', 'steals', 'threes', 'points']
  },
  'PLAYMAKER': {
    over: ['assists', 'points', 'pts_rebs_asts', 'threes', 'steals', 'rebounds', 'blocks'],
    under: ['rebounds', 'threes', 'points', 'blocks', 'steals', 'assists']
  },
  'SCORING_GUARD': {
    over: ['points', 'threes', 'assists', 'pts_rebs_asts', 'steals', 'rebounds', 'blocks'],
    under: ['rebounds', 'blocks', 'assists', 'threes', 'steals', 'points']
  },
  'TWO_WAY_WING': {
    over: ['points', 'rebounds', 'assists', 'steals', 'blocks', 'threes', 'pts_rebs_asts', 'pts_rebs', 'rebs_asts'],
    under: ['points', 'rebounds', 'assists', 'threes', 'steals', 'blocks']
  },
  'STRETCH_BIG': {
    over: ['points', 'threes', 'rebounds', 'pts_rebs', 'blocks', 'steals', 'assists'],
    under: ['assists', 'steals', 'points', 'blocks', 'threes', 'rebounds']
  },
  'RIM_PROTECTOR': {
    over: ['rebounds', 'blocks', 'pts_rebs', 'rebs_asts', 'points', 'steals', 'assists', 'threes'],
    under: ['points', 'assists', 'threes', 'steals', 'blocks', 'rebounds']
  },
  'COMBO_GUARD': {
    over: ['points', 'assists', 'threes', 'pts_rebs_asts', 'steals', 'rebounds', 'blocks'],
    under: ['rebounds', 'blocks', 'threes', 'steals', 'assists', 'points']
  },
  'ROLE_PLAYER': {
    over: ['rebounds', 'assists', 'steals', 'blocks', 'points', 'threes'],
    under: ['points', 'threes', 'assists', 'rebounds', 'steals', 'blocks']
  }
};

// ============ ELITE PLAYER LISTS (MANUALLY CURATED) ============
// ELITE REBOUNDERS: avg >= 9 rebounds (TIER 1 - NEVER FADE)
const ELITE_REBOUNDER_LIST = [
  'nikola jokic', 'nikola jokić', 'domantas sabonis', 'rudy gobert',
  'anthony davis', 'giannis antetokounmpo', 'victor wembanyama',
  'jonas valanciunas', 'deandre ayton', 'bam adebayo', 'jarrett allen',
  'andre drummond', 'steven adams', 'alperen sengun', 'karl-anthony towns',
  'evan mobley', 'paolo banchero', 'chet holmgren', 'jabari smith jr'
];

// GLASS CLEANERS: avg 6-9 rebounds (TIER 2 - eruption potential)
const GLASS_CLEANER_LIST = [
  'santi aldama', 'dayron sharpe', 'mitchell robinson', 'goga bitadze',
  'wendell carter jr', 'julius randle', 'ivica zubac', 'donovan clingan',
  'nick richards', 'jalen duren', 'nic claxton', 'mark williams',
  'mason plumlee', 'robert williams', 'kristaps porzingis', 'zach edey',
  'isaiah hartenstein', 'daniel gafford', 'clint capela', 'brook lopez'
];

// PURE SHOOTERS: Points specialists (20+ PPG scorers)
const PURE_SHOOTER_LIST = [
  'stephen curry', 'damian lillard', 'devin booker', 'kevin durant',
  'jayson tatum', 'jaylen brown', 'zach lavine', 'bradley beal',
  'cj mccollum', 'klay thompson', 'buddy hield', 'malik monk',
  'desmond bane', 'bogdan bogdanovic', 'collin sexton', 'cam thomas',
  'austin reaves', 'keegan murray', 'jalen williams', 'michael porter jr'
];

// PLAYMAKERS: Primary playmakers (7+ APG)
const PLAYMAKER_LIST = [
  'tyrese haliburton', 'trae young', 'chris paul', 'dejounte murray',
  'fred vanvleet', 'jalen brunson', 'darius garland', 'lamelo ball',
  'cade cunningham', 'tre jones', 'tyus jones', 'james harden',
  'luka doncic', 'luka dončić', 'shai gilgeous-alexander'
];

// SCORING GUARDS: High-volume scoring guards
const SCORING_GUARD_LIST = [
  'donovan mitchell', 'tyrese maxey', 'anthony edwards', 'de\'aaron fox',
  'jamal murray', 'demar derozan', 'kyrie irving', 'ja morant',
  'anfernee simons', 'jrue holiday', 'mikal bridges', 'coby white',
  'scoot henderson', 'jordan poole', 'immanuel quickley', 'scottie barnes'
];

// BALL-DOMINANT STARS: High usage + primary FT taker + clutch player
const BALL_DOMINANT_STARS = [
  'luka doncic', 'luka dončić',
  'shai gilgeous-alexander', 'shai gilgeous alexander',
  'jayson tatum', 'giannis antetokounmpo',
  'nikola jokic', 'nikola jokić',
  'anthony edwards', 'ja morant',
  'trae young', 'damian lillard',
  'kyrie irving', 'donovan mitchell',
  'de\'aaron fox', 'deaaron fox',
  'tyrese haliburton', 'lamelo ball',
  'kevin durant', 'lebron james'
];

// ============ STAR PLAYERS BY TEAM (ONE STAR PER TEAM RULE) ============
const STAR_PLAYERS_BY_TEAM: Record<string, string[]> = {
  'BOS': ['jayson tatum', 'jaylen brown'],
  'PHX': ['devin booker', 'kevin durant'],
  'DAL': ['luka doncic', 'luka dončić', 'kyrie irving'],
  'DEN': ['nikola jokic', 'nikola jokić'],
  'MIL': ['giannis antetokounmpo', 'damian lillard'],
  'MIN': ['anthony edwards'],
  'OKC': ['shai gilgeous-alexander', 'shai gilgeous alexander'],
  'LAL': ['lebron james', 'anthony davis'],
  'PHI': ['joel embiid', 'tyrese maxey'],
  'CLE': ['donovan mitchell'],
  'MEM': ['ja morant'],
  'ATL': ['trae young'],
  'SAC': ['de\'aaron fox', 'deaaron fox'],
  'IND': ['tyrese haliburton'],
  'CHA': ['lamelo ball'],
  'GSW': ['stephen curry'],
  'NYK': ['jalen brunson'],
};

// Flatten for quick lookup
const ALL_STAR_PLAYERS = Object.values(STAR_PLAYERS_BY_TEAM).flat();

// ============ ARCHETYPE CLASSIFICATION FUNCTIONS ============
function classifyPlayerArchetype(
  playerName: string,
  position: string,
  avgPoints: number,
  avgRebounds: number,
  avgAssists: number,
  avgThrees: number,
  avgBlocks: number,
  avgMinutes: number
): PlayerArchetype {
  const normalized = playerName?.toLowerCase() || '';
  
  // 1. Check manual elite lists first (highest accuracy)
  if (ELITE_REBOUNDER_LIST.some(p => normalized.includes(p))) return 'ELITE_REBOUNDER';
  if (GLASS_CLEANER_LIST.some(p => normalized.includes(p))) return 'GLASS_CLEANER';
  if (PLAYMAKER_LIST.some(p => normalized.includes(p))) return 'PLAYMAKER';
  if (PURE_SHOOTER_LIST.some(p => normalized.includes(p))) return 'PURE_SHOOTER';
  if (SCORING_GUARD_LIST.some(p => normalized.includes(p))) return 'SCORING_GUARD';
  
  // 2. Infer from stats
  // Elite rebounder: 9+ rebounds
  if (avgRebounds >= 9) return 'ELITE_REBOUNDER';
  
  // Glass cleaner: 6-9 rebounds
  if (avgRebounds >= 6 && avgRebounds < 9) return 'GLASS_CLEANER';
  
  // Playmaker: 7+ assists
  if (avgAssists >= 7) return 'PLAYMAKER';
  
  // Pure shooter: 20+ points, position is G/SG
  const posUpper = position?.toUpperCase() || '';
  if (avgPoints >= 20 && (posUpper === 'G' || posUpper === 'SG' || posUpper.includes('G'))) {
    return 'PURE_SHOOTER';
  }
  
  // Scoring guard: 15+ points, guard position
  if (avgPoints >= 15 && (posUpper === 'G' || posUpper === 'SG' || posUpper === 'PG')) {
    return 'SCORING_GUARD';
  }
  
  // Rim protector: 1.5+ blocks, big position
  if (avgBlocks >= 1.5 && (posUpper === 'C' || posUpper.includes('C'))) {
    return 'RIM_PROTECTOR';
  }
  
  // Stretch big: 4+ threes attempted, big position
  if (avgThrees >= 1.5 && (posUpper === 'PF' || posUpper === 'C' || posUpper.includes('F'))) {
    return 'STRETCH_BIG';
  }
  
  // Two-way wing: SF/F with balanced stats
  if (posUpper === 'SF' || posUpper === 'F' || posUpper.includes('F')) {
    if (avgPoints >= 12 && avgRebounds >= 4 && avgAssists >= 2) {
      return 'TWO_WAY_WING';
    }
  }
  
  // 3. Role player: low minutes or low stats
  if (avgMinutes < 22 || (avgPoints < 10 && avgRebounds < 5 && avgAssists < 3)) {
    return 'ROLE_PLAYER';
  }
  
  // Default to two-way wing (most flexible)
  return 'TWO_WAY_WING';
}

// ============ LAYER 2: ROLE-PROP ALIGNMENT VALIDATION ============
function validateArchetypePropAlignment(
  archetype: PlayerArchetype,
  propType: string,
  side: string
): { allowed: boolean; reason: string } {
  const allowed = ARCHETYPE_PROP_ALLOWED[archetype];
  const propLower = propType.toLowerCase();
  const isOver = side.toLowerCase() === 'over';
  const sideArray = isOver ? allowed.over : allowed.under;
  
  // Check if prop type is in allowed list for this side
  const propBase = propLower
    .replace('player_', '')
    .replace('_over', '')
    .replace('_under', '');
  
  // Handle combo stats
  if (propBase.includes('points') && propBase.includes('rebounds') && propBase.includes('assists')) {
    // PRA - special handling
    return { 
      allowed: false, 
      reason: `PRA props blocked for ${archetype} - use single stats` 
    };
  }
  
  // Check each allowed stat
  for (const stat of sideArray) {
    if (propBase.includes(stat)) {
      return { allowed: true, reason: `${stat} ${side} allowed for ${archetype}` };
    }
  }
  
  // Not in allowed list
  if (sideArray.length === 0) {
    return { 
      allowed: false, 
      reason: `${archetype} has no allowed ${side} props - too volatile` 
    };
  }
  
  return { 
    allowed: false, 
    reason: `${propBase} ${side} not aligned with ${archetype} archetype` 
  };
}

// ============ LAYER 3: HEAD-TO-HEAD MATCHUP ANALYSIS ============
interface MatchupAnalysis {
  gamesVsOpponent: number;
  avgStatVsOpponent: number;
  hitRateVsOpponent: number;
  maxVsOpponent: number;
  minVsOpponent: number;
  lastMeetingResult: 'over' | 'under' | 'push' | null;
}

function analyzeMatchupHistory(
  playerLogs: any[],
  opponent: string,
  propType: string,
  line: number,
  side: string,
  getStatValue: (log: any) => number
): MatchupAnalysis | null {
  if (!opponent || !playerLogs || playerLogs.length === 0) {
    return null;
  }
  
  // Filter logs for this opponent
  const opponentLower = opponent.toLowerCase();
  const matchupLogs = playerLogs.filter(log => {
    const logOpponent = (log.opponent || log.opponent_name || '').toLowerCase();
    return logOpponent.includes(opponentLower) || opponentLower.includes(logOpponent);
  });
  
  if (matchupLogs.length === 0) {
    return null;
  }
  
  const statValues = matchupLogs.map(getStatValue);
  const avgStat = statValues.reduce((a, b) => a + b, 0) / statValues.length;
  
  // Calculate hit rate based on side
  const isOver = side.toLowerCase() === 'over';
  const hits = statValues.filter(v => isOver ? v > line : v < line).length;
  const hitRate = (hits / statValues.length) * 100;
  
  // Last meeting
  const lastStat = statValues[0];
  let lastResult: 'over' | 'under' | 'push' | null = null;
  if (lastStat !== undefined) {
    if (lastStat > line) lastResult = 'over';
    else if (lastStat < line) lastResult = 'under';
    else lastResult = 'push';
  }
  
  return {
    gamesVsOpponent: matchupLogs.length,
    avgStatVsOpponent: avgStat,
    hitRateVsOpponent: hitRate,
    maxVsOpponent: Math.max(...statValues),
    minVsOpponent: Math.min(...statValues),
    lastMeetingResult: lastResult
  };
}

function validateMatchup(
  matchup: MatchupAnalysis | null,
  seasonAvg: number,
  line: number,
  side: string
): { valid: boolean; reason: string } {
  // No matchup data = allow but flag
  if (!matchup) {
    return { valid: true, reason: 'No H2H data - proceeding with caution' };
  }
  
  // Insufficient sample
  if (matchup.gamesVsOpponent < 2) {
    return { valid: true, reason: `Only ${matchup.gamesVsOpponent} games vs opponent - limited data` };
  }
  
  const isOver = side.toLowerCase() === 'over';
  
  // HARD FILTER: Hit rate < 40% vs opponent
  if (matchup.hitRateVsOpponent < 40) {
    return { 
      valid: false, 
      reason: `H2H FAIL: Only ${matchup.hitRateVsOpponent.toFixed(0)}% hit rate vs opponent (${matchup.gamesVsOpponent} games)` 
    };
  }
  
  // HARD FILTER: Avg vs opponent is 20%+ below season avg for OVER
  if (isOver) {
    const dropPct = ((seasonAvg - matchup.avgStatVsOpponent) / seasonAvg) * 100;
    if (dropPct >= 20) {
      return { 
        valid: false, 
        reason: `H2H FAIL: Avg ${matchup.avgStatVsOpponent.toFixed(1)} vs opponent is ${dropPct.toFixed(0)}% below season avg ${seasonAvg.toFixed(1)}` 
      };
    }
  }
  
  // HARD FILTER: Avg vs opponent is 20%+ above line for UNDER
  if (!isOver) {
    const abovePct = ((matchup.avgStatVsOpponent - line) / line) * 100;
    if (abovePct >= 20 && matchup.avgStatVsOpponent > line) {
      return { 
        valid: false, 
        reason: `H2H FAIL: Avg ${matchup.avgStatVsOpponent.toFixed(1)} vs opponent is ${abovePct.toFixed(0)}% above line ${line}` 
      };
    }
  }
  
  return { 
    valid: true, 
    reason: `H2H OK: ${matchup.hitRateVsOpponent.toFixed(0)}% hit rate, avg ${matchup.avgStatVsOpponent.toFixed(1)} vs opponent` 
  };
}

// ============ LAYER 4: STATISTICAL CONTINGENCIES ============
interface StatisticalValidation {
  valid: boolean;
  reason: string;
  details: {
    consistencyScore?: number;
    standardDeviation?: number;
    volatilityPct?: number;
    homeAwayDelta?: number;
    trendDirection?: string;
  };
}

function validateStatisticalContingencies(
  statValues: number[],
  seasonStats: {
    avgPoints?: number;
    avgRebounds?: number;
    avgAssists?: number;
    homeAvg?: number;
    awayAvg?: number;
    consistencyScore?: number;
    trendDirection?: string;
  } | null,
  propType: string,
  side: string,
  isHomeGame: boolean,
  isB2B: boolean
): StatisticalValidation {
  if (statValues.length < 5) {
    return { 
      valid: false, 
      reason: 'Insufficient data: Need 5+ games for statistical validation',
      details: {}
    };
  }
  
  const isOver = side.toLowerCase() === 'over';
  const avg = statValues.reduce((a, b) => a + b, 0) / statValues.length;
  
  // 1. STANDARD DEVIATION CHECK: Reject if std_dev > 30% of average
  const variance = statValues.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / statValues.length;
  const stdDev = Math.sqrt(variance);
  const volatilityPct = (stdDev / avg) * 100;
  
  // Allow higher volatility for low-count stats like blocks/steals
  // RELAXED: 200% max (was 150%) to allow more props through
  if (volatilityPct > 200) {
    return {
      valid: false,
      reason: `HIGH VOLATILITY: ${volatilityPct.toFixed(0)}% std dev (max 200%) - too swingy`,
      details: { standardDeviation: stdDev, volatilityPct }
    };
  }
  
  // 2. CONSISTENCY SCORE CHECK - RELAXED: min 40 (was 55)
  if (seasonStats?.consistencyScore !== undefined && seasonStats.consistencyScore < 40) {
    return {
      valid: false,
      reason: `LOW CONSISTENCY: ${seasonStats.consistencyScore} score (min 40) - unreliable`,
      details: { consistencyScore: seasonStats.consistencyScore }
    };
  }
  
  // 3. TREND DIRECTION CHECK
  if (seasonStats?.trendDirection) {
    const trend = seasonStats.trendDirection.toLowerCase();
    if (trend === 'cold' && isOver) {
      return {
        valid: false,
        reason: `TREND CONFLICT: Player trending COLD but betting OVER`,
        details: { trendDirection: trend }
      };
    }
    if (trend === 'hot' && !isOver) {
      return {
        valid: false,
        reason: `TREND CONFLICT: Player trending HOT but betting UNDER`,
        details: { trendDirection: trend }
      };
    }
  }
  
  // 4. HOME/AWAY SPLIT CHECK
  if (seasonStats?.homeAvg && seasonStats?.awayAvg) {
    const homeAwgDelta = Math.abs(seasonStats.homeAvg - seasonStats.awayAvg);
    const avgOfBoth = (seasonStats.homeAvg + seasonStats.awayAvg) / 2;
    const splitPct = (homeAwgDelta / avgOfBoth) * 100;
    
    if (splitPct >= 25) {
      const expectedAvg = isHomeGame ? seasonStats.homeAvg : seasonStats.awayAvg;
      const propLower = propType.toLowerCase();
      
      // Check if this split matters for the prop type
      if (propLower.includes('points') || propLower.includes('rebounds') || propLower.includes('assists')) {
        // If home avg is significantly higher and we're betting OVER on away game
        if (!isHomeGame && seasonStats.homeAvg > seasonStats.awayAvg && isOver) {
          return {
            valid: false,
            reason: `HOME/AWAY SPLIT: ${splitPct.toFixed(0)}% difference, away avg (${seasonStats.awayAvg.toFixed(1)}) lower but betting OVER`,
            details: { homeAwayDelta: homeAwgDelta }
          };
        }
        // If away avg is significantly higher and we're betting UNDER on home game
        if (isHomeGame && seasonStats.awayAvg > seasonStats.homeAvg && !isOver) {
          return {
            valid: false,
            reason: `HOME/AWAY SPLIT: ${splitPct.toFixed(0)}% difference, home avg (${seasonStats.homeAvg.toFixed(1)}) lower but betting UNDER`,
            details: { homeAwayDelta: homeAwgDelta }
          };
        }
      }
    }
  }
  
  // 5. BACK-TO-BACK FILTER (for OVER bets)
  if (isB2B && isOver) {
    // B2B games typically see 10-15% stat reduction
    // Calculate expected reduction and warn
    const expectedReduction = avg * 0.12;  // 12% expected drop
    return {
      valid: true,  // Allow but flag
      reason: `B2B WARNING: Expect ~${expectedReduction.toFixed(1)} reduction on back-to-back`,
      details: { volatilityPct, standardDeviation: stdDev }
    };
  }
  
  return {
    valid: true,
    reason: 'Statistical checks passed',
    details: { volatilityPct, standardDeviation: stdDev }
  };
}

// ============ LAYER 5: OVER/UNDER BALANCE ENFORCEMENT ============
interface BalanceTracker {
  overCount: number;
  underCount: number;
  total: number;
}

function enforceOverUnderBalance(
  currentBalance: BalanceTracker,
  newSide: string,
  archetype: PlayerArchetype,
  edge: number
): { allowed: boolean; reason: string } {
  const MAX_UNDER_PCT = 70;  // Max 70% unders (relaxed from 65%)
  const MAX_OVER_PCT = 70;   // Max 70% overs (relaxed from 65%)
  const MIN_SAMPLE_SIZE = 10; // Don't enforce balance until we have 10+ approved picks
  
  const isOver = newSide.toLowerCase() === 'over';
  const projectedTotal = currentBalance.total + 1;
  
  // Skip balance check for first N picks to avoid cold-start rejection
  if (currentBalance.total < MIN_SAMPLE_SIZE) {
    return { allowed: true, reason: 'Balance check skipped - building initial pool' };
  }
  
  if (isOver) {
    const projectedOverPct = ((currentBalance.overCount + 1) / projectedTotal) * 100;
    if (projectedOverPct > MAX_OVER_PCT) {
      return { 
        allowed: false, 
        reason: `BALANCE LIMIT: ${projectedOverPct.toFixed(0)}% would be OVER (max ${MAX_OVER_PCT}%)` 
      };
    }
  } else {
    const projectedUnderPct = ((currentBalance.underCount + 1) / projectedTotal) * 100;
    if (projectedUnderPct > MAX_UNDER_PCT) {
      return { 
        allowed: false, 
        reason: `BALANCE LIMIT: ${projectedUnderPct.toFixed(0)}% would be UNDER (max ${MAX_UNDER_PCT}%)` 
      };
    }
  }
  
  // Force OVER consideration for elite performers with huge edge
  if (!isOver && edge >= 3.0) {
    // Big edge on under = suspicious, but allow if archetype supports it
    if (archetype === 'PURE_SHOOTER' || archetype === 'PLAYMAKER') {
      return { allowed: true, reason: 'Large under edge allowed for archetype' };
    }
  }
  
  return { allowed: true, reason: 'Balance check passed' };
}

// ============ GAME SCRIPT CLASSIFICATION ============
type GameScript = 'COMPETITIVE' | 'SOFT_BLOWOUT' | 'HARD_BLOWOUT';

function classifyGameScript(spread: number): GameScript {
  const absSpread = Math.abs(spread);
  if (absSpread <= 7) return 'COMPETITIVE';
  if (absSpread <= 11) return 'SOFT_BLOWOUT';
  return 'HARD_BLOWOUT';
}

// ============ PLAYER ROLE (LEGACY COMPATIBILITY) ============
type PlayerRole = 'STAR' | 'BALL_DOMINANT_STAR' | 'SECONDARY_GUARD' | 'WING' | 'BIG';

function archetypeToRole(archetype: PlayerArchetype, playerName: string): PlayerRole {
  const normalized = playerName?.toLowerCase() || '';
  
  // Ball-dominant star override
  if (BALL_DOMINANT_STARS.some(p => normalized.includes(p))) {
    return 'BALL_DOMINANT_STAR';
  }
  
  // Star player check
  if (ALL_STAR_PLAYERS.some(star => normalized.includes(star))) {
    return 'STAR';
  }
  
  // Map archetype to role
  switch (archetype) {
    case 'ELITE_REBOUNDER':
    case 'GLASS_CLEANER':
    case 'RIM_PROTECTOR':
    case 'STRETCH_BIG':
      return 'BIG';
    case 'PLAYMAKER':
    case 'SCORING_GUARD':
      return 'SECONDARY_GUARD';
    case 'PURE_SHOOTER':
    case 'TWO_WAY_WING':
    default:
      return 'WING';
  }
}

function isStarPlayer(playerName: string): boolean {
  const normalized = playerName.toLowerCase();
  return ALL_STAR_PLAYERS.some(star => normalized.includes(star));
}

function getPlayerTeamFromName(playerName: string): string | null {
  const normalized = playerName.toLowerCase();
  for (const [team, stars] of Object.entries(STAR_PLAYERS_BY_TEAM)) {
    if (stars.some(star => normalized.includes(star))) {
      return team;
    }
  }
  return null;
}

function isBallDominantStar(playerName: string): boolean {
  const normalized = playerName.toLowerCase();
  return BALL_DOMINANT_STARS.some(p => normalized.includes(p));
}

// ============ PRA CHECKS ============
function isPRAPlay(propType: string): boolean {
  const statLower = propType.toLowerCase();
  return statLower.includes('points_rebounds_assists') || 
         statLower.includes('pra') ||
         statLower === 'player_points_rebounds_assists';
}

// PRA Tier 1: Absolute ban
const NEVER_FADE_PRA_TIER1 = ['jaylen brown', 'jayson tatum', 'devin booker'];

// PRA Tier 2: Conditional ban
const NEVER_FADE_PRA_TIER2 = [
  'luka doncic', 'luka dončić', 'nikola jokic', 'nikola jokić', 'giannis antetokounmpo'
];

function isOnNeverFadePRAList(playerName: string): { tier: 1 | 2 | null } {
  const normalized = playerName.toLowerCase();
  if (NEVER_FADE_PRA_TIER1.some(p => normalized.includes(p))) return { tier: 1 };
  if (NEVER_FADE_PRA_TIER2.some(p => normalized.includes(p))) return { tier: 2 };
  return { tier: null };
}

// ============ CEILING CHECK ============
function failsCeilingCheck(
  gameLogs: number[],
  line: number,
  side: string
): { fails: boolean; ceiling: number; ceilingRatio: number; reason: string } {
  const isUnder = side.toLowerCase() === 'under';
  
  if (!isUnder) {
    return { fails: false, ceiling: 0, ceilingRatio: 0, reason: 'Not an under play' };
  }
  
  if (!gameLogs || gameLogs.length < 5) {
    return { fails: false, ceiling: 0, ceilingRatio: 0, reason: 'Insufficient game logs' };
  }
  
  const ceiling = gameLogs.reduce((max, val) => val > max ? val : max, 0);
  const ceilingRatio = line > 0 ? ceiling / line : 0;
  
  // RELAXED: Reject if ceiling exceeds line by more than 150% (was 100%)
  if (ceilingRatio > 2.5) {
    return {
      fails: true,
      ceiling,
      ceilingRatio,
      reason: `CEILING CHECK FAILED: Max ${ceiling} in L${gameLogs.length} is ${Math.round((ceilingRatio - 1) * 100)}% above line ${line}`
    };
  }
  
  return {
    fails: false,
    ceiling,
    ceilingRatio,
    reason: `Ceiling check passed: MAX ${ceiling} within 50% of line ${line}`
  };
}

// ============ MEDIAN BAD GAME CHECK ============
function passesMedianBadGameCheck(
  gameLogs: number[],
  line: number,
  side: string
): { passes: boolean; badGameFloor: number; reason: string } {
  if (gameLogs.length < 5) {
    return { passes: false, badGameFloor: 0, reason: 'Insufficient game logs (need 5+)' };
  }
  
  const isUnder = side.toLowerCase() === 'under';
  const sorted = [...gameLogs].sort((a, b) => a - b);
  
  if (isUnder) {
    // FOR UNDER: Check if at least 2 of top 3 games are under the line
    const topGames = sorted.slice(-3);
    const ceiling = Math.max(...topGames);
    const underCount = topGames.filter(g => g < line).length;
    const passes = underCount >= 2; // Relaxed: 2/3 must be under (was 3/3)
    
    return { 
      passes, 
      badGameFloor: ceiling,
      reason: passes 
        ? `UNDER survives: ${underCount}/3 top games < line ${line}`
        : `UNDER FAILS: Only ${underCount}/3 top games < line ${line}`
    };
  } else {
    // FOR OVER: Check if at least 2 of bottom 3 games beat the line (relaxed from 3/3)
    const badGames = sorted.slice(0, 3);
    const badGameFloor = Math.min(...badGames);
    const overCount = badGames.filter(g => g > line).length;
    const passes = overCount >= 1; // Relaxed: 1/3 bad games > line is OK (was 3/3)
    
    return { 
      passes, 
      badGameFloor,
      reason: passes 
        ? `OVER survives: ${overCount}/3 bad games > line ${line}`
        : `OVER FAILS: ${overCount}/3 bad games > line ${line} - too risky`
    };
  }
}

// ============ MINUTES CLASSIFICATION ============
type MinutesConfidence = 'LOCKED' | 'MEDIUM' | 'RISKY';

function classifyMinutes(avgMinutes: number): MinutesConfidence {
  if (avgMinutes >= 32) return 'LOCKED';
  if (avgMinutes >= 24) return 'MEDIUM';
  return 'RISKY';
}

// ============ MEDIAN DEAD-ZONE FILTER ============
function isInMedianDeadZone(line: number, median: number): boolean {
  return Math.abs(line - median) <= 0.5;
}

// ============ CONFIDENCE SCORING ============
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface ConfidenceFactors {
  archetypeAlignment: number;
  minutesCertainty: number;
  gameScriptFit: number;
  medianDistance: number;
  badGameSurvival: number;
  matchupBonus: number;
  statisticalSafety: number;
}

function calculateConfidenceV3(
  archetype: PlayerArchetype,
  propType: string,
  side: string,
  minutesClass: MinutesConfidence,
  gameScript: GameScript,
  edge: number,
  passesBadGameCheck: boolean,
  matchupValid: boolean,
  statisticsValid: boolean
): { score: number; factors: ConfidenceFactors; propTypeTier: string } {
  const factors: ConfidenceFactors = {
    archetypeAlignment: 0,
    minutesCertainty: 0,
    gameScriptFit: 0,
    medianDistance: 0,
    badGameSurvival: 0,
    matchupBonus: 0,
    statisticalSafety: 0,
  };
  
  // Archetype Alignment (0-2.5)
  const alignment = validateArchetypePropAlignment(archetype, propType, side);
  factors.archetypeAlignment = alignment.allowed ? 2.5 : 0.5;
  
  // Minutes Certainty (0-2.0)
  switch (minutesClass) {
    case 'LOCKED': factors.minutesCertainty = 2.0; break;
    case 'MEDIUM': factors.minutesCertainty = 1.2; break;
    case 'RISKY': factors.minutesCertainty = 0.5; break;
  }
  
  // Game Script Fit (0-2.0)
  if (gameScript === 'COMPETITIVE') {
    factors.gameScriptFit = 2.0;
  } else if (gameScript === 'SOFT_BLOWOUT') {
    factors.gameScriptFit = 1.3;
  } else {
    factors.gameScriptFit = 0.8;
  }
  
  // Median Distance / Edge (0-2.5)
  const absEdge = Math.abs(edge);
  if (absEdge >= 3.0) factors.medianDistance = 2.5;
  else if (absEdge >= 2.0) factors.medianDistance = 2.0;
  else if (absEdge >= 1.0) factors.medianDistance = 1.5;
  else factors.medianDistance = 0.5;
  
  // Bad Game Survival (0-1.0)
  factors.badGameSurvival = passesBadGameCheck ? 1.0 : 0;
  
  // Matchup Bonus (0-1.0)
  factors.matchupBonus = matchupValid ? 1.0 : 0.3;
  
  // Statistical Safety (0-1.0)
  factors.statisticalSafety = statisticsValid ? 1.0 : 0.3;
  
  // Apply prop type performance bonus/penalty
  const normalizedPropType = normalizePropTypeForTier(propType);
  const propPerf = PROP_TYPE_PERFORMANCE_TIERS[normalizedPropType] || { tier: 'SOLID', confidenceBonus: 0, minEdgeRequired: 1.5 };
  
  const totalScore = Object.values(factors).reduce((a, b) => a + b, 0) + propPerf.confidenceBonus;
  
  return { score: totalScore, factors, propTypeTier: propPerf.tier };
}

// ============ PROP TYPE TO COLUMN MAPPING ============
function getColumnForProp(propType: string): string {
  const normalized = propType.toLowerCase().replace(/\s+/g, '_');
  
  if (normalized.includes('rebound')) return 'rebounds';
  if (normalized.includes('assist')) return 'assists';
  if (normalized.includes('point') && normalized.includes('rebound') && normalized.includes('assist')) return 'pts_reb_ast';
  if (normalized.includes('point') && normalized.includes('rebound')) return 'pts_reb';
  if (normalized.includes('point') && normalized.includes('assist')) return 'pts_ast';
  if (normalized.includes('rebound') && normalized.includes('assist')) return 'reb_ast';
  if (normalized.includes('point')) return 'points';
  if (normalized.includes('three') || normalized.includes('3pt')) return 'threes_made';
  if (normalized.includes('block')) return 'blocks';
  if (normalized.includes('steal')) return 'steals';
  if (normalized.includes('turnover')) return 'turnovers';
  
  return 'points';
}

// Extract stat value from game log
function extractStatFromLog(log: any, column: string): number {
  if (column === 'pts_reb_ast') {
    return (log.points || 0) + (log.rebounds || 0) + (log.assists || 0);
  }
  if (column === 'pts_reb') {
    return (log.points || 0) + (log.rebounds || 0);
  }
  if (column === 'pts_ast') {
    return (log.points || 0) + (log.assists || 0);
  }
  if (column === 'reb_ast') {
    return (log.rebounds || 0) + (log.assists || 0);
  }
  
  // Single stats
  if (column === 'rebounds') return log.rebounds || 0;
  if (column === 'assists') return log.assists || 0;
  if (column === 'points') return log.points || 0;
  if (column === 'threes_made') return log.threes_made || 0;
  if (column === 'blocks') return log.blocks || 0;
  if (column === 'steals') return log.steals || 0;
  if (column === 'turnovers') return log.turnovers || 0;
  if (column === 'minutes') return log.minutes || 0;
  
  return 0;
}

// ============ EASTERN TIME HELPER ============
function getEasternDate(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { 
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(now);
}

// ============ MAIN SERVER ============
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { action, mode = 'full_slate', use_live_odds = false, preferred_bookmakers = ['fanduel', 'draftkings'] } = await req.json();

    console.log(`[Risk Engine v3.1] Action: ${action}, Mode: ${mode}, Live Odds: ${use_live_odds}`);

    if (action === 'analyze_slate') {
      const today = getEasternDate();
      console.log(`[Risk Engine v3.1] Analyzing slate for ${today}`);
      
      // 1. Fetch active NBA props
      const { data: props, error: propsError } = await supabase
        .from('unified_props')
        .select('*')
        .eq('sport', 'basketball_nba')
        .eq('is_active', true)
        .gte('commence_time', today);

      if (propsError) throw propsError;
      console.log(`[Risk Engine v3.1] Found ${props?.length || 0} active props`);

      // 2. Fetch upcoming games
      const { data: games } = await supabase
        .from('upcoming_games_cache')
        .select('*')
        .eq('sport', 'basketball_nba')
        .gte('commence_time', today);

      // 3. Fetch player data from bdl_player_cache
      const { data: playerCache } = await supabase
        .from('bdl_player_cache')
        .select('player_name, position, team_name');
      
      const positionMap: Record<string, string> = {};
      for (const p of (playerCache || [])) {
        if (p.player_name && p.position) {
          positionMap[p.player_name.toLowerCase()] = p.position;
        }
      }
      console.log(`[Risk Engine v3.1] Loaded ${Object.keys(positionMap).length} player positions`);

      // 4. Fetch player season stats
      const { data: seasonStats } = await supabase
        .from('player_season_stats')
        .select('*');
      
      const seasonStatsMap: Record<string, any> = {};
      for (const s of (seasonStats || [])) {
        if (s.player_name) {
          seasonStatsMap[s.player_name.toLowerCase()] = s;
        }
      }
      console.log(`[Risk Engine v3.1] Loaded ${Object.keys(seasonStatsMap).length} season stats`);

      // 5. Fetch game logs for players in the props (all games for proper analysis)
      const playerNames = [...new Set((props || []).map((p: any) => p.player_name).filter(Boolean))];
      let allGameLogs: any[] = [];
      
      // Fetch game logs in batches of 50 players to avoid query limits
      const batchSize = 50;
      for (let i = 0; i < playerNames.length; i += batchSize) {
        const batch = playerNames.slice(i, i + batchSize);
        const { data: batchLogs } = await supabase
          .from('nba_player_game_logs')
          .select('*')
          .in('player_name', batch)
          .order('game_date', { ascending: false });
        
        if (batchLogs) {
          allGameLogs = [...allGameLogs, ...batchLogs];
        }
      }
      const gameLogs = allGameLogs;
      
      console.log(`[Risk Engine v3.1] Fetched ${gameLogs?.length || 0} game logs for ${playerNames.length} players`);

      // 6. Fetch player archetypes (if exists)
      const { data: archetypes } = await supabase
        .from('player_archetypes')
        .select('*');
      
      const archetypeMap: Record<string, PlayerArchetype> = {};
      for (const a of (archetypes || [])) {
        if (a.player_name && a.primary_archetype) {
          archetypeMap[a.player_name.toLowerCase()] = a.primary_archetype as PlayerArchetype;
        }
      }
      console.log(`[Risk Engine v3.1] Loaded ${Object.keys(archetypeMap).length} archetypes`);

      const approvedProps: any[] = [];
      const rejectedProps: any[] = [];
      const processedPlayerProps = new Set<string>();
      const starsUsedByTeam: Record<string, string[]> = {};
      
      // Balance tracker
      const balanceTracker: BalanceTracker = { overCount: 0, underCount: 0, total: 0 };
      
      // Track prop type distribution to cap any single type at MAX_PROP_TYPE_PCT
      const propTypeCounter: Record<string, number> = {};

      for (const prop of (props || [])) {
        try {
          const playerNameLower = prop.player_name?.toLowerCase() || '';
          const playerPropKey = `${playerNameLower}_${prop.prop_type}`;
          
          // Skip duplicates
          if (processedPlayerProps.has(playerPropKey)) {
            rejectedProps.push({ ...prop, rejection_reason: 'Duplicate prop type' });
            continue;
          }
          
          // Max 2 props per player
          const playerPropsCount = [...processedPlayerProps].filter(
            key => key.startsWith(playerNameLower + '_')
          ).length;
          
          if (playerPropsCount >= 2) {
            rejectedProps.push({ ...prop, rejection_reason: 'Max 2 props per player' });
            continue;
          }
          
          // One star per team
          const isStar = isStarPlayer(prop.player_name);
          const playerTeam = getPlayerTeamFromName(prop.player_name);
          
          if (isStar && playerTeam) {
            const teamStars = starsUsedByTeam[playerTeam] || [];
            if (teamStars.length >= 1 && !teamStars.includes(playerNameLower)) {
              rejectedProps.push({ 
                ...prop, 
                rejection_reason: `One star per team: ${teamStars[0]} already selected` 
              });
              continue;
            }
          }
          
          // Find game context
          const game = games?.find(g => 
            g.event_id === prop.event_id ||
            prop.description?.includes(g.home_team) ||
            prop.description?.includes(g.away_team)
          );
          
          let spread = game?.spread || 0;
          const gameScript = classifyGameScript(spread);
          const opponent = game?.away_team === prop.team_name ? game?.home_team : game?.away_team;
          const isHomeGame = game?.home_team === prop.team_name;
          
          // Get player stats
          const position = positionMap[playerNameLower] || 'SF';
          const stats = seasonStatsMap[playerNameLower];
          const avgPoints = stats?.avg_points || 0;
          const avgRebounds = stats?.avg_rebounds || 0;
          const avgAssists = stats?.avg_assists || 0;
          const avgThrees = stats?.avg_threes || 0;
          const avgBlocks = stats?.avg_blocks || 0;
          const avgMinutes = stats?.avg_minutes || 28;
          
          // ============ LAYER 0: GET GAME LOGS & CALCULATE MEDIAN FIRST ============
          // FIX: Calculate median BEFORE determining side to avoid defaulting all to 'under'
          const column = getColumnForProp(prop.prop_type);
          const playerLogs = gameLogs?.filter(log => 
            log.player_name?.toLowerCase() === playerNameLower
          ).slice(0, 15) || [];
          
          if (playerLogs.length < 5) {
            rejectedProps.push({ 
              ...prop, 
              rejection_reason: `Insufficient data: only ${playerLogs.length} games (need 5+)`, 
              player_role: 'UNKNOWN', 
              archetype: 'UNKNOWN' 
            });
            continue;
          }
          
          const statValues = playerLogs.map(log => extractStatFromLog(log, column));
          const line = prop.current_line || prop.line;
          const trueMedian = calculateMedian(statValues);
          const seasonAvg = statValues.reduce((a, b) => a + b, 0) / statValues.length;
          
          // ============ LINE SANITY CHECK (PREVENT BAD BOOKMAKER DATA) ============
          const sanityCheck = isLineSane(prop.player_name, prop.prop_type, line, trueMedian);
          if (!sanityCheck.sane) {
            rejectedProps.push({ 
              ...prop, 
              rejection_reason: sanityCheck.reason,
              player_role: 'UNKNOWN', 
              archetype: 'UNKNOWN' 
            });
            console.warn(`[SANITY] Rejected: ${sanityCheck.reason}`);
            continue;
          }
          
          // FIXED: Calculate edge from median BEFORE side determination
          const calculatedEdge = trueMedian - line; // positive = over edge, negative = under edge
          const side = prop.recommended_side || (calculatedEdge >= 0 ? 'over' : 'under');
          const isOver = side.toLowerCase() === 'over';
          const edge = isOver ? calculatedEdge : -calculatedEdge;
          
          // ============ PROP TYPE PERFORMANCE TIER CHECK ============
          const normalizedPropType = normalizePropTypeForTier(prop.prop_type);
          const propPerf = PROP_TYPE_PERFORMANCE_TIERS[normalizedPropType] || { tier: 'SOLID', confidenceBonus: 0, minEdgeRequired: 1.5 };
          
          // Check minimum edge requirement for this prop type tier
          if (Math.abs(calculatedEdge) < propPerf.minEdgeRequired) {
            rejectedProps.push({ 
              ...prop, 
              rejection_reason: `EDGE TOO THIN: ${normalizedPropType} (${propPerf.tier}) needs edge ≥${propPerf.minEdgeRequired}, got ${Math.abs(calculatedEdge).toFixed(1)}`,
              player_role: 'UNKNOWN',
              archetype: 'UNKNOWN'
            });
            continue;
          }
          
          // Check prop type volume cap (only enforce after 10+ approved)
          if (balanceTracker.total >= 10) {
            const currentPropTypeCount = propTypeCounter[normalizedPropType] || 0;
            const projectedPct = (currentPropTypeCount + 1) / (balanceTracker.total + 1);
            
            if (projectedPct > MAX_PROP_TYPE_PCT) {
              rejectedProps.push({ 
                ...prop, 
                rejection_reason: `VOLUME CAP: ${normalizedPropType} would be ${(projectedPct * 100).toFixed(0)}% of picks (max ${MAX_PROP_TYPE_PCT * 100}%)`,
                player_role: 'UNKNOWN',
                archetype: 'UNKNOWN'
              });
              continue;
            }
          }
          
          console.log(`[TIER-CHECK] ${prop.player_name} ${prop.prop_type}: tier=${propPerf.tier}, edge=${Math.abs(calculatedEdge).toFixed(1)} (min ${propPerf.minEdgeRequired})`);
          
          // ============ LAYER 1: ARCHETYPE CLASSIFICATION ============
          // Get archetype early for rebounds check
          let archetype = archetypeMap[playerNameLower];
          if (!archetype) {
            archetype = classifyPlayerArchetype(
              prop.player_name,
              position,
              avgPoints,
              avgRebounds,
              avgAssists,
              avgThrees,
              avgBlocks,
              avgMinutes
            );
          }
          
          const role = archetypeToRole(archetype, prop.player_name);
          
          // ============ REBOUNDS SPECIALIZED VALIDATION ============
          // Must run BEFORE other filters for rebounds props
          if (normalizedPropType === 'rebounds') {
            // RULE 0: Block ROLE_PLAYER rebounds entirely (too volatile)
            if (archetype === 'ROLE_PLAYER') {
              rejectedProps.push({ 
                ...prop, 
                rejection_reason: 'REB_ROLE_BLOCK: ROLE_PLAYER rebounds blocked (too volatile)',
                player_role: role,
                archetype
              });
              continue;
            }
            
            const reboundCheck = validateReboundsProp(line, edge, trueMedian, archetype, side);
            console.log(`[REB-CHECK] ${prop.player_name}: line=${line}, edge=${edge.toFixed(1)}, median=${trueMedian.toFixed(1)}, archetype=${archetype} → ${reboundCheck.approved ? 'PASS' : 'BLOCK'}: ${reboundCheck.reason}`);
            
            if (!reboundCheck.approved) {
              rejectedProps.push({ 
                ...prop, 
                rejection_reason: reboundCheck.reason,
                player_role: role,
                archetype,
                true_median: trueMedian
              });
              continue;
            }
            
            // Store confidence adjustment for later application
            (prop as any)._reboundConfidenceAdjust = reboundCheck.confidenceAdjust;
          }
          
          // ============ POINTS SPECIALIZED VALIDATION FOR BIGS ============
          // Must run for Points props on big archetypes
          let bigPointsCheck: BigPointsValidation | null = null;
          if (normalizedPropType === 'points') {
            bigPointsCheck = validateBigPointsProp(
              line, 
              edge, 
              trueMedian, 
              archetype, 
              side, 
              statValues,
              prop.over_price || null,
              prop.under_price || null
            );
            console.log(`[BIG-POINTS-CHECK] ${prop.player_name}: archetype=${archetype}, line=${line}, side=${side} → ${bigPointsCheck.approved ? 'PASS' : 'BLOCK'}: ${bigPointsCheck.reason}`);
            
            if (!bigPointsCheck.approved) {
              rejectedProps.push({ 
                ...prop, 
                rejection_reason: bigPointsCheck.reason,
                player_role: role,
                archetype,
                true_median: trueMedian,
                alt_line_recommendation: bigPointsCheck.altLineRecommendation
              });
              continue;
            }
            
            // Store confidence adjustment for later application
            if (bigPointsCheck.confidenceAdjust !== 0) {
              (prop as any)._bigPointsConfidenceAdjust = bigPointsCheck.confidenceAdjust;
            }
          }
          
          // ============ JUICED LINE DETECTION ============
          const juicedCheck = detectJuicedLine(
            line,
            prop.over_price || null,
            prop.under_price || null,
            side
          );
          
          // Store for later use
          (prop as any)._juicedCheck = juicedCheck;
          
          if (juicedCheck.isJuiced) {
            console.log(`[JUICED-CHECK] ${prop.player_name} ${prop.prop_type}: ${juicedCheck.reason}`);
          }
          
          // ============ PRA GLOBAL BLOCK ============
          const isPRA = isPRAPlay(prop.prop_type);
          if (isPRA) {
            if (isOver) {
              rejectedProps.push({ ...prop, rejection_reason: 'PRA OVER globally disabled', player_role: role, archetype });
              continue;
            }
            const neverFade = isOnNeverFadePRAList(prop.player_name);
            if (neverFade.tier !== null) {
              rejectedProps.push({ ...prop, rejection_reason: `PRA UNDER disabled for Tier ${neverFade.tier} player`, player_role: role, archetype });
              continue;
            }
            if (isBallDominantStar(prop.player_name) && gameScript === 'COMPETITIVE') {
              rejectedProps.push({ ...prop, rejection_reason: 'PRA UNDER disabled for ball-dominant star in competitive game', player_role: role, archetype });
              continue;
            }
          }
          
          // ============ ROLE PLAYER - Allow but with lower confidence ============
          // ROLE_PLAYER now allowed through - let statistical checks filter them
          
          // ============ LAYER 2: ARCHETYPE-PROP ALIGNMENT ============
          const alignmentCheck = validateArchetypePropAlignment(archetype, prop.prop_type, side);
          if (!alignmentCheck.allowed) {
            rejectedProps.push({ 
              ...prop, 
              rejection_reason: alignmentCheck.reason, 
              player_role: role, 
              archetype 
            });
            continue;
          }
          
          // ============ LAYER 3: HEAD-TO-HEAD MATCHUP ============
          const matchup = analyzeMatchupHistory(
            playerLogs,
            opponent || '',
            prop.prop_type,
            line,
            side,
            (log) => extractStatFromLog(log, column)
          );
          
          const matchupValidation = validateMatchup(matchup, seasonAvg, line, side);
          if (!matchupValidation.valid) {
            rejectedProps.push({ 
              ...prop, 
              rejection_reason: matchupValidation.reason, 
              player_role: role, 
              archetype,
              h2h_games: matchup?.gamesVsOpponent,
              h2h_avg: matchup?.avgStatVsOpponent
            });
            continue;
          }
          
          // ============ LAYER 4: STATISTICAL CONTINGENCIES ============
          const statValidation = validateStatisticalContingencies(
            statValues,
            stats ? {
              avgPoints: stats.avg_points,
              avgRebounds: stats.avg_rebounds,
              avgAssists: stats.avg_assists,
              homeAvg: stats.home_avg_points,
              awayAvg: stats.away_avg_points,
              consistencyScore: stats.consistency_score,
              trendDirection: stats.trend_direction
            } : null,
            prop.prop_type,
            side,
            isHomeGame,
            false  // TODO: Add B2B detection
          );
          
          if (!statValidation.valid) {
            rejectedProps.push({ 
              ...prop, 
              rejection_reason: statValidation.reason, 
              player_role: role, 
              archetype,
              stat_details: statValidation.details
            });
            continue;
          }
          
          // Ceiling check for unders
          const ceilingCheck = failsCeilingCheck(statValues, line, side);
          if (ceilingCheck.fails) {
            rejectedProps.push({ 
              ...prop, 
              rejection_reason: ceilingCheck.reason, 
              player_role: role, 
              archetype,
              ceiling: ceilingCheck.ceiling
            });
            continue;
          }
          
          // Bad game check
          const { passes: passesBadGame, badGameFloor, reason: badGameReason } = 
            passesMedianBadGameCheck(statValues, line, side);
          
          if (!passesBadGame) {
            rejectedProps.push({ 
              ...prop, 
              rejection_reason: badGameReason, 
              player_role: role, 
              archetype 
            });
            continue;
          }
          
          // Median dead-zone
          if (trueMedian > 0 && isInMedianDeadZone(line, trueMedian)) {
            rejectedProps.push({ 
              ...prop, 
              rejection_reason: `DEAD ZONE: Line ${line} within ±0.5 of median ${trueMedian.toFixed(1)}`, 
              player_role: role, 
              archetype 
            });
            continue;
          }
          
          // Sneaky line trap
          if (!isOver && trueMedian > line && (trueMedian - line) <= 2.5) {
            rejectedProps.push({ 
              ...prop, 
              rejection_reason: `SNEAKY TRAP: Median ${trueMedian.toFixed(1)} > line ${line} for UNDER`, 
              player_role: role, 
              archetype 
            });
            continue;
          }
          
          // Minutes check
          const minutesClass = classifyMinutes(avgMinutes);
          if (minutesClass === 'RISKY' && isOver) {
            rejectedProps.push({ 
              ...prop, 
              rejection_reason: 'Risky minutes (≤23) + OVER not allowed', 
              player_role: role, 
              archetype 
            });
            continue;
          }
          
          // ============ LAYER 5: BALANCE ENFORCEMENT ============
          const balanceCheck = enforceOverUnderBalance(balanceTracker, side, archetype, edge);
          if (!balanceCheck.allowed) {
            rejectedProps.push({ 
              ...prop, 
              rejection_reason: balanceCheck.reason, 
              player_role: role, 
              archetype 
            });
            continue;
          }
          
          // ============ CONFIDENCE SCORING (with prop type tier penalty/bonus) ============
          let { score, factors, propTypeTier } = calculateConfidenceV3(
            archetype,
            prop.prop_type,
            side,
            minutesClass,
            gameScript,
            edge,
            passesBadGame,
            matchupValidation.valid,
            statValidation.valid
          );
          
          // ============ LAYER 6: SWEET SPOT CONFIDENCE CALIBRATION (NEW) ============
          let adjustedScore = score;
          let sweetSpotReason: string | null = null;
          
          // POINTS: Scale high confidence down to sweet spot (8.5-9.5)
          if (normalizedPropType === 'points') {
            // Block confidence 8.2 exactly (0% hit rate historically)
            if (score >= 8.1 && score <= 8.3) {
              rejectedProps.push({
                ...prop,
                rejection_reason: `POINTS_CONFIDENCE_TRAP: Score ${score.toFixed(1)} in blocked range (8.1-8.3 = 0% hit rate)`,
                player_role: role,
                archetype,
                confidence_score: score
              });
              continue;
            }
            
            // Scale down high confidence scores to hit sweet spot (8.5-9.5)
            if (adjustedScore > 10.0) {
              // Compress: scores 10-12 become 8.5-9.5
              adjustedScore = 8.5 + ((adjustedScore - 10.0) * 0.5);
              adjustedScore = Math.min(adjustedScore, 9.5); // Cap at 9.5
              console.log(`[SWEET-SPOT] ${prop.player_name} POINTS: ${score.toFixed(1)} → ${adjustedScore.toFixed(1)} (scaled to sweet spot)`);
            }
            
            // Check if in sweet spot
            if (adjustedScore >= 8.5 && adjustedScore <= 9.5) {
              sweetSpotReason = 'POINTS_SWEET_SPOT_8.5-9.5';
            }
            
            // Points MID tier (15-21.5) requires higher edge
            if (line >= 15 && line <= 21.5 && Math.abs(calculatedEdge) < 2.0) {
              rejectedProps.push({
                ...prop,
                rejection_reason: `POINTS_MID_TIER_TRAP: Line ${line} in MID tier (42.9% hit rate), needs edge ≥2.0, got ${Math.abs(calculatedEdge).toFixed(1)}`,
                player_role: role,
                archetype,
                confidence_score: adjustedScore
              });
              continue;
            }
            
            // Apply big points confidence penalty if applicable
            if ((prop as any)._bigPointsConfidenceAdjust) {
              adjustedScore += (prop as any)._bigPointsConfidenceAdjust;
              console.log(`[BIG-POINTS-PENALTY] ${prop.player_name}: Applied ${(prop as any)._bigPointsConfidenceAdjust} penalty, new score: ${adjustedScore.toFixed(1)}`);
            }
          }
          
          // REBOUNDS: Cap at 10.0 (high confidence = trap for rebounds)
          if (normalizedPropType === 'rebounds') {
            adjustedScore = Math.min(adjustedScore, 10.0);
            
            // Apply rebound-specific boost/penalty if stored
            if ((prop as any)._reboundConfidenceAdjust) {
              adjustedScore += (prop as any)._reboundConfidenceAdjust;
            }
            
            // Check if in sweet spot
            if (adjustedScore >= 9.0 && adjustedScore <= 9.8) {
              sweetSpotReason = 'REBOUNDS_SWEET_SPOT_9.0-9.8';
            }
          }
          
          // ASSISTS: Check sweet spot (7.5-9.0)
          if (normalizedPropType === 'assists') {
            if (adjustedScore >= 7.5 && adjustedScore <= 9.0) {
              sweetSpotReason = 'ASSISTS_SWEET_SPOT_7.5-9.0';
            }
          }
          
          // Use prop-type specific minimum threshold
          const minConfidence = MIN_CONFIDENCE_BY_TYPE[normalizedPropType] || MIN_CONFIDENCE_BY_TYPE['default'];
          
          if (adjustedScore < minConfidence) {
            rejectedProps.push({ 
              ...prop, 
              rejection_reason: `Confidence ${adjustedScore.toFixed(1)} < ${minConfidence} threshold for ${normalizedPropType}`, 
              player_role: role, 
              archetype,
              confidence_score: adjustedScore
            });
            continue;
          }
          
          // Star favorable matchup check
          if (isStar && gameScript === 'HARD_BLOWOUT' && Math.abs(spread) > 10) {
            rejectedProps.push({ 
              ...prop, 
              rejection_reason: `Star in hard blowout (spread ${spread}) - minutes risk`, 
              player_role: role, 
              archetype 
            });
            continue;
          }
          
          // ============ APPROVED! ============
          const approvedPick = {
            player_name: prop.player_name,
            team_name: prop.team_name,
            opponent,
            prop_type: prop.prop_type,
            line,
            side,
            player_role: role,
            archetype,
            game_script: gameScript,
            minutes_class: minutesClass,
            avg_minutes: avgMinutes,
            spread,
            true_median: trueMedian,
            edge,
            bad_game_floor: badGameFloor,
            confidence_score: adjustedScore,  // Use adjusted score
            original_confidence: score,       // Store original for reference
            confidence_factors: factors,
            event_id: prop.event_id,
            game_date: today,
            is_pra: isPRA,
            is_ball_dominant: role === 'BALL_DOMINANT_STAR',
            is_star: isStar,
            is_sweet_spot: sweetSpotReason !== null,
            sweet_spot_reason: sweetSpotReason,
            // H2H data
            h2h_games: matchup?.gamesVsOpponent || 0,
            h2h_avg: matchup?.avgStatVsOpponent || 0,
            h2h_hit_rate: matchup?.hitRateVsOpponent || 0,
            // Stats
            volatility_pct: statValidation.details.volatilityPct,
            consistency_score: stats?.consistency_score,
            trend_direction: stats?.trend_direction,
            // Alt line recommendations
            alt_line_recommendation: (prop as any)._juicedCheck?.recommendedAltLine || 
              (bigPointsCheck?.altLineRecommendation && !bigPointsCheck.approved ? bigPointsCheck.altLineRecommendation : null),
            alt_line_reason: (prop as any)._juicedCheck?.isJuiced ? (prop as any)._juicedCheck.reason : null,
            is_juiced: (prop as any)._juicedCheck?.isJuiced || false,
            juice_magnitude: (prop as any)._juicedCheck?.juiceMagnitude || 0,
            line_warning: (prop as any)._juicedCheck?.isJuiced ? (prop as any)._juicedCheck.reason : null,
          };
          
          approvedProps.push(approvedPick);
          
          // Log sweet spot picks
          if (sweetSpotReason) {
            console.log(`[SWEET-SPOT-PICK] ${prop.player_name} ${prop.prop_type} ${side} @ ${line}: ${adjustedScore.toFixed(1)} (${sweetSpotReason})`);
          }
          
          // Log juiced line warnings
          if ((prop as any)._juicedCheck?.isJuiced) {
            console.log(`[JUICED-WARNING] ${prop.player_name} ${prop.prop_type}: ${(prop as any)._juicedCheck.reason}`);
          }
          
          // Track prop type for volume cap
          propTypeCounter[normalizedPropType] = (propTypeCounter[normalizedPropType] || 0) + 1;
          
          // Update tracking
          processedPlayerProps.add(playerPropKey);
          
          if (isOver) {
            balanceTracker.overCount++;
          } else {
            balanceTracker.underCount++;
          }
          balanceTracker.total++;
          
          if (isStar && playerTeam) {
            if (!starsUsedByTeam[playerTeam]) starsUsedByTeam[playerTeam] = [];
            if (!starsUsedByTeam[playerTeam].includes(playerNameLower)) {
              starsUsedByTeam[playerTeam].push(playerNameLower);
            }
          }
          
        } catch (propError: unknown) {
          const errorMessage = propError instanceof Error ? propError.message : 'Unknown error';
          rejectedProps.push({ ...prop, rejection_reason: `Error: ${errorMessage}` });
        }
      }
      
      // ============ SWEET SPOT TRACKING ============
      // Insert sweet spot picks to tracking table for verification
      const sweetSpotPicks = approvedProps.filter(p => p.is_sweet_spot);
      if (sweetSpotPicks.length > 0) {
        const trackingRecords = sweetSpotPicks.map(p => ({
          game_date: today,
          player_name: p.player_name,
          prop_type: normalizePropTypeForTier(p.prop_type),
          line: p.line,
          side: p.side,
          confidence_score: p.confidence_score,
          edge: p.edge,
          archetype: p.archetype,
          sweet_spot_reason: p.sweet_spot_reason
        }));
        
        const { error: trackError } = await supabase
          .from('sweet_spot_tracking')
          .upsert(trackingRecords, { onConflict: 'player_name,game_date,prop_type' });
        
        if (trackError) {
          console.error('[Risk Engine v3.1] Error tracking sweet spots:', trackError);
        } else {
          console.log(`[Risk Engine v3.1] Tracked ${sweetSpotPicks.length} sweet spot picks`);
        }
      }
      
      // Sort by confidence
      approvedProps.sort((a, b) => b.confidence_score - a.confidence_score);
      
      // Store approved picks
      if (approvedProps.length > 0) {
        const { error: insertError } = await supabase
          .from('nba_risk_engine_picks')
          .upsert(
            approvedProps.map(pick => ({
              ...pick,
              mode,
              created_at: new Date().toISOString()
            })),
            { onConflict: 'player_name,game_date,prop_type' }
          );
        
        if (insertError) {
          console.error('[Risk Engine v3.1] Error storing picks:', insertError);
        }
      }
      
      const overPct = balanceTracker.total > 0 
        ? ((balanceTracker.overCount / balanceTracker.total) * 100).toFixed(0) 
        : '0';
      const underPct = balanceTracker.total > 0 
        ? ((balanceTracker.underCount / balanceTracker.total) * 100).toFixed(0) 
        : '0';
      
      console.log(`[Risk Engine v3.1] Approved: ${approvedProps.length}, Rejected: ${rejectedProps.length}`);
      console.log(`[Risk Engine v3.1] Balance: ${overPct}% OVER / ${underPct}% UNDER`);
      console.log(`[Risk Engine v3.1] Sweet Spot Picks: ${sweetSpotPicks.length}`);
      
      return new Response(JSON.stringify({
        success: true,
        approvedCount: approvedProps.length,
        rejectedCount: rejectedProps.length,
        approved: approvedProps,
        rejected: rejectedProps.slice(0, 30),
        mode,
        gameDate: today,
        balance: {
          overs: balanceTracker.overCount,
          unders: balanceTracker.underCount,
          overPct,
          underPct
        },
        engineVersion: 'v3.1 - Sweet Spot Optimization System',
        sweetSpotCount: sweetSpotPicks.length
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (action === 'get_picks') {
      const today = getEasternDate();
      
      const { data: picks, error } = await supabase
        .from('nba_risk_engine_picks')
        .select('*')
        .eq('game_date', today)
        .order('confidence_score', { ascending: false });
      
      if (error) throw error;
      
      return new Response(JSON.stringify({
        success: true,
        picks: picks || [],
        count: picks?.length || 0,
        gameDate: today
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Risk Engine v3.1] Error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
