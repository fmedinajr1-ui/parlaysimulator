/**
 * generate-cross-sport-parlays-v2  (Phase 3 v2 migration)
 *
 * Mixes NBA Under + MLB Under RBI + SB Over (or HR Over).
 * Writes Pick rows to bot_daily_picks; orchestrator handles broadcast.
 * 5 tickets/day at $20 stake.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Pick } from '../_shared/constants.ts';
import { etDateKey } from '../_shared/date-et.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Leg {
  sport: string;          // 'NBA' | 'MLB'
  sport_key: string;      // 'basketball_nba' | 'baseball_mlb'
  player_name: string;
  prop_type: string;
  line: number;
  side: 'over' | 'under';
  odds: number;
  confidence: number;
  source: string;
}

const americanToDecimal = (o: number) => !o ? 1.91 : (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
const decimalToAmerican = (d: number) => d <= 1 ? -10000 : d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));

function legToPick(l: Leg, today: string): Pick {
  const slug = l.player_name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const conf100 = Math.round(Math.max(0.35, Math.min(0.85, l.confidence)) * 100);
  return {
    id: `xsport_${l.sport.toLowerCase()}_${slug}_${l.prop_type}_${today}`,
    sport: l.sport_key,
    player_name: l.player_name,
    prop_type: l.prop_type,
    line: l.line,
    side: l.side,
    american_odds: l.odds,
    confidence: conf100,
    tier: conf100 >= 75 ? 'high' : conf100 >= 60 ? 'medium' : 'exploration',
    reasoning: {
      headline: `${l.player_name} ${l.side === 'over' ? 'O' : 'U'}${l.line} (${l.sport}) — sourced from ${l.source} for the cross-sport mix.`,
      drivers: [
        `Source engine: ${l.source}`,
        `Posted at ${l.odds > 0 ? '+' : ''}${l.odds}`,
      ],
      risk_note: 'Cross-sport parlays compound variance — any single sport going cold sinks the ticket.',
      sources: [l.source],
    },
    generated_at: new Date().toISOString(),
    generator: 'cross_sport_v2',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const today = etDateKey();
  const since = new Date(Date.now() - 18 * 3600 * 1000).toISOString();

  try {
    // NBA Under
    const { data: nbaSignals } = await supabase
      .from('engine_live_tracker').select('*')
      .eq('sport', 'NBA').eq('side', 'under').gte('created_at', since)
      .order('confidence_score', { ascending: false }).limit(40);
    const nbaPool: Leg[] = (nbaSignals || []).map((s: any) => ({
      sport: 'NBA', sport_key: 'basketball_nba',
      player_name: s.player_name, prop_type: s.prop_type || 'points',
      line: Number(s.line || 0), side: 'under', odds: Number(s.odds || -115),
      confidence: Number(s.confidence_score || 0.55), source: 'nba_engine',
    })).filter(l => l.player_name);

    // MLB RBI Under
    const { data: mlbSignals } = await supabase
      .from('engine_live_tracker').select('*')
      .eq('sport', 'MLB')
      .in('signal_source', ['mlb_rbi_under_analyzer', 'mlb-rbi-under-analyzer'])
      .gte('created_at', since).limit(40);
    const mlbPool: Leg[] = (mlbSignals || []).map((s: any) => ({
      sport: 'MLB', sport_key: 'baseball_mlb',
      player_name: s.player_name, prop_type: s.prop_type || 'batter_rbis',
      line: Number(s.line || 0.5), side: 'under', odds: Number(s.odds || -120),
      confidence: Number(s.confidence_score || 0.6), source: 'mlb_rbi',
    })).filter(l => l.player_name);

    // SB Over
    const { data: sbAlerts } = await supabase
      .from('fanduel_prediction_alerts').select('*')
      .eq('signal_type', 'sb_over_l10').in('tier', ['ELITE', 'HIGH'])
      .gte('created_at', since).limit(20);
    const sbPool: Leg[] = (sbAlerts || []).map((a: any) => ({
      sport: 'MLB', sport_key: 'baseball_mlb',
      player_name: a.player_name, prop_type: 'batter_stolen_bases',
      line: Number(a.line || 0.5), side: 'over', odds: Number(a.odds || 250),
      confidence: Number(a.confidence_score || 0.5), source: 'sb_alert',
    })).filter(l => l.player_name);

    // HR Over fallback
    const { data: hrAlerts } = await supabase
      .from('fanduel_prediction_alerts').select('*')
      .ilike('signal_type', '%hr%over%').in('tier', ['ELITE', 'HIGH'])
      .gte('created_at', since).limit(20);
    const hrPool: Leg[] = (hrAlerts || []).map((a: any) => ({
      sport: 'MLB', sport_key: 'baseball_mlb',
      player_name: a.player_name, prop_type: 'batter_home_runs',
      line: Number(a.line || 0.5), side: 'over', odds: Number(a.odds || 350),
      confidence: Number(a.confidence_score || 0.45), source: 'hr_alert',
    })).filter(l => l.player_name);

    const overPool = [...sbPool, ...hrPool];

    if (nbaPool.length === 0 && mlbPool.length === 0 && overPool.length === 0) {
      return new Response(JSON.stringify({ success: false, reason: 'all_pools_empty' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const inserted: any[] = [];
    const used = new Set<string>();
    const TICKETS = 5, STAKE = 20;
    const allLegsUsed: Leg[] = [];

    for (let i = 0; i < TICKETS; i++) {
      const legs: Leg[] = [];
      const pickFrom = (pool: Leg[]) => {
        for (const l of pool) {
          const k = `${l.sport}|${l.player_name.toLowerCase()}|${l.prop_type}`;
          if (used.has(k)) continue;
          used.add(k);
          return l;
        }
        return null;
      };

      const a = pickFrom(nbaPool); if (a) legs.push(a);
      const b = pickFrom(mlbPool); if (b) legs.push(b);
      const c = pickFrom(overPool); if (c) legs.push(c);

      if (legs.length < 2) continue;
      allLegsUsed.push(...legs);

      const dec = legs.reduce((acc, l) => acc * americanToDecimal(l.odds), 1);
      const odds = decimalToAmerican(dec);
      const prob = legs.reduce((acc, l) => acc * Math.max(0.35, Math.min(0.85, l.confidence)), 1);

      // Save pick rows for legs in this ticket
      const ticketPicks = legs.map(l => legToPick(l, today));
      const pickRows = ticketPicks.map(p => ({
        id: p.id, pick_date: today,
        player_name: p.player_name, sport: p.sport, prop_type: p.prop_type,
        line: p.line, side: p.side, american_odds: p.american_odds,
        confidence: p.confidence, tier: p.tier, reasoning: p.reasoning,
        generator: p.generator, status: 'locked', generated_at: p.generated_at,
      }));
      await supabase.from('bot_daily_picks').upsert(pickRows, { onConflict: 'id' });

      const legsJson = legs.map((l, idx) => ({
        pick_id: ticketPicks[idx].id,
        player_name: l.player_name, prop_type: l.prop_type, line: l.line,
        side: l.side, odds: l.odds, sport: l.sport, source: l.source, confidence: l.confidence,
        recommended_side: l.side,
      }));

      const { data, error } = await supabase.from('bot_daily_parlays').insert({
        parlay_date: today,
        strategy_name: 'cross_sport_v2',
        tier: `XSPORT_${legs.length}L`,
        leg_count: legs.length,
        legs: legsJson,
        combined_probability: prob,
        expected_odds: odds,
        simulated_stake: STAKE,
        simulated_payout: STAKE * dec,
        is_simulated: true,
        outcome: 'pending',
        selection_rationale: `Cross-sport v2 (NBA+MLB+Over) | ${legs.map(l => l.sport).join('/')}`,
      }).select('id').single();

      if (!error && data) inserted.push({ id: data.id });
    }

    return new Response(JSON.stringify({
      success: true,
      parlays_generated: inserted.length,
      picks_saved: allLegsUsed.length,
      pool_sizes: { nba: nbaPool.length, mlb: mlbPool.length, over: overPool.length },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[cross-sport-v2] Error:', err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
