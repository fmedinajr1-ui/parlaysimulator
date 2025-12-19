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

    console.log('[Recalibrate Accuracy] Starting accuracy recalibration...');

    const results: Record<string, any> = {};

    // 1. Recalibrate God Mode accuracy metrics
    console.log('[Recalibrate] Processing God Mode predictions...');
    const { data: godModePredictions } = await supabase
      .from('god_mode_upset_predictions')
      .select('*')
      .eq('game_completed', true);

    if (godModePredictions && godModePredictions.length > 0) {
      // Group by sport, confidence, and chaos_mode
      const groups = new Map<string, { total: number; correct: number; odds: number[]; scores: number[] }>();
      
      for (const pred of godModePredictions) {
        const key = `${pred.sport}|${pred.confidence}|${pred.chaos_mode_active}`;
        if (!groups.has(key)) {
          groups.set(key, { total: 0, correct: 0, odds: [], scores: [] });
        }
        const g = groups.get(key)!;
        g.total++;
        if (pred.was_upset) g.correct++;
        g.odds.push(pred.underdog_odds || 0);
        g.scores.push(pred.final_upset_score || 0);
      }

      // Upsert to accuracy metrics
      for (const [key, stats] of groups) {
        const [sport, confidence, chaosMode] = key.split('|');
        const avgOdds = stats.odds.reduce((a, b) => a + b, 0) / stats.odds.length;
        const avgScore = stats.scores.reduce((a, b) => a + b, 0) / stats.scores.length;
        const winRate = stats.correct / stats.total;
        
        // ROI calculation assuming flat betting on underdogs
        const roi = stats.odds.reduce((sum, odds, i) => {
          const pred = godModePredictions.find((p, j) => j === i);
          if (pred?.was_upset) {
            return sum + (odds > 0 ? odds / 100 : -100 / odds);
          }
          return sum - 1;
        }, 0) / stats.total * 100;

        await supabase
          .from('god_mode_accuracy_metrics')
          .upsert({
            sport: sport || 'ALL',
            confidence_level: confidence,
            chaos_mode_active: chaosMode === 'true',
            total_predictions: stats.total,
            correct_predictions: stats.correct,
            accuracy_rate: Math.round(winRate * 100 * 10) / 10,
            avg_upset_score: Math.round(avgScore * 10) / 10,
            roi_percentage: Math.round(roi * 10) / 10,
            updated_at: new Date().toISOString()
          }, { onConflict: 'sport,confidence_level,chaos_mode_active' });
      }

      results.godMode = { processed: godModePredictions.length, groups: groups.size };
    }

    // 2. Recalibrate FanDuel trap accuracy
    console.log('[Recalibrate] Processing FanDuel traps...');
    const { data: trapAnalysis } = await supabase
      .from('fanduel_trap_analysis')
      .select('*')
      .not('outcome', 'is', null);

    if (trapAnalysis && trapAnalysis.length > 0) {
      const trapGroups = new Map<string, { total: number; correct: number; scores: number[] }>();
      
      for (const trap of trapAnalysis) {
        const trapType = trap.is_public_bait ? 'public_bait' : 'sharp_fade';
        const key = `${trap.sport}|${trapType}`;
        if (!trapGroups.has(key)) {
          trapGroups.set(key, { total: 0, correct: 0, scores: [] });
        }
        const g = trapGroups.get(key)!;
        g.total++;
        if (trap.fade_won) g.correct++;
        g.scores.push(trap.trap_score || 0);
      }

      for (const [key, stats] of trapGroups) {
        const [sport, trapType] = key.split('|');
        
        await supabase
          .from('fanduel_trap_accuracy_metrics')
          .upsert({
            sport,
            trap_type: trapType,
            signal_type: 'fade_recommendation',
            total_predictions: stats.total,
            verified_predictions: stats.total,
            correct_predictions: stats.correct,
            accuracy_rate: Math.round(stats.correct / stats.total * 100 * 10) / 10,
            avg_trap_score: Math.round(stats.scores.reduce((a, b) => a + b, 0) / stats.scores.length * 10) / 10,
            updated_at: new Date().toISOString()
          }, { onConflict: 'sport,trap_type,signal_type' });
      }

      results.fanduelTraps = { processed: trapAnalysis.length, groups: trapGroups.size };
    }

    // 3. Recalibrate Hit Rate parlays
    console.log('[Recalibrate] Processing Hit Rate parlays...');
    const { data: hitrateParlays } = await supabase
      .from('hitrate_parlays')
      .select('*')
      .not('outcome', 'is', null);

    if (hitrateParlays && hitrateParlays.length > 0) {
      const hrGroups = new Map<string, { total: number; won: number; probs: number[] }>();
      
      for (const parlay of hitrateParlays) {
        const key = `${parlay.strategy_type}|${parlay.sport || 'mixed'}`;
        if (!hrGroups.has(key)) {
          hrGroups.set(key, { total: 0, won: 0, probs: [] });
        }
        const g = hrGroups.get(key)!;
        g.total++;
        if (parlay.outcome === 'won') g.won++;
        g.probs.push(parlay.combined_probability || 0);
      }

      for (const [key, stats] of hrGroups) {
        const [strategy, sport] = key.split('|');
        const avgPredictedProb = stats.probs.reduce((a, b) => a + b, 0) / stats.probs.length;
        const actualProb = stats.won / stats.total;
        
        await supabase
          .from('hitrate_accuracy_metrics')
          .upsert({
            strategy_type: strategy,
            sport: sport !== 'mixed' ? sport : null,
            total_parlays: stats.total,
            total_won: stats.won,
            total_lost: stats.total - stats.won,
            win_rate: Math.round(actualProb * 100 * 10) / 10,
            avg_predicted_probability: Math.round(avgPredictedProb * 10) / 10,
            avg_actual_probability: Math.round(actualProb * 100 * 10) / 10,
            calibration_factor: avgPredictedProb > 0 ? Math.round(actualProb / avgPredictedProb * 100) / 100 : 1,
            updated_at: new Date().toISOString()
          }, { onConflict: 'strategy_type,sport' });
      }

      results.hitRate = { processed: hitrateParlays.length, groups: hrGroups.size };
    }

    // 4. Recalibrate Median Lock accuracy
    console.log('[Recalibrate] Processing Median Lock candidates...');
    const { data: medianLocks } = await supabase
      .from('median_lock_candidates')
      .select('*')
      .in('outcome', ['hit', 'miss']);

    if (medianLocks && medianLocks.length > 0) {
      const mlGroups = new Map<string, { total: number; hits: number }>();
      
      for (const ml of medianLocks) {
        const key = `${ml.classification}|${ml.bet_side}|${ml.sport || 'mixed'}`;
        if (!mlGroups.has(key)) {
          mlGroups.set(key, { total: 0, hits: 0 });
        }
        const g = mlGroups.get(key)!;
        g.total++;
        if (ml.outcome === 'hit') g.hits++;
      }

      results.medianLock = { processed: medianLocks.length, groups: mlGroups.size };
    }

    // 5. Update god_mode_weights based on performance
    console.log('[Recalibrate] Updating God Mode weights...');
    const { data: accuracyMetrics } = await supabase
      .from('god_mode_accuracy_metrics')
      .select('*')
      .gte('total_predictions', 20);

    if (accuracyMetrics && accuracyMetrics.length > 0) {
      // Calculate optimal weights per sport based on actual performance
      const sportPerformance = new Map<string, { roi: number; accuracy: number }>();
      
      for (const m of accuracyMetrics) {
        if (!sportPerformance.has(m.sport)) {
          sportPerformance.set(m.sport, { roi: 0, accuracy: 0 });
        }
        const p = sportPerformance.get(m.sport)!;
        p.roi = Math.max(p.roi, m.roi_percentage || 0);
        p.accuracy = Math.max(p.accuracy, m.accuracy_rate || 0);
      }

      // Adjust weights slightly towards better-performing signals
      for (const [sport, perf] of sportPerformance) {
        if (perf.accuracy > 40 && perf.roi > 0) {
          // This sport/signal is performing well - boost sharp weight
          await supabase
            .from('god_mode_weights')
            .update({ weight_value: 0.22 }) // Slight boost from 0.20
            .eq('sport', sport)
            .eq('weight_key', 'sharp_pct');
        }
      }

      results.weightsUpdated = sportPerformance.size;
    }

    // Log completion
    await supabase.from('cron_job_history').insert({
      job_name: 'recalibrate-accuracy',
      status: 'completed',
      result: results
    });

    console.log('[Recalibrate Accuracy] Complete:', results);

    return new Response(JSON.stringify({
      success: true,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Recalibrate Accuracy] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
