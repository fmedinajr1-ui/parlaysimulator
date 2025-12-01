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
}

interface FinalPickDecision {
  pick: 'over' | 'under';
  reason: string;
  confidence: number;
}

// Decision matrix for final picks
function determineFinalPick(
  prop: JuicedProp,
  currentOverPrice: number,
  currentUnderPrice: number,
  hasSharpOnUnder: boolean,
  hasSharpOnOver: boolean
): FinalPickDecision {
  const juiceLevel = prop.juice_level;
  const originalJuiceOnOver = prop.juice_direction === 'over';
  
  // Check if juice has reversed
  const currentJuiceOnOver = currentOverPrice < currentUnderPrice;
  const juiceReversed = originalJuiceOnOver !== currentJuiceOnOver;
  
  // Calculate how much the line moved
  const overPriceChange = currentOverPrice - prop.over_price;
  const steamMove = Math.abs(overPriceChange) >= 15;
  
  // Decision matrix
  if (juiceReversed) {
    // Juice flipped - go with the original side that was juiced
    return {
      pick: originalJuiceOnOver ? 'over' : 'under',
      reason: '🔄 Steam reversed - Value on original side',
      confidence: 0.68,
    };
  }
  
  if (juiceLevel === 'heavy') {
    if (hasSharpOnUnder && !hasSharpOnOver) {
      // Heavy public action on Over, sharp money on Under = FADE
      return {
        pick: 'under',
        reason: '🎯 Sharp money fading heavy public Over action',
        confidence: 0.75,
      };
    }
    if (hasSharpOnOver) {
      // Sharp confirming heavy action = FOLLOW
      return {
        pick: 'over',
        reason: '💰 Sharp confirmation despite juice - Follow the money',
        confidence: 0.72,
      };
    }
    // Heavy juice, no sharp signal = FADE public
    return {
      pick: 'under',
      reason: '📉 Fading heavy public action - Line moved too far',
      confidence: 0.65,
    };
  }
  
  if (juiceLevel === 'moderate') {
    if (hasSharpOnUnder) {
      return {
        pick: 'under',
        reason: '⚡ Sharp money on Under with moderate juice',
        confidence: 0.70,
      };
    }
    if (hasSharpOnOver && steamMove) {
      return {
        pick: 'over',
        reason: '🔥 Steam move with sharp confirmation',
        confidence: 0.68,
      };
    }
    // Default to fading moderate juice
    return {
      pick: 'under',
      reason: '📊 Fading moderate public juice',
      confidence: 0.60,
    };
  }
  
  // Light juice - less conviction
  if (hasSharpOnUnder) {
    return {
      pick: 'under',
      reason: '💡 Sharp action on Under',
      confidence: 0.62,
    };
  }
  if (hasSharpOnOver) {
    return {
      pick: 'over',
      reason: '💡 Sharp action on Over',
      confidence: 0.60,
    };
  }
  
  // No clear signal - default to fading juice
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
    
    // Process each prop
    for (const prop of propsToLock as JuicedProp[]) {
      // Check if there's sharp action on this player
      const sharpOnPlayer = (recentSharp || []).filter((s: any) => 
        s.player_name?.toLowerCase() === prop.player_name.toLowerCase()
      );
      
      const hasSharpOnOver = sharpOnPlayer.some((s: any) => 
        s.outcome_name?.toLowerCase().includes('over')
      );
      const hasSharpOnUnder = sharpOnPlayer.some((s: any) => 
        s.outcome_name?.toLowerCase().includes('under')
      );
      
      // For now, use original prices (could fetch current prices with API)
      const currentOverPrice = prop.over_price;
      const currentUnderPrice = prop.under_price;
      
      // Determine final pick
      const decision = determineFinalPick(
        prop,
        currentOverPrice,
        currentUnderPrice,
        hasSharpOnUnder,
        hasSharpOnOver
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
