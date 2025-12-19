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
}

interface Combination {
  legs: PickCandidate[];
  slipScore: number;
  combinedProbability: number;
  totalEdge: number;
  variancePenalty: number;
}

// Calculate leg probability based on available signals
function calculateLegProbability(pick: PickCandidate): number {
  const signals: number[] = [];
  const weights: number[] = [];
  
  // Hit rate signal (most reliable)
  if (pick.hitRate && pick.hitRate > 0) {
    signals.push(pick.hitRate / 100);
    weights.push(1.5);
  }
  
  // MedianLock edge (calibrated signal)
  if (pick.medianLockEdge && pick.medianLockEdge > 0) {
    // Convert edge to probability boost
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

// Calculate SlipScore for a combination
function calculateSlipScore(legs: PickCandidate[]): { slipScore: number; combinedProbability: number; totalEdge: number; variancePenalty: number } {
  const EDGE_WEIGHT = 0.3;
  const VARIANCE_PENALTY_WEIGHT = 0.2;
  
  // Log-probability sum (higher is better probability)
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
  
  const slipScore = logProbSum + (EDGE_WEIGHT * totalEdge) - (VARIANCE_PENALTY_WEIGHT * variancePenalty);
  
  return { slipScore, combinedProbability, totalEdge, variancePenalty };
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
    logStep("Starting Elite Daily Hitter Engine");
    
    const today = new Date().toISOString().split('T')[0];
    
    // Check if we already have a parlay for today
    const { data: existingParlay } = await supabaseClient
      .from('daily_elite_parlays')
      .select('id')
      .eq('parlay_date', today)
      .maybeSingle();
    
    if (existingParlay) {
      logStep("Parlay already exists for today", { id: existingParlay.id });
      return new Response(JSON.stringify({ 
        success: true, 
        message: "Already generated for today",
        parlayId: existingParlay.id 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
    
    // =====================================================
    // FETCH HIGH-CONFIDENCE PICKS FROM ALL ENGINES
    // =====================================================
    
    const eligiblePicks: PickCandidate[] = [];
    const now = new Date();
    
    // 1. MedianLock candidates (LOCK/STRONG with high edge)
    logStep("Fetching MedianLock candidates");
    const { data: medianLockData } = await supabaseClient
      .from('median_lock_candidates')
      .select('*')
      .in('classification', ['LOCK', 'STRONG'])
      .gte('edge_percentage', 1.5)
      .gte('game_time', now.toISOString())
      .eq('outcome', 'pending');
    
    for (const m of medianLockData || []) {
      const existing = eligiblePicks.find(p => 
        p.playerName === m.player_name && 
        p.propType === m.prop_type
      );
      
      if (existing) {
        existing.medianLockEdge = m.edge_percentage;
        existing.engines.push('MedianLock');
      } else {
        eligiblePicks.push({
          id: m.id,
          playerName: m.player_name,
          propType: m.prop_type,
          line: m.median_line,
          side: (m.bet_side?.toLowerCase() || 'over') as 'over' | 'under',
          odds: -110,
          sport: m.sport || 'NBA',
          eventId: m.event_id || m.id,
          gameDescription: m.game_description,
          commenceTime: m.game_time,
          medianLockEdge: m.edge_percentage,
          p_leg: 0,
          edge: m.edge_percentage || 0,
          variance: 0,
          engines: ['MedianLock'],
        });
      }
    }
    
    // 2. Hit Rate props (≥75% hit rate)
    logStep("Fetching Hit Rate candidates");
    const { data: hitRateData } = await supabaseClient
      .from('player_prop_hitrates')
      .select('*')
      .gte('hit_rate_over', 75)
      .gte('commence_time', now.toISOString());
    
    for (const h of hitRateData || []) {
      const side = h.hit_rate_over >= h.hit_rate_under ? 'over' : 'under';
      const hitRate = side === 'over' ? h.hit_rate_over : h.hit_rate_under;
      
      if (hitRate < 75) continue;
      
      const existing = eligiblePicks.find(p => 
        p.playerName === h.player_name && 
        p.propType === h.prop_type
      );
      
      if (existing) {
        existing.hitRate = hitRate;
        existing.engines.push('HitRate');
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
          commenceTime: h.commence_time,
          hitRate,
          p_leg: 0,
          edge: (hitRate - 50) / 10,
          variance: 0,
          engines: ['HitRate'],
        });
      }
    }
    
    // 3. Sharp Money signals (high authenticity)
    logStep("Fetching Sharp Money candidates");
    const { data: sharpData } = await supabaseClient
      .from('line_movements')
      .select('*')
      .gte('ses_score', 35)
      .gte('authenticity_confidence', 0.7)
      .gte('commence_time', now.toISOString())
      .is('outcome_verified', null);
    
    for (const s of sharpData || []) {
      const existing = eligiblePicks.find(p => 
        p.playerName === s.player_name && 
        p.propType === s.prop_type
      );
      
      if (existing) {
        existing.sharpScore = s.ses_score;
        existing.engines.push('Sharp');
      } else if (s.player_name && s.prop_type) {
        eligiblePicks.push({
          id: s.id,
          playerName: s.player_name,
          propType: s.prop_type,
          line: s.current_line || 0,
          side: (s.recommendation?.includes('OVER') ? 'over' : 'under') as 'over' | 'under',
          odds: -110,
          sport: s.sport || 'NBA',
          eventId: s.event_id || s.id,
          gameDescription: s.description,
          commenceTime: s.commence_time,
          sharpScore: s.ses_score,
          p_leg: 0,
          edge: s.ses_score / 20,
          variance: 0,
          engines: ['Sharp'],
        });
      }
    }
    
    // 4. PVS high-scoring props (≥80)
    logStep("Fetching PVS candidates");
    const { data: pvsData } = await supabaseClient
      .from('unified_props')
      .select('*')
      .gte('pvs_final_score', 80)
      .gte('commence_time', now.toISOString())
      .eq('outcome', 'pending');
    
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
          commenceTime: p.commence_time,
          pvsScore: p.pvs_final_score,
          p_leg: 0,
          edge: (p.pvs_final_score - 50) / 10,
          variance: 0,
          engines: ['PVS'],
        });
      }
    }
    
    logStep("Total eligible picks before filtering", { count: eligiblePicks.length });
    
    // =====================================================
    // CALCULATE p_leg AND FILTER
    // =====================================================
    
    for (const pick of eligiblePicks) {
      pick.p_leg = calculateLegProbability(pick);
      pick.variance = getVariance(pick.propType);
    }
    
    // Filter for p_leg >= 0.70
    const highConfidencePicks = eligiblePicks.filter(p => p.p_leg >= 0.70);
    
    logStep("High-confidence picks after filtering", { 
      count: highConfidencePicks.length,
      picks: highConfidencePicks.map(p => ({ 
        player: p.playerName, 
        prop: p.propType, 
        p_leg: p.p_leg.toFixed(3),
        engines: p.engines.length 
      }))
    });
    
    if (highConfidencePicks.length < 3) {
      // Fall back to top 10 by p_leg if not enough high-confidence picks
      const sorted = eligiblePicks.sort((a, b) => b.p_leg - a.p_leg).slice(0, 10);
      if (sorted.length >= 3) {
        highConfidencePicks.push(...sorted.filter(s => !highConfidencePicks.includes(s)));
      }
    }
    
    if (highConfidencePicks.length < 3) {
      logStep("Not enough picks to generate parlay", { count: highConfidencePicks.length });
      return new Response(JSON.stringify({ 
        success: false, 
        message: "Not enough high-confidence picks available",
        picksFound: highConfidencePicks.length
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
          
          // Skip if same event/team
          if (hasSameEventOrTeam(combo)) continue;
          
          // Calculate slip score
          const scores = calculateSlipScore(combo);
          
          validCombinations.push({
            legs: combo,
            ...scores
          });
        }
      }
    }
    
    logStep("Valid combinations generated", { count: validCombinations.length });
    
    if (validCombinations.length === 0) {
      logStep("No valid combinations found");
      return new Response(JSON.stringify({ 
        success: false, 
        message: "No valid 3-leg combinations found"
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
    
    // Sort by slip score and select the best
    validCombinations.sort((a, b) => b.slipScore - a.slipScore);
    const bestCombo = validCombinations[0];
    
    logStep("Best combination selected", {
      slipScore: bestCombo.slipScore.toFixed(4),
      combinedProbability: (bestCombo.combinedProbability * 100).toFixed(2) + '%',
      legs: bestCombo.legs.map(l => `${l.playerName} ${l.propType} ${l.side} ${l.line}`)
    });
    
    // Calculate total odds
    let totalOdds = 1;
    for (const leg of bestCombo.legs) {
      const decimalOdds = leg.odds < 0 
        ? 1 + (100 / Math.abs(leg.odds))
        : 1 + (leg.odds / 100);
      totalOdds *= decimalOdds;
    }
    const americanOdds = totalOdds >= 2 
      ? Math.round((totalOdds - 1) * 100)
      : Math.round(-100 / (totalOdds - 1));
    
    // Format legs for storage
    const formattedLegs = bestCombo.legs.map(leg => ({
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
    }));
    
    const legProbabilities: Record<string, number> = {};
    const legEdges: Record<string, number> = {};
    const engineConsensus = [];
    const sports = new Set<string>();
    const allEngines = new Set<string>();
    
    for (let i = 0; i < bestCombo.legs.length; i++) {
      const leg = bestCombo.legs[i];
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
    
    // Get current generation round
    const { data: latestParlay } = await supabaseClient
      .from('daily_elite_parlays')
      .select('generation_round')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    const generationRound = (latestParlay?.generation_round || 0) + 1;
    
    // Save to database
    const { data: newParlay, error: insertError } = await supabaseClient
      .from('daily_elite_parlays')
      .insert({
        parlay_date: today,
        legs: formattedLegs,
        slip_score: bestCombo.slipScore,
        combined_probability: bestCombo.combinedProbability,
        total_edge: bestCombo.totalEdge,
        variance_penalty: bestCombo.variancePenalty,
        leg_probabilities: legProbabilities,
        leg_edges: legEdges,
        engine_consensus: engineConsensus,
        total_odds: americanOdds,
        sports: Array.from(sports),
        source_engines: Array.from(allEngines),
        generation_round: generationRound,
      })
      .select()
      .single();
    
    if (insertError) {
      logStep("Error saving parlay", { error: insertError.message });
      throw new Error(`Failed to save parlay: ${insertError.message}`);
    }
    
    logStep("Daily Elite Hitter generated successfully", { 
      id: newParlay.id,
      combinedProbability: (bestCombo.combinedProbability * 100).toFixed(2) + '%',
      totalOdds: americanOdds
    });
    
    return new Response(JSON.stringify({ 
      success: true, 
      parlay: newParlay,
      stats: {
        eligiblePicks: eligiblePicks.length,
        highConfidencePicks: highConfidencePicks.length,
        validCombinations: validCombinations.length,
        combinedProbability: bestCombo.combinedProbability,
        slipScore: bestCombo.slipScore
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