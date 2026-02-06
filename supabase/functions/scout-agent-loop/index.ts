import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize Supabase client for logging outcomes
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Record prop outcomes for calibration
async function recordPropOutcomes(
  edges: PropEdge[],
  eventId: string,
  espnEventId: string,
  analysisDate: string
): Promise<void> {
  if (!supabaseUrl || !supabaseKey) {
    console.log('[Scout Agent] Supabase not configured, skipping outcome recording');
    return;
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  // Only record edges with confidence >= 60 to avoid noise
  const recordableEdges = edges.filter(e => e.confidence >= 60);
  
  if (recordableEdges.length === 0) return;
  
  const records = recordableEdges.map(edge => ({
    event_id: eventId,
    espn_event_id: espnEventId,
    analysis_date: analysisDate,
    player_name: edge.player,
    team: null,
    prop: edge.prop,
    side: edge.lean,
    line: edge.line,
    predicted_final: edge.expectedFinal,
    confidence_raw: Math.round(edge.confidence),
    minutes_remaining_est: edge.remainingMinutes,
    rate_modifier: edge.ratePerMinute,
    minutes_uncertainty: edge.minutesUncertainty,
    risk_flags: edge.riskFlags,
    rotation_role: edge.rotationRole,
    on_court_stability: null,
    outcome: 'pending',
  }));
  
  // Upsert to avoid duplicates (player + prop + event + date)
  const { error } = await supabase
    .from('scout_prop_outcomes')
    .upsert(records, {
      onConflict: 'event_id,player_name,prop,analysis_date',
      ignoreDuplicates: true,
    });
  
  if (error) {
    console.error('[Scout Agent] Failed to record prop outcomes:', error.message);
  } else {
    console.log(`[Scout Agent] Recorded ${records.length} prop outcomes for calibration`);
  }
}

// ===== PLAYER BEHAVIOR PROFILE UPDATES =====

interface VisionSignal {
  signalType: 'fatigue' | 'speed' | 'effort' | 'positioning';
  player: string;
  jersey: string;
  value: number;
  observation: string;
  confidence: 'low' | 'medium' | 'high';
  verified?: boolean;
}

// Update player behavior profiles with film-derived insights
async function updatePlayerFilmInsights(
  visionSignals: VisionSignal[],
  playerStates: Record<string, PlayerLiveState>,
  gameContext: { homeTeam: string; awayTeam: string }
): Promise<void> {
  if (!supabaseUrl || !supabaseKey) {
    console.log('[Scout Agent] Supabase not configured, skipping profile updates');
    return;
  }
  
  // Only process verified, medium+ confidence signals
  const validSignals = visionSignals.filter(s => 
    s.verified !== false && 
    s.confidence !== 'low' &&
    s.player && 
    !s.player.startsWith('Unknown')
  );
  
  if (validSignals.length === 0) {
    console.log('[Scout Agent] No valid signals for profile update');
    return;
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  // Group signals by player
  const signalsByPlayer = new Map<string, VisionSignal[]>();
  for (const signal of validSignals) {
    const playerName = signal.player;
    if (!signalsByPlayer.has(playerName)) {
      signalsByPlayer.set(playerName, []);
    }
    signalsByPlayer.get(playerName)!.push(signal);
  }
  
  console.log(`[Scout Agent] Updating film insights for ${signalsByPlayer.size} players`);
  
  for (const [playerName, signals] of signalsByPlayer) {
    try {
      // Get player's team
      const playerState = Object.values(playerStates).find(p => 
        p.playerName.toLowerCase() === playerName.toLowerCase()
      );
      const team = playerState?.team || null;
      
      // Fetch existing profile
      const { data: existingProfile } = await supabase
        .from('player_behavior_profiles')
        .select('*')
        .eq('player_name', playerName)
        .maybeSingle();
      
      // Aggregate signal insights
      const fatigueSignals = signals.filter(s => s.signalType === 'fatigue');
      const effortSignals = signals.filter(s => s.signalType === 'effort');
      const speedSignals = signals.filter(s => s.signalType === 'speed');
      
      // Build fatigue tendency text (accumulative)
      let fatigueTendency = existingProfile?.fatigue_tendency || '';
      if (fatigueSignals.length > 0) {
        const avgFatigueValue = fatigueSignals.reduce((sum, s) => sum + s.value, 0) / fatigueSignals.length;
        const fatigueObs = fatigueSignals.map(s => s.observation).filter(Boolean);
        const newFatigueNote = fatigueObs.length > 0 
          ? `[${new Date().toISOString().split('T')[0]}] ${fatigueObs[0]} (avg: ${avgFatigueValue > 0 ? '+' : ''}${avgFatigueValue.toFixed(1)})`
          : null;
        
        if (newFatigueNote) {
          // Keep last 5 observations
          const existingNotes = fatigueTendency ? fatigueTendency.split('\n').slice(-4) : [];
          fatigueTendency = [...existingNotes, newFatigueNote].join('\n');
        }
      }
      
      // Build body language notes (effort + speed insights)
      let bodyLanguageNotes = existingProfile?.body_language_notes || '';
      const behaviorSignals = [...effortSignals, ...speedSignals];
      if (behaviorSignals.length > 0) {
        const observations = behaviorSignals
          .map(s => `${s.signalType}: ${s.observation}`)
          .filter(Boolean);
        
        if (observations.length > 0) {
          const newNote = `[${new Date().toISOString().split('T')[0]}] ${observations.join('; ')}`;
          const existingNotes = bodyLanguageNotes ? bodyLanguageNotes.split('\n').slice(-4) : [];
          bodyLanguageNotes = [...existingNotes, newNote].join('\n');
        }
      }
      
      // Increment film sample count
      const filmSampleCount = (existingProfile?.film_sample_count || 0) + 1;
      
      // Calculate profile confidence boost from film (adds up to 10 points)
      const baseConfidence = existingProfile?.profile_confidence || 0;
      const filmConfidenceBoost = Math.min(10, filmSampleCount * 2);
      const newConfidence = Math.min(100, baseConfidence + (filmConfidenceBoost > 0 && !existingProfile ? filmConfidenceBoost : 0));
      
      // Upsert the profile
      const { error } = await supabase
        .from('player_behavior_profiles')
        .upsert({
          player_name: playerName,
          team: team,
          fatigue_tendency: fatigueTendency || null,
          body_language_notes: bodyLanguageNotes || null,
          film_sample_count: filmSampleCount,
          profile_confidence: existingProfile ? existingProfile.profile_confidence : newConfidence,
          last_updated: new Date().toISOString(),
          // Preserve existing data if it exists
          three_pt_peak_quarters: existingProfile?.three_pt_peak_quarters || null,
          scoring_zone_preferences: existingProfile?.scoring_zone_preferences || null,
          clutch_performance_vs_average: existingProfile?.clutch_performance_vs_average || null,
          avg_first_rest_time: existingProfile?.avg_first_rest_time || null,
          avg_second_stint_start: existingProfile?.avg_second_stint_start || null,
          avg_minutes_per_quarter: existingProfile?.avg_minutes_per_quarter || null,
          blowout_minutes_reduction: existingProfile?.blowout_minutes_reduction || null,
          best_matchups: existingProfile?.best_matchups || null,
          worst_matchups: existingProfile?.worst_matchups || null,
          quarter_production: existingProfile?.quarter_production || null,
          games_analyzed: existingProfile?.games_analyzed || 0,
        }, {
          onConflict: 'player_name,team',
        });
      
      if (error) {
        console.error(`[Scout Agent] Failed to update profile for ${playerName}:`, error.message);
      } else {
        console.log(`[Scout Agent] Updated film insights for ${playerName} (sample #${filmSampleCount})`);
      }
    } catch (err) {
      console.error(`[Scout Agent] Error updating profile for ${playerName}:`, err);
    }
  }
}

// ===== ROTATION TRUTH LAYER TYPES =====

type RotationRole = 'STARTER' | 'CLOSER' | 'BENCH_CORE' | 'BENCH_FRINGE';
type FoulRiskLevel = 'LOW' | 'MED' | 'HIGH';

interface RotationState {
  stintStartGameTime?: string;
  stintSeconds: number;
  lastSubOutGameTime?: string;
  lastSubInGameTime?: string;
  benchSecondsLast8: number;
  onCourtStability: number;         // 0-1
  projectedStintsRemaining: number;
  foulRiskLevel: FoulRiskLevel;
  rotationRole: RotationRole;
}

interface BoxScoreData {
  points?: number;
  rebounds?: number;
  assists?: number;
  fouls?: number;
  fga?: number;
  fta?: number;
  turnovers?: number;
  threes?: number;
  steals?: number;
  blocks?: number;
}

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
  // V3: Rotation Truth Layer
  rotation?: RotationState;
  // V4: Box score data for team aggregation
  boxScore?: BoxScoreData;
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
  // New projection fields
  currentStat?: number;
  minutesPlayed?: number;
  remainingMinutes?: number;
  edgeMargin?: number;
  ratePerMinute?: number;
  // Bookmaker prices
  overPrice?: number;
  underPrice?: number;
  bookmaker?: string;
  // V3: Uncertainty
  uncertainty?: number;
  minutesUncertainty?: number;
  rotationVolatilityFlag?: boolean;
  rotationRole?: RotationRole;
  calibratedProb?: number;
}

// ===== PROJECTION CORE TYPES =====

interface LiveBox {
  pts: number;
  reb: number;
  ast: number;
  pra: number;
  min: number;
  fouls: number;
  fga: number;
  fta: number;
}

interface RatePerMinute {
  pts: number;
  reb: number;
  ast: number;
}

interface EdgeHistoryEntry {
  margins: number[];
  leans: ('OVER' | 'UNDER')[];
  timestamps: number[];
}

type PropTypeKey = 'Points' | 'Rebounds' | 'Assists' | 'PRA';

// Prop line from bookmakers
interface PropLineData {
  playerName: string;
  propType: 'points' | 'rebounds' | 'assists';
  line: number;
  overPrice?: number;
  underPrice?: number;
  bookmaker?: string;
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
    recentPlays?: any[]; // Substitution events
  };
  existingEdges: PropEdge[];
  currentGameTime?: string;
  forceAnalysis?: boolean;
  propLines?: PropLineData[]; // Real betting lines from unified_props
}

// ===== SUBSTITUTION EVENT PARSING =====

interface SubstitutionEvent {
  time: string;         // "Q2 5:42"
  player: string;
  action: 'in' | 'out';
  team: string;
}

function parseSubstitutionEvents(recentPlays: any[] | undefined): SubstitutionEvent[] {
  if (!recentPlays) return [];
  
  return recentPlays
    .filter(p => p.playType === 'substitution')
    .map(p => {
      const text = (p.text || '').toLowerCase();
      const isEnter = text.includes('enters') || text.includes('checks in');
      return {
        time: p.time || '',
        player: p.playerName || extractPlayerFromSubText(p.text),
        action: isEnter ? 'in' as const : 'out' as const,
        team: p.team || '',
      };
    })
    .filter(e => e.player);
}

function extractPlayerFromSubText(text: string): string {
  if (!text) return '';
  // Try to extract player name from text like "Player Name enters the game"
  const match = text.match(/^([A-Z][a-z]+ [A-Z][a-z]+)/);
  return match ? match[1] : '';
}

// ===== ROTATION STATE MANAGEMENT =====

function createDefaultRotationState(role: PlayerLiveState['role']): RotationState {
  const isStarter = role === 'PRIMARY' || role === 'BIG';
  return {
    stintSeconds: 0,
    benchSecondsLast8: 0,
    onCourtStability: isStarter ? 0.85 : 0.65,
    projectedStintsRemaining: 2,
    foulRiskLevel: 'LOW',
    rotationRole: isStarter ? 'STARTER' : 'BENCH_CORE',
  };
}

