/**
 * Autonomous Scout Agent Types V2
 * Persistent player tracking, prop fusion, halftime lock, and multi-game support
 */

// ===== BASIC ENUMS & TYPES =====

export type PlayerRole = 'PRIMARY' | 'SECONDARY' | 'SPACER' | 'BIG';
export type PropType = 'Points' | 'Rebounds' | 'Assists' | 'PRA' | 'Steals' | 'Blocks' | 'Threes';
export type TrendDirection = 'strengthening' | 'weakening' | 'stable';
export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type SceneType = 'live_play' | 'timeout' | 'injury' | 'fastbreak' | 'freethrow' | 'commercial' | 'dead_time' | 'halftime' | 'unknown';

// ===== PLAYER LIVE STATE V2 (CANONICAL SCHEMA) =====

/**
 * Player Identity - LOCKED once identified
 */
export interface PlayerIdentity {
  gameId: string;
  playerId: string;
  name: string;
  jersey: string;
  team: string;
  position: string;
}

/**
 * On-Court Status
 */
export interface CourtStatus {
  onCourt: boolean;
  lastSubInTime?: string;
  lastSubOutTime?: string;
  minutesPlayed: number;
  rotationStability: number; // 0-100 (higher = stable minutes)
}

/**
 * Role & Usage (VISION + PBP FUSED)
 */
export interface RoleProfile {
  role: PlayerRole;
  usageScore: number; // 0-100 (touch + action involvement)
  touchRate: number; // 0-1
  onBallRate: number; // 0-1
  offBallRate: number; // 0-1
  roleConfidence: number; // 0-100
}

/**
 * Physical Condition (ACCUMULATIVE - fatigue never resets)
 */
export interface PhysicalState {
  fatigueScore: number; // 0-100 (monotonic upward unless resting)
  fatigueSlope: number; // + / - rate of change
  effortScore: number; // 0-100
  speedIndex: number; // normalized sprint + recovery
  postureFlags: string[]; // ["hands_on_knees", "hunched"]
  recoveryEvents: number; // timeouts / stoppages
  sprintCount: number;
  handsOnKneesCount: number;
  slowRecoveryCount: number;
}

/**
 * Skill-Specific Vision Metrics
 */
export interface VisionMetrics {
  shotProfile: {
    rimRate: number; // %
    openShotRate: number; // %
    contestedRate: number; // %
  };
  freeThrowRoutineStability?: number; // 0-100
  defenderProximityAvgFt: number;
  transitionInvolvement: number; // 0-1
}

/**
 * Rebounding Intelligence (KEY FOR UNDERS)
 */
export interface ReboundProfile {
  reboundPositionScore: number; // 0-100
  avgDistanceToRimFt: number;
  boxOutFrequency: number; // 0-1
  crashRate: number; // 0-1
  leakOutRate: number; // 0-1
}

/**
 * Play-By-Play Truth Layer
 */
export interface BoxScoreLive {
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
}

/**
 * Prop Context (LIVE COMPARISON ENGINE)
 */
export interface PropLineContext {
  line: number;
  current: number;
  projectedFinal: number;
  pOver: number;
  pUnder: number;
}

export interface PropContext {
  points?: PropLineContext;
  rebounds?: PropLineContext;
  assists?: PropLineContext;
  pra?: PropLineContext;
  threes?: PropLineContext;
}

/**
 * Risk & Flags
 */
export interface RiskFlags {
  foulRisk: boolean;
  blowoutRisk: boolean;
  injuryWatch: boolean;
  minutesVolatility: boolean;
  rotationRisk: boolean;
}

/**
 * Alert & Confidence Memory (ANTI-SPAM)
 */
export interface AlertState {
  lastAlertTime?: number;
  lastAlertConfidence?: number;
  lastAlertType?: 'OVER' | 'UNDER';
  alertCooldownMs: number;
}

/**
 * Timing & Metadata
 */
export interface StateMeta {
  lastUpdatedGameTime: string; // "Q3 7:14"
  lastUpdatedTs: number;
  dataConfidence: ConfidenceLevel;
}

/**
 * CANONICAL PlayerLiveState V2 (Full structured state)
 */
export interface PlayerLiveStateV2 {
  identity: PlayerIdentity;
  courtStatus: CourtStatus;
  roleProfile: RoleProfile;
  physicalState: PhysicalState;
  visionMetrics: VisionMetrics;
  reboundProfile: ReboundProfile;
  boxScoreLive: BoxScoreLive;
  propContext: PropContext;
  riskFlags: RiskFlags;
  alertState: AlertState;
  meta: StateMeta;
}

