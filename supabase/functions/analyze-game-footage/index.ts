import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
interface AnalysisRequest {
  frames: string[];
  gameContext: {
    homeTeam: string;
    awayTeam: string;
    homeRoster: string;
    awayRoster: string;
    eventId: string;
  };
  clipCategory: string;
  selectedPlayers?: string[]; // NEW: List of player names to track in detail
}

interface FrameStrategy {
  maxFrames: number;
  interval: 'dense' | 'sparse' | 'focused' | 'moderate';
}

// Smart frame selection strategy based on clip category
function getFrameStrategy(category: string, totalFrames: number): FrameStrategy {
  const strategies: Record<string, FrameStrategy> = {
    timeout: { maxFrames: 15, interval: 'sparse' },    // Fatigue = fewer, spread frames
    fastbreak: { maxFrames: 20, interval: 'dense' },   // Motion = more frames, tighter
    freethrow: { maxFrames: 12, interval: 'focused' }, // Mechanics = key moments
    defense: { maxFrames: 18, interval: 'moderate' },  // Rotations = good coverage
  };
  return strategies[category] || { maxFrames: 20, interval: 'moderate' };
}

// Select frames based on strategy
function selectFramesWithStrategy(frames: string[], strategy: FrameStrategy): string[] {
  const { maxFrames, interval } = strategy;
  
  if (frames.length <= maxFrames) {
    return frames; // Use all if under limit
  }
  
  switch (interval) {
    case 'dense':
      // First N frames (most action at start)
      return frames.slice(0, maxFrames);
      
    case 'sparse':
      // Evenly distributed across video
      const sparseStep = Math.floor(frames.length / maxFrames);
      return frames.filter((_, i) => i % sparseStep === 0).slice(0, maxFrames);
      
    case 'focused':
      // First 4, middle 4, last 4 (key moments for mechanics)
      const third = Math.floor(frames.length / 3);
      const focusedFrames = [
        ...frames.slice(0, 4),
        ...frames.slice(third, third + 4),
        ...frames.slice(-4)
      ];
      return focusedFrames.slice(0, maxFrames);
      
    default: // moderate
      const step = Math.max(1, Math.floor(frames.length / maxFrames));
      return frames.filter((_, i) => i % step === 0).slice(0, maxFrames);
  }
}

// Category-specific AI instructions
function getCategorySpecificInstructions(category: string): string {
  const instructions: Record<string, string> = {
    timeout: `TIMEOUT ANALYSIS: You're seeing frames from a timeout/huddle. 
Focus on: standing posture, hands on knees, towel usage, breathing patterns, player spacing, fatigue indicators while at rest.`,
    fastbreak: `FAST BREAK ANALYSIS: Dense frames capturing transition play.
Focus on: sprint speed, explosion off the floor, effort level, defensive recovery speed, pace of play.`,
    freethrow: `FREE THROW ANALYSIS: Key moments from free throw routine.
Focus on: pre-shot routine, stance consistency, release point, follow-through mechanics, focus and composure.`,
    defense: `DEFENSIVE SEQUENCE: Frames showing half-court defense.
Focus on: closeout speed, help rotation timing, communication, recovery positioning, lateral movement.`,
  };
  return instructions[category] || '';
}

