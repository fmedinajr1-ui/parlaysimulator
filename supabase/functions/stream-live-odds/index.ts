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
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const oddsApiKey = Deno.env.get('ODDS_API_KEY');
    
    if (!oddsApiKey) {
      throw new Error('ODDS_API_KEY not configured');
    }

    console.log('[Stream Live Odds] Starting odds stream update...');

    // Fetch active predictions
    const { data: activePredictions, error: fetchError } = await supabase
      .from('god_mode_upset_predictions')
      .select('*')
      .eq('game_completed', false)
      .gte('commence_time', new Date().toISOString());

    if (fetchError) {
      throw fetchError;
    }

    if (!activePredictions || activePredictions.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No active predictions to update',
        updated: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Group predictions by sport
    const sportGroups = activePredictions.reduce((acc: Record<string, any[]>, pred) => {
      if (!acc[pred.sport]) acc[pred.sport] = [];
      acc[pred.sport].push(pred);
      return acc;
    }, {});

    let totalUpdated = 0;
    const updates: any[] = [];

    for (const [sport, predictions] of Object.entries(sportGroups)) {
      try {
        // Fetch current odds
        const oddsResponse = await fetch(
          `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${oddsApiKey}&regions=us&markets=h2h&oddsFormat=american`
        );

        if (!oddsResponse.ok) {
          console.log(`[Stream] Could not fetch odds for ${sport}`);
          continue;
        }

        const events = await oddsResponse.json();
        
        for (const prediction of predictions as any[]) {
          const event = events.find((e: any) => e.id === prediction.event_id);
          
          if (!event || !event.bookmakers || event.bookmakers.length === 0) continue;

          const bookmaker = event.bookmakers[0];
          const h2hMarket = bookmaker.markets?.find((m: any) => m.key === 'h2h');
          
          if (!h2hMarket) continue;

          const underdogOutcome = h2hMarket.outcomes.find((o: any) => 
            o.name === prediction.underdog
          );

          if (!underdogOutcome) continue;

          const newOdds = underdogOutcome.price;
          const previousOdds = prediction.underdog_odds;

          // Detect odds change direction
          let oddsChangeDirection = 'stable';
          if (newOdds > previousOdds + 5) {
            oddsChangeDirection = 'up'; // Underdog odds increased (less likely)
          } else if (newOdds < previousOdds - 5) {
            oddsChangeDirection = 'down'; // Underdog odds decreased (more likely)
          }

          // Only update if odds actually changed
          if (Math.abs(newOdds - previousOdds) >= 3) {
            // Recalculate upset score based on new odds
            const oddsChange = newOdds - previousOdds;
            let scoreAdjustment = 0;
            
            if (oddsChangeDirection === 'down') {
              // Odds moving towards underdog is bullish
              scoreAdjustment = Math.min(5, Math.abs(oddsChange) / 10);
            } else if (oddsChangeDirection === 'up') {
              // Odds moving away is bearish
              scoreAdjustment = -Math.min(5, Math.abs(oddsChange) / 10);
            }

            const newUpsetScore = Math.min(100, Math.max(0, 
              prediction.final_upset_score + scoreAdjustment
            ));

            // Update prediction
            const { error: updateError } = await supabase
              .from('god_mode_upset_predictions')
              .update({
                underdog_odds: newOdds,
                previous_odds: previousOdds,
                odds_change_direction: oddsChangeDirection,
                final_upset_score: Math.round(newUpsetScore * 10) / 10,
                is_live: true,
                last_odds_update: new Date().toISOString()
              })
              .eq('id', prediction.id);

            if (!updateError) {
              totalUpdated++;
              updates.push({
                id: prediction.id,
                underdog: prediction.underdog,
                oldOdds: previousOdds,
                newOdds,
                direction: oddsChangeDirection,
                newScore: newUpsetScore
              });

              console.log(`[Stream] Updated ${prediction.underdog}: ${previousOdds} → ${newOdds} (${oddsChangeDirection})`);
            }
          }
        }
      } catch (sportError) {
        console.error(`[Stream] Error processing ${sport}:`, sportError);
      }
    }

    // Check for games that have started (mark as live)
    const now = new Date();
    const { error: liveError } = await supabase
      .from('god_mode_upset_predictions')
      .update({ is_live: true })
      .eq('game_completed', false)
      .lte('commence_time', now.toISOString())
      .gte('commence_time', new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString());

    if (liveError) {
      console.error('[Stream] Error marking games as live:', liveError);
    }

    console.log(`[Stream Live Odds] Completed. Updated ${totalUpdated} predictions.`);

    return new Response(JSON.stringify({
      success: true,
      updated: totalUpdated,
      updates,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[Stream Live Odds] Error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
