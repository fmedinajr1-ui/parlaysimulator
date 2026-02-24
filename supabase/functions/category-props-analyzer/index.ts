// Category Props Analyzer v4.0 - TRUE PROJECTIONS + ARCHETYPE ENFORCEMENT
// Analyzes props by player category with TRUE projected values (not floor thresholds)
// v4.0: Added projected_value = L10 Median + Matchup Adjustment + Pace Adjustment
// v3.0: Archetype enforcement to prevent misaligned picks
// v2.0 Categories (based on 391 settled picks analysis)
// v1.5: BIG categories ALWAYS recommend OVER with risk_level indicators

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// EST-aware date helper
function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

interface GameLog {
  player_name: string;
  game_date: string;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  threes_made: number;
  minutes_played: number;
  opponent?: string;
}

interface MatchupHistory {
  player_name: string;
  opponent: string;
  prop_type: string;
  games_played: number;
  avg_stat: number;
  max_stat: number;
  min_stat: number;
}

interface GameEnvironment {
  game_id: string;
  home_team: string;
  away_team: string;
  vegas_total: number;
  vegas_spread: number;
  pace_rating?: string;  // v4.1: Fixed - stored as TEXT ("LOW", "MEDIUM", "FAST")
  pace_class?: string;
  game_script?: string;
}

// v4.1: Team abbreviation to full name mapping for matchup_history lookups
const TEAM_ABBREV_TO_NAME: Record<string, string> = {
  'ATL': 'Atlanta Hawks', 'BOS': 'Boston Celtics', 'BKN': 'Brooklyn Nets', 'CHA': 'Charlotte Hornets',
  'CHI': 'Chicago Bulls', 'CLE': 'Cleveland Cavaliers', 'DAL': 'Dallas Mavericks', 'DEN': 'Denver Nuggets',
  'DET': 'Detroit Pistons', 'GSW': 'Golden State Warriors', 'HOU': 'Houston Rockets', 'IND': 'Indiana Pacers',
  'LAC': 'LA Clippers', 'LAL': 'Los Angeles Lakers', 'MEM': 'Memphis Grizzlies', 'MIA': 'Miami Heat',
  'MIL': 'Milwaukee Bucks', 'MIN': 'Minnesota Timberwolves', 'NOP': 'New Orleans Pelicans', 'NYK': 'New York Knicks',
  'OKC': 'Oklahoma City Thunder', 'ORL': 'Orlando Magic', 'PHI': 'Philadelphia 76ers', 'PHX': 'Phoenix Suns',
  'POR': 'Portland Trail Blazers', 'SAC': 'Sacramento Kings', 'SAS': 'San Antonio Spurs', 'TOR': 'Toronto Raptors',
  'UTA': 'Utah Jazz', 'WAS': 'Washington Wizards'
};

// v4.1: Convert text pace_rating to numeric multiplier
function getPaceMultiplier(paceRating: string | undefined): number {
  if (!paceRating) return 0.0;
  switch (paceRating.toUpperCase()) {
    case 'FAST': return 0.05;     // +5% stats boost
    case 'HIGH': return 0.03;     // +3% boost  
    case 'MEDIUM': return 0.0;    // baseline
    case 'LOW': return -0.03;     // -3% penalty
    case 'SLOW': return -0.05;    // -5% penalty
    default: return 0.0;
  }
}

// v4.1: Normalize opponent name for matchup_history lookup
function normalizeOpponentName(opponent: string): string {
  // First try exact abbreviation match
  const upper = opponent.toUpperCase().trim();
  if (TEAM_ABBREV_TO_NAME[upper]) {
    return TEAM_ABBREV_TO_NAME[upper];
  }
  // Try partial match (e.g., "Chicago" or "Bulls" -> "Chicago Bulls")
  const lowerOpp = opponent.toLowerCase().trim();
  for (const [abbrev, fullName] of Object.entries(TEAM_ABBREV_TO_NAME)) {
    if (fullName.toLowerCase().includes(lowerOpp) || lowerOpp.includes(fullName.toLowerCase())) {
      return fullName;
    }
  }
  // Return original if no match found
  return opponent;
}

interface CategoryConfig {
  name: string;
  propType: string;
  avgRange: { min: number; max: number };
  lineRange?: { min: number; max: number };
  lines: number[];
  side: 'over' | 'under';
  minHitRate: number;
  supportsBounceBack?: boolean;
  requiredArchetypes?: string[];
  blockedArchetypes?: string[];
  disabled?: boolean; // v7.0: Disable underperforming categories
}

// ============ STAR PLAYER BLOCK (v7.1) ============
// Never recommend UNDER on star players - hedge system will handle live adjustments
const STAR_PLAYER_NAMES = [
  // MVP Caliber
  'luka doncic', 'luka dončić',
  'anthony edwards',
  'shai gilgeous-alexander', 'shai gilgeous alexander',
  'jayson tatum', 'giannis antetokounmpo',
  'nikola jokic', 'nikola jokić',
  // All-NBA
  'ja morant', 'trae young', 'damian lillard',
  'kyrie irving', 'donovan mitchell',
  'de\'aaron fox', 'deaaron fox',
  'kevin durant', 'lebron james',
  'stephen curry', 'joel embiid',
  'devin booker',
  // All-Star
  'jaylen brown', 'tyrese maxey', 'jimmy butler',
  'anthony davis', 'jalen brunson',
  // Rising Stars
  'tyrese haliburton', 'lamelo ball',
  'paolo banchero', 'zion williamson', 'victor wembanyama',
  // Elite Bigs
  'karl-anthony towns', 'bam adebayo', 'domantas sabonis',
];

function isStarPlayer(playerName: string): boolean {
  const normalized = playerName.toLowerCase().trim();
  return STAR_PLAYER_NAMES.some(star => 
    normalized.includes(star) || star.includes(normalized)
  );
}

// ============ PROJECTION WEIGHTS (v5.0 - TIGHTENED) ============
const PROJECTION_WEIGHTS = {
  L10_MEDIAN: 0.45,      // Reduced from 0.55 - L10 has high variance
  MATCHUP_H2H: 0.22,     // Reduced from 0.30 - small sample sizes
  PACE_FACTOR: 0.08,     // Reduced from 0.15 - pace impact overstated
  REGRESSION: 0.25,      // NEW: Regress toward season average for stability
};

// ============ MINIMUM EDGE THRESHOLDS (v6.0 - TRIPLED) ============
// Only recommend picks where edge (|projection - line|) exceeds threshold
// v6.0: Tripled thresholds to prevent low-edge picks from being recommended
const MIN_EDGE_THRESHOLDS: Record<string, number> = {
  points: 4.5,     // TRIPLED from 1.5 - need 4.5+ edge for points
  rebounds: 2.5,   // INCREASED from 1.0 - need 2.5+ edge for rebounds
  assists: 2.0,    // INCREASED from 0.8 - need 2.0+ edge for assists
  threes: 1.0,     // DOUBLED from 0.5 - need 1.0+ edge for threes
  blocks: 1.0,     // DOUBLED from 0.5 - need 1.0+ edge for blocks
  steals: 0.8,     // INCREASED from 0.3 - need 0.8+ edge for steals
};

// ============ 3PT SHOOTER FILTERS (v6.0) ============
// Based on empirical analysis of 49+ settled picks showing 0% hit rate danger zones
const THREES_FILTER_CONFIG = {
  // Minimum edge requirements by variance tier
  MIN_EDGE_BY_VARIANCE: {
    LOW: 0.3,      // Low variance = reliable, lower edge needed
    MEDIUM: 0.8,   // Medium variance = need decent edge
    HIGH: 1.2,     // High variance = need strong edge buffer
  } as Record<string, number>,
  
  // Maximum variance allowed by edge quality
  MAX_VARIANCE_BY_EDGE: {
    FAVORABLE: 3.0,  // >= 1.0 edge = allow high variance
    NEUTRAL: 1.5,    // 0.5-0.99 edge = cap at medium variance
    TIGHT: 1.0,      // < 0.5 edge = only ultra-consistent allowed
  } as Record<string, number>,
  
  // Floor protection requirements
  MIN_FLOOR_FOR_TIGHT_LINES: 2,  // L10 min must be 2+ for tight edges
  
  // Hot/Cold detection thresholds
  HOT_STREAK_MULTIPLIER: 1.15,   // L5 > L10 * 1.15 = HOT
  COLD_STREAK_MULTIPLIER: 0.85,  // L5 < L10 * 0.85 = COLD
};

// Validate 3PT candidate against variance-edge matrix and hot/cold detection
function validate3PTCandidate(
  playerName: string,
  actualLine: number,
  l10Avg: number,
  l10Min: number,
  stdDev: number,
  l5Avg: number
): { passes: boolean; reason: string; tier: string } {
  
  // 1. Calculate variance tier
  const varianceTier = stdDev <= 1.0 ? 'LOW' : stdDev <= 1.5 ? 'MEDIUM' : 'HIGH';
  
  // 2. Calculate edge quality
  const edge = l10Avg - actualLine;
  const edgeQuality = edge >= 1.0 ? 'FAVORABLE' : edge >= 0.5 ? 'NEUTRAL' : 'TIGHT';
  
  // 3. DANGER ZONE BLOCKING
  // Block: HIGH variance + NEUTRAL edge = 0% historical hit rate
  if (varianceTier === 'HIGH' && edgeQuality === 'NEUTRAL') {
    return { passes: false, reason: `HIGH variance (${stdDev.toFixed(2)}) + NEUTRAL edge (${edge.toFixed(1)}) = 0% historical`, tier: 'BLOCKED' };
  }
  
  // Block: MEDIUM variance + TIGHT edge = 0% historical hit rate
  if (varianceTier === 'MEDIUM' && edgeQuality === 'TIGHT') {
    return { passes: false, reason: `MEDIUM variance + TIGHT edge = 0% historical`, tier: 'BLOCKED' };
  }
  
  // 4. FLOOR PROTECTION for tight lines
  if (edgeQuality === 'TIGHT' && l10Min < THREES_FILTER_CONFIG.MIN_FLOOR_FOR_TIGHT_LINES) {
    return { passes: false, reason: `TIGHT edge requires L10 Min >= ${THREES_FILTER_CONFIG.MIN_FLOOR_FOR_TIGHT_LINES}, got ${l10Min}`, tier: 'BLOCKED' };
  }
  
  // 5. COLD PLAYER DETECTION
  if (l5Avg < l10Avg * THREES_FILTER_CONFIG.COLD_STREAK_MULTIPLIER) {
    return { passes: false, reason: `COLD streak: L5 (${l5Avg.toFixed(1)}) < L10*0.85 (${(l10Avg * 0.85).toFixed(1)})`, tier: 'COLD' };
  }
  
  // 6. Check minimum edge for variance tier
  const minEdge = THREES_FILTER_CONFIG.MIN_EDGE_BY_VARIANCE[varianceTier];
  if (edge < minEdge) {
    return { passes: false, reason: `Edge ${edge.toFixed(1)} below minimum ${minEdge} for ${varianceTier} variance`, tier: 'LOW_EDGE' };
  }
  
  // 7. Check maximum variance for edge quality
  const maxVariance = THREES_FILTER_CONFIG.MAX_VARIANCE_BY_EDGE[edgeQuality];
  if (stdDev > maxVariance) {
    return { passes: false, reason: `Variance ${stdDev.toFixed(2)} exceeds max ${maxVariance} for ${edgeQuality} edge`, tier: 'HIGH_VARIANCE' };
  }
  
  // 8. HOT PLAYER BONUS (informational, still passes)
  if (l5Avg > l10Avg * THREES_FILTER_CONFIG.HOT_STREAK_MULTIPLIER) {
    return { passes: true, reason: `HOT streak: L5 (${l5Avg.toFixed(1)}) > L10*1.15`, tier: 'HOT' };
  }
  
  // 9. PASSED - classify tier
  if (varianceTier === 'LOW') {
    return { passes: true, reason: `LOW variance (100% historical)`, tier: 'ELITE' };
  }
  if (edgeQuality === 'FAVORABLE' && l10Min >= 2) {
    return { passes: true, reason: `Strong floor + favorable edge (87.5% historical)`, tier: 'PREMIUM' };
  }
  
  return { passes: true, reason: `Standard pick`, tier: 'STANDARD' };
}

