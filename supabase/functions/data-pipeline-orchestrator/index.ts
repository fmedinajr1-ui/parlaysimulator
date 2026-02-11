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
    
    console.log(`[Pipeline] Starting unified pipeline in ${mode} mode...`);
    const pipelineStart = Date.now();

    // ============ PHASE 1: DATA COLLECTION ============
    if (mode === 'full' || mode === 'collect') {
      await runFunction('whale-odds-scraper', { sports: ['basketball_nba', 'icehockey_nhl', 'basketball_wnba', 'basketball_ncaab'] });
      await runFunction('daily-fatigue-calculator', {});
      await runFunction('track-odds-movement', { sports: ['basketball_nba', 'icehockey_nhl', 'basketball_wnba', 'basketball_ncaab'] });
      await runFunction('pp-props-scraper', { sports: ['NBA', 'NHL', 'WNBA', 'ATP', 'WTA'] });
      await runFunction('firecrawl-lineup-scraper', {});
    }

    // ============ PHASE 2: ANALYSIS ============
    if (mode === 'full' || mode === 'analyze') {
      await runFunction('category-props-analyzer', { limit: 100 });
      await runFunction('auto-refresh-sharp-tracker', {});
      await runFunction('whale-signal-detector', { sports: ['basketball_nba', 'icehockey_nhl', 'basketball_wnba', 'basketball_ncaab'] });
    }

    // ============ PHASE 3: PARLAY GENERATION ============
    if (mode === 'full' || mode === 'generate') {
      await runFunction('bot-generate-daily-parlays', { source: 'pipeline' });
    }

    // ============ PHASE 4: OUTCOME VERIFICATION & SETTLEMENT ============
    if (mode === 'full' || mode === 'verify') {
      await runFunction('verify-all-engine-outcomes', {});
      await runFunction('verify-sharp-outcomes', {});
      await runFunction('verify-juiced-outcomes', {});
      await runFunction('verify-fatigue-outcomes', {});
      await runFunction('verify-sweet-spot-outcomes', {});
      await runFunction('verify-best-bets-outcomes', {});
      // Settlement: user parlays + bot parlays (P&L calendar)
      await runFunction('auto-settle-parlays', {});
      await runFunction('bot-settle-and-learn', {});
    }

    // ============ PHASE 5: CALIBRATION & LEARNING ============
    if (mode === 'full' || mode === 'calibrate') {
      await runFunction('calculate-calibration', {});
      await runFunction('recalibrate-sharp-signals', {});
      await runFunction('calibrate-bot-weights', {});
    }

    const totalDuration = Date.now() - pipelineStart;
    
    const totalSteps = Object.keys(results).length;
    const successfulSteps = Object.values(results).filter(r => r.success).length;
    const failedSteps = Object.values(results).filter(r => !r.success).length;
    
    await supabase.from('ai_performance_metrics').upsert({
      sport: 'pipeline',
      bet_type: 'unified_orchestrator',
      confidence_level: mode,
      total_predictions: totalSteps,
      correct_predictions: successfulSteps,
      accuracy_rate: totalSteps > 0 ? (successfulSteps / totalSteps) * 100 : 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'sport,bet_type,confidence_level' });

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
