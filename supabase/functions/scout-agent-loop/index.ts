import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PlayerLiveState {
  playerName: string;
  jersey: string;
  team: string;
  onCourt: boolean;
  role: 'PRIMARY' | 'SECONDARY' | 'SPACER' | 'BIG';
  fatigueScore: number;
  effortScore: number;
  speedIndex: number;
  reboundPositionScore: number;
  minutesEstimate: number;
  foulCount: number;
  visualFlags: string[];
  lastUpdated: string;
  sprintCount: number;
  handsOnKneesCount: number;
  slowRecoveryCount: number;
}

interface PropEdge {
  player: string;
  prop: string;
  line: number;
  lean: 'OVER' | 'UNDER';
  confidence: number;
  expectedFinal: number;
  drivers: string[];
  riskFlags: string[];
  trend: 'strengthening' | 'weakening' | 'stable';
  gameTime: string;
}

interface AgentLoopRequest {
  frame: string;
  gameContext: {
    eventId: string;
    homeTeam: string;
    awayTeam: string;
    homeRoster?: { name: string; jersey: string; position: string }[];
    awayRoster?: { name: string; jersey: string; position: string }[];
  };
  playerStates: Record<string, PlayerLiveState>;
  pbpData?: {
    gameTime: string;
    period: number;
    homeScore: number;
    awayScore: number;
    players: any[];
  };
  existingEdges: PropEdge[];
  currentGameTime?: string;
}

function getSceneClassificationPrompt(): string {
  return `SCENE CLASSIFICATION - Determine if this basketball game frame warrants analysis.

IGNORE (isAnalysisWorthy: false):
- Commercials/advertisements (brand logos, product shots)
- Crowd shots / fan reactions
- Bench B-roll footage
- Replay footage (indicated by "REPLAY" text, slow-motion, or different angle graphics)
- Scoreboard-only graphics
- Halftime show / intermission graphics
- Pre-game / post-game graphics

ANALYZE (isAnalysisWorthy: true):
- Live game action (players actively moving, ball in play)
- Timeout/huddle formations (players gathered, coach addressing team)
- Fast break transitions (full court movement)
- Free throw setups (player at line, set formation)
- Injury assessment situations (player down, trainers present)
- Inbound plays

ALSO EXTRACT from scoreboard if visible:
- Game clock (quarter and time, e.g., "Q2 5:42")
- Score (e.g., "LAL 54 - DEN 52")

Return JSON only:
{
  "sceneType": "live_play" | "timeout" | "injury" | "fastbreak" | "freethrow" | "commercial" | "dead_time" | "unknown",
  "isAnalysisWorthy": true | false,
  "confidence": "low" | "medium" | "high",
  "gameTime": "Q2 5:42" or null,
  "score": "LAL 54 - DEN 52" or null,
  "reason": "Brief 5-10 word explanation"
}`;
}

function getVisionAnalysisPrompt(playerStates: Record<string, PlayerLiveState>, sceneType: string): string {
  const playerContext = Object.values(playerStates)
    .filter(p => p.onCourt || p.minutesEstimate > 0)
    .map(p => `#${p.jersey} ${p.playerName} (${p.team}): Fatigue ${p.fatigueScore}/100, Speed ${p.speedIndex}/100`)
    .join('\n');

  return `BASKETBALL VISION ANALYSIS - Extract betting-relevant signals from this ${sceneType} frame.

CURRENT PLAYER STATES:
${playerContext || 'No player states available yet'}

EXTRACT SIGNALS FOR VISIBLE PLAYERS:
1. FATIGUE INDICATORS (affects unders)
   - Hands on knees (+8-10 fatigue)
   - Bent posture, heavy breathing (+5 fatigue)
   - Slow recovery after play (+5 fatigue)
   - Walking instead of jogging (+3 fatigue)

2. SPEED/EXPLOSIVENESS (affects overs/unders)
   - Sprint speed on breaks (rate 1-100)
   - Lateral movement quality
   - First step quickness

3. EFFORT/ENGAGEMENT (affects overs)
   - Active on defense
   - Calling for ball on offense
   - Box-out positioning for rebounds

4. POSITIONING (affects specific props)
   - Distance from rim at shot release (rebounds)
   - Court position (perimeter vs paint)
   - Transition involvement

IDENTIFY PLAYERS BY JERSEY NUMBER WHEN VISIBLE.

Return JSON:
{
  "visionSignals": [
    {
      "signalType": "fatigue" | "speed" | "effort" | "positioning",
      "player": "Player Name",
      "jersey": "#23",
      "value": -10 to +10 (negative = decrease, positive = increase),
      "observation": "Specific observation (hands on knees after sprint)",
      "confidence": "low" | "medium" | "high"
    }
  ],
  "overallAssessment": "Brief scene summary",
  "suggestedProps": [
    {
      "player": "Player Name",
      "prop": "Points" | "Rebounds" | "Assists" | "PRA",
      "lean": "OVER" | "UNDER",
      "reason": "Fatigue spike + low effort on defense"
    }
  ]
}`;
}

