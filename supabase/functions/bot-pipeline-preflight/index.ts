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
    // 1. Odds freshness — unified_props has 50+ rows for today
    const { count: propsCount } = await supabase
      .from('unified_props')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', `${today}T00:00:00`);
    const oddsOk = (propsCount || 0) >= 50;
    checks.push({ name: 'Odds freshness', passed: oddsOk, detail: `${propsCount || 0} props today` });
    if (!oddsOk) blockers.push(`Odds data stale (${propsCount || 0} props for today, need 50+)`);

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

    // 4. Sweet spots exist for today
    const { count: sweetCount } = await supabase
      .from('category_sweet_spots')
      .select('*', { count: 'exact', head: true })
      .eq('analysis_date', today);
    const sweetOk = (sweetCount || 0) > 0;
    checks.push({ name: 'Sweet spots', passed: sweetOk, detail: `${sweetCount || 0} sweet spots today` });
    if (!sweetOk) blockers.push('No category sweet spots for today — analyzer may have failed');

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
