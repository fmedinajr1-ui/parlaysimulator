import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LossPattern {
  description: string;
  line?: number;
  actual_value?: number;
  miss_amount?: number;
  sport: string;
  engine_source: string;
  formula_name: string;
  timestamp: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { action, parlayId, outcome, userId, legs, legResults } = await req.json();

    console.log('🧠 AI Learning Engine - Action:', action);

    // Enhanced settlement with loss analysis
    if (action === 'process_settlement_with_analysis') {
      return await processSettlementWithAnalysis(supabase, parlayId, outcome, legResults);
    }

    if (action === 'process_settlement') {
      return await processSettlement(supabase, parlayId, outcome);
    }
    
    if (action === 'recalculate_weights') {
      const result = await recalculateAllWeights(supabase);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (action === 'discover_compound_formulas') {
      const result = await discoverCompoundFormulas(supabase);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'update_avoid_patterns') {
      const result = await updateAvoidPatterns(supabase);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'cross_engine_analysis') {
      const result = await analyzeCrossEnginePerformance(supabase);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (action === 'full_learning_cycle') {
      console.log('🔄 Starting full learning cycle...');
      const settleResult = await processAllPendingSettlements(supabase);
      const weightsResult = await recalculateAllWeights(supabase);
      const compoundResult = await updateCompoundFormulas(supabase);
      const avoidResult = await updateAvoidPatterns(supabase);
      const crossEngineResult = await analyzeCrossEnginePerformance(supabase);
      const syncResult = await syncLearningProgressFromSettled(supabase);
      
      return new Response(JSON.stringify({
        success: true,
        settlements: settleResult,
        weights_updated: weightsResult,
        compound_formulas: compoundResult,
        avoid_patterns: avoidResult,
        cross_engine: crossEngineResult,
        learning_progress_synced: syncResult
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Sync learning progress from settled parlays
    if (action === 'sync_learning_progress') {
      const result = await syncLearningProgressFromSettled(supabase);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Existing actions for backward compatibility
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

// Enhanced settlement with detailed loss analysis
async function processSettlementWithAnalysis(
  supabase: any, 
  parlayId: string, 
  outcome: 'won' | 'lost',
  legResults?: Array<{ description: string; outcome: string; actualValue?: number; line?: number }>
) {
  console.log(`📊 Processing settlement with analysis for parlay ${parlayId} - ${outcome}`);

  const { data: parlay, error } = await supabase
    .from('ai_generated_parlays')
    .select('*')
    .eq('id', parlayId)
    .single();

  if (error || !parlay) {
    return new Response(JSON.stringify({ error: 'Parlay not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Update parlay outcome
  await supabase
    .from('ai_generated_parlays')
    .update({ outcome, settled_at: new Date().toISOString() })
    .eq('id', parlayId);

  const legs = parlay.legs || [];
  const isWin = outcome === 'won';
  const lossPatterns: LossPattern[] = [];

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const legResult = legResults?.[i];
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

    // Determine individual leg outcome
    const legWon = legResult?.outcome === 'won';
    const legLost = legResult?.outcome === 'lost';

    // Track loss patterns for analysis
    if (legLost && legResult) {
      const lossPattern: LossPattern = {
        description: leg.description,
        line: legResult.line,
        actual_value: legResult.actualValue,
        miss_amount: legResult.actualValue && legResult.line 
          ? Math.abs(legResult.actualValue - legResult.line) 
          : undefined,
        sport,
        engine_source: engineSource,
        formula_name: formulaName,
        timestamp: new Date().toISOString()
      };
      lossPatterns.push(lossPattern);

      // Check for avoid pattern (3+ similar losses)
      await checkAndCreateAvoidPattern(supabase, lossPattern);
    }

    if (formula) {
      const newWins = formula.wins + (isWin ? 1 : 0);
      const newLosses = formula.losses + (isWin ? 0 : 1);
      const newTotal = formula.total_picks + 1;
      const newAccuracy = newTotal > 0 ? (newWins / newTotal) * 100 : 0;

      // Update sport breakdown
      const sportBreakdown = formula.sport_breakdown || {};
      if (!sportBreakdown[sport]) {
        sportBreakdown[sport] = { wins: 0, losses: 0, accuracy: 0 };
      }
      sportBreakdown[sport].wins += isWin ? 1 : 0;
      sportBreakdown[sport].losses += isWin ? 0 : 1;
      const sportTotal = sportBreakdown[sport].wins + sportBreakdown[sport].losses;
      sportBreakdown[sport].accuracy = sportTotal > 0 ? (sportBreakdown[sport].wins / sportTotal) * 100 : 0;

      // Update loss patterns
      const existingLossPatterns = formula.loss_patterns || [];
      const updatedLossPatterns = [
        ...existingLossPatterns,
        ...lossPatterns.filter(lp => lp.formula_name === formulaName)
      ].slice(-50); // Keep last 50 loss patterns

      await supabase
        .from('ai_formula_performance')
        .update({
          total_picks: newTotal,
          wins: newWins,
          losses: newLosses,
          current_accuracy: Math.round(newAccuracy * 100) / 100,
          last_win_streak: isWin ? (formula.last_win_streak + 1) : 0,
          last_loss_streak: isWin ? 0 : (formula.last_loss_streak + 1),
          sport_breakdown: sportBreakdown,
          loss_patterns: updatedLossPatterns
        })
        .eq('id', formula.id);

      console.log(`✅ Updated ${formulaName}: ${newAccuracy.toFixed(1)}% (${newWins}W-${newLosses}L)`);
    } else {
      // Create new formula entry
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
          sport_breakdown: { [sport]: { wins: isWin ? 1 : 0, losses: isWin ? 0 : 1, accuracy: isWin ? 100 : 0 } },
          loss_patterns: !isWin ? lossPatterns.filter(lp => lp.formula_name === formulaName) : []
        });
    }
  }

  // Update compound formulas
  await updateCompoundFormulaForParlay(supabase, parlay, isWin);

  // Update cross-engine performance
  await updateCrossEngineForParlay(supabase, parlay, isWin);

  // Update learning progress with parlay for pattern extraction
  await updateLearningProgress(supabase, isWin, parlay);

  // Instantly recalculate weights after each settlement
  await recalculateAllWeights(supabase);

  return new Response(JSON.stringify({
    success: true,
    parlay_id: parlayId,
    outcome,
    formulas_updated: legs.length,
    loss_patterns_recorded: lossPatterns.length
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Check and create avoid patterns based on repeated losses
async function checkAndCreateAvoidPattern(supabase: any, lossPattern: LossPattern) {
  const patternKey = `${lossPattern.formula_name}_${lossPattern.sport}`;
  
  // Check if pattern already exists
  const { data: existing } = await supabase
    .from('ai_avoid_patterns')
    .select('*')
    .eq('pattern_type', 'formula_sport')
    .eq('pattern_key', patternKey)
    .single();

  if (existing) {
    const newLossCount = existing.loss_count + 1;
    const newTotal = existing.total_count + 1;
    const newAccuracy = ((newTotal - newLossCount) / newTotal) * 100;

    await supabase
      .from('ai_avoid_patterns')
      .update({
        loss_count: newLossCount,
        total_count: newTotal,
        accuracy_rate: Math.round(newAccuracy * 100) / 100,
        last_loss_at: new Date().toISOString(),
        is_active: newLossCount >= 3 && newAccuracy < 40, // Activate avoid if 3+ losses and <40% accuracy
        avoid_reason: newLossCount >= 3 ? `${newLossCount} losses with ${newAccuracy.toFixed(1)}% accuracy` : null
      })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('ai_avoid_patterns')
      .insert({
        pattern_type: 'formula_sport',
        pattern_key: patternKey,
        description: lossPattern.description,
        sport: lossPattern.sport,
        engine_source: lossPattern.engine_source,
        formula_name: lossPattern.formula_name,
        loss_count: 1,
        total_count: 1,
        accuracy_rate: 0,
        last_loss_at: new Date().toISOString(),
        is_active: false
      });
  }
}

// Update compound formula tracking
async function updateCompoundFormulaForParlay(supabase: any, parlay: any, isWin: boolean) {
  const formulas = (parlay.legs || [])
    .map((l: any) => l.formula_name)
    .filter(Boolean)
    .sort()
    .join('+');
  
  if (!formulas) return;

  const { data: existing } = await supabase
    .from('ai_compound_formulas')
    .select('*')
    .eq('combination', formulas)
    .single();

  const sport = parlay.sport;

  if (existing) {
    const newWins = existing.wins + (isWin ? 1 : 0);
    const newLosses = existing.losses + (isWin ? 0 : 1);
    const newTotal = existing.total_picks + 1;
    const newAccuracy = (newWins / newTotal) * 100;
    
    const sports = existing.sports || [];
    if (!sports.includes(sport)) sports.push(sport);

    await supabase
      .from('ai_compound_formulas')
      .update({
        wins: newWins,
        losses: newLosses,
        total_picks: newTotal,
        accuracy_rate: Math.round(newAccuracy * 100) / 100,
        sports,
        last_win_at: isWin ? new Date().toISOString() : existing.last_win_at,
        last_loss_at: !isWin ? new Date().toISOString() : existing.last_loss_at,
        is_preferred: newAccuracy >= 55 && newTotal >= 5
      })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('ai_compound_formulas')
      .insert({
        combination: formulas,
        wins: isWin ? 1 : 0,
        losses: isWin ? 0 : 1,
        total_picks: 1,
        accuracy_rate: isWin ? 100 : 0,
        sports: [sport],
        last_win_at: isWin ? new Date().toISOString() : null,
        last_loss_at: !isWin ? new Date().toISOString() : null,
        is_preferred: false
      });
  }
}

// Update cross-engine performance tracking
async function updateCrossEngineForParlay(supabase: any, parlay: any, isWin: boolean) {
  const legs = parlay.legs || [];
  const engines = [...new Set(legs.map((l: any) => l.engine_source).filter(Boolean))] as string[];
  const sport = parlay.sport;

  // Compare each pair of engines
  for (let i = 0; i < engines.length; i++) {
    for (let j = i + 1; j < engines.length; j++) {
      const engineA = engines[i] < engines[j] ? engines[i] : engines[j];
      const engineB = engines[i] < engines[j] ? engines[j] : engines[i];

      const { data: existing } = await supabase
        .from('ai_cross_engine_performance')
        .select('*')
        .eq('engine_a', engineA)
        .eq('engine_b', engineB)
        .eq('sport', sport)
        .single();

      if (existing) {
        await supabase
          .from('ai_cross_engine_performance')
          .update({
            both_wins: existing.both_wins + (isWin ? 1 : 0),
            both_losses: existing.both_losses + (isWin ? 0 : 1),
            total_comparisons: existing.total_comparisons + 1,
            preference_score: ((existing.both_wins + (isWin ? 1 : 0)) / (existing.total_comparisons + 1)) * 100
          })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('ai_cross_engine_performance')
          .insert({
            engine_a: engineA,
            engine_b: engineB,
            sport,
            both_wins: isWin ? 1 : 0,
            both_losses: isWin ? 0 : 1,
            total_comparisons: 1,
            preference_score: isWin ? 100 : 0
          });
      }
    }
  }
}

// Update learning progress
async function updateLearningProgress(supabase: any, isWin: boolean, parlay?: any) {
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
    
    // Extract pattern from parlay for learned_patterns
    const learnedPatterns = progress.learned_patterns || { winning: [], losing: [] };
    
    if (parlay) {
      const patternDescription = extractPatternFromParlay(parlay);
      if (patternDescription) {
        if (isWin) {
          learnedPatterns.winning = [patternDescription, ...(learnedPatterns.winning || [])].slice(0, 20);
        } else {
          learnedPatterns.losing = [patternDescription, ...(learnedPatterns.losing || [])].slice(0, 20);
        }
      }
    }
    
    await supabase
      .from('ai_learning_progress')
      .update({
        parlays_settled: (progress.parlays_settled || 0) + 1,
        wins: newWins,
        losses: newLosses,
        current_accuracy: total > 0 ? Math.round((newWins / total) * 100 * 10) / 10 : 0,
        learned_patterns: learnedPatterns
      })
      .eq('id', progress.id);
  }
}

// Extract pattern description from a parlay
function extractPatternFromParlay(parlay: any): string | null {
  if (!parlay) return null;
  
  const legs = parlay.legs || [];
  const strategy = parlay.strategy_used || 'unknown';
  const sport = parlay.sport || 'mixed';
  const sourceEngines = parlay.source_engines || [];
  const signals = parlay.signals_used || [];
  
  // Build pattern description
  const legDescriptions = legs.slice(0, 3).map((leg: any) => {
    const formula = leg.formula_name || leg.description?.split(' ')[0] || 'pick';
    return formula;
  }).join(' + ');
  
  const engineStr = sourceEngines.length > 0 ? sourceEngines.join('/') : 'ai';
  const signalStr = signals.length > 0 ? signals.slice(0, 2).join(', ') : '';
  
  let pattern = `[${sport.toUpperCase()}] ${strategy} - ${legDescriptions}`;
  if (engineStr) pattern += ` (${engineStr})`;
  if (signalStr) pattern += ` | Signals: ${signalStr}`;
  
  return pattern;
}

// Sync learning progress from all settled parlays
async function syncLearningProgressFromSettled(supabase: any) {
  console.log('🔄 Syncing learning progress from settled parlays...');
  
  // Get accurate counts using count queries first
  const { count: wonCount, error: wonCountError } = await supabase
    .from('ai_generated_parlays')
    .select('*', { count: 'exact', head: true })
    .eq('outcome', 'won');
  
  const { count: lostCount, error: lostCountError } = await supabase
    .from('ai_generated_parlays')
    .select('*', { count: 'exact', head: true })
    .eq('outcome', 'lost');
  
  if (wonCountError || lostCountError) {
    console.error('Error counting settled parlays:', wonCountError || lostCountError);
    return { success: false, error: 'Failed to count settled parlays' };
  }
  
  const totalWins = wonCount || 0;
  const totalLosses = lostCount || 0;
  const totalSettled = totalWins + totalLosses;
  
  console.log(`📊 Found ${totalWins} wins, ${totalLosses} losses from database`);
  
  // Fetch recent parlays for pattern extraction (limit 30 each for patterns)
  const { data: wonParlays } = await supabase
    .from('ai_generated_parlays')
    .select('*')
    .eq('outcome', 'won')
    .order('settled_at', { ascending: false })
    .limit(30);
  
  const { data: lostParlays } = await supabase
    .from('ai_generated_parlays')
    .select('*')
    .eq('outcome', 'lost')
    .order('settled_at', { ascending: false })
    .limit(30);
  
  // Extract patterns from recent settled parlays
  const winningPatterns: string[] = [];
  const losingPatterns: string[] = [];
  
  for (const parlay of (wonParlays || []).slice(0, 20)) {
    const pattern = extractPatternFromParlay(parlay);
    if (pattern) winningPatterns.push(pattern);
  }
  
  for (const parlay of (lostParlays || []).slice(0, 20)) {
    const pattern = extractPatternFromParlay(parlay);
    if (pattern) losingPatterns.push(pattern);
  }
  
  // Get latest learning progress entry
  const { data: latestProgress } = await supabase
    .from('ai_learning_progress')
    .select('*')
    .order('generation_round', { ascending: false })
    .limit(1);
  
  const learnedPatterns = {
    winning: winningPatterns,
    losing: losingPatterns
  };
  
  const accuracy = totalSettled > 0 ? Math.round((totalWins / totalSettled) * 100 * 10) / 10 : 0;
  
  if (latestProgress && latestProgress.length > 0) {
    // Update existing progress
    await supabase
      .from('ai_learning_progress')
      .update({
        wins: totalWins,
        losses: totalLosses,
        parlays_settled: totalSettled,
        current_accuracy: accuracy,
        learned_patterns: learnedPatterns
      })
      .eq('id', latestProgress[0].id);
    
    console.log(`✅ Updated learning progress: ${totalWins}W-${totalLosses}L (${accuracy}%)`);
    console.log(`📚 Synced ${winningPatterns.length} winning patterns, ${losingPatterns.length} losing patterns`);
  } else {
    // Create new progress entry if none exists
    await supabase
      .from('ai_learning_progress')
      .insert({
        generation_round: 1,
        wins: totalWins,
        losses: totalLosses,
        parlays_settled: totalSettled,
        parlays_generated: totalSettled,
        current_accuracy: accuracy,
        learned_patterns: learnedPatterns,
        target_accuracy: 65,
        is_milestone: false
      });
    
    console.log(`✅ Created new learning progress: ${totalWins}W-${totalLosses}L (${accuracy}%)`);
  }
  
  return {
    success: true,
    wins: totalWins,
    losses: totalLosses,
    accuracy,
    winning_patterns: winningPatterns.length,
    losing_patterns: losingPatterns.length
  };
}

// Original processSettlement function
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
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
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

  // Update compound formulas
  await updateCompoundFormulaForParlay(supabase, parlay, isWin);

  // Update learning progress with parlay for pattern extraction
  await updateLearningProgress(supabase, isWin, parlay);

  return new Response(JSON.stringify({
    success: true,
    parlay_id: parlayId,
    outcome,
    formulas_updated: legs.length
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
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

    // Update compound formulas
    await updateCompoundFormulaForParlay(supabase, parlay, isWin);

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
    if (formula.total_picks < 3) continue;

    const accuracy = formula.current_accuracy;
    let newWeight = 1.0;

    // Weight based on accuracy
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

    // Streak adjustments
    if (formula.last_win_streak >= 5) {
      newWeight *= 1.15;
    } else if (formula.last_win_streak >= 3) {
      newWeight *= 1.08;
    }
    
    if (formula.last_loss_streak >= 5) {
      newWeight *= 0.75;
    } else if (formula.last_loss_streak >= 3) {
      newWeight *= 0.88;
    }

    // Sample size confidence
    const sampleConfidence = Math.min(1, formula.total_picks / 30);
    newWeight = 1.0 + (newWeight - 1.0) * sampleConfidence;
    newWeight = Math.max(0.2, Math.min(2.5, newWeight));
    newWeight = Math.round(newWeight * 100) / 100;

    if (Math.abs(newWeight - formula.current_weight) > 0.03) {
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

// Update compound formulas based on historical data
async function updateCompoundFormulas(supabase: any) {
  console.log('🔬 Updating compound formulas');

  const { data: winningParlays } = await supabase
    .from('ai_generated_parlays')
    .select('*')
    .eq('outcome', 'won');

  const { data: losingParlays } = await supabase
    .from('ai_generated_parlays')
    .select('*')
    .eq('outcome', 'lost');

  const combinations: Record<string, { wins: number; losses: number; sports: Set<string> }> = {};

  for (const parlay of winningParlays || []) {
    const formulas = (parlay.legs || [])
      .map((l: any) => l.formula_name)
      .filter(Boolean)
      .sort()
      .join('+');
    
    if (formulas) {
      if (!combinations[formulas]) combinations[formulas] = { wins: 0, losses: 0, sports: new Set() };
      combinations[formulas].wins++;
      combinations[formulas].sports.add(parlay.sport);
    }
  }

  for (const parlay of losingParlays || []) {
    const formulas = (parlay.legs || [])
      .map((l: any) => l.formula_name)
      .filter(Boolean)
      .sort()
      .join('+');
    
    if (formulas) {
      if (!combinations[formulas]) combinations[formulas] = { wins: 0, losses: 0, sports: new Set() };
      combinations[formulas].losses++;
      combinations[formulas].sports.add(parlay.sport);
    }
  }

  let updated = 0;
  for (const [combo, stats] of Object.entries(combinations)) {
    const total = stats.wins + stats.losses;
    if (total >= 3) {
      const accuracy = (stats.wins / total) * 100;
      
      await supabase
        .from('ai_compound_formulas')
        .upsert({
          combination: combo,
          wins: stats.wins,
          losses: stats.losses,
          total_picks: total,
          accuracy_rate: Math.round(accuracy * 100) / 100,
          sports: Array.from(stats.sports),
          is_preferred: accuracy >= 55 && total >= 5
        }, { onConflict: 'combination' });
      
      updated++;
    }
  }

  console.log(`📊 Updated ${updated} compound formulas`);
  return { combinations_updated: updated };
}

// Discover compound formula combinations (legacy)
async function discoverCompoundFormulas(supabase: any) {
  return await updateCompoundFormulas(supabase);
}

// Update avoid patterns based on loss analysis
async function updateAvoidPatterns(supabase: any) {
  console.log('🚫 Updating avoid patterns');

  const { data: formulas } = await supabase
    .from('ai_formula_performance')
    .select('*')
    .not('loss_patterns', 'is', null);

  let patternsUpdated = 0;

  for (const formula of formulas || []) {
    const lossPatterns = formula.loss_patterns || [];
    if (lossPatterns.length < 3) continue;

    // Group losses by sport
    const sportLosses: Record<string, number> = {};
    for (const pattern of lossPatterns) {
      const sport = pattern.sport || 'unknown';
      sportLosses[sport] = (sportLosses[sport] || 0) + 1;
    }

    // Create avoid patterns for sports with 3+ losses
    for (const [sport, count] of Object.entries(sportLosses)) {
      if (count >= 3) {
        const patternKey = `${formula.formula_name}_${sport}`;
        const accuracy = formula.current_accuracy || 0;
        
        await supabase
          .from('ai_avoid_patterns')
          .upsert({
            pattern_type: 'formula_sport',
            pattern_key: patternKey,
            description: `${formula.formula_name} in ${sport}`,
            sport,
            engine_source: formula.engine_source,
            formula_name: formula.formula_name,
            loss_count: count,
            total_count: formula.total_picks,
            accuracy_rate: accuracy,
            is_active: count >= 3 && accuracy < 45,
            avoid_reason: `${count} losses in ${sport} with ${accuracy.toFixed(1)}% accuracy`
          }, { onConflict: 'pattern_type,pattern_key' });
        
        patternsUpdated++;
      }
    }
  }

  // Deactivate old patterns that have improved
  const { data: activePatterns } = await supabase
    .from('ai_avoid_patterns')
    .select('*')
    .eq('is_active', true);

  for (const pattern of activePatterns || []) {
    const { data: formula } = await supabase
      .from('ai_formula_performance')
      .select('current_accuracy')
      .eq('formula_name', pattern.formula_name)
      .eq('engine_source', pattern.engine_source)
      .single();

    if (formula && formula.current_accuracy >= 50) {
      await supabase
        .from('ai_avoid_patterns')
        .update({ is_active: false, avoid_reason: 'Performance improved' })
        .eq('id', pattern.id);
    }
  }

  console.log(`🚫 Updated ${patternsUpdated} avoid patterns`);
  return { patterns_updated: patternsUpdated };
}

// Analyze cross-engine performance
async function analyzeCrossEnginePerformance(supabase: any) {
  console.log('🔄 Analyzing cross-engine performance');

  const { data: parlays } = await supabase
    .from('ai_generated_parlays')
    .select('*')
    .in('outcome', ['won', 'lost']);

  const crossEngine: Record<string, { wins: number; losses: number; sport: string }> = {};

  for (const parlay of parlays || []) {
    const legs = parlay.legs || [];
    const engines = [...new Set(legs.map((l: any) => l.engine_source).filter(Boolean))] as string[];
    const isWin = parlay.outcome === 'won';
    const sport = parlay.sport;

    for (let i = 0; i < engines.length; i++) {
      for (let j = i + 1; j < engines.length; j++) {
        const key = [engines[i], engines[j]].sort().join('_') + '_' + sport;
        if (!crossEngine[key]) crossEngine[key] = { wins: 0, losses: 0, sport };
        crossEngine[key].wins += isWin ? 1 : 0;
        crossEngine[key].losses += isWin ? 0 : 1;
      }
    }
  }

  let updated = 0;
  for (const [key, stats] of Object.entries(crossEngine)) {
    const [engineA, engineB, sport] = key.split('_');
    const total = stats.wins + stats.losses;
    if (total >= 3) {
      await supabase
        .from('ai_cross_engine_performance')
        .upsert({
          engine_a: engineA,
          engine_b: engineB,
          sport: stats.sport,
          both_wins: stats.wins,
          both_losses: stats.losses,
          total_comparisons: total,
          preference_score: Math.round((stats.wins / total) * 100 * 100) / 100
        }, { onConflict: 'engine_a,engine_b,event_type,sport' });
      updated++;
    }
  }

  console.log(`🔄 Updated ${updated} cross-engine records`);
  return { cross_engine_updated: updated };
}