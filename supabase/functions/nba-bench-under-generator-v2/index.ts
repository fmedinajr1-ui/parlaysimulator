/**
 * nba-bench-under-generator-v2
 *
 * Replaces nba-matchup-daily-broadcast's parlay-insert section.
 * Fixed $10 stake. Removes bidirectional kill-flag (no longer drops legs
 * when defense rank disagrees). No bot_stake_config lookup.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const americanToDecimal = (o: number) => !o ? 1.91 : (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
const decimalToAmerican = (d: number) => d <= 1 ? -10000 : d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
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
  const STAKE = 10;

  try {
    // Pull NBA Under candidates (no bidirectional kill-gate)
    const { data: signals } = await supabase
      .from('engine_live_tracker')
      .select('*')
      .eq('sport', 'NBA')
      .eq('side', 'under')
      .gte('created_at', new Date(Date.now() - 18 * 3600 * 1000).toISOString())
      .order('confidence_score', { ascending: false })
      .limit(60);

    const seen = new Set<string>();
    const pool = (signals || [])
      .filter((s: any) => s.player_name)
      .map((s: any) => ({
        player_name: s.player_name,
        prop_type: (s.prop_type || 'points').toLowerCase(),
        line: Number(s.line || 0),
        side: 'under' as const,
        odds: Number(s.odds || -115),
        confidence: Number(s.confidence_score || 0.55),
      }))
      .filter(l => {
        const k = `${l.player_name.toLowerCase()}|${l.prop_type}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

    if (pool.length < 2) {
      return new Response(JSON.stringify({ success: false, reason: 'insufficient_nba_pool', pool_size: pool.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const inserted: any[] = [];
    const tiers = [
      { tier: 'NBA_BENCH_DUO', leg_count: 2, count: 4 },
      { tier: 'NBA_BENCH_TRIO', leg_count: 3, count: 3 },
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
        const prob = legs.reduce((a, l) => a * Math.max(0.4, Math.min(0.8, l.confidence)), 1);

        const legsJson = legs.map(l => ({
          player_name: l.player_name, prop_type: l.prop_type, line: l.line,
          side: 'under', odds: l.odds, confidence: l.confidence, recommended_side: 'under',
          source: 'nba_bench_v2', sport: 'NBA',
        }));

        const { data, error } = await supabase.from('bot_daily_parlays').insert({
          parlay_date: today,
          strategy_name: 'nba_bench_under_v2',
          tier: cfg.tier,
          leg_count: cfg.leg_count,
          legs: legsJson,
          combined_probability: prob,
          expected_odds: odds,
          simulated_stake: STAKE,
          simulated_payout: STAKE * dec,
          is_simulated: true,
          outcome: 'pending',
          selection_rationale: `NBA bench under v2 | flat $${STAKE} | no bidirectional kill`,
        }).select('id').single();

        if (!error && data) inserted.push({ id: data.id, tier: cfg.tier, legs: legsJson, odds });
      }
    }

    if (inserted.length) {
      const lines = [`🏀 *NBA BENCH UNDER PARLAYS v2 — ${today}*`, `📊 ${inserted.length} tickets | $${STAKE}/each`, ``];
      for (const p of inserted) {
        lines.push(`\n*${p.tier}* | ${p.odds > 0 ? '+' : ''}${p.odds}`);
        for (const l of p.legs) lines.push(`  • ${l.player_name} U${l.line} ${l.prop_type}`);
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
    console.error('[nba-bench-v2] Error:', err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