function determineRotationRole(
  state: PlayerLiveState,
  period: number,
  scoreDiff: number,
  minutesPlayed: number
): RotationRole {
  const role = state.role;
  const isCloseGame = Math.abs(scoreDiff) <= 8;
  
  // Primary players in close Q4 games are closers
  if (period >= 4 && isCloseGame && (role === 'PRIMARY' || role === 'SECONDARY')) {
    return 'CLOSER';
  }
  
  // If we have meaningful live minutes data (>= 5 min), use game context
  if (minutesPlayed >= 5) {
    // Starters based on role and minutes
    if (role === 'PRIMARY' || (role === 'BIG' && minutesPlayed > 15)) {
      return 'STARTER';
    }
    
    // Bench core vs fringe based on live minutes
    if (minutesPlayed >= 10) return 'BENCH_CORE';
    return 'BENCH_CORE';
  }
  
  // Pre-game or early game: preserve pre-game assignment if available
  if (state.rotation?.rotationRole) {
    return state.rotation.rotationRole;
  }
  
  // Fallback: infer from expected minutes (pre-game baseline)
  const expectedMinutes = state.minutesEstimate || 0;
  if (expectedMinutes >= 28) return 'STARTER';
  if (expectedMinutes >= 20) return 'BENCH_CORE';
  if (expectedMinutes >= 12) return 'BENCH_CORE';
  
  return 'BENCH_FRINGE';
}

function updateRotationState(
  state: PlayerLiveState,
  subEvents: SubstitutionEvent[],
  period: number,
  scoreDiff: number,
  minutesPlayed: number
): RotationState {
  const existing = state.rotation || createDefaultRotationState(state.role);
  
  // Find sub events for this player
  const playerSubs = subEvents.filter(e => 
    e.player?.toLowerCase() === state.playerName?.toLowerCase()
  );
  
  // Update stint tracking
  let subInCount = 0;
  let subOutCount = 0;
  
  playerSubs.forEach(sub => {
    if (sub.action === 'in') {
      existing.lastSubInGameTime = sub.time;
      existing.stintStartGameTime = sub.time;
      existing.stintSeconds = 0;
      subInCount++;
    } else if (sub.action === 'out') {
      existing.lastSubOutGameTime = sub.time;
      subOutCount++;
    }
  });
  
  // Calculate on-court stability (0-1)
  // More subs = less stable
  const totalSubs = subInCount + subOutCount;
  if (totalSubs <= 2) {
    existing.onCourtStability = 0.90;
  } else if (totalSubs <= 4) {
    existing.onCourtStability = 0.75;
  } else {
    existing.onCourtStability = 0.55;
  }
  
  // Update foul risk level
  const fouls = state.foulCount;
  if (fouls >= 5) existing.foulRiskLevel = 'HIGH';
  else if (fouls >= 4) existing.foulRiskLevel = 'MED';
  else if (fouls >= 3 && period <= 2) existing.foulRiskLevel = 'MED';
  else existing.foulRiskLevel = 'LOW';
  
  // Determine rotation role
  existing.rotationRole = determineRotationRole(state, period, scoreDiff, minutesPlayed);
  
  // Estimate remaining stints based on period
  if (period >= 4) existing.projectedStintsRemaining = 1;
  else if (period === 3) existing.projectedStintsRemaining = 2;
  else existing.projectedStintsRemaining = 3;
  
  return existing;
}

function getSceneClassificationPrompt(): string {
  return `SCENE CLASSIFICATION - Determine if this basketball game frame warrants analysis.

IGNORE (isAnalysisWorthy: false):
- Commercials/advertisements (brand logos, product shots)
- Crowd shots / fan reactions
- Bench B-roll footage
- Replay footage (indicated by "REPLAY" text, slow-motion, or different angle graphics)
- Scoreboard-only graphics
- Pre-game / post-game graphics

HALFTIME (sceneType: "halftime", isAnalysisWorthy: false):
- Halftime show / intermission graphics
- Score shows end of Q2 (0:00 or "END Q2" or "HALFTIME")
- Players walking to locker room
- Halftime entertainment or studio analysis

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
  "sceneType": "live_play" | "timeout" | "injury" | "fastbreak" | "freethrow" | "commercial" | "dead_time" | "halftime" | "unknown",
  "isAnalysisWorthy": true | false,
  "isHalftime": true | false,
  "confidence": "low" | "medium" | "high",
  "gameTime": "Q2 5:42" or null,
  "score": "LAL 54 - DEN 52" or null,
  "reason": "Brief 5-10 word explanation"
}`;
}

function buildRosterLookupTable(gameContext: any): string {
  const homeRoster = (gameContext.homeRoster || [])
    .filter((p: any) => p.jersey && p.jersey !== '?' && p.jersey !== 'null')
    .map((p: any) => `  #${String(p.jersey).padStart(2, '0')} → ${p.name} (${p.position || 'N/A'})`)
    .join('\n');
  
  const awayRoster = (gameContext.awayRoster || [])
    .filter((p: any) => p.jersey && p.jersey !== '?' && p.jersey !== 'null')
    .map((p: any) => `  #${String(p.jersey).padStart(2, '0')} → ${p.name} (${p.position || 'N/A'})`)
    .join('\n');

  return `
═══════════════════════════════════════════════════════════
                PLAYER JERSEY LOOKUP TABLE
     Use this to identify players. Match jersey numbers EXACTLY.
═══════════════════════════════════════════════════════════

${gameContext.homeTeam} (HOME):
${homeRoster || '  No roster data available'}

${gameContext.awayTeam} (AWAY):
${awayRoster || '  No roster data available'}

═══════════════════════════════════════════════════════════`;
}

function getVisionAnalysisPrompt(playerStates: Record<string, PlayerLiveState>, sceneType: string, gameContext?: any): string {
  const playerContext = Object.values(playerStates)
    .filter(p => p.onCourt || p.minutesEstimate > 0)
    .map(p => `#${p.jersey} ${p.playerName} (${p.team}): Fatigue ${p.fatigueScore}/100, Speed ${p.speedIndex}/100`)
    .join('\n');

  const rosterTable = gameContext ? buildRosterLookupTable(gameContext) : '';

  return `BASKETBALL VISION ANALYSIS - Extract betting-relevant signals from this ${sceneType} frame.

${rosterTable}

## ⚠️ MANDATORY JERSEY IDENTIFICATION RULES ⚠️

1. **NEVER GUESS A PLAYER'S NAME** - You MUST see their jersey number first
2. If you cannot clearly read the jersey number, use "Unknown #?" as the player field
3. When you see a jersey number (e.g., #23), IMMEDIATELY look it up in the roster table above
4. Report the player as the EXACT name from the roster lookup
5. If a jersey number doesn't match any roster player, report as "Unknown #{number}"
6. ALWAYS include the jersey field with the number you observed

Example identification flow:
- See jersey number "23" on a player
- Look up in roster table above
- Find: "#23 → LeBron James (F)"
- Report: player: "LeBron James", jersey: "#23"

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

Return JSON:
{
  "visionSignals": [
    {
      "signalType": "fatigue" | "speed" | "effort" | "positioning",
      "player": "Player Name from Roster (MUST match roster exactly)",
      "jersey": "#23 (the number you observed)",
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

// Build jersey-to-player lookup map from game context
function buildJerseyLookupMap(gameContext: any): Map<string, { name: string; team: string; position: string }> {
  const jerseyMap = new Map<string, { name: string; team: string; position: string }>();
  
  (gameContext.homeRoster || []).forEach((p: any) => {
    if (p.jersey && p.jersey !== '?' && p.jersey !== 'null') {
      const jerseyNum = String(p.jersey).replace('#', '').trim();
      jerseyMap.set(`${gameContext.homeTeam}-${jerseyNum}`, {
        name: p.name,
        team: gameContext.homeTeam,
        position: p.position || '',
      });
    }
  });
  
  (gameContext.awayRoster || []).forEach((p: any) => {
    if (p.jersey && p.jersey !== '?' && p.jersey !== 'null') {
      const jerseyNum = String(p.jersey).replace('#', '').trim();
      jerseyMap.set(`${gameContext.awayTeam}-${jerseyNum}`, {
        name: p.name,
        team: gameContext.awayTeam,
        position: p.position || '',
      });
    }
  });
  
  console.log(`[Scout Agent] Built jersey lookup map with ${jerseyMap.size} entries`);
  return jerseyMap;
}

// Validate and correct vision signals using jersey lookup
function validateVisionSignals(signals: any[], gameContext: any): any[] {
  const jerseyMap = buildJerseyLookupMap(gameContext);
  
  return signals.map(signal => {
    if (!signal.jersey) {
      console.log(`[Scout Agent] Signal missing jersey: ${signal.player}`);
      return { ...signal, verified: false, warning: 'No jersey number provided' };
    }
    
    const jerseyNum = String(signal.jersey).replace('#', '').trim();
    
    // Try home team first
    const homeMatch = jerseyMap.get(`${gameContext.homeTeam}-${jerseyNum}`);
    if (homeMatch) {
      console.log(`[Scout Agent] ✓ Jersey #${jerseyNum} verified: ${homeMatch.name} (${gameContext.homeTeam})`);
      return {
        ...signal,
        player: homeMatch.name, // Override with verified roster name
        team: homeMatch.team,
        verified: true,
      };
    }
    
    // Try away team
    const awayMatch = jerseyMap.get(`${gameContext.awayTeam}-${jerseyNum}`);
    if (awayMatch) {
      console.log(`[Scout Agent] ✓ Jersey #${jerseyNum} verified: ${awayMatch.name} (${gameContext.awayTeam})`);
      return {
        ...signal,
        player: awayMatch.name, // Override with verified roster name
        team: awayMatch.team,
        verified: true,
      };
    }
    
    // Jersey not found in either roster
    console.log(`[Scout Agent] ✗ Jersey #${jerseyNum} not found in roster for: ${signal.player}`);
    return {
      ...signal,
      verified: false,
      warning: `Jersey #${jerseyNum} not found in roster`,
    };
  });
}

