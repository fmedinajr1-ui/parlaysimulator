import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BDL_V1_URL = 'https://api.balldontlie.io/v1';
const ESPN_API_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

// NBA Team ID mapping for Ball Don't Lie API
const NBA_TEAMS: Record<string, number> = {
  'Atlanta Hawks': 1,
  'Boston Celtics': 2,
  'Brooklyn Nets': 3,
  'Charlotte Hornets': 4,
  'Chicago Bulls': 5,
  'Cleveland Cavaliers': 6,
  'Dallas Mavericks': 7,
  'Denver Nuggets': 8,
  'Detroit Pistons': 9,
  'Golden State Warriors': 10,
  'Houston Rockets': 11,
  'Indiana Pacers': 12,
  'LA Clippers': 13,
  'Los Angeles Lakers': 14,
  'Memphis Grizzlies': 15,
  'Miami Heat': 16,
  'Milwaukee Bucks': 17,
  'Minnesota Timberwolves': 18,
  'New Orleans Pelicans': 19,
  'New York Knicks': 20,
  'Oklahoma City Thunder': 21,
  'Orlando Magic': 22,
  'Philadelphia 76ers': 23,
  'Phoenix Suns': 24,
  'Portland Trail Blazers': 25,
  'Sacramento Kings': 26,
  'San Antonio Spurs': 27,
  'Toronto Raptors': 28,
  'Utah Jazz': 29,
  'Washington Wizards': 30,
};

// ESPN Team ID mapping
const ESPN_TEAM_IDS: Record<string, string> = {
  'Atlanta Hawks': '1',
  'Boston Celtics': '2',
  'Brooklyn Nets': '17',
  'Charlotte Hornets': '30',
  'Chicago Bulls': '4',
  'Cleveland Cavaliers': '5',
  'Dallas Mavericks': '6',
  'Denver Nuggets': '7',
  'Detroit Pistons': '8',
  'Golden State Warriors': '9',
  'Houston Rockets': '10',
  'Indiana Pacers': '11',
  'LA Clippers': '12',
  'Los Angeles Lakers': '13',
  'Memphis Grizzlies': '29',
  'Miami Heat': '14',
  'Milwaukee Bucks': '15',
  'Minnesota Timberwolves': '16',
  'New Orleans Pelicans': '3',
  'New York Knicks': '18',
  'Oklahoma City Thunder': '25',
  'Orlando Magic': '19',
  'Philadelphia 76ers': '20',
  'Phoenix Suns': '21',
  'Portland Trail Blazers': '22',
  'Sacramento Kings': '23',
  'San Antonio Spurs': '24',
  'Toronto Raptors': '28',
  'Utah Jazz': '26',
  'Washington Wizards': '27',
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Normalize player names for fuzzy matching (handles diacritics and suffixes)
function normalizePlayerName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics (Şengün → Sengun)
    .replace(/\s+(Jr\.?|Sr\.?|III|II|IV)$/i, '') // Remove suffixes
    .toLowerCase()
    .trim();
}

// Find best ESPN match for a player name
function findESPNMatch(playerName: string, espnJerseys: Map<string, string>): string | null {
  // Exact match first
  if (espnJerseys.has(playerName)) {
    return espnJerseys.get(playerName)!;
  }
  
  // Normalized match
  const normalizedTarget = normalizePlayerName(playerName);
  for (const [espnName, jersey] of espnJerseys.entries()) {
    if (normalizePlayerName(espnName) === normalizedTarget) {
      return jersey;
    }
  }
  
  // Partial last name match (for unique last names)
  const targetLastName = normalizedTarget.split(' ').pop();
  if (targetLastName && targetLastName.length > 4) {
    for (const [espnName, jersey] of espnJerseys.entries()) {
      const espnLastName = normalizePlayerName(espnName).split(' ').pop();
      if (targetLastName === espnLastName) {
        return jersey;
      }
    }
  }
  
  return null;
}

