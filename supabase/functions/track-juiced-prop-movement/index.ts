import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface JuicedProp {
  id: string;
  event_id: string;
  sport: string;
  player_name: string;
  prop_type: string;
  line: number;
  over_price: number;
  under_price: number;
  commence_time: string;
  is_locked: boolean;
}

interface MovementSnapshot {
  over_price: number;
  under_price: number;
  snapshot_time: string;
  movement_direction: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY');
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    console.log('📊 Starting hourly juiced prop movement tracking...');
    
    const now = new Date();
    
    // Get unlocked juiced props that haven't started yet
    const { data: activeProps, error: fetchError } = await supabase
      .from('juiced_props')
      .select('*')
      .eq('is_locked', false)
      .gt('commence_time', now.toISOString());
    
    if (fetchError) {
      console.error('Error fetching props:', fetchError);
      throw fetchError;
    }
    
    console.log(`📋 Found ${activeProps?.length || 0} active props to track`);
    
    if (!activeProps || activeProps.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No active props to track',
        tracked: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    let trackedCount = 0;
    let updatedCount = 0;
    
    // Group props by sport for efficient API calls
    const propsBySport = new Map<string, JuicedProp[]>();
    for (const prop of activeProps as JuicedProp[]) {
      const sportProps = propsBySport.get(prop.sport) || [];
      sportProps.push(prop);
      propsBySport.set(prop.sport, sportProps);
    }
    
    // Map sport names to API keys
    const SPORT_KEYS: Record<string, string> = {
      'NBA': 'basketball_nba',
      'NFL': 'americanfootball_nfl',
      'NHL': 'icehockey_nhl',
      'NCAAB': 'basketball_ncaab',
      'NCAAF': 'americanfootball_ncaaf',
    };
    
    // Fetch current odds for each sport if API key available
    const currentOddsMap = new Map<string, { over_price: number; under_price: number }>();
    
    if (oddsApiKey) {
      for (const [sport, props] of propsBySport) {
        const sportKey = SPORT_KEYS[sport];
        if (!sportKey) continue;
        
        // Get unique event IDs
        const eventIds = [...new Set(props.map(p => p.event_id))];
        
        for (const eventId of eventIds) {
          try {
            // Fetch player props for this event
            const markets = ['player_points', 'player_rebounds', 'player_assists', 'player_threes'];
            
            for (const market of markets) {
              const oddsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${eventId}/odds?apiKey=${oddsApiKey}&regions=us&markets=${market}&oddsFormat=american`;
              
              const response = await fetch(oddsUrl);
              if (!response.ok) continue;
              
              const data = await response.json();
              
              // Parse odds for each player
              for (const bookmaker of (data.bookmakers || [])) {
                for (const market_data of (bookmaker.markets || [])) {
                  for (const outcome of (market_data.outcomes || [])) {
                    const key = `${outcome.description?.toLowerCase()}_${market_data.key}_${outcome.point}`;
                    
                    if (!currentOddsMap.has(key)) {
                      currentOddsMap.set(key, {
                        over_price: outcome.name === 'Over' ? outcome.price : 0,
                        under_price: outcome.name === 'Under' ? outcome.price : 0,
                      });
                    } else {
                      const existing = currentOddsMap.get(key)!;
                      if (outcome.name === 'Over') existing.over_price = outcome.price;
                      if (outcome.name === 'Under') existing.under_price = outcome.price;
                    }
                  }
                }
              }
            }
          } catch (err) {
            console.error(`Error fetching odds for ${eventId}:`, err);
          }
        }
      }
    }
    
    // Process each prop
    for (const prop of activeProps as JuicedProp[]) {
      // Get last snapshot for this prop
      const { data: lastSnapshot } = await supabase
        .from('juiced_prop_movement_history')
        .select('*')
        .eq('juiced_prop_id', prop.id)
        .order('snapshot_time', { ascending: false })
        .limit(1)
        .single();
      
      // Try to find current odds from API, otherwise use stored values
      const propKey = `${prop.player_name.toLowerCase()}_player_${prop.prop_type.toLowerCase().replace(/ /g, '_')}_${prop.line}`;
      const currentOdds = currentOddsMap.get(propKey);
      
      const currentOverPrice = currentOdds?.over_price || prop.over_price;
      const currentUnderPrice = currentOdds?.under_price || prop.under_price;
      
      // Calculate movement direction
      const previousOverPrice = lastSnapshot?.over_price || prop.over_price;
      const priceDelta = currentOverPrice - previousOverPrice;
      
      let movementDirection = 'stable';
      if (priceDelta < -3) {
        movementDirection = 'towards_over'; // Price getting more negative = more action on over
      } else if (priceDelta > 3) {
        movementDirection = 'towards_under';
      }
      
      // Calculate cumulative moves
      const cumulativeOverMoves = (lastSnapshot?.cumulative_over_moves || 0) + (movementDirection === 'towards_over' ? 1 : 0);
      const cumulativeUnderMoves = (lastSnapshot?.cumulative_under_moves || 0) + (movementDirection === 'towards_under' ? 1 : 0);
      
      // Insert new snapshot
      const { error: insertError } = await supabase
        .from('juiced_prop_movement_history')
        .insert({
          juiced_prop_id: prop.id,
          player_name: prop.player_name,
          prop_type: prop.prop_type,
          line: prop.line,
          over_price: currentOverPrice,
          under_price: currentUnderPrice,
          movement_direction: movementDirection,
          cumulative_over_moves: cumulativeOverMoves,
          cumulative_under_moves: cumulativeUnderMoves,
          price_delta: priceDelta,
        });
      
      if (insertError) {
        console.error(`Error inserting snapshot for ${prop.player_name}:`, insertError);
        continue;
      }
      
      trackedCount++;
      
      // Update prop with movement consistency data
      const totalMoves = cumulativeOverMoves + cumulativeUnderMoves;
      const consistentMoves = Math.max(cumulativeOverMoves, cumulativeUnderMoves);
      const consistencyScore = totalMoves > 0 ? (consistentMoves / totalMoves) * 100 : 0;
      const dominantDirection = cumulativeOverMoves > cumulativeUnderMoves ? 'over' : 
                                cumulativeUnderMoves > cumulativeOverMoves ? 'under' : 'mixed';
      
      // Get total snapshots for this prop
      const { count: snapshotCount } = await supabase
        .from('juiced_prop_movement_history')
        .select('*', { count: 'exact', head: true })
        .eq('juiced_prop_id', prop.id);
      
      const { error: updateError } = await supabase
        .from('juiced_props')
        .update({
          movement_consistency_score: consistencyScore,
          total_movement_snapshots: snapshotCount || 0,
          consistent_direction_moves: consistentMoves,
          dominant_movement_direction: dominantDirection,
        })
        .eq('id', prop.id);
      
      if (!updateError) {
        updatedCount++;
      }
      
      if (movementDirection !== 'stable') {
        console.log(`📈 ${prop.player_name} ${prop.prop_type}: ${movementDirection} (Δ${priceDelta > 0 ? '+' : ''}${priceDelta}) | MCS: ${consistencyScore.toFixed(0)}%`);
      }
    }
    
    console.log(`✅ Tracked ${trackedCount} props, updated ${updatedCount} with MCS`);
    
    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'track-juiced-prop-movement',
      status: 'completed',
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      result: {
        tracked: trackedCount,
        updated: updatedCount,
        total_props: activeProps.length,
      },
    });
    
    return new Response(JSON.stringify({
      success: true,
      message: `Tracked ${trackedCount} props, updated ${updatedCount} with MCS`,
      tracked: trackedCount,
      updated: updatedCount,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error: any) {
    console.error('Error in track-juiced-prop-movement:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
