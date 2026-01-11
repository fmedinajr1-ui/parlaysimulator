import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CascadeStep {
  name: string;
  body: Record<string, unknown>;
}

interface StepResult {
  name: string;
  success: boolean;
  duration_ms: number;
  result?: unknown;
  error?: string;
}

const CASCADE_STEPS: CascadeStep[] = [
  { name: 'refresh-todays-props', body: { sport: 'basketball_nba', force_clear: true } },
  { name: 'nba-player-prop-risk-engine', body: { action: 'analyze_slate', use_live_odds: true } },
  { name: 'prop-engine-v2', body: { action: 'analyze' } },
  { name: 'sharp-parlay-builder', body: { action: 'build' } },
  { name: 'heat-prop-engine', body: { action: 'build' } },
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  let requestBody: { scheduled?: boolean; trigger?: string } = {};
  try {
    requestBody = await req.json();
  } catch {
    // Empty body is fine
  }

  const trigger = requestBody.trigger || 'manual';
  const jobName = `engine-cascade-runner`;

  console.log(`[Engine Cascade] Starting cascade run - trigger: ${trigger}`);

  // Log job start
  const { data: jobRecord, error: jobStartError } = await supabase
    .from('cron_job_history')
    .insert({
      job_name: jobName,
      status: 'running',
      started_at: new Date().toISOString(),
      result: { trigger, steps_total: CASCADE_STEPS.length }
    })
    .select()
    .single();

  if (jobStartError) {
    console.error('[Engine Cascade] Failed to log job start:', jobStartError);
  }

  const results: StepResult[] = [];
  let successCount = 0;
  let failCount = 0;

  // Execute each step sequentially
  for (const step of CASCADE_STEPS) {
    const stepStart = Date.now();
    console.log(`[Engine Cascade] Starting step: ${step.name}`);

    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/${step.name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify(step.body),
      });

      const stepDuration = Date.now() - stepStart;

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Engine Cascade] Step ${step.name} failed with status ${response.status}: ${errorText}`);
        
        results.push({
          name: step.name,
          success: false,
          duration_ms: stepDuration,
          error: `HTTP ${response.status}: ${errorText.substring(0, 200)}`,
        });
        failCount++;
      } else {
        let resultData;
        try {
          resultData = await response.json();
        } catch {
          resultData = { status: 'completed' };
        }

        console.log(`[Engine Cascade] Step ${step.name} completed in ${stepDuration}ms`);
        
        results.push({
          name: step.name,
          success: true,
          duration_ms: stepDuration,
          result: resultData,
        });
        successCount++;
      }
    } catch (error) {
      const stepDuration = Date.now() - stepStart;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      console.error(`[Engine Cascade] Step ${step.name} threw error:`, errorMessage);
      
      results.push({
        name: step.name,
        success: false,
        duration_ms: stepDuration,
        error: errorMessage,
      });
      failCount++;
    }

    // Small delay between steps to prevent overwhelming the system
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const totalDuration = Date.now() - startTime;
  const overallStatus = failCount === 0 ? 'completed' : (successCount > 0 ? 'partial' : 'failed');

  console.log(`[Engine Cascade] Cascade complete - ${successCount}/${CASCADE_STEPS.length} steps succeeded in ${totalDuration}ms`);

  // Update job record with results
  if (jobRecord?.id) {
    await supabase
      .from('cron_job_history')
      .update({
        status: overallStatus,
        completed_at: new Date().toISOString(),
        duration_ms: totalDuration,
        result: {
          trigger,
          steps_total: CASCADE_STEPS.length,
          steps_succeeded: successCount,
          steps_failed: failCount,
          step_results: results,
        },
        error_message: failCount > 0 
          ? `${failCount} step(s) failed: ${results.filter(r => !r.success).map(r => r.name).join(', ')}`
          : null,
      })
      .eq('id', jobRecord.id);
  }

  const response = {
    success: failCount === 0,
    status: overallStatus,
    trigger,
    duration_ms: totalDuration,
    summary: {
      total: CASCADE_STEPS.length,
      succeeded: successCount,
      failed: failCount,
    },
    steps: results,
  };

  return new Response(JSON.stringify(response), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: failCount === CASCADE_STEPS.length ? 500 : 200,
  });
});
