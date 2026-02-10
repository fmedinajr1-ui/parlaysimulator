/**
 * bot-daily-diagnostics
 * 
 * Daily health check: 7 checks + 3 improvement metrics.
 * Stores results in bot_diagnostic_runs and sends Telegram report.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CheckResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0];
    const twoDaysAgo = new Date(now.getTime() - 2 * 86400000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString().split('T')[0];
    const oneDayAgoISO = new Date(now.getTime() - 86400000).toISOString();

    const checks: CheckResult[] = [];

    // === 1. Data Freshness ===
    const { count: upcomingProps } = await supabase
      .from('unified_props')
      .select('*', { count: 'exact', head: true })
      .gte('game_date', today);

    if ((upcomingProps ?? 0) > 50) {
      checks.push({ name: 'Data Freshness', status: 'pass', detail: `${upcomingProps} upcoming props` });
    } else if ((upcomingProps ?? 0) > 0) {
      checks.push({ name: 'Data Freshness', status: 'warn', detail: `Only ${upcomingProps} upcoming props` });
    } else {
      checks.push({ name: 'Data Freshness', status: 'fail', detail: 'No upcoming props loaded' });
    }

    // === 2. Weight Calibration ===
    const { data: weights } = await supabase
      .from('bot_category_weights')
      .select('last_calibrated_at')
      .order('last_calibrated_at', { ascending: false })
      .limit(1);

    const lastCalibrated = weights?.[0]?.last_calibrated_at;
    if (lastCalibrated) {
      const hoursSince = (now.getTime() - new Date(lastCalibrated).getTime()) / 3600000;
      if (hoursSince < 48) {
        checks.push({ name: 'Weight Calibration', status: 'pass', detail: `${Math.round(hoursSince)}h ago` });
      } else {
        checks.push({ name: 'Weight Calibration', status: 'warn', detail: `Stale: ${Math.round(hoursSince)}h ago` });
      }
    } else {
      checks.push({ name: 'Weight Calibration', status: 'fail', detail: 'Never calibrated' });
    }

    // === 3. Parlay Generation ===
    const { count: yesterdayParlays } = await supabase
      .from('bot_daily_parlays')
      .select('*', { count: 'exact', head: true })
      .eq('parlay_date', yesterday);

    if ((yesterdayParlays ?? 0) > 0) {
      checks.push({ name: 'Parlay Generation', status: 'pass', detail: `${yesterdayParlays} parlays yesterday` });
    } else {
      checks.push({ name: 'Parlay Generation', status: 'fail', detail: 'No parlays generated yesterday' });
    }

    // === 4. Settlement Pipeline ===
    const { count: unsettledOld } = await supabase
      .from('bot_daily_parlays')
      .select('*', { count: 'exact', head: true })
      .eq('outcome', 'pending')
      .lt('created_at', twoDaysAgo);

    if ((unsettledOld ?? 0) === 0) {
      checks.push({ name: 'Settlement Pipeline', status: 'pass', detail: 'No backlog' });
    } else if ((unsettledOld ?? 0) <= 5) {
      checks.push({ name: 'Settlement Pipeline', status: 'warn', detail: `${unsettledOld} unsettled >48h` });
    } else {
      checks.push({ name: 'Settlement Pipeline', status: 'fail', detail: `${unsettledOld} unsettled >48h` });
    }

    // === 5. Blocked Categories ===
    const { count: totalCats } = await supabase
      .from('bot_category_weights')
      .select('*', { count: 'exact', head: true });

    const { count: blockedCats } = await supabase
      .from('bot_category_weights')
      .select('*', { count: 'exact', head: true })
      .eq('is_blocked', true);

    const blockedRatio = (totalCats ?? 0) > 0 ? (blockedCats ?? 0) / (totalCats ?? 1) : 0;
    if (blockedRatio < 0.3) {
      checks.push({ name: 'Blocked Categories', status: 'pass', detail: `${blockedCats}/${totalCats}` });
    } else if (blockedRatio < 0.5) {
      checks.push({ name: 'Blocked Categories', status: 'warn', detail: `${blockedCats}/${totalCats} blocked` });
    } else {
      checks.push({ name: 'Blocked Categories', status: 'fail', detail: `${blockedCats}/${totalCats} blocked` });
    }

    // === 6. Orphaned Data ===
    const { data: recentParlays } = await supabase
      .from('bot_daily_parlays')
      .select('id, legs')
      .gte('parlay_date', sevenDaysAgo)
      .eq('outcome', 'pending')
      .limit(100);

    let orphanCount = 0;
    if (recentParlays && recentParlays.length > 0) {
      const sweetSpotIds = new Set<string>();
      for (const p of recentParlays) {
        const legs = Array.isArray(p.legs) ? p.legs : [];
        for (const leg of legs) {
          if ((leg as any)?.sweet_spot_id) sweetSpotIds.add((leg as any).sweet_spot_id);
        }
      }
      if (sweetSpotIds.size > 0) {
        const { count: existingCount } = await supabase
          .from('category_sweet_spots')
          .select('*', { count: 'exact', head: true })
          .in('id', Array.from(sweetSpotIds));
        orphanCount = sweetSpotIds.size - (existingCount ?? 0);
      }
    }
    checks.push({
      name: 'Orphaned Data',
      status: orphanCount === 0 ? 'pass' : 'warn',
      detail: orphanCount === 0 ? 'None' : `${orphanCount} orphaned refs`,
    });

    // === 7. Cron Health ===
    const expectedJobs = ['parlay_generation', 'settlement', 'calibration', 'whale_scraper'];
    const { data: recentLogs } = await supabase
      .from('bot_activity_log')
      .select('event_type')
      .gte('created_at', oneDayAgoISO);

    const firedTypes = new Set((recentLogs || []).map(l => l.event_type));
    const missingJobs = expectedJobs.filter(j => !firedTypes.has(j));
    
    if (missingJobs.length === 0) {
      checks.push({ name: 'Cron Jobs', status: 'pass', detail: `${expectedJobs.length}/${expectedJobs.length} fired` });
    } else if (missingJobs.length <= 1) {
      checks.push({ name: 'Cron Jobs', status: 'warn', detail: `Missing: ${missingJobs.join(', ')}` });
    } else {
      checks.push({ name: 'Cron Jobs', status: 'fail', detail: `Missing: ${missingJobs.join(', ')}` });
    }

    // === IMPROVEMENT METRICS ===
    const { data: activationData } = await supabase
      .from('bot_activation_status')
      .select('check_date, parlays_won, parlays_lost, simulated_bankroll')
      .gte('check_date', fourteenDaysAgo)
      .order('check_date', { ascending: true });

    let improvementMetrics: Record<string, any> = {};

    if (activationData && activationData.length > 0) {
      // Win rate: last 7 days vs prior 7 days
      const recent7 = activationData.filter(d => d.check_date >= sevenDaysAgo);
      const prior7 = activationData.filter(d => d.check_date < sevenDaysAgo);

      const calcWinRate = (rows: typeof activationData) => {
        const won = rows.reduce((s, r) => s + (r.parlays_won ?? 0), 0);
        const lost = rows.reduce((s, r) => s + (r.parlays_lost ?? 0), 0);
        const total = won + lost;
        return total > 0 ? Math.round((won / total) * 100) : null;
      };

      const currentWR = calcWinRate(recent7);
      const priorWR = calcWinRate(prior7);
      improvementMetrics.win_rate = { current: currentWR, prior: priorWR, delta: currentWR !== null && priorWR !== null ? currentWR - priorWR : null };

      // Bankroll trajectory
      const currentBankroll = recent7.length > 0 ? recent7[recent7.length - 1].simulated_bankroll : null;
      const priorBankroll = prior7.length > 0 ? prior7[prior7.length - 1].simulated_bankroll : (recent7.length > 0 ? recent7[0].simulated_bankroll : null);
      improvementMetrics.bankroll = {
        current: currentBankroll,
        prior: priorBankroll,
        delta: currentBankroll !== null && priorBankroll !== null ? Math.round((currentBankroll ?? 0) - (priorBankroll ?? 0)) : null,
      };
    }

    // Weight stability (variance of weights)
    const { data: allWeights } = await supabase
      .from('bot_category_weights')
      .select('weight')
      .eq('is_blocked', false);

    if (allWeights && allWeights.length > 1) {
      const vals = allWeights.map(w => w.weight ?? 1);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
      const stdDev = Math.sqrt(variance);
      improvementMetrics.weight_stability = parseFloat(stdDev.toFixed(3));
    }

    // === STORE RESULTS ===
    const passed = checks.filter(c => c.status === 'pass').length;
    const warned = checks.filter(c => c.status === 'warn').length;
    const failed = checks.filter(c => c.status === 'fail').length;
    const overall = failed > 0 ? 'critical' : warned > 0 ? 'degraded' : 'healthy';

    await supabase.from('bot_diagnostic_runs').insert({
      run_date: today,
      checks_passed: passed,
      checks_warned: warned,
      checks_failed: failed,
      overall_status: overall,
      results: checks,
      improvement_metrics: improvementMetrics,
    });

    // === SEND TELEGRAM ===
    try {
      await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        },
        body: JSON.stringify({
          type: 'diagnostic_report',
          data: { checks, improvementMetrics, passed, warned, failed, overall },
        }),
      });
    } catch (e) {
      console.error('[Diagnostics] Telegram send failed:', e);
    }

    // Log activity
    await supabase.from('bot_activity_log').insert({
      event_type: 'diagnostic_run',
      message: `Daily diagnostic: ${passed} pass, ${warned} warn, ${failed} fail`,
      severity: failed > 0 ? 'error' : warned > 0 ? 'warning' : 'info',
      metadata: { passed, warned, failed, overall },
    });

    console.log(`[Diagnostics] Complete: ${passed}P/${warned}W/${failed}F = ${overall}`);

    return new Response(
      JSON.stringify({ success: true, passed, warned, failed, overall, checks, improvementMetrics }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[Diagnostics] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
