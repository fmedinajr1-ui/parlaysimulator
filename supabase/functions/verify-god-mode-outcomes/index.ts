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
    
    const oddsApiKey = Deno.env.get('ODDS_API_KEY');

    console.log('[Verify God Mode] Starting outcome verification...');

    // Fetch unverified predictions from past 48 hours
    const cutoffTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    
    const { data: unverified, error: fetchError } = await supabase
      .from('god_mode_upset_predictions')
      .select('*')
      .eq('game_completed', false)
      .lt('commence_time', new Date().toISOString())
      .gt('commence_time', cutoffTime);

    if (fetchError) throw fetchError;

    if (!unverified || unverified.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No predictions to verify',
        verified: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[Verify God Mode] Found ${unverified.length} unverified predictions`);

    // Group by sport and event for efficient API calls
    const sportGroups = unverified.reduce((acc: Record<string, any[]>, pred) => {
      if (!acc[pred.sport]) acc[pred.sport] = [];
      acc[pred.sport].push(pred);
      return acc;
    }, {});

    let totalVerified = 0;
    let correctPredictions = 0;
    const results: any[] = [];

    for (const [sport, predictions] of Object.entries(sportGroups)) {
      try {
        // Fetch scores
        const scoresResponse = await fetch(
          `https://api.the-odds-api.com/v4/sports/${sport}/scores/?apiKey=${oddsApiKey}&daysFrom=2`
        );

        if (!scoresResponse.ok) {
          console.log(`[Verify] Could not fetch scores for ${sport}`);
          continue;
        }

        const scores = await scoresResponse.json();

        for (const prediction of predictions as any[]) {
          const scoreData = scores.find((s: any) => s.id === prediction.event_id);
          
          if (!scoreData || !scoreData.completed) continue;

          // Determine winner
          const homeScore = scoreData.scores?.find((s: any) => s.name === prediction.home_team)?.score;
          const awayScore = scoreData.scores?.find((s: any) => s.name === prediction.away_team)?.score;

          if (homeScore === undefined || awayScore === undefined) continue;

          const homeScoreNum = parseInt(homeScore);
          const awayScoreNum = parseInt(awayScore);
          
          const winner = homeScoreNum > awayScoreNum ? prediction.home_team : prediction.away_team;
          const wasUpset = winner === prediction.underdog;

          // Update prediction
          const { error: updateError } = await supabase
            .from('god_mode_upset_predictions')
            .update({
              game_completed: true,
              was_upset: wasUpset,
              verified_at: new Date().toISOString()
            })
            .eq('id', prediction.id);

          if (!updateError) {
            totalVerified++;
            if (wasUpset) correctPredictions++;

            results.push({
              id: prediction.id,
              underdog: prediction.underdog,
              upsetScore: prediction.final_upset_score,
              confidence: prediction.confidence,
              wasUpset,
              chaosModeActive: prediction.chaos_mode_active
            });

            console.log(`[Verify] ${prediction.underdog}: Upset=${wasUpset}, Score=${prediction.final_upset_score}`);
          }
        }
      } catch (sportError) {
        console.error(`[Verify] Error processing ${sport}:`, sportError);
      }
    }

    // Update accuracy metrics
    await updateAccuracyMetrics(supabase, results);

    const accuracy = totalVerified > 0 ? (correctPredictions / totalVerified * 100).toFixed(1) : 0;

    console.log(`[Verify God Mode] Completed. Verified: ${totalVerified}, Correct: ${correctPredictions}, Accuracy: ${accuracy}%`);

    return new Response(JSON.stringify({
      success: true,
      verified: totalVerified,
      correct: correctPredictions,
      accuracy: parseFloat(accuracy as string),
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[Verify God Mode] Error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function updateAccuracyMetrics(supabase: any, results: any[]) {
  // Group results by confidence level and chaos mode
  const groups: Record<string, { total: number; correct: number; scores: number[] }> = {};

  for (const result of results) {
    const key = `${result.confidence}_${result.chaosModeActive}`;
    if (!groups[key]) {
      groups[key] = { total: 0, correct: 0, scores: [] };
    }
    groups[key].total++;
    if (result.wasUpset) groups[key].correct++;
    groups[key].scores.push(result.upsetScore);
  }

  // Upsert metrics
  for (const [key, data] of Object.entries(groups)) {
    const [confidence, chaosMode] = key.split('_');
    const avgScore = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
    const accuracy = data.total > 0 ? (data.correct / data.total * 100) : 0;

    // Calculate ROI assuming -110 juice
    const roi = data.total > 0 
      ? ((data.correct * 0.91 - (data.total - data.correct)) / data.total * 100)
      : 0;

    await supabase
      .from('god_mode_accuracy_metrics')
      .upsert({
        confidence_level: confidence,
        chaos_mode_active: chaosMode === 'true',
        total_predictions: data.total,
        correct_predictions: data.correct,
        accuracy_rate: Math.round(accuracy * 10) / 10,
        avg_upset_score: Math.round(avgScore * 10) / 10,
        roi_percentage: Math.round(roi * 10) / 10,
        updated_at: new Date().toISOString()
      }, { 
        onConflict: 'sport,confidence_level,chaos_mode_active',
        ignoreDuplicates: false 
      });
  }
}
