import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HistoricalStats {
  sport: string;
  betType: string;
  totalBets: number;
  wins: number;
  hitRate: number;
  avgOdds: number;
  byConfidence: {
    high: { total: number; wins: number };
    medium: { total: number; wins: number };
    low: { total: number; wins: number };
  };
}

interface AIMetrics {
  sport: string;
  betType: string;
  confidenceLevel: string;
  totalPredictions: number;
  correctPredictions: number;
  accuracyRate: number;
}

interface SimilarBet {
  description: string;
  odds: number;
  sport: string;
  betType: string;
  aiConfidence: string;
  won: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { action, userId, legs } = await req.json();

    console.log(`AI Learning Engine: action=${action}, userId=${userId}`);

    if (action === 'get_user_stats') {
      // Get user's historical betting performance
      const { data: userStats, error: userStatsError } = await supabase
        .rpc('get_user_betting_stats', { p_user_id: userId });

      if (userStatsError) {
        console.error('Error fetching user stats:', userStatsError);
        throw userStatsError;
      }

      return new Response(JSON.stringify({ userStats: userStats || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get_ai_accuracy') {
      // Get global AI accuracy metrics
      const { data: aiMetrics, error: aiMetricsError } = await supabase
        .rpc('get_ai_accuracy_stats');

      if (aiMetricsError) {
        console.error('Error fetching AI metrics:', aiMetricsError);
        throw aiMetricsError;
      }

      return new Response(JSON.stringify({ aiMetrics: aiMetrics || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'find_similar_bets' && legs) {
      // Find historically similar bets for each leg
      const similarBets: { legIndex: number; similar: SimilarBet[] }[] = [];

      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i];
        const searchTerms = leg.description.toLowerCase();
        
        // Get similar settled bets
        const { data: similar, error } = await supabase
          .from('parlay_training_data')
          .select('description, odds, sport, bet_type, ai_confidence, parlay_outcome')
          .not('parlay_outcome', 'is', null)
          .ilike('description', `%${searchTerms.split(' ')[0]}%`)
          .limit(10);

        if (!error && similar) {
          similarBets.push({
            legIndex: i,
            similar: similar.map(s => ({
              description: s.description,
              odds: s.odds,
              sport: s.sport || 'unknown',
              betType: s.bet_type || 'unknown',
              aiConfidence: s.ai_confidence || 'unknown',
              won: s.parlay_outcome === true
            }))
          });
        }
      }

      return new Response(JSON.stringify({ similarBets }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get_historical_context' && userId && legs) {
      // Comprehensive historical context for analysis
      const [userStatsResult, aiMetricsResult] = await Promise.all([
        supabase.rpc('get_user_betting_stats', { p_user_id: userId }),
        supabase.rpc('get_ai_accuracy_stats')
      ]);

      // Get user's recent performance by sport/bet type
      const userStats = userStatsResult.data || [];
      const aiMetrics = aiMetricsResult.data || [];

      // Build context for each leg
      const legContexts = legs.map((leg: any, index: number) => {
        const sport = leg.sport || 'unknown';
        const betType = leg.betType || 'unknown';
        
        const userSportStats = userStats.find((s: any) => 
          s.sport?.toLowerCase() === sport.toLowerCase() && 
          s.bet_type?.toLowerCase() === betType.toLowerCase()
        );
        
        const aiSportMetrics = aiMetrics.find((m: any) => 
          m.sport?.toLowerCase() === sport.toLowerCase() && 
          m.bet_type?.toLowerCase() === betType.toLowerCase()
        );

        return {
          legIndex: index,
          userRecord: userSportStats ? {
            totalBets: userSportStats.total_bets,
            wins: userSportStats.wins,
            hitRate: userSportStats.hit_rate
          } : null,
          aiAccuracy: aiSportMetrics ? {
            totalPredictions: aiSportMetrics.total_predictions,
            correctPredictions: aiSportMetrics.correct_predictions,
            accuracyRate: aiSportMetrics.accuracy_rate
          } : null
        };
      });

      // Calculate overall user stats
      const totalBets = userStats.reduce((sum: number, s: any) => sum + Number(s.total_bets || 0), 0);
      const totalWins = userStats.reduce((sum: number, s: any) => sum + Number(s.wins || 0), 0);
      const overallHitRate = totalBets > 0 ? (totalWins / totalBets * 100).toFixed(1) : 0;

      // Calculate overall AI accuracy
      const aiTotalPredictions = aiMetrics.reduce((sum: number, m: any) => sum + Number(m.total_predictions || 0), 0);
      const aiCorrectPredictions = aiMetrics.reduce((sum: number, m: any) => sum + Number(m.correct_predictions || 0), 0);
      const aiOverallAccuracy = aiTotalPredictions > 0 ? (aiCorrectPredictions / aiTotalPredictions * 100).toFixed(1) : 0;

      return new Response(JSON.stringify({
        legContexts,
        userOverall: {
          totalBets,
          totalWins,
          hitRate: overallHitRate
        },
        aiOverall: {
          totalPredictions: aiTotalPredictions,
          correctPredictions: aiCorrectPredictions,
          accuracy: aiOverallAccuracy
        },
        userStatsByType: userStats,
        aiMetricsByType: aiMetrics
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in ai-learning-engine:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