// Helper: Extract basic signals from text when JSON parsing fails
// ENHANCED: More aggressive extraction with team-level and movement signals
function extractBasicSignals(content: string, gameContext: any): any[] {
  const signals: any[] = [];
  const lowerContent = content.toLowerCase();
  
  // Build roster name lookup
  const rosterNames: { name: string; team: string; jersey: string }[] = [];
  (gameContext.homeRoster || []).forEach((p: any) => {
    rosterNames.push({ name: p.name.toLowerCase(), team: gameContext.homeTeam, jersey: p.jersey || '?' });
  });
  (gameContext.awayRoster || []).forEach((p: any) => {
    rosterNames.push({ name: p.name.toLowerCase(), team: gameContext.awayTeam, jersey: p.jersey || '?' });
  });
  
  // Enhanced keyword sets for better signal detection
  const fatigueKeywords = [
    'tired', 'fatigue', 'hands on knees', 'bent over', 'breathing heavy', 
    'slow', 'labored', 'exhausted', 'gassed', 'winded', 'struggling',
    'sluggish', 'heavy legs', 'dragging', 'worn', 'fatigued'
  ];
  const effortKeywords = [
    'sprint', 'fast', 'quick', 'explosive', 'active', 'hustl', 
    'running', 'racing', 'burst', 'accelerat', 'attacking', 'aggressive'
  ];
  const speedKeywords = [
    'sprint', 'fast break', 'transition', 'racing', 'speed', 
    'quick', 'burst', 'explosive first step', 'motor'
  ];
  const positioningKeywords = [
    'box out', 'boxing out', 'crash', 'crashing', 'rebound position',
    'rim', 'paint', 'posting', 'seal'
  ];
  
  // PHASE 1 ENHANCEMENT: Also check for team-level observations
  const teamFatiguePatterns = [
    { pattern: /home team.*(?:tired|fatigue|slow|gassed)/i, team: gameContext.homeTeam, teamType: 'home' },
    { pattern: /away team.*(?:tired|fatigue|slow|gassed)/i, team: gameContext.awayTeam, teamType: 'away' },
    { pattern: /(?:tired|fatigue|slow|gassed).*home/i, team: gameContext.homeTeam, teamType: 'home' },
    { pattern: /(?:tired|fatigue|slow|gassed).*away/i, team: gameContext.awayTeam, teamType: 'away' },
    { pattern: new RegExp(`${gameContext.homeTeam}.*(?:tired|fatigue|slow)`, 'i'), team: gameContext.homeTeam, teamType: 'home' },
    { pattern: new RegExp(`${gameContext.awayTeam}.*(?:tired|fatigue|slow)`, 'i'), team: gameContext.awayTeam, teamType: 'away' },
  ];
  
  // Check for team-level fatigue mentions
  teamFatiguePatterns.forEach(({ pattern, team, teamType }) => {
    if (pattern.test(content)) {
      // Add a team-level signal that can apply to starters
      const teamRoster = rosterNames.filter(p => p.team === team).slice(0, 3); // Top 3 players
      teamRoster.forEach(({ name, jersey }) => {
        signals.push({
          signalType: 'fatigue',
          player: name.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          jersey: `#${jersey}`,
          value: 5, // Moderate team-level fatigue signal
          observation: `Team-level fatigue detected for ${teamType} team`,
          confidence: 'low',
          verified: jersey !== '?',
          isTeamSignal: true,
        });
      });
    }
  });
  
  // PHASE 2 ENHANCEMENT: Movement-related signal extraction
  const movementPatterns = [
    { pattern: /sprint|running hard|racing/i, type: 'sprint_detected', value: 6 },
    { pattern: /stationary|standing|not moving|minimal movement/i, type: 'stationary_warning', value: -5 },
    { pattern: /fast break|transition/i, type: 'fast_transition', value: 7 },
    { pattern: /crash.*board|box.?out|rebound/i, type: 'box_out_crash', value: 4 },
  ];
  
  // Player-specific extraction
  rosterNames.forEach(({ name, jersey }) => {
    const nameParts = name.split(' ');
    const lastName = nameParts[nameParts.length - 1];
    const firstName = nameParts[0] || '';
    
    // Check if player is mentioned (case insensitive)
    const playerMentioned = lowerContent.includes(lastName) || 
      (firstName.length > 3 && lowerContent.includes(firstName));
    
    if (playerMentioned) {
      const properName = name.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      
      // Check for fatigue indicators near player mention
      fatigueKeywords.forEach(keyword => {
        if (lowerContent.includes(keyword)) {
          // Determine severity based on keyword
          const highSeverity = ['hands on knees', 'exhausted', 'gassed', 'struggling'].includes(keyword);
          signals.push({
            signalType: 'fatigue',
            player: properName,
            jersey: `#${jersey}`,
            value: highSeverity ? 10 : 6,
            observation: `Detected fatigue indicator: ${keyword}`,
            confidence: highSeverity ? 'high' : 'medium',
            verified: jersey !== '?',
          });
        }
      });
      
      // Check for effort/speed indicators
      effortKeywords.forEach(keyword => {
        if (lowerContent.includes(keyword)) {
          signals.push({
            signalType: 'effort',
            player: properName,
            jersey: `#${jersey}`,
            value: 5,
            observation: `Detected effort indicator: ${keyword}`,
            confidence: 'medium',
            verified: jersey !== '?',
          });
        }
      });
      
      // Check for speed indicators
      speedKeywords.forEach(keyword => {
        if (lowerContent.includes(keyword)) {
          signals.push({
            signalType: 'speed',
            player: properName,
            jersey: `#${jersey}`,
            value: 4,
            observation: `Detected speed indicator: ${keyword}`,
            confidence: 'medium',
            verified: jersey !== '?',
          });
        }
      });
      
      // Check for positioning indicators
      positioningKeywords.forEach(keyword => {
        if (lowerContent.includes(keyword)) {
          signals.push({
            signalType: 'positioning',
            player: properName,
            jersey: `#${jersey}`,
            value: 5,
            observation: `Detected positioning indicator: ${keyword}`,
            confidence: 'medium',
            verified: jersey !== '?',
          });
        }
      });
    }
  });
  
  // Deduplicate signals (same player + signalType)
  const uniqueSignals = signals.reduce((acc: any[], signal) => {
    const key = `${signal.player}-${signal.signalType}`;
    const existing = acc.find(s => `${s.player}-${s.signalType}` === key);
    if (!existing) {
      acc.push(signal);
    } else if (signal.value > existing.value) {
      // Keep higher value signal
      const idx = acc.indexOf(existing);
      acc[idx] = signal;
    }
    return acc;
  }, []);
  
  console.log(`[Scout Agent] Extracted ${uniqueSignals.length} basic signals from text (${signals.length} before dedup)`);
  return uniqueSignals;
}

// ===== PROJECTION ENGINE 1: LIVE BOX SCORE PARSER =====

function parseMinutesDecimal(minStr: any): number {
  if (typeof minStr === 'number') return minStr;
  if (typeof minStr !== 'string') return 0;
  const m = minStr.match(/(\d+):(\d+)/);
  if (!m) return parseFloat(minStr) || 0;
  return Number(m[1]) + Number(m[2]) / 60;
}

// Normalize player names for matching (handles Jr, III, periods, etc.)
function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, '')           // Remove periods (S.J. → SJ)
    .replace(/jr\s*$/i, '')       // Remove Jr suffix
    .replace(/sr\s*$/i, '')       // Remove Sr suffix
    .replace(/iv\s*$/i, '')       // Remove IV
    .replace(/iii\s*$/i, '')      // Remove III
    .replace(/ii\s*$/i, '')       // Remove II
    .replace(/\s+/g, ' ')         // Normalize multiple spaces
    .trim();
}

function getLiveBox(pbpData: any, playerName: string): LiveBox | null {
  if (!pbpData?.players?.length) {
    console.log(`[LiveBox] No players array for ${playerName}`);
    return null;
  }
  
  const normalizedSearch = normalizePlayerName(playerName);
  
  // Try exact normalized match first
  let row = pbpData.players.find((p: any) =>
    normalizePlayerName(p.playerName || p.name || '') === normalizedSearch
  );
  
  // Fallback: partial match on last name + 3-char first name (prevents Seth/Stephen Curry mismatch)
  if (!row) {
    const searchParts = normalizedSearch.split(' ');
    const searchFirstName = searchParts[0] || '';
    const searchLastName = searchParts[searchParts.length - 1] || '';
    
    row = pbpData.players.find((p: any) => {
      const pName = normalizePlayerName(p.playerName || p.name || '');
      const pParts = pName.split(' ');
      const pFirstName = pParts[0] || '';
      const pLastName = pParts[pParts.length - 1] || '';
      
      // Require EXACT last name match
      const lastNameMatch = pLastName === searchLastName;
      
      // Require at least 3-char first name match (prevents Seth ↔ Stephen)
      const firstNameMatch = searchFirstName.length >= 3 && pFirstName.length >= 3 &&
        (pFirstName.startsWith(searchFirstName.slice(0, 3)) || 
         searchFirstName.startsWith(pFirstName.slice(0, 3)));
      
      return lastNameMatch && firstNameMatch;
    });
    
    if (row) {
      console.log(`[LiveBox] Fuzzy matched ${playerName} to ${row.playerName || row.name}`);
    }
  }
  
  if (!row) {
    // Log available players for debugging
    const available = pbpData.players.slice(0, 5).map((p: any) => p.playerName || p.name).join(', ');
    console.log(`[LiveBox] No match for "${playerName}". Sample players: ${available}...`);
    return null;
  }

  const min = parseMinutesDecimal(row.minutes);
  const pts = Number(row.points ?? 0);
  const reb = Number(row.rebounds ?? 0);
  const ast = Number(row.assists ?? 0);
  
  // Debug log for scoring accuracy verification
  console.log(`[LiveBox] ${playerName} → pts=${pts}, reb=${reb}, ast=${ast}, min=${min.toFixed(1)}`);

  return {
    pts,
    reb,
    ast,
    pra: pts + reb + ast,
    min: Number.isFinite(min) ? min : 0,
    fouls: Number(row.fouls ?? 0),
    fga: Number(row.fga ?? 0),
    fta: Number(row.fta ?? 0),
  };
}

// ===== PROJECTION ENGINE 2: ROTATION-AWARE MINUTES ENGINE =====

interface MinutesProjectionResult {
  remaining: number;
  uncertainty: number;
  riskFlags: string[];
  blowoutPenalty: number;
  foulPenalty: number;
}

function estimateRemainingMinutesRotationAware(
  state: PlayerLiveState,
  live: LiveBox | null,
  scoreDiff: number,
  period: number
): MinutesProjectionResult {
  const played = live?.min ?? 0;
  const riskFlags: string[] = [];
  const rotation = state.rotation;
  
  // Role-based expected totals
  const roleBasedExpected = 
    state.role === 'PRIMARY' ? 34 :
    state.role === 'SECONDARY' ? 28 :
    state.role === 'BIG' ? 30 : 22;
  
  // Expected total minutes - use minutesEstimate (pre-game baseline) or role-based fallback
  let expectedTotal = state.minutesEstimate;
  if (expectedTotal <= 0 || (expectedTotal <= played && played > 10)) {
    expectedTotal = roleBasedExpected;
    console.log(`[Minutes Engine] Using role-based estimate for ${state.playerName}: ${expectedTotal} min (role: ${state.role})`);
  }
  
  // Rotation role multipliers
  let roleMult = 1.0;
  const absLead = Math.abs(scoreDiff);
  
  if (rotation?.rotationRole === 'CLOSER' && period >= 3 && absLead <= 8) {
    roleMult = 1.08;
    riskFlags.push('CLOSE_GAME_BOOST');
  }
  if (rotation?.rotationRole === 'BENCH_FRINGE') {
    roleMult = 0.85;
    riskFlags.push('MINUTES_VOLATILITY');
  }
  
  let remaining = Math.max(0, (expectedTotal * roleMult) - played);
  console.log(`[Minutes Engine] ${state.playerName}: ${played.toFixed(1)} played, ${remaining.toFixed(1)} remaining (expected: ${expectedTotal}, roleMult: ${roleMult})`);
  
  // Off-court penalty scaled by rotation stability
  if (!state.onCourt) {
    const stability = rotation?.onCourtStability ?? 0.7;
    remaining *= (0.75 + 0.25 * stability);
    if (!riskFlags.includes('MINUTES_VOLATILITY')) {
      riskFlags.push('MINUTES_VOLATILITY');
    }
  }
  
  // Foul risk overlay from rotation state
  let foulPenalty = 1.0;
  if (rotation?.foulRiskLevel === 'HIGH') {
    foulPenalty = 0.55;
    riskFlags.push('FOUL_TROUBLE');
  } else if (rotation?.foulRiskLevel === 'MED') {
    foulPenalty = 0.75;
    riskFlags.push('FOUL_TROUBLE');
  } else {
    // Legacy fallback
    const fouls = live?.fouls ?? state.foulCount;
    if (fouls >= 5) {
      foulPenalty = 0.55;
      riskFlags.push('FOUL_TROUBLE');
    } else if (fouls === 4) {
      foulPenalty = 0.75;
      riskFlags.push('FOUL_TROUBLE');
    } else if (fouls === 3 && period <= 2) {
      foulPenalty = 0.85;
      riskFlags.push('FOUL_TROUBLE');
    }
  }
  remaining *= foulPenalty;
  
  // Blowout adjustments
  let blowoutPenalty = 1.0;
  if (period >= 4) {
    if (absLead >= 20) {
      blowoutPenalty = 0.40;
      riskFlags.push('BLOWOUT_RISK');
    } else if (absLead >= 15) {
      blowoutPenalty = 0.60;
      riskFlags.push('BLOWOUT_RISK');
    } else if (absLead <= 6 && !riskFlags.includes('CLOSE_GAME_BOOST')) {
      blowoutPenalty = 1.15;
      riskFlags.push('CLOSE_GAME_BOOST');
    }
  } else if (period === 3 && absLead >= 20) {
    blowoutPenalty = 0.70;
    riskFlags.push('BLOWOUT_RISK');
  }
  remaining *= blowoutPenalty;
  
  // High fatigue penalty
  if (state.fatigueScore >= 70) {
    remaining *= 0.90;
    riskFlags.push('HIGH_FATIGUE');
  }
  
  // Cap remaining minutes
  remaining = Math.min(remaining, 24);
  
  // ===== CALCULATE MINUTES UNCERTAINTY =====
  let uncertainty = 0.8; // Base ± minutes
  if (rotation?.rotationRole === 'BENCH_FRINGE') uncertainty += 1.4;
  if (!state.onCourt) uncertainty += 0.7;
  if (state.foulCount >= 4 || rotation?.foulRiskLevel === 'MED' || rotation?.foulRiskLevel === 'HIGH') {
    uncertainty += 1.0;
  }
  if (riskFlags.includes('BLOWOUT_RISK')) uncertainty += 1.2;
  
  // Lower uncertainty for stable rotations
  if ((rotation?.onCourtStability ?? 0.7) >= 0.85) {
    uncertainty *= 0.7;
  }
  
  return { remaining, uncertainty, riskFlags, blowoutPenalty, foulPenalty };
}

