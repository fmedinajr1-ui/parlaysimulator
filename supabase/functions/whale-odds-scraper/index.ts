import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Sports covered by Whale Proxy (excludes NFL and MLB)
const WHALE_SPORTS = [
  'basketball_nba',
  'basketball_wnba',
  'hockey_nhl',
];

// Markets to fetch for each sport
const SPORT_MARKETS: Record<string, string[]> = {
  'basketball_nba': ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_blocks', 'player_steals'],
  'basketball_wnba': ['player_points', 'player_rebounds', 'player_assists', 'player_threes'],
  'hockey_nhl': ['player_points', 'player_assists', 'player_goals', 'player_shots_on_goal', 'player_saves'],
};

// Priority bookmakers
const BOOKMAKERS = ['fanduel', 'draftkings', 'betmgm', 'caesars'];

interface OddsAPIEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

interface PropOutcome {
  name: string;
  description: string;
  price: number;
  point: number;
}

interface PropMarket {
  key: string;
  outcomes: PropOutcome[];
}

interface Bookmaker {
  key: string;
  title: string;
  markets: PropMarket[];
}

interface UnifiedPropInsert {
  player_name: string;
  prop_type: string;
  current_line: number;
  sport: string;
  event_id: string;
  bookmaker: string;
  game_description: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  over_price: number | null;
  under_price: number | null;
  is_active: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const apiKey = Deno.env.get('THE_ODDS_API_KEY');
  
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { sports = WHALE_SPORTS, limit_events = 10 } = await req.json().catch(() => ({}));
    
    console.log('[Whale Odds] Starting odds fetch for sports:', sports);
    
    if (!apiKey) {
      console.error('[Whale Odds] THE_ODDS_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Odds API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const now = new Date();
    const allProps: UnifiedPropInsert[] = [];
    let totalApiCalls = 0;
    
    for (const sport of sports) {
      if (!WHALE_SPORTS.includes(sport)) {
        console.log(`[Whale Odds] Skipping non-whale sport: ${sport}`);
        continue;
      }
      
      console.log(`[Whale Odds] Fetching events for ${sport}...`);
      
      // Fetch upcoming events for this sport
      const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${apiKey}&dateFormat=iso`;
      const eventsResponse = await fetch(eventsUrl);
      totalApiCalls++;
      
      if (!eventsResponse.ok) {
        console.error(`[Whale Odds] Events fetch failed for ${sport}:`, eventsResponse.status);
        continue;
      }
      
      const events: OddsAPIEvent[] = await eventsResponse.json();
      console.log(`[Whale Odds] Found ${events.length} events for ${sport}`);
      
      // Filter to today's and tomorrow's events only
      const tomorrow = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      const relevantEvents = events
        .filter(e => new Date(e.commence_time) < tomorrow && new Date(e.commence_time) > now)
        .slice(0, limit_events);
      
      console.log(`[Whale Odds] Processing ${relevantEvents.length} relevant events for ${sport}`);
      
      // Get markets for this sport
      const markets = SPORT_MARKETS[sport] || ['player_points'];
      
      // Fetch props for each event
      for (const event of relevantEvents) {
        for (const market of markets) {
          try {
            const propsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=${market}&oddsFormat=american&bookmakers=${BOOKMAKERS.join(',')}`;
            
            const propsResponse = await fetch(propsUrl);
            totalApiCalls++;
            
            if (!propsResponse.ok) {
              if (propsResponse.status === 404) {
                // No props available for this market/event
                continue;
              }
              console.error(`[Whale Odds] Props fetch failed for ${event.id}/${market}:`, propsResponse.status);
              continue;
            }
            
            const propsData = await propsResponse.json();
            const bookmakers: Bookmaker[] = propsData.bookmakers || [];
            
            // Process each bookmaker's odds
            for (const bookmaker of bookmakers) {
              for (const propMarket of bookmaker.markets) {
                if (propMarket.key !== market) continue;
                
                // Group outcomes by player
                const playerMap = new Map<string, { over?: PropOutcome; under?: PropOutcome }>();
                
                for (const outcome of propMarket.outcomes) {
                  const playerName = outcome.description || outcome.name;
                  if (!playerName || playerName.length < 3) continue;
                  
                  if (!playerMap.has(playerName)) {
                    playerMap.set(playerName, {});
                  }
                  
                  const playerOutcomes = playerMap.get(playerName)!;
                  if (outcome.name === 'Over') {
                    playerOutcomes.over = outcome;
                  } else if (outcome.name === 'Under') {
                    playerOutcomes.under = outcome;
                  }
                }
                
                // Create unified props
                for (const [playerName, outcomes] of playerMap) {
                  const line = outcomes.over?.point ?? outcomes.under?.point;
                  if (line === undefined || line === null) continue;
                  
                  allProps.push({
                    player_name: playerName,
                    prop_type: market,
                    current_line: line,
                    sport: sport,
                    event_id: event.id,
                    bookmaker: bookmaker.key,
                    game_description: `${event.away_team} @ ${event.home_team}`,
                    commence_time: event.commence_time,
                    home_team: event.home_team,
                    away_team: event.away_team,
                    over_price: outcomes.over?.price ?? null,
                    under_price: outcomes.under?.price ?? null,
                    is_active: true,
                  });
                }
              }
            }
          } catch (marketError) {
            console.error(`[Whale Odds] Error fetching ${market} for ${event.id}:`, marketError);
          }
        }
        
        // Rate limiting: small delay between events
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`[Whale Odds] Collected ${allProps.length} props from ${totalApiCalls} API calls`);
    
    if (allProps.length > 0) {
      // Deduplicate by creating unique key
      const uniqueProps = new Map<string, UnifiedPropInsert>();
      for (const prop of allProps) {
        const key = `${prop.event_id}_${prop.player_name}_${prop.prop_type}_${prop.bookmaker}`;
        // Keep the most recent (last) entry
        uniqueProps.set(key, prop);
      }
      
      const propsToInsert = Array.from(uniqueProps.values());
      console.log(`[Whale Odds] Upserting ${propsToInsert.length} unique props`);
      
      // Batch upsert in chunks
      const CHUNK_SIZE = 100;
      let insertedCount = 0;
      
      for (let i = 0; i < propsToInsert.length; i += CHUNK_SIZE) {
        const chunk = propsToInsert.slice(i, i + CHUNK_SIZE);
        
        const { error: upsertError, count } = await supabase
          .from('unified_props')
          .upsert(chunk, {
            onConflict: 'event_id,player_name,prop_type,bookmaker',
            ignoreDuplicates: false,
          });
        
        if (upsertError) {
          console.error(`[Whale Odds] Upsert error for chunk ${i}:`, upsertError);
        } else {
          insertedCount += chunk.length;
        }
      }
      
      console.log(`[Whale Odds] Successfully upserted ${insertedCount} props`);
      
      // Mark old props as inactive (props for games that have started)
      const { error: deactivateError } = await supabase
        .from('unified_props')
        .update({ is_active: false })
        .lt('commence_time', now.toISOString());
      
      if (deactivateError) {
        console.error('[Whale Odds] Deactivate error:', deactivateError);
      }
    }
    
    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'whale-odds-scraper',
      status: 'completed',
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      result: {
        propsCollected: allProps.length,
        apiCalls: totalApiCalls,
        sports: sports,
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        propsCollected: allProps.length,
        apiCalls: totalApiCalls,
        sports: sports,
        sampleProps: allProps.slice(0, 5).map(p => ({
          player: p.player_name,
          market: p.prop_type,
          line: p.current_line,
          book: p.bookmaker,
        })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Whale Odds] Fatal error:', errorMessage);
    
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
