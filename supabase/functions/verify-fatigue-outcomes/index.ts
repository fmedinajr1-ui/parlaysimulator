import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FatigueEdge {
  id: string;
  event_id: string;
  game_date: string;
  home_team: string;
  away_team: string;
  fatigue_differential: number;
  recommended_side: string;
  home_fatigue_score: number;
  away_fatigue_score: number;
}

interface GameScore {
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  completed: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY');

    console.log('Starting fatigue outcome verification...');

    // Get unverified fatigue edges from past games
    const today = new Date().toISOString().split('T')[0];
    const { data: pendingEdges, error: fetchError } = await supabase
      .from('fatigue_edge_tracking')
      .select('*')
      .is('recommended_side_won', null)
      .lt('game_date', today);

    if (fetchError) {
      throw new Error(`Failed to fetch pending edges: ${fetchError.message}`);
    }

    if (!pendingEdges || pendingEdges.length === 0) {
      console.log('No pending fatigue edges to verify');
      return new Response(
        JSON.stringify({ success: true, message: 'No pending edges', verified: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${pendingEdges.length} pending fatigue edges to verify`);

    // Fetch completed NBA game scores
    let gameScores: Map<string, GameScore> = new Map();

    if (oddsApiKey) {
      try {
        // Fetch recent NBA scores from odds API
        const scoresUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/scores/?apiKey=${oddsApiKey}&daysFrom=3`;
        const scoresResponse = await fetch(scoresUrl);

        if (scoresResponse.ok) {
          const scoresData = await scoresResponse.json();
          
          for (const game of scoresData) {
            if (game.completed && game.scores) {
              const homeScore = game.scores.find((s: any) => s.name === game.home_team);
              const awayScore = game.scores.find((s: any) => s.name === game.away_team);
              
              if (homeScore && awayScore) {
                gameScores.set(game.id, {
                  home_team: game.home_team,
                  away_team: game.away_team,
                  home_score: parseInt(homeScore.score),
                  away_score: parseInt(awayScore.score),
                  completed: true,
                });

                // Also create lookup by team names
                const key = `${game.away_team}@${game.home_team}`;
                gameScores.set(key, {
                  home_team: game.home_team,
                  away_team: game.away_team,
                  home_score: parseInt(homeScore.score),
                  away_score: parseInt(awayScore.score),
                  completed: true,
                });
              }
            }
          }
          console.log(`Fetched ${gameScores.size} completed game scores`);
        }
      } catch (e) {
        console.error('Error fetching scores:', e);
      }
    }

    // Verify each pending edge
    const results: any[] = [];
    let verified = 0;
    let wins = 0;
    let losses = 0;

    for (const edge of pendingEdges as FatigueEdge[]) {
      // Try to find game score
      let score = gameScores.get(edge.event_id);
      
      if (!score) {
        // Try team name lookup
        const key = `${edge.away_team}@${edge.home_team}`;
        score = gameScores.get(key);
      }

      if (!score) {
        // Try fuzzy matching
        for (const [_, gameScore] of gameScores) {
          if (
            (gameScore.home_team.includes(edge.home_team) || edge.home_team.includes(gameScore.home_team)) &&
            (gameScore.away_team.includes(edge.away_team) || edge.away_team.includes(gameScore.away_team))
          ) {
            score = gameScore;
            break;
          }
        }
      }

      if (score && score.completed) {
        // Determine winner
        const homeWon = score.home_score > score.away_score;
        const awayWon = score.away_score > score.home_score;
        
        // Check if recommended side won
        let recommendedSideWon: boolean;
        if (edge.recommended_side === 'home') {
          recommendedSideWon = homeWon;
        } else {
          recommendedSideWon = awayWon;
        }

        // Calculate spread (positive = home won by X)
        const actualSpread = score.home_score - score.away_score;
        const actualTotal = score.home_score + score.away_score;

        // Update the edge record
        const { error: updateError } = await supabase
          .from('fatigue_edge_tracking')
          .update({
            recommended_side_won: recommendedSideWon,
            game_result: `${score.away_team} ${score.away_score} - ${score.home_team} ${score.home_score}`,
            actual_spread: actualSpread,
            actual_total: actualTotal,
            verified_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', edge.id);

        if (updateError) {
          console.error(`Error updating edge ${edge.id}:`, updateError);
        } else {
          verified++;
          if (recommendedSideWon) {
            wins++;
          } else {
            losses++;
          }

          results.push({
            game: `${edge.away_team} @ ${edge.home_team}`,
            differential: edge.fatigue_differential,
            recommended: edge.recommended_side,
            result: recommendedSideWon ? 'WIN' : 'LOSS',
            score: `${score.away_score}-${score.home_score}`,
          });

          console.log(`Verified: ${edge.away_team} @ ${edge.home_team} - ${recommendedSideWon ? 'WIN' : 'LOSS'}`);
        }
      }
    }

    const winRate = verified > 0 ? ((wins / verified) * 100).toFixed(1) : '0';
    const roi = verified > 0 ? (((wins * 0.91 - losses) / verified) * 100).toFixed(1) : '0';

    console.log(`Verification complete: ${verified} games, ${wins}W-${losses}L (${winRate}% win rate, ${roi}% ROI)`);

    return new Response(
      JSON.stringify({
        success: true,
        verified,
        wins,
        losses,
        winRate: parseFloat(winRate),
        roi: parseFloat(roi),
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in verify-fatigue-outcomes:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
