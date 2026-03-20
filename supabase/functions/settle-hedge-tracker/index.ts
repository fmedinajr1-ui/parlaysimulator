import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find unsettled hedge tracker rows
    const { data: unsettled, error: fetchError } = await supabase
      .from('hedge_telegram_tracker')
      .select('id, player_name, prop_type, line, side, analysis_date, last_status_sent')
      .is('outcome', null)
      .not('last_status_sent', 'is', null)
      .order('analysis_date', { ascending: false })
      .limit(500);

    if (fetchError) {
      console.error('[settle-hedge-tracker] Fetch error:', fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!unsettled || unsettled.length === 0) {
      return new Response(JSON.stringify({ settled: 0, message: 'No unsettled hedge tracker rows' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[settle-hedge-tracker] Found ${unsettled.length} unsettled rows`);

    const dates = [...new Set(unsettled.map(s => s.analysis_date))];

    // Fetch actual values from category_sweet_spots
    const { data: outcomes, error: outcomeError } = await supabase
      .from('category_sweet_spots')
      .select('player_name, prop_type, recommended_line, actual_value, analysis_date')
      .in('analysis_date', dates)
      .not('actual_value', 'is', null);

    if (outcomeError) {
      console.error('[settle-hedge-tracker] Outcome fetch error:', outcomeError);
      return new Response(JSON.stringify({ error: outcomeError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!outcomes || outcomes.length === 0) {
      return new Response(JSON.stringify({ settled: 0, message: 'No settled outcomes found' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build lookup
    const outcomeLookup = new Map<string, number>();
    for (const o of outcomes) {
      const key = `${o.player_name.toLowerCase().trim()}_${o.prop_type.toLowerCase().trim()}_${o.analysis_date}`;
      outcomeLookup.set(key, o.actual_value);
    }

    let settledCount = 0;
    const statusCounts: Record<string, { total: number; correct: number }> = {};

    for (const row of unsettled) {
      const key = `${row.player_name.toLowerCase().trim()}_${row.prop_type.toLowerCase().trim()}_${row.analysis_date}`;
      const actualValue = outcomeLookup.get(key);
      if (actualValue === undefined) continue;

      const isOver = (row.side ?? 'over').toLowerCase() === 'over';
      let outcome: string;

      if (actualValue === row.line) {
        outcome = 'push';
      } else if (isOver) {
        outcome = actualValue > row.line ? 'hit' : 'miss';
      } else {
        outcome = actualValue < row.line ? 'hit' : 'miss';
      }

      // Determine if hedge recommendation was correct
      const status = row.last_status_sent;
      let hedgeWasCorrect: boolean;

      if (status === 'LOCK' || status === 'HOLD') {
        hedgeWasCorrect = outcome === 'hit'; // Told to hold → correct if it hit
      } else if (status === 'HEDGE NOW' || status === 'HEDGE ALERT') {
        hedgeWasCorrect = outcome === 'miss'; // Warned to hedge → correct if it missed
      } else {
        // MONITOR — neutral, count as correct if it hit (didn't escalate)
        hedgeWasCorrect = outcome === 'hit';
      }

      const { error: updateError } = await supabase
        .from('hedge_telegram_tracker')
        .update({
          actual_value: actualValue,
          outcome,
          hedge_was_correct: hedgeWasCorrect,
        })
        .eq('id', row.id);

      if (updateError) {
        console.error(`[settle-hedge-tracker] Update error for ${row.id}:`, updateError);
      } else {
        settledCount++;
        // Track accuracy by status
        if (!statusCounts[status]) statusCounts[status] = { total: 0, correct: 0 };
        statusCounts[status].total++;
        if (hedgeWasCorrect) statusCounts[status].correct++;
      }
    }

    console.log(`[settle-hedge-tracker] Settled ${settledCount} rows`);

    // Build accuracy summary for Telegram
    if (settledCount > 0) {
      const dateLabel = dates.length === 1 ? dates[0] : `${dates.length} dates`;
      let summaryMsg = `📊 HEDGE ACCURACY — ${dateLabel}\n━━━━━━━━━━━━━━━━━━━━━\n\n`;

      const statusOrder = ['LOCK', 'HOLD', 'MONITOR', 'HEDGE ALERT', 'HEDGE NOW'];
      let totalAll = 0;
      let correctAll = 0;

      for (const status of statusOrder) {
        const counts = statusCounts[status];
        if (!counts) continue;
        const pct = ((counts.correct / counts.total) * 100).toFixed(1);
        const emoji = counts.correct / counts.total >= 0.8 ? '✅' : counts.correct / counts.total >= 0.6 ? '🟡' : '❌';
        summaryMsg += `${status}: ${counts.total} picks, ${counts.correct} correct (${pct}%) ${emoji}\n`;
        totalAll += counts.total;
        correctAll += counts.correct;
      }

      const overallPct = totalAll > 0 ? ((correctAll / totalAll) * 100).toFixed(1) : '0';
      summaryMsg += `\n📈 Overall accuracy: ${overallPct}% (${correctAll}/${totalAll})`;

      try {
        await supabase.functions.invoke('bot-send-telegram', {
          body: { type: 'hedge_accuracy', data: { message: summaryMsg } },
        });
        console.log('[settle-hedge-tracker] Sent accuracy summary to Telegram');
      } catch (tgErr) {
        console.error('[settle-hedge-tracker] Telegram send error:', tgErr);
      }
    }

    return new Response(JSON.stringify({ settled: settledCount, total: unsettled.length, statusCounts }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[settle-hedge-tracker] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
