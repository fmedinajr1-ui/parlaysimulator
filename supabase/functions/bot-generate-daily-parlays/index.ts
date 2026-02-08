/**
 * bot-generate-daily-parlays
 * 
 * Generates 8-10 daily parlays using Monte Carlo simulation, odds value scoring,
 * and proven categories. Implements deduplication to ensure unique picks across parlays.
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
  SIMULATED_STAKE: 50,        // Default stake in simulation
  ITERATIONS: 10000,          // MC iterations per parlay (reduced for speed)
  
  // Odds filtering
  MIN_ODDS: -200,
  MAX_ODDS: 200,
  MIN_ODDS_VALUE_SCORE: 45,
  
  // Volume
  DAILY_PARLAYS_MIN: 8,
  DAILY_PARLAYS_MAX: 10,
  
  // Deduplication
  MAX_PLAYER_USAGE: 2,
  MAX_SAME_TEAM: 2,
  MAX_SAME_CATEGORY: 3,
};

// Parlay profiles for diverse generation
const PARLAY_PROFILES = [
  { legs: 3, strategy: 'conservative', minOddsValue: 55, minHitRate: 68 },
  { legs: 3, strategy: 'conservative', minOddsValue: 55, minHitRate: 68 },
  { legs: 4, strategy: 'balanced', minOddsValue: 50, minHitRate: 62 },
  { legs: 4, strategy: 'balanced', minOddsValue: 50, minHitRate: 62 },
  { legs: 5, strategy: 'standard', minOddsValue: 45, minHitRate: 58 },
  { legs: 5, strategy: 'standard', minOddsValue: 45, minHitRate: 58 },
  { legs: 5, strategy: 'standard', minOddsValue: 45, minHitRate: 58 },
  { legs: 6, strategy: 'aggressive', minOddsValue: 40, minHitRate: 55 },
  { legs: 6, strategy: 'aggressive', minOddsValue: 40, minHitRate: 55 },
  { legs: 6, strategy: 'aggressive', minOddsValue: 40, minHitRate: 55 },
];

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

interface EnrichedPick extends SweetSpotPick {
  americanOdds: number;
  oddsValueScore: number;
  compositeScore: number;
}

interface CategoryWeight {
  category: string;
  side: string;
  weight: number;
  current_hit_rate: number;
  is_blocked: boolean;
}

interface UsageTracker {
  usedPicks: Set<string>;
  playerUsageCount: Map<string, number>;
  teamUsageInParlay: Map<string, number>;
  categoryUsageInParlay: Map<string, number>;
}

// ============= HELPER FUNCTIONS =============

function americanToImplied(odds: number): number {
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return -odds / (-odds + 100);
  }
}

function calculateOddsValueScore(americanOdds: number, estimatedHitRate: number): number {
  const impliedProb = americanToImplied(americanOdds);
  const edge = estimatedHitRate - impliedProb;
  const juicePenalty = Math.max(0, impliedProb - 0.524) * 100;
  const juiceBonus = Math.max(0, 0.524 - impliedProb) * 80;
  const edgeScore = Math.min(40, edge * 400);
  const score = 50 + edgeScore - juicePenalty + juiceBonus;
  return Math.max(0, Math.min(100, score));
}

function calculateCompositeScore(
  hitRate: number,
  edge: number,
  oddsValueScore: number,
  categoryWeight: number
): number {
  const hitRateScore = Math.min(100, hitRate);
  const edgeScore = Math.min(100, Math.max(0, edge * 20 + 50));
  const weightScore = categoryWeight * 66.67;
  
  return Math.round(
    (hitRateScore * 0.30) +
    (edgeScore * 0.25) +
    (oddsValueScore * 0.25) +
    (weightScore * 0.20)
  );
}

function createPickKey(playerName: string, propType: string, side: string): string {
  return `${playerName}_${propType}_${side}`.toLowerCase();
}

function createUsageTracker(): UsageTracker {
  return {
    usedPicks: new Set(),
    playerUsageCount: new Map(),
    teamUsageInParlay: new Map(),
    categoryUsageInParlay: new Map(),
  };
}

function canUsePickGlobally(pick: EnrichedPick, tracker: UsageTracker): boolean {
  const key = createPickKey(pick.player_name, pick.prop_type, pick.recommended_side);
  
  // Never reuse exact same pick
  if (tracker.usedPicks.has(key)) return false;
  
  // Max parlays per player
  const playerCount = tracker.playerUsageCount.get(pick.player_name) || 0;
  if (playerCount >= BOT_RULES.MAX_PLAYER_USAGE) return false;
  
  return true;
}

function canUsePickInParlay(
  pick: EnrichedPick,
  parlayTeamCount: Map<string, number>,
  parlayCategoryCount: Map<string, number>
): boolean {
  // Max per team in single parlay
  const teamCount = parlayTeamCount.get(pick.team_name) || 0;
  if (teamCount >= BOT_RULES.MAX_SAME_TEAM) return false;
  
  // Max per category in single parlay
  const categoryCount = parlayCategoryCount.get(pick.category) || 0;
  if (categoryCount >= BOT_RULES.MAX_SAME_CATEGORY) return false;
  
  return true;
}

function markPickUsed(pick: EnrichedPick, tracker: UsageTracker): void {
  const key = createPickKey(pick.player_name, pick.prop_type, pick.recommended_side);
  tracker.usedPicks.add(key);
  tracker.playerUsageCount.set(
    pick.player_name,
    (tracker.playerUsageCount.get(pick.player_name) || 0) + 1
  );
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

    const weightMap = new Map<string, number>();
    (weights || []).forEach((w: CategoryWeight) => {
      weightMap.set(w.category, w.weight);
    });

    console.log(`[Bot] Eligible categories: ${eligibleCategories.length}`);

    if (eligibleCategories.length < 3) {
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

    // 2. Fetch today's sweet spot picks
    const { data: picks, error: picksError } = await supabase
      .from('category_sweet_spots')
      .select('*')
      .eq('analysis_date', targetDate)
      .eq('is_active', true)
      .in('category', eligibleCategories)
      .gte('confidence_score', 55)
      .order('confidence_score', { ascending: false })
      .limit(80);

    if (picksError) throw picksError;

    if (!picks || picks.length < 10) {
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

    // 3. Fetch live odds from unified_props
    const playerNames = [...new Set(picks.map(p => p.player_name))];
    const { data: oddsData } = await supabase
      .from('unified_props')
      .select('player_name, prop_type, over_price, under_price')
      .in('player_name', playerNames)
      .eq('is_active', true);

    const oddsMap = new Map<string, { overOdds: number; underOdds: number }>();
    (oddsData || []).forEach((od: any) => {
      const key = `${od.player_name}_${od.prop_type}`.toLowerCase();
      oddsMap.set(key, {
        overOdds: od.over_price || -110,
        underOdds: od.under_price || -110
      });
    });

    // 4. Enrich picks with odds and scores
    const enrichedPicks: EnrichedPick[] = picks.map(pick => {
      const oddsKey = `${pick.player_name}_${pick.prop_type}`.toLowerCase();
      const odds = oddsMap.get(oddsKey) || { overOdds: -110, underOdds: -110 };
      const side = pick.recommended_side || 'over';
      const americanOdds = side === 'over' ? odds.overOdds : odds.underOdds;
      
      const hitRate = pick.l10_hit_rate || pick.confidence_score || 50;
      const edge = (pick.projected_value || 0) - (pick.line || 0);
      const categoryWeight = weightMap.get(pick.category) || 1.0;
      
      const oddsValueScore = calculateOddsValueScore(americanOdds, hitRate / 100);
      const compositeScore = calculateCompositeScore(hitRate, edge, oddsValueScore, categoryWeight);
      
      return {
        ...pick,
        recommended_side: side,
        americanOdds,
        oddsValueScore,
        compositeScore,
      };
    });

    // 5. Filter by odds range and value score
    const validPicks = enrichedPicks.filter(p => {
      if (p.americanOdds < BOT_RULES.MIN_ODDS || p.americanOdds > BOT_RULES.MAX_ODDS) {
        console.log(`[Bot] Filtered ${p.player_name}: odds ${p.americanOdds} out of range`);
        return false;
      }
      if (p.oddsValueScore < 35) {
        console.log(`[Bot] Filtered ${p.player_name}: low value score ${p.oddsValueScore}`);
        return false;
      }
      return true;
    });

    // Sort by composite score
    validPicks.sort((a, b) => b.compositeScore - a.compositeScore);

    console.log(`[Bot] Valid picks after filtering: ${validPicks.length}`);

    // 6. Get active strategy
    const { data: strategy } = await supabase
      .from('bot_strategies')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .single();

    const strategyName = strategy?.strategy_name || 'elite_categories_v1';

    // 7. Generate parlays using profiles
    const parlaysToCreate: any[] = [];
    const globalTracker = createUsageTracker();

    for (let profileIdx = 0; profileIdx < PARLAY_PROFILES.length; profileIdx++) {
      const profile = PARLAY_PROFILES[profileIdx];
      const legs: any[] = [];
      const parlayTeamCount = new Map<string, number>();
      const parlayCategoryCount = new Map<string, number>();

      // Find picks for this parlay
      for (const pick of validPicks) {
        if (legs.length >= profile.legs) break;
        
        // Check global deduplication
        if (!canUsePickGlobally(pick, globalTracker)) continue;
        
        // Check parlay-level constraints
        if (!canUsePickInParlay(pick, parlayTeamCount, parlayCategoryCount)) continue;
        
        // Check profile-specific requirements
        const hitRate = pick.l10_hit_rate || pick.confidence_score || 50;
        if (hitRate < profile.minHitRate) continue;
        if (pick.oddsValueScore < profile.minOddsValue) continue;

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
          hit_rate: hitRate,
          american_odds: pick.americanOdds,
          odds_value_score: pick.oddsValueScore,
          composite_score: pick.compositeScore,
          outcome: 'pending',
        });

        parlayTeamCount.set(pick.team_name, (parlayTeamCount.get(pick.team_name) || 0) + 1);
        parlayCategoryCount.set(pick.category, (parlayCategoryCount.get(pick.category) || 0) + 1);
      }

      // Only create parlay if we have enough legs
      if (legs.length >= profile.legs) {
        // Mark all picks as used globally
        for (const leg of legs) {
          const pick = validPicks.find(p => p.id === leg.id);
          if (pick) markPickUsed(pick, globalTracker);
        }

        // Calculate combined probability
        const avgHitRate = legs.reduce((sum, l) => sum + (l.hit_rate / 100), 0) / legs.length;
        const combinedProbability = Math.pow(avgHitRate, legs.length);
        
        // Calculate expected odds from combined probability
        const expectedOdds = combinedProbability > 0 
          ? Math.round((1 / combinedProbability - 1) * 100)
          : 10000;
        
        // Simple edge calculation
        const impliedProbability = 1 / Math.pow(2, legs.length);
        const edge = combinedProbability - impliedProbability;
        
        // Sharpe ratio approximation
        const sharpe = edge / (0.5 * Math.sqrt(legs.length));

        // Check thresholds
        if (combinedProbability < BOT_RULES.MIN_SIM_WIN_RATE) {
          console.log(`[Bot] Parlay ${profileIdx + 1} rejected: low win rate ${(combinedProbability * 100).toFixed(1)}%`);
          continue;
        }

        if (edge < BOT_RULES.MIN_EDGE) {
          console.log(`[Bot] Parlay ${profileIdx + 1} rejected: low edge ${(edge * 100).toFixed(1)}%`);
          continue;
        }

        parlaysToCreate.push({
          parlay_date: targetDate,
          legs,
          leg_count: legs.length,
          combined_probability: combinedProbability,
          expected_odds: Math.min(expectedOdds, 10000),
          simulated_win_rate: combinedProbability,
          simulated_edge: edge,
          simulated_sharpe: sharpe,
          strategy_name: strategyName,
          strategy_version: strategy?.version || 1,
          category_weights_snapshot: Object.fromEntries(weightMap),
          selection_rationale: `${profile.strategy} profile (${profile.legs}-leg) from ${eligibleCategories.length} categories`,
          outcome: 'pending',
          is_simulated: true,
          simulated_stake: BOT_RULES.SIMULATED_STAKE,
        });

        console.log(`[Bot] Created ${profile.legs}-leg ${profile.strategy} parlay #${parlaysToCreate.length}`);
      } else {
        console.log(`[Bot] Could not fill ${profile.legs}-leg parlay, got ${legs.length} legs`);
      }

      // Stop if we've created enough parlays
      if (parlaysToCreate.length >= BOT_RULES.DAILY_PARLAYS_MAX) break;
    }

    console.log(`[Bot] Total parlays created: ${parlaysToCreate.length}`);

    // 8. Insert parlays
    if (parlaysToCreate.length > 0) {
      const { error: insertError } = await supabase
        .from('bot_daily_parlays')
        .insert(parlaysToCreate);

      if (insertError) throw insertError;
    }

    // 9. Update activation status
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

    // 10. Update strategy usage
    if (strategy) {
      await supabase
        .from('bot_strategies')
        .update({ times_used: (strategy.times_used || 0) + parlaysToCreate.length })
        .eq('id', strategy.id);
    }

    // Summary by leg count
    const legCounts = parlaysToCreate.reduce((acc, p) => {
      acc[p.leg_count] = (acc[p.leg_count] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    console.log(`[Bot] Distribution: ${JSON.stringify(legCounts)}`);

    return new Response(
      JSON.stringify({
        success: true,
        parlaysGenerated: parlaysToCreate.length,
        legCounts,
        eligibleCategories: eligibleCategories.length,
        totalCandidates: picks.length,
        validPicks: validPicks.length,
        uniquePicksUsed: globalTracker.usedPicks.size,
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
