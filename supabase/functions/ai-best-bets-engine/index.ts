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
  ai_confidence: number;
  composite_score: number;
  ai_reasoning?: string;
  signals: string[];
}

// Proven accuracy by sport/recommendation from historical data
const HISTORICAL_ACCURACY: Record<string, number> = {
  'nhl_pick': 61.11,
  'nba_fade': 54.47,
  'ncaab_fade': 51.89,
  'nfl_caution': 51.52,
  'nba_pick': 33.33,  // LOSING - exclude
  'nfl_pick': 31.25,  // LOSING - exclude
  'ncaab_pick': 50.0, // Breakeven
};

// Minimum accuracy threshold for inclusion
const MIN_ACCURACY_THRESHOLD = 51.0;

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

    console.log('[AI-BestBets] Starting AI-powered best bets analysis...');

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

    console.log('[AI-BestBets] Verified accuracy data:', accuracyByKey);

    // Step 2: Fetch candidate signals (upcoming games)
    const candidates: any[] = [];

    // NHL Sharp PICK - best performer (61%+)
    const { data: nhlSharp } = await supabase
      .from('line_movements')
      .select('*')
      .ilike('sport', '%nhl%')
      .eq('is_sharp_action', true)
      .eq('is_primary_record', true)
      .eq('recommendation', 'pick')
      .gte('commence_time', now)
      .gte('authenticity_confidence', 0.6)
      .order('authenticity_confidence', { ascending: false })
      .limit(10);

    if (nhlSharp) {
      candidates.push(...nhlSharp.map(s => ({ ...s, signal_type: 'nhl_pick' })));
    }

    // NBA FADE - strong performer (54%+)
    const { data: nbaFade } = await supabase
      .from('line_movements')
      .select('*')
      .ilike('sport', '%nba%')
      .eq('is_primary_record', true)
      .eq('recommendation', 'fade')
      .gte('commence_time', now)
      .gte('authenticity_confidence', 0.5)
      .order('trap_score', { ascending: false })
      .limit(10);

    if (nbaFade) {
      candidates.push(...nbaFade.map(s => ({ ...s, signal_type: 'nba_fade' })));
    }

    // NCAAB FADE - slightly profitable (52%+)
    const { data: ncaabFade } = await supabase
      .from('line_movements')
      .select('*')
      .ilike('sport', '%ncaab%')
      .eq('is_primary_record', true)
      .eq('recommendation', 'fade')
      .gte('commence_time', now)
      .gte('authenticity_confidence', 0.4)
      .order('trap_score', { ascending: false })
      .limit(15);

    if (ncaabFade) {
      candidates.push(...ncaabFade.map(s => ({ ...s, signal_type: 'ncaab_fade' })));
    }

    // NBA Fatigue Edge
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

    console.log(`[AI-BestBets] Found ${candidates.length} candidate signals`);

    // Step 3: Score each candidate
    const scoredCandidates: BestBet[] = [];

    for (const candidate of candidates) {
      const signalKey = candidate.signal_type;
      const historicalAccuracy = accuracyByKey[signalKey]?.accuracy || 
                                 HISTORICAL_ACCURACY[signalKey] || 50;

      // Skip signals below minimum threshold
      if (historicalAccuracy < MIN_ACCURACY_THRESHOLD) {
        console.log(`[AI-BestBets] Skipping ${signalKey} - below accuracy threshold (${historicalAccuracy.toFixed(1)}%)`);
        continue;
      }

      // Calculate composite score
      const signals: string[] = [];
      let compositeScore = historicalAccuracy;

      // Boost for high confidence
      if (candidate.authenticity_confidence >= 0.8) {
        compositeScore += 5;
        signals.push('High confidence signal');
      }

      // Boost for high trap score (for fades)
      if (candidate.trap_score && candidate.trap_score >= 60) {
        compositeScore += 3;
        signals.push(`Trap score: ${candidate.trap_score}`);
      }

      // Boost for fatigue differential
      if (candidate.fatigue_differential && candidate.fatigue_differential >= 25) {
        compositeScore += 5;
        signals.push(`High fatigue diff: +${candidate.fatigue_differential}`);
      } else if (candidate.fatigue_differential && candidate.fatigue_differential >= 20) {
        compositeScore += 2;
        signals.push(`Fatigue edge: +${candidate.fatigue_differential}`);
      }

      // Boost for multi-book consensus
      if (candidate.books_consensus && candidate.books_consensus >= 3) {
        compositeScore += 4;
        signals.push(`${candidate.books_consensus} books consensus`);
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
        ai_confidence: aiConfidence,
        composite_score: compositeScore,
        signals
      });
    }

    // Sort by composite score
    scoredCandidates.sort((a, b) => b.composite_score - a.composite_score);

    // Step 4: Use AI to analyze top candidates (if API key available)
    const topCandidates = scoredCandidates.slice(0, 10);

    if (LOVABLE_API_KEY && topCandidates.length > 0) {
      try {
        const prompt = `You are an expert sports betting analyst. Analyze these signals and provide brief reasoning for each bet.

Historical accuracy data:
${JSON.stringify(accuracyByKey, null, 2)}

Top candidates to analyze:
${topCandidates.map((c, i) => `
${i + 1}. ${c.description}
   - Signal: ${c.recommendation.toUpperCase()}
   - Sport: ${c.sport}
   - Historical accuracy: ${c.historical_accuracy.toFixed(1)}%
   - Composite score: ${c.composite_score.toFixed(1)}
   - Signals: ${c.signals.join(', ')}
`).join('\n')}

For each bet, provide a 1-2 sentence analysis explaining why it's a good or risky play based on the data. Focus on NCAAB fades and other high-accuracy signals.

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
          signal_type: bet.sport.includes('nhl') ? 'nhl_sharp_pick' : 
                       bet.sport.includes('ncaab') ? 'ncaab_sharp_fade' :
                       bet.sport.includes('nba') ? 'nba_sharp_fade' : 'other',
          sport: bet.sport,
          description: bet.description,
          prediction: bet.recommendation,
          odds: bet.odds,
          accuracy_at_time: bet.historical_accuracy,
          sample_size_at_time: accuracyByKey[`${bet.sport.split('_').pop()}_${bet.recommendation}`]?.total || 0,
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
        accuracy_data: Object.keys(accuracyByKey).length
      }
    });

    console.log(`[AI-BestBets] Complete. Top ${topCandidates.length} picks ready.`);

    return new Response(
      JSON.stringify({
        success: true,
        bestBets: topCandidates,
        accuracyData: accuracyByKey,
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
