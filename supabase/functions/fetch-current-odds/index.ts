import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Priority order for bookmakers - Hard Rock first, then FanDuel and DraftKings
const PRIORITY_BOOKMAKERS = ['hardrockbet', 'fanduel', 'draftkings'];
const FALLBACK_BOOKMAKERS = ['betmgm', 'caesars', 'pointsbet', 'bovada', 'williamhill_us'];

const PROP_MARKET_MAP: Record<string, string> = {
  'player_points': 'player_points',
  'player_rebounds': 'player_rebounds',
  'player_assists': 'player_assists',
  'player_threes': 'player_threes',
  'player_blocks': 'player_blocks',
  'player_steals': 'player_steals',
  'player_turnovers': 'player_turnovers',
  'player_points_rebounds_assists': 'player_points_rebounds_assists',
  'player_points_rebounds': 'player_points_rebounds',
  'player_points_assists': 'player_points_assists',
  'player_rebounds_assists': 'player_rebounds_assists',
  'player_steals_blocks': 'player_steals_blocks',
  'player_double_double': 'player_double_double',
  'player_triple_double': 'player_triple_double',
};

// Helper to normalize player names for matching
const normalizeName = (name: string) => {
  return name.toLowerCase()
    .replace(/\./g, '')
    .replace(/'/g, '')
    .replace(/jr$/i, '')
    .replace(/sr$/i, '')
    .replace(/iii$/i, '')
    .replace(/ii$/i, '')
    .trim();
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      event_id, 
      sport, 
      player_name, 
      prop_type, 
      bookmaker,
      preferred_bookmakers = PRIORITY_BOOKMAKERS,
      search_all_books = false,
      return_all_books = false,
    } = await req.json();

    console.log(`[fetch-current-odds] Fetching odds for ${player_name} - ${prop_type}`);
    console.log(`[fetch-current-odds] Preferred bookmakers: ${preferred_bookmakers.join(', ')}, return_all_books: ${return_all_books}`);

    const apiKey = Deno.env.get('THE_ODDS_API_KEY');
    if (!apiKey) {
      throw new Error('THE_ODDS_API_KEY not configured');
    }

    const marketKey = PROP_MARKET_MAP[prop_type] || prop_type;
    
    // Build bookmakers list - prioritize preferred, then add fallbacks if searching all
    const bookmakersToSearch = search_all_books 
      ? [...preferred_bookmakers, ...FALLBACK_BOOKMAKERS]
      : preferred_bookmakers;
    
    const bookmakerParam = bookmakersToSearch.join(',');
    
    const url = `https://api.the-odds-api.com/v4/sports/${sport}/events/${event_id}/odds?apiKey=${apiKey}&regions=us&markets=${marketKey}&oddsFormat=american&bookmakers=${bookmakerParam}`;

    console.log(`[fetch-current-odds] Fetching from API with bookmakers: ${bookmakerParam}`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      if (response.status === 404) {
        return new Response(JSON.stringify({
          success: false,
          message: 'Event not found or no odds available',
          event_id,
        }), { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        });
      }
      throw new Error(`API returned ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const playerNameNorm = normalizeName(player_name);

    // Find player odds from a single bookmaker
    const findPlayerOddsForBook = (bookmakerData: any, mktKey: string) => {
      for (const market of bookmakerData.markets || []) {
        if (market.key !== mktKey) continue;
        for (const outcome of market.outcomes || []) {
          const outcomeNameNorm = normalizeName(outcome.description || '');
          if (outcomeNameNorm.includes(playerNameNorm) || playerNameNorm.includes(outcomeNameNorm)) {
            const overOutcome = market.outcomes.find((o: any) => 
              normalizeName(o.description || '').includes(playerNameNorm) && o.name === 'Over'
            );
            const underOutcome = market.outcomes.find((o: any) => 
              normalizeName(o.description || '').includes(playerNameNorm) && o.name === 'Under'
            );
            return {
              line: outcome.point,
              over_price: overOutcome?.price || null,
              under_price: underOutcome?.price || null,
              bookmaker: bookmakerData.key,
              bookmaker_title: bookmakerData.title,
              last_update: market.last_update,
            };
          }
        }
      }
      return null;
    };

    // Find player odds - search bookmakers in priority order (returns first match)
    const findPlayerOdds = (bookmakers: any[], preferredOrder: string[]) => {
      for (const preferredBook of preferredOrder) {
        const bm = bookmakers.find(b => b.key.toLowerCase() === preferredBook.toLowerCase());
        if (!bm) continue;
        const result = findPlayerOddsForBook(bm, marketKey);
        if (result) return result;
      }
      return null;
    };

    // Find ALL player odds across all bookmakers
    const findAllPlayerOdds = (bookmakers: any[]) => {
      const results: any[] = [];
      for (const bm of bookmakers) {
        const result = findPlayerOddsForBook(bm, marketKey);
        if (result) results.push(result);
      }
      return results;
    };

    const odds = findPlayerOdds(data.bookmakers || [], bookmakersToSearch);
    const allOdds = return_all_books ? findAllPlayerOdds(data.bookmakers || []) : [];

    if (odds) {
      console.log(`[fetch-current-odds] Found odds from ${odds.bookmaker}: line=${odds.line}, O${odds.over_price}/U${odds.under_price}`);
      if (return_all_books) {
        console.log(`[fetch-current-odds] All books: ${allOdds.map(o => `${o.bookmaker}:${o.line}`).join(', ')}`);
      }
      return new Response(JSON.stringify({
        success: true,
        odds,
        all_odds: return_all_books ? allOdds : undefined,
        event_id,
        player_name,
        prop_type: marketKey,
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    return new Response(JSON.stringify({
      success: false,
      message: `No odds found for ${player_name} ${prop_type}`,
      searched_bookmakers: bookmakersToSearch,
      event_id,
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error('[fetch-current-odds] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500 
    });
  }
});
