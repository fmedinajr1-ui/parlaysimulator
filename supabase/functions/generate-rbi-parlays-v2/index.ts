/**
 * generate-rbi-parlays-v2  (Phase 3 v2 migration)
 *
 * UNDER-only RBI parlays. Now writes structured Pick rows to bot_daily_picks
 * and lets the orchestrator decide when/how to broadcast. No self-rendered
 * Telegram messages.
 *
 * Builds: 2-leg ($25), 3-leg ($15), 4-leg ($10).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Pick } from '../_shared/constants.ts';
import { etDateKey } from '../_shared/date-et.ts';

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
  team?: string;
  opp_team?: string;
  confidence: number;
  source: string;
}

const TIER_CONFIG = [
  { tier: 'RBI_DUO', leg_count: 2, stake: 25, count: 4 },
  { tier: 'RBI_TRIO', leg_count: 3, stake: 15, count: 4 },
  { tier: 'RBI_QUAD', leg_count: 4, stake: 10, count: 2 },
];

const americanToDecimal = (o: number) => !o ? 1.91 : (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
const decimalToAmerican = (d: number) => d <= 1 ? -10000 : d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));

function candidateToPick(c: CandidateLeg, today: string): Pick {
  const slug = c.player_name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const conf100 = Math.round(Math.max(0.4, Math.min(0.95, c.confidence)) * 100);
  return {
    id: `rbi_${slug}_${c.prop_type}_${today}`,
    sport: 'baseball_mlb',
    player_name: c.player_name,
    team: c.team,
    opponent: c.opp_team,
    prop_type: c.prop_type,
    line: c.line,
    side: 'under',
    american_odds: c.odds,
    confidence: conf100,
    tier: conf100 >= 75 ? 'high' : conf100 >= 65 ? 'medium' : 'exploration',
    reasoning: {
      headline: `${c.player_name} stays under ${c.line} RBIs — pitcher matchup and recent form both point that way.`,
      drivers: [
        `RBI Under analyzer flagged this leg (${c.source})`,
        `Posted at ${c.odds > 0 ? '+' : ''}${c.odds}`,
      ],
      risk_note: 'Single swing can flip RBI props — late-inning leverage is the live risk.',
      sources: [c.source],
    },
    generated_at: new Date().toISOString(),
    generator: 'rbi_unders_v2',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const today = etDateKey();

  try {
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

    // ── Save canonical Pick rows to bot_daily_picks (status='locked')
    const pickMap = new Map<string, Pick>();
    for (const c of pool) {
      const p = candidateToPick(c, today);
      pickMap.set(`${c.player_name.toLowerCase()}|${c.prop_type}`, p);
    }
    const pickRows = [...pickMap.values()].map(p => ({
      id: p.id,
      pick_date: today,
      player_name: p.player_name,
      team: p.team,
      opponent: p.opponent,
      sport: p.sport,
      prop_type: p.prop_type,
      line: p.line,
      side: p.side,
      american_odds: p.american_odds,
      confidence: p.confidence,
      tier: p.tier,
      reasoning: p.reasoning,
      generator: p.generator,
      status: 'locked',
      generated_at: p.generated_at,
    }));
    await supabase.from('bot_daily_picks').upsert(pickRows, { onConflict: 'id' });

    // ── Build parlays (legs reference pick ids for traceability)
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
        const combinedProb = legs.reduce((acc, l) => acc * Math.max(0.4, Math.min(0.95, l.confidence)), 1);
        const payout = cfg.stake * decOdds;

        const legsJson = legs.map(l => {
          const p = pickMap.get(`${l.player_name.toLowerCase()}|${l.prop_type}`);
          return {
            pick_id: p?.id,
            player_name: l.player_name,
            prop_type: l.prop_type,
            line: l.line,
            side: l.side,
            odds: l.odds,
            source: l.source,
            confidence: l.confidence,
            recommended_side: 'under',
          };
        });

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

        if (!error && data) inserted.push({ id: data.id, tier: cfg.tier, legs: legsJson });
      }
    }

    // NOTE: No Telegram broadcast here. Orchestrator's pick_drops phase reads
    // bot_daily_picks (status='locked') and renders via voice/pick-formatter.

    return new Response(JSON.stringify({
      success: true,
      picks_saved: pickRows.length,
      parlays_generated: inserted.length,
      pool_size: pool.length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[rbi-v2] Error:', err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
