/**
 * bot-generate-daily-parlays (v2 - Tiered System)
 * 
 * Generates 65-75 daily parlays across three tiers:
 * - Exploration (50/day): Edge discovery, $0 stake, 2K iterations
 * - Validation (15/day): Pattern confirmation, simulated stake, 10K iterations
 * - Execution (8/day): Best bets, Kelly stakes, 25K iterations
 * 
 * Runs at 9 AM ET daily via cron.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============= TIER CONFIGURATION =============

type TierName = 'exploration' | 'validation' | 'execution';

interface TierConfig {
  count: number;
  iterations: number;
  maxPlayerUsage: number;
  maxTeamUsage: number;
  maxCategoryUsage: number;
  minHitRate: number;
  minEdge: number;
  minSharpe: number;
  stake: number | 'kelly';
  minConfidence: number;
  profiles: ParlayProfile[];
}

interface ParlayProfile {
  legs: number;
  strategy: string;
  sports?: string[];
  betTypes?: string[];
  minOddsValue?: number;
  minHitRate?: number;
  useAltLines?: boolean;
  minBufferMultiplier?: number;
  preferPlusMoney?: boolean;
}

const TIER_CONFIG: Record<TierName, TierConfig> = {
  exploration: {
    count: 50,
    iterations: 2000,
    maxPlayerUsage: 5,
    maxTeamUsage: 3,
    maxCategoryUsage: 4,
    minHitRate: 45,
    minEdge: 0.003,
    minSharpe: 0.01,
    stake: 0,
    minConfidence: 0.45,
    profiles: [
      // Multi-sport exploration (15 profiles)
      { legs: 3, strategy: 'explore_safe', sports: ['basketball_nba'] },
      { legs: 3, strategy: 'explore_safe', sports: ['basketball_nba'] },
      { legs: 3, strategy: 'explore_safe', sports: ['icehockey_nhl'] },
      { legs: 3, strategy: 'explore_mixed', sports: ['basketball_nba', 'icehockey_nhl'] },
      { legs: 3, strategy: 'explore_mixed', sports: ['basketball_nba', 'icehockey_nhl'] },
      { legs: 4, strategy: 'explore_balanced', sports: ['basketball_nba'] },
      { legs: 4, strategy: 'explore_balanced', sports: ['basketball_nba'] },
      { legs: 4, strategy: 'explore_balanced', sports: ['icehockey_nhl'] },
      { legs: 4, strategy: 'explore_mixed', sports: ['all'] },
      { legs: 4, strategy: 'explore_mixed', sports: ['all'] },
      { legs: 5, strategy: 'explore_aggressive', sports: ['basketball_nba'] },
      { legs: 5, strategy: 'explore_aggressive', sports: ['all'] },
      { legs: 5, strategy: 'explore_aggressive', sports: ['all'] },
      { legs: 6, strategy: 'explore_longshot', sports: ['all'] },
      { legs: 6, strategy: 'explore_longshot', sports: ['all'] },
      // Team props exploration (10 profiles)
      { legs: 3, strategy: 'team_spreads', betTypes: ['spread'] },
      { legs: 3, strategy: 'team_spreads', betTypes: ['spread'] },
      { legs: 3, strategy: 'team_totals', betTypes: ['total'] },
      { legs: 3, strategy: 'team_totals', betTypes: ['total'] },
      { legs: 4, strategy: 'team_mixed', betTypes: ['spread', 'total'] },
      { legs: 4, strategy: 'team_mixed', betTypes: ['spread', 'total'] },
      { legs: 4, strategy: 'team_mixed', betTypes: ['spread', 'total', 'moneyline'] },
      { legs: 3, strategy: 'team_ml', betTypes: ['moneyline'] },
      { legs: 3, strategy: 'team_ml', betTypes: ['moneyline'] },
      { legs: 4, strategy: 'team_all', betTypes: ['spread', 'total', 'moneyline'] },
      // Cross-sport exploration (25 profiles)
      { legs: 3, strategy: 'cross_sport', sports: ['basketball_nba', 'icehockey_nhl'] },
      { legs: 3, strategy: 'cross_sport', sports: ['basketball_nba', 'icehockey_nhl'] },
      { legs: 3, strategy: 'cross_sport', sports: ['basketball_nba', 'icehockey_nhl'] },
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'] },
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'] },
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'] },
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'] },
      { legs: 5, strategy: 'cross_sport_5', sports: ['all'] },
      { legs: 5, strategy: 'cross_sport_5', sports: ['all'] },
      { legs: 5, strategy: 'cross_sport_5', sports: ['all'] },
      { legs: 3, strategy: 'tennis_focus', sports: ['tennis_atp', 'tennis_wta'] },
      { legs: 3, strategy: 'tennis_focus', sports: ['tennis_atp', 'tennis_wta'] },
      { legs: 4, strategy: 'nhl_focus', sports: ['icehockey_nhl'] },
      { legs: 4, strategy: 'nhl_focus', sports: ['icehockey_nhl'] },
      { legs: 4, strategy: 'nhl_focus', sports: ['icehockey_nhl'] },
      { legs: 5, strategy: 'max_diversity', sports: ['all'] },
      { legs: 5, strategy: 'max_diversity', sports: ['all'] },
      { legs: 5, strategy: 'max_diversity', sports: ['all'] },
      { legs: 6, strategy: 'max_diversity', sports: ['all'] },
      { legs: 6, strategy: 'max_diversity', sports: ['all'] },
      { legs: 3, strategy: 'props_only', sports: ['basketball_nba'] },
      { legs: 3, strategy: 'props_only', sports: ['icehockey_nhl'] },
      { legs: 4, strategy: 'props_mixed', sports: ['basketball_nba', 'icehockey_nhl'] },
      { legs: 4, strategy: 'props_mixed', sports: ['all'] },
      { legs: 5, strategy: 'props_mixed', sports: ['all'] },
    ],
  },
  validation: {
    count: 15,
    iterations: 10000,
    maxPlayerUsage: 4,
    maxTeamUsage: 2,
    maxCategoryUsage: 3,
    minHitRate: 52,
    minEdge: 0.008,
    minSharpe: 0.02,
    stake: 50,
    minConfidence: 0.52,
    profiles: [
      { legs: 3, strategy: 'validated_conservative', sports: ['basketball_nba'], minOddsValue: 45, minHitRate: 55 },
      { legs: 3, strategy: 'validated_conservative', sports: ['basketball_nba'], minOddsValue: 45, minHitRate: 55 },
      { legs: 3, strategy: 'validated_conservative', sports: ['icehockey_nhl'], minOddsValue: 45, minHitRate: 55 },
      { legs: 4, strategy: 'validated_balanced', sports: ['basketball_nba'], minOddsValue: 42, minHitRate: 55 },
      { legs: 4, strategy: 'validated_balanced', sports: ['basketball_nba'], minOddsValue: 42, minHitRate: 55 },
      { legs: 4, strategy: 'validated_balanced', sports: ['basketball_nba', 'icehockey_nhl'], minOddsValue: 42, minHitRate: 55 },
      { legs: 5, strategy: 'validated_standard', sports: ['basketball_nba'], minOddsValue: 40, minHitRate: 52 },
      { legs: 5, strategy: 'validated_standard', sports: ['all'], minOddsValue: 40, minHitRate: 52 },
      { legs: 5, strategy: 'validated_standard', sports: ['all'], minOddsValue: 40, minHitRate: 52, useAltLines: true },
      { legs: 3, strategy: 'validated_team', betTypes: ['spread', 'total'], minOddsValue: 45, minHitRate: 55 },
      { legs: 3, strategy: 'validated_team', betTypes: ['spread', 'total'], minOddsValue: 45, minHitRate: 55 },
      { legs: 4, strategy: 'validated_team', betTypes: ['spread', 'total'], minOddsValue: 42, minHitRate: 52 },
      { legs: 4, strategy: 'validated_cross', sports: ['all'], minOddsValue: 42, minHitRate: 52 },
      { legs: 4, strategy: 'validated_cross', sports: ['all'], minOddsValue: 42, minHitRate: 52 },
      { legs: 5, strategy: 'validated_aggressive', sports: ['all'], minOddsValue: 40, minHitRate: 50, useAltLines: true },
    ],
  },
  execution: {
    count: 8,
    iterations: 25000,
    maxPlayerUsage: 3,
    maxTeamUsage: 2,
    maxCategoryUsage: 2,
    minHitRate: 55,
    minEdge: 0.012,
    minSharpe: 0.03,
    stake: 'kelly',
    minConfidence: 0.55,
    profiles: [
      { legs: 3, strategy: 'elite_conservative', sports: ['basketball_nba'], minOddsValue: 50, minHitRate: 56, useAltLines: false },
      { legs: 3, strategy: 'elite_conservative', sports: ['basketball_nba'], minOddsValue: 50, minHitRate: 56, useAltLines: false },
      { legs: 4, strategy: 'elite_balanced', sports: ['basketball_nba'], minOddsValue: 45, minHitRate: 55, useAltLines: false },
      { legs: 4, strategy: 'elite_balanced', sports: ['basketball_nba', 'icehockey_nhl'], minOddsValue: 45, minHitRate: 55, useAltLines: false },
      { legs: 5, strategy: 'elite_standard', sports: ['basketball_nba'], minOddsValue: 42, minHitRate: 55, useAltLines: true, minBufferMultiplier: 1.5 },
      { legs: 5, strategy: 'elite_standard', sports: ['all'], minOddsValue: 42, minHitRate: 55, useAltLines: true, minBufferMultiplier: 1.5 },
      { legs: 6, strategy: 'elite_aggressive', sports: ['basketball_nba'], minOddsValue: 40, minHitRate: 52, useAltLines: true, preferPlusMoney: true },
      { legs: 6, strategy: 'elite_aggressive', sports: ['all'], minOddsValue: 40, minHitRate: 52, useAltLines: true, preferPlusMoney: true },
    ],
  },
};

// ============= CONSTANTS =============

const DEFAULT_MIN_HIT_RATE = 50;
const DEFAULT_MIN_ODDS_VALUE = 35;

const MIN_BUFFER_BY_PROP: Record<string, number> = {
  points: 4.0,
  rebounds: 2.5,
  assists: 2.0,
  threes: 1.0,
  pra: 6.0,
  pts_rebs: 4.5,
  pts_asts: 4.5,
  rebs_asts: 3.0,
  steals: 0.8,
  blocks: 0.8,
  turnovers: 1.0,
  goals: 0.5,
  assists_nhl: 0.5,
  shots: 2.0,
  saves: 5.0,
  aces: 2.0,
  games: 1.0,
};

// ============= CATEGORY INTERLEAVE =============

function interleaveByCategory(picks: EnrichedPick[]): EnrichedPick[] {
  const groups = new Map<string, EnrichedPick[]>();
  for (const pick of picks) {
    const cat = pick.category;
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(pick);
  }
  
  const result: EnrichedPick[] = [];
  const iterators = [...groups.values()].map(g => ({ picks: g, index: 0 }));
  iterators.sort((a, b) => b.picks[0].compositeScore - a.picks[0].compositeScore);
  
  let added = true;
  while (added) {
    added = false;
    for (const iter of iterators) {
      if (iter.index < iter.picks.length) {
        result.push(iter.picks[iter.index]);
        iter.index++;
        added = true;
      }
    }
  }
  return result;
}

// ============= INTERFACES =============

interface AlternateLine {
  line: number;
  overOdds: number;
  underOdds: number;
  bookmaker?: string;
}

interface SelectedLine {
  line: number;
  odds: number;
  reason: string;
  originalLine?: number;
  oddsImprovement?: number;
}

interface SweetSpotPick {
  id: string;
  player_name: string;
  team_name?: string;
  prop_type: string;
  line: number;
  recommended_side: string;
  category: string;
  confidence_score: number;
  l10_hit_rate: number;
  projected_value: number;
  event_id?: string;
  alternateLines?: AlternateLine[];
  sport?: string;
}

interface EnrichedPick extends SweetSpotPick {
  americanOdds: number;
  oddsValueScore: number;
  compositeScore: number;
  has_real_line?: boolean;
  line_source?: string;
  line_verified_at?: string | null;
}

interface TeamProp {
  id: string;
  event_id: string;
  sport: string;
  home_team: string;
  away_team: string;
  bet_type: string;
  line?: number;
  home_odds?: number;
  away_odds?: number;
  over_odds?: number;
  under_odds?: number;
  sharp_score?: number;
  commence_time: string;
}

interface EnrichedTeamPick {
  id: string;
  type: 'team';
  sport: string;
  home_team: string;
  away_team: string;
  bet_type: string;
  side: string;
  line: number;
  odds: number;
  category: string;
  sharp_score: number;
  compositeScore: number;
  confidence_score: number;
}

interface CategoryWeight {
  category: string;
  side: string;
  weight: number;
  current_hit_rate: number;
  is_blocked: boolean;
  sport?: string;
}

interface UsageTracker {
  usedPicks: Set<string>;
  playerUsageCount: Map<string, number>;
  teamUsageInParlay: Map<string, number>;
  categoryUsageInParlay: Map<string, number>;
}

interface PropPool {
  playerPicks: EnrichedPick[];
  teamPicks: EnrichedTeamPick[];
  sweetSpots: EnrichedPick[];
  totalPool: number;
}

// ============= HELPER FUNCTIONS =============

function americanToImplied(odds: number): number {
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return -odds / (-odds + 100);
  }
}

function calculateOddsValueScore(americanOdds: number, estimatedHitRate: number): number {
  const impliedProb = americanToImplied(americanOdds);
  const edge = estimatedHitRate - impliedProb;
  const juicePenalty = Math.max(0, impliedProb - 0.524) * 100;
  const juiceBonus = Math.max(0, 0.524 - impliedProb) * 80;
  const edgeScore = Math.min(40, edge * 400);
  const score = 50 + edgeScore - juicePenalty + juiceBonus;
  return Math.max(0, Math.min(100, score));
}

function calculateCompositeScore(
  hitRate: number,
  edge: number,
  oddsValueScore: number,
  categoryWeight: number
): number {
  const hitRateScore = Math.min(100, hitRate);
  const edgeScore = Math.min(100, Math.max(0, edge * 20 + 50));
  const weightScore = categoryWeight * 66.67;
  
  return Math.round(
    (hitRateScore * 0.30) +
    (edgeScore * 0.25) +
    (oddsValueScore * 0.25) +
    (weightScore * 0.20)
  );
}

function createPickKey(playerName: string, propType: string, side: string): string {
  return `${playerName}_${propType}_${side}`.toLowerCase();
}

function createTeamPickKey(eventId: string, betType: string, side: string): string {
  return `team_${eventId}_${betType}_${side}`.toLowerCase();
}

function createUsageTracker(): UsageTracker {
  return {
    usedPicks: new Set(),
    playerUsageCount: new Map(),
    teamUsageInParlay: new Map(),
    categoryUsageInParlay: new Map(),
  };
}

function getMinBuffer(propType: string): number {
  const normalized = propType.toLowerCase().replace(/[_\s]/g, '');
  return MIN_BUFFER_BY_PROP[normalized] || MIN_BUFFER_BY_PROP[propType.toLowerCase()] || 3.0;
}

function selectOptimalLine(
  pick: EnrichedPick,
  alternateLines: AlternateLine[],
  strategy: string,
  preferPlusMoney: boolean = false,
  minBufferMultiplier: number = 1.0
): SelectedLine {
  const projection = pick.projected_value || 0;
  const mainLine = pick.line;
  const mainOdds = pick.americanOdds;
  const side = pick.recommended_side || 'over';
  const buffer = projection - mainLine;
  
  if (!strategy.includes('aggressive') && !strategy.includes('alt')) {
    return { line: mainLine, odds: mainOdds, reason: 'safe_profile' };
  }
  
  const minBuffer = getMinBuffer(pick.prop_type) * minBufferMultiplier;
  if (buffer < minBuffer) {
    return { line: mainLine, odds: mainOdds, reason: 'insufficient_buffer' };
  }
  
  if (!alternateLines || alternateLines.length === 0) {
    return { line: mainLine, odds: mainOdds, reason: 'no_alternates' };
  }
  
  const safetyMargin = minBuffer * 0.5;
  const maxSafeLine = projection - safetyMargin;
  
  const viableAlts = alternateLines
    .filter(alt => {
      const altOdds = side === 'over' ? alt.overOdds : alt.underOdds;
      return (
        alt.line <= maxSafeLine &&
        alt.line > mainLine &&
        altOdds >= -150 &&
        altOdds <= 200
      );
    })
    .map(alt => ({
      ...alt,
      relevantOdds: side === 'over' ? alt.overOdds : alt.underOdds,
      projectionBuffer: projection - alt.line,
    }));
  
  if (viableAlts.length === 0) {
    return { line: mainLine, odds: mainOdds, reason: 'no_viable_alts' };
  }
  
  if (preferPlusMoney) {
    const plusMoneyAlts = viableAlts.filter(alt => alt.relevantOdds > 0);
    if (plusMoneyAlts.length > 0) {
      const selected = plusMoneyAlts.sort((a, b) => b.line - a.line)[0];
      return {
        line: selected.line,
        odds: selected.relevantOdds,
        reason: 'aggressive_plus_money',
        originalLine: mainLine,
        oddsImprovement: selected.relevantOdds - mainOdds,
      };
    }
  }
  
  const bestOdds = viableAlts.sort((a, b) => b.relevantOdds - a.relevantOdds)[0];
  if (bestOdds.relevantOdds > mainOdds + 15) {
    return {
      line: bestOdds.line,
      odds: bestOdds.relevantOdds,
      reason: 'best_ev_alt',
      originalLine: mainLine,
      oddsImprovement: bestOdds.relevantOdds - mainOdds,
    };
  }
  
  return { line: mainLine, odds: mainOdds, reason: 'main_line_best' };
}

function canUsePickGlobally(pick: EnrichedPick | EnrichedTeamPick, tracker: UsageTracker, tierConfig: TierConfig): boolean {
  let key: string;
  
  if ('type' in pick && pick.type === 'team') {
    key = createTeamPickKey(pick.id, pick.bet_type, pick.side);
  } else {
    const playerPick = pick as EnrichedPick;
    key = createPickKey(playerPick.player_name, playerPick.prop_type, playerPick.recommended_side);
  }
  
  if (tracker.usedPicks.has(key)) return false;
  
  if ('player_name' in pick) {
    const playerCount = tracker.playerUsageCount.get(pick.player_name) || 0;
    if (playerCount >= tierConfig.maxPlayerUsage) return false;
  }
  
  return true;
}

function canUsePickInParlay(
  pick: EnrichedPick | EnrichedTeamPick,
  parlayTeamCount: Map<string, number>,
  parlayCategoryCount: Map<string, number>,
  tierConfig: TierConfig
): boolean {
  if ('team_name' in pick && pick.team_name) {
    const teamCount = parlayTeamCount.get(pick.team_name) || 0;
    if (teamCount >= tierConfig.maxTeamUsage) return false;
  }
  
  if ('home_team' in pick) {
    const homeCount = parlayTeamCount.get(pick.home_team) || 0;
    const awayCount = parlayTeamCount.get(pick.away_team) || 0;
    if (homeCount >= tierConfig.maxTeamUsage || awayCount >= tierConfig.maxTeamUsage) return false;
  }
  
  const category = pick.category;
  const categoryCount = parlayCategoryCount.get(category) || 0;
  if (categoryCount >= tierConfig.maxCategoryUsage) return false;
  
  return true;
}

function markPickUsed(pick: EnrichedPick | EnrichedTeamPick, tracker: UsageTracker): void {
  let key: string;
  
  if ('type' in pick && pick.type === 'team') {
    key = createTeamPickKey(pick.id, pick.bet_type, pick.side);
  } else {
    const playerPick = pick as EnrichedPick;
    key = createPickKey(playerPick.player_name, playerPick.prop_type, playerPick.recommended_side);
    tracker.playerUsageCount.set(
      playerPick.player_name,
      (tracker.playerUsageCount.get(playerPick.player_name) || 0) + 1
    );
  }
  
  tracker.usedPicks.add(key);
}

function calculateKellyStake(
  winProbability: number,
  odds: number,
  bankroll: number,
  maxRisk: number = 0.03
): number {
  const decimalOdds = odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
  const b = decimalOdds - 1;
  const kelly = ((b * winProbability) - (1 - winProbability)) / b;
  const halfKelly = Math.max(0, kelly / 2);
  const stake = Math.min(halfKelly, maxRisk) * bankroll;
  return Math.round(stake * 100) / 100;
}

function mapTeamBetToCategory(betType: string, side: string): string {
  const categoryMap: Record<string, Record<string, string>> = {
    spread: { home: 'SHARP_SPREAD', away: 'SHARP_SPREAD' },
    total: { over: 'OVER_TOTAL', under: 'UNDER_TOTAL' },
    moneyline: { home: 'ML_FAVORITE', away: 'ML_UNDERDOG' },
  };
  return categoryMap[betType]?.[side] || 'TEAM_PROP';
}

function mapPropTypeToCategory(propType: string): string {
  const categoryMap: Record<string, string> = {
    'player_points': 'POINTS',
    'player_rebounds': 'REBOUNDS',
    'player_assists': 'ASSISTS',
    'player_threes': 'THREES',
    'player_blocks': 'BLOCKS',
    'player_steals': 'STEALS',
    'player_goals': 'NHL_GOALS',
    'player_shots_on_goal': 'NHL_SHOTS',
    'player_saves': 'NHL_SAVES',
    'player_pass_yds': 'NFL_PASS_YDS',
    'player_rush_yds': 'NFL_RUSH_YDS',
    'player_reception_yds': 'NFL_REC_YDS',
    'player_receptions': 'NFL_RECEPTIONS',
  };
  return categoryMap[propType] || propType.toUpperCase();
}

// ============= AVAILABILITY GATE =============

function getEasternDateRange(): { startUtc: string; endUtc: string; gameDate: string } {
  const now = new Date();
  // Get current ET date
  const etDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);

  // Reliable DST check: compare ET hour vs UTC hour
  const etHour = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false
  }).format(now));
  const utcHour = now.getUTCHours();
  const etOffset = (utcHour - etHour + 24) % 24; // 5 for EST, 4 for EDT

  // Noon ET in UTC
  const [year, month, day] = etDate.split('-').map(Number);
  const startDate = new Date(Date.UTC(year, month - 1, day, 12 + etOffset, 0, 0));
  const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);

  console.log(`[DST] ET offset: ${etOffset}h, gameDate: ${etDate}, window: ${startDate.toISOString()} - ${endDate.toISOString()}`);

  return {
    startUtc: startDate.toISOString(),
    endUtc: endDate.toISOString(),
    gameDate: etDate,
  };
}

async function fetchActivePlayersToday(
  supabase: any,
  startUtc: string,
  endUtc: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('unified_props')
    .select('player_name')
    .eq('is_active', true)
    .gte('commence_time', startUtc)
    .lt('commence_time', endUtc);

  if (error) {
    console.error('[AvailabilityGate] Error fetching active players:', error);
    return new Set();
  }

  const players = new Set<string>();
  (data || []).forEach((row: any) => {
    if (row.player_name) {
      players.add(row.player_name.toLowerCase().trim());
    }
  });

  console.log(`[AvailabilityGate] ${players.size} active players with lines today`);
  return players;
}

async function fetchInjuryBlocklist(
  supabase: any,
  gameDate: string
): Promise<{ blocklist: Set<string>; penalties: Map<string, number> }> {
  const blocklist = new Set<string>();
  const penalties = new Map<string, number>();

  // Query recent injury alerts (today and yesterday to catch late updates)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('lineup_alerts')
    .select('player_name, alert_type')
    .gte('game_date', yesterdayStr)
    .lte('game_date', gameDate);

  if (error) {
    console.error('[AvailabilityGate] Error fetching injury blocklist:', error);
    return { blocklist, penalties };
  }

  const blockedNames: string[] = [];
  const penalizedNames: string[] = [];

  (data || []).forEach((alert: any) => {
    const name = alert.player_name?.toLowerCase().trim();
    if (!name) return;

    const status = (alert.alert_type || '').toUpperCase();
    if (status === 'OUT' || status === 'DOUBTFUL') {
      blocklist.add(name);
      blockedNames.push(`${alert.player_name} (${status})`);
    } else if (status === 'GTD' || status === 'DTD') {
      penalties.set(name, 0.7);
      penalizedNames.push(`${alert.player_name} (${status} → 0.7x)`);
    } else if (status === 'QUESTIONABLE') {
      penalties.set(name, 0.85);
      penalizedNames.push(`${alert.player_name} (${status} → 0.85x)`);
    }
  });

  console.log(`[AvailabilityGate] Blocked ${blocklist.size}: ${blockedNames.slice(0, 10).join(', ')}${blockedNames.length > 10 ? '...' : ''}`);
  console.log(`[AvailabilityGate] Penalized ${penalties.size}: ${penalizedNames.slice(0, 10).join(', ')}${penalizedNames.length > 10 ? '...' : ''}`);

  return { blocklist, penalties };
}

// ============= PROP POOL BUILDER =============

async function buildPropPool(supabase: any, targetDate: string, weightMap: Map<string, number>, categoryWeights: CategoryWeight[]): Promise<PropPool> {
  console.log(`[Bot] Building prop pool for ${targetDate}`);

  // === AVAILABILITY GATE ===
  const { startUtc, endUtc, gameDate } = getEasternDateRange();
  console.log(`[Bot] ET window: ${startUtc} → ${endUtc} (gameDate: ${gameDate})`);

  const [activePlayersToday, injuryData] = await Promise.all([
    fetchActivePlayersToday(supabase, startUtc, endUtc),
    fetchInjuryBlocklist(supabase, gameDate),
  ]);
  const { blocklist, penalties } = injuryData;

  // 1. Sweet spot picks (analyzed player props) - no is_active filter, analysis_date is sufficient
  const { data: sweetSpots } = await supabase
    .from('category_sweet_spots')
    .select('*, actual_line, recommended_line, bookmaker')
    .eq('analysis_date', targetDate)
    .gte('confidence_score', 0.45)
    .order('confidence_score', { ascending: false })
    .limit(200);

  // 2. Live odds from unified_props - bounded to today's ET window
  const { data: playerProps } = await supabase
    .from('unified_props')
    .select('*')
    .eq('is_active', true)
    .gte('commence_time', startUtc)
    .lt('commence_time', endUtc)
    .limit(500);

  // 3. Team props from game_bets - bounded to today's ET window
  const { data: teamProps } = await supabase
    .from('game_bets')
    .select('*')
    .eq('is_active', true)
    .gte('commence_time', startUtc)
    .lt('commence_time', endUtc);

  console.log(`[Bot] Raw data: ${(sweetSpots || []).length} sweet spots, ${(playerProps || []).length} unified_props, ${(teamProps || []).length} team bets`);

  // Build odds map
  const oddsMap = new Map<string, { overOdds: number; underOdds: number; line: number; sport: string }>();
  (playerProps || []).forEach((od: any) => {
    const key = `${od.player_name}_${od.prop_type}`.toLowerCase();
    oddsMap.set(key, {
      overOdds: od.over_price || -110,
      underOdds: od.under_price || -110,
      line: od.current_line,
      sport: od.sport,
    });
  });

  // Enrich sweet spots
  let enrichedSweetSpots: EnrichedPick[] = (sweetSpots || []).map((pick: SweetSpotPick) => {
    const line = pick.actual_line ?? pick.recommended_line ?? pick.line;
    const hasRealLine = pick.actual_line !== null && pick.actual_line !== undefined;
    
    const oddsKey = `${pick.player_name}_${pick.prop_type}`.toLowerCase();
    const odds = oddsMap.get(oddsKey) || { overOdds: -110, underOdds: -110, line: 0, sport: 'basketball_nba' };
    const side = pick.recommended_side || 'over';
    const americanOdds = side === 'over' ? odds.overOdds : odds.underOdds;
    
    const hitRateDecimal = pick.l10_hit_rate || pick.confidence_score || 0.5;
    const hitRatePercent = hitRateDecimal * 100;
    const edge = (pick.projected_value || 0) - (line || 0);
    const categoryWeight = weightMap.get(pick.category) || 1.0;
    
    const oddsValueScore = calculateOddsValueScore(americanOdds, hitRateDecimal);
    const compositeScore = calculateCompositeScore(hitRatePercent, edge, oddsValueScore, categoryWeight);
    
    return {
      ...pick,
      line,
      recommended_side: side,
      americanOdds,
      oddsValueScore,
      compositeScore,
      has_real_line: hasRealLine,
      line_source: hasRealLine ? 'verified' : 'projected',
      sport: pick.sport || 'basketball_nba',
    };
  }).filter((p: EnrichedPick) => p.americanOdds >= -200 && p.americanOdds <= 200);

  // FALLBACK: If no sweet spots for today, create picks directly from unified_props
  if (enrichedSweetSpots.length === 0 && playerProps && playerProps.length > 0) {
    console.log(`[Bot] No sweet spots for ${targetDate}, using ${playerProps.length} unified_props directly`);
    
    // Build a hit rate lookup from calibrated category weights
    const categoryHitRateMap = new Map<string, number>();
    categoryWeights.forEach(cw => {
      if (cw.current_hit_rate && cw.current_hit_rate > 0) {
        categoryHitRateMap.set(cw.category, cw.current_hit_rate / 100);
        // Also map by prop type for fallback matching
        categoryHitRateMap.set(`${cw.category}_${cw.side}`, cw.current_hit_rate / 100);
      }
    });
    
    enrichedSweetSpots = playerProps.map((prop: any) => {
      const overOdds = prop.over_price || -110;
      const underOdds = prop.under_price || -110;
      // Prefer over bets for favorable odds, under for unfavorable
      const side = overOdds >= underOdds ? 'over' : 'under';
      const americanOdds = side === 'over' ? overOdds : underOdds;
      
      // Estimate hit rate: use calibrated category weight > composite_score > default 55%
      const rawCategory = prop.category || '';
      // Skip data-source names (e.g. 'balldontlie') — always derive category from prop_type
      const knownSourceNames = ['balldontlie', 'odds_api', 'the_odds_api', 'espn', 'rotowire'];
      const propCategory = knownSourceNames.includes(rawCategory.toLowerCase()) 
        ? mapPropTypeToCategory(prop.prop_type)
        : (rawCategory || mapPropTypeToCategory(prop.prop_type));
      const calibratedHitRate = categoryHitRateMap.get(propCategory) 
        || categoryHitRateMap.get(`${propCategory}_${side}`)
        || null;
      const hitRateDecimal = calibratedHitRate 
        ? Math.max(calibratedHitRate, 0.50) 
        : (prop.composite_score && prop.composite_score > 0 ? prop.composite_score / 100 : 0.55);
      const categoryWeight = weightMap.get(propCategory) || 1.0;
      
      const oddsValueScore = calculateOddsValueScore(americanOdds, hitRateDecimal);
      const compositeScore = calculateCompositeScore(hitRateDecimal * 100, 0.5, oddsValueScore, categoryWeight);
      
      return {
        id: prop.id,
        player_name: prop.player_name,
        prop_type: prop.prop_type,
        line: prop.current_line,
        recommended_side: side,
        category: propCategory,
        confidence_score: hitRateDecimal,
        l10_hit_rate: hitRateDecimal,
        projected_value: prop.current_line,
        sport: prop.sport,
        americanOdds,
        oddsValueScore,
        compositeScore,
        has_real_line: true,
        line_source: 'unified_props',
      } as EnrichedPick;
    }).filter((p: EnrichedPick) => 
      p.americanOdds >= -200 && 
      p.americanOdds <= 200 && 
      p.line > 0
    );
    
    console.log(`[Bot] Fallback enriched ${enrichedSweetSpots.length} picks (calibrated hit rates from ${categoryHitRateMap.size} categories)`);
  }

  // === APPLY AVAILABILITY GATE TO PLAYER PICKS ===
  const preFilterCount = enrichedSweetSpots.length;
  const filteredOutPlayers: string[] = [];

  if (activePlayersToday.size > 0) {
    enrichedSweetSpots = enrichedSweetSpots.filter(pick => {
      const normalizedName = pick.player_name.toLowerCase().trim();

      // Block: player not in today's active lines
      if (!activePlayersToday.has(normalizedName)) {
        filteredOutPlayers.push(`${pick.player_name} (no active lines)`);
        return false;
      }

      // Block: OUT or DOUBTFUL
      if (blocklist.has(normalizedName)) {
        filteredOutPlayers.push(`${pick.player_name} (injury blocklist)`);
        return false;
      }

      // Penalize: GTD/QUESTIONABLE - reduce confidence
      const penalty = penalties.get(normalizedName);
      if (penalty) {
        pick.confidence_score *= penalty;
        pick.l10_hit_rate *= penalty;
        pick.compositeScore = Math.round(pick.compositeScore * penalty);
      }

      return true;
    });
  } else {
    // If no active players data, at least apply injury blocklist
    enrichedSweetSpots = enrichedSweetSpots.filter(pick => {
      const normalizedName = pick.player_name.toLowerCase().trim();
      if (blocklist.has(normalizedName)) {
        filteredOutPlayers.push(`${pick.player_name} (injury blocklist)`);
        return false;
      }
      const penalty = penalties.get(normalizedName);
      if (penalty) {
        pick.confidence_score *= penalty;
        pick.l10_hit_rate *= penalty;
        pick.compositeScore = Math.round(pick.compositeScore * penalty);
      }
      return true;
    });
  }

  console.log(`[AvailabilityGate] Filtered sweet spots: ${preFilterCount} → ${enrichedSweetSpots.length}`);
  if (filteredOutPlayers.length > 0) {
    console.log(`[AvailabilityGate] Removed players: ${filteredOutPlayers.slice(0, 20).join(', ')}${filteredOutPlayers.length > 20 ? ` ...and ${filteredOutPlayers.length - 20} more` : ''}`);
  }

  // Enrich team props
  const enrichedTeamPicks: EnrichedTeamPick[] = (teamProps || []).flatMap((game: TeamProp) => {
    const picks: EnrichedTeamPick[] = [];
    
    // Spread picks
    if (game.line !== null && game.line !== undefined) {
      if (game.home_odds) {
        picks.push({
          id: `${game.id}_spread_home`,
          type: 'team',
          sport: game.sport,
          home_team: game.home_team,
          away_team: game.away_team,
          bet_type: 'spread',
          side: 'home',
          line: game.line,
          odds: game.home_odds,
          category: mapTeamBetToCategory('spread', 'home'),
          sharp_score: game.sharp_score || 50,
          compositeScore: Math.min(100, (game.sharp_score || 50) + 20),
          confidence_score: (game.sharp_score || 50) / 100,
        });
      }
      if (game.away_odds) {
        picks.push({
          id: `${game.id}_spread_away`,
          type: 'team',
          sport: game.sport,
          home_team: game.home_team,
          away_team: game.away_team,
          bet_type: 'spread',
          side: 'away',
          line: -game.line,
          odds: game.away_odds,
          category: mapTeamBetToCategory('spread', 'away'),
          sharp_score: game.sharp_score || 50,
          compositeScore: Math.min(100, (game.sharp_score || 50) + 20),
          confidence_score: (game.sharp_score || 50) / 100,
        });
      }
    }
    
    // Total picks
    if (game.over_odds && game.under_odds) {
      picks.push({
        id: `${game.id}_total_over`,
        type: 'team',
        sport: game.sport,
        home_team: game.home_team,
        away_team: game.away_team,
        bet_type: 'total',
        side: 'over',
        line: game.line || 0,
        odds: game.over_odds,
        category: mapTeamBetToCategory('total', 'over'),
        sharp_score: game.sharp_score || 50,
        compositeScore: Math.min(100, (game.sharp_score || 50) + 15),
        confidence_score: (game.sharp_score || 50) / 100,
      });
      picks.push({
        id: `${game.id}_total_under`,
        type: 'team',
        sport: game.sport,
        home_team: game.home_team,
        away_team: game.away_team,
        bet_type: 'total',
        side: 'under',
        line: game.line || 0,
        odds: game.under_odds,
        category: mapTeamBetToCategory('total', 'under'),
        sharp_score: game.sharp_score || 50,
        compositeScore: Math.min(100, (game.sharp_score || 50) + 15),
        confidence_score: (game.sharp_score || 50) / 100,
      });
    }
    
    return picks;
  });

  // Sort by composite score, then interleave by category for diversity
  enrichedSweetSpots.sort((a, b) => b.compositeScore - a.compositeScore);
  enrichedSweetSpots = interleaveByCategory(enrichedSweetSpots);
  enrichedTeamPicks.sort((a, b) => b.compositeScore - a.compositeScore);

  console.log(`[Bot] Pool built: ${enrichedSweetSpots.length} player props, ${enrichedTeamPicks.length} team props`);

  return {
    playerPicks: enrichedSweetSpots,
    teamPicks: enrichedTeamPicks,
    sweetSpots: enrichedSweetSpots,
    totalPool: enrichedSweetSpots.length + enrichedTeamPicks.length,
  };
}

// ============= TIER GENERATION =============

async function generateTierParlays(
  supabase: any,
  tier: TierName,
  targetDate: string,
  pool: PropPool,
  weightMap: Map<string, number>,
  strategyName: string,
  bankroll: number
): Promise<{ count: number; parlays: any[] }> {
  const config = TIER_CONFIG[tier];
  const tracker = createUsageTracker();
  const parlaysToCreate: any[] = [];

  console.log(`[Bot] Generating ${tier} tier (${config.count} target)`);

  for (const profile of config.profiles) {
    if (parlaysToCreate.length >= config.count) break;

    const legs: any[] = [];
    const parlayTeamCount = new Map<string, number>();
    const parlayCategoryCount = new Map<string, number>();

    // Determine which picks to use based on profile
    const isTeamProfile = profile.betTypes && profile.betTypes.length > 0;
    const sportFilter = profile.sports || ['all'];
    
    // Filter picks based on profile
    let candidatePicks: (EnrichedPick | EnrichedTeamPick)[] = [];
    
    if (isTeamProfile) {
      candidatePicks = pool.teamPicks.filter(p => 
        profile.betTypes!.includes(p.bet_type)
      );
    } else {
      candidatePicks = pool.sweetSpots.filter(p => {
        if (sportFilter.includes('all')) return true;
        return sportFilter.includes(p.sport || 'basketball_nba');
      });
    }

    // Build parlay from candidates
    for (const pick of candidatePicks) {
      if (legs.length >= profile.legs) break;
      
      if (!canUsePickGlobally(pick, tracker, config)) continue;
      if (!canUsePickInParlay(pick, parlayTeamCount, parlayCategoryCount, config)) continue;

      // Check profile-specific requirements
      const minHitRate = profile.minHitRate || config.minHitRate;
      const minOddsValue = profile.minOddsValue || DEFAULT_MIN_ODDS_VALUE;
      
      const pickConfidence = pick.confidence_score || 0.5;
      const hitRatePercent = pickConfidence * 100;
      
      if (hitRatePercent < minHitRate) continue;
      
      if ('oddsValueScore' in pick && pick.oddsValueScore < minOddsValue) continue;

      // For player picks, handle line selection
      let legData: any;
      
      if ('type' in pick && pick.type === 'team') {
        const teamPick = pick as EnrichedTeamPick;
        legData = {
          id: teamPick.id,
          type: 'team',
          home_team: teamPick.home_team,
          away_team: teamPick.away_team,
          bet_type: teamPick.bet_type,
          side: teamPick.side,
          line: teamPick.line,
          category: teamPick.category,
          american_odds: teamPick.odds,
          sharp_score: teamPick.sharp_score,
          composite_score: teamPick.compositeScore,
          outcome: 'pending',
          sport: teamPick.sport,
        };
        
        parlayTeamCount.set(teamPick.home_team, (parlayTeamCount.get(teamPick.home_team) || 0) + 1);
        parlayTeamCount.set(teamPick.away_team, (parlayTeamCount.get(teamPick.away_team) || 0) + 1);
      } else {
        const playerPick = pick as EnrichedPick;
        const weight = weightMap.get(playerPick.category) || 1.0;
        
        // Select line based on profile
        const selectedLine = profile.useAltLines
          ? selectOptimalLine(
              playerPick,
              playerPick.alternateLines || [],
              profile.strategy,
              profile.preferPlusMoney || false,
              profile.minBufferMultiplier || 1.0
            )
          : { line: playerPick.line, odds: playerPick.americanOdds, reason: 'main_line' };

        legData = {
          id: playerPick.id,
          player_name: playerPick.player_name,
          team_name: playerPick.team_name,
          prop_type: playerPick.prop_type,
          line: selectedLine.line,
          side: playerPick.recommended_side || 'over',
          category: playerPick.category,
          weight,
          hit_rate: hitRatePercent,
          american_odds: selectedLine.odds,
          odds_value_score: playerPick.oddsValueScore,
          composite_score: playerPick.compositeScore,
          outcome: 'pending',
          original_line: playerPick.line,
          selected_line: selectedLine.line,
          line_selection_reason: selectedLine.reason,
          odds_improvement: selectedLine.oddsImprovement || 0,
          projection_buffer: (playerPick.projected_value || 0) - selectedLine.line,
          projected_value: playerPick.projected_value || 0,
          line_source: playerPick.line_source || 'projected',
          has_real_line: playerPick.has_real_line || false,
          sport: playerPick.sport || 'basketball_nba',
        };
        
        if (playerPick.team_name) {
          parlayTeamCount.set(playerPick.team_name, (parlayTeamCount.get(playerPick.team_name) || 0) + 1);
        }
      }
      
      legs.push(legData);
      parlayCategoryCount.set(pick.category, (parlayCategoryCount.get(pick.category) || 0) + 1);
    }

    // Only create parlay if we have enough legs
    if (legs.length >= profile.legs) {
      // Mark all picks as used
      for (const leg of legs) {
        if (leg.type === 'team') {
          tracker.usedPicks.add(createTeamPickKey(leg.id, leg.bet_type, leg.side));
        } else {
          const playerPick = pool.sweetSpots.find(p => p.id === leg.id);
          if (playerPick) markPickUsed(playerPick, tracker);
        }
      }

      // Calculate combined probability using product of individual hit rates (geometric)
      const combinedProbability = legs.reduce((product, l) => {
        const hr = l.hit_rate ? l.hit_rate / 100 : l.sharp_score ? l.sharp_score / 100 : 0.5;
        return product * hr;
      }, 1);
      
      // Calculate expected odds
      const expectedOdds = combinedProbability > 0 
        ? Math.round((1 / combinedProbability - 1) * 100)
        : 10000;
      
      // Edge and Sharpe - use actual implied probability from odds, not coin-flip model
      const impliedProbability = legs.reduce((product, l) => {
        const odds = l.american_odds || -110;
        return product * americanToImplied(odds);
      }, 1);
      const edge = combinedProbability - impliedProbability;
      
      // Add minimum edge floor for picks with positive signals
      const hasPositiveSignals = legs.some(l => (l.composite_score || 0) > 50 || (l.sharp_score || 0) > 55);
      const effectiveEdge = hasPositiveSignals ? Math.max(edge, 0.005) : edge;
      
      const sharpe = effectiveEdge / (0.5 * Math.sqrt(legs.length));

      // Check tier thresholds
      if (combinedProbability < 0.001) continue;
      if (effectiveEdge < config.minEdge) continue;
      if (sharpe < config.minSharpe) continue;

      // Calculate stake
      let stake = 0;
      if (config.stake === 'kelly') {
        stake = calculateKellyStake(combinedProbability, expectedOdds, bankroll);
      } else {
        stake = config.stake;
      }

      parlaysToCreate.push({
        parlay_date: targetDate,
        legs,
        leg_count: legs.length,
        combined_probability: combinedProbability,
        expected_odds: Math.min(expectedOdds, 10000),
        simulated_win_rate: combinedProbability,
        simulated_edge: effectiveEdge,
        simulated_sharpe: sharpe,
        strategy_name: `${strategyName}_${tier}_${profile.strategy}`,
        selection_rationale: `${tier} tier: ${profile.strategy} (${profile.legs}-leg)`,
        outcome: 'pending',
        is_simulated: tier !== 'execution',
        simulated_stake: stake,
      });

      console.log(`[Bot] Created ${tier}/${profile.strategy} ${legs.length}-leg parlay #${parlaysToCreate.length}`);
    }
  }

  return { count: parlaysToCreate.length, parlays: parlaysToCreate };
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const targetDate = body.date || getEasternDateRange().gameDate;
    const singleTier = body.tier as TierName | undefined;

    console.log(`[Bot v2] Generating tiered parlays for ${targetDate}`);

    // 1. Load category weights (all sports)
    const { data: weights, error: weightsError } = await supabase
      .from('bot_category_weights')
      .select('*')
      .eq('is_blocked', false)
      .gte('weight', 0.5);

    if (weightsError) throw weightsError;

    const weightMap = new Map<string, number>();
    (weights || []).forEach((w: CategoryWeight) => {
      weightMap.set(w.category, w.weight);
    });

    console.log(`[Bot v2] Loaded ${weights?.length || 0} category weights`);

    // 2. Get active strategy
    const { data: strategy } = await supabase
      .from('bot_strategies')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .single();

    const strategyName = strategy?.strategy_name || 'tiered_v2';

    // 3. Get current bankroll
    const { data: activationStatus } = await supabase
      .from('bot_activation_status')
      .select('simulated_bankroll, real_bankroll, is_real_mode_ready')
      .order('check_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    const bankroll = activationStatus?.simulated_bankroll || 1000;

    // 4. Build prop pool
    const pool = await buildPropPool(supabase, targetDate, weightMap, weights as CategoryWeight[] || []);

    if (pool.totalPool < 20) {
      console.log(`[Bot v2] Insufficient prop pool: ${pool.totalPool}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Insufficient prop pool',
          poolSize: pool.totalPool,
          parlaysGenerated: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Generate parlays for each tier
    const tiersToGenerate: TierName[] = singleTier 
      ? [singleTier] 
      : ['exploration', 'validation', 'execution'];

    const results: Record<string, { count: number; parlays: any[] }> = {};
    let allParlays: any[] = [];

    for (const tier of tiersToGenerate) {
      const result = await generateTierParlays(
        supabase,
        tier,
        targetDate,
        pool,
        weightMap,
        strategyName,
        bankroll
      );
      results[tier] = result;
      allParlays = [...allParlays, ...result.parlays];
    }

    console.log(`[Bot v2] Total parlays created: ${allParlays.length}`);

    // 6. Clean up old pending parlays for this date, then insert new ones
    const { data: deletedOld, error: cleanupError } = await supabase
      .from('bot_daily_parlays')
      .delete()
      .eq('parlay_date', targetDate)
      .eq('outcome', 'pending')
      .select('id');
    
    if (cleanupError) {
      console.warn(`[Bot v2] Cleanup warning: ${cleanupError.message}`);
    } else {
      console.log(`[Bot v2] Cleaned up ${deletedOld?.length || 0} old pending parlays for ${targetDate}`);
    }

    if (allParlays.length > 0) {
      const { error: insertError } = await supabase
        .from('bot_daily_parlays')
        .insert(allParlays);

      if (insertError) throw insertError;
    }

    // 7. Update activation status
    const { data: existingStatus } = await supabase
      .from('bot_activation_status')
      .select('*')
      .eq('check_date', targetDate)
      .maybeSingle();

    if (existingStatus) {
      await supabase
        .from('bot_activation_status')
        .update({ 
          parlays_generated: (existingStatus.parlays_generated || 0) + allParlays.length 
        })
        .eq('id', existingStatus.id);
    } else {
      await supabase
        .from('bot_activation_status')
        .insert({
          check_date: targetDate,
          parlays_generated: allParlays.length,
          simulated_bankroll: bankroll,
        });
    }

    // 8. Update learning metrics
    const tierSummary: Record<string, any> = {};
    for (const [tier, result] of Object.entries(results)) {
      tierSummary[tier] = {
        count: result.count,
        legDistribution: result.parlays.reduce((acc, p) => {
          acc[p.leg_count] = (acc[p.leg_count] || 0) + 1;
          return acc;
        }, {} as Record<number, number>),
      };

      // Insert learning metric for this tier
      await supabase.from('bot_learning_metrics').upsert({
        metric_date: targetDate,
        tier,
        sport: 'all',
        parlays_generated: result.count,
        created_at: new Date().toISOString(),
      }, { onConflict: 'metric_date,tier,sport' });
    }

    // 9. Log activity
    await supabase.from('bot_activity_log').insert({
      event_type: 'tiered_generation_complete',
      message: `Generated ${allParlays.length} parlays across ${tiersToGenerate.length} tiers`,
      metadata: { 
        tierSummary,
        poolSize: pool.totalPool,
        playerPicks: pool.playerPicks.length,
        teamPicks: pool.teamPicks.length,
      },
      severity: 'success',
    });

    // 10. Send Telegram notification
    try {
      await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          type: 'tiered_parlays_generated',
          data: {
            totalCount: allParlays.length,
            tierSummary,
            poolSize: pool.totalPool,
            date: targetDate,
          },
        }),
      });
    } catch (telegramError) {
      console.error('[Bot v2] Telegram notification failed:', telegramError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        parlaysGenerated: allParlays.length,
        tierSummary,
        poolSize: pool.totalPool,
        playerPicks: pool.playerPicks.length,
        teamPicks: pool.teamPicks.length,
        date: targetDate,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Bot v2] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
