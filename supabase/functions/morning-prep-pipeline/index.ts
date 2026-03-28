/**
 * morning-prep-pipeline
 * 
 * Runs at 10:00 AM ET — collects odds, analyzes props, scans matchups,
 * and triggers the slate advisory. Does NOT generate parlays (that's at 5:30 PM ET).
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
    log('=== MORNING PREP PIPELINE (No Parlay Generation) ===');

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

    const totalDuration = Date.now() - startTime;
    const allOk = Object.values(results).every((r) => r.status === 'ok');
    const failedSteps = Object.entries(results).filter(([, r]) => r.status !== 'ok');

    log(`=== COMPLETE (${totalDuration}ms) — ${allOk ? 'ALL OK' : `${failedSteps.length} FAILED`} ===`);

    // Telegram summary
    const statusLines = Object.entries(results).map(([fn, r]) =>
      `${r.status === 'ok' ? '✅' : '❌'} ${fn} (${(r.duration_ms / 1000).toFixed(1)}s)`
    );
    const telegramMsg = [
      `☀️ *Morning Prep Complete*`,
      `${allOk ? '✅ All engines refreshed' : `⚠️ ${failedSteps.length} step(s) failed`}`,
      ``,
      ...statusLines,
      ``,
      `⏱ Total: ${(totalDuration / 1000).toFixed(1)}s`,
      ``,
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
