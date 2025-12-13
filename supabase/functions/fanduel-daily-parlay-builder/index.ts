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
  signals: string[];
}

interface ParlayLeg {
  pick: TrapPick;
  decimalOdds: number;
  contribution: string;
}

interface ParlayTier {
  name: string;
  targetOdds: number;
  targetDecimal: number;
  minLegs: number;
  maxLegs: number;
  minTrapScore: number;
}

const PARLAY_TIERS: ParlayTier[] = [
  { name: 'Safe', targetOdds: 300, targetDecimal: 4, minLegs: 2, maxLegs: 3, minTrapScore: 60 },
  { name: 'Standard', targetOdds: 1000, targetDecimal: 11, minLegs: 3, maxLegs: 5, minTrapScore: 45 },
  { name: 'Longshot', targetOdds: 2500, targetDecimal: 26, minLegs: 4, maxLegs: 6, minTrapScore: 40 }
];

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

// Check if two picks are correlated (same game, conflicting outcomes)
function areCorrelated(pick1: TrapPick, pick2: TrapPick): boolean {
  if (pick1.eventId !== pick2.eventId) return false;
  
  // Same event - check for conflicts
  // Spread and ML on same team = correlated
  // Over/Under on same game = not correlated with spread/ML
  if (pick1.marketType === pick2.marketType) return true;
  
  // Spread and ML for opposite teams = correlated
  if ((pick1.marketType === 'h2h' || pick1.marketType === 'spreads') &&
      (pick2.marketType === 'h2h' || pick2.marketType === 'spreads')) {
    return true;
  }
  
  return false;
}

function buildOptimalParlay(
  picks: TrapPick[], 
  tier: ParlayTier
): ParlayLeg[] | null {
  const parlayLegs: ParlayLeg[] = [];
  let currentDecimalOdds = 1;
  
  // Sort by trap score descending
  const sortedPicks = [...picks]
    .filter(p => p.trapScore >= tier.minTrapScore)
    .sort((a, b) => b.trapScore - a.trapScore);
  
  for (const pick of sortedPicks) {
    if (parlayLegs.length >= tier.maxLegs) break;
    
    // Check for correlation with existing legs
    const hasCorrelation = parlayLegs.some(leg => areCorrelated(leg.pick, pick));
    if (hasCorrelation) continue;
    
    const decimalOdds = americanToDecimal(pick.oddsForFade);
    const projectedOdds = currentDecimalOdds * decimalOdds;
    
    // Check if this leg helps get closer to target
    if (parlayLegs.length < tier.minLegs || projectedOdds <= tier.targetDecimal * 1.5) {
      parlayLegs.push({
        pick,
        decimalOdds,
        contribution: `${decimalOdds.toFixed(2)}x (${pick.oddsForFade > 0 ? '+' : ''}${pick.oddsForFade})`
      });
      currentDecimalOdds = projectedOdds;
    }
  }
  
  if (parlayLegs.length < tier.minLegs) {
    return null;
  }
  
  return parlayLegs;
}

