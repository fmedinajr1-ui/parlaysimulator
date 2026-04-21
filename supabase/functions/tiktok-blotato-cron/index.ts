// Phase 6 — Auto-posting cron worker.
// Runs every minute (via pg_cron). Picks up pending queue rows whose
// scheduled_for is now/past and dispatches them via tiktok-blotato-post.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  const startedAt = Date.now();

  try {
    const { data: due, error } = await sb
      .from('tiktok_post_queue')
      .select('id')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .order('scheduled_for', { ascending: true })
      .limit(10);
    if (error) throw error;

    let dispatched = 0;
    for (const row of due || []) {
      // Fire-and-forget — the post function manages its own state
      fetch(`${SUPABASE_URL}/functions/v1/tiktok-blotato-post`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_ROLE}`,
        },
        body: JSON.stringify({ queue_id: row.id }),
      }).catch((e) => console.error('[cron] dispatch failed', row.id, e));
      dispatched += 1;
    }

    if (dispatched > 0) {
      await sb.from('tiktok_pipeline_logs').insert({
        run_type: 'blotato_cron',
        status: 'success',
        message: `Dispatched ${dispatched} queued posts`,
        duration_ms: Date.now() - startedAt,
        metadata: { dispatched },
      });
    }

    return new Response(JSON.stringify({ ok: true, dispatched }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});