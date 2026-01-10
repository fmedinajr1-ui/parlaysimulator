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
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  console.log('[Cleanup] Starting daily cleanup job...');

  const results = {
    unified_props_deleted: 0,
    sharp_parlays_old_deleted: 0,
    sharp_parlays_duplicates_deleted: 0,
    heat_parlays_deleted: 0,
    risk_engine_picks_deleted: 0,
    prop_v2_picks_deleted: 0,
    errors: [] as string[],
  };

  const now = new Date().toISOString();
  const today = now.split('T')[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  try {
    // 1. Delete stale props from unified_props (games already started)
    console.log('[Cleanup] Step 1: Cleaning unified_props...');
    const { data: staleProps, error: stalePropsError } = await supabase
      .from('unified_props')
      .delete()
      .lt('commence_time', now)
      .select('id');

    if (stalePropsError) {
      console.error('[Cleanup] Error deleting stale props:', stalePropsError);
      results.errors.push(`unified_props: ${stalePropsError.message}`);
    } else {
      results.unified_props_deleted = staleProps?.length || 0;
      console.log(`[Cleanup] Deleted ${results.unified_props_deleted} stale props`);
    }

    // 2. Delete old sharp_ai_parlays (older than 7 days)
    console.log('[Cleanup] Step 2: Cleaning old sharp_ai_parlays...');
    const { data: oldSharpParlays, error: oldSharpError } = await supabase
      .from('sharp_ai_parlays')
      .delete()
      .lt('parlay_date', sevenDaysAgo)
      .select('id');

    if (oldSharpError) {
      console.error('[Cleanup] Error deleting old sharp parlays:', oldSharpError);
      results.errors.push(`sharp_ai_parlays (old): ${oldSharpError.message}`);
    } else {
      results.sharp_parlays_old_deleted = oldSharpParlays?.length || 0;
      console.log(`[Cleanup] Deleted ${results.sharp_parlays_old_deleted} old sharp parlays`);
    }

    // 3. Deduplicate sharp_ai_parlays - keep only newest per date/type
    console.log('[Cleanup] Step 3: Deduplicating sharp_ai_parlays...');
    
    // Get all parlays grouped by date and type
    const { data: allSharpParlays, error: fetchError } = await supabase
      .from('sharp_ai_parlays')
      .select('id, parlay_date, parlay_type, created_at')
      .order('created_at', { ascending: false });

    if (fetchError) {
      console.error('[Cleanup] Error fetching sharp parlays for dedup:', fetchError);
      results.errors.push(`sharp_ai_parlays (dedup fetch): ${fetchError.message}`);
    } else if (allSharpParlays && allSharpParlays.length > 0) {
      // Group by date + type and find duplicates
      const groups: Record<string, typeof allSharpParlays> = {};
      for (const parlay of allSharpParlays) {
        const key = `${parlay.parlay_date}_${parlay.parlay_type}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(parlay);
      }

      // Collect IDs to delete (all but the first/newest in each group)
      const idsToDelete: string[] = [];
      for (const key in groups) {
        if (groups[key].length > 1) {
          // Skip first (newest), delete the rest
          for (let i = 1; i < groups[key].length; i++) {
            idsToDelete.push(groups[key][i].id);
          }
        }
      }

      if (idsToDelete.length > 0) {
        const { error: dedupDeleteError } = await supabase
          .from('sharp_ai_parlays')
          .delete()
          .in('id', idsToDelete);

        if (dedupDeleteError) {
          console.error('[Cleanup] Error deleting duplicate sharp parlays:', dedupDeleteError);
          results.errors.push(`sharp_ai_parlays (dedup delete): ${dedupDeleteError.message}`);
        } else {
          results.sharp_parlays_duplicates_deleted = idsToDelete.length;
          console.log(`[Cleanup] Deleted ${idsToDelete.length} duplicate sharp parlays`);
        }
      }
    }

    // 4. Delete old heat_parlays (older than 7 days)
    console.log('[Cleanup] Step 4: Cleaning old heat_parlays...');
    const { data: oldHeatParlays, error: oldHeatError } = await supabase
      .from('heat_parlays')
      .delete()
      .lt('parlay_date', sevenDaysAgo)
      .select('id');

    if (oldHeatError) {
      console.error('[Cleanup] Error deleting old heat parlays:', oldHeatError);
      results.errors.push(`heat_parlays: ${oldHeatError.message}`);
    } else {
      results.heat_parlays_deleted = oldHeatParlays?.length || 0;
      console.log(`[Cleanup] Deleted ${results.heat_parlays_deleted} old heat parlays`);
    }

    // 5. Delete stale nba_risk_engine_picks (past game dates)
    console.log('[Cleanup] Step 5: Cleaning nba_risk_engine_picks...');
    const { data: stalePicks, error: stalePicksError } = await supabase
      .from('nba_risk_engine_picks')
      .delete()
      .lt('game_date', today)
      .select('id');

    if (stalePicksError) {
      console.error('[Cleanup] Error deleting stale risk engine picks:', stalePicksError);
      results.errors.push(`nba_risk_engine_picks: ${stalePicksError.message}`);
    } else {
      results.risk_engine_picks_deleted = stalePicks?.length || 0;
      console.log(`[Cleanup] Deleted ${results.risk_engine_picks_deleted} stale risk engine picks`);
    }

    // 6. Delete stale prop_engine_v2_picks (past game dates)
    console.log('[Cleanup] Step 6: Cleaning prop_engine_v2_picks...');
    const { data: staleV2Picks, error: staleV2Error } = await supabase
      .from('prop_engine_v2_picks')
      .delete()
      .lt('game_date', today)
      .select('id');

    if (staleV2Error) {
      console.error('[Cleanup] Error deleting stale prop v2 picks:', staleV2Error);
      results.errors.push(`prop_engine_v2_picks: ${staleV2Error.message}`);
    } else {
      results.prop_v2_picks_deleted = staleV2Picks?.length || 0;
      console.log(`[Cleanup] Deleted ${results.prop_v2_picks_deleted} stale prop v2 picks`);
    }

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Cleanup] Unexpected error:', err);
    results.errors.push(`unexpected: ${errorMessage}`);
  }

  const durationMs = Date.now() - startTime;
  const status = results.errors.length === 0 ? 'completed' : 'completed_with_errors';

  // Log to cron_job_history
  const { error: logError } = await supabase
    .from('cron_job_history')
    .insert({
      job_name: 'cleanup-stale-props',
      status,
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      result: results,
      error_message: results.errors.length > 0 ? results.errors.join('; ') : null,
    });

  if (logError) {
    console.error('[Cleanup] Error logging to cron_job_history:', logError);
  }

  console.log('[Cleanup] Completed in', durationMs, 'ms');
  console.log('[Cleanup] Results:', JSON.stringify(results, null, 2));

  return new Response(
    JSON.stringify({
      success: results.errors.length === 0,
      message: `Cleanup completed in ${durationMs}ms`,
      results,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
