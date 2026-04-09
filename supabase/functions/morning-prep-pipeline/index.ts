/**
 * morning-prep-pipeline
 * 
 * Runs at 10:00 AM ET — collects odds, analyzes props, scans matchups,
 * settles previous day's signals via unified settlement-orchestrator,
 * and triggers the slate advisory. Does NOT generate parlays (that's at 5:30 PM ET).
 * 
 * v2: Uses settlement-orchestrator instead of fragmented settlers.
 *     Only triggers learning when settlement coverage ≥85%.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const startTime = Date.now();
  const log = (msg: string) => console.log(`[morning-prep] ${msg}`);
  const results: Record<string, { status: string; duration_ms: number }> = {};

  const invokeStep = async (label: string, fnName: string, body: object = {}) => {
    const stepStart = Date.now();
    log(`▶ ${label}`);
    try {
      const { error } = await supabase.functions.invoke(fnName, { body });
      const dur = Date.now() - stepStart;
      if (error) {
        log(`⚠ ${label} error (${dur}ms): ${JSON.stringify(error)}`);
        results[fnName] = { status: `error: ${error.message || JSON.stringify(error)}`, duration_ms: dur };
      } else {
        log(`✅ ${label} done (${dur}ms)`);
        results[fnName] = { status: 'ok', duration_ms: dur };
      }
    } catch (e) {
      const dur = Date.now() - stepStart;
      log(`❌ ${label} exception (${dur}ms): ${e.message}`);
      results[fnName] = { status: `exception: ${e.message}`, duration_ms: dur };
    }
  };

  try {
    log('=== MORNING PREP PIPELINE v2 (Unified Settlement) ===');

    // Step 1: Full odds scrape
    await invokeStep('Whale odds scraper (full)', 'whale-odds-scraper', { mode: 'full' });

    // Step 2: Parallel analysis
    await Promise.all([
      invokeStep('Category props analyzer', 'category-props-analyzer', {}),
      invokeStep('Matchup defense scanner', 'bot-matchup-defense-scanner', {}),
      invokeStep('Game context analyzer', 'bot-game-context-analyzer', {}),
    ]);

    // Step 3: Sync all engine outputs to the unified tracker
    await invokeStep('Engine tracker sync', 'engine-tracker-sync', {});

    // Step 4: MLB RBI Under/Over analyzer with pitcher cross-references
    await invokeStep('MLB RBI Under analyzer', 'mlb-rbi-under-analyzer', {});

    // Step 5: UNIFIED SETTLEMENT — replaces fragmented mlb-rbi-settler + fanduel-accuracy-feedback
    // Settles ALL signal types through the single settlement-orchestrator
    // with trigger_learning=false (learning happens at 4 AM wave)
    await invokeStep('Settlement orchestrator (morning wave)', 'settlement-orchestrator', {
      trigger_learning: false,
    });

    // Step 6: Generate RBI parlays from highest-accuracy signals
    await invokeStep('RBI parlay generator', 'generate-rbi-parlays', {});

    const totalDuration = Date.now() - startTime;
    const allOk = Object.values(results).every((r) => r.status === 'ok');
    const failedSteps = Object.entries(results).filter(([, r]) => r.status !== 'ok');

    log(`=== COMPLETE (${totalDuration}ms) — ${allOk ? 'ALL OK' : `${failedSteps.length} FAILED`} ===`);

    // Telegram summary
    const statusLines = Object.entries(results).map(([fn, r]) =>
      `${r.status === 'ok' ? '✅' : '❌'} ${fn} (${(r.duration_ms / 1000).toFixed(1)}s)`
    );
    const telegramMsg = [
      `☀️ *Morning Prep v2 Complete*`,
      `${allOk ? '✅ All engines refreshed' : `⚠️ ${failedSteps.length} step(s) failed`}`,
      ``,
      ...statusLines,
      ``,
      `⏱ Total: ${(totalDuration / 1000).toFixed(1)}s`,
      ``,
      `🔄 Settlement uses unified orchestrator`,
      `🕐 Learning triggers at 4 AM ET wave (≥85% coverage)`,
      `🕐 Parlays generate at 5:30 PM ET (pre-tip)`,
    ].join('\n');

    try {
      await supabase.functions.invoke('bot-send-telegram', {
        body: { message: telegramMsg, parse_mode: 'Markdown', admin_only: true },
      });
    } catch (_) { /* ignore */ }

    return new Response(JSON.stringify({ success: true, allOk, results, duration_ms: totalDuration }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    log(`Fatal error: ${err.message}`);
    return new Response(JSON.stringify({ success: false, error: err.message, results }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
