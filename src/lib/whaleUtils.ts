// Whale Proxy Utilities - SharpScore calculation + mock data generation

export type Sport = 'NBA' | 'WNBA' | 'MLB' | 'NHL' | 'TENNIS';
export type SignalType = 'STEAM' | 'DIVERGENCE' | 'FREEZE';
export type Confidence = 'A' | 'B' | 'C';

export interface WhalePick {
  id: string;
  marketKey: string;
  playerName: string;
  matchup: string;
  sport: Sport;
  statType: string;
  period: string;
  pickSide: 'OVER' | 'UNDER';
  ppLine: number;
  confidence: Confidence;
  sharpScore: number;
  signalType: SignalType;
  whyShort: string[];
  startTime: Date;
  createdAt: Date;
  expiresAt: Date;
  isExpired: boolean;
}

export interface SharpScoreInput {
  ppLine: number;
  consensusLine: number;
  ppLinePrevious?: number;
  minutesSinceLastChange: number;
  booksFollowedDirection: boolean;
  wasFrozen: boolean;
  wasRelisted: boolean;
}

export interface SharpScoreResult {
  total: number;
  divergence: number;
  moveSpeed: number;
  confirmation: number;
  boardBehavior: number;
}

export function calculateSharpScore(input: SharpScoreInput): SharpScoreResult {
  // DivergenceScore (0-40): normalized |pp_line - consensus|
  const lineDiff = Math.abs(input.ppLine - input.consensusLine);
  const divergence = Math.min(40, lineDiff * 8);

  // MoveSpeedScore (0-25): how fast did PP line change
  const delta = input.ppLinePrevious 
    ? Math.abs(input.ppLine - input.ppLinePrevious) 
    : 0;
  const moveSpeed = Math.min(25, (delta / Math.max(1, input.minutesSinceLastChange)) * 10);

  // ConfirmationScore (0-20): books follow direction
  const confirmation = input.booksFollowedDirection ? 20 : 0;

  // BoardBehaviorScore (0-15): freeze/relist detection
  const boardBehavior = (input.wasFrozen ? 10 : 0) + (input.wasRelisted ? 5 : 0);

  return {
    total: Math.round(divergence + moveSpeed + confirmation + boardBehavior),
    divergence: Math.round(divergence),
    moveSpeed: Math.round(moveSpeed),
    confirmation: Math.round(confirmation),
    boardBehavior: Math.round(boardBehavior)
  };
}

export function getConfidenceGrade(sharpScore: number): Confidence | null {
  if (sharpScore >= 80) return 'A';
  if (sharpScore >= 65) return 'B';
  if (sharpScore >= 55) return 'C';
  return null;
}

// Mock data for simulation
const MOCK_PLAYERS: Record<Sport, string[]> = {
  NBA: ['LeBron James', 'Jayson Tatum', 'Luka Doncic', 'Nikola Jokic', 'Stephen Curry', 'Kevin Durant', 'Giannis Antetokounmpo', 'Anthony Edwards'],
  WNBA: ['A\'ja Wilson', 'Breanna Stewart', 'Caitlin Clark', 'Sabrina Ionescu', 'Napheesa Collier'],
  MLB: ['Shohei Ohtani', 'Aaron Judge', 'Mookie Betts', 'Ronald Acuna Jr.', 'Gerrit Cole', 'Max Scherzer'],
  NHL: ['Connor McDavid', 'Nathan MacKinnon', 'Auston Matthews', 'Leon Draisaitl', 'Cale Makar'],
  TENNIS: ['Novak Djokovic', 'Carlos Alcaraz', 'Iga Swiatek', 'Jannik Sinner', 'Aryna Sabalenka']
};

const STAT_TYPES: Record<Sport, string[]> = {
  NBA: ['points', 'rebounds', 'assists', 'threes', 'pts+reb+ast'],
  WNBA: ['points', 'rebounds', 'assists'],
  MLB: ['strikeouts', 'hits_allowed', 'total_bases', 'walks'],
  NHL: ['shots_on_goal', 'points', 'saves', 'goals'],
  TENNIS: ['aces', 'games_won', 'sets_won', 'double_faults']
};

const MATCHUPS: Record<Sport, string[]> = {
  NBA: ['LAL vs BOS', 'GSW vs MIA', 'PHX vs MIL', 'DEN vs CLE', 'DAL vs NYK'],
  WNBA: ['LVA vs NYL', 'SEA vs CHI', 'MIN vs PHO', 'CON vs IND'],
  MLB: ['LAD vs NYY', 'HOU vs ATL', 'PHI vs SD', 'TEX vs ARI'],
  NHL: ['EDM vs TOR', 'COL vs BOS', 'VGK vs NYR', 'DAL vs FLA'],
  TENNIS: ['Djokovic vs Alcaraz', 'Sinner vs Medvedev', 'Swiatek vs Sabalenka']
};