// ===== PROJECTION ENGINE 3: RATE ENGINE =====

function baselineRateFromRole(role: PlayerLiveState['role']): RatePerMinute {
  switch (role) {
    case 'PRIMARY':   return { pts: 0.70, reb: 0.18, ast: 0.16 };
    case 'SECONDARY': return { pts: 0.55, reb: 0.16, ast: 0.14 };
    case 'SPACER':    return { pts: 0.45, reb: 0.12, ast: 0.10 };
    case 'BIG':       return { pts: 0.50, reb: 0.28, ast: 0.10 };
    default:          return { pts: 0.55, reb: 0.16, ast: 0.14 };
  }
}

function blendedRate(state: PlayerLiveState, live: LiveBox | null): RatePerMinute {
  const base = baselineRateFromRole(state.role);
  
  const played = live?.min ?? 0;
  const liveRate: RatePerMinute = played > 0
    ? { 
        pts: (live!.pts / played), 
        reb: (live!.reb / played), 
        ast: (live!.ast / played) 
      }
    : base;

  // Weight ramps up as minutes played increases (trust live data more over time)
  const w = Math.max(0.15, Math.min(0.85, played / 18));
  
  return {
    pts: base.pts * (1 - w) + liveRate.pts * w,
    reb: base.reb * (1 - w) + liveRate.reb * w,
    ast: base.ast * (1 - w) + liveRate.ast * w,
  };
}

// ===== PROJECTION ENGINE 4: VISUAL MODIFIER ENGINE (v2 - Piecewise Fatigue) =====

// Piecewise fatigue penalty (more realistic cliff behavior)
function fatiguePenaltyPct(fatigueScore: number): number {
  if (fatigueScore < 45) return 0.00;  // No penalty
  if (fatigueScore < 60) return 0.03;  // 3% penalty
  if (fatigueScore < 75) return 0.07;  // 7% penalty
  return 0.12;                          // 12% max penalty
}

// ===== TEAM-LEVEL AGGREGATION & GAME BET PROJECTION ENGINE =====

interface TeamLiveState {
  teamAbbrev: string;
  teamName: string;
  isHome: boolean;
  currentScore: number;
  avgTeamFatigue: number;
  avgTeamEffort: number;
  teamSpeedIndex: number;
  livePace: number;
  offensiveRating: number;
  fgPct: number;
  threePtPct: number;
  momentumScore: number;
  runDetected: boolean;
  closeGameFlag: boolean;
  // Enhanced momentum tracking
  runInProgress: boolean;
  runPoints: number;
  runPossessions: number;
  hotPlayers: string[];
  coldPlayers: string[];
  swingDetected: boolean;
}

interface GameBetEdge {
  betType: 'MONEYLINE' | 'TOTAL' | 'SPREAD';
  lean: 'HOME' | 'AWAY' | 'OVER' | 'UNDER';
  confidence: number;
  projectedWinner?: 'HOME' | 'AWAY';
  winProbability?: number;
  projectedTotal?: number;
  vegasLine?: number;
  edgeAmount?: number;
  projectedMargin?: number;
  spreadLine?: number;
  drivers: string[];
  riskFlags: string[];
  gameTime: string;
  homeOdds?: number;
  awayOdds?: number;
  overOdds?: number;
  underOdds?: number;
}

// Parse clock string to seconds remaining in period
function parseClockSeconds(clock: string): number {
  if (!clock) return 720; // Default 12 minutes
  const parts = clock.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }
  return parseInt(clock) * 60 || 720;
}

// Enhanced momentum result with run tracking
interface MomentumResult {
  score: number;                  // -100 to +100
  runInProgress: boolean;         // Currently on a scoring run
  runPoints: number;              // Points in current unanswered run
  runPossessions: number;         // Consecutive possessions with scoring
  hotPlayers: string[];           // Players with 3+ recent scores
  coldPlayers: string[];          // Players with recent turnovers/misses
  swingDetected: boolean;         // 8+ point swing in last 2 minutes
}

// Weighted play type values for momentum calculation
const PLAY_MOMENTUM_WEIGHTS: Record<string, number> = {
  'dunk': 12,
  'alley_oop': 12,
  'and_one': 11,
  'three_pointer': 10,
  'score': 8,
  'steal': 7,
  'block': 6,
  'off_rebound': 4,
  'def_rebound': 2,
  'rebound': 2,
  'turnover': -8,
  'missed_ft': -3,
  'foul': -2,
  'other': 0,
};

// Calculate advanced momentum with run tracking and hot player detection
function calculateAdvancedMomentum(recentPlays: any[] | undefined, teamAbbrev: string): MomentumResult {
  if (!recentPlays || recentPlays.length === 0) {
    return { score: 0, runInProgress: false, runPoints: 0, runPossessions: 0, hotPlayers: [], coldPlayers: [], swingDetected: false };
  }
  
  const lowerTeam = teamAbbrev.toLowerCase();
  const last15 = recentPlays.slice(-15);
  
  // 1. Calculate weighted momentum score
  let momentum = 0;
  last15.forEach((play, idx) => {
    const weight = (idx + 1) / 15; // More recent = higher weight
    const isTeamPlay = play.team?.toLowerCase() === lowerTeam;
    const playType = play.playType || 'other';
    const baseWeight = PLAY_MOMENTUM_WEIGHTS[playType] || 0;
    const highMomentumBonus = play.isHighMomentum ? 3 : 0;
    
    const playMomentum = (baseWeight + highMomentumBonus) * weight;
    momentum += isTeamPlay ? playMomentum : -playMomentum;
  });
  
  // 2. Track unanswered runs (reverse order to find current run)
  let runPoints = 0;
  let runPossessions = 0;
  let runTeam: string | null = null;
  
  for (let i = last15.length - 1; i >= 0; i--) {
    const play = last15[i];
    const pts = play.pointValue || 0;
    
    if (pts > 0) {
      if (runTeam === null) {
        runTeam = play.team?.toLowerCase();
        runPoints = pts;
        runPossessions = 1;
      } else if (play.team?.toLowerCase() === runTeam) {
        runPoints += pts;
        runPossessions++;
      } else {
        break; // Run ended - other team scored
      }
    }
  }
  
  const runInProgress = runPossessions >= 3 && runPoints >= 6 && runTeam === lowerTeam;
  
  // 3. Identify hot players (3+ recent makes in last 20 plays)
  const last20 = recentPlays.slice(-20);
  const playerScores = new Map<string, number>();
  const playerTurnovers = new Map<string, number>();
  
  last20.forEach(play => {
    const playerName = play.playerName;
    if (!playerName) return;
    
    const playType = play.playType || 'other';
    if (['score', 'dunk', 'alley_oop', 'and_one', 'three_pointer'].includes(playType)) {
      playerScores.set(playerName, (playerScores.get(playerName) || 0) + 1);
    }
    if (playType === 'turnover') {
      playerTurnovers.set(playerName, (playerTurnovers.get(playerName) || 0) + 1);
    }
  });
  
  const hotPlayers = [...playerScores.entries()]
    .filter(([_, count]) => count >= 3)
    .map(([name]) => name);
  
  const coldPlayers = [...playerTurnovers.entries()]
    .filter(([_, count]) => count >= 2)
    .map(([name]) => name);
  
  // 4. Detect swing (8+ point change in last 2 minutes worth of plays)
  // Rough estimate: ~6-8 plays = 2 minutes
  const last8 = recentPlays.slice(-8);
  let swingScore = 0;
  let lastScoringTeam: string | null = null;
  let teamSwitches = 0;
  
  last8.forEach(play => {
    const pts = play.pointValue || 0;
    if (pts > 0) {
      if (lastScoringTeam && play.team?.toLowerCase() !== lastScoringTeam) {
        teamSwitches++;
      }
      lastScoringTeam = play.team?.toLowerCase();
      swingScore += pts;
    }
  });
  
  const swingDetected = teamSwitches >= 2 && swingScore >= 12;
  
  return {
    score: Math.max(-100, Math.min(100, Math.round(momentum))),
    runInProgress,
    runPoints: runTeam === lowerTeam ? runPoints : 0,
    runPossessions: runTeam === lowerTeam ? runPossessions : 0,
    hotPlayers,
    coldPlayers,
    swingDetected,
  };
}

// Legacy momentum function for backward compatibility
function calculateMomentum(recentPlays: any[] | undefined, teamAbbrev: string): number {
  return calculateAdvancedMomentum(recentPlays, teamAbbrev).score;
}

// Detect scoring run (8+ points in short span)
function detectRun(recentPlays: any[] | undefined, teamAbbrev: string): boolean {
  return calculateAdvancedMomentum(recentPlays, teamAbbrev).runInProgress;
}

// Aggregate player states into team state
function calculateTeamLiveState(
  playerStates: Record<string, PlayerLiveState>,
  pbpData: any,
  isHome: boolean
): TeamLiveState {
  const teamAbbrev = isHome ? pbpData.homeTeam : pbpData.awayTeam;
  const currentScore = isHome ? pbpData.homeScore : pbpData.awayScore;
  const opponentScore = isHome ? pbpData.awayScore : pbpData.homeScore;
  
  // Filter players on this team (prefer on-court players for fatigue)
  const teamPlayers = Object.values(playerStates)
    .filter(p => p.team === teamAbbrev);
  
  const onCourtPlayers = teamPlayers.filter(p => p.onCourt);
  const relevantPlayers = onCourtPlayers.length >= 3 ? onCourtPlayers : teamPlayers.slice(0, 8);
  
  // Aggregate fatigue/effort from on-court players
  const avgFatigue = relevantPlayers.length > 0
    ? relevantPlayers.reduce((sum, p) => sum + (p.fatigueScore || 40), 0) / relevantPlayers.length
    : 40;
  
  const avgEffort = relevantPlayers.length > 0
    ? relevantPlayers.reduce((sum, p) => sum + (p.effortScore || 50), 0) / relevantPlayers.length
    : 50;
  
  const avgSpeed = relevantPlayers.length > 0
    ? relevantPlayers.reduce((sum, p) => sum + (p.speedIndex || 50), 0) / relevantPlayers.length
    : 50;
  
  // Calculate FG% from team boxscore if available
  let fgPct = 0.45;
  let threePtPct = 0.35;
  
  if (teamPlayers.length > 0) {
    const totalFGA = teamPlayers.reduce((sum, p) => sum + (p.boxScore?.fga || 0), 0);
    const totalPts = teamPlayers.reduce((sum, p) => sum + (p.boxScore?.points || 0), 0);
    const totalThrees = teamPlayers.reduce((sum, p) => sum + (p.boxScore?.threes || 0), 0);
    
    if (totalFGA > 0) {
      // Rough estimate: PTS = 2*FGM + 3*3PM + FTM, assume 2.2 pts per make
      fgPct = Math.min(0.65, Math.max(0.30, (totalPts / 2.2) / totalFGA));
    }
    if (totalFGA > 0) {
      threePtPct = Math.min(0.55, Math.max(0.20, totalThrees / (totalFGA * 0.4))); // Assume 40% are 3s
    }
  }
  
  const period = pbpData?.period || 1;
  const scoreDiff = Math.abs(currentScore - opponentScore);
  
  // Get advanced momentum data
  const momentumResult = calculateAdvancedMomentum(pbpData?.recentPlays, teamAbbrev);
  
  return {
    teamAbbrev,
    teamName: teamAbbrev,
    isHome,
    currentScore,
    avgTeamFatigue: Math.round(avgFatigue),
    avgTeamEffort: Math.round(avgEffort),
    teamSpeedIndex: Math.round(avgSpeed),
    livePace: pbpData?.pace || 100,
    offensiveRating: 0, // Would need possessions to calculate
    fgPct: Math.round(fgPct * 100) / 100,
    threePtPct: Math.round(threePtPct * 100) / 100,
    momentumScore: momentumResult.score,
    runDetected: momentumResult.runInProgress,
    closeGameFlag: scoreDiff <= 5 && period >= 4,
    // Enhanced momentum tracking
    runInProgress: momentumResult.runInProgress,
    runPoints: momentumResult.runPoints,
    runPossessions: momentumResult.runPossessions,
    hotPlayers: momentumResult.hotPlayers,
    coldPlayers: momentumResult.coldPlayers,
    swingDetected: momentumResult.swingDetected,
  };
}

