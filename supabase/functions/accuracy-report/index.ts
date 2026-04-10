import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    // 1. Overall accuracy by signal type — split by settlement_method
    const { data: bySignal } = await supabase
      .from('fanduel_prediction_accuracy')
      .select('signal_type, was_correct, prop_type, created_at, settlement_method')
      .not('was_correct', 'is', null)
      .neq('actual_outcome', 'informational_excluded');

    if (!bySignal || bySignal.length === 0) {
      return new Response(JSON.stringify({ message: 'No verified data yet' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Split into "since changes" (last 48h) vs all-time
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const recent = bySignal.filter(r => r.created_at > cutoff);
    const allTime = bySignal;

    // Split by settlement method
    const clvRows = allTime.filter(r => r.settlement_method === 'clv');
    const outcomeRows = allTime.filter(r => r.settlement_method === 'outcome');
    const recentClv = recent.filter(r => r.settlement_method === 'clv');
    const recentOutcome = recent.filter(r => r.settlement_method === 'outcome');

    // Helper to compute accuracy breakdown
    const breakdown = (rows: typeof bySignal, groupKey: (r: any) => string) => {
      const map = new Map<string, { correct: number; total: number }>();
      for (const r of rows) {
        const k = groupKey(r);
        if (!map.has(k)) map.set(k, { correct: 0, total: 0 });
        const b = map.get(k)!;
        b.total++;
        if (r.was_correct) b.correct++;
      }
      return Array.from(map.entries())
        .map(([key, s]) => ({ key, accuracy: Math.round(s.correct / s.total * 100), n: s.total }))
        .sort((a, b) => b.n - a.n);
    };

    const calcAcc = (rows: typeof bySignal) => {
      const c = rows.filter(r => r.was_correct).length;
      const t = rows.length;
      return { correct: c, total: t, pct: t > 0 ? Math.round(c / t * 100) : 0 };
    };

    const signalBreakdown = breakdown(allTime, r => r.signal_type);
    const recentSignalBreakdown = breakdown(recent, r => r.signal_type);
    const propBreakdown = breakdown(
      allTime.filter(r => r.signal_type === 'line_about_to_move'),
      r => r.prop_type || 'unknown'
    );
    const recentPropBreakdown = breakdown(
      recent.filter(r => r.signal_type === 'line_about_to_move'),
      r => r.prop_type || 'unknown'
    );

    // Readable signal labels
    const SIGNAL_LABELS: Record<string, string> = {
      velocity_spike: 'Sharp Money Spike', cascade: 'Sustained Line Move',
      line_about_to_move: 'Early Line Signal', take_it_now: 'Snapback Value',
      trap_warning: 'Trap Alert', price_drift: 'Steady Drift',
      live_velocity_spike: 'Live Sharp Spike', live_cascade: 'Live Line Move',
      live_line_about_to_move: 'Live Early Signal',
    };
    const signalName = (s: string) => SIGNAL_LABELS[s] || s.replace(/_/g, ' ');

    // Build Telegram message
    const icon = (acc: number) => acc >= 60 ? '🟢' : acc >= 50 ? '🟡' : '🔴';
    const overall = calcAcc(allTime);
    const recentAcc = calcAcc(recent);
    const clvAcc = calcAcc(clvRows);
    const outcomeAcc = calcAcc(outcomeRows);
    const recentClvAcc = calcAcc(recentClv);
    const recentOutcomeAcc = calcAcc(recentOutcome);

    // Plain-English top-line
    let topLine = '';
    if (overall.pct >= 60) topLine = `System is running hot — ${overall.pct}% overall`;
    else if (overall.pct >= 50) topLine = `System is grinding — ${overall.pct}% overall, room to improve`;
    else topLine = `System needs work — ${overall.pct}% overall, check weak signals`;

    // Find best performing signal
    const bestSignal = signalBreakdown.filter(s => s.n >= 5).sort((a, b) => b.accuracy - a.accuracy)[0];
    if (bestSignal) topLine += `, ${signalName(bestSignal.key)} carrying the book`;

    const lines: string[] = [
      `📊 *ACCURACY CHECK-IN REPORT*`,
      ``,
      `💬 _${topLine}_`,
      ``,
      `*Overall:* ${icon(overall.pct)} ${overall.pct}% (${overall.correct}/${overall.total} picks)`,
      `*Last 48h:* ${icon(recentAcc.pct)} ${recentAcc.pct}% (${recentAcc.correct}/${recentAcc.total} picks)`,
      ``,
      `*── By Settlement Method ──*`,
      `📈 CLV (all): ${icon(clvAcc.pct)} ${clvAcc.pct}% (${clvAcc.total} picks)`,
      `🎯 Outcome (all): ${icon(outcomeAcc.pct)} ${outcomeAcc.pct}% (${outcomeAcc.total} picks)`,
      `📈 CLV (48h): ${icon(recentClvAcc.pct)} ${recentClvAcc.pct}% (${recentClvAcc.total} picks)`,
      `🎯 Outcome (48h): ${icon(recentOutcomeAcc.pct)} ${recentOutcomeAcc.pct}% (${recentOutcomeAcc.total} picks)`,
      ``,
      `*── By Signal (All-Time) ──*`,
      ...signalBreakdown.map(s => `${icon(s.accuracy)} ${signalName(s.key)}: ${s.accuracy}% (${s.n} picks)`),
      ``,
      `*── By Signal (Last 48h) ──*`,
      ...(recentSignalBreakdown.length > 0 
        ? recentSignalBreakdown.map(s => `${icon(s.accuracy)} ${signalName(s.key)}: ${s.accuracy}% (${s.n} picks)`)
        : ['No recent verified data yet']),
      ``,
      `*── Early Line Signal by Prop (All-Time) ──*`,
      ...propBreakdown.slice(0, 10).map(s => `${icon(s.accuracy)} ${s.key}: ${s.accuracy}% (${s.n} picks)`),
      ``,
      `*── Early Line Signal by Prop (Last 48h) ──*`,
      ...(recentPropBreakdown.length > 0
        ? recentPropBreakdown.slice(0, 10).map(s => `${icon(s.accuracy)} ${s.key}: ${s.accuracy}% (${s.n} picks)`)
        : ['Not enough recent data yet']),
    ];

    // Recommendations
    const recs: string[] = [];
    for (const s of signalBreakdown) {
      if (s.n >= 30 && s.accuracy < 40) recs.push(`⛔ Consider killing *${signalName(s.key)}* (${s.accuracy}% over ${s.n} picks)`);
      if (s.n >= 30 && s.accuracy >= 65) recs.push(`🚀 Boost *${signalName(s.key)}* — strong edge (${s.accuracy}% over ${s.n} picks)`);
    }
    for (const p of propBreakdown) {
      if (p.n >= 15 && p.accuracy < 40) recs.push(`🔄 Flip or suppress *${p.key}* props (${p.accuracy}% over ${p.n} picks)`);
      if (p.n >= 15 && p.accuracy >= 70) recs.push(`🔥 Boost *${p.key}* combo alerts (${p.accuracy}% over ${p.n} picks)`);
    }

    // Flag divergent methods
    if (clvAcc.total >= 20 && outcomeAcc.total >= 20) {
      const diff = Math.abs(clvAcc.pct - outcomeAcc.pct);
      if (diff >= 15) {
        recs.push(`⚠️ CLV vs Outcome divergence: ${diff}pp gap — investigate signal types with mixed methods`);
      }
    }

    if (recs.length > 0) {
      lines.push(``, `*── 🧠 RECOMMENDATIONS ──*`, ...recs);
    } else {
      lines.push(``, `_No strong recommendations yet — need more data._`);
    }

    const msg = lines.join('\n');

    // Send via Telegram
    try {
      await supabase.functions.invoke('bot-send-telegram', {
        body: { message: msg, parse_mode: 'Markdown', admin_only: true }
      });
    } catch (tgErr: any) {
      console.error('Telegram send error:', tgErr.message);
    }

    return new Response(JSON.stringify({
      success: true,
      overall: overall.pct,
      recentAcc: recentAcc.pct,
      clvAcc: clvAcc.pct,
      outcomeAcc: outcomeAcc.pct,
      signals: signalBreakdown.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('Accuracy report error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
