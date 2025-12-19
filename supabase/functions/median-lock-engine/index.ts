import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============ TYPES ============

interface PlayerPropCandidate {
  playerName: string;
  teamName: string;
  propType: string;
  bookLine: number;
  currentPrice: number;
  openingPrice: number;
  location: 'HOME' | 'AWAY';
  opponent: string;
  opponentDefenseRank: number;
  eventId: string;
  recommendedSide: 'over' | 'under';
  
  statLast10: number[];  // The relevant stat for this prop type
  minutesLast10: number[];
  usageLast10: number[];
  shotsLast10: number[];
  homeAwayLast10: ('HOME' | 'AWAY')[];
  
  teammatesOut: string[];
  teammatesQuestionable: string[];
  isNewlyStarting: boolean;
}

interface ShockResult {
  isShock: boolean;
  reasons: string[];
  passedValidation: boolean;
  minutesShock: boolean;
  usageShock: boolean;
  shotsShock: boolean;
}

interface MedianLockResult {
  status: 'LOCK' | 'STRONG' | 'BLOCK';
  blockReason?: string;
  betSide: 'OVER' | 'UNDER' | 'PASS';
  
  medianPoints: number;
  medianMinutes: number;
  medianUsage: number;
  medianShots: number;
  
  rawEdge: number;
  defenseAdjustment: number;
  adjustedEdge: number;
  splitEdge: number;
  hitRate: number;
  hitRateLast5: number;
  
  isShockFlagged: boolean;
  shockReasons: string[];
  shockPassedValidation: boolean;
  minutesShock: boolean;
  usageShock: boolean;
  shotsShock: boolean;
  teammatesOutCount: number;
  
  consistencyScore: number;
  confidenceScore: number;
  juiceLagBonus: number;
  
  passedChecks: string[];
  failedChecks: string[];
}

interface GreenSlip {
  legs: MedianLockResult[];
  legIds: string[];
  slipScore: number;
  probability: number;
  stakeTier: 'A' | 'B' | 'C';
}

interface EngineConfig {
  edgeMin: number;
  hitRateMin: number;
  minutesFloor: number;
  minutesMin: number;
  splitEdgeMin: number;
  adjustedEdgeMin: number;
}

const DEFAULT_CONFIG: EngineConfig = {
  edgeMin: 1.5,           // Enhanced: was 1.0
  hitRateMin: 0.80,       // Enhanced: was 0.70
  minutesFloor: 28,       // Enhanced: was 24
  minutesMin: 22,         // Enhanced: was 18
  splitEdgeMin: 1.0,      // Enhanced: was 0.5
  adjustedEdgeMin: 1.0,   // Enhanced: was 0.5
};

// ============ UTILITY FUNCTIONS ============

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const avg = average(arr);
  const squareDiffs = arr.map(value => Math.pow(value - avg, 2));
  return Math.sqrt(average(squareDiffs));
}

function calculateHitRate(values: number[], line: number, side: 'over' | 'under' = 'over'): number {
  if (values.length === 0) return 0;
  const hits = values.filter(v => side === 'over' ? v >= line : v < line).length;
  return hits / values.length;
}

// ============ AUTO BET SIDE DETECTION ============

interface BetSideResult {
  betSide: 'OVER' | 'UNDER' | 'PASS';
  edge: number;
  hitRate: number;
  side: 'over' | 'under';
}

