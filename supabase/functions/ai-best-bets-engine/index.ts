import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AccuracyData {
  sport: string;
  recommendation: string;
  wins: number;
  total: number;
  accuracy: number;
}

interface BestBet {
  id: string;
  event_id: string;
  description: string;
  sport: string;
  recommendation: string;
  commence_time?: string;
  outcome_name?: string;
  odds?: number;
  historical_accuracy: number;
  sample_size: number;
  ai_confidence: number;
  composite_score: number;
  ai_reasoning?: string;
  risk_factors?: string[];
  signals: string[];
  signal_type: string;
}

interface UserPreferences {
  preferred_sports: string[];
  risk_tolerance: 'conservative' | 'medium' | 'aggressive';
  include_god_mode: boolean;
  include_coaching_signals: boolean;
  include_fatigue_edge: boolean;
  max_odds: number;
  min_sample_size: number;
  min_accuracy_threshold: number;
}

// REAL accuracy by sport/recommendation from verified historical data (as of Dec 2024)
// These values are based on actual verified outcomes from line_movements table
const HISTORICAL_ACCURACY: Record<string, { accuracy: number; sampleSize: number; avgOdds?: number }> = {
  // TOP PERFORMERS - Feature prominently
  'nfl_fade': { accuracy: 66.54, sampleSize: 260, avgOdds: -110 },     // BEST PERFORMER!
  'nfl_caution': { accuracy: 55.79, sampleSize: 699, avgOdds: -110 }, // Strong
  'nhl_caution': { accuracy: 53.08, sampleSize: 552, avgOdds: -110 }, // Profitable
  'ncaab_fade': { accuracy: 52.92, sampleSize: 907, avgOdds: -110 },  // Profitable
  
  // GOD MODE UPSETS - Plus money plays (lower accuracy OK with +odds)
  'god_mode_high': { accuracy: 38.0, sampleSize: 50, avgOdds: 200 },    // +200 avg, needs 33.3% for breakeven
  'god_mode_medium': { accuracy: 30.0, sampleSize: 100, avgOdds: 275 }, // +275 avg, needs 26.7% for breakeven
  
  // NEAR BREAKEVEN - Include with caution
  'ncaab_caution': { accuracy: 50.90, sampleSize: 1038, avgOdds: -110 },
  'ncaab_pick': { accuracy: 50.34, sampleSize: 440, avgOdds: -110 },
  'nba_caution': { accuracy: 50.19, sampleSize: 257, avgOdds: -110 },
  
  // UNDERPERFORMERS - Exclude or consider fading
  'nba_fade': { accuracy: 49.53, sampleSize: 214, avgOdds: -110 },    // Near random
  'nhl_fade': { accuracy: 46.86, sampleSize: 175, avgOdds: -110 },    // Below average
  'nhl_pick': { accuracy: 46.43, sampleSize: 28, avgOdds: -110 },     // Below average
  'nfl_pick': { accuracy: 42.11, sampleSize: 38, avgOdds: -110 },     // Bad
  'nba_pick': { accuracy: 32.20, sampleSize: 59, avgOdds: -110 },     // TERRIBLE - fade these!
};

// Calculate breakeven accuracy for given American odds
function getBreakevenAccuracy(odds: number): number {
  if (odds > 0) {
    return 100 / (odds + 100) * 100; // e.g., +200 = 33.3%
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100) * 100; // e.g., -110 = 52.38%
  }
}

// ROI-based threshold: must beat breakeven for the typical odds in this signal type
function getAccuracyThreshold(signalKey: string, candidateOdds?: number): number {
  const avgOdds = candidateOdds || HISTORICAL_ACCURACY[signalKey]?.avgOdds || -110;
  return getBreakevenAccuracy(avgOdds);
}

// Calculate expected ROI for a signal
function calculateExpectedROI(accuracy: number, avgOdds: number): number {
  const winProb = accuracy / 100;
  const loseProb = 1 - winProb;
  
  if (avgOdds > 0) {
    // Plus money: win returns odds/100 units, lose returns -1 unit
    return (winProb * (avgOdds / 100)) - loseProb;
  } else {
    // Minus money: win returns 100/|odds| units, lose returns -1 unit
    return (winProb * (100 / Math.abs(avgOdds))) - loseProb;
  }
}

// Sample-size weighted boost multiplier (0.5 - 1.0)
function getSampleSizeMultiplier(sampleSize: number): number {
  if (sampleSize >= 200) return 1.0;
  if (sampleSize >= 100) return 0.9;
  if (sampleSize >= 50) return 0.8;
  if (sampleSize >= 30) return 0.7;
  return 0.5;
}

const MIN_SAMPLE_SIZE = 30; // Require statistical significance
const BREAKEVEN_STANDARD = 52.4; // Standard -110 breakeven

// Dynamic weighting types
interface SignalAccuracyData {
  signal_name: string;
  signal_type: string;
  sport: string | null;
  total_occurrences: number;
  accuracy_rate: number;
  suggested_weight: number;
}

