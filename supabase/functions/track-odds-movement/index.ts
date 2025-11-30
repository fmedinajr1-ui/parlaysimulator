import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OddsOutcome {
  name: string;
  price: number;
  point?: number;
}

interface OddsMarket {
  key: string;
  outcomes: OddsOutcome[];
}

interface Bookmaker {
  key: string;
  title: string;
  markets: OddsMarket[];
}

interface OddsEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
}

interface LineMovement {
  event_id: string;
  sport: string;
  description: string;
  bookmaker: string;
  market_type: string;
  outcome_name: string;
  old_price: number;
  new_price: number;
  old_point?: number;
  new_point?: number;
  price_change: number;
  point_change?: number;
  is_sharp_action: boolean;
  sharp_indicator?: string;
  commence_time?: string;
}

const SPORT_KEYS: Record<string, string> = {
  'NBA': 'basketball_nba',
  'NFL': 'americanfootball_nfl',
  'NCAAF': 'americanfootball_ncaaf',
  'NCAAB': 'basketball_ncaab',
  'NHL': 'icehockey_nhl',
  'MLB': 'baseball_mlb',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sports, action } = await req.json() as {
      sports?: string[];
      action?: 'fetch' | 'get_movements' | 'get_sharp_alerts';
    };

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get recent line movements
    if (action === 'get_movements') {
      const sport = sports?.[0] || null;
      
      const { data: movements, error } = await supabase
        .from('line_movements')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(30);

      if (error) throw error;

      return new Response(JSON.stringify({ movements: movements || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get sharp money alerts only
    if (action === 'get_sharp_alerts') {
      const { data: alerts, error } = await supabase
        .from('line_movements')
        .select('*')
        .eq('is_sharp_action', true)
        .order('detected_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      return new Response(JSON.stringify({ alerts: alerts || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch and track odds
    const ODDS_API_KEY = Deno.env.get('THE_ODDS_API_KEY');
    if (!ODDS_API_KEY) {
      throw new Error('THE_ODDS_API_KEY is not configured');
    }

    const targetSports = sports || ['NBA', 'NFL', 'NCAAB'];
    const allMovements: LineMovement[] = [];
    const snapshotsToInsert: any[] = [];

    for (const sport of targetSports) {
      const sportKey = SPORT_KEYS[sport];
      if (!sportKey) continue;

      console.log(`Fetching odds for ${sport}...`);

      try {
        const oddsResponse = await fetch(
          `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads,h2h,totals&oddsFormat=american`
        );

        if (!oddsResponse.ok) {
          console.error(`Failed to fetch ${sport} odds:`, oddsResponse.status);
          continue;
        }

        const events: OddsEvent[] = await oddsResponse.json();
        console.log(`Got ${events.length} events for ${sport}`);

        for (const event of events) {
          for (const bookmaker of event.bookmakers) {
            // Only track major books
            if (!['fanduel', 'draftkings', 'betmgm', 'caesars'].includes(bookmaker.key)) {
              continue;
            }

            for (const market of bookmaker.markets) {
              for (const outcome of market.outcomes) {
                const snapshotKey = `${event.id}-${bookmaker.key}-${market.key}-${outcome.name}`;
                
                // Check for existing snapshot
                const { data: existingSnapshot } = await supabase
                  .from('odds_snapshots')
                  .select('*')
                  .eq('event_id', event.id)
                  .eq('bookmaker', bookmaker.key)
                  .eq('market_type', market.key)
                  .eq('outcome_name', outcome.name)
                  .order('snapshot_time', { ascending: false })
                  .limit(1)
                  .single();

                // Create new snapshot
                const newSnapshot = {
                  event_id: event.id,
                  sport: sport,
                  home_team: event.home_team,
                  away_team: event.away_team,
                  commence_time: event.commence_time,
                  bookmaker: bookmaker.key,
                  market_type: market.key,
                  outcome_name: outcome.name,
                  price: outcome.price,
                  point: outcome.point || null,
                  snapshot_time: new Date().toISOString()
                };

                snapshotsToInsert.push(newSnapshot);

                // Detect line movement
                if (existingSnapshot) {
                  const priceChange = outcome.price - existingSnapshot.price;
                  const pointChange = outcome.point !== undefined && existingSnapshot.point !== null
                    ? outcome.point - existingSnapshot.point
                    : null;

                  // Only track significant movements (5+ points in price or 0.5+ in spread)
                  const isSignificantMove = Math.abs(priceChange) >= 5 || 
                    (pointChange !== null && Math.abs(pointChange) >= 0.5);

                  if (isSignificantMove) {
                    // Detect sharp money
                    let isSharp = false;
                    let sharpIndicator: string | undefined;

                    if (Math.abs(priceChange) >= 15) {
                      isSharp = true;
                      sharpIndicator = 'STEAM MOVE - Major price shift detected';
                    } else if (Math.abs(priceChange) >= 10 && (pointChange === null || Math.abs(pointChange) < 0.5)) {
                      isSharp = true;
                      sharpIndicator = 'SHARP ACTION - Price moved without spread change';
                    } else if (Math.abs(priceChange) >= 8) {
                      isSharp = true;
                      sharpIndicator = 'POSSIBLE SHARP - Significant line movement';
                    }

                    const movement: LineMovement = {
                      event_id: event.id,
                      sport: sport,
                      description: `${event.away_team} @ ${event.home_team}`,
                      bookmaker: bookmaker.key,
                      market_type: market.key,
                      outcome_name: outcome.name,
                      old_price: existingSnapshot.price,
                      new_price: outcome.price,
                      old_point: existingSnapshot.point,
                      new_point: outcome.point,
                      price_change: priceChange,
                      point_change: pointChange || undefined,
                      is_sharp_action: isSharp,
                      sharp_indicator: sharpIndicator,
                      commence_time: event.commence_time
                    };

                    allMovements.push(movement);
                  }
                }
              }
            }
          }
        }
      } catch (sportError) {
        console.error(`Error processing ${sport}:`, sportError);
      }
    }

    // Batch insert snapshots
    if (snapshotsToInsert.length > 0) {
      const { error: snapshotError } = await supabase
        .from('odds_snapshots')
        .insert(snapshotsToInsert);

      if (snapshotError) {
        console.error('Error inserting snapshots:', snapshotError);
      } else {
        console.log(`Inserted ${snapshotsToInsert.length} odds snapshots`);
      }
    }

    // Insert line movements
    if (allMovements.length > 0) {
      const { error: movementError } = await supabase
        .from('line_movements')
        .insert(allMovements.map(m => ({
          event_id: m.event_id,
          sport: m.sport,
          description: m.description,
          bookmaker: m.bookmaker,
          market_type: m.market_type,
          outcome_name: m.outcome_name,
          old_price: m.old_price,
          new_price: m.new_price,
          old_point: m.old_point,
          new_point: m.new_point,
          price_change: m.price_change,
          point_change: m.point_change,
          is_sharp_action: m.is_sharp_action,
          sharp_indicator: m.sharp_indicator,
          commence_time: m.commence_time
        })));

      if (movementError) {
        console.error('Error inserting movements:', movementError);
      } else {
        console.log(`Detected ${allMovements.length} line movements, ${allMovements.filter(m => m.is_sharp_action).length} sharp`);
        
        // Send push notifications for sharp alerts
        const sharpMovements = allMovements.filter(m => m.is_sharp_action);
        for (const sharpMove of sharpMovements) {
          try {
            await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({
                action: 'notify',
                alert: {
                  sport: sharpMove.sport,
                  description: sharpMove.description,
                  bookmaker: sharpMove.bookmaker,
                  price_change: sharpMove.price_change,
                  sharp_indicator: sharpMove.sharp_indicator,
                }
              })
            });
            console.log(`Push notification sent for sharp move: ${sharpMove.description}`);
          } catch (pushError) {
            console.error('Error sending push notification:', pushError);
          }
        }
      }
    }

    // Clean up old snapshots (keep last 24 hours)
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('odds_snapshots')
      .delete()
      .lt('snapshot_time', cutoffTime);

    return new Response(JSON.stringify({
      success: true,
      snapshotsCreated: snapshotsToInsert.length,
      movementsDetected: allMovements.length,
      sharpAlerts: allMovements.filter(m => m.is_sharp_action).length,
      movements: allMovements
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in track-odds-movement:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      movements: []
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