// Project Game Total (OVER/UNDER combined final score)
function projectGameTotal(
  homeTeamState: TeamLiveState,
  awayTeamState: TeamLiveState,
  pbpData: any,
  vegasTotal: number
): GameBetEdge {
  const period = pbpData?.period || 1;
  const clock = pbpData?.clock || '12:00';
  const clockSeconds = parseClockSeconds(clock);
  const minutesPlayed = (period - 1) * 12 + (12 - clockSeconds / 60);
  const remainingMinutes = Math.max(0, 48 - minutesPlayed);
  
  const currentTotal = homeTeamState.currentScore + awayTeamState.currentScore;
  
  // Current pace projection
  const currentPace = minutesPlayed > 2 
    ? (currentTotal / minutesPlayed) * 48 
    : vegasTotal;
  
  // Fatigue adjustment (tired teams score less)
  const avgFatigue = (homeTeamState.avgTeamFatigue + awayTeamState.avgTeamFatigue) / 2;
  const fatiguePenalty = 1 - fatiguePenaltyPct(avgFatigue);
  
  // Blowout adjustment (garbage time tends to increase scoring)
  const scoreDiff = Math.abs(homeTeamState.currentScore - awayTeamState.currentScore);
  const blowoutFactor = scoreDiff > 20 ? 1.05 : scoreDiff > 15 ? 1.02 : 1.0;
  
  // Pace factor from live data
  const paceFactor = (pbpData?.pace || 100) / 100;
  
  // Blend current pace with pre-game expectation
  const weight = Math.min(0.85, minutesPlayed / 24); // Trust live data more over time
  const projectedRemainingPace = (currentPace * weight + vegasTotal * (1 - weight)) * fatiguePenalty * blowoutFactor * paceFactor;
  
  const projectedRemaining = (projectedRemainingPace / 48) * remainingMinutes;
  const projectedTotal = currentTotal + projectedRemaining;
  
  const edgeAmount = projectedTotal - vegasTotal;
  const lean: 'OVER' | 'UNDER' = edgeAmount >= 0 ? 'OVER' : 'UNDER';
  
  // Drivers
  const drivers: string[] = [];
  if (avgFatigue > 55) drivers.push(`High team fatigue (${Math.round(avgFatigue)})`);
  if (pbpData?.pace > 105) drivers.push(`Fast pace (${pbpData.pace})`);
  if (pbpData?.pace < 95) drivers.push(`Slow pace (${pbpData.pace})`);
  if (scoreDiff > 20) drivers.push('Blowout garbage time');
  if (minutesPlayed > 0) drivers.push(`Current pace: ${(currentTotal / minutesPlayed * 48).toFixed(0)}/48`);
  
  // Risk flags
  const riskFlags: string[] = [];
  if (minutesPlayed < 12) riskFlags.push('EARLY_GAME_VOLATILITY');
  if (scoreDiff > 25) riskFlags.push('BLOWOUT_RISK');
  
  // Confidence grows with game time
  const confidence = Math.min(90, Math.round(45 + weight * 45 + Math.abs(edgeAmount) * 2));
  
  return {
    betType: 'TOTAL',
    lean,
    confidence,
    projectedTotal: Math.round(projectedTotal * 10) / 10,
    vegasLine: vegasTotal,
    edgeAmount: Math.round(edgeAmount * 10) / 10,
    drivers,
    riskFlags,
    gameTime: pbpData?.gameTime || 'Unknown',
  };
}

// Project Moneyline (which team wins)
function projectMoneyline(
  homeTeamState: TeamLiveState,
  awayTeamState: TeamLiveState,
  pbpData: any,
  preGameHomeWinProb: number = 0.5
): GameBetEdge {
  const period = pbpData?.period || 1;
  const clock = pbpData?.clock || '12:00';
  const clockSeconds = parseClockSeconds(clock);
  const minutesPlayed = (period - 1) * 12 + (12 - clockSeconds / 60);
  const remainingPct = Math.max(0, (48 - minutesPlayed) / 48);
  
  const scoreDiff = homeTeamState.currentScore - awayTeamState.currentScore; // Positive = home leading
  
  // Fatigue differential (positive = home more tired)
  const fatigueDiff = homeTeamState.avgTeamFatigue - awayTeamState.avgTeamFatigue;
  
  // Momentum differential (using enhanced momentum score)
  const momentumDiff = homeTeamState.momentumScore - awayTeamState.momentumScore;
  
  // Run bonus - stronger impact when a team has an active run
  let runBonus = 0;
  if (homeTeamState.runInProgress) {
    runBonus = homeTeamState.runPoints >= 10 ? 0.08 : 0.04;
  } else if (awayTeamState.runInProgress) {
    runBonus = awayTeamState.runPoints >= 10 ? -0.08 : -0.04;
  }
  
  // Hot player bonus
  const homeHotCount = homeTeamState.hotPlayers?.length || 0;
  const awayHotCount = awayTeamState.hotPlayers?.length || 0;
  const hotPlayerBonus = (homeHotCount - awayHotCount) * 0.02;
  
  // Blend pre-game probability with live game state
  let liveWinProbHome = 0.5 + (scoreDiff / 40); // +10 pts ≈ 75% win prob
  liveWinProbHome += momentumDiff / 150; // Enhanced momentum impact
  liveWinProbHome -= fatigueDiff / 400;  // Fatigue penalty (home being tired is bad)
  liveWinProbHome += runBonus;           // Run bonus
  liveWinProbHome += hotPlayerBonus;     // Hot player bonus
  
  // Clamp to reasonable range
  liveWinProbHome = Math.max(0.02, Math.min(0.98, liveWinProbHome));
  
  // Blend with pre-game expectation (less weight as game progresses)
  const blendedProb = preGameHomeWinProb * remainingPct + liveWinProbHome * (1 - remainingPct);
  
  const projectedWinner: 'HOME' | 'AWAY' = blendedProb >= 0.5 ? 'HOME' : 'AWAY';
  const winProbability = blendedProb >= 0.5 ? blendedProb : 1 - blendedProb;
  
  // Drivers - now include run and hot player info
  const drivers: string[] = [];
  if (scoreDiff > 10) drivers.push(`Home leading by ${scoreDiff}`);
  if (scoreDiff < -10) drivers.push(`Away leading by ${Math.abs(scoreDiff)}`);
  
  // Run-in-progress drivers
  if (homeTeamState.runInProgress && homeTeamState.runPoints > 0) {
    drivers.push(`${homeTeamState.teamAbbrev} on ${homeTeamState.runPoints}-0 run`);
  }
  if (awayTeamState.runInProgress && awayTeamState.runPoints > 0) {
    drivers.push(`${awayTeamState.teamAbbrev} on ${awayTeamState.runPoints}-0 run`);
  }
  
  // Hot player drivers
  if (homeHotCount > 0) {
    drivers.push(`Hot: ${homeTeamState.hotPlayers?.slice(0, 2).join(', ')}`);
  }
  if (awayHotCount > 0) {
    drivers.push(`Hot: ${awayTeamState.hotPlayers?.slice(0, 2).join(', ')}`);
  }
  
  if (Math.abs(momentumDiff) > 25) drivers.push(momentumDiff > 0 ? 'Home momentum surge' : 'Away momentum surge');
  if (Math.abs(fatigueDiff) > 15) drivers.push(fatigueDiff > 0 ? 'Home fatigue edge' : 'Away fresher');
  
  // Risk flags
  const riskFlags: string[] = [];
  if (Math.abs(scoreDiff) <= 5 && period >= 3) riskFlags.push('CLOSE_GAME');
  if (homeTeamState.runInProgress || awayTeamState.runInProgress) riskFlags.push('RUN_IN_PROGRESS');
  if (homeTeamState.swingDetected || awayTeamState.swingDetected) riskFlags.push('SWING_GAME');
  
  // Confidence grows with game time, score margin, and run status
  const marginBonus = Math.min(20, Math.abs(scoreDiff) * 1.5);
  const runConfidenceBonus = (homeTeamState.runInProgress || awayTeamState.runInProgress) ? 5 : 0;
  const confidence = Math.min(95, Math.round(40 + (1 - remainingPct) * 35 + marginBonus + runConfidenceBonus));
  
  return {
    betType: 'MONEYLINE',
    lean: projectedWinner,
    confidence,
    projectedWinner,
    winProbability: Math.round(winProbability * 100) / 100,
    drivers,
    riskFlags,
    gameTime: pbpData?.gameTime || 'Unknown',
  };
}

// Project Spread
function projectSpread(
  homeTeamState: TeamLiveState,
  awayTeamState: TeamLiveState,
  pbpData: any,
  vegasSpread: number = 0 // Negative = home favorite
): GameBetEdge {
  const period = pbpData?.period || 1;
  const clock = pbpData?.clock || '12:00';
  const clockSeconds = parseClockSeconds(clock);
  const minutesPlayed = (period - 1) * 12 + (12 - clockSeconds / 60);
  const remainingMinutes = Math.max(0, 48 - minutesPlayed);
  
  const currentMargin = homeTeamState.currentScore - awayTeamState.currentScore; // Positive = home winning
  
  // Project remaining margin based on pace/momentum
  const momentumFactor = (homeTeamState.momentumScore - awayTeamState.momentumScore) / 100;
  const fatigueFactor = (awayTeamState.avgTeamFatigue - homeTeamState.avgTeamFatigue) / 200;
  
  // Estimate remaining scoring margin
  const ratePerMinute = 0.1 * (1 + momentumFactor + fatigueFactor); // Approx 0.1 points/min differential
  const projectedAdditionalMargin = ratePerMinute * remainingMinutes;
  
  const projectedFinalMargin = currentMargin + projectedAdditionalMargin;
  const spreadCover = projectedFinalMargin - vegasSpread;
  
  const lean: 'HOME' | 'AWAY' = spreadCover >= 0 ? 'HOME' : 'AWAY';
  
  const drivers: string[] = [];
  if (currentMargin > 5) drivers.push(`Home +${currentMargin} now`);
  if (currentMargin < -5) drivers.push(`Away +${Math.abs(currentMargin)} now`);
  if (Math.abs(momentumFactor) > 0.2) drivers.push(momentumFactor > 0 ? 'Home momentum' : 'Away momentum');
  
  const riskFlags: string[] = [];
  if (remainingMinutes > 24) riskFlags.push('EARLY_PROJECTION');
  
  const weight = Math.min(0.85, minutesPlayed / 24);
  const confidence = Math.min(85, Math.round(40 + weight * 35 + Math.abs(spreadCover) * 3));
  
  return {
    betType: 'SPREAD',
    lean,
    confidence,
    projectedMargin: Math.round(projectedFinalMargin * 10) / 10,
    spreadLine: vegasSpread,
    edgeAmount: Math.round(spreadCover * 10) / 10,
    drivers,
    riskFlags,
    gameTime: pbpData?.gameTime || 'Unknown',
  };
}

