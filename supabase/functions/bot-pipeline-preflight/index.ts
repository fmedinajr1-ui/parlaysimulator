import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const today = getEasternDate();
  const checks: CheckResult[] = [];
  const blockers: string[] = [];

  try {
    // 1. Odds distribution check — each active sport needs ≥10 props, not just global count
    const { data: propsBySport } = await supabase
      .from('unified_props')
      .select('sport')
      .gte('created_at', `${today}T00:00:00`);

    const sportCounts: Record<string, number> = {};
    for (const row of propsBySport || []) {
      const sport = row.sport || 'unknown';
      sportCounts[sport] = (sportCounts[sport] || 0) + 1;
    }
    
    const totalProps = Object.values(sportCounts).reduce((s, c) => s + c, 0);
    const activeSports = Object.keys(sportCounts);
    const underCovered = Object.entries(sportCounts).filter(([, count]) => count < 10);
    
    const oddsOk = totalProps >= 50 && underCovered.length === 0;
    const sportDetail = activeSports.map(s => `${s}:${sportCounts[s]}`).join(', ');
    checks.push({ 
      name: 'Odds distribution', 
      passed: oddsOk, 
      detail: `${totalProps} total props across ${activeSports.length} sports (${sportDetail})` 
    });
    if (!oddsOk) {
      if (totalProps < 50) {
        blockers.push(`Odds data thin (${totalProps} total props, need 50+)`);
      }
      if (underCovered.length > 0) {
        blockers.push(`Thin coverage on: ${underCovered.map(([s, c]) => `${s}(${c})`).join(', ')} — need 10+ per sport`);
      }
    }

    // 2. Game log freshness — data within last 5 days
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { count: logCount } = await supabase
      .from('nba_player_game_logs')
      .select('*', { count: 'exact', head: true })
      .gte('game_date', fiveDaysAgo);
    const logsOk = (logCount || 0) > 0;
    checks.push({ name: 'Game log freshness', passed: logsOk, detail: `${logCount || 0} logs since ${fiveDaysAgo}` });
    if (!logsOk) blockers.push('NBA game logs stale — no data in last 5 days');

    // 3. API budget — 200+ calls remaining
    const { data: budgetData } = await supabase
      .from('api_budget_tracker')
      .select('calls_used, calls_limit')
      .eq('date', today)
      .maybeSingle();
    const remaining = budgetData ? budgetData.calls_limit - budgetData.calls_used : 2500;
    const budgetOk = remaining >= 200;
    checks.push({ name: 'API budget', passed: budgetOk, detail: `${remaining} calls remaining` });
    if (!budgetOk) blockers.push(`API budget low (${remaining} remaining, need 200+)`);

    // 4. Sweet spots quality check — existence + confidence distribution
    const { data: sweetSpots } = await supabase
      .from('category_sweet_spots')
      .select('category, confidence_score')
      .eq('analysis_date', today);

    const sweetCount = sweetSpots?.length || 0;
    const highConfidence = (sweetSpots || []).filter((s: any) => (s.confidence_score || 0) >= 70).length;
    const sweetOk = sweetCount > 0 && highConfidence >= Math.floor(sweetCount * 0.3);
    checks.push({ 
      name: 'Sweet spots quality', 
      passed: sweetOk, 
      detail: `${sweetCount} sweet spots today (${highConfidence} high-confidence ≥70%)` 
    });
    if (!sweetOk) {
      if (sweetCount === 0) {
        blockers.push('No category sweet spots for today — analyzer may have failed');
      } else {
        blockers.push(`Only ${highConfidence}/${sweetCount} sweet spots are high-confidence (need 30%+)`);
      }
    }

    // 5. Whale signals exist — game_bets updated today
    const { count: whaleCount } = await supabase
      .from('game_bets')
      .select('*', { count: 'exact', head: true })
      .gte('updated_at', `${today}T00:00:00`);
    const whaleOk = (whaleCount || 0) > 0;
    checks.push({ name: 'Whale signals', passed: whaleOk, detail: `${whaleCount || 0} signals today` });
    if (!whaleOk) blockers.push('No whale signals updated today — detector may have failed');

    // 6. Recent cron success — last orchestrator run was not 'failed'
    const { data: lastCron } = await supabase
      .from('cron_job_history')
      .select('status, completed_at')
      .eq('job_name', 'data-pipeline-orchestrator')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const cronOk = !lastCron || lastCron.status !== 'failed';
    checks.push({ name: 'Recent cron success', passed: cronOk, detail: lastCron ? `Last: ${lastCron.status}` : 'No runs found' });
    if (!cronOk) blockers.push('Last pipeline orchestrator run failed');

    // 7. Stale props cleaned — no unified_props older than 48h with today's game date
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { count: staleCount } = await supabase
      .from('unified_props')
      .select('*', { count: 'exact', head: true })
      .lt('created_at', twoDaysAgo)
      .gte('game_date', today);
    const staleOk = (staleCount || 0) === 0;
    checks.push({ name: 'Stale props cleaned', passed: staleOk, detail: `${staleCount || 0} stale props` });
    if (!staleOk) blockers.push(`${staleCount} stale props (>48h old) still present — cleanup missed`);

    // 8. Integrity check — no 1-leg or 2-leg parlays from last run
    const { count: badParlayCount } = await supabase
      .from('bot_daily_parlays')
      .select('*', { count: 'exact', head: true })
      .eq('parlay_date', today)
      .lt('leg_count', 3);
    const integrityOk = (badParlayCount || 0) === 0;
    checks.push({ name: 'Parlay integrity', passed: integrityOk, detail: `${badParlayCount || 0} short parlays` });
    if (!integrityOk) blockers.push(`${badParlayCount} parlays with <3 legs detected — generator bug`);

    // 9. Settlement coverage — check if yesterday's signals are ≥85% settled
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(yesterday);

    const { count: totalYesterday } = await supabase
      .from('fanduel_prediction_alerts')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', `${yesterdayStr}T00:00:00`)
      .lt('created_at', `${today}T00:00:00`);

    const { count: settledYesterday } = await supabase
      .from('settlement_records')
      .select('*', { count: 'exact', head: true })
      .gte('settled_at', `${yesterdayStr}T00:00:00`)
      .lt('settled_at', `${today}T00:00:00`);

    const settlementCoverage = (totalYesterday || 0) > 0
      ? ((settledYesterday || 0) / (totalYesterday || 1)) * 100
      : 100;
    const settlementOk = settlementCoverage >= 85 || (totalYesterday || 0) === 0;
    checks.push({
      name: 'Settlement coverage',
      passed: settlementOk,
      detail: `${(settledYesterday || 0)}/${(totalYesterday || 0)} yesterday's signals settled (${settlementCoverage.toFixed(0)}%)`,
    });
    if (!settlementOk) {
      blockers.push(`Settlement coverage only ${settlementCoverage.toFixed(0)}% — weights may be calibrated on partial data`);
    }

    const ready = blockers.length === 0;

    // Log to bot_activity_log
    await supabase.from('bot_activity_log').insert({
      event_type: 'preflight_check',
      message: ready ? `Preflight passed: all ${checks.length} checks OK` : `Preflight failed: ${blockers.length} blockers`,
      severity: ready ? 'info' : 'warning',
      metadata: { ready, checks, blockers, date: today },
    });

    // Fire Telegram alert if not ready
    if (!ready) {
      console.warn(`[Preflight] ${blockers.length} blockers detected:`, blockers);
      try {
        await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'preflight_alert',
            data: { blockers, checks, date: today },
          }),
        });
      } catch (e) {
        console.error('[Preflight] Failed to send Telegram alert:', e);
      }
    }

    console.log(`[Preflight] ${ready ? '✅ Ready' : '❌ Not ready'} — ${checks.length} checks, ${blockers.length} blockers`);

    return new Response(JSON.stringify({ ready, checks, blockers }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Preflight] Fatal error:', msg);
    return new Response(JSON.stringify({ ready: false, error: msg, checks, blockers }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
