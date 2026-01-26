import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useParlayBuilder } from "@/contexts/ParlayBuilderContext";
import { toast } from "sonner";

// Get today's date in Eastern Time for consistent filtering
function getEasternDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// Normalize player name for fuzzy matching (handles dots, case, extra spaces)
function normalizePlayerName(name: string): string {
  return name.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

export interface SweetSpotPick {
  id: string;
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  confidence_score: number;
  edge: number;
  archetype: string | null;
  category?: string | null;
  team_name?: string;
  event_id?: string;
  game_date?: string;
  injuryStatus?: string | null;
  l10HitRate?: number | null;
  // v4.0: Projection fields
  projectedValue?: number | null;
  actualLine?: number | null;
  matchupAdjustment?: number | null;
  paceAdjustment?: number | null;
}

// v3.0: ARCHETYPE-PROP ALIGNMENT VALIDATION
const ARCHETYPE_PROP_BLOCKED: Record<string, string[]> = {
  'ELITE_REBOUNDER': ['points', 'threes'],
  'GLASS_CLEANER': ['points', 'threes', 'assists'],
  'RIM_PROTECTOR': ['points', 'threes'],
  'PURE_SHOOTER': ['rebounds', 'blocks'],
  'PLAYMAKER': ['rebounds', 'blocks'],
  'COMBO_GUARD': ['rebounds', 'blocks'],
  'SCORING_GUARD': ['rebounds', 'blocks'],
};

// Safe prop normalization helper - handles null/undefined and strips non-alpha chars
const normalizeProp = (p?: string | null): string =>
  (p || '').toLowerCase().replace(/[^a-z]/g, ''); // "Points + Rebounds" -> "pointsrebounds"

function isPickArchetypeAligned(pick: SweetSpotPick): boolean {
  if (!pick.archetype || pick.archetype === 'UNKNOWN') return true;
  
  // Safe prop normalization (prevents crash on null prop_type)
  const propNorm = normalizeProp(pick.prop_type);
  
  // ========== CATEGORY OVERRIDE: BIG_ASSIST_OVER ==========
  // Passing bigs (Vucevic, Sabonis, Jokic) are specifically targeted for BIG_ASSIST_OVER
  // Even if their archetype normally blocks assists, allow it for this category
  if (pick.category === 'BIG_ASSIST_OVER' && propNorm.includes('assist')) {
    console.log(`[SweetSpot] ✅ BIG_ASSIST_OVER override: ${pick.player_name} (${pick.archetype}) allowed for assists`);
    return true;
  }
  
  const blockedProps = ARCHETYPE_PROP_BLOCKED[pick.archetype];
  if (!blockedProps) return true;
  
  for (const blocked of blockedProps) {
    if (propNorm.includes(blocked.replace(/[^a-z]/g, ''))) {
      console.warn(`[SweetSpot] Filtering misaligned: ${pick.player_name} (${pick.archetype}) for ${pick.prop_type}`);
      return false;
    }
  }
  
  return true;
}

export interface H2HData {
  opponent: string;
  gamesPlayed: number;
  avgStat: number;
  hitRate: number;
  maxStat: number;
  minStat: number;
}

// Renamed from GameContext to prevent collision with Scout.tsx's GameContext
export interface ParlayEnvContext {
  vegasTotal: number;
  paceRating: string;  // 'FAST' | 'MEDIUM' | 'SLOW'
  gameScript: string;  // 'SHOOTOUT' | 'GRIND_OUT' | 'COMPETITIVE' | 'BLOWOUT' | 'HARD_BLOWOUT'
  grindFactor: number;
  opponent: string;
}

/**
 * Decision trace for debugging pick selection (v3.2)
 * Captures all factors that influenced a pick's inclusion/exclusion
 */
export interface DecisionTrace {
  playerName: string;
  category: string | null;
  
  // Archetype alignment
  archetypeAligned: boolean;
  archetypeReason?: string;
  
  // Pattern scoring
  patternScore: number;
  patternReasons: string[];
  
  // Defense context
  defenseRank?: number;
  defenseBlocked: boolean;
  
  // L10 context
  l10HitRate?: number;
  l10Missing: boolean;
  
  // Final score breakdown
  scoreBreakdown: {
    pattern: number;
    l10Contribution: number;
    confContribution: number;
    missingL10Penalty: number;
    totalScore: number;
  };
  
  // Outcome
  selected: boolean;
  blockReason?: string;
}

export interface DreamTeamLeg {
  pick: SweetSpotPick;
  team: string;
  score: number;
  h2h?: H2HData;
  gameContext?: ParlayEnvContext;
  opponentDefenseRank?: number;
  patternScore?: number;
}

// ========== WINNING PATTERN RULES v4.0 ==========
// Based on $714+ winning slips: game script + line thresholds + defensive matchups
// v4.0: Removed MID_SCORER_UNDER (40% hit rate) and ELITE_REB_OVER (unproven)
// Added THREE_POINT_SHOOTER (100% hit rate) and BIG_REBOUNDER (60%, proven)
const WINNING_PATTERN_RULES: Record<string, {
  minLine?: number;
  maxLine?: number;
  preferredPace?: string[];
  maxVegasTotal?: number;
  minVegasTotal?: number;
  preferredGameScript?: string[];
  excludedGameScript?: string[];
  preferredOpponentDefenseRank?: number; // Lower = stronger defense
  statType?: string;
}> = {
  'BIG_REBOUNDER': {
    minLine: 7.5,
    maxLine: 14.5,
    preferredPace: ['SLOW', 'MEDIUM'],
    maxVegasTotal: 222, // Grind games = more rebounds
    preferredGameScript: ['COMPETITIVE', 'GRIND_OUT'],
    statType: 'rebounds',
  },
  'ROLE_PLAYER_REB': {
    minLine: 3.5,
    maxLine: 6.5,
    preferredPace: ['SLOW', 'MEDIUM'], // Normalized: was LOW/MEDIUM
    statType: 'rebounds',
  },
  'LOW_SCORER_UNDER': {
    minLine: 4.5,
    maxLine: 10.5,
    preferredOpponentDefenseRank: 12, // vs TOP 12 points defense
    preferredGameScript: ['GRIND_OUT', 'COMPETITIVE'],
    statType: 'points',
  },
  'BIG_ASSIST_OVER': {
    minLine: 2.5,
    maxLine: 5.5,
    excludedGameScript: ['GRIND_OUT'], // Bigs don't pass in slow games
    statType: 'assists',
  },
  'STAR_FLOOR_OVER': {
    minLine: 18.5,
    preferredGameScript: ['SHOOTOUT', 'COMPETITIVE'],
    minVegasTotal: 218, // High-scoring games
    statType: 'points',
  },
  'THREE_POINT_SHOOTER': {
    minLine: 0.5,
    maxLine: 4.5,
    preferredGameScript: ['SHOOTOUT', 'COMPETITIVE'],
    minVegasTotal: 215, // Shootouts favor threes
    statType: 'threes',
  },
  'ASSIST_ANCHOR': {
    maxLine: 6.5,
    preferredGameScript: ['GRIND_OUT'],
    statType: 'assists',
  },
  'HIGH_REB_UNDER': {
    minLine: 8.5,
    preferredPace: ['FAST'], // Normalized: was HIGH
    statType: 'rebounds',
  },
};

interface PatternCheckResult {
  passes: boolean;
  score: number;
  reason: string;
}

// ========== PACE/SCRIPT NORMALIZATION v3.1 ==========
// Handles vocabulary mismatch: Rules use LOW/HIGH, DB uses SLOW/FAST
type Pace = 'FAST' | 'MEDIUM' | 'SLOW';
type Script = 'SHOOTOUT' | 'GRIND_OUT' | 'COMPETITIVE' | 'BLOWOUT' | 'HARD_BLOWOUT';

const normalizePace = (v?: string): Pace => {
  const p = (v || 'MEDIUM').toUpperCase();
  // Handle old rule vocab + any weird inputs
  if (p === 'LOW') return 'SLOW';
  if (p === 'HIGH') return 'FAST';
  if (p === 'SLOW' || p === 'MEDIUM' || p === 'FAST') return p as Pace;
  return 'MEDIUM';
};

const normalizeScript = (v?: string): Script => {
  const s = (v || 'COMPETITIVE').toUpperCase();
  if (s === 'HARD_BLOWOUT') return 'HARD_BLOWOUT';
  if (s === 'BLOWOUT') return 'BLOWOUT';
  if (s === 'GRIND_OUT') return 'GRIND_OUT';
  if (s === 'SHOOTOUT') return 'SHOOTOUT';
  return 'COMPETITIVE';
};

// Helper: Convert full team name to abbreviation for defensive lookups
function teamNameToAbbrev(teamName: string): string {
  if (!teamName) return '';
  const abbrevMap: Record<string, string> = {
    'atlanta hawks': 'atl', 'boston celtics': 'bos', 'brooklyn nets': 'bkn', 'charlotte hornets': 'cha',
    'chicago bulls': 'chi', 'cleveland cavaliers': 'cle', 'dallas mavericks': 'dal', 'denver nuggets': 'den',
    'detroit pistons': 'det', 'golden state warriors': 'gsw', 'houston rockets': 'hou', 'indiana pacers': 'ind',
    'los angeles clippers': 'lac', 'la clippers': 'lac', 'los angeles lakers': 'lal', 'la lakers': 'lal',
    'memphis grizzlies': 'mem', 'miami heat': 'mia', 'milwaukee bucks': 'mil', 'minnesota timberwolves': 'min',
    'new orleans pelicans': 'nop', 'new york knicks': 'nyk', 'oklahoma city thunder': 'okc', 'orlando magic': 'orl',
    'philadelphia 76ers': 'phi', 'phoenix suns': 'phx', 'portland trail blazers': 'por', 'sacramento kings': 'sac',
    'san antonio spurs': 'sas', 'toronto raptors': 'tor', 'utah jazz': 'uta', 'washington wizards': 'was',
  };
  const lower = teamName.toLowerCase();
  // Direct match first
  if (abbrevMap[lower]) return abbrevMap[lower];
  // Partial match
  for (const [name, abbrev] of Object.entries(abbrevMap)) {
    if (lower.includes(name) || name.includes(lower)) return abbrev;
  }
  return teamName.slice(0, 3).toLowerCase();
}

// ========== PRODUCTION-GRADE PATTERN MATCHER v3.1 ==========
// Handles: pace normalization, excluded script blocks, grindFactor bonuses, clean reason strings
function matchesWinningPattern(
  pick: SweetSpotPick,
  gameContext: ParlayEnvContext | undefined,
  opponentDefenseRank: number | undefined
): PatternCheckResult {
  const rules = WINNING_PATTERN_RULES[pick.category || ''];
  if (!rules) return { passes: true, score: 0, reason: 'No specific rules' };

  let score = 0;
  const reasons: string[] = [];
  const failures: string[] = [];

  const side = (pick.side || '').toLowerCase();
  const isUnder = side === 'under';

  // --------------------------
  // 1) LINE THRESHOLDS (HARD BLOCK)
  // --------------------------
  if (rules.minLine != null && pick.line < rules.minLine) {
    return { passes: false, score: 0, reason: `Line ${pick.line} < min ${rules.minLine}` };
  }
  if (rules.maxLine != null && pick.line > rules.maxLine) {
    return { passes: false, score: 0, reason: `Line ${pick.line} > max ${rules.maxLine}` };
  }
  score += 2;
  reasons.push('Line ✓');

  // ------------------------------------------
  // 2) CONTEXT: allow missing with penalty
  // ------------------------------------------
  const needsContext =
    !!(rules.preferredGameScript?.length ||
       rules.excludedGameScript?.length ||
       rules.preferredPace?.length ||
       rules.maxVegasTotal != null ||
       rules.minVegasTotal != null);

  if (!gameContext && needsContext) {
    score -= 2;
    reasons.push('No context (-2)');
    return { passes: true, score, reason: reasons.join(' | ') };
  }

  // --------------------------
  // 3) GAME CONTEXT SCORING
  // --------------------------
  if (gameContext) {
    const script = normalizeScript(gameContext.gameScript);
    const pace = normalizePace(gameContext.paceRating);
    const total = Number(gameContext.vegasTotal);

    // (A) Excluded scripts = HARD BLOCK
    if (rules.excludedGameScript?.length) {
      const excluded = rules.excludedGameScript.map(s => normalizeScript(s));
      if (excluded.includes(script)) {
        failures.push(`Script ${script} excluded`);
        return { passes: false, score: 0, reason: failures.join(', ') };
      }
    }

    // (B) Preferred script = strong bonus, else light penalty
    if (rules.preferredGameScript?.length) {
      const preferred = rules.preferredGameScript.map(s => normalizeScript(s));
      if (preferred.includes(script)) {
        score += 3;
        reasons.push(`${script} ✓`);
      } else {
        score -= 1;
        reasons.push(`${script} ✗`);
      }
    }

    // (C) Pace (normalized SLOW/MEDIUM/FAST)
    if (rules.preferredPace?.length) {
      const preferred = rules.preferredPace.map(p => normalizePace(p));
      if (preferred.includes(pace)) {
        score += 2;
        reasons.push(`Pace ${pace} ✓`);
      } else {
        score -= 1;
        reasons.push(`Pace ${pace} ✗`);
      }
    }

    // (D) Vegas total checks
    if (rules.maxVegasTotal != null) {
      if (total <= rules.maxVegasTotal) {
        score += 2;
        reasons.push(`Total ${total} ≤ ${rules.maxVegasTotal} ✓`);
      } else {
        score -= 2;
        reasons.push(`Total ${total} > ${rules.maxVegasTotal} ✗`);
      }
    }

    if (rules.minVegasTotal != null) {
      if (total >= rules.minVegasTotal) {
        score += 2;
        reasons.push(`Total ${total} ≥ ${rules.minVegasTotal} ✓`);
      } else {
        score -= 1;
        reasons.push(`Total ${total} < ${rules.minVegasTotal} ✗`);
      }
    }

    // (E) GrindFactor tie-in (small, safe)
    if (typeof gameContext.grindFactor === 'number') {
      if (isUnder && gameContext.grindFactor >= 0.65) {
        score += 1;
        reasons.push('Grind ↑ (UNDER) ✓');
      }
      if (!isUnder && gameContext.grindFactor >= 0.75 && rules.statType === 'points') {
        score -= 1;
        reasons.push('Grind ↑ (PTS OVER) ✗');
      }
    }
  }

  // ----------------------------------------------------
  // 4) DEFENSE: required + hard blocks for UNDERS
  // ----------------------------------------------------
  if (rules.preferredOpponentDefenseRank != null) {
    if (!opponentDefenseRank) {
      if (isUnder) {
        return { passes: false, score: 0, reason: 'UNDER requires defense rank verification' };
      }
      score -= 1;
      reasons.push('No DEF rank (-1)');
      return { passes: true, score, reason: reasons.join(' | ') };
    }

    if (opponentDefenseRank <= rules.preferredOpponentDefenseRank) {
      score += 4;
      reasons.push(`vs #${opponentDefenseRank} DEF ✓`);
    } else {
      if (isUnder) {
        return {
          passes: false,
          score: 0,
          reason: `UNDER vs weak DEF #${opponentDefenseRank} (need top ${rules.preferredOpponentDefenseRank})`
        };
      }
      score -= 2;
      reasons.push(`vs #${opponentDefenseRank} DEF (weak)`);
    }
  }

  return { passes: true, score, reason: reasons.join(' | ') || 'Base criteria met' };
}

// OPTIMAL WINNERS FORMULA v3.0 - Based on user's winning bet slip patterns
// Mirrors $714+ winning parlays: Elite Rebounders + Role Player Props + Unders
// Historical Win Rates from actual winning slips:
// - Elite Reb OVER (Gobert/Nurkic): ~65% win rate
// - Role Player Reb OVER (Finney-Smith/George): ~60% win rate
// - Big Assists OVER (Vucevic): ~70% win rate
// - Low Scorer UNDER (Dort/Sheppard): ~65% win rate
// - Mid Scorer UNDER: 64% win rate
// OPTIMAL WINNERS FORMULA v4.0 - Based on ACTUAL settled outcomes
// Updated 2026-01-26: Removed MID_SCORER_UNDER (40%) and ELITE_REB_OVER (0 data)
// THREE_POINT_SHOOTER: 100% hit rate (25/25)
// STAR_FLOOR_OVER: 95% hit rate (19/20)
// BIG_ASSIST_OVER: 83.3% hit rate (10/12)
// LOW_SCORER_UNDER: 76.7% hit rate (23/30)
// ROLE_PLAYER_REB: 75.9% hit rate (22/29)
// BIG_REBOUNDER: 60% hit rate (12/20) - replacing unproven ELITE_REB_OVER
const PROVEN_FORMULA = [
  { category: 'STAR_FLOOR_OVER', side: 'over', count: 1 },       // 95% - Stars like Ja, Booker
  { category: 'BIG_ASSIST_OVER', side: 'over', count: 1 },       // 83.3% - Vucevic, Sabonis type
  { category: 'THREE_POINT_SHOOTER', side: 'over', count: 1 },   // 100% - REPLACES MID_SCORER_UNDER (40%)
  { category: 'LOW_SCORER_UNDER', side: 'under', count: 1 },     // 76.7% - Dort/Sheppard type
  { category: 'ROLE_PLAYER_REB', side: 'over', count: 1 },       // 75.9% - Finney-Smith type
  { category: 'BIG_REBOUNDER', side: 'over', count: 1 },         // 60% - REPLACES ELITE_REB_OVER (no data)
];

// v4.0: Minimum requirements for a category to be used in parlay building
export const CATEGORY_MIN_REQUIREMENTS = {
  minSampleSize: 5,      // At least 5 settled picks
  minHitRate: 60,        // At least 60% hit rate (as percentage)
};

/**
 * Scoring weight presets for A/B testing and tuning (v3.3)
 * Switch between modes to optimize for different strategies
 */
export const SCORE_PRESETS = {
  balanced: {
    name: 'Balanced',
    description: 'Stable outputs, confidence matters, no weird flips',
    pattern: 1.0,
    l10: 6.0,
    confidence: 0.25,
    l10Default: 0.6,
    confDefault: 0.7,
    missingL10Penalty: -0.5,
  },
  reliabilityMax: {
    name: 'Reliability Max',
    description: 'L10 heavier, punishes missing data harder',
    pattern: 1.1,
    l10: 7.0,
    confidence: 0.22,
    l10Default: 0.58,
    confDefault: 0.7,
    missingL10Penalty: -0.75,
  },
  sharp: {
    name: 'Sharp',
    description: 'Confidence has more say, aggressive swings',
    pattern: 1.0,
    l10: 5.5,
    confidence: 0.35,
    l10Default: 0.6,
    confDefault: 0.7,
    missingL10Penalty: -0.6,
  },
} as const;

export type ScorePresetKey = keyof typeof SCORE_PRESETS;

// Active weights (mutable, starts with balanced)
export const SCORE_WEIGHTS = { 
  ...SCORE_PRESETS.balanced, 
  presetKey: 'balanced' as ScorePresetKey 
};

// Runtime preset switcher
export const setScorePreset = (key: ScorePresetKey) => {
  Object.assign(SCORE_WEIGHTS, SCORE_PRESETS[key], { presetKey: key });
  console.log(`[ScorePreset] Switched to: ${SCORE_PRESETS[key].name}`);
};

/** 
 * Unified pick scoring function (v4.0)
 * Uses configurable SCORE_WEIGHTS for A/B testing
 * 
 * Pattern = gatekeeper (structural logic)
 * L10 = primary signal (performance reliability)  
 * Confidence = meaningful tie-breaker (model conviction)
 * Missing L10 = penalty (unknowns shouldn't beat knowns)
 * Category Sample Size = penalty for unproven categories
 */
const scorePick = (p: {
  _patternScore?: number;
  l10HitRate?: number | null;
  confidence_score?: number;
  _categorySampleSize?: number;  // v4.0: Sample size for category-based penalty
}): number => {
  const pat = p._patternScore ?? 0;

  // L10 handling (0–1 scale)
  const hasL10 = p.l10HitRate != null;
  const l10 = hasL10 ? p.l10HitRate! : SCORE_WEIGHTS.l10Default;
  const missingL10Penalty = hasL10 ? 0 : SCORE_WEIGHTS.missingL10Penalty;

  // Confidence is already 0–1 scale
  const conf = p.confidence_score ?? SCORE_WEIGHTS.confDefault;

  // v4.0: Penalty for picks from categories with small sample sizes
  const sampleSize = p._categorySampleSize ?? 10;
  const samplePenalty = sampleSize < 10 ? -0.5 : 0;

  return (
    (pat * SCORE_WEIGHTS.pattern) +
    (l10 * SCORE_WEIGHTS.l10) +
    (conf * SCORE_WEIGHTS.confidence) +
    missingL10Penalty +
    samplePenalty
  );
};

// Export for unit testing
export { scorePick };

// ========== PURE CORE FUNCTION TYPES v3.4 ==========
/**
 * Input for pure core builder function
 * Contains all data needed for deterministic selection
 */
export interface BuilderInput {
  displayedDate: string;  // slateStatus.displayedDate for reproducibility
  presetKey?: ScorePresetKey;  // scoring preset for deterministic tests
  picks: SweetSpotPick[];
  h2hMap: Record<string, {
    opponent: string;
    gamesPlayed: number;
    avgStat: number;
    hitRateOver: number;
    hitRateUnder: number;
    maxStat: number;
    minStat: number;
  }>;
  gameContextMap: Record<string, ParlayEnvContext>;
  defenseMap: Record<string, number>;
}

/**
 * Output from pure core builder function
 */
export interface BuilderOutput {
  selectedLegs: DreamTeamLeg[];
  traces: DecisionTraceRow[];
  diagnostics: {
    totalCandidates: number;
    archetypeFiltered: number;
    h2hBlocked: string[];
    patternBlocked: string[];
    selectedCount: number;
  };
  activePreset: string;
  displayedDate: string;
}

// ========== PURE CORE BUILDER FUNCTION v3.4 ==========
/**
 * Pure, testable core function for building optimal parlays
 * Takes all dependencies as input, returns deterministic output
 * No React hooks, no side effects (except console logging for diagnostics)
 */
export function buildSweetSpotParlayCore(input: BuilderInput): BuilderOutput {
  // Set preset if provided (for deterministic testing)
  if (input.presetKey) {
    setScorePreset(input.presetKey);
  }

  const traces: DecisionTraceRow[] = [];
  const diagnostics = {
    totalCandidates: input.picks.length,
    archetypeFiltered: 0,
    h2hBlocked: [] as string[],
    patternBlocked: [] as string[],
    selectedCount: 0,
  };

  // Convert input maps to Map objects for consistent lookup
  const h2hMap = new Map(Object.entries(input.h2hMap || {}));
  const gameContextMap = new Map(Object.entries(input.gameContextMap || {}));
  const defenseMap = new Map(Object.entries(input.defenseMap || {}));

  // Helper: Get team abbreviation
  const getTeamAbbrev = (teamName: string | undefined): string => {
    if (!teamName) return '';
    const abbrevMap: Record<string, string> = {
      'charlotte hornets': 'CHA', 'brooklyn nets': 'BKN', 'atlanta hawks': 'ATL', 
      'boston celtics': 'BOS', 'chicago bulls': 'CHI', 'cleveland cavaliers': 'CLE', 
      'dallas mavericks': 'DAL', 'denver nuggets': 'DEN', 'detroit pistons': 'DET',
      'golden state warriors': 'GSW', 'houston rockets': 'HOU', 'indiana pacers': 'IND', 
      'los angeles clippers': 'LAC', 'la clippers': 'LAC', 'los angeles lakers': 'LAL', 
      'la lakers': 'LAL', 'memphis grizzlies': 'MEM', 'miami heat': 'MIA', 
      'milwaukee bucks': 'MIL', 'minnesota timberwolves': 'MIN', 'new orleans pelicans': 'NOP', 
      'new york knicks': 'NYK', 'oklahoma city thunder': 'OKC', 'orlando magic': 'ORL', 
      'philadelphia 76ers': 'PHI', 'phoenix suns': 'PHX', 'portland trail blazers': 'POR', 
      'sacramento kings': 'SAC', 'san antonio spurs': 'SAS', 'toronto raptors': 'TOR', 
      'utah jazz': 'UTA', 'washington wizards': 'WAS',
      'hornets': 'CHA', 'nets': 'BKN', 'hawks': 'ATL', 'celtics': 'BOS', 'bulls': 'CHI',
      'cavaliers': 'CLE', 'mavericks': 'DAL', 'nuggets': 'DEN', 'pistons': 'DET',
      'warriors': 'GSW', 'rockets': 'HOU', 'pacers': 'IND', 'clippers': 'LAC',
      'lakers': 'LAL', 'grizzlies': 'MEM', 'heat': 'MIA', 'bucks': 'MIL',
      'timberwolves': 'MIN', 'pelicans': 'NOP', 'knicks': 'NYK', 'thunder': 'OKC',
      'magic': 'ORL', '76ers': 'PHI', 'suns': 'PHX', 'trail blazers': 'POR', 'blazers': 'POR',
      'kings': 'SAC', 'spurs': 'SAS', 'raptors': 'TOR', 'jazz': 'UTA', 'wizards': 'WAS',
    };
    const lower = teamName.toLowerCase();
    if (abbrevMap[lower]) return abbrevMap[lower];
    const sortedEntries = Object.entries(abbrevMap).sort((a, b) => b[0].length - a[0].length);
    for (const [name, abbrev] of sortedEntries) {
      if (lower.includes(name)) return abbrev;
    }
    return teamName.slice(0, 3).toUpperCase();
  };

  // Helper: Get H2H data for a pick
  const getH2HForPick = (pick: SweetSpotPick): H2HData | undefined => {
    const playerKey = pick.player_name?.toLowerCase() || '';
    const propKey = pick.prop_type?.toLowerCase() || '';
    for (const [key, data] of h2hMap.entries()) {
      if (key.startsWith(`${playerKey}_`) && key.endsWith(`_${propKey}`)) {
        const isOver = pick.side?.toLowerCase() === 'over';
        return {
          opponent: data.opponent,
          gamesPlayed: data.gamesPlayed,
          avgStat: data.avgStat,
          hitRate: isOver ? data.hitRateOver : data.hitRateUnder,
          maxStat: data.maxStat,
          minStat: data.minStat,
        };
      }
    }
    return undefined;
  };

  // Helper: Get game context for a pick
  const getGameContextForPick = (pick: SweetSpotPick): ParlayEnvContext | undefined => {
    const teamAbbrev = getTeamAbbrev(pick.team_name);
    return gameContextMap.get(teamAbbrev.toLowerCase());
  };

  // Helper: Get opponent defense rank
  const getOpponentDefenseRank = (pick: SweetSpotPick): number | undefined => {
    const ctx = getGameContextForPick(pick);
    if (!ctx?.opponent) return undefined;

    const rules = WINNING_PATTERN_RULES[pick.category || ''];
    const allowedStatTypes = new Set(['points', 'rebounds', 'assists']);
    let statType = (rules?.statType || '').toLowerCase();

    if (!allowedStatTypes.has(statType)) {
      const propNorm = normalizeProp(pick.prop_type);
      statType = propNorm.includes('rebound') ? 'rebounds'
        : propNorm.includes('assist') ? 'assists'
        : 'points';
    }

    const oppRaw = (ctx.opponent || '').trim();
    const oppLower = oppRaw.toLowerCase();

    // Try as-is abbrev
    const key1 = `${oppLower}_${statType}`;
    const r1 = defenseMap.get(key1);
    if (r1 != null) return r1;

    // Try normalized abbrev
    const oppAbbrev = teamNameToAbbrev(oppRaw).toLowerCase();
    if (oppAbbrev && oppAbbrev !== oppLower) {
      const key2 = `${oppAbbrev}_${statType}`;
      const r2 = defenseMap.get(key2);
      if (r2 != null) return r2;
    }

    return undefined;
  };

  // Step 1: Archetype alignment filter
  const alignedPicks = input.picks.filter(pick => {
    const aligned = isPickArchetypeAligned(pick);
    if (!aligned) diagnostics.archetypeFiltered++;
    return aligned;
  });

  // Step 2: H2H validation
  const h2hValidatedPicks = alignedPicks.filter(pick => {
    const h2h = getH2HForPick(pick);
    if (!h2h || h2h.gamesPlayed < 2) return true;
    
    const isOver = pick.side?.toLowerCase() === 'over';
    
    if (h2h.hitRate < 0.40 && h2h.gamesPlayed >= 3) {
      diagnostics.h2hBlocked.push(`${pick.player_name} - ${(h2h.hitRate * 100).toFixed(0)}% ${pick.side} vs ${h2h.opponent}`);
      return false;
    }
    
    if (isOver && h2h.avgStat < pick.line * 0.75 && h2h.gamesPlayed >= 3) {
      diagnostics.h2hBlocked.push(`${pick.player_name} OVER - H2H avg ${h2h.avgStat.toFixed(1)} vs line ${pick.line}`);
      return false;
    }
    
    if (!isOver && h2h.avgStat > pick.line * 1.25 && h2h.gamesPlayed >= 3) {
      diagnostics.h2hBlocked.push(`${pick.player_name} UNDER - H2H avg ${h2h.avgStat.toFixed(1)} vs line ${pick.line}`);
      return false;
    }
    
    return true;
  });

  // Step 3: Pattern validation
  const patternValidatedPicks = h2hValidatedPicks.filter(pick => {
    const gameContext = getGameContextForPick(pick);
    const opponentDefenseRank = getOpponentDefenseRank(pick);
    const patternCheck = matchesWinningPattern(pick, gameContext, opponentDefenseRank);
    
    if (!patternCheck.passes) {
      diagnostics.patternBlocked.push(`${pick.player_name} ${pick.category}: ${patternCheck.reason}`);
      return false;
    }
    
    return true;
  });

  // Step 4: Category selection loop
  const selectedLegs: DreamTeamLeg[] = [];
  const usedTeams = new Set<string>();
  const usedPlayers = new Set<string>();

  for (const formula of PROVEN_FORMULA) {
    const categoryPicks = patternValidatedPicks
      .filter(p => 
        p.category === formula.category && 
        p.side.toLowerCase() === formula.side &&
        !usedPlayers.has(p.player_name.toLowerCase()) &&
        !usedTeams.has((p.team_name || '').toLowerCase())
      )
      .map(p => {
        const gameContext = getGameContextForPick(p);
        const opponentDefenseRank = getOpponentDefenseRank(p);
        const patternCheck = matchesWinningPattern(p, gameContext, opponentDefenseRank);
        return { ...p, _patternScore: patternCheck.score, _gameContext: gameContext, _opponentDefenseRank: opponentDefenseRank };
      })
      .sort((a, b) => scorePick(b) - scorePick(a));

    let added = 0;
    for (const pick of categoryPicks) {
      if (added >= formula.count) continue;
      if (selectedLegs.length >= TARGET_LEG_COUNT) break;

      const team = (pick.team_name || 'Unknown').toLowerCase();
      const h2h = getH2HForPick(pick);
      const gameContext = pick._gameContext;
      const opponentDefenseRank = pick._opponentDefenseRank;
      const finalScore = scorePick({ _patternScore: pick._patternScore, l10HitRate: pick.l10HitRate, confidence_score: pick.confidence_score });

      // Create trace row
      const hasL10 = pick.l10HitRate != null;
      const l10Val = hasL10 ? pick.l10HitRate! : SCORE_WEIGHTS.l10Default;
      const confVal = pick.confidence_score ?? SCORE_WEIGHTS.confDefault;
      
      traces.push({
        player: pick.player_name,
        team: pick.team_name,
        category: pick.category,
        prop: pick.prop_type,
        side: pick.side,
        archetypeAligned: true,
        patternScore: pick._patternScore ?? 0,
        patternReason: 'Passed validation',
        defenseRank: opponentDefenseRank,
        l10: pick.l10HitRate,
        conf: pick.confidence_score,
        scoreTotal: finalScore,
        scorePattern: (pick._patternScore ?? 0) * SCORE_WEIGHTS.pattern,
        scoreL10: l10Val * SCORE_WEIGHTS.l10,
        scoreConf: confVal * SCORE_WEIGHTS.confidence,
        scorePenalty: hasL10 ? 0 : SCORE_WEIGHTS.missingL10Penalty,
        selected: true,
      });

      selectedLegs.push({
        pick,
        team: pick.team_name || 'Unknown',
        score: finalScore,
        h2h,
        gameContext,
        opponentDefenseRank,
        patternScore: pick._patternScore,
      });
      usedTeams.add(team);
      usedPlayers.add(pick.player_name.toLowerCase());
      added++;
    }
  }

  // Step 5: Fill remaining slots from pattern-validated picks if needed
  if (selectedLegs.length < TARGET_LEG_COUNT) {
    const remainingPicks = patternValidatedPicks
      .filter(p => 
        !usedPlayers.has(p.player_name.toLowerCase()) &&
        !usedTeams.has((p.team_name || '').toLowerCase())
      )
      .map(p => {
        const gameContext = getGameContextForPick(p);
        const opponentDefenseRank = getOpponentDefenseRank(p);
        const patternCheck = matchesWinningPattern(p, gameContext, opponentDefenseRank);
        return { ...p, _patternScore: patternCheck.score, _gameContext: gameContext, _opponentDefenseRank: opponentDefenseRank };
      })
      .sort((a, b) => scorePick(b) - scorePick(a));

    for (const pick of remainingPicks) {
      if (selectedLegs.length >= TARGET_LEG_COUNT) break;

      const team = (pick.team_name || 'Unknown').toLowerCase();
      const h2h = getH2HForPick(pick);
      const gameContext = pick._gameContext;
      const opponentDefenseRank = pick._opponentDefenseRank;
      const finalScore = scorePick({ _patternScore: pick._patternScore, l10HitRate: pick.l10HitRate, confidence_score: pick.confidence_score });

      const hasL10 = pick.l10HitRate != null;
      const l10Val = hasL10 ? pick.l10HitRate! : SCORE_WEIGHTS.l10Default;
      const confVal = pick.confidence_score ?? SCORE_WEIGHTS.confDefault;
      
      traces.push({
        player: pick.player_name,
        team: pick.team_name,
        category: pick.category,
        prop: pick.prop_type,
        side: pick.side,
        archetypeAligned: true,
        patternScore: pick._patternScore ?? 0,
        patternReason: 'Fallback selection',
        defenseRank: opponentDefenseRank,
        l10: pick.l10HitRate,
        conf: pick.confidence_score,
        scoreTotal: finalScore,
        scorePattern: (pick._patternScore ?? 0) * SCORE_WEIGHTS.pattern,
        scoreL10: l10Val * SCORE_WEIGHTS.l10,
        scoreConf: confVal * SCORE_WEIGHTS.confidence,
        scorePenalty: hasL10 ? 0 : SCORE_WEIGHTS.missingL10Penalty,
        selected: true,
      });

      selectedLegs.push({
        pick,
        team: pick.team_name || 'Unknown',
        score: finalScore,
        h2h,
        gameContext,
        opponentDefenseRank,
        patternScore: pick._patternScore,
      });
      usedTeams.add(team);
      usedPlayers.add(pick.player_name.toLowerCase());
    }
  }

  diagnostics.selectedCount = selectedLegs.length;

  return { 
    selectedLegs, 
    traces, 
    diagnostics,
    activePreset: SCORE_WEIGHTS.presetKey,
    displayedDate: input.displayedDate,
  };
}

/**
 * Decision trace row for debugging pick selection (v3.3)
 * Captures full score breakdown for each candidate
 */
export interface DecisionTraceRow {
  player: string;
  team?: string;
  category?: string;
  prop?: string;
  side?: string;

  // Archetype validation
  archetypeAligned: boolean;
  archetypeReason?: string;

  // Pattern scoring
  patternScore: number;
  patternReason: string;

  // Context
  defenseRank?: number;
  l10?: number | null;
  conf?: number;

  // Score breakdown
  scoreTotal: number;
  scorePattern: number;
  scoreL10: number;
  scoreConf: number;
  scorePenalty: number;

  // Outcome
  selected: boolean;
  blockedReason?: string;
}

// Dream Team constraints
const MAX_PLAYERS_PER_TEAM = 1;
const TARGET_LEG_COUNT = 6;

interface SlateStatus {
  currentDate: string;
  displayedDate: string;
  isNextSlate: boolean;
}

type H2HMapType = Map<string, {
  opponent: string;
  gamesPlayed: number;
  avgStat: number;
  hitRateOver: number;
  hitRateUnder: number;
  maxStat: number;
  minStat: number;
}>;

type GameContextMapType = Map<string, ParlayEnvContext>;
type DefenseMapType = Map<string, number>;

interface QueryResult {
  picks: SweetSpotPick[];
  h2hMap: H2HMapType;
  gameContextMap: GameContextMapType;
  defenseMap: DefenseMapType;
  slateStatus: SlateStatus;
}

export function useSweetSpotParlayBuilder() {
  const { addLeg, clearParlay } = useParlayBuilder();

  // Fetch all sweet spot picks with team data - cross-reference with active props, injuries, and matchup intelligence
  const { data: queryResult, isLoading, refetch } = useQuery({
    queryKey: ['sweet-spot-parlay-picks'],
    queryFn: async (): Promise<QueryResult> => {
      const today = getEasternDate();
      const now = new Date().toISOString();
      
      // ========== DIAGNOSTIC TRACKING ==========
      const diagnostics = {
        timestamp: new Date().toISOString(),
        targetDate: '',
        totalCandidates: { category: 0, riskEngine: 0 },
        filters: {
          archetypeBlocked: { count: 0, players: [] as string[] },
          matchupBlocked: { count: 0, players: [] as string[] },
          outPlayers: { count: 0, players: [] as string[] },
          sideConflicts: { count: 0, players: [] as string[] },
          notInActiveSlate: { count: 0, players: [] as string[] },
        },
        passedValidation: { category: 0, riskEngine: 0 },
      };
      
      console.group('🎯 [Optimal Parlay Diagnostics]');
      console.log(`📅 Query started at: ${diagnostics.timestamp}`);
      
      // First get active props (future games only) to filter out stale picks
      const { data: activeProps } = await supabase
        .from('unified_props')
        .select('player_name, commence_time')
        .gte('commence_time', now);
      
      // Check if today has any remaining active games
      const todayActiveProps = (activeProps || []).filter(p => {
        const propDate = new Date(p.commence_time).toLocaleDateString('en-CA', { 
          timeZone: 'America/New_York' 
        });
        return propDate === today;
      });

      // Determine target date - today or next available slate
      let targetDate = today;
      let targetPlayers = new Set(
        todayActiveProps.map(p => p.player_name?.toLowerCase()).filter(Boolean)
      );
      let isNextSlate = false;

      if (todayActiveProps.length === 0 && activeProps && activeProps.length > 0) {
        // Find the earliest future date with props
        const futureProps = (activeProps || [])
          .map(p => ({
            ...p,
            gameDate: new Date(p.commence_time).toLocaleDateString('en-CA', { 
              timeZone: 'America/New_York' 
            })
          }))
          .sort((a, b) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime());

        if (futureProps.length > 0) {
          targetDate = futureProps[0].gameDate;
          targetPlayers = new Set(
            futureProps
              .filter(p => p.gameDate === targetDate)
              .map(p => p.player_name?.toLowerCase())
              .filter(Boolean)
          );
          isNextSlate = true;
          console.log(`⏭️ Today's slate complete. Switching to next slate: ${targetDate}`);
        }
      }

      diagnostics.targetDate = targetDate;
      console.log(`📆 Target date: ${targetDate}`);
      console.log(`👥 Active players in slate: ${targetPlayers.size}`);

      // Fetch injury reports for target date
      const { data: injuryReports } = await supabase
        .from('nba_injury_reports')
        .select('player_name, status, injury_type')
        .eq('game_date', targetDate);
      
      // ========== GAME ENVIRONMENT FETCH (Vegas lines, pace, script) ==========
      const { data: gameEnvironments } = await supabase
        .from('game_environment')
        .select('home_team_abbrev, away_team_abbrev, vegas_total, pace_rating, game_script, grind_factor')
        .eq('game_date', targetDate);
      
      // Create team -> game context map (uses ParlayEnvContext)
      const gameContextMap = new Map<string, ParlayEnvContext>();
      (gameEnvironments || []).forEach(g => {
        const context: ParlayEnvContext = {
          vegasTotal: Number(g.vegas_total) || 220,
          paceRating: g.pace_rating || 'MEDIUM',
          gameScript: g.game_script || 'COMPETITIVE',
          grindFactor: Number(g.grind_factor) || 0.5,
          opponent: '',
        };
        // Map both teams to their context, with opponent info
        if (g.home_team_abbrev) {
          gameContextMap.set(g.home_team_abbrev.toLowerCase(), { ...context, opponent: g.away_team_abbrev || '' });
        }
        if (g.away_team_abbrev) {
          gameContextMap.set(g.away_team_abbrev.toLowerCase(), { ...context, opponent: g.home_team_abbrev || '' });
        }
      });
      
      console.log(`🎮 Game environments loaded: ${gameContextMap.size} teams`);
      if (gameEnvironments && gameEnvironments.length > 0) {
        console.table(gameEnvironments.map(g => ({
          matchup: `${g.away_team_abbrev} @ ${g.home_team_abbrev}`,
          total: g.vegas_total,
          pace: g.pace_rating,
          script: g.game_script,
        })));
      }
      
      // ========== DEFENSIVE RATINGS FETCH ==========
      const { data: defenseRatings } = await supabase
        .from('team_defensive_ratings')
        .select('team_name, stat_type, defensive_rank, stat_allowed_per_game');
      
      // FIX: Create opponent defense map using ABBREVIATIONS as keys (not full team names)
      // This fixes the mismatch where lookups used "min_points" but map had "minnesota timberwolves_points"
      const defenseMap = new Map<string, number>();
      (defenseRatings || []).forEach(d => {
        // Store by abbreviation (e.g., "min_points" instead of "minnesota timberwolves_points")
        const abbrevKey = `${teamNameToAbbrev(d.team_name || '')}_${d.stat_type?.toLowerCase()}`;
        defenseMap.set(abbrevKey, d.defensive_rank ?? 15);
        
        // Also store by full name for compatibility
        const fullKey = `${d.team_name?.toLowerCase()}_${d.stat_type?.toLowerCase()}`;
        defenseMap.set(fullKey, d.defensive_rank ?? 15);
      });
      
      console.log(`🛡️ Defense ratings loaded: ${defenseMap.size} entries (keyed by abbrev + full name)`);
      
      // ========== H2H HISTORY FETCH ==========
      const { data: matchupHistoryData } = await supabase
        .from('matchup_history')
        .select('player_name, opponent, prop_type, games_played, avg_stat, hit_rate_over, hit_rate_under, max_stat, min_stat');
      
      // Create H2H lookup map: player_opponent_prop -> H2H stats
      const h2hMap = new Map<string, {
        opponent: string;
        gamesPlayed: number;
        avgStat: number;
        hitRateOver: number;
        hitRateUnder: number;
        maxStat: number;
        minStat: number;
      }>();
      
      (matchupHistoryData || []).forEach(h => {
        const key = `${h.player_name?.toLowerCase()}_${h.opponent?.toLowerCase()}_${h.prop_type?.toLowerCase()}`;
        h2hMap.set(key, {
          opponent: h.opponent || '',
          gamesPlayed: h.games_played || 0,
          avgStat: Number(h.avg_stat) || 0,
          hitRateOver: Number(h.hit_rate_over) || 0,
          hitRateUnder: Number(h.hit_rate_under) || 0,
          maxStat: Number(h.max_stat) || 0,
          minStat: Number(h.min_stat) || 0,
        });
      });
      
      console.log(`📊 H2H records loaded: ${h2hMap.size}`);

      // Create sets for different injury statuses
      const outPlayers = new Set(
        (injuryReports || [])
          .filter(r => r.status?.toLowerCase().includes('out'))
          .map(r => r.player_name?.toLowerCase())
          .filter(Boolean)
      );

      const questionablePlayers = new Map<string, string>(
        (injuryReports || [])
          .filter(r => !r.status?.toLowerCase().includes('out'))
          .map(r => [r.player_name?.toLowerCase() || '', r.status || ''])
      );

      console.log(`🏥 Injuries: ${outPlayers.size} OUT, ${questionablePlayers.size} questionable/GTD`);

      // NEW: Fetch blocked picks from matchup intelligence (head-to-head logic)
      const { data: blockedPicks } = await supabase
        .from('matchup_intelligence')
        .select('player_name, prop_type, side, line, block_reason')
        .eq('game_date', targetDate)
        .eq('is_blocked', true);

      const blockedSet = new Set(
        (blockedPicks || []).map(p => 
          `${p.player_name?.toLowerCase()}_${p.prop_type?.toLowerCase()}_${p.side?.toLowerCase()}`
        )
      );
      
      // Log blocked picks details
      console.log(`🚫 Matchup Intelligence Blocks: ${blockedSet.size}`);
      if (blockedPicks && blockedPicks.length > 0) {
        console.table(blockedPicks.map(p => ({
          player: p.player_name,
          prop: p.prop_type,
          side: p.side,
          reason: p.block_reason
        })));
      }

      // NEW v3.1: Fetch Game Environment Validation results (Vegas-math pre-filter)
      const { data: envValidations } = await supabase
        .from('game_environment_validation')
        .select('player_name, prop_type, side, line, validation_status, rejection_reason, confidence_adjustment')
        .eq('game_date', targetDate);

      const validationMap = new Map<string, { status: string; reason: string; adjustment: number }>(
        (envValidations || []).map(v => [
          `${v.player_name?.toLowerCase()}_${v.prop_type?.toLowerCase()}_${v.side?.toLowerCase()}`,
          { 
            status: v.validation_status || 'PENDING', 
            reason: v.rejection_reason || '',
            adjustment: v.confidence_adjustment || 0
          }
        ])
      );
      
      // Log validation summary
      const validationCounts = { approved: 0, conditional: 0, rejected: 0 };
      envValidations?.forEach(v => {
        if (v.validation_status === 'APPROVED') validationCounts.approved++;
        else if (v.validation_status === 'CONDITIONAL') validationCounts.conditional++;
        else if (v.validation_status === 'REJECTED') validationCounts.rejected++;
      });
      console.log(`🎯 Game Environment Validation: ${validationCounts.approved} 🟢 | ${validationCounts.conditional} 🟡 | ${validationCounts.rejected} 🔴`);

      // Get player team data from cache
      const { data: playerCache } = await supabase
        .from('bdl_player_cache')
        .select('player_name, team_name');

      const teamMap = new Map<string, string>();
      playerCache?.forEach(p => {
        if (p.player_name && p.team_name) {
          teamMap.set(p.player_name.toLowerCase(), p.team_name);
        }
      });

      // Calculate date range (today or yesterday in case of late analysis)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

      // PRIORITY 1: Get OPTIMAL WINNERS from category_sweet_spots (v3.0 categories)
      const { data: categoryPicks, error: categoryError } = await supabase
        .from('category_sweet_spots')
        .select('*')
        .gte('analysis_date', yesterdayStr)
        .lte('analysis_date', targetDate)
        .in('category', [
          // v3.0 Optimal winners (user's winning patterns)
          'ELITE_REB_OVER', 'ROLE_PLAYER_REB', 'BIG_ASSIST_OVER', 
          'LOW_SCORER_UNDER', 'STAR_FLOOR_OVER',
          // v2.0 Proven winners (still valid)
          'ASSIST_ANCHOR', 'HIGH_REB_UNDER', 'MID_SCORER_UNDER'
        ])
        .or('is_active.eq.true,l10_hit_rate.gte.0.55')
        .not('actual_line', 'is', null)
        .order('l10_hit_rate', { ascending: false });

      if (categoryError) {
        console.error('Error fetching category sweet spots:', categoryError);
      }

      // Build category recommendations map for side enforcement
      const categoryRecommendations = new Map<string, { side: string; l10HitRate: number }>();
      (categoryPicks || []).forEach(pick => {
        const key = `${pick.player_name?.toLowerCase()}_${pick.prop_type?.toLowerCase()}`;
        if (pick.recommended_side) {
          categoryRecommendations.set(key, {
            side: pick.recommended_side.toLowerCase(),
            l10HitRate: pick.l10_hit_rate || 0
          });
        }
      });

      // Filter category picks with ALL validation rules
      const validCategoryPicks = (categoryPicks || []).filter(pick => {
        const playerKey = pick.player_name?.toLowerCase();
        if (!playerKey) return false;
        
        // FIX: Use fuzzy matching for player names (handles "P.J." vs "PJ", etc.)
        const normalizedKey = normalizePlayerName(pick.player_name || '');
        const hasExactMatch = targetPlayers.has(playerKey);
        const hasFuzzyMatch = [...targetPlayers].some(p => normalizePlayerName(p) === normalizedKey);
        
        if (!hasExactMatch && !hasFuzzyMatch) {
          return false;
        }
        if (outPlayers.has(playerKey)) {
          console.log(`[SweetSpotParlay] Excluding OUT player from categories: ${pick.player_name}`);
          return false;
        }
        
        // v3.0: Apply archetype alignment check
        if (!isPickArchetypeAligned({
          id: pick.id,
          player_name: pick.player_name || '',
          prop_type: pick.prop_type || '',
          line: pick.actual_line || 0,
          side: pick.recommended_side || 'over',
          confidence_score: pick.confidence_score || 0,
          edge: 0,
          archetype: pick.archetype,
        })) {
          console.log(`[SweetSpotParlay] Blocking archetype-misaligned category: ${pick.player_name} (${pick.archetype}) for ${pick.prop_type}`);
          return false;
        }
        
        // Check matchup intelligence blocking
        const blockKey = `${playerKey}_${pick.prop_type?.toLowerCase()}_${pick.recommended_side?.toLowerCase()}`;
        if (blockedSet.has(blockKey)) {
          console.log(`[SweetSpotParlay] Blocking matchup-blocked category: ${pick.player_name} ${pick.prop_type} ${pick.recommended_side}`);
          return false;
        }
        
        return true;
      });

      console.log(`[SweetSpotParlay] Proven category picks: ${validCategoryPicks.length} (from ${categoryPicks?.length || 0})`);

      // PRIORITY 2: Get risk engine picks as fallback
      const { data: riskPicks, error: riskError } = await supabase
        .from('nba_risk_engine_picks')
        .select('*')
        .eq('is_sweet_spot', true)
        .eq('game_date', targetDate)
        .order('confidence_score', { ascending: false });

      if (riskError) {
        console.error('Error fetching risk engine sweet spots:', riskError);
      }

      // Filter risk picks with ALL validation rules
      const validRiskPicks = (riskPicks || []).filter(pick => {
        const playerKey = pick.player_name?.toLowerCase();
        if (!playerKey) return false;
        
        // FIX: Use fuzzy matching for player names (handles "P.J." vs "PJ", etc.)
        const normalizedKey = normalizePlayerName(pick.player_name || '');
        const hasExactMatch = targetPlayers.has(playerKey);
        const hasFuzzyMatch = [...targetPlayers].some(p => normalizePlayerName(p) === normalizedKey);
        
        if (!hasExactMatch && !hasFuzzyMatch) {
          return false;
        }
        if (outPlayers.has(playerKey)) {
          console.log(`[SweetSpotParlay] Excluding OUT player from risk engine: ${pick.player_name}`);
          return false;
        }
        
        // v3.0: Apply archetype alignment check
        if (!isPickArchetypeAligned({
          id: pick.id,
          player_name: pick.player_name || '',
          prop_type: pick.prop_type || '',
          line: pick.line || 0,
          side: pick.side || 'over',
          confidence_score: pick.confidence_score || 0,
          edge: pick.edge || 0,
          archetype: pick.archetype,
        })) {
          console.log(`[SweetSpotParlay] Blocking archetype-misaligned risk: ${pick.player_name} (${pick.archetype}) for ${pick.prop_type}`);
          return false;
        }
        
        // Check matchup intelligence blocking
        const blockKey = `${playerKey}_${pick.prop_type?.toLowerCase()}_${pick.side?.toLowerCase()}`;
        if (blockedSet.has(blockKey)) {
          console.log(`[SweetSpotParlay] Blocking matchup-blocked risk: ${pick.player_name} ${pick.prop_type} ${pick.side}`);
          return false;
        }
        
        // Check if category has a DIFFERENT side recommendation - skip if conflict
        const catKey = `${playerKey}_${pick.prop_type?.toLowerCase()}`;
        const categoryRec = categoryRecommendations.get(catKey);
        if (categoryRec && categoryRec.side !== pick.side?.toLowerCase()) {
          console.log(`[SweetSpotParlay] Skipping risk pick - category recommends ${categoryRec.side}, risk says ${pick.side}: ${pick.player_name}`);
          return false;
        }
        
        return true;
      });

      console.log(`[SweetSpotParlay] Risk engine picks: ${validRiskPicks.length} (filtered from ${riskPicks?.length || 0})`);

      // Combine picks with category picks taking priority
      const allPicks: SweetSpotPick[] = [];
      const seenPlayers = new Set<string>();

      // Add category picks first (proven formulas) - ALWAYS use recommended_side
      validCategoryPicks.forEach(pick => {
        const playerKey = pick.player_name?.toLowerCase();
        if (playerKey && !seenPlayers.has(playerKey)) {
          seenPlayers.add(playerKey);
          const injuryStatus = questionablePlayers.get(playerKey) || null;
          
          allPicks.push({
            id: pick.id,
            player_name: pick.player_name || '',
            prop_type: pick.prop_type || '',
            line: pick.actual_line || pick.recommended_line || 0,
            side: pick.recommended_side || 'over', // ENFORCE category recommendation
            confidence_score: pick.confidence_score || 0.8,
            edge: (pick.l10_hit_rate || 0.7) * 10 - 5,
            archetype: pick.archetype,
            category: pick.category,
            team_name: teamMap.get(playerKey) || 'Unknown',
            game_date: pick.analysis_date,
            injuryStatus,
            l10HitRate: pick.l10_hit_rate,
            // v4.0: Projection fields from category analyzer
            projectedValue: pick.projected_value,
            actualLine: pick.actual_line,
            matchupAdjustment: pick.matchup_adjustment,
            paceAdjustment: pick.pace_adjustment,
          });
        }
      });

      // Add risk engine picks that aren't duplicates and don't conflict with categories
      validRiskPicks.forEach(pick => {
        const playerKey = pick.player_name?.toLowerCase();
        if (playerKey && !seenPlayers.has(playerKey)) {
          seenPlayers.add(playerKey);
          const injuryStatus = questionablePlayers.get(playerKey) || null;
          
          allPicks.push({
            id: pick.id,
            player_name: pick.player_name || '',
            prop_type: pick.prop_type || '',
            line: pick.line || 0,
            side: pick.side || 'over',
            confidence_score: pick.confidence_score || 0,
            edge: pick.edge || 0,
            archetype: pick.archetype,
            category: null,
            team_name: teamMap.get(playerKey) || pick.team_name || 'Unknown',
            event_id: pick.event_id,
            game_date: pick.game_date,
            injuryStatus,
          });
        }
      });

      // v3.1: Apply Game Environment Validation filter
      const validatedPicks = allPicks.filter(pick => {
        const key = `${pick.player_name?.toLowerCase()}_${pick.prop_type?.toLowerCase()}_${pick.side?.toLowerCase()}`;
        const validation = validationMap.get(key);
        
        if (!validation) return true; // No validation = allow (new/pending picks)
        
        // Block REJECTED picks
        if (validation.status === 'REJECTED') {
          console.log(`[GameEnvValidator] ❌ REJECTED: ${pick.player_name} ${pick.prop_type} ${pick.side} - ${validation.reason}`);
          diagnostics.filters.archetypeBlocked.count++; // Reusing counter for env blocking
          return false;
        }
        
        // Allow CONDITIONAL only if L10 hit rate >= 70% (strong override signal)
        if (validation.status === 'CONDITIONAL') {
          if ((pick.l10HitRate || 0) >= 0.7) {
            console.log(`[GameEnvValidator] 🟡 CONDITIONAL (allowed): ${pick.player_name} - high L10 hit rate (${((pick.l10HitRate || 0) * 100).toFixed(0)}%) overrides`);
            // Apply confidence adjustment from validation
            pick.confidence_score = Math.max(0, Math.min(1, pick.confidence_score + (validation.adjustment / 100)));
            return true;
          }
          console.log(`[GameEnvValidator] 🟡 CONDITIONAL (blocked): ${pick.player_name} - ${validation.reason}`);
          return false;
        }
        
        // APPROVED - apply any positive confidence adjustment
        if (validation.adjustment > 0) {
          pick.confidence_score = Math.min(1, pick.confidence_score + (validation.adjustment / 100));
        }
        
        return true; // APPROVED
      });

      console.log(`[SweetSpotParlay] After Game Environment Validation: ${validatedPicks.length}/${allPicks.length} picks passed`);
      console.groupEnd();

      return {
        picks: validatedPicks,
        h2hMap,
        gameContextMap,
        defenseMap,
        slateStatus: {
          currentDate: today,
          displayedDate: targetDate,
          isNextSlate,
        }
      };
    },
    staleTime: 60000,
  });

  const sweetSpotPicks = queryResult?.picks;
  const h2hMap = queryResult?.h2hMap || new Map();
  const gameContextMap = queryResult?.gameContextMap || new Map();
  const defenseMap = queryResult?.defenseMap || new Map();
  const slateStatus = queryResult?.slateStatus || { currentDate: getEasternDate(), displayedDate: getEasternDate(), isNextSlate: false };

  // Build optimal 6-leg parlay using pure core function
  const buildOptimalParlay = (): DreamTeamLeg[] => {
    console.group('🏆 [Optimal Parlay Builder v3.4 - Pure Core Integration]');
    console.log(`🎛️ [Preset: ${SCORE_WEIGHTS.presetKey.toUpperCase()}] Pat×${SCORE_WEIGHTS.pattern} | L10×${SCORE_WEIGHTS.l10} | Conf×${SCORE_WEIGHTS.confidence} | Penalty: ${SCORE_WEIGHTS.missingL10Penalty}`);
    
    if (!sweetSpotPicks || sweetSpotPicks.length === 0) {
      console.log('❌ No sweet spot picks available');
      console.groupEnd();
      return [];
    }

    // Serialize Maps to plain objects for pure core function
    const input: BuilderInput = {
      displayedDate: slateStatus.displayedDate,
      presetKey: SCORE_WEIGHTS.presetKey,
      picks: sweetSpotPicks,
      h2hMap: Object.fromEntries(h2hMap.entries()),
      gameContextMap: Object.fromEntries(gameContextMap.entries()),
      defenseMap: Object.fromEntries(defenseMap.entries()),
    };

    const result = buildSweetSpotParlayCore(input);
    
    // Console logging (side effect, kept in hook)
    console.log(`📊 Total candidates: ${result.diagnostics.totalCandidates}`);
    console.log(`🚫 Archetype blocked: ${result.diagnostics.archetypeFiltered}`);
    if (result.diagnostics.h2hBlocked.length > 0) {
      console.log(`🚫 H2H blocked (${result.diagnostics.h2hBlocked.length}):`);
      result.diagnostics.h2hBlocked.forEach(b => console.log(`   ❌ ${b}`));
    }
    if (result.diagnostics.patternBlocked.length > 0) {
      console.log(`🚫 Pattern blocked (${result.diagnostics.patternBlocked.length}):`);
      result.diagnostics.patternBlocked.forEach(b => console.log(`   ❌ ${b}`));
    }
    console.log(`✅ Selected: ${result.diagnostics.selectedCount} legs`);
    
    if (result.selectedLegs.length > 0) {
      console.log(`\n📋 FINAL SELECTION (${result.selectedLegs.length}/6 legs):`);
      console.table(result.selectedLegs.map((leg, i) => ({
        '#': i + 1,
        Player: leg.pick.player_name,
        Category: leg.pick.category || 'Fallback',
        Prop: `${leg.pick.side.toUpperCase()} ${leg.pick.line} ${leg.pick.prop_type}`,
        L10: leg.pick.l10HitRate ? `${(leg.pick.l10HitRate * 100).toFixed(0)}%` : 'N/A',
        Score: leg.score.toFixed(2),
        DEF: leg.opponentDefenseRank ? `#${leg.opponentDefenseRank}` : '-',
      })));
    }
    
    console.groupEnd();
    return result.selectedLegs;
  };

  // Export frozen slate for golden snapshot testing
  const exportFrozenSlate = () => {
    if (!sweetSpotPicks?.length) {
      console.warn('[FrozenSlate] No picks loaded yet');
      toast.error('No picks loaded - cannot export slate');
      return;
    }

    const payload: BuilderInput = {
      displayedDate: slateStatus.displayedDate,
      presetKey: SCORE_WEIGHTS.presetKey,
      picks: sweetSpotPicks,
      h2hMap: Object.fromEntries(h2hMap.entries()),
      gameContextMap: Object.fromEntries(gameContextMap.entries()),
      defenseMap: Object.fromEntries(defenseMap.entries()),
    };

    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `frozen_slate_${slateStatus.displayedDate}_${SCORE_WEIGHTS.presetKey}.json`;
    a.click();

    URL.revokeObjectURL(url);
    toast.success(`Exported frozen slate: ${sweetSpotPicks.length} picks`);
    console.log('[FrozenSlate] Exported', slateStatus.displayedDate, sweetSpotPicks.length, 'picks');
  };

  // Add optimal parlay to builder
  const addOptimalParlayToBuilder = () => {
    const optimalLegs = buildOptimalParlay();
    
    if (optimalLegs.length === 0) {
      toast.error('No sweet spot picks available to build parlay');
      return;
    }

    clearParlay();

    optimalLegs.forEach(leg => {
      const description = `${leg.pick.player_name} ${leg.pick.prop_type} ${leg.pick.side.toUpperCase()} ${leg.pick.line}`;
      
      addLeg({
        source: 'sharp',
        description,
        odds: -110,
        playerName: leg.pick.player_name,
        propType: leg.pick.prop_type,
        line: leg.pick.line,
        side: leg.pick.side as 'over' | 'under',
        confidenceScore: leg.pick.confidence_score,
      });
    });

    toast.success(`Added ${optimalLegs.length}-leg Sweet Spot Dream Team parlay!`);
  };

  const optimalParlay = sweetSpotPicks ? buildOptimalParlay() : [];

  // Calculate combined stats
  const combinedStats = {
    avgConfidence: optimalParlay.length > 0 
      ? optimalParlay.reduce((sum, l) => sum + l.pick.confidence_score, 0) / optimalParlay.length 
      : 0,
    avgEdge: optimalParlay.length > 0 
      ? optimalParlay.reduce((sum, l) => sum + l.pick.edge, 0) / optimalParlay.length 
      : 0,
    avgL10HitRate: optimalParlay.length > 0
      ? optimalParlay.reduce((sum, l) => sum + (l.pick.l10HitRate || 0), 0) / optimalParlay.length
      : 0,
    uniqueTeams: new Set(optimalParlay.map(l => l.team)).size,
    propTypes: [...new Set(optimalParlay.map(l => l.pick.prop_type))],
    legCount: optimalParlay.length,
    categories: [...new Set(optimalParlay.map(l => l.pick.category).filter(Boolean))],
  };

  return {
    sweetSpotPicks,
    optimalParlay,
    combinedStats,
    isLoading,
    refetch,
    addOptimalParlayToBuilder,
    buildOptimalParlay,
    exportFrozenSlate,  // v3.4: Export frozen slate for testing
    slateStatus,
    // v3.4: Expose active preset for dashboard
    activePreset: SCORE_WEIGHTS.presetKey,
  };
}
