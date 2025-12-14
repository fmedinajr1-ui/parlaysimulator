import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface PredictionData {
  predicted: number;
  actual: 0 | 1;
  engine: string;
  sport: string;
  betType: string;
}

// Calculate Brier Score
function calculateBrierScore(predictions: { predicted: number; actual: 0 | 1 }[]): number {
  if (predictions.length === 0) return 0;
  return predictions.reduce((sum, p) => sum + Math.pow(p.predicted - p.actual, 2), 0) / predictions.length;
}

// Calculate Log Loss
function calculateLogLoss(predictions: { predicted: number; actual: 0 | 1 }[]): number {
  if (predictions.length === 0) return 0;
  const epsilon = 1e-15;
  return predictions.reduce((sum, p) => {
    const clampedPred = Math.max(epsilon, Math.min(1 - epsilon, p.predicted));
    return sum - (p.actual * Math.log(clampedPred) + (1 - p.actual) * Math.log(1 - clampedPred));
  }, 0) / predictions.length;
}

// Calculate calibration buckets
function createCalibrationBuckets(predictions: { predicted: number; actual: 0 | 1 }[], numBuckets = 10) {
  const bucketSize = 1 / numBuckets;
  const buckets = [];
  
  for (let i = 0; i < numBuckets; i++) {
    const bucketStart = i * bucketSize;
    const bucketEnd = (i + 1) * bucketSize;
    const bucketPreds = predictions.filter(p => p.predicted >= bucketStart && p.predicted < bucketEnd);
    
    if (bucketPreds.length > 0) {
      const predictedAvg = bucketPreds.reduce((sum, p) => sum + p.predicted, 0) / bucketPreds.length;
      const actualAvg = bucketPreds.reduce((sum, p) => sum + p.actual, 0) / bucketPreds.length;
      
      // Wilson confidence interval
      const n = bucketPreds.length;
      const z = 1.96;
      const phat = actualAvg;
      const denominator = 1 + z * z / n;
      const center = (phat + z * z / (2 * n)) / denominator;
      const margin = (z * Math.sqrt((phat * (1 - phat) + z * z / (4 * n)) / n)) / denominator;
      
      buckets.push({
        bucketStart,
        bucketEnd,
        predictedAvg,
        actualAvg,
        count: bucketPreds.length,
        confidenceLower: Math.max(0, center - margin),
        confidenceUpper: Math.min(1, center + margin),
      });
    }
  }
  
  return buckets;
}

