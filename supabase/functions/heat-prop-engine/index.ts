import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// MODULE 2: SIGNAL DETECTION CONSTANTS
// ============================================================================
const SIGNALS = {
  JUICE_DIVERGENCE: 20,       // Price ≥20 cents, NO line move
  LINE_MOVE_AGAINST_PUBLIC: 20, // Tickets ≥65% one side, line opposite
  EARLY_SHARP_SNAP: 25,       // Meaningful move within 10min of open
  MULTI_BOOK_CONFIRMATION: 15, // ≥3 books same direction in 30min
  PROMO_TRAP: -20,            // Promo + public heavy + inflated line
  LATE_CHASE: -10             // Heavy movement in final 60min with tickets
};

// Signal label thresholds
function getSignalLabel(score: number): string {
  if (score >= 80) return 'STRONG_SHARP';
  if (score >= 60) return 'SHARP_LEAN';
  if (score >= 40) return 'NEUTRAL';
  return 'PUBLIC_TRAP';
}

// ============================================================================
// MODULE 3: STAT-TYPE SAFETY FILTER (ROLE PLAYER-FIRST)
// ============================================================================
const STAT_SAFETY_RULES: Record<string, { prefer: string[], avoid: string[] }> = {
  basketball_nba: {
    prefer: ['rebounds', 'assists', 'blocks', 'steals', 'turnovers'],  // Reb/Ast first
    avoid: ['points', '3pt_made', 'fantasy_points', 'pra', 'double_double']  // Points blocked
  },
  icehockey_nhl: {
    prefer: ['shots_on_goal', 'blocked_shots', 'hits', 'faceoffs_won'],
    avoid: ['points', 'goals', 'power_play_points']
  },
  soccer: {
    prefer: ['passes', 'tackles', 'interceptions', 'shots', 'crosses'],
    avoid: ['goals', 'anytime_scorer', 'first_scorer']
  },
  tennis: {
    prefer: ['aces', 'double_faults', 'games_won', 'total_sets'],
    avoid: ['set_winner', 'tiebreak']
  }
};

// Star players registry (for one-star-per-team rule)
const ALL_STAR_PLAYERS = [
  'jaylen brown', 'jayson tatum', 'devin booker', 'kevin durant',
  'luka doncic', 'nikola jokic', 'giannis antetokounmpo', 'damian lillard',
  'shai gilgeous-alexander', 'anthony edwards', 'lebron james', 'anthony davis',
  'joel embiid', 'tyrese maxey', 'donovan mitchell', 'ja morant', 'trae young',
  'stephen curry', 'kyrie irving', 'jalen brunson', 'lamelo ball', 
  'de\'aaron fox', 'tyrese haliburton'
];

function isStarPlayer(playerName: string): boolean {
  const normalized = playerName?.toLowerCase() || '';
  return ALL_STAR_PLAYERS.some(star => normalized.includes(star));
}

// Stat priority for scoring (rebounds/assists >> points)
const STAT_PRIORITY: Record<string, number> = {
  'rebounds': 10,
  'assists': 9,
  'blocks': 7,
  'steals': 6,
  'threes': 4,
  'points': 2  // Lowest - deprioritized
};

function getStatPriorityScore(propType: string): number {
  const lower = propType?.toLowerCase() || '';
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
  'jaylen brown', 'jayson tatum', 'devin booker',
  'luka doncic', 'nikola jokic', 'giannis antetokounmpo'
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
  marketType: string
): { passes: boolean; reason?: string } {
  const lowerName = playerName.toLowerCase();
  
  // NBA minutes filter
  if (sport === 'basketball_nba' && side === 'over') {
    if (projectedMinutes && projectedMinutes < 24) {
      return { passes: false, reason: `Projected ${projectedMinutes} minutes < 24 min threshold` };
    }
  }
  
  // Never fade PRA for certain stars
  if (NEVER_FADE_PRA.includes(lowerName) && side === 'under') {
    const praMarkets = ['points', 'rebounds', 'assists', 'pra'];
    if (praMarkets.includes(marketType.toLowerCase())) {
      return { passes: false, reason: `Never fade ${playerName} ${marketType} under` };
    }
  }
  
  return { passes: true };
}

