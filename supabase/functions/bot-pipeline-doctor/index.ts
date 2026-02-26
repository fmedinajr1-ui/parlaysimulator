import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// ==================== KNOWN BUG PATTERN DATABASE ====================

interface BugPattern {
  id: string;
  name: string;
  check: (ctx: DiagnosticContext) => Promise<Diagnosis | null>;
  autoRemediable: boolean;
  remediationFunction?: string;
  remediationBody?: Record<string, unknown>;
}

interface Diagnosis {
  patternId: string;
  problem: string;
  rootCause: string;
  suggestedFix: string;
  impact: string;
  autoRemediable: boolean;
  severity: 'critical' | 'warning' | 'info';
}

interface DiagnosticContext {
  supabase: any;
  supabaseUrl: string;
  supabaseKey: string;
  today: string;
  pipelineResults?: Record<string, any>;
  triggerSource: string;
}

const PATTERNS: BugPattern[] = [
  // 1. Zero parlays generated
  {
    id: 'zero_parlays',
    name: 'Zero Parlays Generated',
    autoRemediable: true,
    remediationFunction: 'bot-force-fresh-parlays',
    remediationBody: {},
    check: async (ctx) => {
      const { count } = await ctx.supabase
        .from('bot_daily_parlays')
        .select('*', { count: 'exact', head: true })
        .eq('parlay_date', ctx.today);

      if ((count ?? 0) === 0) {
        return {
          patternId: 'zero_parlays',
          problem: '0 parlays generated today',
          rootCause: 'Generation phase produced no output — refresh-todays-props may have returned 0 props or composite thresholds too high',
          suggestedFix: 'Run bot-force-fresh-parlays or check Odds API budget',
          impact: 'No parlays to deliver — missed entire day',
          autoRemediable: true,
          severity: 'critical',
        };
      }
      return null;
    },
  },

  // 2. Stale weight calibration
  {
    id: 'stale_calibration',
    name: 'Stale Weight Calibration',
    autoRemediable: true,
    remediationFunction: 'calibrate-bot-weights',
    remediationBody: {},
    check: async (ctx) => {
      const { data: weights } = await ctx.supabase
        .from('bot_category_weights')
        .select('last_calibrated_at')
        .order('last_calibrated_at', { ascending: false })
        .limit(1);

      const lastCal = weights?.[0]?.last_calibrated_at;
      if (!lastCal) {
        return {
          patternId: 'stale_calibration',
          problem: 'Weight calibration never run',
          rootCause: 'calibrate-bot-weights has never executed successfully',
          suggestedFix: 'AUTO-FIX: triggering calibrate-bot-weights',
          impact: 'Category weights are default — suboptimal pick selection',
          autoRemediable: true,
          severity: 'warning',
        };
      }

      const hoursSince = (Date.now() - new Date(lastCal).getTime()) / 3600000;
      if (hoursSince > 48) {
        return {
          patternId: 'stale_calibration',
          problem: `Weight calibration stale (${Math.round(hoursSince)}h)`,
          rootCause: 'calibrate-bot-weights skipped in recent runs',
          suggestedFix: 'AUTO-FIX: triggering calibrate-bot-weights',
          impact: 'Category weights may be suboptimal',
          autoRemediable: true,
          severity: 'warning',
        };
      }
      return null;
    },
  },

  // 3. Settlement backlog
  {
    id: 'settlement_backlog',
    name: 'Settlement Backlog',
    autoRemediable: true,
    remediationFunction: 'auto-settle-parlays',
    remediationBody: {},
    check: async (ctx) => {
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const { count } = await ctx.supabase
        .from('bot_daily_parlays')
        .select('*', { count: 'exact', head: true })
        .eq('outcome', 'pending')
        .lt('created_at', twoDaysAgo);

      if ((count ?? 0) > 5) {
        return {
          patternId: 'settlement_backlog',
          problem: `Settlement backlog: ${count} parlays >48h unsettled`,
          rootCause: 'auto-settle-parlays or verify-sweet-spot-outcomes may be failing silently',
          suggestedFix: 'AUTO-FIX: triggering auto-settle-parlays',
          impact: 'Bankroll tracking delayed, win rate metrics stale',
          autoRemediable: true,
          severity: 'warning',
        };
      }
      return null;
    },
  },

  // 4. Critical pipeline step failures
  {
    id: 'critical_step_fail',
    name: 'Critical Pipeline Step Failed',
    autoRemediable: false,
    check: async (ctx) => {
      if (!ctx.pipelineResults) return null;
      
      const criticalSteps = [
        'refresh-todays-props', 'nba-player-prop-risk-engine',
        'sharp-parlay-builder', 'heat-prop-engine',
        'bot-generate-daily-parlays', 'whale-odds-scraper',
      ];

      const failedCritical: string[] = [];
      
      // Check step_results array (cascade runner format)
      if (Array.isArray(ctx.pipelineResults.step_results)) {
        for (const step of ctx.pipelineResults.step_results) {
          if (!step.success && criticalSteps.includes(step.name)) {
            failedCritical.push(step.name);
          }
        }
      }
      
      // Check results object (orchestrator format)
      if (ctx.pipelineResults.results && typeof ctx.pipelineResults.results === 'object') {
        for (const [name, result] of Object.entries(ctx.pipelineResults.results as Record<string, any>)) {
          if (!result.success && criticalSteps.includes(name)) {
            failedCritical.push(name);
          }
        }
      }

      if (failedCritical.length > 0) {
        return {
          patternId: 'critical_step_fail',
          problem: `${failedCritical.length} critical step(s) failed: ${failedCritical.join(', ')}`,
          rootCause: 'Critical pipeline functions returned errors — downstream output compromised',
          suggestedFix: `Investigate logs for: ${failedCritical.join(', ')}. These steps must succeed for parlays to generate.`,
          impact: 'Likely 0 or degraded parlays produced',
          autoRemediable: false,
          severity: 'critical',
        };
      }
      return null;
    },
  },

  // 5. Prop drought (no upcoming props)
  {
    id: 'prop_drought',
    name: 'Prop Drought',
    autoRemediable: true,
    remediationFunction: 'whale-odds-scraper',
    remediationBody: { mode: 'full', sports: ['basketball_nba'] },
    check: async (ctx) => {
      const { count } = await ctx.supabase
        .from('unified_props')
        .select('*', { count: 'exact', head: true })
        .gte('game_date', ctx.today);

      if ((count ?? 0) === 0) {
        return {
          patternId: 'prop_drought',
          problem: '0 upcoming props in unified_props',
          rootCause: 'Odds scraper may have failed or no games scheduled',
          suggestedFix: 'AUTO-FIX: triggering whale-odds-scraper full refresh',
          impact: 'No props = no picks = no parlays',
          autoRemediable: true,
          severity: 'critical',
        };
      }
      return null;
    },
  },

  // 6. API budget exhausted
  {
    id: 'budget_exhausted',
    name: 'API Budget Exhausted',
    autoRemediable: false,
    check: async (ctx) => {
      const { data: budget } = await ctx.supabase
        .from('api_budget_tracker')
        .select('calls_used, calls_limit')
        .eq('date', ctx.today)
        .maybeSingle();

      if (budget && budget.calls_limit > 0) {
        const pctUsed = (budget.calls_used / budget.calls_limit) * 100;
        if (pctUsed >= 95) {
          return {
            patternId: 'budget_exhausted',
            problem: `API budget ${pctUsed.toFixed(0)}% exhausted (${budget.calls_used}/${budget.calls_limit})`,
            rootCause: 'Too many API calls today — remaining scrapes will fail',
            suggestedFix: 'Wait for budget reset tomorrow or upgrade API plan',
            impact: 'No fresh odds data until budget resets',
            autoRemediable: false,
            severity: 'critical',
          };
        }
      }
      return null;
    },
  },

  // 7. Empty scanner output (silent failures)
  {
    id: 'empty_scanner',
    name: 'Empty Scanner Output',
    autoRemediable: false,
    check: async (ctx) => {
      const todayStart = `${ctx.today}T00:00:00`;
      const { data: recentJobs } = await ctx.supabase
        .from('cron_job_history')
        .select('job_name, result')
        .gte('started_at', todayStart)
        .in('job_name', [
          'double-confirmed-scanner', 'high-conviction-analyzer',
          'detect-mispriced-lines', 'recurring-winners-detector',
        ]);

      if (!recentJobs || recentJobs.length === 0) return null;

      const emptyOnes: string[] = [];
      for (const job of recentJobs) {
        const r = job.result;
        if (r && typeof r === 'object') {
          const count = (r as any).count ?? (r as any).total ?? (r as any).picks_found ?? -1;
          if (count === 0) emptyOnes.push(job.job_name);
        }
      }

      if (emptyOnes.length >= 2) {
        return {
          patternId: 'empty_scanner',
          problem: `${emptyOnes.length} scanners returned 0 results: ${emptyOnes.join(', ')}`,
          rootCause: 'Scanners ran successfully but found nothing — may indicate stale input data or overly strict filters',
          suggestedFix: 'Check category_sweet_spots freshness and scanner thresholds',
          impact: 'Reduced pick pool quality — parlays built from smaller pool',
          autoRemediable: false,
          severity: 'warning',
        };
      }
      return null;
    },
  },
];