// Main function to calculate all game bet edges
function calculateGameBetEdges(
  playerStates: Record<string, PlayerLiveState>,
  pbpData: any,
  vegasTotal: number = 220,
  vegasSpread: number = 0,
  preGameHomeWinProb: number = 0.5
): { homeTeam: TeamLiveState; awayTeam: TeamLiveState; gameBetEdges: GameBetEdge[] } {
  
  const homeTeam = calculateTeamLiveState(playerStates, pbpData, true);
  const awayTeam = calculateTeamLiveState(playerStates, pbpData, false);
  
  const gameBetEdges: GameBetEdge[] = [
    projectGameTotal(homeTeam, awayTeam, pbpData, vegasTotal),
    projectMoneyline(homeTeam, awayTeam, pbpData, preGameHomeWinProb),
    projectSpread(homeTeam, awayTeam, pbpData, vegasSpread),
  ];
  
  console.log(`[Scout Agent] Game bet edges: Total ${gameBetEdges[0].lean} (${gameBetEdges[0].confidence}%), ML ${gameBetEdges[1].lean} (${gameBetEdges[1].confidence}%)`);
  
  return { homeTeam, awayTeam, gameBetEdges };
}

function calculateRateModifier(state: PlayerLiveState, prop: PropTypeKey): number {
  let mod = 1.0;
  
  const fatigue = state.fatigueScore ?? 40;
  const effort = state.effortScore ?? 50;
  const speed = state.speedIndex ?? 50;
  const handsOnKnees = state.handsOnKneesCount ?? 0;
  const slowRecovery = state.slowRecoveryCount ?? 0;
  const sprints = state.sprintCount ?? 0;
  
  // 1) Fatigue affects all props (piecewise cliff - more realistic)
  mod *= (1 - fatiguePenaltyPct(fatigue));
  
  // 2) Accumulative indicators (only penalize if repeated)
  if (handsOnKnees >= 2) mod *= 0.95;  // Extra 5% penalty
  if (slowRecovery >= 2) mod *= 0.96;  // Extra 4% penalty
  
  // 3) Effort + speed boosts only for scoring/playmaking props
  const isScoringProp = prop === 'Points' || prop === 'Assists' || prop === 'PRA';
  if (isScoringProp) {
    const effortBoost = (effort - 50) / 50; // -1 to +1
    const speedBoost = (speed - 50) / 50;
    
    mod *= (1 + 0.06 * effortBoost);
    mod *= (1 + 0.06 * speedBoost);
    
    // "Hot motor" bonus (sprinting with high effort)
    if (sprints >= 3 && effort >= 65) mod *= 1.05;
  }
  
  // 4) Rebound positioning (only for REB and PRA)
  if (prop === 'Rebounds' || prop === 'PRA') {
    const pos = state.reboundPositionScore ?? 50;
    const posBoost = (pos - 50) / 50;
    mod *= (1 + 0.08 * posBoost);
  }
  
  // 5) Off-court stability overlay
  if (!state.onCourt) mod *= 0.98;
  
  // v5.0: Tighten clamp range from ±20% to ±12% for more stable projections
  return Math.max(0.88, Math.min(1.12, mod));
}

// ===== PROJECTION ENGINE 5: PROJECTION CORE =====

interface ProjectionResult {
  expected: number;
  remaining: number;
  uncertainty: number;
  riskFlags: string[];
  rate: number;
  rotationRole?: RotationRole;
}

function projectFinal(
  state: PlayerLiveState,
  live: LiveBox | null,
  prop: PropTypeKey,
  scoreDiff: number,
  period: number
): ProjectionResult {
  const { remaining, uncertainty, riskFlags: baseRiskFlags } = estimateRemainingMinutesRotationAware(state, live, scoreDiff, period);
  const rate = blendedRate(state, live);
  const mod = calculateRateModifier(state, prop);
  
  // v5.0: Additional risk flag detection
  const riskFlags = [...baseRiskFlags];
  const minPlayed = live?.min ?? 0;
  
  // Early projection flag - less than 10 minutes of data
  if (minPlayed < 10) {
    riskFlags.push('EARLY_PROJECTION');
  }
  
  // Trending detection based on current rate vs expected
  const curPTS = live?.pts ?? 0;
  const curREB = live?.reb ?? 0;
  const curAST = live?.ast ?? 0;
  
  if (minPlayed >= 8) {
    const ptsRate = curPTS / minPlayed;
    const rebRate = curREB / minPlayed;
    const astRate = curAST / minPlayed;
    
    // Cold detection: current rate < 70% of expected rate
    if (prop === 'Points' && ptsRate < rate.pts * 0.70) {
      riskFlags.push('TRENDING_COLD');
    }
    // Hot detection: current rate > 130% of expected rate
    if (prop === 'Points' && ptsRate > rate.pts * 1.30) {
      riskFlags.push('TRENDING_HOT');
    }
  }

  const addPTS = rate.pts * remaining * mod;
  const addREB = rate.reb * remaining * mod;
  const addAST = rate.ast * remaining * mod;

  let expected: number;
  let rateUsed: number;
  
  switch (prop) {
    case 'Points':
      expected = curPTS + addPTS;
      rateUsed = rate.pts * mod;
      break;
    case 'Rebounds':
      expected = curREB + addREB;
      rateUsed = rate.reb * mod;
      break;
    case 'Assists':
      expected = curAST + addAST;
      rateUsed = rate.ast * mod;
      break;
    case 'PRA':
      expected = (curPTS + curREB + curAST) + (addPTS + addREB + addAST);
      rateUsed = (rate.pts + rate.reb + rate.ast) * mod;
      break;
    default:
      expected = 0;
      rateUsed = 0;
  }

  return { 
    expected, 
    remaining, 
    uncertainty,
    riskFlags, 
    rate: rateUsed,
    rotationRole: state.rotation?.rotationRole,
  };
}

// ===== CONFIDENCE FORMULA =====

function computeConfidence(
  edgeMargin: number,
  state: PlayerLiveState,
  riskFlags: string[],
  live: LiveBox | null
): number {
  let c = 50;

  // Bigger edge => higher confidence (cap at +25)
  c += Math.min(25, edgeMargin * 6);

  // Data reliability bonuses
  if (state.onCourt) c += 8;
  else c -= 6;

  // Minutes reliability - more granular
  const minPlayed = live?.min ?? 0;
  if (minPlayed >= 20) c += 8;
  else if (minPlayed >= 15) c += 5;
  else if (minPlayed >= 10) c += 2;

  // Risk penalties
  if (riskFlags.includes('FOUL_TROUBLE')) {
    const fouls = live?.fouls ?? state.foulCount;
    c -= fouls >= 5 ? 18 : 10;
  }
  if (riskFlags.includes('BLOWOUT_RISK')) c -= 12;
  if (riskFlags.includes('HIGH_FATIGUE')) c -= 10;
  if (riskFlags.includes('MINUTES_VOLATILITY')) c -= 8;
  
  // v5.0: NEW risk flag penalties for tighter projections
  if (riskFlags.includes('HIGH_VARIANCE')) c -= 12;       // High variance player
  if (riskFlags.includes('EARLY_PROJECTION')) c -= 15;    // Minutes < 10, low confidence
  if (riskFlags.includes('TRENDING_COLD')) c -= 8;        // Cold shooting
  if (riskFlags.includes('TRENDING_HOT')) c += 5;         // Hot streak bonus
  
  // Close game boost
  if (riskFlags.includes('CLOSE_GAME_BOOST')) c += 5;

  return Math.max(1, Math.min(99, Math.round(c)));
}

// ===== TREND ENGINE =====

const edgeHistoryMap = new Map<string, EdgeHistoryEntry>();

function calculateTrend(
  historyKey: string,
  currentMargin: number,
  currentLean: 'OVER' | 'UNDER'
): 'strengthening' | 'weakening' | 'stable' {
  let history = edgeHistoryMap.get(historyKey);
  
  if (!history) {
    history = { margins: [], leans: [], timestamps: [] };
    edgeHistoryMap.set(historyKey, history);
  }

  // Add current reading
  history.margins.push(currentMargin);
  history.leans.push(currentLean);
  history.timestamps.push(Date.now());

  // Keep only last 5 readings
  while (history.margins.length > 5) {
    history.margins.shift();
    history.leans.shift();
    history.timestamps.shift();
  }

  if (history.margins.length < 2) return 'stable';

  // Check for lean consistency (flip = weakening)
  const lastLean = history.leans[history.leans.length - 2];
  if (lastLean !== currentLean) return 'weakening';

  // Calculate slope
  const firstMargin = history.margins[0];
  const slope = currentMargin - firstMargin;

  if (slope > 0.5) return 'strengthening';
  if (slope < -0.5) return 'weakening';
  return 'stable';
}

// ===== DRIVER BUILDER =====

function buildDrivers(
  state: PlayerLiveState,
  live: LiveBox | null,
  remaining: number,
  prop: PropTypeKey
): string[] {
  const drivers: string[] = [];
  
  // Current stat with pace info (not redundant with UI "Now X")
  const current = prop === 'Points' ? live?.pts :
                  prop === 'Rebounds' ? live?.reb :
                  prop === 'Assists' ? live?.ast :
                  live?.pra ?? 0;
  
  const minutes = live?.min ?? 0;
  if (minutes > 0) {
    const pacePerMin = (current ?? 0) / minutes;
    drivers.push(`Pace: ${pacePerMin.toFixed(2)}/min over ${minutes.toFixed(0)} min`);
  }
  drivers.push(`Est. ${remaining.toFixed(1)} min remaining`);
  
  // Key indicators
  if (state.fatigueScore >= 50) {
    drivers.push(`Fatigue: ${state.fatigueScore}/100`);
  }
  if (state.effortScore >= 65 || state.effortScore <= 35) {
    drivers.push(`Effort: ${state.effortScore}/100`);
  }
  if (state.handsOnKneesCount > 0) {
    drivers.push(`Hands on knees: ${state.handsOnKneesCount}x`);
  }
  if (prop === 'Rebounds' && state.role === 'BIG') {
    drivers.push(`Reb position: ${state.reboundPositionScore}/100`);
  }
  
  return drivers.slice(0, 4);
}

// ===== PROP LINE DEFAULTS (fallback when no real lines) =====

function getDefaultLine(prop: PropTypeKey, role: PlayerLiveState['role']): number {
  switch (prop) {
    case 'Points':
      return role === 'PRIMARY' ? 24.5 : role === 'SECONDARY' ? 18.5 : role === 'BIG' ? 14.5 : 10.5;
    case 'Rebounds':
      return role === 'BIG' ? 10.5 : role === 'PRIMARY' ? 5.5 : 4.5;
    case 'Assists':
      return role === 'PRIMARY' ? 6.5 : role === 'SECONDARY' ? 4.5 : 2.5;
    case 'PRA':
      return role === 'PRIMARY' ? 35.5 : role === 'SECONDARY' ? 28.5 : role === 'BIG' ? 25.5 : 18.5;
    default:
      return 15.5;
  }
}

// ===== REAL PROP LINE LOOKUP =====

function buildPropLineLookup(propLines: PropLineData[] | undefined): Map<string, { line: number; overPrice?: number; underPrice?: number; bookmaker?: string }> {
  const lookup = new Map<string, { line: number; overPrice?: number; underPrice?: number; bookmaker?: string }>();
  if (!propLines) return lookup;
  
  propLines.forEach(p => {
    // Key: "playername_proptype" (lowercase, normalized)
    const normalizedName = p.playerName.toLowerCase().trim();
    const key = `${normalizedName}_${p.propType.toLowerCase()}`;
    lookup.set(key, {
      line: p.line,
      overPrice: p.overPrice,
      underPrice: p.underPrice,
      bookmaker: p.bookmaker,
    });
  });
  
  console.log(`[Scout Agent] Built prop line lookup with ${lookup.size} real lines`);
  return lookup;
}

function getLine(
  propLineLookup: Map<string, { line: number; overPrice?: number; underPrice?: number; bookmaker?: string }>,
  playerName: string,
  prop: PropTypeKey,
  role: PlayerLiveState['role']
): { line: number; isRealLine: boolean; overPrice?: number; underPrice?: number; bookmaker?: string } {
  // PRA doesn't have real lines, always use default
  if (prop === 'PRA') {
    return { line: getDefaultLine(prop, role), isRealLine: false };
  }
  
  const propKey = prop.toLowerCase();
  const normalizedName = playerName.toLowerCase().trim();
  const key = `${normalizedName}_${propKey}`;
  const realLine = propLineLookup.get(key);
  
  if (realLine) {
    return { 
      line: realLine.line, 
      isRealLine: true,
      overPrice: realLine.overPrice,
      underPrice: realLine.underPrice,
      bookmaker: realLine.bookmaker,
    };
  }
  
  // Fallback to default
  return { line: getDefaultLine(prop, role), isRealLine: false };
}

