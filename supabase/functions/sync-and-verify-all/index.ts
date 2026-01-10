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

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  let jobId: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const source = body.source || 'manual';
    
    console.log(`[sync-and-verify-all] Starting combined sync & verify (source: ${source})`);

    // Log job start
    const { data: jobRecord } = await supabase
      .from('cron_job_history')
      .insert({
        job_name: 'sync-and-verify-all',
        status: 'running',
        started_at: new Date().toISOString(),
        result: { source, phase: 'starting' }
      })
      .select('id')
      .single();
    
    jobId = jobRecord?.id;

    // Phase 1: Sync NBA game stats from ESPN (last 3 days)
    console.log('[sync-and-verify-all] Phase 1: Syncing NBA game stats...');
    
    const syncResponse = await fetch(`${supabaseUrl}/functions/v1/nba-stats-fetcher`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        mode: 'sync',
        daysBack: 3,
        useESPN: true,
        includeParlayPlayers: true
      })
    });

    const syncResult = await syncResponse.json().catch(() => ({ error: 'Failed to parse sync response' }));
    console.log('[sync-and-verify-all] Sync result:', JSON.stringify(syncResult).slice(0, 500));

    // Update job status
    if (jobId) {
      await supabase
        .from('cron_job_history')
        .update({ result: { source, phase: 'sync_complete', syncResult } })
        .eq('id', jobId);
    }

    // Phase 2: Verify all engine outcomes
    console.log('[sync-and-verify-all] Phase 2: Verifying all engine outcomes...');
    
    const verifyResponse = await fetch(`${supabaseUrl}/functions/v1/verify-all-engine-outcomes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({})
    });

    const verifyResult = await verifyResponse.json().catch(() => ({ error: 'Failed to parse verify response' }));
    console.log('[sync-and-verify-all] Verify result:', JSON.stringify(verifyResult).slice(0, 500));

    const duration = Date.now() - startTime;

    // Final job update
    if (jobId) {
      await supabase
        .from('cron_job_history')
        .update({
          status: 'success',
          completed_at: new Date().toISOString(),
          duration_ms: duration,
          result: {
            source,
            sync: {
              success: syncResult.success ?? false,
              gamesProcessed: syncResult.espnGames?.length ?? 0,
              logsUpserted: syncResult.logsUpserted ?? 0,
              errors: syncResult.errors ?? []
            },
            verify: {
              success: verifyResult.success ?? false,
              riskEngine: verifyResult.results?.riskEngine ?? {},
              sharpParlays: verifyResult.results?.sharpParlays ?? {},
              heatParlays: verifyResult.results?.heatParlays ?? {}
            }
          }
        })
        .eq('id', jobId);
    }

    console.log(`[sync-and-verify-all] Completed in ${duration}ms`);

    return new Response(JSON.stringify({
      success: true,
      duration_ms: duration,
      sync: {
        success: syncResult.success ?? false,
        gamesProcessed: syncResult.espnGames?.length ?? 0,
        logsUpserted: syncResult.logsUpserted ?? 0
      },
      verify: {
        success: verifyResult.success ?? false,
        summary: verifyResult.summary ?? {}
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[sync-and-verify-all] Error:', errorMessage);
    
    const duration = Date.now() - startTime;

    // Update job with error
    if (jobId) {
      await supabase
        .from('cron_job_history')
        .update({
          status: 'error',
          completed_at: new Date().toISOString(),
          duration_ms: duration,
          error_message: errorMessage
        })
        .eq('id', jobId);
    }

    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
      duration_ms: duration
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
