import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BDL_V1_URL = 'https://api.balldontlie.io/v1';

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

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
    const { teams = [] } = await req.json().catch(() => ({}));

    const headers = {
      'Authorization': bdlApiKey,
      'Content-Type': 'application/json',
    };

    // Determine which teams to sync
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
