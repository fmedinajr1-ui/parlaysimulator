// ============================================================================
// daily-fade-parlay-generator
// Builds the daily "Fade Parlay of the Day" from velocity_spike alerts where
// the strength meter labels the pick STRONG_FADE or LEAN_FADE and the engine
// reasoning verdict is NEUTRAL. Prefers STRONG_FADE legs, fills with
// LEAN_FADE. Picks 2–5 legs across distinct events, broadcasts to Telegram.
// Schedule: 10:00 AM ET via pg_cron.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MIN_LEGS = 2;
const MAX_LEGS = 5;

type Alert = {
  id: string;
  player_name: string | null;
  sport: string | null;
  prop_type: string | null;
  prediction: string | null;
  event_id: string | null;
  event_description: string | null;
  commence_time: string | null;
  metadata: any;
};

function americanToDecimal(odds: number | null): number {
  if (odds == null || !Number.isFinite(odds)) return 1.91;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

function pickPrice(a: Alert): number {
  const side = (a.prediction ?? '').toLowerCase();
  const op = Number(a.metadata?.over_price);
  const up = Number(a.metadata?.under_price);
  const price = side === 'over' ? op : up;
  return americanToDecimal(Number.isFinite(price) ? price : null);
}

function americanString(odds: number | null | undefined): string {
  if (odds == null || !Number.isFinite(Number(odds))) return '—';
  const n = Number(odds);
  return n > 0 ? `+${n}` : `${n}`;
}

function propLabel(p: string | null): string {
  if (!p) return '';
  return p
    .replace(/^player_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    // Pull velocity_spike alerts for games that haven't started yet.
    const { data, error } = await supabase
      .from('fanduel_prediction_alerts')
      .select('id,player_name,sport,prop_type,prediction,event_id,event_description,commence_time,metadata')
      .eq('signal_type', 'velocity_spike')
      .gte('commence_time', new Date().toISOString())
      .order('commence_time', { ascending: true })
      .limit(500);
    if (error) throw error;

    const pool: Alert[] = (data ?? []).filter((a: any) => {
      const label = a?.metadata?.strength?.label;
      const verdict = a?.metadata?.engine_reasoning?.verdict;
      return (label === 'STRONG_FADE' || label === 'LEAN_FADE') && verdict === 'NEUTRAL';
    });

    if (pool.length < MIN_LEGS) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'not_enough_picks', pool: pool.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Sort: STRONG_FADE first, then LEAN_FADE; within each, highest meter first.
    pool.sort((a, b) => {
      const la = a.metadata?.strength?.label === 'STRONG_FADE' ? 0 : 1;
      const lb = b.metadata?.strength?.label === 'STRONG_FADE' ? 0 : 1;
      if (la !== lb) return la - lb;
      const ma = Number(a.metadata?.strength?.meter ?? 0);
      const mb = Number(b.metadata?.strength?.meter ?? 0);
      return mb - ma;
    });

    // Greedy: distinct event_id only.
    const usedEvents = new Set<string>();
    const selected: Alert[] = [];
    for (const a of pool) {
      if (selected.length >= MAX_LEGS) break;
      const ek = a.event_id ?? `${a.event_description ?? ''}|${a.commence_time ?? ''}`;
      if (usedEvents.has(ek)) continue;
      selected.push(a);
      usedEvents.add(ek);
    }

    if (selected.length < MIN_LEGS) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'no_valid_combo', pool: pool.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Dedupe against today's existing fade parlay.
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { data: existing } = await supabase
      .from('ai_generated_parlays')
      .select('id,legs,created_at')
      .eq('strategy_used', 'fade_parlay_of_the_day')
      .gte('created_at', todayStart.toISOString())
      .order('created_at', { ascending: false })
      .limit(5);
    const newKey = selected.map((a) => a.id).sort().join('|');
    const duplicate = (existing ?? []).some((row) => {
      const ids = ((row.legs as any[]) ?? []).map((l) => l.alert_id).filter(Boolean).sort().join('|');
      return ids === newKey;
    });
    if (duplicate) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'duplicate' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const totalOdds = selected.reduce((acc, a) => acc * pickPrice(a), 1);
    const avgMeter = Math.round(
      selected.reduce((acc, a) => acc + Number(a.metadata?.strength?.meter ?? 0), 0) / selected.length,
    );
    const sports = Array.from(new Set(selected.map((a) => (a.sport ?? '').toUpperCase()).filter(Boolean)));

    const legs = selected.map((a) => ({
      alert_id: a.id,
      sport: a.sport,
      player_name: a.player_name,
      prop_type: a.prop_type,
      side: a.prediction,
      line: a.metadata?.line ?? null,
      price: pickPrice(a),
      over_price: a.metadata?.over_price ?? null,
      under_price: a.metadata?.under_price ?? null,
      strength_label: a.metadata?.strength?.label ?? null,
      meter: a.metadata?.strength?.meter ?? null,
      cohort_reason: a.metadata?.strength?.reason ?? null,
      verdict: 'NEUTRAL',
      event_id: a.event_id,
      game: a.event_description,
      commence_time: a.commence_time,
    }));

    const { data: inserted, error: insErr } = await supabase
      .from('ai_generated_parlays')
      .insert({
        strategy_used: 'fade_parlay_of_the_day',
        signals_used: ['velocity_spike_fade_neutral'],
        legs,
        total_odds: Number(totalOdds.toFixed(2)),
        confidence_score: avgMeter,
        source_engines: ['fanduel_prediction_alerts'],
        sport: sports.length > 1 ? 'cross_sport' : (sports[0] ?? null),
        cross_validated: true,
        ai_reasoning: `Fade Parlay of the Day — ${legs.length} legs, avg meter ${avgMeter}. Public-side fade plays where engine verdict is NEUTRAL and cohort history favors the opposite side.`,
        leg_sources: legs.map(() => 'fanduel_prediction_alerts'),
      })
      .select('id')
      .single();
    if (insErr) throw insErr;

    // Broadcast to Telegram (admin channel).
    let telegram: any = null;
    try {
      const lines: string[] = [];
      lines.push(`🎯 *Fade Parlay of the Day* — ${legs.length} legs`);
      lines.push(`Combined odds: *${totalOdds.toFixed(2)}x* · Avg meter ${avgMeter}`);
      lines.push(`_Public-fade · engine NEUTRAL · cohort says inverse_`);
      lines.push('');
      legs.forEach((l, i) => {
        const sideEmoji = (l.side ?? '').toLowerCase() === 'over' ? '⬆️' : '⬇️';
        const priceAmerican = (l.side ?? '').toLowerCase() === 'over' ? l.over_price : l.under_price;
        const badge = l.strength_label === 'STRONG_FADE' ? '🔴 STRONG_FADE' : '🟠 LEAN_FADE';
        lines.push(`${i + 1}. *${l.player_name}* — ${sideEmoji} ${l.side} ${l.line} ${propLabel(l.prop_type)} (${americanString(Number(priceAmerican))})`);
        lines.push(`   ${badge} · meter ${l.meter}`);
        if (l.game) lines.push(`   _${l.game}_`);
        if (l.cohort_reason) lines.push(`   ↳ ${l.cohort_reason}`);
      });
      const message = lines.join('\n');
      const { data: sendResp, error: sendErr } = await supabase.functions.invoke('bot-send-telegram', {
        body: { message, parse_mode: 'Markdown', admin_only: true, type: 'fade_parlay_of_the_day' },
      });
      if (sendErr) console.warn('[fade-parlay] telegram send error:', sendErr);
      telegram = sendResp ?? null;
    } catch (tErr) {
      console.warn('[fade-parlay] telegram broadcast failed:', tErr);
    }

    return new Response(JSON.stringify({
      success: true,
      parlay_id: inserted?.id,
      legs: legs.length,
      total_odds: Number(totalOdds.toFixed(2)),
      avg_meter: avgMeter,
      pool_size: pool.length,
      telegram,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[daily-fade-parlay-generator] error:', err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});