// Enhanced player tracking instructions
function getPlayerTrackingInstructions(selectedPlayers: string[]): string {
  if (!selectedPlayers || selectedPlayers.length === 0) return '';
  
  return `
SELECTED PLAYERS TO TRACK: [${selectedPlayers.join(', ')}]

For EACH selected player, provide DETAILED TRACKING in the playerTracking array:

1. JERSEY & COURT POSITION
   - Confirm jersey number if visible
   - Track court zones: restricted_area, paint, mid_range, perimeter, corner, transition
   - Note frame indices where player appears

2. SHOT ATTEMPTS (if visible)
   - Zone: restricted_area | paint | mid_range | corner_3 | above_break_3
   - Result: made | missed | blocked
   - Shot type: catch_shoot | pull_up | post_up | transition

3. ROTATION PATTERNS
   - Visible stint changes (on/off court)
   - Bench appearances
   - Fatigue level when returning to court: none | mild | moderate | heavy

4. DEFENSIVE ASSIGNMENTS
   - Opponent player being guarded (if identifiable)
   - Closeout quality: 1-10
   - Help rotation timing: quick | average | slow
`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const { frames, gameContext, clipCategory, selectedPlayers }: AnalysisRequest = await req.json();
    
    if (!frames || frames.length === 0) {
      throw new Error('No frames provided for analysis');
    }

    console.log(`[analyze-game-footage] Received ${frames.length} frames for ${gameContext.awayTeam} @ ${gameContext.homeTeam}`);
    console.log(`[analyze-game-footage] Clip category: ${clipCategory}`);
    console.log(`[analyze-game-footage] Selected players to track: ${selectedPlayers?.join(', ') || 'none'}`);

    // Smart frame selection based on clip category
    const strategy = getFrameStrategy(clipCategory, frames.length);
    const framesToAnalyze = selectFramesWithStrategy(frames, strategy);
    
    console.log(`[analyze-game-footage] Strategy: ${strategy.interval}, analyzing ${framesToAnalyze.length} of ${frames.length} frames`);

    // Get category-specific instructions
    const categoryInstructions = getCategorySpecificInstructions(clipCategory);
    
    // Get player tracking instructions if players are selected
    const playerTrackingInstructions = getPlayerTrackingInstructions(selectedPlayers || []);

    // Build the analysis prompt
    const systemPrompt = `You are an expert NBA video analyst specializing in detecting betting-relevant signals from game footage. You identify players by jersey numbers and analyze their movement, fatigue, and mechanics for halftime betting insights.

Your analysis must be grounded in VISUAL OBSERVATIONS from the frames provided. Do not guess or invent observations.

${categoryInstructions}

${playerTrackingInstructions}

KEY ANALYSIS AREAS:
1. PLAYER IDENTIFICATION - Match jersey numbers to roster names
2. MOVEMENT QUALITY - Score 1-10 (explosiveness, lateral movement, recovery speed)
3. FATIGUE INDICATORS - Hands on knees, slow transition, heavy breathing, hunched posture
4. BODY LANGUAGE - Frustrated, confident, disengaged, locked in
5. SHOT MECHANICS - Release point, follow-through consistency (if visible)
6. TEAM DYNAMICS - Communication, defensive rotations, pace
7. COURT POSITIONING - Where players spend time (paint, perimeter, corner, transition)

FRAME COVERAGE: You are analyzing ${framesToAnalyze.length} frames with ${strategy.interval} distribution for ${clipCategory} clip type.`;

    const selectedPlayersList = selectedPlayers && selectedPlayers.length > 0 
      ? `\nSELECTED PLAYERS TO TRACK: ${selectedPlayers.join(', ')}`
      : '';

    const userPrompt = `GAME: ${gameContext.awayTeam} @ ${gameContext.homeTeam}
CLIP CATEGORY: ${clipCategory}
FRAMES: ${framesToAnalyze.length} frames (${strategy.interval} selection from ${frames.length} total)
${selectedPlayersList}

ROSTER CONTEXT:
${gameContext.homeTeam}: ${gameContext.homeRoster || 'Not available'}
${gameContext.awayTeam}: ${gameContext.awayRoster || 'Not available'}

Analyze the ${framesToAnalyze.length} frames provided and return a JSON object with this exact structure:

{
  "observations": [
    {
      "playerName": "Full Name",
      "jerseyNumber": "23",
      "team": "Team Name",
      "framesDetectedIn": [0, 3, 5],
      "movementScore": 7,
      "fatigueIndicators": ["slower lateral movement", "hands on hips"],
      "bodyLanguage": "focused but conserving energy",
      "shotMechanicsNote": null,
      "confidence": "high"
    }
  ],
  "playerTracking": [
    {
      "playerName": "Full Name",
      "jerseyNumber": "11",
      "framesDetected": [0, 3, 5, 8, 12],
      "courtZones": {
        "paint": 4,
        "perimeter": 6,
        "corner": 2,
        "transition": 3
      },
      "shotAttempts": [
        { "zone": "mid_range", "result": "made", "type": "pull_up" },
        { "zone": "paint", "result": "missed", "type": "post_up" }
      ],
      "rotationSignals": {
        "stintsObserved": 1,
        "benchTimeVisible": false,
        "fatigueOnReentry": "none"
      },
      "defensiveMatchups": [
        { "opponent": "Opponent Name", "closeoutQuality": 7, "helpTiming": "quick" }
      ],
      "movementScore": 8,
      "fatigueIndicators": ["none"],
      "confidence": "high"
    }
  ],
  "teamObservations": {
    "Team Name": {
      "defensiveIntensity": 7,
      "pace": "moderate",
      "energyTrend": "declining"
    }
  },
  "paceAssessment": "moderate",
  "bettingSignals": [
    "Player X showing fatigue → consider UNDER on 2H points",
    "Team defensive intensity dropping → consider OVER on opponent points"
  ],
  "recommendations": [
    {
      "playerName": "Full Name",
      "propType": "Points",
      "line": 12.5,
      "recommendation": "UNDER",
      "confidence": "medium",
      "reasoning": "Visual signs of fatigue in Q1/Q2 footage",
      "visualEvidence": ["Hands on knees during timeout", "Slower recovery on fast break"]
    }
  ]
}

IMPORTANT:
- Only include players you can VISUALLY CONFIRM from jersey numbers
- Movement scores should reflect what you SEE, not assumptions
- Recommendations require at least 2 aligned visual signals
- If you cannot identify players clearly, state that in the response
- For playerTracking: ONLY include entries for the SELECTED PLAYERS if specified
- Return ONLY valid JSON, no markdown or explanation`;

    // Build message content with images
    const messageContent: any[] = [
      { type: "text", text: userPrompt }
    ];

    // Add frames as images
    for (let i = 0; i < framesToAnalyze.length; i++) {
      const frame = framesToAnalyze[i];
      // Handle both data URL and raw base64
      const base64Data = frame.startsWith('data:') 
        ? frame 
        : `data:image/jpeg;base64,${frame.replace(/^data:image\/\w+;base64,/, '')}`;
      
      messageContent.push({
        type: "image_url",
        image_url: {
          url: base64Data,
          detail: "high"
        }
      });
    }

    console.log(`[analyze-game-footage] Sending ${framesToAnalyze.length} frames to AI (${strategy.interval} strategy)`);

    // Call OpenAI API with GPT-4o (vision)
    const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: messageContent }
        ],
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[analyze-game-footage] AI gateway error: ${response.status}`, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ 
          error: "Rate limit exceeded. Please try again in a few minutes." 
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      if (response.status === 402) {
        return new Response(JSON.stringify({ 
          error: "AI credits exhausted. Please add funds to continue." 
        }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('No content in AI response');
    }

    console.log(`[analyze-game-footage] AI response received, parsing...`);

    // Parse JSON from response (handle markdown code blocks)
    let analysis;
    try {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();
      analysis = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('[analyze-game-footage] JSON parse error:', parseError);
      console.log('[analyze-game-footage] Raw content:', content.substring(0, 500));
      
      // Return a fallback structure
      analysis = {
        observations: [],
        teamObservations: {},
        paceAssessment: "unable to determine",
        bettingSignals: ["Analysis parsing failed - please try again with clearer footage"],
        recommendations: []
      };
    }

    console.log(`[analyze-game-footage] Analysis complete: ${analysis.observations?.length || 0} players, ${analysis.recommendations?.length || 0} recommendations`);

    // ==================== PROPS MATCHING ====================
    // Query unified_props for actual bookmaker lines
    let enrichedRecommendations = analysis.recommendations || [];
    let availablePropsCount = 0;

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (supabaseUrl && supabaseServiceKey && gameContext.eventId) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Get all player names from observations
        const observedPlayerNames = analysis.observations?.map((o: any) => o.playerName) || [];
        
        if (observedPlayerNames.length > 0) {
          console.log(`[analyze-game-footage] Querying props for ${observedPlayerNames.length} observed players`);

          // Query props for observed players
          const { data: availableProps, error: propsError } = await supabase
            .from("unified_props")
            .select("*")
            .eq("event_id", gameContext.eventId);

          if (propsError) {
            console.error('[analyze-game-footage] Props query error:', propsError);
          } else if (availableProps && availableProps.length > 0) {
            availablePropsCount = availableProps.length;
            console.log(`[analyze-game-footage] Found ${availablePropsCount} props for this game`);

            // Enrich recommendations with actual bookmaker lines
            enrichedRecommendations = (analysis.recommendations || []).map((rec: any) => {
              // Find matching prop (fuzzy match on player name and prop type)
              const matchingProp = availableProps.find((p: any) => {
                const playerMatch = p.player_name?.toLowerCase().includes(rec.playerName?.toLowerCase()) ||
                                    rec.playerName?.toLowerCase().includes(p.player_name?.toLowerCase());
                const propMatch = p.prop_type?.toLowerCase().includes(rec.propType?.toLowerCase()) ||
                                  rec.propType?.toLowerCase().includes(p.prop_type?.toLowerCase());
                return playerMatch && propMatch;
              });

              if (matchingProp) {
                return {
                  ...rec,
                  actualLine: matchingProp.current_line ?? matchingProp.line ?? null,
                  overPrice: matchingProp.over_price ?? matchingProp.over_odds ?? null,
                  underPrice: matchingProp.under_price ?? matchingProp.under_odds ?? null,
                  bookmaker: matchingProp.bookmaker ?? 'Unknown',
                  propAvailable: true,
                  lineDelta: matchingProp.current_line 
                    ? Number((rec.line - matchingProp.current_line).toFixed(1))
                    : null,
                };
              }

              return {
                ...rec,
                actualLine: null,
                overPrice: null,
                underPrice: null,
                bookmaker: null,
                propAvailable: false,
                lineDelta: null,
              };
            });
          }
        }
      }
    } catch (propsMatchError) {
      console.error('[analyze-game-footage] Props matching error:', propsMatchError);
      // Continue without props enrichment
    }

    // Update analysis with enriched recommendations
    analysis.recommendations = enrichedRecommendations;

    return new Response(JSON.stringify({
      success: true,
      analysis,
      framesAnalyzed: framesToAnalyze.length,
      totalFramesReceived: frames.length,
      frameStrategy: strategy.interval,
      availableProps: availablePropsCount,
      clipCategory,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error('[analyze-game-footage] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Analysis failed',
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
