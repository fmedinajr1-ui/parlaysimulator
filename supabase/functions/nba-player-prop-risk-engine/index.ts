import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// 🏀 NBA RISK ENGINE v3.0 - ELITE PLAYER ARCHETYPE SYSTEM
// ============================================================================
// 5-LAYER SHARP FUNNEL:
// Layer 1: Elite Player Archetype Classification
// Layer 2: Role-Prop Alignment Enforcement
// Layer 3: Head-to-Head Matchup Analysis
// Layer 4: Stricter Statistical Contingencies
// Layer 5: Balanced Over/Under Distribution
// ============================================================================

// ============ LAYER 1: ELITE PLAYER ARCHETYPE SYSTEM ============
type PlayerArchetype = 
  | 'ELITE_REBOUNDER'      // avg >= 9 reb (Drummond, Gobert, Jokic)
  | 'GLASS_CLEANER'        // avg 6-9 reb (High-ceiling rebounders)
  | 'PURE_SHOOTER'         // Points specialists (Curry, Booker, Lillard)
  | 'PLAYMAKER'            // Primary playmakers (Haliburton, Trae, CP3)
  | 'SCORING_GUARD'        // Scoring guards (Mitchell, Maxey, Edwards)
  | 'TWO_WAY_WING'         // Versatile wings (Butler, Tatum)
  | 'STRETCH_BIG'          // Floor-spacing bigs (3PT attempts >= 4)
  | 'RIM_PROTECTOR'        // Shot blockers (blocks >= 1.5)
  | 'ROLE_PLAYER';         // Bench/rotation players

