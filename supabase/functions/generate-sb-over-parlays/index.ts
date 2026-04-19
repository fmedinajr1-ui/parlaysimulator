/**
 * generate-sb-over-parlays  (Phase 3 v2 migration)
 *
 * Wraps SB Over signals (sb_over_l10) from fanduel_prediction_alerts into 2-3 leg parlays.
 * Tier ELITE/HIGH only. Writes Pick rows to bot_daily_picks; orchestrator broadcasts.
 * Stakes: 2-leg $20, 3-leg $10.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Pick } from '../_shared/constants.ts';
import { etDateKey } from '../_shared/date-et.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const americanToDecimal = (o: number) => !o ? 2.5 : (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
const decimalToAmerican = (d: number) => d <= 1 ? -10000 : d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));

interface SbCandidate {
  player_name: string;
  prop_type: string;
  line: number;
  side: 'over';
  odds: number;
  tier: string;
  confidence: number;
}

function candidateToPick(c: SbCandidate, today: string): Pick {
  const slug = c.player_name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const conf100 = Math.round(Math.max(0.3, Math.min(0.7, c.confidence)) * 100);
  return {
    id: `sb_${slug}_${today}`,
    sport: 'baseball_mlb',
    player_name: c.player_name,
    prop_type: c.prop_type,
    line: c.line,
    side: 'over',
    american_odds: c.odds,
    confidence: conf100,
    tier: c.tier === 'ELITE' ? 'elite' : 'high',
    reasoning: {
      headline: `${c.player_name} O${c.line} SB — ${c.tier} signal from L10 base-stealing model.`,
      drivers: [
        `SB-Over alert tier: ${c.tier}`,
        `Posted at ${c.odds > 0 ? '+' : ''}${c.odds}`,
      ],
      risk_note: 'Speed props can die on a caught-stealing or early lift — single attempt is the whole prop.',
      sources: ['sb_over_alert'],
    },
    generated_at: new Date().toISOString(),
    generator: 'sb_over_v1',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const today = etDateKey();

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
    const pool: SbCandidate[] = [];
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

    // ── Save Pick rows
    const pickMap = new Map<string, Pick>();
    for (const c of pool) {
      const p = candidateToPick(c, today);
      pickMap.set(c.player_name.toLowerCase(), p);
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
      { tier: 'SB_DUO', leg_count: 2, stake: 20, count: 3 },
      { tier: 'SB_TRIO', leg_count: 3, stake: 10, count: 2 },
    ];
    let cursor = 0;
    for (const cfg of tiers) {
      for (let i = 0; i < cfg.count; i++) {
        if (pool.length < cfg.leg_count) break;
        const legs: SbCandidate[] = [];
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
        const legsJson = legs.map(l => {
          const p = pickMap.get(l.player_name.toLowerCase());
          return {
            pick_id: p?.id,
            player_name: l.player_name, prop_type: l.prop_type, line: l.line,
            side: 'over', odds: l.odds, confidence: l.confidence, recommended_side: 'over',
            source: 'sb_over_alert',
          };
        });

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
    console.error('[sb-over] Error:', err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
