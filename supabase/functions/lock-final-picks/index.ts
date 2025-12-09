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
}

interface FinalPickDecision {
  pick: 'over' | 'under';
  reason: string;
  confidence: number;
}

// AI BETTING KNOWLEDGE RULES
const AI_BETTING_RULES = {
  FOLLOW: ['LINE_AND_JUICE_MOVED', 'LATE_MONEY_SWEET_SPOT', 'INJURY_UNDER', 'MULTI_BOOK_CONSENSUS', 'PVS_S_TIER', 'PVS_A_TIER'],
  FADE: ['EARLY_MORNING_OVER', 'PRICE_ONLY_MOVE', 'FAKE_SHARP_TAG', 'STEAM_MOVE_NO_CONSENSUS', 'HIGH_TRAP_SCORE', 'PVS_D_TIER'],
};

// PVS Tier confidence multipliers
const PVS_TIER_MULTIPLIERS: Record<string, number> = {
  'S': 1.20,
  'A': 1.12,
  'B': 1.05,
  'C': 0.95,
  'D': 0.85,
};

// Decision matrix for final picks - Now with Unified Intelligence
function determineFinalPick(
  prop: JuicedProp,
  currentOverPrice: number,
  currentUnderPrice: number,
  hasSharpOnUnder: boolean,
  hasSharpOnOver: boolean,
  hoursToGame: number,
  isMorningTrap: boolean,
  hasInjurySignal: boolean,
  sharpSignals: string[]
): FinalPickDecision {
  const juiceLevel = prop.juice_level;
  const originalJuiceOnOver = prop.juice_direction === 'over';
  
  // Check if juice has reversed
  const currentJuiceOnOver = currentOverPrice < currentUnderPrice;
  const juiceReversed = originalJuiceOnOver !== currentJuiceOnOver;
  
  // Calculate how much the line moved
  const overPriceChange = currentOverPrice - prop.over_price;
  const steamMove = Math.abs(overPriceChange) >= 15;
  
  // 🧠 UNIFIED INTELLIGENCE ANALYSIS
  const hasUnified = prop.used_unified_intelligence && prop.unified_composite_score !== undefined;
  const unifiedComposite = prop.unified_composite_score || 0;
  const unifiedPvsTier = prop.unified_pvs_tier || 'C';
  const unifiedRecommendation = prop.unified_recommendation;
  const unifiedConfidence = prop.unified_confidence || 0;
  const unifiedTrapScore = prop.unified_trap_score || 0;
  
  // Get PVS tier multiplier
  const pvsMultiplier = PVS_TIER_MULTIPLIERS[unifiedPvsTier] || 1.0;
  
  // 🚨 HIGH TRAP SCORE - Strong fade signal from unified intelligence
  if (hasUnified && unifiedTrapScore >= 70) {
    const pick: 'over' | 'under' = originalJuiceOnOver ? 'under' : 'over';
    return {
      pick,
      reason: `🚨 High trap score (${unifiedTrapScore}) from Unified AI - Fading`,
      confidence: Math.min(0.82, 0.70 * pvsMultiplier),
    };
  }
  
  // 🎯 S/A TIER PVS with unified recommendation agreement
  if (hasUnified && (unifiedPvsTier === 'S' || unifiedPvsTier === 'A') && unifiedComposite >= 70) {
    const unifiedPick = unifiedRecommendation === 'over' ? 'over' : 'under';
    return {
      pick: unifiedPick,
      reason: `🧠 ${unifiedPvsTier}-Tier PVS (${unifiedComposite.toFixed(0)}) | Unified AI: ${unifiedPick.toUpperCase()}`,
      confidence: Math.min(0.85, 0.75 * pvsMultiplier),
    };
  }
  
  // ✅ RULE: Follow unders with injury signals
  if (hasInjurySignal) {
    let confidence = 0.72;
    if (hasUnified && unifiedRecommendation === 'under') {
      confidence *= pvsMultiplier;
    }
    return {
      pick: 'under',
      reason: `🏥 Injury signal detected - lean Under${hasUnified ? ` | PVS: ${unifiedPvsTier}` : ''}`,
      confidence: Math.min(0.85, confidence),
    };
  }
  
  // ❌ RULE: Fade early morning overs (public trap)
  if (isMorningTrap && prop.juice_direction === 'over') {
    let confidence = 0.68;
    // Boost confidence if unified also says under or has trap score
    if (hasUnified) {
      if (unifiedRecommendation === 'under') confidence += 0.08;
      if (unifiedTrapScore >= 40) confidence += 0.05;
    }
    return {
      pick: 'under',
      reason: `🌅 Fading early morning over - likely public trap${hasUnified ? ` | Trap: ${unifiedTrapScore}` : ''}`,
      confidence: Math.min(0.82, confidence),
    };
  }
  
  // ✅ RULE: Follow late moves 1-3 hours pregame (sweet spot)
  const isLateMoneyWindow = hoursToGame >= 1 && hoursToGame <= 3;
  
  // Check for price-only traps in sharp signals
  const hasPriceOnlyTrap = sharpSignals.some(s => s.includes('PRICE_ONLY'));
  const hasConfirmedSharp = sharpSignals.some(s => 
    s.includes('LINE_AND_JUICE') || s.includes('LATE_MONEY_SWEET_SPOT') || s.includes('MULTI_BOOK')
  );
  
  // ❌ RULE: Fade price-only moves (trap)
  if (hasPriceOnlyTrap && !hasConfirmedSharp) {
    let confidence = 0.65;
    if (hasUnified && unifiedTrapScore >= 50) confidence += 0.08;
    return {
      pick: originalJuiceOnOver ? 'under' : 'over',
      reason: `❌ Fading price-only move - no line confirmation${hasUnified ? ` | Trap: ${unifiedTrapScore}` : ''}`,
      confidence: Math.min(0.78, confidence),
    };
  }
  
  // 🧠 UNIFIED INTELLIGENCE: Use composite score for borderline decisions
  if (hasUnified && unifiedComposite >= 65 && !steamMove) {
    const unifiedPick = unifiedRecommendation === 'over' ? 'over' : 'under';
    // Check if unified agrees with sharp signals
    const unifiedAgreesWithSharp = 
      (unifiedPick === 'over' && hasSharpOnOver) || 
      (unifiedPick === 'under' && hasSharpOnUnder);
    
    if (unifiedAgreesWithSharp) {
      return {
        pick: unifiedPick,
        reason: `🧠 Unified AI (${unifiedComposite.toFixed(0)}) + Sharp agree: ${unifiedPick.toUpperCase()} | ${unifiedPvsTier}-Tier`,
        confidence: Math.min(0.82, 0.72 * pvsMultiplier),
      };
    }
  }
  
  // Decision matrix - now with PVS multiplier
  if (juiceReversed) {
    let confidence = 0.68;
    if (hasUnified) confidence *= pvsMultiplier;
    return {
      pick: originalJuiceOnOver ? 'over' : 'under',
      reason: `🔄 Steam reversed - Value on original side${hasUnified ? ` | PVS: ${unifiedPvsTier}` : ''}`,
      confidence: Math.min(0.80, confidence),
    };
  }
  
  if (juiceLevel === 'heavy') {
    if (hasSharpOnUnder && !hasSharpOnOver) {
      let confidence = isLateMoneyWindow ? 0.78 : 0.75;
      if (hasUnified && unifiedRecommendation === 'under') confidence *= pvsMultiplier;
      return {
        pick: 'under',
        reason: `🎯 Sharp money fading heavy public Over${isLateMoneyWindow ? ' | 🕐 1-3hr window' : ''}${hasUnified ? ` | PVS: ${unifiedPvsTier}` : ''}`,
        confidence: Math.min(0.85, confidence),
      };
    }
    if (hasSharpOnOver && hasConfirmedSharp) {
      let confidence = 0.72;
      if (hasUnified && unifiedRecommendation === 'over' && unifiedPvsTier !== 'D') {
        confidence *= pvsMultiplier;
      }
      return {
        pick: 'over',
        reason: `💰 Sharp confirmation with line+juice move - Follow the money${hasUnified ? ` | PVS: ${unifiedPvsTier}` : ''}`,
        confidence: Math.min(0.82, confidence),
      };
    }
    let confidence = 0.65;
    if (hasUnified) confidence *= pvsMultiplier;
    return {
      pick: 'under',
      reason: `📉 Fading heavy public action - Line moved too far${hasUnified ? ` | PVS: ${unifiedPvsTier}` : ''}`,
      confidence: Math.min(0.75, confidence),
    };
  }
  
  if (juiceLevel === 'moderate') {
    if (hasSharpOnUnder) {
      let confidence = isLateMoneyWindow ? 0.73 : 0.70;
      if (hasUnified && unifiedRecommendation === 'under') confidence *= pvsMultiplier;
      return {
        pick: 'under',
        reason: `⚡ Sharp money on Under${isLateMoneyWindow ? ' | 🕐 1-3hr window' : ''}${hasUnified ? ` | PVS: ${unifiedPvsTier}` : ''}`,
        confidence: Math.min(0.82, confidence),
      };
    }
    if (hasSharpOnOver && steamMove && hasConfirmedSharp) {
      let confidence = 0.68;
      if (hasUnified && unifiedRecommendation === 'over') confidence *= pvsMultiplier;
      return {
        pick: 'over',
        reason: `🔥 Confirmed steam move with sharp action${hasUnified ? ` | PVS: ${unifiedPvsTier}` : ''}`,
        confidence: Math.min(0.78, confidence),
      };
    }
    let confidence = 0.60;
    if (hasUnified) confidence *= pvsMultiplier;
    return {
      pick: 'under',
      reason: `📊 Fading moderate public juice${hasUnified ? ` | PVS: ${unifiedPvsTier}` : ''}`,
      confidence: Math.min(0.72, confidence),
    };
  }
  
  // Light juice
  if (hasSharpOnUnder) {
    let confidence = isLateMoneyWindow ? 0.65 : 0.62;
    if (hasUnified && unifiedRecommendation === 'under') confidence *= pvsMultiplier;
    return {
      pick: 'under',
      reason: `💡 Sharp action on Under${hasUnified ? ` | PVS: ${unifiedPvsTier}` : ''}`,
      confidence: Math.min(0.75, confidence),
    };
  }
  if (hasSharpOnOver && hasConfirmedSharp) {
    let confidence = 0.60;
    if (hasUnified && unifiedRecommendation === 'over') confidence *= pvsMultiplier;
    return {
      pick: 'over',
      reason: `💡 Confirmed sharp action on Over${hasUnified ? ` | PVS: ${unifiedPvsTier}` : ''}`,
      confidence: Math.min(0.72, confidence),
    };
  }
  
  // Default - use unified if available
  if (hasUnified && unifiedComposite >= 55) {
    const unifiedPick = unifiedRecommendation === 'over' ? 'over' : 'under';
    return {
      pick: unifiedPick,
      reason: `🧠 Unified AI lean: ${unifiedPick.toUpperCase()} (${unifiedComposite.toFixed(0)}) | ${unifiedPvsTier}-Tier`,
      confidence: Math.min(0.68, 0.55 * pvsMultiplier),
    };
  }
  
  return {
    pick: 'under',
    reason: `⚖️ Slight lean to Under - fading public${hasUnified ? ` | PVS: ${unifiedPvsTier}` : ''}`,
    confidence: hasUnified ? 0.55 * pvsMultiplier : 0.55,
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
    
    console.log('🔒 Starting final picks lock with Unified Intelligence + Season Standings...');
    
    const now = new Date();
    const thirtyMinsFromNow = new Date(now.getTime() + 30 * 60 * 1000);
    const ninetyMinsFromNow = new Date(now.getTime() + 90 * 60 * 1000);
    
    // Get unlocked juiced props where game starts in 30-90 minutes
    const { data: propsToLock, error: fetchError } = await supabase
      .from('juiced_props')
      .select('*')
      .eq('is_locked', false)
      .gte('commence_time', thirtyMinsFromNow.toISOString())
      .lte('commence_time', ninetyMinsFromNow.toISOString());
    
    if (fetchError) {
      console.error('Error fetching props:', fetchError);
      throw fetchError;
    }
    
    console.log(`📋 Found ${propsToLock?.length || 0} props to lock`);
    
    if (!propsToLock || propsToLock.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No props to lock at this time',
        locked: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Count props with unified intelligence
    const withUnifiedCount = propsToLock.filter((p: any) => p.used_unified_intelligence).length;
    console.log(`🧠 ${withUnifiedCount}/${propsToLock.length} props have Unified Intelligence data`);
    
    // Fetch season standings for trap favorite detection
    const { data: standings } = await supabase
      .from('team_season_standings')
      .select('team_name, wins, losses, win_pct');
    
    // Build standings map
    const standingsMap = new Map<string, { wins: number; losses: number; winPct: number }>();
    (standings || []).forEach((s: any) => {
      standingsMap.set(s.team_name.toLowerCase(), { wins: s.wins, losses: s.losses, winPct: s.win_pct });
    });
    console.log(`📊 Loaded ${standingsMap.size} team standings for trap detection`);
    
    // Helper to check for trap favorite
    function checkTrapFavorite(gameDescription: string): { isTrap: boolean; warning: string | null; homeRecord: string | null; awayRecord: string | null } {
      // Parse "Away @ Home" format
      const match = gameDescription.match(/(.+)\s+@\s+(.+)/);
      if (!match) return { isTrap: false, warning: null, homeRecord: null, awayRecord: null };
      
      const awayTeam = match[1].trim().toLowerCase();
      const homeTeam = match[2].trim().toLowerCase();
      
      const homeStanding = standingsMap.get(homeTeam);
      const awayStanding = standingsMap.get(awayTeam);
      
      const homeRecord = homeStanding ? `${homeStanding.wins}-${homeStanding.losses}` : null;
      const awayRecord = awayStanding ? `${awayStanding.wins}-${awayStanding.losses}` : null;
      
      if (!homeStanding || !awayStanding) return { isTrap: false, warning: null, homeRecord, awayRecord };
      
      // Trap: home team is typically favored but has worse record
      const isTrap = awayStanding.winPct > homeStanding.winPct + 0.1;
      const warning = isTrap 
        ? `⚠️ TRAP: ${match[2].trim()} favored but ${homeRecord} vs ${awayRecord}`
        : null;
      
      return { isTrap, warning, homeRecord, awayRecord };
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
      trapFavorite?: boolean;
    }> = [];
    
    // Check for sharp money on related line movements
    const { data: recentSharp } = await supabase
      .from('line_movements')
      .select('*')
      .eq('is_sharp_action', true)
      .gte('detected_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
    
    // Check for injury signals in recent movements
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
      // Calculate hours to game
      const hoursToGame = (new Date(prop.commence_time).getTime() - now.getTime()) / (1000 * 60 * 60);
      
      // Check if this is a morning trap (prop found before 10 AM ET and > 6 hours to game)
      const scanTime = prop.morning_scan_time ? new Date(prop.morning_scan_time) : now;
      const isMorningTrap = scanTime.getUTCHours() < 15 && hoursToGame > 6;
      
      // Check for injury signal on this player
      const hasInjurySignal = playersWithInjurySignals.has(prop.player_name.toLowerCase());
      
      // Check if there's sharp action on this player
      const sharpOnPlayer = (recentSharp || []).filter((s: any) => 
        s.player_name?.toLowerCase() === prop.player_name.toLowerCase()
      );
      
      // Collect sharp signals for this player
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
      
      // For now, use original prices (could fetch current prices with API)
      const currentOverPrice = prop.over_price;
      const currentUnderPrice = prop.under_price;
      
      // Check for trap favorite based on season standings
      const trapCheck = checkTrapFavorite(prop.game_description);
      
      // Determine final pick with enhanced rules + Unified Intelligence
      const decision = determineFinalPick(
        prop,
        currentOverPrice,
        currentUnderPrice,
        hasSharpOnUnder,
        hasSharpOnOver,
        hoursToGame,
        isMorningTrap,
        hasInjurySignal,
        sharpSignals
      );
      
      // Apply trap favorite penalty
      let adjustedConfidence = decision.confidence;
      let adjustedReason = decision.reason;
      if (trapCheck.isTrap) {
        adjustedConfidence *= 0.85; // Reduce confidence by 15%
        adjustedReason += ` | ${trapCheck.warning}`;
        console.log(`⚠️ Trap favorite detected for ${prop.player_name}: ${trapCheck.warning}`);
      }
      
      // Update the database
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
        pick: decision.pick.toUpperCase(),
        odds: pickOdds,
        reason: adjustedReason,
        confidence: adjustedConfidence,
        usedUnified: prop.used_unified_intelligence || false,
        pvsTier: prop.unified_pvs_tier,
        trapFavorite: trapCheck.isTrap,
      });
      
      const unifiedTag = prop.used_unified_intelligence ? ` | 🧠 ${prop.unified_pvs_tier}-Tier` : '';
      const trapTag = trapCheck.isTrap ? ' | ⚠️ TRAP' : '';
      console.log(`🔒 Locked: ${prop.player_name} ${decision.pick.toUpperCase()} ${prop.line} ${prop.prop_type} (${Math.round(adjustedConfidence * 100)}%)${unifiedTag}${trapTag}`);
    }
    
    // Send push notifications for locked picks
    if (lockedPicks.length > 0) {
      for (const pick of lockedPicks.slice(0, 5)) { // Limit to 5 notifications
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
              },
            },
          });
        } catch (notifyError) {
          console.error('Failed to send pick notification:', notifyError);
        }
        
        // Small delay between notifications
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      console.log(`📱 Sent ${Math.min(lockedPicks.length, 5)} final pick notifications`);
    }
    
    // Send email notifications for locked picks (minimum 3 picks)
    if (lockedPicks.length >= 3) {
      try {
        // Build full pick data for email
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
    
    return new Response(JSON.stringify({
      success: true,
      message: `Locked ${lockedPicks.length} final picks (${unifiedLockedCount} with Unified Intelligence)`,
      locked: lockedPicks.length,
      withUnifiedIntelligence: unifiedLockedCount,
      picks: lockedPicks,
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
