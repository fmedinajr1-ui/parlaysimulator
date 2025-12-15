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
  
  pointsLast10: number[];
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
  edgeMin: 1.0,
  hitRateMin: 0.70,
  minutesFloor: 24,
  minutesMin: 18,
  splitEdgeMin: 0.5,
  adjustedEdgeMin: 0.5,
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

function calculateHitRate(values: number[], line: number): number {
  if (values.length === 0) return 0;
  const hits = values.filter(v => v >= line).length;
  return hits / values.length;
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
    const pointsLast5 = candidate.pointsLast10.slice(0, 5);
    const hitRateLast5 = calculateHitRate(pointsLast5, bookLine);
    const medianLast5 = median(pointsLast5);
    
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
  const medianPoints = median(candidate.pointsLast10);
  const medianMinutes = median(candidate.minutesLast10);
  const medianUsage = median(candidate.usageLast10);
  const medianShots = median(candidate.shotsLast10);
  
  // Raw edge and hit rate
  const rawEdge = medianPoints - candidate.bookLine;
  const hitRate = calculateHitRate(candidate.pointsLast10, candidate.bookLine);
  const hitRateLast5 = calculateHitRate(candidate.pointsLast10.slice(0, 5), candidate.bookLine);
  
  // Build base result
  const baseResult = {
    medianPoints,
    medianMinutes,
    medianUsage,
    medianShots,
    rawEdge,
    hitRate,
    hitRateLast5,
    passedChecks,
    failedChecks,
  };
  
  // === CHECK 1: Edge & Hit Rate ===
  if (rawEdge < config.edgeMin) {
    failedChecks.push(`Edge ${rawEdge.toFixed(1)} < ${config.edgeMin} min`);
  } else {
    passedChecks.push(`Edge ${rawEdge.toFixed(1)} ≥ ${config.edgeMin}`);
  }
  
  if (hitRate < config.hitRateMin) {
    failedChecks.push(`Hit rate ${(hitRate * 100).toFixed(0)}% < ${config.hitRateMin * 100}% min`);
  } else {
    passedChecks.push(`Hit rate ${(hitRate * 100).toFixed(0)}% ≥ ${config.hitRateMin * 100}%`);
  }
  
  if (rawEdge < config.edgeMin || hitRate < config.hitRateMin) {
    return {
      status: 'BLOCK',
      blockReason: 'Low Edge/Hit Rate',
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
  const homePoints: number[] = [];
  const awayPoints: number[] = [];
  candidate.pointsLast10.forEach((p, i) => {
    if (candidate.homeAwayLast10[i] === 'HOME') homePoints.push(p);
    else awayPoints.push(p);
  });
  
  const relevantSplitPoints = candidate.location === 'HOME' ? homePoints : awayPoints;
  const splitMedian = relevantSplitPoints.length > 0 ? median(relevantSplitPoints) : medianPoints;
  const splitEdge = splitMedian - candidate.bookLine;
  
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
  
  // === CHECK 6: Shock Detection ===
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
  const pointsStdDev = stdDev(candidate.pointsLast10);
  const consistencyScore = pointsStdDev > 0 ? medianPoints / pointsStdDev : medianPoints;
  
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
  
  // Filter out conflicts
  const validSlips = combinations.filter(combo => {
    // No same-team legs
    const teams = combo.map(c => c.teamName);
    const uniqueTeams = new Set(teams);
    if (uniqueTeams.size < combo.length) return false;
    
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

      // Fetch recent game logs
      const { data: gameLogs, error: logsError } = await supabase
        .from('nba_player_game_logs')
        .select('*')
        .order('game_date', { ascending: false })
        .limit(5000);

      if (logsError) throw logsError;

      // Group game logs by player
      const playerLogs: Record<string, typeof gameLogs> = {};
      gameLogs?.forEach(log => {
        const key = log.player_name;
        if (!playerLogs[key]) playerLogs[key] = [];
        playerLogs[key].push(log);
      });

      const results: CandidateWithId[] = [];
      const processed = new Set<string>();

      for (const prop of propData || []) {
        const key = `${prop.player_name}_${prop.prop_type}`;
        if (processed.has(key)) continue;
        processed.add(key);

        const logs = playerLogs[prop.player_name]?.slice(0, 10) || [];
        if (logs.length < 5) continue;

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
          pointsLast10: logs.map(l => l.points || 0),
          minutesLast10: logs.map(l => l.minutes_played || 0),
          usageLast10: logs.map(l => l.usage_rate || 25),
          shotsLast10: logs.map(l => l.field_goals_attempted || 10),
          homeAwayLast10: logs.map(l => l.is_home ? 'HOME' : 'AWAY') as ('HOME' | 'AWAY')[],
          teammatesOut: [],
          teammatesQuestionable: [],
          isNewlyStarting: false,
        };

        const result = evaluateCandidate(candidate, engineConfig);
        
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

      // Insert candidates into database
      const candidatesToInsert = results.map(r => ({
        player_name: r.playerName,
        team_name: r.teamName,
        prop_type: r.propType,
        book_line: r.bookLine || 0,
        slate_date: targetDate,
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
            onConflict: 'player_name,slate_date,prop_type',
            ignoreDuplicates: false 
          });
        
        if (insertError) console.error('Insert error:', insertError);
      }

      // Build Green Slips
      const locks = results.filter(r => r.status === 'LOCK' || r.status === 'STRONG');
      const slip2 = buildGreenSlips(locks, '2-leg');
      const slip3 = buildGreenSlips(locks, '3-leg');

      // Insert slips
      const slipsToInsert = [
        ...slip2.map(s => ({
          slate_date: targetDate,
          slip_type: '2-leg',
          legs: s.legs.map(l => ({ playerName: (l as CandidateWithId).playerName, confidenceScore: l.confidenceScore, status: l.status })),
          leg_ids: s.legIds,
          slip_score: s.slipScore,
          probability: s.probability,
          stake_tier: s.stakeTier,
        })),
        ...slip3.map(s => ({
          slate_date: targetDate,
          slip_type: '3-leg',
          legs: s.legs.map(l => ({ playerName: (l as CandidateWithId).playerName, confidenceScore: l.confidenceScore, status: l.status })),
          leg_ids: s.legIds,
          slip_score: s.slipScore,
          probability: s.probability,
          stake_tier: s.stakeTier,
        })),
      ];

      if (slipsToInsert.length > 0) {
        const { error: slipError } = await supabase
          .from('median_lock_slips')
          .insert(slipsToInsert);
        
        if (slipError) console.error('Slip insert error:', slipError);
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
