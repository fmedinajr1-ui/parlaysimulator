// Phase 6 — Auto-posting: Push a single queued post to Blotato API.
// Can be called directly (for "Post now" button) or by the cron worker.
// Body: { queue_id: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BLOTATO_API_KEY = Deno.env.get('BLOTATO_API_KEY');
const BLOTATO_BASE = 'https://backend.blotato.com/v2';

async function blotatoPost(payload: any): Promise<{ id: string; raw: any }> {
  const r = await fetch(`${BLOTATO_BASE}/posts`, {
    method: 'POST',
    headers: {
      'blotato-api-key': BLOTATO_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let raw: any;
  try { raw = JSON.parse(text); } catch { raw = { text }; }
  if (!r.ok) throw new Error(`Blotato ${r.status}: ${text.slice(0, 500)}`);
  return { id: raw?.id || raw?.post?.id || 'unknown', raw };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (!BLOTATO_API_KEY) {
    return new Response(JSON.stringify({ error: 'BLOTATO_API_KEY not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const { queue_id } = await req.json();
    if (!queue_id) throw new Error('queue_id required');

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: q, error: qErr } = await sb
      .from('tiktok_post_queue')
      .select('*, account:tiktok_accounts(id, persona_key, blotato_account_id, tiktok_handle)')
      .eq('id', queue_id)
      .maybeSingle();
    if (qErr) throw qErr;
    if (!q) throw new Error('queue row not found');
    if (q.status === 'posted') return new Response(JSON.stringify({ ok: true, already: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!q.account?.blotato_account_id) throw new Error('account missing blotato_account_id');
    if (!q.video_url) throw new Error('queue row missing video_url');

    // Mark posting
    await sb.from('tiktok_post_queue').update({
      status: 'posting',
      attempts: (q.attempts || 0) + 1,
    }).eq('id', queue_id);

    const captionWithTags = [q.caption, (q.hashtags || []).join(' ')].filter(Boolean).join('\n\n');

    // Blotato post payload (TikTok target)
    const payload = {
      post: {
        accountId: q.account.blotato_account_id,
        target: {
          targetType: 'tiktok',
          isYourBrand: true,
          disabledDuet: false,
          disabledStitch: false,
          disabledComments: false,
          privacyLevel: 'PUBLIC_TO_EVERYONE',
          isBrandedContent: false,
        },
        content: {
          text: captionWithTags,
          platform: 'tiktok',
          mediaUrls: [q.video_url],
        },
      },
    };

    try {
      const { id: blotatoId, raw } = await blotatoPost(payload);
      const nowIso = new Date().toISOString();

      await sb.from('tiktok_post_queue').update({
        status: 'posted',
        blotato_post_id: blotatoId,
        blotato_response: raw,
        posted_at: nowIso,
        last_error: null,
      }).eq('id', queue_id);

      // Mirror into tiktok_posts so metrics + learning loop pick it up
      await sb.from('tiktok_posts').insert({
        script_id: q.script_id,
        render_id: q.render_id,
        account_id: q.account_id,
        caption: q.caption,
        hashtags: q.hashtags,
        status: 'posted_auto',
        posted_at: nowIso,
        manual_post_url: raw?.post?.publishedUrl || null,
      });

      await sb.from('tiktok_video_renders').update({ status: 'published' }).eq('id', q.render_id);
      await sb.from('tiktok_video_scripts').update({ status: 'posted' }).eq('id', q.script_id);

      await sb.from('tiktok_pipeline_logs').insert({
        run_type: 'blotato_post',
        status: 'success',
        message: `Posted ${q.account.persona_key} via Blotato (${blotatoId})`,
        metadata: { queue_id, blotato_id: blotatoId },
      });

      return new Response(JSON.stringify({ ok: true, blotato_id: blotatoId }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (postErr: any) {
      const msg = String(postErr?.message || postErr);
      const attempts = (q.attempts || 0) + 1;
      const newStatus = attempts >= 3 ? 'failed' : 'pending';
      await sb.from('tiktok_post_queue').update({
        status: newStatus,
        last_error: msg,
      }).eq('id', queue_id);
      await sb.from('tiktok_pipeline_logs').insert({
        run_type: 'blotato_post',
        status: 'failed',
        message: msg.slice(0, 500),
        metadata: { queue_id, attempts },
      });
      throw postErr;
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});