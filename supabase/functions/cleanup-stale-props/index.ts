import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Get Eastern Time date string
function getEasternDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Parse request body for immediate mode
  let requestBody: { immediate?: boolean } = {};
  try {
    requestBody = await req.json();
  } catch {
    // No body or invalid JSON, use defaults
  }

  const isImmediate = requestBody.immediate === true;
  console.log(`[Cleanup] Starting cleanup job... Mode: ${isImmediate ? 'IMMEDIATE' : 'FULL'}`);

  const results = {
    mode: isImmediate ? 'immediate' : 'full',
    archive_completed: false,
    archive_results: null as any,
    unified_props_deleted: 0,
    sharp_parlays_old_deleted: 0,
    sharp_parlays_duplicates_deleted: 0,
    heat_parlays_deleted: 0,
    risk_engine_picks_deleted: 0,
    prop_v2_picks_deleted: 0,
    sweet_spot_tracking_deleted: 0,
    errors: [] as string[],
  };

  const now = new Date().toISOString();
  const todayEastern = getEasternDate();
  // Extended retention: 30 days instead of 7
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  try {
    // IMMEDIATE MODE: Quick cleanup of started games only, skip archive
    if (isImmediate) {
      console.log('[Cleanup] IMMEDIATE MODE - clearing started games only...');
      
      // 1. Delete props where game has already started
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

      // 2. Delete risk engine picks for past game dates (already settled)
      const { data: stalePicks, error: stalePicksError } = await supabase
        .from('nba_risk_engine_picks')
        .delete()
        .lt('game_date', todayEastern)
        .select('id');

      if (stalePicksError) {
        console.error('[Cleanup] Error deleting stale risk picks:', stalePicksError);
        results.errors.push(`nba_risk_engine_picks: ${stalePicksError.message}`);
      } else {
        results.risk_engine_picks_deleted = stalePicks?.length || 0;
        console.log(`[Cleanup] Deleted ${results.risk_engine_picks_deleted} past risk engine picks`);
      }

      // 3. Delete prop v2 picks for past game dates
      const { data: staleV2Picks, error: staleV2Error } = await supabase
        .from('prop_engine_v2_picks')
        .delete()
        .lt('game_date', todayEastern)
        .select('id');

      if (staleV2Error) {
        console.error('[Cleanup] Error deleting stale prop v2 picks:', staleV2Error);
        results.errors.push(`prop_engine_v2_picks: ${staleV2Error.message}`);
      } else {
        results.prop_v2_picks_deleted = staleV2Picks?.length || 0;
        console.log(`[Cleanup] Deleted ${results.prop_v2_picks_deleted} past prop v2 picks`);
      }

      // 4. Delete sweet_spot_tracking for past game dates
      const { data: staleSweetSpot, error: staleSweetSpotError } = await supabase
        .from('sweet_spot_tracking')
        .delete()
        .lt('game_date', todayEastern)
        .select('id');

      if (staleSweetSpotError) {
        console.error('[Cleanup] Error deleting stale sweet spot tracking:', staleSweetSpotError);
        results.errors.push(`sweet_spot_tracking: ${staleSweetSpotError.message}`);
      } else {
        results.sweet_spot_tracking_deleted = staleSweetSpot?.length || 0;
        console.log(`[Cleanup] Deleted ${results.sweet_spot_tracking_deleted} past sweet spot picks`);
      }

      // 5. NEW: Delete risk engine picks for games that have already started today
      // (their props are gone from unified_props but picks remain)
      console.log('[Cleanup] Step 5: Cleaning orphaned risk picks for started games...');
      
      // Get all player names from active props (future games only)
      const { data: activeProps } = await supabase
        .from('unified_props')
        .select('player_name')
        .gte('commence_time', now);
      
      const activePlayers = new Set(
        (activeProps || []).map(p => p.player_name?.toLowerCase()).filter(Boolean)
      );
      
      console.log(`[Cleanup] Found ${activePlayers.size} active players with upcoming props`);
      
      // Get today's risk picks
      const { data: todayPicks } = await supabase
        .from('nba_risk_engine_picks')
        .select('id, player_name')
        .eq('game_date', todayEastern);
      
      // Find picks that don't have matching active props (game already started)
      const orphanedPickIds = (todayPicks || [])
        .filter(pick => !activePlayers.has(pick.player_name?.toLowerCase()))
        .map(pick => pick.id);
      
      if (orphanedPickIds.length > 0) {
        const { error: orphanDeleteError } = await supabase
          .from('nba_risk_engine_picks')
          .delete()
          .in('id', orphanedPickIds);
        
        if (!orphanDeleteError) {
          console.log(`[Cleanup] Deleted ${orphanedPickIds.length} orphaned risk picks (games started)`);
          results.risk_engine_picks_deleted += orphanedPickIds.length;
        } else {
          console.error('[Cleanup] Error deleting orphaned picks:', orphanDeleteError);
          results.errors.push(`orphaned_picks: ${orphanDeleteError.message}`);
        }
      } else {
        console.log('[Cleanup] No orphaned risk picks found');
      }

      const durationMs = Date.now() - startTime;
      console.log('[Cleanup] IMMEDIATE mode completed in', durationMs, 'ms');

      return new Response(
        JSON.stringify({
          success: results.errors.length === 0,
          message: `Immediate cleanup completed in ${durationMs}ms`,
          results,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // FULL MODE: Archive first, then comprehensive cleanup
    // STEP 0: Archive all settled picks FIRST before any cleanup
    console.log('[Cleanup] Step 0: Running archive-prop-results first...');
    try {
      const archiveResponse = await fetch(`${supabaseUrl}/functions/v1/archive-prop-results`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (archiveResponse.ok) {
        const archiveData = await archiveResponse.json();
        results.archive_completed = true;
        results.archive_results = archiveData.results;
        console.log('[Cleanup] Archive completed:', JSON.stringify(archiveData.results));
      } else {
        const errorText = await archiveResponse.text();
        console.error('[Cleanup] Archive failed:', errorText);
        results.errors.push(`archive: ${errorText}`);
      }
    } catch (archiveErr) {
      console.error('[Cleanup] Archive error:', archiveErr);
      results.errors.push(`archive: ${archiveErr instanceof Error ? archiveErr.message : 'Unknown error'}`);
    }

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

    // 2. Delete old sharp_ai_parlays (older than 30 days - extended from 7)
    console.log('[Cleanup] Step 2: Cleaning old sharp_ai_parlays...');
    const { data: oldSharpParlays, error: oldSharpError } = await supabase
      .from('sharp_ai_parlays')
      .delete()
      .lt('parlay_date', thirtyDaysAgo)
      .select('id');

    if (oldSharpError) {
      console.error('[Cleanup] Error deleting old sharp parlays:', oldSharpError);
      results.errors.push(`sharp_ai_parlays (old): ${oldSharpError.message}`);
    } else {
      results.sharp_parlays_old_deleted = oldSharpParlays?.length || 0;
      console.log(`[Cleanup] Deleted ${results.sharp_parlays_old_deleted} old sharp parlays (30+ days)`);
    }

    // 3. Deduplicate sharp_ai_parlays - keep only newest per date/type
    console.log('[Cleanup] Step 3: Deduplicating sharp_ai_parlays...');
    
    const { data: allSharpParlays, error: fetchError } = await supabase
      .from('sharp_ai_parlays')
      .select('id, parlay_date, parlay_type, created_at')
      .order('created_at', { ascending: false });

    if (fetchError) {
      console.error('[Cleanup] Error fetching sharp parlays for dedup:', fetchError);
      results.errors.push(`sharp_ai_parlays (dedup fetch): ${fetchError.message}`);
    } else if (allSharpParlays && allSharpParlays.length > 0) {
      const groups: Record<string, typeof allSharpParlays> = {};
      for (const parlay of allSharpParlays) {
        const key = `${parlay.parlay_date}_${parlay.parlay_type}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(parlay);
      }

      const idsToDelete: string[] = [];
      for (const key in groups) {
        if (groups[key].length > 1) {
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

    // 4. Delete old heat_parlays (older than 30 days - extended from 7)
    console.log('[Cleanup] Step 4: Cleaning old heat_parlays...');
    const { data: oldHeatParlays, error: oldHeatError } = await supabase
      .from('heat_parlays')
      .delete()
      .lt('parlay_date', thirtyDaysAgo)
      .select('id');

    if (oldHeatError) {
      console.error('[Cleanup] Error deleting old heat parlays:', oldHeatError);
      results.errors.push(`heat_parlays: ${oldHeatError.message}`);
    } else {
      results.heat_parlays_deleted = oldHeatParlays?.length || 0;
      console.log(`[Cleanup] Deleted ${results.heat_parlays_deleted} old heat parlays (30+ days)`);
    }

    // 5. Delete old nba_risk_engine_picks (older than 30 days, after archive)
    // Changed from deleting all past dates to only 30+ days old
    console.log('[Cleanup] Step 5: Cleaning old nba_risk_engine_picks...');
    const { data: stalePicks, error: stalePicksError } = await supabase
      .from('nba_risk_engine_picks')
      .delete()
      .lt('game_date', thirtyDaysAgo)
      .select('id');

    if (stalePicksError) {
      console.error('[Cleanup] Error deleting stale risk engine picks:', stalePicksError);
      results.errors.push(`nba_risk_engine_picks: ${stalePicksError.message}`);
    } else {
      results.risk_engine_picks_deleted = stalePicks?.length || 0;
      console.log(`[Cleanup] Deleted ${results.risk_engine_picks_deleted} old risk engine picks (30+ days)`);
    }

    // 6. Delete old prop_engine_v2_picks (older than 30 days, after archive)
    console.log('[Cleanup] Step 6: Cleaning old prop_engine_v2_picks...');
    const { data: staleV2Picks, error: staleV2Error } = await supabase
      .from('prop_engine_v2_picks')
      .delete()
      .lt('game_date', thirtyDaysAgo)
      .select('id');

    if (staleV2Error) {
      console.error('[Cleanup] Error deleting stale prop v2 picks:', staleV2Error);
      results.errors.push(`prop_engine_v2_picks: ${staleV2Error.message}`);
    } else {
      results.prop_v2_picks_deleted = staleV2Picks?.length || 0;
      console.log(`[Cleanup] Deleted ${results.prop_v2_picks_deleted} old prop v2 picks (30+ days)`);
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