function passesStatSafety(sport: string, marketType: string, playerName?: string): { passes: boolean; reason?: string } {
  const rules = STAT_SAFETY_RULES[sport];
  if (!rules) return { passes: true };
  
  const lowerMarket = marketType.toLowerCase();
  
  // NEW: Hard block points for star players
  if (playerName && isStarPlayer(playerName)) {
    if (lowerMarket.includes('points') && !lowerMarket.includes('rebounds') && !lowerMarket.includes('assists')) {
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
  if (hoursToStart < 2 && signalLabel !== 'STRONG_SHARP') return -6;
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
  multiBookCount: number
): { score: number; signals: string[] } {
  let score = 50; // Base score
  const signals: string[] = [];
  
  // A) JUICE DIVERGENCE: Price moves ≥20 cents with NO line move
  if (Math.abs(priceDelta) >= 20 && Math.abs(lineDelta) < 0.5) {
    score += SIGNALS.JUICE_DIVERGENCE;
    signals.push('JUICE_DIVERGENCE');
  }
  
  // B) LINE MOVE AGAINST PUBLIC
  if (publicPctTickets && publicPctTickets >= 65 && Math.abs(lineDelta) >= 0.5) {
    // Assuming line moved against public (would need direction data)
    score += SIGNALS.LINE_MOVE_AGAINST_PUBLIC;
    signals.push('LINE_MOVE_AGAINST_PUBLIC');
  }
  
  // C) EARLY SHARP SNAP (12-24h is optimal)
  if (hoursToGame >= 12 && hoursToGame <= 24 && Math.abs(lineDelta) >= 0.5) {
    score += SIGNALS.EARLY_SHARP_SNAP;
    signals.push('EARLY_SHARP_SNAP');
  }
  
  // D) MULTI-BOOK CONFIRMATION
  if (multiBookCount >= 3) {
    score += SIGNALS.MULTI_BOOK_CONFIRMATION;
    signals.push('MULTI_BOOK_CONFIRMATION');
  }
  
  // E) PROMO TRAP
  if (promoFlag && publicPctTickets && publicPctTickets >= 60) {
    score += SIGNALS.PROMO_TRAP;
    signals.push('PROMO_TRAP');
  }
  
  // F) LATE CHASE
  if (hoursToGame < 1 && publicPctTickets && publicPctTickets >= 60) {
    score += SIGNALS.LATE_CHASE;
    signals.push('LATE_CHASE');
  }
  
  return { score: Math.max(0, Math.min(100, score)), signals };
}

// ============================================================================
// BASE ROLE SCORE (0-50) - Now with role-based granularity
// ============================================================================
const ROLE_BASE_SCORES: Record<string, number> = {
  'BALL_DOMINANT_STAR': 45,
  'STAR': 42,
  'SECONDARY_GUARD': 38,
  'WING': 35,
  'BIG': 40
};

function calculateBaseRoleScore(
  sport: string,
  marketType: string,
  playerRoleTag: string | null,
  playerRole?: string | null,  // From nba_risk_engine_picks.player_role
  playerName?: string | null,  // For star check
  confidenceScore?: number,    // NEW: for score variance
  hoursToGame?: number         // NEW: for time-based variance
): number {
  const rules = STAT_SAFETY_RULES[sport];
  
  // Start with role-based score for granularity (range: 35-45)
  let baseScore = playerRole ? (ROLE_BASE_SCORES[playerRole] || 38) : 38;
  
  if (!rules) return Math.min(baseScore, 85); // Cap at 85 to ensure watchlist range
  
  const lowerMarket = marketType.toLowerCase();
  
  // Stat priority adjustments (range: -10 to +15)
  const statPriority = getStatPriorityScore(marketType);
  if (statPriority >= 9) baseScore += 15;       // Rebounds/Assists: +15
  else if (statPriority >= 7) baseScore += 8;   // Blocks/Steals: +8
  else if (statPriority >= 4) baseScore += 0;   // Threes: neutral
  else if (statPriority <= 2) baseScore -= 10;  // Points: -10
  
  // Star player + points = heavy penalty
  if (playerName && isStarPlayer(playerName) && lowerMarket.includes('points')) {
    baseScore -= 15;
  }
  
  // NEW: Confidence-based variance (range: -8 to +10)
  if (confidenceScore !== undefined) {
    if (confidenceScore >= 9.5) baseScore += 10;
    else if (confidenceScore >= 9.0) baseScore += 6;
    else if (confidenceScore >= 8.5) baseScore += 3;
    else if (confidenceScore >= 8.0) baseScore += 0;
    else if (confidenceScore >= 7.5) baseScore -= 4;
    else baseScore -= 8;  // Low confidence penalty
  }
  
  // NEW: Time-to-game variance (range: -5 to +5)
  if (hoursToGame !== undefined) {
    if (hoursToGame >= 4 && hoursToGame <= 8) baseScore += 5;  // Optimal window
    else if (hoursToGame >= 2 && hoursToGame < 4) baseScore += 2;
    else if (hoursToGame > 8) baseScore -= 3;  // Too early
    else if (hoursToGame < 2) baseScore -= 5;  // Too late
  }
  
  // Bonus for preferred stats (+8-12)
  for (const preferred of rules.prefer) {
    if (lowerMarket.includes(preferred)) {
      const preferBonus = playerRoleTag === 'star' ? 12 : 8;
      baseScore += preferBonus;
      break;  // Only apply once
    }
  }
  
  // Penalty for avoided stats (-15)
  for (const avoided of rules.avoid) {
    if (lowerMarket.includes(avoided)) {
      baseScore -= 15;
      break;  // Only apply once
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
  const isBallDominant = pick.is_ball_dominant || pick.player_role === 'BALL_DOMINANT_STAR';
  const isPra = pick.is_pra || pick.prop_type?.toLowerCase().includes('pra');
  const gameScript = pick.game_script || 'competitive';
  const side = pick.side?.toLowerCase() || 'over';
  const trueMedian = pick.true_median || pick.rolling_median || 0;
  const line = pick.current_line || pick.line || 0;
  
  // CRITICAL: For UNDER bets, validate median is BELOW line
  // If median > line for under bet → PUBLIC_TRAP (player exceeds line on average)
  if (side === 'under' && trueMedian > 0 && line > 0) {
    if (trueMedian > line) {
      // Median is above line for an UNDER bet → This is a trap!
      return { label: 'PUBLIC_TRAP', score: 25 };
    }
    
    // For valid unders: reward when median is significantly below line
    const underEdge = line - trueMedian;
    if (underEdge >= 2.0) {
      // Strong under edge: median is 2+ below line
      if (confidence >= 8.5) {
        return { label: 'STRONG_SHARP', score: 88 };
      }
      return { label: 'SHARP_LEAN', score: 72 };
    }
  }
  
  // High confidence with line movement = SHARP_LEAN
  if (confidence >= 8.5 && Math.abs(lineDelta) >= 0.5) {
    return { label: 'SHARP_LEAN', score: 70 };
  }
  
  // Very high confidence = STRONG_SHARP
  if (confidence >= 9.0) {
    return { label: 'STRONG_SHARP', score: 85 };
  }
  
  // Good confidence = SHARP_LEAN
  if (confidence >= 8.0) {
    return { label: 'SHARP_LEAN', score: 65 };
  }
  
  // Ball-dominant star on competitive game with public appeal = PUBLIC_LEAN
  if (isBallDominant && gameScript === 'competitive' && isPra) {
    return { label: 'PUBLIC_LEAN', score: 45 };
  }
  
  // Low confidence with high public appeal (PRA) = PUBLIC_TRAP
  if (confidence < 7.5 && isPra) {
    return { label: 'PUBLIC_TRAP', score: 30 };
  }
  
  // Default neutral
  return { label: 'NEUTRAL', score: 50 };
}

// ============================================================================
// MODULE 6: PARLAY BUILDING
// ============================================================================
interface ParlayLeg {
  player_name: string;
  market_type: string;
  line: number;
  side: string;
  book_name: string;
  final_score: number;
  signal_label: string;
  reason: string;
  event_id: string;
  sport: string;
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

function buildParlays(
  eligibleProps: any[],
  parlayType: 'CORE' | 'UPSIDE',
  excludePlayerNames: string[] = []  // Exclude these players (used for UPSIDE to avoid CORE overlap)
): { leg_1: ParlayLeg; leg_2: ParlayLeg; summary: string; risk_level: string } | null {
  const minScore = parlayType === 'CORE' ? 78 : 70;
  
  // Filter by score threshold AND exclude already-used players
  let candidates = eligibleProps.filter(p => 
    p.final_score >= minScore && 
    !excludePlayerNames.includes(p.player_name)
  );
  
  // CORE: Reject PUBLIC_TRAP, prefer low-variance stats
  if (parlayType === 'CORE') {
    candidates = candidates.filter(p => p.signal_label !== 'PUBLIC_TRAP');
    // Sort by stat priority first (rebounds/assists > points), then score
    candidates.sort((a, b) => {
      const aPriority = getStatPriorityScore(a.market_type);
      const bPriority = getStatPriorityScore(b.market_type);
      if (bPriority !== aPriority) return bPriority - aPriority;
      return b.final_score - a.final_score;
    });
  }
  
  // UPSIDE: Prioritize sharp-confirmed legs for variety
  if (parlayType === 'UPSIDE') {
    // Boost STRONG_SHARP and SHARP_LEAN to the top, then sort by stat priority, then score
    candidates.sort((a, b) => {
      const aSharp = ['STRONG_SHARP', 'SHARP_LEAN'].includes(a.signal_label) ? 1 : 0;
      const bSharp = ['STRONG_SHARP', 'SHARP_LEAN'].includes(b.signal_label) ? 1 : 0;
      if (bSharp !== aSharp) return bSharp - aSharp;
      const aPriority = getStatPriorityScore(a.market_type);
      const bPriority = getStatPriorityScore(b.market_type);
      if (bPriority !== aPriority) return bPriority - aPriority;
      return b.final_score - a.final_score;
    });
  }
  
  if (candidates.length < 2) return null;
  
  // NEW: Prop type diversity requirement - try to get different prop types
  const propCategories = new Set<string>();
  let leg1 = candidates[0];
  propCategories.add(getPropCategory(leg1.market_type));
  const leg1IsStar = isStarPlayer(leg1.player_name);
  
  // Find leg2: different player, respect one-star limit, PREFER different prop type
  let leg2 = candidates.find(c => {
    if (c.player_name === leg1.player_name) return false;
    if (c.event_id === leg1.event_id) return false;  // Different games preferred
    
    const isStar = isStarPlayer(c.player_name);
    if (leg1IsStar && isStar) return false;
    
    // DIVERSITY: Prefer different prop category
    const category = getPropCategory(c.market_type);
    return !propCategories.has(category);
  });
  
  // If no diverse option found, fall back to any valid leg
  if (!leg2) {
    leg2 = candidates.find(c => {
      if (c.player_name === leg1.player_name) return false;
      const isStar = isStarPlayer(c.player_name);
      if (leg1IsStar && isStar) return false;
      return true;
    });
  }
  
  if (!leg2) return null;
  
  const formatLeg = (p: any): ParlayLeg => ({
    player_name: p.player_name,
    market_type: p.market_type,
    line: p.latest_line,
    side: p.side,
    book_name: p.book_name,
    final_score: p.final_score,
    signal_label: p.signal_label,
    reason: generateLegReason(p),
    event_id: p.event_id,
    sport: p.sport
  });
  
  // Log diversity status
  const leg1Cat = getPropCategory(leg1.market_type);
  const leg2Cat = getPropCategory(leg2.market_type);
  console.log(`[Heat Engine] ${parlayType} parlay diversity: ${leg1Cat} + ${leg2Cat} (diverse: ${leg1Cat !== leg2Cat})`);
  
  return {
    leg_1: formatLeg(leg1),
    leg_2: formatLeg(leg2),
    summary: parlayType === 'CORE' 
      ? `Role player ${leg1Cat}/${leg2Cat} with strong market signals` 
      : `Higher upside with sharp-confirmed legs (${leg1Cat}/${leg2Cat})`,
    risk_level: parlayType === 'CORE' ? 'Low' : 'Med'
  };
}

function generateLegReason(prop: any): string {
  const parts: string[] = [];
  
  if (prop.signal_label === 'STRONG_SHARP') {
    parts.push('Strong sharp action detected');
  } else if (prop.signal_label === 'SHARP_LEAN') {
    parts.push('Sharp lean confirmed');
  }
  
  if (prop.line_delta && Math.abs(prop.line_delta) >= 0.5) {
    const dir = prop.line_delta > 0 ? 'up' : 'down';
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
  
  return parts.length > 0 ? parts.join('; ') : 'Meets all validation rules';
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

// ============================================================================
// MAIN ENGINE
// ============================================================================
async function runHeatEngine(supabase: any, action: string, sport?: string) {
  const today = getEasternDate();
  const now = new Date();
  
  console.log(`[Heat Prop Engine] Running action: ${action}, sport: ${sport || 'all'}, date: ${today}`);
  
  if (action === 'scan' || action === 'ingest') {
    // First, verify we have source data (unified_props with NBA games)
    const { data: nbaProps, error: propsCheckError } = await supabase
      .from('unified_props')
      .select('event_id')
      .eq('sport', 'basketball_nba')
      .gte('commence_time', today)
      .limit(1);
    
    if (propsCheckError) {
      console.error('[Heat Engine] Error checking unified_props:', propsCheckError);
    }
    
    if (!nbaProps || nbaProps.length === 0) {
      console.warn('[Heat Engine] NO NBA PROPS in unified_props - run refresh-todays-props first');
      return {
        success: false,
        error: 'NO_SOURCE_DATA',
        message: 'No NBA props available. Run refresh-todays-props for basketball_nba first.'
      };
    }
    
    // Fetch props from nba_risk_engine_picks as source data
    // Filter by mode='full_slate' and no rejection_reason (these are approved picks)
    const { data: picks, error: picksError } = await supabase
      .from('nba_risk_engine_picks')
      .select('*')
      .gte('game_date', today)
      .eq('mode', 'full_slate')
      .is('rejection_reason', null);
    
    if (picksError) {
      console.error('Error fetching picks:', picksError);
      return { success: false, error: picksError.message };
    }
    
    console.log(`[Heat Engine] Found ${picks?.length || 0} approved picks from Risk Engine`);
    
    if (!picks || picks.length === 0) {
      return { 
        success: false, 
        error: 'NO_RISK_ENGINE_DATA',
        message: 'No approved picks from Risk Engine for today. Run nba-player-prop-risk-engine first.',
        processed: 0
      };
    }
    
    // Process each pick and upsert to heat_prop_tracker
    const trackerUpserts: any[] = [];
    
    for (const pick of picks) {
      const hoursToGame = pick.game_date 
        ? (new Date(pick.game_date).getTime() - now.getTime()) / (1000 * 60 * 60)
        : 24;
      
      // Map fields from nba_risk_engine_picks schema
      const sport = 'basketball_nba';
      const side = pick.side?.toLowerCase() || 'over';
      const lineDelta = (pick.current_line && pick.line) ? (pick.current_line - pick.line) : 0;
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
        1 // confirming_books default
      );
      
      // Use better of derived signal score or market signal score
      const signalScore = Math.max(derivedSignal.score, marketSignalScore);
      const signalLabel = derivedSignal.label !== 'NEUTRAL' ? derivedSignal.label : getSignalLabel(marketSignalScore);
      
      // Calculate base role score with player role for granularity
      const baseRoleScore = calculateBaseRoleScore(
        sport,
        pick.prop_type,
        roleTag,
        pick.player_role,      // Pass player role for score variation
        pick.player_name,      // Pass player name for star check
        pick.confidence_score, // NEW: Pass confidence for score variance
        hoursToGame            // NEW: Pass hours to game for time variance
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
        pick.prop_type
      );
      
      // MEDIAN DEAD-ZONE FILTER (±0.5): If line is within ±0.5 of median → no edge
      const rollingMedian = pick.rolling_median || pick.median_l10;
      const currentLine = pick.line + lineDelta;
      const inDeadZone = rollingMedian && isInMedianDeadZone(currentLine, rollingMedian);
      
      if (inDeadZone) {
        console.log(`[Heat] Dead zone skip: ${pick.player_name} line ${currentLine} vs median ${rollingMedian}`);
      }
      
      // Eligibility (now includes dead-zone filter)
      const isEligibleCore = finalScore >= 78 && 
        statSafety.passes && 
        roleValidation.passes && 
        signalLabel !== 'PUBLIC_TRAP' &&
        !inDeadZone;
      
      const isEligibleUpside = finalScore >= 70 && 
        roleValidation.passes &&
        (signalLabel === 'STRONG_SHARP' || signalLabel === 'SHARP_LEAN' || statSafety.passes) &&
        !inDeadZone;
      
      trackerUpserts.push({
        event_id: pick.event_id || `${pick.player_name}-${pick.prop_type}-${today}`,
        sport: sport,
        league: 'NBA',
        start_time_utc: pick.game_date || new Date(now.getTime() + hoursToGame * 60 * 60 * 1000).toISOString(),
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
        book_name: pick.bookmaker || 'fanduel',
        side: pick.pick_side?.toLowerCase() || 'over',
        updated_at: now.toISOString()
      });
    }
    
    // Upsert to tracker
    if (trackerUpserts.length > 0) {
      const { error: upsertError } = await supabase
        .from('heat_prop_tracker')
        .upsert(trackerUpserts, {
          onConflict: 'event_id,player_name,market_type,book_name,side'
        });
      
      if (upsertError) {
        console.error('Error upserting tracker:', upsertError);
        return { success: false, error: upsertError.message };
      }
    }
    
    console.log(`[Heat Engine] Upserted ${trackerUpserts.length} props to tracker`);
    
    return {
      success: true,
      processed: trackerUpserts.length,
      eligible_core: trackerUpserts.filter(t => t.is_eligible_core).length,
      eligible_upside: trackerUpserts.filter(t => t.is_eligible_upside).length
    };
  }
  
  if (action === 'build') {
    // CRITICAL: Clear stale parlays FIRST before rebuilding
    // This prevents yesterday's settled parlays from showing as today's
    console.log(`[Heat Engine] Clearing stale data for ${today}...`);
    
    const { error: clearParlaysError } = await supabase
      .from('heat_parlays')
      .delete()
      .eq('parlay_date', today);
    
    if (clearParlaysError) {
      console.error('[Heat Engine] Error clearing parlays:', clearParlaysError);
    }
    
    // Also clear stale tracker entries from previous days
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    await supabase
      .from('heat_prop_tracker')
      .delete()
      .lt('start_time_utc', today);
    
    // Fetch eligible props from tracker
    const { data: eligibleProps, error: fetchError } = await supabase
      .from('heat_prop_tracker')
      .select('*')
      .gte('start_time_utc', today)
      .or('is_eligible_core.eq.true,is_eligible_upside.eq.true')
      .order('final_score', { ascending: false });
    
    if (fetchError) {
      console.error('Error fetching eligible props:', fetchError);
      return { success: false, error: fetchError.message };
    }
    
    console.log(`[Heat Engine] Found ${eligibleProps?.length || 0} eligible props for today`);
    
    if (!eligibleProps || eligibleProps.length < 2) {
      // Clear today's supporting data
      await supabase.from('heat_watchlist').delete().eq('watchlist_date', today);
      await supabase.from('heat_do_not_bet').delete().eq('dnb_date', today);
      
      return {
        success: false,
        error: 'INSUFFICIENT_PROPS',
        message: 'NO CORE PLAY TODAY - insufficient eligible props. Need at least 2 eligible props.',
        core_parlay: null,
        upside_parlay: null,
        watchlist: [],
        do_not_bet: []
      };
    }
    
    // Build CORE parlay first
    const coreParlay = buildParlays(
      eligibleProps.filter((p: any) => p.is_eligible_core),
      'CORE',
      []  // No exclusions for CORE
    );
    
    // Extract CORE player names to exclude from UPSIDE
    const corePlayerNames = coreParlay 
      ? [coreParlay.leg_1.player_name, coreParlay.leg_2.player_name]
      : [];
    
    console.log(`[Heat Engine] CORE players to exclude from UPSIDE: ${corePlayerNames.join(', ')}`);
    
    // Build UPSIDE parlay with CORE players excluded for variety
    const upsideParlay = buildParlays(
      eligibleProps.filter((p: any) => p.is_eligible_upside),
      'UPSIDE',
      corePlayerNames  // Exclude CORE players for differentiation
    );
    
    // Build Watchlist (top 5 approaching entry) - range 70-84 (just below CORE threshold)
    const todayStart = `${today}T00:00:00Z`;
    const { data: allTrackedForWatchlist, error: watchlistError } = await supabase
      .from('heat_prop_tracker')
      .select('*')
      .gte('start_time_utc', todayStart)
      .gte('final_score', 70)
      .lt('final_score', 85)
      .neq('signal_label', 'PUBLIC_TRAP')
      .order('final_score', { ascending: false })
      .limit(5);
    
    console.log(`[Heat Engine] Watchlist query result: ${allTrackedForWatchlist?.length || 0} items, error: ${watchlistError?.message || 'none'}`);
    
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
      reason: `Score ${p.final_score}/100, needs ${85 - p.final_score} more for CORE entry`
    }));
    
    console.log(`[Heat Engine] Watchlist candidates: ${watchlistCandidates.length}`);
    
    // Build Do-Not-Bet list (PUBLIC_TRAP + PUBLIC_LEAN + failed stat safety)
    const { data: trapProps } = await supabase
      .from('heat_prop_tracker')
      .select('*')
      .gte('start_time_utc', today)
      .in('signal_label', ['PUBLIC_TRAP', 'PUBLIC_LEAN'])
      .order('final_score', { ascending: true })
      .limit(3);
    
    const { data: failedSafetyProps } = await supabase
      .from('heat_prop_tracker')
      .select('*')
      .gte('start_time_utc', today)
      .eq('passes_stat_safety', false)
      .order('final_score', { ascending: true })
      .limit(3);
    
    // Combine and deduplicate
    const allDnbCandidates = [...(trapProps || []), ...(failedSafetyProps || [])];
    const uniqueDnb = allDnbCandidates.reduce((acc: any[], p: any) => {
      if (!acc.find(x => x.player_name === p.player_name && x.market_type === p.market_type)) {
        acc.push(p);
      }
      return acc;
    }, []).slice(0, 5);
    
    const dnbList = uniqueDnb.map((p: any) => {
      let trapReason = '';
      if (p.signal_label === 'PUBLIC_TRAP') {
        trapReason = `PUBLIC_TRAP - High public exposure, low sharp action`;
      } else if (p.signal_label === 'PUBLIC_LEAN') {
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
        final_score: p.final_score
      };
    });
    
    console.log(`[Heat Engine] Do-Not-Bet candidates: ${dnbList.length}`);
    
    // Save parlays
    const parlaysToSave: any[] = [];
    
    if (coreParlay) {
      parlaysToSave.push({
        parlay_date: today,
        parlay_type: 'CORE',
        leg_1: coreParlay.leg_1,
        leg_2: coreParlay.leg_2,
        summary: coreParlay.summary,
        risk_level: coreParlay.risk_level,
        no_bet_flags: [],
        engine_version: 'v1'
      });
    }
    
    if (upsideParlay) {
      parlaysToSave.push({
        parlay_date: today,
        parlay_type: 'UPSIDE',
        leg_1: upsideParlay.leg_1,
        leg_2: upsideParlay.leg_2,
        summary: upsideParlay.summary,
        risk_level: upsideParlay.risk_level,
        no_bet_flags: [],
        engine_version: 'v1'
      });
    }
    
    // Clear and insert
    await supabase.from('heat_parlays').delete().eq('parlay_date', today);
    await supabase.from('heat_watchlist').delete().eq('watchlist_date', today);
    await supabase.from('heat_do_not_bet').delete().eq('dnb_date', today);
    
    if (parlaysToSave.length > 0) {
      await supabase.from('heat_parlays').insert(parlaysToSave);
    }
    
    if (watchlistCandidates.length > 0) {
      await supabase.from('heat_watchlist').insert(watchlistCandidates);
    }
    
    if (dnbList.length > 0) {
      await supabase.from('heat_do_not_bet').insert(dnbList);
    }
    
    return {
      success: true,
      core_parlay: coreParlay,
      upside_parlay: upsideParlay,
      watchlist: watchlistCandidates,
      do_not_bet: dnbList
    };
  }
  
  if (action === 'fetch') {
    // Fetch today's parlays
    const { data: parlays } = await supabase
      .from('heat_parlays')
      .select('*')
      .eq('parlay_date', today);
    
    const { data: watchlist } = await supabase
      .from('heat_watchlist')
      .select('*')
      .eq('watchlist_date', today)
      .order('final_score', { ascending: false });
    
    const { data: dnb } = await supabase
      .from('heat_do_not_bet')
      .select('*')
      .eq('dnb_date', today);
    
    const coreParlay = parlays?.find((p: any) => p.parlay_type === 'CORE');
    const upsideParlay = parlays?.find((p: any) => p.parlay_type === 'UPSIDE');
    
    return {
      success: true,
      core_parlay: coreParlay || null,
      upside_parlay: upsideParlay || null,
      watchlist: watchlist || [],
      do_not_bet: dnb || []
    };
  }
  
  return { success: false, error: 'Invalid action' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { action = 'fetch', sport } = body;

    console.log(`[Heat Prop Engine] Request: ${action}, sport: ${sport || 'all'}`);

    const result = await runHeatEngine(supabase, action, sport);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Heat Prop Engine] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
