import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface ParlayLeg {
  description: string;
  odds: number;
}

interface GameResult {
  eventId: string;
  status: 'scheduled' | 'in_progress' | 'final' | 'postponed';
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  winner?: string;
  sport?: string;
}

// Normalize team name for matching
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Determine if a leg won based on game result
function determineLegOutcome(leg: ParlayLeg, game: GameResult): boolean | null {
  if (game.status !== 'final') {
    console.log(`Game not final: ${game.homeTeam} vs ${game.awayTeam} (${game.status})`);
    return null;
  }
  
  if (game.homeScore === null || game.awayScore === null) {
    console.log(`Missing scores for ${game.homeTeam} vs ${game.awayTeam}`);
    return null;
  }
  
  const desc = leg.description.toLowerCase();
  const homeNorm = normalizeTeamName(game.homeTeam);
  const awayNorm = normalizeTeamName(game.awayTeam);
  const descNorm = normalizeTeamName(desc);
  
  // Determine which team the bet is on
  const isHomeTeamBet = descNorm.includes(homeNorm) || 
    descNorm.includes(homeNorm.split(' ').pop() || '');
  const isAwayTeamBet = descNorm.includes(awayNorm) || 
    descNorm.includes(awayNorm.split(' ').pop() || '');
  
  console.log(`Evaluating: "${desc.substring(0, 60)}..."`);
  console.log(`Home: ${game.homeTeam} (${game.homeScore}), Away: ${game.awayTeam} (${game.awayScore})`);
  console.log(`Bet on: ${isHomeTeamBet ? 'home' : isAwayTeamBet ? 'away' : 'unknown'}`);
  
  // Handle moneyline bets
  if (desc.includes('moneyline') || desc.includes(' ml') || 
      (desc.includes('to win') && !desc.includes('spread'))) {
    const betTeamWon = isHomeTeamBet 
      ? game.homeScore > game.awayScore
      : game.awayScore > game.homeScore;
    console.log(`Moneyline bet result: ${betTeamWon ? 'WON' : 'LOST'}`);
    return betTeamWon;
  }
  
  // Handle spread bets
  const spreadMatch = desc.match(/([+-]?\d+\.?\d*)\s*(pts?|points?)?/);
  if (spreadMatch && (desc.includes('spread') || desc.includes('+') || desc.includes('-'))) {
    const spread = parseFloat(spreadMatch[1]);
    const scoreDiff = game.homeScore - game.awayScore;
    
    // If bet is on home team, add spread to home score
    // If bet is on away team, add spread to away score (which is like subtracting from diff)
    let adjustedDiff: number;
    if (isHomeTeamBet) {
      adjustedDiff = scoreDiff + spread;
    } else if (isAwayTeamBet) {
      adjustedDiff = -scoreDiff + spread;
    } else {
      console.log(`Can't determine team for spread bet`);
      return null;
    }
    
    const won = adjustedDiff > 0;
    console.log(`Spread bet: ${spread}, scoreDiff: ${scoreDiff}, adjustedDiff: ${adjustedDiff}, result: ${won ? 'WON' : 'LOST'}`);
    return won;
  }
  
  // Handle over/under (totals) bets
  if (desc.includes('over') || desc.includes('under')) {
    const totalMatch = desc.match(/(\d+\.?\d*)\s*(pts?|points?)?/);
    if (totalMatch) {
      const total = parseFloat(totalMatch[1]);
      const actualTotal = game.homeScore + game.awayScore;
      
      let won: boolean;
      if (desc.includes('over')) {
        won = actualTotal > total;
      } else {
        won = actualTotal < total;
      }
      console.log(`Over/Under bet: line ${total}, actual ${actualTotal}, result: ${won ? 'WON' : 'LOST'}`);
      return won;
    }
  }
  
  // For player props and complex bets, return null (requires manual settlement)
  console.log(`Can't auto-determine outcome for: "${desc.substring(0, 60)}..."`);
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log('=== Starting auto-settle process ===');
    
    // Fetch unsettled parlays where games should have started
    const { data: unsettledParlays, error: fetchError } = await supabase
      .from('parlay_history')
      .select('*')
      .eq('is_settled', false)
      .not('event_start_time', 'is', null)
      .lt('event_start_time', new Date().toISOString());
    
    if (fetchError) {
      throw fetchError;
    }
    
    console.log(`Found ${unsettledParlays?.length || 0} unsettled parlays to check`);
    
    const results: Array<{ parlayId: string; status: string; details?: string }> = [];
    
    for (const parlay of unsettledParlays || []) {
      try {
        console.log(`\n--- Processing parlay ${parlay.id} ---`);
        const legs = parlay.legs as ParlayLeg[];
        
        // Get training data for this parlay to check leg outcomes
        const { data: trainingData } = await supabase
          .from('parlay_training_data')
          .select('*')
          .eq('parlay_history_id', parlay.id)
          .order('leg_index');
        
        // Determine sports from training data or leg descriptions
        const sports = [...new Set(trainingData?.map(t => t.sport).filter(Boolean) || [])];
        const legDescriptions = legs.map(l => l.description);
        
        console.log(`Parlay has ${legs.length} legs, sports: ${sports.join(', ') || 'unknown'}`);
        
        // Fetch game scores
        const scoreResponse = await fetch(`${supabaseUrl}/functions/v1/fetch-game-scores`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            sport: sports[0] || null,
            legDescriptions,
          }),
        });
        
        let gameResults: Record<number, GameResult | null> = {};
        
        if (scoreResponse.ok) {
          const scoreData = await scoreResponse.json();
          gameResults = scoreData.matchedGames || {};
          console.log(`Matched ${Object.values(gameResults).filter(Boolean).length}/${legs.length} legs to games`);
        } else {
          console.log(`Failed to fetch scores: ${scoreResponse.status}`);
        }
        
        // Evaluate each leg
        let allGamesFinished = true;
        let allLegsWon = true;
        let anyLegLost = false;
        let determinedLegs = 0;
        
        for (let i = 0; i < legs.length; i++) {
          const game = gameResults[i];
          
          if (!game) {
            console.log(`Leg ${i}: No game matched`);
            allGamesFinished = false;
            continue;
          }
          
          if (game.status !== 'final') {
            console.log(`Leg ${i}: Game not final (${game.status})`);
            allGamesFinished = false;
            continue;
          }
          
          const legOutcome = determineLegOutcome(legs[i], game);
          
          if (legOutcome === null) {
            allGamesFinished = false;
          } else {
            determinedLegs++;
            
            // Update training data with leg outcome
            await supabase
              .from('parlay_training_data')
              .update({
                leg_outcome: legOutcome,
                event_status: 'final',
                event_result: legOutcome ? 'win' : 'loss',
              })
              .eq('parlay_history_id', parlay.id)
              .eq('leg_index', i);
            
            if (legOutcome === false) {
              anyLegLost = true;
              allLegsWon = false;
              console.log(`Leg ${i}: LOST ❌`);
            } else {
              console.log(`Leg ${i}: WON ✓`);
            }
          }
        }
        
        console.log(`Summary: ${determinedLegs}/${legs.length} determined, anyLost: ${anyLegLost}, allWon: ${allLegsWon && allGamesFinished}`);
        
        // If any leg lost, the parlay is lost
        if (anyLegLost) {
          await supabase
            .from('parlay_history')
            .update({
              is_settled: true,
              is_won: false,
              settled_at: new Date().toISOString(),
              all_games_started: true,
            })
            .eq('id', parlay.id);
          
          // Update training data
          await supabase
            .from('parlay_training_data')
            .update({
              parlay_outcome: false,
              settled_at: new Date().toISOString(),
            })
            .eq('parlay_history_id', parlay.id);
          
          // Update profile stats - fetch current values and increment
          const { data: profile } = await supabase
            .from('profiles')
            .select('total_losses, total_staked')
            .eq('user_id', parlay.user_id)
            .maybeSingle();
          
          if (profile) {
            await supabase
              .from('profiles')
              .update({
                total_losses: (profile.total_losses || 0) + 1,
                total_staked: (profile.total_staked || 0) + Number(parlay.stake),
              })
              .eq('user_id', parlay.user_id);
          }
          
          results.push({
            parlayId: parlay.id,
            status: 'settled',
            details: 'LOST - at least one leg failed',
          });
          console.log(`Parlay ${parlay.id}: SETTLED as LOST`);
          
        } else if (allGamesFinished && allLegsWon) {
          // All games finished and all legs won
          await supabase
            .from('parlay_history')
            .update({
              is_settled: true,
              is_won: true,
              settled_at: new Date().toISOString(),
              all_games_started: true,
            })
            .eq('id', parlay.id);
          
          // Update training data
          await supabase
            .from('parlay_training_data')
            .update({
              parlay_outcome: true,
              settled_at: new Date().toISOString(),
            })
            .eq('parlay_history_id', parlay.id);
          
          // Update profile stats - fetch current values and increment
          const { data: profile } = await supabase
            .from('profiles')
            .select('total_wins, total_staked, total_payout')
            .eq('user_id', parlay.user_id)
            .maybeSingle();
          
          if (profile) {
            await supabase
              .from('profiles')
              .update({
                total_wins: (profile.total_wins || 0) + 1,
                total_staked: (profile.total_staked || 0) + Number(parlay.stake),
                total_payout: (profile.total_payout || 0) + Number(parlay.potential_payout),
              })
              .eq('user_id', parlay.user_id);
          }
          
          results.push({
            parlayId: parlay.id,
            status: 'settled',
            details: 'WON - all legs hit! 🎉',
          });
          console.log(`Parlay ${parlay.id}: SETTLED as WON 🎉`);
          
        } else {
          results.push({
            parlayId: parlay.id,
            status: 'pending',
            details: `${determinedLegs}/${legs.length} legs determined, waiting for more games`,
          });
          console.log(`Parlay ${parlay.id}: Still pending`);
        }
        
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error(`Error processing parlay ${parlay.id}:`, err);
        results.push({
          parlayId: parlay.id,
          status: 'error',
          details: errorMessage,
        });
      }
    }
    
    console.log('\n=== Auto-settle complete ===');
    console.log(`Processed: ${results.length}`);
    console.log(`Settled: ${results.filter(r => r.status === 'settled').length}`);
    console.log(`Pending: ${results.filter(r => r.status === 'pending').length}`);
    console.log(`Errors: ${results.filter(r => r.status === 'error').length}`);
    
    return new Response(
      JSON.stringify({
        processed: results.length,
        settled: results.filter(r => r.status === 'settled').length,
        pending: results.filter(r => r.status === 'pending').length,
        errors: results.filter(r => r.status === 'error').length,
        results,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in auto-settle-parlays:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});