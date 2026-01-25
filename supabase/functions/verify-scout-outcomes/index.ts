import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Normalize player names for matching
const normalizeName = (s: string): string =>
  (s || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// Extract stat value from game log
const extractStatValue = (gameLog: any, prop: string): number | null => {
  const p = prop.toLowerCase();
  if (p === 'points') return Number(gameLog.points) || null;
  if (p === 'rebounds') return Number(gameLog.rebounds) || null;
  if (p === 'assists') return Number(gameLog.assists) || null;
  if (p === 'pra') {
    return (Number(gameLog.points) || 0) + 
           (Number(gameLog.rebounds) || 0) + 
           (Number(gameLog.assists) || 0);
  }
  if (p === 'threes') return Number(gameLog.threes_made) || null;
  if (p === 'steals') return Number(gameLog.steals) || null;
  if (p === 'blocks') return Number(gameLog.blocks) || null;
  return null;
};

// Determine outcome
const determineOutcome = (actual: number, line: number, side: string): 'hit' | 'miss' | 'push' => {
  if (actual === line) return 'push';
  const isOver = side.toUpperCase() === 'OVER';
  if (isOver) return actual > line ? 'hit' : 'miss';
  return actual < line ? 'hit' : 'miss';
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request - default to yesterday
    let targetDate: string;
    try {
      const body = await req.json();
      targetDate = body.date || new Date(Date.now() - 86400000).toISOString().split('T')[0];
    } catch {
      targetDate = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    }

    console.log(`[verify-scout-outcomes] Starting for date: ${targetDate}`);

    // Step 1: Fetch pending scout outcomes
    const { data: pendingOutcomes, error: fetchError } = await supabase
      .from('scout_prop_outcomes')
      .select('*')
      .eq('analysis_date', targetDate)
      .eq('outcome', 'pending');

    if (fetchError) throw new Error(`Fetch error: ${fetchError.message}`);
    if (!pendingOutcomes?.length) {
      console.log(`[verify-scout-outcomes] No pending outcomes for ${targetDate}`);
      return new Response(JSON.stringify({
        success: true, 
        date: targetDate, 
        message: 'No pending outcomes',
        summary: { total: 0, verified: 0, hits: 0, misses: 0, pushes: 0 }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[verify-scout-outcomes] Found ${pendingOutcomes.length} pending outcomes`);

    // Step 2: Fetch game logs for that date
    const { data: gameLogs, error: logsError } = await supabase
      .from('nba_player_game_logs')
      .select('player_name, points, rebounds, assists, threes_made, steals, blocks')
      .eq('game_date', targetDate);

    if (logsError) throw new Error(`Logs error: ${logsError.message}`);

    console.log(`[verify-scout-outcomes] Found ${gameLogs?.length || 0} game logs`);

    // Build lookup map
    const gameLogMap = new Map<string, any>();
    for (const log of gameLogs || []) {
      gameLogMap.set(normalizeName(log.player_name), log);
    }

    // Step 3: Verify each outcome
    const results = { 
      total: pendingOutcomes.length, 
      verified: 0, 
      noData: 0, 
      hits: 0, 
      misses: 0, 
      pushes: 0, 
      details: [] as any[] 
    };
    
    // Track MAE calculations
    let totalAbsError = 0;
    let errorCount = 0;

    for (const outcome of pendingOutcomes) {
      const gameLog = gameLogMap.get(normalizeName(outcome.player_name));
      
      if (!gameLog) {
        results.noData++;
        console.log(`[verify-scout-outcomes] No game log for: ${outcome.player_name}`);
        continue;
      }

      const actualValue = extractStatValue(gameLog, outcome.prop);
      if (actualValue === null) {
        results.noData++;
        continue;
      }

      const result = determineOutcome(actualValue, outcome.line, outcome.side);
      const projectionError = Math.abs(actualValue - (outcome.predicted_final || 0));
      
      totalAbsError += projectionError;
      errorCount++;

      // Update the record
      const { error: updateError } = await supabase
        .from('scout_prop_outcomes')
        .update({
          actual_final: actualValue,
          outcome: result,
          projection_error: projectionError,
          settled_at: new Date().toISOString(),
        })
        .eq('id', outcome.id);

      if (updateError) {
        console.error(`[verify-scout-outcomes] Update error for ${outcome.id}:`, updateError);
        continue;
      }

      results.verified++;
      if (result === 'hit') results.hits++;
      else if (result === 'miss') results.misses++;
      else results.pushes++;

      results.details.push({
        player: outcome.player_name,
        prop: outcome.prop,
        side: outcome.side,
        line: outcome.line,
        predicted: outcome.predicted_final,
        actual: actualValue,
        error: projectionError.toFixed(1),
        outcome: result,
        confidence: outcome.confidence_raw,
      });
    }

    // Step 4: Update calibration bucket map from the view
    const { data: calibrationData } = await supabase
      .from('scout_confidence_calibration')
      .select('*');

    if (calibrationData && calibrationData.length > 0) {
      console.log(`[verify-scout-outcomes] Updating ${calibrationData.length} calibration buckets`);
      
      for (const row of calibrationData) {
        await supabase
          .from('scout_confidence_bucket_map')
          .upsert({
            bucket: row.bucket,
            calibrated_prob: row.hit_rate || 0.5,
            sample_size: row.settled || 0,
            last_hit_rate: row.hit_rate,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'bucket'
          });
      }
    }

    const mae = errorCount > 0 ? (totalAbsError / errorCount) : 0;
    const hitRate = (results.hits + results.misses) > 0 
      ? results.hits / (results.hits + results.misses) 
      : 0;

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'verify-scout-outcomes',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      result: {
        date: targetDate,
        summary: { 
          total: results.total,
          verified: results.verified,
          noData: results.noData,
          hits: results.hits,
          misses: results.misses,
          pushes: results.pushes,
          mae: mae.toFixed(2), 
          hitRate: hitRate.toFixed(4) 
        },
      },
    });

    console.log(`[verify-scout-outcomes] Complete: ${results.verified} verified, MAE: ${mae.toFixed(2)}, Hit Rate: ${(hitRate * 100).toFixed(1)}%`);

    return new Response(JSON.stringify({
      success: true,
      date: targetDate,
      duration_ms: Date.now() - startTime,
      summary: {
        total: results.total,
        verified: results.verified,
        noData: results.noData,
        hits: results.hits,
        misses: results.misses,
        pushes: results.pushes,
        mae: mae.toFixed(2),
        hitRate: hitRate.toFixed(4),
      },
      details: results.details,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[verify-scout-outcomes] Error:', errorMessage);
    
    // Log failure
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      await supabase.from('cron_job_history').insert({
        job_name: 'verify-scout-outcomes',
        status: 'failed',
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        error_message: errorMessage,
      });
    }
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
