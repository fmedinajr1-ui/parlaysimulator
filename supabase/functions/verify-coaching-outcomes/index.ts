import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CoachingPrediction {
  id: string;
  coach_id: string;
  coach_name: string;
  team_name: string;
  event_id: string;
  game_date: string;
  situation: string;
  prop_type: string;
  player_name: string | null;
  recommendation: string;
  confidence: number;
  prop_line: number | null;
  predicted_direction: string | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('Verify Coaching Outcomes - Starting verification');

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch pending coaching predictions from yesterday and before
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const { data: pendingPredictions, error: fetchError } = await supabase
      .from('coaching_predictions')
      .select('*')
      .eq('outcome', 'pending')
      .lte('game_date', yesterdayStr)
      .limit(100);

    if (fetchError) {
      console.error('Error fetching pending predictions:', fetchError);
      throw fetchError;
    }

    console.log(`Found ${pendingPredictions?.length || 0} pending coaching predictions to verify`);

    if (!pendingPredictions || pendingPredictions.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          verified: 0, 
          message: 'No pending predictions to verify' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let verified = 0;
    let wins = 0;
    let losses = 0;
    const metricsUpdates: Map<string, { wins: number; losses: number; total: number; confidence: number }> = new Map();

    for (const prediction of pendingPredictions as CoachingPrediction[]) {
      try {
        // Check if we have player stats for this game
        let actualValue: number | null = null;
        let predictionAccurate: boolean | null = null;

        if (prediction.player_name && prediction.prop_line) {
          // Look for player stats
          const { data: statsData } = await supabase
            .from('player_stats_cache')
            .select('stat_value')
            .eq('player_name', prediction.player_name)
            .eq('game_date', prediction.game_date)
            .eq('stat_type', prediction.prop_type)
            .maybeSingle();

          if (statsData && typeof statsData.stat_value === 'number') {
            actualValue = statsData.stat_value;
            const propLine = prediction.prop_line as number;
            
            // Determine if prediction was accurate
            const wentOver = actualValue > propLine;
            const predictedOver = prediction.predicted_direction === 'over' || prediction.recommendation === 'pick';
            const predictedUnder = prediction.predicted_direction === 'under' || prediction.recommendation === 'fade';
            
            if (predictedOver) {
              predictionAccurate = wentOver;
            } else if (predictedUnder) {
              predictionAccurate = !wentOver;
            }
          }
        }

        // If we couldn't get stats, try to infer from game results (for team-level predictions)
        if (predictionAccurate === null) {
          const { data: fatigueData } = await supabase
            .from('fatigue_edge_tracking')
            .select('recommended_side_won')
            .eq('event_id', prediction.event_id)
            .maybeSingle();

          if (fatigueData && fatigueData.recommended_side_won !== null) {
            // Use fatigue tracking as a proxy
            predictionAccurate = fatigueData.recommended_side_won;
          }
        }

        // Skip if we still couldn't determine outcome
        if (predictionAccurate === null) {
          console.log(`Could not determine outcome for prediction ${prediction.id}`);
          continue;
        }

        // Update the prediction record
        const outcome = predictionAccurate ? 'won' : 'lost';
        const { error: updateError } = await supabase
          .from('coaching_predictions')
          .update({
            outcome,
            outcome_verified: true,
            prediction_accurate: predictionAccurate,
            actual_stat_value: actualValue,
            verified_at: new Date().toISOString()
          })
          .eq('id', prediction.id);

        if (updateError) {
          console.error(`Error updating prediction ${prediction.id}:`, updateError);
          continue;
        }

        verified++;
        if (predictionAccurate) {
          wins++;
        } else {
          losses++;
        }

        // Track metrics for aggregation
        const metricsKey = `${prediction.coach_id}:${prediction.situation}:${prediction.prop_type}`;
        const existing = metricsUpdates.get(metricsKey) || { wins: 0, losses: 0, total: 0, confidence: 0 };
        existing.total++;
        existing.confidence += prediction.confidence;
        if (predictionAccurate) {
          existing.wins++;
        } else {
          existing.losses++;
        }
        metricsUpdates.set(metricsKey, existing);

      } catch (predError) {
        console.error(`Error processing prediction ${prediction.id}:`, predError);
      }
    }

    // Update aggregated accuracy metrics
    for (const [key, stats] of metricsUpdates) {
      const [coachId, situation, propType] = key.split(':');
      
      // Get existing metrics
      const { data: existingMetrics } = await supabase
        .from('coaching_accuracy_metrics')
        .select('*')
        .eq('coach_id', coachId)
        .eq('situation', situation)
        .eq('prop_type', propType)
        .maybeSingle();

      const totalPredictions = (existingMetrics?.total_predictions || 0) + stats.total;
      const correctPredictions = (existingMetrics?.correct_predictions || 0) + stats.wins;
      const winRate = totalPredictions > 0 ? (correctPredictions / totalPredictions) * 100 : 0;
      const avgConfidence = stats.total > 0 ? stats.confidence / stats.total : 0.5;

      // Calculate ROI (assuming -110 standard juice)
      const roi = totalPredictions > 0 
        ? ((correctPredictions * 0.91) - (totalPredictions - correctPredictions)) / totalPredictions * 100 
        : 0;

      // Calculate calibration factor
      const calibrationFactor = avgConfidence > 0 ? (winRate / 100) / avgConfidence : 1.0;

      // Get coach info for the record
      const { data: coachInfo } = await supabase
        .from('coach_profiles')
        .select('coach_name, team_name')
        .eq('id', coachId)
        .maybeSingle();

      // Upsert metrics
      const { error: upsertError } = await supabase
        .from('coaching_accuracy_metrics')
        .upsert({
          coach_id: coachId,
          coach_name: coachInfo?.coach_name || 'Unknown',
          team_name: coachInfo?.team_name || 'Unknown',
          situation,
          prop_type: propType,
          total_predictions: totalPredictions,
          correct_predictions: correctPredictions,
          win_rate: winRate,
          avg_confidence: avgConfidence,
          roi_percentage: roi,
          calibration_factor: calibrationFactor,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'coach_id,situation,prop_type'
        });

      if (upsertError) {
        console.error('Error upserting metrics:', upsertError);
      }
    }

    // Update AI formula performance for coaching
    const overallWinRate = verified > 0 ? (wins / verified) * 100 : 0;
    const { error: formulaError } = await supabase
      .from('ai_formula_performance')
      .upsert({
        formula_name: 'coaching_tendencies',
        engine_source: 'coaching',
        total_picks: verified,
        wins,
        losses,
        current_accuracy: overallWinRate,
        current_weight: overallWinRate >= 55 ? 1.2 : overallWinRate >= 50 ? 1.0 : 0.8,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'formula_name,engine_source'
      });

    if (formulaError) {
      console.error('Error updating formula performance:', formulaError);
    }

    // Log to cron job history
    const duration = Date.now() - startTime;
    await supabase
      .from('cron_job_history')
      .insert({
        job_name: 'verify-coaching-outcomes',
        status: 'completed',
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: duration,
        result: {
          verified,
          wins,
          losses,
          win_rate: verified > 0 ? ((wins / verified) * 100).toFixed(1) : 0
        }
      });

    console.log(`Verification complete: ${verified} predictions verified, ${wins} wins, ${losses} losses`);

    return new Response(
      JSON.stringify({
        success: true,
        verified,
        wins,
        losses,
        win_rate: verified > 0 ? ((wins / verified) * 100).toFixed(1) : 0,
        duration_ms: duration
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Verify coaching outcomes error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
