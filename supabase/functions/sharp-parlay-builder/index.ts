import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ========================
// CONFIGURATION & CONSTANTS
// ========================

const MINUTES_THRESHOLD = 24;

// Stars with proven blowout immunity - never fade their PRA
const BLOWOUT_IMMUNITY_STARS = [
  'luka doncic', 'jayson tatum', 'nikola jokic', 'giannis antetokounmpo',
  'shai gilgeous-alexander', 'anthony edwards', 'kevin durant', 'stephen curry',
  'lebron james', 'joel embiid', 'damian lillard', 'donovan mitchell',
  'trae young', 'devin booker', 'tyrese haliburton', 'anthony davis'
];

// All star players (for one-star-per-parlay rule)
const ALL_STAR_PLAYERS = [
  ...BLOWOUT_IMMUNITY_STARS,
  'jaylen brown', 'kyrie irving', 'jalen brunson', 'lamelo ball',
  'de\'aaron fox', 'deaaron fox', 'ja morant', 'tyrese maxey'
];

function isStarPlayer(playerName: string): boolean {
  const normalized = playerName?.toLowerCase() || '';
  return ALL_STAR_PLAYERS.some(star => normalized.includes(star));
}

// Never fade PRA on these players regardless of spread
const NEVER_FADE_PRA = [
  'luka doncic', 'nikola jokic', 'jayson tatum', 'giannis antetokounmpo',
  'shai gilgeous-alexander', 'lebron james', 'kevin durant'
];

// Role locks by stat type - BIG allowed for rebounds, WING for all core stats
const ROLE_STAT_LOCKS = {
  rebounds: ['C', 'PF', 'F-C', 'C-F', 'SF', 'BIG', 'WING'],  // BIG + WING allowed
  assists: ['PG', 'SG', 'G', 'PG-SG', 'SG-PG', 'SF', 'GUARD', 'WING'],  // GUARD + WING allowed
  points: ['PG', 'SG', 'SF', 'G', 'GUARD', 'WING'],  // Allow for non-BIG roles
  threes: 'VOLUME_CHECK'
};

// Stat priority for scoring (rebounds/assists >> points)
const STAT_PRIORITY: Record<string, number> = {
  'rebounds': 10,
  'assists': 9,
  'blocks': 7,
  'steals': 6,
  'threes': 4,
  'points': 2  // Lowest - deprioritized
};

function getStatPriority(propType: string): number {
  const lower = propType?.toLowerCase() || '';
  for (const [stat, priority] of Object.entries(STAT_PRIORITY)) {
    if (lower.includes(stat)) return priority;
  }
  return 5;
}

// High volatility stats (limit in parlays)
const HIGH_VOLATILITY_STATS = ['blocks', 'steals', 'turnovers', 'threes', '3-pointers'];

// Parlay configuration
const PARLAY_CONFIGS = {
  SAFE: { minLegs: 2, maxLegs: 3, maxVolatilityLegs: 0, confidenceThreshold: 0.65 },
  BALANCED: { minLegs: 3, maxLegs: 4, maxVolatilityLegs: 1, confidenceThreshold: 0.55 },
  UPSIDE: { minLegs: 3, maxLegs: 4, maxVolatilityLegs: 1, confidenceThreshold: 0.45 }
};

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
  return name?.toLowerCase().trim() || '';
}

function normalizePropType(propType: string): string {
  return propType?.toLowerCase().replace(/[_\s]/g, '') || '';
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
  
  if (BLOWOUT_IMMUNITY_STARS.includes(normalizedName)) {
    return { passes: true, reason: `Star exception (${avgMinutes.toFixed(1)} min)` };
  }
  
  return { passes: false, reason: `${avgMinutes.toFixed(1)} min < ${MINUTES_THRESHOLD} threshold` };
}

