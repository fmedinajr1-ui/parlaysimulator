import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PROP_MARKET_MAP: Record<string, string> = {
  'points': 'player_points',
  'rebounds': 'player_rebounds',
  'assists': 'player_assists',
  'threes': 'player_threes',
  'blocks': 'player_blocks',
  'steals': 'player_steals',
  'pts+reb': 'player_points_rebounds',
  'pts+ast': 'player_points_assists',
  'reb+ast': 'player_rebounds_assists',
  'pts+reb+ast': 'player_points_rebounds_assists',
  'passing_yards': 'player_pass_yds',
  'rushing_yards': 'player_rush_yds',
  'receiving_yards': 'player_reception_yds',
  'touchdowns': 'player_anytime_td',
  'completions': 'player_pass_completions',
  'receptions': 'player_receptions'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { event_id, sport, player_name, prop_type, bookmaker, search_all_books = false } = await req.json();
    
    console.log('Fetching current odds for:', { event_id, sport, player_name, prop_type, bookmaker, search_all_books });

    const apiKey = Deno.env.get('THE_ODDS_API_KEY');
    if (!apiKey) {
      throw new Error('THE_ODDS_API_KEY not configured');
    }

    // Map prop type to API market
    const market = PROP_MARKET_MAP[prop_type] || `player_${prop_type}`;
    
    // Fetch current odds from The Odds API
    const url = `https://api.the-odds-api.com/v4/sports/${sport}/events/${event_id}/odds?apiKey=${apiKey}&regions=us&markets=${market}&oddsFormat=american`;
    
    console.log('Fetching from URL:', url.replace(apiKey, '***'));
    
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API response not ok:', response.status, errorText);
      
      // Handle 404 gracefully - event may have expired or completed
      if (response.status === 404) {
        return new Response(JSON.stringify({ 
          success: true, 
          found: false,
          message: 'Event not found - game may have started or completed',
          searched: { player_name, prop_type, bookmaker, event_id }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      throw new Error(`Failed to fetch odds: ${response.status}`);
    }

    const data = await response.json();
    console.log('API response bookmakers:', data.bookmakers?.length || 0);

    // Helper function to search for player odds in bookmakers
    const findPlayerOdds = (bookmakers: any[], targetBookmaker?: string) => {
      for (const bookie of bookmakers || []) {
        // Skip if we're looking for a specific bookmaker and this isn't it
        if (targetBookmaker && bookie.key !== targetBookmaker) continue;
        
        for (const marketData of bookie.markets || []) {
          // Group outcomes by player
          const playerOutcomes: Record<string, any[]> = {};
          
          for (const outcome of marketData.outcomes || []) {
            const playerKey = outcome.description || outcome.name;
            if (!playerOutcomes[playerKey]) {
              playerOutcomes[playerKey] = [];
            }
            playerOutcomes[playerKey].push(outcome);
          }

          // Find the player we're looking for (fuzzy match)
          for (const [name, outcomes] of Object.entries(playerOutcomes)) {
            const normalizedSearchName = player_name.toLowerCase().replace(/[^a-z]/g, '');
            const normalizedFoundName = name.toLowerCase().replace(/[^a-z]/g, '');
            
            if (normalizedFoundName.includes(normalizedSearchName) || 
                normalizedSearchName.includes(normalizedFoundName)) {
              
              const overOutcome = outcomes.find((o: any) => o.name === 'Over');
              const underOutcome = outcomes.find((o: any) => o.name === 'Under');

              if (overOutcome && underOutcome) {
                return {
                  player_name: name,
                  bookmaker: bookie.key,
                  market: marketData.key,
                  line: overOutcome.point,
                  over_price: overOutcome.price,
                  under_price: underOutcome.price,
                  last_update: bookie.last_update
                };
              }
            }
          }
        }
      }
      return null;
    };

    // First try the specific bookmaker if provided and not searching all
    let foundOdds = null;
    let searchedAllBooks = false;
    
    if (bookmaker && !search_all_books) {
      foundOdds = findPlayerOdds(data.bookmakers, bookmaker);
    }
    
    // If not found on specific bookmaker, search all bookmakers
    if (!foundOdds) {
      foundOdds = findPlayerOdds(data.bookmakers);
      searchedAllBooks = true;
    }

    if (!foundOdds) {
      return new Response(JSON.stringify({ 
        success: true, 
        found: false,
        message: 'Player prop not found in current odds',
        searched: { player_name, prop_type, bookmaker }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Found odds:', foundOdds, 'searched all books:', searchedAllBooks);

    return new Response(JSON.stringify({ 
      success: true, 
      found: true,
      odds: foundOdds,
      found_on_different_book: searchedAllBooks && bookmaker && foundOdds.bookmaker !== bookmaker,
      original_bookmaker: bookmaker
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in fetch-current-odds:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