// Isotonic regression using Pool Adjacent Violators Algorithm
function isotonicRegression(predictions: { predicted: number; actual: 0 | 1 }[]) {
  if (predictions.length === 0) return [];
  
  const sorted = [...predictions].sort((a, b) => a.predicted - b.predicted);
  
  interface Block {
    predicted: number[];
    value: number;
    weight: number;
  }
  
  let blocks: Block[] = sorted.map(p => ({
    predicted: [p.predicted],
    value: p.actual,
    weight: 1,
  }));
  
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < blocks.length - 1; i++) {
      if (blocks[i].value > blocks[i + 1].value) {
        const totalWeight = blocks[i].weight + blocks[i + 1].weight;
        const mergedValue = (blocks[i].value * blocks[i].weight + blocks[i + 1].value * blocks[i + 1].weight) / totalWeight;
        
        blocks[i] = {
          predicted: [...blocks[i].predicted, ...blocks[i + 1].predicted],
          value: mergedValue,
          weight: totalWeight,
        };
        blocks.splice(i + 1, 1);
        changed = true;
        break;
      }
    }
  }
  
  return blocks.map(block => ({
    rawProbability: block.predicted.reduce((a, b) => a + b, 0) / block.predicted.length,
    calibratedProbability: block.value,
    sampleSize: block.predicted.length,
  }));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log('=== Starting Brier score calculation ===');
    const periodEnd = new Date();
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - 30); // Last 30 days

    // Collect predictions from various engines
    const allPredictions: PredictionData[] = [];

    // 1. Juiced Props predictions
    const { data: juicedProps } = await supabase
      .from('juiced_props')
      .select('*')
      .not('outcome', 'is', null)
      .neq('outcome', 'pending')
      .gte('created_at', periodStart.toISOString());

    if (juicedProps) {
      for (const prop of juicedProps) {
        const predicted = prop.unified_confidence || (prop.juice_amount > 15 ? 0.6 : 0.55);
        allPredictions.push({
          predicted,
          actual: prop.outcome === 'won' ? 1 : 0,
          engine: 'juiced_props',
          sport: prop.sport,
          betType: prop.prop_type || 'prop',
        });
      }
    }

    // 2. Hit Rate Parlays
    const { data: hitrateParlays } = await supabase
      .from('hitrate_parlays')
      .select('*')
      .not('outcome', 'is', null)
      .neq('outcome', 'pending')
      .gte('created_at', periodStart.toISOString());

    if (hitrateParlays) {
      for (const parlay of hitrateParlays) {
        allPredictions.push({
          predicted: parlay.combined_probability,
          actual: parlay.outcome === 'won' ? 1 : 0,
          engine: 'hitrate_parlays',
          sport: parlay.sport || 'multi',
          betType: parlay.strategy_type,
        });
      }
    }

    // 3. God Mode Upset Predictions
    const { data: upsetPreds } = await supabase
      .from('god_mode_upset_predictions')
      .select('*')
      .eq('game_completed', true)
      .not('was_upset', 'is', null)
      .gte('created_at', periodStart.toISOString());

    if (upsetPreds) {
      for (const pred of upsetPreds) {
        allPredictions.push({
          predicted: pred.upset_probability,
          actual: pred.was_upset ? 1 : 0,
          engine: 'god_mode_upsets',
          sport: pred.sport,
          betType: 'moneyline',
        });
      }
    }

    // 4. Sharp Money (Line Movements)
    const { data: sharpMoves } = await supabase
      .from('line_movements')
      .select('*')
      .eq('outcome_verified', true)
      .not('outcome_correct', 'is', null)
      .gte('created_at', periodStart.toISOString());

    if (sharpMoves) {
      for (const move of sharpMoves) {
        const predicted = move.sharp_probability || move.authenticity_confidence || 0.55;
        allPredictions.push({
          predicted,
          actual: move.outcome_correct ? 1 : 0,
          engine: 'sharp_money',
          sport: move.sport,
          betType: move.market_type,
        });
      }
    }

    // 5. AI Generated Parlays
    const { data: aiParlays } = await supabase
      .from('ai_generated_parlays')
      .select('*')
      .neq('outcome', 'pending')
      .gte('created_at', periodStart.toISOString());

    if (aiParlays) {
      for (const parlay of aiParlays) {
        allPredictions.push({
          predicted: parlay.confidence_score,
          actual: parlay.outcome === 'won' ? 1 : 0,
          engine: 'ai_parlay_generator',
          sport: parlay.sport || 'multi',
          betType: parlay.strategy_used,
        });
      }
    }

    console.log(`Collected ${allPredictions.length} predictions for scoring`);

    // Group by engine and calculate scores
    const engineGroups = new Map<string, PredictionData[]>();
    for (const pred of allPredictions) {
      const key = pred.engine;
      if (!engineGroups.has(key)) {
        engineGroups.set(key, []);
      }
      engineGroups.get(key)!.push(pred);
    }

    // Calculate and store Brier scores for each engine
    const results = [];
    for (const [engine, preds] of engineGroups) {
      if (preds.length < 5) continue; // Minimum sample size

      const brierScore = calculateBrierScore(preds);
      const logLoss = calculateLogLoss(preds);
      
      // Calculate reliability and resolution
      const baseRate = preds.reduce((sum, p) => sum + p.actual, 0) / preds.length;
      const buckets = createCalibrationBuckets(preds, 10);
      
      let reliability = 0;
      let resolution = 0;
      for (const bucket of buckets) {
        const weight = bucket.count / preds.length;
        reliability += weight * Math.pow(bucket.predictedAvg - bucket.actualAvg, 2);
        resolution += weight * Math.pow(bucket.actualAvg - baseRate, 2);
      }
      
      const calibrationError = Math.sqrt(reliability);

      // Upsert engine Brier score
      const { error: brierError } = await supabase
        .from('engine_brier_scores')
        .upsert({
          engine_name: engine,
          sport: null, // Overall for engine
          bet_type: null,
          brier_score: brierScore,
          log_loss: logLoss,
          sample_size: preds.length,
          calibration_error: calibrationError,
          reliability_score: reliability,
          resolution_score: resolution,
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'engine_name,sport,bet_type,period_start,period_end',
        });

      if (brierError) {
        console.error(`Error upserting Brier score for ${engine}:`, brierError);
      }

      // Store calibration buckets
      for (const bucket of buckets) {
        await supabase
          .from('calibration_buckets')
          .upsert({
            engine_name: engine,
            sport: null,
            bucket_start: bucket.bucketStart,
            bucket_end: bucket.bucketEnd,
            predicted_avg: bucket.predictedAvg,
            actual_avg: bucket.actualAvg,
            sample_count: bucket.count,
            confidence_lower: bucket.confidenceLower,
            confidence_upper: bucket.confidenceUpper,
            updated_at: new Date().toISOString(),
          });
      }

      // Calculate and store isotonic calibration mapping
      const isotonicMapping = isotonicRegression(preds);
      for (const point of isotonicMapping) {
        await supabase
          .from('isotonic_calibration')
          .upsert({
            engine_name: engine,
            sport: null,
            bet_type: null,
            raw_probability: point.rawProbability,
            calibrated_probability: point.calibratedProbability,
            sample_size: point.sampleSize,
            updated_at: new Date().toISOString(),
          });
      }

      results.push({
        engine,
        brierScore,
        logLoss,
        calibrationError,
        sampleSize: preds.length,
        bucketsCreated: buckets.length,
        isotonicPoints: isotonicMapping.length,
      });

      console.log(`${engine}: Brier=${brierScore.toFixed(4)}, LogLoss=${logLoss.toFixed(4)}, n=${preds.length}`);
    }

    // Also calculate per-sport scores for larger engines
    for (const [engine, preds] of engineGroups) {
      const sportGroups = new Map<string, PredictionData[]>();
      for (const pred of preds) {
        if (!sportGroups.has(pred.sport)) {
          sportGroups.set(pred.sport, []);
        }
        sportGroups.get(pred.sport)!.push(pred);
      }

      for (const [sport, sportPreds] of sportGroups) {
        if (sportPreds.length < 10) continue;

        const brierScore = calculateBrierScore(sportPreds);
        const logLoss = calculateLogLoss(sportPreds);
        const buckets = createCalibrationBuckets(sportPreds, 10);
        
        let reliability = 0;
        for (const bucket of buckets) {
          const weight = bucket.count / sportPreds.length;
          reliability += weight * Math.pow(bucket.predictedAvg - bucket.actualAvg, 2);
        }

        await supabase
          .from('engine_brier_scores')
          .upsert({
            engine_name: engine,
            sport: sport,
            bet_type: null,
            brier_score: brierScore,
            log_loss: logLoss,
            sample_size: sportPreds.length,
            calibration_error: Math.sqrt(reliability),
            reliability_score: reliability,
            resolution_score: 0,
            period_start: periodStart.toISOString(),
            period_end: periodEnd.toISOString(),
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'engine_name,sport,bet_type,period_start,period_end',
          });
      }
    }

    console.log('=== Brier score calculation complete ===');

    return new Response(
      JSON.stringify({
        success: true,
        totalPredictions: allPredictions.length,
        enginesScored: results.length,
        results,
        period: {
          start: periodStart.toISOString(),
          end: periodEnd.toISOString(),
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in calculate-brier-scores:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
