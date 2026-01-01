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

    console.log('Starting Median Edge outcome verification...');

    const { reverify } = await req.json().catch(() => ({ reverify: false }));

    // Get pending picks from yesterday and earlier
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    let picksQuery = supabase
      .from('median_edge_picks')
      .select('*')
      .lte('game_date', yesterdayStr);
    
    if (reverify) {
      console.log('RE-VERIFICATION MODE: Recalculating all historical outcomes...');
      picksQuery = picksQuery.limit(500);
    } else {
      picksQuery = picksQuery
        .or('outcome.is.null,outcome.eq.pending')
        .limit(200);
    }
    
    const { data: pendingPicks, error: picksError } = await picksQuery;

    if (picksError) {
      console.error('Error fetching pending picks:', picksError);
      throw picksError;
    }

    console.log(`Found ${pendingPicks?.length || 0} pending picks to verify`);

    let verifiedCount = 0;
    let hitCount = 0;
    let missCount = 0;
    let pushCount = 0;
    const resultsByRecommendation: Record<string, { hits: number; misses: number; pushes: number }> = {};

    for (const pick of pendingPicks || []) {
      try {
        // Fetch player's actual game log for that date
        const { data: gameLog, error: logError } = await supabase
          .from('nba_player_game_logs')
          .select('points, rebounds, assists, minutes_played, threes_made, steals, blocks, turnovers')
          .eq('player_name', pick.player_name)
          .eq('game_date', pick.game_date)
          .single();

        if (logError || !gameLog) {
          console.log(`No game log found for ${pick.player_name} on ${pick.game_date}`);
          continue;
        }

        // Determine actual value based on stat_type
        let actualValue: number | null = null;
        const statType = pick.stat_type?.toLowerCase() || '';

        if (statType.includes('pra') || statType.includes('pts+reb+ast') || statType.includes('pts_rebs_asts')) {
          actualValue = (gameLog.points || 0) + (gameLog.rebounds || 0) + (gameLog.assists || 0);
        } else if (statType.includes('pts_rebs') || statType.includes('pts+reb') || statType.includes('points_rebounds')) {
          actualValue = (gameLog.points || 0) + (gameLog.rebounds || 0);
        } else if (statType.includes('pts_asts') || statType.includes('pts+ast') || statType.includes('points_assists')) {
          actualValue = (gameLog.points || 0) + (gameLog.assists || 0);
        } else if (statType.includes('rebs_asts') || statType.includes('reb+ast') || statType.includes('rebounds_assists')) {
          actualValue = (gameLog.rebounds || 0) + (gameLog.assists || 0);
        } else if (statType.includes('points') || statType.includes('pts') || statType === 'points') {
          actualValue = gameLog.points;
        } else if (statType.includes('rebounds') || statType.includes('rebs') || statType === 'rebounds') {
          actualValue = gameLog.rebounds;
        } else if (statType.includes('assists') || statType.includes('asts') || statType === 'assists') {
          actualValue = gameLog.assists;
        } else if (statType.includes('threes') || statType.includes('3pt') || statType.includes('three_pointers')) {
          actualValue = gameLog.threes_made ?? null;
        } else if (statType.includes('steals') || statType.includes('stl')) {
          actualValue = gameLog.steals ?? null;
        } else if (statType.includes('blocks') || statType.includes('blk')) {
          actualValue = gameLog.blocks ?? null;
        } else if (statType.includes('turnovers') || statType.includes('to')) {
          actualValue = gameLog.turnovers ?? null;
        }

        if (actualValue === null) {
          console.log(`Could not determine actual value for stat type: ${statType}`);
          continue;
        }

        // Determine bet side from recommendation
        const recommendation = pick.recommendation || '';
        const line = pick.sportsbook_line || 0;
        
        // Parse recommendation to determine side
        // Recommendations: 'STRONG OVER', 'LEAN OVER', 'STRONG UNDER', 'LEAN UNDER', 'NO BET'
        const isOver = recommendation.toUpperCase().includes('OVER');
        const isUnder = recommendation.toUpperCase().includes('UNDER');
        
        if (!isOver && !isUnder) {
          console.log(`Skipping pick with unclear recommendation: ${recommendation}`);
          continue;
        }
        
        let outcome: string;
        
        if (isUnder) {
          if (actualValue < line) {
            outcome = 'hit';
            hitCount++;
          } else if (actualValue === line) {
            outcome = 'push';
            pushCount++;
          } else {
            outcome = 'miss';
            missCount++;
          }
        } else {
          // OVER
          if (actualValue > line) {
            outcome = 'hit';
            hitCount++;
          } else if (actualValue === line) {
            outcome = 'push';
            pushCount++;
          } else {
            outcome = 'miss';
            missCount++;
          }
        }

        // Track by recommendation type (LEAN vs STRONG)
        const recType = recommendation.toUpperCase().includes('STRONG') ? 'STRONG' : 'LEAN';
        if (!resultsByRecommendation[recType]) {
          resultsByRecommendation[recType] = { hits: 0, misses: 0, pushes: 0 };
        }
        if (outcome === 'hit') resultsByRecommendation[recType].hits++;
        else if (outcome === 'miss') resultsByRecommendation[recType].misses++;
        else resultsByRecommendation[recType].pushes++;

        // Update pick with outcome
        const { error: updateError } = await supabase
          .from('median_edge_picks')
          .update({
            outcome,
            actual_value: actualValue,
            verified_at: new Date().toISOString(),
          })
          .eq('id', pick.id);

        if (updateError) {
          console.error(`Error updating pick ${pick.id}:`, updateError);
          continue;
        }

        verifiedCount++;
        console.log(`Verified ${pick.player_name} ${statType}: ${actualValue} vs ${line} (${isOver ? 'OVER' : 'UNDER'}) = ${outcome}`);
      } catch (err) {
        console.error(`Error processing pick ${pick.id}:`, err);
      }
    }

    // Calculate accuracy by recommendation type
    const accuracyByType: Record<string, number> = {};
    for (const [type, results] of Object.entries(resultsByRecommendation)) {
      const total = results.hits + results.misses;
      accuracyByType[type] = total > 0 ? Math.round((results.hits / total) * 100) : 0;
    }

    const summary = {
      picksVerified: verifiedCount,
      hits: hitCount,
      misses: missCount,
      pushes: pushCount,
      overallHitRate: verifiedCount > 0 ? ((hitCount / (hitCount + missCount)) * 100).toFixed(1) : '0',
      resultsByRecommendation,
      accuracyByType,
    };

    console.log('Verification complete:', JSON.stringify(summary, null, 2));

    return new Response(JSON.stringify({ 
      success: true, 
      summary,
      message: `Verified ${verifiedCount} picks (${hitCount} hits, ${missCount} misses, ${pushCount} pushes)`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Verification error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
