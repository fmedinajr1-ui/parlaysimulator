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
  // PVS-specific fields
  pvs_value_score: number;
  pvs_matchup_score: number;
  pvs_minutes_score: number;
  pvs_pace_score: number;
  pvs_accuracy_score: number;
  pvs_sharp_score: number;
  pvs_injury_tax: number;
  pvs_confidence_score: number;
  pvs_final_score: number;
  pvs_tier: string;
  true_line: number | null;
  true_line_diff: number | null;
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
    
    console.log('[UnifiedEngine] Starting unified props analysis with PVS scoring for:', sports);
    const startTime = Date.now();

    // Fetch all supporting data for PVS calculations
    const [hitRates, lineMovements, trapPatterns, fatigueScores, defenseStats, paceStats, gameLogs, injuryReports] = await Promise.all([
      supabase.from('player_prop_hitrates').select('*').gte('expires_at', new Date().toISOString()),
      supabase.from('line_movements').select('*').eq('is_primary_record', true).gte('detected_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()),
      supabase.from('trap_patterns').select('*').limit(500),
      supabase.from('nba_fatigue_scores').select('*').gte('game_date', new Date().toISOString().split('T')[0]),
      supabase.from('nba_opponent_defense_stats').select('*'),
      supabase.from('nba_team_pace_projections').select('*'),
      supabase.from('nba_player_game_logs').select('*').order('game_date', { ascending: false }).limit(1000),
      supabase.from('nba_injury_reports').select('*').gte('game_date', new Date().toISOString().split('T')[0])
    ]);

    console.log('[UnifiedEngine] Loaded supporting data:', {
      hitRates: hitRates.data?.length || 0,
      lineMovements: lineMovements.data?.length || 0,
      trapPatterns: trapPatterns.data?.length || 0,
      fatigueScores: fatigueScores.data?.length || 0,
      defenseStats: defenseStats.data?.length || 0,
      paceStats: paceStats.data?.length || 0,
      gameLogs: gameLogs.data?.length || 0,
      injuryReports: injuryReports.data?.length || 0
    });

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

    // Build defense stats map by team
    const defenseMap = new Map<string, any>();
    (defenseStats.data || []).forEach(ds => {
      defenseMap.set(ds.team_name, ds);
    });

    // Build pace stats map by team
    const paceMap = new Map<string, any>();
    (paceStats.data || []).forEach(ps => {
      paceMap.set(ps.team_name, ps);
    });

    // Build game logs map by player
    const gameLogsMap = new Map<string, any[]>();
    (gameLogs.data || []).forEach(gl => {
      const key = gl.player_name;
      if (!gameLogsMap.has(key)) gameLogsMap.set(key, []);
      gameLogsMap.get(key)!.push(gl);
    });

    // Build injury map by player
    const injuryMap = new Map<string, any>();
    (injuryReports.data || []).forEach(ir => {
      injuryMap.set(ir.player_name, ir);
    });

    const unifiedProps: UnifiedProp[] = [];
    let totalPropsAnalyzed = 0;

    // Fetch and analyze props for each sport
    for (const sport of sports) {
      try {
        // Fetch events
        const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${oddsApiKey}`;
        const eventsRes = await fetch(eventsUrl);
        if (!eventsRes.ok) {
          console.log(`[UnifiedEngine] Failed to fetch events for ${sport}:`, eventsRes.status);
          continue;
        }
        
        const events = await eventsRes.json();
        const upcomingEvents = events.filter((e: any) => {
          const commenceTime = new Date(e.commence_time);
          const now = new Date();
          const hoursUntil = (commenceTime.getTime() - now.getTime()) / (1000 * 60 * 60);
          return hoursUntil > 0 && hoursUntil < 48;
        }).slice(0, 8); // Limit to 8 events per sport

        console.log(`[UnifiedEngine] Processing ${upcomingEvents.length} events for ${sport}`);

        for (const event of upcomingEvents) {
          // Fetch props for this event
          for (const market of PROP_MARKETS.slice(0, 6)) { // Process 6 markets
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

                    // Calculate base scores
                    const baseScores = calculateBaseScores({
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

                    // Calculate PVS scores
                    const pvsScores = calculatePVSScores({
                      playerName,
                      propType: propMarket.key,
                      line,
                      overPrice,
                      underPrice,
                      homeTeam: event.home_team,
                      awayTeam: event.away_team,
                      hitRateMap,
                      sharpMovementMap,
                      defenseMap,
                      paceMap,
                      gameLogsMap,
                      injuryMap,
                      fatigueMap,
                      trapSignatures,
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
                      ...baseScores,
                      ...pvsScores
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

    console.log(`[UnifiedEngine] Analyzed ${totalPropsAnalyzed} props, created ${unifiedProps.length} unified props`);

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

    // Create PVS-based parlays
    await createPVSParlays(supabase, unifiedProps);

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
        sports,
        pvsEnabled: true
      }
    });

    console.log(`[UnifiedEngine] Completed in ${duration}ms with PVS scoring`);

    return new Response(JSON.stringify({
      success: true,
      totalPropsAnalyzed,
      unifiedPropsCreated: unifiedProps.length,
      categoryCounts,
      duration,
      pvsEnabled: true
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

interface BaseScoreParams {
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

function calculateBaseScores(params: BaseScoreParams): {
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
    (100 - trapScore) * 0.15 +
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

interface PVSScoreParams {
  playerName: string;
  propType: string;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  homeTeam: string;
  awayTeam: string;
  hitRateMap: Map<string, any>;
  sharpMovementMap: Map<string, any[]>;
  defenseMap: Map<string, any>;
  paceMap: Map<string, any>;
  gameLogsMap: Map<string, any[]>;
  injuryMap: Map<string, any>;
  fatigueMap: Map<string, any>;
  trapSignatures: Set<string>;
  bookmaker: string;
}

function calculatePVSScores(params: PVSScoreParams): {
  pvs_value_score: number;
  pvs_matchup_score: number;
  pvs_minutes_score: number;
  pvs_pace_score: number;
  pvs_accuracy_score: number;
  pvs_sharp_score: number;
  pvs_injury_tax: number;
  pvs_confidence_score: number;
  pvs_final_score: number;
  pvs_tier: string;
  true_line: number | null;
  true_line_diff: number | null;
} {
  let valueScore = 50; // Default middle value
  let matchupScore = 50;
  let minutesScore = 50;
  let paceScore = 50;
  let accuracyScore = 50;
  let sharpScore = 50;
  let injuryTax = 0;

  // 1. VALUE SCORE (0-100): Based on odds line differential and implied probability edge
  if (params.overPrice && params.underPrice) {
    // Calculate implied probabilities
    const overProb = params.overPrice > 0 
      ? 100 / (params.overPrice + 100) 
      : Math.abs(params.overPrice) / (Math.abs(params.overPrice) + 100);
    const underProb = params.underPrice > 0 
      ? 100 / (params.underPrice + 100) 
      : Math.abs(params.underPrice) / (Math.abs(params.underPrice) + 100);
    
    // Total probability over 1 indicates juice - find the edge
    const totalProb = overProb + underProb;
    const noVigOverProb = overProb / totalProb;
    const noVigUnderProb = underProb / totalProb;
    
    // Value is higher when one side has clear edge (prob difference)
    const probDiff = Math.abs(noVigOverProb - noVigUnderProb);
    valueScore = Math.min(100, 50 + probDiff * 100);
  }

  // 2. MATCHUP SCORE (0-100): Based on opponent defense stats
  const opponentTeam = params.homeTeam; // Assume player is on away team for now
  const defenseData = params.defenseMap.get(opponentTeam);
  if (defenseData) {
    // Map prop type to defensive stat
    const propToStat: Record<string, string> = {
      'player_points': 'points_allowed_avg',
      'player_rebounds': 'rebounds_allowed_avg',
      'player_assists': 'assists_allowed_avg',
      'player_threes': 'threes_allowed_avg',
      'player_blocks': 'blocks_allowed_avg'
    };
    
    const statKey = propToStat[params.propType];
    if (statKey && defenseData[statKey]) {
      // Higher defense rating = easier matchup = higher score
      // Defense rank 1-30, lower is better defense
      const defenseRank = defenseData.defense_rank || 15;
      matchupScore = Math.min(100, Math.max(0, (defenseRank / 30) * 100));
    }
  }

  // 3. MINUTES SCORE (0-100): Based on player game logs and minutes consistency
  const playerLogs = params.gameLogsMap.get(params.playerName) || [];
  if (playerLogs.length >= 3) {
    const recentLogs = playerLogs.slice(0, 10);
    const avgMinutes = recentLogs.reduce((sum, log) => sum + (log.minutes_played || 0), 0) / recentLogs.length;
    const minutesVariance = recentLogs.reduce((sum, log) => sum + Math.pow((log.minutes_played || 0) - avgMinutes, 2), 0) / recentLogs.length;
    const stdDev = Math.sqrt(minutesVariance);
    
    // Low variance = high consistency = high score
    // Also boost if avg minutes is high (more opportunity)
    const consistencyScore = Math.max(0, 100 - stdDev * 10);
    const volumeBonus = Math.min(20, avgMinutes - 20); // Bonus for 20+ minutes
    minutesScore = Math.min(100, consistencyScore + Math.max(0, volumeBonus));
    
    // Calculate true line based on recent performance
    const propToStat: Record<string, string> = {
      'player_points': 'points',
      'player_rebounds': 'rebounds',
      'player_assists': 'assists',
      'player_threes': 'threes_made',
      'player_blocks': 'blocks',
      'player_steals': 'steals'
    };
    
    const statKey = propToStat[params.propType];
    if (statKey) {
      const avgStat = recentLogs.reduce((sum, log) => sum + (log[statKey] || 0), 0) / recentLogs.length;
      // Could set true_line here if needed
    }
  }

  // 4. PACE SCORE (0-100): Based on team pace projections
  const homePace = params.paceMap.get(params.homeTeam);
  const awayPace = params.paceMap.get(params.awayTeam);
  if (homePace || awayPace) {
    const avgPaceRating = ((homePace?.pace_rating || 100) + (awayPace?.pace_rating || 100)) / 2;
    // Higher pace = more possessions = higher scores = higher score for overs
    // Pace rating typically 95-110, normalize to 0-100
    paceScore = Math.min(100, Math.max(0, (avgPaceRating - 90) * 5));
    
    // Consider tempo factor
    const avgTempo = ((homePace?.tempo_factor || 1) + (awayPace?.tempo_factor || 1)) / 2;
    paceScore = paceScore * avgTempo;
  }

  // 5. ACCURACY SCORE (0-100): Based on historical hit rates
  const hitRateKey = `${params.playerName}:${params.propType}`;
  const hitRateData = params.hitRateMap.get(hitRateKey);
  if (hitRateData) {
    const maxHitRate = Math.max(hitRateData.hit_rate_over || 0, hitRateData.hit_rate_under || 0);
    accuracyScore = maxHitRate * 100;
    
    // Bonus for perfect streaks
    if (hitRateData.is_perfect_streak) {
      accuracyScore = Math.min(100, accuracyScore + 10);
    }
    
    // Confidence score bonus for large sample size
    if (hitRateData.games_analyzed >= 10) {
      accuracyScore = Math.min(100, accuracyScore + 5);
    }
  }

  // 6. SHARP SCORE (0-100): Based on sharp money indicators
  // Check for sharp movements on this player
  let sharpMovementCount = 0;
  for (const [eventId, movements] of params.sharpMovementMap) {
    const playerMovements = movements.filter(m => 
      m.player_name?.toLowerCase() === params.playerName.toLowerCase() && 
      m.is_sharp_action
    );
    sharpMovementCount += playerMovements.length;
  }
  sharpScore = Math.min(100, 50 + sharpMovementCount * 15);

  // 7. INJURY TAX (0-100): Penalty if player is injured
  const injuryData = params.injuryMap.get(params.playerName);
  if (injuryData) {
    const statusPenalties: Record<string, number> = {
      'out': 100,
      'doubtful': 80,
      'questionable': 40,
      'probable': 10,
      'available': 0
    };
    injuryTax = statusPenalties[injuryData.status?.toLowerCase()] || 0;
    
    // Additional penalty based on impact level
    if (injuryData.impact_level === 'high') {
      injuryTax = Math.min(100, injuryTax + 20);
    } else if (injuryData.impact_level === 'medium') {
      injuryTax = Math.min(100, injuryTax + 10);
    }
  }

  // Check for trap patterns
  const trapSig = `basketball_nba:${params.propType}:${params.bookmaker}`;
  if (params.trapSignatures.has(trapSig)) {
    // Reduce all scores if this is a trap pattern
    valueScore = valueScore * 0.7;
    sharpScore = Math.max(0, sharpScore - 30);
  }

  // Calculate confidence score (average of key metrics)
  const confidenceScore = (
    valueScore * 0.2 +
    matchupScore * 0.15 +
    minutesScore * 0.15 +
    paceScore * 0.1 +
    accuracyScore * 0.25 +
    sharpScore * 0.15
  );

  // FINAL PVS SCORE: Weighted combination minus injury tax
  const rawFinalScore = (
    valueScore * 0.20 +
    matchupScore * 0.20 +
    minutesScore * 0.15 +
    paceScore * 0.10 +
    accuracyScore * 0.20 +
    sharpScore * 0.15
  );
  
  // Apply injury tax as a reduction
  const finalScore = Math.max(0, rawFinalScore - (injuryTax * 0.10));

  // Determine PVS Tier based on final score
  let tier: string;
  if (finalScore >= 85) {
    tier = 'GOD_TIER';
  } else if (finalScore >= 70) {
    tier = 'HIGH_VALUE';
  } else if (finalScore >= 55) {
    tier = 'MED_VOLATILITY';
  } else if (finalScore >= 40) {
    tier = 'RISKY';
  } else {
    tier = 'FADE';
  }

  // Override tier if trap pattern detected
  const trapSigCheck = `basketball_nba:${params.propType}:${params.bookmaker}`;
  if (params.trapSignatures.has(trapSigCheck) && tier !== 'FADE') {
    tier = 'FADE';
  }

  return {
    pvs_value_score: Math.round(valueScore * 100) / 100,
    pvs_matchup_score: Math.round(matchupScore * 100) / 100,
    pvs_minutes_score: Math.round(minutesScore * 100) / 100,
    pvs_pace_score: Math.round(paceScore * 100) / 100,
    pvs_accuracy_score: Math.round(accuracyScore * 100) / 100,
    pvs_sharp_score: Math.round(sharpScore * 100) / 100,
    pvs_injury_tax: Math.round(injuryTax * 100) / 100,
    pvs_confidence_score: Math.round(confidenceScore * 100) / 100,
    pvs_final_score: Math.round(finalScore * 100) / 100,
    pvs_tier: tier,
    true_line: null, // Can be calculated from game logs
    true_line_diff: null
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
      total_odds: 400,
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

async function createPVSParlays(supabase: any, props: UnifiedProp[]): Promise<void> {
  // Filter to only high-quality PVS props
  const pvsProps = props
    .filter(p => p.pvs_final_score >= 60 && p.pvs_tier !== 'FADE')
    .sort((a, b) => b.pvs_final_score - a.pvs_final_score);

  if (pvsProps.length < 2) {
    console.log('[UnifiedEngine] Not enough high-quality PVS props for parlays');
    return;
  }

  // Create "Safe 2-Leg" parlay from GOD_TIER and HIGH_VALUE props
  const safeLegProps = pvsProps.filter(p => p.pvs_tier === 'GOD_TIER' || p.pvs_tier === 'HIGH_VALUE').slice(0, 2);
  if (safeLegProps.length === 2) {
    const safeLegs = safeLegProps.map(p => ({
      player_name: p.player_name,
      prop_type: p.prop_type,
      line: p.current_line,
      side: p.recommended_side || 'over',
      pvs_score: p.pvs_final_score,
      tier: p.pvs_tier,
      game: p.game_description,
      event_id: p.event_id
    }));

    await supabase.from('pvs_parlays').upsert({
      parlay_type: 'safe_2leg',
      legs: safeLegs,
      combined_pvs_score: safeLegs.reduce((sum, leg) => sum + leg.pvs_score, 0) / safeLegs.length,
      combined_probability: safeLegProps.reduce((acc, p) => acc * (p.pvs_confidence_score / 100), 1),
      total_odds: 250,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      is_active: true
    }, { onConflict: 'parlay_type' });
  }

  // Create "Value 3-Leg" parlay from HIGH_VALUE and MED_VOLATILITY props
  const valueLegProps = pvsProps.filter(p => p.pvs_tier === 'HIGH_VALUE' || p.pvs_tier === 'MED_VOLATILITY').slice(0, 3);
  if (valueLegProps.length === 3) {
    const valueLegs = valueLegProps.map(p => ({
      player_name: p.player_name,
      prop_type: p.prop_type,
      line: p.current_line,
      side: p.recommended_side || 'over',
      pvs_score: p.pvs_final_score,
      tier: p.pvs_tier,
      game: p.game_description,
      event_id: p.event_id
    }));

    await supabase.from('pvs_parlays').upsert({
      parlay_type: 'value_3leg',
      legs: valueLegs,
      combined_pvs_score: valueLegs.reduce((sum, leg) => sum + leg.pvs_score, 0) / valueLegs.length,
      combined_probability: valueLegProps.reduce((acc, p) => acc * (p.pvs_confidence_score / 100), 1),
      total_odds: 450,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      is_active: true
    }, { onConflict: 'parlay_type' });
  }

  // Create "Degen 4-Leg" parlay from mixed tiers with high scores
  const degenLegProps = pvsProps.slice(0, 4);
  if (degenLegProps.length === 4) {
    const degenLegs = degenLegProps.map(p => ({
      player_name: p.player_name,
      prop_type: p.prop_type,
      line: p.current_line,
      side: p.recommended_side || 'over',
      pvs_score: p.pvs_final_score,
      tier: p.pvs_tier,
      game: p.game_description,
      event_id: p.event_id
    }));

    await supabase.from('pvs_parlays').upsert({
      parlay_type: 'degen_4leg',
      legs: degenLegs,
      combined_pvs_score: degenLegs.reduce((sum, leg) => sum + leg.pvs_score, 0) / degenLegs.length,
      combined_probability: degenLegProps.reduce((acc, p) => acc * (p.pvs_confidence_score / 100), 1),
      total_odds: 800,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      is_active: true
    }, { onConflict: 'parlay_type' });
  }

  console.log('[UnifiedEngine] Created PVS parlays:', {
    safe2Leg: safeLegProps.length === 2,
    value3Leg: valueLegProps.length === 3,
    degen4Leg: degenLegProps.length === 4
  });
}
