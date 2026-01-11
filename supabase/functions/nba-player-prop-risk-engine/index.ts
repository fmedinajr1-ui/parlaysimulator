import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

// ============ STAT PRIORITY SYSTEM (REBOUNDS/ASSISTS > POINTS) ============
const STAT_PRIORITY: Record<string, number> = {
  'rebounds': 10,      // HIGHEST
  'assists': 9,
  'blocks': 7,
  'steals': 6,
  'turnovers': 5,
  '3pt_attempts': 4,
  'threes': 3,
  'points': 2,         // LOWEST - deprioritized for stars
  'pra': 1,            // AVOID
  'fantasy': 0         // NEVER
};

function getStatPriority(propType: string): number {
  const lower = propType.toLowerCase();
  for (const [stat, priority] of Object.entries(STAT_PRIORITY)) {
    if (lower.includes(stat)) return priority;
  }
  return 5; // default
}

// ============ NEVER FADE PRA BLACKLIST ============
// Tier 1 - Absolute: PRA UNDER always disabled
const NEVER_FADE_PRA_TIER1 = [
  'jaylen brown',
  'jayson tatum',
  'devin booker'
];

// Tier 2 - Conditional: PRA fade disabled by default
const NEVER_FADE_PRA_TIER2 = [
  'luka doncic',
  'luka dončić',
  'nikola jokic',
  'nikola jokić',
  'giannis antetokounmpo'
];

// Ball-dominant stars: High usage + primary FT taker + clutch player
const BALL_DOMINANT_STARS = [
  'luka doncic', 'luka dončić',
  'shai gilgeous-alexander', 'shai gilgeous alexander',
  'jayson tatum',
  'giannis antetokounmpo',
  'nikola jokic', 'nikola jokić',
  'anthony edwards',
  'ja morant',
  'trae young',
  'damian lillard',
  'kyrie irving',
  'donovan mitchell',
  'de\'aaron fox', 'deaaron fox',
  'tyrese haliburton',
  'lamelo ball'
];

function isOnNeverFadePRAList(playerName: string): { tier: 1 | 2 | null } {
  const normalized = playerName.toLowerCase();
  if (NEVER_FADE_PRA_TIER1.some(p => normalized.includes(p))) return { tier: 1 };
  if (NEVER_FADE_PRA_TIER2.some(p => normalized.includes(p))) return { tier: 2 };
  return { tier: null };
}

function isBallDominantStar(playerName: string): boolean {
  const normalized = playerName.toLowerCase();
  return BALL_DOMINANT_STARS.some(p => normalized.includes(p));
}

// ============ FAVORABLE MATCHUP CHECK FOR STARS ============
function hasFavorableMatchup(spread: number, gameScript: GameScript): boolean {
  // Star needs:
  // 1. Competitive or soft blowout (not hard blowout)
  // 2. Team favored OR close game (spread between -8 and +8)
  if (gameScript === 'HARD_BLOWOUT') return false;
  if (Math.abs(spread) > 8) return false;
  return true;
}

// ============ STEP 1: GAME SCRIPT CLASSIFICATION ============
type GameScript = 'COMPETITIVE' | 'SOFT_BLOWOUT' | 'HARD_BLOWOUT';

function classifyGameScript(spread: number): GameScript {
  const absSpread = Math.abs(spread);
  if (absSpread <= 7) return 'COMPETITIVE';
  if (absSpread <= 11) return 'SOFT_BLOWOUT'; // Updated: 8-11 = Soft Blowout
  return 'HARD_BLOWOUT'; // >= 12 = Hard Blowout
}

// ============ STEP 2: PLAYER ROLE CLASSIFICATION ============
type PlayerRole = 'STAR' | 'BALL_DOMINANT_STAR' | 'SECONDARY_GUARD' | 'WING' | 'BIG';

function classifyPlayerRole(
  usageRate: number,
  avgMinutes: number,
  position: string,
  playerName: string
): PlayerRole {
  // Check ball-dominant first (overrides other classifications)
  if (isBallDominantStar(playerName)) {
    return 'BALL_DOMINANT_STAR';
  }
  
  // STAR: Usage >= 28% OR team's primary scorer
  if (usageRate >= 28) return 'STAR';
  
  // BIG: Center / interior forward
  if (['C', 'PF', 'F-C', 'C-F'].includes(position)) return 'BIG';
  
  // SECONDARY GUARD: Ball handler but not primary
  if (['PG', 'SG', 'G', 'G-F'].includes(position) && usageRate >= 18) return 'SECONDARY_GUARD';
  
  // WING: 2-way perimeter player, minutes >= 30
  if (avgMinutes >= 30) return 'WING';
  
  // Default fallback
  return ['PG', 'SG', 'G', 'G-F'].includes(position) ? 'SECONDARY_GUARD' : 'WING';
}

// ============ STEP 3 & 4: PRA STAT TYPE RULES (GLOBAL) ============
function isPRAPlay(propType: string): boolean {
  const statLower = propType.toLowerCase();
  return statLower.includes('points_rebounds_assists') || 
         statLower.includes('pra') ||
         statLower === 'player_points_rebounds_assists';
}

