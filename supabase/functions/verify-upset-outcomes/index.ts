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
    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    const startTime = Date.now();

    // Get unverified predictions where game time has passed
    const { data: pendingPredictions, error: fetchError } = await supabase
      .from('upset_predictions')
      .select('*')
      .eq('game_completed', false)
      .lt('commence_time', new Date().toISOString())
      .order('commence_time', { ascending: true })
      .limit(50);

    if (fetchError) throw fetchError;
    
    console.log(`[VerifyUpsets] Found ${pendingPredictions?.length || 0} predictions to verify`);

    if (!pendingPredictions || pendingPredictions.length === 0) {
      return new Response(JSON.stringify({
        message: 'No predictions to verify',
        verified: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Group predictions by sport for efficient API calls
    const sportGroups: Record<string, any[]> = {};
    for (const pred of pendingPredictions) {
      if (!sportGroups[pred.sport]) sportGroups[pred.sport] = [];
      sportGroups[pred.sport].push(pred);
    }

    const SPORT_API_KEYS: Record<string, string> = {
      'NBA': 'basketball_nba',
      'NCAAB': 'basketball_ncaab',
      'NFL': 'americanfootball_nfl',
      'NCAAF': 'americanfootball_ncaaf',
      'NHL': 'icehockey_nhl',
      'MLB': 'baseball_mlb',
    };

    let verifiedCount = 0;
    let correctCount = 0;
    const confidenceResults: Record<string, { total: number; correct: number; roiSum: number }> = {};
    const scoreRangeResults: Record<string, { total: number; correct: number }> = {};

    // Fetch scores for each sport
    for (const [sport, predictions] of Object.entries(sportGroups)) {
      const apiKey = SPORT_API_KEYS[sport];
      if (!apiKey) continue;

      try {
        // Fetch completed games from The Odds API
        const response = await fetch(
          `https://api.the-odds-api.com/v4/sports/${apiKey}/scores/?apiKey=${oddsApiKey}&daysFrom=3`
        );

        if (!response.ok) continue;
        const scores = await response.json();

        // Match predictions to completed games
        for (const pred of predictions) {
          const game = scores.find((s: any) => s.id === pred.game_id);
          
          if (!game || !game.completed) continue;

          // Determine winner
          const homeScore = game.scores?.find((s: any) => s.name === pred.home_team)?.score;
          const awayScore = game.scores?.find((s: any) => s.name === pred.away_team)?.score;

          if (homeScore === undefined || awayScore === undefined) continue;

          const winner = parseInt(homeScore) > parseInt(awayScore) 
            ? pred.home_team 
            : pred.away_team;
          
          // Check if underdog won (upset)
          const wasUpset = winner === pred.underdog;

          // Track by confidence level
          if (!confidenceResults[pred.confidence]) {
            confidenceResults[pred.confidence] = { total: 0, correct: 0, roiSum: 0 };
          }
          confidenceResults[pred.confidence].total++;
          if (wasUpset) {
            confidenceResults[pred.confidence].correct++;
            // Calculate ROI based on underdog odds (assuming -110 standard)
            const odds = pred.underdog_odds || 200;
            const profit = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
            confidenceResults[pred.confidence].roiSum += profit;
          } else {
            confidenceResults[pred.confidence].roiSum -= 1; // Lost the bet
          }

          // Track by upset score range
          const scoreRange = pred.upset_score >= 60 ? '60-100' : pred.upset_score >= 30 ? '30-59' : '0-29';
          if (!scoreRangeResults[scoreRange]) {
            scoreRangeResults[scoreRange] = { total: 0, correct: 0 };
          }
          scoreRangeResults[scoreRange].total++;
          if (wasUpset) scoreRangeResults[scoreRange].correct++;

          // Update prediction record
          const { error: updateError } = await supabase
            .from('upset_predictions')
            .update({
              game_completed: true,
              winner,
              was_upset: wasUpset,
              verified_at: new Date().toISOString()
            })
            .eq('id', pred.id);

          if (!updateError) {
            verifiedCount++;
            if (wasUpset) correctCount++;
            console.log(`[VerifyUpsets] Verified: ${pred.home_team} vs ${pred.away_team} - Winner: ${winner}, Upset: ${wasUpset}, Score: ${pred.upset_score}, Confidence: ${pred.confidence}`);
          }
        }
      } catch (e) {
        console.error(`[VerifyUpsets] Error fetching scores for ${sport}:`, e);
      }
    }

    // Update calibration factors for upset predictions using new function
    try {
      await supabase.rpc('update_upset_calibration');
    } catch (e) {
      console.error('[VerifyUpsets] Error updating calibration:', e);
    }

    // Update AI performance metrics for upset predictions
    for (const [confidence, results] of Object.entries(confidenceResults)) {
      if (results.total > 0) {
        await supabase.from('ai_performance_metrics').upsert({
          sport: 'upset_tracker',
          bet_type: 'moneyline',
          confidence_level: confidence,
          total_predictions: results.total,
          correct_predictions: results.correct,
          accuracy_rate: (results.correct / results.total) * 100,
          profit_units: results.roiSum,
          updated_at: new Date().toISOString()
        }, { onConflict: 'sport,bet_type,confidence_level' });
      }
    }

    // Get updated accuracy stats
    const { data: accuracyData } = await supabase.rpc('get_upset_accuracy_summary');

    const duration = Date.now() - startTime;

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'verify-upset-outcomes',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { 
        verified: verifiedCount, 
        upsets: correctCount,
        byConfidence: confidenceResults,
        byScoreRange: scoreRangeResults,
        accuracy: accuracyData?.[0] || null
      }
    });

    return new Response(JSON.stringify({
      message: `Verified ${verifiedCount} predictions`,
      verified: verifiedCount,
      upsets: correctCount,
      accuracyByConfidence: confidenceResults,
      accuracyByScoreRange: scoreRangeResults,
      overallAccuracy: accuracyData?.[0] || null,
      duration
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[VerifyUpsets] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
