import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[ELITE-DAILY-HITTER] ${step}${detailsStr}`);
};

interface PickCandidate {
  id: string;
  playerName: string;
  propType: string;
  line: number;
  side: 'over' | 'under';
  odds: number;
  sport: string;
  eventId: string;
  gameDescription?: string;
  commenceTime: string;
  
  // Engine-specific data
  hitRate?: number;
  medianLockEdge?: number;
  sharpScore?: number;
  pvsScore?: number;
  fatigueImpact?: number;
  
  // Calculated fields
  p_leg: number;
  edge: number;
  variance: number;
  engines: string[];
  sourceEngine?: string; // Primary source engine
}

interface Combination {
  legs: PickCandidate[];
  slipScore: number;
  combinedProbability: number;
  totalEdge: number;
  variancePenalty: number;
  engineDiversityBonus: number;
  patternPenalty: number;
  matchupPenalty: number;
  blockedPatterns: string[];
}

// Calculate leg probability based on available signals
function calculateLegProbability(pick: PickCandidate): number {
  const signals: number[] = [];
  const weights: number[] = [];
  
  // Hit rate signal (most reliable - BOOSTED WEIGHT)
  if (pick.hitRate && pick.hitRate > 0) {
    const normalizedHitRate = pick.hitRate <= 1 ? pick.hitRate : pick.hitRate / 100;
    signals.push(normalizedHitRate);
    weights.push(2.0); // INCREASED from 1.5 to prioritize HitRate
  }
  
  // MedianLock edge (calibrated signal)
  if (pick.medianLockEdge && pick.medianLockEdge > 0) {
    const edgeProb = 0.55 + (pick.medianLockEdge / 100) * 0.2;
    signals.push(Math.min(edgeProb, 0.85));
    weights.push(1.2);
  }
  
  // Sharp money signal
  if (pick.sharpScore && pick.sharpScore > 0) {
    const sharpProb = 0.5 + (pick.sharpScore / 100) * 0.25;
    signals.push(Math.min(sharpProb, 0.80));
    weights.push(1.0);
  }
  
  // PVS score
  if (pick.pvsScore && pick.pvsScore > 0) {
    const pvsProb = 0.5 + (pick.pvsScore / 100) * 0.3;
    signals.push(Math.min(pvsProb, 0.85));
    weights.push(1.3);
  }
  
  // Fatigue impact (negative = good for other team)
  if (pick.fatigueImpact) {
    const fatigueProb = 0.5 + (pick.fatigueImpact / 100) * 0.15;
    signals.push(Math.max(0.4, Math.min(fatigueProb, 0.75)));
    weights.push(0.5);
  }
  
  if (signals.length === 0) {
    // Fallback to implied probability from odds
    if (pick.odds < 0) {
      return Math.abs(pick.odds) / (Math.abs(pick.odds) + 100);
    } else {
      return 100 / (pick.odds + 100);
    }
  }
  
  // Weighted average
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < signals.length; i++) {
    weightedSum += signals[i] * weights[i];
    totalWeight += weights[i];
  }
  
  const rawProbability = weightedSum / totalWeight;
  
  // Apply calibration based on number of confirming engines
  const engineBoost = Math.min(0.05, (pick.engines.length - 1) * 0.015);
  
  return Math.min(0.85, rawProbability + engineBoost);
}

// Calculate variance for a prop type
function getVariance(propType: string): number {
  const highVariance = ['rebounds', 'assists', 'blocks', 'steals', 'turnovers'];
  const mediumVariance = ['threes', '3pm', 'fantasy', 'fantasy_points'];
  
  const propLower = propType.toLowerCase();
  
  if (highVariance.some(v => propLower.includes(v))) return 0.2;
  if (mediumVariance.some(v => propLower.includes(v))) return 0.1;
  return 0.05; // Low variance (points, passing yards, etc.)
}

// Calculate engine diversity bonus - reward parlays with picks from different engines
function calculateEngineDiversityBonus(legs: PickCandidate[]): number {
  const uniqueEngines = new Set(legs.flatMap(l => l.engines));
  return Math.max(0, (uniqueEngines.size - 1) * 0.1);
}

// Loss Pattern structure for learned patterns
interface LossPattern {
  pattern_type: string;
  pattern_key: string;
  description: string;
  loss_count: number;
  hit_count: number;
  total_count: number;
  accuracy_rate: number;
  severity: string;
  penalty_amount: number;
  is_active: boolean;
}

// Matchup Pattern structure for defense-correlated patterns
interface MatchupPattern {
  sport: string;
  prop_type: string;
  side: string;
  defense_tier: string;
  hit_count: number;
  miss_count: number;
  total_count: number;
  accuracy_rate: number;
  penalty_amount: number;
  is_boost: boolean;
  is_active: boolean;
}

// Get defense tier from rank
function getDefenseTier(rank: number): string {
  if (rank <= 5) return 'elite';
  if (rank <= 12) return 'good';
  if (rank <= 20) return 'average';
  return 'weak';
}

// Extract opponent from game description
function extractOpponent(gameDescription: string): string {
  if (!gameDescription) return '';
  const parts = gameDescription.split(/[@vs]+/).map(s => s.trim());
  return parts[1] || parts[0] || '';
}

// Apply penalties based on learned loss patterns
function applyPatternPenalties(legs: PickCandidate[], patterns: LossPattern[]): { totalPenalty: number; blockedPatterns: string[]; appliedPenalties: { pattern: string; penalty: number }[] } {
  let totalPenalty = 0;
  const blockedPatterns: string[] = [];
  const appliedPenalties: { pattern: string; penalty: number }[] = [];
  
  if (!patterns || patterns.length === 0) {
    return { totalPenalty: 0, blockedPatterns: [], appliedPenalties: [] };
  }
  
  // Check engine concentration patterns
  const allEngines = legs.flatMap(l => l.engines);
  const uniqueEngines = new Set(allEngines);
  
  if (uniqueEngines.size === 1) {
    const singleEngine = [...uniqueEngines][0].toLowerCase();
    const enginePattern = patterns.find(p => 
      p.pattern_type === 'engine_concentration' && 
      p.pattern_key === `all_${singleEngine}_parlay` &&
      p.is_active
    );
    
    if (enginePattern) {
      if (enginePattern.severity === 'block') {
        blockedPatterns.push(enginePattern.pattern_key);
      } else {
        totalPenalty += enginePattern.penalty_amount;
        appliedPenalties.push({ pattern: enginePattern.pattern_key, penalty: enginePattern.penalty_amount });
      }
    }
  }
  
  // Check prop type + side patterns for each leg
  for (const leg of legs) {
    const propType = leg.propType?.toLowerCase()?.replace(/[^a-z]/g, '_') || 'unknown';
    const side = leg.side?.toLowerCase() || 'over';
    const patternKey = `${propType}_${side}`;
    
    const propPattern = patterns.find(p => 
      p.pattern_type === 'prop_type_side' && 
      p.pattern_key === patternKey &&
      p.is_active &&
      p.accuracy_rate < 0.50 // Only penalize underperforming patterns
    );
    
    if (propPattern) {
      if (propPattern.severity === 'block') {
        blockedPatterns.push(propPattern.pattern_key);
      } else {
        totalPenalty += propPattern.penalty_amount;
        appliedPenalties.push({ pattern: propPattern.pattern_key, penalty: propPattern.penalty_amount });
      }
    }
  }
  
  return { totalPenalty, blockedPatterns, appliedPenalties };
}

// Calculate SlipScore for a combination (with optional pattern penalties and matchup data)
function calculateSlipScore(
  legs: PickCandidate[], 
  patterns?: LossPattern[], 
  matchupPatterns?: MatchupPattern[],
  defenseDataMap?: Map<string, { defense_rank: number }>
): { slipScore: number; combinedProbability: number; totalEdge: number; variancePenalty: number; engineDiversityBonus: number; patternPenalty: number; matchupPenalty: number; blockedPatterns: string[] } {
  const EDGE_WEIGHT = 0.3;
  const VARIANCE_PENALTY_WEIGHT = 0.2;
  
  let logProbSum = 0;
  let combinedProbability = 1;
  let totalEdge = 0;
  let variancePenalty = 0;
  
  for (const leg of legs) {
    logProbSum += Math.log(leg.p_leg);
    combinedProbability *= leg.p_leg;
    totalEdge += leg.edge || 0;
    variancePenalty += leg.variance;
  }
  
  const engineDiversityBonus = calculateEngineDiversityBonus(legs);
  
  const { totalPenalty: patternPenalty, blockedPatterns } = 
    patterns ? applyPatternPenalties(legs, patterns) : { totalPenalty: 0, blockedPatterns: [] };
  
  let matchupPenalty = 0;
  if (matchupPatterns && matchupPatterns.length > 0 && defenseDataMap) {
    for (const leg of legs) {
      const opponent = extractOpponent(leg.gameDescription || '');
      const defenseData = defenseDataMap.get(opponent.toLowerCase());
      
      if (defenseData) {
        const tier = getDefenseTier(defenseData.defense_rank);
        const propType = leg.propType?.toLowerCase()?.replace(/[^a-z]/g, '_') || 'unknown';
        const side = leg.side?.toLowerCase() || 'over';
        
        const matchupPattern = matchupPatterns.find(p => 
          p.prop_type === propType &&
          p.side === side &&
          p.defense_tier === tier &&
          p.is_active &&
          p.total_count >= 3
        );
        
        if (matchupPattern) {
          if (matchupPattern.is_boost && matchupPattern.accuracy_rate >= 0.65) {
            matchupPenalty -= matchupPattern.penalty_amount;
          } else if (!matchupPattern.is_boost && matchupPattern.accuracy_rate < 0.50) {
            matchupPenalty += matchupPattern.penalty_amount;
          }
        }
      }
    }
  }
  
  const slipScore = logProbSum + (EDGE_WEIGHT * totalEdge) - (VARIANCE_PENALTY_WEIGHT * variancePenalty) + engineDiversityBonus - patternPenalty - matchupPenalty;
  
  return { slipScore, combinedProbability, totalEdge, variancePenalty, engineDiversityBonus, patternPenalty, matchupPenalty, blockedPatterns };
}

// Check if two legs are from the same event or team
function hasSameEventOrTeam(legs: PickCandidate[]): boolean {
  const events = new Set<string>();
  
  for (const leg of legs) {
    if (events.has(leg.eventId)) return true;
    events.add(leg.eventId);
  }
  
  return false;
}

// Check if two legs have the same player
function hasSamePlayer(legs: PickCandidate[]): boolean {
  const players = new Set<string>();
  
  for (const leg of legs) {
    const playerKey = leg.playerName?.toLowerCase();
    if (playerKey && players.has(playerKey)) return true;
    if (playerKey) players.add(playerKey);
  }
  
  return false;
}

// Check if a parlay has minimum HitRate backing
function hasMinHitRateLegs(legs: PickCandidate[], minCount: number = 2): boolean {
  const hitRateLegs = legs.filter(leg => 
    leg.sourceEngine === 'HitRate' || (leg.hitRate && leg.hitRate >= 0.65)
  );
  return hitRateLegs.length >= minCount;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Starting Elite Daily Hitter Engine v2");
    
    let force = false;
    try {
      const body = await req.json();
      force = body?.force === true;
      logStep("Request parsed", { force });
    } catch {
      // No body or invalid JSON
    }
    
    // Load learned loss patterns
    logStep("Loading learned loss patterns");
    const { data: lossPatterns, error: patternsError } = await supabaseClient
      .from('elite_hitter_loss_patterns')
      .select('*')
      .eq('is_active', true);
    
    if (patternsError) {
      logStep("Error loading patterns", { error: patternsError.message });
    } else {
      logStep("Loaded loss patterns", { 
        count: lossPatterns?.length || 0,
        blockedPatterns: lossPatterns?.filter((p: LossPattern) => p.severity === 'block').length || 0
      });
    }
    
    // Load matchup patterns
    logStep("Loading matchup patterns");
    const { data: matchupPatterns, error: matchupError } = await supabaseClient
      .from('elite_hitter_matchup_patterns')
      .select('*')
      .eq('is_active', true)
      .gte('total_count', 3);
    
    if (matchupError) {
      logStep("Error loading matchup patterns", { error: matchupError.message });
    } else {
      logStep("Loaded matchup patterns", { 
        count: matchupPatterns?.length || 0,
        boostPatterns: matchupPatterns?.filter((p: MatchupPattern) => p.is_boost).length || 0
      });
    }
    
    // Load defense rankings
    logStep("Loading defense rankings");
    const { data: defenseData } = await supabaseClient
      .from('nba_opponent_defense_stats')
      .select('team_name, defense_rank, defense_rating');
    
    const defenseDataMap = new Map<string, { defense_rank: number; defense_rating: number }>();
    for (const team of defenseData || []) {
      if (team.team_name) {
        defenseDataMap.set(team.team_name.toLowerCase(), {
          defense_rank: team.defense_rank,
          defense_rating: team.defense_rating
        });
      }
    }
    logStep("Defense data loaded", { teamCount: defenseDataMap.size });
    
    const today = new Date().toISOString().split('T')[0];
    const MAX_3LEG_PARLAYS = 5;
    const MAX_2LEG_PARLAYS = 3;
    
    // Check existing parlays
    const { data: existingParlays } = await supabaseClient
      .from('daily_elite_parlays')
      .select('id, leg_count')
      .eq('parlay_date', today);
    
    const existing3Leg = existingParlays?.filter(p => p.leg_count === 3 || !p.leg_count).length || 0;
    const existing2Leg = existingParlays?.filter(p => p.leg_count === 2).length || 0;
    
    if (existing3Leg >= MAX_3LEG_PARLAYS && existing2Leg >= MAX_2LEG_PARLAYS && !force) {
      logStep("Parlays already exist for today", { threeleg: existing3Leg, twoleg: existing2Leg });
      return new Response(JSON.stringify({ 
        success: true, 
        message: "Already generated for today",
        parlayCount: existingParlays?.length || 0 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
    
    // If force=true, delete existing parlays
    if (existingParlays && existingParlays.length > 0 && force) {
      logStep("Force regeneration requested, deleting existing parlays", { count: existingParlays.length });
      await supabaseClient
        .from('daily_elite_parlays')
        .delete()
        .eq('parlay_date', today);
    }
    
    // =====================================================
    // FETCH HIGH-CONFIDENCE PICKS FROM ALL ENGINES
    // =====================================================
    
    const eligiblePicks: PickCandidate[] = [];
    
    // 1. MedianLock candidates (LOCK/STRONG with high edge) - TODAY ONLY
    logStep("Fetching MedianLock candidates");
    
    const { data: medianLockData, error: mlError } = await supabaseClient
      .from('median_lock_candidates')
      .select('*')
      .in('classification', ['LOCK', 'STRONG'])
      .gte('adjusted_edge', 1.0)
      .eq('outcome', 'pending')
      .eq('slate_date', today)
      .order('adjusted_edge', { ascending: false })
      .limit(50);
    
    if (mlError) {
      logStep("MedianLock query error", { error: mlError.message });
    }
    
    logStep("MedianLock results", { count: medianLockData?.length || 0 });
    
    for (const m of medianLockData || []) {
      const existing = eligiblePicks.find(p => 
        p.playerName === m.player_name && 
        p.propType === m.prop_type
      );
      
      if (existing) {
        existing.medianLockEdge = m.adjusted_edge;
        existing.engines.push('MedianLock');
      } else {
        eligiblePicks.push({
          id: m.id,
          playerName: m.player_name,
          propType: m.prop_type,
          line: m.book_line,
          side: (m.bet_side?.toLowerCase() || 'over') as 'over' | 'under',
          odds: m.current_price || -110,
          sport: 'NBA',
          eventId: m.event_id || m.id,
          gameDescription: `${m.team_name} vs ${m.opponent}`,
          commenceTime: m.game_start_time || m.slate_date || new Date().toISOString(),
          medianLockEdge: m.adjusted_edge,
          hitRate: m.hit_rate,
          p_leg: 0,
          edge: m.adjusted_edge || 0,
          variance: 0,
          engines: ['MedianLock'],
          sourceEngine: 'MedianLock',
        });
      }
    }
    
    // 2. Hit Rate props - FIX: Use expires_at instead of commence_time, lower threshold to 65%
    logStep("Fetching Hit Rate candidates");
    const now = new Date().toISOString();
    
    const { data: hitRateData, error: hrError } = await supabaseClient
      .from('player_prop_hitrates')
      .select('*')
      .gte('expires_at', now) // FIX: Use expires_at instead of commence_time
      .or('hit_rate_over.gte.0.65,hit_rate_under.gte.0.65'); // FIX: Lowered to 65%
    
    if (hrError) {
      logStep("HitRate query error", { error: hrError.message });
    }
    
    logStep("HitRate results", { count: hitRateData?.length || 0 });
    
    for (const h of hitRateData || []) {
      const side = h.hit_rate_over >= h.hit_rate_under ? 'over' : 'under';
      const hitRate = side === 'over' ? h.hit_rate_over : h.hit_rate_under;
      
      // Check threshold (65% = 0.65)
      if (hitRate < 0.65) continue;
      
      const existing = eligiblePicks.find(p => 
        p.playerName === h.player_name && 
        p.propType === h.prop_type
      );
      
      if (existing) {
        existing.hitRate = hitRate;
        existing.engines.push('HitRate');
        if (!existing.sourceEngine) existing.sourceEngine = 'HitRate';
      } else {
        eligiblePicks.push({
          id: h.id,
          playerName: h.player_name,
          propType: h.prop_type,
          line: h.current_line,
          side,
          odds: side === 'over' ? (h.over_price || -110) : (h.under_price || -110),
          sport: h.sport || 'NBA',
          eventId: h.event_id || h.id,
          gameDescription: h.game_description,
          commenceTime: h.commence_time || h.expires_at || now,
          hitRate,
          p_leg: 0,
          edge: (hitRate - 0.50) * 20, // Convert to edge percentage
          variance: 0,
          engines: ['HitRate'],
          sourceEngine: 'HitRate',
        });
      }
    }
    
    // 3. Sharp Money signals - FIX: Use detected_at with 24-hour window
    logStep("Fetching Sharp Money candidates");
    const sharpCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: sharpData, error: sharpError } = await supabaseClient
      .from('line_movements')
      .select('*')
      .gte('sharp_edge_score', 35)
      .gte('authenticity_confidence', 0.7)
      .gte('detected_at', sharpCutoff) // FIX: Use detected_at instead of commence_time
      .is('outcome_verified', null);
    
    if (sharpError) {
      logStep("Sharp query error", { error: sharpError.message });
    }
    
    logStep("Sharp results", { count: sharpData?.length || 0 });
    
    for (const s of sharpData || []) {
      if (!s.player_name) continue;
      
      const existing = eligiblePicks.find(p => 
        p.playerName === s.player_name && 
        p.propType === s.market_type
      );
      
      if (existing) {
        existing.sharpScore = s.sharp_edge_score;
        existing.engines.push('Sharp');
      } else if (s.market_type) {
        eligiblePicks.push({
          id: s.id,
          playerName: s.player_name,
          propType: s.market_type,
          line: s.current_line || 0,
          side: (s.recommendation?.includes('OVER') ? 'over' : 'under') as 'over' | 'under',
          odds: -110,
          sport: s.sport || 'NBA',
          eventId: s.event_id || s.id,
          gameDescription: s.description,
          commenceTime: s.commence_time || s.detected_at || now,
          sharpScore: s.sharp_edge_score,
          p_leg: 0,
          edge: (s.sharp_edge_score || 0) / 20,
          variance: 0,
          engines: ['Sharp'],
          sourceEngine: 'Sharp',
        });
      }
    }
    
    // 4. PVS high-scoring props - FIX: Use created_at with 48-hour window
    logStep("Fetching PVS candidates");
    const pvsCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    
    const { data: pvsData, error: pvsError } = await supabaseClient
      .from('unified_props')
      .select('*')
      .gte('pvs_final_score', 75)
      .gte('created_at', pvsCutoff) // FIX: Use created_at instead of commence_time
      .eq('outcome', 'pending');
    
    if (pvsError) {
      logStep("PVS query error", { error: pvsError.message });
    }
    
    logStep("PVS results", { count: pvsData?.length || 0 });
    
    for (const p of pvsData || []) {
      const existing = eligiblePicks.find(ep => 
        ep.playerName === p.player_name && 
        ep.propType === p.prop_type
      );
      
      if (existing) {
        existing.pvsScore = p.pvs_final_score;
        existing.engines.push('PVS');
      } else {
        eligiblePicks.push({
          id: p.id,
          playerName: p.player_name,
          propType: p.prop_type,
          line: p.current_line,
          side: (p.recommended_side?.toLowerCase() || 'over') as 'over' | 'under',
          odds: p.recommended_side === 'over' ? (p.over_price || -110) : (p.under_price || -110),
          sport: p.sport,
          eventId: p.event_id,
          gameDescription: p.game_description,
          commenceTime: p.commence_time || p.created_at || now,
          pvsScore: p.pvs_final_score,
          p_leg: 0,
          edge: (p.pvs_final_score - 50) / 10,
          variance: 0,
          engines: ['PVS'],
          sourceEngine: 'PVS',
        });
      }
    }
    
    logStep("Total eligible picks before filtering", { count: eligiblePicks.length });
    
    // =====================================================
    // CALCULATE p_leg AND FILTER
    // =====================================================
    
    const MIN_LEG_PROBABILITY = 0.55;
    const PRIMARY_MIN_PROB = 0.15;      // 15% for #1 pick
    const ALTERNATIVE_MIN_PROB = 0.12;  // 12% for #2-5 picks
    const IDEAL_LEG_PROBABILITY = 0.70;
    const TWO_LEG_MIN_PROB = 0.25;      // 25% for 2-leg parlays
    
    for (const pick of eligiblePicks) {
      pick.p_leg = calculateLegProbability(pick);
      pick.variance = getVariance(pick.propType);
    }
    
    const qualityPicks = eligiblePicks.filter(p => p.p_leg >= MIN_LEG_PROBABILITY);
    
    logStep("Quality picks after minimum filter", { 
      count: qualityPicks.length,
      byEngine: {
        hitRate: qualityPicks.filter(p => p.sourceEngine === 'HitRate').length,
        medianLock: qualityPicks.filter(p => p.sourceEngine === 'MedianLock').length,
        sharp: qualityPicks.filter(p => p.sourceEngine === 'Sharp').length,
        pvs: qualityPicks.filter(p => p.sourceEngine === 'PVS').length,
      }
    });
    
    let highConfidencePicks = qualityPicks.filter(p => p.p_leg >= IDEAL_LEG_PROBABILITY);
    
    logStep("High-confidence picks (70%+)", { count: highConfidencePicks.length });
    
    if (highConfidencePicks.length < 3) {
      logStep("Not enough 70%+ picks, falling back to 55%+ quality threshold");
      const sorted = qualityPicks.sort((a, b) => b.p_leg - a.p_leg);
      highConfidencePicks = sorted.slice(0, Math.min(15, sorted.length));
    }
    
    if (highConfidencePicks.length < 3) {
      logStep("Not enough quality picks to generate parlay - AI CHOOSING NOT TO PRODUCE", { 
        count: highConfidencePicks.length,
        reason: "Quality threshold not met"
      });
      return new Response(JSON.stringify({ 
        success: false, 
        message: "No high-quality picks available today. AI refuses to generate a parlay below quality standards.",
        picksFound: highConfidencePicks.length,
        minimumRequired: 3
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
    
    // =====================================================
    // GENERATE ALL VALID 3-LEG COMBINATIONS
    // =====================================================
    
    const validCombinations: Combination[] = [];
    
    for (let i = 0; i < highConfidencePicks.length; i++) {
      for (let j = i + 1; j < highConfidencePicks.length; j++) {
        for (let k = j + 1; k < highConfidencePicks.length; k++) {
          const combo = [highConfidencePicks[i], highConfidencePicks[j], highConfidencePicks[k]];
          
          if (hasSameEventOrTeam(combo)) continue;
          
          const scores = calculateSlipScore(combo, lossPatterns || [], matchupPatterns || [], defenseDataMap);
          
          if (scores.blockedPatterns.length > 0) continue;
          
          validCombinations.push({
            legs: combo,
            ...scores
          });
        }
      }
    }
    
    logStep("Valid 3-leg combinations generated", { count: validCombinations.length });
    
    // Sort by slip score
    validCombinations.sort((a, b) => b.slipScore - a.slipScore);
    
    // Select up to MAX_3LEG_PARLAYS diverse parlays with HitRate priority for #1
    const selectedParlays: Combination[] = [];
    const usedPlayerCounts = new Map<string, number>();
    
    for (const combo of validCombinations) {
      if (selectedParlays.length >= MAX_3LEG_PARLAYS) break;
      
      // Tiered probability thresholds
      const minProb = selectedParlays.length === 0 ? PRIMARY_MIN_PROB : ALTERNATIVE_MIN_PROB;
      if (combo.combinedProbability < minProb) continue;
      
      // Require HitRate backing for #1 pick (at least 2 HitRate-backed legs)
      if (selectedParlays.length === 0 && !hasMinHitRateLegs(combo.legs, 2)) {
        continue;
      }
      
      const comboPlayers = combo.legs.map(l => l.playerName);
      
      let maxPlayerReuse = 0;
      for (const player of comboPlayers) {
        maxPlayerReuse = Math.max(maxPlayerReuse, usedPlayerCounts.get(player) || 0);
      }
      
      if (maxPlayerReuse >= 2) continue;
      
      selectedParlays.push(combo);
      comboPlayers.forEach(p => {
        usedPlayerCounts.set(p, (usedPlayerCounts.get(p) || 0) + 1);
      });
    }
    
    // If no #1 parlay with HitRate backing, try without that requirement
    if (selectedParlays.length === 0) {
      logStep("No parlays with HitRate backing, relaxing requirement");
      for (const combo of validCombinations) {
        if (selectedParlays.length >= MAX_3LEG_PARLAYS) break;
        if (combo.combinedProbability < PRIMARY_MIN_PROB) continue;
        
        const comboPlayers = combo.legs.map(l => l.playerName);
        let maxPlayerReuse = 0;
        for (const player of comboPlayers) {
          maxPlayerReuse = Math.max(maxPlayerReuse, usedPlayerCounts.get(player) || 0);
        }
        if (maxPlayerReuse >= 2) continue;
        
        selectedParlays.push(combo);
        comboPlayers.forEach(p => {
          usedPlayerCounts.set(p, (usedPlayerCounts.get(p) || 0) + 1);
        });
      }
    }
    
    logStep("Selected 3-leg parlays", { 
      count: selectedParlays.length,
      uniquePlayers: usedPlayerCounts.size
    });
    
    // =====================================================
    // GENERATE 2-LEG SAFE PARLAYS
    // =====================================================
    
    const twoLegPicks = qualityPicks.filter(p => p.p_leg >= 0.70); // Only 70%+ for 2-leggers
    
    logStep("Generating 2-leg safe parlays", { eligiblePicks: twoLegPicks.length });
    
    const twoLegCombinations: Combination[] = [];
    
    for (let i = 0; i < twoLegPicks.length; i++) {
      for (let j = i + 1; j < twoLegPicks.length; j++) {
        const leg1 = twoLegPicks[i];
        const leg2 = twoLegPicks[j];
        
        if (leg1.eventId === leg2.eventId) continue;
        if (leg1.playerName?.toLowerCase() === leg2.playerName?.toLowerCase()) continue;
        
        const combo = [leg1, leg2];
        const scores = calculateSlipScore(combo, lossPatterns || [], matchupPatterns || [], defenseDataMap);
        
        if (scores.blockedPatterns.length > 0) continue;
        
        twoLegCombinations.push({
          legs: combo,
          ...scores
        });
      }
    }
    
    // Sort by combined probability (safer = higher)
    twoLegCombinations.sort((a, b) => b.combinedProbability - a.combinedProbability);
    
    // Select top 3 diverse 2-leg parlays
    const selected2Leg: Combination[] = [];
    const used2LegPlayers = new Set<string>();
    
    for (const combo of twoLegCombinations) {
      if (selected2Leg.length >= MAX_2LEG_PARLAYS) break;
      if (combo.combinedProbability < TWO_LEG_MIN_PROB) continue;
      
      const players = combo.legs.map(l => l.playerName?.toLowerCase());
      const hasUsedPlayer = players.some(p => p && used2LegPlayers.has(p));
      if (hasUsedPlayer) continue;
      
      selected2Leg.push(combo);
      players.forEach(p => { if (p) used2LegPlayers.add(p); });
    }
    
    logStep("Selected 2-leg parlays", { count: selected2Leg.length });
    
    // =====================================================
    // SAVE ALL PARLAYS
    // =====================================================
    
    const { data: latestParlay } = await supabaseClient
      .from('daily_elite_parlays')
      .select('generation_round')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    const generationRound = (latestParlay?.generation_round || 0) + 1;
    
    const savedParlays = [];
    
    // Save 3-leg parlays
    for (let rank = 0; rank < selectedParlays.length; rank++) {
      const combo = selectedParlays[rank];
      
      const engineCounts: Record<string, number> = {};
      combo.legs.forEach(leg => {
        leg.engines.forEach(e => {
          engineCounts[e] = (engineCounts[e] || 0) + 1;
        });
      });
      
      const topEngines = Object.entries(engineCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([name, count]) => `${name} (${count} legs)`);
      
      const avgLegProb = combo.legs.reduce((sum, l) => sum + l.p_leg, 0) / 3;
      
      const selectionRationale = rank === 0 
        ? `#1 PRIMARY PICK: Selected from ${validCombinations.length} valid combinations. ` +
          `${(combo.combinedProbability * 100).toFixed(1)}% combined probability, ` +
          `${(avgLegProb * 100).toFixed(0)}% avg leg confidence. Engines: ${topEngines.join(', ')}.`
        : `#${rank + 1} ALTERNATIVE: Diverse option with ${(combo.combinedProbability * 100).toFixed(1)}% combined probability. ` +
          `Engines: ${topEngines.join(', ')}. Total edge: +${combo.totalEdge.toFixed(1)}%.`;
      
      let totalOdds = 1;
      for (const leg of combo.legs) {
        const decimalOdds = leg.odds < 0 
          ? 1 + (100 / Math.abs(leg.odds))
          : 1 + (leg.odds / 100);
        totalOdds *= decimalOdds;
      }
      const americanOdds = totalOdds >= 2 
        ? Math.round((totalOdds - 1) * 100)
        : Math.round(-100 / (totalOdds - 1));
      
      const formattedLegs = combo.legs.map(leg => ({
        id: leg.id,
        playerName: leg.playerName,
        propType: leg.propType,
        line: leg.line,
        side: leg.side,
        odds: leg.odds,
        sport: leg.sport,
        eventId: leg.eventId,
        gameDescription: leg.gameDescription,
        commenceTime: leg.commenceTime,
        p_leg: leg.p_leg,
        edge: leg.edge,
        engines: leg.engines,
        hitRate: leg.hitRate,
      }));
      
      const legProbabilities: Record<string, number> = {};
      const legEdges: Record<string, number> = {};
      const engineConsensus = [];
      const sports = new Set<string>();
      const allEngines = new Set<string>();
      
      for (let i = 0; i < combo.legs.length; i++) {
        const leg = combo.legs[i];
        const key = `leg${i + 1}`;
        legProbabilities[key] = leg.p_leg;
        legEdges[key] = leg.edge;
        engineConsensus.push({
          leg: key,
          playerName: leg.playerName,
          engines: leg.engines,
          confidence: leg.p_leg
        });
        sports.add(leg.sport);
        leg.engines.forEach(e => allEngines.add(e));
      }
      
      const { data: newParlay, error: insertError } = await supabaseClient
        .from('daily_elite_parlays')
        .insert({
          parlay_date: today,
          legs: formattedLegs,
          slip_score: combo.slipScore,
          combined_probability: combo.combinedProbability,
          total_edge: combo.totalEdge,
          variance_penalty: combo.variancePenalty,
          leg_probabilities: legProbabilities,
          leg_edges: legEdges,
          engine_consensus: engineConsensus,
          total_odds: americanOdds,
          sports: Array.from(sports),
          source_engines: Array.from(allEngines),
          generation_round: generationRound,
          selection_rationale: selectionRationale,
          rank: rank + 1,
          leg_count: 3,
        })
        .select()
        .single();
      
      if (insertError) {
        logStep(`Error saving 3-leg parlay rank ${rank + 1}`, { error: insertError.message });
        continue;
      }
      
      savedParlays.push(newParlay);
    }
    
    // Save 2-leg parlays
    for (let rank = 0; rank < selected2Leg.length; rank++) {
      const combo = selected2Leg[rank];
      
      const avgLegProb = combo.legs.reduce((sum, l) => sum + l.p_leg, 0) / 2;
      
      const selectionRationale = `2-LEG SAFE PICK #${rank + 1}: High-confidence legs for safer returns. ` +
        `${(combo.combinedProbability * 100).toFixed(1)}% combined probability, ` +
        `${(avgLegProb * 100).toFixed(0)}% avg leg confidence.`;
      
      let totalOdds = 1;
      for (const leg of combo.legs) {
        const decimalOdds = leg.odds < 0 
          ? 1 + (100 / Math.abs(leg.odds))
          : 1 + (leg.odds / 100);
        totalOdds *= decimalOdds;
      }
      const americanOdds = totalOdds >= 2 
        ? Math.round((totalOdds - 1) * 100)
        : Math.round(-100 / (totalOdds - 1));
      
      const formattedLegs = combo.legs.map(leg => ({
        id: leg.id,
        playerName: leg.playerName,
        propType: leg.propType,
        line: leg.line,
        side: leg.side,
        odds: leg.odds,
        sport: leg.sport,
        eventId: leg.eventId,
        gameDescription: leg.gameDescription,
        commenceTime: leg.commenceTime,
        p_leg: leg.p_leg,
        edge: leg.edge,
        engines: leg.engines,
        hitRate: leg.hitRate,
      }));
      
      const sports = new Set<string>();
      const allEngines = new Set<string>();
      combo.legs.forEach(leg => {
        sports.add(leg.sport);
        leg.engines.forEach(e => allEngines.add(e));
      });
      
      const { data: newParlay, error: insertError } = await supabaseClient
        .from('daily_elite_parlays')
        .insert({
          parlay_date: today,
          legs: formattedLegs,
          slip_score: combo.slipScore,
          combined_probability: combo.combinedProbability,
          total_edge: combo.totalEdge,
          variance_penalty: combo.variancePenalty,
          total_odds: americanOdds,
          sports: Array.from(sports),
          source_engines: Array.from(allEngines),
          generation_round: generationRound,
          selection_rationale: selectionRationale,
          rank: rank + 1,
          leg_count: 2,
        })
        .select()
        .single();
      
      if (insertError) {
        logStep(`Error saving 2-leg parlay rank ${rank + 1}`, { error: insertError.message });
        continue;
      }
      
      savedParlays.push(newParlay);
    }
    
    logStep("Daily Elite Hitter generation complete", { 
      saved3Leg: selectedParlays.length,
      saved2Leg: selected2Leg.length,
      totalSaved: savedParlays.length
    });
    
    return new Response(JSON.stringify({ 
      success: true, 
      parlays: savedParlays,
      stats: {
        eligiblePicks: eligiblePicks.length,
        highConfidencePicks: highConfidencePicks.length,
        valid3LegCombinations: validCombinations.length,
        valid2LegCombinations: twoLegCombinations.length,
        saved3Leg: selectedParlays.length,
        saved2Leg: selected2Leg.length
      }
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
