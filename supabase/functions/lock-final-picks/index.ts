import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface JuicedProp {
  id: string;
  event_id: string;
  sport: string;
  game_description: string;
  player_name: string;
  prop_type: string;
  line: number;
  over_price: number;
  under_price: number;
  juice_level: string;
  juice_direction: string;
  juice_amount: number;
  bookmaker: string;
  commence_time: string;
  morning_scan_time?: string;
  // Unified intelligence columns
  unified_composite_score?: number;
  unified_pvs_tier?: string;
  unified_recommendation?: string;
  unified_confidence?: number;
  unified_trap_score?: number;
  used_unified_intelligence?: boolean;
  // Movement consistency columns
  movement_consistency_score?: number;
  total_movement_snapshots?: number;
  consistent_direction_moves?: number;
  dominant_movement_direction?: string;
}

interface MovementSnapshot {
  over_price: number;
  under_price: number;
  movement_direction: string;
  snapshot_time: string;
  price_delta: number;
}

interface FinalPickDecision {
  pick: 'over' | 'under' | null;
  reason: string;
  confidence: number;
  skip: boolean;
}

// MINIMUM CONFIDENCE THRESHOLD - 65% (lowered from 80% to allow more picks)
const MIN_CONFIDENCE_THRESHOLD = 0.65;

// AI BETTING KNOWLEDGE RULES
const AI_BETTING_RULES = {
  FOLLOW: ['LINE_AND_JUICE_MOVED', 'LATE_MONEY_SWEET_SPOT', 'INJURY_UNDER', 'MULTI_BOOK_CONSENSUS', 'PVS_S_TIER', 'PVS_A_TIER', 'CONSISTENT_MOVEMENT'],
  FADE: ['EARLY_MORNING_OVER', 'PRICE_ONLY_MOVE', 'FAKE_SHARP_TAG', 'STEAM_MOVE_NO_CONSENSUS', 'HIGH_TRAP_SCORE', 'PVS_D_TIER', 'INCONSISTENT_MOVEMENT'],
};

// PVS Tier confidence multipliers
const PVS_TIER_MULTIPLIERS: Record<string, number> = {
  'S': 1.20,
  'A': 1.12,
  'B': 1.05,
  'C': 0.95,
  'D': 0.85,
};

// Confidence boost factors for 80% threshold system
const CONFIDENCE_BOOSTS = {
  MCS_HIGH: 0.15,         // MCS ≥ 80% (4+ moves same direction)
  MCS_MEDIUM: 0.10,       // MCS ≥ 60% (3+ moves same direction)
  MULTI_BOOK_CONSENSUS: 0.10,
  LATE_MONEY_WINDOW: 0.08,
  LINE_AND_JUICE: 0.08,
  PVS_S_TIER: 0.07,
  PVS_A_TIER: 0.05,
  TOTAL_MOVEMENT_HIGH: 0.10, // Total movement ≥ 20 points
  INJURY_SIGNAL: 0.08,
  TRAP_SCORE_HIGH: 0.10,    // For fades
};

// Calculate Movement Consistency Score from history
function calculateMovementConsistency(
  movementSnapshots: number,
  consistentMoves: number,
  mcs: number,
  dominantDirection: string
): {
  isConsistent: boolean;
  direction: 'over' | 'under' | 'mixed';
  boost: number;
  description: string;
} {
  if (movementSnapshots < 2) {
    return {
      isConsistent: false,
      direction: 'mixed',
      boost: 0,
      description: 'Insufficient movement data',
    };
  }
  
  const direction = dominantDirection === 'over' ? 'over' : 
                    dominantDirection === 'under' ? 'under' : 'mixed';
  
  // High consistency: 80%+ of moves in same direction with 4+ total moves
  if (mcs >= 80 && consistentMoves >= 4) {
    return {
      isConsistent: true,
      direction,
      boost: CONFIDENCE_BOOSTS.MCS_HIGH,
      description: `Day-long ${direction} pressure (${mcs.toFixed(0)}% consistency, ${consistentMoves} moves)`,
    };
  }
  
  // Medium consistency: 60%+ of moves in same direction with 3+ moves
  if (mcs >= 60 && consistentMoves >= 3) {
    return {
      isConsistent: true,
      direction,
      boost: CONFIDENCE_BOOSTS.MCS_MEDIUM,
      description: `Consistent ${direction} movement (${mcs.toFixed(0)}% consistency)`,
    };
  }
  
  // Low/mixed consistency
  return {
    isConsistent: false,
    direction: 'mixed',
    boost: -0.05, // Penalty for inconsistent movement
    description: `Mixed movement signals (${mcs.toFixed(0)}% consistency)`,
  };
}

