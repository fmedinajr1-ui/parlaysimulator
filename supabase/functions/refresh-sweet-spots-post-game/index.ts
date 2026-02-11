import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('[refresh-sweet-spots-post-game] Starting post-game refresh...');

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    
    // Check for games that finished in the last 2 hours
    const { data: finishedGames, error: gamesError } = await supabase
      .from('live_game_scores')
      .select('event_id, home_team, away_team, game_status, last_updated')
      .eq('game_status', 'final')
      .gte('last_updated', twoHoursAgo.toISOString())
      .order('last_updated', { ascending: false });

    if (gamesError) {
      console.error('[refresh-sweet-spots-post-game] Error fetching finished games:', JSON.stringify(gamesError));
      throw new Error(`Failed to fetch finished games: ${gamesError.message || JSON.stringify(gamesError)}`);
    }

    const gamesProcessed = finishedGames?.length || 0;
    console.log(`[refresh-sweet-spots-post-game] Found ${gamesProcessed} games finished in last 2 hours`);

    if (gamesProcessed === 0) {
      await supabase.from('cron_job_history').insert({
        job_name: 'refresh-sweet-spots-post-game',
        status: 'completed',
        result: { games_processed: 0, message: 'No games finished in last 2 hours' },
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      });

      return new Response(
        JSON.stringify({ success: true, message: 'No games to process', gamesProcessed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get today's date in ET format (YYYY-MM-DD)
    const etFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = etFormatter.formatToParts(now);
    const todayET = `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}-${parts.find(p => p.type === 'day')?.value}`;

    console.log(`[refresh-sweet-spots-post-game] Today ET: ${todayET}`);

    // Trigger backfill-player-stats for today via fetch (more reliable than functions.invoke)
    let backfillResult = null;
    try {
      const backfillResp = await fetch(`${supabaseUrl}/functions/v1/backfill-player-stats`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ targetDate: todayET }),
      });
      
      if (backfillResp.ok) {
        backfillResult = await backfillResp.json();
        console.log('[refresh-sweet-spots-post-game] Backfill completed:', JSON.stringify(backfillResult).slice(0, 200));
      } else {
        const errText = await backfillResp.text();
        console.error(`[refresh-sweet-spots-post-game] Backfill failed (${backfillResp.status}):`, errText.slice(0, 200));
      }
    } catch (err) {
      console.error('[refresh-sweet-spots-post-game] Backfill invoke error:', err instanceof Error ? err.message : String(err));
    }

    // Wait for backfill data to propagate
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Trigger verify-sweet-spot-outcomes via fetch
    let verifyResult = null;
    try {
      const verifyResp = await fetch(`${supabaseUrl}/functions/v1/verify-sweet-spot-outcomes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ date: todayET }),
      });
      
      if (verifyResp.ok) {
        verifyResult = await verifyResp.json();
        console.log('[refresh-sweet-spots-post-game] Verify completed:', JSON.stringify(verifyResult).slice(0, 200));
      } else {
        const errText = await verifyResp.text();
        console.error(`[refresh-sweet-spots-post-game] Verify failed (${verifyResp.status}):`, errText.slice(0, 200));
      }
    } catch (err) {
      console.error('[refresh-sweet-spots-post-game] Verify invoke error:', err instanceof Error ? err.message : String(err));
    }

    const durationMs = Date.now() - startTime;
    await supabase.from('cron_job_history').insert({
      job_name: 'refresh-sweet-spots-post-game',
      status: 'completed',
      result: {
        games_processed: gamesProcessed,
        games: finishedGames?.map(g => `${g.away_team} @ ${g.home_team}`),
        backfill_result: backfillResult ? 'success' : 'failed',
        verify_result: verifyResult?.summary || null,
        target_date: todayET,
      },
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
    });

    console.log(`[refresh-sweet-spots-post-game] Completed in ${durationMs}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        gamesProcessed,
        targetDate: todayET,
        backfillResult: backfillResult ? 'success' : 'failed',
        verifyResult: verifyResult?.summary || null,
        durationMs,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    console.error('[refresh-sweet-spots-post-game] Error:', errorMessage);

    await supabase.from('cron_job_history').insert({
      job_name: 'refresh-sweet-spots-post-game',
      status: 'error',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    });

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
