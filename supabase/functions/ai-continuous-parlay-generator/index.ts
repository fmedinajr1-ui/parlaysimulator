import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FormulaWeight {
  formula_name: string;
  engine_source: string;
  current_weight: number;
  current_accuracy: number;
  total_picks: number;
}

interface PickCandidate {
  description: string;
  odds: number;
  event_id: string;
  sport: string;
  engine_source: string;
  formula_name: string;
  formula_scores: Record<string, number>;
  combined_score: number;
  commence_time: string;
  game_description?: string;
}

interface GeneratedParlay {
  legs: PickCandidate[];
  strategy_used: string;
  signals_used: string[];
  total_odds: number;
  confidence_score: number;
  formula_breakdown: Record<string, number>;
  source_engines: string[];
  sport: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('🤖 Starting Enhanced AI Parlay Generator - 50+ Daily Parlays');

    // Clean up old parlays (older than 24 hours)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: deletedCount } = await supabase
      .from('ai_generated_parlays')
      .delete()
      .lt('created_at', twentyFourHoursAgo);
    
    if (deletedCount && deletedCount > 0) {
      console.log(`🧹 Cleaned up ${deletedCount} old parlays`);
    }

    // Get current formula weights
    const { data: formulaWeights } = await supabase
      .from('ai_formula_performance')
      .select('*');

    const weightMap = new Map<string, FormulaWeight>();
    (formulaWeights || []).forEach((fw: FormulaWeight) => {
      weightMap.set(`${fw.formula_name}_${fw.engine_source}`, fw);
    });

    // Fetch avoid patterns (patterns to skip)
    const { data: avoidPatterns } = await supabase
      .from('ai_avoid_patterns')
      .select('*')
      .eq('is_active', true);

    const avoidSet = new Set((avoidPatterns || []).map((p: any) => p.pattern_key));
    console.log(`🚫 Active avoid patterns: ${avoidSet.size}`);

    // Fetch preferred compound formulas
    const { data: preferredCombos } = await supabase
      .from('ai_compound_formulas')
      .select('*')
      .eq('is_preferred', true)
      .gte('accuracy_rate', 55)
      .order('accuracy_rate', { ascending: false })
      .limit(10);

    const preferredComboSet = new Set((preferredCombos || []).map((c: any) => c.combination));
    console.log(`⭐ Preferred formula combos: ${preferredComboSet.size}`);

    // Fetch picks from ALL 7 engines in parallel
    const [
      sharpPicks,
      pvsPicks,
      hitratePicks,
      juicedPicks,
      godmodePicks,
      fatiguePicks,
      bestBetsPicks
    ] = await Promise.all([
      fetchSharpPicks(supabase, weightMap),
      fetchPVSPicks(supabase, weightMap),
      fetchHitratePicks(supabase, weightMap),
      fetchJuicedPicks(supabase, weightMap),
      fetchGodmodePicks(supabase, weightMap),
      fetchFatiguePicks(supabase, weightMap),
      fetchBestBetsPicks(supabase, weightMap)
    ]);

    console.log(`📊 Picks fetched - Sharp: ${sharpPicks.length}, PVS: ${pvsPicks.length}, HitRate: ${hitratePicks.length}, Juiced: ${juicedPicks.length}, GodMode: ${godmodePicks.length}, Fatigue: ${fatiguePicks.length}, BestBets: ${bestBetsPicks.length}`);

    // Combine all picks
    let allPicks: PickCandidate[] = [
      ...sharpPicks,
      ...pvsPicks,
      ...hitratePicks,
      ...juicedPicks,
      ...godmodePicks,
      ...fatiguePicks,
      ...bestBetsPicks
    ];

    // Filter out picks matching avoid patterns
    const originalCount = allPicks.length;
    allPicks = allPicks.filter(pick => {
      const patternKey = `${pick.formula_name}_${pick.sport}`;
      return !avoidSet.has(patternKey);
    });
    const filteredCount = originalCount - allPicks.length;
    if (filteredCount > 0) {
      console.log(`🚫 Filtered out ${filteredCount} picks based on avoid patterns`);
    }

