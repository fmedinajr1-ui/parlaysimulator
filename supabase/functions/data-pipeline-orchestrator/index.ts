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
    
    console.log(`[Pipeline] Starting data pipeline in ${mode} mode...`);
    const pipelineStart = Date.now();

    // Step 1: Scan for juiced props (morning scanner)
    if (mode === 'full' || mode === 'props') {
      await runFunction('morning-props-scanner', { sports: ['basketball_nba', 'hockey_nhl', 'americanfootball_nfl'] });
    }

    // Step 2: Analyze player prop hit rates
    if (mode === 'full' || mode === 'hitrates') {
      await runFunction('analyze-hitrate-props', { limit: 100 });
    }

    // Step 3: Build high hit-rate parlays
    if (mode === 'full' || mode === 'parlays') {
      await runFunction('build-hitrate-parlays', {});
    }

    // Step 4: Verify sharp money outcomes (for completed games)
    if (mode === 'full' || mode === 'verify') {
      await runFunction('verify-sharp-outcomes', {});
    }

    // Step 5: Calculate/update calibration factors
    if (mode === 'full' || mode === 'calibration') {
      await runFunction('calculate-calibration', {});
    }

    // Step 6: Generate fresh suggestions with calibrated probabilities
    if (mode === 'full' || mode === 'suggestions') {
      await runFunction('generate-suggestions', { sports: ['basketball_nba', 'hockey_nhl'] });
    }

    const totalDuration = Date.now() - pipelineStart;
    
    // Log pipeline run to database for tracking
    await supabase.from('ai_performance_metrics').upsert({
      sport: 'pipeline',
      bet_type: 'orchestrator',
      confidence_level: mode,
      total_predictions: Object.keys(results).length,
      correct_predictions: Object.values(results).filter(r => r.success).length,
      accuracy_rate: Object.values(results).filter(r => r.success).length / Object.keys(results).length,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'sport,bet_type,confidence_level' });

    const summary = {
      mode,
      totalDuration,
      totalSteps: Object.keys(results).length,
      successfulSteps: Object.values(results).filter(r => r.success).length,
      failedSteps: Object.values(results).filter(r => !r.success).length,
      results,
    };

    console.log('[Pipeline] Complete:', summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Pipeline] Fatal error:', errorMessage);
    return new Response(JSON.stringify({ 
      error: errorMessage,
      results 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
