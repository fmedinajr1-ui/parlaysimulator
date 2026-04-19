/**
 * nba-bench-under-generator-v2  (Phase 3 v2 migration)
 *
 * Writes Pick rows to bot_daily_picks; orchestrator handles broadcast.
 * Fixed $10 stake. No bidirectional kill-flag.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Pick } from '../_shared/constants.ts';
import { etDateKey } from '../_shared/date-et.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const americanToDecimal = (o: number) => !o ? 1.91 : (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
const decimalToAmerican = (d: number) => d <= 1 ? -10000 : d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));

interface NbaCandidate {
  player_name: string;
  prop_type: string;
  line: number;
  side: 'under';
  odds: number;
  confidence: number;
}

function candidateToPick(c: NbaCandidate, today: string): Pick {
  const slug = c.player_name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const conf100 = Math.round(Math.max(0.4, Math.min(0.8, c.confidence)) * 100);
  return {
    id: `nbabench_${slug}_${c.prop_type}_${today}`,
    sport: 'basketball_nba',
    player_name: c.player_name,
    prop_type: c.prop_type,
    line: c.line,
    side: 'under',
    american_odds: c.odds,
    confidence: conf100,
    tier: conf100 >= 75 ? 'high' : conf100 >= 65 ? 'medium' : 'exploration',
    reasoning: {
      headline: `${c.player_name} stays under ${c.line} ${c.prop_type.replace('_', ' ')} — bench/role volatility model flagged the under.`,
      drivers: [
        `Engine confidence ${conf100}%`,
        `Posted at ${c.odds > 0 ? '+' : ''}${c.odds}`,
      ],
      risk_note: 'Garbage time or rotation surprise can blow the line — bench-leaning unders die fast on blowout scripts.',
      sources: ['nba_bench_engine'],
    },
    generated_at: new Date().toISOString(),
    generator: 'nba_bench_under_v2',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const today = etDateKey();
  const STAKE = 10;

  try {
    const { data: signals } = await supabase
      .from('engine_live_tracker')
      .select('*')
      .eq('sport', 'NBA')
      .eq('side', 'under')
      .gte('created_at', new Date(Date.now() - 18 * 3600 * 1000).toISOString())
      .order('confidence_score', { ascending: false })
      .limit(60);

    const seen = new Set<string>();
    const pool: NbaCandidate[] = (signals || [])
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

    // ── Save Pick rows
    const pickMap = new Map<string, Pick>();
    for (const c of pool) {
      const p = candidateToPick(c, today);
      pickMap.set(`${c.player_name.toLowerCase()}|${c.prop_type}`, p);
    }
    const pickRows = [...pickMap.values()].map(p => ({
      id: p.id, pick_date: today,
      player_name: p.player_name, sport: p.sport, prop_type: p.prop_type,
      line: p.line, side: p.side, american_odds: p.american_odds,
      confidence: p.confidence, tier: p.tier, reasoning: p.reasoning,
      generator: p.generator, status: 'locked', generated_at: p.generated_at,
    }));
    await supabase.from('bot_daily_picks').upsert(pickRows, { onConflict: 'id' });

    const inserted: any[] = [];
    const tiers = [
      { tier: 'NBA_BENCH_DUO', leg_count: 2, count: 4 },
      { tier: 'NBA_BENCH_TRIO', leg_count: 3, count: 3 },
    ];
    let cursor = 0;

    for (const cfg of tiers) {
      for (let i = 0; i < cfg.count; i++) {
        if (pool.length < cfg.leg_count) break;
        const legs: NbaCandidate[] = [];
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

        const legsJson = legs.map(l => {
          const p = pickMap.get(`${l.player_name.toLowerCase()}|${l.prop_type}`);
          return {
            pick_id: p?.id,
            player_name: l.player_name, prop_type: l.prop_type, line: l.line,
            side: 'under', odds: l.odds, confidence: l.confidence, recommended_side: 'under',
            source: 'nba_bench_v2', sport: 'NBA',
          };
        });

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

        if (!error && data) inserted.push({ id: data.id, tier: cfg.tier });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      picks_saved: pickRows.length,
      parlays_generated: inserted.length,
      pool_size: pool.length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[nba-bench-v2] Error:', err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
