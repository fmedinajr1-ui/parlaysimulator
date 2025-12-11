import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SignalAccuracy {
  signal: string;
  accuracy: number;
  sampleSize: number;
}

interface StrategyWeights {
  [key: string]: number;
}

interface LearnedPatterns {
  winning: string[];
  losing: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Starting AI parlay generation...');

    // Get current learning progress
    const { data: progressData } = await supabase
      .from('ai_learning_progress')
      .select('*')
      .order('generation_round', { ascending: false })
      .limit(1)
      .single();

    const currentRound = (progressData?.generation_round || 0) + 1;
    const currentAccuracy = progressData?.current_accuracy || 0;
    const strategyWeights: StrategyWeights = progressData?.strategy_weights || {
      nhl_pick: 1.0,
      nba_fade: 1.0,
      ncaab_fade: 1.0,
      hit_streak: 1.0,
      sharp_money: 1.0,
      fatigue_edge: 1.0
    };
    const learnedPatterns: LearnedPatterns = progressData?.learned_patterns || { winning: [], losing: [] };

    // Fetch current signal accuracies from various tables
    const signalAccuracies: SignalAccuracy[] = [];

    // Get sharp money accuracy
    const { data: sharpData } = await supabase
      .from('line_movements')
      .select('outcome_correct, recommendation')
      .eq('outcome_verified', true)
      .eq('is_primary_record', true);

    if (sharpData && sharpData.length > 0) {
      const pickMovements = sharpData.filter(m => m.recommendation === 'pick');
      const fadeMovements = sharpData.filter(m => m.recommendation === 'fade');
      
      if (pickMovements.length >= 5) {
        const pickWins = pickMovements.filter(m => m.outcome_correct).length;
        signalAccuracies.push({
          signal: 'sharp_pick',
          accuracy: (pickWins / pickMovements.length) * 100,
          sampleSize: pickMovements.length
        });
      }
      
      if (fadeMovements.length >= 5) {
        const fadeWins = fadeMovements.filter(m => m.outcome_correct).length;
        signalAccuracies.push({
          signal: 'sharp_fade',
          accuracy: (fadeWins / fadeMovements.length) * 100,
          sampleSize: fadeMovements.length
        });
      }
    }

    // Get hit rate accuracy
    const { data: hitRateData } = await supabase
      .from('hitrate_parlays')
      .select('outcome, strategy_type')
      .neq('outcome', 'pending');

    if (hitRateData && hitRateData.length >= 5) {
      const wins = hitRateData.filter(h => h.outcome === 'won').length;
      signalAccuracies.push({
        signal: 'hit_streak',
        accuracy: (wins / hitRateData.length) * 100,
        sampleSize: hitRateData.length
      });
    }

    // Get fatigue edge accuracy
    const { data: fatigueData } = await supabase
      .from('fatigue_edge_tracking')
      .select('recommended_side_won')
      .not('recommended_side_won', 'is', null);

    if (fatigueData && fatigueData.length >= 5) {
      const wins = fatigueData.filter(f => f.recommended_side_won).length;
      signalAccuracies.push({
        signal: 'fatigue_edge',
        accuracy: (wins / fatigueData.length) * 100,
        sampleSize: fatigueData.length
      });
    }

    // Get god mode upset accuracy
    const { data: upsetData } = await supabase
      .from('god_mode_upset_predictions')
      .select('was_upset, confidence')
      .eq('game_completed', true);

    if (upsetData && upsetData.length >= 5) {
      const wins = upsetData.filter(u => u.was_upset).length;
      signalAccuracies.push({
        signal: 'upset_pick',
        accuracy: (wins / upsetData.length) * 100,
        sampleSize: upsetData.length
      });
    }

    console.log('Signal accuracies:', signalAccuracies);

    // Build prompt for AI to generate optimal parlays
    const signalSummary = signalAccuracies.map(s => 
      `- ${s.signal}: ${s.accuracy.toFixed(1)}% accuracy (${s.sampleSize} samples)`
    ).join('\n');

    const weightsSummary = Object.entries(strategyWeights)
      .map(([k, v]) => `- ${k}: ${(v as number).toFixed(2)}x weight`)
      .join('\n');

    const patternsSummary = `
Winning patterns: ${learnedPatterns.winning.slice(0, 5).join(', ') || 'None yet'}
Losing patterns: ${learnedPatterns.losing.slice(0, 5).join(', ') || 'None yet'}
    `.trim();

    // Generate parlays using Lovable AI if available
    let generatedParlays: any[] = [];

