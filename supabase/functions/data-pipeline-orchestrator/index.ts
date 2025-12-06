import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const results: Record<string, { success: boolean; message: string; duration?: number }> = {};
  
  const runFunction = async (name: string, body: Record<string, unknown> = {}) => {
    const start = Date.now();
    try {
      console.log(`[Pipeline] Starting ${name}...`);
      
      const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const duration = Date.now() - start;
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Pipeline] ${name} failed:`, errorText);
        results[name] = { success: false, message: errorText, duration };
        return false;
      }

      const data = await response.json();
      console.log(`[Pipeline] ${name} completed in ${duration}ms:`, data);
      results[name] = { success: true, message: JSON.stringify(data).slice(0, 200), duration };
      return true;
    } catch (err) {
      const duration = Date.now() - start;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[Pipeline] ${name} error:`, errorMessage);
      results[name] = { success: false, message: errorMessage, duration };
      return false;
    }
  };

  try {
    const { mode = 'full' } = await req.json().catch(() => ({}));
    
    console.log(`[Pipeline] Starting AI-driven unified pipeline in ${mode} mode...`);
    const pipelineStart = Date.now();

    // ============ PHASE 1: DATA COLLECTION ============
    if (mode === 'full' || mode === 'collect') {
      // Step 1a: Run unified props engine (fetches ALL props, analyzes through ALL signals)
      await runFunction('unified-props-engine', { sports: ['basketball_nba', 'hockey_nhl'] });
      
      // Step 1b: Scan for juiced props (morning scanner for additional juice detection)
      await runFunction('morning-props-scanner', { sports: ['basketball_nba', 'hockey_nhl', 'americanfootball_nfl'] });
      
      // Step 1c: Calculate NBA fatigue scores
      await runFunction('nba-fatigue-engine', {});
      
      // Step 1d: Track odds movements for sharp money detection
      await runFunction('track-odds-movement', { sports: ['basketball_nba', 'hockey_nhl'] });
    }

    // ============ PHASE 2: ANALYSIS & CATEGORIZATION ============
    if (mode === 'full' || mode === 'analyze') {
      // Step 2a: Analyze player prop hit rates
      await runFunction('analyze-hitrate-props', { limit: 100 });
      
      // Step 2b: Predict upsets using unified data + calibrated signals
      await runFunction('predict-upsets', {});
      
      // Step 2c: Analyze sharp line movements
      await runFunction('analyze-sharp-line', {});
    }

    // ============ PHASE 3: PARLAY & SUGGESTION GENERATION ============
    if (mode === 'full' || mode === 'generate') {
      // Step 3a: Build high hit-rate parlays from unified data
      await runFunction('build-hitrate-parlays', { runSharpAnalysis: true });
      
      // Step 3b: Generate AI-driven suggestions with all signals
      await runFunction('generate-suggestions', { sports: ['basketball_nba', 'hockey_nhl'] });
    }

    // ============ PHASE 4: OUTCOME VERIFICATION ============
    if (mode === 'full' || mode === 'verify') {
      // Step 4a: Verify unified props outcomes
      await runFunction('verify-unified-outcomes', {});
      
      // Step 4b: Verify sharp money outcomes
      await runFunction('verify-sharp-outcomes', {});
      
      // Step 4c: Verify hit rate parlay outcomes
      await runFunction('verify-hitrate-outcomes', {});
      
      // Step 4d: Verify upset prediction outcomes
      await runFunction('verify-upset-outcomes', {});
      
      // Step 4e: Auto-settle user parlays
      await runFunction('auto-settle-parlays', {});
      
      // Step 4f: Verify fatigue edge outcomes
      await runFunction('verify-fatigue-outcomes', {});
    }

    // ============ PHASE 5: CALIBRATION & LEARNING ============
    if (mode === 'full' || mode === 'calibrate') {
      // Step 5a: Calculate/update calibration factors from all verified outcomes
      await runFunction('calculate-calibration', {});
      
      // Step 5b: Recalibrate sharp signals based on accuracy
      await runFunction('recalibrate-sharp-signals', {});
      
      // Step 5c: Run AI learning engine to update weights
      await runFunction('ai-learning-engine', {});
    }

    const totalDuration = Date.now() - pipelineStart;
    
    // Calculate pipeline metrics
    const totalSteps = Object.keys(results).length;
    const successfulSteps = Object.values(results).filter(r => r.success).length;
    const failedSteps = Object.values(results).filter(r => !r.success).length;
    
    // Log pipeline run to database for tracking
    await supabase.from('ai_performance_metrics').upsert({
      sport: 'pipeline',
      bet_type: 'unified_orchestrator',
      confidence_level: mode,
      total_predictions: totalSteps,
      correct_predictions: successfulSteps,
      accuracy_rate: totalSteps > 0 ? (successfulSteps / totalSteps) * 100 : 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'sport,bet_type,confidence_level' });

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'data-pipeline-orchestrator',
      status: failedSteps === 0 ? 'completed' : 'partial',
      started_at: new Date(pipelineStart).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: totalDuration,
      result: {
        mode,
        totalSteps,
        successfulSteps,
        failedSteps,
        phases: {
          collect: mode === 'full' || mode === 'collect',
          analyze: mode === 'full' || mode === 'analyze',
          generate: mode === 'full' || mode === 'generate',
          verify: mode === 'full' || mode === 'verify',
          calibrate: mode === 'full' || mode === 'calibrate'
        }
      }
    });

    const summary = {
      mode,
      totalDuration,
      totalSteps,
      successfulSteps,
      failedSteps,
      pipelineHealth: failedSteps === 0 ? 'healthy' : failedSteps <= 2 ? 'degraded' : 'unhealthy',
      results,
    };

    console.log('[Pipeline] Complete:', summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Pipeline] Fatal error:', errorMessage);
    
    await supabase.from('cron_job_history').insert({
      job_name: 'data-pipeline-orchestrator',
      status: 'failed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
      result: { results }
    });
    
    return new Response(JSON.stringify({ 
      error: errorMessage,
      results 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
