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
  fatigueSlope?: number;
  boxScore?: {
    points: number;
    rebounds: number;
    assists: number;
    fouls: number;
    fga: number;
    fta: number;
    turnovers: number;
    threes: number;
    steals: number;
    blocks: number;
  };
}

interface PropLine {
  playerName: string;
  propType: 'points' | 'rebounds' | 'assists';
  line: number;
  overPrice?: number;
  underPrice?: number;
  bookmaker?: string;
}

interface LivePBPData {
  gameTime: string;
  period: number;
  clock: string;
  homeScore: number;
  awayScore: number;
  homeTeam: string;
  awayTeam: string;
  pace: number;
  players: any[];
  recentPlays: any[];
  isHalftime: boolean;
  isGameOver: boolean;
  isQ3Starting?: boolean;
  isQ4Starting?: boolean;
}

interface DataProjectionRequest {
  playerStates: Record<string, PlayerLiveState>;
  pbpData: LivePBPData;
  propLines?: PropLine[];
  gameContext: {
    eventId: string;
    homeTeam: string;
    awayTeam: string;
  };
}

interface LiveBox {
  pts: number;
  reb: number;
  ast: number;
  pra: number;
  min: number;
  fouls: number;
  fga: number;
  fta: number;
  threes: number;
  steals: number;
  blocks: number;
}

// Build lookup for prop lines
function buildPropLineLookup(propLines?: PropLine[]): Map<string, PropLine> {
  const lookup = new Map<string, PropLine>();
  if (!propLines) return lookup;
  
  propLines.forEach(pl => {
    const key = `${pl.playerName.toLowerCase()}_${pl.propType.toLowerCase()}`;
    lookup.set(key, pl);
  });
  
  return lookup;
}

// Get line from lookup or default
function getLine(
  lookup: Map<string, PropLine>,
  playerName: string,
  prop: string,
  role: string
): { line: number; overPrice?: number; underPrice?: number; bookmaker?: string } {
  const propType = prop.toLowerCase();
  const key = `${playerName.toLowerCase()}_${propType}`;
  const propLine = lookup.get(key);
  
  if (propLine) {
    return {
      line: propLine.line,
      overPrice: propLine.overPrice,
      underPrice: propLine.underPrice,
      bookmaker: propLine.bookmaker,
    };
  }
  
  // Role-based defaults
  const defaults: Record<string, Record<string, number>> = {
    'PRIMARY': { points: 24.5, rebounds: 5.5, assists: 5.5 },
    'SECONDARY': { points: 16.5, rebounds: 4.5, assists: 4.5 },
    'BIG': { points: 12.5, rebounds: 9.5, assists: 2.5 },
    'SPACER': { points: 8.5, rebounds: 3.5, assists: 2.5 },
  };
  
  return { line: defaults[role]?.[propType] || 15.5 };
}

// Build LiveBox from PBP data
function getLiveBox(playerName: string, pbpData: LivePBPData): LiveBox | null {
  const pbpPlayer = pbpData.players.find(
    p => p.playerName.toLowerCase() === playerName.toLowerCase()
  );
  
  if (!pbpPlayer) return null;
  
  return {
    pts: pbpPlayer.points || 0,
    reb: pbpPlayer.rebounds || 0,
    ast: pbpPlayer.assists || 0,
    pra: (pbpPlayer.points || 0) + (pbpPlayer.rebounds || 0) + (pbpPlayer.assists || 0),
    min: pbpPlayer.minutes || 0,
    fouls: pbpPlayer.fouls || 0,
    fga: pbpPlayer.fga || 0,
    fta: pbpPlayer.fta || 0,
    threes: pbpPlayer.threePm || 0,
    steals: pbpPlayer.steals || 0,
    blocks: pbpPlayer.blocks || 0,
  };
}

