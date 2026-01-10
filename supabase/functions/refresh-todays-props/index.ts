import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY');

    if (!oddsApiKey) {
      throw new Error('THE_ODDS_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { sport = 'basketball_nba', force_clear = false } = await req.json().catch(() => ({}));

    console.log(`[refresh-todays-props] Starting refresh for ${sport}, force_clear: ${force_clear}`);

    // Step 1: Delete old props (commence_time in the past)
    const now = new Date().toISOString();
    
    // If force_clear, delete ALL props for this sport (not just stale ones)
    if (force_clear) {
      const { error: forceClearError, count } = await supabase
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

    // Step 2: Fetch today's events from The Odds API
    const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${oddsApiKey}`;
    console.log(`[refresh-todays-props] Fetching events from: ${eventsUrl}`);
    
    const eventsResponse = await fetch(eventsUrl);
    if (!eventsResponse.ok) {
      throw new Error(`Events API error: ${eventsResponse.status}`);
    }
    
    const events = await eventsResponse.json();
    console.log(`[refresh-todays-props] Found ${events.length} upcoming events`);

    // Filter to today's games only
    const today = new Date();
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
        events: 0
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Step 3: Fetch player props for each event
    const markets = ['player_points', 'player_rebounds', 'player_assists', 'player_threes'];
    const allProps: any[] = [];
    let apiCallsMade = 0;

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
                  is_active: true
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

    const finalProps = Array.from(consolidatedProps.values());
    console.log(`[refresh-todays-props] Consolidated to ${finalProps.length} unique props`);

    // Step 4: Insert into unified_props
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

      console.log(`[refresh-todays-props] Inserted ${insertedCount} props`);

      return new Response(JSON.stringify({
        success: true,
        message: `Refreshed props for ${todaysEvents.length} games`,
        deleted: 0,
        inserted: insertedCount,
        events: todaysEvents.length,
        apiCalls: apiCallsMade
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'No props found for today',
      deleted: 0,
      inserted: 0,
      events: todaysEvents.length
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
