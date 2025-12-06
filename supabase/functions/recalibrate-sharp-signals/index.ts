import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SignalAccuracy {
  signal: string;
  total: number;
  correct: number;
  accuracy: number;
  currentWeight: number;
  suggestedWeight: number;
}

interface RecommendationAccuracy {
  recommendation: string;
  total: number;
  correct: number;
  accuracy: number;
}

interface CalibrationResult {
  timestamp: string;
  signalAccuracy: SignalAccuracy[];
  recommendationAccuracy: RecommendationAccuracy[];
  confidenceBuckets: {
    bucket: string;
    total: number;
    correct: number;
    accuracy: number;
  }[];
  suggestions: string[];
  calibrationFactors: Record<string, number>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  // Create cron job history record
  let historyId: string | null = null;
  try {
    const { data: historyRecord } = await supabase
      .from('cron_job_history')
      .insert({
        job_name: 'recalibrate-sharp-signals',
        status: 'running'
      })
      .select('id')
      .single();
    historyId = historyRecord?.id || null;
  } catch (e) {
    console.log('[RECALIBRATE] Could not create history record:', e);
  }

  try {
    console.log('[RECALIBRATE] Starting sharp signal recalibration...');

    // Fetch all verified line movements with outcomes
    const { data: movements, error: movementsError } = await supabase
      .from('line_movements')
      .select('*')
      .eq('outcome_verified', true)
      .eq('is_primary_record', true)
      .not('outcome_correct', 'is', null);

    if (movementsError) {
      throw new Error(`Failed to fetch movements: ${movementsError.message}`);
    }

    console.log(`[RECALIBRATE] Analyzing ${movements?.length || 0} verified movements`);

    if (!movements || movements.length < 10) {
      // Update history with insufficient data result
      if (historyId) {
        await supabase
          .from('cron_job_history')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            result: { message: 'Insufficient data', dataCount: movements?.length || 0 }
          })
          .eq('id', historyId);
      }
      
