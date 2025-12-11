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

    const { action, parlayId, outcome, userId, legs } = await req.json();

    console.log('🧠 AI Learning Engine - Action:', action);

    // NEW ACTIONS for formula learning
    if (action === 'process_settlement') {
      return await processSettlement(supabase, parlayId, outcome);
    }
    
    if (action === 'recalculate_weights') {
      return await recalculateAllWeights(supabase);
    }
    
    if (action === 'discover_compound_formulas') {
      return await discoverCompoundFormulas(supabase);
    }
    
    if (action === 'full_learning_cycle') {
      const settleResult = await processAllPendingSettlements(supabase);
      const weightsResult = await recalculateAllWeights(supabase);
      const compoundResult = await discoverCompoundFormulas(supabase);
      
      return new Response(JSON.stringify({
        success: true,
        settlements: settleResult,
        weights_updated: weightsResult,
        compound_formulas: compoundResult
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // EXISTING ACTIONS for user stats (backward compatibility)
    if (action === 'get_user_stats') {
      const { data: userStats, error } = await supabase
        .rpc('get_user_betting_stats', { p_user_id: userId });
      if (error) throw error;
      return new Response(JSON.stringify({ userStats: userStats || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get_ai_accuracy') {
      const { data: aiMetrics, error } = await supabase.rpc('get_ai_accuracy_stats');
      if (error) throw error;
      return new Response(JSON.stringify({ aiMetrics: aiMetrics || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get_suggestion_accuracy') {
      const { data: suggestionAccuracy, error } = await supabase.rpc('get_suggestion_accuracy_stats');
      if (error) throw error;
      
      const transformed = (suggestionAccuracy || []).map((s: any) => ({
        sport: s.sport,
        confidenceLevel: s.confidence_level,
        totalSuggestions: s.total_suggestions,
        totalWon: s.total_won,
        totalLost: s.total_lost,
        accuracyRate: s.accuracy_rate,
        avgOdds: s.avg_odds,
        roiPercentage: s.roi_percentage,
      }));

      const totalSuggestions = transformed.reduce((sum: number, s: any) => sum + s.totalSuggestions, 0);
      const totalWon = transformed.reduce((sum: number, s: any) => sum + s.totalWon, 0);
      const totalLost = transformed.reduce((sum: number, s: any) => sum + s.totalLost, 0);
      const overallAccuracy = totalSuggestions > 0 ? ((totalWon / totalSuggestions) * 100).toFixed(1) : '0';

      return new Response(JSON.stringify({ 
        suggestionAccuracy: transformed,
        summary: { totalSuggestions, totalWon, totalLost, overallAccuracy: parseFloat(overallAccuracy) }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get_historical_context' && userId && legs) {
      const [userStatsResult, aiMetricsResult, suggestionAccuracyResult] = await Promise.all([
        supabase.rpc('get_user_betting_stats', { p_user_id: userId }),
        supabase.rpc('get_ai_accuracy_stats'),
        supabase.rpc('get_suggestion_accuracy_stats'),
      ]);

      return new Response(JSON.stringify({
        userStatsByType: userStatsResult.data || [],
        aiMetricsByType: aiMetricsResult.data || [],
        suggestionAccuracyByType: suggestionAccuracyResult.data || [],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('AI Learning Engine Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Process a single parlay settlement
async function processSettlement(supabase: any, parlayId: string, outcome: 'won' | 'lost') {
  console.log(`📊 Processing settlement for parlay ${parlayId} - ${outcome}`);

  const { data: parlay, error } = await supabase
    .from('ai_generated_parlays')
    .select('*')
    .eq('id', parlayId)
    .single();

  if (error || !parlay) {
    return new Response(JSON.stringify({ error: 'Parlay not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  await supabase
    .from('ai_generated_parlays')
    .update({ outcome, settled_at: new Date().toISOString() })
    .eq('id', parlayId);

  const legs = parlay.legs || [];
  const isWin = outcome === 'won';

  for (const leg of legs) {
    const formulaName = leg.formula_name;
    const engineSource = leg.engine_source;
    const sport = leg.sport || parlay.sport;

    if (!formulaName || !engineSource) continue;

    const { data: formula } = await supabase
      .from('ai_formula_performance')
      .select('*')
      .eq('formula_name', formulaName)
      .eq('engine_source', engineSource)
      .single();

    if (formula) {
      const newWins = formula.wins + (isWin ? 1 : 0);
      const newLosses = formula.losses + (isWin ? 0 : 1);
      const newTotal = formula.total_picks + 1;
      const newAccuracy = newTotal > 0 ? (newWins / newTotal) * 100 : 0;

      const sportBreakdown = formula.sport_breakdown || {};
      if (!sportBreakdown[sport]) {
        sportBreakdown[sport] = { wins: 0, losses: 0, accuracy: 0 };
      }
      sportBreakdown[sport].wins += isWin ? 1 : 0;
      sportBreakdown[sport].losses += isWin ? 0 : 1;
      const sportTotal = sportBreakdown[sport].wins + sportBreakdown[sport].losses;
      sportBreakdown[sport].accuracy = sportTotal > 0 ? (sportBreakdown[sport].wins / sportTotal) * 100 : 0;

      await supabase
        .from('ai_formula_performance')
        .update({
          total_picks: newTotal,
          wins: newWins,
          losses: newLosses,
          current_accuracy: Math.round(newAccuracy * 100) / 100,
          last_win_streak: isWin ? (formula.last_win_streak + 1) : 0,
          last_loss_streak: isWin ? 0 : (formula.last_loss_streak + 1),
          sport_breakdown: sportBreakdown
        })
        .eq('id', formula.id);

      console.log(`✅ Updated ${formulaName}: ${newAccuracy.toFixed(1)}% (${newWins}W-${newLosses}L)`);
    } else {
      await supabase
        .from('ai_formula_performance')
        .insert({
          formula_name: formulaName,
          engine_source: engineSource,
          total_picks: 1,
          wins: isWin ? 1 : 0,
          losses: isWin ? 0 : 1,
          current_accuracy: isWin ? 100 : 0,
          current_weight: 1.0,
          last_win_streak: isWin ? 1 : 0,
          last_loss_streak: isWin ? 0 : 1,
          sport_breakdown: { [sport]: { wins: isWin ? 1 : 0, losses: isWin ? 0 : 1, accuracy: isWin ? 100 : 0 } }
        });
    }
  }

  // Update learning progress
  const { data: latestProgress } = await supabase
    .from('ai_learning_progress')
    .select('*')
    .order('generation_round', { ascending: false })
    .limit(1);

  if (latestProgress && latestProgress.length > 0) {
    const progress = latestProgress[0];
    const newWins = (progress.wins || 0) + (isWin ? 1 : 0);
    const newLosses = (progress.losses || 0) + (isWin ? 0 : 1);
    const total = newWins + newLosses;
    
    await supabase
      .from('ai_learning_progress')
      .update({
        parlays_settled: (progress.parlays_settled || 0) + 1,
        wins: newWins,
        losses: newLosses,
        current_accuracy: total > 0 ? Math.round((newWins / total) * 100 * 10) / 10 : 0
      })
      .eq('id', progress.id);
  }

  return new Response(JSON.stringify({
    success: true,
    parlay_id: parlayId,
    outcome,
    formulas_updated: legs.length
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Process all pending settlements
async function processAllPendingSettlements(supabase: any) {
  const { data: settledParlays } = await supabase
    .from('ai_generated_parlays')
    .select('*')
    .in('outcome', ['won', 'lost'])
    .is('settled_at', null);

  let processed = 0;
  for (const parlay of settledParlays || []) {
    const isWin = parlay.outcome === 'won';
    const legs = parlay.legs || [];

    for (const leg of legs) {
      const formulaName = leg.formula_name;
      const engineSource = leg.engine_source;
      const sport = leg.sport || parlay.sport;

      if (!formulaName || !engineSource) continue;

      const { data: formula } = await supabase
        .from('ai_formula_performance')
        .select('*')
        .eq('formula_name', formulaName)
        .eq('engine_source', engineSource)
        .single();

      if (formula) {
        const newWins = formula.wins + (isWin ? 1 : 0);
        const newLosses = formula.losses + (isWin ? 0 : 1);
        const newTotal = formula.total_picks + 1;
        const newAccuracy = newTotal > 0 ? (newWins / newTotal) * 100 : 0;

        const sportBreakdown = formula.sport_breakdown || {};
        if (!sportBreakdown[sport]) {
          sportBreakdown[sport] = { wins: 0, losses: 0, accuracy: 0 };
        }
        sportBreakdown[sport].wins += isWin ? 1 : 0;
        sportBreakdown[sport].losses += isWin ? 0 : 1;

        await supabase
          .from('ai_formula_performance')
          .update({
            total_picks: newTotal,
            wins: newWins,
            losses: newLosses,
            current_accuracy: Math.round(newAccuracy * 100) / 100,
            sport_breakdown: sportBreakdown
          })
          .eq('id', formula.id);
      }
    }

    await supabase
      .from('ai_generated_parlays')
      .update({ settled_at: new Date().toISOString() })
      .eq('id', parlay.id);

    processed++;
  }

  return { processed };
}

// Recalculate all formula weights based on performance
async function recalculateAllWeights(supabase: any) {
  console.log('⚖️ Recalculating formula weights');

  const { data: formulas } = await supabase
    .from('ai_formula_performance')
    .select('*');

  let updated = 0;

  for (const formula of formulas || []) {
    if (formula.total_picks < 5) continue;

    const accuracy = formula.current_accuracy;
    let newWeight = 1.0;

    if (accuracy >= 65) {
      newWeight = 1.0 + ((accuracy - 50) / 100) * 1.5;
    } else if (accuracy >= 55) {
      newWeight = 1.0 + ((accuracy - 50) / 100);
    } else if (accuracy >= 45) {
      newWeight = 1.0;
    } else if (accuracy >= 35) {
      newWeight = 0.5 + (accuracy / 100);
    } else {
      newWeight = Math.max(0.2, accuracy / 100);
    }

    if (formula.last_win_streak >= 5) {
      newWeight *= 1.15;
    } else if (formula.last_loss_streak >= 5) {
      newWeight *= 0.85;
    }

    const sampleConfidence = Math.min(1, formula.total_picks / 50);
    newWeight = 1.0 + (newWeight - 1.0) * sampleConfidence;
    newWeight = Math.max(0.2, Math.min(2.5, newWeight));
    newWeight = Math.round(newWeight * 100) / 100;

    if (Math.abs(newWeight - formula.current_weight) > 0.05) {
      await supabase
        .from('ai_formula_performance')
        .update({ current_weight: newWeight })
        .eq('id', formula.id);
      updated++;
      console.log(`📈 ${formula.formula_name}: ${formula.current_weight} → ${newWeight}`);
    }
  }

  return { weights_updated: updated };
}

// Discover compound formula combinations
async function discoverCompoundFormulas(supabase: any) {
  console.log('🔬 Discovering compound formulas');

  const { data: winningParlays } = await supabase
    .from('ai_generated_parlays')
    .select('*')
    .eq('outcome', 'won');

  const { data: losingParlays } = await supabase
    .from('ai_generated_parlays')
    .select('*')
    .eq('outcome', 'lost');

  const combinations: Record<string, { wins: number; losses: number }> = {};

  for (const parlay of winningParlays || []) {
    const formulas = (parlay.legs || [])
      .map((l: any) => l.formula_name)
      .filter(Boolean)
      .sort()
      .join('+');
    
    if (formulas) {
      if (!combinations[formulas]) combinations[formulas] = { wins: 0, losses: 0 };
      combinations[formulas].wins++;
    }
  }

  for (const parlay of losingParlays || []) {
    const formulas = (parlay.legs || [])
      .map((l: any) => l.formula_name)
      .filter(Boolean)
      .sort()
      .join('+');
    
    if (formulas) {
      if (!combinations[formulas]) combinations[formulas] = { wins: 0, losses: 0 };
      combinations[formulas].losses++;
    }
  }

  const goodCombinations: Array<{ combination: string; accuracy: number; sample_size: number }> = [];
  
  for (const [combo, stats] of Object.entries(combinations)) {
    const total = stats.wins + stats.losses;
    if (total >= 5) {
      const accuracy = (stats.wins / total) * 100;
      if (accuracy >= 55) {
        goodCombinations.push({
          combination: combo,
          accuracy: Math.round(accuracy * 10) / 10,
          sample_size: total
        });
      }
    }
  }

  goodCombinations.sort((a, b) => b.accuracy - a.accuracy);

  console.log(`📊 Found ${goodCombinations.length} high-performing combinations`);

  return {
    combinations_discovered: goodCombinations.length,
    top_combinations: goodCombinations.slice(0, 5)
  };
}
