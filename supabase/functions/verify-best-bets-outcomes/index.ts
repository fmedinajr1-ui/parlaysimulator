import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Continuous Calibration Feedback Loop
 * 
 * This function:
 * 1. Finds unverified best_bets_log entries where games have completed
 * 2. Matches against line_movements outcomes by event_id
 * 3. Updates best_bets_log.outcome (true/false)
 * 4. Recalculates accuracy stats in sharp_signal_accuracy
 * 
 * Should run every 6 hours via cron job
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const now = new Date().toISOString();
    const jobStartTime = Date.now();
    
    console.log('[VerifyBestBets] Starting outcome verification and calibration...');

    // Step 1: Find unverified best bets that are at least 6 hours old (game likely finished)
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    
    const { data: unsettledBets, error: fetchError } = await supabase
      .from('best_bets_log')
      .select('*')
      .is('outcome', null)
      .lt('created_at', sixHoursAgo)
      .order('created_at', { ascending: true })
      .limit(100);

    if (fetchError) {
      console.error('[VerifyBestBets] Fetch error:', fetchError);
      throw fetchError;
    }

    console.log(`[VerifyBestBets] Found ${unsettledBets?.length || 0} unsettled best bets to verify`);

    let verifiedCount = 0;
    let matchedCount = 0;
    const updatedSignals: Record<string, { wins: number; total: number }> = {};

    // Step 2: Match against verified line_movements or other outcome sources
    for (const bet of unsettledBets || []) {
      let outcome: boolean | null = null;

      // Try to find verified line movement for this event
      if (bet.signal_type?.includes('fade') || bet.signal_type?.includes('caution') || bet.signal_type?.includes('pick')) {
        const { data: verifiedMovement } = await supabase
          .from('line_movements')
          .select('outcome_correct, outcome_verified')
          .eq('event_id', bet.event_id)
          .eq('outcome_verified', true)
          .limit(1)
          .single();

        if (verifiedMovement) {
          // For fade signals, the bet wins when the public bet LOSES
          if (bet.signal_type?.includes('fade')) {
            outcome = !verifiedMovement.outcome_correct;
          } else {
            outcome = verifiedMovement.outcome_correct;
          }
          matchedCount++;
        }
      }

      // Try fatigue edge tracking
      if (bet.signal_type === 'nba_fatigue' && outcome === null) {
        const { data: fatigueResult } = await supabase
          .from('fatigue_edge_tracking')
          .select('recommended_side_won')
          .eq('event_id', bet.event_id)
          .not('recommended_side_won', 'is', null)
          .limit(1)
          .single();

        if (fatigueResult) {
          outcome = fatigueResult.recommended_side_won;
          matchedCount++;
        }
      }

      // Try god mode upset predictions
      if (bet.signal_type?.includes('god_mode') && outcome === null) {
        const { data: upsetResult } = await supabase
          .from('god_mode_upset_predictions')
          .select('was_upset, game_completed')
          .eq('event_id', bet.event_id)
          .eq('game_completed', true)
          .limit(1)
          .single();

        if (upsetResult) {
          outcome = upsetResult.was_upset;
          matchedCount++;
        }
      }

      // Try median lock candidates
      if (bet.signal_type === 'median_lock' && outcome === null) {
        const { data: medianResult } = await supabase
          .from('median_lock_candidates')
          .select('outcome')
          .eq('event_id', bet.event_id)
          .not('outcome', 'is', null)
          .limit(1)
          .single();

        if (medianResult) {
          outcome = medianResult.outcome === 'hit';
          matchedCount++;
        }
      }

      // Update the best bet if we found an outcome
      if (outcome !== null) {
        const { error: updateError } = await supabase
          .from('best_bets_log')
          .update({
            outcome,
            verified_at: now
          })
          .eq('id', bet.id);

        if (!updateError) {
          verifiedCount++;
          
          // Track for accuracy recalculation
          const signalKey = bet.signal_type;
          if (!updatedSignals[signalKey]) {
            updatedSignals[signalKey] = { wins: 0, total: 0 };
          }
          updatedSignals[signalKey].total++;
          if (outcome) {
            updatedSignals[signalKey].wins++;
          }
        }
      }
    }

    console.log(`[VerifyBestBets] Verified ${verifiedCount} bets, matched ${matchedCount} outcomes`);

    // Step 3: Recalculate accuracy stats in sharp_signal_accuracy
    if (Object.keys(updatedSignals).length > 0) {
      console.log('[VerifyBestBets] Recalculating signal accuracies...');
      
      for (const [signalType, stats] of Object.entries(updatedSignals)) {
        // Get current stats from best_bets_log for this signal type
        const { data: allBets } = await supabase
          .from('best_bets_log')
          .select('outcome')
          .eq('signal_type', signalType)
          .not('outcome', 'is', null);

        if (allBets && allBets.length >= 10) {
          const totalVerified = allBets.length;
          const totalWins = allBets.filter(b => b.outcome === true).length;
          const accuracyRate = (totalWins / totalVerified) * 100;

          // Update or insert into sharp_signal_accuracy
          const { error: upsertError } = await supabase
            .from('sharp_signal_accuracy')
            .upsert({
              signal_name: signalType,
              signal_type: signalType.split('_').slice(0, -1).join('_') || signalType,
              sport: signalType.split('_')[0] || 'all',
              total_occurrences: totalVerified,
              correct_when_present: totalWins,
              accuracy_rate: accuracyRate,
              suggested_weight: Math.max(0, (accuracyRate - 52.4) * 0.5), // Weight based on edge
              last_calibrated_at: now,
              updated_at: now
            }, {
              onConflict: 'signal_name'
            });

          if (upsertError) {
            console.error(`[VerifyBestBets] Error updating accuracy for ${signalType}:`, upsertError);
          } else {
            console.log(`[VerifyBestBets] Updated ${signalType}: ${accuracyRate.toFixed(1)}% (${totalWins}/${totalVerified})`);
          }
        }
      }
    }

    // Step 4: Log job completion
    const jobDuration = Date.now() - jobStartTime;
    
    await supabase.from('cron_job_history').insert({
      job_name: 'verify-best-bets-outcomes',
      status: 'completed',
      started_at: now,
      completed_at: new Date().toISOString(),
      duration_ms: jobDuration,
      result: {
        unsettled_found: unsettledBets?.length || 0,
        outcomes_matched: matchedCount,
        bets_verified: verifiedCount,
        signals_recalibrated: Object.keys(updatedSignals).length
      }
    });

    console.log(`[VerifyBestBets] Complete in ${jobDuration}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        unsettledFound: unsettledBets?.length || 0,
        outcomesMatched: matchedCount,
        betsVerified: verifiedCount,
        signalsRecalibrated: Object.keys(updatedSignals),
        durationMs: jobDuration
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[VerifyBestBets] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
