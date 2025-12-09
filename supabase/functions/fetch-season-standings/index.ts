import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ESPN API endpoints (free, no API key required)
const ESPN_NBA_STANDINGS = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';
const ESPN_NFL_STANDINGS = 'https://site.api.espn.com/apis/v2/sports/football/nfl/standings';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { sport } = await req.json().catch(() => ({}));
    
    console.log(`[Season Standings] Fetching standings for: ${sport || 'all'}`);

    const results: any[] = [];
    const currentSeason = getCurrentSeason();

    // Fetch NBA standings
    if (!sport || sport === 'NBA' || sport === 'basketball_nba') {
      try {
        const nbaStandings = await fetchESPNStandings(ESPN_NBA_STANDINGS, 'NBA', currentSeason.nba);
        results.push(...nbaStandings);
        console.log(`[Season Standings] Fetched ${nbaStandings.length} NBA teams`);
      } catch (error) {
        console.error('[Season Standings] NBA fetch error:', error);
      }
    }

    // Fetch NFL standings
    if (!sport || sport === 'NFL' || sport === 'americanfootball_nfl') {
      try {
        const nflStandings = await fetchESPNStandings(ESPN_NFL_STANDINGS, 'NFL', currentSeason.nfl);
        results.push(...nflStandings);
        console.log(`[Season Standings] Fetched ${nflStandings.length} NFL teams`);
      } catch (error) {
        console.error('[Season Standings] NFL fetch error:', error);
      }
    }

    // Upsert to database
    let upsertedCount = 0;
    for (const standing of results) {
      const { error } = await supabase
        .from('team_season_standings')
        .upsert(standing, { 
          onConflict: 'sport,team_name,season'
        });

      if (error) {
        console.error(`[Season Standings] Upsert error for ${standing.team_name}:`, error);
      } else {
        upsertedCount++;
      }
    }

    console.log(`[Season Standings] Successfully upserted ${upsertedCount}/${results.length} standings`);

    return new Response(JSON.stringify({
      success: true,
      teamsUpdated: upsertedCount,
      sports: sport ? [sport] : ['NBA', 'NFL'],
      season: currentSeason
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[Season Standings] Error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function getCurrentSeason() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // NBA season runs Oct-June
  const nbaSeason = month >= 10 ? `${year}-${(year + 1).toString().slice(2)}` : `${year - 1}-${year.toString().slice(2)}`;
  
  // NFL season runs Sept-Feb
  const nflSeason = month >= 9 ? `${year}` : `${year - 1}`;

  return { nba: nbaSeason, nfl: nflSeason };
}

async function fetchESPNStandings(url: string, sport: string, season: string): Promise<any[]> {
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`ESPN API error: ${response.status}`);
  }

  const data = await response.json();
  const standings: any[] = [];

  // Parse ESPN's nested structure
  const children = data.children || [];
  
  for (const conference of children) {
    const conferenceName = conference.name || conference.abbreviation || '';
    const confStandings = conference.standings?.entries || [];

    for (const entry of confStandings) {
      const team = entry.team || {};
      const stats = entry.stats || [];

      // Extract stats by name
      const statMap: Record<string, any> = {};
      for (const stat of stats) {
        statMap[stat.name] = stat.value;
        if (stat.displayValue) {
          statMap[`${stat.name}_display`] = stat.displayValue;
        }
      }

      // Map team names to match The Odds API format
      const teamName = normalizeTeamName(team.displayName || team.name || '', sport);

      standings.push({
        sport,
        team_name: teamName,
        wins: statMap.wins || 0,
        losses: statMap.losses || 0,
        ties: statMap.ties || 0,
        win_pct: statMap.winPercent || statMap.leagueWinPercent || 0.5,
        home_record: statMap.Home_display || statMap.home_display || null,
        away_record: statMap.Road_display || statMap.away_display || null,
        last_10: statMap.Last_Ten_Games_display || null,
        streak: statMap.streak_display || null,
        conference: conferenceName,
        division: entry.team?.division?.name || null,
        conference_rank: statMap.playoffSeed || null,
        division_rank: statMap.divisionWinPercent ? null : null,
        points_for: statMap.pointsFor || statMap.avgPointsFor || 0,
        points_against: statMap.pointsAgainst || statMap.avgPointsAgainst || 0,
        point_differential: statMap.differential || (statMap.pointsFor || 0) - (statMap.pointsAgainst || 0),
        season,
        updated_at: new Date().toISOString()
      });
    }
  }

  return standings;
}

// Normalize team names to match The Odds API format
function normalizeTeamName(name: string, sport: string): string {
  // Common mappings
  const mappings: Record<string, string> = {
    // NBA
    'LA Clippers': 'Los Angeles Clippers',
    'LA Lakers': 'Los Angeles Lakers',
    // NFL
    'Washington Commanders': 'Washington Commanders',
  };

  return mappings[name] || name;
}
