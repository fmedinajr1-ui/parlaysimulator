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
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('[Sync Archetypes] Starting archetype sync job...');

  try {
    // Step 1: Fetch all known player archetypes
    const { data: archetypes, error: archError } = await supabase
      .from('player_archetypes')
      .select('player_name, primary_archetype')
      .neq('primary_archetype', 'UNKNOWN')
      .not('primary_archetype', 'is', null);

    if (archError) {
      console.error('[Sync Archetypes] Error fetching player_archetypes:', archError);
      throw archError;
    }

    console.log(`[Sync Archetypes] Found ${archetypes?.length || 0} known archetypes`);

    if (!archetypes || archetypes.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No archetypes to sync',
        updated: 0,
        duration_ms: Date.now() - startTime
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Step 2: Get current UNKNOWN archetypes in category_sweet_spots
    const { data: unknownEntries, error: unknownError } = await supabase
      .from('category_sweet_spots')
      .select('id, player_name, archetype')
      .or('archetype.eq.UNKNOWN,archetype.is.null');

    if (unknownError) {
      console.error('[Sync Archetypes] Error fetching unknown archetypes:', unknownError);
      throw unknownError;
    }

    console.log(`[Sync Archetypes] Found ${unknownEntries?.length || 0} entries with UNKNOWN/null archetype`);

    // Step 3: Build lookup map for quick matching
    const archetypeMap = new Map<string, string>();
    archetypes.forEach(a => {
      if (a.player_name && a.primary_archetype) {
        // Store both exact and lowercase for flexible matching
        archetypeMap.set(a.player_name.toLowerCase(), a.primary_archetype);
      }
    });

    // Step 4: Find matches and update
    let updatedCount = 0;
    let matchedPlayers: string[] = [];

    for (const entry of unknownEntries || []) {
      const playerKey = entry.player_name?.toLowerCase();
      if (!playerKey) continue;

      const matchedArchetype = archetypeMap.get(playerKey);
      if (matchedArchetype) {
        const { error: updateError } = await supabase
          .from('category_sweet_spots')
          .update({ archetype: matchedArchetype })
          .eq('id', entry.id);

        if (updateError) {
          console.warn(`[Sync Archetypes] Failed to update ${entry.player_name}:`, updateError);
        } else {
          updatedCount++;
          if (!matchedPlayers.includes(entry.player_name || '')) {
            matchedPlayers.push(entry.player_name || '');
          }
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Sync Archetypes] Complete: Updated ${updatedCount} entries for ${matchedPlayers.length} unique players in ${duration}ms`);
    console.log(`[Sync Archetypes] Players synced: ${matchedPlayers.slice(0, 20).join(', ')}${matchedPlayers.length > 20 ? '...' : ''}`);

    // Step 5: Log summary stats
    const { count: remainingUnknown } = await supabase
      .from('category_sweet_spots')
      .select('*', { count: 'exact', head: true })
      .or('archetype.eq.UNKNOWN,archetype.is.null');

    console.log(`[Sync Archetypes] Remaining UNKNOWN/null archetypes: ${remainingUnknown || 0}`);

    return new Response(JSON.stringify({
      success: true,
      message: `Synced ${updatedCount} archetype entries`,
      updated: updatedCount,
      unique_players: matchedPlayers.length,
      remaining_unknown: remainingUnknown || 0,
      sample_players: matchedPlayers.slice(0, 10),
      duration_ms: duration
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Sync Archetypes] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