function determineBetSide(
  medianStat: number,
  bookLine: number,
  statLast10: number[],
  config: EngineConfig
): BetSideResult {
  const overEdge = medianStat - bookLine;
  const overHitRate = calculateHitRate(statLast10, bookLine, 'over');
  
  const underEdge = bookLine - medianStat;
  const underHitRate = calculateHitRate(statLast10, bookLine, 'under');
  
  // Check OVER with STRICTER filters (similar to UNDER)
  if (overEdge >= config.edgeMin && overHitRate >= config.hitRateMin) {
    // === STRICTER OVER VALIDATION ===
    
    // 1. Variance check: OVER bets need consistent players (but allow slightly more variance than UNDER)
    const overVariance = stdDev(statLast10);
    if (overVariance > 6) {
      console.log(`OVER blocked: high variance ${overVariance.toFixed(1)} > 6`);
      // Fall through to check UNDER
    }
    // 2. Trending check: Last 3 games should also be over the line
    else {
      const last3 = statLast10.slice(0, 3);
      const last3Over = last3.filter(v => v >= bookLine).length;
      if (last3Over < 2) {
        console.log(`OVER blocked: only ${last3Over}/3 recent games over line (trending filter)`);
        // Fall through to check UNDER
      } 
      // 3. Edge buffer: Require higher edge for OVER bets (at least 1.5)
      else if (overEdge < 1.5) {
        console.log(`OVER blocked: edge ${overEdge.toFixed(1)} < 1.5 (edge buffer)`);
        // Fall through to check UNDER
      } else {
        // Passed all OVER filters
        return { betSide: 'OVER', edge: overEdge, hitRate: overHitRate, side: 'over' };
      }
    }
  }
  
  // Check UNDER with STRICTER filters
  if (underEdge >= config.edgeMin && underHitRate >= config.hitRateMin) {
    // === STRICTER UNDER VALIDATION ===
    
    // 1. Variance check: UNDER bets are risky with high-variance players
    const variance = stdDev(statLast10);
    if (variance > 5) {
      console.log(`UNDER blocked: high variance ${variance.toFixed(1)} > 5`);
      // Fall through to PASS
    } 
    // 2. Blowout protection: If median is way below line, something's off
    else if (medianStat < bookLine * 0.6) {
      console.log(`UNDER blocked: median ${medianStat.toFixed(1)} too low vs line ${bookLine} (blowout protection)`);
      // Fall through to PASS
    }
    // 3. Trending check: Last 3 games should also be under the line
    else {
      const last3 = statLast10.slice(0, 3);
      const last3Under = last3.filter(v => v < bookLine).length;
      if (last3Under < 2) {
        console.log(`UNDER blocked: only ${last3Under}/3 recent games under line (trending filter)`);
        // Fall through to PASS
      } else {
        // Passed all UNDER filters
        return { betSide: 'UNDER', edge: underEdge, hitRate: underHitRate, side: 'under' };
      }
    }
  }
  
  // Default to PASS - return best available edge for logging
  if (overEdge >= underEdge) {
    return { betSide: 'PASS', edge: overEdge, hitRate: overHitRate, side: 'over' };
  }
  return { betSide: 'PASS', edge: underEdge, hitRate: underHitRate, side: 'under' };
}

// Helper to get correct stat based on prop type
function getStatForPropType(log: any, propType: string): number {
  switch (propType) {
    case 'player_points': return log.points || 0;
    case 'player_assists': return log.assists || 0;
    case 'player_rebounds': return log.rebounds || 0;
    case 'player_threes': return log.threes_made || 0;
    case 'player_blocks': return log.blocks || 0;
    case 'player_steals': return log.steals || 0;
    default: return log.points || 0;
  }
}

// ============ DEFENSE ADJUSTMENT ============

function calculateDefenseAdjustment(rank: number): number {
  if (rank >= 1 && rank <= 10) return -1.5; // Top 10 defense = harder
  if (rank >= 11 && rank <= 20) return 0;   // Average defense
  return 1.5; // Weak defense = easier
}

// ============ SHOCK DETECTION ============

