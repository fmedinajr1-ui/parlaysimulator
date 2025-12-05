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
    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get unverified predictions where game time has passed
    const { data: pendingPredictions, error: fetchError } = await supabase
      .from('upset_predictions')
      .select('*')
      .eq('game_completed', false)
      .lt('commence_time', new Date().toISOString())
      .order('commence_time', { ascending: true })
      .limit(50);

    if (fetchError) throw fetchError;
    
    console.log(`Found ${pendingPredictions?.length || 0} predictions to verify`);

    if (!pendingPredictions || pendingPredictions.length === 0) {
      return new Response(JSON.stringify({
        message: 'No predictions to verify',
        verified: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Group predictions by sport for efficient API calls
    const sportGroups: Record<string, any[]> = {};
    for (const pred of pendingPredictions) {
      if (!sportGroups[pred.sport]) sportGroups[pred.sport] = [];
      sportGroups[pred.sport].push(pred);
    }

    const SPORT_API_KEYS: Record<string, string> = {
      'NBA': 'basketball_nba',
      'NCAAB': 'basketball_ncaab',
      'NFL': 'americanfootball_nfl',
      'NCAAF': 'americanfootball_ncaaf',
      'NHL': 'icehockey_nhl',
      'MLB': 'baseball_mlb',
    };

    let verifiedCount = 0;
    let correctCount = 0;

    // Fetch scores for each sport
    for (const [sport, predictions] of Object.entries(sportGroups)) {
      const apiKey = SPORT_API_KEYS[sport];
      if (!apiKey) continue;

      try {
        // Fetch completed games from The Odds API
        const response = await fetch(
          `https://api.the-odds-api.com/v4/sports/${apiKey}/scores/?apiKey=${oddsApiKey}&daysFrom=3`
        );

        if (!response.ok) continue;
        const scores = await response.json();

        // Match predictions to completed games
        for (const pred of predictions) {
          const game = scores.find((s: any) => s.id === pred.game_id);
          
          if (!game || !game.completed) continue;

          // Determine winner
          const homeScore = game.scores?.find((s: any) => s.name === pred.home_team)?.score;
          const awayScore = game.scores?.find((s: any) => s.name === pred.away_team)?.score;

          if (homeScore === undefined || awayScore === undefined) continue;

          const winner = parseInt(homeScore) > parseInt(awayScore) 
            ? pred.home_team 
            : pred.away_team;
          
          // Check if underdog won (upset)
          const wasUpset = winner === pred.underdog;

          // Update prediction record
          const { error: updateError } = await supabase
            .from('upset_predictions')
            .update({
              game_completed: true,
              winner,
              was_upset: wasUpset,
              verified_at: new Date().toISOString()
            })
            .eq('id', pred.id);

          if (!updateError) {
            verifiedCount++;
            if (wasUpset) correctCount++;
            console.log(`Verified: ${pred.home_team} vs ${pred.away_team} - Winner: ${winner}, Upset: ${wasUpset}`);
          }
        }
      } catch (e) {
        console.error(`Error fetching scores for ${sport}:`, e);
      }
    }

    // Get updated accuracy stats
    const { data: accuracyData } = await supabase.rpc('get_upset_accuracy_summary');

    return new Response(JSON.stringify({
      message: `Verified ${verifiedCount} predictions`,
      verified: verifiedCount,
      upsets: correctCount,
      accuracy: accuracyData?.[0] || null
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Error in verify-upset-outcomes:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