    if (lovableApiKey) {
      try {
        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${lovableApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              {
                role: 'system',
                content: `You are an expert sports betting AI focused on generating profitable 2-3 leg parlays. 
Your goal is to reach 65% accuracy. Current accuracy: ${currentAccuracy.toFixed(1)}%.

CURRENT SIGNAL PERFORMANCE:
${signalSummary || 'No signals tracked yet'}

STRATEGY WEIGHTS (higher = more reliable):
${weightsSummary}

LEARNED PATTERNS:
${patternsSummary}

Generate exactly 3 parlays based on the strongest signals. Each parlay should have 2-3 legs.
Focus on signals with >55% accuracy. Avoid combining signals from the same game.`
              },
              {
                role: 'user',
                content: 'Generate 3 optimal parlays for today based on the signal performance data. Return as JSON array.'
              }
            ],
            tools: [
              {
                type: 'function',
                function: {
                  name: 'generate_parlays',
                  description: 'Generate optimal parlays based on signal data',
                  parameters: {
                    type: 'object',
                    properties: {
                      parlays: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            strategy: { type: 'string', description: 'Combined strategy name e.g. sharp_pick+fatigue_edge' },
                            signals: { type: 'array', items: { type: 'string' } },
                            legs: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  description: { type: 'string' },
                                  odds: { type: 'number' },
                                  signal_source: { type: 'string' }
                                },
                                required: ['description', 'odds', 'signal_source']
                              }
                            },
                            confidence: { type: 'number', description: 'Confidence score 0-100' },
                            reasoning: { type: 'string' }
                          },
                          required: ['strategy', 'signals', 'legs', 'confidence', 'reasoning']
                        }
                      }
                    },
                    required: ['parlays']
                  }
                }
              }
            ],
            tool_choice: { type: 'function', function: { name: 'generate_parlays' } }
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
          if (toolCall?.function?.arguments) {
            const parsed = JSON.parse(toolCall.function.arguments);
            generatedParlays = parsed.parlays || [];
          }
        } else {
          console.error('AI response error:', await aiResponse.text());
        }
      } catch (aiError) {
        console.error('AI generation error:', aiError);
      }
    }

    // Fallback: Generate parlays based on best signals if AI fails
    if (generatedParlays.length === 0) {
      const topSignals = signalAccuracies
        .filter(s => s.accuracy >= 50 && s.sampleSize >= 5)
        .sort((a, b) => b.accuracy - a.accuracy)
        .slice(0, 3);

      generatedParlays = [
        {
          strategy: topSignals.map(s => s.signal).join('+') || 'baseline',
          signals: topSignals.map(s => s.signal),
          legs: [
            { description: 'AI Generated Leg 1 - Top Signal Pick', odds: -110, signal_source: topSignals[0]?.signal || 'baseline' },
            { description: 'AI Generated Leg 2 - Secondary Signal', odds: -115, signal_source: topSignals[1]?.signal || 'baseline' }
          ],
          confidence: topSignals.length > 0 ? topSignals[0].accuracy : 50,
          reasoning: `Generated from ${topSignals.length} signals with combined weight`
        }
      ];
    }

    // Save generated parlays
    const insertedParlays = [];
    for (const parlay of generatedParlays) {
      const totalOdds = parlay.legs.reduce((acc: number, leg: any) => {
        const decimal = leg.odds > 0 ? (leg.odds / 100) + 1 : (100 / Math.abs(leg.odds)) + 1;
        return acc * decimal;
      }, 1);

      const { data: inserted, error: insertError } = await supabase
        .from('ai_generated_parlays')
        .insert({
          generation_round: currentRound,
          strategy_used: parlay.strategy,
          signals_used: parlay.signals,
          legs: parlay.legs,
          total_odds: totalOdds,
          confidence_score: parlay.confidence,
          accuracy_at_generation: currentAccuracy,
          ai_reasoning: parlay.reasoning
        })
        .select()
        .single();

      if (!insertError && inserted) {
        insertedParlays.push(inserted);
      } else {
        console.error('Insert error:', insertError);
      }
    }

    // Update or create learning progress
    const { data: existingProgress } = await supabase
      .from('ai_learning_progress')
      .select('*')
      .eq('generation_round', currentRound)
      .single();

    if (existingProgress) {
      await supabase
        .from('ai_learning_progress')
        .update({
          parlays_generated: existingProgress.parlays_generated + insertedParlays.length,
          strategy_weights: strategyWeights
        })
        .eq('id', existingProgress.id);
    } else {
      // Check for milestone
      const isMilestone = [55, 60, 65].includes(Math.floor(currentAccuracy));
      const milestoneReached = isMilestone ? `${Math.floor(currentAccuracy)}%` : null;

      await supabase
        .from('ai_learning_progress')
        .insert({
          generation_round: currentRound,
          parlays_generated: insertedParlays.length,
          parlays_settled: 0,
          wins: 0,
          losses: 0,
          current_accuracy: currentAccuracy,
          strategy_weights: strategyWeights,
          learned_patterns: learnedPatterns,
          is_milestone: isMilestone,
          milestone_reached: milestoneReached
        });
    }

    console.log(`Generated ${insertedParlays.length} parlays for round ${currentRound}`);

    return new Response(JSON.stringify({
      success: true,
      round: currentRound,
      parlaysGenerated: insertedParlays.length,
      parlays: insertedParlays,
      currentAccuracy
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in AI parlay generator:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
