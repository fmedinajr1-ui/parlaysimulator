import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log('=== Starting sharp outcome verification ===');
    
    // Get unverified line movements from the last 48 hours that should have game results
    const { data: unverifiedMovements, error: fetchError } = await supabase
      .from('line_movements')
      .select('*')
      .eq('outcome_verified', false)
      .lt('commence_time', new Date().toISOString())
      .gte('commence_time', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .order('commence_time', { ascending: true });
    
    if (fetchError) {
      throw fetchError;
    }
    
    console.log(`Found ${unverifiedMovements?.length || 0} unverified movements to check`);
    
    const results = {
      verified: 0,
      correct: 0,
      incorrect: 0,
      pending: 0,
      errors: 0,
    };
    
    // Group by event_id to batch game score fetches
    const eventIds = [...new Set(unverifiedMovements?.map(m => m.event_id) || [])];
    
    for (const eventId of eventIds) {
      try {
        const eventMovements = unverifiedMovements?.filter(m => m.event_id === eventId) || [];
        if (eventMovements.length === 0) continue;
        
        const movement = eventMovements[0];
        console.log(`\nChecking event: ${movement.description}`);
        
        // Fetch game scores
        const scoreResponse = await fetch(`${supabaseUrl}/functions/v1/fetch-game-scores`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            sport: movement.sport,
            legDescriptions: [movement.description],
          }),
        });
        
        if (!scoreResponse.ok) {
          console.log(`Failed to fetch scores for ${eventId}`);
          results.pending += eventMovements.length;
          continue;
        }
        
        const scoreData = await scoreResponse.json();
        const gameResult = scoreData.matchedGames?.[0];
        
        if (!gameResult || gameResult.status !== 'final') {
          console.log(`Game not final yet: ${gameResult?.status || 'no match'}`);
          results.pending += eventMovements.length;
          continue;
        }
        
        console.log(`Game result: ${gameResult.homeTeam} ${gameResult.homeScore} - ${gameResult.awayTeam} ${gameResult.awayScore}`);
        
        // Determine if the sharp-backed side won
        for (const mov of eventMovements) {
          try {
            const wasCorrect = determineOutcome(mov, gameResult);
            
            if (wasCorrect === null) {
              results.pending++;
              continue;
            }
            
            // Update the line movement with verified outcome
            const { error: updateError } = await supabase
              .from('line_movements')
              .update({
                outcome_verified: true,
                outcome_correct: wasCorrect,
                verified_at: new Date().toISOString(),
                game_result: `${gameResult.homeTeam} ${gameResult.homeScore} - ${gameResult.awayTeam} ${gameResult.awayScore}`,
              })
              .eq('id', mov.id);
            
            if (updateError) {
              console.error(`Failed to update movement ${mov.id}:`, updateError);
              results.errors++;
              continue;
            }
            
            results.verified++;
            if (wasCorrect) {
              results.correct++;
              console.log(`✓ Sharp action CORRECT: ${mov.outcome_name}`);
            } else {
              results.incorrect++;
              console.log(`✗ Sharp action INCORRECT: ${mov.outcome_name}`);
              
              // Record trap pattern if sharp was wrong
              if (mov.is_sharp_action && mov.recommendation === 'pick') {
                await recordTrapPattern(supabase, mov, gameResult);
              }
            }
          } catch (innerErr) {
            console.error(`Error processing movement ${mov.id}:`, innerErr);
            results.errors++;
          }
        }
      } catch (eventErr) {
        console.error(`Error processing event ${eventId}:`, eventErr);
        results.errors++;
      }
    }
    
    // Update calibration factors after verification
    console.log('\nRecalculating calibration factors...');
    const { error: calibError } = await supabase.rpc('calculate_calibration_factors');
    if (calibError) {
      console.error('Failed to recalculate calibration:', calibError);
    }
    
    // Update strategy performance
    console.log('Updating strategy performance...');
    const { error: stratError } = await supabase.rpc('update_strategy_performance');
    if (stratError) {
      console.error('Failed to update strategy performance:', stratError);
    }
    
    console.log('\n=== Verification complete ===');
    console.log(`Verified: ${results.verified}`);
    console.log(`Correct: ${results.correct}`);
    console.log(`Incorrect: ${results.incorrect}`);
    console.log(`Pending: ${results.pending}`);
    console.log(`Errors: ${results.errors}`);
    
    // Calculate sharp money accuracy rate
    const sharpAccuracy = results.verified > 0 
      ? (results.correct / results.verified * 100).toFixed(1)
      : 'N/A';
    
    return new Response(
      JSON.stringify({
        ...results,
        sharpAccuracyRate: sharpAccuracy,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in verify-sharp-outcomes:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function determineOutcome(movement: any, game: any): boolean | null {
  const desc = movement.description?.toLowerCase() || '';
  const outcomeName = movement.outcome_name?.toLowerCase() || '';
  
  // Normalize team names
  const homeNorm = game.homeTeam.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const awayNorm = game.awayTeam.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  
  // Determine which team the movement is backing
  const isHomeBet = desc.includes(homeNorm) || 
    desc.includes(homeNorm.split(' ').pop() || '') ||
    outcomeName.includes(homeNorm) ||
    outcomeName.includes(homeNorm.split(' ').pop() || '');
  
  const isAwayBet = desc.includes(awayNorm) || 
    desc.includes(awayNorm.split(' ').pop() || '') ||
    outcomeName.includes(awayNorm) ||
    outcomeName.includes(awayNorm.split(' ').pop() || '');
  
  const marketType = movement.market_type?.toLowerCase() || '';
  
  // Handle moneyline (h2h)
  if (marketType === 'h2h' || desc.includes('moneyline') || desc.includes(' ml')) {
    if (isHomeBet) {
      return game.homeScore > game.awayScore;
    } else if (isAwayBet) {
      return game.awayScore > game.homeScore;
    }
  }
  
  // Handle spreads
  if (marketType === 'spreads' || desc.includes('spread')) {
    const point = movement.new_point || movement.old_point;
    if (point !== null && point !== undefined) {
      const scoreDiff = game.homeScore - game.awayScore;
      if (isHomeBet) {
        return scoreDiff + point > 0;
      } else if (isAwayBet) {
        return -scoreDiff + point > 0;
      }
    }
  }
  
  // Handle totals
  if (marketType === 'totals' || desc.includes('over') || desc.includes('under')) {
    const total = game.homeScore + game.awayScore;
    const point = movement.new_point || movement.old_point;
    
    if (point !== null && point !== undefined) {
      if (outcomeName.includes('over') || desc.includes('over')) {
        return total > point;
      } else if (outcomeName.includes('under') || desc.includes('under')) {
        return total < point;
      }
    }
  }
  
  // Cannot determine
  return null;
}

async function recordTrapPattern(supabase: any, movement: any, game: any) {
  try {
    console.log(`Recording trap pattern for: ${movement.description}`);
    
    // Build trap signature
    const timeBeforeGame = movement.commence_time 
      ? (new Date(movement.commence_time).getTime() - new Date(movement.detected_at).getTime()) / (1000 * 60 * 60)
      : null;
    
    const trapSignature = [
      movement.sport,
      movement.market_type,
      movement.movement_authenticity || 'uncertain',
      timeBeforeGame && timeBeforeGame < 6 ? 'late_move' : 'early_move',
      Math.abs(movement.price_change) >= 15 ? 'large_move' : 'small_move',
    ].join('_');
    
    const { error } = await supabase
      .from('trap_patterns')
      .insert({
        sport: movement.sport,
        bet_type: movement.market_type,
        market_type: movement.market_type,
        bookmaker: movement.bookmaker,
        movement_size: Math.abs(movement.price_change),
        original_movement_id: movement.id,
        was_single_book: movement.books_consensus === 1,
        price_only_move: !movement.point_change || movement.point_change === 0,
        early_morning_move: timeBeforeGame && timeBeforeGame >= 12,
        time_before_game_hours: timeBeforeGame,
        trap_signature: trapSignature,
        confirmed_trap: true,
      });
    
    if (error) {
      console.error('Failed to record trap pattern:', error);
    } else {
      console.log(`Trap pattern recorded: ${trapSignature}`);
    }
  } catch (err) {
    console.error('Error recording trap pattern:', err);
  }
}
