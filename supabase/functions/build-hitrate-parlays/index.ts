import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Convert American odds to implied probability
function americanToImpliedProb(odds: number): number {
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
}

// Convert American odds to decimal
function americanToDecimal(odds: number): number {
  if (odds > 0) {
    return (odds / 100) + 1;
  } else {
    return (100 / Math.abs(odds)) + 1;
  }
}

// Calculate parlay odds
function calculateParlayOdds(legs: any[]): { decimalOdds: number; americanOdds: number } {
  let decimalOdds = 1;
  
  for (const leg of legs) {
    const price = leg.recommended_side === 'over' ? leg.over_price : leg.under_price;
    decimalOdds *= americanToDecimal(price);
  }
  
  // Convert back to American
  let americanOdds: number;
  if (decimalOdds >= 2) {
    americanOdds = Math.round((decimalOdds - 1) * 100);
  } else {
    americanOdds = Math.round(-100 / (decimalOdds - 1));
  }
  
  return { decimalOdds, americanOdds };
}

// Calculate combined probability using hit rates
function calculateCombinedProbability(legs: any[]): number {
  let prob = 1;
  for (const leg of legs) {
    const hitRate = leg.recommended_side === 'over' ? leg.hit_rate_over : leg.hit_rate_under;
    prob *= hitRate;
  }
  return prob;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const { 
      minHitRate = 0.8, 
      maxLegs = 4, 
      sports = ['basketball_nba', 'americanfootball_nfl', 'icehockey_nhl'],
      runSharpAnalysis = false 
    } = await req.json().catch(() => ({}));

    console.log('Building hit rate parlays with params:', { minHitRate, maxLegs, sports, runSharpAnalysis });

    // Fetch high hit-rate props
    const { data: props, error: fetchError } = await supabase
      .from('player_prop_hitrates')
      .select('*')
      .in('sport', sports)
      .or(`hit_rate_over.gte.${minHitRate},hit_rate_under.gte.${minHitRate}`)
      .gt('expires_at', new Date().toISOString())
      .order('confidence_score', { ascending: false });

    if (fetchError) {
      throw new Error(`Failed to fetch props: ${fetchError.message}`);
    }

    if (!props || props.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No high hit-rate props found',
        parlays: []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Found ${props.length} high hit-rate props`);

    // Group props by event to avoid correlation
    const propsByEvent: Record<string, any[]> = {};
    for (const prop of props) {
      const eventKey = prop.event_id || prop.game_description;
      if (!propsByEvent[eventKey]) {
        propsByEvent[eventKey] = [];
      }
      propsByEvent[eventKey].push(prop);
    }

    // Strategy 1: 5/5 Streak Parlay (only perfect hit rates - 100%)
    const perfectProps = props.filter(p => {
      const bestHitRate = p.recommended_side === 'over' ? p.hit_rate_over : p.hit_rate_under;
      return bestHitRate >= 1.0;
    });

    // Strategy 2: Consistent Parlay (uses minHitRate threshold from request)
    const consistentProps = props.filter(p => {
      const bestHitRate = p.recommended_side === 'over' ? p.hit_rate_over : p.hit_rate_under;
      return bestHitRate >= minHitRate;
    });

    console.log(`Perfect props (100%): ${perfectProps.length}, Consistent props (>=${minHitRate * 100}%): ${consistentProps.length}`);

    const parlays: any[] = [];

    // Check how many unique events we have
    const uniqueEvents = new Set(props.map(p => p.event_id || p.game_description));
    const singleGameMode = uniqueEvents.size === 1;
    
    console.log(`Unique events: ${uniqueEvents.size}, Single game mode: ${singleGameMode}`);

    // Helper to select legs - allows same-game legs if only one game available
    const selectLegs = (sourceProps: any[], max: number): any[] => {
      const selected: any[] = [];
      const usedPlayers = new Set<string>();
      const usedEvents = new Set<string>();
      
      const sorted = sourceProps.sort((a, b) => {
        const hitRateA = a.recommended_side === 'over' ? a.hit_rate_over : a.hit_rate_under;
        const hitRateB = b.recommended_side === 'over' ? b.hit_rate_over : b.hit_rate_under;
        if (hitRateB !== hitRateA) return hitRateB - hitRateA;
        return b.confidence_score - a.confidence_score;
      });
      
      for (const prop of sorted) {
        if (selected.length >= max) break;
        
        const eventKey = prop.event_id || prop.game_description;
        const playerKey = `${prop.player_name}-${prop.prop_type}`;
        
        // Always avoid same player+prop combo
        if (usedPlayers.has(playerKey)) continue;
        
        // In multi-game mode, avoid same event
        if (!singleGameMode && usedEvents.has(eventKey)) continue;
        
        selected.push(prop);
        usedPlayers.add(playerKey);
        usedEvents.add(eventKey);
      }
      
      return selected;
    };

    // Build parlay from legs
    const buildParlay = (legs: any[], strategyType: string, minRate: number): any => {
      const { decimalOdds, americanOdds } = calculateParlayOdds(legs);
      const combinedProb = calculateCombinedProbability(legs);
      
      return {
        legs: legs.map(leg => ({
          player_name: leg.player_name,
          prop_type: leg.prop_type,
          line: leg.current_line,
          recommended_side: leg.recommended_side,
          price: leg.recommended_side === 'over' ? leg.over_price : leg.under_price,
          hit_rate: leg.recommended_side === 'over' ? leg.hit_rate_over : leg.hit_rate_under,
          games_analyzed: leg.games_analyzed,
          over_hits: leg.over_hits,
          under_hits: leg.under_hits,
          game_logs: leg.game_logs,
          confidence_score: leg.confidence_score,
          sport: leg.sport,
          game_description: leg.game_description,
          event_id: leg.event_id,
          commence_time: leg.commence_time
        })),
        combined_probability: Math.round(combinedProb * 10000) / 100,
        total_odds: americanOdds,
        min_hit_rate: minRate,
        strategy_type: strategyType,
        sharp_optimized: false,
        sport: legs.length === 1 ? legs[0].sport : (new Set(legs.map(l => l.sport)).size === 1 ? legs[0].sport : 'mixed'),
        expires_at: legs.reduce((min, leg) => 
          new Date(leg.commence_time) < new Date(min) ? leg.commence_time : min, 
          legs[0].commence_time
        )
      };
    };

    // Build 5/5 streak parlay if we have enough
    if (perfectProps.length >= 2) {
      const selectedLegs = selectLegs(perfectProps, maxLegs);
      
      if (selectedLegs.length >= 2) {
        parlays.push(buildParlay(selectedLegs, '5/5_streak', 1.0));
        console.log(`Built 5/5_streak parlay with ${selectedLegs.length} legs`);
      }
    }

    // Build consistent parlay
    if (consistentProps.length >= 2) {
      const selectedLegs = selectLegs(consistentProps, maxLegs);
      
      if (selectedLegs.length >= 2) {
        // Avoid duplicating if same legs as 5/5 parlay
        const existingLegKeys = parlays.length > 0 
          ? new Set(parlays[0].legs.map((l: any) => `${l.player_name}-${l.prop_type}`))
          : new Set();
        
        const isDuplicate = selectedLegs.length === parlays[0]?.legs?.length &&
          selectedLegs.every(leg => existingLegKeys.has(`${leg.player_name}-${leg.prop_type}`));
        
        if (!isDuplicate) {
          parlays.push(buildParlay(selectedLegs, 'consistent', minHitRate));
          console.log(`Built consistent parlay with ${selectedLegs.length} legs`);
        }
      }
    }

    // Optionally run sharp analysis on parlays
    if (runSharpAnalysis && parlays.length > 0) {
      console.log('Running sharp analysis on parlays...');
      
      for (const parlay of parlays) {
        const sharpResults: any[] = [];
        
        for (const leg of parlay.legs) {
          try {
            // Check if this prop has any line movement data
            const { data: movements } = await supabase
              .from('line_movements')
              .select('*')
              .eq('player_name', leg.player_name)
              .eq('market_type', leg.prop_type)
              .order('detected_at', { ascending: false })
              .limit(1);

            if (movements && movements.length > 0) {
              const movement = movements[0];
              sharpResults.push({
                player_name: leg.player_name,
                prop_type: leg.prop_type,
                is_sharp: movement.is_sharp_action,
                recommendation: movement.recommendation,
                movement_type: movement.movement_type,
                price_change: movement.price_change
              });

              // Boost confidence if sharp action aligns with hit rate recommendation
              if (movement.is_sharp_action && movement.recommendation === 'pick') {
                leg.confidence_score = Math.min(leg.confidence_score + 10, 100);
                leg.sharp_aligned = true;
              }
            }
          } catch (e) {
            console.error(`Error checking sharp data for ${leg.player_name}:`, e);
          }
        }

        parlay.sharp_optimized = sharpResults.length > 0;
        parlay.sharp_analysis = sharpResults;
      }
    }

    // Save parlays to database
    for (const parlay of parlays) {
      const { error: insertError } = await supabase
        .from('hitrate_parlays')
        .insert({
          legs: parlay.legs,
          combined_probability: parlay.combined_probability,
          total_odds: parlay.total_odds,
          min_hit_rate: parlay.min_hit_rate,
          strategy_type: parlay.strategy_type,
          sharp_optimized: parlay.sharp_optimized,
          sharp_analysis: parlay.sharp_analysis,
          sport: parlay.sport,
          expires_at: parlay.expires_at
        });

      if (insertError) {
        console.error('Error saving parlay:', insertError);
      } else {
        console.log(`✓ Saved ${parlay.strategy_type} parlay with ${parlay.legs.length} legs`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      parlaysCreated: parlays.length,
      parlays
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in build-hitrate-parlays:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
