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

interface SuggestionAccuracy {
  sport: string;
  confidenceLevel: string;
  totalSuggestions: number;
  totalWon: number;
  totalLost: number;
  accuracyRate: number;
  avgOdds: number;
  roiPercentage: number;
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

    if (action === 'get_suggestion_accuracy') {
      // Get AI suggestion accuracy metrics - how well AI suggestions perform
      const { data: suggestionAccuracy, error: suggestionError } = await supabase
        .rpc('get_suggestion_accuracy_stats');

      if (suggestionError) {
        console.error('Error fetching suggestion accuracy:', suggestionError);
        throw suggestionError;
      }

      // Transform to camelCase for frontend
      const transformed: SuggestionAccuracy[] = (suggestionAccuracy || []).map((s: any) => ({
        sport: s.sport,
        confidenceLevel: s.confidence_level,
        totalSuggestions: s.total_suggestions,
        totalWon: s.total_won,
        totalLost: s.total_lost,
        accuracyRate: s.accuracy_rate,
        avgOdds: s.avg_odds,
        roiPercentage: s.roi_percentage,
      }));

      // Calculate summary stats
      const totalSuggestions = transformed.reduce((sum, s) => sum + s.totalSuggestions, 0);
      const totalWon = transformed.reduce((sum, s) => sum + s.totalWon, 0);
      const totalLost = transformed.reduce((sum, s) => sum + s.totalLost, 0);
      const overallAccuracy = totalSuggestions > 0 
        ? ((totalWon / totalSuggestions) * 100).toFixed(1) 
        : '0';

      // Best performing sports
      const bestSports = [...transformed]
        .filter(s => s.totalSuggestions >= 3)
        .sort((a, b) => b.accuracyRate - a.accuracyRate)
        .slice(0, 3);

      // Best performing confidence levels
      const byConfidence: Record<string, { total: number; won: number; accuracy: number }> = {};
      for (const s of transformed) {
        if (!byConfidence[s.confidenceLevel]) {
          byConfidence[s.confidenceLevel] = { total: 0, won: 0, accuracy: 0 };
        }
        byConfidence[s.confidenceLevel].total += s.totalSuggestions;
        byConfidence[s.confidenceLevel].won += s.totalWon;
      }
      for (const level of Object.keys(byConfidence)) {
        byConfidence[level].accuracy = byConfidence[level].total > 0
          ? (byConfidence[level].won / byConfidence[level].total) * 100
          : 0;
      }

      return new Response(JSON.stringify({ 
        suggestionAccuracy: transformed,
        summary: {
          totalSuggestions,
          totalWon,
          totalLost,
          overallAccuracy: parseFloat(overallAccuracy),
          bestSports,
          byConfidence,
        }
      }), {
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
      const [userStatsResult, aiMetricsResult, suggestionAccuracyResult] = await Promise.all([
        supabase.rpc('get_user_betting_stats', { p_user_id: userId }),
        supabase.rpc('get_ai_accuracy_stats'),
        supabase.rpc('get_suggestion_accuracy_stats'),
      ]);

      // Get user's recent performance by sport/bet type
      const userStats = userStatsResult.data || [];
      const aiMetrics = aiMetricsResult.data || [];
      const suggestionAccuracy = suggestionAccuracyResult.data || [];

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

        const suggestionSportMetrics = suggestionAccuracy.find((s: any) =>
          s.sport?.toLowerCase() === sport.toLowerCase()
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
          } : null,
          suggestionAccuracy: suggestionSportMetrics ? {
            totalSuggestions: suggestionSportMetrics.total_suggestions,
            totalWon: suggestionSportMetrics.total_won,
            accuracyRate: suggestionSportMetrics.accuracy_rate,
            roiPercentage: suggestionSportMetrics.roi_percentage,
          } : null,
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

      // Calculate overall suggestion accuracy
      const suggestionTotal = suggestionAccuracy.reduce((sum: number, s: any) => sum + Number(s.total_suggestions || 0), 0);
      const suggestionWon = suggestionAccuracy.reduce((sum: number, s: any) => sum + Number(s.total_won || 0), 0);
      const suggestionOverallAccuracy = suggestionTotal > 0 ? (suggestionWon / suggestionTotal * 100).toFixed(1) : 0;

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
        suggestionOverall: {
          totalSuggestions: suggestionTotal,
          totalWon: suggestionWon,
          accuracy: suggestionOverallAccuracy,
        },
        userStatsByType: userStats,
        aiMetricsByType: aiMetrics,
        suggestionAccuracyByType: suggestionAccuracy,
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