// Calculate remaining minutes
function calculateRemainingMinutes(
  state: PlayerLiveState,
  live: LiveBox | null,
  scoreDiff: number,
  period: number
): { remaining: number; riskFlags: string[]; blowoutPenalty: number; foulPenalty: number } {
  const played = live?.min ?? 0;
  const riskFlags: string[] = [];
  
  // Role-based expected totals
  const roleBasedExpected = 
    state.role === 'PRIMARY' ? 34 :
    state.role === 'SECONDARY' ? 28 :
    state.role === 'BIG' ? 30 : 22;
  
  let expectedTotal = state.minutesEstimate;
  if (expectedTotal <= 0 || (expectedTotal <= played && played > 10)) {
    expectedTotal = roleBasedExpected;
    console.log(`[Data Projection] Using role-based estimate for ${state.playerName}: ${expectedTotal} min`);
  }
  
  let remaining = Math.max(0, expectedTotal - played);
  
  // Foul penalties
  let foulPenalty = 1.0;
  const fouls = live?.fouls ?? state.foulCount;
  if (fouls >= 5) {
    foulPenalty = 0.5;
    remaining *= 0.5;
    riskFlags.push('foul_trouble');
  } else if (fouls >= 4) {
    foulPenalty = 0.75;
    remaining *= 0.75;
    riskFlags.push('foul_risk');
  } else if (fouls >= 3) {
    foulPenalty = 0.9;
    remaining *= 0.9;
  }
  
  // Blowout penalties
  let blowoutPenalty = 1.0;
  const absScoreDiff = Math.abs(scoreDiff);
  
  if (period >= 4 && absScoreDiff >= 20) {
    blowoutPenalty = 0.4;
    remaining *= 0.4;
    riskFlags.push('blowout_garbage_time');
  } else if (period >= 4 && absScoreDiff >= 15) {
    blowoutPenalty = 0.6;
    remaining *= 0.6;
    riskFlags.push('blowout_risk');
  } else if (period >= 3 && absScoreDiff >= 25) {
    blowoutPenalty = 0.7;
    remaining *= 0.7;
    riskFlags.push('blowout_early');
  }
  
  return { remaining: Math.max(0, remaining), riskFlags, blowoutPenalty, foulPenalty };
}

// Calculate rate per minute
function calculateRate(
  live: LiveBox | null,
  prop: string,
  role: string
): number {
  // Base role rates
  const baseRates: Record<string, Record<string, number>> = {
    'PRIMARY': { Points: 0.75, Rebounds: 0.18, Assists: 0.20 },
    'SECONDARY': { Points: 0.55, Rebounds: 0.15, Assists: 0.16 },
    'BIG': { Points: 0.40, Rebounds: 0.32, Assists: 0.10 },
    'SPACER': { Points: 0.35, Rebounds: 0.12, Assists: 0.10 },
  };
  
  const baseRate = baseRates[role]?.[prop] || 0.3;
  
  if (!live || live.min < 5) {
    return baseRate;
  }
  
  // Calculate live rate
  const current = prop === 'Points' ? live.pts :
                  prop === 'Rebounds' ? live.reb :
                  prop === 'Assists' ? live.ast : 0;
  
  const liveRate = current / live.min;
  
  // Blend: 40% base, 60% live (weighted toward live data)
  return baseRate * 0.4 + liveRate * 0.6;
}

// Project final stat
function projectFinal(
  state: PlayerLiveState,
  live: LiveBox | null,
  prop: string,
  scoreDiff: number,
  period: number
): { expected: number; remaining: number; riskFlags: string[] } {
  const { remaining, riskFlags } = calculateRemainingMinutes(state, live, scoreDiff, period);
  const rate = calculateRate(live, prop, state.role);
  
  const current = live ? (
    prop === 'Points' ? live.pts :
    prop === 'Rebounds' ? live.reb :
    prop === 'Assists' ? live.ast : 0
  ) : 0;
  
  // Apply fatigue modifier
  let fatigueModifier = 1.0;
  if (state.fatigueScore >= 60) {
    fatigueModifier = 0.85;
  } else if (state.fatigueScore >= 45) {
    fatigueModifier = 0.92;
  }
  
  const projected = rate * remaining * fatigueModifier;
  const expected = current + projected;
  
  return { expected, remaining, riskFlags };
}

// Compute confidence score
function computeConfidence(
  edgeMargin: number,
  state: PlayerLiveState,
  riskFlags: string[],
  live: LiveBox | null
): number {
  let confidence = 50;
  
  // Edge margin boost
  if (edgeMargin >= 5) confidence += 25;
  else if (edgeMargin >= 3) confidence += 18;
  else if (edgeMargin >= 2) confidence += 12;
  else if (edgeMargin >= 1) confidence += 6;
  
  // Minutes played reliability
  const minutesPlayed = live?.min ?? 0;
  if (minutesPlayed >= 20) confidence += 10;
  else if (minutesPlayed >= 15) confidence += 7;
  else if (minutesPlayed >= 10) confidence += 4;
  
  // Risk flag penalties
  if (riskFlags.includes('blowout_garbage_time')) confidence -= 15;
  if (riskFlags.includes('blowout_risk')) confidence -= 8;
  if (riskFlags.includes('foul_trouble')) confidence -= 12;
  if (riskFlags.includes('foul_risk')) confidence -= 5;
  
  // Fatigue boost for unders
  if (state.fatigueScore >= 50) confidence += 5;
  
  return Math.min(99, Math.max(1, Math.round(confidence)));
}

