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
    const { parlayId, suggestedParlayId, wasLoss, lossAmount } = await req.json();
    
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log(`Recording trap pattern for parlay ${parlayId}, wasLoss: ${wasLoss}`);

    // Fetch the suggested parlay to get leg details
    const { data: suggestedParlay, error: suggestedError } = await supabase
      .from('suggested_parlays')
      .select('*')
      .eq('id', suggestedParlayId)
      .maybeSingle();

    if (suggestedError || !suggestedParlay) {
      console.error('Failed to fetch suggested parlay:', suggestedError);
      throw new Error('Suggested parlay not found');
    }

    // Fetch training data for this parlay to analyze patterns
    const { data: trainingData, error: trainingError } = await supabase
      .from('parlay_training_data')
      .select('*')
      .eq('parlay_history_id', parlayId);

    if (trainingError) {
      console.error('Failed to fetch training data:', trainingError);
    }

    // Analyze each leg for trap characteristics
    const legs = suggestedParlay.legs as any[];
    const { data: lineMovements } = await supabase
      .from('line_movements')
      .select('*')
      .in('event_id', legs.map((l: any) => l.eventId || '').filter(Boolean))
      .gte('detected_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const legTraining = trainingData?.find(t => t.leg_index === i);
      
      // Find related line movements for this leg
      const relatedMovements = lineMovements?.filter(lm => 
        lm.event_id === leg.eventId || 
        lm.description?.toLowerCase().includes(leg.description?.toLowerCase() || '')
      ) || [];

      if (relatedMovements.length === 0) continue;

      // Analyze trap characteristics for each movement
      for (const movement of relatedMovements) {
        const wasSingleBook = !movement.books_consensus || movement.books_consensus === 1;
        const priceOnlyMove = Math.abs(movement.price_change) >= 10 && 
                             (!movement.point_change || Math.abs(movement.point_change) < 0.5);
        const bothSidesMoved = movement.opposite_side_moved === true;
        
        const commenceTime = new Date(movement.commence_time || suggestedParlay.created_at);
        const detectedTime = new Date(movement.detected_at);
        const hoursBeforeGame = (commenceTime.getTime() - detectedTime.getTime()) / (1000 * 60 * 60);
        const earlyMorningMove = detectedTime.getHours() >= 6 && detectedTime.getHours() <= 10;

        // Generate trap signature for pattern matching
        const trapSignature = `${leg.sport || 'unknown'}_${leg.betType || 'unknown'}_` +
                            `${wasSingleBook ? 'single_book' : 'multi_book'}_` +
                            `${priceOnlyMove ? 'price_only' : 'line_move'}_` +
                            `${earlyMorningMove ? 'morning' : 'normal'}`;

        // Insert trap pattern record
        const { error: insertError } = await supabase
          .from('trap_patterns')
          .insert({
            original_movement_id: movement.id,
            sport: leg.sport || 'unknown',
            bet_type: leg.betType || 'unknown',
            market_type: movement.market_type,
            bookmaker: movement.bookmaker,
            was_single_book: wasSingleBook,
            price_only_move: priceOnlyMove,
            early_morning_move: earlyMorningMove,
            both_sides_moved: bothSidesMoved,
            movement_size: Math.abs(movement.price_change),
            time_before_game_hours: hoursBeforeGame,
            parlay_id: parlayId,
            confirmed_trap: wasLoss,
            loss_amount: wasLoss ? lossAmount : null,
            trap_signature: trapSignature,
          });

        if (insertError) {
          console.error('Failed to insert trap pattern:', insertError);
        } else {
          console.log(`Recorded ${wasLoss ? 'trap' : 'win'} pattern: ${trapSignature}`);
        }

        // Update line_movements with outcome verification
        await supabase
          .from('line_movements')
          .update({
            outcome_verified: true,
            outcome_correct: !wasLoss, // If parlay won, the movement was correct
            linked_parlay_ids: [...(movement.linked_parlay_ids || []), parlayId],
            trap_score: wasLoss ? Math.min((movement.trap_score || 0) + 20, 100) : Math.max((movement.trap_score || 0) - 10, 0),
          })
          .eq('id', movement.id);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        patternsRecorded: lineMovements?.length || 0,
        wasLoss 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in record-trap-pattern:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});