// RULE 2: Median Engine (L5 & L10 games) + Dead-Zone Filter + SIDE-AWARE LOGIC
function passesMedianRule(
  gameLogs: number[], 
  line: number, 
  parlayType: string,
  side: string  // NEW: 'over' or 'under' - CRITICAL for correct validation
): { passes: boolean; median5: number; median10: number; edge: number; reason: string } {
  const last5 = gameLogs.slice(0, 5);
  const last10 = gameLogs.slice(0, 10);
  
  const median5 = calculateMedian(last5);
  const median10 = calculateMedian(last10);
  
  const isUnder = side?.toLowerCase() === 'under';
  
  // CRITICAL FIX: For UNDER, use LOWER median; for OVER, use HIGHER median
  const bestMedian = isUnder 
    ? Math.min(median5, median10)  // For UNDER, pessimistic = lower median
    : Math.max(median5, median10); // For OVER, optimistic = higher median
  
  // Edge calculation: positive = good for OVER, flip for UNDER
  const rawEdge = ((bestMedian - line) / line) * 100;
  const edge = isUnder ? -rawEdge : rawEdge;  // Flip sign for under (negative rawEdge = good)
  
  // DEAD-ZONE CHECK: If line is within ±0.5 of median → NO EDGE (coin-flip)
  const medianGap = Math.abs(line - bestMedian);
  if (medianGap <= 0.5) {
    return {
      passes: false,
      median5,
      median10,
      edge: 0,
      reason: `DEAD ZONE: Line ${line} within ±0.5 of median ${bestMedian.toFixed(1)} - no edge`
    };
  }
  
  // SNEAKY LINE TRAP DETECTION: Vegas sets line just above median for unders
  // Example: Player averages 8 rebounds, line is 7.5 under → TRAP
  if (isUnder && bestMedian > line) {
    const sneakyGap = bestMedian - line;
    if (sneakyGap <= 2.0) {  // Line is set 0.5-2.0 below median → SNEAKY TRAP
      return {
        passes: false,
        median5,
        median10,
        edge: 0,
        reason: `SNEAKY LINE: Median ${bestMedian.toFixed(1)} > line ${line} → under is trap`
      };
    }
  }
  
  // Upside builds allow 10% buffer
  const isUpsideBuild = parlayType === 'UPSIDE';
  
  if (isUnder) {
    // FOR UNDER: Median must be BELOW line (player underperforms line)
    // Require at least 10% buffer for safety
    const threshold = isUpsideBuild ? line * 1.05 : line * 0.90;  // 10% below line
    const passes = median5 <= threshold || median10 <= threshold;
    
    if (passes) {
      return { 
        passes: true, 
        median5, 
        median10, 
        edge,
        reason: `UNDER valid: L5 ${median5.toFixed(1)}, L10 ${median10.toFixed(1)} below line ${line}`
      };
    }
    
    return { 
      passes: false, 
      median5, 
      median10, 
      edge,
      reason: `UNDER INVALID: Medians (${median5.toFixed(1)}/${median10.toFixed(1)}) >= line ${line} - player exceeds line`
    };
  } else {
    // FOR OVER: Median must be ABOVE line (player exceeds line)
    const threshold = isUpsideBuild ? line * 0.90 : line;
    const passes = median5 >= threshold || median10 >= threshold;
    
    if (passes) {
      return { 
        passes: true, 
        median5, 
        median10, 
        edge,
        reason: `OVER valid: L5 ${median5.toFixed(1)}, L10 ${median10.toFixed(1)}, edge ${edge > 0 ? '+' : ''}${edge.toFixed(1)}%`
      };
    }
    
    return { 
      passes: false, 
      median5, 
      median10, 
      edge,
      reason: `OVER INVALID: Medians (${median5.toFixed(1)}/${median10.toFixed(1)}) below threshold ${threshold.toFixed(1)}`
    };
  }
}