function detectUsageShock(candidate: PlayerPropCandidate, bookLine: number): ShockResult {
  const shockReasons: string[] = [];
  let minutesShock = false;
  let usageShock = false;
  let shotsShock = false;
  
  const medianMinutes = median(candidate.minutesLast10);
  const last3MinutesAvg = average(candidate.minutesLast10.slice(0, 3));
  const medianUsage = median(candidate.usageLast10);
  const last3UsageAvg = average(candidate.usageLast10.slice(0, 3));
  const medianShots = median(candidate.shotsLast10);
  const last3ShotsAvg = average(candidate.shotsLast10.slice(0, 3));
  
  // Check for sudden jumps in last 3 games
  if (last3MinutesAvg - medianMinutes >= 4) {
    shockReasons.push(`Minutes surge: +${(last3MinutesAvg - medianMinutes).toFixed(1)}`);
    minutesShock = true;
  }
  if (last3UsageAvg - medianUsage >= 3.5) {
    shockReasons.push(`Usage surge: +${(last3UsageAvg - medianUsage).toFixed(1)}%`);
    usageShock = true;
  }
  if (last3ShotsAvg - medianShots >= 2.5) {
    shockReasons.push(`Shots surge: +${(last3ShotsAvg - medianShots).toFixed(1)}`);
    shotsShock = true;
  }
  
  // Teammate injuries
  if (candidate.teammatesOut.length >= 2) {
    shockReasons.push(`${candidate.teammatesOut.length} teammates OUT`);
  }
  if (candidate.isNewlyStarting) {
    shockReasons.push('Newly inserted into starting lineup');
  }
  
  // If shock flagged, require secondary validation
  if (shockReasons.length > 0) {
    const statLast5 = candidate.statLast10.slice(0, 5);
    const hitRateLast5 = calculateHitRate(statLast5, bookLine);
    const medianLast5 = median(statLast5);
    
    // Must have 60%+ hit rate in last 5 AND median exceeds line by 0.5+
    const passedValidation = hitRateLast5 >= 0.6 && (medianLast5 - bookLine) >= 0.5;
    
    return {
      isShock: true,
      reasons: shockReasons,
      passedValidation,
      minutesShock,
      usageShock,
      shotsShock,
    };
  }
  
  return {
    isShock: false,
    reasons: [],
    passedValidation: true,
    minutesShock: false,
    usageShock: false,
    shotsShock: false,
  };
}

// ============ CORE ENGINE ============

