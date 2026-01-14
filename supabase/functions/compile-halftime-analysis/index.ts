import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface KeyMoment {
  type: string;
  gameTime: string | null;
  timestamp: string;
  frames: string[];
  observations?: string[];
}

interface LiveObservation {
  playerName: string;
  type: string;
  observation: string;
  confidence: string;
  gameTime: string;
}

interface GameContext {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  homeRoster?: any[];
  awayRoster?: any[];
  sport?: string;
}

interface CompileRequest {
  gameContext: GameContext;
  keyMoments: KeyMoment[];
  liveObservations: LiveObservation[];
  capturedFrames?: string[];
}

// Weight moments by type for analysis priority
function getMomentWeight(type: string): number {
  const weights: Record<string, number> = {
    'timeout': 2.0,    // Best for fatigue assessment
    'injury': 2.5,     // Critical impact
    'fastbreak': 1.5,  // Energy/explosiveness indicator
    'freethrow': 1.2,  // Focus/fatigue indicator
    'other': 1.0,
  };
  return weights[type] || 1.0;
}

// Parse game time to get quarter number for progression analysis
function parseGameTime(gameTime: string | null): { quarter: number; timeRemaining: number } | null {
  if (!gameTime) return null;
  
  const match = gameTime.match(/Q(\d+|OT)\s*(\d+):(\d+)/i);
  if (!match) return null;
  
  const quarter = match[1] === 'OT' ? 5 : parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const seconds = parseInt(match[3]);
  const timeRemaining = minutes * 60 + seconds;
  
  return { quarter, timeRemaining };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { gameContext, keyMoments, liveObservations, capturedFrames } = await req.json() as CompileRequest;
    
    console.log('Compiling halftime analysis:', {
      eventId: gameContext.eventId,
      keyMomentsCount: keyMoments.length,
      observationsCount: liveObservations.length,
      capturedFramesCount: capturedFrames?.length || 0,
    });

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    // Aggregate observations by player
    const playerObservations: Record<string, {
      observations: string[];
      gameTimes: string[];
      fatigueSignals: number;
      energySignals: number;
    }> = {};

    // Process key moment observations (weighted higher)
    for (const moment of keyMoments) {
      const weight = getMomentWeight(moment.type);
      if (moment.observations) {
        for (const obs of moment.observations) {
          // Try to extract player name from observation
          const playerMatch = obs.match(/^([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
          if (playerMatch) {
            const playerName = playerMatch[1];
            if (!playerObservations[playerName]) {
              playerObservations[playerName] = { observations: [], gameTimes: [], fatigueSignals: 0, energySignals: 0 };
            }
            playerObservations[playerName].observations.push(`[${moment.type.toUpperCase()}] ${obs}`);
            if (moment.gameTime) {
              playerObservations[playerName].gameTimes.push(moment.gameTime);
            }
            
            // Track fatigue vs energy signals
            const lowerObs = obs.toLowerCase();
            if (lowerObs.includes('fatigue') || lowerObs.includes('tired') || lowerObs.includes('slow') || lowerObs.includes('hands on')) {
              playerObservations[playerName].fatigueSignals += weight;
            }
            if (lowerObs.includes('explosive') || lowerObs.includes('energetic') || lowerObs.includes('fast') || lowerObs.includes('aggressive')) {
              playerObservations[playerName].energySignals += weight;
            }
          }
        }
      }
    }

    // Process live observations
    for (const obs of liveObservations) {
      if (!playerObservations[obs.playerName]) {
        playerObservations[obs.playerName] = { observations: [], gameTimes: [], fatigueSignals: 0, energySignals: 0 };
      }
      playerObservations[obs.playerName].observations.push(obs.observation);
      if (obs.gameTime) {
        playerObservations[obs.playerName].gameTimes.push(obs.gameTime);
      }
      
      const lowerObs = obs.observation.toLowerCase();
      if (lowerObs.includes('fatigue') || lowerObs.includes('tired') || lowerObs.includes('slow')) {
        playerObservations[obs.playerName].fatigueSignals += 1;
      }
      if (lowerObs.includes('explosive') || lowerObs.includes('energetic') || lowerObs.includes('fast')) {
        playerObservations[obs.playerName].energySignals += 1;
      }
    }

    // Format key moments for AI prompt
    const formattedKeyMoments = keyMoments.map(m => {
      const timeStr = m.gameTime || 'Unknown time';
      const obsStr = m.observations?.length ? m.observations.join('; ') : 'Pending analysis';
      return `- ${timeStr}: ${m.type.toUpperCase()} - ${obsStr}`;
    }).join('\n');

    // Format live observations for AI prompt
    const formattedObservations = liveObservations.map(o => {
      return `- ${o.gameTime || 'Unknown'}: ${o.playerName} (${o.type}): ${o.observation} [${o.confidence}]`;
    }).join('\n');

    // Format player summaries for AI prompt
    const playerSummaries = Object.entries(playerObservations).map(([name, data]) => {
      const fatigueLevel = data.fatigueSignals > data.energySignals ? 'elevated' : 
                          data.energySignals > data.fatigueSignals ? 'low' : 'moderate';
      return `${name}: ${data.observations.length} observations, fatigue level: ${fatigueLevel}`;
    }).join('\n');

    const systemPrompt = `You are an elite sports betting analyst specializing in halftime prop adjustments. Your task is to synthesize live game observations into actionable 2nd half betting recommendations.

You have deep expertise in:
- Player fatigue patterns and how they affect 2nd half performance
- Injury impact on prop lines
- Team energy and pace dynamics
- Historical patterns of stat distribution between halves

Your recommendations should be data-driven, citing specific observations that support each pick.`;

    const userPrompt = `GAME: ${gameContext.awayTeam} @ ${gameContext.homeTeam}
SPORT: ${gameContext.sport || 'NBA'}

=== KEY MOMENTS CAPTURED (${keyMoments.length} total) ===
${formattedKeyMoments || 'No key moments marked'}

=== LIVE OBSERVATIONS (${liveObservations.length} total) ===
${formattedObservations || 'No live observations'}

=== PLAYER FATIGUE SUMMARY ===
${playerSummaries || 'No player data'}

TASK: Synthesize these first-half observations into betting recommendations for 2nd half props.

ANALYSIS REQUIREMENTS:
1. FATIGUE PROGRESSION - Did players show increasing fatigue from Q1 to Q2? This typically indicates 2H stat drops.
2. INJURY IMPACT - Any players showing movement limitations? Flag for UNDER consideration.
3. ENERGY TRENDS - Which team has more 2nd half juice based on timeout observations?
4. KEY MOMENT WEIGHTING - Timeout and injury observations are most reliable for fatigue assessment.

Return your analysis as JSON with this exact structure:
{
  "playerSummaries": [
    {
      "playerName": "Player Name",
      "team": "Team Name",
      "observationCount": 3,
      "fatigueLevel": "low|medium|high",
      "fatigueProgression": "stable|increasing|decreasing",
      "keySignals": ["specific observation 1", "specific observation 2"],
      "confidenceLevel": "low|medium|high"
    }
  ],
  "teamAnalysis": {
    "homeTeam": {
      "name": "${gameContext.homeTeam}",
      "energyLevel": 7,
      "fatigueTrend": "stable|improving|declining",
      "paceExpectation": "faster|same|slower"
    },
    "awayTeam": {
      "name": "${gameContext.awayTeam}",
      "energyLevel": 5,
      "fatigueTrend": "stable|improving|declining",
      "paceExpectation": "faster|same|slower"
    }
  },
  "recommendations": [
    {
      "playerName": "Player Name",
      "propType": "Points|Rebounds|Assists|PRA|Threes",
      "recommendation": "OVER|UNDER",
      "confidence": "low|medium|high",
      "reasoning": "Specific reasoning citing observations",
      "supportingMoments": ["Q1 8:42 - Timeout observation", "Q2 5:15 - Fast break energy"],
      "riskFactors": ["Any concerns or caveats"]
    }
  ],
  "gameNarrative": "Brief 2-3 sentence summary of key 1H observations affecting 2H outlook",
  "topPick": {
    "summary": "One sentence description of best bet",
    "confidence": "high"
  }
}

Provide 3-5 recommendations ranked by confidence. Focus on players with the most observations.`;

    // Call AI for synthesis
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: 'AI credits exhausted. Please add credits to continue.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || '';
    
    // Parse JSON from AI response
    let analysisResult;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      console.log('Raw content:', content);
      
      // Return a structured fallback
      analysisResult = {
        playerSummaries: [],
        teamAnalysis: {
          homeTeam: { name: gameContext.homeTeam, energyLevel: 5, fatigueTrend: 'stable' },
          awayTeam: { name: gameContext.awayTeam, energyLevel: 5, fatigueTrend: 'stable' },
        },
        recommendations: [],
        gameNarrative: 'Unable to generate detailed analysis. Please try again.',
        topPick: null,
        rawContent: content,
      };
    }

    // Try to match recommendations to actual unified_props
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (analysisResult.recommendations && analysisResult.recommendations.length > 0) {
      // Get props for this game
      const { data: props } = await supabase
        .from('unified_props')
        .select('player_name, prop_type, line, over_price, under_price, bookmaker, is_active')
        .eq('event_id', gameContext.eventId)
        .eq('is_active', true);

      if (props && props.length > 0) {
        // Enrich recommendations with actual lines
        for (const rec of analysisResult.recommendations) {
          const matchingProp = props.find(p => 
            p.player_name?.toLowerCase().includes(rec.playerName?.toLowerCase()) &&
            p.prop_type?.toLowerCase().includes(rec.propType?.toLowerCase())
          );
          
          if (matchingProp) {
            rec.actualLine = matchingProp.line;
            rec.overPrice = matchingProp.over_price;
            rec.underPrice = matchingProp.under_price;
            rec.bookmaker = matchingProp.bookmaker;
            rec.hasLiveLine = true;
          } else {
            rec.hasLiveLine = false;
          }
        }
      }
    }

    // Add metadata
    analysisResult.metadata = {
      generatedAt: new Date().toISOString(),
      keyMomentsCount: keyMoments.length,
      observationsCount: liveObservations.length,
      playersAnalyzed: Object.keys(playerObservations).length,
      eventId: gameContext.eventId,
    };

    return new Response(JSON.stringify(analysisResult), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in compile-halftime-analysis:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      playerSummaries: [],
      recommendations: [],
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
