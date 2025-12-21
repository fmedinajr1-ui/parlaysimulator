import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { legCount, degenerateLevel, probability, userId } = await req.json();

    console.log('Fetching comparison for:', { legCount, degenerateLevel, probability });

    // Find similar historical parlays
    const minLegs = Math.max(1, legCount - 1);
    const maxLegs = legCount + 1;

    const { data: similarParlays, error: parlayError } = await supabase
      .from('parlay_history')
      .select('id, legs, stake, potential_payout, combined_probability, degenerate_level, is_won, is_settled, created_at')
      .eq('is_settled', true)
      .eq('degenerate_level', degenerateLevel)
      .order('created_at', { ascending: false })
      .limit(100);

    if (parlayError) {
      console.error('Error fetching parlays:', parlayError);
      throw parlayError;
    }

    // Filter by leg count (JSONB array length)
    const filteredParlays = (similarParlays || []).filter((p: any) => {
      const legs = Array.isArray(p.legs) ? p.legs : [];
      return legs.length >= minLegs && legs.length <= maxLegs;
    }).slice(0, 50);

    const totalFound = filteredParlays.length;
    const wonParlays = filteredParlays.filter((p: any) => p.is_won === true);
    const winRate = totalFound > 0 ? (wonParlays.length / totalFound) * 100 : 0;
    const avgPayout = wonParlays.length > 0 
      ? wonParlays.reduce((sum: number, p: any) => sum + (p.potential_payout || 0), 0) / wonParlays.length
      : 0;

    // Calculate user-specific stats if userId provided
    let userStats = { totalParlays: 0, winRate: 0, avgPayout: 0 };
    if (userId) {
      const { data: userParlays } = await supabase
        .from('parlay_history')
        .select('id, is_won, potential_payout')
        .eq('user_id', userId)
        .eq('is_settled', true)
        .limit(50);

      if (userParlays && userParlays.length > 0) {
        const userWins = userParlays.filter((p: any) => p.is_won === true);
        userStats = {
          totalParlays: userParlays.length,
          winRate: (userWins.length / userParlays.length) * 100,
          avgPayout: userWins.length > 0 
            ? userWins.reduce((sum: number, p: any) => sum + (p.potential_payout || 0), 0) / userWins.length
            : 0
        };
      }
    }

    // Calculate community average (all settled parlays)
    const { data: communityStats } = await supabase
      .from('parlay_history')
      .select('id, is_won')
      .eq('is_settled', true)
      .limit(500);

    const communityTotal = communityStats?.length || 0;
    const communityWins = communityStats?.filter((p: any) => p.is_won === true).length || 0;
    const communityWinRate = communityTotal > 0 ? (communityWins / communityTotal) * 100 : 0;

    // Calculate probability vs actual comparison
    const impliedProbPct = probability * 100;
    const probabilityVsActual = winRate - impliedProbPct;

    // Determine risk tier
    let riskTier = 'LOW';
    if (probability < 0.1) riskTier = 'EXTREME';
    else if (probability < 0.2) riskTier = 'HIGH';
    else if (probability < 0.35) riskTier = 'MODERATE';

    // Generate insight
    let recommendation = '';
    if (totalFound < 5) {
      recommendation = `Not enough similar parlays to compare. Keep placing bets to build your history!`;
    } else if (probabilityVsActual > 10) {
      recommendation = `${legCount}-leg ${degenerateLevel.replace(/_/g, ' ')} parlays historically hit ${winRate.toFixed(0)}% - that's ${probabilityVsActual.toFixed(0)}% better than implied odds suggest! 🔥`;
    } else if (probabilityVsActual < -10) {
      recommendation = `Heads up: Similar parlays only hit ${winRate.toFixed(0)}% historically. Your ${impliedProbPct.toFixed(0)}% implied odds might be optimistic.`;
    } else {
      recommendation = `This parlay structure historically hits around ${winRate.toFixed(0)}% of the time - right in line with expectations.`;
    }

    // Get recent similar parlays for display
    const recentSimilar = filteredParlays.slice(0, 5).map((p: any) => ({
      id: p.id,
      legCount: Array.isArray(p.legs) ? p.legs.length : 0,
      probability: p.combined_probability,
      won: p.is_won,
      payout: p.potential_payout,
      stake: p.stake,
      createdAt: p.created_at
    }));

    const response = {
      similarParlays: {
        totalFound,
        matchCriteria: [`${degenerateLevel.replace(/_/g, ' ')} tier`, `${minLegs}-${maxLegs} legs`],
        winRate: Math.round(winRate * 10) / 10,
        avgPayout: Math.round(avgPayout * 100) / 100
      },
      benchmarks: {
        userAvg: {
          winRate: Math.round(userStats.winRate * 10) / 10,
          totalParlays: userStats.totalParlays,
          avgPayout: Math.round(userStats.avgPayout * 100) / 100
        },
        communityAvg: {
          winRate: Math.round(communityWinRate * 10) / 10,
          totalParlays: communityTotal
        }
      },
      comparison: {
        probabilityVsActual: `${probabilityVsActual >= 0 ? '+' : ''}${probabilityVsActual.toFixed(1)}%`,
        riskTier,
        recommendation
      },
      topSimilarParlays: recentSimilar
    };

    console.log('Comparison response:', response);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Error in fetch-parlay-comparison:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