function evaluateCandidate(
  candidate: PlayerPropCandidate,
  config: EngineConfig = DEFAULT_CONFIG
): MedianLockResult {
  const passedChecks: string[] = [];
  const failedChecks: string[] = [];
  
  // Compute basic medians
  const medianStat = median(candidate.statLast10);
  const medianMinutes = median(candidate.minutesLast10);
  const medianUsage = median(candidate.usageLast10);
  const medianShots = median(candidate.shotsLast10);
  
  // === AUTO BET SIDE DETECTION ===
  const betSideResult = determineBetSide(medianStat, candidate.bookLine, candidate.statLast10, config);
  const { betSide, edge: rawEdge, hitRate, side } = betSideResult;
  const hitRateLast5 = calculateHitRate(candidate.statLast10.slice(0, 5), candidate.bookLine, side);
  
  // Build base result (medianPoints stores the stat median for compatibility)
  const baseResult = {
    medianPoints: medianStat,
    medianMinutes,
    medianUsage,
    medianShots,
    rawEdge,
    hitRate,
    hitRateLast5,
    passedChecks,
    failedChecks,
    betSide,
  };
  
  // === CHECK 0: Bet Side PASS ===
  if (betSide === 'PASS') {
    failedChecks.push(`No clear edge: OVER edge ${(medianStat - candidate.bookLine).toFixed(1)}, UNDER edge ${(candidate.bookLine - medianStat).toFixed(1)}`);
    return {
      status: 'BLOCK',
      blockReason: 'No Clear OVER/UNDER Edge',
      ...baseResult,
      defenseAdjustment: 0,
      adjustedEdge: rawEdge,
      splitEdge: 0,
      isShockFlagged: false,
      shockReasons: [],
      shockPassedValidation: true,
      minutesShock: false,
      usageShock: false,
      shotsShock: false,
      teammatesOutCount: 0,
      consistencyScore: 0,
      confidenceScore: 0,
      juiceLagBonus: 0,
    };
  }
  
  passedChecks.push(`${betSide}: Edge ${rawEdge.toFixed(1)} ≥ ${config.edgeMin}, HR ${(hitRate * 100).toFixed(0)}% ≥ ${config.hitRateMin * 100}%`);
  
  // === CHECK 2: Minutes Floor ===
  const minMinutes = Math.min(...candidate.minutesLast10);
  if (medianMinutes < config.minutesFloor || minMinutes < config.minutesMin) {
    failedChecks.push(`Minutes floor: median ${medianMinutes.toFixed(0)}, min ${minMinutes.toFixed(0)}`);
    return {
      status: 'BLOCK',
      blockReason: 'Low Minutes',
      ...baseResult,
      defenseAdjustment: 0,
      adjustedEdge: rawEdge,
      splitEdge: 0,
      isShockFlagged: false,
      shockReasons: [],
      shockPassedValidation: true,
      minutesShock: false,
      usageShock: false,
      shotsShock: false,
      teammatesOutCount: 0,
      consistencyScore: 0,
      confidenceScore: 0,
      juiceLagBonus: 0,
    };
  }
  passedChecks.push(`Minutes floor: median ${medianMinutes.toFixed(0)} ≥ ${config.minutesFloor}`);
  
  // === CHECK 3: Defense Adjustment ===
  const defenseAdjustment = calculateDefenseAdjustment(candidate.opponentDefenseRank);
  const adjustedEdge = rawEdge + defenseAdjustment;
  
  if (adjustedEdge < config.adjustedEdgeMin) {
    failedChecks.push(`Adjusted edge ${adjustedEdge.toFixed(1)} < ${config.adjustedEdgeMin} (defense rank ${candidate.opponentDefenseRank})`);
    return {
      status: 'BLOCK',
      blockReason: 'Bad Defensive Matchup',
      ...baseResult,
      defenseAdjustment,
      adjustedEdge,
      splitEdge: 0,
      isShockFlagged: false,
      shockReasons: [],
      shockPassedValidation: true,
      minutesShock: false,
      usageShock: false,
      shotsShock: false,
      teammatesOutCount: 0,
      consistencyScore: 0,
      confidenceScore: 0,
      juiceLagBonus: 0,
    };
  }
  passedChecks.push(`Defense adjustment: ${defenseAdjustment >= 0 ? '+' : ''}${defenseAdjustment.toFixed(1)} (rank ${candidate.opponentDefenseRank})`);
  
  // === CHECK 4: Home/Away Split ===
  const homeStats: number[] = [];
  const awayStats: number[] = [];
  candidate.statLast10.forEach((p, i) => {
    if (candidate.homeAwayLast10[i] === 'HOME') homeStats.push(p);
    else awayStats.push(p);
  });
  
  const relevantSplitStats = candidate.location === 'HOME' ? homeStats : awayStats;
  const splitMedian = relevantSplitStats.length > 0 ? median(relevantSplitStats) : medianStat;
  const splitEdge = betSide === 'UNDER'
    ? candidate.bookLine - splitMedian
    : splitMedian - candidate.bookLine;
  
  if (splitEdge < config.splitEdgeMin) {
    failedChecks.push(`${candidate.location} split edge ${splitEdge.toFixed(1)} < ${config.splitEdgeMin}`);
    return {
      status: 'BLOCK',
      blockReason: 'Weak Home/Away Edge',
      ...baseResult,
      defenseAdjustment,
      adjustedEdge,
      splitEdge,
      isShockFlagged: false,
      shockReasons: [],
      shockPassedValidation: true,
      minutesShock: false,
      usageShock: false,
      shotsShock: false,
      teammatesOutCount: 0,
      consistencyScore: 0,
      confidenceScore: 0,
      juiceLagBonus: 0,
    };
  }
  passedChecks.push(`${candidate.location} split edge: ${splitEdge.toFixed(1)} ≥ ${config.splitEdgeMin}`);
  
  // === CHECK 5: Juice Lag Detector ===
  const juiceDelta = candidate.currentPrice - candidate.openingPrice;
  const juiceLagBonus = (juiceDelta <= -15) ? 1.5 : 0;
  if (juiceLagBonus > 0) {
    passedChecks.push(`Juice lag bonus: +${juiceLagBonus} (price moved ${juiceDelta})`);
  }
  
  // === CHECK 6: Shock Detection (uses statLast10 now) ===
  const shockResult = detectUsageShock(candidate, candidate.bookLine);
  
  if (shockResult.isShock && !shockResult.passedValidation) {
    failedChecks.push(`Shock flag: ${shockResult.reasons.join(', ')} - failed validation`);
    return {
      status: 'BLOCK',
      blockReason: 'Shock Flag Failed Validation',
      ...baseResult,
      defenseAdjustment,
      adjustedEdge,
      splitEdge,
      isShockFlagged: true,
      shockReasons: shockResult.reasons,
      shockPassedValidation: false,
      minutesShock: shockResult.minutesShock,
      usageShock: shockResult.usageShock,
      shotsShock: shockResult.shotsShock,
      teammatesOutCount: candidate.teammatesOut.length,
      consistencyScore: 0,
      confidenceScore: 0,
      juiceLagBonus,
    };
  }
  
  if (shockResult.isShock && shockResult.passedValidation) {
    passedChecks.push(`Shock flag: ${shockResult.reasons.join(', ')} - passed validation`);
  }
  
  // === CALCULATE FINAL SCORES ===
  const statStdDev = stdDev(candidate.statLast10);
  const consistencyScore = statStdDev > 0 ? medianStat / statStdDev : medianStat;
  
  // ConfidenceScore formula:
  // AdjustedEdge × 0.35 × 10 + HitRate × 40 + (MedianMinutes / 30) × 10 + ConsistencyScore × 8 + JuiceLagBonus × 5 - (ShockFlag ? 6 : 0)
  let confidenceScore = 
    (adjustedEdge * 3.5) +           // Edge weight (0.35 * 10)
    (hitRate * 40) +                  // Hit rate weight
    ((medianMinutes / 30) * 10) +     // Minutes weight
    (Math.min(consistencyScore, 5) * 8) + // Consistency weight (capped)
    (juiceLagBonus * 5) -             // Juice lag bonus
    (shockResult.isShock ? 6 : 0);    // Shock penalty
  
  // Classify
  let status: 'LOCK' | 'STRONG' | 'BLOCK';
  if (confidenceScore >= 85) {
    status = 'LOCK';
    passedChecks.push(`Confidence ${confidenceScore.toFixed(1)} ≥ 85 → LOCK`);
  } else if (confidenceScore >= 75) {
    status = 'STRONG';
    passedChecks.push(`Confidence ${confidenceScore.toFixed(1)} ≥ 75 → STRONG`);
  } else {
    status = 'BLOCK';
    failedChecks.push(`Confidence ${confidenceScore.toFixed(1)} < 75 → BLOCK`);
  }
  
  return {
    status,
    blockReason: status === 'BLOCK' ? 'Low Confidence Score' : undefined,
    ...baseResult,
    defenseAdjustment,
    adjustedEdge,
    splitEdge,
    isShockFlagged: shockResult.isShock,
    shockReasons: shockResult.reasons,
    shockPassedValidation: shockResult.passedValidation,
    minutesShock: shockResult.minutesShock,
    usageShock: shockResult.usageShock,
    shotsShock: shockResult.shotsShock,
    teammatesOutCount: candidate.teammatesOut.length,
    consistencyScore,
    confidenceScore,
    juiceLagBonus,
  };
}