const WHY_REASONS: Record<SignalType, string[]> = {
  STEAM: [
    'PP line moved 1.5 pts in 3 min',
    'Books followed within 8 min',
    'Sharp money detected on consensus',
    'Volume spike at line move',
    'Pro bettor pattern identified'
  ],
  DIVERGENCE: [
    'PP 2.5 pts off book consensus',
    'Line gap widening for 15+ min',
    'PP stale while books adjust',
    'Market inefficiency detected',
    '3+ books disagree with PP line'
  ],
  FREEZE: [
    'Prop frozen after line spike',
    'Removed from board temporarily',
    'Sharp action triggered hold',
    'Line pulled for recalibration',
    'Suspicious activity pause'
  ]
};

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateMockPick(existingIds: Set<string>): WhalePick {
  const sport = randomChoice<Sport>(['NBA', 'WNBA', 'MLB', 'NHL', 'TENNIS']);
  const player = randomChoice(MOCK_PLAYERS[sport]);
  const statType = randomChoice(STAT_TYPES[sport]);
  const matchup = randomChoice(MATCHUPS[sport]);
  const signalType = randomChoice<SignalType>(['STEAM', 'DIVERGENCE', 'FREEZE']);
  
  // Generate sharp score between 55-95
  const sharpScore = 55 + Math.floor(Math.random() * 40);
  const confidence = getConfidenceGrade(sharpScore) || 'C';
  
  // Generate line based on stat type
  let ppLine: number;
  switch (statType) {
    case 'points':
      ppLine = 15 + Math.floor(Math.random() * 25);
      break;
    case 'rebounds':
      ppLine = 4 + Math.floor(Math.random() * 10);
      break;
    case 'assists':
      ppLine = 3 + Math.floor(Math.random() * 8);
      break;
    case 'threes':
      ppLine = 1.5 + Math.floor(Math.random() * 5);
      break;
    case 'strikeouts':
      ppLine = 4 + Math.floor(Math.random() * 6);
      break;
    case 'aces':
      ppLine = 3 + Math.floor(Math.random() * 8);
      break;
    default:
      ppLine = 5 + Math.floor(Math.random() * 15);
  }
  
  const now = new Date();
  const startTime = new Date(now.getTime() + (30 + Math.random() * 180) * 60 * 1000); // 30min to 3.5hrs from now
  const expiresAt = new Date(Math.min(
    startTime.getTime() - 5 * 60 * 1000, // 5 min before start
    now.getTime() + 45 * 60 * 1000 // or 45 min from now
  ));
  
  // Get 1-2 why reasons
  const reasons = WHY_REASONS[signalType];
  const numReasons = 1 + Math.floor(Math.random() * 2);
  const whyShort = Array.from({ length: numReasons }, () => randomChoice(reasons));
  
  const marketKey = `${sport}_${player.replace(/\s/g, '_')}_${statType}_${Date.now()}`;
  
  // Ensure unique ID
  let id = `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  while (existingIds.has(id)) {
    id = `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  return {
    id,
    marketKey,
    playerName: player,
    matchup,
    sport,
    statType,
    period: 'FULL_GAME',
    pickSide: Math.random() > 0.5 ? 'OVER' : 'UNDER',
    ppLine,
    confidence,
    sharpScore,
    signalType,
    whyShort,
    startTime,
    createdAt: now,
    expiresAt,
    isExpired: false
  };
}

export function generateInitialMockPicks(count: number = 8): WhalePick[] {
  const picks: WhalePick[] = [];
  const existingIds = new Set<string>();
  
  for (let i = 0; i < count; i++) {
    const pick = generateMockPick(existingIds);
    existingIds.add(pick.id);
    picks.push(pick);
  }
  
  return picks.sort((a, b) => b.sharpScore - a.sharpScore);
}

export function generateNewMockPick(existingPicks: WhalePick[]): WhalePick {
  const existingIds = new Set(existingPicks.map(p => p.id));
  return generateMockPick(existingIds);
}

export function filterByConfidence(picks: WhalePick[], filter: 'A' | 'A+B' | 'ALL'): WhalePick[] {
  switch (filter) {
    case 'A':
      return picks.filter(p => p.confidence === 'A');
    case 'A+B':
      return picks.filter(p => p.confidence === 'A' || p.confidence === 'B');
    case 'ALL':
    default:
      return picks;
  }
}

export function filterBySport(picks: WhalePick[], sport: Sport | 'ALL'): WhalePick[] {
  if (sport === 'ALL') return picks;
  return picks.filter(p => p.sport === sport);
}

export function getLivePicks(picks: WhalePick[]): WhalePick[] {
  const now = new Date();
  return picks
    .filter(p => !p.isExpired && p.startTime > now && (p.confidence === 'A' || p.confidence === 'B'))
    .sort((a, b) => b.sharpScore - a.sharpScore);
}

export function getWatchlistPicks(picks: WhalePick[]): WhalePick[] {
  const now = new Date();
  return picks
    .filter(p => !p.isExpired && p.startTime > now && p.confidence === 'C')
    .sort((a, b) => b.sharpScore - a.sharpScore);
}

export function formatTimeUntil(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  
  if (diffMs <= 0) return 'Started';
  
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHrs = Math.floor(diffMins / 60);
  const remainingMins = diffMins % 60;
  
  if (diffHrs > 0) {
    return `${diffHrs}h ${remainingMins}m`;
  }
  return `${diffMins}m`;
}

export function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  
  if (diffMs < 0) return 'just now';
  
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  
  if (diffSecs < 60) {
    return `${diffSecs}s ago`;
  }
  return `${diffMins}m ago`;
}
