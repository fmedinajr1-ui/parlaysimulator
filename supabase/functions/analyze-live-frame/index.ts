import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LiveFrameRequest {
  frames: string[];
  gameContext: {
    eventId: string;
    homeTeam: string;
    awayTeam: string;
    homeRoster?: { name: string; jersey: string; position: string }[];
    awayRoster?: { name: string; jersey: string; position: string }[];
  };
  momentType: 'timeout' | 'injury' | 'fastbreak' | 'freethrow' | 'other';
  isPriority: boolean;
  existingObservations?: string[];
}

function getMomentSpecificPrompt(momentType: string): string {
  const prompts: Record<string, string> = {
    timeout: `TIMEOUT/HUDDLE ANALYSIS - Focus on:
- Fatigue indicators: bent posture, hands on knees, heavy breathing
- Players seeking bench vs staying active
- Body language: frustration, focus, exhaustion
- Who needs substitution vs who's still energetic`,
    
    injury: `INJURY CHECK ANALYSIS - Focus on:
- Identify which player appears injured
- Assess severity cues: limping, holding body part, facial expressions
- Substitution likelihood indicators
- Impact on team rotation`,
    
    fastbreak: `FAST BREAK ANALYSIS - Focus on:
- Player explosiveness and sprint speed
- Court coverage efficiency
- Transition energy levels
- Who leads vs trails on the break`,
    
    freethrow: `FREE THROW ANALYSIS - Focus on:
- Shot mechanics consistency
- Pre-shot routine execution
- Focus indicators: eye contact with rim, body stillness
- Signs of fatigue affecting form`,
    
    other: `GENERAL KEY MOMENT ANALYSIS - Focus on:
- Player energy and movement quality
- Team dynamics and body language
- Fatigue indicators across both teams
- Notable performance signals`,
  };
  
  return prompts[momentType] || prompts.other;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { frames, gameContext, momentType, isPriority, existingObservations } = await req.json() as LiveFrameRequest;

    if (!frames || frames.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No frames provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    // Build roster context
    let rosterContext = '';
    if (gameContext.homeRoster?.length) {
      rosterContext += `\n${gameContext.homeTeam} Roster:\n`;
      gameContext.homeRoster.forEach(p => {
        rosterContext += `- #${p.jersey} ${p.name} (${p.position})\n`;
      });
    }
    if (gameContext.awayRoster?.length) {
      rosterContext += `\n${gameContext.awayTeam} Roster:\n`;
      gameContext.awayRoster.forEach(p => {
        rosterContext += `- #${p.jersey} ${p.name} (${p.position})\n`;
      });
    }

    // Build context from existing observations
    let existingContext = '';
    if (existingObservations?.length) {
      existingContext = `\nPREVIOUS OBSERVATIONS (avoid repeating):\n${existingObservations.map(o => `- ${o}`).join('\n')}\n`;
    }

    const systemPrompt = `You are an AI sports analyst specializing in real-time game observation for betting insights.
You analyze live game footage frames to detect player fatigue, energy levels, and performance indicators.

Game: ${gameContext.awayTeam} @ ${gameContext.homeTeam}
${rosterContext}
${existingContext}

${getMomentSpecificPrompt(momentType)}

CRITICAL: Identify players by jersey number when visible. Be specific about what you observe.
${isPriority ? 'This is a PRIORITY KEY MOMENT - provide detailed analysis.' : ''}`;

    const userPrompt = `Analyze these ${frames.length} frames from a ${momentType} moment.

Return a JSON object with this exact structure:
{
  "observations": [
    {
      "playerName": "Player Name or #Jersey",
      "type": "fatigue" | "energy" | "mechanics" | "team",
      "observation": "Specific observation (1-2 sentences)",
      "confidence": "low" | "medium" | "high",
      "bettingImplication": "How this affects betting (optional)"
    }
  ],
  "gameTime": "Estimated game time if visible (e.g., Q2 5:42)",
  "overallAssessment": "Brief summary of the moment",
  "suggestedNextCapture": 20000
}

Focus on NEW observations. Be concise but specific.`;

    // Build content array with frames
    const content: any[] = [{ type: 'text', text: userPrompt }];
    
    // Add frames (max 5 for quick analysis)
    const framesToAnalyze = frames.slice(0, 5);
    framesToAnalyze.forEach((frame, index) => {
      const base64Data = frame.replace(/^data:image\/\w+;base64,/, '');
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${base64Data}`,
          detail: 'low', // Use low detail for faster processing
        },
      });
    });

    console.log(`Analyzing ${framesToAnalyze.length} frames for ${momentType} moment`);

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content },
        ],
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please wait a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add credits.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const content_response = aiResponse.choices?.[0]?.message?.content;

    if (!content_response) {
      throw new Error('No response from AI');
    }

    // Parse JSON from response
    let result;
    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = content_response.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : content_response.trim();
      result = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Failed to parse AI response:', content_response);
      result = {
        observations: [],
        gameTime: 'Unknown',
        overallAssessment: 'Analysis completed but could not parse detailed observations',
        suggestedNextCapture: 30000,
      };
    }

    return new Response(
      JSON.stringify({
        ...result,
        momentType,
        framesAnalyzed: framesToAnalyze.length,
        isPriority,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('analyze-live-frame error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
