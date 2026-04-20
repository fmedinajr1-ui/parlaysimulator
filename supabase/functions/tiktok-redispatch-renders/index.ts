// ──────────────────────────────────────────────────────────────────────────────
// TikTok Re-dispatch Renders (Phase 5)
// ──────────────────────────────────────────────────────────────────────────────
// Once REMOTION_WORKER_URL is configured, this picks up every render parked
// in `step = awaiting_worker` (assets generated, just no worker available at
// the time) and re-runs the orchestrator on each one. The orchestrator is
// idempotent — it will detect existing audio/avatar/b-roll and only do the
// final POST to the worker.
//
// Body: { dry_run?: boolean, limit?: number }
// Returns: { dispatched: number, render_ids: string[], skipped: number }
// ──────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const workerUrl = Deno.env.get('REMOTION_WORKER_URL');
  if (!workerUrl) {
    return new Response(
      JSON.stringify({ error: 'REMOTION_WORKER_URL not configured. Deploy the worker first (see worker/DEPLOY.md).' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = !!body.dry_run;
    const limit = Math.min(20, Math.max(1, Number(body.limit) || 10));

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Find renders parked at awaiting_worker OR failed-with-no-worker
    const { data: queued, error } = await sb
      .from('tiktok_video_renders')
      .select('id, script_id, step, status, created_at')
      .or('step.eq.awaiting_worker,and(status.eq.failed,error_message.ilike.%REMOTION_WORKER_URL%)')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) throw error;
    if (!queued || queued.length === 0) {
      return new Response(JSON.stringify({ dispatched: 0, render_ids: [], skipped: 0, message: 'No renders waiting on worker.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (dryRun) {
      return new Response(JSON.stringify({
        dispatched: 0, render_ids: queued.map((r: any) => r.id), skipped: 0,
        dry_run: true, would_dispatch: queued.length,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Re-invoke orchestrator for each script — fire-and-forget so we return fast
    const dispatched: string[] = [];
    let skipped = 0;
    for (const r of queued) {
      if (!r.script_id) { skipped++; continue; }
      try {
        // Don't await individual responses — orchestrator is slow (1-3 min)
        fetch(`${SUPABASE_URL}/functions/v1/tiktok-render-orchestrator`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
          body: JSON.stringify({ script_id: r.script_id, resume_render_id: r.id }),
        }).catch((e) => console.warn(`[redispatch] orchestrator invoke failed for ${r.id}:`, e));
        dispatched.push(r.id);
      } catch (e) {
        console.error(`[redispatch] failed to dispatch ${r.id}:`, e);
        skipped++;
      }
    }

    await sb.from('tiktok_pipeline_logs').insert({
      run_type: 'render',
      status: 'success',
      message: `Re-dispatched ${dispatched.length} awaiting_worker renders`,
      metadata: { dispatched_ids: dispatched, skipped },
    });

    return new Response(JSON.stringify({ dispatched: dispatched.length, render_ids: dispatched, skipped }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('[tiktok-redispatch-renders] error:', err);
    return new Response(JSON.stringify({ error: String(err?.message || err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
