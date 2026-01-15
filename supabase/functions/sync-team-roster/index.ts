import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BDL_V1_URL = 'https://api.balldontlie.io/v1';

interface BDLPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  height: string;
  weight: string;
  jersey_number: string;
  college: string;
  country: string;
  draft_year: number;
  draft_round: number;
  draft_number: number;
  team: {
    id: number;
    conference: string;
    division: string;
    city: string;
    name: string;
    full_name: string;
    abbreviation: string;
  };
}

interface SyncRequest {
  teamNames: string[];
  forceRefresh?: boolean;
}

// Rate limiting helper
async function fetchWithDelay(url: string, apiKey: string, delayMs: number = 100): Promise<Response> {
  await new Promise(resolve => setTimeout(resolve, delayMs));
  return fetch(url, {
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
  });
}

// Map team names to BDL team abbreviations/names
const TEAM_NAME_MAP: Record<string, string> = {
  'Atlanta Hawks': 'Atlanta Hawks',
  'Boston Celtics': 'Boston Celtics',
  'Brooklyn Nets': 'Brooklyn Nets',
  'Charlotte Hornets': 'Charlotte Hornets',
  'Chicago Bulls': 'Chicago Bulls',
  'Cleveland Cavaliers': 'Cleveland Cavaliers',
  'Dallas Mavericks': 'Dallas Mavericks',
  'Denver Nuggets': 'Denver Nuggets',
  'Detroit Pistons': 'Detroit Pistons',
  'Golden State Warriors': 'Golden State Warriors',
  'Houston Rockets': 'Houston Rockets',
  'Indiana Pacers': 'Indiana Pacers',
  'Los Angeles Clippers': 'LA Clippers',
  'LA Clippers': 'LA Clippers',
  'Los Angeles Lakers': 'Los Angeles Lakers',
  'LA Lakers': 'Los Angeles Lakers',
  'Memphis Grizzlies': 'Memphis Grizzlies',
  'Miami Heat': 'Miami Heat',
  'Milwaukee Bucks': 'Milwaukee Bucks',
  'Minnesota Timberwolves': 'Minnesota Timberwolves',
  'New Orleans Pelicans': 'New Orleans Pelicans',
  'New York Knicks': 'New York Knicks',
  'Oklahoma City Thunder': 'Oklahoma City Thunder',
  'Orlando Magic': 'Orlando Magic',
  'Philadelphia 76ers': 'Philadelphia 76ers',
  'Phoenix Suns': 'Phoenix Suns',
  'Portland Trail Blazers': 'Portland Trail Blazers',
  'Sacramento Kings': 'Sacramento Kings',
  'San Antonio Spurs': 'San Antonio Spurs',
  'Toronto Raptors': 'Toronto Raptors',
  'Utah Jazz': 'Utah Jazz',
  'Washington Wizards': 'Washington Wizards',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { teamNames, forceRefresh = false } = await req.json() as SyncRequest;

    if (!teamNames || teamNames.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No team names provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const BDL_API_KEY = Deno.env.get('BALLDONTLIE_API_KEY');
    if (!BDL_API_KEY) {
      throw new Error('BALLDONTLIE_API_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[sync-team-roster] Syncing rosters for: ${teamNames.join(', ')}`);

    const results: {
      team: string;
      playersFound: number;
      playersUpdated: number;
      playersWithJersey: number;
    }[] = [];

    for (const teamName of teamNames) {
      const normalizedTeam = TEAM_NAME_MAP[teamName] || teamName;
      console.log(`[sync-team-roster] Processing team: ${teamName} -> ${normalizedTeam}`);

      // Check if we need to refresh (skip if recently synced and not forcing)
      if (!forceRefresh) {
        const { data: recentPlayers } = await supabase
          .from('bdl_player_cache')
          .select('last_updated')
          .ilike('team_name', `%${normalizedTeam}%`)
          .not('jersey_number', 'is', null)
          .order('last_updated', { ascending: false })
          .limit(1);

        if (recentPlayers && recentPlayers.length > 0) {
          const lastUpdate = new Date(recentPlayers[0].last_updated);
          const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);
          
          if (hoursSinceUpdate < 24) {
            console.log(`[sync-team-roster] ${teamName} recently synced (${hoursSinceUpdate.toFixed(1)}h ago), skipping`);
            
            // Still count current roster
            const { data: existingRoster } = await supabase
              .from('bdl_player_cache')
              .select('jersey_number')
              .ilike('team_name', `%${normalizedTeam}%`);

            const playersWithJersey = (existingRoster || []).filter(p => 
              p.jersey_number && p.jersey_number !== '?' && p.jersey_number.trim() !== ''
            ).length;

            results.push({
              team: teamName,
              playersFound: existingRoster?.length || 0,
              playersUpdated: 0,
              playersWithJersey,
            });
            continue;
          }
        }
      }

      // Fetch all active players from BDL
      let allPlayers: BDLPlayer[] = [];
      let cursor: number | null = null;
      let pageCount = 0;
      const maxPages = 5; // Limit pages to avoid rate limits

      do {
        const url = cursor 
          ? `${BDL_V1_URL}/players?team_ids[]=${await getTeamId(normalizedTeam, BDL_API_KEY)}&per_page=100&cursor=${cursor}`
          : `${BDL_V1_URL}/players?per_page=100&search=${encodeURIComponent(normalizedTeam.split(' ').pop() || '')}`;
        
        const response = await fetchWithDelay(url, BDL_API_KEY, 150);
        
        if (!response.ok) {
          console.error(`[sync-team-roster] BDL API error: ${response.status}`);
          break;
        }

        const data = await response.json();
        
        // Filter to only players on the target team
        const teamPlayers = (data.data || []).filter((p: BDLPlayer) => 
          p.team?.full_name?.toLowerCase().includes(normalizedTeam.toLowerCase().split(' ').pop() || '')
        );
        
        allPlayers = [...allPlayers, ...teamPlayers];
        cursor = data.meta?.next_cursor || null;
        pageCount++;
        
        console.log(`[sync-team-roster] Fetched page ${pageCount}, found ${teamPlayers.length} players for ${teamName}`);
      } while (cursor && pageCount < maxPages);

      // Dedupe by player ID
      const uniquePlayers = Array.from(
        new Map(allPlayers.map(p => [p.id, p])).values()
      );

      console.log(`[sync-team-roster] Total unique players for ${teamName}: ${uniquePlayers.length}`);

      // Upsert players to cache
      let updatedCount = 0;
      let withJerseyCount = 0;

      for (const player of uniquePlayers) {
        const playerName = `${player.first_name} ${player.last_name}`;
        const hasJersey = player.jersey_number && player.jersey_number.trim() !== '';
        
        if (hasJersey) withJerseyCount++;

        const { error } = await supabase.from('bdl_player_cache').upsert({
          bdl_player_id: player.id,
          player_name: playerName,
          position: player.position || null,
          team_name: player.team?.full_name || normalizedTeam,
          jersey_number: player.jersey_number || null,
          height: player.height || null,
          weight: player.weight || null,
          college: player.college || null,
          country: player.country || null,
          draft_year: player.draft_year || null,
          draft_round: player.draft_round || null,
          draft_number: player.draft_number || null,
          last_updated: new Date().toISOString(),
        }, { onConflict: 'player_name' });

        if (!error) updatedCount++;
      }

      results.push({
        team: teamName,
        playersFound: uniquePlayers.length,
        playersUpdated: updatedCount,
        playersWithJersey: withJerseyCount,
      });

      console.log(`[sync-team-roster] ${teamName}: ${updatedCount}/${uniquePlayers.length} synced, ${withJerseyCount} with jerseys`);
    }

    const totalPlayers = results.reduce((sum, r) => sum + r.playersFound, 0);
    const totalWithJerseys = results.reduce((sum, r) => sum + r.playersWithJersey, 0);

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          teamsProcessed: results.length,
          totalPlayers,
          totalWithJerseys,
          coveragePercent: totalPlayers > 0 ? Math.round((totalWithJerseys / totalPlayers) * 100) : 0,
        },
        details: results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[sync-team-roster] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Helper to get team ID from BDL
async function getTeamId(teamName: string, apiKey: string): Promise<number | null> {
  try {
    const response = await fetchWithDelay(`${BDL_V1_URL}/teams`, apiKey, 100);
    if (!response.ok) return null;
    
    const data = await response.json();
    const team = (data.data || []).find((t: any) => 
      t.full_name.toLowerCase() === teamName.toLowerCase() ||
      t.name.toLowerCase() === teamName.split(' ').pop()?.toLowerCase()
    );
    
    return team?.id || null;
  } catch {
    return null;
  }
}
