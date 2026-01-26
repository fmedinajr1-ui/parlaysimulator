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
  momentType: 'timeout' | 'injury' | 'fastbreak' | 'freethrow' | 'other' | 'auto';
  isPriority: boolean;
  existingObservations?: string[];
  isAutoDetect?: boolean;
}

function getMomentSpecificPrompt(momentType: string): string {
  const prompts: Record<string, string> = {
    timeout: `TIMEOUT/HUDDLE ANALYSIS - Focus on:
- Fatigue indicators: bent posture, hands on knees, heavy breathing
- Players seeking bench vs staying active
- Body language: frustration, focus, exhaustion
- Who needs substitution vs who's still energetic
- SPRINT/MOVEMENT: Track which players moved quickly vs slowly before timeout`,
    
    injury: `INJURY CHECK ANALYSIS - Focus on:
- Identify which player appears injured
- Assess severity cues: limping, holding body part, facial expressions
- Substitution likelihood indicators
- Impact on team rotation
- OTHER PLAYERS: Note fatigue or positioning of non-injured players`,
    
    fastbreak: `FAST BREAK ANALYSIS - Focus on:
- Player explosiveness and sprint speed (rate each visible player 1-10)
- Court coverage efficiency
- Transition energy levels
- Who leads vs trails on the break
- MOVEMENT TRACKING: Identify sprinting players by jersey number`,
    
    freethrow: `FREE THROW ANALYSIS - Focus on:
- Shot mechanics consistency
- Pre-shot routine execution
- Focus indicators: eye contact with rim, body stillness
- Signs of fatigue affecting form
- OTHER PLAYERS: Positioning for rebounds, fatigue signs while waiting`,
    
    other: `GENERAL KEY MOMENT ANALYSIS - Focus on:
- Player energy and movement quality (rate each visible player 1-10)
- Team dynamics and body language
- Fatigue indicators across both teams
- Notable performance signals
- MOVEMENT TRACKING: Note players sprinting, standing still, or showing slow recovery`,
  };
  
  return prompts[momentType] || prompts.other;
}

// PHASE 3 ENHANCEMENT: Team color and jersey detection context
function getTeamColorDetectionContext(homeTeam: string, awayTeam: string): string {
  return `
JERSEY IDENTIFICATION GUIDE:
1. First, identify the two jersey colors on court
2. Home team (${homeTeam}) typically wears WHITE/LIGHT jerseys at home
3. Away team (${awayTeam}) typically wears DARK/COLORED jerseys
4. Read the NUMBER on front or back of jersey
5. Cross-reference with roster table provided
6. If number is unclear, report as "Unknown #{team} player"

MOVEMENT TRACKING:
For each player you can identify:
- Note if they are SPRINTING (explosive movement)
- Note if they are STATIONARY (minimal movement - fatigue indicator)
- Note if they are in SLOW RECOVERY (walking after exertion)
- Track position changes between frames if multiple frames provided`;
}

function getAutoDetectPrompt(): string {
  return `QUICK SCENE CLASSIFICATION - Identify what's happening on the basketball court.

DETECT ONE OF THESE MOMENTS:
- "timeout" = Players in huddle, coach talking to team, bench area activity, players gathered
- "injury" = Player down on court, trainers attending, player limping, holding body part
- "fastbreak" = Full court sprint, transition play, fast movement toward basket, players running
- "freethrow" = Player at free throw line, set formation, other players lined up on lane

ALSO EXTRACT:
- Game clock if visible (look for scoreboard showing quarter and time like "Q2 5:42" or "2nd 5:42")
- Score if visible

Return JSON:
{
  "detectedMoment": "timeout" | "injury" | "fastbreak" | "freethrow" | null,
  "confidence": "low" | "medium" | "high",
  "gameTime": "Q2 5:42" or null,
  "score": "HOM 45 - AWY 42" or null,
  "reason": "Brief 5-10 word explanation"
}

If nothing notable is happening (regular play), return detectedMoment as null.`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { frames, gameContext, momentType, isPriority, existingObservations, isAutoDetect } = await req.json() as LiveFrameRequest;

    if (!frames || frames.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No frames provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    // AUTO-DETECT MODE: Quick classification scan
    if (isAutoDetect || momentType === 'auto') {
      console.log('Running auto-detect mode on 1 frame');
      
      const frame = frames[0];
      const base64Data = frame.replace(/^data:image\/\w+;base64,/, '');
      
      const autoContent: any[] = [
        { type: 'text', text: getAutoDetectPrompt() },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${base64Data}`,
            detail: 'low',
          },
        },
      ];

      const autoResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: `You are a basketball game scene classifier. Game: ${gameContext.awayTeam} @ ${gameContext.homeTeam}` },
            { role: 'user', content: autoContent },
          ],
          max_tokens: 200,
        }),
      });

      if (!autoResponse.ok) {
        if (autoResponse.status === 429) {
          return new Response(
            JSON.stringify({ error: 'Rate limit exceeded', detectedMoment: null }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (autoResponse.status === 402) {
          return new Response(
            JSON.stringify({ error: 'AI credits exhausted', detectedMoment: null }),
            { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        throw new Error(`AI Gateway error: ${autoResponse.status}`);
      }

      const autoAiResponse = await autoResponse.json();
      const autoContentResponse = autoAiResponse.choices?.[0]?.message?.content;

      let autoResult = { detectedMoment: null, confidence: 'low', gameTime: null, reason: null };
      try {
        const jsonMatch = autoContentResponse?.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1].trim() : autoContentResponse?.trim();
        autoResult = JSON.parse(jsonStr);
      } catch {
        console.log('Auto-detect parse failed, returning null detection');
      }

      return new Response(
        JSON.stringify({
          ...autoResult,
          isAutoDetect: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // STANDARD MODE: Full analysis
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

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
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
