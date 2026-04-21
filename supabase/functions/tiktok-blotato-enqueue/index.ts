// Phase 6 — Auto-posting: Enqueue a render into the Blotato post queue.
// Called from the admin Publish tab. Picks the next available scheduled slot
// (or accepts a custom scheduled_for) and inserts a tiktok_post_queue row.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function nextSlotDate(dow: number, hour: number, minute: number): Date {
  // Slots are stored in ET. We approximate ET as UTC-5 (EST) — Blotato will
  // schedule at the absolute UTC time we pass, so this is good enough for
  // posting cadence (DST drift = max 1hr, acceptable for TikTok timing).
  const now = new Date();
  const target = new Date(now);
  target.setUTCHours(hour + 5, minute, 0, 0);
  let diff = (dow - target.getUTCDay() + 7) % 7;
  if (diff === 0 && target.getTime() <= now.getTime()) diff = 7;
  target.setUTCDate(target.getUTCDate() + diff);
  return target;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { render_id, scheduled_for } = await req.json();
    if (!render_id) throw new Error('render_id required');

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: render, error: rErr } = await sb
      .from('tiktok_video_renders')
      .select('id, script_id, final_video_url, status')
      .eq('id', render_id)
      .maybeSingle();
    if (rErr) throw rErr;
    if (!render) throw new Error('render not found');
    if (!render.final_video_url) throw new Error('render has no final_video_url — cannot auto-post');

    const { data: script, error: sErr } = await sb
      .from('tiktok_video_scripts')
      .select('id, account_id, target_persona_key, final_caption, caption_seed, final_hashtags, hashtag_seed, hook')
      .eq('id', render.script_id)
      .maybeSingle();
    if (sErr) throw sErr;
    if (!script) throw new Error('script not found');

    // Find account
    let accountId = script.account_id;
    if (!accountId) {
      const { data: acc } = await sb
        .from('tiktok_accounts')
        .select('id')
        .eq('persona_key', script.target_persona_key)
        .maybeSingle();
      accountId = acc?.id;
    }
    if (!accountId) throw new Error('no account for script');

    const { data: account, error: aErr } = await sb
      .from('tiktok_accounts')
      .select('id, persona_key, blotato_account_id, auto_post_enabled, status')
      .eq('id', accountId)
      .maybeSingle();
    if (aErr) throw aErr;
    if (!account?.blotato_account_id) throw new Error(`Account ${account?.persona_key} has no blotato_account_id`);
    if (!account.auto_post_enabled) throw new Error(`Auto-post disabled for ${account.persona_key}`);

    // Determine schedule
    let when: string;
    if (scheduled_for) {
      when = new Date(scheduled_for).toISOString();
    } else {
      const { data: slots } = await sb
        .from('tiktok_post_schedule')
        .select('day_of_week, hour_et, minute_et')
        .eq('account_id', accountId)
        .eq('is_active', true);
      if (!slots?.length) {
        when = new Date(Date.now() + 5 * 60_000).toISOString(); // +5m fallback
      } else {
        // Pick earliest future slot that isn't already occupied by a pending queue row
        const { data: pending } = await sb
          .from('tiktok_post_queue')
          .select('scheduled_for')
          .eq('account_id', accountId)
          .in('status', ['pending', 'posting']);
        const taken = new Set((pending || []).map((p) => new Date(p.scheduled_for).getTime()));
        const candidates = slots
          .map((s) => nextSlotDate(s.day_of_week, s.hour_et, s.minute_et))
          .sort((a, b) => a.getTime() - b.getTime());
        const free = candidates.find((d) => !taken.has(d.getTime())) || candidates[0];
        when = free.toISOString();
      }
    }

    const caption = script.final_caption || script.caption_seed || '';
    const hashtags = (script.final_hashtags?.length ? script.final_hashtags : script.hashtag_seed) || [];

    const { data: row, error: qErr } = await sb
      .from('tiktok_post_queue')
      .insert({
        script_id: script.id,
        render_id: render.id,
        account_id: accountId,
        scheduled_for: when,
        caption,
        hashtags,
        video_url: render.final_video_url,
        status: 'pending',
      })
      .select()
      .single();
    if (qErr) throw qErr;

    return new Response(JSON.stringify({ ok: true, queue_id: row.id, scheduled_for: when }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});