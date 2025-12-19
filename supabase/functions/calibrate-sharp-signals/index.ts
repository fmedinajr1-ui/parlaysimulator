import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SignalStats {
  signal: string;
  type: 'sharp' | 'trap';
  total: number;
  correct: number;
  accuracy: number;
  avgSES: number;
  sports: { [sport: string]: { total: number; correct: number } };
}

interface CalibrationResult {
  signalStats: SignalStats[];
  sportAccuracy: { [sport: string]: { total: number; correct: number; accuracy: number } };
  recommendationAccuracy: {
    pick: { total: number; correct: number; accuracy: number };
    fade: { total: number; correct: number; accuracy: number };
    caution: { total: number; correct: number; accuracy: number };
  };
  sesRangeAccuracy: { range: string; total: number; correct: number; accuracy: number }[];
  suggestedWeightChanges: { signal: string; currentWeight: number; suggestedWeight: number; reason: string }[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Log job start
    const startTime = Date.now();
    const { data: jobRecord } = await supabase
      .from('cron_job_history')
      .insert({
        job_name: 'calibrate-sharp-signals',
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    console.log('Starting Sharp Signal Calibration...');

    // Fetch verified movements from the last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: movements, error: fetchError } = await supabase
      .from('line_movements')
      .select('*')
      .eq('outcome_verified', true)
      .gte('detected_at', thirtyDaysAgo)
      .not('detected_signals', 'is', null);

    if (fetchError) throw fetchError;

    if (!movements || movements.length < 20) {
      console.log('Insufficient verified data for calibration:', movements?.length || 0);
      
      if (jobRecord) {
        await supabase
          .from('cron_job_history')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            result: { message: 'Insufficient data', count: movements?.length || 0 },
          })
          .eq('id', jobRecord.id);
      }

      return new Response(
        JSON.stringify({ success: false, message: 'Insufficient verified data for calibration', count: movements?.length || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Analyzing ${movements.length} verified movements...`);

    // Initialize tracking
    const signalStats: Map<string, SignalStats> = new Map();
    const sportAccuracy: { [sport: string]: { total: number; correct: number } } = {};
    const recommendationAccuracy = {
      pick: { total: 0, correct: 0 },
      fade: { total: 0, correct: 0 },
      caution: { total: 0, correct: 0 },
    };
    const sesRanges = [
      { min: -100, max: -50, label: 'very_low' },
      { min: -50, max: -20, label: 'low' },
      { min: -20, max: 0, label: 'slightly_low' },
      { min: 0, max: 20, label: 'slightly_high' },
      { min: 20, max: 50, label: 'high' },
      { min: 50, max: 100, label: 'very_high' },
    ];
    const sesRangeStats: Map<string, { total: number; correct: number }> = new Map();
    sesRanges.forEach(r => sesRangeStats.set(r.label, { total: 0, correct: 0 }));

    // Process each movement
    for (const movement of movements) {
      const isCorrect = movement.outcome_correct === true;
      const sport = movement.sport || 'unknown';
      const recommendation = movement.recommendation as 'pick' | 'fade' | 'caution';
      const ses = movement.sharp_edge_score || 0;
      const signals = movement.detected_signals as { type: string; signal: string; value: number }[] || [];

      // Track sport accuracy
      if (!sportAccuracy[sport]) {
        sportAccuracy[sport] = { total: 0, correct: 0 };
      }
      sportAccuracy[sport].total++;
      if (isCorrect) sportAccuracy[sport].correct++;

      // Track recommendation accuracy
      if (recommendation && recommendationAccuracy[recommendation]) {
        recommendationAccuracy[recommendation].total++;
        if (isCorrect) recommendationAccuracy[recommendation].correct++;
      }

      // Track SES range accuracy
      for (const range of sesRanges) {
        if (ses >= range.min && ses < range.max) {
          const stats = sesRangeStats.get(range.label)!;
          stats.total++;
          if (isCorrect) stats.correct++;
          break;
        }
      }

      // Track signal-level accuracy
      for (const sig of signals) {
        const key = `${sig.type}:${sig.signal}`;
        if (!signalStats.has(key)) {
          signalStats.set(key, {
            signal: sig.signal,
            type: sig.type as 'sharp' | 'trap',
            total: 0,
            correct: 0,
            accuracy: 0,
            avgSES: 0,
            sports: {},
          });
        }
        const stats = signalStats.get(key)!;
        stats.total++;
        if (isCorrect) stats.correct++;
        stats.avgSES = ((stats.avgSES * (stats.total - 1)) + ses) / stats.total;

        // Track by sport
        if (!stats.sports[sport]) {
          stats.sports[sport] = { total: 0, correct: 0 };
        }
        stats.sports[sport].total++;
        if (isCorrect) stats.sports[sport].correct++;
      }
    }

    // Calculate accuracies
    const signalStatsArray: SignalStats[] = [];
    for (const [key, stats] of signalStats) {
      stats.accuracy = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
      signalStatsArray.push(stats);
    }

    // Sort by accuracy
    signalStatsArray.sort((a, b) => b.accuracy - a.accuracy);

    // Generate suggested weight changes
    const suggestedWeightChanges: { signal: string; currentWeight: number; suggestedWeight: number; reason: string }[] = [];
    
    // Load current config
    const { data: configRows } = await supabase
      .from('sharp_engine_config')
      .select('config_key, config_value');
    
    const currentConfig: { [key: string]: number } = {};
    for (const row of configRows || []) {
      currentConfig[row.config_key] = row.config_value;
    }

    // Analyze each signal and suggest changes
    for (const stats of signalStatsArray) {
      if (stats.total < 10) continue; // Need sufficient sample

      const configKey = stats.type === 'sharp' 
        ? `SIGNAL_${stats.signal.replace(/([A-Z])/g, '_$1').toUpperCase()}`
        : `TRAP_${stats.signal.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
      
      const currentWeight = currentConfig[configKey] || 20;
      
      // If signal accuracy is below 40%, reduce weight significantly
      // If signal accuracy is above 60%, increase weight
      let suggestedWeight = currentWeight;
      let reason = '';

      if (stats.type === 'sharp') {
        // Sharp signals: higher accuracy = higher weight
        if (stats.accuracy < 40) {
          suggestedWeight = Math.max(5, currentWeight * 0.5);
          reason = `Accuracy ${stats.accuracy.toFixed(1)}% is below 40% - reduce weight`;
        } else if (stats.accuracy > 60) {
          suggestedWeight = Math.min(40, currentWeight * 1.3);
          reason = `Accuracy ${stats.accuracy.toFixed(1)}% is above 60% - increase weight`;
        }
      } else {
        // Trap signals: we want them to correctly identify traps
        // If a trap signal is present and the pick LOSES, that's good trap detection
        if (stats.accuracy > 60) {
          // High accuracy when trap signal is present = bad trap detection
          suggestedWeight = Math.max(5, currentWeight * 0.5);
          reason = `Trap signal has ${stats.accuracy.toFixed(1)}% win rate - ineffective trap detection`;
        } else if (stats.accuracy < 40) {
          // Low accuracy = good trap detection
          suggestedWeight = Math.min(40, currentWeight * 1.3);
          reason = `Trap signal has ${stats.accuracy.toFixed(1)}% win rate - effective trap detection`;
        }
      }

      if (Math.abs(suggestedWeight - currentWeight) >= 3) {
        suggestedWeightChanges.push({
          signal: stats.signal,
          currentWeight,
          suggestedWeight: Math.round(suggestedWeight),
          reason,
        });
      }
    }

    // Calculate recommendation accuracy percentages
    const recAccWithPct = {
      pick: { 
        ...recommendationAccuracy.pick, 
        accuracy: recommendationAccuracy.pick.total > 0 
          ? (recommendationAccuracy.pick.correct / recommendationAccuracy.pick.total) * 100 
          : 0 
      },
      fade: { 
        ...recommendationAccuracy.fade, 
        accuracy: recommendationAccuracy.fade.total > 0 
          ? (recommendationAccuracy.fade.correct / recommendationAccuracy.fade.total) * 100 
          : 0 
      },
      caution: { 
        ...recommendationAccuracy.caution, 
        accuracy: recommendationAccuracy.caution.total > 0 
          ? (recommendationAccuracy.caution.correct / recommendationAccuracy.caution.total) * 100 
          : 0 
      },
    };

    // Calculate sport accuracy percentages
    const sportAccWithPct: { [sport: string]: { total: number; correct: number; accuracy: number } } = {};
    for (const [sport, stats] of Object.entries(sportAccuracy)) {
      sportAccWithPct[sport] = {
        ...stats,
        accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
      };
    }

    // Calculate SES range accuracy
    const sesRangeAccuracy = sesRanges.map(r => {
      const stats = sesRangeStats.get(r.label)!;
      return {
        range: r.label,
        ...stats,
        accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
      };
    });

    // Update signal accuracy table
    for (const stats of signalStatsArray) {
      await supabase
        .from('sharp_signal_accuracy')
        .upsert({
          signal_name: stats.signal,
          signal_type: stats.type,
          sport: 'all',
          total_occurrences: stats.total,
          correct_when_present: stats.correct,
          accuracy_rate: stats.accuracy,
          avg_ses_when_present: stats.avgSES,
          suggested_weight: suggestedWeightChanges.find(s => s.signal === stats.signal)?.suggestedWeight,
          last_calibrated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'signal_name,sport',
        });

      // Also update per-sport accuracy
      for (const [sport, sportStats] of Object.entries(stats.sports)) {
        if (sportStats.total >= 5) {
          await supabase
            .from('sharp_signal_accuracy')
            .upsert({
              signal_name: stats.signal,
              signal_type: stats.type,
              sport,
              total_occurrences: sportStats.total,
              correct_when_present: sportStats.correct,
              accuracy_rate: sportStats.total > 0 ? (sportStats.correct / sportStats.total) * 100 : 0,
              last_calibrated_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'signal_name,sport',
            });
        }
      }
    }

    const result: CalibrationResult = {
      signalStats: signalStatsArray,
      sportAccuracy: sportAccWithPct,
      recommendationAccuracy: recAccWithPct,
      sesRangeAccuracy,
      suggestedWeightChanges,
    };

    console.log('Calibration complete:', {
      movementsAnalyzed: movements.length,
      signalsTracked: signalStatsArray.length,
      suggestedChanges: suggestedWeightChanges.length,
      pickAccuracy: recAccWithPct.pick.accuracy.toFixed(1) + '%',
      fadeAccuracy: recAccWithPct.fade.accuracy.toFixed(1) + '%',
    });

    // Update job record
    if (jobRecord) {
      await supabase
        .from('cron_job_history')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          result: {
            movementsAnalyzed: movements.length,
            signalsTracked: signalStatsArray.length,
            suggestedChanges: suggestedWeightChanges.length,
            pickAccuracy: recAccWithPct.pick.accuracy,
            fadeAccuracy: recAccWithPct.fade.accuracy,
          },
        })
        .eq('id', jobRecord.id);
    }

    return new Response(
      JSON.stringify({ success: true, result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Calibration Error:', error);
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
