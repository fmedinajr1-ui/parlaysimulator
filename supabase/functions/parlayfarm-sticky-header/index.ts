// parlayfarm-sticky-header
//
// Maintains a single pinned status message per chat (template #8). Edits in
// place every 15 minutes with rolling 60-min counters from engine_live_tracker.
// If no pinned message exists yet for the chat, sends one and pins it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { renderStickyHeader } from '../_shared/parlayfarm-format.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;

async function tg(method: string, payload: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { ok: r.ok, status: r.status, body: await r.json() };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { data: state } = await sb
      .from('telegram_bot_state')
      .select('pinned_header_message_id, pinned_header_chat_id')
      .eq('id', 1)
      .maybeSingle();

    const adminChatId = Deno.env.get('TELEGRAM_CHAT_ID');
    const chatId = state?.pinned_header_chat_id ?? (adminChatId ? Number(adminChatId) : null);
    if (!chatId) {
      return new Response(JSON.stringify({ ok: false, error: 'no_chat_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Pull last 60 min of signals
    const sinceIso = new Date(Date.now() - 60 * 60_000).toISOString();
    const { data: rows } = await sb
      .from('engine_live_tracker')
      .select('signal_type, sport, created_at')
      .gte('created_at', sinceIso)
      .limit(2000);

    let velocity = 0, traps = 0, steam = 0, correlated = 0, reverses = 0;
    const sportSet = new Set<string>();
    for (const r of rows ?? []) {
      const t = String((r as any).signal_type ?? '').toLowerCase();
      if (t.includes('reverse')) reverses++;
      else if (t.includes('trap')) traps++;
      else if (t.includes('cascade')) correlated++;
      else if (t.includes('steam') || t.includes('line_about_to_move')) steam++;
      else velocity++;
      const sp = (r as any).sport;
      if (sp) sportSet.add(String(sp).toUpperCase());
    }

    const rendered = renderStickyHeader({
      velocity, traps, steam, correlated, reverses,
      newScans: (rows ?? []).length,
      liveSports: Array.from(sportSet).slice(0, 4),
      books: ['FanDuel', 'DraftKings', 'MGM', 'Caesars'],
      quietHours: '2a–8a ET',
    });

    let messageId = state?.pinned_header_message_id ?? null;

    if (messageId) {
      const edit = await tg('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: rendered.message,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      });
      if (!edit.ok && edit.body?.description?.includes('message to edit not found')) {
        messageId = null; // fall through to send + pin
      } else if (!edit.ok && !edit.body?.description?.includes('not modified')) {
        console.warn('[sticky-header] edit failed', edit.body);
      } else {
        return new Response(JSON.stringify({ ok: true, edited: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Send + pin
    const sent = await tg('sendMessage', {
      chat_id: chatId,
      text: rendered.message,
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true,
    });
    if (!sent.ok) {
      return new Response(JSON.stringify({ ok: false, error: sent.body }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const newMid = sent.body?.result?.message_id;
    await tg('pinChatMessage', { chat_id: chatId, message_id: newMid, disable_notification: true });

    await sb.from('telegram_bot_state').update({
      pinned_header_message_id: newMid,
      pinned_header_chat_id: chatId,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);

    return new Response(JSON.stringify({ ok: true, pinned: newMid }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[sticky-header] error', e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