      return new Response(JSON.stringify({
        success: false,
        message: 'Insufficient data for recalibration (need at least 10 verified movements)',
        dataCount: movements?.length || 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Analyze by recommendation type
    const recommendationStats: Record<string, { total: number; correct: number }> = {
      'pick': { total: 0, correct: 0 },
      'fade': { total: 0, correct: 0 },
      'caution': { total: 0, correct: 0 }
    };

    // Analyze by confidence bucket
    const confidenceStats: Record<string, { total: number; correct: number }> = {
      '80%+': { total: 0, correct: 0 },
      '60-79%': { total: 0, correct: 0 },
      '50-59%': { total: 0, correct: 0 },
      '<50%': { total: 0, correct: 0 }
    };

    // Analyze by individual signals
    const signalStats: Record<string, { total: number; correct: number }> = {};

    // Current signal weights (from track-odds-movement)
    const currentWeights: Record<string, number> = {
      'REVERSE_LINE_MOVEMENT': 3,
      'STEAM_MOVE': 3,
      'SHARP_TIMING': 2,
      'PROFESSIONAL_SIZING': 2,
      'MULTI_BOOK_CONSENSUS': 2,
      'CLOSING_LINE_VALUE': 2,
      'LATE_MONEY_SWEET_SPOT': 2,
      'SIGNIFICANT_PRICE_MOVE': 1,
      'MODERATE_PRICE_MOVE': 1,
      'EARLY_MORNING_MOVE': -2,
      'SINGLE_BOOK_ONLY': -2,
      'BOTH_SIDES_MOVING': -1,
      'SMALL_MOVE': -1
    };

    for (const movement of movements) {
      const rec = movement.recommendation || 'caution';
      const confidence = movement.authenticity_confidence || 0.5;
      const isCorrect = movement.outcome_correct === true;

      // Track recommendation accuracy
      if (recommendationStats[rec]) {
        recommendationStats[rec].total++;
        if (isCorrect) recommendationStats[rec].correct++;
      }

      // Track confidence bucket accuracy
      let bucket = '<50%';
      if (confidence >= 0.8) bucket = '80%+';
      else if (confidence >= 0.6) bucket = '60-79%';
      else if (confidence >= 0.5) bucket = '50-59%';

      confidenceStats[bucket].total++;
      if (isCorrect) confidenceStats[bucket].correct++;

      // Track individual signal accuracy
      const indicator = movement.sharp_indicator || '';
      const signals = indicator.split(' - ').filter(Boolean);
      
      for (const signal of signals) {
        const trimmedSignal = signal.trim().toUpperCase().replace(/\s+/g, '_');
        if (!signalStats[trimmedSignal]) {
          signalStats[trimmedSignal] = { total: 0, correct: 0 };
        }
        signalStats[trimmedSignal].total++;
        if (isCorrect) signalStats[trimmedSignal].correct++;
      }
    }

    // Calculate accuracies and suggested weights
    const signalAccuracy: SignalAccuracy[] = Object.entries(signalStats)
      .filter(([_, stats]) => stats.total >= 5) // Only signals with enough data
      .map(([signal, stats]) => {
        const accuracy = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
        const currentWeight = currentWeights[signal] || 0;
        
        // Calculate suggested weight based on accuracy
        let suggestedWeight = 0;
        if (accuracy >= 65) suggestedWeight = 3;
        else if (accuracy >= 55) suggestedWeight = 2;
        else if (accuracy >= 50) suggestedWeight = 1;
        else if (accuracy >= 45) suggestedWeight = 0;
        else if (accuracy >= 40) suggestedWeight = -1;
        else suggestedWeight = -2;

        return {
          signal,
          total: stats.total,
          correct: stats.correct,
          accuracy: Math.round(accuracy * 10) / 10,
          currentWeight,
          suggestedWeight
        };
      })
      .sort((a, b) => b.accuracy - a.accuracy);

    const recommendationAccuracy: RecommendationAccuracy[] = Object.entries(recommendationStats)
      .map(([rec, stats]) => ({
        recommendation: rec,
        total: stats.total,
        correct: stats.correct,
        accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 1000) / 10 : 0
      }))
      .sort((a, b) => b.accuracy - a.accuracy);

    const confidenceBuckets = Object.entries(confidenceStats)
      .map(([bucket, stats]) => ({
        bucket,
        total: stats.total,
        correct: stats.correct,
        accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 1000) / 10 : 0
      }))
      .sort((a, b) => b.accuracy - a.accuracy);

    // Generate calibration suggestions
    const suggestions: string[] = [];
    const calibrationFactors: Record<string, number> = {};

    // Check PICK performance
    const pickStats = recommendationStats['pick'];
    const pickAccuracy = pickStats.total > 0 ? (pickStats.correct / pickStats.total) * 100 : 0;
    if (pickAccuracy < 55 && pickStats.total >= 10) {
      suggestions.push(`PICK accuracy is ${pickAccuracy.toFixed(1)}% - increase threshold from 3 to 4+ real score advantage`);
      calibrationFactors['PICK_THRESHOLD'] = 4;
    } else if (pickAccuracy >= 60 && pickStats.total >= 10) {
      suggestions.push(`PICK accuracy is strong at ${pickAccuracy.toFixed(1)}% - current threshold is working`);
      calibrationFactors['PICK_THRESHOLD'] = 3;
    }

    // Check FADE performance
    const fadeStats = recommendationStats['fade'];
    const fadeAccuracy = fadeStats.total > 0 ? (fadeStats.correct / fadeStats.total) * 100 : 0;
    if (fadeAccuracy < 50 && fadeStats.total >= 10) {
      suggestions.push(`FADE accuracy is only ${fadeAccuracy.toFixed(1)}% - increase threshold from 4 to 5+ fake score advantage`);
      calibrationFactors['FADE_THRESHOLD'] = 5;
    } else if (fadeAccuracy >= 55 && fadeStats.total >= 10) {
      suggestions.push(`FADE accuracy is solid at ${fadeAccuracy.toFixed(1)}% - current threshold is working`);
      calibrationFactors['FADE_THRESHOLD'] = 4;
    }

    // Check confidence bucket performance
    const highConfBucket = confidenceStats['80%+'];
    const highConfAccuracy = highConfBucket.total > 0 ? (highConfBucket.correct / highConfBucket.total) * 100 : 0;
    if (highConfAccuracy < 60 && highConfBucket.total >= 10) {
      suggestions.push(`High confidence (80%+) accuracy is ${highConfAccuracy.toFixed(1)}% - tighten confidence thresholds`);
      calibrationFactors['HIGH_CONF_MULTIPLIER'] = 0.9;
    }

    // Identify best and worst performing signals
    if (signalAccuracy.length > 0) {
      const bestSignal = signalAccuracy[0];
      const worstSignal = signalAccuracy[signalAccuracy.length - 1];
      
      if (bestSignal.accuracy >= 60) {
        suggestions.push(`Best signal: ${bestSignal.signal} at ${bestSignal.accuracy}% - consider increasing weight`);
        calibrationFactors[`WEIGHT_${bestSignal.signal}`] = Math.min(bestSignal.currentWeight + 1, 4);
      }
      
      if (worstSignal.accuracy < 45) {
        suggestions.push(`Worst signal: ${worstSignal.signal} at ${worstSignal.accuracy}% - consider decreasing weight`);
        calibrationFactors[`WEIGHT_${worstSignal.signal}`] = Math.max(worstSignal.currentWeight - 1, -3);
      }
    }

    // Check consensus requirement
    const consensusMovements = movements.filter(m => (m.books_consensus || 1) >= 2);
    const consensusCorrect = consensusMovements.filter(m => m.outcome_correct).length;
    const consensusAccuracy = consensusMovements.length > 0 ? (consensusCorrect / consensusMovements.length) * 100 : 0;
    
    const singleBookMovements = movements.filter(m => (m.books_consensus || 1) === 1);
    const singleBookCorrect = singleBookMovements.filter(m => m.outcome_correct).length;
    const singleBookAccuracy = singleBookMovements.length > 0 ? (singleBookCorrect / singleBookMovements.length) * 100 : 0;

    if (consensusAccuracy > singleBookAccuracy + 5 && consensusMovements.length >= 10) {
      suggestions.push(`Multi-book consensus (${consensusAccuracy.toFixed(1)}%) outperforms single-book (${singleBookAccuracy.toFixed(1)}%) - require 2+ books for PICK`);
      calibrationFactors['MIN_BOOKS_CONSENSUS'] = 2;
    }

    const result: CalibrationResult = {
      timestamp: new Date().toISOString(),
      signalAccuracy,
      recommendationAccuracy,
      confidenceBuckets,
      suggestions,
      calibrationFactors
    };

    // Save calibration factors to database
    const factorsToSave = Object.entries(calibrationFactors);
    let savedCount = 0;
    
    for (const [key, value] of factorsToSave) {
      const signalMatch = key.match(/^WEIGHT_(.+)$/);
      const signalName = signalMatch ? signalMatch[1] : null;
      const signalStat = signalName ? signalAccuracy.find(s => s.signal === signalName) : null;
      
      const { error: upsertError } = await supabase
        .from('sharp_signal_calibration')
        .upsert({
          factor_key: key,
          factor_value: value,
          last_accuracy: signalStat?.accuracy || null,
          sample_size: signalStat?.total || 0,
          updated_at: new Date().toISOString()
        }, { onConflict: 'factor_key' });
      
      if (!upsertError) savedCount++;
    }

    console.log(`[RECALIBRATE] Saved ${savedCount}/${factorsToSave.length} calibration factors to database`);
    console.log('[RECALIBRATE] Calibration complete:', JSON.stringify(result, null, 2));

    const summary = {
      totalMovements: movements.length,
      pickAccuracy: pickAccuracy.toFixed(1) + '%',
      fadeAccuracy: fadeAccuracy.toFixed(1) + '%',
      suggestionsCount: suggestions.length,
      savedFactors: savedCount
    };

    // Update history with success
    if (historyId) {
      await supabase
        .from('cron_job_history')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          result: summary
        })
        .eq('id', historyId);
    }

    return new Response(JSON.stringify({
      success: true,
      result,
      summary,
      savedFactors: savedCount
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[RECALIBRATE] Error:', error);
    
    // Update history with error
    if (historyId) {
      await supabase
        .from('cron_job_history')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          error_message: errorMessage
        })
        .eq('id', historyId);
    }
    
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
