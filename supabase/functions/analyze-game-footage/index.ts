import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

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
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const { frames, gameContext, clipCategory }: AnalysisRequest = await req.json();
    
    if (!frames || frames.length === 0) {
      throw new Error('No frames provided for analysis');
    }

    console.log(`[analyze-game-footage] Analyzing ${frames.length} frames for ${gameContext.awayTeam} @ ${gameContext.homeTeam}`);
    console.log(`[analyze-game-footage] Clip category: ${clipCategory}`);

    // Build the analysis prompt
    const systemPrompt = `You are an expert NBA video analyst specializing in detecting betting-relevant signals from game footage. You identify players by jersey numbers and analyze their movement, fatigue, and mechanics for halftime betting insights.

Your analysis must be grounded in VISUAL OBSERVATIONS from the frames provided. Do not guess or invent observations.

KEY ANALYSIS AREAS:
1. PLAYER IDENTIFICATION - Match jersey numbers to roster names
2. MOVEMENT QUALITY - Score 1-10 (explosiveness, lateral movement, recovery speed)
3. FATIGUE INDICATORS - Hands on knees, slow transition, heavy breathing, hunched posture
4. BODY LANGUAGE - Frustrated, confident, disengaged, locked in
5. SHOT MECHANICS - Release point, follow-through consistency (if visible)
6. TEAM DYNAMICS - Communication, defensive rotations, pace

CLIP CATEGORY FOCUS:
- timeout: Look for fatigue indicators (hands on knees, towel usage, heavy breathing)
- fastbreak: Assess explosion, transition speed, effort levels
- freethrow: Analyze shot mechanics, routine consistency, focus
- defense: Evaluate closeout speed, rotation discipline, communication`;

    const userPrompt = `GAME: ${gameContext.awayTeam} @ ${gameContext.homeTeam}
CLIP CATEGORY: ${clipCategory}

ROSTER CONTEXT:
${gameContext.homeTeam}: ${gameContext.homeRoster || 'Not available'}
${gameContext.awayTeam}: ${gameContext.awayRoster || 'Not available'}

Analyze the ${frames.length} frames provided and return a JSON object with this exact structure:

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
- Return ONLY valid JSON, no markdown or explanation`;

    // Build message content with images
    const messageContent: any[] = [
      { type: "text", text: userPrompt }
    ];

    // Add frames as images (limit to 10 for token efficiency)
    const framesToAnalyze = frames.slice(0, 10);
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

    console.log(`[analyze-game-footage] Sending ${framesToAnalyze.length} frames to AI`);

    // Call Lovable AI Gateway with Gemini 2.5 Pro (multimodal)
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
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

    return new Response(JSON.stringify({
      success: true,
      analysis,
      framesAnalyzed: framesToAnalyze.length,
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
