import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SPORT_KEYS: Record<string, string> = {
  'basketball_nba': 'NBA',
  'hockey_nhl': 'NHL',
  'americanfootball_nfl': 'NFL',
};

const PROP_MARKETS = [
  'player_points', 'player_rebounds', 'player_assists',
  'player_threes', 'player_blocks', 'player_steals',
  'player_points_rebounds_assists', 'player_goals', 'player_shots_on_goal'
];

interface UnifiedProp {
  event_id: string;
  sport: string;
  game_description: string;
  commence_time: string;
  player_name: string;
  prop_type: string;
  bookmaker: string;
  current_line: number;
  over_price: number | null;
  under_price: number | null;
  hit_rate_score: number;
  sharp_money_score: number;
  upset_score: number;
  trap_score: number;
  fatigue_score: number;
  composite_score: number;
  recommendation: string;
  recommended_side: string | null;
  confidence: number;
  category: string;
  signal_sources: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { sports = ['basketball_nba', 'hockey_nhl'] } = await req.json().catch(() => ({}));
    
    console.log('[UnifiedEngine] Starting unified props analysis for:', sports);
    const startTime = Date.now();

    // Fetch existing data for analysis
    const [hitRates, lineMovements, trapPatterns, fatigueScores] = await Promise.all([
      supabase.from('player_prop_hitrates').select('*').gte('expires_at', new Date().toISOString()),
      supabase.from('line_movements').select('*').eq('is_primary_record', true).gte('detected_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()),
      supabase.from('trap_patterns').select('*').limit(500),
      supabase.from('nba_fatigue_scores').select('*').gte('game_date', new Date().toISOString().split('T')[0])
    ]);

    // Build lookup maps for efficient scoring
    const hitRateMap = new Map<string, any>();
    (hitRates.data || []).forEach(hr => {
      hitRateMap.set(`${hr.player_name}:${hr.prop_type}`, hr);
    });

    const sharpMovementMap = new Map<string, any[]>();
    (lineMovements.data || []).forEach(lm => {
      const key = lm.event_id;
      if (!sharpMovementMap.has(key)) sharpMovementMap.set(key, []);
      sharpMovementMap.get(key)!.push(lm);
    });

    const trapSignatures = new Set<string>();
    (trapPatterns.data || []).filter(tp => tp.confirmed_trap).forEach(tp => {
      if (tp.trap_signature) trapSignatures.add(tp.trap_signature);
    });

    const fatigueMap = new Map<string, any>();
    (fatigueScores.data || []).forEach(fs => {
      fatigueMap.set(fs.team_name, fs);
    });

    const unifiedProps: UnifiedProp[] = [];
    let totalPropsAnalyzed = 0;

    // Fetch and analyze props for each sport
    for (const sport of sports) {
      try {
        // Fetch events
        const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${oddsApiKey}`;
        const eventsRes = await fetch(eventsUrl);
        if (!eventsRes.ok) continue;
        
        const events = await eventsRes.json();
        const upcomingEvents = events.filter((e: any) => {
          const commenceTime = new Date(e.commence_time);
          const now = new Date();
          const hoursUntil = (commenceTime.getTime() - now.getTime()) / (1000 * 60 * 60);
          return hoursUntil > 0 && hoursUntil < 48;
        }).slice(0, 5); // Limit to 5 events per sport to manage API usage

        for (const event of upcomingEvents) {
          // Fetch props for this event
          for (const market of PROP_MARKETS.slice(0, 3)) { // Limit markets
            try {
              const propsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds?apiKey=${oddsApiKey}&regions=us&markets=${market}&oddsFormat=american`;
              const propsRes = await fetch(propsUrl);
              if (!propsRes.ok) continue;

              const propsData = await propsRes.json();
              
              for (const bookmaker of propsData.bookmakers || []) {
                for (const propMarket of bookmaker.markets || []) {
                  // Group outcomes by player
                  const playerOutcomes = new Map<string, { over?: any; under?: any }>();
                  
                  for (const outcome of propMarket.outcomes || []) {
                    const playerName = outcome.description;
                    if (!playerName) continue;
                    
                    if (!playerOutcomes.has(playerName)) {
                      playerOutcomes.set(playerName, {});
                    }
                    
                    if (outcome.name === 'Over') {
                      playerOutcomes.get(playerName)!.over = outcome;
                    } else if (outcome.name === 'Under') {
                      playerOutcomes.get(playerName)!.under = outcome;
                    }
                  }

                  // Analyze each player prop
                  for (const [playerName, outcomes] of playerOutcomes) {
                    if (!outcomes.over && !outcomes.under) continue;
                    
                    totalPropsAnalyzed++;
                    
                    const line = outcomes.over?.point || outcomes.under?.point || 0;
                    const overPrice = outcomes.over?.price || null;
                    const underPrice = outcomes.under?.price || null;

                    // Calculate scores
                    const scores = calculateScores({
                      playerName,
                      propType: propMarket.key,
                      eventId: event.id,
                      sport,
                      line,
                      overPrice,
                      underPrice,
                      hitRateMap,
                      sharpMovementMap,
                      trapSignatures,
                      fatigueMap,
                      homeTeam: event.home_team,
                      awayTeam: event.away_team,
                      bookmaker: bookmaker.key
                    });

                    unifiedProps.push({
                      event_id: event.id,
                      sport,
                      game_description: `${event.away_team} @ ${event.home_team}`,
                      commence_time: event.commence_time,
                      player_name: playerName,
                      prop_type: propMarket.key,
                      bookmaker: bookmaker.key,
                      current_line: line,
                      over_price: overPrice,
                      under_price: underPrice,
                      ...scores
                    });
                  }
                }
              }
            } catch (err) {
              console.error(`[UnifiedEngine] Error fetching ${market} for ${event.id}:`, err);
            }
          }
        }
      } catch (err) {
        console.error(`[UnifiedEngine] Error processing sport ${sport}:`, err);
      }
    }

    // Upsert to database
    if (unifiedProps.length > 0) {
      const { error: upsertError } = await supabase
        .from('unified_props')
        .upsert(unifiedProps, { 
          onConflict: 'event_id,player_name,prop_type,bookmaker',
          ignoreDuplicates: false 
        });

      if (upsertError) {
        console.error('[UnifiedEngine] Upsert error:', upsertError);
      }
    }

    // Categorize and distribute props
    const categoryCounts = await distributeToCategories(supabase, unifiedProps);

    const duration = Date.now() - startTime;
    
    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'unified-props-engine',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { 
        totalPropsAnalyzed,
        unifiedPropsCreated: unifiedProps.length,
        categoryCounts,
        sports
      }
    });

    console.log(`[UnifiedEngine] Completed in ${duration}ms. Analyzed ${totalPropsAnalyzed} props, created ${unifiedProps.length} unified props`);

    return new Response(JSON.stringify({
      success: true,
      totalPropsAnalyzed,
      unifiedPropsCreated: unifiedProps.length,
      categoryCounts,
      duration
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[UnifiedEngine] Fatal error:', errorMessage);
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

interface ScoreParams {
  playerName: string;
  propType: string;
  eventId: string;
  sport: string;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  hitRateMap: Map<string, any>;
  sharpMovementMap: Map<string, any[]>;
  trapSignatures: Set<string>;
  fatigueMap: Map<string, any>;
  homeTeam: string;
  awayTeam: string;
  bookmaker: string;
}

function calculateScores(params: ScoreParams): {
  hit_rate_score: number;
  sharp_money_score: number;
  upset_score: number;
  trap_score: number;
  fatigue_score: number;
  composite_score: number;
  recommendation: string;
  recommended_side: string | null;
  confidence: number;
  category: string;
  signal_sources: string[];
} {
  const signalSources: string[] = [];
  let hitRateScore = 0;
  let sharpMoneyScore = 0;
  let upsetScore = 0;
  let trapScore = 0;
  let fatigueScore = 0;

  // Hit Rate Score
  const hitRateKey = `${params.playerName}:${params.propType}`;
  const hitRateData = params.hitRateMap.get(hitRateKey);
  if (hitRateData) {
    const maxHitRate = Math.max(hitRateData.hit_rate_over || 0, hitRateData.hit_rate_under || 0);
    hitRateScore = maxHitRate * 100;
    if (maxHitRate >= 0.8) signalSources.push('hit_rate_80+');
    if (hitRateData.is_perfect_streak) signalSources.push('perfect_streak');
  }

  // Sharp Money Score
  const movements = params.sharpMovementMap.get(params.eventId) || [];
  const relevantMovements = movements.filter(m => 
    m.player_name?.toLowerCase() === params.playerName.toLowerCase()
  );
  if (relevantMovements.length > 0) {
    const sharpMovements = relevantMovements.filter(m => m.is_sharp_action);
    sharpMoneyScore = Math.min(100, sharpMovements.length * 25);
    if (sharpMovements.length > 0) signalSources.push('sharp_money');
  }

  // Trap Score (inverted - high trap = bad)
  const trapSig = `${params.sport}:${params.propType}:${params.bookmaker}`;
  if (params.trapSignatures.has(trapSig)) {
    trapScore = 60;
    signalSources.push('trap_pattern');
  }

  // Fatigue Score (NBA only)
  if (params.sport === 'basketball_nba') {
    const homeFatigue = params.fatigueMap.get(params.homeTeam);
    const awayFatigue = params.fatigueMap.get(params.awayTeam);
    if (homeFatigue || awayFatigue) {
      const maxFatigue = Math.max(
        homeFatigue?.fatigue_score || 0,
        awayFatigue?.fatigue_score || 0
      );
      fatigueScore = maxFatigue;
      if (maxFatigue >= 30) signalSources.push('high_fatigue');
    }
  }

  // Upset Score (based on price differential)
  if (params.overPrice && params.underPrice) {
    const priceDiff = Math.abs(params.overPrice - params.underPrice);
    if (priceDiff > 40) {
      upsetScore = Math.min(80, priceDiff);
      signalSources.push('price_differential');
    }
  }

  // Calculate composite score (weighted)
  const compositeScore = (
    hitRateScore * 0.35 +
    sharpMoneyScore * 0.25 +
    (100 - trapScore) * 0.15 + // Invert trap (low trap = good)
    fatigueScore * 0.15 +
    upsetScore * 0.10
  );

  // Determine recommendation
  let recommendation = 'neutral';
  let recommendedSide: string | null = null;
  let confidence = compositeScore / 100;

  if (trapScore >= 50) {
    recommendation = 'fade';
    signalSources.push('fade_signal');
  } else if (hitRateScore >= 80 || sharpMoneyScore >= 50) {
    recommendation = 'pick';
    // Determine side based on hit rate or sharp money direction
    if (hitRateData) {
      recommendedSide = hitRateData.hit_rate_over > hitRateData.hit_rate_under ? 'over' : 'under';
    }
  }

  // Determine category
  let category = 'uncategorized';
  if (hitRateScore >= 80) {
    category = 'hitrate';
  } else if (sharpMoneyScore >= 50) {
    category = 'sharp';
  } else if (trapScore >= 50) {
    category = 'fade';
  } else if (upsetScore >= 50) {
    category = 'upset';
  } else if (compositeScore >= 60) {
    category = 'suggested';
  }

  return {
    hit_rate_score: Math.round(hitRateScore * 100) / 100,
    sharp_money_score: Math.round(sharpMoneyScore * 100) / 100,
    upset_score: Math.round(upsetScore * 100) / 100,
    trap_score: Math.round(trapScore * 100) / 100,
    fatigue_score: Math.round(fatigueScore * 100) / 100,
    composite_score: Math.round(compositeScore * 100) / 100,
    recommendation,
    recommended_side: recommendedSide,
    confidence: Math.round(confidence * 100) / 100,
    category,
    signal_sources: signalSources
  };
}

async function distributeToCategories(supabase: any, props: UnifiedProp[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {
    hitrate: 0,
    sharp: 0,
    upset: 0,
    fade: 0,
    suggested: 0,
    uncategorized: 0
  };

  for (const prop of props) {
    counts[prop.category] = (counts[prop.category] || 0) + 1;
  }

  // Create hit rate parlays from top hitrate props
  const hitRateProps = props.filter(p => p.category === 'hitrate').slice(0, 10);
  if (hitRateProps.length >= 3) {
    const parlayLegs = hitRateProps.slice(0, 4).map(p => ({
      player_name: p.player_name,
      prop_type: p.prop_type,
      line: p.current_line,
      side: p.recommended_side || 'over',
      hit_rate: p.hit_rate_score / 100,
      confidence: p.confidence,
      game: p.game_description,
      event_id: p.event_id
    }));

    await supabase.from('hitrate_parlays').upsert({
      legs: parlayLegs,
      combined_probability: parlayLegs.reduce((acc, leg) => acc * leg.hit_rate, 1),
      total_odds: 400, // Placeholder
      strategy_type: 'unified_pipeline',
      min_hit_rate: 0.8,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      sport: hitRateProps[0]?.sport || 'mixed',
      is_active: true
    });
  }

  // Create suggested parlays from top composite scores
  const suggestedProps = props
    .filter(p => p.recommendation === 'pick' && p.composite_score >= 60)
    .sort((a, b) => b.composite_score - a.composite_score)
    .slice(0, 6);

  if (suggestedProps.length >= 2) {
    const suggestionLegs = suggestedProps.slice(0, 3).map(p => ({
      description: `${p.player_name} ${p.recommended_side || 'over'} ${p.current_line} ${p.prop_type}`,
      player: p.player_name,
      prop_type: p.prop_type,
      line: p.current_line,
      side: p.recommended_side || 'over',
      confidence: p.confidence,
      signals: p.signal_sources
    }));

    await supabase.from('suggested_parlays').insert({
      legs: suggestionLegs,
      combined_probability: suggestedProps.slice(0, 3).reduce((acc, p) => acc * p.confidence, 1),
      total_odds: 350,
      sport: suggestedProps[0]?.sport || 'mixed',
      suggestion_reason: 'AI-driven unified pipeline: High composite score across multiple signals',
      confidence_score: suggestedProps[0]?.confidence || 0.5,
      expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      is_active: true,
      is_hybrid: true,
      hybrid_scores: {
        hit_rate: suggestedProps[0]?.hit_rate_score,
        sharp: suggestedProps[0]?.sharp_money_score,
        fatigue: suggestedProps[0]?.fatigue_score
      }
    });
  }

  return counts;
}
