/**
 * generate-sb-over-parlays
 *
 * Wraps SB Over signals (sb_over_l10) from fanduel_prediction_alerts into 2-3 leg parlays.
 * Tier ELITE/HIGH only. No DNA, no integrity gate.
 * Stakes: 2-leg $20, 3-leg $10.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function americanToDecimal(o: number): number {
  if (!o) return 2.5;
  return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);
}
function decimalToAmerican(d: number): number {
  if (d <= 1) return -10000;
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}
function chunkMessage(text: string, max = 3800): string[] {
  if (text.length <= max) return [text];
  const out: string[] = []; let buf = '';
  for (const line of text.split('\n')) {
    if ((buf + line + '\n').length > max) { if (buf) out.push(buf.trimEnd()); buf = line + '\n'; }
    else buf += line + '\n';
  }
  if (buf) out.push(buf.trimEnd());
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  try {
    const { data: alerts } = await supabase
      .from('fanduel_prediction_alerts')
      .select('*')
      .eq('signal_type', 'sb_over_l10')
      .in('tier', ['ELITE', 'HIGH'])
      .gte('created_at', new Date(Date.now() - 18 * 3600 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(40);

    const seen = new Set<string>();
    const pool: any[] = [];
    for (const a of alerts || []) {
      const player = (a as any).player_name;
      if (!player) continue;
      const k = player.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      pool.push({
        player_name: player,
        prop_type: 'batter_stolen_bases',
        line: Number((a as any).line || 0.5),
        side: 'over',
        odds: Number((a as any).odds || 250),
        tier: (a as any).tier,
        confidence: Number((a as any).confidence_score || 0.55),
      });
    }

    if (pool.length < 2) {
      return new Response(JSON.stringify({ success: false, reason: 'insufficient_sb_pool', pool_size: pool.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const inserted: any[] = [];
    const tiers = [
      { tier: 'SB_DUO', leg_count: 2, stake: 20, count: 3 },
      { tier: 'SB_TRIO', leg_count: 3, stake: 10, count: 2 },
    ];
    let cursor = 0;
    for (const cfg of tiers) {
      for (let i = 0; i < cfg.count; i++) {
        if (pool.length < cfg.leg_count) break;
        const legs: any[] = [];
        const used = new Set<string>();
        let scan = cursor;
        while (legs.length < cfg.leg_count && scan < pool.length * 2) {
          const idx = scan % pool.length;
          const c = pool[idx];
          scan += 1;
          if (used.has(c.player_name.toLowerCase())) continue;
          used.add(c.player_name.toLowerCase());
          legs.push(c);
        }
        if (legs.length < cfg.leg_count) continue;
        cursor = (cursor + cfg.leg_count) % pool.length;

        const dec = legs.reduce((a, l) => a * americanToDecimal(l.odds), 1);
        const odds = decimalToAmerican(dec);
        const prob = legs.reduce((a, l) => a * Math.max(0.3, Math.min(0.7, l.confidence)), 1);
        const legsJson = legs.map(l => ({
          player_name: l.player_name, prop_type: l.prop_type, line: l.line,
          side: 'over', odds: l.odds, confidence: l.confidence, recommended_side: 'over',
          source: 'sb_over_alert',
        }));

        const { data, error } = await supabase.from('bot_daily_parlays').insert({
          parlay_date: today,
          strategy_name: 'sb_over_v1',
          tier: cfg.tier,
          leg_count: cfg.leg_count,
          legs: legsJson,
          combined_probability: prob,
          expected_odds: odds,
          simulated_stake: cfg.stake,
          simulated_payout: cfg.stake * dec,
          is_simulated: true,
          outcome: 'pending',
          selection_rationale: `SB Over alerts (ELITE/HIGH) | ${cfg.leg_count}-leg`,
        }).select('id').single();

        if (!error && data) inserted.push({ id: data.id, tier: cfg.tier, legs: legsJson, odds, stake: cfg.stake });
      }
    }

    if (inserted.length) {
      const lines = [`🏃 *SB OVER PARLAYS — ${today}*`, `📊 ${inserted.length} tickets`, ``];
      for (const p of inserted) {
        lines.push(`\n*${p.tier}* — ${p.legs.length}-leg | $${p.stake} | ${p.odds > 0 ? '+' : ''}${p.odds}`);
        for (const l of p.legs) lines.push(`  • ${l.player_name} O${l.line} SB`);
      }
      for (const chunk of chunkMessage(lines.join('\n'))) {
        await supabase.functions.invoke('bot-send-telegram', {
          body: { message: chunk, parse_mode: 'Markdown', admin_only: true },
        });
      }
    }

    return new Response(JSON.stringify({ success: true, generated: inserted.length, pool_size: pool.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[sb-over] Error:', err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
