/**
 * generate-rbi-parlays-v2
 *
 * UNDER-only RBI parlays. No DNA gating, no 60% accuracy gate.
 * Pulls directly from mlb_rbi_under_analyzer outputs (engine_live_tracker)
 * and straight_bet_tracker cascade signals.
 *
 * Builds: 2-leg ($25), 3-leg ($15), 4-leg ($10).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CandidateLeg {
  player_name: string;
  prop_type: string;
  line: number;
  side: 'under';
  odds: number;
  game_id?: string;
  team?: string;
  opp_team?: string;
  confidence?: number;
  source: string;
}

const TIER_CONFIG = [
  { tier: 'RBI_DUO', leg_count: 2, stake: 25, count: 4 },
  { tier: 'RBI_TRIO', leg_count: 3, stake: 15, count: 4 },
  { tier: 'RBI_QUAD', leg_count: 4, stake: 10, count: 2 },
];

function americanToDecimal(odds: number): number {
  if (!odds) return 1.91;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}
function decimalToAmerican(d: number): number {
  if (d <= 1) return -10000;
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}
function chunkMessage(text: string, max = 3800): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let buf = '';
  for (const line of text.split('\n')) {
    if ((buf + line + '\n').length > max) {
      if (buf) out.push(buf.trimEnd());
      buf = line + '\n';
    } else buf += line + '\n';
  }
  if (buf) out.push(buf.trimEnd());
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  try {
    // Pull from engine_live_tracker (mlb_rbi_under_analyzer outputs) + straight_bet_tracker
    const candidates = new Map<string, CandidateLeg>();

    const { data: trackerSignals } = await supabase
      .from('engine_live_tracker')
      .select('*')
      .eq('sport', 'MLB')
      .in('signal_source', ['mlb_rbi_under_analyzer', 'mlb-rbi-under-analyzer'])
      .gte('created_at', new Date(Date.now() - 18 * 3600 * 1000).toISOString())
      .limit(200);

    for (const s of trackerSignals || []) {
      const player = (s as any).player_name;
      const propType = ((s as any).prop_type || 'batter_rbis').toLowerCase();
      if (!player) continue;
      const key = `${player.toLowerCase()}|${propType}`;
      if (candidates.has(key)) continue;
      candidates.set(key, {
        player_name: player,
        prop_type: propType,
        line: Number((s as any).line || 0.5),
        side: 'under',
        odds: Number((s as any).odds || -120),
        confidence: Number((s as any).confidence_score || 0.6),
        source: 'rbi_analyzer',
      });
    }

    // Cascade reinforcement from straight_bet_tracker
    const { data: cascadeBets } = await supabase
      .from('straight_bet_tracker')
      .select('*')
      .eq('sport', 'MLB')
      .ilike('prop_type', '%rbi%')
      .eq('side', 'under')
      .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .limit(100);

    for (const b of cascadeBets || []) {
      const player = (b as any).player_name;
      const propType = ((b as any).prop_type || 'batter_rbis').toLowerCase();
      if (!player) continue;
      const key = `${player.toLowerCase()}|${propType}`;
      if (candidates.has(key)) continue;
      candidates.set(key, {
        player_name: player,
        prop_type: propType,
        line: Number((b as any).line || 0.5),
        side: 'under',
        odds: Number((b as any).odds || -130),
        confidence: 0.62,
        source: 'cascade',
      });
    }

    const pool = [...candidates.values()].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    if (pool.length < 2) {
      return new Response(JSON.stringify({ success: false, reason: 'insufficient_pool', pool_size: pool.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const inserted: any[] = [];
    let cursor = 0;

    for (const cfg of TIER_CONFIG) {
      for (let i = 0; i < cfg.count; i++) {
        const legs: CandidateLeg[] = [];
        const used = new Set<string>();
        let scan = cursor;
        while (legs.length < cfg.leg_count && scan < pool.length + cursor + cfg.count * cfg.leg_count) {
          const idx = scan % pool.length;
          const cand = pool[idx];
          scan += 1;
          if (used.has(cand.player_name.toLowerCase())) continue;
          used.add(cand.player_name.toLowerCase());
          legs.push(cand);
        }
        if (legs.length < cfg.leg_count) continue;
        cursor = (cursor + cfg.leg_count) % pool.length;

        const decOdds = legs.reduce((acc, l) => acc * americanToDecimal(l.odds), 1);
        const americanOdds = decimalToAmerican(decOdds);
        const combinedProb = legs.reduce((acc, l) => acc * Math.max(0.4, Math.min(0.95, l.confidence || 0.6)), 1);
        const payout = cfg.stake * decOdds;

        const legsJson = legs.map(l => ({
          player_name: l.player_name,
          prop_type: l.prop_type,
          line: l.line,
          side: l.side,
          odds: l.odds,
          source: l.source,
          confidence: l.confidence,
          recommended_side: 'under',
        }));

        const { data, error } = await supabase.from('bot_daily_parlays').insert({
          parlay_date: today,
          strategy_name: 'rbi_unders_v2',
          tier: cfg.tier,
          leg_count: cfg.leg_count,
          legs: legsJson,
          combined_probability: combinedProb,
          expected_odds: americanOdds,
          simulated_stake: cfg.stake,
          simulated_payout: payout,
          is_simulated: true,
          outcome: 'pending',
          selection_rationale: `v2 RBI Under | tier ${cfg.tier} | sources: ${[...new Set(legs.map(l => l.source))].join(',')}`,
        }).select('id').single();

        if (!error && data) inserted.push({ id: data.id, tier: cfg.tier, legs: legsJson, odds: americanOdds, stake: cfg.stake });
      }
    }

    // Telegram broadcast (chunked)
    if (inserted.length) {
      const lines = [`⚾ *RBI UNDER PARLAYS v2 — ${today}*`, `📊 ${inserted.length} tickets generated`, ``];
      for (const p of inserted) {
        lines.push(`\n*${p.tier}* — ${p.legs.length}-leg | $${p.stake} | ${p.odds > 0 ? '+' : ''}${p.odds}`);
        for (const l of p.legs) lines.push(`  • ${l.player_name} U${l.line} ${l.prop_type}`);
      }
      const msg = lines.join('\n');
      for (const chunk of chunkMessage(msg)) {
        await supabase.functions.invoke('bot-send-telegram', {
          body: { message: chunk, parse_mode: 'Markdown', admin_only: true },
        });
      }
    }

    return new Response(JSON.stringify({ success: true, generated: inserted.length, pool_size: pool.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[rbi-v2] Error:', err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
