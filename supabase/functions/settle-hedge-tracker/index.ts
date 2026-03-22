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

    // SOURCE 1: Fetch actual values from category_sweet_spots
    const { data: outcomes } = await supabase
      .from('category_sweet_spots')
      .select('player_name, prop_type, actual_value, analysis_date')
      .in('analysis_date', dates)
      .not('actual_value', 'is', null);

    // Build lookup from sweet spots
    const outcomeLookup = new Map<string, number>();
    if (outcomes) {
      for (const o of outcomes) {
        const key = `${o.player_name.toLowerCase().trim()}_${o.prop_type.toLowerCase().trim()}_${o.analysis_date}`;
        outcomeLookup.set(key, o.actual_value);
      }
    }
    console.log(`[settle-hedge-tracker] Sweet spots lookup: ${outcomeLookup.size} entries`);

    // SOURCE 2: Fallback — extract actual values from settled parlay legs
    const { data: settledParlays } = await supabase
      .from('bot_daily_parlays')
      .select('legs, parlay_date')
      .in('parlay_date', dates)
      .not('outcome', 'is', null);

    if (settledParlays) {
      for (const p of settledParlays) {
        const legs = Array.isArray(p.legs) ? p.legs : [];
        for (const leg of legs) {
          if (leg.actual_value != null && leg.player_name && leg.prop_type) {
            const key = `${leg.player_name.toLowerCase().trim()}_${leg.prop_type.toLowerCase().trim()}_${p.parlay_date}`;
            if (!outcomeLookup.has(key)) {
              outcomeLookup.set(key, leg.actual_value);
            }
          }
        }
      }
    }
    console.log(`[settle-hedge-tracker] Total lookup after parlay fallback: ${outcomeLookup.size} entries`);

    // SOURCE 3: Fallback — extract from daily_elite_leg_outcomes
    const { data: eliteLegs } = await supabase
      .from('daily_elite_leg_outcomes')
      .select('player_name, prop_type, actual_value, created_at')
      .not('actual_value', 'is', null)
      .limit(2000);

    if (eliteLegs) {
      for (const el of eliteLegs) {
        if (el.actual_value != null && el.player_name && el.prop_type) {
          const legDate = el.created_at?.split('T')[0];
          if (legDate && dates.includes(legDate)) {
            const key = `${el.player_name.toLowerCase().trim()}_${el.prop_type.toLowerCase().trim()}_${legDate}`;
            if (!outcomeLookup.has(key)) {
              outcomeLookup.set(key, el.actual_value);
            }
          }
        }
      }
    }
    console.log(`[settle-hedge-tracker] Total lookup after elite legs fallback: ${outcomeLookup.size} entries`);

    if (outcomeLookup.size === 0) {
      return new Response(JSON.stringify({ settled: 0, message: 'No actual values found from any source' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let settledCount = 0;
    let unmatchedCount = 0;
    const unmatchedPlayers: string[] = [];
    const statusCounts: Record<string, { total: number; correct: number }> = {};

    for (const row of unsettled) {
      const key = `${row.player_name.toLowerCase().trim()}_${row.prop_type.toLowerCase().trim()}_${row.analysis_date}`;
      const actualValue = outcomeLookup.get(key);
      if (actualValue === undefined) {
        unmatchedCount++;
        if (unmatchedPlayers.length < 10) unmatchedPlayers.push(`${row.player_name} ${row.prop_type} ${row.analysis_date}`);
        continue;
      }

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
        hedgeWasCorrect = outcome === 'hit';
      } else if (status === 'HEDGE NOW' || status === 'HEDGE ALERT') {
        hedgeWasCorrect = outcome === 'miss';
      } else {
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
        if (!statusCounts[status]) statusCounts[status] = { total: 0, correct: 0 };
        statusCounts[status].total++;
        if (hedgeWasCorrect) statusCounts[status].correct++;
      }
    }

    console.log(`[settle-hedge-tracker] Settled ${settledCount}, unmatched ${unmatchedCount}`);
    if (unmatchedPlayers.length > 0) {
      console.log(`[settle-hedge-tracker] Unmatched samples: ${unmatchedPlayers.join(', ')}`);
    }

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
      if (unmatchedCount > 0) {
        summaryMsg += `\n⚠️ ${unmatchedCount} picks could not be graded (no stat data)`;
      }

      try {
        await supabase.functions.invoke('bot-send-telegram', {
          body: { type: 'hedge_accuracy', data: { message: summaryMsg } },
        });
        console.log('[settle-hedge-tracker] Sent accuracy summary to Telegram');
      } catch (tgErr) {
        console.error('[settle-hedge-tracker] Telegram send error:', tgErr);
      }
    }

    return new Response(JSON.stringify({ settled: settledCount, unmatched: unmatchedCount, total: unsettled.length, statusCounts }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[settle-hedge-tracker] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
