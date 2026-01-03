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

    console.log('[PARLAY-VERIFY] Starting median parlay outcome verification...');

    const { reverify } = await req.json().catch(() => ({ reverify: false }));

    // Get pending parlays from yesterday and earlier
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    let parlaysQuery = supabase
      .from('median_parlay_picks')
      .select('*')
      .lte('parlay_date', yesterdayStr);
    
    if (reverify) {
      console.log('[PARLAY-VERIFY] RE-VERIFICATION MODE: Recalculating all historical outcomes...');
      parlaysQuery = parlaysQuery.limit(100);
    } else {
      parlaysQuery = parlaysQuery
        .or('outcome.is.null,outcome.eq.pending')
        .limit(50);
    }
    
    const { data: pendingParlays, error: parlaysError } = await parlaysQuery;

    if (parlaysError) {
      console.error('[PARLAY-VERIFY] Error fetching pending parlays:', parlaysError);
      throw parlaysError;
    }

    console.log(`[PARLAY-VERIFY] Found ${pendingParlays?.length || 0} pending parlays to verify`);

    const resultsByType: Record<string, { won: number; lost: number; partial: number }> = {
      SAFE: { won: 0, lost: 0, partial: 0 },
      BALANCED: { won: 0, lost: 0, partial: 0 },
      VALUE: { won: 0, lost: 0, partial: 0 }
    };

    let verifiedCount = 0;

    for (const parlay of pendingParlays || []) {
      try {
        const legs = parlay.legs as any[];
        if (!legs || !Array.isArray(legs)) {
          console.log(`[PARLAY-VERIFY] Skipping parlay ${parlay.id} - no legs array`);
          continue;
        }

        const legOutcomes: { outcome: string; actual_value: number | null }[] = [];
        let legsWon = 0;
        let legsLost = 0;
        let legsPush = 0;
        let legsNoData = 0;

        for (const leg of legs) {
          try {
            // Fetch player's actual game log for that date
            const { data: gameLog, error: logError } = await supabase
              .from('nba_player_game_logs')
              .select('points, rebounds, assists, minutes_played')
              .eq('player_name', leg.player_name)
              .eq('game_date', parlay.parlay_date)
              .single();

            if (logError || !gameLog) {
              console.log(`[PARLAY-VERIFY] No game log for ${leg.player_name} on ${parlay.parlay_date}`);
              legOutcomes.push({ outcome: 'no_data', actual_value: null });
              legsNoData++;
              continue;
            }

            // Calculate actual value based on stat_type
            let actualValue: number | null = null;
            const statType = (leg.stat_type || '').toLowerCase();

            if (statType.includes('pra') || statType === 'pra') {
              actualValue = (gameLog.points || 0) + (gameLog.rebounds || 0) + (gameLog.assists || 0);
            } else if (statType.includes('pr') || statType === 'pr') {
              actualValue = (gameLog.points || 0) + (gameLog.rebounds || 0);
            } else if (statType.includes('pa') || statType === 'pa') {
              actualValue = (gameLog.points || 0) + (gameLog.assists || 0);
            } else if (statType.includes('ra') || statType === 'ra') {
              actualValue = (gameLog.rebounds || 0) + (gameLog.assists || 0);
            } else if (statType.includes('points') || statType === 'points') {
              actualValue = gameLog.points;
            } else if (statType.includes('rebounds') || statType === 'rebounds') {
              actualValue = gameLog.rebounds;
            } else if (statType.includes('assists') || statType === 'assists') {
              actualValue = gameLog.assists;
            }

            if (actualValue === null) {
              console.log(`[PARLAY-VERIFY] Could not determine actual value for stat type: ${statType}`);
              legOutcomes.push({ outcome: 'no_data', actual_value: null });
              legsNoData++;
              continue;
            }

            // Determine bet side from recommendation
            const recommendation = leg.recommendation || '';
            const line = leg.line || 0;
            
            const isOver = recommendation.toUpperCase().includes('OVER');
            const isUnder = recommendation.toUpperCase().includes('UNDER');
            
            if (!isOver && !isUnder) {
              legOutcomes.push({ outcome: 'no_data', actual_value: actualValue });
              legsNoData++;
              continue;
            }
            
            let legOutcome: string;
            
            if (isUnder) {
              if (actualValue < line) {
                legOutcome = 'hit';
                legsWon++;
              } else if (actualValue === line) {
                legOutcome = 'push';
                legsPush++;
              } else {
                legOutcome = 'miss';
                legsLost++;
              }
            } else {
              // OVER
              if (actualValue > line) {
                legOutcome = 'hit';
                legsWon++;
              } else if (actualValue === line) {
                legOutcome = 'push';
                legsPush++;
              } else {
                legOutcome = 'miss';
                legsLost++;
              }
            }

            legOutcomes.push({ outcome: legOutcome, actual_value: actualValue });
            console.log(`[PARLAY-VERIFY] Leg: ${leg.player_name} ${statType} ${isOver ? 'OVER' : 'UNDER'} ${line} = ${actualValue} → ${legOutcome}`);
          } catch (legErr) {
            console.error(`[PARLAY-VERIFY] Error processing leg:`, legErr);
            legOutcomes.push({ outcome: 'error', actual_value: null });
            legsNoData++;
          }
        }

        // Determine overall parlay outcome
        let parlayOutcome: string;
        
        if (legsLost > 0) {
          parlayOutcome = 'lost';
        } else if (legsNoData === legs.length) {
          parlayOutcome = 'pending'; // All legs have no data
        } else if (legsWon === legs.length) {
          parlayOutcome = 'won';
        } else if (legsPush === legs.length) {
          parlayOutcome = 'push';
        } else if (legsWon > 0 && legsNoData > 0) {
          parlayOutcome = 'partial'; // Some legs won, some no data
        } else {
          parlayOutcome = 'pending';
        }

        // Update parlay with outcomes
        const { error: updateError } = await supabase
          .from('median_parlay_picks')
          .update({
            outcome: parlayOutcome,
            leg_outcomes: legOutcomes,
            legs_won: legsWon,
            legs_lost: legsLost,
            verified_at: new Date().toISOString(),
          })
          .eq('id', parlay.id);

        if (updateError) {
          console.error(`[PARLAY-VERIFY] Error updating parlay ${parlay.id}:`, updateError);
          continue;
        }

        verifiedCount++;
        
        // Update experiment assignment if this parlay is part of an A/B test
        if (parlay.experiment_id) {
          const { error: assignmentError } = await supabase
            .from('parlay_experiment_assignments')
            .update({
              outcome: parlayOutcome,
              legs_hit: legsWon,
              verified_at: new Date().toISOString()
            })
            .eq('parlay_id', parlay.id);
          
          if (assignmentError) {
            console.error(`[PARLAY-VERIFY] Error updating assignment for parlay ${parlay.id}:`, assignmentError);
          } else {
            console.log(`[PARLAY-VERIFY] Updated A/B assignment for parlay ${parlay.id} (${parlay.experiment_variant}): ${parlayOutcome}`);
          }
        }
        
        // Track by type
        const parlayType = parlay.parlay_type || 'UNKNOWN';
        if (resultsByType[parlayType]) {
          if (parlayOutcome === 'won') resultsByType[parlayType].won++;
          else if (parlayOutcome === 'lost') resultsByType[parlayType].lost++;
          else if (parlayOutcome === 'partial') resultsByType[parlayType].partial++;
        }

        console.log(`[PARLAY-VERIFY] Parlay ${parlay.id} (${parlayType}): ${legsWon}/${legs.length} legs hit → ${parlayOutcome}`);
      } catch (err) {
        console.error(`[PARLAY-VERIFY] Error processing parlay ${parlay.id}:`, err);
      }
    }

    // Calculate accuracy by parlay type
    const accuracyByType: Record<string, { total: number; won: number; rate: string }> = {};
    for (const [type, results] of Object.entries(resultsByType)) {
      const total = results.won + results.lost;
      accuracyByType[type] = {
        total,
        won: results.won,
        rate: total > 0 ? ((results.won / total) * 100).toFixed(1) + '%' : 'N/A'
      };
    }

    const summary = {
      parlaysVerified: verifiedCount,
      resultsByType,
      accuracyByType,
    };

    console.log('[PARLAY-VERIFY] Verification complete:', JSON.stringify(summary, null, 2));

    return new Response(JSON.stringify({ 
      success: true, 
      summary,
      message: `Verified ${verifiedCount} parlays`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[PARLAY-VERIFY] Verification error:', error);
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