    // Boost scores for picks from preferred combos
    allPicks = allPicks.map(pick => {
      const isInPreferredCombo = Array.from(preferredComboSet).some(combo => 
        (combo as string).includes(pick.formula_name)
      );
      if (isInPreferredCombo) {
        return { ...pick, combined_score: pick.combined_score * 1.15 };
      }
      return pick;
    });

    // Get current learning progress
    const { data: learningProgress } = await supabase
      .from('ai_learning_progress')
      .select('*')
      .order('generation_round', { ascending: false })
      .limit(1);

    const currentRound = (learningProgress?.[0]?.generation_round || 0) + 1;
    const currentAccuracy = learningProgress?.[0]?.current_accuracy || 0;

    // Generate 50+ parlays distributed across sports
    const targetParlays = {
      basketball_nba: 18,
      basketball_ncaab: 12,
      icehockey_nhl: 12,
      americanfootball_nfl: 5,
      americanfootball_ncaaf: 5
    };

    const generatedParlays: GeneratedParlay[] = [];

    // Generate parlays for each sport (now passing weightMap for confidence calculation)
    for (const [sport, target] of Object.entries(targetParlays)) {
      const sportPicks = allPicks.filter(p => 
        p.sport === sport || 
        p.sport?.includes(sport.split('_')[0]) ||
        (sport.includes('basketball') && p.sport?.includes('nba')) ||
        (sport.includes('icehockey') && p.sport?.includes('nhl'))
      );
      const crossSportPicks = allPicks.filter(p => p.sport !== sport);
      
      const sportParlays = generateOptimalParlays(sportPicks, crossSportPicks, target, sport, preferredComboSet, weightMap);
      generatedParlays.push(...sportParlays);
    }

    // Generate mixed-sport parlays for remaining slots
    const remainingTarget = Math.max(0, 52 - generatedParlays.length);
    if (remainingTarget > 0) {
      const mixedParlays = generateMixedSportParlays(allPicks, remainingTarget, preferredComboSet, weightMap);
      generatedParlays.push(...mixedParlays);
    }

    console.log(`🎯 Generated ${generatedParlays.length} parlays`);

    // Save parlays to database
    const parlaysToInsert = generatedParlays.map(parlay => ({
      generation_round: currentRound,
      strategy_used: parlay.strategy_used,
      signals_used: parlay.signals_used,
      legs: parlay.legs.map(leg => ({
        description: leg.description,
        odds: leg.odds,
        event_id: leg.event_id,
        sport: leg.sport,
        engine_source: leg.engine_source,
        formula_name: leg.formula_name,
        formula_scores: leg.formula_scores,
        commence_time: leg.commence_time,
        game_description: leg.game_description
      })),
      total_odds: parlay.total_odds,
      confidence_score: parlay.confidence_score,
      accuracy_at_generation: currentAccuracy,
      formula_breakdown: parlay.formula_breakdown,
      source_engines: parlay.source_engines,
      leg_sources: parlay.legs.map(leg => ({
        description: leg.description,
        engine: leg.engine_source,
        formula: leg.formula_name,
        scores: leg.formula_scores
      })),
      sport: parlay.sport,
      outcome: 'pending'
    }));

    if (parlaysToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('ai_generated_parlays')
        .insert(parlaysToInsert);

      if (insertError) {
        console.error('Error inserting parlays:', insertError);
      }
    }

    // Update learning progress
    await supabase.from('ai_learning_progress').insert({
      generation_round: currentRound,
      parlays_generated: generatedParlays.length,
      current_accuracy: currentAccuracy,
      strategy_weights: Object.fromEntries(
        Array.from(weightMap.entries()).map(([k, v]) => [k, v.current_weight])
      ),
      learned_patterns: {
        winning: [],
        losing: [],
        engines_used: [...new Set(generatedParlays.flatMap(p => p.source_engines))]
      }
    });

    // Log sport distribution
    const sportDistribution: Record<string, number> = {};
    generatedParlays.forEach(p => {
      sportDistribution[p.sport] = (sportDistribution[p.sport] || 0) + 1;
    });