// ============ ARCHETYPE DEFINITIONS (v3.0) ============
const ARCHETYPE_GROUPS = {
  BIGS: ['ELITE_REBOUNDER', 'GLASS_CLEANER', 'STRETCH_BIG', 'RIM_PROTECTOR'],
  GUARDS: ['PLAYMAKER', 'COMBO_GUARD', 'SCORING_GUARD', 'PURE_SHOOTER'],
  WINGS: ['TWO_WAY_WING', 'SCORING_WING'],
  STARS: ['ELITE_REBOUNDER', 'PLAYMAKER', 'PURE_SHOOTER', 'COMBO_GUARD', 'SCORING_WING'],
  ROLE_PLAYERS: ['TWO_WAY_WING', 'STRETCH_BIG', 'RIM_PROTECTOR', 'ROLE_PLAYER', 'UNKNOWN']
};

const ARCHETYPE_PROP_ALIGNMENT: Record<string, { primary: string[], blocked: string[] }> = {
  'ELITE_REBOUNDER': { primary: ['rebounds', 'blocks'], blocked: ['threes'] },
  'GLASS_CLEANER': { primary: ['rebounds'], blocked: ['points', 'threes', 'assists'] },
  'PURE_SHOOTER': { primary: ['points', 'threes'], blocked: ['rebounds', 'blocks'] },
  'PLAYMAKER': { primary: ['assists'], blocked: ['rebounds', 'blocks'] },
  'COMBO_GUARD': { primary: ['points', 'assists'], blocked: ['rebounds', 'blocks'] },
  'TWO_WAY_WING': { primary: ['points', 'rebounds'], blocked: ['blocks'] },
  'STRETCH_BIG': { primary: ['points', 'rebounds', 'threes'], blocked: [] },
  'RIM_PROTECTOR': { primary: ['blocks', 'rebounds'], blocked: ['points', 'threes'] },
  'SCORING_WING': { primary: ['points'], blocked: ['assists', 'blocks'] },
  'SCORING_GUARD': { primary: ['points', 'assists'], blocked: ['rebounds', 'blocks'] },
  'ROLE_PLAYER': { primary: [], blocked: ['points'] },
  'UNKNOWN': { primary: [], blocked: [] }
};

const BOUNCE_BACK_CONFIG = {
  minSeasonVsL10Gap: 1.5,
  minStdDevGap: 0.5,
  maxLineVsSeasonGap: 2.0,
  minL10HitRateForOVER: 0.20,
  maxL10HitRateForOVER: 0.50,
};

// Global caches for projection data
let matchupHistoryCache: Map<string, MatchupHistory> = new Map();
let gameEnvironmentCache: Map<string, GameEnvironment> = new Map();

// v8.0: Player behavior profiles cache
interface PlayerBehaviorProfile {
  player_name: string;
  three_pt_peak_quarters: { q1: number; q2: number; q3: number; q4: number } | null;
  best_matchups: { opponent: string; stat: string; avg_vs: number; games: number }[] | null;
  worst_matchups: { opponent: string; stat: string; avg_vs: number; games: number }[] | null;
  fatigue_tendency: string | null;
  blowout_minutes_reduction: number | null;
  film_sample_count: number | null;
  profile_confidence: number | null;
}
let playerProfileCache: Map<string, PlayerBehaviorProfile> = new Map();

const CATEGORIES: Record<string, CategoryConfig> = {
  // ============ NEW PROVEN WINNERS (v2.0) ============
  // Based on analysis of 391 settled picks
  
  ASSIST_ANCHOR: {
    name: 'Assist Anchor',
    propType: 'assists',
    avgRange: { min: 3, max: 5.5 },  // Guards averaging 3-5.5 assists
    lines: [3.5, 4.5, 5.5],
    side: 'under',
    minHitRate: 0.60  // 65% historical win rate on assists under 3.5-5
  },
  
  HIGH_REB_UNDER: {
    name: 'High Reb Under',
    propType: 'rebounds',
    avgRange: { min: 8, max: 14 },  // Big men averaging 8-14 rebounds
    lines: [9.5, 10.5, 11.5, 12.5],
    side: 'under',
    minHitRate: 0.55  // 62% historical win rate on rebounds under 10+
  },
  
  MID_SCORER_UNDER: {
    name: 'Mid Scorer Under',
    propType: 'points',
    avgRange: { min: 12, max: 22 },  // Players averaging 12-22 points
    lines: [14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5],
    side: 'under',
    minHitRate: 0.55,
    // v8.0: RE-ENABLED for contrarian fade strategy (55% OVER hit rate when faded)
    fadeOnly: true  // Picks generated here are meant to be faded (bet OVER)
  },
  
  // ============ OPTIMAL WINNERS (v3.0) - ARCHETYPE ENFORCED ============
  // Based on user's winning bet slip patterns with STRICT archetype validation
  
  ELITE_REB_OVER: {
    name: 'Elite Rebounder OVER',
    propType: 'rebounds',
    avgRange: { min: 9, max: 20 },  // Elite centers (Gobert, Nurkic, Wemby)
    lines: [9.5, 10.5, 11.5, 12.5],
    side: 'over',
    minHitRate: 0.55,  // ~65% win rate on elite big boards
    supportsBounceBack: true,
    // v3.0: ONLY elite rebounders/glass cleaners allowed
    requiredArchetypes: ['ELITE_REBOUNDER', 'GLASS_CLEANER', 'RIM_PROTECTOR'],
    blockedArchetypes: ['PLAYMAKER', 'COMBO_GUARD', 'PURE_SHOOTER', 'SCORING_GUARD']
  },
  
  ROLE_PLAYER_REB: {
    name: 'Role Player Reb OVER',
    propType: 'rebounds',
    avgRange: { min: 3, max: 6 },  // Finney-Smith, Kyshawn George type
    lines: [2.5, 3.5, 4.5],
    side: 'over',
    minHitRate: 0.60,  // ~60% win rate on low line reb overs
    // v3.0: Block stars and guards - only wings/bigs allowed
    requiredArchetypes: ['TWO_WAY_WING', 'STRETCH_BIG', 'SCORING_WING', 'ROLE_PLAYER', 'UNKNOWN'],
    blockedArchetypes: ['ELITE_REBOUNDER', 'PLAYMAKER', 'COMBO_GUARD', 'PURE_SHOOTER', 'SCORING_GUARD']
  },
  
  BIG_ASSIST_OVER: {
    name: 'Big Man Assists OVER',
    propType: 'assists',
    avgRange: { min: 2, max: 6 },  // Passing bigs (Vucevic, Sabonis, Jokic, Sengun)
    lines: [2.5, 3.5, 4.5],
    side: 'over',
    minHitRate: 0.60,  // ~70% win rate on low assist lines for bigs
    // v3.0: ONLY bigs allowed - no guards/wings
    requiredArchetypes: ['ELITE_REBOUNDER', 'GLASS_CLEANER', 'STRETCH_BIG', 'RIM_PROTECTOR'],
    blockedArchetypes: ['PLAYMAKER', 'COMBO_GUARD', 'PURE_SHOOTER', 'SCORING_GUARD', 'SCORING_WING']
  },
  
  LOW_SCORER_UNDER: {
    name: 'Low Scorer UNDER',
    propType: 'points',
    avgRange: { min: 5, max: 12 },  // Lu Dort, Reed Sheppard type
    lines: [7.5, 8.5, 9.5, 10.5, 11.5, 12.5],
    side: 'under',
    minHitRate: 0.55,  // ~65% win rate on role player pts under
    // v3.0: Block star scorers
    blockedArchetypes: ['PURE_SHOOTER', 'COMBO_GUARD', 'SCORING_GUARD', 'SCORING_WING']
  },
  
  STAR_FLOOR_OVER: {
    name: 'Star Floor OVER',
    propType: 'points',
    avgRange: { min: 20, max: 40 },  // Stars like Ja Morant, Booker
    lines: [14.5, 15.5, 16.5, 17.5, 18.5, 19.5],  // Well below their avg
    side: 'over',
    minHitRate: 0.65,  // ~75% win rate on star floor plays
    // v3.0: ONLY star scorers
    requiredArchetypes: ['PURE_SHOOTER', 'COMBO_GUARD', 'PLAYMAKER', 'SCORING_GUARD', 'SCORING_WING']
  },
  
  // ============ LEGACY CATEGORIES ============
  BIG_REBOUNDER: {
    name: 'Big Rebounder',
    propType: 'rebounds',
    avgRange: { min: 9, max: 20 },
    lineRange: { min: 9, max: 20 },
    lines: [6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5],
    side: 'over',
    minHitRate: 0.7,
    supportsBounceBack: true,
    requiredArchetypes: ['ELITE_REBOUNDER', 'GLASS_CLEANER', 'STRETCH_BIG', 'RIM_PROTECTOR']
  },
  LOW_LINE_REBOUNDER: {
    name: 'Low Line Rebounder',
    propType: 'rebounds',
    avgRange: { min: 4, max: 6 },
    lines: [3.5, 4.5, 5.5],
    side: 'over',
    minHitRate: 0.7
  },
  NON_SCORING_SHOOTER: {
    name: 'Non-Scoring Shooter',
    propType: 'points',
    avgRange: { min: 8, max: 14 },
    lines: [10.5, 11.5, 12.5, 13.5, 14.5],
    side: 'under',
    minHitRate: 0.7,
    // v7.0: Block star scorers and combo guards from UNDER picks
    blockedArchetypes: ['PURE_SHOOTER', 'COMBO_GUARD', 'SCORING_GUARD', 'PLAYMAKER']
  },
  VOLUME_SCORER: {
    name: 'Volume Scorer',
    propType: 'points',
    avgRange: { min: 15, max: 40 },
    lineRange: { min: 18, max: 40 },
    lines: [14.5, 16.5, 18.5, 20.5, 22.5, 24.5, 26.5, 28.5, 30.5],
    side: 'over',
    minHitRate: 0.7,
    supportsBounceBack: true
  },
  HIGH_ASSIST: {
    name: 'Playmaker',
    propType: 'assists',
    avgRange: { min: 4, max: 15 },
    lines: [3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5],
    side: 'over',
    minHitRate: 0.7
  },
  THREE_POINT_SHOOTER: {
    name: '3-Point Shooter',
    propType: 'threes',
    avgRange: { min: 1.5, max: 6 },
    lines: [0.5, 1.5, 2.5, 3.5, 4.5],
    side: 'over',
    minHitRate: 0.7
  },
  HIGH_ASSIST_UNDER: {
    name: 'Assist Under',
    propType: 'assists',
    avgRange: { min: 4, max: 15 },
    lines: [3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5],
    side: 'under',
    minHitRate: 0.7
  },
  LOW_LINE_REBOUNDER_UNDER: {
    name: 'Low Line Reb Under',
    propType: 'rebounds',
    avgRange: { min: 4, max: 6 },
    lines: [3.5, 4.5, 5.5],
    side: 'under',
    minHitRate: 0.7
  },

  // ============ MLB CATEGORIES ============
  MLB_PITCHER_K_OVER: {
    name: 'MLB Pitcher K OVER',
    propType: 'pitcher_strikeouts',
    avgRange: { min: 5, max: 12 },
    lines: [4.5, 5.5, 6.5, 7.5, 8.5],
    side: 'over',
    minHitRate: 0.55
  },
  MLB_PITCHER_K_UNDER: {
    name: 'MLB Pitcher K UNDER',
    propType: 'pitcher_strikeouts',
    avgRange: { min: 5, max: 12 },
    lines: [4.5, 5.5, 6.5, 7.5, 8.5],
    side: 'under',
    minHitRate: 0.55
  },
  MLB_HITTER_FANTASY_OVER: {
    name: 'MLB Hitter Fantasy OVER',
    propType: 'hitter_fantasy_score',
    avgRange: { min: 3, max: 20 },
    lines: [5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5],
    side: 'over',
    minHitRate: 0.55
  },
  MLB_HITTER_FANTASY_UNDER: {
    name: 'MLB Hitter Fantasy UNDER',
    propType: 'hitter_fantasy_score',
    avgRange: { min: 3, max: 20 },
    lines: [5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5],
    side: 'under',
    minHitRate: 0.55
  },
  MLB_HITS_OVER: {
    name: 'MLB Hits OVER',
    propType: 'hits',
    avgRange: { min: 0.8, max: 2.5 },
    lines: [0.5, 1.5, 2.5],
    side: 'over',
    minHitRate: 0.55
  },
  MLB_TOTAL_BASES_OVER: {
    name: 'MLB Total Bases OVER',
    propType: 'total_bases',
    avgRange: { min: 1.5, max: 4.0 },
    lines: [1.5, 2.5, 3.5],
    side: 'over',
    minHitRate: 0.55
  },
  MLB_RUNS_OVER: {
    name: 'MLB Runs OVER',
    propType: 'runs',
    avgRange: { min: 0.5, max: 1.5 },
    lines: [0.5, 1.5],
    side: 'over',
    minHitRate: 0.55
  },
};

