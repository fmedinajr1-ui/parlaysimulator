import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PendingMovement {
  id: string;
  event_id: string;
  sport: string;
  bookmaker: string;
  market_type: string;
  outcome_name: string;
  commence_time: string;
  opening_price: number;
  opening_point: number | null;
  new_price: number;
  new_point: number | null;
  movement_authenticity: string;
  recommendation: string;
  recommendation_reason: string;
  player_name: string | null;
  books_consensus: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting finalize-line-determination...');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const oneHourFifteenFromNow = new Date(now.getTime() + 75 * 60 * 1000);

    // Find all pending movements for games starting in 60-75 minutes
    const { data: pendingMovements, error: queryError } = await supabase
      .from('line_movements')
      .select('*')
      .eq('determination_status', 'pending')
      .gte('commence_time', oneHourFromNow.toISOString())
      .lte('commence_time', oneHourFifteenFromNow.toISOString());

    if (queryError) throw queryError;

    if (!pendingMovements || pendingMovements.length === 0) {
      console.log('No pending movements found for games in the next 60-75 minutes');
      return new Response(JSON.stringify({ 
        success: true, 
        finalizedCount: 0,
        message: 'No pending movements to finalize'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${pendingMovements.length} pending movements to finalize`);

    // Group by event_id to minimize API calls
    const eventIds = [...new Set(pendingMovements.map((m: PendingMovement) => m.event_id))];
    const finalizedMovements: any[] = [];

    for (const eventId of eventIds) {
      const eventMovements = pendingMovements.filter((m: PendingMovement) => m.event_id === eventId);
      const firstMovement = eventMovements[0];
      
      // Fetch current odds for this event
      const sport = firstMovement.sport.toLowerCase().replace(' ', '_');
      const oddsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${eventId}/odds?apiKey=${oddsApiKey}&regions=us&markets=spreads,totals,h2h&oddsFormat=american`;
      
      console.log(`Fetching closing odds for event: ${eventId}`);
      
      try {
        const oddsResponse = await fetch(oddsUrl);
        
        if (!oddsResponse.ok) {
          console.error(`Failed to fetch odds for ${eventId}:`, oddsResponse.status);
          continue;
        }

        const oddsData = await oddsResponse.json();
        
        if (!oddsData.bookmakers || oddsData.bookmakers.length === 0) {
          console.log(`No closing odds available for ${eventId}`);
          continue;
        }

        // Process each pending movement for this event
        for (const movement of eventMovements) {
          const bookmaker = oddsData.bookmakers.find((b: any) => b.key === movement.bookmaker);
          
          if (!bookmaker) {
            console.log(`Bookmaker ${movement.bookmaker} not found for event ${eventId}`);
            continue;
          }

          const market = bookmaker.markets.find((m: any) => m.key === movement.market_type);
          
          if (!market) {
            console.log(`Market ${movement.market_type} not found for ${movement.bookmaker}`);
            continue;
          }

          const outcome = market.outcomes.find((o: any) => o.name === movement.outcome_name);
          
          if (!outcome) {
            console.log(`Outcome ${movement.outcome_name} not found`);
            continue;
          }

          // Calculate Closing Line Value (CLV)
          const closingPrice = outcome.price;
          const closingPoint = outcome.point || null;
          const openingPrice = movement.opening_price;
          const openingPoint = movement.opening_point;

          // Determine CLV direction
          let clvDirection: 'positive' | 'negative' | 'neutral' = 'neutral';
          let clvScore = 0;

          // For picks: Positive CLV = line moved in our favor (price got better)
          // For fades: Positive CLV = line moved away from our fade target
          if (movement.recommendation === 'pick') {
            if (closingPrice > openingPrice) {
              clvDirection = 'positive';
              clvScore = closingPrice - openingPrice;
            } else if (closingPrice < openingPrice) {
              clvDirection = 'negative';
              clvScore = openingPrice - closingPrice;
            }
          } else if (movement.recommendation === 'fade') {
            if (closingPrice < openingPrice) {
              clvDirection = 'positive';
              clvScore = openingPrice - closingPrice;
            } else if (closingPrice > openingPrice) {
              clvDirection = 'negative';
              clvScore = closingPrice - openingPrice;
            }
          }

          // Final determination scoring
          let finalScore = 0;
          const finalSignals: string[] = [];

          // CLV is the STRONGEST signal
          if (clvDirection === 'positive') {
            finalScore += 5;
            finalSignals.push(`CLV_POSITIVE (+${clvScore.toFixed(0)})`);
          } else if (clvDirection === 'negative') {
            finalScore -= 5;
            finalSignals.push(`CLV_NEGATIVE (-${clvScore.toFixed(0)})`);
          }

          // Multi-book consensus
          if (movement.books_consensus >= 3) {
            finalScore += 4;
            finalSignals.push('MULTI_BOOK_CONSENSUS');
          } else if (movement.books_consensus === 1) {
            finalScore -= 3;
            finalSignals.push('SINGLE_BOOK_ISOLATED');
          }

          // Line movement magnitude
          if (closingPoint && openingPoint && Math.abs(closingPoint - openingPoint) >= 1) {
            finalScore += 3;
            finalSignals.push('SIGNIFICANT_LINE_MOVE');
          }

          // Determine final authenticity and recommendation
          let finalAuthenticity: 'real' | 'fake' | 'uncertain';
          let finalRecommendation: 'pick' | 'fade' | 'caution';
          let finalReason: string;

          if (finalScore >= 5) {
            finalAuthenticity = 'real';
            finalRecommendation = 'pick';
            finalReason = `✅ CONFIRMED SHARP ACTION - ${finalSignals.join(', ')}`;
          } else if (finalScore <= -5) {
            finalAuthenticity = 'fake';
            finalRecommendation = 'fade';
            finalReason = `🚫 CONFIRMED TRAP - ${finalSignals.join(', ')}`;
          } else {
            finalAuthenticity = 'uncertain';
            finalRecommendation = 'caution';
            finalReason = `⚠️ MIXED SIGNALS - ${finalSignals.join(', ')}`;
          }

          // Update the movement to FINAL status
          const { error: updateError } = await supabase
            .from('line_movements')
            .update({
              determination_status: 'final',
              closing_price: closingPrice,
              closing_point: closingPoint,
              clv_direction: clvDirection,
              movement_authenticity: finalAuthenticity,
              recommendation: finalRecommendation,
              recommendation_reason: finalReason,
              final_determination_time: new Date().toISOString()
            })
            .eq('id', movement.id);

          if (updateError) {
            console.error(`Error updating movement ${movement.id}:`, updateError);
          } else {
            console.log(`✓ Finalized movement ${movement.id}: ${finalAuthenticity} (${clvDirection} CLV)`);
            finalizedMovements.push({
              id: movement.id,
              event_id: movement.event_id,
              finalAuthenticity,
              clvDirection,
              clvScore
            });
          }
        }
      } catch (fetchError) {
        console.error(`Error fetching odds for event ${eventId}:`, fetchError);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      finalizedCount: finalizedMovements.length,
      movements: finalizedMovements
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in finalize-line-determination:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
