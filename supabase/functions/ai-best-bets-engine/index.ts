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
const HISTORICAL_ACCURACY: Record<string, { accuracy: number; sampleSize: number }> = {
  // TOP PERFORMERS - Feature prominently
  'nfl_fade': { accuracy: 66.54, sampleSize: 260 },     // BEST PERFORMER!
  'nfl_caution': { accuracy: 55.79, sampleSize: 699 }, // Strong
  'nhl_caution': { accuracy: 53.08, sampleSize: 552 }, // Profitable
  'ncaab_fade': { accuracy: 52.92, sampleSize: 907 },  // Profitable
  
  // NEAR BREAKEVEN - Include with caution
  'ncaab_caution': { accuracy: 50.90, sampleSize: 1038 },
  'ncaab_pick': { accuracy: 50.34, sampleSize: 440 },
  'nba_caution': { accuracy: 50.19, sampleSize: 257 },
  
  // UNDERPERFORMERS - Exclude or consider fading
  'nba_fade': { accuracy: 49.53, sampleSize: 214 },    // Near random
  'nhl_fade': { accuracy: 46.86, sampleSize: 175 },    // Below average
  'nhl_pick': { accuracy: 46.43, sampleSize: 28 },     // Below average - WRONGLY shown before!
  'nfl_pick': { accuracy: 42.11, sampleSize: 38 },     // Bad
  'nba_pick': { accuracy: 32.20, sampleSize: 59 },     // TERRIBLE - fade these!
};

// Minimum accuracy threshold for inclusion (must beat the vig)
// At -110 odds, you need 52.38% to break even
const MIN_ACCURACY_THRESHOLD = 52.4;
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

    console.log(`[AI-BestBets] Found ${candidates.length} total candidate signals (including coaching)`);

    // Step 3: Score each candidate using REAL accuracy data
    const scoredCandidates: BestBet[] = [];

    for (const candidate of candidates) {
      const signalKey = candidate.signal_type;
      
      // Use live accuracy if available, otherwise use historical baseline
      const liveAccuracy = accuracyByKey[signalKey]?.accuracy;
      const liveTotal = accuracyByKey[signalKey]?.total || 0;
      
      const baselineAccuracy = HISTORICAL_ACCURACY[signalKey]?.accuracy || 50;
      const baselineSampleSize = HISTORICAL_ACCURACY[signalKey]?.sampleSize || 0;
      
      // Prefer live data if sample size is sufficient
      const historicalAccuracy = (liveTotal >= 20) ? liveAccuracy : baselineAccuracy;
      const sampleSize = (liveTotal >= 20) ? liveTotal : baselineSampleSize;

      // Skip signals below minimum threshold
      if (historicalAccuracy < MIN_ACCURACY_THRESHOLD) {
        console.log(`[AI-BestBets] Skipping ${signalKey} - below accuracy threshold (${historicalAccuracy.toFixed(1)}% < ${MIN_ACCURACY_THRESHOLD}%)`);
        continue;
      }

      // Skip signals with insufficient sample size
      if (sampleSize < MIN_SAMPLE_SIZE && signalKey !== 'nba_fatigue') {
        console.log(`[AI-BestBets] Skipping ${signalKey} - insufficient sample size (${sampleSize} < ${MIN_SAMPLE_SIZE})`);
        continue;
      }

      // Calculate composite score - start with accuracy
      const signals: string[] = [];
      let compositeScore = historicalAccuracy;

      // Boost for NFL FADE (best performer)
      if (signalKey === 'nfl_fade') {
        compositeScore += 8;
        signals.push('🔥 Top performer (66%+ accuracy)');
      }

      // Boost for high confidence
      if (candidate.authenticity_confidence >= 0.8) {
        compositeScore += 5;
        signals.push('High confidence signal');
      } else if (candidate.authenticity_confidence >= 0.6) {
        compositeScore += 2;
        signals.push('Medium-high confidence');
      }

      // Boost for high trap score (for fades)
      if (candidate.trap_score && candidate.trap_score >= 70) {
        compositeScore += 5;
        signals.push(`Strong trap: ${candidate.trap_score}`);
      } else if (candidate.trap_score && candidate.trap_score >= 50) {
        compositeScore += 2;
        signals.push(`Trap detected: ${candidate.trap_score}`);
      }

      // Boost for fatigue differential
      if (candidate.fatigue_differential && candidate.fatigue_differential >= 25) {
        compositeScore += 6;
        signals.push(`High fatigue diff: +${candidate.fatigue_differential}`);
      } else if (candidate.fatigue_differential && candidate.fatigue_differential >= 20) {
        compositeScore += 3;
        signals.push(`Fatigue edge: +${candidate.fatigue_differential}`);
      }

      // Boost for multi-book consensus
      if (candidate.books_consensus && candidate.books_consensus >= 4) {
        compositeScore += 5;
        signals.push(`${candidate.books_consensus} books consensus`);
      } else if (candidate.books_consensus && candidate.books_consensus >= 3) {
        compositeScore += 2;
        signals.push(`${candidate.books_consensus} books agree`);
      }

      // Boost for coaching signals
      if (candidate.signal_type?.startsWith('coaching')) {
        compositeScore += 4;
        signals.push(`🏀 Coach tendency: ${candidate.coach_name || 'NBA'}`);
        if (candidate.coaching_tendency === 'fast') {
          signals.push('Fast pace = higher scoring');
        } else if (candidate.coaching_tendency === 'b2b_rest_heavy') {
          signals.push('B2B rest = star minutes down');
        }
      }

      // Add sample size context
      if (sampleSize >= 200) {
        signals.push(`Large sample (n=${sampleSize})`);
      } else if (sampleSize >= 50) {
        signals.push(`Good sample (n=${sampleSize})`);
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