// ===== INFER PLAYER ROLE FROM POSITION AND BOX SCORE =====

function inferPlayerRole(
  position: string | undefined,
  boxScore: { points: number; rebounds: number; assists: number } | null,
  minutesPlayed: number
): 'PRIMARY' | 'SECONDARY' | 'BIG' | 'SPACER' {
  const pos = (position || '').toUpperCase();
  
  // Position-based inference for bigs
  if (pos.includes('C') || pos === 'F-C' || pos === 'C-F') return 'BIG';
  if (pos === 'PF' && boxScore && boxScore.rebounds > 5) return 'BIG';
  
  // Stats-based inference for high-minute players
  if (minutesPlayed >= 15 && boxScore) {
    if (boxScore.points >= 12 || boxScore.assists >= 5) return 'PRIMARY';
    if (boxScore.points >= 8) return 'SECONDARY';
  }
  
  // Guard positions default to SECONDARY
  if (pos === 'PG' || pos === 'SG') return 'SECONDARY';
  if (pos === 'SF' || pos === 'PF') return 'SECONDARY';
  
  return 'SPACER';
}

// ===== NEW PROJECTION-BASED calculatePropEdges =====

function calculatePropEdges(
  playerStates: Record<string, PlayerLiveState>,
  visionSignals: any[],
  pbpData: any,
  existingEdges: PropEdge[],
  gameTime: string,
  propLines?: PropLineData[],
  gameContext?: any
): PropEdge[] {
  const edges: PropEdge[] = [];
  
  const scoreDiff = (pbpData?.homeScore ?? 0) - (pbpData?.awayScore ?? 0);
  const period = pbpData?.period ?? 1;
  
  // Build prop line lookup from real bookmaker data
  const propLineLookup = buildPropLineLookup(propLines);
  
  const propTypes: PropTypeKey[] = ['Points', 'Rebounds', 'Assists', 'PRA'];
  
  // PART 1: Parse substitution events and populate rotation state for all players
  const subEvents = parseSubstitutionEvents(pbpData?.recentPlays);
  console.log(`[Scout Agent] calculatePropEdges: ${Object.keys(playerStates).length} players, period ${period}, scoreDiff ${scoreDiff}, realLines: ${propLineLookup.size}, subEvents: ${subEvents.length}`);
  
  // Build roster lookup for position inference
  const rosterLookup = new Map<string, string>();
  [...(gameContext?.homeRoster || []), ...(gameContext?.awayRoster || [])].forEach((p: any) => {
    if (p.name && p.position) {
      rosterLookup.set(p.name.toLowerCase(), p.position);
    }
  });
  
  // Pre-process: Update rotation state and infer roles for all players
  Object.values(playerStates).forEach(player => {
    const live = getLiveBox(pbpData, player.playerName);
    const minutesPlayed = live?.min ?? 0;
    
    // Update rotation state using PBP substitution data
    player.rotation = updateRotationState(player, subEvents, period, scoreDiff, minutesPlayed);
    
    // Infer player role from roster position if not already set or defaulted
    if (player.role === 'SPACER' || !player.role) {
      const position = rosterLookup.get(player.playerName.toLowerCase());
      const boxScore = live ? { points: live.pts, rebounds: live.reb, assists: live.ast } : null;
      player.role = inferPlayerRole(position, boxScore, minutesPlayed);
    }
  });
  
  Object.values(playerStates).forEach(player => {
    // Skip players with minimal playing time
    if (!player.onCourt && player.minutesEstimate < 5) return;
    
    const live = getLiveBox(pbpData, player.playerName);
    
    // Apply vision signals to player state temporarily
    const playerSignals = visionSignals?.filter((s: any) => 
      s.player?.toLowerCase() === player.playerName.toLowerCase()
    ) || [];
    
    // Modify player state based on vision signals
    if (playerSignals.length > 0) {
      playerSignals.forEach((signal: any) => {
        if (signal.signalType === 'fatigue' && signal.value > 0) {
          player.fatigueScore = Math.min(100, (player.fatigueScore || 0) + signal.value);
        }
        if (signal.signalType === 'effort') {
          player.effortScore = Math.max(0, Math.min(100, (player.effortScore || 50) + signal.value));
        }
        if (signal.signalType === 'speed') {
          player.speedIndex = Math.max(0, Math.min(100, (player.speedIndex || 50) + signal.value));
        }
      });
    }
    
    propTypes.forEach(prop => {
      // Skip certain props based on role
      if (prop === 'Rebounds' && player.role !== 'BIG' && player.role !== 'PRIMARY') return;
      if (prop === 'Assists' && player.role === 'SPACER') return;
      
      // Get real line from lookup, or fallback to default
      const { line, isRealLine, overPrice, underPrice, bookmaker } = getLine(
        propLineLookup, 
        player.playerName, 
        prop, 
        player.role
      );
      
      // Skip props without real lines (except PRA which is calculated)
      // This prevents showing confusing default-based projections
      if (!isRealLine && prop !== 'PRA') return;
      
      const { expected, remaining, uncertainty, riskFlags, rate, rotationRole } = projectFinal(
        player, live, prop, scoreDiff, period
      );
      
      const diff = expected - line;
      const lean: 'OVER' | 'UNDER' = diff >= 0 ? 'OVER' : 'UNDER';
      const edgeMargin = Math.abs(diff);
      
      // Calculate trend
      const historyKey = `${player.playerName}-${prop}`;
      const trend = calculateTrend(historyKey, edgeMargin, lean);
      
      const confidence = computeConfidence(edgeMargin, player, riskFlags, live);
      
      // Only include edges with meaningful margin AND minimum confidence
      if (edgeMargin >= 1.5 && confidence >= 45) {
        const currentStat = prop === 'Points' ? live?.pts :
                           prop === 'Rebounds' ? live?.reb :
                           prop === 'Assists' ? live?.ast :
                           live?.pra ?? 0;
        
        // Calculate stat uncertainty from minutes uncertainty and rate
        const statUncertainty = uncertainty * rate;
        
        edges.push({
          player: player.playerName,
          prop,
          line,
          lean,
          confidence,
          expectedFinal: Math.round(expected * 10) / 10,
          drivers: buildDrivers(player, live, remaining, prop),
          riskFlags,
          trend,
          gameTime,
          currentStat,
          minutesPlayed: live?.min ?? 0,
          remainingMinutes: remaining,
          edgeMargin: Math.round(edgeMargin * 10) / 10,
          ratePerMinute: Math.round(rate * 100) / 100,
          overPrice,
          underPrice,
          bookmaker,
          // V3: Uncertainty fields
          uncertainty: Math.round(statUncertainty * 10) / 10,
          minutesUncertainty: Math.round(uncertainty * 10) / 10,
          rotationVolatilityFlag: rotationRole === 'BENCH_FRINGE',
          rotationRole,
        });
      }
    });
  });
  
  // Sort by confidence descending
  edges.sort((a, b) => b.confidence - a.confidence);
  
  console.log(`[Scout Agent] Generated ${edges.length} projection-based prop edges (using real lines)`);
  return edges;
}