    console.log('📈 Sport Distribution:', sportDistribution);

    return new Response(JSON.stringify({
      success: true,
      generation_round: currentRound,
      parlays_generated: generatedParlays.length,
      sport_distribution: sportDistribution,
      picks_by_engine: {
        sharp: sharpPicks.length,
        pvs: pvsPicks.length,
        hitrate: hitratePicks.length,
        juiced: juicedPicks.length,
        godmode: godmodePicks.length,
        fatigue: fatiguePicks.length,
        bestbets: bestBetsPicks.length
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('AI Parlay Generator Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Fetch sharp engine picks (both pick and fade signals)
async function fetchSharpPicks(supabase: any, weightMap: Map<string, FormulaWeight>): Promise<PickCandidate[]> {
  const picks: PickCandidate[] = [];
  
  // Get sharp PICK signals (SES >= 30)
  const { data: sharpPicks } = await supabase
    .from('line_movements')
    .select('*')
    .gte('sharp_edge_score', 30)
    .eq('recommendation', 'pick')
    .eq('is_primary_record', true)
    .gte('commence_time', new Date().toISOString())
    .order('sharp_edge_score', { ascending: false })
    .limit(25);

  for (const pick of sharpPicks || []) {
    const weight = weightMap.get('sharp_ses_30+_sharp')?.current_weight || 1.0;
    picks.push({
      description: `${pick.description} (Sharp PICK - SES ${pick.sharp_edge_score?.toFixed(0)})`,
      odds: pick.new_price || -110,
      event_id: pick.event_id,
      sport: pick.sport,
      engine_source: 'sharp',
      formula_name: 'sharp_ses_30+',
      formula_scores: {
        sharp_edge_score: pick.sharp_edge_score || 0,
        authenticity_confidence: pick.authenticity_confidence || 0.5,
        trap_score: pick.trap_score || 0
      },
      combined_score: (pick.sharp_edge_score || 0) * weight,
      commence_time: pick.commence_time,
      game_description: pick.description?.split(' (')[0] || pick.description
    });
  }

  // Get sharp FADE signals (high trap score)
  const { data: fadePicks } = await supabase
    .from('line_movements')
    .select('*')
    .gte('trap_score', 50)
    .eq('recommendation', 'fade')
    .eq('is_primary_record', true)
    .gte('commence_time', new Date().toISOString())
    .order('trap_score', { ascending: false })
    .limit(25);

  for (const pick of fadePicks || []) {
    const weight = weightMap.get('sharp_fade_30-_sharp')?.current_weight || 1.0;
    picks.push({
      description: `${pick.description} (Sharp FADE - Trap ${pick.trap_score?.toFixed(0)}%)`,
      odds: pick.new_price || -110,
      event_id: pick.event_id,
      sport: pick.sport,
      engine_source: 'sharp',
      formula_name: 'sharp_fade_30-',
      formula_scores: {
        sharp_edge_score: pick.sharp_edge_score || 0,
        trap_score: pick.trap_score || 0,
        trap_pressure: pick.trap_pressure || 0
      },
      combined_score: (pick.trap_score || 0) * weight,
      commence_time: pick.commence_time,
      game_description: pick.description?.split(' (')[0] || pick.description
    });
  }

  return picks;
}

// Fetch PVS calculator picks
async function fetchPVSPicks(supabase: any, weightMap: Map<string, FormulaWeight>): Promise<PickCandidate[]> {
  const picks: PickCandidate[] = [];
  
  const { data: pvsProps } = await supabase
    .from('unified_props')
    .select('*')
    .gte('pvs_final_score', 70)
    .gte('commence_time', new Date().toISOString())
    .order('pvs_final_score', { ascending: false })
    .limit(30);

  for (const prop of pvsProps || []) {
    const isPVS80 = (prop.pvs_final_score || 0) >= 80;
    const formulaName = isPVS80 ? 'pvs_final_80+' : 'pvs_final_70+';
    const weight = weightMap.get(`${formulaName}_pvs`)?.current_weight || 1.0;
    
    picks.push({
      description: `${prop.player_name} ${prop.pvs_recommendation} ${prop.line} ${prop.prop_type} (PVS ${prop.pvs_final_score?.toFixed(0)})`,
      odds: prop.pvs_recommendation === 'OVER' ? (prop.over_price || -110) : (prop.under_price || -110),
      event_id: prop.event_id || '',
      sport: prop.sport,
      engine_source: 'pvs',
      formula_name: formulaName,
      formula_scores: {
        pvs_final_score: prop.pvs_final_score || 0,
        pvs_tier: prop.pvs_tier === 'ELITE' ? 100 : prop.pvs_tier === 'STRONG' ? 80 : 60,
        composite_score: prop.composite_score || 0
      },
      combined_score: (prop.pvs_final_score || 0) * weight,
      commence_time: prop.commence_time,
      game_description: prop.game_description
    });
  }

  return picks;
}

// Fetch hit rate picks
async function fetchHitratePicks(supabase: any, weightMap: Map<string, FormulaWeight>): Promise<PickCandidate[]> {
  const picks: PickCandidate[] = [];
  
  const { data: hitrates } = await supabase
    .from('player_prop_hitrates')
    .select('*')
    .gte('hit_rate_over', 0.75)
    .gte('games_analyzed', 5)
    .gte('commence_time', new Date().toISOString())
    .order('hit_rate_over', { ascending: false })
    .limit(30);

  for (const hr of hitrates || []) {
    const isPerfect = hr.hit_streak === '5/5';
    const formulaName = isPerfect ? 'hitrate_5_5' : 'hitrate_4_5';
    const weight = weightMap.get(`${formulaName}_hitrate`)?.current_weight || 1.0;
    const hitRate = Math.max(hr.hit_rate_over || 0, hr.hit_rate_under || 0);
    const side = (hr.hit_rate_over || 0) > (hr.hit_rate_under || 0) ? 'Over' : 'Under';
    
    picks.push({
      description: `${hr.player_name} ${side} ${hr.current_line} ${hr.prop_type} (${(hitRate * 100).toFixed(0)}% Hit Rate${hr.hit_streak ? ` - ${hr.hit_streak}` : ''})`,
      odds: side === 'Over' ? (hr.over_price || -110) : (hr.under_price || -110),
      event_id: hr.event_id || '',
      sport: hr.sport,
      engine_source: 'hitrate',
      formula_name: formulaName,
      formula_scores: {
        hit_rate: hitRate,
        games_analyzed: hr.games_analyzed || 0,
        consistency_score: hr.consistency_score || 0
      },
      combined_score: hitRate * 100 * weight,
      commence_time: hr.commence_time || new Date().toISOString(),
      game_description: hr.game_description
    });
  }

  return picks;
}

// Fetch juiced props picks
async function fetchJuicedPicks(supabase: any, weightMap: Map<string, FormulaWeight>): Promise<PickCandidate[]> {
  const picks: PickCandidate[] = [];
  
  const { data: juiced } = await supabase
    .from('juiced_props')
    .select('*')
    .not('final_pick', 'is', null)
    .in('juice_level', ['extreme', 'heavy'])
    .gte('unified_confidence', 0.70)  // 70% confidence minimum for juiced props
    .gte('commence_time', new Date().toISOString())
    .order('juice_amount', { ascending: false })
    .limit(25);

  for (const prop of juiced || []) {
    const isExtreme = prop.juice_level === 'extreme';
    const formulaName = isExtreme ? 'juiced_extreme' : 'juiced_heavy';
    const weight = weightMap.get(`${formulaName}_juiced`)?.current_weight || 1.0;
    
    picks.push({
      description: `${prop.player_name} ${prop.final_pick} ${prop.line} ${prop.prop_type} (Juiced ${prop.juice_level} - ${prop.juice_amount}¢)`,
      odds: prop.final_pick === 'OVER' ? prop.over_price : prop.under_price,
      event_id: prop.event_id,
      sport: prop.sport,
      engine_source: 'juiced',
      formula_name: formulaName,
      formula_scores: {
        juice_amount: prop.juice_amount || 0,
        juice_direction: prop.juice_direction === 'over' ? 1 : -1,
        unified_confidence: prop.unified_confidence || 0
      },
      combined_score: (prop.juice_amount || 0) * weight,
      commence_time: prop.commence_time,
      game_description: prop.game_description
    });
  }

  return picks;
}

// Fetch god mode upset picks
async function fetchGodmodePicks(supabase: any, weightMap: Map<string, FormulaWeight>): Promise<PickCandidate[]> {
  const picks: PickCandidate[] = [];
  
  const { data: upsets } = await supabase
    .from('god_mode_upset_predictions')
    .select('*')
    .in('confidence', ['high', 'medium'])
    .gte('final_upset_score', 50)
    .eq('game_completed', false)
    .gte('commence_time', new Date().toISOString())
    .order('final_upset_score', { ascending: false })
    .limit(20);

  for (const upset of upsets || []) {
    const isHigh = upset.confidence === 'high' && (upset.final_upset_score || 0) >= 65;
    const formulaName = isHigh ? 'godmode_high_65+' : 'godmode_medium_50+';
    const weight = weightMap.get(`${formulaName}_godmode`)?.current_weight || 1.0;
    
    picks.push({
      description: `${upset.underdog} ML vs ${upset.favorite} (GodMode ${upset.final_upset_score?.toFixed(0)} - ${upset.confidence})`,
      odds: upset.underdog_odds,
      event_id: upset.event_id,
      sport: upset.sport,
      engine_source: 'godmode',
      formula_name: formulaName,
      formula_scores: {
        final_upset_score: upset.final_upset_score || 0,
        chess_ev: upset.chess_ev || 0,
        sharp_pct: upset.sharp_pct || 0,
        chaos_percentage: upset.chaos_percentage || 0
      },
      combined_score: (upset.final_upset_score || 0) * weight,
      commence_time: upset.commence_time,
      game_description: `${upset.away_team} @ ${upset.home_team}`
    });
  }

  return picks;
}

// Fetch fatigue edge picks
async function fetchFatiguePicks(supabase: any, weightMap: Map<string, FormulaWeight>): Promise<PickCandidate[]> {
  const picks: PickCandidate[] = [];
  
  const today = new Date().toISOString().split('T')[0];
  
  const { data: fatigue } = await supabase
    .from('fatigue_edge_tracking')
    .select('*')
    .gte('fatigue_differential', 20)
    .gte('game_date', today)
    .is('recommended_side_won', null)
    .order('fatigue_differential', { ascending: false })
    .limit(15);

  for (const game of fatigue || []) {
    const isHighDiff = (game.fatigue_differential || 0) >= 30;
    const formulaName = isHighDiff ? 'fatigue_diff_30+' : 'fatigue_diff_20+';
    const weight = weightMap.get(`${formulaName}_fatigue`)?.current_weight || 1.0;
    
    picks.push({
      description: `${game.recommended_side} (Fatigue Edge +${game.fatigue_differential} - ${game.recommended_angle || 'spread'})`,
      odds: -110,
      event_id: game.event_id,
      sport: 'basketball_nba',
      engine_source: 'fatigue',
      formula_name: formulaName,
      formula_scores: {
        fatigue_differential: game.fatigue_differential || 0,
        home_fatigue: game.home_fatigue_score || 0,
        away_fatigue: game.away_fatigue_score || 0
      },
      combined_score: (game.fatigue_differential || 0) * weight,
      commence_time: game.game_date,
      game_description: `${game.away_team} @ ${game.home_team}`
    });
  }

  return picks;
}

// Fetch best bets picks
async function fetchBestBetsPicks(supabase: any, weightMap: Map<string, FormulaWeight>): Promise<PickCandidate[]> {
  const picks: PickCandidate[] = [];
  
  const today = new Date().toISOString().split('T')[0];
  
  const { data: bestBets } = await supabase
    .from('best_bets_log')
    .select('*')
    .gte('created_at', today)
    .is('outcome', null)
    .gte('accuracy_at_time', 55)
    .order('accuracy_at_time', { ascending: false })
    .limit(15);

  for (const bet of bestBets || []) {
    const weight = weightMap.get('bestbets_high_accuracy_bestbets')?.current_weight || 1.0;
    
    picks.push({
      description: `${bet.description || bet.prediction} (Best Bet - ${bet.signal_type} ${(bet.accuracy_at_time || 0).toFixed(0)}%)`,
      odds: bet.odds || -110,
      event_id: bet.event_id,
      sport: bet.sport,
      engine_source: 'bestbets',
      formula_name: 'bestbets_high_accuracy',
      formula_scores: {
        accuracy_at_time: bet.accuracy_at_time || 0,
        sample_size: bet.sample_size_at_time || 0
      },
      combined_score: (bet.accuracy_at_time || 0) * weight,
      commence_time: bet.created_at,
      game_description: bet.description?.split(' (')[0] || bet.description
    });
  }

  return picks;
}

// Generate optimal parlays for a specific sport
function generateOptimalParlays(
  sportPicks: PickCandidate[],
  crossSportPicks: PickCandidate[],
  target: number,
  sport: string,
  preferredCombos: Set<string> = new Set(),
  weightMap?: Map<string, FormulaWeight>
): GeneratedParlay[] {
  const parlays: GeneratedParlay[] = [];
  
  const sortedPicks = [...sportPicks].sort((a, b) => b.combined_score - a.combined_score);
  
  // First prioritize preferred formula combinations
  if (preferredCombos.size > 0) {
    for (const combo of preferredCombos) {
      if (parlays.length >= target * 0.3) break; // 30% from preferred combos
      
      const formulas = (combo as string).split('+');
      const matchingPicks = sortedPicks.filter(p => formulas.includes(p.formula_name));
      
      if (matchingPicks.length >= 2) {
        const uniqueEvents = new Set(matchingPicks.map(p => p.event_id));
        if (uniqueEvents.size >= 2) {
          const selectedPicks = matchingPicks.slice(0, 2);
          if (selectedPicks[0].event_id !== selectedPicks[1]?.event_id) {
            const parlay = createParlay(selectedPicks, sport, weightMap);
            parlays.push(parlay);
          }
        }
      }
    }
  }
  
  // Generate 2-leg parlays
  for (let i = 0; i < Math.min(sortedPicks.length, target * 2); i++) {
    for (let j = i + 1; j < Math.min(sortedPicks.length, target * 2); j++) {
      if (parlays.length >= target) break;
      
      const pick1 = sortedPicks[i];
      const pick2 = sortedPicks[j];
      
      if (pick1.event_id === pick2.event_id) continue;
      
      const sameEngine = pick1.engine_source === pick2.engine_source;
      if (sameEngine && Math.random() > 0.3) continue;
      
      const parlay = createParlay([pick1, pick2], sport, weightMap);
      parlays.push(parlay);
    }
    if (parlays.length >= target) break;
  }

  // Generate 3-leg parlays if needed
  if (sortedPicks.length >= 3 && parlays.length < target) {
    for (let i = 0; i < Math.min(sortedPicks.length - 2, 10); i++) {
      for (let j = i + 1; j < Math.min(sortedPicks.length - 1, 10); j++) {
        for (let k = j + 1; k < Math.min(sortedPicks.length, 10); k++) {
          if (parlays.length >= target) break;
          
          const pick1 = sortedPicks[i];
          const pick2 = sortedPicks[j];
          const pick3 = sortedPicks[k];
          
          const eventIds = new Set([pick1.event_id, pick2.event_id, pick3.event_id]);
          if (eventIds.size < 3) continue;
          
          const parlay = createParlay([pick1, pick2, pick3], sport, weightMap);
          parlays.push(parlay);
        }
      }
    }
  }

  return parlays;
}

// Generate mixed sport parlays
function generateMixedSportParlays(
  allPicks: PickCandidate[], 
  target: number,
  preferredCombos: Set<string> = new Set(),
  weightMap?: Map<string, FormulaWeight>
): GeneratedParlay[] {
  const parlays: GeneratedParlay[] = [];
  const sortedPicks = [...allPicks].sort((a, b) => b.combined_score - a.combined_score);
  
  for (let i = 0; i < Math.min(sortedPicks.length, target * 3); i++) {
    for (let j = i + 1; j < Math.min(sortedPicks.length, target * 3); j++) {
      if (parlays.length >= target) break;
      
      const pick1 = sortedPicks[i];
      const pick2 = sortedPicks[j];
      
      if (pick1.sport === pick2.sport && Math.random() > 0.5) continue;
      if (pick1.event_id === pick2.event_id) continue;
      
      // Boost priority for preferred combos
      const combo = [pick1.formula_name, pick2.formula_name].sort().join('+');
      const isPreferred = preferredCombos.has(combo);
      
      if (isPreferred || Math.random() > 0.3) {
        const parlay = createParlay([pick1, pick2], 'mixed', weightMap);
        parlays.push(parlay);
      }
    }
    if (parlays.length >= target) break;
  }

  return parlays;
}

// ============================================
// 4-STAGE CONFIDENCE FUNNEL
// ============================================

// Stage 1: Normalize engine scores to 0-1 scale
function normalizeEngineScore(pick: PickCandidate): number {
  const engine = pick.engine_source;
  const scores = pick.formula_scores;
  
  switch (engine) {
    case 'hitrate':
      // HitRate: 60-100% → 0.0-1.0
      const hitRate = (scores.hit_rate as number) || 0.75;
      return Math.max(0, Math.min(1, (hitRate - 0.6) / 0.4));
    
    case 'pvs':
      // PVS: 50-100 → 0.0-1.0
      const pvsScore = (scores.pvs_final_score as number) || 70;
      return Math.max(0, Math.min(1, (pvsScore - 50) / 50));
    
    case 'sharp':
      // Sharp: SES 20-50+ → 0.4-1.0
      const sesScore = (scores.sharp_edge_score as number) || 30;
      return Math.max(0.4, Math.min(1, sesScore / 50));
    
    case 'juiced':
      // Juiced: juice amount 10-50+ → 0.4-1.0
      const juiceAmount = (scores.juice_amount as number) || 20;
      return Math.max(0.4, Math.min(1, juiceAmount / 50));
    
    case 'godmode':
      // GodMode: upset score 40-80% → 0.4-1.0
      const upsetScore = pick.combined_score / 100;
      return Math.max(0.4, Math.min(1, upsetScore));
    
    case 'fatigue':
      // Fatigue: differential 5-20+ → 0.4-1.0
      const differential = (scores.fatigue_differential as number) || 10;
      return Math.max(0.4, Math.min(1, differential / 20));
    
    case 'bestbets':
      // BestBets: accuracy 55-85% → 0.5-1.0
      const accuracy = (scores.accuracy_at_time as number) || 65;
      return Math.max(0.5, Math.min(1, (accuracy - 55) / 30));
    
    default:
      return 0.5; // Default baseline
  }
}

// Stage 2: Get historical accuracy for formula (weakest link principle)
function getFormulaAccuracyFactor(picks: PickCandidate[], weightMap: Map<string, FormulaWeight>): number {
  let lowestAccuracy = 1.0;
  
  for (const pick of picks) {
    const key = `${pick.formula_name}_${pick.engine_source}`;
    const formula = weightMap.get(key);
    
    if (formula && formula.total_picks && formula.total_picks >= 5) {
      const accuracy = formula.current_accuracy / 100; // Convert from percentage
      lowestAccuracy = Math.min(lowestAccuracy, accuracy);
    } else {
      // New formula with no data - use baseline 50%
      lowestAccuracy = Math.min(lowestAccuracy, 0.50);
    }
  }
  
  return lowestAccuracy;
}

// Stage 3: Risk penalty based on total odds
function getRiskPenaltyFactor(totalOdds: number): number {
  const absOdds = Math.abs(totalOdds);
  
  if (totalOdds < 0) {
    // Favorites: no penalty for low risk
    return 1.0;
  } else if (absOdds <= 200) {
    // Standard 2-leg range: no penalty
    return 1.0;
  } else if (absOdds <= 400) {
    // Getting risky
    return 0.85;
  } else if (absOdds <= 700) {
    // Long shot territory
    return 0.70;
  } else {
    // Lottery ticket
    return 0.50;
  }
}

// Stage 4: Combined probability from implied odds
function getCombinedProbability(picks: PickCandidate[]): number {
  let combinedProb = 1.0;
  
  for (const pick of picks) {
    const odds = pick.odds;
    let impliedProb: number;
    
    if (odds < 0) {
      impliedProb = Math.abs(odds) / (Math.abs(odds) + 100);
    } else {
      impliedProb = 100 / (odds + 100);
    }
    
    combinedProb *= impliedProb;
  }
  
  return combinedProb;
}

// Create a parlay from picks with 4-stage confidence funnel
function createParlay(picks: PickCandidate[], sport: string, weightMap?: Map<string, FormulaWeight>): GeneratedParlay {
  let totalOddsDecimal = 1;
  for (const pick of picks) {
    const decimal = pick.odds > 0 ? (pick.odds / 100) + 1 : (100 / Math.abs(pick.odds)) + 1;
    totalOddsDecimal *= decimal;
  }
  
  const totalOdds = totalOddsDecimal >= 2 
    ? Math.round((totalOddsDecimal - 1) * 100)
    : Math.round(-100 / (totalOddsDecimal - 1));

  // ============================================
  // 4-STAGE CONFIDENCE CALCULATION
  // ============================================
  
  // Stage 1: Normalized Engine Scores (25% weight)
  const normalizedScores = picks.map(p => normalizeEngineScore(p));
  const avgNormalizedScore = normalizedScores.reduce((sum, s) => sum + s, 0) / normalizedScores.length;
  
  // Stage 2: Historical Accuracy (30% weight) - use baseline if no weightMap
  const historicalAccuracy = weightMap 
    ? getFormulaAccuracyFactor(picks, weightMap)
    : 0.55; // Default baseline
  
  // Stage 3: Risk Penalty (20% weight)
  const riskFactor = getRiskPenaltyFactor(totalOdds);
  
  // Stage 4: Combined Probability (25% weight)
  const combinedProbability = getCombinedProbability(picks);
  
  // Calculate weighted confidence score
  const rawConfidence = (
    (avgNormalizedScore * 0.25) +
    (historicalAccuracy * 0.30) +
    (riskFactor * 0.20) +
    (combinedProbability * 0.25)
  ) * 100;
  
  // Clamp to 35-95% range (never 0% or 100%)
  const confidenceScore = Math.max(35, Math.min(95, Math.round(rawConfidence)));

  const formulaBreakdown: Record<string, number> = {};
  picks.forEach(pick => {
    Object.entries(pick.formula_scores).forEach(([key, value]) => {
      if (!formulaBreakdown[key]) formulaBreakdown[key] = 0;
      formulaBreakdown[key] += value as number;
    });
  });
  Object.keys(formulaBreakdown).forEach(key => {
    formulaBreakdown[key] = Math.round((formulaBreakdown[key] / picks.length) * 100) / 100;
  });
  
  // Add confidence breakdown to formula_breakdown for transparency
  formulaBreakdown['_conf_normalized'] = Math.round(avgNormalizedScore * 100);
  formulaBreakdown['_conf_historical'] = Math.round(historicalAccuracy * 100);
  formulaBreakdown['_conf_risk'] = Math.round(riskFactor * 100);
  formulaBreakdown['_conf_probability'] = Math.round(combinedProbability * 100);

  const sourceEngines = [...new Set(picks.map(p => p.engine_source))];
  const signalsUsed = [...new Set(picks.map(p => p.formula_name))];
  const strategyUsed = signalsUsed.join('+');

  return {
    legs: picks,
    strategy_used: strategyUsed,
    signals_used: signalsUsed,
    total_odds: totalOdds,
    confidence_score: confidenceScore,
    formula_breakdown: formulaBreakdown,
    source_engines: sourceEngines,
    sport
  };
}