// Fetch jersey data from ESPN API as fallback
async function fetchESPNJerseys(teamName: string): Promise<Map<string, string>> {
  const teamId = ESPN_TEAM_IDS[teamName];
  if (!teamId) {
    console.log(`[sync-missing-rosters] No ESPN team ID for: ${teamName}`);
    return new Map();
  }
  
  try {
    const response = await fetch(`${ESPN_API_URL}/teams/${teamId}/roster`);
    if (!response.ok) {
      console.warn(`[sync-missing-rosters] ESPN roster fetch failed for ${teamName}: ${response.status}`);
      return new Map();
    }
    
    const data = await response.json();
    const jerseyMap = new Map<string, string>();
    
    for (const athlete of data.athletes || []) {
      const fullName = `${athlete.firstName} ${athlete.lastName}`;
      if (athlete.jersey) {
        jerseyMap.set(fullName, athlete.jersey);
      }
    }
    
    console.log(`[sync-missing-rosters] ESPN returned ${jerseyMap.size} jerseys for ${teamName}`);
    return jerseyMap;
  } catch (err) {
    console.warn(`[sync-missing-rosters] ESPN fetch error for ${teamName}:`, err);
    return new Map();
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const bdlApiKey = Deno.env.get('BALLDONTLIE_API_KEY');

    if (!bdlApiKey) {
      throw new Error('BALLDONTLIE_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { teams = [], force_espn = false } = await req.json().catch(() => ({}));
    
    console.log(`[sync-missing-rosters] Request: teams=${teams.join(',')}, force_espn=${force_espn}`);

    const headers = {
      'Authorization': bdlApiKey,
      'Content-Type': 'application/json',
    };

    // PHASE 1: Fix players with missing jersey numbers using BDL then ESPN fallback
    console.log('[sync-missing-rosters] Checking for players with missing jersey numbers...');
    
    const { data: missingJerseys } = await supabase
      .from('bdl_player_cache')
      .select('player_name, bdl_player_id, team_name')
      .is('jersey_number', null)
      .limit(50);

    if (missingJerseys && missingJerseys.length > 0) {
      console.log(`[sync-missing-rosters] Found ${missingJerseys.length} players with missing jersey numbers`);
      
      // Group players by team for ESPN batch lookup
      const playersByTeam = new Map<string, typeof missingJerseys>();
      for (const player of missingJerseys) {
        if (player.team_name) {
          const existing = playersByTeam.get(player.team_name) || [];
          existing.push(player);
          playersByTeam.set(player.team_name, existing);
        }
      }
      
      // Fetch ESPN jerseys for each team
      const espnJerseyCache = new Map<string, Map<string, string>>();
      for (const teamName of playersByTeam.keys()) {
        const jerseys = await fetchESPNJerseys(teamName);
        espnJerseyCache.set(teamName, jerseys);
        await delay(100); // Rate limit ESPN calls
      }
      
      // Try BDL first, then ESPN fallback
      for (const player of missingJerseys) {
        try {
          let jerseyNumber: string | null = null;
          
          // Try BDL API first if we have player ID
          if (player.bdl_player_id) {
            const response = await fetch(
              `${BDL_V1_URL}/players/${player.bdl_player_id}`,
              { headers }
            );
            
            if (response.ok) {
              const data = await response.json();
              if (data.jersey_number) {
                jerseyNumber = data.jersey_number.toString();
                console.log(`[sync-missing-rosters] BDL: ${player.player_name} -> #${jerseyNumber}`);
              }
            }
            await delay(100);
          }
          
          // Fallback to ESPN with fuzzy matching if BDL didn't have it
          if (!jerseyNumber && player.team_name) {
            const teamJerseys = espnJerseyCache.get(player.team_name);
            if (teamJerseys) {
              jerseyNumber = findESPNMatch(player.player_name, teamJerseys);
              if (jerseyNumber) {
                console.log(`[sync-missing-rosters] ESPN (fuzzy): ${player.player_name} -> #${jerseyNumber}`);
              }
            }
          }
          
          // Update if we found a jersey number
          if (jerseyNumber) {
            await supabase.from('bdl_player_cache').update({
              jersey_number: jerseyNumber,
              last_updated: new Date().toISOString(),
            }).eq('player_name', player.player_name);
          }
        } catch (err) {
          console.warn(`[sync-missing-rosters] Error processing ${player.player_name}:`, err);
        }
      }
    }

    // PHASE 2: Determine which teams to sync
    let teamsToSync: string[] = teams;
    
    if (teamsToSync.length === 0) {
      // Find teams with missing or incomplete roster data
      console.log('[sync-missing-rosters] Checking for teams with missing roster data...');
      
      const teamCounts: Record<string, number> = {};
      
      for (const teamName of Object.keys(NBA_TEAMS)) {
        const { count } = await supabase
          .from('bdl_player_cache')
          .select('*', { count: 'exact', head: true })
          .ilike('team_name', `%${teamName}%`);
        
        teamCounts[teamName] = count || 0;
        
        // Teams with fewer than 10 players need syncing
        if ((count || 0) < 10) {
          teamsToSync.push(teamName);
        }
      }
      
      console.log('[sync-missing-rosters] Team roster counts:', teamCounts);
    }

    if (teamsToSync.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'All teams have complete roster data',
        synced: 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[sync-missing-rosters] Syncing rosters for: ${teamsToSync.join(', ')}`);

    let totalInserted = 0;
    const results: Record<string, number> = {};

    for (const teamName of teamsToSync) {
      const bdlTeamId = NBA_TEAMS[teamName];
      
      if (!bdlTeamId) {
        console.warn(`[sync-missing-rosters] Unknown team: ${teamName}`);
        continue;
      }

      try {
        // Fetch players for this team from BDL API
        const url = `${BDL_V1_URL}/players?team_ids[]=${bdlTeamId}&per_page=25`;
        console.log(`[sync-missing-rosters] Fetching: ${url}`);
        
        const response = await fetch(url, { headers });
        
        if (!response.ok) {
          console.error(`[sync-missing-rosters] API error for ${teamName}: ${response.status}`);
          continue;
        }

        const data = await response.json();
        const players = data.data || [];
        
        console.log(`[sync-missing-rosters] Found ${players.length} players for ${teamName}`);

        let inserted = 0;
        for (const player of players) {
          const playerName = `${player.first_name} ${player.last_name}`;
          
          const { error } = await supabase.from('bdl_player_cache').upsert({
            bdl_player_id: player.id,
            player_name: playerName,
            team_name: teamName,
            jersey_number: player.jersey_number?.toString() || null,
            position: player.position || null,
            height: player.height || null,
            weight: player.weight || null,
            college: player.college || null,
            country: player.country || null,
            draft_year: player.draft_year || null,
            draft_round: player.draft_round || null,
            draft_number: player.draft_number || null,
            last_updated: new Date().toISOString(),
          }, { onConflict: 'player_name' });

          if (error) {
            console.warn(`[sync-missing-rosters] Upsert error for ${playerName}:`, error.message);
          } else {
            inserted++;
          }
        }

        results[teamName] = inserted;
        totalInserted += inserted;
        
        // Rate limiting between teams
        await delay(200);
        
      } catch (err) {
        console.error(`[sync-missing-rosters] Error syncing ${teamName}:`, err);
      }
    }

    console.log(`[sync-missing-rosters] Completed. Total inserted: ${totalInserted}`);

    return new Response(JSON.stringify({
      success: true,
      message: `Synced rosters for ${teamsToSync.length} teams`,
      synced: totalInserted,
      teams: results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[sync-missing-rosters] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
    }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});
