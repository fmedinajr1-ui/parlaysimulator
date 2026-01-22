import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// GAME ENVIRONMENT VALIDATOR - Vegas Math Pre-Filter for 6-Leg Optimal Parlay
// ============================================================================
// Validates props against: Implied Totals, Pace, Defense, Game Script, Role
// Output: APPROVED (🟢) / CONDITIONAL (🟡) / REJECTED (🔴) + justification
// ============================================================================

// Helper: Get current date in Eastern Time
function getEasternDate(): string {
  const now = new Date();
  const eastern = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return eastern.toISOString().split('T')[0];
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface PropToValidate {
  player_name: string;
  prop_type: string;
  side: string;
  line: number;
  team_name?: string;
  opponent_team?: string;
  archetype?: string;
}

interface GameEnvironment {
  home_team: string;
  away_team: string;
  vegas_total: number;
  vegas_spread: number;
  game_script?: string;
  blowout_probability?: number;
  garbage_time_risk?: number;
}

interface ValidationResult {
  status: 'APPROVED' | 'CONDITIONAL' | 'REJECTED';
  emoji: '🟢' | '🟡' | '🔴';
  justification: string;
  checks: {
    implied_total: boolean;
    pace: boolean;
    defense: boolean;
    role: boolean;
    game_script: boolean;
    prop_type: boolean;
  };
  confidenceAdjustment: number;
  details: {
    teamImplied?: number;
    expectedPace?: number;
    paceClass?: string;
    defenseRank?: number;
    playerRole?: string;
    avgMinutes?: number;
  };
}

type PlayerRole = 'PRIMARY' | 'SECONDARY' | 'ROLE' | 'BENCH';
type PaceClass = 'FAST' | 'NEUTRAL' | 'SLOW';

// ============================================================================
// CONSTANTS & THRESHOLDS
// ============================================================================

// Maximum percentage of team implied total a player can clear
const PROP_TO_TEAM_RATIO: Record<string, number> = {
  points: 0.35,           // Star scorer max 35% of team points
  player_points: 0.35,
  pra: 0.50,              // PRA max 50% of team implied
  player_points_rebounds_assists: 0.50,
  pr: 0.40,               // Points+Rebounds max 40%
  player_points_rebounds: 0.40,
  pa: 0.45,               // Points+Assists max 45%
  player_points_assists: 0.45,
  rebounds: 0.15,         // Rebounds max 15% of total missed shots proxy
  player_rebounds: 0.15,
  assists: 0.25,          // Assists max 25% of team FGM proxy
  player_assists: 0.25,
  threes: 0.12,           // 3PM max 12% of team points (3s worth 3 pts each)
  player_threes: 0.12,
};

// Pace thresholds
const PACE_FAST_THRESHOLD = 102;
const PACE_SLOW_THRESHOLD = 98;

// Pace effect matrix: how pace class affects each prop type
const PACE_EFFECTS: Record<PaceClass, Record<string, 'BOOST' | 'NEUTRAL' | 'PENALTY'>> = {
  FAST: { 
    points: 'BOOST', threes: 'BOOST', assists: 'BOOST', 
    rebounds: 'NEUTRAL', pra: 'BOOST', pr: 'NEUTRAL', pa: 'BOOST' 
  },
  NEUTRAL: { 
    points: 'NEUTRAL', threes: 'NEUTRAL', assists: 'NEUTRAL', 
    rebounds: 'NEUTRAL', pra: 'NEUTRAL', pr: 'NEUTRAL', pa: 'NEUTRAL' 
  },
  SLOW: { 
    points: 'PENALTY', threes: 'PENALTY', assists: 'PENALTY', 
    rebounds: 'BOOST', pra: 'PENALTY', pr: 'NEUTRAL', pa: 'PENALTY' 
  }
};

// Defense rank thresholds (1 = best defense, 30 = worst)
const ELITE_DEFENSE_RANK = 5;    // Top 5 = elite
const WEAK_DEFENSE_RANK = 25;    // Bottom 6 = weak

// Minutes thresholds for player role classification
const PRIMARY_MINUTES = 32;
const SECONDARY_MINUTES = 24;
const ROLE_MINUTES = 15;

// Blowout spread threshold
const BLOWOUT_SPREAD = 8;

// ============================================================================
// CORE VALIDATION FUNCTIONS
// ============================================================================

/**
 * Classify player role based on average minutes
 */
function getPlayerRole(avgMinutes: number): PlayerRole {
  if (avgMinutes >= PRIMARY_MINUTES) return 'PRIMARY';
  if (avgMinutes >= SECONDARY_MINUTES) return 'SECONDARY';
  if (avgMinutes >= ROLE_MINUTES) return 'ROLE';
  return 'BENCH';
}

/**
 * Classify pace based on expected game pace
 */
function getPaceClass(expectedPace: number): PaceClass {
  if (expectedPace >= PACE_FAST_THRESHOLD) return 'FAST';
  if (expectedPace <= PACE_SLOW_THRESHOLD) return 'SLOW';
  return 'NEUTRAL';
}

/**
 * Normalize prop type to standard category
 */
function normalizeStatType(propType: string): string {
  const lower = propType?.toLowerCase() || '';
  if (lower.includes('point') && lower.includes('rebound') && lower.includes('assist')) return 'pra';
  if (lower.includes('point') && lower.includes('rebound')) return 'pr';
  if (lower.includes('point') && lower.includes('assist')) return 'pa';
  if (lower.includes('rebound') && lower.includes('assist')) return 'ra';
  if (lower.includes('point')) return 'points';
  if (lower.includes('rebound')) return 'rebounds';
  if (lower.includes('assist')) return 'assists';
  if (lower.includes('three') || lower.includes('3p')) return 'threes';
  if (lower.includes('steal')) return 'steals';
  if (lower.includes('block')) return 'blocks';
  return 'other';
}

/**
 * Check if prop type is a combo stat
 */
function isComboStat(propType: string): boolean {
  const normalized = normalizeStatType(propType);
  return ['pra', 'pr', 'pa', 'ra'].includes(normalized);
}

/**
 * STEP 1: Implied Team Total Hard Constraints
 */
function validateImpliedTotal(
  prop: PropToValidate,
  gameEnv: GameEnvironment,
  isHome: boolean
): { pass: boolean; teamImplied: number; reason?: string } {
  const { vegas_total, vegas_spread } = gameEnv;
  
  // Calculate implied totals for each team
  // Favorite gets: (Total/2) + (|Spread|/2)
  // Underdog gets: (Total/2) - (|Spread|/2)
  const favoriteImplied = (vegas_total / 2) + (Math.abs(vegas_spread) / 2);
  const underdogImplied = (vegas_total / 2) - (Math.abs(vegas_spread) / 2);
  
  // Determine if player's team is favorite (negative spread = favorite at home, positive = underdog)
  const isPlayerTeamFavorite = isHome ? vegas_spread < 0 : vegas_spread > 0;
  const teamImplied = isPlayerTeamFavorite ? favoriteImplied : underdogImplied;
  
  const normalizedProp = normalizeStatType(prop.prop_type);
  const maxRatio = PROP_TO_TEAM_RATIO[normalizedProp] || 0.40;
  const maxAllowedLine = teamImplied * maxRatio;
  
  // For non-points props, use different calculation
  if (['rebounds', 'assists', 'threes'].includes(normalizedProp)) {
    // These props don't directly correlate with team implied total
    // Use softer check based on whether team implied is very low
    if (teamImplied < 100 && prop.side === 'over') {
      return { 
        pass: true, 
        teamImplied,
        reason: `Low team implied (${teamImplied.toFixed(1)}) - ${normalizedProp} OVER may be limited`
      };
    }
    return { pass: true, teamImplied };
  }
  
  // For points and combo props, enforce hard constraint
  if (prop.line > maxAllowedLine) {
    return {
      pass: false,
      teamImplied,
      reason: `Line ${prop.line} exceeds ${(maxRatio * 100).toFixed(0)}% of team implied total (${teamImplied.toFixed(1)} pts)`
    };
  }
  
  return { pass: true, teamImplied };
}

/**
 * STEP 2: Pace Adjustment Validation
 */
function validatePace(
  prop: PropToValidate,
  teamPace: number,
  opponentPace: number
): { pass: boolean; expectedPace: number; paceClass: PaceClass; reason?: string } {
  const expectedPace = (teamPace + opponentPace) / 2;
  const paceClass = getPaceClass(expectedPace);
  const normalizedProp = normalizeStatType(prop.prop_type);
  
  const paceEffect = PACE_EFFECTS[paceClass][normalizedProp] || 'NEUTRAL';
  
  // PENALTY + OVER = bad combination
  if (paceEffect === 'PENALTY' && prop.side === 'over') {
    return {
      pass: false,
      expectedPace,
      paceClass,
      reason: `${paceClass} pace (${expectedPace.toFixed(1)}) penalizes ${normalizedProp} OVER bets`
    };
  }
  
  // BOOST + UNDER = questionable
  if (paceEffect === 'BOOST' && prop.side === 'under') {
    return {
      pass: true, // Allow but flag
      expectedPace,
      paceClass,
      reason: `${paceClass} pace (${expectedPace.toFixed(1)}) typically boosts ${normalizedProp} - UNDER is contrarian`
    };
  }
  
  return { pass: true, expectedPace, paceClass };
}

/**
 * STEP 3: Defensive Allowance Filter
 */
function validateDefense(
  prop: PropToValidate,
  defenseRank: number,
  statAllowed: number
): { pass: boolean; reason?: string } {
  const normalizedProp = normalizeStatType(prop.prop_type);
  
  // Elite defense (rank <= 5) blocks OVER bets
  if (defenseRank <= ELITE_DEFENSE_RANK && prop.side === 'over') {
    return {
      pass: false,
      reason: `Elite ${normalizedProp} defense (Rank #${defenseRank}) blocks OVER`
    };
  }
  
  // Weak defense (rank >= 25) challenges UNDER bets
  if (defenseRank >= WEAK_DEFENSE_RANK && prop.side === 'under') {
    return {
      pass: true, // Allow but flag as conditional
      reason: `Weak ${normalizedProp} defense (Rank #${defenseRank}) challenges UNDER`
    };
  }
  
  return { pass: true };
}

/**
 * STEP 4: Spread & Game Script Validation
 */
function validateGameScript(
  prop: PropToValidate,
  gameEnv: GameEnvironment,
  playerRole: PlayerRole,
  isHome: boolean
): { pass: boolean; confidenceAdj: number; reason?: string } {
  const { vegas_spread, blowout_probability = 0.15, garbage_time_risk = 0.15 } = gameEnv;
  const isPlayerTeamFavorite = isHome ? vegas_spread < 0 : vegas_spread > 0;
  const isBlowout = Math.abs(vegas_spread) >= BLOWOUT_SPREAD;
  
  let confidenceAdj = 0;
  
  if (isBlowout) {
    // FAVORITE star overs = DOWNGRADE (they'll sit in 4th quarter)
    if (isPlayerTeamFavorite && playerRole === 'PRIMARY' && prop.side === 'over') {
      return {
        pass: true,
        confidenceAdj: -3,
        reason: `Blowout favorite (spread ${vegas_spread}) - star may sit Q4`
      };
    }
    
    // UNDERDOG role player rebounds = UPGRADE (garbage time boards)
    if (!isPlayerTeamFavorite && normalizeStatType(prop.prop_type) === 'rebounds' && playerRole === 'ROLE') {
      confidenceAdj = +2;
    }
    
    // BENCH player overs in blowout = UPGRADE (garbage time opportunity)
    if (playerRole === 'BENCH' && prop.side === 'over' && garbage_time_risk >= 0.25) {
      confidenceAdj = +1;
    }
  }
  
  return { pass: true, confidenceAdj };
}

/**
 * STEP 5: Player Role Validation
 */
function validatePlayerRole(
  prop: PropToValidate,
  playerRole: PlayerRole,
  avgMinutes: number
): { pass: boolean; reason?: string } {
  const normalizedProp = normalizeStatType(prop.prop_type);
  const isCombo = isComboStat(prop.prop_type);
  
  // Block combo props for ROLE and BENCH players
  if (isCombo && ['ROLE', 'BENCH'].includes(playerRole)) {
    return {
      pass: false,
      reason: `${playerRole} players (${avgMinutes.toFixed(1)} min) cannot clear combo props (${normalizedProp})`
    };
  }
  
  // BENCH players with high lines = questionable
  if (playerRole === 'BENCH' && prop.side === 'over') {
    const thresholds: Record<string, number> = {
      points: 10, rebounds: 5, assists: 3, threes: 2, pra: 15
    };
    const threshold = thresholds[normalizedProp] || 10;
    
    if (prop.line > threshold) {
      return {
        pass: false,
        reason: `BENCH player (${avgMinutes.toFixed(1)} min) - line ${prop.line} too high for minutes`
      };
    }
  }
  
  return { pass: true };
}

/**
 * STEP 6: Prop Type Specific Rules
 */
function validatePropTypeRules(
  prop: PropToValidate,
  paceClass: PaceClass,
  teamImplied: number,
  avgMinutes: number
): { pass: boolean; reason?: string } {
  const normalizedProp = normalizeStatType(prop.prop_type);
  
  // PRA specific: Block in slow pace or low team implied
  if (normalizedProp === 'pra') {
    if (paceClass === 'SLOW' && prop.side === 'over') {
      return {
        pass: false,
        reason: `PRA OVER invalid in SLOW pace game - reduced possessions limit all stats`
      };
    }
    if (teamImplied < 108 && prop.side === 'over') {
      return {
        pass: false,
        reason: `PRA OVER requires team implied ≥108 (current: ${teamImplied.toFixed(1)})`
      };
    }
  }
  
  // Points: Need decent minutes and pace
  if (normalizedProp === 'points') {
    if (avgMinutes < 25 && prop.line >= 20 && prop.side === 'over') {
      return {
        pass: false,
        reason: `${avgMinutes.toFixed(1)} min not enough for ${prop.line}+ points`
      };
    }
  }
  
  // Threes: High variance, block stacking
  if (normalizedProp === 'threes') {
    if (prop.line >= 4 && avgMinutes < 30) {
      return {
        pass: true,
        reason: `High 3PM line (${prop.line}) with ${avgMinutes.toFixed(1)} min - high variance`
      };
    }
  }
  
  return { pass: true };
}

/**
 * MASTER VALIDATION FUNCTION
 */
function validateProp(
  prop: PropToValidate,
  gameEnv: GameEnvironment | null,
  teamPace: number,
  opponentPace: number,
  defenseRank: number,
  statAllowed: number,
  avgMinutes: number
): ValidationResult {
  const checks = {
    implied_total: true,
    pace: true,
    defense: true,
    role: true,
    game_script: true,
    prop_type: true
  };
  
  const reasons: string[] = [];
  let confidenceAdjustment = 0;
  let status: 'APPROVED' | 'CONDITIONAL' | 'REJECTED' = 'APPROVED';
  
  const playerRole = getPlayerRole(avgMinutes);
  const isHome = gameEnv?.home_team?.toLowerCase().includes(prop.team_name?.toLowerCase() || '') || false;
  
  let teamImplied = 110; // Default
  let expectedPace = 100;
  let paceClass: PaceClass = 'NEUTRAL';
  
  // STEP 1: Implied Total Check
  if (gameEnv) {
    const impliedResult = validateImpliedTotal(prop, gameEnv, isHome);
    teamImplied = impliedResult.teamImplied;
    if (!impliedResult.pass) {
      checks.implied_total = false;
      reasons.push(impliedResult.reason!);
      status = 'REJECTED';
    }
  }
  
  // STEP 2: Pace Check
  const paceResult = validatePace(prop, teamPace, opponentPace);
  expectedPace = paceResult.expectedPace;
  paceClass = paceResult.paceClass;
  if (!paceResult.pass) {
    checks.pace = false;
    reasons.push(paceResult.reason!);
    status = 'REJECTED';
  } else if (paceResult.reason) {
    reasons.push(paceResult.reason);
    if (status === 'APPROVED') status = 'CONDITIONAL';
  }
  
  // STEP 3: Defense Check
  const defenseResult = validateDefense(prop, defenseRank, statAllowed);
  if (!defenseResult.pass) {
    checks.defense = false;
    reasons.push(defenseResult.reason!);
    status = 'REJECTED';
  } else if (defenseResult.reason) {
    reasons.push(defenseResult.reason);
    if (status === 'APPROVED') status = 'CONDITIONAL';
  }
  
  // STEP 4: Game Script Check
  if (gameEnv) {
    const scriptResult = validateGameScript(prop, gameEnv, playerRole, isHome);
    confidenceAdjustment += scriptResult.confidenceAdj;
    if (scriptResult.reason) {
      reasons.push(scriptResult.reason);
      if (status === 'APPROVED') status = 'CONDITIONAL';
    }
  }
  
  // STEP 5: Role Check
  const roleResult = validatePlayerRole(prop, playerRole, avgMinutes);
  if (!roleResult.pass) {
    checks.role = false;
    reasons.push(roleResult.reason!);
    status = 'REJECTED';
  }
  
  // STEP 6: Prop Type Rules Check
  const propTypeResult = validatePropTypeRules(prop, paceClass, teamImplied, avgMinutes);
  if (!propTypeResult.pass) {
    checks.prop_type = false;
    reasons.push(propTypeResult.reason!);
    status = 'REJECTED';
  } else if (propTypeResult.reason) {
    reasons.push(propTypeResult.reason);
    if (status === 'APPROVED') status = 'CONDITIONAL';
  }
  
  // Build justification
  const justification = reasons.length > 0 
    ? reasons[0] // Use first/most important reason
    : `All checks passed: ${paceClass} pace (${expectedPace.toFixed(1)}), team implied ${teamImplied.toFixed(1)}, ${playerRole} player`;
  
  return {
    status,
    emoji: status === 'APPROVED' ? '🟢' : status === 'CONDITIONAL' ? '🟡' : '🔴',
    justification,
    checks,
    confidenceAdjustment,
    details: {
      teamImplied,
      expectedPace,
      paceClass,
      defenseRank,
      playerRole,
      avgMinutes
    }
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const targetDate = getEasternDate();
    console.log(`[GameEnvValidator] Starting validation for ${targetDate}`);

    // Fetch all required data in parallel
    const [
      propsResult,
      gameEnvResult,
      paceResult,
      defenseResult,
      seasonStatsResult,
      playerCacheResult  // NEW: bdl_player_cache for team lookups
    ] = await Promise.all([
      // Today's props that need validation (from risk engine + category sweet spots)
      supabase
        .from('nba_risk_engine_picks')
        .select('player_name, prop_type, side, line, team')
        .eq('game_date', targetDate)
        .is('rejection_reason', null),
      
      // Game environment data
      supabase
        .from('game_environment')
        .select('*')
        .eq('game_date', targetDate),
      
      // Team pace projections (pace_class doesn't exist - we calculate it)
      supabase
        .from('nba_team_pace_projections')
        .select('team_name, team_abbrev, pace_rating'),
      
      // Team defense ratings
      supabase
        .from('team_defensive_ratings')
        .select('team_name, stat_type, defensive_rank, stat_allowed_per_game'),
      
      // Player season stats for minutes/role
      supabase
        .from('player_season_stats')
        .select('player_name, avg_minutes, team_name'),
      
      // NEW: bdl_player_cache - Primary source for player→team mapping
      supabase
        .from('bdl_player_cache')
        .select('player_name, team_name')
        .eq('is_active', true)
    ]);

    // Also fetch category sweet spots
    const { data: sweetSpots } = await supabase
      .from('category_sweet_spots')
      .select('player_name, prop_type, recommended_side, actual_line, archetype')
      .eq('analysis_date', targetDate);

    // NEW: Build player→team lookup from bdl_player_cache (primary source)
    const playerTeamMap = new Map<string, string>();
    (playerCacheResult.data || []).forEach((p: any) => {
      if (p.player_name && p.team_name) {
        playerTeamMap.set(p.player_name.toLowerCase(), p.team_name);
      }
    });
    console.log(`[GameEnvValidator] Loaded ${playerTeamMap.size} player→team mappings from bdl_player_cache`);

    // Build lookup maps
    const gameEnvMap = new Map<string, GameEnvironment>();
    (gameEnvResult.data || []).forEach((g: any) => {
      const key = `${g.home_team?.toLowerCase()}_${g.away_team?.toLowerCase()}`;
      gameEnvMap.set(key, {
        home_team: g.home_team,
        away_team: g.away_team,
        vegas_total: g.vegas_total || 220,
        vegas_spread: g.vegas_spread || 0,
        game_script: g.game_script,
        blowout_probability: g.blowout_probability,
        garbage_time_risk: g.garbage_time_risk
      });
      // Also add reverse lookup
      const reverseKey = `${g.away_team?.toLowerCase()}_${g.home_team?.toLowerCase()}`;
      gameEnvMap.set(reverseKey, gameEnvMap.get(key)!);
    });
    console.log(`[GameEnvValidator] Loaded ${gameEnvMap.size / 2} game environments`);

    // NEW: Build pace map with MULTIPLE keys per team (full name, abbrev, partial matches)
    const paceMap = new Map<string, { pace: number; paceClass: string }>();
    (paceResult.data || []).forEach((p: any) => {
      const paceData = { 
        pace: p.pace_rating || 100, 
        paceClass: p.pace_class || getPaceClass(p.pace_rating || 100) 
      };
      
      // Add full name: "atlanta hawks"
      if (p.team_name) {
        paceMap.set(p.team_name.toLowerCase(), paceData);
        // Also add partial matches: "hawks", "atlanta"
        const parts = p.team_name.toLowerCase().split(' ');
        parts.forEach((part: string) => {
          if (part.length >= 3) paceMap.set(part, paceData);
        });
      }
      
      // Add abbreviation: "atl"
      if (p.team_abbrev) {
        paceMap.set(p.team_abbrev.toLowerCase(), paceData);
      }
    });
    console.log(`[GameEnvValidator] Loaded ${paceResult.data?.length || 0} teams into pace map with ${paceMap.size} lookup keys`);

    const defenseMap = new Map<string, { rank: number; allowed: number }>();
    (defenseResult.data || []).forEach((d: any) => {
      const key = `${d.team_name?.toLowerCase()}_${d.stat_type?.toLowerCase()}`;
      defenseMap.set(key, { rank: d.defensive_rank || 15, allowed: d.stat_allowed_per_game || 0 });
    });

    const minutesMap = new Map<string, { minutes: number; team: string }>();
    (seasonStatsResult.data || []).forEach((s: any) => {
      const key = s.player_name?.toLowerCase();
      if (key) {
        minutesMap.set(key, { minutes: s.avg_minutes || 20, team: s.team_name || '' });
      }
    });

    // Combine props from risk engine and sweet spots
    const allProps: PropToValidate[] = [];
    
    (propsResult.data || []).forEach((p: any) => {
      allProps.push({
        player_name: p.player_name,
        prop_type: p.prop_type,
        side: p.side,
        line: p.line,
        team_name: p.team
      });
    });

    (sweetSpots || []).forEach((s: any) => {
      // Avoid duplicates
      const exists = allProps.some(p => 
        p.player_name?.toLowerCase() === s.player_name?.toLowerCase() &&
        normalizeStatType(p.prop_type) === normalizeStatType(s.prop_type)
      );
      if (!exists) {
        allProps.push({
          player_name: s.player_name,
          prop_type: s.prop_type,
          side: s.recommended_side || 'over',
          line: s.actual_line || 0,
          archetype: s.archetype
        });
      }
    });

    console.log(`[GameEnvValidator] Validating ${allProps.length} props`);

    // Validate each prop
    const validationResults: any[] = [];
    let approved = 0, conditional = 0, rejected = 0;

    for (const prop of allProps) {
      const playerKey = prop.player_name?.toLowerCase() || '';
      const playerStats = minutesMap.get(playerKey);
      const avgMinutes = playerStats?.minutes || 20;
      
      // NEW: Try multiple sources for team name (bdl_player_cache is primary)
      const teamName = prop.team_name || 
                       playerTeamMap.get(playerKey) || 
                       playerStats?.team || '';
      
      // Find opponent and game environment
      let gameEnv: GameEnvironment | null = null;
      let opponentTeam = '';
      
      // Try to find game environment by team name
      const teamLower = teamName.toLowerCase();
      for (const [key, env] of gameEnvMap) {
        if (key.includes(teamLower)) {
          gameEnv = env;
          // Extract opponent from key
          const parts = key.split('_');
          opponentTeam = parts.find(p => !teamLower.includes(p) && !p.includes(teamLower)) || '';
          break;
        }
      }
      
      // NEW: Try partial match if full team name didn't work
      if (!gameEnv && teamName) {
        const teamParts = teamLower.split(' ');
        for (const [key, env] of gameEnvMap) {
          if (teamParts.some(part => part.length >= 3 && key.includes(part))) {
            gameEnv = env;
            const parts = key.split('_');
            opponentTeam = parts.find(p => !teamParts.some(tp => p.includes(tp))) || '';
            break;
          }
        }
      }
      
      // NEW: Get pace data with fallback matching (try full name, then partial)
      let teamPaceData = paceMap.get(teamLower);
      if (!teamPaceData && teamName) {
        // Try each word in team name
        const teamWords = teamLower.split(' ');
        for (const word of teamWords) {
          if (word.length >= 3) {
            teamPaceData = paceMap.get(word);
            if (teamPaceData) break;
          }
        }
      }
      teamPaceData = teamPaceData || { pace: 100, paceClass: 'NEUTRAL' };
      
      // Same for opponent pace
      let oppPaceData = paceMap.get(opponentTeam.toLowerCase());
      if (!oppPaceData && opponentTeam) {
        const oppWords = opponentTeam.toLowerCase().split(' ');
        for (const word of oppWords) {
          if (word.length >= 3) {
            oppPaceData = paceMap.get(word);
            if (oppPaceData) break;
          }
        }
      }
      oppPaceData = oppPaceData || { pace: 100, paceClass: 'NEUTRAL' };
      
      // NEW: If no game environment found, estimate from pace data
      if (!gameEnv && teamPaceData.pace !== 100 && oppPaceData.pace !== 100) {
        const estimatedTotal = (teamPaceData.pace + oppPaceData.pace) * 2.2; // ~220 baseline adjusted by pace
        gameEnv = {
          home_team: teamName,
          away_team: opponentTeam,
          vegas_total: estimatedTotal,
          vegas_spread: 0, // Assume pick'em when unknown
          game_script: 'COMPETITIVE',
          blowout_probability: 0.15,
          garbage_time_risk: 0.15
        };
        console.log(`[GameEnvValidator] Estimated game environment for ${teamName}: total=${estimatedTotal.toFixed(1)}`);
      }
      
      // Get defense data for opponent (try both full name and partial)
      const normalizedStat = normalizeStatType(prop.prop_type);
      let defenseData = defenseMap.get(`${opponentTeam.toLowerCase()}_${normalizedStat}`);
      if (!defenseData && opponentTeam) {
        const oppWords = opponentTeam.toLowerCase().split(' ');
        for (const word of oppWords) {
          if (word.length >= 3) {
            defenseData = defenseMap.get(`${word}_${normalizedStat}`);
            if (defenseData) break;
          }
        }
      }
      defenseData = defenseData || { rank: 15, allowed: 0 };
      
      // Run validation
      const result = validateProp(
        prop,
        gameEnv,
        teamPaceData.pace,
        oppPaceData.pace,
        defenseData.rank,
        defenseData.allowed,
        avgMinutes
      );
      
      // Track counts
      if (result.status === 'APPROVED') approved++;
      else if (result.status === 'CONDITIONAL') conditional++;
      else rejected++;
      
      // Prepare record for upsert
      validationResults.push({
        player_name: prop.player_name,
        prop_type: prop.prop_type,
        side: prop.side,
        line: prop.line,
        game_date: targetDate,
        team_name: teamName,
        opponent_team: opponentTeam,
        vegas_total: gameEnv?.vegas_total,
        vegas_spread: gameEnv?.vegas_spread,
        team_implied_total: result.details.teamImplied,
        team_pace: teamPaceData.pace,
        opponent_pace: oppPaceData.pace,
        expected_game_pace: result.details.expectedPace,
        pace_class: result.details.paceClass,
        opp_defense_rank: defenseData.rank,
        opp_stat_allowed: defenseData.allowed,
        player_role: result.details.playerRole,
        avg_minutes: avgMinutes,
        is_starter: avgMinutes >= 25,
        player_archetype: prop.archetype,
        validation_status: result.status,
        rejection_reason: result.justification,
        implied_total_check: result.checks.implied_total,
        pace_check: result.checks.pace,
        defense_check: result.checks.defense,
        role_check: result.checks.role,
        game_script_check: result.checks.game_script,
        prop_type_check: result.checks.prop_type,
        confidence_adjustment: result.confidenceAdjustment,
        updated_at: new Date().toISOString()
      });
    }

    // Upsert validation results
    if (validationResults.length > 0) {
      const { error: upsertError } = await supabase
        .from('game_environment_validation')
        .upsert(validationResults, {
          onConflict: 'player_name,prop_type,side,line,game_date'
        });

      if (upsertError) {
        console.error('[GameEnvValidator] Upsert error:', upsertError);
      }
    }

    const summary = {
      date: targetDate,
      total_validated: allProps.length,
      approved,
      conditional,
      rejected,
      approval_rate: allProps.length > 0 ? ((approved / allProps.length) * 100).toFixed(1) + '%' : '0%'
    };

    console.log(`[GameEnvValidator] Complete: ${JSON.stringify(summary)}`);

    return new Response(JSON.stringify({
      success: true,
      summary,
      details: validationResults.slice(0, 10) // Return first 10 for preview
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[GameEnvValidator] Error:', errorMessage);
    return new Response(JSON.stringify({ 
      error: errorMessage,
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
