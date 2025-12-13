import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TrapPick {
  id: string;
  eventId: string;
  sport: string;
  description: string;
  playerName?: string;
  marketType: string;
  outcomeName: string;
  trapScore: number;
  fadePickDescription: string;
  oddsForFade: number;
  publicBaitReason: string;
  confidenceScore: number;
}

interface ParlayLeg {
  pick: TrapPick;
  decimalOdds: number;
  contribution: string;
}

function americanToDecimal(odds: number): number {
  if (odds > 0) {
    return (odds / 100) + 1;
  }
  return (100 / Math.abs(odds)) + 1;
}

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) {
    return Math.round((decimal - 1) * 100);
  }
  return Math.round(-100 / (decimal - 1));
}

function generateReasoning(legs: ParlayLeg[]): string {
  const intro = `🎯 **FanDuel Trap Parlay Analysis**\n\nThis parlay was built by analyzing ${legs.length} high-confidence trap patterns detected throughout the day. Each pick represents a "fade the public" opportunity where FanDuel's line movements indicate public money traps.\n\n`;
  
  const legBreakdowns = legs.map((leg, i) => {
    const pick = leg.pick;
    return `**Leg ${i + 1}: ${pick.description}**\n` +
      `• Market: ${pick.marketType.toUpperCase()}\n` +
      `• Fade Pick: ${pick.fadePickDescription}\n` +
      `• Trap Score: ${pick.trapScore}/100\n` +
      `• Why: ${pick.publicBaitReason}\n` +
      `• Odds Contribution: ${leg.contribution}\n`;
  }).join('\n');
  
  const summary = `\n**Strategy Summary:**\n` +
    `Each leg was selected because the line movement pattern suggests public money is being trapped. ` +
    `By fading these moves, we're positioning against the public and with the house edge. ` +
    `Combined confidence: ${Math.round(legs.reduce((acc, l) => acc + l.pick.confidenceScore, 0) / legs.length * 100)}%`;
  
  return intro + legBreakdowns + summary;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('🎰 FanDuel Daily Parlay Builder starting...');
    
    const today = new Date().toISOString().split('T')[0];
    const TARGET_ODDS = 1000; // +1000
    const TARGET_DECIMAL = 11; // +1000 ≈ 11x decimal
    const MIN_LEGS = 3;
    const MAX_LEGS = 6;
    const MIN_TRAP_SCORE = 40;
    
    // Get all high-confidence traps for today
    const { data: trapData, error: trapError } = await supabase
      .from('fanduel_trap_analysis')
      .select('*')
      .eq('scan_date', today)
      .gte('trap_score', MIN_TRAP_SCORE)
      .eq('is_public_bait', true)
      .not('fade_the_public_pick', 'is', null)
      .order('trap_score', { ascending: false });
    
    if (trapError) {
      throw new Error(`Failed to fetch trap data: ${trapError.message}`);
    }
    
    if (!trapData || trapData.length < MIN_LEGS) {
      console.log(`⚠️ Not enough traps found. Need ${MIN_LEGS}, have ${trapData?.length || 0}`);
      return new Response(JSON.stringify({
        success: false,
        message: `Need at least ${MIN_LEGS} high-confidence traps to build parlay`,
        trapsFound: trapData?.length || 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    console.log(`📊 Found ${trapData.length} trap picks with score >= ${MIN_TRAP_SCORE}`);
    
    // Convert to TrapPick format and dedupe by event
    const picksByEvent = new Map<string, TrapPick>();
    
    for (const trap of trapData) {
      // Only keep highest scoring pick per event
      const existing = picksByEvent.get(trap.event_id);
      if (!existing || trap.trap_score > existing.trapScore) {
        picksByEvent.set(trap.event_id, {
          id: trap.id,
          eventId: trap.event_id,
          sport: trap.sport,
          description: trap.description,
          playerName: trap.player_name,
          marketType: trap.market_type,
          outcomeName: trap.outcome_name,
          trapScore: trap.trap_score,
          fadePickDescription: trap.fade_the_public_pick,
          oddsForFade: trap.odds_for_fade,
          publicBaitReason: trap.public_bait_reason,
          confidenceScore: trap.confidence_score
        });
      }
    }
    
    const sortedPicks = Array.from(picksByEvent.values())
      .sort((a, b) => b.trapScore - a.trapScore);
    
    console.log(`🎯 ${sortedPicks.length} unique events with trap picks`);
    
    // Build optimal parlay targeting +1000
    const parlayLegs: ParlayLeg[] = [];
    let currentDecimalOdds = 1;
    
    for (const pick of sortedPicks) {
      if (parlayLegs.length >= MAX_LEGS) break;
      
      const decimalOdds = americanToDecimal(pick.oddsForFade);
      const projectedOdds = currentDecimalOdds * decimalOdds;
      
      // Check if this leg helps get closer to target
      if (parlayLegs.length < MIN_LEGS || projectedOdds <= TARGET_DECIMAL * 1.5) {
        parlayLegs.push({
          pick,
          decimalOdds,
          contribution: `${decimalOdds.toFixed(2)}x (${pick.oddsForFade > 0 ? '+' : ''}${pick.oddsForFade})`
        });
        currentDecimalOdds = projectedOdds;
        
        console.log(`➕ Added: ${pick.description} @ ${pick.oddsForFade} (Total: ${currentDecimalOdds.toFixed(2)}x)`);
      }
    }
    
    if (parlayLegs.length < MIN_LEGS) {
      console.log(`⚠️ Could only build ${parlayLegs.length} legs, need ${MIN_LEGS}`);
      return new Response(JSON.stringify({
        success: false,
        message: `Could only build ${parlayLegs.length} legs from unique events`,
        legsBuilt: parlayLegs.length
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    const finalAmericanOdds = decimalToAmerican(currentDecimalOdds);
    const avgConfidence = parlayLegs.reduce((acc, l) => acc + l.pick.confidenceScore, 0) / parlayLegs.length;
    const reasoning = generateReasoning(parlayLegs);
    
    // Prepare legs for storage
    const legsJson = parlayLegs.map(leg => ({
      id: leg.pick.id,
      eventId: leg.pick.eventId,
      sport: leg.pick.sport,
      description: leg.pick.description,
      playerName: leg.pick.playerName,
      marketType: leg.pick.marketType,
      outcomeName: leg.pick.outcomeName,
      fadePick: leg.pick.fadePickDescription,
      odds: leg.pick.oddsForFade,
      decimalOdds: leg.decimalOdds,
      trapScore: leg.pick.trapScore,
      reason: leg.pick.publicBaitReason
    }));
    
    // Movement analysis summary
    const movementAnalysis = {
      totalTrapsAnalyzed: trapData.length,
      avgTrapScore: Math.round(trapData.reduce((acc, t) => acc + t.trap_score, 0) / trapData.length),
      sportBreakdown: parlayLegs.reduce((acc, leg) => {
        acc[leg.pick.sport] = (acc[leg.pick.sport] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      priceOnlyMoves: trapData.filter(t => t.price_only_move).length,
      bothSidesMoved: trapData.filter(t => t.opposite_side_also_moved).length
    };
    
    // Update daily parlay
    const { error: updateError } = await supabase
      .from('fanduel_daily_parlay')
      .upsert({
        parlay_date: today,
        legs: legsJson,
        total_odds: finalAmericanOdds,
        target_odds: TARGET_ODDS,
        confidence_score: avgConfidence,
        reasoning_summary: reasoning,
        movement_analysis: movementAnalysis,
        trap_patterns_found: trapData.length,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'parlay_date'
      });
    
    if (updateError) {
      throw new Error(`Failed to update daily parlay: ${updateError.message}`);
    }
    
    console.log(`✅ Built ${parlayLegs.length}-leg parlay @ +${finalAmericanOdds}`);
    
    return new Response(JSON.stringify({
      success: true,
      parlay: {
        legs: parlayLegs.length,
        totalOdds: finalAmericanOdds,
        targetOdds: TARGET_ODDS,
        confidence: Math.round(avgConfidence * 100),
        picks: legsJson
      },
      movementAnalysis
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('FanDuel Daily Parlay Builder error:', error);
    return new Response(JSON.stringify({ 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
