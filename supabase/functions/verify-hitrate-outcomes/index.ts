import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HitRateParlay {
  id: string;
  legs: any[];
  expires_at: string;
  combined_probability: number;
  strategy_type: string;
  sport: string | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Starting hit rate parlay outcome verification...');

    // Get expired parlays that haven't been settled
    const now = new Date().toISOString();
    const { data: pendingParlays, error: fetchError } = await supabase
      .from('hitrate_parlays')
      .select('*')
      .eq('outcome', 'pending')
      .lt('expires_at', now)
      .order('expires_at', { ascending: true })
      .limit(50);

    if (fetchError) {
      console.error('Error fetching pending parlays:', fetchError);
      throw fetchError;
    }

    if (!pendingParlays || pendingParlays.length === 0) {
      console.log('No pending hit rate parlays to verify');
      return new Response(
        JSON.stringify({ success: true, message: 'No pending parlays to verify', verified: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${pendingParlays.length} expired parlays to verify`);

    let verified = 0;
    let won = 0;
    let lost = 0;

    for (const parlay of pendingParlays as HitRateParlay[]) {
      try {
        // For now, we'll use a simplified verification based on player stats cache
        // In production, this would fetch actual game results from an API
        const legResults: any[] = [];
        let allLegsWon = true;
        let anyLegVerifiable = false;

        for (const leg of parlay.legs) {
          const playerName = leg.player_name;
          const propType = leg.prop_type;
          const line = leg.line;
          const recommendedSide = leg.recommended_side;

          // Check if we have stats for this player after the parlay was created
          const { data: stats } = await supabase
            .from('player_stats_cache')
            .select('*')
            .ilike('player_name', `%${playerName}%`)
            .eq('stat_type', propType)
            .gt('created_at', parlay.expires_at)
            .order('game_date', { ascending: false })
            .limit(1);

          if (stats && stats.length > 0) {
            anyLegVerifiable = true;
            const actualValue = stats[0].stat_value;
            const legWon = recommendedSide === 'over' 
              ? actualValue > line 
              : actualValue < line;

            legResults.push({
              player_name: playerName,
              prop_type: propType,
              line,
              recommended_side: recommendedSide,
              actual_value: actualValue,
              won: legWon
            });

            if (!legWon) {
              allLegsWon = false;
            }
          } else {
            // No verifiable stats yet, mark as unknown
            legResults.push({
              player_name: playerName,
              prop_type: propType,
              line,
              recommended_side: recommendedSide,
              actual_value: null,
              won: null
            });
          }
        }

        // Only settle if at least one leg is verifiable
        if (anyLegVerifiable) {
          // If any leg has no data, check if parlay is old enough to assume loss
          const parlayAge = Date.now() - new Date(parlay.expires_at).getTime();
          const oneDayMs = 24 * 60 * 60 * 1000;

          // If parlay is more than 1 day old and we have some data, settle it
          if (parlayAge > oneDayMs || legResults.every(l => l.actual_value !== null)) {
            const outcome = allLegsWon ? 'won' : 'lost';
            
            const { error: updateError } = await supabase
              .from('hitrate_parlays')
              .update({
                outcome,
                settled_at: new Date().toISOString(),
                result_details: legResults,
                actual_win_rate: legResults.filter(l => l.won === true).length / legResults.length
              })
              .eq('id', parlay.id);

            if (updateError) {
              console.error(`Error updating parlay ${parlay.id}:`, updateError);
            } else {
              verified++;
              if (outcome === 'won') won++;
              else lost++;
              console.log(`Settled parlay ${parlay.id} as ${outcome}`);
            }
          }
        }
      } catch (legError) {
        console.error(`Error processing parlay ${parlay.id}:`, legError);
      }
    }

    // Update accuracy metrics
    if (verified > 0) {
      console.log('Updating hitrate accuracy metrics...');
      
      // Get aggregated stats
      const { data: strategyStats } = await supabase
        .from('hitrate_parlays')
        .select('strategy_type, sport, outcome, combined_probability')
        .in('outcome', ['won', 'lost']);

      if (strategyStats && strategyStats.length > 0) {
        // Group by strategy and sport
        const grouped: Record<string, any> = {};
        
        for (const stat of strategyStats) {
          const key = `${stat.strategy_type}|${stat.sport || 'all'}`;
          if (!grouped[key]) {
            grouped[key] = {
              strategy_type: stat.strategy_type,
              sport: stat.sport,
              total: 0,
              won: 0,
              probSum: 0
            };
          }
          grouped[key].total++;
          grouped[key].probSum += stat.combined_probability;
          if (stat.outcome === 'won') grouped[key].won++;
        }

        // Upsert metrics
        for (const key in grouped) {
          const g = grouped[key];
          const winRate = g.total > 0 ? g.won / g.total : 0;
          const avgPredicted = g.total > 0 ? g.probSum / g.total : 0;
          const calibrationFactor = avgPredicted > 0 ? winRate / avgPredicted : 1;

          await supabase
            .from('hitrate_accuracy_metrics')
            .upsert({
              strategy_type: g.strategy_type,
              sport: g.sport,
              prop_type: null,
              total_parlays: g.total,
              total_won: g.won,
              total_lost: g.total - g.won,
              win_rate: Math.round(winRate * 1000) / 10,
              avg_predicted_probability: Math.round(avgPredicted * 1000) / 10,
              avg_actual_probability: Math.round(winRate * 1000) / 10,
              calibration_factor: Math.round(calibrationFactor * 100) / 100,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'strategy_type,sport,prop_type'
            });
        }
      }
    }

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'verify-hitrate-outcomes',
      status: 'completed',
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - new Date().getTime(),
      result: { verified, won, lost, pending: pendingParlays.length - verified }
    });

    console.log(`Verification complete: ${verified} settled (${won} won, ${lost} lost)`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        verified, 
        won, 
        lost,
        pending: pendingParlays.length - verified
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in verify-hitrate-outcomes:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});