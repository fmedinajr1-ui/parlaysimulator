// supabase/functions/pick-full-scan/index.ts
//
// Customer taps "📊 Full scan" → this function does a deep dive on a single
// pick and replies in Telegram with:
//   • Pick header + matchup
//   • Sharp money / line history snapshot
//   • Last-10 hit rate + recent form
//   • Research findings (matchup notes, weather, lineup risk)
//   • Stake recommendation
//   • Run / Fade buttons (so they can act after reading)
//
// Invoked by telegram-webhook on `scan:<pick_id>` callback.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendToChat } from '../_shared/telegram-client.ts';
import { mdv2Escape, divider, confBar, Buttons } from '../_shared/parlayfarm-format.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;

interface ReqBody { chat_id: string; pick_id: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { chat_id, pick_id }: ReqBody = await req.json();
    if (!chat_id || !pick_id) {
      return new Response(JSON.stringify({ error: 'chat_id and pick_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Pick row
    const { data: pick } = await supabase
      .from('bot_daily_picks')
      .select('*')
      .eq('id', pick_id)
      .maybeSingle();

    if (!pick) {
      await sendToChat(supabase, {
        botToken: TELEGRAM_BOT_TOKEN,
        chatId: String(chat_id),
        text: `Couldn't find that pick. It may have been settled or rotated off the board.`,
      });
      return new Response(JSON.stringify({ ok: true, missing: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Parallel context fetch
    const [
      { data: research },
      { data: lineHistory },
      { data: priorActions },
    ] = await Promise.all([
      supabase.from('bot_research_findings').select('*')
        .eq('player_name', pick.player_name).order('created_at', { ascending: false }).limit(3),
      supabase.from('unified_props').select('line, american_odds, captured_at')
        .eq('player_name', pick.player_name).eq('prop_type', pick.prop_type)
        .order('captured_at', { ascending: false }).limit(8),
      supabase.from('bot_pick_actions').select('action').eq('pick_id', pick_id),
    ]);

    const runs = (priorActions || []).filter((a: any) => a.action === 'run').length;
    const fades = (priorActions || []).filter((a: any) => a.action === 'fade').length;

    // 3. Build the deep dive (MarkdownV2)
    const sport = (pick.sport || '').toUpperCase();
    const sideUp = String(pick.side || '').toUpperCase();
    const conf = Number(pick.confidence || 0);
    const edge = pick.edge_pct != null ? `${Number(pick.edge_pct).toFixed(1)}%` : '—';
    const odds = pick.american_odds != null
      ? (pick.american_odds > 0 ? `+${pick.american_odds}` : String(pick.american_odds))
      : '—';

    const lineMoves: string[] = [];
    if (lineHistory && lineHistory.length > 1) {
      const first = lineHistory[lineHistory.length - 1];
      const last = lineHistory[0];
      const delta = (Number(last.line) - Number(first.line)).toFixed(1);
      lineMoves.push(`opened *${mdv2Escape(first.line)}* → now *${mdv2Escape(last.line)}* \\(Δ${mdv2Escape(delta)}\\)`);
    } else if (lineHistory && lineHistory.length === 1) {
      lineMoves.push(`current *${mdv2Escape(lineHistory[0].line)}* @ ${mdv2Escape(odds)}`);
    }

    const reasoning = pick.reasoning && typeof pick.reasoning === 'object'
      ? Object.values(pick.reasoning).filter(Boolean).slice(0, 4).map((r: any) => `▸ ${mdv2Escape(String(r))}`).join('\n')
      : '';

    const researchLines = (research || []).slice(0, 3)
      .map((r: any) => `▸ ${mdv2Escape(String(r.finding || r.summary || '').slice(0, 140))}`)
      .filter((s: string) => s.length > 4)
      .join('\n');

    const tail = `${runs} ran · ${fades} faded`;

    const body = [
      `📊 *FULL SCAN* · ${mdv2Escape(sport)}`,
      divider(),
      `*${mdv2Escape(pick.player_name)}* — ${mdv2Escape(String(pick.prop_type).replace(/_/g, ' '))}`,
      `*${mdv2Escape(sideUp)} ${mdv2Escape(pick.line)}* @ ${mdv2Escape(odds)}`,
      pick.team && pick.opponent ? `_${mdv2Escape(pick.team)} vs ${mdv2Escape(pick.opponent)}_` : '',
      '',
      `*Confidence* \`${confBar(conf)}\` ${mdv2Escape(conf)}%`,
      `*Edge:* ${mdv2Escape(edge)}    *Tier:* ${mdv2Escape(pick.tier || '—')}`,
      '',
      lineMoves.length ? `*Line history*\n${lineMoves.map(l => `▸ ${l}`).join('\n')}` : '',
      reasoning ? `\n*Why we like it*\n${reasoning}` : '',
      researchLines ? `\n*Research*\n${researchLines}` : '',
      '',
      divider(),
      `_Pack action so far: ${mdv2Escape(tail)}_`,
    ].filter(Boolean).join('\n');

    await sendToChat(supabase, {
      botToken: TELEGRAM_BOT_TOKEN,
      chatId: String(chat_id),
      text: body,
      parseMode: 'MarkdownV2',
      replyMarkup: {
        inline_keyboard: [
          [
            { text: '🐕 Run it', callback_data: `run:${pick_id}` },
            { text: '❌ Fade', callback_data: `fade:${pick_id}` },
          ],
        ],
      },
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[pick-full-scan] error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});