// Archetype-to-Prop alignment matrix - ONLY allow props that match archetype
const ARCHETYPE_PROP_ALLOWED: Record<PlayerArchetype, { over: string[], under: string[] }> = {
  'ELITE_REBOUNDER': {
    over: ['rebounds', 'points'],      // Can go over on boards and points
    under: []                           // NEVER bet under on elite rebounders
  },
  'GLASS_CLEANER': {
    over: ['rebounds'],                 // Only rebounds over
    under: []                           // NEVER bet under - eruption risk
  },
  'PURE_SHOOTER': {
    over: ['points', 'threes'],         // Scoring props only
    under: ['rebounds', 'assists']      // Can fade non-scoring stats
  },
  'PLAYMAKER': {
    over: ['assists'],                  // Primary: assists
    under: ['points', 'rebounds']       // Can fade scoring/boards
  },
  'SCORING_GUARD': {
    over: ['points', 'threes'],         // Scoring + 3s
    under: ['rebounds']                 // Can fade rebounds
  },
  'TWO_WAY_WING': {
    over: ['points', 'rebounds', 'assists', 'steals'],  // Most flexible
    under: ['points', 'rebounds', 'assists', 'threes']  // Can fade any
  },
  'STRETCH_BIG': {
    over: ['points', 'threes', 'rebounds'],  // Spacing + boards
    under: ['assists']                        // Can fade assists
  },
  'RIM_PROTECTOR': {
    over: ['rebounds', 'blocks'],       // Defense + boards
    under: ['points', 'assists']        // Can fade offense
  },
  'ROLE_PLAYER': {
    over: [],                           // TOO VOLATILE - minimal overs
    under: []                           // TOO VOLATILE - minimal unders
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
  
  if (volatilityPct > 35) {
    return {
      valid: false,
      reason: `HIGH VOLATILITY: ${volatilityPct.toFixed(0)}% std dev (max 35%) - too swingy`,
      details: { standardDeviation: stdDev, volatilityPct }
    };
  }
  
  // 2. CONSISTENCY SCORE CHECK (if available)
  if (seasonStats?.consistencyScore !== undefined && seasonStats.consistencyScore < 55) {
    return {
      valid: false,
      reason: `LOW CONSISTENCY: ${seasonStats.consistencyScore} score (min 55) - unreliable`,
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
  const MAX_UNDER_PCT = 65;  // Max 65% unders
  const MAX_OVER_PCT = 65;   // Max 65% overs
  
  const isOver = newSide.toLowerCase() === 'over';
  const projectedTotal = currentBalance.total + 1;
  
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
  
  // REJECT if ceiling exceeds line by more than 50%
  if (ceilingRatio > 1.5) {
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
    // FOR UNDER: Check if top 3 games still go under
    const topGames = sorted.slice(-3);
    const ceiling = Math.max(...topGames);
    const passes = topGames.every(g => g < line);
    
    return { 
      passes, 
      badGameFloor: ceiling,
      reason: passes 
        ? `UNDER survives: Top games (${topGames.join(', ')}) all < line ${line}`
        : `UNDER FAILS: Top games (${topGames.join(', ')}) include games >= line ${line}`
    };
  } else {
    // FOR OVER: Check if bottom 3 games still go over
    const badGames = sorted.slice(0, 3);
    const badGameFloor = Math.min(...badGames);
    const passes = badGames.every(g => g > line);
    
    return { 
      passes, 
      badGameFloor,
      reason: passes 
        ? `OVER survives: Bad games (${badGames.join(', ')}) all > line ${line}`
        : `OVER FAILS: Bad games (${badGames.join(', ')}) include games <= line ${line}`
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
): { score: number; factors: ConfidenceFactors } {
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
  
  const totalScore = Object.values(factors).reduce((a, b) => a + b, 0);
  
  return { score: totalScore, factors };
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

    console.log(`[Risk Engine v3.0] Action: ${action}, Mode: ${mode}, Live Odds: ${use_live_odds}`);

    if (action === 'analyze_slate') {
      const today = getEasternDate();
      console.log(`[Risk Engine v3.0] Analyzing slate for ${today}`);
      
      // 1. Fetch active NBA props
      const { data: props, error: propsError } = await supabase
        .from('unified_props')
        .select('*')
        .eq('sport', 'basketball_nba')
        .eq('is_active', true)
        .gte('commence_time', today);

      if (propsError) throw propsError;
      console.log(`[Risk Engine v3.0] Found ${props?.length || 0} active props`);

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
      console.log(`[Risk Engine v3.0] Loaded ${Object.keys(positionMap).length} player positions`);

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
      console.log(`[Risk Engine v3.0] Loaded ${Object.keys(seasonStatsMap).length} season stats`);

      // 5. Fetch game logs (last 15 games per player)
      const { data: gameLogs } = await supabase
        .from('nba_player_game_logs')
        .select('*')
        .order('game_date', { ascending: false })
        .limit(15000);
      
      console.log(`[Risk Engine v3.0] Fetched ${gameLogs?.length || 0} game logs`);

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
      console.log(`[Risk Engine v3.0] Loaded ${Object.keys(archetypeMap).length} archetypes`);

      const approvedProps: any[] = [];
      const rejectedProps: any[] = [];
      const processedPlayerProps = new Set<string>();
      const starsUsedByTeam: Record<string, string[]> = {};
      
      // Balance tracker
      const balanceTracker: BalanceTracker = { overCount: 0, underCount: 0, total: 0 };

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
          
          // ============ LAYER 1: ARCHETYPE CLASSIFICATION ============
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
          const side = prop.recommended_side || 
            (prop.edge && prop.edge > 0 ? 'over' : 'under') || 'over';
          const isOver = side.toLowerCase() === 'over';
          
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
          
          // ============ ROLE PLAYER BLOCK ============
          if (archetype === 'ROLE_PLAYER') {
            rejectedProps.push({ 
              ...prop, 
              rejection_reason: `ROLE_PLAYER archetype - too volatile for any prop`, 
              player_role: role, 
              archetype 
            });
            continue;
          }
          
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
          
          // Get game logs
          const column = getColumnForProp(prop.prop_type);
          const playerLogs = gameLogs?.filter(log => 
            log.player_name?.toLowerCase() === playerNameLower
          ).slice(0, 15) || [];
          
          if (playerLogs.length < 5) {
            rejectedProps.push({ 
              ...prop, 
              rejection_reason: `Insufficient data: only ${playerLogs.length} games (need 5+)`, 
              player_role: role, 
              archetype 
            });
            continue;
          }
          
          const statValues = playerLogs.map(log => extractStatFromLog(log, column));
          const line = prop.current_line || prop.line;
          const trueMedian = calculateMedian(statValues);
          const edge = isOver ? trueMedian - line : line - trueMedian;
          const seasonAvg = statValues.reduce((a, b) => a + b, 0) / statValues.length;
          
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
          
          // ============ CONFIDENCE SCORING ============
          const { score, factors } = calculateConfidenceV3(
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
          
          // Minimum threshold: 8.0 (raised from 7.7)
          if (score < 8.0) {
            rejectedProps.push({ 
              ...prop, 
              rejection_reason: `Confidence ${score.toFixed(1)} < 8.0 threshold`, 
              player_role: role, 
              archetype,
              confidence_score: score
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
          approvedProps.push({
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
            confidence_score: score,
            confidence_factors: factors,
            event_id: prop.event_id,
            game_date: today,
            is_pra: isPRA,
            is_ball_dominant: role === 'BALL_DOMINANT_STAR',
            is_star: isStar,
            // H2H data
            h2h_games: matchup?.gamesVsOpponent || 0,
            h2h_avg: matchup?.avgStatVsOpponent || 0,
            h2h_hit_rate: matchup?.hitRateVsOpponent || 0,
            // Stats
            volatility_pct: statValidation.details.volatilityPct,
            consistency_score: stats?.consistency_score,
            trend_direction: stats?.trend_direction,
          });
          
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
          console.error('[Risk Engine v3.0] Error storing picks:', insertError);
        }
      }
      
      const overPct = balanceTracker.total > 0 
        ? ((balanceTracker.overCount / balanceTracker.total) * 100).toFixed(0) 
        : '0';
      const underPct = balanceTracker.total > 0 
        ? ((balanceTracker.underCount / balanceTracker.total) * 100).toFixed(0) 
        : '0';
      
      console.log(`[Risk Engine v3.0] Approved: ${approvedProps.length}, Rejected: ${rejectedProps.length}`);
      console.log(`[Risk Engine v3.0] Balance: ${overPct}% OVER / ${underPct}% UNDER`);
      
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
        engineVersion: 'v3.0 - Elite Player Archetype System'
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
    console.error('[Risk Engine v3.0] Error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
