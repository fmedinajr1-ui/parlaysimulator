import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ESPN_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

// Normalize team name for matching
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/76ers/, 'sixers')
    .replace(/blazers/, 'trailblazers');
}

// Check if team names match (fuzzy)
function teamsMatch(espnName: string, inputName: string): boolean {
  const normalizedEspn = normalizeTeamName(espnName);
  const normalizedInput = normalizeTeamName(inputName);
  
  // Check for exact match
  if (normalizedEspn === normalizedInput) return true;
  
  // Check if one contains the other
  if (normalizedEspn.includes(normalizedInput) || normalizedInput.includes(normalizedEspn)) return true;
  
  // Check for common variations
  const words = inputName.toLowerCase().split(' ');
  return words.some(word => word.length > 3 && normalizedEspn.includes(word));
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { homeTeam, awayTeam } = await req.json();
    
    if (!homeTeam || !awayTeam) {
      return new Response(
        JSON.stringify({ error: 'homeTeam and awayTeam are required', espnEventId: null }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[ESPN Event ID] Looking up: ${awayTeam} @ ${homeTeam}`);

    // Fetch ESPN's NBA scoreboard
    const response = await fetch(ESPN_SCOREBOARD_URL);
    
    if (!response.ok) {
      console.error(`[ESPN Event ID] Scoreboard fetch failed: ${response.status}`);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch ESPN scoreboard', espnEventId: null }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const events = data.events || [];
    
    console.log(`[ESPN Event ID] Found ${events.length} games on scoreboard`);

    // Find matching game
    for (const event of events) {
      const competitors = event.competitions?.[0]?.competitors || [];
      const home = competitors.find((c: any) => c.homeAway === 'home');
      const away = competitors.find((c: any) => c.homeAway === 'away');

      if (!home || !away) continue;

      const espnHomeName = home.team?.displayName || home.team?.name || '';
      const espnAwayName = away.team?.displayName || away.team?.name || '';

      const homeMatch = teamsMatch(espnHomeName, homeTeam);
      const awayMatch = teamsMatch(espnAwayName, awayTeam);

      if (homeMatch && awayMatch) {
        console.log(`[ESPN Event ID] ✓ Found match: ${event.id} (${espnAwayName} @ ${espnHomeName})`);
        
        return new Response(
          JSON.stringify({
            espnEventId: event.id,
            status: event.status?.type?.name,
            gameName: event.name,
            shortName: event.shortName,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log(`[ESPN Event ID] ✗ No match found for ${awayTeam} @ ${homeTeam}`);
    
    // Log available games for debugging
    events.forEach((event: any) => {
      const competitors = event.competitions?.[0]?.competitors || [];
      const home = competitors.find((c: any) => c.homeAway === 'home');
      const away = competitors.find((c: any) => c.homeAway === 'away');
      console.log(`  Available: ${away?.team?.displayName} @ ${home?.team?.displayName} (${event.id})`);
    });

    return new Response(
      JSON.stringify({ espnEventId: null, reason: 'No matching game found' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[ESPN Event ID] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error', espnEventId: null }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