// RULE 3: Role Lock (Position-based stat validation)
function passesRoleLock(
  propType: string, 
  position: string, 
  threeAttempts?: number, 
  threeMakes?: number,
  playerRole?: string
): { passes: boolean; reason: string } {
  const normalizedProp = normalizePropType(propType);
  const normalizedPosition = position?.toUpperCase() || '';
  const role = playerRole?.toUpperCase() || '';
  
  // Rebounds: BIG, WING, or traditional big positions
  if (normalizedProp.includes('rebound')) {
    const validPositions = ROLE_STAT_LOCKS.rebounds as string[];
    const positionMatch = validPositions.some(p => normalizedPosition.includes(p));
    const roleMatch = role === 'BIG' || role === 'WING' || role === 'STAR';
    if (positionMatch || roleMatch) {
      return { passes: true, reason: `${role || normalizedPosition} valid for rebounds` };
    }
    return { passes: false, reason: `${role || normalizedPosition} not ideal for rebounds` };
  }
  
  // Assists: GUARD, WING, or ball handler positions
  if (normalizedProp.includes('assist')) {
    const validPositions = ROLE_STAT_LOCKS.assists as string[];
    const positionMatch = validPositions.some(p => normalizedPosition.includes(p));
    const roleMatch = role === 'GUARD' || role === 'SECONDARY_GUARD' || role === 'WING' || role === 'STAR' || role === 'BALL_DOMINANT_STAR';
    if (positionMatch || roleMatch) {
      return { passes: true, reason: `${role || normalizedPosition} is ball handler` };
    }
    return { passes: false, reason: `${role || normalizedPosition} not primary ball handler` };
  }
  
  // Points: Allow all except pure BIG role
  if (normalizedProp.includes('points') && !normalizedProp.includes('rebound') && !normalizedProp.includes('assist')) {
    if (role === 'BIG') {
      return { passes: false, reason: `BIG role not ideal for points-only` };
    }
    return { passes: true, reason: `${role || normalizedPosition} valid for points` };
  }
  
  // Threes: Volume check (attempts > makes)
  if (normalizedProp.includes('three') || normalizedProp.includes('3pt') || normalizedProp.includes('3-pointer')) {
    if (threeAttempts && threeMakes && threeAttempts > threeMakes) {
      return { passes: true, reason: `Volume shooter (${threeAttempts.toFixed(1)} 3PA)` };
    }
    return { passes: true, reason: 'Volume check skipped (no data)' };
  }
  
  // PRA, combo stats - all positions valid
  return { passes: true, reason: 'Position-agnostic stat' };
}

// RULE 4: Blowout Filter (Spread ≥ 12)
function passesBlowoutFilter(
  spread: number | null, 
  propType: string, 
  side: string, 
  playerName: string
): { passes: boolean; reason: string; recommendation?: string } {
  if (!spread || Math.abs(spread) < 12) {
    return { passes: true, reason: 'Competitive game (spread < 12)' };
  }
  
  const normalizedName = normalizePlayerName(playerName);
  const normalizedProp = normalizePropType(propType);
  const normalizedSide = side?.toLowerCase() || '';
  
  const isPRA = normalizedProp.includes('pra') || 
                normalizedProp.includes('points') && normalizedProp.includes('rebounds') && normalizedProp.includes('assists');
  const isUnder = normalizedSide === 'under';
  
  // Never fade PRA override
  if (NEVER_FADE_PRA.includes(normalizedName)) {
    return { passes: true, reason: `${playerName} never-fade star (blowout override)` };
  }
  
  // In blowouts, avoid PRA unders on stars
  if (isPRA && isUnder) {
    return { 
      passes: false, 
      reason: `Blowout risk: PRA under on star`,
      recommendation: 'Use rebounds, assists, or attempts instead'
    };
  }
  
  // Favor rebounds/assists in blowouts
  if (normalizedProp.includes('rebound') || normalizedProp.includes('assist')) {
    return { passes: true, reason: 'Blowout-safe stat (rebounds/assists)' };
  }
  
  return { passes: true, reason: `Spread ${spread}, standard blowout filter passed` };
}

