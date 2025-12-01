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
}

interface FinalPickDecision {
  pick: 'over' | 'under';
  reason: string;
  confidence: number;
}

// AI BETTING KNOWLEDGE RULES
const AI_BETTING_RULES = {
  FOLLOW: ['LINE_AND_JUICE_MOVED', 'LATE_MONEY_SWEET_SPOT', 'INJURY_UNDER', 'MULTI_BOOK_CONSENSUS'],
  FADE: ['EARLY_MORNING_OVER', 'PRICE_ONLY_MOVE', 'FAKE_SHARP_TAG', 'STEAM_MOVE_NO_CONSENSUS'],
};

// Decision matrix for final picks
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
  
  // ✅ RULE: Follow unders with injury signals
  if (hasInjurySignal) {
    return {
      pick: 'under',
      reason: '🏥 Injury signal detected - lean Under',
      confidence: 0.72,
    };
  }
  
  // ❌ RULE: Fade early morning overs (public trap)
  if (isMorningTrap && prop.juice_direction === 'over') {
    return {
      pick: 'under',
      reason: '🌅 Fading early morning over - likely public trap',
      confidence: 0.68,
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
    return {
      pick: originalJuiceOnOver ? 'under' : 'over',
      reason: '❌ Fading price-only move - no line confirmation',
      confidence: 0.65,
    };
  }
  
  // Decision matrix
  if (juiceReversed) {
    return {
      pick: originalJuiceOnOver ? 'over' : 'under',
      reason: '🔄 Steam reversed - Value on original side',
      confidence: 0.68,
    };
  }
  
  if (juiceLevel === 'heavy') {
    if (hasSharpOnUnder && !hasSharpOnOver) {
      const confidence = isLateMoneyWindow ? 0.78 : 0.75;
      return {
        pick: 'under',
        reason: `🎯 Sharp money fading heavy public Over${isLateMoneyWindow ? ' | 🕐 1-3hr window' : ''}`,
        confidence,
      };
    }
    if (hasSharpOnOver && hasConfirmedSharp) {
      return {
        pick: 'over',
        reason: '💰 Sharp confirmation with line+juice move - Follow the money',
        confidence: 0.72,
      };
    }
    return {
      pick: 'under',
      reason: '📉 Fading heavy public action - Line moved too far',
      confidence: 0.65,
    };
  }
  
  if (juiceLevel === 'moderate') {
    if (hasSharpOnUnder) {
      const confidence = isLateMoneyWindow ? 0.73 : 0.70;
      return {
        pick: 'under',
        reason: `⚡ Sharp money on Under${isLateMoneyWindow ? ' | 🕐 1-3hr window' : ''}`,
        confidence,
      };
    }
    if (hasSharpOnOver && steamMove && hasConfirmedSharp) {
      return {
        pick: 'over',
        reason: '🔥 Confirmed steam move with sharp action',
        confidence: 0.68,
      };
    }
    return {
      pick: 'under',
      reason: '📊 Fading moderate public juice',
      confidence: 0.60,
    };
  }
  
  // Light juice
  if (hasSharpOnUnder) {
    return {
      pick: 'under',
      reason: '💡 Sharp action on Under',
      confidence: isLateMoneyWindow ? 0.65 : 0.62,
    };
  }
  if (hasSharpOnOver && hasConfirmedSharp) {
    return {
      pick: 'over',
      reason: '💡 Confirmed sharp action on Over',
      confidence: 0.60,
    };
  }
  
  return {
    pick: 'under',
    reason: '⚖️ Slight lean to Under - fading public',
    confidence: 0.55,
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
    
    console.log('🔒 Starting final picks lock...');
    
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
    
    const lockedPicks: Array<{
      id: string;
      player: string;
      prop: string;
      line: number;
      pick: string;
      odds: number;
      reason: string;
      confidence: number;
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
      
      // Determine final pick with enhanced rules
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
      
      // Update the database
      const { error: updateError } = await supabase
        .from('juiced_props')
        .update({
          final_pick: decision.pick,
          final_pick_reason: decision.reason,
          final_pick_confidence: decision.confidence,
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
        reason: decision.reason,
        confidence: decision.confidence,
      });
      
      console.log(`🔒 Locked: ${prop.player_name} ${decision.pick.toUpperCase()} ${prop.line} ${prop.prop_type} (${Math.round(decision.confidence * 100)}%)`);
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
    
    return new Response(JSON.stringify({
      success: true,
      message: `Locked ${lockedPicks.length} final picks`,
      locked: lockedPicks.length,
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
