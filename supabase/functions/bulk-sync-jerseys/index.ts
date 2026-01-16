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

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[bulk-sync] Starting bulk jersey sync for all 30 NBA teams...');

    // Fetch all players from cache
    const { data: players, error: fetchError } = await supabase
      .from('bdl_player_cache')
      .select('id, player_name, team_name, jersey_number, normalized_name')
      .order('team_name');

    if (fetchError) {
      throw new Error(`Failed to fetch players: ${fetchError.message}`);
    }

    console.log(`[bulk-sync] Found ${players?.length || 0} players in cache`);

    // Fetch ESPN rosters for all teams
    const espnData = new Map<string, Map<string, { jersey: string; position: string }>>();
    
    for (const [teamName, teamId] of Object.entries(ESPN_TEAM_IDS)) {
      const roster = await fetchESPNRoster(teamId);
      espnData.set(teamName, roster);
      console.log(`[bulk-sync] Fetched ${roster.size} players from ESPN for ${teamName}`);
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Match players and update jerseys
    let updatedCount = 0;
    let normalizedCount = 0;
    const updates: Array<{ id: string; jersey_number: string; normalized_name: string }> = [];

    for (const player of players || []) {
      const normalizedName = normalizePlayerName(player.player_name);
      
      // Find matching team roster
      const teamRoster = espnData.get(player.team_name);
      
      let newJersey = player.jersey_number;
      let needsUpdate = false;

      // If we have team roster, try to find jersey
      if (teamRoster) {
        const espnPlayer = teamRoster.get(normalizedName);
        if (espnPlayer?.jersey) {
          newJersey = espnPlayer.jersey;
          if (player.jersey_number !== newJersey) {
            needsUpdate = true;
          }
        }
      }

      // Update normalized_name if missing or different
      if (player.normalized_name !== normalizedName) {
        needsUpdate = true;
        normalizedCount++;
      }

      if (needsUpdate) {
        updates.push({
          id: player.id,
          jersey_number: newJersey,
          normalized_name: normalizedName
        });
      }
    }

    console.log(`[bulk-sync] Found ${updates.length} players to update`);

    // Batch update in chunks of 50
    const chunkSize = 50;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      
      for (const update of chunk) {
        const { error: updateError } = await supabase
          .from('bdl_player_cache')
          .update({
            jersey_number: update.jersey_number,
            normalized_name: update.normalized_name,
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

    // Count remaining missing jerseys
    const { count: stillMissing } = await supabase
      .from('bdl_player_cache')
      .select('id', { count: 'exact', head: true })
      .or('jersey_number.is.null,jersey_number.eq.');

    console.log(`[bulk-sync] Completed: ${updatedCount} players updated, ${stillMissing || 0} still missing jerseys`);

    return new Response(
      JSON.stringify({
        success: true,
        updated: updatedCount,
        normalizedNames: normalizedCount,
        stillMissing: stillMissing || 0,
        teamsProcessed: Object.keys(ESPN_TEAM_IDS).length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[bulk-sync] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