// RULE 5: Volatility Control
function isVolatileLeg(propType: string): boolean {
  const normalizedProp = normalizePropType(propType);
  return HIGH_VOLATILITY_STATS.some(v => normalizedProp.includes(v.toLowerCase().replace(/[_\s-]/g, '')));
}

// RULE 6: Public Trap Detection
function detectPublicTrap(
  odds: number, 
  lineMovement?: number, 
  hasInjuryNews?: boolean
): { isTrap: boolean; reason: string; alternatives?: string[] } {
  // Heavy juice detection (worse than -130)
  const heavyJuice = odds < -130 || odds > 130;
  
  // Suspicious movement without injury (1.5+ point swing)
  const suspiciousMovement = Math.abs(lineMovement || 0) >= 1.5 && !hasInjuryNews;
  
  if (heavyJuice) {
    return {
      isTrap: true,
      reason: `Heavy juice detected (${odds})`,
      alternatives: ['Consider ALT lines', 'Use attempts instead of makes', 'Consider PRA instead of single stat']
    };
  }
  
  if (suspiciousMovement) {
    return {
      isTrap: true,
      reason: `Suspicious line movement (${lineMovement} pts) without injury news`,
      alternatives: ['Wait for clarity', 'Consider opposite side', 'Use ALT lines']
    };
  }
  
  return { isTrap: false, reason: 'Clean line' };
}

// ========================
// MAIN ENGINE LOGIC
// ========================