// Injury status types
export type InjuryStatus = 'OUT' | 'DOUBTFUL' | 'QUESTIONABLE' | 'GTD' | 'DTD' | null;

// ===== ROTATION TRUTH LAYER =====

export type RotationRole = 'STARTER' | 'CLOSER' | 'BENCH_CORE' | 'BENCH_FRINGE';
export type FoulRiskLevel = 'LOW' | 'MED' | 'HIGH';

/**
 * Rotation State - Tracks substitution patterns and playing time reliability
 */
export interface RotationState {
  stintStartGameTime?: string;      // When current stint started (e.g., "Q2 5:42")
  stintSeconds: number;             // Seconds in current stint
  lastSubOutGameTime?: string;      // Last time they left floor
  lastSubInGameTime?: string;       // Last time they entered
  benchSecondsLast8: number;        // Rolling bench time window (last 8 minutes)
  onCourtStability: number;         // 0-1: stable rotation vs chaotic
  projectedStintsRemaining: number; // Expected number of stints left
  foulRiskLevel: FoulRiskLevel;
  rotationRole: RotationRole;
}

/**
 * Legacy PlayerLiveState (for backwards compatibility during migration)
 * @deprecated Use PlayerLiveStateV2 instead
 */
export interface PlayerLiveState {
  playerName: string;
  jersey: string;
  team: string;
  onCourt: boolean;
  role: PlayerRole;
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
  lastSubbedIn?: string;
  lastSubbedOut?: string;
  // V2 fields (optional for migration)
  fatigueSlope?: number;
  boxScore?: Partial<BoxScoreLive>;
  // Pre-game baseline metadata
  preGameTrend?: 'hot' | 'cold' | 'stable';
  preGameConsistency?: number;
  // Injury status from ESPN
  injuryStatus?: InjuryStatus;
  injuryDetail?: string;
  // V3: Rotation Truth Layer
  rotation?: RotationState;
}

// ===== PROP EDGE =====

export interface PropEdge {
  player: string;
  prop: PropType;
  line: number;
  lean: 'OVER' | 'UNDER';
  confidence: number; // 0-100
  expectedFinal: number;
  drivers: string[];
  riskFlags: string[];
  trend: TrendDirection;
  gameTime: string;
  notifiedAt?: Date;
  // PBP enrichment
  currentStat?: number;
  minutesPlayed?: number;
  remainingMinutes?: number;
  // Projection details
  edgeMargin?: number; // |expected - line|
  ratePerMinute?: number;
  // Bookmaker data
  actualLine?: number;
  overPrice?: number;
  underPrice?: number;
  bookmaker?: string;
  // V3: Uncertainty bands
  uncertainty?: number;           // ± stat units
  minutesUncertainty?: number;    // ± minutes
  rateUncertainty?: number;       // ± rate per min
  rotationVolatilityFlag?: boolean;
  rotationRole?: RotationRole;
  // Calibrated probability (once bucket map is populated)
  calibratedProb?: number;        // 0-1
}

// ===== SCENE CLASSIFICATION =====

export interface SceneClassification {
  sceneType: SceneType;
  isAnalysisWorthy: boolean;
  confidence: ConfidenceLevel;
  gameTime: string | null;
  score: string | null;
  reason: string;
  timestamp: Date;
}

// ===== HALFTIME LOCK MODE =====

export interface HalftimeLockedProp {
  mode: 'HALFTIME_LOCK';
  player: string;
  prop: PropType;
  line: number;
  lean: 'OVER' | 'UNDER';
  confidence: number;
  expectedFinal: number;
  drivers: string[];
  riskFlags: string[];
  lockTime: string;
  firstHalfStats?: Partial<BoxScoreLive>;
  // Real bookmaker prices
  overPrice?: number;
  underPrice?: number;
  bookmaker?: string;
}

export interface HalftimeLockState {
  isLocked: boolean;
  lockTime?: string;
  lockTimestamp?: number;
  lockedRecommendations: HalftimeLockedProp[];
}

// ===== LIVE PLAY-BY-PLAY =====

