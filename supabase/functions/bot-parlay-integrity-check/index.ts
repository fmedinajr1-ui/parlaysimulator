/**
 * bot-parlay-integrity-check
 *
 * Runs after each generation run. Queries bot_daily_parlays for today
 * and alerts via Telegram if any 1-leg or 2-leg parlays are found.
 * On a clean run, logs silently to bot_activity_log with no Telegram noise.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse optional date override from body
    let body: { date?: string } = {};
    try {
      body = await req.json();
    } catch (_) { /* no body is fine */ }

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const targetDate = body?.date || today;

    console.log(`[Integrity] Checking parlays for ${targetDate}`);

    // Query for any 1-leg or 2-leg parlays
    const { data: violations, error } = await supabase
      .from('bot_daily_parlays')
      .select('id, leg_count, strategy_name, tier')
      .eq('parlay_date', targetDate)
      .in('leg_count', [1, 2]);

    if (error) {
      console.error('[Integrity] Query error:', error);
      throw error;
    }

    const oneLeg = violations?.filter(p => p.leg_count === 1) || [];
    const twoLeg = violations?.filter(p => p.leg_count === 2) || [];
    const total = oneLeg.length + twoLeg.length;

    if (total === 0) {
      // Silent pass — log to activity log only, no Telegram
      await supabase.from('bot_activity_log').insert({
        event_type: 'integrity_check_pass',
        message: `Integrity check passed for ${targetDate}: 0 violations`,
        severity: 'info',
        metadata: { date: targetDate, violations: 0 },
      });

      console.log(`[Integrity] ✅ All clear for ${targetDate}`);

      return new Response(
        JSON.stringify({ clean: true, violations: 0, date: targetDate }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Violations found — build strategy breakdown
    const strategyCounts: Record<string, number> = {};
    for (const p of violations || []) {
      const name = p.strategy_name || 'unknown';
      strategyCounts[name] = (strategyCounts[name] || 0) + 1;
    }

    console.error(`[Integrity] ❌ ${total} violations found for ${targetDate}: ${oneLeg.length} one-leg, ${twoLeg.length} two-leg`);

    // Fire Telegram integrity alert — bypasses quiet hours via type='integrity_alert'
    try {
      await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          type: 'integrity_alert',
          data: {
            date: targetDate,
            oneLegCount: oneLeg.length,
            twoLegCount: twoLeg.length,
            total,
            strategyCounts,
          },
        }),
      });
    } catch (telegramError) {
      console.error('[Integrity] Telegram alert failed:', telegramError);
    }

    // Log failure to activity log
    await supabase.from('bot_activity_log').insert({
      event_type: 'integrity_check_fail',
      message: `Integrity check FAILED for ${targetDate}: ${oneLeg.length} one-leg, ${twoLeg.length} two-leg parlays found`,
      severity: 'error',
      metadata: {
        date: targetDate,
        one_leg_count: oneLeg.length,
        two_leg_count: twoLeg.length,
        total,
        strategy_counts: strategyCounts,
        violation_ids: violations?.map(v => v.id) || [],
      },
    });

    return new Response(
      JSON.stringify({
        clean: false,
        violations: total,
        one_leg: oneLeg.length,
        two_leg: twoLeg.length,
        strategy_counts: strategyCounts,
        date: targetDate,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Integrity] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
