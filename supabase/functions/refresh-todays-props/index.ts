import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BDL_BASE_URL = 'https://api.balldontlie.io/v2';

// Map BDL prop types to our unified format
const BDL_PROP_TYPE_MAP: Record<string, string> = {
  'points': 'points',
  'rebounds': 'rebounds',
  'assists': 'assists',
  'threes': 'threes',
  'steals': 'steals',
  'blocks': 'blocks',
  'turnovers': 'turnovers',
  'pts_rebs_asts': 'points_rebounds_assists',
  'pts_rebs': 'points_rebounds',
  'pts_asts': 'points_assists',
  'rebs_asts': 'rebounds_assists',
  'stls_blks': 'steals_blocks',
};

interface BDLGame {
  id: number;
  date: string;
  home_team: { id: number; full_name: string; abbreviation: string };
  visitor_team: { id: number; full_name: string; abbreviation: string };
  status: string;
}

interface BDLPlayerProp {
  game_id: number;
  player_id: number;
  player: { first_name: string; last_name: string };
  vendor: string;
  prop_type: string;
  line_value: string;
  market: {
    type: 'over_under' | 'milestone';
    over_odds?: number;
    under_odds?: number;
    odds?: number;
  };
}

// Fetch props from BallDontLie API
async function fetchBDLProps(bdlApiKey: string, today: string): Promise<any[]> {
  const headers = {
    'Authorization': bdlApiKey,
    'Content-Type': 'application/json',
  };

  // Step 1: Get today's games
  const gamesUrl = `${BDL_BASE_URL}/games?dates[]=${today}`;
  console.log(`[BDL Fallback] Fetching games from: ${gamesUrl}`);
  
  const gamesResponse = await fetch(gamesUrl, { headers });
  if (!gamesResponse.ok) {
    console.error(`[BDL Fallback] Games API error: ${gamesResponse.status}`);
    return [];
  }
  
  const gamesData = await gamesResponse.json();
  const games: BDLGame[] = gamesData.data || [];
  console.log(`[BDL Fallback] Found ${games.length} NBA games`);

  if (games.length === 0) return [];

  const allProps: any[] = [];

  // Step 2: Fetch props for each game
  for (const game of games) {
    try {
      const propsUrl = `${BDL_BASE_URL}/odds/player_props?game_id=${game.id}`;
      const propsResponse = await fetch(propsUrl, { headers });
      
      if (!propsResponse.ok) {
        if (propsResponse.status === 403) {
          console.warn(`[BDL Fallback] GOAT tier required - skipping player props`);
          return []; // Return empty if tier not sufficient
        }
        continue;
      }
      
      const propsData = await propsResponse.json();
      const props: BDLPlayerProp[] = propsData.data || [];
      
      // Generate event_id compatible with our system
      const eventId = `bdl_nba_${game.id}`;
      const gameDate = new Date(game.date);
      gameDate.setHours(19, 0, 0, 0);
      
      for (const prop of props) {
        const propType = BDL_PROP_TYPE_MAP[prop.prop_type] || prop.prop_type;
        
        allProps.push({
          event_id: eventId,
          sport_key: 'basketball_nba',
          sport_title: 'NBA',
          home_team: game.home_team.full_name,
          away_team: game.visitor_team.full_name,
          commence_time: gameDate.toISOString(),
          bookmaker: prop.vendor.toLowerCase(),
          market_key: `player_${propType}`,
          player_name: `${prop.player.first_name} ${prop.player.last_name}`,
          prop_type: propType,
          line: parseFloat(prop.line_value),
          over_price: prop.market.over_odds || null,
          under_price: prop.market.under_odds || null,
          last_update: new Date().toISOString(),
          is_active: true,
          data_source: 'balldontlie',
        });
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 150));
      
    } catch (err) {
      console.error(`[BDL Fallback] Error fetching props for game ${game.id}:`, err);
    }
  }

  return allProps;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY');
    const bdlApiKey = Deno.env.get('BALLDONTLIE_API_KEY');

    if (!oddsApiKey) {
      throw new Error('THE_ODDS_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { 
      sport = 'basketball_nba', 
      force_clear = false,
      use_bdl_fallback = true, // Enable BDL fallback by default for NBA
      bdl_only = false // Force BDL as primary source
    } = await req.json().catch(() => ({}));

    console.log(`[refresh-todays-props] Starting refresh for ${sport}, force_clear: ${force_clear}, bdl_fallback: ${use_bdl_fallback}, bdl_only: ${bdl_only}`);

    // Step 1: Delete old props (commence_time in the past)
    const now = new Date().toISOString();
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    // If force_clear, delete ALL props for this sport (not just stale ones)
    if (force_clear) {
      const { error: forceClearError } = await supabase
        .from('unified_props')
        .delete()
        .eq('sport_key', sport);
      
      if (forceClearError) {
        console.error('[refresh-todays-props] Force clear error:', forceClearError);
      } else {
        console.log(`[refresh-todays-props] Force cleared all ${sport} props`);
      }
    }
    
    // Always delete stale props (past games)
    const { error: deleteError } = await supabase
      .from('unified_props')
      .delete()
      .lt('commence_time', now);

    if (deleteError) {
      console.error('[refresh-todays-props] Delete stale error:', deleteError);
    } else {
      console.log(`[refresh-todays-props] Deleted stale props`);
    }

    let finalProps: any[] = [];
    let dataSource = 'the_odds_api';
    let apiCallsMade = 0;

    // If bdl_only mode for NBA, skip The Odds API
    if (bdl_only && sport === 'basketball_nba' && bdlApiKey) {
      console.log(`[refresh-todays-props] BDL-only mode - fetching from BallDontLie`);
      finalProps = await fetchBDLProps(bdlApiKey, todayStr);
      dataSource = 'balldontlie';
      
      if (finalProps.length > 0) {
        console.log(`[refresh-todays-props] BDL returned ${finalProps.length} props`);
      }
    } else {
      // Step 2: Fetch today's events from The Odds API
      const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${oddsApiKey}`;
      console.log(`[refresh-todays-props] Fetching events from The Odds API`);
      
      const eventsResponse = await fetch(eventsUrl);
      if (!eventsResponse.ok) {
        throw new Error(`Events API error: ${eventsResponse.status}`);
      }
      
      const events = await eventsResponse.json();
      console.log(`[refresh-todays-props] Found ${events.length} upcoming events`);

      // Filter to today's games only
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todaysEvents = events.filter((event: any) => {
        const eventDate = new Date(event.commence_time);
        return eventDate >= today && eventDate < tomorrow;
      });

      console.log(`[refresh-todays-props] ${todaysEvents.length} events are today`);

      if (todaysEvents.length === 0) {
        return new Response(JSON.stringify({
          success: true,
          message: 'No games today',
          deleted: 0,
          inserted: 0,
          events: 0,
          data_source: dataSource,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Step 3: Fetch player props for each event from The Odds API
      const markets = ['player_points', 'player_rebounds', 'player_assists', 'player_threes'];
      const allProps: any[] = [];

      for (const event of todaysEvents) {
        for (const market of markets) {
          try {
            const propsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds?apiKey=${oddsApiKey}&regions=us&markets=${market}&oddsFormat=american&bookmakers=fanduel,draftkings`;
            
            const propsResponse = await fetch(propsUrl);
            apiCallsMade++;
            
            if (!propsResponse.ok) {
              console.warn(`[refresh-todays-props] Props API error for ${event.id}/${market}: ${propsResponse.status}`);
              continue;
            }

            const propsData = await propsResponse.json();
            
            // Parse bookmakers and outcomes
            for (const bookmaker of propsData.bookmakers || []) {
              for (const marketData of bookmaker.markets || []) {
                for (const outcome of marketData.outcomes || []) {
                  const prop = {
                    event_id: event.id,
                    sport_key: sport,
                    sport_title: 'NBA',
                    home_team: event.home_team,
                    away_team: event.away_team,
                    commence_time: event.commence_time,
                    bookmaker: bookmaker.key,
                    market_key: marketData.key,
                    player_name: outcome.description,
                    prop_type: market.replace('player_', ''),
                    line: outcome.point,
                    over_price: outcome.name === 'Over' ? outcome.price : null,
                    under_price: outcome.name === 'Under' ? outcome.price : null,
                    last_update: bookmaker.last_update || new Date().toISOString(),
                    is_active: true,
                    data_source: 'the_odds_api',
                  };
                  
                  allProps.push(prop);
                }
              }
            }

            // Rate limiting - small delay between API calls
            await new Promise(resolve => setTimeout(resolve, 100));
            
          } catch (propError) {
            console.error(`[refresh-todays-props] Error fetching ${market} for ${event.id}:`, propError);
          }
        }
      }

      console.log(`[refresh-todays-props] Parsed ${allProps.length} raw props from ${apiCallsMade} API calls`);

      // Consolidate props (combine over/under for same player/prop)
      const consolidatedProps: Map<string, any> = new Map();
      
      for (const prop of allProps) {
        const key = `${prop.event_id}-${prop.player_name}-${prop.prop_type}-${prop.bookmaker}-${prop.line}`;
        
        if (consolidatedProps.has(key)) {
          const existing = consolidatedProps.get(key);
          if (prop.over_price) existing.over_price = prop.over_price;
          if (prop.under_price) existing.under_price = prop.under_price;
        } else {
          consolidatedProps.set(key, { ...prop });
        }
      }

      finalProps = Array.from(consolidatedProps.values());
      console.log(`[refresh-todays-props] Consolidated to ${finalProps.length} unique props from The Odds API`);

      // Step 4: If no props from The Odds API and NBA, try BDL fallback
      if (finalProps.length === 0 && sport === 'basketball_nba' && use_bdl_fallback && bdlApiKey) {
        console.log(`[refresh-todays-props] No props from The Odds API - trying BallDontLie fallback`);
        
        finalProps = await fetchBDLProps(bdlApiKey, todayStr);
        dataSource = 'balldontlie';
        
        if (finalProps.length > 0) {
          console.log(`[refresh-todays-props] BDL fallback returned ${finalProps.length} props`);
        } else {
          console.log(`[refresh-todays-props] BDL fallback also returned no props`);
        }
      }
    }

    // Step 5: Insert into unified_props
    let insertedCount = 0;
    if (finalProps.length > 0) {
      // Insert in batches of 100
      const batchSize = 100;
      
      for (let i = 0; i < finalProps.length; i += batchSize) {
        const batch = finalProps.slice(i, i + batchSize);
        
        const { error: insertError } = await supabase
          .from('unified_props')
          .upsert(batch, { 
            onConflict: 'event_id,player_name,prop_type,bookmaker',
            ignoreDuplicates: false 
          });

        if (insertError) {
          console.error(`[refresh-todays-props] Insert batch error:`, insertError);
        } else {
          insertedCount += batch.length;
        }
      }

      console.log(`[refresh-todays-props] Inserted ${insertedCount} props from ${dataSource}`);

      return new Response(JSON.stringify({
        success: true,
        message: `Refreshed props from ${dataSource}`,
        deleted: 0,
        inserted: insertedCount,
        events: finalProps.length > 0 ? Math.ceil(finalProps.length / 20) : 0,
        apiCalls: apiCallsMade,
        data_source: dataSource,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'No props found for today from any source',
      deleted: 0,
      inserted: 0,
      events: 0,
      data_source: dataSource,
      bdl_available: !!bdlApiKey,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('[refresh-todays-props] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});