// ==================== PROFIT IMPACT CORRELATOR ====================

async function correlateProfitImpact(
  supabase: any,
  diagnoses: Diagnosis[]
): Promise<{ failureDayWinRate: number | null; cleanDayWinRate: number | null; estimatedImpact: number | null }> {
  try {
    // Get last 30 days of activation data
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { data: activationDays } = await supabase
      .from('bot_activation_status')
      .select('check_date, parlays_won, parlays_lost, daily_profit_loss')
      .gte('check_date', thirtyDaysAgo)
      .order('check_date', { ascending: true });

    if (!activationDays || activationDays.length < 7) {
      return { failureDayWinRate: null, cleanDayWinRate: null, estimatedImpact: null };
    }

    // Get days with pipeline failures from cron history
    const { data: failureJobs } = await supabase
      .from('cron_job_history')
      .select('started_at, status')
      .gte('started_at', `${thirtyDaysAgo}T00:00:00`)
      .in('job_name', ['engine-cascade-runner', 'data-pipeline-orchestrator'])
      .in('status', ['failed', 'partial']);

    const failureDates = new Set(
      (failureJobs || []).map((j: any) => j.started_at?.split('T')[0]).filter(Boolean)
    );

    let failWins = 0, failTotal = 0, cleanWins = 0, cleanTotal = 0;
    let failPnL = 0, cleanPnL = 0;

    for (const day of activationDays) {
      const won = day.parlays_won || 0;
      const lost = day.parlays_lost || 0;
      const total = won + lost;
      if (total === 0) continue;

      if (failureDates.has(day.check_date)) {
        failWins += won;
        failTotal += total;
        failPnL += day.daily_profit_loss || 0;
      } else {
        cleanWins += won;
        cleanTotal += total;
        cleanPnL += day.daily_profit_loss || 0;
      }
    }

    const failWR = failTotal > 0 ? Math.round((failWins / failTotal) * 100) : null;
    const cleanWR = cleanTotal > 0 ? Math.round((cleanWins / cleanTotal) * 100) : null;

    // Estimate today's impact based on average clean day P&L vs failure day P&L
    const cleanDays = activationDays.length - failureDates.size;
    const failDays = failureDates.size;
    const avgCleanPnL = cleanDays > 0 ? cleanPnL / cleanDays : 0;
    const avgFailPnL = failDays > 0 ? failPnL / failDays : 0;
    const estimatedImpact = diagnoses.length > 0 ? Math.round(avgFailPnL - avgCleanPnL) : null;

    return {
      failureDayWinRate: failWR,
      cleanDayWinRate: cleanWR,
      estimatedImpact,
    };
  } catch (err) {
    console.error('[Doctor] Profit correlation error:', err);
    return { failureDayWinRate: null, cleanDayWinRate: null, estimatedImpact: null };
  }
}