// Calculate prop edges from data only (no vision)
function calculateDataOnlyEdges(
  playerStates: Record<string, PlayerLiveState>,
  pbpData: LivePBPData,
  propLines?: PropLine[]
): any[] {
  const edges: any[] = [];
  const propLineLookup = buildPropLineLookup(propLines);
  
  const scoreDiff = pbpData.homeScore - pbpData.awayScore;
  const period = pbpData.period;
  const gameTime = pbpData.gameTime;
  
  Object.values(playerStates).forEach(player => {
    const live = getLiveBox(player.playerName, pbpData);
    
    // Skip players with no minutes
    if (!live || live.min < 3) return;
    
    const props = ['Points', 'Rebounds', 'Assists'];
    
    props.forEach(prop => {
      const { line, overPrice, underPrice, bookmaker } = getLine(
        propLineLookup, player.playerName, prop, player.role
      );
      
      const { expected, remaining, riskFlags } = projectFinal(
        player, live, prop, scoreDiff, period
      );
      
      const edgeMargin = Math.abs(expected - line);
      
      // Only create edge if margin is significant
      if (edgeMargin < 1.0) return;
      
      const lean = expected > line ? 'OVER' : 'UNDER';
      const confidence = computeConfidence(edgeMargin, player, riskFlags, live);
      
      // Filter out low confidence
      if (confidence < 50) return;
      
      const currentStat = prop === 'Points' ? live.pts :
                          prop === 'Rebounds' ? live.reb :
                          prop === 'Assists' ? live.ast : 0;
      
      const rate = calculateRate(live, prop, player.role);
      
      edges.push({
        player: player.playerName,
        prop,
        line,
        lean,
        confidence,
        expectedFinal: Math.round(expected * 10) / 10,
        drivers: [
          `Current: ${currentStat}/${line} (${Math.round((currentStat / line) * 100)}%)`,
          `Rate: ${rate.toFixed(2)}/min`,
          `Est. ${remaining.toFixed(1)} min remaining`,
          player.fatigueScore >= 40 ? `Fatigue: ${player.fatigueScore}%` : null,
        ].filter(Boolean),
        riskFlags,
        trend: 'stable',
        gameTime,
        currentStat,
        minutesPlayed: live.min,
        remainingMinutes: remaining,
        edgeMargin: Math.round(edgeMargin * 10) / 10,
        ratePerMinute: Math.round(rate * 100) / 100,
        overPrice,
        underPrice,
        bookmaker,
      });
    });
  });
  
  // Sort by confidence
  edges.sort((a, b) => b.confidence - a.confidence);
  
  console.log(`[Data Projection] Generated ${edges.length} data-only prop edges`);
  return edges;
}

