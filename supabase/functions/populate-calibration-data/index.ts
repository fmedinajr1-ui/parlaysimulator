import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CalibrationBucket {
  engine_name: string;
  sport: string | null;
  bucket_start: number;
  bucket_end: number;
  predicted_avg: number;
  actual_avg: number;
  sample_count: number;
  confidence_lower: number;
  confidence_upper: number;
}

interface BrierScore {
  engine_name: string;
  sport: string | null;
  bet_type: string | null;
  brier_score: number;
  reliability_score: number;
  resolution_score: number;
  calibration_error: number;
  sample_size: number;
  period_start: string;
  period_end: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    console.log('[Calibration] Starting calibration data population...');
    
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    
    // Step 1: Fetch all verified outcomes from line_movements
    const { data: lineMovements, error: lmError } = await supabase
      .from('line_movements')
      .select('sport, recommendation, outcome_correct, authenticity_confidence')
      .eq('outcome_verified', true)
      .eq('is_primary_record', true)
      .gte('verified_at', thirtyDaysAgo);
    
    if (lmError) throw lmError;
    
    console.log(`[Calibration] Found ${lineMovements?.length || 0} verified line movements`);
    
    // Step 2: Build calibration buckets for sharp_money engine
    const buckets: CalibrationBucket[] = [];
    const bucketRanges = [
      { start: 0, end: 0.2 },
      { start: 0.2, end: 0.4 },
      { start: 0.4, end: 0.5 },
      { start: 0.5, end: 0.6 },
      { start: 0.6, end: 0.7 },
      { start: 0.7, end: 0.8 },
      { start: 0.8, end: 0.9 },
      { start: 0.9, end: 1.0 },
    ];
    
    // Group by sport
    const sports = [...new Set(lineMovements?.map(lm => lm.sport?.split('_').pop()?.toLowerCase() || 'unknown'))];
    
