import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseKey);

  const nowISO = new Date().toISOString();
  const today = nowISO.split('T')[0];
  console.log(`[Heat Cleanup] Starting cleanup at ${nowISO}`);

  const results = {
    heat_tracker_deleted: 0,
    heat_watchlist_deleted: 0,
    heat_do_not_bet_deleted: 0,
    heat_parlays_deleted: 0,
    errors: [] as string[],
  };

  try {
    // 1. Delete stale props from heat_prop_tracker (games already started)
    const { data: staleTracker, error: trackerError } = await supabase
      .from('heat_prop_tracker')
      .delete()
      .lt('start_time_utc', nowISO)
      .select('id, event_id');

    if (trackerError) {
      console.error('[Heat Cleanup] Tracker error:', trackerError);
      results.errors.push(`heat_prop_tracker: ${trackerError.message}`);
    } else {
      results.heat_tracker_deleted = staleTracker?.length || 0;
      console.log(`[Heat Cleanup] Deleted ${results.heat_tracker_deleted} stale tracker entries`);
    }

    // 2. Get stale event_ids to clean related tables
    const staleEventIds = (staleTracker || [])
      .map((t: any) => t.event_id)
      .filter((id: string) => id && id.length > 0);

    // 3. Clean watchlist entries matching stale events OR old dates
    if (staleEventIds.length > 0) {
      const { data: staleWatchlist, error: watchlistError } = await supabase
        .from('heat_watchlist')
        .delete()
        .in('event_id', staleEventIds)
        .select('id');

      if (!watchlistError) {
        results.heat_watchlist_deleted += staleWatchlist?.length || 0;
      }

      // 4. Clean do-not-bet entries matching stale events
      const { data: staleDnb, error: dnbError } = await supabase
        .from('heat_do_not_bet')
        .delete()
        .in('event_id', staleEventIds)
        .select('id');

      if (!dnbError) {
        results.heat_do_not_bet_deleted += staleDnb?.length || 0;
      }
    }

    // 5. Also clean old date-based entries (older than today)
    const { data: oldWatchlist } = await supabase
      .from('heat_watchlist')
      .delete()
      .lt('watchlist_date', today)
      .select('id');
    results.heat_watchlist_deleted += oldWatchlist?.length || 0;

    const { data: oldDnb } = await supabase
      .from('heat_do_not_bet')
      .delete()
      .lt('dnb_date', today)
      .select('id');
    results.heat_do_not_bet_deleted += oldDnb?.length || 0;

    const { data: oldParlays } = await supabase
      .from('heat_parlays')
      .delete()
      .lt('parlay_date', today)
      .select('id');
    results.heat_parlays_deleted = oldParlays?.length || 0;

    console.log(`[Heat Cleanup] Cleaned old date-based entries - watchlist: ${oldWatchlist?.length || 0}, dnb: ${oldDnb?.length || 0}, parlays: ${oldParlays?.length || 0}`);

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Heat Cleanup] Unexpected error:', err);
    results.errors.push(`unexpected: ${errorMessage}`);
  }

  const durationMs = Date.now() - startTime;
  const totalDeleted = results.heat_tracker_deleted + 
                       results.heat_watchlist_deleted + 
                       results.heat_do_not_bet_deleted +
                       results.heat_parlays_deleted;

  // Log to cron_job_history
  await supabase.from('cron_job_history').insert({
    job_name: 'cleanup-heat-tracker',
    status: results.errors.length === 0 ? 'completed' : 'completed_with_errors',
    started_at: new Date(startTime).toISOString(),
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
    result: results,
    error_message: results.errors.length > 0 ? results.errors.join('; ') : null,
  });

  console.log(`[Heat Cleanup] Completed in ${durationMs}ms - Deleted ${totalDeleted} total entries`);

  return new Response(
    JSON.stringify({ success: results.errors.length === 0, results, duration_ms: durationMs }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