// Generate halftime locked recommendations
function generateHalftimeRecommendations(
  playerStates: Record<string, PlayerLiveState>,
  existingEdges: PropEdge[],
  gameTime: string
): any[] {
  const recommendations: any[] = [];
  
  Object.values(playerStates).forEach(player => {
    if (player.minutesEstimate < 5) return;
    
    const playerEdges = existingEdges.filter(e => e.player === player.playerName);
    const live = { pts: 0, reb: 0, ast: 0, pra: 0, min: player.minutesEstimate, fouls: player.foulCount, fga: 0, fta: 0 };
    
    // Points recommendation for scorers
    if (player.role === 'PRIMARY' || player.role === 'SECONDARY') {
      const isFatigued = player.fatigueScore >= 40;
      const isEnergized = player.fatigueScore < 25 && player.effortScore > 60;
      
      if (isFatigued || isEnergized) {
        const existingEdge = playerEdges.find(e => e.prop === 'Points');
        const line = existingEdge?.line || getDefaultLine('Points', player.role);
        const { expected, remaining, riskFlags } = projectFinal(player, live, 'Points', 0, 2);
        
        recommendations.push({
          mode: 'HALFTIME_LOCK',
          player: player.playerName,
          prop: 'Points',
          line,
          lean: isFatigued ? 'UNDER' : 'OVER',
          confidence: computeConfidence(Math.abs(expected - line), player, riskFlags, live),
          expectedFinal: Math.round(expected * 10) / 10,
          drivers: buildDrivers(player, live, remaining, 'Points'),
          riskFlags,
          lockTime: gameTime,
        });
      }
    }
    
    // Rebounds recommendation for bigs
    if (player.role === 'BIG') {
      const lowPositioning = player.reboundPositionScore < 50;
      const goodPositioning = player.reboundPositionScore > 70;
      
      if (lowPositioning || goodPositioning) {
        const existingEdge = playerEdges.find(e => e.prop === 'Rebounds');
        const line = existingEdge?.line || getDefaultLine('Rebounds', player.role);
        const { expected, remaining, riskFlags } = projectFinal(player, live, 'Rebounds', 0, 2);
        
        recommendations.push({
          mode: 'HALFTIME_LOCK',
          player: player.playerName,
          prop: 'Rebounds',
          line,
          lean: lowPositioning ? 'UNDER' : 'OVER',
          confidence: computeConfidence(Math.abs(expected - line), player, riskFlags, live),
          expectedFinal: Math.round(expected * 10) / 10,
          drivers: buildDrivers(player, live, remaining, 'Rebounds'),
          riskFlags,
          lockTime: gameTime,
        });
      }
    }
  });
  
  return recommendations;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse request body with error handling for malformed JSON
    let requestBody: AgentLoopRequest;
    try {
      requestBody = await req.json() as AgentLoopRequest;
    } catch (parseError) {
      console.error('[Scout Agent] Failed to parse request body:', parseError);
      return new Response(
        JSON.stringify({ error: 'Invalid request body - malformed JSON' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const { 
      frame, 
      gameContext, 
      playerStates, 
      pbpData: providedPbpData,
      existingEdges,
      currentGameTime,
      forceAnalysis,
      propLines
    } = requestBody;

    // Fetch fresh PBP data directly instead of relying on potentially stale frontend state
    let pbpData = providedPbpData;
    let pbpTimestamp: string | null = null;
    let pbpGameTime: string | null = null;
    const eventIdForPBP = (gameContext as any)?.espnEventId || gameContext?.eventId;
    
    if (eventIdForPBP) {
      try {
        const pbpResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/fetch-live-pbp`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
            },
            body: JSON.stringify({ eventId: eventIdForPBP }),
          }
        );
        
        if (pbpResponse.ok) {
          const freshData = await pbpResponse.json();
          if (!freshData.notAvailable && freshData.players?.length) {
            pbpData = freshData;
            pbpTimestamp = new Date().toISOString();
            pbpGameTime = freshData.gameTime || null;
            console.log(`[Scout Agent] Fresh PBP: ${freshData.players.length} players, time: ${freshData.gameTime}`);
          }
        } else {
          await pbpResponse.text(); // Consume body to prevent resource leak
        }
      } catch (e) {
        console.log(`[Scout Agent] Fresh PBP fetch failed, using provided data:`, (e as Error).message);
      }
    }

    if (!frame || frame.length < 100) {
      return new Response(
        JSON.stringify({ error: 'No valid frame provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const base64Data = frame.replace(/^data:image\/\w+;base64,/, '');

    // STEP 1: Scene Classification (fast model)
    console.log('[Scout Agent] Step 1: Scene classification');
    
    const classifyResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
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
      const errorStatus = classifyResponse.status;
      
      // Handle rate limits (429), payment issues (402), and gateway errors (502, 503, 504) gracefully
      if (errorStatus === 429 || errorStatus === 402 || errorStatus === 502 || errorStatus === 503 || errorStatus === 504) {
        const isRateLimit = errorStatus === 429;
        const isPaymentIssue = errorStatus === 402;
        
        let errorMessage = 'AI gateway temporarily unavailable';
        let reason = `Gateway error ${errorStatus} - will retry`;
        let retryDelay = 5000;
        
        if (isRateLimit) {
          errorMessage = 'Rate limit';
          reason = 'Rate limited - will retry';
          retryDelay = 2000;
        } else if (isPaymentIssue) {
          errorMessage = 'AI quota exceeded';
          reason = 'AI credits exhausted - contact support or wait for reset';
          retryDelay = 30000; // Longer delay for payment issues
        }
        
        console.log(`[Scout Agent] AI gateway issue: ${errorStatus} - ${errorMessage}`);
        
        return new Response(
          JSON.stringify({ 
            error: errorMessage,
            sceneClassification: { 
              sceneType: 'unknown',
              isAnalysisWorthy: false, 
              reason,
              timestamp: new Date().toISOString(),
            },
            retryAfter: retryDelay,
          }),
          { status: isPaymentIssue ? 402 : (isRateLimit ? 429 : 503), headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Classification failed: ${errorStatus}`);
    }

    const classifyData = await classifyResponse.json();
    const classifyContent = classifyData.choices?.[0]?.message?.content || '';
    
    let sceneClassification = {
      sceneType: 'unknown',
      isAnalysisWorthy: false,
      isHalftime: false,
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
      
      // Auto-detect halftime from scene type
      if (parsed.sceneType === 'halftime') {
        sceneClassification.isHalftime = true;
      }
    } catch {
      console.log('[Scout Agent] Scene classification parse failed, using defaults');
    }

    // If scene is not analysis-worthy, return early (unless forceAnalysis is set)
    if (!sceneClassification.isAnalysisWorthy && !forceAnalysis) {
      console.log(`[Scout Agent] Skipping analysis: ${sceneClassification.reason}`);
      
      // V8: Signal frontend to trigger refresh during breaks
      const isBreakScene = ['commercial', 'timeout', 'dead_time'].includes(sceneClassification.sceneType);
      
      return new Response(
        JSON.stringify({
          sceneClassification,
          gameTime: sceneClassification.gameTime || currentGameTime,
          score: sceneClassification.score,
          // V8: Break refresh signals
          shouldRefresh: isBreakScene,
          refreshReason: isBreakScene ? sceneClassification.sceneType : undefined,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log if forcing analysis
    if (forceAnalysis && !sceneClassification.isAnalysisWorthy) {
      console.log('[Scout Agent] Force analysis enabled - bypassing scene check');
    }

    // STEP 2: Vision Analysis (detailed model)
    console.log(`[Scout Agent] Step 2: Vision analysis for ${sceneClassification.sceneType}`);

    // Note: Roster context is now built into getVisionAnalysisPrompt via gameContext

    const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { 
            role: 'system', 
            content: `You are an AI sports analyst extracting betting signals from live game footage.
Game: ${gameContext.awayTeam} @ ${gameContext.homeTeam}

CRITICAL RULE: You MUST identify players by their jersey numbers and look them up in the roster table provided in the prompt. NEVER guess player names.` 
          },
          { 
            role: 'user', 
            content: [
              { type: 'text', text: getVisionAnalysisPrompt(playerStates, sceneClassification.sceneType, gameContext) },
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
      const visionErrorStatus = visionResponse.status;
      console.error('[Scout Agent] Vision analysis failed:', visionErrorStatus);
      
      // Still return scene classification data, just without vision signals
      return new Response(
        JSON.stringify({
          sceneClassification,
          gameTime: sceneClassification.gameTime || currentGameTime,
          score: sceneClassification.score,
          visionSignals: [],
          propEdges: [],
          error: visionErrorStatus === 429 ? 'Vision rate limited' : `Vision analysis failed (${visionErrorStatus})`,
          retryAfter: visionErrorStatus === 429 ? 2000 : 5000,
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
      // Strategy 1: Try code block extraction
      const jsonMatch = visionContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        visionResult = JSON.parse(jsonMatch[1].trim());
        console.log('[Scout Agent] Parsed vision via code block');
      } else {
        // Strategy 2: Try finding JSON object in content
        const objectMatch = visionContent.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          visionResult = JSON.parse(objectMatch[0]);
          console.log('[Scout Agent] Parsed vision via object extraction');
        } else {
          // Strategy 3: Try direct parse
          visionResult = JSON.parse(visionContent.trim());
          console.log('[Scout Agent] Parsed vision via direct parse');
        }
      }
    } catch {
      console.log('[Scout Agent] Vision result parse failed, extracting basic signals from text');
      // Strategy 4: Extract signals from natural language
      visionResult.visionSignals = extractBasicSignals(visionContent, gameContext);
      visionResult.overallAssessment = visionContent.slice(0, 200);
    }

    // PHASE 1 ENHANCEMENT: Fallback signal extraction when AI returns empty signals
    // If scene is analysis-worthy but no signals were returned, try extracting from overallAssessment
    if ((!visionResult.visionSignals || visionResult.visionSignals.length === 0) && 
        sceneClassification.isAnalysisWorthy && 
        visionResult.overallAssessment) {
      console.log('[Scout Agent] No vision signals returned, attempting fallback extraction from assessment');
      const fallbackSignals = extractBasicSignals(visionResult.overallAssessment, gameContext);
      if (fallbackSignals.length > 0) {
        visionResult.visionSignals = fallbackSignals;
        console.log(`[Scout Agent] Fallback extraction yielded ${fallbackSignals.length} signals`);
      }
    }
    
    // PHASE 1 ENHANCEMENT: Also extract from suggestedProps if signals are still empty
    if ((!visionResult.visionSignals || visionResult.visionSignals.length === 0) && 
        visionResult.suggestedProps?.length > 0) {
      console.log('[Scout Agent] Extracting signals from suggestedProps');
      visionResult.visionSignals = visionResult.suggestedProps.map((prop: any) => ({
        signalType: prop.lean === 'UNDER' ? 'fatigue' : 'effort',
        player: prop.player,
        jersey: '?',
        value: prop.lean === 'UNDER' ? 6 : 5,
        observation: prop.reason || `Suggested ${prop.prop} ${prop.lean}`,
        confidence: 'medium',
        verified: false,
      }));
      console.log(`[Scout Agent] Extracted ${visionResult.visionSignals.length} signals from suggestedProps`);
    }

    // STEP 2.5: Validate vision signals against roster (jersey → player name)
    if (visionResult.visionSignals?.length > 0) {
      console.log(`[Scout Agent] Validating ${visionResult.visionSignals.length} vision signals against roster`);
      visionResult.visionSignals = validateVisionSignals(visionResult.visionSignals, gameContext);
      
      const verifiedCount = visionResult.visionSignals.filter((s: any) => s.verified).length;
      console.log(`[Scout Agent] Jersey validation complete: ${verifiedCount}/${visionResult.visionSignals.length} verified`);
      
      // PHASE 1 ENHANCEMENT: Accept low confidence signals (previously filtered)
      // Don't filter out low confidence signals - they're still valuable
    }

    // STEP 3: Calculate prop edges
    const gameTime = sceneClassification.gameTime || currentGameTime || 'Unknown';
    const propEdges = calculatePropEdges(
      playerStates,
      visionResult.visionSignals || [],
      pbpData,
      existingEdges,
      gameTime,
      propLines,
      gameContext
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

    // Record prop outcomes for calibration tracking
    const analysisDate = new Date().toISOString().split('T')[0];
    await recordPropOutcomes(
      propEdges,
      gameContext.eventId,
      '', // espnEventId not available in request type
      analysisDate
    );

    // PHASE 2: Update player behavior profiles with film-derived insights
    if (visionResult.visionSignals?.length > 0) {
      await updatePlayerFilmInsights(
        visionResult.visionSignals,
        playerStates,
        gameContext
      );
    }

    // Generate halftime recommendations if halftime detected
    let halftimeRecommendations: any[] = [];
    if (sceneClassification.isHalftime) {
      halftimeRecommendations = generateHalftimeRecommendations(playerStates, propEdges, gameTime);
      console.log(`[Scout Agent] Halftime detected - generated ${halftimeRecommendations.length} locked recommendations`);
    }

    // STEP 5: Calculate game-level bet edges (Total, Moneyline, Spread)
    // First, fetch Vegas lines from game_environment table
    let vegasData: { vegasTotal: number; vegasSpread: number; moneylineHome: number | null; moneylineAway: number | null; paceRating: string; gameScript: string } | null = null;
    let gameBetData = null;
    
    if (pbpData && supabaseUrl && supabaseKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseKey);
        const today = new Date().toISOString().split('T')[0];
        
        // Try to fetch Vegas lines from game_environment
        const { data: gameEnv, error: envError } = await supabase
          .from('game_environment')
          .select('vegas_total, vegas_spread, moneyline_home, moneyline_away, home_implied_total, away_implied_total, pace_rating, game_script')
          .or(`home_team_abbrev.eq.${gameContext.homeTeam},away_team_abbrev.eq.${gameContext.awayTeam}`)
          .gte('game_date', today)
          .limit(1)
          .maybeSingle();
        
        if (gameEnv && !envError) {
          vegasData = {
            vegasTotal: gameEnv.vegas_total || 220,
            vegasSpread: gameEnv.vegas_spread || 0,
            moneylineHome: gameEnv.moneyline_home,
            moneylineAway: gameEnv.moneyline_away,
            paceRating: gameEnv.pace_rating || 'MEDIUM',
            gameScript: gameEnv.game_script || 'COMPETITIVE',
          };
          console.log(`[Scout Agent] Vegas data loaded: Total=${vegasData.vegasTotal}, Spread=${vegasData.vegasSpread}, Script=${vegasData.gameScript}`);
        } else {
          console.log('[Scout Agent] No Vegas data found, using defaults');
          vegasData = {
            vegasTotal: 220,
            vegasSpread: 0,
            moneylineHome: null,
            moneylineAway: null,
            paceRating: 'MEDIUM',
            gameScript: 'COMPETITIVE',
          };
        }
      } catch (err) {
        console.error('[Scout Agent] Failed to fetch Vegas data:', err);
        vegasData = {
          vegasTotal: 220,
          vegasSpread: 0,
          moneylineHome: null,
          moneylineAway: null,
          paceRating: 'MEDIUM',
          gameScript: 'COMPETITIVE',
        };
      }
      
      // Convert moneyline to implied probability
      const oddsToProb = (americanOdds: number | null): number => {
        if (!americanOdds) return 0.5;
        if (americanOdds > 0) {
          return 100 / (americanOdds + 100);
        } else {
          return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
        }
      };
      
      const preGameHomeWinProb = vegasData.moneylineHome ? oddsToProb(vegasData.moneylineHome) : 0.5;
      
      gameBetData = calculateGameBetEdges(
        playerStates,
        pbpData,
        vegasData.vegasTotal,
        vegasData.vegasSpread,
        preGameHomeWinProb
      );
      console.log(`[Scout Agent] Game bet edges calculated: ${gameBetData.gameBetEdges.length} bets`);
    }

    return new Response(
      JSON.stringify({
        sceneClassification,
        visionSignals: visionResult.visionSignals,
        propEdges,
        updatedPlayerStates: {},
        gameTime,
        score: sceneClassification.score,
        shouldNotify,
        notification,
        overallAssessment: visionResult.overallAssessment,
        isHalftime: sceneClassification.isHalftime,
        halftimeRecommendations: sceneClassification.isHalftime ? halftimeRecommendations : undefined,
        // Game-level bet edges
        homeTeamState: gameBetData?.homeTeam || null,
        awayTeamState: gameBetData?.awayTeam || null,
        gameBetEdges: gameBetData?.gameBetEdges || [],
        vegasData,
        // PBP freshness tracking
        pbpTimestamp,
        pbpGameTime,
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
