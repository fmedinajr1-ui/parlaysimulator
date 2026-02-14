/**
 * fetch-alternate-lines
 * 
 * Fetches alternate prop lines from The Odds API for a given player and prop type.
 * Used by the bot to shop for better odds when projections are significantly above the main line.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Map prop types to Odds API alternate market keys
const ALTERNATE_MARKETS: Record<string, string> = {
  points: 'player_points_alternate',
  rebounds: 'player_rebounds_alternate',
  assists: 'player_assists_alternate',
  threes: 'player_threes_alternate',
  pra: 'player_points_rebounds_assists_alternate',
  pts_rebs: 'player_points_rebounds_alternate',
  pts_asts: 'player_points_assists_alternate',
  rebs_asts: 'player_rebounds_assists_alternate',
  steals: 'player_steals_alternate',
  blocks: 'player_blocks_alternate',
  turnovers: 'player_turnovers_alternate',
  // Team-level alternate markets
  spreads: 'alternate_spreads',
  spread: 'alternate_spreads',
  totals: 'alternate_totals',
  total: 'alternate_totals',
};

interface AlternateLine {
  line: number;
  overOdds: number;
  underOdds: number;
  bookmaker: string;
}

interface RequestBody {
  eventId: string;
  playerName?: string;
  teamName?: string;
  propType: string;
  sport?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const oddsApiKey = Deno.env.get('ODDS_API_KEY');
    if (!oddsApiKey) {
      throw new Error('ODDS_API_KEY not configured');
    }

    const body: RequestBody = await req.json();
    const { eventId, playerName, teamName, propType, sport = 'basketball_nba' } = body;

    const lookupName = playerName || teamName;
    if (!eventId || !lookupName || !propType) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: eventId, playerName/teamName, propType' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const isTeamMarket = ['spreads', 'spread', 'totals', 'total'].includes(propType.toLowerCase());

    // Get the alternate market key
    const normalizedPropType = propType.toLowerCase().replace(/[_\s]/g, '');
    const marketKey = ALTERNATE_MARKETS[normalizedPropType] || ALTERNATE_MARKETS[propType.toLowerCase()];

    if (!marketKey) {
      console.log(`[AltLines] No alternate market for prop type: ${propType}`);
      return new Response(
        JSON.stringify({ lines: [], message: `No alternate market for ${propType}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[AltLines] Fetching ${marketKey} for ${lookupName} in event ${eventId} (team=${isTeamMarket})`);

    // Fetch alternate lines from The Odds API
    const url = `https://api.the-odds-api.com/v4/sports/${sport}/events/${eventId}/odds?apiKey=${oddsApiKey}&regions=us&markets=${marketKey}&oddsFormat=american`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AltLines] API error: ${response.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ lines: [], error: `API error: ${response.status}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const alternateLines: AlternateLine[] = [];

    // Parse the response to extract lines for the specific player/team
    const normalizedLookupName = (lookupName || '').toLowerCase().replace(/[^a-z\s]/g, '');

    for (const bookmaker of data.bookmakers || []) {
      for (const market of bookmaker.markets || []) {
        if (market.key !== marketKey) continue;

        for (const outcome of market.outcomes || []) {
          if (isTeamMarket) {
            // Team spreads/totals: outcome.name is team name or Over/Under
            // For spreads: outcomes have name = team name, point = spread line
            // For totals: outcomes have name = Over/Under, point = total line
            const outcomeName = (outcome.name || '').toLowerCase().replace(/[^a-z\s]/g, '');
            
            if (propType.toLowerCase().includes('spread')) {
              // Spread: match team name
              if (!outcomeName.includes(normalizedLookupName) && !normalizedLookupName.includes(outcomeName)) {
                continue;
              }
              const line = outcome.point;
              const odds = outcome.price;
              // For spreads, store as overOdds (the team covering odds)
              let lineEntry = alternateLines.find(l => l.line === line && l.bookmaker === bookmaker.key);
              if (!lineEntry) {
                lineEntry = { line, overOdds: odds, underOdds: -110, bookmaker: bookmaker.key };
                alternateLines.push(lineEntry);
              } else {
                lineEntry.overOdds = odds;
              }
            } else {
              // Totals: Over/Under
              const line = outcome.point;
              const isOver = outcome.name === 'Over';
              const odds = outcome.price;
              let lineEntry = alternateLines.find(l => l.line === line && l.bookmaker === bookmaker.key);
              if (!lineEntry) {
                lineEntry = { line, overOdds: -110, underOdds: -110, bookmaker: bookmaker.key };
                alternateLines.push(lineEntry);
              }
              if (isOver) {
                lineEntry.overOdds = odds;
              } else {
                lineEntry.underOdds = odds;
              }
            }
          } else {
            // Player props: match by description
            const outcomePlayer = (outcome.description || '').toLowerCase().replace(/[^a-z\s]/g, '');
            
            if (!outcomePlayer.includes(normalizedLookupName) && !normalizedLookupName.includes(outcomePlayer)) {
              continue;
            }

            const line = outcome.point;
            const isOver = outcome.name === 'Over';
            const odds = outcome.price;

            let lineEntry = alternateLines.find(l => l.line === line && l.bookmaker === bookmaker.key);
            if (!lineEntry) {
              lineEntry = { line, overOdds: -110, underOdds: -110, bookmaker: bookmaker.key };
              alternateLines.push(lineEntry);
            }

            if (isOver) {
              lineEntry.overOdds = odds;
            } else {
              lineEntry.underOdds = odds;
            }
          }
        }
      }
    }

    // Sort by line ascending and remove duplicates (keep best odds per line)
    const uniqueLines = new Map<number, AlternateLine>();
    for (const line of alternateLines) {
      const existing = uniqueLines.get(line.line);
      if (!existing || line.overOdds > existing.overOdds) {
        uniqueLines.set(line.line, line);
      }
    }

    const sortedLines = Array.from(uniqueLines.values()).sort((a, b) => a.line - b.line);

    console.log(`[AltLines] Found ${sortedLines.length} alternate lines for ${lookupName}`);

    return new Response(
      JSON.stringify({
        lines: sortedLines,
        playerName: playerName || null,
        teamName: teamName || null,
        propType,
        marketKey,
        isTeamMarket,
        count: sortedLines.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[AltLines] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message, lines: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