function isStatBlacklisted(
  propType: string,
  side: string,
  role: PlayerRole,
  gameScript: GameScript,
  playerName: string,
  threePtAttempts?: number
): { blocked: boolean; reason?: string } {
  const statLower = propType.toLowerCase();
  const isOver = side.toLowerCase() === 'over';
  const isPRA = isPRAPlay(propType);
  
  // ❌ PRA OVER - NEVER ALLOWED (any role, any game) - STEP 4
  if (isPRA && isOver) {
    return { blocked: true, reason: 'PRA OVER globally disabled' };
  }
  
  // ❌ PRA UNDER on Never Fade list (Tier 1 or Tier 2) - STEP 3
  const neverFade = isOnNeverFadePRAList(playerName);
  if (isPRA && !isOver && neverFade.tier !== null) {
    return { 
      blocked: true, 
      reason: `PRA UNDER disabled for Tier ${neverFade.tier} player (Never Fade list: ${playerName})` 
    };
  }
  
  // ❌ PRA UNDER for ball-dominant stars in COMPETITIVE games - STEP 3
  if (isPRA && !isOver && role === 'BALL_DOMINANT_STAR' && gameScript === 'COMPETITIVE') {
    return { 
      blocked: true, 
      reason: 'PRA UNDER disabled for ball-dominant star in competitive game' 
    };
  }
  
  // Guard PRA - NEVER (applies to SECONDARY_GUARD, not BALL_DOMINANT)
  if (role === 'SECONDARY_GUARD' && isPRA) {
    return { blocked: true, reason: 'Guard PRA blacklisted' };
  }
  
  // Big PRA OVER - NEVER (already covered by global PRA OVER rule)
  // Big PRA UNDER - only in non-dominant + blowout (checked in kill switch)
  
  // Guard Rebounds - NEVER
  if (role === 'SECONDARY_GUARD' && statLower === 'player_rebounds') {
    return { blocked: true, reason: 'Guard rebounds blacklisted' };
  }
  
  // 3PT Made unless attempts >= 7 and role is shooter
  if (statLower.includes('threes') && (!threePtAttempts || threePtAttempts < 7)) {
    return { blocked: true, reason: '3PT blocked: <7 attempts avg' };
  }
  
  return { blocked: false };
}

// ============ STEP 5: GAME-STATE PRA KILL SWITCH (NEW) ============
function passesPRAKillSwitch(
  playerName: string,
  role: PlayerRole,
  gameScript: GameScript,
  spread: number,
  propType: string,
  side: string
): { passes: boolean; reason?: string } {
  const isPRA = isPRAPlay(propType);
  const isUnder = side.toLowerCase() === 'under';
  
  // Only applies to PRA UNDER plays
  if (!isPRA || !isUnder) {
    return { passes: true };
  }
  
  // Condition 1: Spread must be >= 12 (hard blowout)
  if (Math.abs(spread) < 12) {
    return { passes: false, reason: 'PRA UNDER requires spread >= 12 (Hard Blowout only)' };
  }
  
  // Condition 2: Player must NOT be ball-dominant
  if (role === 'BALL_DOMINANT_STAR') {
    return { passes: false, reason: 'PRA UNDER disabled for ball-dominant stars' };
  }
  
  // Condition 3: Player NOT on Never Fade list (already checked in blacklist, but double-check)
  const neverFade = isOnNeverFadePRAList(playerName);
  if (neverFade.tier !== null) {
    return { passes: false, reason: `PRA UNDER disabled for Never Fade Tier ${neverFade.tier} player` };
  }
  
  // Condition 4: Game must be projected non-competitive
  if (gameScript === 'COMPETITIVE') {
    return { passes: false, reason: 'PRA UNDER not allowed in competitive games' };
  }
  
  return { passes: true };
}

// ============ STEP 6: CLUTCH FAILURE PROTECTION (NEW) ============
function failsClutchProtection(
  role: PlayerRole,
  gameScript: GameScript,
  propType: string,
  side: string
): { fails: boolean; reason?: string } {
  const isPRA = isPRAPlay(propType);
  const isUnder = side.toLowerCase() === 'under';
  
  // Only applies to PRA UNDER for ball-dominant stars in competitive games
  if (!isPRA || !isUnder) {
    return { fails: false };
  }
  
  // Ball-dominant star + competitive game = clutch risk
  // Late FTs + assists kill PRA unders fastest
  if (role === 'BALL_DOMINANT_STAR' && gameScript === 'COMPETITIVE') {
    return { 
      fails: true, 
      reason: 'Clutch protection: Ball-dominant star PRA UNDER in close game (late FTs + assists risk)' 
    };
  }
  
  return { fails: false };
}

// ============ STEP 7: ALLOWED STAT TYPES BY ROLE ============
// ROLE PLAYER-FIRST: Prioritize rebounds/assists, deprioritize points (especially for stars)
function getAllowedStats(role: PlayerRole, gameScript: GameScript): string[] {
  switch (role) {
    case 'BALL_DOMINANT_STAR':
      // Ball-dominant stars: ONLY rebounds/assists (NO points!)
      return ['rebounds', 'rebounds_under', 'assists', 'assists_under'];
      
    case 'STAR':
      // Stars: rebounds/assists first, NO points (deprioritized)
      if (gameScript === 'COMPETITIVE') {
        return ['rebounds', 'assists']; // No points for stars!
      }
      // Blowout: only rebounds/assists UNDERs for stars
      return ['rebounds_under', 'assists_under'];
      
    case 'SECONDARY_GUARD':
      // Guards: assists primary, rebounds secondary, NO points
      return ['assists', 'rebounds', 'steals'];
      
    case 'WING':
      // Wings: rebounds/assists primary, steals/blocks secondary, NO points
      return ['rebounds', 'assists', 'steals', 'blocks'];
      
    case 'BIG':
      // Bigs: rebounds first, assists/blocks secondary, NO points
      const bigStats = ['rebounds', 'assists', 'blocks'];
      if (gameScript === 'HARD_BLOWOUT') {
        bigStats.push('rebounds_under');
      }
      return bigStats;
      
    default:
      // Fallback: rebounds/assists only (no points)
      return ['rebounds', 'assists'];
  }
}

