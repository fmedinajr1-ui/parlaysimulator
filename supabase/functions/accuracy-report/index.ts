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
    // 1. Overall accuracy by signal type
    const { data: bySignal } = await supabase
      .from('fanduel_prediction_accuracy')
      .select('signal_type, was_correct, prop_type, created_at')
      .not('was_correct', 'is', null);

    if (!bySignal || bySignal.length === 0) {
      return new Response(JSON.stringify({ message: 'No verified data yet' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Split into "since changes" (last 48h) vs all-time
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const recent = bySignal.filter(r => r.created_at > cutoff);
    const allTime = bySignal;

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

    // Build Telegram message
    const icon = (acc: number) => acc >= 60 ? '🟢' : acc >= 50 ? '🟡' : '🔴';
    const totalCorrect = allTime.filter(r => r.was_correct).length;
    const totalAll = allTime.length;
    const overallAcc = Math.round(totalCorrect / totalAll * 100);

    const recentCorrect = recent.filter(r => r.was_correct).length;
    const recentAll = recent.length;
    const recentAcc = recentAll > 0 ? Math.round(recentCorrect / recentAll * 100) : 0;

    const lines: string[] = [
      `📊 *ACCURACY CHECK-IN REPORT*`,
      ``,
      `*Overall:* ${icon(overallAcc)} ${overallAcc}% (${totalCorrect}/${totalAll})`,
      `*Last 48h:* ${icon(recentAcc)} ${recentAcc}% (${recentCorrect}/${recentAll})`,
      ``,
      `*── By Signal (All-Time) ──*`,
      ...signalBreakdown.map(s => `${icon(s.accuracy)} ${s.key}: ${s.accuracy}% (n=${s.n})`),
      ``,
      `*── By Signal (Last 48h) ──*`,
      ...(recentSignalBreakdown.length > 0 
        ? recentSignalBreakdown.map(s => `${icon(s.accuracy)} ${s.key}: ${s.accuracy}% (n=${s.n})`)
        : ['No recent verified data yet']),
      ``,
      `*── Line-About-To-Move by Prop (All-Time) ──*`,
      ...propBreakdown.slice(0, 10).map(s => `${icon(s.accuracy)} ${s.key}: ${s.accuracy}% (n=${s.n})`),
      ``,
      `*── Line-About-To-Move by Prop (Last 48h) ──*`,
      ...(recentPropBreakdown.length > 0
        ? recentPropBreakdown.slice(0, 10).map(s => `${icon(s.accuracy)} ${s.key}: ${s.accuracy}% (n=${s.n})`)
        : ['Not enough recent data yet']),
    ];

    // Recommendations
    const recs: string[] = [];
    for (const s of signalBreakdown) {
      if (s.n >= 30 && s.accuracy < 40) recs.push(`⛔ Consider killing *${s.key}* (${s.accuracy}%)`);
      if (s.n >= 30 && s.accuracy >= 65) recs.push(`🚀 Boost *${s.key}* — strong edge (${s.accuracy}%)`);
    }
    for (const p of propBreakdown) {
      if (p.n >= 15 && p.accuracy < 40) recs.push(`🔄 Flip or suppress *${p.key}* props (${p.accuracy}%)`);
      if (p.n >= 15 && p.accuracy >= 70) recs.push(`🔥 Boost *${p.key}* combo alerts (${p.accuracy}%)`);
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

    return new Response(JSON.stringify({ success: true, overall: overallAcc, recentAcc, signals: signalBreakdown.length }), {
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