    for (const sport of sports) {
      const sportData = lineMovements?.filter(lm => 
        lm.sport?.toLowerCase().includes(sport)
      ) || [];
      
      for (const range of bucketRanges) {
        const inBucket = sportData.filter(d => 
          d.authenticity_confidence !== null &&
          d.authenticity_confidence >= range.start && 
          d.authenticity_confidence < range.end
        );
        
        if (inBucket.length >= 5) {
          const wins = inBucket.filter(d => d.outcome_correct).length;
          const total = inBucket.length;
          const actualRate = wins / total;
          const predictedAvg = (range.start + range.end) / 2;
          
          // Calculate Wilson confidence interval
          const z = 1.96; // 95% confidence
          const p = actualRate;
          const n = total;
          const denominator = 1 + z * z / n;
          const center = (p + z * z / (2 * n)) / denominator;
          const margin = (z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / denominator;
          
          buckets.push({
            engine_name: 'sharp_money',
            sport,
            bucket_start: range.start,
            bucket_end: range.end,
            predicted_avg: predictedAvg,
            actual_avg: actualRate,
            sample_count: total,
            confidence_lower: Math.max(0, center - margin),
            confidence_upper: Math.min(1, center + margin),
          });
        }
      }
    }
    
    console.log(`[Calibration] Generated ${buckets.length} calibration buckets`);
    
    // Step 3: Calculate Brier scores
    const brierScores: BrierScore[] = [];
    
    // Calculate by sport and recommendation
    const recommendations = ['pick', 'fade', 'caution'];
    
    for (const sport of sports) {
      const sportData = lineMovements?.filter(lm => 
        lm.sport?.toLowerCase().includes(sport) &&
        lm.authenticity_confidence !== null
      ) || [];
      
      if (sportData.length < 10) continue;
      
      for (const rec of recommendations) {
        const recData = sportData.filter(d => d.recommendation === rec);
        
        if (recData.length < 5) continue;
        
        // Calculate Brier score components
        let brierSum = 0;
        let reliabilitySum = 0;
        let resolutionSum = 0;
        
        const baseRate = recData.filter(d => d.outcome_correct).length / recData.length;
        
        for (const item of recData) {
          const predicted = item.authenticity_confidence || 0.5;
          const actual = item.outcome_correct ? 1 : 0;
          
          // Brier score = mean squared error
          brierSum += Math.pow(predicted - actual, 2);
        }
        
        const brierScore = brierSum / recData.length;
        
        // Reliability (calibration) = average squared difference from bucket means
        const bucketGroups: Record<string, { predicted: number[]; actual: number[] }> = {};
        for (const item of recData) {
          const conf = item.authenticity_confidence || 0.5;
          const bucket = Math.floor(conf * 10) / 10;
          const key = bucket.toString();
          
          if (!bucketGroups[key]) {
            bucketGroups[key] = { predicted: [], actual: [] };
          }
          bucketGroups[key].predicted.push(conf);
          bucketGroups[key].actual.push(item.outcome_correct ? 1 : 0);
        }
        
        for (const key of Object.keys(bucketGroups)) {
          const group = bucketGroups[key];
          const predAvg = group.predicted.reduce((a, b) => a + b, 0) / group.predicted.length;
          const actAvg = group.actual.reduce((a, b) => a + b, 0) / group.actual.length;
          reliabilitySum += group.predicted.length * Math.pow(predAvg - actAvg, 2);
        }
        
        const reliability = reliabilitySum / recData.length;
        
        // Resolution = variance of actual outcomes around base rate
        for (const key of Object.keys(bucketGroups)) {
          const group = bucketGroups[key];
          const actAvg = group.actual.reduce((a, b) => a + b, 0) / group.actual.length;
          resolutionSum += group.actual.length * Math.pow(actAvg - baseRate, 2);
        }
        
        const resolution = resolutionSum / recData.length;
        
        brierScores.push({
          engine_name: 'sharp_money',
          sport,
          bet_type: rec,
          brier_score: brierScore,
          reliability_score: reliability,
          resolution_score: resolution,
          calibration_error: reliability, // ECE approximation
          sample_size: recData.length,
          period_start: thirtyDaysAgo,
          period_end: now.toISOString(),
        });
      }
    }
    
    console.log(`[Calibration] Calculated ${brierScores.length} Brier scores`);
    
    // Step 4: Insert/update calibration buckets
    if (buckets.length > 0) {
      const { error: bucketError } = await supabase
        .from('calibration_buckets')
        .upsert(
          buckets.map(b => ({
            engine_name: b.engine_name,
            sport: b.sport,
            bucket_start: b.bucket_start,
            bucket_end: b.bucket_end,
            predicted_avg: b.predicted_avg,
            actual_avg: b.actual_avg,
            sample_count: b.sample_count,
            confidence_lower: b.confidence_lower,
            confidence_upper: b.confidence_upper,
            updated_at: now.toISOString(),
          })),
          { onConflict: 'engine_name,sport,bucket_start,bucket_end' }
        );
      
      if (bucketError) {
        console.error('[Calibration] Bucket insert error:', bucketError);
      }
    }
    
    // Step 5: Insert/update Brier scores
    if (brierScores.length > 0) {
      const { error: brierError } = await supabase
        .from('engine_brier_scores')
        .upsert(
          brierScores.map(b => ({
            engine_name: b.engine_name,
            sport: b.sport,
            bet_type: b.bet_type,
            brier_score: b.brier_score,
            reliability_score: b.reliability_score,
            resolution_score: b.resolution_score,
            calibration_error: b.calibration_error,
            sample_size: b.sample_size,
            period_start: b.period_start,
            period_end: b.period_end,
            updated_at: now.toISOString(),
          })),
          { onConflict: 'engine_name,sport,bet_type,period_start' }
        );
      
      if (brierError) {
        console.error('[Calibration] Brier insert error:', brierError);
      }
    }
    
    // Step 6: Build isotonic calibration mapping
    const isotonicMappings: { engine_name: string; sport: string | null; raw_probability: number; calibrated_probability: number; sample_size: number }[] = [];
    
    for (const sport of sports) {
      const sportData = lineMovements?.filter(lm => 
        lm.sport?.toLowerCase().includes(sport) &&
        lm.authenticity_confidence !== null
      ) || [];
      
      if (sportData.length < 20) continue;
      
      // Sort by confidence
      const sorted = sportData.sort((a, b) => 
        (a.authenticity_confidence || 0) - (b.authenticity_confidence || 0)
      );
      
      // Pool Adjacent Violators Algorithm (PAVA) simplified
      const poolSize = Math.max(5, Math.floor(sorted.length / 10));
      
      for (let i = 0; i < sorted.length; i += poolSize) {
        const pool = sorted.slice(i, Math.min(i + poolSize, sorted.length));
        const rawAvg = pool.reduce((sum, d) => sum + (d.authenticity_confidence || 0.5), 0) / pool.length;
        const actualAvg = pool.filter(d => d.outcome_correct).length / pool.length;
        
        isotonicMappings.push({
          engine_name: 'sharp_money',
          sport,
          raw_probability: rawAvg,
          calibrated_probability: actualAvg,
          sample_size: pool.length,
        });
      }
    }
    
    // Insert isotonic mappings
    if (isotonicMappings.length > 0) {
      const { error: isoError } = await supabase
        .from('isotonic_calibration')
        .upsert(
          isotonicMappings.map(m => ({
            engine_name: m.engine_name,
            sport: m.sport,
            raw_probability: m.raw_probability,
            calibrated_probability: m.calibrated_probability,
            sample_size: m.sample_size,
            updated_at: now.toISOString(),
          })),
          { onConflict: 'engine_name,sport,raw_probability' }
        );
      
      if (isoError) {
        console.error('[Calibration] Isotonic insert error:', isoError);
      }
    }
    
    console.log(`[Calibration] Generated ${isotonicMappings.length} isotonic mappings`);
    
    // Step 7: Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'populate-calibration-data',
      status: 'completed',
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      result: {
        buckets_created: buckets.length,
        brier_scores_created: brierScores.length,
        isotonic_mappings: isotonicMappings.length,
        sports_analyzed: sports.length,
        total_samples: lineMovements?.length || 0,
      }
    });
    
    return new Response(
      JSON.stringify({
        success: true,
        calibration: {
          buckets: buckets.length,
          brierScores: brierScores.length,
          isotonicMappings: isotonicMappings.length,
        },
        sports: sports,
        sampleSize: lineMovements?.length || 0,
        timestamp: now.toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('[Calibration] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
