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
}

// Determine if a leg won based on game result
function determineLegOutcome(leg: ParlayLeg, game: GameResult): boolean | null {
  if (game.status !== 'final') return null;
  
  const desc = leg.description.toLowerCase();
  
  // Handle moneyline bets
  if (desc.includes('moneyline') || desc.includes(' ml')) {
    const teamName = desc.replace(/moneyline|ml/gi, '').trim();
    return game.winner?.toLowerCase().includes(teamName) || false;
  }
  
  // Handle spread bets
  if (desc.includes('+') || desc.includes('-')) {
    const spreadMatch = desc.match(/([+-]?\d+\.?\d*)/);
    if (spreadMatch && game.homeScore !== null && game.awayScore !== null) {
      const spread = parseFloat(spreadMatch[1]);
      const scoreDiff = game.homeScore - game.awayScore;
      
      // Simplified spread logic - needs team context
      return scoreDiff + spread > 0;
    }
  }
  
  // Handle over/under bets
  if (desc.includes('over') || desc.includes('under')) {
    const totalMatch = desc.match(/(\d+\.?\d*)/);
    if (totalMatch && game.homeScore !== null && game.awayScore !== null) {
      const total = parseFloat(totalMatch[1]);
      const actualTotal = game.homeScore + game.awayScore;
      
      if (desc.includes('over')) return actualTotal > total;
      if (desc.includes('under')) return actualTotal < total;
    }
  }
  
  // For complex props, return null (requires manual settlement)
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log('Starting auto-settle process...');
    
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
    
    console.log(`Found ${unsettledParlays?.length || 0} parlays to check`);
    
    const results: Array<{ parlayId: string; status: string; details?: string }> = [];
    
    for (const parlay of unsettledParlays || []) {
      try {
        const legs = parlay.legs as ParlayLeg[];
        
        // Get training data for this parlay to check leg outcomes
        const { data: trainingData } = await supabase
          .from('parlay_training_data')
          .select('*')
          .eq('parlay_history_id', parlay.id)
          .order('leg_index');
        
        // Fetch current game scores
        const legDescriptions = legs.map(l => l.description);
        const sports = [...new Set(trainingData?.map(t => t.sport).filter(Boolean) || [])];
        
        let allGamesFinished = true;
        let allLegsWon = true;
        let anyLegLost = false;
        let gameResults: Record<number, GameResult | null> = {};
        
        // Fetch scores for each sport
        for (const sport of sports.length ? sports : ['nba', 'nfl', 'mlb', 'nhl']) {
          const scoreResponse = await fetch(`${supabaseUrl}/functions/v1/fetch-game-scores`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              sport,
              legDescriptions,
            }),
          });
          
          if (scoreResponse.ok) {
            const scoreData = await scoreResponse.json();
            Object.assign(gameResults, scoreData.matchedGames || {});
          }
        }
        
        // Evaluate each leg
        for (let i = 0; i < legs.length; i++) {
          const game = gameResults[i];
          
          if (!game || game.status !== 'final') {
            allGamesFinished = false;
            continue;
          }
          
          const legOutcome = determineLegOutcome(legs[i], game);
          
          if (legOutcome === null) {
            // Can't determine outcome automatically
            allGamesFinished = false;
          } else if (legOutcome === false) {
            anyLegLost = true;
            allLegsWon = false;
            
            // Update training data with leg outcome
            await supabase
              .from('parlay_training_data')
              .update({
                leg_outcome: false,
                event_status: 'final',
                event_result: 'loss',
              })
              .eq('parlay_history_id', parlay.id)
              .eq('leg_index', i);
          } else {
            // Update training data with leg outcome
            await supabase
              .from('parlay_training_data')
              .update({
                leg_outcome: true,
                event_status: 'final',
                event_result: 'win',
              })
              .eq('parlay_history_id', parlay.id)
              .eq('leg_index', i);
          }
        }
        
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
          
          // Update profile stats
          await supabase
            .from('profiles')
            .update({
              total_losses: supabase.rpc('increment', { x: 1 }),
              total_staked: supabase.rpc('increment', { x: parlay.stake }),
            })
            .eq('user_id', parlay.user_id);
          
          results.push({
            parlayId: parlay.id,
            status: 'settled',
            details: 'Lost - at least one leg failed',
          });
          
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
          
          // Update profile stats
          await supabase
            .from('profiles')
            .update({
              total_wins: supabase.rpc('increment', { x: 1 }),
              total_staked: supabase.rpc('increment', { x: parlay.stake }),
              total_payout: supabase.rpc('increment', { x: parlay.potential_payout }),
            })
            .eq('user_id', parlay.user_id);
          
          results.push({
            parlayId: parlay.id,
            status: 'settled',
            details: 'Won - all legs hit!',
          });
          
        } else {
          results.push({
            parlayId: parlay.id,
            status: 'pending',
            details: 'Games still in progress or unable to determine outcome',
          });
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
    
    console.log('Auto-settle complete:', results);
    
    return new Response(
      JSON.stringify({
        processed: results.length,
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
