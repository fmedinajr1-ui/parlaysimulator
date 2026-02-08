/**
 * bot-evolve-strategies
 * 
 * Weekly strategy evolution - retires underperforming strategies,
 * boosts successful ones, and generates new variants.
 * Runs Sunday 11 PM ET via cron.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Evolution thresholds
const RETIRE_THRESHOLD = 0.40;  // Retire strategies below 40% win rate
const BOOST_THRESHOLD = 0.65;   // Boost strategies above 65% win rate
const MIN_USES_FOR_EVAL = 20;   // Minimum uses before evaluating

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[Bot Evolution] Starting weekly strategy evolution');

    // 1. Get all active strategies with enough usage
    const { data: strategies, error: strategiesError } = await supabase
      .from('bot_strategies')
      .select('*')
      .eq('is_active', true)
      .gte('times_used', MIN_USES_FOR_EVAL);

    if (strategiesError) throw strategiesError;

    const evolutionLog: any[] = [];
    let strategiesRetired = 0;
    let strategiesBoosted = 0;
    let strategiesCreated = 0;

    for (const strategy of strategies || []) {
      const winRate = strategy.win_rate || 0;

      if (winRate < RETIRE_THRESHOLD) {
        // Retire underperforming strategy
        await supabase
          .from('bot_strategies')
          .update({
            is_active: false,
            retired_at: new Date().toISOString(),
            retire_reason: `Win rate ${(winRate * 100).toFixed(1)}% below ${RETIRE_THRESHOLD * 100}% threshold`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', strategy.id);

        // Create mutated variant
        const rules = typeof strategy.rules === 'string' 
          ? JSON.parse(strategy.rules) 
          : strategy.rules;

        const mutatedRules = {
          ...rules,
          min_hit_rate: Math.min(0.60, (rules.min_hit_rate || 0.55) + 0.02),
          min_weight: Math.min(0.90, (rules.min_weight || 0.80) + 0.05),
          min_edge: Math.min(0.05, (rules.min_edge || 0.03) + 0.005),
        };

        const newStrategyName = `${strategy.strategy_name}_evolved_v${(strategy.version || 1) + 1}`;

        await supabase
          .from('bot_strategies')
          .insert({
            strategy_name: newStrategyName,
            rules: mutatedRules,
            description: `Evolved from ${strategy.strategy_name} with stricter thresholds`,
            is_active: true,
            auto_generated: true,
            parent_strategy: strategy.strategy_name,
            version: (strategy.version || 1) + 1,
          });

        evolutionLog.push({
          action: 'retire_and_evolve',
          original: strategy.strategy_name,
          new: newStrategyName,
          reason: `Win rate ${(winRate * 100).toFixed(1)}% too low`,
        });

        strategiesRetired++;
        strategiesCreated++;

      } else if (winRate >= BOOST_THRESHOLD) {
        // Boost successful strategy - increase weight for its categories
        const rules = typeof strategy.rules === 'string' 
          ? JSON.parse(strategy.rules) 
          : strategy.rules;

        // Could add logic here to boost categories that this strategy uses most
        evolutionLog.push({
          action: 'boost',
          strategy: strategy.strategy_name,
          winRate: (winRate * 100).toFixed(1) + '%',
        });

        strategiesBoosted++;
      }
    }

    // 2. Analyze recent parlay performance for new patterns
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

    const { data: recentParlays } = await supabase
      .from('bot_daily_parlays')
      .select('*')
      .gte('parlay_date', sevenDaysAgoStr)
      .neq('outcome', 'pending');

    if (recentParlays && recentParlays.length > 0) {
      // Analyze winning patterns
      const winningParlays = recentParlays.filter(p => p.outcome === 'won');
      
      if (winningParlays.length >= 3) {
        // Find common categories in winning parlays
        const categoryFrequency = new Map<string, number>();
        
        for (const parlay of winningParlays) {
          const legs = Array.isArray(parlay.legs) ? parlay.legs : JSON.parse(parlay.legs);
          for (const leg of legs) {
            const count = categoryFrequency.get(leg.category) || 0;
            categoryFrequency.set(leg.category, count + 1);
          }
        }

        // Sort by frequency
        const topCategories = [...categoryFrequency.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([cat]) => cat);

        if (topCategories.length >= 3) {
          evolutionLog.push({
            action: 'pattern_detected',
            topCategories,
            winningParlays: winningParlays.length,
          });
        }
      }
    }

    // 3. Log evolution results
    console.log(`[Bot Evolution] Complete:
      - Strategies retired: ${strategiesRetired}
      - Strategies boosted: ${strategiesBoosted}
      - New strategies created: ${strategiesCreated}
    `);

    return new Response(
      JSON.stringify({
        success: true,
        strategiesRetired,
        strategiesBoosted,
        strategiesCreated,
        evolutionLog,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Bot Evolution] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
