import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('[refresh-sweet-spots-post-game] Starting post-game refresh...');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get current time in Eastern
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    
    // Check for games that finished in the last 2 hours
    const { data: finishedGames, error: gamesError } = await supabase
      .from('live_game_scores')
      .select('event_id, home_team, away_team, game_status, updated_at')
      .eq('game_status', 'final')
      .gte('updated_at', twoHoursAgo.toISOString())
      .order('updated_at', { ascending: false });

    if (gamesError) {
      console.error('[refresh-sweet-spots-post-game] Error fetching finished games:', gamesError);
      throw gamesError;
    }

    const gamesProcessed = finishedGames?.length || 0;
    console.log(`[refresh-sweet-spots-post-game] Found ${gamesProcessed} games finished in last 2 hours`);

    if (gamesProcessed === 0) {
      // Log to cron history even if no games
      await supabase.from('cron_job_history').insert({
        job_name: 'refresh-sweet-spots-post-game',
        status: 'completed',
        result: {
          games_processed: 0,
          message: 'No games finished in last 2 hours',
        },
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      });

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No games to process',
          gamesProcessed: 0 
        }),
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

    // Trigger backfill-player-stats for today
    let backfillResult = null;
    try {
      const { data, error } = await supabase.functions.invoke('backfill-player-stats', {
        body: { targetDate: todayET },
      });
      
      if (error) {
        console.error('[refresh-sweet-spots-post-game] Backfill error:', error);
      } else {
        backfillResult = data;
        console.log('[refresh-sweet-spots-post-game] Backfill completed:', data);
      }
    } catch (err) {
      console.error('[refresh-sweet-spots-post-game] Backfill invoke error:', err);
    }

    // Wait a bit for backfill to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Trigger verify-sweet-spot-outcomes for today
    let verifyResult = null;
    try {
      const { data, error } = await supabase.functions.invoke('verify-sweet-spot-outcomes', {
        body: { date: todayET },
      });
      
      if (error) {
        console.error('[refresh-sweet-spots-post-game] Verify error:', error);
      } else {
        verifyResult = data;
        console.log('[refresh-sweet-spots-post-game] Verify completed:', data);
      }
    } catch (err) {
      console.error('[refresh-sweet-spots-post-game] Verify invoke error:', err);
    }

    // Log to cron history
    const durationMs = Date.now() - startTime;
    await supabase.from('cron_job_history').insert({
      job_name: 'refresh-sweet-spots-post-game',
      status: 'completed',
      result: {
        games_processed: gamesProcessed,
        games: finishedGames?.map(g => `${g.away_team} @ ${g.home_team}`),
        backfill_result: backfillResult,
        verify_result: verifyResult,
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
        backfillResult,
        verifyResult,
        durationMs,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[refresh-sweet-spots-post-game] Error:', error);

    // Log error to cron history
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase.from('cron_job_history').insert({
      job_name: 'refresh-sweet-spots-post-game',
      status: 'error',
      error_message: error instanceof Error ? error.message : String(error),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    });

    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