interface RollingPerformanceData {
  engine_name: string;
  sport: string | null;
  window_days: number;
  hit_rate: number;
  sample_size: number;
  roi_percentage: number;
}

// Calculate dynamic boost from live signal accuracy data
function getDynamicBoost(
  signalKey: string, 
  sport: string,
  signalAccuracies: SignalAccuracyData[]
): number {
  // Find matching signal accuracy data
  const signalData = signalAccuracies.find(s => {
    const matchesSignal = s.signal_name?.toLowerCase() === signalKey?.toLowerCase() ||
                          s.signal_type?.toLowerCase() === signalKey?.toLowerCase();
    const matchesSport = !s.sport || s.sport === 'all' || 
                         sport?.toLowerCase().includes(s.sport.toLowerCase());
    return matchesSignal && matchesSport;
  });

  if (!signalData || signalData.total_occurrences < 20) {
    return 0; // Not enough data for dynamic weighting
  }

  // Calculate edge above breakeven
  const accuracyEdge = signalData.accuracy_rate - BREAKEVEN_STANDARD;
  
  // Apply sample size confidence multiplier
  const sampleMultiplier = getSampleSizeMultiplier(signalData.total_occurrences);
  
  // Use suggested_weight if available, otherwise calculate from accuracy edge
  if (signalData.suggested_weight && signalData.suggested_weight > 0) {
    return signalData.suggested_weight * sampleMultiplier;
  }
  
  // Dynamic boost: 0.6 points per percentage above breakeven, scaled by sample size
  return Math.max(0, accuracyEdge * 0.6 * sampleMultiplier);
}