function calculatePropEdges(
  playerStates: Record<string, PlayerLiveState>,
  visionSignals: any[],
  pbpData: any,
  existingEdges: PropEdge[],
  gameTime: string
): PropEdge[] {
  const edges: PropEdge[] = [];
  
  Object.values(playerStates).forEach(player => {
    if (!player.onCourt && player.minutesEstimate < 5) return;
    
    // Get PBP stats for this player
    const pbpStats = pbpData?.players?.find((p: any) => 
      p.playerName?.toLowerCase() === player.playerName.toLowerCase()
    );
    
    // Calculate fatigue-driven unders
    if (player.fatigueScore >= 60) {
      const fatigueConfidence = Math.min(95, 50 + player.fatigueScore * 0.5);
      
      // Points under
      if (player.role === 'PRIMARY' || player.role === 'SECONDARY') {
        edges.push({
          player: player.playerName,
          prop: 'Points',
          line: 22.5, // Will be enriched with actual lines
          lean: 'UNDER',
          confidence: Math.round(fatigueConfidence),
          expectedFinal: 0, // Will be calculated with PBP
          drivers: [
            `Fatigue score: ${player.fatigueScore}/100`,
            `Speed index: ${player.speedIndex}/100`,
            player.handsOnKneesCount > 0 ? `Hands on knees x${player.handsOnKneesCount}` : null,
          ].filter(Boolean) as string[],
          riskFlags: player.foulCount >= 3 ? ['foul_trouble'] : [],
          trend: 'strengthening',
          gameTime,
        });
      }
      
      // Rebounds under for bigs
      if (player.role === 'BIG' && player.reboundPositionScore < 50) {
        edges.push({
          player: player.playerName,
          prop: 'Rebounds',
          line: 10.5,
          lean: 'UNDER',
          confidence: Math.round(fatigueConfidence * 0.9),
          expectedFinal: 0,
          drivers: [
            `Low rebound positioning: ${player.reboundPositionScore}/100`,
            `Fatigue affecting box-outs`,
          ],
          riskFlags: [],
          trend: 'strengthening',
          gameTime,
        });
      }
    }
    
    // Calculate effort-driven overs
    if (player.effortScore >= 70 && player.speedIndex >= 70 && player.fatigueScore < 40) {
      const overConfidence = Math.min(90, 40 + player.effortScore * 0.5 + player.speedIndex * 0.2);
      
      if (player.role === 'PRIMARY') {
        edges.push({
          player: player.playerName,
          prop: 'Points',
          line: 22.5,
          lean: 'OVER',
          confidence: Math.round(overConfidence),
          expectedFinal: 0,
          drivers: [
            `High effort score: ${player.effortScore}/100`,
            `Low fatigue: ${player.fatigueScore}/100`,
            `Speed maintained: ${player.speedIndex}/100`,
          ],
          riskFlags: [],
          trend: 'stable',
          gameTime,
        });
      }
    }
  });
  
  return edges;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      frame, 
      gameContext, 
      playerStates, 
      pbpData,
      existingEdges,
      currentGameTime 
    } = await req.json() as AgentLoopRequest;

    if (!frame) {
      return new Response(
        JSON.stringify({ error: 'No frame provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const base64Data = frame.replace(/^data:image\/\w+;base64,/, '');

    // STEP 1: Scene Classification (fast model)
    console.log('[Scout Agent] Step 1: Scene classification');
    
    const classifyResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          { 
            role: 'system', 
            content: `You are a basketball broadcast scene classifier. Game: ${gameContext.awayTeam} @ ${gameContext.homeTeam}` 
          },
          { 
            role: 'user', 
            content: [
              { type: 'text', text: getSceneClassificationPrompt() },
              { 
                type: 'image_url', 
                image_url: { url: `data:image/jpeg;base64,${base64Data}`, detail: 'low' } 
              }
            ] 
          },
        ],
        max_tokens: 250,
      }),
    });

    if (!classifyResponse.ok) {
      if (classifyResponse.status === 429) {
        return new Response(
          JSON.stringify({ 
            error: 'Rate limit', 
            sceneClassification: { isAnalysisWorthy: false, reason: 'Rate limited' } 
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Classification failed: ${classifyResponse.status}`);
    }

    const classifyData = await classifyResponse.json();
    const classifyContent = classifyData.choices?.[0]?.message?.content || '';
    
    let sceneClassification = {
      sceneType: 'unknown',
      isAnalysisWorthy: false,
      confidence: 'low',
      gameTime: null as string | null,
      score: null as string | null,
      reason: 'Could not parse classification',
      timestamp: new Date().toISOString(),
    };

    try {
      const jsonMatch = classifyContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : classifyContent.trim();
      const parsed = JSON.parse(jsonStr);
      sceneClassification = { ...sceneClassification, ...parsed, timestamp: new Date().toISOString() };
    } catch {
      console.log('[Scout Agent] Scene classification parse failed, using defaults');
    }

    // If scene is not analysis-worthy, return early
    if (!sceneClassification.isAnalysisWorthy) {
      console.log(`[Scout Agent] Skipping analysis: ${sceneClassification.reason}`);
      return new Response(
        JSON.stringify({
          sceneClassification,
          gameTime: sceneClassification.gameTime || currentGameTime,
          score: sceneClassification.score,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // STEP 2: Vision Analysis (detailed model)
    console.log(`[Scout Agent] Step 2: Vision analysis for ${sceneClassification.sceneType}`);

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

    const visionResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { 
            role: 'system', 
            content: `You are an AI sports analyst extracting betting signals from live game footage.
Game: ${gameContext.awayTeam} @ ${gameContext.homeTeam}
${rosterContext}

CRITICAL: Match jersey numbers to player names from the roster. Be specific about observations.` 
          },
          { 
            role: 'user', 
            content: [
              { type: 'text', text: getVisionAnalysisPrompt(playerStates, sceneClassification.sceneType) },
              { 
                type: 'image_url', 
                image_url: { url: `data:image/jpeg;base64,${base64Data}`, detail: 'low' } 
              }
            ] 
          },
        ],
        max_tokens: 800,
      }),
    });

    if (!visionResponse.ok) {
      console.error('[Scout Agent] Vision analysis failed:', visionResponse.status);
      return new Response(
        JSON.stringify({
          sceneClassification,
          gameTime: sceneClassification.gameTime || currentGameTime,
          score: sceneClassification.score,
          error: 'Vision analysis failed',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const visionData = await visionResponse.json();
    const visionContent = visionData.choices?.[0]?.message?.content || '';
    
    let visionResult = {
      visionSignals: [] as any[],
      overallAssessment: '',
      suggestedProps: [] as any[],
    };

    try {
      const jsonMatch = visionContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : visionContent.trim();
      visionResult = JSON.parse(jsonStr);
    } catch {
      console.log('[Scout Agent] Vision result parse failed');
    }

    // STEP 3: Calculate prop edges
    const gameTime = sceneClassification.gameTime || currentGameTime || 'Unknown';
    const propEdges = calculatePropEdges(
      playerStates,
      visionResult.visionSignals || [],
      pbpData,
      existingEdges,
      gameTime
    );

    // STEP 4: Determine if notification is warranted
    let shouldNotify = false;
    let notification = null;

    const topEdge = propEdges.find(e => e.confidence >= 75 && e.trend === 'strengthening');
    if (topEdge) {
      shouldNotify = true;
      notification = {
        player: topEdge.player,
        prop: topEdge.prop,
        lean: topEdge.lean,
        confidence: topEdge.confidence,
        reason: topEdge.drivers.slice(0, 2).join(' + '),
        gameTime,
      };
    }

    console.log(`[Scout Agent] Analysis complete: ${visionResult.visionSignals?.length || 0} signals, ${propEdges.length} edges`);

    return new Response(
      JSON.stringify({
        sceneClassification,
        visionSignals: visionResult.visionSignals,
        propEdges,
        updatedPlayerStates: {}, // Will be calculated by client based on signals
        gameTime,
        score: sceneClassification.score,
        shouldNotify,
        notification,
        overallAssessment: visionResult.overallAssessment,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Scout Agent] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