// ==================== AUTO-REMEDIATION ENGINE ====================

async function runAutoRemediation(
  ctx: DiagnosticContext,
  diagnoses: Diagnosis[]
): Promise<{ action: string; success: boolean; error?: string }[]> {
  const remediations: { action: string; success: boolean; error?: string }[] = [];

  // Safety: max 2 auto-remediations per day
  const todayStart = `${ctx.today}T00:00:00`;
  const { count: todayRemediations } = await ctx.supabase
    .from('bot_activity_log')
    .select('*', { count: 'exact', head: true })
    .eq('event_type', 'doctor_remediation')
    .gte('created_at', todayStart);

  if ((todayRemediations ?? 0) >= 2) {
    console.log('[Doctor] Max 2 auto-remediations/day reached — skipping');
    return remediations;
  }

  const budget = 2 - (todayRemediations ?? 0);
  let used = 0;

  for (const diag of diagnoses) {
    if (!diag.autoRemediable || used >= budget) continue;

    const pattern = PATTERNS.find(p => p.id === diag.patternId);
    if (!pattern?.remediationFunction) continue;

    console.log(`[Doctor] Auto-remediating: ${pattern.id} via ${pattern.remediationFunction}`);

    try {
      const resp = await fetch(`${ctx.supabaseUrl}/functions/v1/${pattern.remediationFunction}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ctx.supabaseKey}`,
        },
        body: JSON.stringify(pattern.remediationBody || {}),
      });

      const ok = resp.ok;
      await resp.text(); // consume body

      remediations.push({
        action: `${pattern.remediationFunction} (for ${pattern.id})`,
        success: ok,
        error: ok ? undefined : `HTTP ${resp.status}`,
      });

      // Log to activity log
      await ctx.supabase.from('bot_activity_log').insert({
        event_type: 'doctor_remediation',
        message: `Auto-remediation: ${pattern.remediationFunction} for ${pattern.id} — ${ok ? 'success' : 'failed'}`,
        severity: ok ? 'info' : 'warning',
        metadata: { patternId: pattern.id, function: pattern.remediationFunction, success: ok },
      });

      used++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      remediations.push({ action: `${pattern.remediationFunction} (for ${pattern.id})`, success: false, error: errMsg });
      used++;
    }
  }

  return remediations;
}

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const today = getEasternDate();

  let requestBody: { trigger_source?: string; pipeline_results?: Record<string, any> } = {};
  try {
    requestBody = await req.json();
  } catch {
    // empty body ok
  }

  const triggerSource = requestBody.trigger_source || 'manual';
  const pipelineResults = requestBody.pipeline_results || null;

  console.log(`[Doctor] Starting diagnosis — trigger: ${triggerSource}, date: ${today}`);

  const ctx: DiagnosticContext = {
    supabase,
    supabaseUrl,
    supabaseKey,
    today,
    pipelineResults,
    triggerSource,
  };

  // Run all pattern checks
  const diagnoses: Diagnosis[] = [];
  for (const pattern of PATTERNS) {
    try {
      const result = await pattern.check(ctx);
      if (result) {
        diagnoses.push(result);
        console.log(`[Doctor] Detected: ${result.problem}`);
      }
    } catch (err) {
      console.error(`[Doctor] Pattern ${pattern.id} check error:`, err);
    }
  }

  console.log(`[Doctor] ${diagnoses.length} problems detected`);

  // Correlate with P&L
  const profitCorrelation = await correlateProfitImpact(supabase, diagnoses);

  // Auto-remediate safe fixes
  const remediations = await runAutoRemediation(ctx, diagnoses);
  const autoFixedCount = remediations.filter(r => r.success).length;

  // Update diagnoses with auto-fix status
  for (const diag of diagnoses) {
    const remediation = remediations.find(r => r.action.includes(diag.patternId));
    if (remediation?.success) {
      diag.suggestedFix = `AUTO-FIXED — ${diag.suggestedFix.replace('AUTO-FIX: triggering ', 'triggered ')}`;
    }
  }

  // Store report
  const reportData = {
    report_date: today,
    trigger_source: triggerSource,
    problems_detected: diagnoses.length,
    problems_auto_fixed: autoFixedCount,
    diagnoses,
    auto_remediations: remediations,
    profit_impact_estimate: profitCorrelation.estimatedImpact,
    failure_day_win_rate: profitCorrelation.failureDayWinRate,
    clean_day_win_rate: profitCorrelation.cleanDayWinRate,
    pipeline_context: pipelineResults ? { steps_failed: pipelineResults.steps_failed, steps_succeeded: pipelineResults.steps_succeeded } : null,
  };

  await supabase.from('bot_doctor_reports').insert(reportData);

  // Send Telegram report if problems found
  if (diagnoses.length > 0) {
    try {
      await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          type: 'doctor_report',
          data: {
            diagnoses,
            autoFixedCount,
            remediations,
            failureDayWinRate: profitCorrelation.failureDayWinRate,
            cleanDayWinRate: profitCorrelation.cleanDayWinRate,
            estimatedImpact: profitCorrelation.estimatedImpact,
            triggerSource,
          },
        }),
      });
      console.log('[Doctor] Telegram report sent');
    } catch (err) {
      console.error('[Doctor] Failed to send Telegram:', err);
    }
  } else {
    console.log('[Doctor] No problems detected — no Telegram alert needed');
  }

  // Log activity
  await supabase.from('bot_activity_log').insert({
    event_type: 'doctor_diagnosis',
    message: `Pipeline Doctor: ${diagnoses.length} problems, ${autoFixedCount} auto-fixed`,
    severity: diagnoses.some(d => d.severity === 'critical') ? 'error' : diagnoses.length > 0 ? 'warning' : 'info',
    metadata: { problems: diagnoses.length, autoFixed: autoFixedCount, trigger: triggerSource },
  });

  return new Response(JSON.stringify({
    success: true,
    problemsDetected: diagnoses.length,
    problemsAutoFixed: autoFixedCount,
    diagnoses,
    remediations,
    profitCorrelation,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
