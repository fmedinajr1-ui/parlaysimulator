import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ESPN team IDs for all 30 NBA teams
const ESPN_TEAM_IDS: Record<string, number> = {
  'Atlanta Hawks': 1,
  'Boston Celtics': 2,
  'Brooklyn Nets': 17,
  'Charlotte Hornets': 30,
  'Chicago Bulls': 4,
  'Cleveland Cavaliers': 5,
  'Dallas Mavericks': 6,
  'Denver Nuggets': 7,
  'Detroit Pistons': 8,
  'Golden State Warriors': 9,
  'Houston Rockets': 10,
  'Indiana Pacers': 11,
  'LA Clippers': 12,
  'Los Angeles Lakers': 13,
  'Memphis Grizzlies': 29,
  'Miami Heat': 14,
  'Milwaukee Bucks': 15,
  'Minnesota Timberwolves': 16,
  'New Orleans Pelicans': 3,
  'New York Knicks': 18,
  'Oklahoma City Thunder': 25,
  'Orlando Magic': 19,
  'Philadelphia 76ers': 20,
  'Phoenix Suns': 21,
  'Portland Trail Blazers': 22,
  'Sacramento Kings': 23,
  'San Antonio Spurs': 24,
  'Toronto Raptors': 28,
  'Utah Jazz': 26,
  'Washington Wizards': 27,
};