// Enhanced decision matrix for final picks - Now with 80% confidence threshold
function determineFinalPick(
  prop: JuicedProp,
  currentOverPrice: number,
  currentUnderPrice: number,
  hasSharpOnUnder: boolean,
  hasSharpOnOver: boolean,
  hoursToGame: number,
  isMorningTrap: boolean,
  hasInjurySignal: boolean,
  sharpSignals: string[],
  movementHistory: MovementSnapshot[]
): FinalPickDecision {
  const juiceLevel = prop.juice_level;
  const originalJuiceOnOver = prop.juice_direction === 'over';
  
  // Check if juice has reversed
  const currentJuiceOnOver = currentOverPrice < currentUnderPrice;
  const juiceReversed = originalJuiceOnOver !== currentJuiceOnOver;
  
  // Calculate how much the line moved
  const overPriceChange = currentOverPrice - prop.over_price;
  const totalMovement = Math.abs(overPriceChange);
  const steamMove = totalMovement >= 15;
  
  // 🧠 UNIFIED INTELLIGENCE ANALYSIS
  const hasUnified = prop.used_unified_intelligence && prop.unified_composite_score !== undefined;
  const unifiedComposite = prop.unified_composite_score || 0;
  const unifiedPvsTier = prop.unified_pvs_tier || 'C';
  const unifiedRecommendation = prop.unified_recommendation;
  const unifiedConfidence = prop.unified_confidence || 0;
  const unifiedTrapScore = prop.unified_trap_score || 0;
  
  // Get PVS tier multiplier
  const pvsMultiplier = PVS_TIER_MULTIPLIERS[unifiedPvsTier] || 1.0;
  
  // 📊 MOVEMENT CONSISTENCY ANALYSIS
  const mcs = prop.movement_consistency_score || 0;
  const totalSnapshots = prop.total_movement_snapshots || 0;
  const consistentMoves = prop.consistent_direction_moves || 0;
  const dominantDirection = prop.dominant_movement_direction || 'mixed';
  
  const movementAnalysis = calculateMovementConsistency(
    totalSnapshots,
    consistentMoves,
    mcs,
    dominantDirection
  );
  
  // Build confidence score starting from base
  let baseConfidence = 0.50;
  let reasons: string[] = [];
  let suggestedPick: 'over' | 'under' | null = null;
  
  // Check for confirmatory signals
  const hasPriceOnlyTrap = sharpSignals.some(s => s.includes('PRICE_ONLY'));
  const hasConfirmedSharp = sharpSignals.some(s => 
    s.includes('LINE_AND_JUICE') || s.includes('LATE_MONEY_SWEET_SPOT') || s.includes('MULTI_BOOK')
  );
  const isLateMoneyWindow = hoursToGame >= 1 && hoursToGame <= 3;
  
  // ==========================================
  // SIGNAL ANALYSIS & CONFIDENCE BUILDING
  // ==========================================
  
  // 1️⃣ Movement Consistency (Most Important)
  if (movementAnalysis.isConsistent) {
    baseConfidence += movementAnalysis.boost;
    suggestedPick = movementAnalysis.direction === 'over' ? 'over' : 
                    movementAnalysis.direction === 'under' ? 'under' : null;
    reasons.push(`📊 ${movementAnalysis.description}`);
  } else if (totalSnapshots >= 2) {
    baseConfidence += movementAnalysis.boost; // Apply penalty
    reasons.push(`⚠️ ${movementAnalysis.description}`);
  }
  
  // 2️⃣ High Trap Score - Strong fade signal
  if (hasUnified && unifiedTrapScore >= 70) {
    baseConfidence += CONFIDENCE_BOOSTS.TRAP_SCORE_HIGH;
    const fadePick: 'over' | 'under' = originalJuiceOnOver ? 'under' : 'over';
    if (!suggestedPick || movementAnalysis.direction === fadePick) {
      suggestedPick = fadePick;
    }
    reasons.push(`🚨 High trap score (${unifiedTrapScore}) - Fading public`);
  }
  
  // 3️⃣ S/A Tier PVS
  if (hasUnified && (unifiedPvsTier === 'S' || unifiedPvsTier === 'A') && unifiedComposite >= 70) {
    const pvsBoost = unifiedPvsTier === 'S' ? CONFIDENCE_BOOSTS.PVS_S_TIER : CONFIDENCE_BOOSTS.PVS_A_TIER;
    baseConfidence += pvsBoost;
    const pvsPick = unifiedRecommendation === 'over' ? 'over' : 'under';
    if (!suggestedPick) suggestedPick = pvsPick;
    reasons.push(`🧠 ${unifiedPvsTier}-Tier PVS (${unifiedComposite.toFixed(0)})`);
  }
  
  // 4️⃣ Multi-book consensus
  if (hasConfirmedSharp && sharpSignals.some(s => s.includes('MULTI_BOOK'))) {
    baseConfidence += CONFIDENCE_BOOSTS.MULTI_BOOK_CONSENSUS;
    reasons.push('📚 Multi-book consensus');
  }
  
  // 5️⃣ Late money window (1-3 hours)
  if (isLateMoneyWindow && (hasSharpOnOver || hasSharpOnUnder)) {
    baseConfidence += CONFIDENCE_BOOSTS.LATE_MONEY_WINDOW;
    if (!suggestedPick) {
      suggestedPick = hasSharpOnUnder ? 'under' : 'over';
    }
    reasons.push('🕐 Late money sweet spot (1-3hr)');
  }
  
  // 6️⃣ Line AND juice moved together
  if (hasConfirmedSharp && sharpSignals.some(s => s.includes('LINE_AND_JUICE'))) {
    baseConfidence += CONFIDENCE_BOOSTS.LINE_AND_JUICE;
    reasons.push('💰 Line + juice moved together');
  }
  
  // 7️⃣ Total movement ≥ 20 points
  if (totalMovement >= 20) {
    baseConfidence += CONFIDENCE_BOOSTS.TOTAL_MOVEMENT_HIGH;
    reasons.push(`📈 Major movement (${totalMovement.toFixed(0)} pts)`);
  }
  
  // 8️⃣ Injury signal
  if (hasInjurySignal) {
    baseConfidence += CONFIDENCE_BOOSTS.INJURY_SIGNAL;
    suggestedPick = 'under';
    reasons.push('🏥 Injury signal detected');
  }
  
  // 9️⃣ Morning trap fade
  if (isMorningTrap && prop.juice_direction === 'over') {
    baseConfidence += 0.05;
    if (!suggestedPick) suggestedPick = 'under';
    reasons.push('🌅 Fading early morning over trap');
  }
  
  // 🔟 Price-only trap (negative signal)
  if (hasPriceOnlyTrap && !hasConfirmedSharp) {
    baseConfidence -= 0.08;
    reasons.push('❌ Price-only move (trap indicator)');
  }
  
  // Apply PVS multiplier to final confidence
  let finalConfidence = baseConfidence * pvsMultiplier;
  
  // ==========================================
  // FINAL DECISION WITH 80% THRESHOLD
  // ==========================================
  
  // Determine final pick direction
  if (!suggestedPick) {
    // Default logic if no strong signals
    if (hasSharpOnUnder) {
      suggestedPick = 'under';
    } else if (hasSharpOnOver && hasConfirmedSharp) {
      suggestedPick = 'over';
    } else if (hasUnified && unifiedRecommendation) {
      suggestedPick = unifiedRecommendation === 'over' ? 'over' : 'under';
    } else {
      suggestedPick = 'under'; // Default fade
    }
  }
  
  // Check agreement between signals
  const movementAgrees = movementAnalysis.direction === suggestedPick || movementAnalysis.direction === 'mixed';
  const unifiedAgrees = !hasUnified || unifiedRecommendation === suggestedPick;
  const sharpAgrees = (suggestedPick === 'over' && hasSharpOnOver) || 
                      (suggestedPick === 'under' && hasSharpOnUnder) ||
                      (!hasSharpOnOver && !hasSharpOnUnder);
  
  // Bonus for signal agreement
  if (movementAgrees && unifiedAgrees && sharpAgrees && reasons.length >= 3) {
    finalConfidence += 0.05;
    reasons.push('✅ Signals aligned');
  }
  
  // Cap confidence at 0.95
  finalConfidence = Math.min(0.95, Math.max(0, finalConfidence));
  
  // ==========================================
  // 80% THRESHOLD CHECK
  // ==========================================
  
  if (finalConfidence < MIN_CONFIDENCE_THRESHOLD) {
    return {
      pick: null,
      reason: `⏭️ Below 65% threshold (${(finalConfidence * 100).toFixed(0)}%) | ${reasons.slice(0, 2).join(' | ')}`,
      confidence: finalConfidence,
      skip: true,
    };
  }
  
  // Check for inconsistent movement - require higher confidence (70% instead of 85%)
  if (!movementAnalysis.isConsistent && totalSnapshots >= 3) {
    // Inconsistent movement detected - need slightly higher confidence
    if (finalConfidence < 0.70) {
      return {
        pick: null,
        reason: `⏭️ Inconsistent day movement (${mcs.toFixed(0)}% MCS) - need 70%+ | ${reasons[0] || ''}`,
        confidence: finalConfidence,
        skip: true,
      };
    }
  }
  
  // Build final reason string
  const finalReason = reasons.slice(0, 4).join(' | ') + 
    (hasUnified ? ` | PVS: ${unifiedPvsTier}` : '');
  
  return {
    pick: suggestedPick,
    reason: finalReason,
    confidence: finalConfidence,
    skip: false,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    console.log('🔒 Starting final picks lock with 65% Confidence Threshold + Movement Consistency...');
    
    const now = new Date();
    const fifteenMinsFromNow = new Date(now.getTime() + 15 * 60 * 1000);
    const threeHoursFromNow = new Date(now.getTime() + 180 * 60 * 1000);
    
    // Get unlocked juiced props where game starts in 15-180 minutes (expanded from 30-90)
    const { data: propsToLock, error: fetchError } = await supabase
      .from('juiced_props')
      .select('*')
      .eq('is_locked', false)
      .gte('commence_time', fifteenMinsFromNow.toISOString())
      .lte('commence_time', threeHoursFromNow.toISOString());
    
    if (fetchError) {
      console.error('Error fetching props:', fetchError);
      throw fetchError;
    }
    
    console.log(`📋 Found ${propsToLock?.length || 0} props to evaluate`);
    
    if (!propsToLock || propsToLock.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No props to evaluate at this time',
        locked: 0,
        skipped: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Count props with movement data
    const withMCSCount = propsToLock.filter((p: any) => 
      p.movement_consistency_score !== null && p.total_movement_snapshots >= 2
    ).length;
    const withUnifiedCount = propsToLock.filter((p: any) => p.used_unified_intelligence).length;
    
    console.log(`📊 ${withMCSCount}/${propsToLock.length} props have MCS data`);
    console.log(`🧠 ${withUnifiedCount}/${propsToLock.length} props have Unified Intelligence`);
    
    // Fetch season standings for trap favorite detection
    const { data: standings } = await supabase
      .from('team_season_standings')
      .select('team_name, wins, losses, win_pct');
    
    const standingsMap = new Map<string, { wins: number; losses: number; winPct: number }>();
    (standings || []).forEach((s: any) => {
      standingsMap.set(s.team_name.toLowerCase(), { wins: s.wins, losses: s.losses, winPct: s.win_pct });
    });
    
    // Helper to check for trap favorite
    function checkTrapFavorite(gameDescription: string): { isTrap: boolean; warning: string | null } {
      const match = gameDescription.match(/(.+)\s+@\s+(.+)/);
      if (!match) return { isTrap: false, warning: null };
      
      const awayTeam = match[1].trim().toLowerCase();
      const homeTeam = match[2].trim().toLowerCase();
      
      const homeStanding = standingsMap.get(homeTeam);
      const awayStanding = standingsMap.get(awayTeam);
      
      if (!homeStanding || !awayStanding) return { isTrap: false, warning: null };
      
      const isTrap = awayStanding.winPct > homeStanding.winPct + 0.1;
      const warning = isTrap 
        ? `⚠️ TRAP: Worse team favored`
        : null;
      
      return { isTrap, warning };
    }
    
    const lockedPicks: Array<{
      id: string;
      player: string;
      prop: string;
      line: number;
      pick: string;
      odds: number;
      reason: string;
      confidence: number;
      usedUnified: boolean;
      pvsTier?: string;
      mcs?: number;
    }> = [];
    
    const skippedPicks: Array<{
      player: string;
      reason: string;
      confidence: number;
    }> = [];
    
    // Check for sharp money
    const { data: recentSharp } = await supabase
      .from('line_movements')
      .select('*')
      .eq('is_sharp_action', true)
      .gte('detected_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
    
    // Check for injury signals
    const { data: injuryMoves } = await supabase
      .from('line_movements')
      .select('*')
      .or('recommendation_reason.ilike.%injury%,sharp_indicator.ilike.%injury%')
      .gte('detected_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
    
    const playersWithInjurySignals = new Set(
      (injuryMoves || []).map((m: any) => m.player_name?.toLowerCase()).filter(Boolean)
    );
    
    // Process each prop
    for (const prop of propsToLock as JuicedProp[]) {
      const hoursToGame = (new Date(prop.commence_time).getTime() - now.getTime()) / (1000 * 60 * 60);
      
      const scanTime = prop.morning_scan_time ? new Date(prop.morning_scan_time) : now;
      const isMorningTrap = scanTime.getUTCHours() < 15 && hoursToGame > 6;
      
      const hasInjurySignal = playersWithInjurySignals.has(prop.player_name.toLowerCase());
      
      const sharpOnPlayer = (recentSharp || []).filter((s: any) => 
        s.player_name?.toLowerCase() === prop.player_name.toLowerCase()
      );
      
      const sharpSignals: string[] = sharpOnPlayer.flatMap((s: any) => {
        const signals: string[] = [];
        if (s.recommendation_reason?.includes('LINE_AND_JUICE')) signals.push('LINE_AND_JUICE');
        if (s.recommendation_reason?.includes('LATE_MONEY_SWEET_SPOT')) signals.push('LATE_MONEY_SWEET_SPOT');
        if (s.recommendation_reason?.includes('PRICE_ONLY')) signals.push('PRICE_ONLY_TRAP');
        if (s.recommendation_reason?.includes('MULTI_BOOK')) signals.push('MULTI_BOOK');
        if (s.movement_authenticity === 'real') signals.push('VERIFIED_SHARP');
        if (s.movement_authenticity === 'fake') signals.push('FAKE_SHARP');
        return signals;
      });
      
      const hasSharpOnOver = sharpOnPlayer.some((s: any) => 
        s.outcome_name?.toLowerCase().includes('over')
      );
      const hasSharpOnUnder = sharpOnPlayer.some((s: any) => 
        s.outcome_name?.toLowerCase().includes('under')
      );
      
      // Get movement history for this prop
      const { data: movementHistory } = await supabase
        .from('juiced_prop_movement_history')
        .select('*')
        .eq('juiced_prop_id', prop.id)
        .order('snapshot_time', { ascending: true });
      
      const currentOverPrice = prop.over_price;
      const currentUnderPrice = prop.under_price;
      
      const trapCheck = checkTrapFavorite(prop.game_description);
      
      // Determine final pick with 80% threshold
      const decision = determineFinalPick(
        prop,
        currentOverPrice,
        currentUnderPrice,
        hasSharpOnUnder,
        hasSharpOnOver,
        hoursToGame,
        isMorningTrap,
        hasInjurySignal,
        sharpSignals,
        (movementHistory || []) as MovementSnapshot[]
      );
      
      // Apply trap favorite penalty
      let adjustedConfidence = decision.confidence;
      let adjustedReason = decision.reason;
      if (trapCheck.isTrap && !decision.skip) {
        adjustedConfidence *= 0.90;
        adjustedReason += ` | ${trapCheck.warning}`;
      }
      
      // Skip if below threshold
      if (decision.skip || adjustedConfidence < MIN_CONFIDENCE_THRESHOLD) {
        skippedPicks.push({
          player: prop.player_name,
          reason: decision.reason,
          confidence: adjustedConfidence,
        });
        console.log(`⏭️ Skipped: ${prop.player_name} ${prop.prop_type} (${(adjustedConfidence * 100).toFixed(0)}%)`);
        continue;
      }
      
      // Lock the pick
      const { error: updateError } = await supabase
        .from('juiced_props')
        .update({
          final_pick: decision.pick,
          final_pick_reason: adjustedReason,
          final_pick_confidence: adjustedConfidence,
          final_pick_time: now.toISOString(),
          is_locked: true,
        })
        .eq('id', prop.id);
      
      if (updateError) {
        console.error(`Failed to lock prop ${prop.id}:`, updateError);
        continue;
      }
      
      const pickOdds = decision.pick === 'over' ? currentOverPrice : currentUnderPrice;
      
      lockedPicks.push({
        id: prop.id,
        player: prop.player_name,
        prop: prop.prop_type,
        line: prop.line,
        pick: decision.pick!.toUpperCase(),
        odds: pickOdds,
        reason: adjustedReason,
        confidence: adjustedConfidence,
        usedUnified: prop.used_unified_intelligence || false,
        pvsTier: prop.unified_pvs_tier,
        mcs: prop.movement_consistency_score,
      });
      
      console.log(`🔒 Locked: ${prop.player_name} ${decision.pick!.toUpperCase()} ${prop.line} (${(adjustedConfidence * 100).toFixed(0)}%) | MCS: ${(prop.movement_consistency_score || 0).toFixed(0)}%`);
    }
    
    // Send push notifications for locked picks
    if (lockedPicks.length > 0) {
      for (const pick of lockedPicks.slice(0, 5)) {
        try {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              action: 'notify_final_pick',
              data: {
                player: pick.player,
                prop: pick.prop,
                line: pick.line,
                pick: pick.pick,
                odds: pick.odds,
                reason: pick.reason,
                confidence: pick.confidence,
                pvsTier: pick.pvsTier,
                usedUnified: pick.usedUnified,
                mcs: pick.mcs,
              },
            },
          });
        } catch (notifyError) {
          console.error('Failed to send pick notification:', notifyError);
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      console.log(`📱 Sent ${Math.min(lockedPicks.length, 5)} final pick notifications`);
    }
    
    // Send email notifications (minimum 3 picks)
    if (lockedPicks.length >= 3) {
      try {
        const emailPicks = (propsToLock as JuicedProp[])
          .filter(p => lockedPicks.some(lp => lp.id === p.id))
          .map(p => {
            const locked = lockedPicks.find(lp => lp.id === p.id)!;
            return {
              player_name: p.player_name,
              prop_type: p.prop_type,
              line: p.line,
              final_pick: locked.pick.toLowerCase(),
              over_price: p.over_price,
              under_price: p.under_price,
              final_pick_reason: locked.reason,
              final_pick_confidence: locked.confidence,
              sport: p.sport,
              game_description: p.game_description,
              commence_time: p.commence_time,
              pvs_tier: p.unified_pvs_tier,
              used_unified: p.used_unified_intelligence,
              mcs: p.movement_consistency_score,
            };
          });
        
        await supabase.functions.invoke('send-juiced-picks-email', {
          body: { picks: emailPicks },
        });
        console.log(`📧 Triggered email notifications for ${emailPicks.length} picks`);
      } catch (emailError) {
        console.error('Failed to send email notifications:', emailError);
      }
    }
    
    const unifiedLockedCount = lockedPicks.filter(p => p.usedUnified).length;
    const avgMCS = lockedPicks.length > 0 
      ? lockedPicks.reduce((sum, p) => sum + (p.mcs || 0), 0) / lockedPicks.length 
      : 0;
    
    console.log(`\n📊 SUMMARY:`);
    console.log(`   ✅ Locked: ${lockedPicks.length} picks (80%+ confidence)`);
    console.log(`   ⏭️ Skipped: ${skippedPicks.length} picks (below threshold)`);
    console.log(`   🧠 With Unified: ${unifiedLockedCount}`);
    console.log(`   📈 Avg MCS: ${avgMCS.toFixed(1)}%`);
    
    return new Response(JSON.stringify({
      success: true,
      message: `Locked ${lockedPicks.length} picks (80%+ confidence), skipped ${skippedPicks.length}`,
      locked: lockedPicks.length,
      skipped: skippedPicks.length,
      withUnifiedIntelligence: unifiedLockedCount,
      avgMovementConsistency: avgMCS,
      picks: lockedPicks,
      skippedPicks: skippedPicks.slice(0, 10), // Include first 10 skipped for debugging
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error: any) {
    console.error('Error in lock-final-picks:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
