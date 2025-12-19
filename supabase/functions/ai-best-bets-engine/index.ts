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
  signals: string[];
  signal_type: string;
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

    console.log('[AI-BestBets] Starting AI-powered best bets analysis with corrected accuracy data...');

    // Step 1: Fetch REAL accuracy data from verified outcomes
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

    console.log(`[AI-BestBets] Found ${candidates.length} total candidate signals (including coaching, God Mode)`);

    // Step 3: Score each candidate using REAL accuracy data
    const scoredCandidates: BestBet[] = [];

    for (const candidate of candidates) {
      const signalKey = candidate.signal_type;
      
      // Use live accuracy if available, otherwise use historical baseline
      const liveAccuracy = accuracyByKey[signalKey]?.accuracy;
      const liveTotal = accuracyByKey[signalKey]?.total || 0;
      
      const baselineAccuracy = HISTORICAL_ACCURACY[signalKey]?.accuracy || 50;
      const baselineSampleSize = HISTORICAL_ACCURACY[signalKey]?.sampleSize || 0;
      const avgOdds = candidate.new_price || HISTORICAL_ACCURACY[signalKey]?.avgOdds || -110;
      
      // Prefer live data if sample size is sufficient
      const historicalAccuracy = (liveTotal >= 20) ? liveAccuracy : baselineAccuracy;
      const sampleSize = (liveTotal >= 20) ? liveTotal : baselineSampleSize;

      // ROI-based threshold: must beat breakeven for the odds
      const accuracyThreshold = getAccuracyThreshold(signalKey, avgOdds);
      const expectedROI = calculateExpectedROI(historicalAccuracy, avgOdds);

      // Skip signals below ROI-adjusted threshold (allows plus-money with lower accuracy)
      if (historicalAccuracy < accuracyThreshold) {
        console.log(`[AI-BestBets] Skipping ${signalKey} - below ROI threshold (${historicalAccuracy.toFixed(1)}% < ${accuracyThreshold.toFixed(1)}% for ${avgOdds} odds)`);
        continue;
      }

      // Skip signals with insufficient sample size (except fatigue and god mode which have separate tracking)
      const skipSampleCheck = signalKey === 'nba_fatigue' || signalKey.startsWith('god_mode');
      if (sampleSize < MIN_SAMPLE_SIZE && !skipSampleCheck) {
        console.log(`[AI-BestBets] Skipping ${signalKey} - insufficient sample size (${sampleSize} < ${MIN_SAMPLE_SIZE})`);
        continue;
      }
      
      // Sample size weight multiplier for boosts
      const sampleMultiplier = getSampleSizeMultiplier(sampleSize);

      // Calculate composite score - start with accuracy
      const signals: string[] = [];
      let compositeScore = historicalAccuracy;

      // Boost for NFL FADE (best performer) - weighted by sample size
      if (signalKey === 'nfl_fade') {
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

      // Boost for coaching signals
      if (signalKey?.startsWith('coaching')) {
        compositeScore += 4 * sampleMultiplier;
        signals.push(`🏀 Coach tendency: ${candidate.coach_name || 'NBA'}`);
        if (candidate.coaching_tendency === 'fast') {
          signals.push('Fast pace = higher scoring');
        } else if (candidate.coaching_tendency === 'b2b_rest_heavy') {
          signals.push('B2B rest = star minutes down');
        }
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

      // Add sample size context
      if (sampleSize >= 200) {
        signals.push(`Large sample (n=${sampleSize})`);
      } else if (sampleSize >= 50) {
        signals.push(`Good sample (n=${sampleSize})`);
      } else if (signalKey?.startsWith('god_mode')) {
        signals.push(`God Mode tracking (n=${sampleSize})`);
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
        const prompt = `You are an expert sports betting analyst. Analyze these signals based on VERIFIED accuracy data and provide brief reasoning.

KEY INSIGHT: NFL FADE signals have 66.54% historical accuracy (260 samples) - this is our TOP performer.

Live accuracy data from verified outcomes:
${JSON.stringify(accuracyByKey, null, 2)}

Historical baselines:
${JSON.stringify(HISTORICAL_ACCURACY, null, 2)}

Top candidates to analyze:
${topCandidates.map((c, i) => `
${i + 1}. ${c.description}
   - Signal Type: ${c.signal_type}
   - Recommendation: ${c.recommendation.toUpperCase()}
   - Historical accuracy: ${c.historical_accuracy.toFixed(1)}% (n=${c.sample_size})
   - Composite score: ${c.composite_score.toFixed(1)}
   - Signals: ${c.signals.join(', ')}
`).join('\n')}

For each bet, provide a 1-2 sentence analysis. PRIORITIZE NFL FADE signals as they have proven 66%+ accuracy.

Respond with JSON array:
[
  { "index": 0, "reasoning": "Brief analysis...", "confidence_adjustment": 0.0 },
  ...
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
              { role: 'system', content: 'You are a sports betting analyst. Respond only with valid JSON.' },
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