function generateReasoning(legs: ParlayLeg[], tier: string): string {
  const intro = `🎯 **FanDuel ${tier} Parlay**\n\nBuilt from ${legs.length} high-confidence trap patterns detected today. Each pick represents a "fade the public" opportunity.\n\n`;
  
  const signalCounts: Record<string, number> = {};
  const sportCounts: Record<string, number> = {};
  
  const legBreakdowns = legs.map((leg, i) => {
    const pick = leg.pick;
    
    // Count signals and sports
    for (const signal of pick.signals || []) {
      signalCounts[signal] = (signalCounts[signal] || 0) + 1;
    }
    sportCounts[pick.sport] = (sportCounts[pick.sport] || 0) + 1;
    
    return `**Leg ${i + 1}: ${pick.description}**\n` +
      `• Market: ${pick.marketType.toUpperCase()}\n` +
      `• Fade: ${pick.fadePickDescription}\n` +
      `• Trap Score: ${pick.trapScore}/100\n` +
      `• Signals: ${(pick.signals || []).join(', ') || 'General trap pattern'}\n` +
      `• Contribution: ${leg.contribution}\n`;
  }).join('\n');
  
  // Top signals used
  const topSignals = Object.entries(signalCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([signal]) => signal)
    .join(', ');
  
  const summary = `\n**Why This Parlay:**\n` +
    `• Top signals detected: ${topSignals || 'Multiple trap indicators'}\n` +
    `• Sports covered: ${Object.keys(sportCounts).length}\n` +
    `• Avg trap score: ${Math.round(legs.reduce((acc, l) => acc + l.pick.trapScore, 0) / legs.length)}\n` +
    `• Strategy: Fading public money traps with multi-book confirmation`;
  
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
    
    console.log('🎰 FanDuel Daily Parlay Builder V2 starting...');
    
    const today = new Date().toISOString().split('T')[0];
    
    // Get all high-confidence traps for today
    const { data: trapData, error: trapError } = await supabase
      .from('fanduel_trap_analysis')
      .select('*')
      .eq('scan_date', today)
      .gte('trap_score', 40)
      .eq('is_public_bait', true)
      .not('fade_the_public_pick', 'is', null)
      .gt('commence_time', new Date().toISOString()) // Only future games
      .order('trap_score', { ascending: false });
    
    if (trapError) {
      throw new Error(`Failed to fetch trap data: ${trapError.message}`);
    }
    
    if (!trapData || trapData.length < 2) {
      console.log(`⚠️ Not enough traps found. Need 2+, have ${trapData?.length || 0}`);
      return new Response(JSON.stringify({
        success: false,
        message: `Need at least 2 high-confidence traps to build parlay`,
        trapsFound: trapData?.length || 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    console.log(`📊 Found ${trapData.length} trap picks`);
    
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
          confidenceScore: trap.confidence_score,
          signals: trap.signals_detected || []
        });
      }
    }
    
    const sortedPicks = Array.from(picksByEvent.values())
      .sort((a, b) => b.trapScore - a.trapScore);
    
    console.log(`🎯 ${sortedPicks.length} unique events with trap picks`);
    
    // Build the standard parlay (primary)
    const standardTier = PARLAY_TIERS[1]; // Standard tier
    const parlayLegs = buildOptimalParlay(sortedPicks, standardTier);
    
    if (!parlayLegs || parlayLegs.length < standardTier.minLegs) {
      console.log(`⚠️ Could not build standard parlay`);
      return new Response(JSON.stringify({
        success: false,
        message: `Could not build parlay with enough uncorrelated legs`,
        trapsFound: trapData.length,
        uniqueEvents: sortedPicks.length
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    const currentDecimalOdds = parlayLegs.reduce((acc, leg) => acc * leg.decimalOdds, 1);
    const finalAmericanOdds = decimalToAmerican(currentDecimalOdds);
    const avgConfidence = parlayLegs.reduce((acc, l) => acc + l.pick.confidenceScore, 0) / parlayLegs.length;
    const reasoning = generateReasoning(parlayLegs, 'Standard');
    
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
      signals: leg.pick.signals,
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
      signalBreakdown: parlayLegs.reduce((acc, leg) => {
        for (const signal of leg.pick.signals || []) {
          acc[signal] = (acc[signal] || 0) + 1;
        }
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
        target_odds: standardTier.targetOdds,
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
    
    // Log job
    await supabase.from('cron_job_history').insert({
      job_name: 'fanduel-daily-parlay-builder',
      status: 'completed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      result: {
        legs: parlayLegs.length,
        totalOdds: finalAmericanOdds,
        avgTrapScore: movementAnalysis.avgTrapScore
      }
    });
    
    return new Response(JSON.stringify({
      success: true,
      parlay: {
        legs: parlayLegs.length,
        totalOdds: finalAmericanOdds,
        targetOdds: standardTier.targetOdds,
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
