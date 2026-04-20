// ──────────────────────────────────────────────────────────────────────────────
// TikTok Render Callback
// ──────────────────────────────────────────────────────────────────────────────
// Receives the finished render from the external `worker/` Remotion service.
// Worker uploads the final MP4 to our storage bucket, then POSTs:
//
//   {
//     render_id: string,
//     status: 'completed' | 'failed',
//     final_video_path?: string,    // path inside the tiktok-renders bucket
//     thumbnail_path?: string,
//     error?: string,
//     cost_usd?: number,
//   }
//
// Auth: Bearer token must equal REMOTION_WORKER_SECRET. This is the
// shared-secret mechanism — no user JWT required, since this comes from a
// trusted external worker.
// ──────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STORAGE_BUCKET = 'tiktok-renders';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // ── Shared-secret auth ────────────────────────────────────────────────────
  const expectedSecret = Deno.env.get('REMOTION_WORKER_SECRET');
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!expectedSecret || token !== expectedSecret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { render_id, status, final_video_path, thumbnail_path, error, cost_usd } = body;
    if (!render_id || !status) {
      return new Response(JSON.stringify({ error: 'render_id and status required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    if (status === 'failed') {
      await sb.from('tiktok_video_renders').update({
        status: 'failed', step: 'error', error_message: error || 'worker reported failure',
      }).eq('id', render_id);
      const { data: r } = await sb.from('tiktok_video_renders').select('script_id').eq('id', render_id).maybeSingle();
      if (r?.script_id) {
        await sb.from('tiktok_video_scripts').update({ status: 'approved' }).eq('id', r.script_id);
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Sign URLs for the final video and thumbnail
    let finalUrl: string | null = null;
    let thumbUrl: string | null = null;
    if (final_video_path) {
      const { data, error: e } = await sb.storage.from(STORAGE_BUCKET).createSignedUrl(final_video_path, 60 * 60 * 24 * 7); // 7 days
      if (e) throw e;
      finalUrl = data.signedUrl;
    }
    if (thumbnail_path) {
      const { data } = await sb.storage.from(STORAGE_BUCKET).createSignedUrl(thumbnail_path, 60 * 60 * 24 * 7);
      thumbUrl = data?.signedUrl ?? null;
    }

    const { data: render } = await sb.from('tiktok_video_renders')
      .select('cost_breakdown, script_id')
      .eq('id', render_id).maybeSingle();
    const updatedCosts = { ...(render?.cost_breakdown || {}), worker_usd: cost_usd ?? null };

    await sb.from('tiktok_video_renders').update({
      status: 'completed',
      step: 'done',
      final_video_url: finalUrl,
      thumbnail_url: thumbUrl,
      cost_breakdown: updatedCosts,
      completed_at: new Date().toISOString(),
    }).eq('id', render_id);

    if (render?.script_id) {
      await sb.from('tiktok_video_scripts').update({
        status: 'rendered', rendered_at: new Date().toISOString(),
      }).eq('id', render.script_id);

      // Phase 3: auto-generate the publish-ready caption + hashtags
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/tiktok-caption-generator`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
          body: JSON.stringify({ script_id: render.script_id }),
        });
      } catch (e) {
        console.warn('[render-callback] caption generation failed (non-fatal):', e);
      }
    }

    // Pipeline log
    await sb.from('tiktok_pipeline_logs').insert({
      run_type: 'render',
      status: 'success',
      message: `Render ${render_id} completed`,
      metadata: { render_id, cost_usd },
    });

    // Telegram ping (best-effort)
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({
          message: `🎬 *TikTok render ready*\n\nRender \`${render_id.slice(0, 8)}\` finished.\nCost: $${(cost_usd ?? 0).toFixed(3)}\n\nReview in /admin/tiktok queue.`,
          parse_mode: 'Markdown',
          admin_only: true,
          format_version: 'v3',
          reference_key: `tiktok_render_${render_id}`,
        }),
      });
    } catch (_) { /* never fail callback on alert error */ }

    return new Response(JSON.stringify({ ok: true, final_video_url: finalUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[render-callback] error:', err);
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});