interface CandidateLeg {
  player_name: string;
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
  const formatter = new Intl.DateTimeFormat('en-CA', { 
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(now); // Returns 'YYYY-MM-DD'
}

async function buildSharpParlays(supabase: any): Promise<any> {
  console.log('[Sharp Parlay Builder] Starting engine...');
  
  // Fetch today's props from unified_props or nba_risk_engine_picks
  const today = getEasternDate();
  
  const { data: props, error: propsError } = await supabase
    .from('nba_risk_engine_picks')
    .select('*')
    .eq('game_date', today)
    .is('rejection_reason', null);
  
  if (propsError) {
    console.error('[Sharp Parlay Builder] Error fetching props:', propsError);
    throw propsError;
  }
  
  console.log(`[Sharp Parlay Builder] Found ${props?.length || 0} approved props for ${today}`);
  
  if (!props || props.length === 0) {
    return { 
      message: 'No approved props available for today', 
      parlays: null,
      candidates_evaluated: 0,
      candidates_passed: 0,
      saved: []
    };
  }
  
  // Fetch game logs for median calculation
  const playerNames = [...new Set(props.map((p: any) => p.player_name))];
  
  const { data: gameLogs, error: gameLogsError } = await supabase
    .from('nba_player_game_logs')
    .select('*')
    .in('player_name', playerNames)
    .order('game_date', { ascending: false });
  
  if (gameLogsError) {
    console.error('[Sharp Parlay Builder] Error fetching game logs:', gameLogsError);
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
    .from('player_usage_metrics')
    .select('player_name, position, avg_minutes, avg_three_attempts, avg_three_made')
    .in('player_name', playerNames);
  
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
    const propSide = prop.side || 'over';
    const medianResult = passesMedianRule(statValues, prop.line, 'SAFE', propSide);
    if (!medianResult.passes) {
      // Try again with UPSIDE threshold
      const upsideMedianResult = passesMedianRule(statValues, prop.line, 'UPSIDE', propSide);
      if (!upsideMedianResult.passes) {
        console.log(`[Sharp Builder] ${prop.player_name} ${prop.prop_type} ${propSide} failed median: ${medianResult.reason}`);
        continue;
      }
    }
    
    // RULE 3: Role lock
    const position = usage.position || prop.position || '';
    const roleResult = passesRoleLock(
      prop.prop_type, 
      position, 
      usage.avg_three_attempts, 
      usage.avg_three_made,
      prop.player_role  // Pass player_role from Risk Engine picks
    );
    if (!roleResult.passes) {
      console.log(`[Sharp Builder] ${prop.player_name} failed role lock: ${roleResult.reason}`);
      continue;
    }
    
    // RULE 4: Blowout filter
    const blowoutResult = passesBlowoutFilter(
      prop.spread || null,
      prop.prop_type,
      prop.side,
      prop.player_name
    );
    if (!blowoutResult.passes) {
      console.log(`[Sharp Builder] ${prop.player_name} failed blowout filter: ${blowoutResult.reason}`);
      continue;
    }
    
    // RULE 5: Check volatility (for later filtering)
    const isVolatile = isVolatileLeg(prop.prop_type);
    
    // RULE 5.5: CEILING CHECK (50% MAX RULE) - For UNDER bets only
    const isUnderBet = propSide?.toLowerCase() === 'under';
    if (isUnderBet && statValues.length >= 5) {
      const ceiling = Math.max(...statValues);
      const ceilingRatio = ceiling / prop.line;
      if (ceilingRatio > 1.5) {
        console.log(`[Sharp Builder] ${prop.player_name} ${prop.prop_type} UNDER failed ceiling check: MAX ${ceiling} is ${Math.round((ceilingRatio - 1) * 100)}% above line ${prop.line}`);
        continue;
      }
    }
    
    // RULE 6: Public trap detection
    const trapResult = detectPublicTrap(prop.odds || -110, prop.line_movement, prop.has_injury_news);
    
    // Calculate confidence score
    const baseConfidence = prop.confidence_score || 0.5;
    let adjustedConfidence = baseConfidence;
    
    // Boost for strong median edge
    if (medianResult.edge > 10) adjustedConfidence += 0.1;
    else if (medianResult.edge > 5) adjustedConfidence += 0.05;
    
    // Penalty for trap signals
    if (trapResult.isTrap) adjustedConfidence -= 0.1;
    
    // Penalty for volatility
    if (isVolatile) adjustedConfidence -= 0.05;
    
    // NEW: Stat priority boost (rebounds/assists >> points)
    const statPriority = getStatPriority(prop.prop_type);
    if (statPriority >= 9) adjustedConfidence += 0.15;  // Rebounds/assists boost
    else if (statPriority >= 7) adjustedConfidence += 0.08;  // Blocks/steals boost
    else if (statPriority <= 2) adjustedConfidence -= 0.20;  // Points penalty
    
    // NEW: Star player with points = heavy penalty
    const isStar = isStarPlayer(prop.player_name);
    if (isStar && prop.prop_type?.toLowerCase().includes('points')) {
      adjustedConfidence -= 0.25;  // Stars should use rebounds/assists
    }
    
    // NEW: Fade Specialist bonus from Risk Engine
    const isFadeSpecialist = prop.is_fade_specialist === true;
    const fadeEdgeTag = prop.fade_edge_tag || null;
    
    if (isFadeSpecialist) {
      // Boost based on fade edge tier
      if (fadeEdgeTag === 'FADE_ELITE') adjustedConfidence += 0.20;
      else if (fadeEdgeTag === 'FADE_EDGE') adjustedConfidence += 0.12;
      else if (fadeEdgeTag === 'FADE_COMBO') adjustedConfidence += 0.08;
    }
    
    adjustedConfidence = Math.max(0.1, Math.min(0.95, adjustedConfidence));
    
    // Build rationale (one-line, role + median based)
    const statType = statPriority >= 9 ? '(preferred)' : statPriority <= 2 ? '(low priority)' : '';
    const fadeTag = isFadeSpecialist ? ` [${fadeEdgeTag}]` : '';
    const rationale = `${position || 'Player'}, L5 median ${medianResult.median5.toFixed(1)}, L10 median ${medianResult.median10.toFixed(1)}, ${medianResult.edge > 0 ? '+' : ''}${medianResult.edge.toFixed(1)}% edge ${statType}${fadeTag}`;
    
    candidates.push({
      player_name: prop.player_name,
      prop_type: prop.prop_type,
      line: prop.line,
      side: prop.side || 'over',
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
      rationale,
      rules_passed: {
        minutes: minutesResult.passes,
        median: medianResult.passes,
        role_lock: roleResult.passes,
        blowout_filter: blowoutResult.passes,
        public_trap: !trapResult.isTrap
      }
    });
  }
  
  console.log(`[Sharp Parlay Builder] ${candidates.length} candidates passed all rules`);
  
  // Sort candidates by confidence
  candidates.sort((a, b) => b.confidence_score - a.confidence_score);
  
  // Build the three parlay types
  const parlays = {
    SAFE: buildParlay(candidates, 'SAFE'),
    BALANCED: buildParlay(candidates, 'BALANCED'),
    UPSIDE: buildParlay(candidates, 'UPSIDE')
  };
  
  // Save parlays to database
  const savedParlays = [];
  for (const [parlayType, legs] of Object.entries(parlays)) {
    if (legs && legs.length >= PARLAY_CONFIGS[parlayType as keyof typeof PARLAY_CONFIGS].minLegs) {
      const totalOdds = calculateParlayOdds(legs);
      const combinedProb = calculateCombinedProbability(legs);
      
      const { data: saved, error: saveError } = await supabase
        .from('sharp_ai_parlays')
        .insert({
          parlay_date: today,
          parlay_type: parlayType,
          legs: legs.map(l => ({
            player: l.player_name,
            prop: l.prop_type,
            line: l.line,
            side: l.side,
            odds: l.odds,
            confidence_tier: getConfidenceTier(l.confidence_score),
            rationale: l.rationale,
            is_fade_specialist: l.is_fade_specialist || false,
            fade_edge_tag: l.fade_edge_tag || null
          })),
          total_odds: totalOdds,
          combined_probability: combinedProb,
          rule_compliance: { all_rules_passed: true },
          model_version: 'v1'
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
      UPSIDE: parlays.UPSIDE?.length || 0
    },
    saved: savedParlays
  };
}

function extractStatValues(logs: any[], propType: string): number[] {
  const normalizedProp = normalizePropType(propType);
  
  return logs.slice(0, 10).map((log: any) => {
    if (normalizedProp.includes('point')) {
      if (normalizedProp.includes('rebound') && normalizedProp.includes('assist')) {
        return (log.points || 0) + (log.rebounds || 0) + (log.assists || 0);
      }
      return log.points || 0;
    }
    if (normalizedProp.includes('rebound')) return log.rebounds || 0;
    if (normalizedProp.includes('assist')) return log.assists || 0;
    if (normalizedProp.includes('three') || normalizedProp.includes('3pt')) return log.three_pointers_made || 0;
    if (normalizedProp.includes('block')) return log.blocks || 0;
    if (normalizedProp.includes('steal')) return log.steals || 0;
    return log.points || 0;
  }).filter((v: number) => v > 0);
}

// Helper to categorize prop types for diversity
function getPropCategory(propType: string): string {
  const lower = propType?.toLowerCase() || '';
  if (lower.includes('rebound')) return 'rebounds';
  if (lower.includes('assist')) return 'assists';
  if (lower.includes('point') && !lower.includes('rebound') && !lower.includes('assist')) return 'points';
  if (lower.includes('three') || lower.includes('3pt')) return 'threes';
  if (lower.includes('block')) return 'blocks';
  if (lower.includes('steal')) return 'steals';
  return 'other';
}

function buildParlay(candidates: CandidateLeg[], parlayType: keyof typeof PARLAY_CONFIGS): CandidateLeg[] {
  const config = PARLAY_CONFIGS[parlayType];
  const legs: CandidateLeg[] = [];
  const usedPlayers = new Set<string>();
  const usedCategories = new Set<string>();  // NEW: Track prop categories for diversity
  let volatileCount = 0;
  let starCount = 0;  // Track star count (max 1 per parlay)
  
  // Filter candidates by confidence threshold
  const eligibleCandidates = candidates.filter(c => c.confidence_score >= config.confidenceThreshold);
  
  // For UPSIDE, include lower confidence candidates but still sort by confidence
  const pool = parlayType === 'UPSIDE' 
    ? candidates.filter(c => c.confidence_score >= 0.35)
    : eligibleCandidates;
  
  // Sort by stat priority (rebounds/assists first), then by fade specialist status, then confidence
  pool.sort((a, b) => {
    // First: Prioritize fade specialists in SAFE parlays
    if (parlayType === 'SAFE') {
      const aFade = (a as any).is_fade_specialist ? 1 : 0;
      const bFade = (b as any).is_fade_specialist ? 1 : 0;
      if (bFade !== aFade) return bFade - aFade;
    }
    
    // Second: by stat priority (higher = better)
    const aPriority = (a as any).stat_priority || getStatPriority(a.prop_type);
    const bPriority = (b as any).stat_priority || getStatPriority(b.prop_type);
    if (bPriority !== aPriority) return bPriority - aPriority;
    
    // Third: by confidence
    return b.confidence_score - a.confidence_score;
  });
  
  // First pass: prefer diverse prop types
  for (const candidate of pool) {
    if (usedPlayers.has(normalizePlayerName(candidate.player_name))) continue;
    
    const isStar = (candidate as any).is_star || isStarPlayer(candidate.player_name);
    if (isStar && starCount >= 1) continue;
    
    const category = getPropCategory(candidate.prop_type);
    
    // DIVERSITY: Skip if we already have this category (first pass only)
    if (usedCategories.has(category) && legs.length < config.maxLegs - 1) continue;
    
    if (candidate.is_volatile) {
      if (volatileCount >= config.maxVolatilityLegs) continue;
      volatileCount++;
    }
    
    legs.push(candidate);
    usedPlayers.add(normalizePlayerName(candidate.player_name));
    usedCategories.add(category);
    if (isStar) starCount++;
    
    if (legs.length >= config.maxLegs) break;
  }
  
  // Second pass: fill remaining slots ignoring diversity
  if (legs.length < config.minLegs) {
    for (const candidate of pool) {
      if (usedPlayers.has(normalizePlayerName(candidate.player_name))) continue;
      
      const isStar = (candidate as any).is_star || isStarPlayer(candidate.player_name);
      if (isStar && starCount >= 1) continue;
      
      if (candidate.is_volatile) {
        if (volatileCount >= config.maxVolatilityLegs) continue;
        volatileCount++;
      }
      
      legs.push(candidate);
      usedPlayers.add(normalizePlayerName(candidate.player_name));
      if (isStar) starCount++;
      
      if (legs.length >= config.maxLegs) break;
    }
  }
  
  // Log diversity status
  const categories = legs.map(l => getPropCategory(l.prop_type));
  const uniqueCategories = new Set(categories).size;
  console.log(`[Sharp Builder] ${parlayType} parlay: ${legs.length} legs, ${uniqueCategories} unique categories: ${categories.join(', ')}`);
  
  return legs;
}

function calculateParlayOdds(legs: CandidateLeg[]): number {
  let decimal = 1;
  for (const leg of legs) {
    const odds = leg.odds;
    if (odds > 0) {
      decimal *= (odds / 100) + 1;
    } else {
      decimal *= (100 / Math.abs(odds)) + 1;
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
  if (score >= 0.65) return 'HIGH';
  if (score >= 0.50) return 'MEDIUM';
  return 'UPSIDE';
}

// ========================
// SERVER HANDLER
// ========================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action } = await req.json().catch(() => ({ action: 'build' }));
    
    console.log(`[Sharp Parlay Builder] Action: ${action}`);

    let result;
    
    if (action === 'build') {
      result = await buildSharpParlays(supabase);
    } else if (action === 'fetch') {
      // Fetch today's parlays
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('sharp_ai_parlays')
        .select('*')
        .eq('parlay_date', today)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      result = { parlays: data };
    } else {
      result = { error: 'Unknown action. Use "build" or "fetch"' };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Sharp Parlay Builder] Error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
