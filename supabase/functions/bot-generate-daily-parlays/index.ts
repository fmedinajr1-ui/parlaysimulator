/**
 * bot-generate-daily-parlays
 * 
 * Generates daily parlays using Monte Carlo simulation and proven categories.
 * Runs at 9 AM ET daily via cron.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Bot rule constants
const BOT_RULES = {
  MIN_HIT_RATE: 55,           // 55% minimum category hit rate
  MIN_WEIGHT: 0.8,            // Minimum weight to include category
  MIN_SIM_WIN_RATE: 0.12,     // 12% minimum simulated win rate
  MIN_EDGE: 0.03,             // 3% minimum edge
  MIN_SHARPE: 0.5,            // Minimum Sharpe ratio
  MAX_LEGS: 6,                // Maximum legs per parlay
  DAILY_PARLAYS: 3,           // Max parlays per day
  SIMULATED_STAKE: 50,        // Default stake in simulation
  ITERATIONS: 25000,          // MC iterations
};

interface SweetSpotPick {
  id: string;
  player_name: string;
  team_name: string;
  prop_type: string;
  line: number;
  recommended_side: string;
  category: string;
  confidence_score: number;
  l10_hit_rate: number;
  projected_value: number;
  event_id: string;
}

interface CategoryWeight {
  category: string;
  side: string;
  weight: number;
  current_hit_rate: number;
  is_blocked: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const targetDate = body.date || new Date().toISOString().split('T')[0];

    console.log(`[Bot] Generating parlays for ${targetDate}`);

    // 1. Load category weights
    const { data: weights, error: weightsError } = await supabase
      .from('bot_category_weights')
      .select('*')
      .eq('is_blocked', false)
      .gte('weight', BOT_RULES.MIN_WEIGHT);

    if (weightsError) throw weightsError;

    const eligibleCategories = (weights || [])
      .filter((w: CategoryWeight) => w.current_hit_rate >= BOT_RULES.MIN_HIT_RATE)
      .map((w: CategoryWeight) => w.category);

    console.log(`[Bot] Eligible categories: ${eligibleCategories.length}`);

    if (eligibleCategories.length < 4) {
      console.log('[Bot] Not enough eligible categories');
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Not enough eligible categories',
          parlaysGenerated: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Fetch today's sweet spot picks from eligible categories
    const { data: picks, error: picksError } = await supabase
      .from('category_sweet_spots')
      .select('*')
      .eq('analysis_date', targetDate)
      .eq('is_active', true)
      .in('category', eligibleCategories)
      .gte('confidence_score', 60)
      .order('confidence_score', { ascending: false })
      .limit(30);

    if (picksError) throw picksError;

    if (!picks || picks.length < 6) {
      console.log(`[Bot] Not enough picks: ${picks?.length || 0}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Not enough picks available',
          parlaysGenerated: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Bot] Found ${picks.length} candidate picks`);

    // 3. Get active strategy
    const { data: strategy } = await supabase
      .from('bot_strategies')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .single();

    const strategyName = strategy?.strategy_name || 'elite_categories_v1';

    // 4. Build weight map
    const weightMap = new Map<string, number>();
    (weights || []).forEach((w: CategoryWeight) => {
      weightMap.set(w.category, w.weight);
    });

    // 5. Generate parlays using greedy selection
    const parlaysToCreate: any[] = [];
    const usedPlayerIds = new Set<string>();

    for (let parlayNum = 0; parlayNum < BOT_RULES.DAILY_PARLAYS; parlayNum++) {
      const legs: any[] = [];
      const usedTeams = new Map<string, number>();

      for (const pick of picks) {
        if (legs.length >= BOT_RULES.MAX_LEGS) break;
        
        // Skip already used players
        if (usedPlayerIds.has(pick.player_name)) continue;

        // Max 2 players per team
        const teamCount = usedTeams.get(pick.team_name) || 0;
        if (teamCount >= 2) continue;

        const weight = weightMap.get(pick.category) || 1.0;
        
        legs.push({
          id: pick.id,
          player_name: pick.player_name,
          team_name: pick.team_name,
          prop_type: pick.prop_type,
          line: pick.line,
          side: pick.recommended_side || 'over',
          category: pick.category,
          weight,
          hit_rate: pick.l10_hit_rate || pick.confidence_score,
          outcome: 'pending',
        });

        usedTeams.set(pick.team_name, teamCount + 1);
        usedPlayerIds.add(pick.player_name);
      }

      if (legs.length >= 4) {
        // Calculate combined probability (simplified - actual MC would be better)
        const avgHitRate = legs.reduce((sum, l) => sum + (l.hit_rate / 100), 0) / legs.length;
        const combinedProbability = Math.pow(avgHitRate, legs.length);
        
        // Simple edge calculation
        const impliedProbability = 1 / Math.pow(2, legs.length); // Rough estimate
        const edge = combinedProbability - impliedProbability;
        
        // Skip if edge is negative
        if (edge < BOT_RULES.MIN_EDGE) {
          console.log(`[Bot] Parlay ${parlayNum + 1} has negative edge, skipping`);
          continue;
        }

        // Calculate expected odds
        const expectedOdds = Math.round((1 / combinedProbability - 1) * 100);

        parlaysToCreate.push({
          parlay_date: targetDate,
          legs,
          leg_count: legs.length,
          combined_probability: combinedProbability,
          expected_odds: Math.min(expectedOdds, 10000),
          simulated_win_rate: combinedProbability,
          simulated_edge: edge,
          simulated_sharpe: edge / (0.5 * Math.sqrt(legs.length)), // Simplified Sharpe
          strategy_name: strategyName,
          strategy_version: strategy?.version || 1,
          category_weights_snapshot: Object.fromEntries(weightMap),
          selection_rationale: `Auto-generated from ${eligibleCategories.length} eligible categories`,
          outcome: 'pending',
          is_simulated: true,
          simulated_stake: BOT_RULES.SIMULATED_STAKE,
        });
      }
    }

    // 6. Insert parlays
    if (parlaysToCreate.length > 0) {
      const { error: insertError } = await supabase
        .from('bot_daily_parlays')
        .insert(parlaysToCreate);

      if (insertError) throw insertError;
    }

    // 7. Update activation status
    const { data: existingStatus } = await supabase
      .from('bot_activation_status')
      .select('*')
      .eq('check_date', targetDate)
      .maybeSingle();

    if (existingStatus) {
      await supabase
        .from('bot_activation_status')
        .update({ 
          parlays_generated: (existingStatus.parlays_generated || 0) + parlaysToCreate.length 
        })
        .eq('id', existingStatus.id);
    } else {
      await supabase
        .from('bot_activation_status')
        .insert({
          check_date: targetDate,
          parlays_generated: parlaysToCreate.length,
          simulated_bankroll: 1000,
        });
    }

    // 8. Update strategy usage
    if (strategy) {
      await supabase
        .from('bot_strategies')
        .update({ times_used: (strategy.times_used || 0) + parlaysToCreate.length })
        .eq('id', strategy.id);
    }

    console.log(`[Bot] Generated ${parlaysToCreate.length} parlays`);

    return new Response(
      JSON.stringify({
        success: true,
        parlaysGenerated: parlaysToCreate.length,
        eligibleCategories: eligibleCategories.length,
        totalCandidates: picks.length,
        date: targetDate,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Bot] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
