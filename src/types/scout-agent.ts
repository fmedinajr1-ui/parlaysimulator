/**
 * Autonomous Scout Agent Types
 * Persistent player tracking, prop fusion, and real-time betting signals
 */

export type PlayerRole = 'PRIMARY' | 'SECONDARY' | 'SPACER' | 'BIG';
export type PropType = 'Points' | 'Rebounds' | 'Assists' | 'PRA' | 'Steals' | 'Blocks' | 'Threes';
export type TrendDirection = 'strengthening' | 'weakening' | 'stable';
export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type SceneType = 'live_play' | 'timeout' | 'injury' | 'fastbreak' | 'freethrow' | 'commercial' | 'dead_time' | 'unknown';

/**
 * Persistent player state maintained throughout the game
 * Fatigue is ACCUMULATIVE - does not reset randomly
 */
export interface PlayerLiveState {
  playerName: string;
  jersey: string;
  team: string;
  onCourt: boolean;
  role: PlayerRole;
  fatigueScore: number;       // 0-100, ACCUMULATIVE
  effortScore: number;        // 0-100
  speedIndex: number;         // 0-100
  reboundPositionScore: number; // 0-100
  minutesEstimate: number;
  foulCount: number;
  visualFlags: string[];
  lastUpdated: string;        // "Q2 5:42"
  // Tracking for fatigue accumulation
  sprintCount: number;
  handsOnKneesCount: number;
  slowRecoveryCount: number;
  lastSubbedIn?: string;
  lastSubbedOut?: string;
}

/**
 * Prop edge recommendation with confidence and trend
 */
export interface PropEdge {
  player: string;
  prop: PropType;
  line: number;
  lean: 'OVER' | 'UNDER';
  confidence: number;         // 0-100
  expectedFinal: number;
  drivers: string[];
  riskFlags: string[];
  trend: TrendDirection;
  gameTime: string;
  notifiedAt?: Date;
  // PBP enrichment
  currentStat?: number;
  minutesPlayed?: number;
  // Bookmaker data
  actualLine?: number;
  overPrice?: number;
  underPrice?: number;
}

/**
 * Scene classification result from auto-detection
 */
export interface SceneClassification {
  sceneType: SceneType;
  isAnalysisWorthy: boolean;
  confidence: ConfidenceLevel;
  gameTime: string | null;
  score: string | null;
  reason: string;
  timestamp: Date;
}

/**
 * Live play-by-play data from ESPN API
 */
export interface LivePBPData {
  gameTime: string;           // "Q2 5:42"
  period: number;
  clock: string;
  homeScore: number;
  awayScore: number;
  homeTeam: string;
  awayTeam: string;
  pace: number;               // Possessions per 48
  players: PBPPlayerStats[];
  recentPlays: RecentPlay[];
  isHalftime: boolean;
  isGameOver: boolean;
}

export interface PBPPlayerStats {
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  fouls: number;
  plusMinus: number;
  fgm: number;
  fga: number;
  threePm: number;
  threePa: number;
  ftm: number;
  fta: number;
}

export interface RecentPlay {
  time: string;
  text: string;
  playerId?: string;
  playerName?: string;
  team?: string;
  playType?: 'score' | 'rebound' | 'assist' | 'turnover' | 'foul' | 'substitution' | 'timeout' | 'other';
}

/**
 * Vision signal extracted from frame analysis
 */
export interface VisionSignal {
  signalType: 'fatigue' | 'speed' | 'posture' | 'effort' | 'positioning' | 'mechanics';
  player: string;
  jersey: string;
  value: number;              // Delta to apply
  observation: string;
  confidence: ConfidenceLevel;
}

/**
 * Full agent state for React hook
 */
export interface ScoutAgentState {
  isRunning: boolean;
  isPaused: boolean;
  captureRate: number;        // FPS (1-5)
  gameContext: {
    eventId: string;
    homeTeam: string;
    awayTeam: string;
    homeRoster: { name: string; jersey: string; position: string }[];
    awayRoster: { name: string; jersey: string; position: string }[];
  } | null;
  playerStates: Map<string, PlayerLiveState>;
  activePropEdges: PropEdge[];
  sceneHistory: SceneClassification[];
  pbpData: LivePBPData | null;
  lastAnalysisTime: Date | null;
  analysisCount: number;
  framesProcessed: number;
  commercialSkipCount: number;
  currentGameTime: string | null;
  currentScore: string | null;
}

/**
 * Agent loop analysis request
 */
export interface AgentLoopRequest {
  frame: string;              // Base64 image
  gameContext: {
    eventId: string;
    homeTeam: string;
    awayTeam: string;
    homeRoster?: { name: string; jersey: string; position: string }[];
    awayRoster?: { name: string; jersey: string; position: string }[];
  };
  playerStates: Record<string, PlayerLiveState>;
  pbpData?: LivePBPData;
  existingEdges: PropEdge[];
  currentGameTime?: string;
}

/**
 * Agent loop analysis response
 */
export interface AgentLoopResponse {
  sceneClassification: SceneClassification;
  updatedPlayerStates?: Record<string, Partial<PlayerLiveState>>;
  visionSignals?: VisionSignal[];
  propEdges?: PropEdge[];
  gameTime?: string;
  score?: string;
  shouldNotify?: boolean;
  notification?: {
    player: string;
    prop: PropType;
    lean: 'OVER' | 'UNDER';
    confidence: number;
    reason: string;
    gameTime: string;
  };
}

/**
 * Toast notification for prop alerts
 */
export interface PropAlertNotification {
  type: 'PROP_ALERT';
  player: string;
  prop: PropType;
  lean: 'OVER' | 'UNDER';
  confidence: number;
  reason: string;
  gameTime: string;
}

/**
 * Fatigue calculation factors
 */
export interface FatigueFactors {
  sprints: number;            // +3-5 per fast break
  handsOnKnees: number;       // +8-10
  slowRecovery: number;       // +5
  timeoutRecovery: number;    // -5
  substitutionReset: boolean; // Reset slope
  minutesPlayed: number;      // Base fatigue from minutes
}
