import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ParlayLeg {
  description: string;
  odds: number;
  probability: number;
}

interface ParlayInput {
  legs: ParlayLeg[];
  stake: number;
  totalOdds: number;
  combinedProbability: number;
}

interface SharpData {
  lineMovements: any[];
  unifiedProps: any[];
  juicedProps: any[];
  fatigueScores: any[];
  trapAnalysis: any[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { parlays } = await req.json() as { parlays: ParlayInput[] };

    if (!parlays || parlays.length < 2) {
      throw new Error('At least 2 parlays required for comparison');
    }

    console.log(`Analyzing ${parlays.length} parlays with AI`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Extract all leg descriptions for cross-referencing
    const allLegs = parlays.flatMap((p, parlayIdx) => 
      p.legs.map(leg => ({ ...leg, parlayIndex: parlayIdx }))
    );

    // Fetch sharp data in parallel
    const [lineMovementsRes, unifiedPropsRes, juicedPropsRes, fatigueRes, trapRes] = await Promise.all([
      // Recent line movements (last 24 hours)
      supabase
        .from('line_movements')
        .select('*')
        .gte('detected_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('detected_at', { ascending: false })
        .limit(100),
      
      // Recent unified props
      supabase
        .from('unified_props')
        .select('*')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(100),
      
      // Recent juiced props
      supabase
        .from('juiced_props')
        .select('*')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(100),
      
      // NBA fatigue scores
      supabase
        .from('nba_fatigue_scores')
        .select('*')
        .gte('game_date', new Date().toISOString().split('T')[0])
        .limit(50),
      
      // FanDuel trap analysis
      supabase
        .from('fanduel_trap_analysis')
        .select('*')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .eq('is_public_bait', true)
        .limit(50)
    ]);

    const sharpData: SharpData = {
      lineMovements: lineMovementsRes.data || [],
      unifiedProps: unifiedPropsRes.data || [],
      juicedProps: juicedPropsRes.data || [],
      fatigueScores: fatigueRes.data || [],
      trapAnalysis: trapRes.data || []
    };

    console.log(`Fetched sharp data: ${sharpData.lineMovements.length} movements, ${sharpData.unifiedProps.length} unified props, ${sharpData.juicedProps.length} juiced props`);

    // Cross-reference each leg with sharp data
    const legAnalysis = allLegs.map(leg => {
      const legDesc = leg.description.toLowerCase();
      
      // Check for sharp movements
      const matchingMovements = sharpData.lineMovements.filter(m => {
        const desc = (m.description || '').toLowerCase();
        const outcome = (m.outcome_name || '').toLowerCase();
        return desc.includes(legDesc.slice(0, 15)) || legDesc.includes(desc.slice(0, 15)) ||
               outcome.includes(legDesc.slice(0, 15));
      });

      // Check for unified prop matches
      const matchingProps = sharpData.unifiedProps.filter(p => {
        const player = (p.player_name || '').toLowerCase();
        const propType = (p.prop_type || '').toLowerCase();
        return legDesc.includes(player) || legDesc.includes(propType);
      });

      // Check for juiced prop matches
      const matchingJuiced = sharpData.juicedProps.filter(j => {
        const player = (j.player_name || '').toLowerCase();
        return legDesc.includes(player);
      });

      // Check for trap indicators
      const matchingTraps = sharpData.trapAnalysis.filter(t => {
        const outcome = (t.outcome_name || '').toLowerCase();
        return legDesc.includes(outcome.slice(0, 15));
      });

      // Check for fatigue impacts
      const fatigueMatch = sharpData.fatigueScores.find(f => {
        const homeTeam = (f.home_team || '').toLowerCase();
        const awayTeam = (f.away_team || '').toLowerCase();
        return legDesc.includes(homeTeam) || legDesc.includes(awayTeam);
      });

      return {
        legDescription: leg.description,
        parlayIndex: leg.parlayIndex,
        odds: leg.odds,
        sharpAlignment: matchingMovements.some(m => m.is_sharp_action),
        sharpMovements: matchingMovements.slice(0, 3).map(m => ({
          recommendation: m.recommendation,
          priceChange: m.price_change,
          isSharp: m.is_sharp_action,
          confidence: m.authenticity_confidence
        })),
        unifiedScore: matchingProps.length > 0 ? matchingProps[0]?.composite_score : null,
        pvsTier: matchingProps.length > 0 ? matchingProps[0]?.pvs_tier : null,
        juicedDirection: matchingJuiced.length > 0 ? matchingJuiced[0]?.juice_direction : null,
        juiceLevel: matchingJuiced.length > 0 ? matchingJuiced[0]?.juice_level : null,
        isTrap: matchingTraps.length > 0,
        trapScore: matchingTraps.length > 0 ? matchingTraps[0]?.trap_score : null,
        fatigueImpact: fatigueMatch ? {
          homeFatigue: fatigueMatch.home_fatigue_score,
          awayFatigue: fatigueMatch.away_fatigue_score,
          recommendation: fatigueMatch.recommended_side
        } : null
      };
    });

    // Calculate per-parlay metrics
    const parlayMetrics = parlays.map((parlay, idx) => {
      const parlayLegs = legAnalysis.filter(l => l.parlayIndex === idx);
      const sharpAlignedLegs = parlayLegs.filter(l => l.sharpAlignment).length;
      const trapLegs = parlayLegs.filter(l => l.isTrap).length;
      const juicedLegs = parlayLegs.filter(l => l.juicedDirection).length;
      const fatigueAlertLegs = parlayLegs.filter(l => l.fatigueImpact).length;
      
      return {
        parlayIndex: idx,
        totalLegs: parlayLegs.length,
        sharpAlignedLegs,
        trapLegs,
        juicedLegs,
        fatigueAlertLegs,
        sharpAlignmentScore: parlayLegs.length > 0 ? (sharpAlignedLegs / parlayLegs.length) * 100 : 0,
        trapRisk: parlayLegs.length > 0 ? (trapLegs / parlayLegs.length) * 100 : 0,
        stake: parlay.stake,
        totalOdds: parlay.totalOdds,
        combinedProbability: parlay.combinedProbability
      };
    });

    // Build context for AI
    const contextSummary = parlayMetrics.map(m => 
      `Parlay ${m.parlayIndex + 1}: ${m.totalLegs} legs, ${m.sharpAlignedLegs} sharp-aligned, ${m.trapLegs} potential traps, ${m.totalOdds > 0 ? '+' : ''}${m.totalOdds} odds, ${(m.combinedProbability * 100).toFixed(1)}% probability`
    ).join('\n');

    const legDetails = legAnalysis.map(l => {
      const flags = [];
      if (l.sharpAlignment) flags.push('✓ Sharp');
      if (l.isTrap) flags.push('⚠️ Trap');
      if (l.juicedDirection) flags.push(`💧 ${l.juiceLevel} juice ${l.juicedDirection}`);
      if (l.fatigueImpact) flags.push('🏃 Fatigue impact');
      if (l.pvsTier) flags.push(`PVS: ${l.pvsTier}`);
      
      return `[P${l.parlayIndex + 1}] ${l.legDescription.slice(0, 50)} (${l.odds > 0 ? '+' : ''}${l.odds}) ${flags.join(' | ')}`;
    }).join('\n');

    // Call GPT-5-mini for insights
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const systemPrompt = `You are a sharp sports betting analyst comparing multiple parlays. Analyze the data and provide actionable insights.

IMPORTANT RULES:
- Be direct and specific about which parlay is better and why
- Flag any trap bets or concerning patterns
- Consider sharp money alignment as a strong positive signal
- Highlight fatigue concerns for NBA bets
- Keep analysis concise but comprehensive
- Grade each parlay A-F based on overall quality`;

    const userPrompt = `Compare these ${parlays.length} parlays and provide analysis:

PARLAYS SUMMARY:
${contextSummary}

LEG-BY-LEG ANALYSIS:
${legDetails}

SHARP DATA AVAILABLE:
- ${sharpData.lineMovements.length} recent line movements tracked
- ${sharpData.unifiedProps.length} unified prop signals  
- ${sharpData.juicedProps.length} juiced props detected
- ${sharpData.trapAnalysis.length} trap patterns identified
- ${sharpData.fatigueScores.length} fatigue scores for today

Provide JSON response:
{
  "recommendation": "Clear recommendation on best parlay and why",
  "parlayGrades": [{"parlayIndex": 0, "grade": "A-F", "reasoning": "Brief reason"}],
  "sharpInsight": "What sharp money signals suggest",
  "trapWarnings": ["Any trap bet warnings"],
  "fatigueAlerts": ["Any fatigue concerns"],
  "edgeAnalysis": "Where the real edge might be",
  "confidence": "high/medium/low"
}`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-5-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      
      // Return basic analysis without AI
      return new Response(JSON.stringify({
        success: true,
        aiAnalysis: null,
        legAnalysis,
        parlayMetrics,
        sharpDataCounts: {
          lineMovements: sharpData.lineMovements.length,
          unifiedProps: sharpData.unifiedProps.length,
          juicedProps: sharpData.juicedProps.length,
          trapAnalysis: sharpData.trapAnalysis.length,
          fatigueScores: sharpData.fatigueScores.length
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content || '';
    
    // Parse AI response
    let aiAnalysis = null;
    try {
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiAnalysis = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('Failed to parse AI response:', e);
      aiAnalysis = {
        recommendation: aiContent.slice(0, 500),
        confidence: 'medium'
      };
    }

    console.log('AI analysis complete');

    return new Response(JSON.stringify({
      success: true,
      aiAnalysis,
      legAnalysis,
      parlayMetrics,
      sharpDataCounts: {
        lineMovements: sharpData.lineMovements.length,
        unifiedProps: sharpData.unifiedProps.length,
        juicedProps: sharpData.juicedProps.length,
        trapAnalysis: sharpData.trapAnalysis.length,
        fatigueScores: sharpData.fatigueScores.length
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Compare parlays AI error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