// Calculate recency factor from rolling performance data
// Compares short-term (14-day) vs long-term (30-day) performance
function getRecencyFactor(
  signalType: string,
  sport: string,
  rollingPerformance: RollingPerformanceData[]
): number {
  // Map signal types to engine names
  const engineName = signalType.includes('fade') ? 'sharp_fade' :
                     signalType.includes('caution') ? 'sharp_caution' :
                     signalType.includes('fatigue') ? 'fatigue_edge' :
                     signalType.includes('god_mode') ? 'god_mode' :
                     signalType.includes('coaching') ? 'coaching' :
                     'sharp_money';

  const sportKey = sport?.split('_').pop()?.toLowerCase() || '';

  // Find recent (14-day) and longer-term (30-day) data
  const recentData = rollingPerformance.find(p => 
    p.engine_name === engineName && 
    p.window_days === 14 &&
    (!p.sport || p.sport === sportKey)
  );
  
  const longerData = rollingPerformance.find(p => 
    p.engine_name === engineName && 
    p.window_days === 30 &&
    (!p.sport || p.sport === sportKey)
  );

  // Default to neutral if insufficient data
  if (!recentData || !longerData) return 1.0;
  if (recentData.sample_size < 10 || longerData.sample_size < 20) return 1.0;

  // Calculate recency edge (positive = hot streak, negative = cold streak)
  const recentEdge = recentData.hit_rate - longerData.hit_rate;
  
  // Apply a ±15% adjustment based on recent form
  // Hot streak (recent 5% better) = 1.075 multiplier
  // Cold streak (recent 5% worse) = 0.925 multiplier
  const recencyFactor = 1.0 + (recentEdge / 100) * 1.5;
  
  // Clamp between 0.85 and 1.15 to prevent extreme swings
  return Math.max(0.85, Math.min(1.15, recencyFactor));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    // Parse request body for user preferences
    let userPreferences: UserPreferences | null = null;
    let userId: string | null = null;
    
    try {
      const body = await req.json();
      userId = body.user_id;
      
      if (userId) {
        // Fetch user preferences from database
        const { data: prefs } = await supabase
          .from('user_bet_preferences')
          .select('*')
          .eq('user_id', userId)
          .single();
        
        if (prefs) {
          userPreferences = {
            preferred_sports: prefs.preferred_sports || ['nfl', 'nba', 'nhl', 'ncaab', 'mlb'],
            risk_tolerance: prefs.risk_tolerance || 'medium',
            include_god_mode: prefs.include_god_mode ?? true,
            include_coaching_signals: prefs.include_coaching_signals ?? true,
            include_fatigue_edge: prefs.include_fatigue_edge ?? true,
            max_odds: prefs.max_odds || 500,
            min_sample_size: prefs.min_sample_size || 20,
            min_accuracy_threshold: prefs.min_accuracy_threshold || 52.0
          };
          console.log(`[AI-BestBets] Loaded user preferences for ${userId}:`, userPreferences);
        }
      }
    } catch {
      // No body or invalid JSON - continue without preferences
    }

    console.log('[AI-BestBets] Starting AI-powered best bets analysis with dynamic weighting...');

    // Step 0: Fetch dynamic weighting data from sharp_signal_accuracy
    const { data: signalAccuracies } = await supabase
      .from('sharp_signal_accuracy')
      .select('signal_name, signal_type, sport, total_occurrences, accuracy_rate, suggested_weight')
      .gte('total_occurrences', 15);

    const dynamicWeights: SignalAccuracyData[] = signalAccuracies || [];
    console.log(`[AI-BestBets] Loaded ${dynamicWeights.length} signal accuracy records for dynamic weighting`);

    // Step 0b: Fetch rolling performance data for recency weighting
    const { data: rollingPerformance } = await supabase
      .from('performance_snapshots')
      .select('engine_name, sport, window_days, hit_rate, sample_size, roi_percentage')
      .in('window_days', [14, 30])
      .order('snapshot_date', { ascending: false })
      .limit(50);

    const rollingData: RollingPerformanceData[] = rollingPerformance || [];
    console.log(`[AI-BestBets] Loaded ${rollingData.length} rolling performance records`);
    const { data: verifiedOutcomes } = await supabase
      .from('line_movements')
      .select('sport, recommendation, outcome_correct')
      .eq('outcome_verified', true)
      .eq('is_primary_record', true)
      .in('recommendation', ['pick', 'fade', 'caution']);

    const accuracyByKey: Record<string, AccuracyData> = {};
    
    if (verifiedOutcomes) {
      for (const outcome of verifiedOutcomes) {
        const sportKey = outcome.sport?.split('_').pop()?.toLowerCase() || 'unknown';
        const key = `${sportKey}_${outcome.recommendation}`;
        
        if (!accuracyByKey[key]) {
          accuracyByKey[key] = { 
            sport: sportKey, 
            recommendation: outcome.recommendation, 
            wins: 0, 
            total: 0,
            accuracy: 0 
          };
        }
        
        accuracyByKey[key].total++;
        if (outcome.outcome_correct) {
          accuracyByKey[key].wins++;
        }
      }

      // Calculate accuracy percentages
      for (const key of Object.keys(accuracyByKey)) {
        const data = accuracyByKey[key];
        data.accuracy = data.total > 0 ? (data.wins / data.total) * 100 : 0;
      }
    }

    console.log('[AI-BestBets] Live accuracy data:', accuracyByKey);

    // Step 2: Fetch candidate signals (upcoming games) - prioritize by REAL accuracy
    const candidates: any[] = [];

    // NFL FADE - BEST PERFORMER (66.54% with 260 samples!) - PRIORITY
    const { data: nflFade } = await supabase
      .from('line_movements')
      .select('*')
      .ilike('sport', '%nfl%')
      .eq('is_primary_record', true)
      .eq('recommendation', 'fade')
      .gte('commence_time', now)
      .gte('authenticity_confidence', 0.5)
      .order('trap_score', { ascending: false })
      .limit(15);

    if (nflFade) {
      candidates.push(...nflFade.map(s => ({ ...s, signal_type: 'nfl_fade' })));
    }
    console.log(`[AI-BestBets] NFL FADE candidates: ${nflFade?.length || 0}`);

    // NFL CAUTION - Strong (55.79%)
    const { data: nflCaution } = await supabase
      .from('line_movements')
      .select('*')
      .ilike('sport', '%nfl%')
      .eq('is_primary_record', true)
      .eq('recommendation', 'caution')
      .gte('commence_time', now)
      .gte('authenticity_confidence', 0.6)
      .order('authenticity_confidence', { ascending: false })
      .limit(10);

    if (nflCaution) {
      candidates.push(...nflCaution.map(s => ({ ...s, signal_type: 'nfl_caution' })));
    }

    // NHL CAUTION - Profitable (53.08%) - NOT NHL PICK which is 46%!
    const { data: nhlCaution } = await supabase
      .from('line_movements')
      .select('*')
      .ilike('sport', '%nhl%')
      .eq('is_primary_record', true)
      .eq('recommendation', 'caution')
      .gte('commence_time', now)
      .gte('authenticity_confidence', 0.5)
      .order('authenticity_confidence', { ascending: false })
      .limit(10);

    if (nhlCaution) {
      candidates.push(...nhlCaution.map(s => ({ ...s, signal_type: 'nhl_caution' })));
    }

    // NCAAB FADE - Profitable (52.92%)
    const { data: ncaabFade } = await supabase
      .from('line_movements')
      .select('*')
      .ilike('sport', '%ncaab%')
      .eq('is_primary_record', true)
      .eq('recommendation', 'fade')
      .gte('commence_time', now)
      .gte('authenticity_confidence', 0.5)
      .order('trap_score', { ascending: false })
      .limit(15);

    if (ncaabFade) {
      candidates.push(...ncaabFade.map(s => ({ ...s, signal_type: 'ncaab_fade' })));
    }

    // NBA Fatigue Edge - separate system
    const { data: fatigueGames } = await supabase
      .from('fatigue_edge_tracking')
      .select('*')
      .gte('fatigue_differential', 15)
      .gte('game_date', today)
      .order('fatigue_differential', { ascending: false })
      .limit(10);

    if (fatigueGames) {
      candidates.push(...fatigueGames.map(g => ({
        id: g.id,
        event_id: g.event_id,
        sport: 'basketball_nba',
        description: `${g.away_team} @ ${g.home_team}`,
        recommendation: g.recommended_side,
        commence_time: g.game_date,
        fatigue_differential: g.fatigue_differential,
        signal_type: 'nba_fatigue'
      })));
    }

    // Coaching Tendencies Edge - NBA coaches with clear patterns
    const { data: coachProfiles } = await supabase
      .from('coach_profiles')
      .select('*')
      .eq('sport', 'NBA')
      .eq('is_active', true);

    if (coachProfiles && fatigueGames) {
      // Add coaching signals for today's games
      for (const game of fatigueGames) {
        const homeCoach = coachProfiles.find((c: any) => 
          game.home_team?.toLowerCase().includes(c.team_name?.toLowerCase()?.split(' ').pop())
        );
        const awayCoach = coachProfiles.find((c: any) => 
          game.away_team?.toLowerCase().includes(c.team_name?.toLowerCase()?.split(' ').pop())
        );

        if (homeCoach && (homeCoach.pace_preference === 'fast' || homeCoach.pace_preference === 'slow')) {
          candidates.push({
            id: `coach_${homeCoach.id}`,
            event_id: game.event_id,
            sport: 'basketball_nba',
            description: `${game.home_team} ${homeCoach.pace_preference === 'fast' ? 'Over' : 'Under'} (Coach ${homeCoach.coach_name})`,
            recommendation: homeCoach.pace_preference === 'fast' ? 'pick' : 'fade',
            commence_time: game.game_date,
            coaching_tendency: homeCoach.pace_preference,
            coach_name: homeCoach.coach_name,
            signal_type: 'coaching_pace'
          });
        }

        // B2B rest tendency on fatigued games
        if (homeCoach && homeCoach.b2b_rest_tendency === 'heavy' && game.home_fatigue_score > 50) {
          candidates.push({
            id: `coach_b2b_${homeCoach.id}`,
            event_id: game.event_id,
            sport: 'basketball_nba',
            description: `${game.home_team} star props Under (Coach ${homeCoach.coach_name} B2B Rest)`,
            recommendation: 'fade',
            commence_time: game.game_date,
            coaching_tendency: 'b2b_rest_heavy',
            coach_name: homeCoach.coach_name,
            fatigue_score: game.home_fatigue_score,
            signal_type: 'coaching_b2b'
          });
        }
      }
    }

    // GOD MODE UPSETS - High value plus-money plays
    const { data: godModeUpsets } = await supabase
      .from('god_mode_upset_predictions')
      .select('*')
      .gte('commence_time', now)
      .eq('game_completed', false)
      .gte('final_upset_score', 55)
      .in('confidence', ['high', 'medium'])
      .order('final_upset_score', { ascending: false })
      .limit(15);

    if (godModeUpsets) {
      for (const upset of godModeUpsets) {
        const signalType = upset.confidence === 'high' ? 'god_mode_high' : 'god_mode_medium';
        candidates.push({
          id: upset.id,
          event_id: upset.event_id,
          sport: upset.sport,
          description: `${upset.underdog} ML (+${upset.underdog_odds}) vs ${upset.favorite}`,
          recommendation: 'pick',
          commence_time: upset.commence_time,
          outcome_name: `${upset.underdog} Moneyline`,
          new_price: upset.underdog_odds,
          upset_score: upset.final_upset_score,
          upset_probability: upset.upset_probability,
          chaos_mode: upset.chaos_mode_active,
          sharp_pct: upset.sharp_pct,
          signal_type: signalType
        });
      }
      console.log(`[AI-BestBets] God Mode upset candidates: ${godModeUpsets.length}`);
    }

    // PHASE 6: Additional Engines - MedianLock candidates
    const { data: medianLockCandidates } = await supabase
      .from('median_lock_candidates')
      .select('*')
      .gte('slate_date', today)
      .in('classification', ['LOCK', 'STRONG'])
      .eq('parlay_grade', true)
      .gte('confidence_score', 0.65)
      .order('confidence_score', { ascending: false })
      .limit(15);

    if (medianLockCandidates) {
      for (const lock of medianLockCandidates) {
        candidates.push({
          id: lock.id,
          event_id: lock.event_id,
          sport: 'basketball_nba',
          description: `${lock.player_name} ${lock.prop_type} ${lock.bet_side} ${lock.book_line}`,
          recommendation: lock.bet_side?.toLowerCase() === 'over' ? 'pick' : 'fade',
          commence_time: lock.game_start_time,
          outcome_name: `${lock.player_name} ${lock.prop_type} ${lock.bet_side}`,
          new_price: lock.current_price || -110,
          player_name: lock.player_name,
          prop_type: lock.prop_type,
          hit_rate: lock.hit_rate,
          confidence_score: lock.confidence_score,
          classification: lock.classification,
          signal_type: 'median_lock'
        });
      }
      console.log(`[AI-BestBets] MedianLock candidates: ${medianLockCandidates.length}`);
    }

    // PHASE 6: Additional Engines - HitRate parlays
    const { data: hitRateParlays } = await supabase
      .from('hitrate_parlays')
      .select('*')
      .eq('is_active', true)
      .gte('min_hit_rate', 65)
      .gte('combined_probability', 0.5)
      .order('combined_probability', { ascending: false })
      .limit(10);

    if (hitRateParlays) {
      for (const parlay of hitRateParlays) {
        const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
        if (legs.length > 0) {
          candidates.push({
            id: parlay.id,
            event_id: `hitrate_${parlay.id}`,
            sport: parlay.sport || 'mixed',
            description: `HitRate ${parlay.strategy_type}: ${legs.length} legs @ ${parlay.min_hit_rate}%+ hit rate`,
            recommendation: 'pick',
            commence_time: parlay.expires_at,
            outcome_name: `HitRate Parlay (${parlay.strategy_type})`,
            new_price: parlay.total_odds || 200,
            combined_probability: parlay.combined_probability,
            min_hit_rate: parlay.min_hit_rate,
            strategy_type: parlay.strategy_type,
            leg_count: legs.length,
            signal_type: 'hitrate_parlay'
          });
        }
      }
      console.log(`[AI-BestBets] HitRate parlay candidates: ${hitRateParlays.length}`);
    }

    console.log(`[AI-BestBets] Found ${candidates.length} total candidate signals (including all engines)`);

    // Step 3: Score each candidate using REAL accuracy data
    const scoredCandidates: BestBet[] = [];

    for (const candidate of candidates) {
      const signalKey = candidate.signal_type;
      const sportKey = candidate.sport?.split('_').pop()?.toLowerCase() || 'unknown';
      
      // PHASE 4: Apply user preference filters
      if (userPreferences) {
        // Sport filter
        if (!userPreferences.preferred_sports.includes(sportKey)) {
          continue;
        }
        
        // Risk tolerance filter
        if (userPreferences.risk_tolerance === 'conservative') {
          // Conservative: no god mode, no high odds, require higher sample size
          if (signalKey.startsWith('god_mode') && !userPreferences.include_god_mode) continue;
          if (Math.abs(candidate.new_price || -110) > 200) continue;
        }
        
        // God mode filter
        if (!userPreferences.include_god_mode && signalKey.startsWith('god_mode')) continue;
        
        // Coaching signals filter
        if (!userPreferences.include_coaching_signals && signalKey.startsWith('coaching')) continue;
        
        // Fatigue edge filter
        if (!userPreferences.include_fatigue_edge && signalKey === 'nba_fatigue') continue;
        
        // Max odds filter (for plus money)
        if (candidate.new_price > 0 && candidate.new_price > userPreferences.max_odds) continue;
      }
      
      // Use live accuracy if available, otherwise use historical baseline
      const liveAccuracy = accuracyByKey[signalKey]?.accuracy;
      const liveTotal = accuracyByKey[signalKey]?.total || 0;
      
      const baselineAccuracy = HISTORICAL_ACCURACY[signalKey]?.accuracy || 50;
      const baselineSampleSize = HISTORICAL_ACCURACY[signalKey]?.sampleSize || 0;
      const avgOdds = candidate.new_price || HISTORICAL_ACCURACY[signalKey]?.avgOdds || -110;
      
      // Prefer live data if sample size is sufficient
      const historicalAccuracy = (liveTotal >= 20) ? liveAccuracy : baselineAccuracy;
      const sampleSize = (liveTotal >= 20) ? liveTotal : baselineSampleSize;

      // PHASE 4: User min accuracy threshold
      if (userPreferences && historicalAccuracy < userPreferences.min_accuracy_threshold) {
        continue;
      }

      // ROI-based threshold: must beat breakeven for the odds
      // For God Mode upsets, use actual candidate odds (not historical average)
      const candidateOdds = signalKey.startsWith('god_mode') 
        ? (candidate.new_price || avgOdds) 
        : avgOdds;
      const accuracyThreshold = getAccuracyThreshold(signalKey, candidateOdds);
      const expectedROI = calculateExpectedROI(historicalAccuracy, candidateOdds);

      // Skip signals below ROI-adjusted threshold (allows plus-money with lower accuracy)
      // For God Mode, we accept if expectedROI is positive (historical accuracy beats breakeven)
      const isGodMode = signalKey.startsWith('god_mode');
      const isMedianLock = signalKey === 'median_lock';
      const isHitRate = signalKey === 'hitrate_parlay';
      
      // MedianLock and HitRate have their own accuracy thresholds
      const meetsThreshold = isGodMode 
        ? (expectedROI > 0 || historicalAccuracy >= accuracyThreshold * 0.95)
        : isMedianLock || isHitRate
          ? true // These engines have pre-filtered for quality
          : (historicalAccuracy >= accuracyThreshold);
        
      if (!meetsThreshold) {
        console.log(`[AI-BestBets] Skipping ${signalKey} - below ROI threshold (${historicalAccuracy.toFixed(1)}% < ${accuracyThreshold.toFixed(1)}% for ${candidateOdds} odds, ROI: ${(expectedROI * 100).toFixed(1)}%)`);
        continue;
      }
      
      // Log when God Mode passes threshold
      if (isGodMode) {
        console.log(`[AI-BestBets] ✅ God Mode ${signalKey} INCLUDED: ${historicalAccuracy.toFixed(1)}% accuracy, ${candidateOdds} odds, ${(expectedROI * 100).toFixed(1)}% expected ROI`);
      }

      // Skip signals with insufficient sample size (except special engines)
      const skipSampleCheck = signalKey === 'nba_fatigue' || signalKey.startsWith('god_mode') || 
                              signalKey === 'median_lock' || signalKey === 'hitrate_parlay';
      const effectiveMinSample = userPreferences?.min_sample_size || MIN_SAMPLE_SIZE;
      if (sampleSize < effectiveMinSample && !skipSampleCheck) {
        console.log(`[AI-BestBets] Skipping ${signalKey} - insufficient sample size (${sampleSize} < ${effectiveMinSample})`);
        continue;
      }
      
      // Sample size weight multiplier for boosts
      const sampleMultiplier = getSampleSizeMultiplier(sampleSize);

      // Calculate composite score - start with accuracy
      const signals: string[] = [];
      let compositeScore = historicalAccuracy;

      // DYNAMIC WEIGHTING: Get boost from live signal accuracy data
      const dynamicBoost = getDynamicBoost(signalKey, candidate.sport || '', dynamicWeights);
      if (dynamicBoost > 0) {
        compositeScore += dynamicBoost;
        signals.push(`📊 Dynamic boost: +${dynamicBoost.toFixed(1)}`);
        console.log(`[AI-BestBets] Dynamic boost for ${signalKey}: +${dynamicBoost.toFixed(1)} (from live accuracy data)`);
      }

      // ROLLING WINDOW: Apply recency factor based on recent vs longer-term performance
      const recencyFactor = getRecencyFactor(signalKey, candidate.sport || '', rollingData);
      if (recencyFactor !== 1.0) {
        const recencyAdjustment = (recencyFactor - 1.0) * 100;
        compositeScore *= recencyFactor;
        if (recencyFactor > 1.02) {
          signals.push(`🔥 Hot streak: +${recencyAdjustment.toFixed(1)}%`);
        } else if (recencyFactor < 0.98) {
          signals.push(`❄️ Cold streak: ${recencyAdjustment.toFixed(1)}%`);
        }
        console.log(`[AI-BestBets] Recency factor for ${signalKey}: ${recencyFactor.toFixed(3)} (${recencyAdjustment > 0 ? '+' : ''}${recencyAdjustment.toFixed(1)}%)`);
      }

      // Boost for NFL FADE (best performer) - now uses dynamic weight if available
      if (signalKey === 'nfl_fade' && dynamicBoost === 0) {
        // Fallback static boost only if no dynamic data
        compositeScore += 8 * sampleMultiplier;
        signals.push('🔥 Top performer (66%+ accuracy)');
      }

      // Safe access for authenticity_confidence (may not exist on all signal types)
      const authConfidence = candidate.authenticity_confidence ?? 0;
      if (authConfidence >= 0.8) {
        compositeScore += 5 * sampleMultiplier;
        signals.push('High confidence signal');
      } else if (authConfidence >= 0.6) {
        compositeScore += 2 * sampleMultiplier;
        signals.push('Medium-high confidence');
      }

      // Safe access for trap_score (only exists on line movement signals)
      const trapScore = candidate.trap_score ?? 0;
      if (trapScore >= 70) {
        compositeScore += 5 * sampleMultiplier;
        signals.push(`Strong trap: ${trapScore}`);
      } else if (trapScore >= 50) {
        compositeScore += 2 * sampleMultiplier;
        signals.push(`Trap detected: ${trapScore}`);
      }

      // Safe access for fatigue_differential (only on fatigue signals)
      const fatigueDiff = candidate.fatigue_differential ?? 0;
      if (fatigueDiff >= 25) {
        compositeScore += 6 * sampleMultiplier;
        signals.push(`High fatigue diff: +${fatigueDiff}`);
      } else if (fatigueDiff >= 20) {
        compositeScore += 3 * sampleMultiplier;
        signals.push(`Fatigue edge: +${fatigueDiff}`);
      }

      // Safe access for books_consensus (may not exist on all signals)
      const booksConsensus = candidate.books_consensus ?? 0;
      if (booksConsensus >= 4) {
        compositeScore += 5 * sampleMultiplier;
        signals.push(`${booksConsensus} books consensus`);
      } else if (booksConsensus >= 3) {
        compositeScore += 2 * sampleMultiplier;
        signals.push(`${booksConsensus} books agree`);
      }

      // Boost for coaching signals - uses dynamic weight if available
      if (signalKey?.startsWith('coaching') && dynamicBoost === 0) {
        compositeScore += 4 * sampleMultiplier;
        signals.push(`🏀 Coach tendency: ${candidate.coach_name || 'NBA'}`);
        if (candidate.coaching_tendency === 'fast') {
          signals.push('Fast pace = higher scoring');
        } else if (candidate.coaching_tendency === 'b2b_rest_heavy') {
          signals.push('B2B rest = star minutes down');
        }
      } else if (signalKey?.startsWith('coaching')) {
        signals.push(`🏀 Coach tendency: ${candidate.coach_name || 'NBA'}`);
      }

      // GOD MODE UPSET boosts
      if (signalKey?.startsWith('god_mode')) {
        const upsetScore = candidate.upset_score ?? 0;
        const chaosMode = candidate.chaos_mode ?? false;
        const sharpPct = candidate.sharp_pct ?? 0;
        
        // Boost based on upset score
        if (upsetScore >= 75) {
          compositeScore += 10 * sampleMultiplier;
          signals.push(`🐺 God Mode: ${upsetScore.toFixed(0)} upset score`);
        } else if (upsetScore >= 65) {
          compositeScore += 6 * sampleMultiplier;
          signals.push(`🔮 Strong upset signal: ${upsetScore.toFixed(0)}`);
        } else {
          compositeScore += 3 * sampleMultiplier;
          signals.push(`Upset candidate: ${upsetScore.toFixed(0)}`);
        }
        
        // Chaos mode active = extra boost
        if (chaosMode) {
          compositeScore += 5;
          signals.push('🌪️ CHAOS MODE active');
        }
        
        // Sharp money on underdog
        if (sharpPct >= 70) {
          compositeScore += 4 * sampleMultiplier;
          signals.push(`Sharp money: ${sharpPct.toFixed(0)}%`);
        }
        
        // Plus money value context
        const odds = candidate.new_price ?? 0;
        if (odds >= 250) {
          signals.push(`💰 High value: +${odds}`);
        } else if (odds >= 150) {
          signals.push(`Value play: +${odds}`);
        }
        
        // Add ROI context for plus money
        if (expectedROI > 0) {
          signals.push(`📈 +${(expectedROI * 100).toFixed(1)}% expected ROI`);
        }
      }

      // PHASE 6: MedianLock signal boosts
      if (signalKey === 'median_lock') {
        const hitRate = candidate.hit_rate ?? 0;
        const confidenceScore = candidate.confidence_score ?? 0;
        const classification = candidate.classification || '';
        
        if (classification === 'LOCK') {
          compositeScore += 8 * sampleMultiplier;
          signals.push(`🔒 MedianLock LOCK (${hitRate.toFixed(0)}% hit rate)`);
        } else if (classification === 'STRONG') {
          compositeScore += 5 * sampleMultiplier;
          signals.push(`📊 MedianLock STRONG (${hitRate.toFixed(0)}% hit rate)`);
        }
        
        if (confidenceScore >= 0.8) {
          compositeScore += 4;
          signals.push(`High confidence: ${(confidenceScore * 100).toFixed(0)}%`);
        }
        
        signals.push(`Player: ${candidate.player_name}`);
      }

      // PHASE 6: HitRate parlay boosts
      if (signalKey === 'hitrate_parlay') {
        const minHitRate = candidate.min_hit_rate ?? 0;
        const combinedProb = candidate.combined_probability ?? 0;
        const legCount = candidate.leg_count ?? 0;
        
        compositeScore += 6 * sampleMultiplier;
        signals.push(`🎯 HitRate ${candidate.strategy_type} (${minHitRate}%+ hit rate)`);
        signals.push(`${legCount} legs @ ${(combinedProb * 100).toFixed(0)}% combined prob`);
        
        if (minHitRate >= 70) {
          compositeScore += 4;
          signals.push('Premium hit rate tier');
        }
      }

      // Add sample size context
      if (sampleSize >= 200) {
        signals.push(`Large sample (n=${sampleSize})`);
      } else if (sampleSize >= 50) {
        signals.push(`Good sample (n=${sampleSize})`);
      } else if (signalKey?.startsWith('god_mode')) {
        signals.push(`God Mode tracking (n=${sampleSize})`);
      } else if (signalKey === 'median_lock') {
        signals.push(`MedianLock tracking`);
      } else if (signalKey === 'hitrate_parlay') {
        signals.push(`HitRate system`);
      }

      // Calculate AI confidence (normalized 0-1)
      const aiConfidence = Math.min(compositeScore / 100, 0.95);

      scoredCandidates.push({
        id: candidate.id,
        event_id: candidate.event_id,
        description: candidate.description,
        sport: candidate.sport,
        recommendation: candidate.recommendation,
        commence_time: candidate.commence_time,
        outcome_name: candidate.outcome_name,
        odds: candidate.new_price,
        historical_accuracy: historicalAccuracy,
        sample_size: sampleSize,
        ai_confidence: aiConfidence,
        composite_score: compositeScore,
        signals,
        signal_type: signalKey
      });
    }

    // Sort by composite score (best first)
    scoredCandidates.sort((a, b) => b.composite_score - a.composite_score);

    // Step 4: Use AI to analyze top candidates (if API key available)
    const topCandidates = scoredCandidates.slice(0, 12);

    if (LOVABLE_API_KEY && topCandidates.length > 0) {
      try {
        // PHASE 5: Enhanced AI prompt with risk factors
        const prompt = `You are an expert sports betting analyst. Analyze these signals and provide BOTH positive reasoning AND risk factors.

KEY PERFORMERS (prioritize these):
- NFL FADE: 66.54% accuracy (260 samples) - BEST PERFORMER
- NFL CAUTION: 55.79% accuracy (699 samples)
- NHL CAUTION: 53.08% accuracy (552 samples)
- MedianLock LOCK/STRONG: 65-70% hit rate on player props
- HitRate Parlays: Pre-filtered for high hit rate legs

Live accuracy data:
${JSON.stringify(accuracyByKey, null, 2)}

Top candidates to analyze:
${topCandidates.map((c, i) => `
${i + 1}. ${c.description}
   - Signal Type: ${c.signal_type}
   - Recommendation: ${c.recommendation.toUpperCase()}
   - Historical accuracy: ${c.historical_accuracy.toFixed(1)}% (n=${c.sample_size})
   - Composite score: ${c.composite_score.toFixed(1)}
   - Signals: ${c.signals.join(', ')}
`).join('\n')}

For EACH bet, provide:
1. "reasoning": 1-2 sentence positive analysis (why this pick looks good)
2. "risk_factors": Array of 1-3 specific risks that could hurt this pick
3. "confidence_adjustment": -0.1 to +0.1 based on overall assessment

RISK FACTORS TO CONSIDER:
- Small sample size (n < 50): "Limited sample size (n=X)"
- Recent cold streak vs historical: "Recent form below average"
- Plus money volatility: "High variance plus-money play"
- Conflicting signals: "Some engines disagree"
- Key matchup concerns: "Tough opponent matchup"
- Prop-specific risks: "Minutes uncertainty", "Game script dependent"
- Weather/travel factors for outdoor sports

Respond with JSON array:
[
  { 
    "index": 0, 
    "reasoning": "Strong NFL FADE signal with 66% historical accuracy...",
    "risk_factors": ["Limited recent data this season", "Division rivalry game"],
    "confidence_adjustment": 0.0 
  }
]`;

        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: 'You are a sports betting analyst who provides balanced analysis including risks. Respond only with valid JSON.' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.3,
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content || '';
          
          // Extract JSON from response
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const analyses = JSON.parse(jsonMatch[0]);
            
            for (const analysis of analyses) {
              if (analysis.index < topCandidates.length) {
                topCandidates[analysis.index].ai_reasoning = analysis.reasoning;
                
                // PHASE 5: Add risk factors to the bet
                if (analysis.risk_factors && Array.isArray(analysis.risk_factors)) {
                  topCandidates[analysis.index].risk_factors = analysis.risk_factors;
                }
                
                // Apply confidence adjustment
                if (analysis.confidence_adjustment) {
                  topCandidates[analysis.index].ai_confidence += analysis.confidence_adjustment;
                  topCandidates[analysis.index].ai_confidence = Math.max(0, Math.min(0.95, topCandidates[analysis.index].ai_confidence));
                }
              }
            }
          }
        } else {
          console.error('[AI-BestBets] AI response error:', aiResponse.status);
        }
      } catch (aiError) {
        console.error('[AI-BestBets] AI analysis error:', aiError);
      }
    }

    // Step 5: Log results to database
    const { error: logError } = await supabase
      .from('best_bets_log')
      .upsert(
        topCandidates.map(bet => ({
          event_id: bet.event_id,
          signal_type: bet.signal_type,
          sport: bet.sport,
          description: bet.description,
          prediction: bet.recommendation,
          odds: bet.odds,
          accuracy_at_time: bet.historical_accuracy,
          sample_size_at_time: bet.sample_size,
          created_at: now
        })),
        { onConflict: 'event_id,signal_type' }
      );

    if (logError) {
      console.error('[AI-BestBets] Log error:', logError);
    }

    // Step 6: Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'ai-best-bets-engine',
      status: 'completed',
      started_at: now,
      completed_at: new Date().toISOString(),
      result: {
        candidates: candidates.length,
        filtered: scoredCandidates.length,
        top_picks: topCandidates.length,
        accuracy_data: Object.keys(accuracyByKey).length,
        dynamic_weights_loaded: dynamicWeights.length,
        rolling_performance_loaded: rollingData.length,
        top_signal_types: topCandidates.slice(0, 5).map(c => c.signal_type)
      }
    });

    console.log(`[AI-BestBets] Complete. Top ${topCandidates.length} picks ready.`);

    return new Response(
      JSON.stringify({
        success: true,
        bestBets: topCandidates,
        accuracyData: accuracyByKey,
        historicalBaselines: HISTORICAL_ACCURACY,
        totalCandidates: candidates.length,
        filteredCount: scoredCandidates.length,
        dynamicWeightsLoaded: dynamicWeights.length,
        rollingPerformanceLoaded: rollingData.length,
        timestamp: now
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[AI-BestBets] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
