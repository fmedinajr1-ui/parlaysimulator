/**
 * telegram-audit-report
 *
 * One-shot diagnostic. Scans last 14 days of bot_daily_parlays + straight_bet_tracker
 * and posts a per-strategy/per-signal audit to Telegram (admin_only).
 *
 * Reports: tickets, wins, losses, voids, pending, win-rate, void-rate, stake, P/L, ROI.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 14);
    const startISO = startDate.toISOString().split('T')[0];

    // --- Pull parlays ---
    const { data: parlays, error: pErr } = await supabase
      .from('bot_daily_parlays')
      .select('strategy_name, tier, outcome, leg_count, simulated_stake, simulated_payout, profit_loss, parlay_date')
      .gte('parlay_date', startISO);

    if (pErr) throw pErr;

    // --- Aggregate by strategy ---
    type Agg = {
      tickets: number; won: number; lost: number; void: number; pending: number;
      stake: number; payout: number; pl: number;
    };
    const byStrategy = new Map<string, Agg>();
    const blank = (): Agg => ({ tickets: 0, won: 0, lost: 0, void: 0, pending: 0, stake: 0, payout: 0, pl: 0 });

    for (const p of parlays || []) {
      const key = p.strategy_name || 'unknown';
      const a = byStrategy.get(key) || blank();
      a.tickets += 1;
      const outcome = (p.outcome || 'pending').toLowerCase();
      if (outcome === 'won' || outcome === 'win') a.won += 1;
      else if (outcome === 'lost' || outcome === 'loss') a.lost += 1;
      else if (outcome === 'void' || outcome === 'voided') a.void += 1;
      else a.pending += 1;
      a.stake += Number(p.simulated_stake || 0);
      a.payout += Number(p.simulated_payout || 0);
      a.pl += Number(p.profit_loss || 0);
      byStrategy.set(key, a);
    }

    // --- Sort by tickets desc ---
    const rows = [...byStrategy.entries()].sort((a, b) => b[1].tickets - a[1].tickets);

    // --- Totals ---
    const tot = blank();
    for (const [, a] of rows) {
      tot.tickets += a.tickets; tot.won += a.won; tot.lost += a.lost;
      tot.void += a.void; tot.pending += a.pending;
      tot.stake += a.stake; tot.payout += a.payout; tot.pl += a.pl;
    }

    const fmtPct = (n: number, d: number) => d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
    const fmtMoney = (n: number) => `$${n.toFixed(2)}`;
    const settled = (a: Agg) => a.won + a.lost;
    const wr = (a: Agg) => fmtPct(a.won, settled(a));
    const vr = (a: Agg) => fmtPct(a.void, a.tickets);
    const roi = (a: Agg) => a.stake > 0 ? `${((a.pl / a.stake) * 100).toFixed(1)}%` : '—';

    // --- Build Telegram message ---
    const lines: string[] = [];
    lines.push(`🔍 *PARLAY AUDIT — Last 14 Days*`);
    lines.push(`📅 ${startISO} → ${today.toISOString().split('T')[0]}`);
    lines.push(``);
    lines.push(`*OVERALL:*`);
    lines.push(`  Tickets: ${tot.tickets} | Won: ${tot.won} | Lost: ${tot.lost} | Void: ${tot.void} | Pending: ${tot.pending}`);
    lines.push(`  WinRate: ${wr(tot)} | VoidRate: ${vr(tot)}`);
    lines.push(`  Stake: ${fmtMoney(tot.stake)} | P/L: ${fmtMoney(tot.pl)} | ROI: ${roi(tot)}`);
    lines.push(``);
    lines.push(`*BY STRATEGY:*`);

    for (const [name, a] of rows) {
      lines.push(`\n*${name}*`);
      lines.push(`  ${a.tickets}T | ${a.won}W ${a.lost}L ${a.void}V ${a.pending}P`);
      lines.push(`  WR: ${wr(a)} | VoidRate: ${vr(a)} | ROI: ${roi(a)}`);
      lines.push(`  P/L: ${fmtMoney(a.pl)}`);
    }

    // --- Straight bets summary ---
    const { data: straights } = await supabase
      .from('straight_bet_tracker')
      .select('signal_type, outcome, profit_loss, stake')
      .gte('created_at', startDate.toISOString());

    if (straights && straights.length) {
      const bySig = new Map<string, { n: number; w: number; l: number; pl: number }>();
      for (const s of straights) {
        const k = (s as any).signal_type || 'unknown';
        const x = bySig.get(k) || { n: 0, w: 0, l: 0, pl: 0 };
        x.n += 1;
        const o = ((s as any).outcome || '').toLowerCase();
        if (o === 'won' || o === 'win') x.w += 1;
        else if (o === 'lost' || o === 'loss') x.l += 1;
        x.pl += Number((s as any).profit_loss || 0);
        bySig.set(k, x);
      }
      lines.push(``);
      lines.push(`*STRAIGHT BETS BY SIGNAL:*`);
      for (const [sig, x] of [...bySig.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12)) {
        const settledN = x.w + x.l;
        const sigWR = settledN > 0 ? `${((x.w / settledN) * 100).toFixed(0)}%` : '—';
        lines.push(`  ${sig}: ${x.n} bets | ${x.w}W/${x.l}L (${sigWR}) | ${fmtMoney(x.pl)}`);
      }
    }

    lines.push(``);
    lines.push(`💡 Diagnostic complete.`);

    const message = lines.join('\n');

    // Send via bot-send-telegram (admin only)
    await supabase.functions.invoke('bot-send-telegram', {
      body: { message, parse_mode: 'Markdown', admin_only: true },
    });

    return new Response(JSON.stringify({
      success: true,
      strategies: rows.length,
      totals: tot,
      message_length: message.length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[audit-report] Error:', err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
