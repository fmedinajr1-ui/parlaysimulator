// telegram-batch-flusher
//
// Drains telegram_alert_batch_buffer per chat into a ParlayFarm Batch Digest
// (template #7). Runs every 30s via pg_cron.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { renderBatchDigest, type BatchDigestEntry } from '../_shared/parlayfarm-format.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;

function classify(sigType: string): keyof BatchCounts {
  const t = (sigType || '').toLowerCase();
  if (t.includes('reverse')) return 'reverseCount';
  if (t.includes('trap')) return 'trapCount';
  if (t.includes('cascade')) return 'correlatedCount';
  if (t.includes('steam') || t.includes('line_about_to_move')) return 'steamCount';
  return 'velocityCount';
}

interface BatchCounts {
  velocityCount: number;
  trapCount: number;
  steamCount: number;
  correlatedCount: number;
  reverseCount: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    // Pull anything older than ~25s so we let the buffer fill a bit
    const cutoff = new Date(Date.now() - 25_000).toISOString();
    const { data: rows, error } = await sb
      .from('telegram_alert_batch_buffer')
      .select('id, chat_id, signal_type, payload, created_at')
      .lte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) throw error;
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, flushed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Group by chat
    const byChat = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = String(r.chat_id);
      if (!byChat.has(key)) byChat.set(key, []);
      byChat.get(key)!.push(r);
    }

    let flushed = 0;
    for (const [chatId, group] of byChat) {
      const counts: BatchCounts = {
        velocityCount: 0, trapCount: 0, steamCount: 0, correlatedCount: 0, reverseCount: 0,
      };
      for (const g of group) counts[classify(g.signal_type)]++;

      const top: BatchDigestEntry[] = group.slice(0, 3).map((g, i) => {
        const ctx = (g.payload as any)?.alert_context ?? {};
        const player = ctx.player || ctx.headline || g.signal_type;
        const conf = ctx.confidence != null ? `${Math.round(ctx.confidence)}%` : '—';
        const sport = ctx.sport ? ` ${String(ctx.sport).toUpperCase()}` : '';
        return { rank: i + 1, player: String(player), meta: `${conf}${sport}` };
      });

      const batchId = crypto.randomUUID();
      const digest = renderBatchDigest({
        batchId,
        totalSignals: group.length,
        windowMin: 1,
        ...counts,
        top,
        reasoning: 'Pack is on it. Tap to expand the full list.',
      });

      const tg = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: digest.message,
          parse_mode: 'MarkdownV2',
          reply_markup: digest.reply_markup,
          disable_web_page_preview: true,
        }),
      });
      const tgJson = await tg.json();
      if (!tg.ok) {
        console.error('[batch-flusher] sendMessage failed', tgJson);
        continue;
      }

      // Delete the flushed rows
      const ids = group.map((g) => g.id);
      await sb.from('telegram_alert_batch_buffer').delete().in('id', ids);
      flushed += group.length;
    }

    return new Response(JSON.stringify({ ok: true, flushed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[batch-flusher] error', e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