// Normalize player names for matching
function normalizePlayerName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // Remove diacritics (Şengün → Sengun)
    .replace(/[''`]/g, '')            // Remove apostrophes
    .replace(/\s+(Jr\.?|Sr\.?|III|II|IV|V)$/i, '')  // Remove suffixes
    .replace(/\./g, '')               // Remove periods
    .toLowerCase()
    .trim();
}

interface ESPNAthlete {
  displayName: string;
  jersey?: string;
  position?: {
    abbreviation?: string;
  };
}

interface ESPNRosterResponse {
  athletes?: ESPNAthlete[];
}

async function fetchESPNRoster(teamId: number): Promise<Map<string, { jersey: string; position: string }>> {
  const jerseys = new Map<string, { jersey: string; position: string }>();
  
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/roster`;
    const response = await fetch(url);
    
    if (!response.ok) {
      console.log(`[bulk-sync] ESPN API returned ${response.status} for team ${teamId}`);
      return jerseys;
    }
    
    const data: ESPNRosterResponse = await response.json();
    
    if (data.athletes && Array.isArray(data.athletes)) {
      for (const athlete of data.athletes) {
        if (athlete.displayName) {
          const normalizedName = normalizePlayerName(athlete.displayName);
          jerseys.set(normalizedName, {
            jersey: athlete.jersey || '',
            position: athlete.position?.abbreviation || ''
          });
        }
      }
    }
  } catch (error) {
    console.error(`[bulk-sync] Error fetching ESPN roster for team ${teamId}:`, error);
  }
  
  return jerseys;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Create cron job history record
  let jobRecordId: string | null = null;
  try {
    const { data: jobRecord } = await supabase
      .from('cron_job_history')
      .insert({
        job_name: 'bulk-sync-jerseys',
        status: 'running',
        started_at: new Date().toISOString()
      })
      .select('id')
      .single();
    jobRecordId = jobRecord?.id || null;
  } catch (e) {
    console.warn('[bulk-sync] Could not create job history record:', e);
  }

  try {
    console.log('[bulk-sync] Starting bulk jersey sync for all 30 NBA teams...');

    // Step 1: Fetch ESPN rosters for all teams FIRST
    const espnData = new Map<string, Map<string, { jersey: string; position: string }>>();
    const espnActivePlayersByTeam = new Map<string, Set<string>>();
    
    for (const [teamName, teamId] of Object.entries(ESPN_TEAM_IDS)) {
      const roster = await fetchESPNRoster(teamId);
      espnData.set(teamName, roster);
      espnActivePlayersByTeam.set(teamName, new Set(roster.keys()));
      console.log(`[bulk-sync] Fetched ${roster.size} players from ESPN for ${teamName}`);
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Step 2: Mark ALL players in cache as inactive first
    console.log('[bulk-sync] Marking all players as inactive...');
    const { error: deactivateError } = await supabase
      .from('bdl_player_cache')
      .update({ is_active: false })
      .not('id', 'is', null); // Update all rows

    if (deactivateError) {
      console.error('[bulk-sync] Error deactivating players:', deactivateError);
    }

    // Step 3: Fetch all players from cache
    const { data: players, error: fetchError } = await supabase
      .from('bdl_player_cache')
      .select('id, player_name, team_name, jersey_number, normalized_name')
      .order('team_name');

    if (fetchError) {
      throw new Error(`Failed to fetch players: ${fetchError.message}`);
    }

    console.log(`[bulk-sync] Found ${players?.length || 0} players in cache`);

    // Step 4: Match players and update jerseys + is_active status
    let updatedCount = 0;
    let activatedCount = 0;
    const updates: Array<{ id: string; jersey_number: string; normalized_name: string; is_active: boolean }> = [];

    for (const player of players || []) {
      const normalizedName = normalizePlayerName(player.player_name);
      
      // Find matching team roster
      const teamRoster = espnData.get(player.team_name);
      const activePlayersSet = espnActivePlayersByTeam.get(player.team_name);
      
      let newJersey = player.jersey_number || '';
      let isActive = false;

      // If we have team roster, check if player is on current ESPN roster
      if (teamRoster && activePlayersSet) {
        const isOnCurrentRoster = activePlayersSet.has(normalizedName);
        
        if (isOnCurrentRoster) {
          isActive = true;
          activatedCount++;
          
          const espnPlayer = teamRoster.get(normalizedName);
          if (espnPlayer?.jersey) {
            newJersey = espnPlayer.jersey;
          }
        }
      }

      // Only update if something changed
      const needsUpdate = 
        player.normalized_name !== normalizedName ||
        player.jersey_number !== newJersey ||
        isActive; // Always update if player should be active

      if (needsUpdate) {
        updates.push({
          id: player.id,
          jersey_number: newJersey,
          normalized_name: normalizedName,
          is_active: isActive
        });
      }
    }

    console.log(`[bulk-sync] Found ${updates.length} players to update, ${activatedCount} will be marked active`);

    // Step 5: Batch update in chunks of 50
    const chunkSize = 50;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      
      for (const update of chunk) {
        const { error: updateError } = await supabase
          .from('bdl_player_cache')
          .update({
            jersey_number: update.jersey_number,
            normalized_name: update.normalized_name,
            is_active: update.is_active,
            last_updated: new Date().toISOString()
          })
          .eq('id', update.id);

        if (!updateError) {
          updatedCount++;
        } else {
          console.error(`[bulk-sync] Error updating player ${update.id}:`, updateError);
        }
      }
    }

    // Step 6: Count active players per team for verification
    const { data: activeCounts } = await supabase
      .from('bdl_player_cache')
      .select('team_name')
      .eq('is_active', true);

    const teamCounts: Record<string, number> = {};
    (activeCounts || []).forEach(p => {
      teamCounts[p.team_name] = (teamCounts[p.team_name] || 0) + 1;
    });

    console.log('[bulk-sync] Active players per team:', teamCounts);

    // Count remaining missing jerseys among active players
    const { count: stillMissing } = await supabase
      .from('bdl_player_cache')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .or('jersey_number.is.null,jersey_number.eq.');

    console.log(`[bulk-sync] Completed: ${updatedCount} players updated, ${activatedCount} marked active, ${stillMissing || 0} active players still missing jerseys`);

    const result = {
      success: true,
      updated: updatedCount,
      activated: activatedCount,
      stillMissing: stillMissing || 0,
      teamsProcessed: Object.keys(ESPN_TEAM_IDS).length,
      activePlayersPerTeam: teamCounts
    };

    // Update cron job history with success
    if (jobRecordId) {
      await supabase
        .from('cron_job_history')
        .update({
          status: 'success',
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          result: result
        })
        .eq('id', jobRecordId);
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[bulk-sync] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Update cron job history with failure
    if (jobRecordId) {
      await supabase
        .from('cron_job_history')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          error_message: errorMessage
        })
        .eq('id', jobRecordId);
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
