import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SPORT_KEYS: Record<string, string> = {
  'basketball_nba': 'basketball_nba',
  'americanfootball_nfl': 'americanfootball_nfl',
  'icehockey_nhl': 'icehockey_nhl'
};

const NBA_MARKETS = [
  'player_points',
  'player_rebounds', 
  'player_assists',
  'player_threes',
  'player_blocks',
  'player_steals'
];

const NFL_MARKETS = [
  'player_pass_yds',
  'player_rush_yds',
  'player_reception_yds',
  'player_anytime_td',
  'player_pass_tds',
  'player_receptions'
];

const NHL_MARKETS = [
  'player_points',
  'player_assists',
  'player_shots_on_goal',
  'player_blocked_shots',
  'player_power_play_points'
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sports = ['basketball_nba', 'americanfootball_nfl', 'icehockey_nhl'] } = await req.json().catch(() => ({}));
    
    const apiKey = Deno.env.get('THE_ODDS_API_KEY');
    if (!apiKey) {
      throw new Error('THE_ODDS_API_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let totalPropsAdded = 0;
    const errors: string[] = [];

    for (const sport of sports) {
      const sportKey = SPORT_KEYS[sport];
      if (!sportKey) continue;

      console.log(`Scanning ${sport} for opening lines...`);

      // First get events
      const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/events?apiKey=${apiKey}`;
      const eventsRes = await fetch(eventsUrl);
      
      if (!eventsRes.ok) {
        console.error(`Failed to fetch events for ${sport}:`, eventsRes.status);
        continue;
      }

      const events = await eventsRes.json();
      console.log(`Found ${events.length} events for ${sport}`);

      // Filter events that are 4-24 hours out
      const now = new Date();
      const relevantEvents = events.filter((event: any) => {
        const commenceTime = new Date(event.commence_time);
        const hoursUntil = (commenceTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        return hoursUntil >= 4 && hoursUntil <= 24;
      });

      console.log(`${relevantEvents.length} events are in the target window (4-24 hours out)`);

      // Select markets based on sport
      const marketsToScan = sport === 'americanfootball_nfl' ? NFL_MARKETS : sport === 'icehockey_nhl' ? NHL_MARKETS : NBA_MARKETS;

      // For each relevant event, fetch player props
      for (const event of relevantEvents.slice(0, 5)) { // Limit to 5 events per sport
        for (const market of marketsToScan.slice(0, 4)) { // Limit markets to save API calls
          try {
            const propsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=${market}&oddsFormat=american`;
            const propsRes = await fetch(propsUrl);
            
            if (!propsRes.ok) {
              console.log(`No props available for ${market} in ${event.id}`);
              continue;
            }

            const propsData = await propsRes.json();
            
            // Process each bookmaker's props
            for (const bookmaker of propsData.bookmakers || []) {
              for (const marketData of bookmaker.markets || []) {
                // Group outcomes by player (description field)
                const playerOutcomes: Record<string, any[]> = {};
                
                for (const outcome of marketData.outcomes || []) {
                  const playerKey = outcome.description || outcome.name;
                  if (!playerOutcomes[playerKey]) {
                    playerOutcomes[playerKey] = [];
                  }
                  playerOutcomes[playerKey].push(outcome);
                }

                // Process each player's over/under
                for (const [playerName, outcomes] of Object.entries(playerOutcomes)) {
                  const overOutcome = outcomes.find((o: any) => o.name === 'Over');
                  const underOutcome = outcomes.find((o: any) => o.name === 'Under');

                  if (overOutcome && underOutcome && overOutcome.point) {
                    // Check if we already have this prop
                    const { data: existing } = await supabase
                      .from('sharp_line_tracker')
                      .select('id')
                      .eq('event_id', event.id)
                      .eq('player_name', playerName)
                      .eq('prop_type', market.replace('player_', ''))
                      .eq('bookmaker', bookmaker.key)
                      .single();

                    if (existing) {
                      console.log(`Already tracking ${playerName} ${market} - skipping`);
                      continue;
                    }

                    // Insert new prop
                    const { error: insertError } = await supabase
                      .from('sharp_line_tracker')
                      .insert({
                        event_id: event.id,
                        sport,
                        game_description: `${event.away_team} @ ${event.home_team}`,
                        player_name: playerName,
                        prop_type: market.replace('player_', ''),
                        bookmaker: bookmaker.key,
                        opening_line: overOutcome.point,
                        opening_over_price: overOutcome.price,
                        opening_under_price: underOutcome.price,
                        commence_time: event.commence_time,
                        input_method: 'scan',
                        status: 'pending'
                      });

                    if (insertError) {
                      console.error('Insert error:', insertError);
                      errors.push(`Failed to insert ${playerName} ${market}`);
                    } else {
                      totalPropsAdded++;
                      console.log(`Added: ${playerName} ${market} ${overOutcome.point}`);
                    }
                  }
                }
              }
            }
          } catch (err) {
            console.error(`Error processing ${market} for ${event.id}:`, err);
          }
        }
      }
    }

    console.log(`Scan complete. Added ${totalPropsAdded} props.`);

    return new Response(JSON.stringify({ 
      success: true, 
      count: totalPropsAdded,
      errors: errors.length > 0 ? errors : undefined
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in scan-opening-lines:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