// Runtime archetype lookup
let archetypeMap: Record<string, string> = {};

async function loadArchetypes(supabase: any): Promise<void> {
  const { data } = await supabase
    .from('player_archetypes')
    .select('player_name, primary_archetype');
  
  archetypeMap = {};
  for (const a of (data || [])) {
    archetypeMap[a.player_name?.toLowerCase().trim() || ''] = a.primary_archetype;
  }
  console.log(`[Category Analyzer] Loaded ${Object.keys(archetypeMap).length} player archetypes`);
}

function getPlayerArchetype(playerName: string): string {
  return archetypeMap[playerName?.toLowerCase().trim() || ''] || 'UNKNOWN';
}

// v3.0: Check if player passes archetype requirements for a category
function passesArchetypeValidation(playerName: string, config: CategoryConfig): { passes: boolean; reason: string } {
  const archetype = getPlayerArchetype(playerName);
  
  // Check blocked archetypes first
  if (config.blockedArchetypes && config.blockedArchetypes.includes(archetype)) {
    return { passes: false, reason: `Archetype ${archetype} is blocked for this category` };
  }
  
  // If required archetypes specified, player must match one
  if (config.requiredArchetypes && config.requiredArchetypes.length > 0) {
    if (!config.requiredArchetypes.includes(archetype)) {
      // Allow UNKNOWN archetype if no required match (fallback for missing data)
      if (archetype === 'UNKNOWN') {
        return { passes: true, reason: `Archetype unknown - allowing with caution` };
      }
      return { passes: false, reason: `Archetype ${archetype} not in required list: ${config.requiredArchetypes.join(', ')}` };
    }
  }
  
  return { passes: true, reason: `Archetype ${archetype} valid for category` };
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - avg, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function calculateHitRate(values: number[], line: number, side: 'over' | 'under'): number {
  if (values.length === 0) return 0;
  const hits = values.filter(v => side === 'over' ? v > line : v < line).length;
  return hits / values.length;
}

function getStatValue(log: GameLog, propType: string): number {
  switch (propType) {
    case 'points': return log.points || 0;
    case 'rebounds': return log.rebounds || 0;
    case 'assists': return log.assists || 0;
    case 'steals': return log.steals || 0;
    case 'blocks': return log.blocks || 0;
    case 'threes': return log.threes_made || 0;
    default: return 0;
  }
}

// ============ MLB INTERFACES & STAT EXTRACTION ============
interface MLBGameLog {
  player_name: string;
  game_date: string;
  hits: number;
  walks: number;
  runs: number;
  rbis: number;
  total_bases: number;
  stolen_bases: number;
  home_runs: number;
  strikeouts: number;
  pitcher_strikeouts: number | null;
  innings_pitched: number | null;
  opponent?: string;
}

const MLB_CATEGORIES = new Set([
  'MLB_PITCHER_K_OVER', 'MLB_PITCHER_K_UNDER',
  'MLB_HITTER_FANTASY_OVER', 'MLB_HITTER_FANTASY_UNDER',
  'MLB_HITS_OVER', 'MLB_TOTAL_BASES_OVER', 'MLB_RUNS_OVER',
]);

function getMLBStatValue(log: MLBGameLog, propType: string): number {
  switch (propType) {
    case 'pitcher_strikeouts': return log.pitcher_strikeouts || 0;
    case 'hits': return log.hits || 0;
    case 'total_bases': return log.total_bases || 0;
    case 'runs': return log.runs || 0;
    case 'hitter_fantasy_score':
      return (log.hits || 0) + (log.walks || 0) + (log.runs || 0) + 
             (log.rbis || 0) + (log.total_bases || 0) + (log.stolen_bases || 0);
    default: return 0;
  }
}

// ============ TRUE PROJECTION CALCULATION (v8.0 - PROFILE INTEGRATION) ============
// v8.0: Added player behavior profile adjustments
// v5.0: Added variance shrinkage, regression to mean, stricter UNDER criteria
function calculateTrueProjection(
  playerName: string,
  propType: string,
  statValues: number[],
  opponent: string | null,
  seasonAvg?: number,
  l10StdDev?: number
): { projectedValue: number; matchupAdj: number; paceAdj: number; profileAdj: number; projectionSource: string; varianceRatio: number; shrinkageFactor: number; profileFlags: string[] } {
  // 1. BASE: L10 Median (more stable than average for betting)
  const l10Median = calculateMedian(statValues);
  const l10Avg = statValues.length > 0 ? statValues.reduce((a, b) => a + b, 0) / statValues.length : l10Median;
  
  // v5.0: Calculate variance ratio for shrinkage
  const stdDev = l10StdDev ?? calculateStdDev(statValues);
  const varianceRatio = l10Avg > 0 ? stdDev / l10Avg : 0.5;
  
  // 2. MATCHUP ADJUSTMENT: Check H2H history vs opponent
  let matchupAdj = 0;
  let projectionSource = 'L10_MEDIAN';
  
  if (opponent) {
    const normalizedOpponent = normalizeOpponentName(opponent);
    const matchupPropType = propType.startsWith('player_') ? propType : `player_${propType}`;
    const matchupKey = `${playerName.toLowerCase().trim()}_${matchupPropType}_${normalizedOpponent.toLowerCase().trim()}`;
    const matchup = matchupHistoryCache.get(matchupKey);
    
    console.log(`[Projection] Matchup lookup: key="${matchupKey}", found=${!!matchup}, opponent="${opponent}" -> "${normalizedOpponent}"`);
    
    if (matchup && matchup.games_played >= 2) {
      const h2hAvg = matchup.avg_stat;
      matchupAdj = (h2hAvg - l10Median) * PROJECTION_WEIGHTS.MATCHUP_H2H;
      projectionSource = matchup.games_played >= 5 ? 'L10+H2H_STRONG' : 'L10+H2H';
      console.log(`[Projection] H2H found: ${matchup.games_played} games, avg=${h2hAvg.toFixed(1)}, adj=${matchupAdj.toFixed(2)}`);
    }
  }
  
  // 3. PACE ADJUSTMENT: Check game environment
  let paceAdj = 0;
  if (opponent) {
    const normalizedOpponent = normalizeOpponentName(opponent);
    for (const [_, env] of gameEnvironmentCache) {
      const homeMatch = env.home_team?.toLowerCase().includes(normalizedOpponent.toLowerCase()) ||
                       env.away_team?.toLowerCase().includes(normalizedOpponent.toLowerCase());
      if (homeMatch && env.pace_rating) {
        const paceMultiplier = getPaceMultiplier(env.pace_rating);
        paceAdj = paceMultiplier * l10Median * PROJECTION_WEIGHTS.PACE_FACTOR;
        
        if (paceMultiplier < 0) {
          projectionSource += '+SLOW';
        } else if (paceMultiplier > 0) {
          projectionSource += '+FAST';
        }
        console.log(`[Projection] Pace found: ${env.pace_rating}, multiplier=${paceMultiplier.toFixed(3)}, adj=${paceAdj.toFixed(2)}`);
        break;
      }
    }
  }
  
  // 4. v8.0: PROFILE ADJUSTMENT - Apply player behavior profile insights
  let profileAdj = 0;
  const profileFlags: string[] = [];
  const profile = playerProfileCache.get(playerName.toLowerCase().trim());
  
  if (profile) {
    console.log(`[Projection] v8.0 Profile found: ${playerName}, film_samples=${profile.film_sample_count || 0}, confidence=${profile.profile_confidence || 0}`);
    
    // A. 3PT Peak Quarter boost (for threes props)
    if (propType === 'threes' && profile.three_pt_peak_quarters) {
      const peakQ = Object.entries(profile.three_pt_peak_quarters)
        .reduce((max, [q, pct]) => (pct as number) > max.pct ? { q, pct: pct as number } : max, { q: 'q1', pct: 0 });
      if (peakQ.pct > 30) {
        profileAdj += 0.4;
        profileFlags.push(`PEAK_Q${peakQ.q.replace('q', '')}`);
        console.log(`[Projection] 3PT Peak quarter boost: Q${peakQ.q.replace('q', '')} at ${peakQ.pct}%, +0.4`);
      }
    }
    
    // B. Best/Worst matchup from profile (supplements H2H table data)
    if (opponent && profile.best_matchups) {
      const normalizedOpp = normalizeOpponentName(opponent).toLowerCase();
      const bestMatch = profile.best_matchups.find(m => 
        m.opponent?.toLowerCase().includes(normalizedOpp) || normalizedOpp.includes(m.opponent?.toLowerCase() || '')
      );
      if (bestMatch) {
        profileAdj += 0.5;
        profileFlags.push('BEST_MATCHUP');
        console.log(`[Projection] Profile best matchup: ${bestMatch.opponent}, +0.5`);
      }
    }
    
    if (opponent && profile.worst_matchups) {
      const normalizedOpp = normalizeOpponentName(opponent).toLowerCase();
      const worstMatch = profile.worst_matchups.find(m => 
        m.opponent?.toLowerCase().includes(normalizedOpp) || normalizedOpp.includes(m.opponent?.toLowerCase() || '')
      );
      if (worstMatch) {
        profileAdj -= 0.5;
        profileFlags.push('WORST_MATCHUP');
        console.log(`[Projection] Profile worst matchup: ${worstMatch.opponent}, -0.5`);
      }
    }
    
    // C. Fatigue tendency (from film analysis)
    if (profile.fatigue_tendency?.toLowerCase().includes('fatigue')) {
      profileAdj -= 0.3;
      profileFlags.push('FATIGUE_RISK');
      console.log(`[Projection] Fatigue tendency detected, -0.3`);
    }
    
    // D. Blowout minutes reduction warning (informational flag)
    if (profile.blowout_minutes_reduction && profile.blowout_minutes_reduction > 5) {
      profileFlags.push('BLOWOUT_RISK');
      console.log(`[Projection] Blowout risk: ${profile.blowout_minutes_reduction} min reduction typical`);
    }
    
    // E. Film-verified player boost (high confidence from film samples)
    if ((profile.film_sample_count || 0) >= 3) {
      profileFlags.push('FILM_VERIFIED');
      projectionSource += '+FILM';
    }
    
    if (profileAdj !== 0) {
      projectionSource += '+PROFILE';
    }
  }
  
  // 5. v5.0: VARIANCE SHRINKAGE - High variance = regress more to season mean
  const shrinkageFactor = Math.max(0.70, Math.min(0.95, 1 - varianceRatio * 0.4));
  
  // 6. v5.0: REGRESSION TO MEAN - Blend with season average
  let rawProjection = l10Median + matchupAdj + paceAdj + profileAdj;
  
  if (seasonAvg && seasonAvg > 0) {
    rawProjection = (rawProjection * shrinkageFactor) + (seasonAvg * (1 - shrinkageFactor));
    projectionSource += '+REGRESSED';
    console.log(`[Projection] v5.0 Shrinkage: factor=${shrinkageFactor.toFixed(2)}, seasonAvg=${seasonAvg.toFixed(1)}, before=${(l10Median + matchupAdj + paceAdj + profileAdj).toFixed(1)}, after=${rawProjection.toFixed(1)}`);
  }
  
  const projectedValue = Math.round(rawProjection * 2) / 2;
  
  return {
    projectedValue,
    matchupAdj: Math.round(matchupAdj * 10) / 10,
    paceAdj: Math.round(paceAdj * 10) / 10,
    profileAdj: Math.round(profileAdj * 10) / 10,
    projectionSource,
    varianceRatio: Math.round(varianceRatio * 100) / 100,
    shrinkageFactor: Math.round(shrinkageFactor * 100) / 100,
    profileFlags,
  };
}

// Load matchup history into cache (with pagination to get all records)
async function loadMatchupHistory(supabase: any): Promise<void> {
  matchupHistoryCache.clear();
  let page = 0;
  const pageSize = 1000;
  let totalLoaded = 0;
  
  while (true) {
    const { data, error } = await supabase
      .from('matchup_history')
      .select('player_name, opponent, prop_type, games_played, avg_stat, max_stat, min_stat')
      .range(page * pageSize, (page + 1) * pageSize - 1);
    
    if (error) {
      console.warn('[Category Analyzer] Matchup history load error:', error.message);
      break;
    }
    
    if (!data || data.length === 0) break;
    
    for (const m of data) {
      // v4.1: Key format: playername_proptype_opponent (keep prop_type as-is with player_ prefix)
      const propType = m.prop_type || '';
      const key = `${m.player_name?.toLowerCase().trim()}_${propType}_${m.opponent?.toLowerCase().trim()}`;
      matchupHistoryCache.set(key, m);
    }
    
    totalLoaded += data.length;
    if (data.length < pageSize) break;
    page++;
  }
  
  console.log(`[Category Analyzer] Loaded ${matchupHistoryCache.size} matchup history records (${totalLoaded} total fetched)`);
  // v4.1: Log sample keys for debugging
  const sampleKeys = Array.from(matchupHistoryCache.keys()).slice(0, 3);
  console.log(`[Category Analyzer] Sample matchup keys: ${sampleKeys.join(', ')}`);
}

// Load game environment into cache
async function loadGameEnvironment(supabase: any): Promise<void> {
  const today = getEasternDate();
  const { data, error } = await supabase
    .from('game_environment')
    .select('game_id, home_team, away_team, vegas_total, vegas_spread, pace_rating, game_script')
    .gte('game_date', today);
  
  if (error) {
    console.warn('[Category Analyzer] Game environment load error:', error.message);
    return;
  }
  
  gameEnvironmentCache.clear();
  for (const g of (data || [])) {
    gameEnvironmentCache.set(g.game_id, g);
  }
  console.log(`[Category Analyzer] Loaded ${gameEnvironmentCache.size} game environment records`);
  // v4.1: Log sample for debugging
  if (data && data.length > 0) {
    const sample = data[0];
    console.log(`[Category Analyzer] Sample game: ${sample.away_team} @ ${sample.home_team}, pace_rating=${sample.pace_rating}`);
  }
}

// v8.0: Load player behavior profiles into cache
async function loadPlayerProfiles(supabase: any): Promise<void> {
  const { data, error } = await supabase
    .from('player_behavior_profiles')
    .select('player_name, three_pt_peak_quarters, best_matchups, worst_matchups, fatigue_tendency, blowout_minutes_reduction, film_sample_count, profile_confidence')
    .gte('games_analyzed', 5); // Only profiles with enough data
  
  if (error) {
    console.warn('[Category Analyzer] Player profiles load error:', error.message);
    return;
  }
  
  playerProfileCache.clear();
  for (const p of (data || [])) {
    playerProfileCache.set(p.player_name?.toLowerCase().trim(), p);
  }
  console.log(`[Category Analyzer] v8.0 Loaded ${playerProfileCache.size} player behavior profiles`);
  
  // Log sample profile for debugging
  if (data && data.length > 0) {
    const sample = data[0];
    console.log(`[Category Analyzer] Sample profile: ${sample.player_name}, film_samples=${sample.film_sample_count || 0}, confidence=${sample.profile_confidence || 0}`);
  }
}

// v9.0: Side override map - loaded from bot_category_weights to support flipped categories
let sideOverrideMap: Map<string, 'over' | 'under'> = new Map();

async function loadSideOverrides(supabase: any): Promise<Map<string, 'over' | 'under'>> {
  sideOverrideMap.clear();
  const { data, error } = await supabase
    .from('bot_category_weights')
    .select('category, side, weight, is_blocked')
    .order('weight', { ascending: false });
  
  if (error || !data) return sideOverrideMap;
  
  // For each category, find the active (non-blocked, highest weight) side
  const categoryBestSide = new Map<string, { side: string; weight: number }>();
  for (const w of data) {
    if (w.is_blocked || (w.weight || 0) <= 0) continue;
    const existing = categoryBestSide.get(w.category);
    if (!existing || (w.weight || 0) > existing.weight) {
      categoryBestSide.set(w.category, { side: w.side, weight: w.weight || 0 });
    }
  }
  
  for (const [cat, best] of categoryBestSide) {
    sideOverrideMap.set(cat, best.side as 'over' | 'under');
  }
  
  console.log(`[Category Analyzer] v9.0 Loaded ${sideOverrideMap.size} side overrides`);
  for (const [cat, side] of sideOverrideMap) {
    const config = CATEGORIES[cat];
    if (config && config.side !== side) {
      console.log(`[Category Analyzer] ↔️ FLIPPED: ${cat} ${config.side} -> ${side}`);
    }
  }
  
  return sideOverrideMap;
}

// v10.0: Auto-flip detection — check historical outcomes and auto-create flipped weight entries
// When a category's "over" hit rate < 50% with 30+ samples, auto-promote "under" side
async function autoFlipUnderperformingCategories(supabase: any): Promise<string[]> {
  const flipped: string[] = [];
  
  // Query settled outcomes grouped by category + side
  const { data: outcomes, error } = await supabase
    .from('category_sweet_spots')
    .select('category, recommended_side, outcome')
    .not('outcome', 'is', null)
    .not('settled_at', 'is', null);
  
  if (error || !outcomes) {
    console.warn('[Category Analyzer] v10.0 Auto-flip: could not load outcomes');
    return flipped;
  }
  
  // Aggregate hit rates by category + side (only graded outcomes: hit/miss)
  const stats = new Map<string, { hits: number; graded: number }>();
  for (const row of outcomes) {
    // Only count graded outcomes — exclude no_data, push, void
    if (row.outcome !== 'hit' && row.outcome !== 'miss') continue;
    
    const key = `${row.category}__${row.recommended_side || 'over'}`;
    let s = stats.get(key);
    if (!s) { s = { hits: 0, graded: 0 }; stats.set(key, s); }
    s.graded++;
    if (row.outcome === 'hit') s.hits++;
  }
  
  // Find categories where "over" is underperforming (< 50% hit rate, 30+ graded samples)
  for (const [key, s] of stats) {
    const [category, side] = key.split('__');
    if (side !== 'over' || s.graded < 30) continue;
    
    const hitRate = s.hits / s.graded;
    if (hitRate >= 0.50) continue;
    
    // Check if under-side weight already exists and is promoted
    const underKey = `${category}__under`;
    const underStats = stats.get(underKey);
    
    console.log(`[Category Analyzer] v10.0 AUTO-FLIP CANDIDATE: ${category} over=${(hitRate * 100).toFixed(1)}% (${s.graded} graded picks) — promoting under side`);
    
    // Auto-create/update weight entries — SPORT-AWARE (v10.1)
    // Only update entries that DON'T have sport-specific overrides
    // Check if sport-specific entries exist first
    const { data: sportSpecific } = await supabase.from('bot_category_weights')
      .select('id, sport')
      .eq('category', category)
      .eq('side', 'over')
      .not('sport', 'is', null)
      .not('sport', 'eq', 'team_all');
    
    if (sportSpecific && sportSpecific.length > 0) {
      console.log(`[Category Analyzer] v10.1 SKIP auto-flip for ${category}: has ${sportSpecific.length} sport-specific overrides — manage manually`);
      flipped.push(`${category}: over ${(hitRate * 100).toFixed(1)}% — SKIPPED (sport-specific overrides exist)`);
      continue;
    }
    
    // Deprioritize over side (only global/team_all entries)
    await supabase.from('bot_category_weights')
      .update({ weight: 0.50, updated_at: new Date().toISOString() })
      .eq('category', category)
      .eq('side', 'over')
      .or('sport.is.null,sport.eq.team_all');
    
    // Promote under side (upsert)
    const underWeight = hitRate < 0.40 ? 1.00 : 1.10;
    const { data: existing } = await supabase.from('bot_category_weights')
      .select('id').eq('category', category).eq('side', 'under')
      .or('sport.is.null,sport.eq.team_all')
      .limit(1);
    
    if (existing && existing.length > 0) {
      await supabase.from('bot_category_weights')
        .update({ weight: underWeight, is_blocked: false, updated_at: new Date().toISOString() })
        .eq('id', existing[0].id);
    } else {
      await supabase.from('bot_category_weights').insert({
        category, side: 'under', sport: 'basketball_nba',
        weight: underWeight, current_hit_rate: 55, total_picks: 0, total_hits: 0,
        is_blocked: false, current_streak: 0, best_streak: 0, worst_streak: 0,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
    }
    
    // Update the runtime override map
    sideOverrideMap.set(category, 'under');
    flipped.push(`${category}: over ${(hitRate * 100).toFixed(1)}% → flipped to under (weight ${underWeight})`);
  }
  
  if (flipped.length > 0) {
    console.log(`[Category Analyzer] v10.0 Auto-flipped ${flipped.length} categories: ${flipped.join('; ')}`);
  }
  
  return flipped;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { category, minHitRate = 0.7, forceRefresh = false } = await req.json().catch(() => ({}));

    console.log(`[Category Analyzer v4.0] Starting analysis with TRUE PROJECTIONS for category: ${category || 'ALL'}`);

    // v8.0: Load all projection data sources including player profiles
    // v9.0: Load category weight overrides for flipped sides
    const [, , , , sideOverrides] = await Promise.all([
      loadArchetypes(supabase),
      loadMatchupHistory(supabase),
      loadGameEnvironment(supabase),
      loadPlayerProfiles(supabase),
      loadSideOverrides(supabase)
    ]);

    // v10.0: Auto-flip underperforming categories before analysis
    const autoFlipped = await autoFlipUnderperformingCategories(supabase);

    // Get today's date for analysis
    const today = getEasternDate();

    // Check if we already have fresh data
    if (!forceRefresh) {
      const { data: existingData } = await supabase
        .from('category_sweet_spots')
        .select('*')
        .eq('analysis_date', today)
        .eq('is_active', true);

      if (existingData && existingData.length > 0) {
        console.log(`[Category Analyzer] Found ${existingData.length} existing sweet spots for today`);
        
        if (category) {
          const filtered = existingData.filter((d: any) => d.category === category);
          return new Response(JSON.stringify({
            success: true,
            data: filtered,
            cached: true,
            count: filtered.length
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        
        return new Response(JSON.stringify({
          success: true,
          data: existingData,
          cached: true,
          count: existingData.length
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Fetch all game logs from last 30 days - BOTH NBA and NCAAB
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    let allGameLogs: GameLog[] = [];
    
    // Fetch NBA logs with pagination
    let page = 0;
    const pageSize = 1000;
    while (true) {
      const { data: gameLogs, error: logsError } = await supabase
        .from('nba_player_game_logs')
        .select('player_name, game_date, points, rebounds, assists, steals, blocks, threes_made, minutes_played')
        .gte('game_date', thirtyDaysAgoStr)
        .order('game_date', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (logsError) {
        console.error('[Category Analyzer] Error fetching NBA game logs:', logsError);
        throw new Error(`Failed to fetch NBA game logs: ${logsError.message}`);
      }
      if (!gameLogs || gameLogs.length === 0) break;
      allGameLogs = allGameLogs.concat(gameLogs as GameLog[]);
      if (gameLogs.length < pageSize) break;
      page++;
    }
    console.log(`[Category Analyzer] NBA game logs fetched: ${allGameLogs.length}`);

    // Fetch NCAAB logs with pagination
    let ncaabPage = 0;
    let ncaabCount = 0;
    while (true) {
      const { data: ncaabLogs, error: ncaabError } = await supabase
        .from('ncaab_player_game_logs')
        .select('player_name, game_date, points, rebounds, assists, steals, blocks, threes_made, minutes_played')
        .gte('game_date', thirtyDaysAgoStr)
        .order('game_date', { ascending: false })
        .range(ncaabPage * pageSize, (ncaabPage + 1) * pageSize - 1);

      if (ncaabError) {
        console.warn('[Category Analyzer] NCAAB game logs warning:', ncaabError.message);
        break;
      }
      if (!ncaabLogs || ncaabLogs.length === 0) break;
      allGameLogs = allGameLogs.concat(ncaabLogs as GameLog[]);
      ncaabCount += ncaabLogs.length;
      if (ncaabLogs.length < pageSize) break;
      ncaabPage++;
    }
    console.log(`[Category Analyzer] NCAAB game logs fetched: ${ncaabCount}`);
    console.log(`[Category Analyzer] Total game logs fetched: ${allGameLogs.length}`);

    // ============ FETCH MLB GAME LOGS ============
    // Use full season data (no date filter) — MLB uses historical backfill as baseline
    let allMLBLogs: MLBGameLog[] = [];
    let mlbPage = 0;
    while (true) {
      const { data: mlbLogs, error: mlbError } = await supabase
        .from('mlb_player_game_logs')
        .select('player_name, game_date, hits, walks, runs, rbis, total_bases, stolen_bases, home_runs, strikeouts, pitcher_strikeouts, innings_pitched, opponent')
        .order('game_date', { ascending: false })
        .range(mlbPage * pageSize, (mlbPage + 1) * pageSize - 1);

      if (mlbError) {
        console.warn('[Category Analyzer] MLB game logs warning:', mlbError.message);
        break;
      }
      if (!mlbLogs || mlbLogs.length === 0) break;
      allMLBLogs = allMLBLogs.concat(mlbLogs as MLBGameLog[]);
      if (mlbLogs.length < pageSize) break;
      mlbPage++;
    }
    console.log(`[Category Analyzer] MLB game logs fetched: ${allMLBLogs.length}`);

    // Group MLB logs by player
    const mlbPlayerLogs: Record<string, MLBGameLog[]> = {};
    for (const log of allMLBLogs) {
      const name = log.player_name;
      if (!mlbPlayerLogs[name]) mlbPlayerLogs[name] = [];
      mlbPlayerLogs[name].push(log);
    }
    console.log(`[Category Analyzer] Grouped MLB logs for ${Object.keys(mlbPlayerLogs).length} players`);

    if (allGameLogs.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No game logs found',
        data: []
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Group logs by player
    const playerLogs: Record<string, GameLog[]> = {};
    for (const log of allGameLogs) {
      const name = log.player_name;
      if (!playerLogs[name]) playerLogs[name] = [];
      playerLogs[name].push(log);
    }

    console.log(`[Category Analyzer] Grouped logs for ${Object.keys(playerLogs).length} players`);

    // Analyze each category (NBA/NCAAB only — MLB handled separately below)
    const categoriesToAnalyze = category 
      ? (MLB_CATEGORIES.has(category) ? [] : [category]) 
      : Object.keys(CATEGORIES).filter(k => !MLB_CATEGORIES.has(k));
    const sweetSpots: any[] = [];
    let archetypeBlockedCount = 0;

    for (const catKey of categoriesToAnalyze) {
      const config = CATEGORIES[catKey];
      if (!config) continue;

      // v9.0: Apply side override from bot_category_weights (flipped categories)
      const effectiveSide = sideOverrideMap.get(catKey) || config.side;

      // v7.0: Skip disabled categories
      if (config.disabled) {
        console.log(`[Category Analyzer] ⛔ Skipping disabled category: ${catKey}`);
        continue;
      }

      console.log(`[Category Analyzer] Analyzing category: ${catKey}`);
      let playersInRange = 0;
      let qualifiedPlayers = 0;
      let blockedByArchetype = 0;
      let blockedByMinutes = 0;

      for (const [playerName, logs] of Object.entries(playerLogs)) {
        // Take last 10 games only
        const l10Logs = logs.slice(0, 10);
        if (l10Logs.length < 5) continue; // Need at least 5 games for reliable analysis

        const statValues = l10Logs.map(log => getStatValue(log, config.propType));
        const l10Avg = statValues.reduce((a, b) => a + b, 0) / statValues.length;
        const l10StdDev = calculateStdDev(statValues);

        // v1.4: DUAL ELIGIBILITY - Check avgRange OR lineRange
        const avgEligible = l10Avg >= config.avgRange.min && l10Avg <= config.avgRange.max;
        
        // For line-based eligibility, we need to check against actual bookmaker line later
        // For now, mark players who might qualify via lineRange for later validation
        const potentialLineEligible = config.lineRange !== undefined;

        // v3.0: ARCHETYPE VALIDATION - Must pass before being considered
        const archetypeCheck = passesArchetypeValidation(playerName, config);
        if (!archetypeCheck.passes) {
          if (avgEligible && playersInRange < 5) {
            // Only log first few blocked for debugging
            console.log(`[Category Analyzer] ⛔ ${catKey}: ${playerName} blocked - ${archetypeCheck.reason}`);
          }
          blockedByArchetype++;
          continue; // Skip this player for this category
        }

        // v7.1: STAR PLAYER BLOCK - Never recommend UNDER on star players
        // If they're slow during live game, hedge system will alert
        if (effectiveSide === 'under' && isStarPlayer(playerName)) {
          console.log(`[Category Analyzer] ⭐ STAR BLOCKED: ${playerName} excluded from ${catKey} - use hedge system for live adjustments`);
          continue;
        }

        // v7.0: STARTER PROTECTION - Block starters from points UNDER categories
        // Players averaging 28+ minutes are starters who can explode any night
        if (config.propType === 'points' && effectiveSide === 'under') {
          const avgMinutes = l10Logs.reduce((sum, g) => sum + (g.minutes_played || 0), 0) / l10Logs.length;
          if (avgMinutes >= 28) {
            if (blockedByMinutes < 5) {
              console.log(`[Category Analyzer] ⛔ STARTER: ${playerName} blocked from ${catKey} - ${avgMinutes.toFixed(1)} min avg (starters can explode)`);
            }
            blockedByMinutes++;
            continue;
          }
        }
        
        // v4.0: BREAKOUT PLAYER DETECTION - Block rising stars from UNDER categories
        // Prevents picks like "Evan Mobley UNDER 18.5" when he's on an upward trend
        if (effectiveSide === 'under') {
          const l5Logs = l10Logs.slice(0, 5);
          const l5Values = l5Logs.map(log => getStatValue(log, config.propType));
          const l5Avg = l5Values.reduce((a, b) => a + b, 0) / l5Values.length;
          
          // Check for breakout signals
          const breakoutSignals = {
            // 1. Recent explosion: Any 25+ point game in L5 (for points)
            recentExplosion: config.propType === 'points' && l5Values.some(v => v >= 25),
            // 2. Usage trending: L5 avg > L10 avg by 15%+ 
            usageTrending: l10Logs.length >= 10 && l5Avg > l10Avg * 1.15,
            // 3. Minutes expanding: L5 minutes > L10 minutes by 10%+
            minutesExpanding: (() => {
              const l5Min = l5Logs.reduce((s, g) => s + (g.minutes_played || 0), 0) / l5Logs.length;
              const l10Min = l10Logs.reduce((s, g) => s + (g.minutes_played || 0), 0) / l10Logs.length;
              return l10Logs.length >= 10 && l5Min > l10Min * 1.10;
            })(),
            // 4. Consistency breakout: Recent games all above line
            consistentHigh: config.propType === 'points' && l5Values.every(v => v >= l10Avg * 1.1),
          };
          
          // Block if explosion detected (immediate disqualifier)
          if (breakoutSignals.recentExplosion) {
            console.log(`[Category Analyzer] 🚫 BREAKOUT: ${playerName} blocked from ${catKey} - 25+ pt game in L5`);
            continue;
          }
          
          // Block if multiple trending signals detected
          const trendingCount = [
            breakoutSignals.usageTrending,
            breakoutSignals.minutesExpanding,
            breakoutSignals.consistentHigh,
          ].filter(Boolean).length;
          
          if (trendingCount >= 2) {
            console.log(`[Category Analyzer] 🚫 BREAKOUT: ${playerName} blocked from ${catKey} - ${trendingCount} trending signals`);
            continue;
          }
        }
        
        // If neither eligibility path is possible, skip
        if (!avgEligible && !potentialLineEligible) continue;
        
        playersInRange++;

        const l10Min = Math.min(...statValues);
        const l10Max = Math.max(...statValues);
        const l10Median = calculateMedian(statValues);

        // Find the best line for this player
        let bestLine: number | null = null;
        let bestHitRate = 0;

        for (const line of config.lines) {
          const hitRate = calculateHitRate(statValues, line, effectiveSide);
          
          if (hitRate >= (minHitRate || config.minHitRate) && hitRate > bestHitRate) {
            bestHitRate = hitRate;
            bestLine = line;
          }
        }

        // Log top candidates even if they don't qualify
        if (playersInRange <= 5) {
          console.log(`[Category Analyzer] ${catKey} - ${playerName}: avg=${l10Avg.toFixed(1)}, bestLine=${bestLine}, hitRate=${(bestHitRate * 100).toFixed(0)}%, avgEligible=${avgEligible}, potentialLineEligible=${potentialLineEligible}`);
        }

        // Calculate confidence score based on consistency and hit rate
        const consistency = l10Avg > 0 ? 1 - (l10StdDev / l10Avg) : 0;
        
        // v5.0: TIGHTENED UNDER CRITERIA - UNDERs hit at 63.6% vs 78% for OVERs
        if (effectiveSide === 'under') {
          const underMinHitRate = 0.65; // Higher threshold for unders
          const maxVarianceRatio = 0.30; // Variance must be < 30% of avg
          const varianceRatio = l10Avg > 0 ? l10StdDev / l10Avg : 1;
          
          // Block high-variance UNDERs
          if (varianceRatio > maxVarianceRatio) {
            console.log(`[Category Analyzer] ✗ UNDER ${playerName}: Variance too high (${(varianceRatio * 100).toFixed(0)}% > ${maxVarianceRatio * 100}%)`);
            continue;
          }
          
          // Check for trending up (L5 > L10)
          const l5Values = statValues.slice(0, 5);
          const l5Avg = l5Values.length > 0 ? l5Values.reduce((a, b) => a + b, 0) / l5Values.length : l10Avg;
          if (l5Avg > l10Avg * 1.08) {
            console.log(`[Category Analyzer] ✗ UNDER ${playerName}: Trending up (L5 ${l5Avg.toFixed(1)} > L10*1.08 ${(l10Avg * 1.08).toFixed(1)})`);
            continue;
          }
          
          // Apply stricter hit rate for UNDERs
          if (bestHitRate < underMinHitRate) {
            console.log(`[Category Analyzer] ✗ UNDER ${playerName}: Hit rate ${(bestHitRate * 100).toFixed(0)}% < required ${underMinHitRate * 100}%`);
            continue;
          }
        }

        if (bestLine !== null && bestHitRate >= (minHitRate || config.minHitRate)) {
          qualifiedPlayers++;
          
          // v5.0: RECALIBRATED CONFIDENCE FORMULA
          // Add variance penalty, side-specific bonus, sample size bonus
          const baseConfidence = (bestHitRate * 0.50) + (Math.max(0, consistency) * 0.30);
          const variancePenalty = l10Avg > 0 ? (l10StdDev / l10Avg) * 0.12 : 0;
          const sideBonus = effectiveSide === 'over' ? 0.06 : 0; // OVERs historically hit higher
          const sampleBonus = l10Logs.length >= 10 ? 0.04 : 0;
          const confidenceScore = Math.min(0.92, Math.max(0.35, baseConfidence - variancePenalty + sideBonus + sampleBonus));

          sweetSpots.push({
            category: catKey,
            player_name: playerName,
            prop_type: config.propType,
            recommended_line: bestLine,
            recommended_side: effectiveSide,
            l10_hit_rate: Math.round(bestHitRate * 100) / 100,
            l10_avg: Math.round(l10Avg * 10) / 10,
            l10_min: l10Min,
            l10_max: l10Max,
            l10_median: Math.round(l10Median * 10) / 10,
            games_played: l10Logs.length,
            archetype: getPlayerArchetype(playerName), // v3.0: Store actual archetype
            confidence_score: Math.round(confidenceScore * 100) / 100,
            analysis_date: today,
            is_active: true,
            eligibility_type: 'AVG_RANGE' // Track how they qualified
          });
        } else if (!avgEligible && potentialLineEligible) {
          // v1.4: Player doesn't meet avgRange but might qualify via lineRange
          // Add as potential bounce-back candidate for later validation
          sweetSpots.push({
            category: catKey,
            player_name: playerName,
            prop_type: config.propType,
            recommended_line: null, // Will be set during validation
            recommended_side: effectiveSide,
            l10_hit_rate: null,
            l10_avg: Math.round(l10Avg * 10) / 10,
            l10_min: l10Min,
            l10_max: l10Max,
            l10_median: Math.round(l10Median * 10) / 10,
            l10_std_dev: Math.round(l10StdDev * 10) / 10,
            games_played: l10Logs.length,
            archetype: getPlayerArchetype(playerName), // v3.0: Store actual archetype
            confidence_score: 0, // Will be calculated during validation
            analysis_date: today,
            is_active: false, // Will be activated during validation if eligible
            eligibility_type: 'LINE_RANGE_PENDING', // Needs line-based validation
            requires_bounce_back_check: config.supportsBounceBack || false
          });
        }
      }
      
      console.log(`[Category Analyzer] ${catKey}: ${playersInRange} in range, ${qualifiedPlayers} qualified, ${blockedByArchetype} blocked by archetype`);
      archetypeBlockedCount += blockedByArchetype;
    }

    console.log(`[Category Analyzer] Found ${sweetSpots.length} total sweet spots before validation (${archetypeBlockedCount} total blocked by archetype)`);

    // ============ MLB CATEGORY ANALYSIS ============
    const mlbCategoriesToAnalyze = category 
      ? (MLB_CATEGORIES.has(category) ? [category] : [])
      : Array.from(MLB_CATEGORIES);
    
    let mlbSweetSpotCount = 0;

    for (const catKey of mlbCategoriesToAnalyze) {
      const config = CATEGORIES[catKey];
      if (!config) continue;

      const effectiveSide = sideOverrideMap.get(catKey) || config.side;
      console.log(`[Category Analyzer] Analyzing MLB category: ${catKey}`);
      let mlbQualified = 0;

      // For pitcher_strikeouts, only use players who have pitcher data
      const isPitcherCategory = config.propType === 'pitcher_strikeouts';

      for (const [playerName, logs] of Object.entries(mlbPlayerLogs)) {
        // Filter: pitcher categories need pitcher_strikeouts != null
        const relevantLogs = isPitcherCategory
          ? logs.filter(l => l.pitcher_strikeouts !== null && l.pitcher_strikeouts !== undefined)
          : logs;

        const l10Logs = relevantLogs.slice(0, 10);
        if (l10Logs.length < 5) continue;

        const statValues = l10Logs.map(log => getMLBStatValue(log, config.propType));
        const l10Avg = statValues.reduce((a, b) => a + b, 0) / statValues.length;
        const l10StdDev = calculateStdDev(statValues);

        // Check average range eligibility
        if (l10Avg < config.avgRange.min || l10Avg > config.avgRange.max) continue;

        const l10Min = Math.min(...statValues);
        const l10Max = Math.max(...statValues);
        const l10Median = calculateMedian(statValues);

        // Find best line
        let bestLine: number | null = null;
        let bestHitRate = 0;

        for (const line of config.lines) {
          const hitRate = calculateHitRate(statValues, line, effectiveSide);
          if (hitRate >= config.minHitRate && hitRate > bestHitRate) {
            bestHitRate = hitRate;
            bestLine = line;
          }
        }

        // v5.0: UNDER criteria for MLB
        if (effectiveSide === 'under') {
          const varianceRatio = l10Avg > 0 ? l10StdDev / l10Avg : 1;
          if (varianceRatio > 0.40) continue; // MLB stats are more variable, slightly relaxed

          const l5Values = statValues.slice(0, 5);
          const l5Avg = l5Values.length > 0 ? l5Values.reduce((a, b) => a + b, 0) / l5Values.length : l10Avg;
          if (l5Avg > l10Avg * 1.10) continue; // Trending up = skip under
        }

        if (bestLine !== null && bestHitRate >= config.minHitRate) {
          mlbQualified++;
          const consistency = l10Avg > 0 ? 1 - (l10StdDev / l10Avg) : 0;
          const baseConfidence = (bestHitRate * 0.50) + (Math.max(0, consistency) * 0.30);
          const variancePenalty = l10Avg > 0 ? (l10StdDev / l10Avg) * 0.12 : 0;
          const sideBonus = effectiveSide === 'over' ? 0.06 : 0;
          const sampleBonus = l10Logs.length >= 10 ? 0.04 : 0;
          const confidenceScore = Math.min(0.92, Math.max(0.35, baseConfidence - variancePenalty + sideBonus + sampleBonus));

          sweetSpots.push({
            category: catKey,
            player_name: playerName,
            prop_type: config.propType,
            recommended_line: bestLine,
            recommended_side: effectiveSide,
            l10_hit_rate: Math.round(bestHitRate * 100) / 100,
            l10_avg: Math.round(l10Avg * 10) / 10,
            l10_min: l10Min,
            l10_max: l10Max,
            l10_median: Math.round(l10Median * 10) / 10,
            l10_std_dev: Math.round(l10StdDev * 10) / 10,
            games_played: l10Logs.length,
            archetype: null, // MLB doesn't use archetypes
            confidence_score: Math.round(confidenceScore * 100) / 100,
            analysis_date: today,
            is_active: true,
            eligibility_type: 'MLB_AVG_RANGE',
            projected_value: Math.round(l10Median * 10) / 10, // Simple projection: L10 median
            projection_source: 'MLB_L10_MEDIAN',
          });
          mlbSweetSpotCount++;
        }
      }
      console.log(`[Category Analyzer] ${catKey}: ${mlbQualified} qualified MLB players`);
    }

    console.log(`[Category Analyzer] MLB sweet spots generated: ${mlbSweetSpotCount}`);
    console.log(`[Category Analyzer] Total sweet spots (NBA+MLB): ${sweetSpots.length}`);

    // ======= NEW: Validate against actual bookmaker lines from unified_props =======
    console.log(`[CAT-ANALYZER-CRITICAL] Starting unified_props fetch...`);
    
    // Fetch actual lines from unified_props for today's games (including already started)
    // v4.2: Use start-of-day UTC instead of now() to catch games that already tipped
    const todayStartUtc = new Date().toISOString().split('T')[0] + 'T00:00:00Z';
    console.log(`[CAT-ANALYZER-CRITICAL] Using today start UTC: ${todayStartUtc}`);
    
    const { data: upcomingProps, error: propsError } = await supabase
      .from('unified_props')
      .select('player_name, prop_type, current_line, over_price, under_price, bookmaker, commence_time, game_description')
      .gte('commence_time', todayStartUtc)
      .order('commence_time', { ascending: true });

    if (propsError) {
      console.error(`[CAT-ANALYZER-CRITICAL] Error fetching unified_props: ${propsError.message}`);
    }

    console.log(`[CAT-ANALYZER-CRITICAL] Found ${upcomingProps?.length || 0} upcoming props`);

    // Create lookup map for actual lines (key: playername_proptype)
    // v4.1: Include opponent extraction from game_description for accurate projections
    const actualLineMap = new Map<string, { line: number; overPrice: number; underPrice: number; bookmaker: string; opponent: string | null; playerTeam: string | null }>();
    for (const prop of upcomingProps || []) {
      if (!prop.player_name || !prop.prop_type || prop.current_line == null) continue;
      
      // v4.1: Parse opponent from game_description (e.g., "MIN @ CHI" or "Denver Nuggets @ Chicago Bulls")
      // Since we don't have player's team, we'll just extract both teams for later matching
      let opponent: string | null = null;
      let playerTeam: string | null = null;
      if (prop.game_description) {
        const atMatch = prop.game_description.match(/^(.+?)\s*@\s*(.+)$/i);
        const vsMatch = prop.game_description.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
        const parts = atMatch || vsMatch;
        if (parts && parts.length >= 3) {
          // Store both teams - will need to match player to team later via game logs
          playerTeam = parts[1].trim(); // Away team (placeholder - may need player roster lookup)
          opponent = parts[2].trim();   // Home team
        }
      }
      
      const normalizedPropType = prop.prop_type.toLowerCase().replace(/^player_/, '');
      const key = `${prop.player_name.toLowerCase().trim()}_${normalizedPropType}`;
      // Only keep first occurrence (most recent)
      if (!actualLineMap.has(key)) {
        actualLineMap.set(key, {
          line: prop.current_line,
          overPrice: prop.over_price,
          underPrice: prop.under_price,
          bookmaker: prop.bookmaker,
          opponent: opponent,
          playerTeam: playerTeam
        });
      }
    }

    console.log(`[CAT-ANALYZER-CRITICAL] Built lookup map with ${actualLineMap.size} unique player/prop combinations`);

    // Validate each sweet spot against actual lines and recalculate hit rates
    const validatedSpots: any[] = [];
    let validatedCount = 0;
    let droppedCount = 0;
    let noGameCount = 0;
    let bounceBackCount = 0;
    let lineEligibleCount = 0;

    // Fetch season stats for bounce back detection
    const { data: seasonStats } = await supabase
      .from('player_season_stats')
      .select('player_name, avg_points, avg_rebounds, avg_assists, avg_threes');
    
    const seasonStatsMap = new Map<string, any>();
    for (const stat of seasonStats || []) {
      seasonStatsMap.set(stat.player_name?.toLowerCase().trim(), stat);
    }
    
    console.log(`[Category Analyzer] Loaded season stats for ${seasonStatsMap.size} players`);

    for (const spot of sweetSpots) {
      const isMLBSpot = MLB_CATEGORIES.has(spot.category);
      const key = `${spot.player_name.toLowerCase().trim()}_${spot.prop_type.toLowerCase()}`;
      const actualData = actualLineMap.get(key);
      
      if (!actualData) {
        // No upcoming game found - mark as inactive
        spot.is_active = false;
        spot.actual_line = null;
        spot.actual_hit_rate = null;
        spot.line_difference = null;
        spot.bookmaker = null;
        validatedSpots.push(spot);
        noGameCount++;
        continue;
      }
      
      // For MLB spots that already have projected_value from analysis, do simplified validation
      if (isMLBSpot) {
        const mlbLogs = mlbPlayerLogs[spot.player_name];
        if (!mlbLogs || mlbLogs.length < 5) {
          spot.is_active = false;
          validatedSpots.push(spot);
          continue;
        }
        const isPitcher = spot.prop_type === 'pitcher_strikeouts';
        const relevantLogs = isPitcher ? mlbLogs.filter(l => l.pitcher_strikeouts != null) : mlbLogs;
        const l10Logs = relevantLogs.slice(0, 10);
        const statValues = l10Logs.map(log => getMLBStatValue(log, spot.prop_type));
        const actualHitRate = calculateHitRate(statValues, actualData.line, spot.recommended_side);
        
        spot.actual_line = actualData.line;
        spot.actual_hit_rate = Math.round(actualHitRate * 100) / 100;
        spot.line_difference = spot.recommended_line ? Math.round((actualData.line - spot.recommended_line) * 10) / 10 : null;
        spot.bookmaker = actualData.bookmaker;
        
        // Negative edge blocking for MLB
        if (spot.recommended_side === 'over' && (spot.projected_value || 0) <= actualData.line) {
          spot.is_active = false;
          spot.risk_level = 'BLOCKED';
          spot.recommendation = `Negative edge: proj ${spot.projected_value} <= line ${actualData.line}`;
          validatedSpots.push(spot);
          droppedCount++;
          continue;
        }
        if (spot.recommended_side === 'under' && (spot.projected_value || 0) >= actualData.line) {
          spot.is_active = false;
          spot.risk_level = 'BLOCKED';
          spot.recommendation = `Negative edge: proj ${spot.projected_value} >= line ${actualData.line}`;
          validatedSpots.push(spot);
          droppedCount++;
          continue;
        }
        
        // Activate if hit rate against actual line is sufficient
        spot.is_active = actualHitRate >= 0.50;
        if (actualHitRate >= 0.70) {
          spot.risk_level = 'LOW';
          spot.recommendation = `Strong MLB play - ${(actualHitRate * 100).toFixed(0)}% L10 hit rate`;
        } else if (actualHitRate >= 0.55) {
          spot.risk_level = 'MEDIUM';
          spot.recommendation = `Decent MLB value - ${(actualHitRate * 100).toFixed(0)}% L10`;
        } else {
          spot.risk_level = 'HIGH';
          spot.recommendation = `Higher risk MLB play - ${(actualHitRate * 100).toFixed(0)}% L10`;
        }
        
        if (spot.is_active) {
          validatedCount++;
          console.log(`[Category Analyzer] ✓ MLB ${spot.category} ${spot.player_name}: ${spot.recommended_side.toUpperCase()} ${actualData.line} (${(actualHitRate * 100).toFixed(0)}% L10)`);
        } else {
          droppedCount++;
        }
        validatedSpots.push(spot);
        continue;
      }
      
      // Recalculate L10 hit rate against actual bookmaker line (NBA/NCAAB)
      const logs = playerLogs[spot.player_name];
      if (logs && logs.length >= 5) {
        const l10Logs = logs.slice(0, 10);
        const statValues = l10Logs.map(log => getStatValue(log, spot.prop_type));
        const l10Avg = statValues.reduce((a, b) => a + b, 0) / statValues.length;
        const l10StdDev = calculateStdDev(statValues);
        const l10Min = Math.min(...statValues);
        
        // v6.0: Calculate L5 avg for hot/cold detection
        const l5Logs = l10Logs.slice(0, 5);
        const l5Values = l5Logs.map(log => getStatValue(log, spot.prop_type));
        const l5Avg = l5Values.length > 0 ? l5Values.reduce((a, b) => a + b, 0) / l5Values.length : l10Avg;
        
        // v4.1: Get UPCOMING opponent from unified_props (not historical from game logs)
        const upcomingOpponent = actualData.opponent || null;
        
        // v6.0: Apply 3PT VALIDATION FILTER for THREE_POINT_SHOOTER category
        if (spot.category === 'THREE_POINT_SHOOTER' && actualData.line !== null) {
          const validation = validate3PTCandidate(
            spot.player_name,
            actualData.line,
            l10Avg,
            l10Min,
            l10StdDev,
            l5Avg
          );
          
          if (!validation.passes) {
            console.log(`[3PT Filter] ✗ ${spot.player_name}: ${validation.reason}`);
            spot.is_active = false;
            spot.quality_tier = validation.tier;
            validatedSpots.push(spot);
            droppedCount++;
            continue;
          }
          
          console.log(`[3PT Filter] ✓ ${spot.player_name}: ${validation.tier} - ${validation.reason}`);
          spot.quality_tier = validation.tier;
        }
        
        // v4.1: Calculate TRUE PROJECTION using correct upcoming opponent
        const projection = calculateTrueProjection(
          spot.player_name,
          spot.prop_type,
          statValues,
          upcomingOpponent
        );
        
        // v6.0: NEVER store NULL projected_value - use fallback chain
        // Fallback: projectedValue → l10Median → l10Avg → actualLine → 0
        const l10Median = calculateMedian(statValues);
        const finalProjectedValue = projection.projectedValue ?? l10Median ?? l10Avg ?? actualData.line ?? 0;
        
        // v6.0: Log warning if using fallback
        if (!projection.projectedValue) {
          console.log(`[Projection] ⚠️ ${spot.player_name} ${spot.prop_type}: Using fallback projection (L10 median: ${l10Median?.toFixed(1) || 'null'})`);
        }
        
        // Add projection data to spot - GUARANTEED non-null
        spot.projected_value = Math.round(finalProjectedValue * 10) / 10;
        spot.matchup_adjustment = projection.matchupAdj;
        spot.pace_adjustment = projection.paceAdj;
        spot.projection_source = projection.projectedValue ? projection.projectionSource : 'fallback_l10_median';
        
        // v4.2: NEGATIVE-EDGE BLOCKING
        // Block picks where projection contradicts the recommended side
        if (spot.recommended_side === 'over' && spot.projected_value <= actualData.line) {
          console.log(`[Edge Block] ✗ ${spot.player_name} ${spot.prop_type}: OVER ${actualData.line} but proj only ${spot.projected_value} — negative edge blocked`);
          spot.is_active = false;
          spot.risk_level = 'BLOCKED';
          spot.recommendation = `Negative edge: proj ${spot.projected_value} <= line ${actualData.line}`;
          spot.actual_line = actualData.line;
          spot.bookmaker = actualData.bookmaker;
          validatedSpots.push(spot);
          droppedCount++;
          continue;
        }
        if (spot.recommended_side === 'under' && spot.projected_value >= actualData.line) {
          console.log(`[Edge Block] ✗ ${spot.player_name} ${spot.prop_type}: UNDER ${actualData.line} but proj ${spot.projected_value} — negative edge blocked`);
          spot.is_active = false;
          spot.risk_level = 'BLOCKED';
          spot.recommendation = `Negative edge: proj ${spot.projected_value} >= line ${actualData.line}`;
          spot.actual_line = actualData.line;
          spot.bookmaker = actualData.bookmaker;
          validatedSpots.push(spot);
          droppedCount++;
          continue;
        }
        
        // v4.1: Log projection for debugging
        console.log(`[Projection] ${spot.player_name} ${spot.prop_type} vs ${upcomingOpponent || 'unknown'}: Proj=${spot.projected_value?.toFixed(1)}, MatchupAdj=${projection.matchupAdj.toFixed(1)}, PaceAdj=${projection.paceAdj.toFixed(1)}, Source=${spot.projection_source}`);
        
        // v1.4: Handle LINE_RANGE_PENDING spots (line-based eligibility)
        if (spot.eligibility_type === 'LINE_RANGE_PENDING') {
          const config = CATEGORIES[spot.category];
          
          // Check if actual line qualifies via lineRange
          const lineEligible = config.lineRange && 
            actualData.line >= config.lineRange.min && 
            actualData.line <= config.lineRange.max;
          
          if (!lineEligible) {
            spot.is_active = false;
            validatedSpots.push(spot);
            continue;
          }
          
          lineEligibleCount++;
          console.log(`[Category Analyzer] [LINE-ELIGIBLE] ${spot.player_name}: L10 avg ${l10Avg.toFixed(1)} below range but line ${actualData.line} qualifies`);
          
          // Get season average for bounce back detection
          const playerSeasonStats = seasonStatsMap.get(spot.player_name.toLowerCase().trim());
          let seasonAvg = 0;
          if (playerSeasonStats) {
            switch (spot.prop_type) {
              case 'points': seasonAvg = playerSeasonStats.avg_points || 0; break;
              case 'rebounds': seasonAvg = playerSeasonStats.avg_rebounds || 0; break;
              case 'assists': seasonAvg = playerSeasonStats.avg_assists || 0; break;
              case 'threes': seasonAvg = playerSeasonStats.avg_threes || 0; break;
            }
          }
          
          // Check for bounce back candidate
          const seasonVsL10Gap = seasonAvg - l10Avg;
          const stdDevGap = l10StdDev > 0 ? seasonVsL10Gap / l10StdDev : 0;
          const lineVsSeasonGap = Math.abs(actualData.line - seasonAvg);
          
          const isBounceBackCandidate = 
            config.supportsBounceBack &&
            seasonVsL10Gap >= BOUNCE_BACK_CONFIG.minSeasonVsL10Gap &&
            stdDevGap >= BOUNCE_BACK_CONFIG.minStdDevGap &&
            lineVsSeasonGap <= BOUNCE_BACK_CONFIG.maxLineVsSeasonGap;
          
          if (isBounceBackCandidate) {
            // Check OVER hit rate - low L10 OVER hit rate = due for bounce
            const l10OverHitRate = calculateHitRate(statValues, actualData.line, 'over');
            
            // Ideal bounce back: Low L10 hit rate (20-50%) + Season avg >= line
            if (l10OverHitRate >= BOUNCE_BACK_CONFIG.minL10HitRateForOVER &&
                l10OverHitRate <= BOUNCE_BACK_CONFIG.maxL10HitRateForOVER &&
                seasonAvg >= actualData.line * 0.95) { // Season avg within 5% of line
              
              bounceBackCount++;
              spot.recommended_side = 'over';
              spot.recommended_line = actualData.line;
              spot.actual_line = actualData.line;
              spot.actual_hit_rate = Math.round(l10OverHitRate * 100) / 100;
              spot.bookmaker = actualData.bookmaker;
              spot.is_active = true;
              spot.eligibility_type = 'BOUNCE_BACK';
              spot.bounce_back_score = Math.round(stdDevGap * 100) / 100;
              spot.season_avg = Math.round(seasonAvg * 10) / 10;
              
              // Confidence based on how far below mean + season baseline
              const confidenceScore = Math.min(0.85, 0.5 + (stdDevGap * 0.15) + ((seasonAvg - actualData.line) / actualData.line * 0.5));
              spot.confidence_score = Math.round(confidenceScore * 100) / 100;
              
              validatedCount++;
              console.log(`[Category Analyzer] 🔥 BOUNCE-BACK ${spot.player_name} ${spot.prop_type} OVER ${actualData.line}: Season ${seasonAvg.toFixed(1)} vs L10 ${l10Avg.toFixed(1)} (${stdDevGap.toFixed(2)} std devs below)`);
              validatedSpots.push(spot);
              continue;
            }
          }
          
          // v1.5: For BIG categories, ALWAYS recommend OVER with risk indicator
          const overHitRate = calculateHitRate(statValues, actualData.line, 'over');
          
          spot.recommended_side = 'over';
          spot.recommended_line = actualData.line;
          spot.actual_line = actualData.line;
          spot.actual_hit_rate = Math.round(overHitRate * 100) / 100;
          spot.bookmaker = actualData.bookmaker;
          spot.is_active = true;
          spot.eligibility_type = 'LINE_ELIGIBLE_OVER';
          
          // Add risk level based on L10 hit rate
          if (overHitRate >= 0.70) {
            spot.risk_level = 'LOW';
            spot.recommendation = 'Strong play - 70%+ L10 hit rate';
          } else if (overHitRate >= 0.50) {
            spot.risk_level = 'MEDIUM';
            spot.recommendation = 'Decent value - watch for variance';
          } else if (overHitRate >= 0.30) {
            spot.risk_level = 'HIGH';
            spot.recommendation = 'High variance - potential regression play';
          } else {
            spot.risk_level = 'EXTREME';
            spot.recommendation = 'Extreme variance - use caution';
          }
          
          // Confidence adjusted by hit rate (scaled 0.4-0.9)
          const confidence = Math.max(0.4, Math.min(0.9, overHitRate * 0.8 + 0.3));
          spot.confidence_score = Math.round(confidence * 100) / 100;
          
          lineEligibleCount++;
          validatedCount++;
          console.log(`[Category Analyzer] ✓ LINE-ELIGIBLE-OVER ${spot.player_name} ${spot.prop_type}: OVER ${actualData.line} (${(overHitRate * 100).toFixed(0)}% L10, ${spot.risk_level} risk)`);
          validatedSpots.push(spot);
          continue;
        }
        
        // v3.0 OPTIMAL WINNER categories - trust L10 hit rate for activation
        // These categories have specific line ranges designed for favorable odds
        const OPTIMAL_WINNER_CATEGORIES = [
          'ROLE_PLAYER_REB', 'BIG_ASSIST_OVER', 
          'LOW_SCORER_UNDER', 'STAR_FLOOR_OVER'
        ];

        if (OPTIMAL_WINNER_CATEGORIES.includes(spot.category)) {
          // Use the L10 hit rate calculated during initial analysis (not recalculated against actual line)
          const config = CATEGORIES[spot.category];
          const actualHitRate = calculateHitRate(statValues, actualData.line, spot.recommended_side);
          
          spot.actual_line = actualData.line;
          spot.actual_hit_rate = Math.round(actualHitRate * 100) / 100;
          spot.line_difference = spot.recommended_line ? Math.round((actualData.line - spot.recommended_line) * 10) / 10 : null;
          spot.bookmaker = actualData.bookmaker;
          
          // Activate based on ORIGINAL L10 hit rate (stored during analysis)
          spot.is_active = (spot.l10_hit_rate || 0) >= (config?.minHitRate || 0.55);
          
          // Add risk level based on actual line hit rate
          if (actualHitRate >= 0.60) {
            spot.risk_level = 'LOW';
            spot.recommendation = `Strong play - ${(actualHitRate * 100).toFixed(0)}% vs actual line`;
          } else if (actualHitRate >= 0.45) {
            spot.risk_level = 'MEDIUM';
            spot.recommendation = `Moderate risk - ${(actualHitRate * 100).toFixed(0)}% vs actual, ${((spot.l10_hit_rate || 0) * 100).toFixed(0)}% L10`;
          } else {
            spot.risk_level = 'HIGH';
            spot.recommendation = `Higher risk - L10 favorable but actual line tighter`;
          }
          
          if (spot.is_active) {
            validatedCount++;
            console.log(`[Category Analyzer] ✓ OPTIMAL ${spot.category} ${spot.player_name}: ${spot.recommended_side.toUpperCase()} ${actualData.line} (L10: ${((spot.l10_hit_rate || 0) * 100).toFixed(0)}%, Actual: ${(actualHitRate * 100).toFixed(0)}%)`);
          } else {
            droppedCount++;
            console.log(`[Category Analyzer] ✗ OPTIMAL ${spot.player_name}: L10 hit rate ${((spot.l10_hit_rate || 0) * 100).toFixed(0)}% below threshold`);
          }
          
          validatedSpots.push(spot);
          continue; // Skip standard validation
        }

        // Standard validation for AVG_RANGE qualified spots (legacy categories)
        const actualHitRate = calculateHitRate(statValues, actualData.line, spot.recommended_side);
        
        spot.actual_line = actualData.line;
        spot.actual_hit_rate = Math.round(actualHitRate * 100) / 100;
        spot.line_difference = spot.recommended_line ? Math.round((actualData.line - spot.recommended_line) * 10) / 10 : null;
        spot.bookmaker = actualData.bookmaker;
        
        // v1.2: TIERED HIT RATE REQUIREMENTS for BIG_REBOUNDER
        // High-volume rebounders against tough lines still have value at lower thresholds
        let requiredHitRate = 0.70; // Default 70%
        
        if (spot.category === 'BIG_REBOUNDER') {
          if (actualData.line > 10.5) {
            requiredHitRate = 0.60; // 60% for very high lines (10.5+)
          } else if (actualData.line >= 8.5) {
            requiredHitRate = 0.65; // 65% for high lines (8.5-10.5)
          }
          // Lines <= 8.5 keep 70% requirement
        }
        
        spot.is_active = actualHitRate >= requiredHitRate;
        
        if (spot.is_active) {
          validatedCount++;
          console.log(`[Category Analyzer] ✓ ${spot.player_name} ${spot.prop_type}: recommended=${spot.recommended_line}, actual=${actualData.line}, hitRate=${(actualHitRate * 100).toFixed(0)}% (req: ${(requiredHitRate * 100).toFixed(0)}%)`);
        } else {
          droppedCount++;
          console.log(`[Category Analyzer] ✗ ${spot.player_name} ${spot.prop_type}: dropped (hitRate ${(actualHitRate * 100).toFixed(0)}% < ${(requiredHitRate * 100).toFixed(0)}% at actual line ${actualData.line})`);
          
          // v1.5: For BIG categories, keep as OVER with risk indicator instead of switching to UNDER
          if (spot.category === 'BIG_REBOUNDER' || spot.category === 'VOLUME_SCORER') {
            // Re-enable with risk indicator
            spot.is_active = true;
            spot.recommended_side = 'over'; // Keep as OVER
            droppedCount--; // Undo the drop
            validatedCount++;
            
            // Set risk level based on actual hit rate
            if (actualHitRate >= 0.50) {
              spot.risk_level = 'MEDIUM';
              spot.recommendation = `Moderate risk - ${(actualHitRate * 100).toFixed(0)}% L10 hit rate`;
            } else if (actualHitRate >= 0.30) {
              spot.risk_level = 'HIGH';
              spot.recommendation = `High variance - ${(actualHitRate * 100).toFixed(0)}% L10, regression possible`;
            } else {
              spot.risk_level = 'EXTREME';
              spot.recommendation = `Extreme variance - ${(actualHitRate * 100).toFixed(0)}% L10, use caution`;
            }
            
            console.log(`[Category Analyzer] ⚠ ${spot.player_name} ${spot.prop_type}: OVER ${actualData.line} with ${spot.risk_level} risk (${(actualHitRate * 100).toFixed(0)}% L10)`);
          }
        }
      }
      
      validatedSpots.push(spot);
    }

    console.log(`[Category Analyzer] Validation complete: ${validatedCount} active, ${droppedCount} dropped, ${noGameCount} no game today, ${bounceBackCount} bounce-back, ${lineEligibleCount} line-eligible`);

    // Sort by confidence score (active first, then by score)
    validatedSpots.sort((a, b) => {
      if (a.is_active !== b.is_active) return b.is_active ? 1 : -1;
      return b.confidence_score - a.confidence_score;
    });

    // Upsert to database (clear old data first for today)
    if (validatedSpots.length > 0) {
      // Delete existing data for today
      const { error: deleteError } = await supabase
        .from('category_sweet_spots')
        .delete()
        .eq('analysis_date', today);

      if (deleteError) {
        console.error('[Category Analyzer] Error deleting old data:', deleteError);
      } else {
        console.log(`[Category Analyzer] Deleted old data for ${today}`);
      }

      // Deduplicate spots by player_name + prop_type (keep highest confidence per player/prop)
      const deduped = new Map<string, any>();
      for (const spot of validatedSpots) {
        const key = `${spot.player_name.toLowerCase()}_${spot.prop_type}`;
        const existing = deduped.get(key);
        if (!existing || (spot.is_active && !existing.is_active) || 
            (spot.is_active === existing.is_active && (spot.confidence_score || 0) > (existing.confidence_score || 0))) {
          deduped.set(key, spot);
        }
      }
      
      const dedupedSpots = Array.from(deduped.values());
      console.log(`[Category Analyzer] Deduplicated ${validatedSpots.length} spots to ${dedupedSpots.length}`);

      // Insert in batches of 100 to avoid hitting limits
      const BATCH_SIZE = 100;
      let insertedCount = 0;
      let insertErrors = 0;
      
      for (let i = 0; i < dedupedSpots.length; i += BATCH_SIZE) {
        const batch = dedupedSpots.slice(i, i + BATCH_SIZE);
        const { error: insertError } = await supabase
          .from('category_sweet_spots')
          .insert(batch);

        if (insertError) {
          console.error(`[Category Analyzer] Batch ${Math.floor(i/BATCH_SIZE) + 1} error:`, insertError.message);
          insertErrors++;
        } else {
          insertedCount += batch.length;
        }
      }
      
      console.log(`[Category Analyzer] Inserted ${insertedCount}/${dedupedSpots.length} sweet spots (${insertErrors} errors)`);
      
      // v4.2: SYNC PROJECTIONS BACK TO unified_props
      // Enrich unified_props with projection data from category_sweet_spots
      console.log(`[Category Analyzer] Starting unified_props sync...`);
      const activeForSync = dedupedSpots.filter(s => s.is_active && s.projected_value != null && s.actual_line != null);
      let syncCount = 0;
      let syncErrors = 0;
      
      for (const spot of activeForSync) {
        const normalizedPropType = `player_${spot.prop_type}`;
        const trueLine = spot.projected_value;
        const trueLineDiff = trueLine - spot.actual_line;
        
        const { error: syncError } = await supabase
          .from('unified_props')
          .update({
            true_line: trueLine,
            true_line_diff: Math.round(trueLineDiff * 10) / 10,
            composite_score: spot.confidence_score || 0,
            category: spot.category,
            recommended_side: spot.recommended_side,
          })
          .ilike('player_name', spot.player_name)
          .eq('prop_type', normalizedPropType)
          .gte('commence_time', todayStartUtc);
        
        if (syncError) {
          syncErrors++;
          if (syncErrors <= 3) console.error(`[Sync] Error for ${spot.player_name}: ${syncError.message}`);
        } else {
          syncCount++;
        }
      }
      
      console.log(`[Category Analyzer] Synced ${syncCount}/${activeForSync.length} projections to unified_props (${syncErrors} errors)`);
    }

    // Group by category for response (only active ones)
    const activeSpots = validatedSpots.filter(s => s.is_active);
    const grouped: Record<string, any[]> = {};
    for (const spot of activeSpots) {
      if (!grouped[spot.category]) grouped[spot.category] = [];
      grouped[spot.category].push(spot);
    }

    return new Response(JSON.stringify({
      success: true,
      data: activeSpots,
      grouped,
      count: activeSpots.length,
      totalAnalyzed: validatedSpots.length,
      droppedBelowThreshold: droppedCount,
      noUpcomingGame: noGameCount,
      bounceBackPicks: bounceBackCount,
      lineEligiblePicks: lineEligibleCount,
      categories: Object.keys(grouped),
      analyzedAt: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Category Analyzer] Error:', errorMessage);
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
