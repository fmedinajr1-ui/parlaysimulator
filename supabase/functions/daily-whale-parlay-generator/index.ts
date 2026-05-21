// ============================================================================
// daily-whale-parlay-generator
// Builds exactly one 3-leg cross-sport "Whale Parlay of the Day" from the
// freshest Tier-S / Tier-A whale_picks. Writes to ai_generated_parlays with
// strategy_used='whale_parlay_of_the_day'.
// Schedule: 12:00 ET and 16:30 ET via pg_cron.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_LEGS = 3;
const MIN_LEGS = 2;
const PICK_WINDOW_HOURS = 6;

type WhalePick = {
  id: string;
  sport: string | null;
  player_name: string | null;
  prop_type: string | null;
  side: string | null;
  current_line: number | null;
  whale_score: number | null;
  tier: string | null;
  signal_types: string[] | null;
  why_short_text: string | null;
  event_id: string | null;
  game_description: string | null;
  commence_time: string | null;
  current_over_price: number | null;
  current_under_price: number | null;
};

function americanToDecimal(odds: number | null): number {
  if (odds == null || !Number.isFinite(odds)) return 1.91;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

function pickPrice(p: WhalePick): number {
  return p.side === 'Over' ? americanToDecimal(p.current_over_price) : americanToDecimal(p.current_under_price);
}

function sportKey(s: string | null): string {
  return (s ?? 'unknown').toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    // Pull fresh Tier S / A picks, not expired, game starting within the window
    const horizon = new Date(Date.now() + PICK_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const { data: picks, error } = await supabase
      .from('whale_picks')
      .select('id,sport,player_name,prop_type,side,current_line,whale_score,tier,signal_types,why_short_text,event_id,game_description,commence_time,current_over_price,current_under_price')
      .in('tier', ['S', 'A'])
      .eq('is_expired', false)
      .gte('commence_time', new Date().toISOString())
      .lte('commence_time', horizon)
      .order('whale_score', { ascending: false })
      .limit(50);
    if (error) throw error;

    const pool = (picks ?? []) as WhalePick[];
    if (pool.length < MIN_LEGS) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'not_enough_picks', pool: pool.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build cross-sport 3-leg: greedy pick top score per sport, no two legs same game
    const usedSports = new Set<string>();
    const usedEvents = new Set<string>();
    const selected: WhalePick[] = [];
    for (const p of pool) {
      if (selected.length >= MAX_LEGS) break;
      const sk = sportKey(p.sport);
      const ek = p.event_id ?? '';
      if (usedSports.has(sk)) continue;
      if (ek && usedEvents.has(ek)) continue;
      selected.push(p);
      usedSports.add(sk);
      if (ek) usedEvents.add(ek);
    }

    // Fallback: if cross-sport gave us <2, allow same-sport but still distinct games
    if (selected.length < MIN_LEGS) {
      usedEvents.clear();
      selected.length = 0;
      for (const p of pool) {
        if (selected.length >= MAX_LEGS) break;
        const ek = p.event_id ?? '';
        if (ek && usedEvents.has(ek)) continue;
        selected.push(p);
        if (ek) usedEvents.add(ek);
      }
    }

    if (selected.length < MIN_LEGS) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'no_valid_combo', pool: pool.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Dedupe against today's existing whale parlay
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { data: existing } = await supabase
      .from('ai_generated_parlays')
      .select('id,legs,created_at')
      .eq('strategy_used', 'whale_parlay_of_the_day')
      .gte('created_at', todayStart.toISOString())
      .order('created_at', { ascending: false })
      .limit(5);
    const newKey = selected.map((p) => p.id).sort().join('|');
    const duplicate = (existing ?? []).some((row) => {
      const ids = ((row.legs as any[]) ?? []).map((l) => l.whale_pick_id).filter(Boolean).sort().join('|');
      return ids === newKey;
    });
    if (duplicate) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'duplicate' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const totalOdds = selected.reduce((acc, p) => acc * pickPrice(p), 1);
    const confidence = Math.min(95, Math.round(selected.reduce((acc, p) => acc + (p.whale_score ?? 0), 0) / selected.length));

    const legs = selected.map((p) => ({
      whale_pick_id: p.id,
      sport: p.sport,
      player_name: p.player_name,
      prop_type: p.prop_type,
      side: p.side,
      line: p.current_line,
      price: pickPrice(p),
      tier: p.tier,
      whale_score: p.whale_score,
      signal_types: p.signal_types ?? [],
      why: p.why_short_text,
      game: p.game_description,
      commence_time: p.commence_time,
    }));

    const signals = Array.from(new Set(selected.flatMap((p) => p.signal_types ?? [])));

    const { data: inserted, error: insErr } = await supabase
      .from('ai_generated_parlays')
      .insert({
        strategy_used: 'whale_parlay_of_the_day',
        signals_used: signals,
        legs,
        total_odds: Number(totalOdds.toFixed(2)),
        confidence_score: confidence,
        source_engines: ['smart-whale-engine'],
        sport: selected.length > 1 ? 'cross_sport' : selected[0]?.sport ?? null,
        cross_validated: true,
        ai_reasoning: `Whale Parlay of the Day — ${selected.length} legs, avg whale_score ${confidence}, signals: ${signals.join(', ')}.`,
        leg_sources: legs.map(() => 'whale_picks'),
      })
      .select('id')
      .single();
    if (insErr) throw insErr;

    // Broadcast to Telegram (admin channel) — this is what makes it real.
    let telegram: any = null;
    try {
      const lines: string[] = [];
      lines.push(`🐋 *Whale Parlay of the Day* — ${legs.length} legs`);
      lines.push(`Combined odds: *${totalOdds.toFixed(2)}x* · Confidence ${confidence}`);
      lines.push('');
      legs.forEach((l, i) => {
        lines.push(`${i + 1}. *${l.player_name}* — ${l.side} ${l.line} ${l.prop_type} _(Tier ${l.tier}, score ${l.whale_score})_`);
        if (l.game) lines.push(`   _${l.game}_`);
        if (l.why) lines.push(`   💡 ${l.why}`);
      });
      if (signals.length) {
        lines.push('');
        lines.push(`_Signals: ${signals.join(', ')}_`);
      }
      const message = lines.join('\n');
      const { data: sendResp, error: sendErr } = await supabase.functions.invoke('bot-send-telegram', {
        body: { message, parse_mode: 'Markdown', admin_only: true, type: 'whale_parlay_of_the_day' },
      });
      if (sendErr) console.warn('[whale-parlay] telegram send error:', sendErr);
      telegram = sendResp ?? null;
    } catch (tErr) {
      console.warn('[whale-parlay] telegram broadcast failed:', tErr);
    }

    return new Response(JSON.stringify({
      success: true,
      parlay_id: inserted?.id,
      legs: legs.length,
      total_odds: Number(totalOdds.toFixed(2)),
      confidence,
      pool_size: pool.length,
      telegram,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[daily-whale-parlay-generator] error:', err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});