export interface LivePBPData {
  gameTime: string; // "Q2 5:42"
  period: number;
  clock: string;
  homeScore: number;
  awayScore: number;
  homeTeam: string;
  awayTeam: string;
  pace: number; // Possessions per 48
  players: PBPPlayerStats[];
  recentPlays: RecentPlay[];
  isHalftime: boolean;
  isGameOver: boolean;
  // Period transition flags for auto-suggest
  isQ2Ending?: boolean;
  isQ3Starting?: boolean;
  isQ4Starting?: boolean;
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
  playType?: 'dunk' | 'alley_oop' | 'and_one' | 'three_pointer' | 'score' | 'block' | 'steal' | 'def_rebound' | 'off_rebound' | 'rebound' | 'assist' | 'turnover' | 'missed_ft' | 'foul' | 'substitution' | 'timeout' | 'other';
  pointValue?: number;           // 0, 1, 2, or 3 points scored
  isHighMomentum?: boolean;      // Dunks, blocks, steals, and-1s
}

// ===== VISION SIGNALS =====

export interface VisionSignal {
  signalType: 'fatigue' | 'speed' | 'posture' | 'effort' | 'positioning' | 'mechanics';
  player: string;
  jersey: string;
  value: number; // Delta to apply
  observation: string;
  confidence: ConfidenceLevel;
}

// ===== MULTI-GAME MANAGER =====

export interface SingleGameState {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  playerStates: Map<string, PlayerLiveState>;
  propEdges: PropEdge[];
  sceneHistory: SceneClassification[];
  halftimeLock: HalftimeLockState;
  pbpData: LivePBPData | null;
  priority: number; // 0-100
  isActive: boolean;
  lastAnalysisTime: Date | null;
  analysisCount: number;
  framesProcessed: number;
  commercialSkipCount: number;
  currentGameTime: string | null;
  currentScore: string | null;
}

export interface QueuedAlert {
  gameId: string;
  gameName: string; // "BOS @ NYK"
  notification: PropAlertNotification;
  confidence: number;
  urgency: number;
  timestamp: number;
}

export interface MultiGameState {
  activeGames: Map<string, SingleGameState>;
  priorityGameIds: string[];
  alertQueue: QueuedAlert[];
  halftimeLocksReady: number;
  totalFramesProcessed: number;
}

// ===== AGENT STATE (SINGLE GAME - LEGACY COMPATIBLE) =====

import type { PreGameBaseline, TeamFatigueData } from './pre-game-baselines';

export interface ScoutAgentState {
  isRunning: boolean;
  isPaused: boolean;
  captureRate: number; // FPS (1-5)
  gameContext: {
    eventId: string;
    homeTeam: string;
    awayTeam: string;
    homeRoster: { name: string; jersey: string; position: string }[];
    awayRoster: { name: string; jersey: string; position: string }[];
    propLines?: { 
      playerName: string; 
      propType: 'points' | 'rebounds' | 'assists'; 
      line: number; 
      overPrice?: number; 
      underPrice?: number; 
      bookmaker?: string; 
    }[];
    // Pre-game baselines
    preGameBaselines?: PreGameBaseline[];
    homeTeamFatigue?: TeamFatigueData;
    awayTeamFatigue?: TeamFatigueData;
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
  // V2: Halftime Lock
  halftimeLock: HalftimeLockState;
}

// ===== AGENT LOOP REQUEST/RESPONSE =====

// ===== PROP LINE FROM BOOKMAKERS =====

export interface PropLine {
  playerName: string;
  propType: 'points' | 'rebounds' | 'assists';
  line: number;
  overPrice?: number;
  underPrice?: number;
  bookmaker?: string;
}

export interface AgentLoopRequest {
  frame: string; // Base64 image
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
  propLines?: PropLine[]; // Real betting lines from unified_props
}

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
  // V2: Halftime Lock
  isHalftime?: boolean;
  halftimeRecommendations?: HalftimeLockedProp[];
  // V3: Team-level game bet data
  homeTeamState?: TeamLiveState | null;
  awayTeamState?: TeamLiveState | null;
  gameBetEdges?: GameBetEdge[];
  vegasData?: {
    vegasTotal: number;
    vegasSpread: number;
    moneylineHome: number | null;
    moneylineAway: number | null;
    paceRating: string;
    gameScript: string;
  };
  // V4: PBP freshness tracking
  pbpTimestamp?: string;
  pbpGameTime?: string;
}

// ===== NOTIFICATIONS =====

export interface PropAlertNotification {
  type: 'PROP_ALERT';
  player: string;
  prop: PropType;
  lean: 'OVER' | 'UNDER';
  confidence: number;
  reason: string;
  gameTime: string;
  gameId?: string;
  gameName?: string;
}

// ===== FATIGUE CALCULATION =====

export interface FatigueFactors {
  sprints: number; // +3-5 per fast break
  handsOnKnees: number; // +8-10
  slowRecovery: number; // +5
  timeoutRecovery: number; // -5
  substitutionReset: boolean; // Reset slope
  minutesPlayed: number; // Base fatigue from minutes
}