function isStatAllowed(
  propType: string,
  side: string,
  role: PlayerRole,
  gameScript: GameScript
): boolean {
  const allowed = getAllowedStats(role, gameScript);
  const statLower = propType.toLowerCase();
  const sideLower = side.toLowerCase();
  
  // Check if this stat+side combo is allowed
  for (const a of allowed) {
    // Handle explicit under requirements
    if (a.includes('_under')) {
      const baseStat = a.replace('_under', '');
      if (statLower.includes(baseStat) && sideLower === 'under') {
        return true;
      }
    } else {
      // Regular stat - any side allowed unless restricted elsewhere
      if (statLower.includes(a)) {
        return true;
      }
    }
  }
  
  return false;
}

// ============ STEP 7.5: CEILING CHECK FOR UNDERS (50% MAX RULE) ============
// Rejects UNDER bets where player's MAX in L10 exceeds line by >50%
// Example: Line 6.5, MAX 16 → 16/6.5 = 2.46 (146% above) → REJECT
function failsCeilingCheck(
  gameLogs: number[],
  line: number,
  side: string
): { fails: boolean; ceiling: number; ceilingRatio: number; reason: string } {
  const isUnder = side.toLowerCase() === 'under';
  
  // Only applies to UNDER bets
  if (!isUnder) {
    return { fails: false, ceiling: 0, ceilingRatio: 0, reason: 'Not an under play' };
  }
  
  if (gameLogs.length < 5) {
    return { fails: false, ceiling: 0, ceilingRatio: 0, reason: 'Insufficient game logs for ceiling check' };
  }
  
  // Get MAX performance in the sample
  const ceiling = Math.max(...gameLogs);
  const ceilingRatio = ceiling / line;
  
  // REJECT if ceiling exceeds line by more than 50%
  if (ceilingRatio > 1.5) {
    return {
      fails: true,
      ceiling,
      ceilingRatio,
      reason: `CEILING CHECK FAILED: Player hit ${ceiling} in L${gameLogs.length} (${Math.round((ceilingRatio - 1) * 100)}% above line ${line})`
    };
  }
  
  return {
    fails: false,
    ceiling,
    ceilingRatio,
    reason: `Ceiling check passed: MAX ${ceiling} is within 50% of line ${line}`
  };
}