// Generate period-based auto-suggest recommendations
function generatePeriodBasedRecommendations(
  playerStates: Record<string, PlayerLiveState>,
  pbpData: LivePBPData,
  propLines: PropLine[] | undefined,
  triggerType: 'Q3_START' | 'Q4_START' | 'FINAL_MINUTES'
): any[] {
  const recommendations: any[] = [];
  const propLineLookup = buildPropLineLookup(propLines);
  
  const scoreDiff = pbpData.homeScore - pbpData.awayScore;
  const period = pbpData.period;
  
  Object.values(playerStates).forEach(player => {
    const live = getLiveBox(player.playerName, pbpData);
    if (!live || live.min < 5) return;
    
    // Q3 START: Generate halftime-style recommendations
    if (triggerType === 'Q3_START') {
      const isFatigued = player.fatigueScore >= 40;
      const isEnergized = player.fatigueScore < 25 && player.effortScore > 60;
      
      if ((player.role === 'PRIMARY' || player.role === 'SECONDARY') && (isFatigued || isEnergized)) {
        const { line, overPrice, underPrice, bookmaker } = getLine(
          propLineLookup, player.playerName, 'Points', player.role
        );
        const { expected, remaining, riskFlags } = projectFinal(
          player, live, 'Points', scoreDiff, period
        );
        
        recommendations.push({
          mode: 'AUTO_SUGGEST',
          trigger: 'Q3_START',
          player: player.playerName,
          prop: 'Points',
          line,
          lean: isFatigued ? 'UNDER' : 'OVER',
          confidence: computeConfidence(Math.abs(expected - line), player, riskFlags, live),
          expectedFinal: Math.round(expected * 10) / 10,
          drivers: [
            `1H Stats: ${live.pts}pts, ${live.reb}reb, ${live.ast}ast`,
            isFatigued ? `Fatigue building: ${player.fatigueScore}%` : `Fresh legs: ${player.fatigueScore}%`,
            `${live.min.toFixed(1)} min played`,
          ],
          riskFlags,
          lockTime: pbpData.gameTime,
          firstHalfStats: {
            points: live.pts,
            rebounds: live.reb,
            assists: live.ast,
            minutes: live.min,
          },
          overPrice,
          underPrice,
          bookmaker,
        });
      }
    }
    
    // Q4 START: Final push recommendations
    if (triggerType === 'Q4_START') {
      const isOnPace = (live.pts / live.min) > 0.6; // High scoring rate
      const isBehindPace = (live.pts / live.min) < 0.4; // Low scoring rate
      
      if (player.role === 'PRIMARY' || player.role === 'SECONDARY') {
        const { line, overPrice, underPrice, bookmaker } = getLine(
          propLineLookup, player.playerName, 'Points', player.role
        );
        const { expected, remaining, riskFlags } = projectFinal(
          player, live, 'Points', scoreDiff, period
        );
        
        const edgeMargin = Math.abs(expected - line);
        if (edgeMargin >= 2) {
          recommendations.push({
            mode: 'AUTO_SUGGEST',
            trigger: 'Q4_START',
            player: player.playerName,
            prop: 'Points',
            line,
            lean: expected > line ? 'OVER' : 'UNDER',
            confidence: computeConfidence(edgeMargin, player, riskFlags, live),
            expectedFinal: Math.round(expected * 10) / 10,
            drivers: [
              `Current: ${live.pts}pts (${Math.round((live.pts / line) * 100)}% of line)`,
              `Rate: ${(live.pts / live.min).toFixed(2)}/min`,
              `~${remaining.toFixed(1)} min remaining`,
              riskFlags.length > 0 ? `⚠️ ${riskFlags.join(', ')}` : null,
            ].filter(Boolean),
            riskFlags,
            lockTime: pbpData.gameTime,
            overPrice,
            underPrice,
            bookmaker,
          });
        }
      }
    }
    
    // FINAL MINUTES: Under 2 min remaining
    if (triggerType === 'FINAL_MINUTES') {
      ['Points', 'Rebounds', 'Assists'].forEach(prop => {
        const { line, overPrice, underPrice, bookmaker } = getLine(
          propLineLookup, player.playerName, prop, player.role
        );
        
        const current = prop === 'Points' ? live.pts :
                        prop === 'Rebounds' ? live.reb :
                        prop === 'Assists' ? live.ast : 0;
        
        const diff = current - line;
        const isOver = diff > 0;
        const isClear = Math.abs(diff) >= 1;
        
        if (isClear) {
          recommendations.push({
            mode: 'AUTO_SUGGEST',
            trigger: 'FINAL_MINUTES',
            player: player.playerName,
            prop,
            line,
            lean: isOver ? 'OVER' : 'UNDER',
            confidence: Math.min(95, 70 + Math.abs(diff) * 5),
            expectedFinal: current,
            drivers: [
              `Final: ${current} vs ${line} line`,
              isOver ? `✅ Already over by ${diff.toFixed(1)}` : `🛑 Short by ${Math.abs(diff).toFixed(1)}`,
            ],
            riskFlags: [],
            lockTime: pbpData.gameTime,
            overPrice,
            underPrice,
            bookmaker,
          });
        }
      });
    }
  });
  
  return recommendations;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: DataProjectionRequest = await req.json();
    const { playerStates, pbpData, propLines, gameContext } = body;

    if (!playerStates || !pbpData) {
      return new Response(
        JSON.stringify({ error: 'playerStates and pbpData are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Data Projection] Processing for event ${gameContext?.eventId}, period ${pbpData.period}`);

    // Calculate edges from data only
    const propEdges = calculateDataOnlyEdges(playerStates, pbpData, propLines);

    // Check for period-based triggers
    let autoSuggestRecommendations: any[] = [];
    
    if (pbpData.isQ3Starting) {
      console.log('[Data Projection] Q3 starting - generating auto-suggest bets');
      autoSuggestRecommendations = generatePeriodBasedRecommendations(
        playerStates, pbpData, propLines, 'Q3_START'
      );
    } else if (pbpData.isQ4Starting) {
      console.log('[Data Projection] Q4 starting - generating final push recommendations');
      autoSuggestRecommendations = generatePeriodBasedRecommendations(
        playerStates, pbpData, propLines, 'Q4_START'
      );
    }

    // Check for final minutes
    const clockParts = pbpData.clock.split(':');
    const minutes = parseInt(clockParts[0]) || 0;
    const seconds = parseInt(clockParts[1]) || 0;
    const totalSeconds = minutes * 60 + seconds;
    
    if (pbpData.period === 4 && totalSeconds <= 120) {
      console.log('[Data Projection] Final 2 minutes - generating final recommendations');
      const finalRecs = generatePeriodBasedRecommendations(
        playerStates, pbpData, propLines, 'FINAL_MINUTES'
      );
      autoSuggestRecommendations = [...autoSuggestRecommendations, ...finalRecs];
    }

    return new Response(
      JSON.stringify({
        propEdges,
        autoSuggestRecommendations,
        gameTime: pbpData.gameTime,
        period: pbpData.period,
        isHalftime: pbpData.isHalftime,
        isGameOver: pbpData.isGameOver,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Data Projection] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