// ===== PROJECTION CORE TYPES =====

/**
 * Live Box Score - Normalized PBP data per player
 */
export interface LiveBox {
  pts: number;
  reb: number;
  ast: number;
  pra: number;
  min: number;      // decimal minutes (18:34 → 18.566)
  fouls: number;
  fga: number;
  fta: number;
  threes: number;
  steals: number;
  blocks: number;
}

/**
 * Per-minute production rates
 */
export interface RatePerMinute {
  pts: number;
  reb: number;
  ast: number;
}

/**
 * Edge history for trend smoothing
 */
export interface EdgeHistory {
  margins: number[];      // last 5 edge margins
  confidences: number[];  // last 5 confidences
  leans: ('OVER' | 'UNDER')[]; // last 5 leans
  timestamps: number[];
}

/**
 * Minutes projection result
 */
export interface MinutesProjection {
  remaining: number;
  riskFlags: string[];
  blowoutPenalty: number;
  foulPenalty: number;
}

/**
 * Projection configuration (baseline rates)
 */
export interface ProjectionConfig {
  roleBaselines: Record<PlayerRole, RatePerMinute>;
  blowoutThresholds: {
    q4Large: number;   // 15 pts
    q4Extreme: number; // 20 pts
    q3Medium: number;  // 20 pts
  };
  foulPenalties: Record<number, number>; // fouls -> penalty multiplier
  confidenceWeights: {
    edgeMarginMultiplier: number;
    onCourtBonus: number;
    offCourtPenalty: number;
    foulTroublePenalty: number;
    fatiguePenalty: number;
    blowoutPenalty: number;
  };
}

// ===== PLAYER STATE DELTA (for Edge/Worker split) =====

export interface PlayerStateDelta {
  player: string;
  jersey?: string;
  deltas: {
    fatigueScore?: number;
    effortScore?: number;
    speedIndex?: number;
    reboundPositionScore?: number;
    fatigueSlope?: number;
  };
  signals?: VisionSignal[];
  confidence: ConfidenceLevel;
  timestamp: string;
}

// ===== TEAM-LEVEL BETTING TYPES =====

export type TeamBetType = 'MONEYLINE' | 'TOTAL' | 'SPREAD';

/**
 * Team Live State - Aggregated from individual player states
 */
export interface TeamLiveState {
  teamAbbrev: string;
  teamName: string;
  isHome: boolean;
  currentScore: number;
  
  // Aggregated from rostered players (on-court weighted)
  avgTeamFatigue: number;        // 0-100 (average of on-court players)
  avgTeamEffort: number;         // 0-100
  teamSpeedIndex: number;        // Aggregate transition speed
  
  // Live efficiency metrics
  livePace: number;              // Current possessions per 48
  offensiveRating: number;       // Points per 100 possessions
  fgPct: number;                 // Current FG%
  threePtPct: number;            // Current 3P%
  
  // Game script signals
  momentumScore: number;         // -100 to +100 (negative = opponent momentum)
  runDetected: boolean;          // 8+ point run in last 3 minutes
  closeGameFlag: boolean;        // Margin <= 5 in Q4
  
  // Enhanced momentum tracking
  runInProgress?: boolean;       // Currently on a scoring run
  runPoints?: number;            // Points in current unanswered run
  runPossessions?: number;       // Consecutive possessions with scoring
  hotPlayers?: string[];         // Players with 3+ recent scores
  coldPlayers?: string[];        // Players with recent turnovers/misses
  swingDetected?: boolean;       // 8+ point swing in last 2 minutes
}

/**
 * Game Bet Edge - Predictions for game-level bets (Total, Moneyline, Spread)
 */
export interface GameBetEdge {
  betType: TeamBetType;
  lean: 'HOME' | 'AWAY' | 'OVER' | 'UNDER';
  confidence: number;            // 0-100
  
  // For Moneyline
  projectedWinner?: 'HOME' | 'AWAY';
  winProbability?: number;       // 0-1
  
  // For Totals
  projectedTotal?: number;       // Expected combined final score
  vegasLine?: number;            // Bookmaker's total line
  edgeAmount?: number;           // Projected - Vegas
  
  // For Spread
  projectedMargin?: number;      // Expected point differential
  spreadLine?: number;           // Bookmaker spread
  
  // Drivers (why we predict this)
  drivers: string[];
  riskFlags: string[];
  gameTime: string;
  
  // Bookmaker data
  homeOdds?: number;
  awayOdds?: number;
  overOdds?: number;
  underOdds?: number;
}
