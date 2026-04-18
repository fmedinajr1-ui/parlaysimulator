/**
 * generate-cross-sport-parlays-v2
 *
 * Replaces l3-cross-engine-parlay. INCLUDES MLB.
 * Mixes NBA Under + MLB Under RBI + SB Over (or HR Over).
 * 5 tickets/day at $20 stake. Confidence-tier gate only.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Leg {
  sport: string;
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
  const since = new Date(Date.now() - 18 * 3600 * 1000).toISOString();

  try {
    // NBA Under pool
    const { data: nbaSignals } = await supabase
      .from('engine_live_tracker')
      .select('*')
      .eq('sport', 'NBA')
      .eq('side', 'under')
      .gte('created_at', since)
      .order('confidence_score', { ascending: false })
      .limit(40);

    const nbaPool: Leg[] = (nbaSignals || []).map((s: any) => ({
      sport: 'NBA', player_name: s.player_name, prop_type: s.prop_type || 'points',
      line: Number(s.line || 0), side: 'under', odds: Number(s.odds || -115),
      confidence: Number(s.confidence_score || 0.55), source: 'nba_engine',
    })).filter(l => l.player_name);

    // MLB RBI Under pool
    const { data: mlbSignals } = await supabase
      .from('engine_live_tracker')
      .select('*')
      .eq('sport', 'MLB')
      .in('signal_source', ['mlb_rbi_under_analyzer', 'mlb-rbi-under-analyzer'])
      .gte('created_at', since)
      .limit(40);

    const mlbPool: Leg[] = (mlbSignals || []).map((s: any) => ({
      sport: 'MLB', player_name: s.player_name, prop_type: s.prop_type || 'batter_rbis',
      line: Number(s.line || 0.5), side: 'under', odds: Number(s.odds || -120),
      confidence: Number(s.confidence_score || 0.6), source: 'mlb_rbi',
    })).filter(l => l.player_name);

    // SB Over pool (from alerts)
    const { data: sbAlerts } = await supabase
      .from('fanduel_prediction_alerts')
      .select('*')
      .eq('signal_type', 'sb_over_l10')
      .in('tier', ['ELITE', 'HIGH'])
      .gte('created_at', since)
      .limit(20);

    const sbPool: Leg[] = (sbAlerts || []).map((a: any) => ({
      sport: 'MLB', player_name: a.player_name, prop_type: 'batter_stolen_bases',
      line: Number(a.line || 0.5), side: 'over', odds: Number(a.odds || 250),
      confidence: Number(a.confidence_score || 0.5), source: 'sb_alert',
    })).filter(l => l.player_name);

    // HR Over fallback (when SB pool thin)
    const { data: hrAlerts } = await supabase
      .from('fanduel_prediction_alerts')
      .select('*')
      .ilike('signal_type', '%hr%over%')
      .in('tier', ['ELITE', 'HIGH'])
      .gte('created_at', since)
      .limit(20);

    const hrPool: Leg[] = (hrAlerts || []).map((a: any) => ({
      sport: 'MLB', player_name: a.player_name, prop_type: 'batter_home_runs',
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

      const dec = legs.reduce((acc, l) => acc * americanToDecimal(l.odds), 1);
      const odds = decimalToAmerican(dec);
      const prob = legs.reduce((acc, l) => acc * Math.max(0.35, Math.min(0.85, l.confidence)), 1);

      const legsJson = legs.map(l => ({
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

      if (!error && data) inserted.push({ id: data.id, legs: legsJson, odds });
    }

    if (inserted.length) {
      const lines = [`🌐 *CROSS-SPORT PARLAYS v2 — ${today}*`, `📊 ${inserted.length} tickets | $${STAKE}/each`, ``];
      for (const p of inserted) {
        lines.push(`\n${p.legs.length}-leg | ${p.odds > 0 ? '+' : ''}${p.odds}`);
        for (const l of p.legs) lines.push(`  • [${l.sport}] ${l.player_name} ${l.side === 'over' ? 'O' : 'U'}${l.line} ${l.prop_type}`);
      }
      for (const chunk of chunkMessage(lines.join('\n'))) {
        await supabase.functions.invoke('bot-send-telegram', {
          body: { message: chunk, parse_mode: 'Markdown', admin_only: true },
        });
      }
    }

    return new Response(JSON.stringify({
      success: true, generated: inserted.length,
      pool_sizes: { nba: nbaPool.length, mlb: mlbPool.length, over: overPool.length },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[cross-sport-v2] Error:', err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
