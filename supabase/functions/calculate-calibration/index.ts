import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log('=== Starting calibration calculation ===');
    
    // Step 1: Calculate calibration factors from historical data
    console.log('Calculating calibration factors...');
    const { error: calibError } = await supabase.rpc('calculate_calibration_factors');
    
    if (calibError) {
      console.error('Calibration error:', calibError);
      throw calibError;
    }
    
    // Step 2: Update strategy performance metrics
    console.log('Updating strategy performance...');
    const { error: stratError } = await supabase.rpc('update_strategy_performance');
    
    if (stratError) {
      console.error('Strategy performance error:', stratError);
      throw stratError;
    }
    
    // Step 3: Fetch results for reporting
    const { data: calibrationFactors, error: fetchCalibError } = await supabase
      .from('ai_calibration_factors')
      .select('*')
      .order('sample_size', { ascending: false });
    
    const { data: strategyPerformance, error: fetchStratError } = await supabase
      .from('strategy_performance')
      .select('*')
      .order('total_suggestions', { ascending: false });
    
    // Calculate summary statistics
    const totalCalibrationSamples = calibrationFactors?.reduce((sum, f) => sum + f.sample_size, 0) || 0;
    const avgCalibrationFactor = calibrationFactors?.length 
      ? calibrationFactors.reduce((sum, f) => sum + f.calibration_factor, 0) / calibrationFactors.length
      : 1.0;
    
    const bestStrategy = strategyPerformance?.find(s => s.win_rate > 0) || null;
    const worstStrategy = strategyPerformance?.filter(s => s.win_rate > 0).pop() || null;
    
    // Step 4: Log insights
    console.log('\n=== Calibration Results ===');
    console.log(`Total calibration samples: ${totalCalibrationSamples}`);
    console.log(`Average calibration factor: ${avgCalibrationFactor.toFixed(3)}`);
    console.log(`Calibration buckets: ${calibrationFactors?.length || 0}`);
    
    if (calibrationFactors?.length) {
      console.log('\nTop calibration factors:');
      for (const factor of calibrationFactors.slice(0, 5)) {
        const calibStatus = factor.calibration_factor > 1.1 ? 'UNDERCONFIDENT' 
          : factor.calibration_factor < 0.9 ? 'OVERCONFIDENT' 
          : 'WELL_CALIBRATED';
        console.log(`  ${factor.sport}/${factor.bet_type}/${factor.odds_bucket}: ${factor.calibration_factor.toFixed(2)} (${calibStatus}, n=${factor.sample_size})`);
      }
    }
    
    console.log('\n=== Strategy Performance ===');
    if (strategyPerformance?.length) {
      for (const strat of strategyPerformance) {
        console.log(`  ${strat.strategy_name}: ${strat.win_rate}% win rate (${strat.total_won}/${strat.total_suggestions}), ROI: ${strat.roi_percentage}%`);
      }
    }
    
    // Step 5: Identify overconfident and underconfident areas
    const overconfidentAreas = calibrationFactors?.filter(f => f.calibration_factor < 0.85 && f.sample_size >= 5) || [];
    const underconfidentAreas = calibrationFactors?.filter(f => f.calibration_factor > 1.15 && f.sample_size >= 5) || [];
    
    const insights = {
      overconfident: overconfidentAreas.map(f => ({
        area: `${f.sport}/${f.bet_type}/${f.odds_bucket}`,
        predictedProb: f.predicted_probability,
        actualWinRate: f.actual_win_rate,
        adjustment: `Reduce confidence by ${((1 - f.calibration_factor) * 100).toFixed(0)}%`,
      })),
      underconfident: underconfidentAreas.map(f => ({
        area: `${f.sport}/${f.bet_type}/${f.odds_bucket}`,
        predictedProb: f.predicted_probability,
        actualWinRate: f.actual_win_rate,
        adjustment: `Increase confidence by ${((f.calibration_factor - 1) * 100).toFixed(0)}%`,
      })),
    };
    
    console.log('\n=== Calibration complete ===');
    
    return new Response(
      JSON.stringify({
        success: true,
        calibration: {
          factorCount: calibrationFactors?.length || 0,
          totalSamples: totalCalibrationSamples,
          avgFactor: avgCalibrationFactor,
          factors: calibrationFactors?.slice(0, 10) || [],
        },
        strategy: {
          strategies: strategyPerformance || [],
          bestStrategy: bestStrategy?.strategy_name,
          bestWinRate: bestStrategy?.win_rate,
        },
        insights,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in calculate-calibration:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
