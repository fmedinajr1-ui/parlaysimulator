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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const results: Record<string, { success: boolean; message: string; duration?: number }> = {};
  
  const runFunction = async (name: string, body: Record<string, unknown> = {}) => {
    const start = Date.now();
    try {
      console.log(`[Pipeline] Starting ${name}...`);
      
      const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const duration = Date.now() - start;
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Pipeline] ${name} failed:`, errorText);
        results[name] = { success: false, message: errorText, duration };
        return false;
      }

      const data = await response.json();
      console.log(`[Pipeline] ${name} completed in ${duration}ms:`, data);
      results[name] = { success: true, message: JSON.stringify(data).slice(0, 200), duration };
      return true;
    } catch (err) {
      const duration = Date.now() - start;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[Pipeline] ${name} error:`, errorMessage);
      results[name] = { success: false, message: errorMessage, duration };
      return false;
    }
  };

  try {
    const { mode = 'full' } = await req.json().catch(() => ({}));
    
    console.log(`[Pipeline] Starting unified pipeline in ${mode} mode...`);
    const pipelineStart = Date.now();
    const today = getEasternDate();

    // Check API budget status before data collection
    let budgetStatus = { calls_used: 0, calls_limit: 2500 };
    const { data: budgetData } = await supabase
      .from('api_budget_tracker')
      .select('calls_used, calls_limit')
      .eq('date', today)
      .maybeSingle();
    
    if (budgetData) {
      budgetStatus = budgetData;
      console.log(`[Pipeline] API Budget: ${budgetData.calls_used}/${budgetData.calls_limit} calls used today`);
    }

    // ============ PHASE 1: DATA COLLECTION ============
    if (mode === 'full' || mode === 'collect') {
      const budgetRemaining = budgetStatus.calls_limit - budgetStatus.calls_used;
      
      if (budgetRemaining > 200) {
        // Use 'full' mode scraper for scheduled full scrapes
        await runFunction('whale-odds-scraper', { 
          mode: 'full',
          sports: ['basketball_nba', 'icehockey_nhl', 'basketball_wnba', 'basketball_ncaab', 'baseball_ncaa'] 
        });
      } else {
        console.log(`[Pipeline] Low budget (${budgetRemaining} remaining), using targeted scrape only`);
        await runFunction('whale-odds-scraper', { mode: 'targeted' });
      }
      
      await runFunction('daily-fatigue-calculator', {});
      await runFunction('track-odds-movement', { sports: ['basketball_nba', 'icehockey_nhl', 'basketball_wnba', 'basketball_ncaab', 'baseball_ncaa'] });
      
      // Run simulation engine predictions after odds collection
      await runFunction('odds-simulation-engine', { mode: 'predict' });
      
      await runFunction('pp-props-scraper', { sports: ['NBA', 'NHL', 'WNBA', 'ATP', 'WTA'] });
      await runFunction('firecrawl-lineup-scraper', {});
      await runFunction('ncaa-baseball-data-ingestion', { days_back: 1 });
      await runFunction('ncaa-baseball-team-stats-fetcher', {});
      
      // NCAAB Intelligence Layer (KenPom -> Team Stats -> Refs -> Fatigue)
      await runFunction('ncaab-kenpom-scraper', {});
      await runFunction('ncaab-team-stats-fetcher', {});
      await runFunction('ncaab-referee-scraper', {});
      await runFunction('ncaab-fatigue-calculator', {});
    }

    // ============ PHASE 2: ANALYSIS ============
    if (mode === 'full' || mode === 'analyze') {
      await runFunction('category-props-analyzer', { limit: 100 });
      await runFunction('auto-refresh-sharp-tracker', {});
      await runFunction('whale-signal-detector', { sports: ['basketball_nba', 'icehockey_nhl', 'basketball_wnba', 'basketball_ncaab', 'baseball_ncaa'] });
      await runFunction('team-bets-scoring-engine', {});
      await runFunction('bot-game-context-analyzer', {});
      
      // MLB pipeline: sync PP props → analyze → cross-reference
      await runFunction('mlb-props-sync', {});
      await runFunction('detect-mispriced-lines', {});
      await runFunction('mlb-batter-analyzer', {});
      await runFunction('mlb-prop-cross-reference', {});
      await runFunction('high-conviction-analyzer', {});
      
      // MLB Pitcher K analysis (Feb-October = spring training + season)
      const currentMonth = new Date().getMonth() + 1; // 1-12
      if (currentMonth >= 2 && currentMonth <= 10) {
        await runFunction('mlb-pitcher-k-analyzer', {});
      }
    }

    // ============ PHASE 3: PARLAY GENERATION ============
    if (mode === 'full' || mode === 'generate') {
      // Collect table tennis player stats before generation
      await runFunction('tt-stats-collector', {});
      
      // Pre-generation health check
      const preflightOk = await runFunction('bot-pipeline-preflight', {});
      if (!preflightOk) {
        console.warn('[Pipeline] ⚠️ Preflight failed -- generation will proceed with warnings');
      }
      
      // Targeted refresh before generation to ensure fresh lines
      await runFunction('whale-odds-scraper', { mode: 'targeted' });
      await runFunction('bot-review-and-optimize', { source: 'pipeline' });
    }

    // ============ PHASE 3B: MID-DAY RE-GENERATION CHECK ============
    // If morning run produced < 10 picks, schedule an afternoon re-gen
    if (mode === 'full' || mode === 'regen') {
      const { count: parlayCount } = await supabase
        .from('bot_daily_parlays')
        .select('*', { count: 'exact', head: true })
        .eq('parlay_date', today)
        .eq('outcome', 'pending');

      if ((parlayCount || 0) < 10) {
        console.log(`[Pipeline] 🔄 MID-DAY RE-GEN: Only ${parlayCount || 0} pending parlays for ${today}. Triggering additional generation.`);
        await runFunction('whale-odds-scraper', { mode: 'full', sports: ['basketball_nba', 'icehockey_nhl', 'basketball_ncaab', 'basketball_wnba'] });
        await runFunction('team-bets-scoring-engine', {});
        await runFunction('bot-review-and-optimize', { source: 'regen' });
        results['mid_day_regen'] = { success: true, message: `Re-triggered: had ${parlayCount} parlays`, duration: 0 };
      } else {
        console.log(`[Pipeline] ✅ Sufficient parlays (${parlayCount}) for ${today}, skipping re-gen.`);
      }
    }

    // ============ PHASE 4: OUTCOME VERIFICATION & SETTLEMENT ============
    if (mode === 'full' || mode === 'verify') {
      await runFunction('verify-all-engine-outcomes', {});
      await runFunction('verify-sharp-outcomes', {});
      await runFunction('verify-juiced-outcomes', {});
      await runFunction('verify-fatigue-outcomes', {});
      await runFunction('verify-sweet-spot-outcomes', {});
      await runFunction('verify-best-bets-outcomes', {});
      await runFunction('auto-settle-parlays', {});
      await runFunction('bot-settle-and-learn', {});
      
      // Settle simulation shadow picks
      await runFunction('odds-simulation-engine', { mode: 'settle' });
    }

    // ============ PHASE 5: CALIBRATION & LEARNING ============
    if (mode === 'full' || mode === 'calibrate') {
      // Adaptive Intelligence runs FIRST — updates recency rates, Bayesian calibration,
      // regime detection, correlation matrix, gate overrides, and tier recommendations
      await runFunction('bot-adaptive-intelligence', {});
      
      await runFunction('calculate-calibration', {});
      await runFunction('recalibrate-sharp-signals', {});
      await runFunction('calibrate-bot-weights', {});
    }

    const totalDuration = Date.now() - pipelineStart;
    
    const totalSteps = Object.keys(results).length;
    const successfulSteps = Object.values(results).filter(r => r.success).length;
    const failedSteps = Object.values(results).filter(r => !r.success).length;

    // Re-fetch budget after pipeline run
    const { data: finalBudget } = await supabase
      .from('api_budget_tracker')
      .select('calls_used, calls_limit')
      .eq('date', today)
      .maybeSingle();
    
    await supabase.from('ai_performance_metrics').upsert({
      sport: 'pipeline',
      bet_type: 'unified_orchestrator',
      confidence_level: mode,
      total_predictions: totalSteps,
      correct_predictions: successfulSteps,
      accuracy_rate: totalSteps > 0 ? (successfulSteps / totalSteps) * 100 : 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'sport,bet_type,confidence_level' });

    await supabase.from('cron_job_history').insert({
      job_name: 'data-pipeline-orchestrator',
      status: failedSteps === 0 ? 'completed' : 'partial',
      started_at: new Date(pipelineStart).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: totalDuration,
      result: {
        mode,
        totalSteps,
        successfulSteps,
        failedSteps,
        apiBudget: finalBudget || budgetStatus,
        phases: {
          collect: mode === 'full' || mode === 'collect',
          analyze: mode === 'full' || mode === 'analyze',
          generate: mode === 'full' || mode === 'generate',
          verify: mode === 'full' || mode === 'verify',
          calibrate: mode === 'full' || mode === 'calibrate'
        }
      }
    });

    const summary = {
      mode,
      totalDuration,
      totalSteps,
      successfulSteps,
      failedSteps,
      apiBudget: finalBudget || budgetStatus,
      pipelineHealth: failedSteps === 0 ? 'healthy' : failedSteps <= 2 ? 'degraded' : 'unhealthy',
      results,
    };

    console.log('[Pipeline] Complete:', summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Pipeline] Fatal error:', errorMessage);
    
    await supabase.from('cron_job_history').insert({
      job_name: 'data-pipeline-orchestrator',
      status: 'failed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
      result: { results }
    });
    
    return new Response(JSON.stringify({ 
      error: errorMessage,
      results 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