// ============ GREEN SLIP BUILDER ============

interface CandidateWithId extends MedianLockResult {
  id: string;
  playerName: string;
  teamName: string;
  propType: string;
  eventId: string;
  bookLine: number;
}

function generateCombinations<T>(arr: T[], size: number): T[][] {
  if (size > arr.length) return [];
  if (size === 1) return arr.map(item => [item]);
  
  const result: T[][] = [];
  for (let i = 0; i <= arr.length - size; i++) {
    const subCombos = generateCombinations(arr.slice(i + 1), size - 1);
    for (const combo of subCombos) {
      result.push([arr[i], ...combo]);
    }
  }
  return result;
}

function buildGreenSlips(
  candidates: CandidateWithId[],
  slipType: '2-leg' | '3-leg'
): GreenSlip[] {
  // Filter to LOCK and eligible STRONG
  const eligible = candidates.filter(c => 
    c.status === 'LOCK' || 
    (c.status === 'STRONG' && (!c.isShockFlagged || c.hitRateLast5 >= 0.8))
  );
  
  if (eligible.length < (slipType === '2-leg' ? 2 : 3)) {
    return [];
  }
  
  const targetLegs = slipType === '2-leg' ? 2 : 3;
  const combinations = generateCombinations(eligible, targetLegs);
  
  console.log(`Building ${slipType} slips from ${eligible.length} eligible candidates, ${combinations.length} combinations`);
  
  // Filter out conflicts
  const validSlips = combinations.filter(combo => {
    // No duplicate players
    const players = combo.map(c => c.playerName);
    const uniquePlayers = new Set(players);
    if (uniquePlayers.size < combo.length) return false;
    
    // Limit same-game legs to max 2 to reduce correlation risk
    const events = combo.map(c => c.eventId);
    const eventCounts = events.reduce((acc, e) => {
      acc[e] = (acc[e] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const maxSameGame = Math.max(...Object.values(eventCounts));
    if (maxSameGame > 2) return false;
    
    return true;
  });
  
  // Score and rank slips
  const scoredSlips: GreenSlip[] = validSlips.map(combo => {
    const avgJuiceLag = average(combo.map(c => c.juiceLagBonus));
    const strongCount = combo.filter(c => c.status === 'STRONG').length;
    
    const slipScore = 
      combo.reduce((sum, c) => sum + c.confidenceScore, 0) +
      (3 * avgJuiceLag) -
      (2 * strongCount);
    
    // Calculate probability with clamping
    const probability = combo.reduce((prod, c) => {
      const clampedHitRate = Math.min(0.95, Math.max(0.55, c.hitRate));
      return prod * clampedHitRate;
    }, 1);
    
    // Same-game penalty
    const events = combo.map(c => c.eventId);
    const uniqueEvents = new Set(events);
    const sameGamePenalty = uniqueEvents.size < combo.length ? 0.03 : 0;
    const adjustedProb = probability - sameGamePenalty;
    
    // Stake tier
    let stakeTier: 'A' | 'B' | 'C';
    if (adjustedProb >= 0.62) stakeTier = 'A';
    else if (adjustedProb >= 0.55) stakeTier = 'B';
    else stakeTier = 'C';
    
    return {
      legs: combo,
      legIds: combo.map(c => c.id),
      slipScore,
      probability: adjustedProb,
      stakeTier,
    };
  });
  
  console.log(`Generated ${scoredSlips.length} valid ${slipType} slips`);
  
  // Return top 10 sorted by slip score
  return scoredSlips
    .sort((a, b) => b.slipScore - a.slipScore)
    .slice(0, 10);
}

// ============ MAIN HANDLER ============

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { action, slateDate, config } = await req.json();
    const engineConfig: EngineConfig = { ...DEFAULT_CONFIG, ...config };
    const targetDate = slateDate || new Date().toISOString().split('T')[0];

    console.log(`MedianLock™ PRO Engine: action=${action}, date=${targetDate}`);

    if (action === 'run') {
      // Fetch player prop candidates from existing hitrate data
      const { data: propData, error: propError } = await supabase
        .from('player_prop_hitrates')
        .select('*')
        .gte('expires_at', new Date().toISOString());

      if (propError) throw propError;

      // Get unique player names from active props
      const playerNames = [...new Set(propData?.map(p => p.player_name) || [])];
      console.log(`Fetching game logs for ${playerNames.length} players with active props`);

      // Fetch game logs ONLY for players with active props (avoids 1000 row limit issue)
      const { data: gameLogs, error: logsError } = await supabase
        .from('nba_player_game_logs')
        .select('*')
        .in('player_name', playerNames)
        .order('game_date', { ascending: false });

      if (logsError) throw logsError;

      // Group game logs by player
      const playerLogs: Record<string, typeof gameLogs> = {};
      gameLogs?.forEach(log => {
        const key = log.player_name;
        if (!playerLogs[key]) playerLogs[key] = [];
        playerLogs[key].push(log);
      });

      const playersWithLogs = Object.keys(playerLogs).length;
      console.log(`Grouped ${gameLogs?.length || 0} game logs into ${playersWithLogs} unique players`);

      const results: CandidateWithId[] = [];
      const processed = new Set<string>();
      let skippedLowGames = 0;

      console.log(`Processing ${(propData || []).length} props for candidates`);
      
      for (const prop of propData || []) {
        const key = `${prop.player_name}_${prop.prop_type}`;
        if (processed.has(key)) continue;
        processed.add(key);

        // Filter out zero-minute games (DNP/inactive) before slicing
        const logs = (playerLogs[prop.player_name] || [])
          .filter(l => (l.minutes_played || 0) > 0)
          .slice(0, 10);
        if (logs.length < 5) {
          skippedLowGames++;
          console.log(`SKIP: ${prop.player_name} - only ${logs.length} valid games`);
          continue;
        }

        // Build candidate from available data
        const candidate: PlayerPropCandidate = {
          playerName: prop.player_name,
          teamName: logs[0]?.team_abbreviation || 'UNK',
          propType: prop.prop_type,
          bookLine: prop.current_line,
          currentPrice: -110, // Default if not available
          openingPrice: -110,
          location: logs[0]?.is_home ? 'HOME' : 'AWAY',
          opponent: logs[0]?.opponent_abbreviation || 'UNK',
          opponentDefenseRank: 15, // Default to average
          eventId: prop.event_id || `${prop.player_name}_${targetDate}`,
          recommendedSide: (prop.recommended_side || 'over') as 'over' | 'under',
          statLast10: logs.map(l => getStatForPropType(l, prop.prop_type)),
          minutesLast10: logs.map(l => l.minutes_played || 0),
          usageLast10: logs.map(l => l.usage_rate || 25),
          shotsLast10: logs.map(l => l.field_goals_attempted || 10),
          homeAwayLast10: logs.map(l => l.is_home ? 'HOME' : 'AWAY') as ('HOME' | 'AWAY')[],
          teammatesOut: [],
          teammatesQuestionable: [],
          isNewlyStarting: false,
        };

        const result = evaluateCandidate(candidate, engineConfig);
        
        console.log(`EVALUATED: ${prop.player_name} ${prop.prop_type} ${candidate.recommendedSide} - status=${result.status}, blockReason=${result.blockReason || 'none'}, edge=${result.adjustedEdge?.toFixed(2)}, hitRate=${(result.hitRate * 100).toFixed(1)}%`);
        
        results.push({
          ...result,
          id: crypto.randomUUID(),
          playerName: candidate.playerName,
          teamName: candidate.teamName,
          propType: candidate.propType,
          eventId: candidate.eventId,
          bookLine: candidate.bookLine,
        });
      }

      const lockCount = results.filter(r => r.status === 'LOCK').length;
      const strongCount = results.filter(r => r.status === 'STRONG').length;
      const blockCount = results.filter(r => r.status === 'BLOCK').length;
      console.log(`Generated ${results.length} candidates: ${lockCount} LOCK, ${strongCount} STRONG, ${blockCount} BLOCK (skipped ${skippedLowGames} with <5 games)`);

      // Insert candidates into database
      const candidatesToInsert = results.map(r => ({
        player_name: r.playerName,
        team_name: r.teamName,
        prop_type: r.propType,
        book_line: r.bookLine || 0,
        slate_date: targetDate,
        bet_side: r.betSide,
        median_points: r.medianPoints,
        median_minutes: r.medianMinutes,
        median_usage: r.medianUsage,
        median_shots: r.medianShots,
        raw_edge: r.rawEdge,
        defense_adjustment: r.defenseAdjustment,
        adjusted_edge: r.adjustedEdge,
        split_edge: r.splitEdge,
        juice_lag_bonus: r.juiceLagBonus,
        hit_rate: r.hitRate,
        hit_rate_last_5: r.hitRateLast5,
        is_shock_flagged: r.isShockFlagged,
        shock_reasons: r.shockReasons,
        minutes_shock: r.minutesShock,
        usage_shock: r.usageShock,
        shots_shock: r.shotsShock,
        shock_passed_validation: r.shockPassedValidation,
        consistency_score: r.consistencyScore,
        confidence_score: r.confidenceScore,
        classification: r.status,
        block_reason: r.blockReason,
        passed_checks: r.passedChecks,
        failed_checks: r.failedChecks,
      }));

      if (candidatesToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('median_lock_candidates')
          .upsert(candidatesToInsert, { 
            onConflict: 'player_name,slate_date,prop_type,book_line',
            ignoreDuplicates: false 
          });
        
        if (insertError) console.error('Insert error:', insertError);
      }

      // Build Green Slips
      const locks = results.filter(r => r.status === 'LOCK' || r.status === 'STRONG');
      console.log(`Building slips from ${locks.length} LOCK/STRONG candidates`);
      
      const slip2 = buildGreenSlips(locks, '2-leg');
      console.log(`2-leg slips generated: ${slip2.length}`);
      
      const slip3 = buildGreenSlips(locks, '3-leg');
      console.log(`3-leg slips generated: ${slip3.length}`);
      
      if (slip3.length === 0 && locks.length >= 3) {
        console.warn(`WARNING: No 3-leg slips generated despite ${locks.length} eligible candidates. Check filtering logic.`);
      }

      // Delete existing slips for today before inserting new ones (prevents duplicates)
      const { error: deleteError } = await supabase
        .from('median_lock_slips')
        .delete()
        .eq('slate_date', targetDate);
      
      if (deleteError) {
        console.error('Error deleting existing slips:', deleteError);
      } else {
        console.log(`Deleted existing slips for ${targetDate}`);
      }

      // Insert slips
      const slipsToInsert = [
        ...slip2.map(s => ({
          slate_date: targetDate,
          slip_type: '2-leg',
          legs: s.legs.map(l => ({ 
            playerName: (l as CandidateWithId).playerName, 
            confidenceScore: l.confidenceScore, 
            status: l.status,
            betSide: l.betSide,
            propType: (l as CandidateWithId).propType,
            bookLine: (l as CandidateWithId).bookLine,
          })),
          leg_ids: s.legIds,
          slip_score: s.slipScore,
          probability: s.probability,
          stake_tier: s.stakeTier,
        })),
        ...slip3.map(s => ({
          slate_date: targetDate,
          slip_type: '3-leg',
          legs: s.legs.map(l => ({ 
            playerName: (l as CandidateWithId).playerName, 
            confidenceScore: l.confidenceScore, 
            status: l.status,
            betSide: l.betSide,
            propType: (l as CandidateWithId).propType,
            bookLine: (l as CandidateWithId).bookLine,
          })),
          leg_ids: s.legIds,
          slip_score: s.slipScore,
          probability: s.probability,
          stake_tier: s.stakeTier,
        })),
      ];

      console.log(`Total slips to insert: ${slipsToInsert.length} (${slip2.length} 2-leg, ${slip3.length} 3-leg)`);

      if (slipsToInsert.length > 0) {
        const { error: slipError } = await supabase
          .from('median_lock_slips')
          .insert(slipsToInsert);
        
        if (slipError) {
          console.error('Slip insert error:', slipError);
        } else {
          console.log(`Successfully inserted ${slipsToInsert.length} slips`);
        }
      }

      const summary = {
        date: targetDate,
        totalCandidates: results.length,
        locks: results.filter(r => r.status === 'LOCK').length,
        strongs: results.filter(r => r.status === 'STRONG').length,
        blocks: results.filter(r => r.status === 'BLOCK').length,
        shockFlagged: results.filter(r => r.isShockFlagged).length,
        greenSlips2: slip2.length,
        greenSlips3: slip3.length,
        topLocks: results
          .filter(r => r.status === 'LOCK')
          .sort((a, b) => b.confidenceScore - a.confidenceScore)
          .slice(0, 5)
          .map(r => ({
            player: r.playerName,
            confidence: r.confidenceScore,
            hitRate: r.hitRate,
            edge: r.adjustedEdge,
          })),
      };

      console.log('MedianLock™ PRO Summary:', JSON.stringify(summary));

      return new Response(JSON.stringify({ success: true, summary }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get_candidates') {
      const { data, error } = await supabase
        .from('median_lock_candidates')
        .select('*')
        .eq('slate_date', targetDate)
        .order('confidence_score', { ascending: false });

      if (error) throw error;

      return new Response(JSON.stringify({ success: true, candidates: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get_slips') {
      const { data, error } = await supabase
        .from('median_lock_slips')
        .select('*')
        .eq('slate_date', targetDate)
        .order('slip_score', { ascending: false });

      if (error) throw error;

      return new Response(JSON.stringify({ success: true, slips: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('MedianLock Engine error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