// ============ STEP 8: MEDIAN BAD GAME SURVIVAL TEST (ENHANCED FOR UNDER) ============
function passesMedianBadGameCheck(
  gameLogs: number[],
  line: number,
  side: string
): { passes: boolean; badGameFloor: number; reason: string } {
  if (gameLogs.length < 5) {
    return { passes: false, badGameFloor: 0, reason: 'Insufficient game logs (need 5+)' };
  }
  
  const isUnder = side.toLowerCase() === 'under';
  
  // Sort games - ascending for OVER (bad = low), descending for UNDER (bad = high)
  const sorted = [...gameLogs].sort((a, b) => a - b);
  
  if (isUnder) {
    // FOR UNDER: "Bad games" = games where player exceeded line (TOP 3)
    // We want to check: even in player's BEST games, did they stay under?
    const topGames = sorted.slice(-3);  // Top 3 performances
    const ceiling = Math.max(...topGames);
    
    // STRICT: All top performances must still go UNDER the line
    // If player hit 10+ in their best games but line is 7.5 → REJECT
    const passes = topGames.every(g => g < line);
    
    return { 
      passes, 
      badGameFloor: ceiling,  // For unders, report the ceiling (worst case)
      reason: passes 
        ? `UNDER survives: Top games (${topGames.join(', ')}) all < line ${line}`
        : `UNDER FAILS: Top games (${topGames.join(', ')}) include games >= line ${line}`
    };
  } else {
    // FOR OVER: "Bad games" = games where player scored low (BOTTOM 3)
    const badGames = sorted.slice(0, 3);
    const badGameFloor = Math.min(...badGames);
    
    // All bad games must still clear the line
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

// ============ STEP 9: MINUTES CONFIDENCE FILTER ============
type MinutesConfidence = 'LOCKED' | 'MEDIUM' | 'RISKY';

function classifyMinutes(avgMinutes: number): MinutesConfidence {
  if (avgMinutes >= 32) return 'LOCKED';
  if (avgMinutes >= 24) return 'MEDIUM';
  return 'RISKY';
}

// ============ FADE MODE: HIGH-EDGE UNDER SPECIALIST ============
type FadeEdgeTag = 'FADE_ELITE' | 'FADE_EDGE' | 'FADE_COMBO' | 'AST_FADE_RISK' | 'BLOWOUT_FADE_RISK' | null;

interface FadeEdgeResult {
  bonus: number;
  tag: FadeEdgeTag;
  reason: string;
}

// Calculate Fade Edge Bonus based on historical win rates
// WING + Rebounds Under + COMPETITIVE: 71.4% (ELITE)
// Rebounds Under (any): 68.3% (EDGE)
// Pts+Reb Under (WING): 64.7% (COMBO)
// Assists Under: 52% (RISK - near coin-flip)
function calculateFadeEdgeBonus(
  role: PlayerRole,
  propType: string,
  side: string,
  gameScript: GameScript
): FadeEdgeResult {
  const isUnder = side.toLowerCase() === 'under';
  if (!isUnder) {
    return { bonus: 0, tag: null, reason: 'Not an under play' };
  }

  const propLower = propType.toLowerCase();
  const isRebounds = propLower.includes('rebounds') && !propLower.includes('points') && !propLower.includes('assists');
  const isPtsReb = propLower.includes('points') && propLower.includes('rebounds') && !propLower.includes('assists');
  const isAssists = propLower.includes('assists') && !propLower.includes('points') && !propLower.includes('rebounds');

// FADE ELITE: WING + Rebounds Under + COMPETITIVE (71.4% historical)
  // CRITICAL: Only award if median is actually below line (real edge exists)
  if (role === 'WING' && isRebounds && gameScript === 'COMPETITIVE') {
    // This tag is a placeholder - actual median validation happens in main flow
    // The bonus is only meaningful if the pick passes median validation
    return { 
      bonus: 1.5, 
      tag: 'FADE_ELITE', 
      reason: 'WING Rebounds Under in COMPETITIVE (71.4% historical) - REQUIRES median < line'
    };
  }

  // FADE EDGE: Any Rebounds Under (68.3% historical)
  if (isRebounds) {
    const gameBonus = gameScript === 'COMPETITIVE' ? 0.3 : 0;
    return { 
      bonus: 0.8 + gameBonus, 
      tag: 'FADE_EDGE', 
      reason: `Rebounds Under (68.3% historical)${gameScript === 'COMPETITIVE' ? ' + COMPETITIVE' : ''}` 
    };
  }

  // FADE COMBO: WING + Pts+Reb Under (64.7% historical)
  if (role === 'WING' && isPtsReb) {
    return { 
      bonus: 0.5, 
      tag: 'FADE_COMBO', 
      reason: 'WING Pts+Reb Under (64.7% historical)' 
    };
  }

  // AST FADE RISK: Assists Under is only 52% - near coin-flip
  if (isAssists) {
    return { 
      bonus: -0.5, 
      tag: 'AST_FADE_RISK', 
      reason: 'Assists Under only 52% historical - near coin-flip' 
    };
  }

  // HARD BLOWOUT risk for all unders
  if (gameScript === 'HARD_BLOWOUT') {
    return { 
      bonus: -1.0, 
      tag: 'BLOWOUT_FADE_RISK', 
      reason: 'Hard Blowout Under risk - stars get pulled' 
    };
  }

  // Default under with no special edge
  return { bonus: 0, tag: null, reason: 'Standard under play' };
}

// Check if pick qualifies as Fade Specialist
function qualifiesAsFadeSpecialist(
  fadeResult: FadeEdgeResult,
  role: PlayerRole,
  side: string
): boolean {
  const isUnder = side.toLowerCase() === 'under';
  if (!isUnder) return false;
  
  // Fade Specialist requires positive edge tag
  if (fadeResult.tag === 'FADE_ELITE' || fadeResult.tag === 'FADE_EDGE' || fadeResult.tag === 'FADE_COMBO') {
    return fadeResult.bonus >= 0.5;
  }
  
  return false;
}

// ============ STEP 10: CONFIDENCE SCORING ============
interface ConfidenceFactors {
  roleStatAlignment: number;
  minutesCertainty: number;
  gameScriptFit: number;
  medianDistance: number;
  badGameSurvival: number;
  praCompliance: number;
  fadeEdgeBonus: number; // NEW: Fade specialist bonus
}

function calculateConfidence(
  role: PlayerRole,
  propType: string,
  side: string,
  minutesClass: MinutesConfidence,
  gameScript: GameScript,
  edge: number,
  passesBadGameCheck: boolean
): { score: number; factors: ConfidenceFactors; fadeEdge: FadeEdgeResult } {
  const isPRA = isPRAPlay(propType);
  
  // Calculate fade edge bonus
  const fadeEdge = calculateFadeEdgeBonus(role, propType, side, gameScript);
  
  const factors: ConfidenceFactors = {
    roleStatAlignment: 0,
    minutesCertainty: 0,
    gameScriptFit: 0,
    medianDistance: 0,
    badGameSurvival: 0,
    praCompliance: 0,
    fadeEdgeBonus: fadeEdge.bonus,
  };
  
  // Role + Stat Alignment (0-2.5)
  if (isStatAllowed(propType, side, role, gameScript)) {
    factors.roleStatAlignment = 2.5;
  } else {
    factors.roleStatAlignment = 1.0;
  }
  
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
  if (absEdge >= 3.0) {
    factors.medianDistance = 2.5;
  } else if (absEdge >= 2.0) {
    factors.medianDistance = 2.0;
  } else if (absEdge >= 1.0) {
    factors.medianDistance = 1.5;
  } else {
    factors.medianDistance = 0.5;
  }
  
  // Bad Game Survival (0-1.0)
  factors.badGameSurvival = passesBadGameCheck ? 1.0 : 0;
  
  // PRA Compliance Bonus (0-0.5)
  // Prefer Points/Rebounds UNDERS over PRA UNDERS
  if (!isPRA) {
    factors.praCompliance = 0.5; // Bonus for avoiding PRA entirely
  } else {
    factors.praCompliance = 0; // No bonus for PRA plays
  }
  
  const totalScore = Object.values(factors).reduce((a, b) => a + b, 0);
  
  return { score: totalScore, factors, fadeEdge };
}

// ============ HELPER FUNCTIONS ============
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// MEDIAN DEAD-ZONE FILTER: If line is within ±0.5 of median → no edge (coin-flip)
function isInMedianDeadZone(line: number, median: number): boolean {
  return Math.abs(line - median) <= 0.5;
}

function generateReason(
  role: PlayerRole,
  gameScript: GameScript,
  edge: number,
  minutesClass: MinutesConfidence,
  side: string,
  isPRA: boolean
): string {
  const parts: string[] = [];
  
  parts.push(`${role.replace('_', ' ')} in ${gameScript.toLowerCase().replace('_', ' ')} game`);
  
  if (edge > 0) {
    parts.push(`+${edge.toFixed(1)} edge`);
  } else {
    parts.push(`${edge.toFixed(1)} edge`);
  }
  
  if (minutesClass === 'LOCKED') {
    parts.push('locked minutes');
  }
  
  parts.push(`${side.toUpperCase()} play`);
  
  if (!isPRA) {
    parts.push('✓ non-PRA');
  }
  
  return parts.join(', ');
}

function inferPosition(playerName: string): string {
  // Default fallback - in production would use player data
  return 'SF';
}

// Prop type to game log column mapping - FIXED: Use actual DB column names
const PROP_TO_COLUMN: Record<string, string> = {
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_points_rebounds_assists': 'pts_reb_ast',  // Computed
  'player_threes': 'threes_made',
  'player_steals': 'steals',
  'player_blocks': 'blocks',
  'player_turnovers': 'turnovers',
  'player_points_rebounds': 'pts_reb',  // Computed
  'player_points_assists': 'pts_ast',   // Computed
  'player_rebounds_assists': 'reb_ast', // Computed
};

function getColumnForProp(propType: string): string {
  const normalized = propType.toLowerCase().replace(/\s+/g, '_');
  
  // Direct lookup first
  if (PROP_TO_COLUMN[normalized]) return PROP_TO_COLUMN[normalized];
  
  // Fallback: search for keywords
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
  
  return 'points'; // Ultimate fallback
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { action, mode = 'full_slate', use_live_odds = false, preferred_bookmakers = ['fanduel', 'draftkings'] } = await req.json();

    console.log(`[Risk Engine v2] Action: ${action}, Mode: ${mode}, Live Odds: ${use_live_odds}`);

    // Helper function to fetch live odds from FanDuel/DraftKings
    async function fetchLiveOdds(eventId: string, playerName: string, propType: string): Promise<{
      line: number | null;
      overPrice: number | null;
      underPrice: number | null;
      bookmaker: string | null;
    } | null> {
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/fetch-current-odds`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            event_id: eventId,
            sport: 'basketball_nba',
            player_name: playerName,
            prop_type: propType,
            preferred_bookmakers: preferred_bookmakers,
            search_all_books: true,
          }),
        });

        const data = await response.json();
        if (data?.success && data?.odds) {
          return {
            line: data.odds.line,
            overPrice: data.odds.over_price,
            underPrice: data.odds.under_price,
            bookmaker: data.odds.bookmaker,
          };
        }
        return null;
      } catch (err) {
        console.error(`[Risk Engine v2] Error fetching live odds for ${playerName}:`, err);
        return null;
      }
    }

    // Helper function to get today's date in Eastern Time (NBA game time)
    function getEasternDate(): string {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-CA', { 
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      return formatter.format(now); // Returns 'YYYY-MM-DD'
    }

    if (action === 'analyze_slate') {
      const today = getEasternDate();
      
      // 1. Fetch active NBA props from unified_props
      const { data: props, error: propsError } = await supabase
        .from('unified_props')
        .select('*')
        .eq('sport', 'basketball_nba')
        .eq('is_active', true)
        .gte('commence_time', today);

      if (propsError) {
        console.error('[Risk Engine v2] Error fetching props:', propsError);
        throw propsError;
      }

      console.log(`[Risk Engine v2] Found ${props?.length || 0} active props`);

      // 2. Fetch upcoming games with spreads
      const { data: games } = await supabase
        .from('upcoming_games_cache')
        .select('*')
        .eq('sport', 'basketball_nba')
        .gte('commence_time', today);

      // 3. Fetch player usage metrics
      const { data: usageMetrics } = await supabase
        .from('player_usage_metrics')
        .select('*');

      // 4. Fetch recent game logs - increased limit to ensure all players covered
      const { data: gameLogs } = await supabase
        .from('nba_player_game_logs')
        .select('*')
        .order('game_date', { ascending: false })
        .limit(10000);
      
      console.log(`[Risk Engine] Fetched ${gameLogs?.length || 0} game logs`);

      const approvedProps: any[] = [];
      const rejectedProps: any[] = [];
      // Track player+prop_type combinations instead of just player
      const processedPlayerProps = new Set<string>();
      // NEW: Track stars used per team (ONE STAR PER TEAM rule)
      const starsUsedByTeam: Record<string, string[]> = {};

      for (const prop of (props || [])) {
        try {
          // Create unique key: player_name + prop_type
          const playerPropKey = `${prop.player_name?.toLowerCase()}_${prop.prop_type}`;
          
          // Skip if we already have this exact prop type from this player
          if (processedPlayerProps.has(playerPropKey)) {
            rejectedProps.push({
              ...prop,
              rejection_reason: 'Duplicate prop type from same player'
            });
            continue;
          }
          
          // Limit total props per player to 2 (e.g., rebounds + assists, but not all 3)
          const playerPropsCount = [...processedPlayerProps].filter(
            key => key.startsWith(prop.player_name?.toLowerCase() + '_')
          ).length;
          
          if (playerPropsCount >= 2) {
            rejectedProps.push({
              ...prop,
              rejection_reason: 'Max 2 props per player reached'
            });
            continue;
          }
          
          // NEW: Check if this is a star player
          const isStar = isStarPlayer(prop.player_name);
          const playerTeam = getPlayerTeamFromName(prop.player_name);
          
          // ONE STAR PER TEAM RULE
          if (isStar && playerTeam) {
            const teamStars = starsUsedByTeam[playerTeam] || [];
            if (teamStars.length >= 1 && !teamStars.includes(prop.player_name?.toLowerCase())) {
              rejectedProps.push({
                ...prop,
                rejection_reason: `One star per team limit: ${teamStars[0]} already selected from ${playerTeam}`
              });
              continue;
            }
          }
          
          // STAR POINTS BLOCK: Deprioritize points for star players
          if (isStar && prop.prop_type?.toLowerCase().includes('points') && 
              !prop.prop_type?.toLowerCase().includes('rebounds') && 
              !prop.prop_type?.toLowerCase().includes('assists')) {
            rejectedProps.push({
              ...prop,
              rejection_reason: 'Star player points blocked - use rebounds/assists instead'
            });
            continue;
          }

          // Find game context
          const game = games?.find(g => 
            g.event_id === prop.event_id ||
            prop.description?.includes(g.home_team) ||
            prop.description?.includes(g.away_team)
          );
          
          // Try to get spread from game, fallback to record differential estimate
          let spread = game?.spread || 0;
          if (spread === 0 && prop.record_differential) {
            // Each 0.1 win % differential ~ 3 point spread
            spread = prop.record_differential * 30;
          }
          
          // STEP 1: Game Script Classification
          const gameScript = classifyGameScript(spread);
          
          // Get player metrics
          const playerUsage = usageMetrics?.find(u => 
            u.player_name?.toLowerCase() === prop.player_name?.toLowerCase()
          );
          
          const avgMinutes = playerUsage?.avg_minutes || 28;
          const usageRate = playerUsage?.usage_rate || 20;
          const position = playerUsage?.position || inferPosition(prop.player_name);
          
          // STEP 2: Player Role Classification (now includes ball-dominant check)
          const role = classifyPlayerRole(usageRate, avgMinutes, position, prop.player_name);
          
          // Determine side (over/under)
          const side = prop.recommended_side || 
            (prop.edge && prop.edge > 0 ? 'over' : 'under') ||
            'over';
          
          // STEP 3 & 4: Blacklist Check (includes Never Fade PRA list and global rules)
          const threePtAttempts = playerUsage?.avg_3pt_attempts || 0;
          const blacklistCheck = isStatBlacklisted(
            prop.prop_type,
            side,
            role,
            gameScript,
            prop.player_name,
            threePtAttempts
          );
          
          if (blacklistCheck.blocked) {
            rejectedProps.push({
              ...prop,
              rejection_reason: blacklistCheck.reason,
              player_role: role,
              game_script: gameScript
            });
            continue;
          }
          
          // STEP 5: PRA Kill Switch (for PRA UNDER plays)
          const killSwitchCheck = passesPRAKillSwitch(
            prop.player_name,
            role,
            gameScript,
            spread,
            prop.prop_type,
            side
          );
          
          if (!killSwitchCheck.passes) {
            rejectedProps.push({
              ...prop,
              rejection_reason: killSwitchCheck.reason,
              player_role: role,
              game_script: gameScript
            });
            continue;
          }
          
          // STEP 6: Clutch Failure Protection
          const clutchCheck = failsClutchProtection(role, gameScript, prop.prop_type, side);
          if (clutchCheck.fails) {
            rejectedProps.push({
              ...prop,
              rejection_reason: clutchCheck.reason,
              player_role: role,
              game_script: gameScript
            });
            continue;
          }
          
          // STEP 7: Allowed Stats Check
          if (!isStatAllowed(prop.prop_type, side, role, gameScript)) {
            rejectedProps.push({
              ...prop,
              rejection_reason: `Stat not allowed for ${role} in ${gameScript}`,
              player_role: role,
              game_script: gameScript
            });
            continue;
          }
          
          // Get player's recent game logs for this stat
          const column = getColumnForProp(prop.prop_type);
          const playerLogs = gameLogs?.filter(log => 
            log.player_name?.toLowerCase() === prop.player_name?.toLowerCase()
          ).slice(0, 10);
          
          // VALIDATION: Reject props with no game log data
          if (!playerLogs || playerLogs.length === 0) {
            console.log(`[Risk Engine] No game logs for ${prop.player_name} - rejecting`);
            rejectedProps.push({
              ...prop,
              rejection_reason: 'No game log data available - cannot calculate median',
              player_role: role,
              game_script: gameScript,
              true_median: -1
            });
            continue;
          }
          
          const statValues = playerLogs?.map(log => {
            // FIXED: Use correct DB column names (points, rebounds, assists)
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
            return log[column] || 0;
          }) || [];
          
          // DEBUG: Log when statValues is empty despite having logs
          if (statValues.length === 0 || statValues.every(v => v === 0)) {
            console.log(`[Risk Engine] Empty/zero stats for ${prop.player_name} (${prop.prop_type}): column=${column}, logs=${playerLogs.length}`);
          }
          
          // STEP 8: Median Bad Game Survival Test (ENHANCED FOR UNDER)
          const { passes: passesBadGame, badGameFloor, reason: badGameReason } = passesMedianBadGameCheck(
            statValues,
            prop.current_line || prop.line,
            side
          );
          
          if (!passesBadGame && statValues.length >= 5) {
            rejectedProps.push({
              ...prop,
              rejection_reason: badGameReason,
              player_role: role,
              game_script: gameScript,
              bad_game_floor: badGameFloor
            });
            continue;
          }
          
          // STEP 8.5: CEILING CHECK FOR UNDERS (50% MAX RULE)
          // Reject UNDER bets where player's L10 MAX exceeds line by >50%
          const ceilingCheck = failsCeilingCheck(statValues, prop.current_line || prop.line, side);
          console.log(`[Risk Engine] Ceiling check for ${prop.player_name} (${prop.prop_type} ${side}): MAX=${ceilingCheck.ceiling}, ratio=${ceilingCheck.ceilingRatio.toFixed(2)}, fails=${ceilingCheck.fails}`);
          if (ceilingCheck.fails) {
            console.log(`[Risk Engine] CEILING REJECT: ${prop.player_name} ${prop.prop_type} - ${ceilingCheck.reason}`);
            rejectedProps.push({
              ...prop,
              rejection_reason: ceilingCheck.reason,
              player_role: role,
              game_script: gameScript,
              ceiling: ceilingCheck.ceiling,
              ceiling_ratio: ceilingCheck.ceilingRatio,
              true_median: calculateMedian(statValues)
            });
            continue;
          }
          
          // STEP 9: Minutes Confidence Filter
          const minutesClass = classifyMinutes(avgMinutes);
          const isOver = side.toLowerCase() === 'over';
          
          if (minutesClass === 'RISKY' && isOver) {
            rejectedProps.push({
              ...prop,
              rejection_reason: 'Risky minutes (≤23) + OVER not allowed',
              player_role: role,
              game_script: gameScript,
              minutes_class: minutesClass
            });
            continue;
          }
          
          // Calculate median and edge
          const trueMedian = calculateMedian(statValues);
          const line = prop.current_line || prop.line;
          const edge = isOver ? trueMedian - line : line - trueMedian;
          
          // STEP 9.5: MEDIAN DEAD-ZONE FILTER (±0.5)
          // If line is within ±0.5 of median → coin-flip with no edge
          if (trueMedian > 0 && isInMedianDeadZone(line, trueMedian)) {
            rejectedProps.push({
              ...prop,
              rejection_reason: `DEAD ZONE: Line ${line} within ±0.5 of median ${trueMedian.toFixed(1)} - no edge`,
              player_role: role,
              game_script: gameScript,
              rolling_median: trueMedian
            });
            continue;
          }
          
          // STEP 9.6: SNEAKY LINE TRAP DETECTION FOR UNDERS
          // If betting UNDER but median is ABOVE line → TRAP (player exceeds line on average)
          if (!isOver && trueMedian > line) {
            const sneakyGap = trueMedian - line;
            if (sneakyGap > 0 && sneakyGap <= 2.5) {  // Median is 0-2.5 above line
              rejectedProps.push({
                ...prop,
                rejection_reason: `SNEAKY LINE TRAP: Median ${trueMedian.toFixed(1)} > line ${line} for UNDER bet`,
                player_role: role,
                game_script: gameScript,
                rolling_median: trueMedian
              });
              continue;
            }
          }
          
          // STEP 10: Confidence Scoring
          const { score, factors, fadeEdge } = calculateConfidence(
            role,
            prop.prop_type,
            side,
            minutesClass,
            gameScript,
            edge,
            passesBadGame
          );
          
          // Check if this qualifies as a Fade Specialist pick
          const isFadeSpecialist = qualifiesAsFadeSpecialist(fadeEdge, role, side);
          
          // Minimum confidence threshold: 7.7
          if (score < 7.7) {
            rejectedProps.push({
              ...prop,
              rejection_reason: `Confidence ${score.toFixed(1)} < 7.7 threshold`,
              player_role: role,
              game_script: gameScript,
              confidence_score: score
            });
            continue;
          }
          
          // APPROVED!
          const isPRA = isPRAPlay(prop.prop_type);
          const reason = generateReason(role, gameScript, edge, minutesClass, side, isPRA);
          
          // For stars, check favorable matchup
          const propIsStar = isStarPlayer(prop.player_name);
          const propTeam = getPlayerTeamFromName(prop.player_name);
          
          if (propIsStar && !hasFavorableMatchup(spread, gameScript)) {
            rejectedProps.push({
              ...prop,
              rejection_reason: `Star player ${prop.player_name} lacks favorable matchup (spread: ${spread}, script: ${gameScript})`
            });
            continue;
          }
          
          // Fetch live odds if enabled
          let liveOdds = null;
          if (use_live_odds && prop.event_id) {
            liveOdds = await fetchLiveOdds(prop.event_id, prop.player_name, prop.prop_type);
            console.log(`[Risk Engine v2] Live odds for ${prop.player_name}: ${JSON.stringify(liveOdds)}`);
          }
          
          // Calculate stat priority boost (higher = better)
          const statPriority = getStatPriority(prop.prop_type);
          const priorityBoost = statPriority >= 9 ? 0.3 : (statPriority >= 7 ? 0.15 : 0);
          const adjustedScore = score + priorityBoost;
          
          approvedProps.push({
            player_name: prop.player_name,
            team_name: prop.team_name,
            opponent: game?.away_team === prop.team_name ? game?.home_team : game?.away_team,
            prop_type: prop.prop_type,
            line,
            side,
            player_role: role,
            game_script: gameScript,
            minutes_class: minutesClass,
            avg_minutes: avgMinutes,
            usage_rate: usageRate,
            spread,
            true_median: trueMedian,
            edge,
            bad_game_floor: badGameFloor,
            confidence_score: adjustedScore,
            confidence_factors: factors,
            reason,
            event_id: prop.event_id,
            game_date: today,
            is_pra: isPRA,
            is_ball_dominant: role === 'BALL_DOMINANT_STAR',
            is_star: propIsStar,
            stat_priority: statPriority,
            // Live odds data
            current_line: liveOdds?.line || line,
            over_price: liveOdds?.overPrice,
            under_price: liveOdds?.underPrice,
            bookmaker: liveOdds?.bookmaker || prop.bookmaker,
            odds_updated_at: liveOdds ? new Date().toISOString() : null,
            // Fade Mode fields
            is_fade_specialist: isFadeSpecialist,
            fade_edge_tag: fadeEdge.tag,
          });
          
          processedPlayerProps.add(playerPropKey);
          
          // Track star usage per team
          if (propIsStar && propTeam) {
            if (!starsUsedByTeam[propTeam]) {
              starsUsedByTeam[propTeam] = [];
            }
            if (!starsUsedByTeam[propTeam].includes(prop.player_name?.toLowerCase())) {
              starsUsedByTeam[propTeam].push(prop.player_name?.toLowerCase());
            }
          }
        } catch (propError: unknown) {
          const errorMessage = propError instanceof Error ? propError.message : 'Unknown error';
          console.error(`[Risk Engine v2] Error processing ${prop.player_name}:`, propError);
          rejectedProps.push({
            ...prop,
            rejection_reason: `Processing error: ${errorMessage}`
          });
          continue;
        }
      }
      
      // Sort by confidence (prefer non-PRA plays with equal confidence)
      approvedProps.sort((a, b) => {
        // First by confidence
        if (b.confidence_score !== a.confidence_score) {
          return b.confidence_score - a.confidence_score;
        }
        // Prefer non-PRA plays
        if (a.is_pra !== b.is_pra) {
          return a.is_pra ? 1 : -1;
        }
        return 0;
      });
      
      // Mode-based filtering
      let finalPicks = approvedProps;
      let noPlayWarning: string | null = null;
      
      if (mode === 'daily_hitter') {
        finalPicks = approvedProps
          .filter(p => p.confidence_score >= 8.2)
          .slice(0, 3);
      } else if (mode === 'fade_specialist') {
        // FADE MODE: Only high-edge Under plays
        finalPicks = approvedProps
          .filter(p => p.is_fade_specialist === true)
          .sort((a, b) => {
            // Sort by fade edge tag priority: ELITE > EDGE > COMBO
            const tagPriority: Record<string, number> = {
              'FADE_ELITE': 3,
              'FADE_EDGE': 2,
              'FADE_COMBO': 1,
            };
            const aPriority = tagPriority[a.fade_edge_tag] || 0;
            const bPriority = tagPriority[b.fade_edge_tag] || 0;
            if (bPriority !== aPriority) return bPriority - aPriority;
            return b.confidence_score - a.confidence_score;
          })
          .slice(0, 10); // Max 10 fade specialist picks
      }
      
      // NO PLAY Logic: If fewer than 2 props qualify → warn
      if (finalPicks.length < 2) {
        noPlayWarning = 'NO_PLAY_RECOMMENDED: Fewer than 2 props qualify - consider skipping this slate';
        console.log(`[Risk Engine v2] ${noPlayWarning}`);
      }
      
      // Store approved picks in database
      if (finalPicks.length > 0) {
        const { error: insertError } = await supabase
          .from('nba_risk_engine_picks')
          .upsert(
            finalPicks.map(pick => ({
              ...pick,
              mode,
              created_at: new Date().toISOString()
            })),
            { onConflict: 'player_name,game_date,prop_type' }
          );
        
        if (insertError) {
          console.error('[Risk Engine v2] Error storing picks:', insertError);
        }
      }
      
      console.log(`[Risk Engine v2] Approved: ${finalPicks.length}, Rejected: ${rejectedProps.length}`);
      
      return new Response(JSON.stringify({
        success: true,
        approvedCount: finalPicks.length,
        rejectedCount: rejectedProps.length,
        approved: finalPicks,
        rejected: rejectedProps.slice(0, 20), // Limit rejected for response size
        mode,
        gameDate: today,
        warning: noPlayWarning,
        engineVersion: 'v2.0 - Never Fade PRA + Kill Switch + Clutch Protection'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (action === 'get_picks') {
      const today = new Date().toISOString().split('T')[0];
      
      let query = supabase
        .from('nba_risk_engine_picks')
        .select('*')
        .eq('game_date', today)
        .order('confidence_score', { ascending: false });
      
      if (mode === 'daily_hitter') {
        query = query.gte('confidence_score', 8.2).limit(3);
      } else if (mode === 'fade_specialist') {
        query = query.eq('is_fade_specialist', true).limit(10);
      }
      
      const { data: picks, error } = await query;
      
      if (error) {
        throw error;
      }
      
      return new Response(JSON.stringify({
        success: true,
        picks: picks || [],
        mode,
        engineVersion: 'v2.0'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ 
      error: 'Invalid action. Use "analyze_slate" or "get_picks"' 
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Risk Engine v2] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ 
      success: false,
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
