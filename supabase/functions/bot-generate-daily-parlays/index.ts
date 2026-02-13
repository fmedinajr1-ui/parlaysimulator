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
  sortBy?: 'composite' | 'hit_rate';
  boostLegs?: number;
  allowTeamLegs?: number;
  maxMlLegs?: number;
}

const TIER_CONFIG: Record<TierName, TierConfig> = {
  exploration: {
    count: 50,
    iterations: 2000,
    maxPlayerUsage: 5,
    maxTeamUsage: 3,
    maxCategoryUsage: 6,
    minHitRate: 45,
    minEdge: 0.003,
    minSharpe: 0.01,
    stake: 10,
    minConfidence: 0.45,
    profiles: [
      // Multi-sport exploration (15 profiles)
      { legs: 3, strategy: 'explore_safe', sports: ['basketball_nba'] },
      { legs: 3, strategy: 'explore_safe', sports: ['basketball_nba'] },
      { legs: 3, strategy: 'explore_safe', sports: ['icehockey_nhl'] },
      { legs: 3, strategy: 'explore_mixed', sports: ['basketball_nba', 'icehockey_nhl'] },
      { legs: 3, strategy: 'explore_mixed', sports: ['basketball_nba', 'icehockey_nhl', 'basketball_ncaab'] },
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
      // NCAAB exploration (5 profiles) - totals/spreads focused (was ML-heavy)
      { legs: 3, strategy: 'ncaab_totals', sports: ['basketball_ncaab'], betTypes: ['total'] },
      { legs: 3, strategy: 'ncaab_totals', sports: ['basketball_ncaab'], betTypes: ['total'] },
      { legs: 3, strategy: 'ncaab_totals', sports: ['basketball_ncaab'], betTypes: ['total'] },
      { legs: 3, strategy: 'ncaab_spreads', sports: ['basketball_ncaab'], betTypes: ['spread'] },
      { legs: 4, strategy: 'ncaab_spreads', sports: ['basketball_ncaab'], betTypes: ['spread'] },
      // NCAA Baseball exploration (5 profiles)
      { legs: 3, strategy: 'baseball_totals', sports: ['baseball_ncaa'], betTypes: ['total'] },
      { legs: 3, strategy: 'baseball_totals', sports: ['baseball_ncaa'], betTypes: ['total'] },
      { legs: 3, strategy: 'baseball_spreads', sports: ['baseball_ncaa'], betTypes: ['spread'] },
      { legs: 3, strategy: 'baseball_mixed', sports: ['baseball_ncaa'], betTypes: ['spread', 'total'] },
      { legs: 3, strategy: 'baseball_cross', sports: ['baseball_ncaa', 'basketball_ncaab'] },
      // Team props exploration (13 profiles) - ML Sniper: hybrid profiles with maxMlLegs: 1
      { legs: 3, strategy: 'team_hybrid', betTypes: ['moneyline', 'spread', 'total'], maxMlLegs: 1 },
      { legs: 3, strategy: 'team_totals', betTypes: ['total'] },
      { legs: 3, strategy: 'team_totals', betTypes: ['total'] },
      { legs: 3, strategy: 'team_totals', betTypes: ['total'] },
      { legs: 3, strategy: 'team_totals', betTypes: ['total'] },
      { legs: 3, strategy: 'team_spreads', betTypes: ['spread'] },
      { legs: 3, strategy: 'team_spreads', betTypes: ['spread'] },
      { legs: 4, strategy: 'team_mixed', betTypes: ['spread', 'total'] },
      { legs: 3, strategy: 'team_hybrid_cross', betTypes: ['moneyline', 'spread', 'total'], sports: ['basketball_nba', 'basketball_ncaab'], maxMlLegs: 1 },
      { legs: 4, strategy: 'team_mixed', betTypes: ['spread', 'total'] },
      // Cross-sport exploration (20 profiles)
      { legs: 3, strategy: 'cross_sport', sports: ['basketball_nba', 'icehockey_nhl'] },
      { legs: 3, strategy: 'cross_sport', sports: ['basketball_nba', 'basketball_ncaab'] },
      { legs: 3, strategy: 'cross_sport', sports: ['basketball_ncaab', 'icehockey_nhl'] },
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
    stake: 10,
    minConfidence: 0.52,
    profiles: [
      { legs: 3, strategy: 'validated_conservative', sports: ['basketball_nba'], minOddsValue: 45, minHitRate: 55 },
      { legs: 3, strategy: 'validated_conservative', sports: ['basketball_nba'], minOddsValue: 45, minHitRate: 55 },
      { legs: 3, strategy: 'validated_conservative', sports: ['icehockey_nhl'], minOddsValue: 45, minHitRate: 55 },
      { legs: 3, strategy: 'validated_ncaab_totals', sports: ['basketball_ncaab'], betTypes: ['total'], minOddsValue: 45, minHitRate: 55 },
      { legs: 3, strategy: 'validated_ncaab_spreads', sports: ['basketball_ncaab'], betTypes: ['spread'], minOddsValue: 45, minHitRate: 55 },
      // Validated baseball
      { legs: 3, strategy: 'validated_baseball_totals', sports: ['baseball_ncaa'], betTypes: ['total'], minOddsValue: 45, minHitRate: 55 },
      { legs: 3, strategy: 'validated_baseball_spreads', sports: ['baseball_ncaa'], betTypes: ['spread'], minOddsValue: 45, minHitRate: 55 },
      { legs: 4, strategy: 'validated_balanced', sports: ['basketball_nba'], minOddsValue: 42, minHitRate: 55 },
      { legs: 4, strategy: 'validated_balanced', sports: ['basketball_nba', 'icehockey_nhl'], minOddsValue: 42, minHitRate: 55 },
      { legs: 4, strategy: 'validated_balanced', sports: ['basketball_nba', 'basketball_ncaab'], minOddsValue: 42, minHitRate: 55 },
      { legs: 5, strategy: 'validated_standard', sports: ['basketball_nba'], minOddsValue: 40, minHitRate: 55 },
      { legs: 5, strategy: 'validated_standard', sports: ['all'], minOddsValue: 40, minHitRate: 55 },
      { legs: 5, strategy: 'validated_standard', sports: ['all'], minOddsValue: 40, minHitRate: 55, useAltLines: true },
      { legs: 3, strategy: 'validated_team', betTypes: ['spread', 'total'], minOddsValue: 45, minHitRate: 55 },
      { legs: 3, strategy: 'validated_team', betTypes: ['spread', 'total'], minOddsValue: 45, minHitRate: 55 },
      { legs: 4, strategy: 'validated_team', betTypes: ['spread', 'total'], minOddsValue: 42, minHitRate: 55 },
      { legs: 4, strategy: 'validated_cross', sports: ['all'], minOddsValue: 42, minHitRate: 55 },
      { legs: 5, strategy: 'validated_aggressive', sports: ['all'], minOddsValue: 40, minHitRate: 52, useAltLines: true },
      // Win-rate-first validated profiles
      { legs: 3, strategy: 'validated_winrate', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate' },
      { legs: 4, strategy: 'validated_winrate', sports: ['basketball_nba'], minHitRate: 58, sortBy: 'hit_rate' },
      // Promoted from execution: 4-5 leg proving ground (moved from execution tier)
      { legs: 4, strategy: 'proving_cash', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
      { legs: 4, strategy: 'proving_cash', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
      { legs: 4, strategy: 'proving_boosted', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: true, boostLegs: 2, minBufferMultiplier: 1.5 },
      { legs: 5, strategy: 'proving_boost', sports: ['all'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: true, boostLegs: 2, preferPlusMoney: true, minBufferMultiplier: 1.2 },
    ],
  },
  execution: {
    count: 10,
    iterations: 25000,
    maxPlayerUsage: 3,
    maxTeamUsage: 2,
    maxCategoryUsage: 2,
    minHitRate: 60,
    minEdge: 0.008,
    minSharpe: 0.02,
    stake: 10,
    minConfidence: 0.60,
    profiles: [
      // ALL 3-LEG: Maximum win probability (Feb 11 analysis: all 4 winners were 3-leg)
      { legs: 3, strategy: 'cash_lock', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'hit_rate', useAltLines: false },
      { legs: 3, strategy: 'cash_lock', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'hit_rate', useAltLines: false },
      { legs: 3, strategy: 'cash_lock', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
      { legs: 3, strategy: 'cash_lock_cross', sports: ['all'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
      // BOOSTED: Shop odds on 1 leg for plus-money
      { legs: 3, strategy: 'boosted_cash', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'hit_rate', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      { legs: 3, strategy: 'boosted_cash', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      { legs: 3, strategy: 'boosted_cash_cross', sports: ['all'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.2 },
      // GOLDEN LOCKS: Require golden category legs
      { legs: 3, strategy: 'golden_lock', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
      { legs: 3, strategy: 'golden_lock', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
      { legs: 3, strategy: 'golden_lock_cross', sports: ['all'], minHitRate: 58, sortBy: 'hit_rate', useAltLines: false },
      // HYBRID: Mix player props + team props for diversity
      { legs: 3, strategy: 'hybrid_exec', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false, allowTeamLegs: 1 },
      { legs: 3, strategy: 'hybrid_exec_cross', sports: ['all'], minHitRate: 58, sortBy: 'hit_rate', useAltLines: false, allowTeamLegs: 1 },
      // TEAM EXECUTION: Pure team props with high composite scores
      { legs: 3, strategy: 'team_exec', betTypes: ['moneyline', 'spread', 'total'], minHitRate: 55 },
      // NCAAB EXECUTION: KenPom-powered, totals/spreads only (ML favorites were 0/12)
      { legs: 3, strategy: 'ncaab_totals', sports: ['basketball_ncaab'], betTypes: ['total'], minHitRate: 55, sortBy: 'composite' },
      { legs: 3, strategy: 'ncaab_totals', sports: ['basketball_ncaab'], betTypes: ['total'], minHitRate: 55, sortBy: 'composite' },
      { legs: 3, strategy: 'ncaab_spreads', sports: ['basketball_ncaab'], betTypes: ['spread'], minHitRate: 55, sortBy: 'composite' },
      // NCAA Baseball execution
      { legs: 3, strategy: 'baseball_totals', sports: ['baseball_ncaa'], betTypes: ['total'], minHitRate: 55, sortBy: 'composite' },
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

function interleaveByCategory(picks: EnrichedPick[], goldenCategories?: Set<string>): EnrichedPick[] {
  // If golden categories provided, front-load golden picks
  if (goldenCategories && goldenCategories.size > 0) {
    const goldenPicks = picks.filter(p => goldenCategories.has(p.category));
    const regularPicks = picks.filter(p => !goldenCategories.has(p.category));
    
    // Sort each group by composite score
    goldenPicks.sort((a, b) => b.compositeScore - a.compositeScore);
    regularPicks.sort((a, b) => b.compositeScore - a.compositeScore);
    
    // Interleave: golden first, then regular, maintaining category diversity
    const result: EnrichedPick[] = [];
    const usedCategories = new Set<string>();
    
    // First pass: one from each golden category
    for (const pick of goldenPicks) {
      if (!usedCategories.has(pick.category)) {
        result.push(pick);
        usedCategories.add(pick.category);
      }
    }
    // Second pass: remaining golden picks
    for (const pick of goldenPicks) {
      if (!result.includes(pick)) result.push(pick);
    }
    // Third pass: regular picks interleaved
    const regularGroups = new Map<string, EnrichedPick[]>();
    for (const pick of regularPicks) {
      if (!regularGroups.has(pick.category)) regularGroups.set(pick.category, []);
      regularGroups.get(pick.category)!.push(pick);
    }
    const regularIterators = [...regularGroups.values()].map(g => ({ picks: g, index: 0 }));
    let added = true;
    while (added) {
      added = false;
      for (const iter of regularIterators) {
        if (iter.index < iter.picks.length) {
          result.push(iter.picks[iter.index]);
          iter.index++;
          added = true;
        }
      }
    }
    return result;
  }

  // Default round-robin interleave
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
  updated_at?: string;
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
  score_breakdown?: Record<string, number>;
}

// ============= TEAM INTELLIGENCE DATA =============

interface PaceData { pace_rating: number; pace_rank: number; tempo_factor: number; }
interface DefenseData { overall_rank: number; }
interface GameEnvData { vegas_total: number; vegas_spread: number; shootout_factor: number; grind_factor: number; blowout_probability: number; }
interface HomeCourtData { home_win_rate: number; home_cover_rate: number; home_over_rate: number; }

// NCAAB team intelligence data
interface NcaabTeamStats {
  team_name: string;
  conference: string | null;
  kenpom_rank: number | null;
  adj_offense: number | null;
  adj_defense: number | null;
  adj_tempo: number | null;
  home_record: string | null;
  away_record: string | null;
  ats_record: string | null;
  over_under_record: string | null;
}

function clampScore(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseRecord(record: string | null): { wins: number; losses: number; rate: number } {
  if (!record) return { wins: 0, losses: 0, rate: 0.5 };
  const match = record.match(/(\d+)-(\d+)/);
  if (!match) return { wins: 0, losses: 0, rate: 0.5 };
  const wins = parseInt(match[1]);
  const losses = parseInt(match[2]);
  const total = wins + losses;
  return { wins, losses, rate: total > 0 ? wins / total : 0.5 };
}

// NCAAB team name normalization for abbreviation mismatches
const NCAAB_NAME_MAP: Record<string, string> = {
  'Michigan St': 'Michigan State', 'Michigan St Spartans': 'Michigan State Spartans',
  'Ohio St': 'Ohio State', 'Ohio St Buckeyes': 'Ohio State Buckeyes',
  'Penn St': 'Penn State', 'Penn St Nittany Lions': 'Penn State Nittany Lions',
  'Oklahoma St': 'Oklahoma State', 'Oklahoma St Cowboys': 'Oklahoma State Cowboys',
  'Iowa St': 'Iowa State', 'Iowa St Cyclones': 'Iowa State Cyclones',
  'Kansas St': 'Kansas State', 'Kansas St Wildcats': 'Kansas State Wildcats',
  'Boise St': 'Boise State', 'Boise St Broncos': 'Boise State Broncos',
  'San Diego St': 'San Diego State', 'San Diego St Aztecs': 'San Diego State Aztecs',
  'Colorado St': 'Colorado State', 'Colorado St Rams': 'Colorado State Rams',
  'Fresno St': 'Fresno State', 'Fresno St Bulldogs': 'Fresno State Bulldogs',
  'Arizona St': 'Arizona State', 'Arizona St Sun Devils': 'Arizona State Sun Devils',
  'Oregon St': 'Oregon State', 'Oregon St Beavers': 'Oregon State Beavers',
  'Washington St': 'Washington State', 'Washington St Cougars': 'Washington State Cougars',
  'Miss St': 'Mississippi State', 'Miss St Bulldogs': 'Mississippi State Bulldogs',
  'UConn': 'Connecticut', 'UConn Huskies': 'Connecticut Huskies',
  'UNC': 'North Carolina', 'UNC Tar Heels': 'North Carolina Tar Heels',
  'SMU': 'SMU Mustangs',
  'UCF': 'UCF Knights',
  'UNLV': 'UNLV Rebels',
  'USC': 'USC Trojans',
  'LSU': 'LSU Tigers',
  'BYU': 'BYU Cougars',
};

function resolveNcaabTeam(teamName: string, statsMap: Map<string, NcaabTeamStats>): NcaabTeamStats | undefined {
  // Direct match
  let stats = statsMap.get(teamName);
  if (stats) return stats;
  // Try mapped name
  const mapped = NCAAB_NAME_MAP[teamName];
  if (mapped) { stats = statsMap.get(mapped); if (stats) return stats; }
  // Fuzzy: try matching on last word (mascot) or first word
  for (const [key, val] of statsMap) {
    if (key.includes(teamName) || teamName.includes(key)) return val;
    // Match mascot: "Spartans" in both
    const teamMascot = teamName.split(' ').pop()?.toLowerCase();
    const statMascot = key.split(' ').pop()?.toLowerCase();
    if (teamMascot && statMascot && teamMascot === statMascot && teamMascot.length > 3) {
      // Confirm first word also partially matches
      const teamFirst = teamName.split(' ')[0].toLowerCase();
      if (key.toLowerCase().includes(teamFirst)) return val;
    }
  }
  return undefined;
}

// NCAAB-specific composite scoring using KenPom-style data
function calculateNcaabTeamCompositeScore(
  game: TeamProp,
  betType: string,
  side: string,
  ncaabStatsMap: Map<string, NcaabTeamStats>
): { score: number; breakdown: Record<string, number> } {
  let score = 50;
  const breakdown: Record<string, number> = { base: 50 };

  const homeStats = resolveNcaabTeam(game.home_team, ncaabStatsMap);
  const awayStats = resolveNcaabTeam(game.away_team, ncaabStatsMap);

  // If no NCAAB data available, return flat score
  if (!homeStats && !awayStats) {
    breakdown.no_data = 0;
    return { score: 55, breakdown };
  }

  const homeOff = homeStats?.adj_offense || 70;
  const homeDef = homeStats?.adj_defense || 70;
  const awayOff = awayStats?.adj_offense || 70;
  const awayDef = awayStats?.adj_defense || 70;
  const homeRank = homeStats?.kenpom_rank || 200;
  const awayRank = awayStats?.kenpom_rank || 200;
  const homeTempo = homeStats?.adj_tempo || 67;
  const awayTempo = awayStats?.adj_tempo || 67;

  // Reject teams ranked 200+ (too unpredictable)
  const sideRank = side === 'home' ? homeRank : awayRank;
  if (sideRank > 200) {
    score -= 15;
    breakdown.low_rank_penalty = -15;
  }

  // Rank tier bonus: Top 50 teams are far more predictable
  if (sideRank <= 25) {
    score += 10;
    breakdown.elite_rank = 10;
  } else if (sideRank <= 50) {
    score += 7;
    breakdown.top50_rank = 7;
  } else if (sideRank <= 100) {
    score += 3;
    breakdown.top100_rank = 3;
  }

  if (betType === 'spread') {
    // KenPom efficiency differential: (team_offense - opp_defense) gap
    const homeNetAdv = (homeOff - awayDef) - (awayOff - homeDef);
    const sideAdv = side === 'home' ? homeNetAdv : -homeNetAdv;
    
    // Large efficiency gaps (10+ points) are highly predictive in NCAAB
    const effBonus = clampScore(-15, 15, sideAdv * 1.0);
    score += effBonus;
    breakdown.efficiency_edge = effBonus;

    // Home court is worth ~3.5 points in college (bigger than NBA)
    if (side === 'home') {
      score += 5;
      breakdown.home_court = 5;
    }

    // ATS record weighting
    const sideTeam = side === 'home' ? homeStats : awayStats;
    if (sideTeam?.ats_record) {
      const ats = parseRecord(sideTeam.ats_record);
      if (ats.rate > 0.55 && ats.wins + ats.losses >= 10) {
        const atsBonus = Math.round((ats.rate - 0.50) * 40);
        score += clampScore(0, 8, atsBonus);
        breakdown.ats_record = clampScore(0, 8, atsBonus);
      }
    }

    // Penalize close spreads in NCAAB (< 3 pts)
    const absLine = Math.abs(game.line || 0);
    if (absLine > 0 && absLine < 3) {
      score -= 8;
      breakdown.close_spread_penalty = -8;
    }

    // Conference matchup context: conference games are tighter
    if (homeStats?.conference && awayStats?.conference && homeStats.conference === awayStats.conference) {
      score -= 5; // Conference games are harder to predict
      breakdown.conference_game = -5;
    }
  }

  if (betType === 'total') {
    const avgTempo = (homeTempo + awayTempo) / 2;
    
    // College tempo thresholds (65-75 range vs NBA 95-105)
    // Tempo is THE strongest predictor in college basketball totals
    if (side === 'over' && avgTempo > 70) {
      const paceBonus = Math.round((avgTempo - 68) * 4);
      score += clampScore(0, 18, paceBonus);
      breakdown.tempo_fast = clampScore(0, 18, paceBonus);
    } else if (side === 'under' && avgTempo < 65) {
      const paceBonus = Math.round((65 - avgTempo) * 5);
      score += clampScore(0, 18, paceBonus);
      breakdown.tempo_slow = clampScore(0, 18, paceBonus);
    } else if ((side === 'over' && avgTempo < 64) || (side === 'under' && avgTempo > 71)) {
      score -= 12;
      breakdown.tempo_mismatch = -12;
    }

    // Offensive efficiency: both teams scoring well = over, both defensive = under
    const combinedOff = homeOff + awayOff;
    const combinedDef = homeDef + awayDef;
    if (side === 'over' && combinedOff > 148) { // Both teams above 74 ppg
      score += 5;
      breakdown.high_scoring = 5;
    }
    if (side === 'under' && combinedDef < 128) { // Both teams allow < 64 ppg
      score += 5;
      breakdown.strong_defense = 5;
    }

    // O/U record weighting
    const sideTeam = side === 'home' ? homeStats : awayStats;
    if (sideTeam?.over_under_record) {
      const ou = parseRecord(sideTeam.over_under_record);
      if (ou.rate > 0.55 && ou.wins + ou.losses >= 10) {
        const ouBonus = Math.round((ou.rate - 0.50) * 30);
        score += clampScore(0, 6, ouBonus);
        breakdown.ou_record = clampScore(0, 6, ouBonus);
      }
    }
  }

  if (betType === 'moneyline') {
    // Efficiency differential for ML
    const homeNetAdv = (homeOff - awayDef) - (awayOff - homeDef);
    const sideAdv = side === 'home' ? homeNetAdv : -homeNetAdv;
    const effBonus = clampScore(-12, 12, sideAdv * 0.8);
    score += effBonus;
    breakdown.efficiency_edge = effBonus;

    // Rank differential: picking top team vs low rank = high confidence
    const rankDiff = side === 'home' ? awayRank - homeRank : homeRank - awayRank;
    if (rankDiff > 100) {
      score += 10;
      breakdown.rank_mismatch = 10;
    } else if (rankDiff > 50) {
      score += 6;
      breakdown.rank_edge = 6;
    }

    // Home court advantage in NCAAB is stronger than NBA
    if (side === 'home') {
      score += 6;
      breakdown.home_court = 6;
    }

    // Home record weighting
    if (side === 'home' && homeStats?.home_record) {
      const hr = parseRecord(homeStats.home_record);
      if (hr.rate > 0.70 && hr.wins + hr.losses >= 5) {
        score += 5;
        breakdown.strong_home_record = 5;
      }
    }

    // Penalize heavy favorites
    const odds = side === 'home' ? (game.home_odds || -110) : (game.away_odds || -110);
    const impliedProb = americanToImplied(odds);
    if (impliedProb > 0.80) {
      score -= 10;
      breakdown.heavy_fav_penalty = -10;
    }
  }

  return { score: clampScore(30, 95, score), breakdown };
}

function calculateTeamCompositeScore(
  game: TeamProp,
  betType: string,
  side: string,
  paceMap: Map<string, PaceData>,
  defenseMap: Map<string, number>,
  envMap: Map<string, GameEnvData>,
  homeCourtMap: Map<string, HomeCourtData>,
  ncaabStatsMap?: Map<string, NcaabTeamStats>
): { score: number; breakdown: Record<string, number> } {
  // Route NCAAB games to specialized scoring
  const isNCAAB = game.sport?.includes('ncaab') || game.sport?.includes('college');
  if (isNCAAB && ncaabStatsMap && ncaabStatsMap.size > 0) {
    return calculateNcaabTeamCompositeScore(game, betType, side, ncaabStatsMap);
  }

  let score = 50;
  const breakdown: Record<string, number> = { base: 50 };

  const homeAbbrev = game.home_team;
  const awayAbbrev = game.away_team;
  const gameKey = `${homeAbbrev}_${awayAbbrev}`;
  const env = envMap.get(gameKey);
  const homeCourt = homeCourtMap.get(homeAbbrev);
  const homeDefRank = defenseMap.get(homeAbbrev) || 15;
  const awayDefRank = defenseMap.get(awayAbbrev) || 15;

  if (betType === 'spread') {
    // Defense rank differential: better defense (lower rank) = more confident
    const defDiff = awayDefRank - homeDefRank; // positive = home has better defense
    const sideDefAdv = side === 'home' ? defDiff : -defDiff;
    const defBonus = clampScore(-15, 15, sideDefAdv * 1.5);
    score += defBonus;
    breakdown.defense_edge = defBonus;

    // Home court cover rate
    if (homeCourt && side === 'home' && homeCourt.home_cover_rate > 0.55) {
      const coverBonus = Math.round((homeCourt.home_cover_rate - 0.50) * 100);
      score += clampScore(0, 10, coverBonus);
      breakdown.home_cover = clampScore(0, 10, coverBonus);
    }

    // Blowout probability favors favorite spread
    if (env && env.blowout_probability > 0.25) {
      const blowoutBonus = Math.round(env.blowout_probability * 20);
      // Only boost if on the favorite side (negative spread = favorite)
      const isFavSide = (side === 'home' && (env.vegas_spread || 0) < 0) ||
                        (side === 'away' && (env.vegas_spread || 0) > 0);
      if (isFavSide) {
        score += clampScore(0, 10, blowoutBonus);
        breakdown.blowout = clampScore(0, 10, blowoutBonus);
      }
    }

    // Penalize close spreads (< 3 pts) as coin-flip territory
    const absLine = Math.abs(game.line || 0);
    if (absLine > 0 && absLine < 3) {
      score -= 8;
      breakdown.close_spread_penalty = -8;
    }
  }

  if (betType === 'total') {
    const homePace = paceMap.get(homeAbbrev);
    const awayPace = paceMap.get(awayAbbrev);

    if (homePace && awayPace) {
      const avgPace = (homePace.pace_rating + awayPace.pace_rating) / 2;
      if (side === 'over' && avgPace > 101) {
        const paceBonus = Math.round((avgPace - 99) * 3);
        score += clampScore(0, 15, paceBonus);
        breakdown.pace_fast = clampScore(0, 15, paceBonus);
      } else if (side === 'under' && avgPace < 99) {
        const paceBonus = Math.round((99 - avgPace) * 3);
        score += clampScore(0, 15, paceBonus);
        breakdown.pace_slow = clampScore(0, 15, paceBonus);
      } else if ((side === 'over' && avgPace < 98) || (side === 'under' && avgPace > 102)) {
        score -= 10; // Pace contradicts the side
        breakdown.pace_mismatch = -10;
      }
    }

    // Shootout / grind factor
    if (env) {
      if (side === 'over' && env.shootout_factor > 0.25) {
        const shootBonus = Math.round(env.shootout_factor * 30);
        score += clampScore(0, 10, shootBonus);
        breakdown.shootout = clampScore(0, 10, shootBonus);
      }
      if (side === 'under' && env.grind_factor > 0.75) {
        const grindBonus = Math.round((env.grind_factor - 0.70) * 40);
        score += clampScore(0, 10, grindBonus);
        breakdown.grind = clampScore(0, 10, grindBonus);
      }
    }

    // Home over rate
    if (homeCourt && side === 'over' && homeCourt.home_over_rate > 0.55) {
      score += 5;
      breakdown.home_over_rate = 5;
    }
  }

  if (betType === 'moneyline') {
    // Defense rank differential
    const defDiff = awayDefRank - homeDefRank;
    const sideDefAdv = side === 'home' ? defDiff : -defDiff;
    const defBonus = clampScore(-12, 12, sideDefAdv * 1.2);
    score += defBonus;
    breakdown.defense_edge = defBonus;

    // Home win rate
    if (homeCourt && side === 'home' && homeCourt.home_win_rate > 0.55) {
      const winBonus = Math.round((homeCourt.home_win_rate - 0.50) * 60);
      score += clampScore(0, 12, winBonus);
      breakdown.home_win_rate = clampScore(0, 12, winBonus);
    }

    // Penalize heavy favorites (implied prob > 75%) as low-value
    const odds = side === 'home' ? (game.home_odds || -110) : (game.away_odds || -110);
    const impliedProb = americanToImplied(odds);
    if (impliedProb > 0.75) {
      score -= 12;
      breakdown.heavy_fav_penalty = -12;
    }
  }

  return { score: clampScore(30, 95, score), breakdown };
}

// ============= TEAM CONFLICT DETECTION =============

function canAddTeamLegToParlay(
  newLeg: EnrichedTeamPick,
  existingLegs: any[]
): boolean {
  for (const existing of existingLegs) {
    if (existing.type !== 'team') continue;
    
    // Same game check (match home_team + away_team)
    const sameGame = existing.home_team === newLeg.home_team && existing.away_team === newLeg.away_team;
    if (!sameGame) continue;
    
    // Block: same bet_type from the same game (no 2 spreads, no 2 totals)
    if (existing.bet_type === newLeg.bet_type) {
      return false;
    }
  }
  return true;
}

interface CategoryWeight {
  category: string;
  side: string;
  weight: number;
  current_hit_rate: number;
  is_blocked: boolean;
  sport?: string;
  total_picks?: number;
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
  goldenCategories: Set<string>;
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
  categoryWeight: number,
  calibratedHitRate?: number
): number {
  const hitRateScore = Math.min(100, hitRate);
  const edgeScore = Math.min(100, Math.max(0, edge * 20 + 50));
  const weightScore = categoryWeight * 66.67;
  
  let baseScore = Math.round(
    (hitRateScore * 0.30) +
    (edgeScore * 0.25) +
    (oddsValueScore * 0.25) +
    (weightScore * 0.20)
  );

  // Hit-rate tier multiplier based on calibrated category performance
  if (calibratedHitRate !== undefined && calibratedHitRate > 0) {
    if (calibratedHitRate >= 65) {
      baseScore = Math.round(baseScore * 1.5);
    } else if (calibratedHitRate >= 55) {
      baseScore = Math.round(baseScore * 1.2);
    } else if (calibratedHitRate < 45) {
      baseScore = Math.round(baseScore * 0.5);
    }
  }

  return baseScore;
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
  tierConfig: TierConfig,
  existingLegs?: any[]
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
  
  // Team conflict detection: no contradictory or duplicate same-game legs
  if ('type' in pick && pick.type === 'team' && existingLegs) {
    if (!canAddTeamLegToParlay(pick as EnrichedTeamPick, existingLegs)) return false;
  }
  
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

async function fetchTeamsPlayingToday(
  supabase: any,
  startUtc: string,
  endUtc: string,
  gameDate: string
): Promise<Set<string>> {
  const teams = new Set<string>();

  // Source 1: upcoming_games_cache (most reliable for schedule)
  const { data: upcoming } = await supabase
    .from('upcoming_games_cache')
    .select('home_team, away_team')
    .gte('commence_time', startUtc)
    .lt('commence_time', endUtc);

  (upcoming || []).forEach((g: any) => {
    if (g.home_team) teams.add(g.home_team.toLowerCase().trim());
    if (g.away_team) teams.add(g.away_team.toLowerCase().trim());
  });

  // Source 2: game_bets (backup)
  const { data: bets } = await supabase
    .from('game_bets')
    .select('home_team, away_team')
    .eq('is_active', true)
    .gte('commence_time', startUtc)
    .lt('commence_time', endUtc);

  (bets || []).forEach((g: any) => {
    if (g.home_team) teams.add(g.home_team.toLowerCase().trim());
    if (g.away_team) teams.add(g.away_team.toLowerCase().trim());
  });

  console.log(`[GameSchedule] ${teams.size} teams playing today`);
  return teams;
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

// ============= RESEARCH INTELLIGENCE =============

async function fetchResearchInjuryIntel(
  supabase: any,
  gameDate: string
): Promise<Set<string>> {
  const researchBlocklist = new Set<string>();
  
  const { data } = await supabase
    .from('bot_research_findings')
    .select('key_insights, id')
    .eq('category', 'injury_intel')
    .eq('research_date', gameDate)
    .order('created_at', { ascending: false })
    .limit(3);

  if (!data?.length) return researchBlocklist;

  const outPattern = /([A-Z][a-z]+ [A-Z][a-z]+)\s+(?:Out|OUT|ruled out|RULED OUT)/gi;
  for (const finding of data) {
    const insights = Array.isArray(finding.key_insights) 
      ? finding.key_insights.join(' ') 
      : String(finding.key_insights || '');
    let match;
    while ((match = outPattern.exec(insights)) !== null) {
      researchBlocklist.add(match[1].toLowerCase().trim());
    }
    outPattern.lastIndex = 0;
  }

  console.log(`[ResearchIntel] Found ${researchBlocklist.size} OUT players from research`);
  return researchBlocklist;
}

async function fetchResearchEdgeThreshold(supabase: any): Promise<number | null> {
  const { data } = await supabase
    .from('bot_research_findings')
    .select('key_insights, id')
    .eq('category', 'statistical_models')
    .eq('actionable', true)
    .is('action_taken', null)
    .order('relevance_score', { ascending: false })
    .limit(1);

  if (!data?.[0]) return null;
  
  const text = Array.isArray(data[0].key_insights) 
    ? data[0].key_insights.join(' ') 
    : String(data[0].key_insights || '');
  
  const edgeMatch = text.match(/edge\s*[>≥]\s*(\d+(?:\.\d+)?)\s*%/i);
  if (edgeMatch) {
    const threshold = parseFloat(edgeMatch[1]) / 100;
    console.log(`[ResearchIntel] Dynamic edge threshold from research: ${threshold}`);
    return threshold;
  }
  return null;
}

async function markResearchConsumed(supabase: any, gameDate: string): Promise<void> {
  const { error } = await supabase
    .from('bot_research_findings')
    .update({ action_taken: `Applied to generation on ${gameDate}` })
    .in('category', ['injury_intel', 'statistical_models', 'ncaa_baseball_pitching', 'weather_totals_impact', 'ncaab_kenpom_matchups', 'ncaab_injury_lineups', 'ncaab_sharp_signals'])
    .eq('research_date', gameDate)
    .is('action_taken', null);

  if (error) {
    console.warn(`[ResearchIntel] Failed to mark research consumed:`, error.message);
  } else {
    console.log(`[ResearchIntel] Marked research findings as consumed for ${gameDate}`);
  }
}

async function fetchResearchPitchingWeather(supabase: any, gameDate: string): Promise<Map<string, 'over' | 'under' | 'neutral'>> {
  const weatherBias = new Map<string, 'over' | 'under' | 'neutral'>();
  
  try {
    const { data: findings } = await supabase
      .from('bot_research_findings')
      .select('category, summary, key_insights')
      .in('category', ['ncaa_baseball_pitching', 'weather_totals_impact'])
      .eq('research_date', gameDate)
      .gte('relevance_score', 0.40);

    if (!findings || findings.length === 0) {
      console.log(`[ResearchIntel] No pitching/weather findings for ${gameDate}`);
      return weatherBias;
    }

    for (const f of findings) {
      const text = f.summary + ' ' + (Array.isArray(f.key_insights) ? f.key_insights.join(' ') : String(f.key_insights || ''));

      if (f.category === 'ncaa_baseball_pitching') {
        // Extract high-ERA starters (ERA >= 5.0) as over-friendly signals
        const eraMatches = text.matchAll(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*.*?ERA\s*[:\s]*(\d+\.\d+)/gi);
        for (const match of eraMatches) {
          const team = match[1].trim();
          const era = parseFloat(match[2]);
          if (era >= 5.0) {
            weatherBias.set(team.toLowerCase(), 'over');
            console.log(`[ResearchIntel] High-ERA starter flagged: ${team} (ERA ${era}) → over bias`);
          } else if (era <= 2.5) {
            weatherBias.set(team.toLowerCase(), 'under');
            console.log(`[ResearchIntel] Low-ERA starter flagged: ${team} (ERA ${era}) → under bias`);
          }
        }
      }

      if (f.category === 'weather_totals_impact') {
        // Wind blowing out = over-friendly
        if (/wind.*blow(?:ing)?\s*out/i.test(text) || /wind.*(?:1[0-9]|2[0-9])\s*mph/i.test(text)) {
          // Try to extract team names near wind mentions
          const windTeams = text.match(/(?:at|vs\.?|@)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g);
          if (windTeams) {
            for (const wt of windTeams) {
              const team = wt.replace(/^(?:at|vs\.?|@)\s+/i, '').trim().toLowerCase();
              if (team.length > 2) {
                weatherBias.set(team, 'over');
              }
            }
          }
        }
        // Cold + low humidity = under-friendly
        if (/cold|below\s*5[0-9]\s*°?F?|freezing/i.test(text) && /pitcher.friendly|low\s*humidity/i.test(text)) {
          console.log(`[ResearchIntel] Cold weather + pitcher-friendly conditions detected → under bias`);
        }
      }
    }

    console.log(`[ResearchIntel] Weather bias map: ${weatherBias.size} entries for ${gameDate}`);
  } catch (err) {
    console.warn(`[ResearchIntel] Error fetching pitching/weather research:`, err);
  }

  return weatherBias;
}

async function fetchResearchNcaabIntel(supabase: any, gameDate: string): Promise<{
  sharpBias: Map<string, 'over' | 'under' | 'spread_home' | 'spread_away'>;
  injuryImpact: Set<string>;
  tempoMismatches: Map<string, 'over' | 'under'>;
}> {
  const sharpBias = new Map<string, 'over' | 'under' | 'spread_home' | 'spread_away'>();
  const injuryImpact = new Set<string>();
  const tempoMismatches = new Map<string, 'over' | 'under'>();

  try {
    const { data: findings } = await supabase
      .from('bot_research_findings')
      .select('category, summary, key_insights')
      .in('category', ['ncaab_kenpom_matchups', 'ncaab_injury_lineups', 'ncaab_sharp_signals'])
      .eq('research_date', gameDate)
      .gte('relevance_score', 0.40);

    if (!findings || findings.length === 0) {
      console.log(`[ResearchIntel] No NCAAB research findings for ${gameDate}`);
      return { sharpBias, injuryImpact, tempoMismatches };
    }

    for (const f of findings) {
      const text = f.summary + ' ' + (Array.isArray(f.key_insights) ? f.key_insights.join(' ') : String(f.key_insights || ''));

      if (f.category === 'ncaab_kenpom_matchups') {
        // Detect tempo mismatches: fast-paced matchups favor overs
        const tempoMatches = text.matchAll(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*.*?(?:AdjT|tempo|pace)\s*[:\s]*(\d+(?:\.\d+)?)/gi);
        for (const match of tempoMatches) {
          const team = match[1].trim().toLowerCase();
          const tempo = parseFloat(match[2]);
          if (tempo >= 72) {
            tempoMismatches.set(team, 'over');
            console.log(`[ResearchIntel] NCAAB high-tempo team: ${team} (AdjT ${tempo}) → over lean`);
          } else if (tempo <= 63) {
            tempoMismatches.set(team, 'under');
            console.log(`[ResearchIntel] NCAAB low-tempo team: ${team} (AdjT ${tempo}) → under lean`);
          }
        }
      }

      if (f.category === 'ncaab_injury_lineups') {
        // Extract injured/out NCAAB players
        const outMatches = text.matchAll(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*(?:is\s+)?(?:out|ruled out|will not play|DNP|suspended|questionable)/gi);
        for (const match of outMatches) {
          const player = match[1].trim();
          if (player.length > 4 && player.length < 40) {
            injuryImpact.add(player);
          }
        }
        console.log(`[ResearchIntel] NCAAB injury intel: ${injuryImpact.size} players flagged`);
      }

      if (f.category === 'ncaab_sharp_signals') {
        // Extract sharp side signals: "sharp money on [team] [side]"
        const sharpOverMatches = text.matchAll(/sharp\s*(?:money|action|bettors?)\s*(?:on|loading|hammering)\s*(?:the\s+)?over\s*(?:in|for|:)?\s*([A-Z][a-z]+(?:\s+(?:vs\.?|at|@)\s+[A-Z][a-z]+)?)/gi);
        for (const match of sharpOverMatches) {
          const game = match[1].trim().toLowerCase();
          if (game.length > 2) sharpBias.set(game, 'over');
        }
        const sharpUnderMatches = text.matchAll(/sharp\s*(?:money|action|bettors?)\s*(?:on|loading|hammering)\s*(?:the\s+)?under\s*(?:in|for|:)?\s*([A-Z][a-z]+(?:\s+(?:vs\.?|at|@)\s+[A-Z][a-z]+)?)/gi);
        for (const match of sharpUnderMatches) {
          const game = match[1].trim().toLowerCase();
          if (game.length > 2) sharpBias.set(game, 'under');
        }
        // Line movement signals (3+ point moves)
        const lineMoveMatches = text.matchAll(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*.*?(?:moved|shifted|steamed)\s*(?:from\s*)?[-+]?\d+(?:\.\d+)?\s*to\s*([-+]?\d+(?:\.\d+)?)/gi);
        for (const match of lineMoveMatches) {
          const team = match[1].trim().toLowerCase();
          console.log(`[ResearchIntel] NCAAB line movement detected for: ${team}`);
        }
        console.log(`[ResearchIntel] NCAAB sharp signals: ${sharpBias.size} directional biases`);
      }
    }
  } catch (err) {
    console.warn(`[ResearchIntel] Error fetching NCAAB research:`, err);
  }

  return { sharpBias, injuryImpact, tempoMismatches };
}

// ============= PROP POOL BUILDER =============

async function buildPropPool(supabase: any, targetDate: string, weightMap: Map<string, number>, categoryWeights: CategoryWeight[]): Promise<PropPool> {
  console.log(`[Bot] Building prop pool for ${targetDate}`);

  // === AUTO-BLOCK LOW HIT-RATE CATEGORIES ===
  const blockedByHitRate = new Set<string>();
  categoryWeights.forEach(cw => {
    if (cw.current_hit_rate < 40 && (cw.total_picks || 0) >= 10) {
      blockedByHitRate.add(cw.category);
    }
  });
  if (blockedByHitRate.size > 0) {
    console.log(`[Bot] Auto-blocked ${blockedByHitRate.size} low hit-rate categories: ${[...blockedByHitRate].join(', ')}`);
  }

  // Build calibrated hit-rate lookup for composite score multipliers
  const calibratedHitRateMap = new Map<string, number>();
  categoryWeights.forEach(cw => {
    if (cw.current_hit_rate && cw.current_hit_rate > 0) {
      calibratedHitRateMap.set(cw.category, cw.current_hit_rate);
    }
  });

  // === AVAILABILITY GATE ===
  const { startUtc, endUtc, gameDate } = getEasternDateRange();
  console.log(`[Bot] ET window: ${startUtc} → ${endUtc} (gameDate: ${gameDate})`);

  const [activePlayersToday, injuryData, teamsPlayingToday, researchBlocklist, researchEdge, weatherBiasMap, ncaabResearch] = await Promise.all([
    fetchActivePlayersToday(supabase, startUtc, endUtc),
    fetchInjuryBlocklist(supabase, gameDate),
    fetchTeamsPlayingToday(supabase, startUtc, endUtc, gameDate),
    fetchResearchInjuryIntel(supabase, gameDate),
    fetchResearchEdgeThreshold(supabase),
    fetchResearchPitchingWeather(supabase, gameDate),
    fetchResearchNcaabIntel(supabase, gameDate),
  ]);
  const { blocklist, penalties } = injuryData;

  // Merge research injury intel into blocklist
  for (const player of researchBlocklist) {
    blocklist.add(player);
  }
  if (researchBlocklist.size > 0) {
    console.log(`[Bot] Merged ${researchBlocklist.size} research-sourced OUT players into blocklist`);
  }

  // Merge NCAAB research injury intel into blocklist
  for (const player of ncaabResearch.injuryImpact) {
    blocklist.add(player);
  }
  if (ncaabResearch.injuryImpact.size > 0) {
    console.log(`[Bot] Merged ${ncaabResearch.injuryImpact.size} NCAAB research-sourced injuries into blocklist`);
  }

  // Apply dynamic edge threshold from research if available
  if (researchEdge !== null) {
    for (const tierKey of Object.keys(TIER_CONFIG) as TierName[]) {
      const original = TIER_CONFIG[tierKey].minEdge;
      TIER_CONFIG[tierKey].minEdge = Math.max(original, researchEdge);
    }
    console.log(`[Bot] Applied research edge threshold: ${researchEdge} (overrides lower defaults)`);
  }

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
  const { data: rawTeamProps } = await supabase
    .from('game_bets')
    .select('*')
    .eq('is_active', true)
    .gte('commence_time', startUtc)
    .lt('commence_time', endUtc);

  // 4. Fetch team intelligence data in parallel (including NCAAB stats)
  const [paceResult, defenseResult, envResult, homeCourtResult, ncaabStatsResult] = await Promise.all([
    supabase.from('nba_team_pace_projections').select('team_abbrev, team_name, pace_rating, pace_rank, tempo_factor'),
    supabase.from('team_defense_rankings').select('team_abbreviation, team_name, overall_rank').eq('is_current', true),
    supabase.from('game_environment').select('home_team_abbrev, away_team_abbrev, vegas_total, vegas_spread, shootout_factor, grind_factor, blowout_probability').eq('game_date', gameDate),
    supabase.from('home_court_advantage_stats').select('team_name, home_win_rate, home_cover_rate, home_over_rate').eq('sport', 'basketball_nba'),
    supabase.from('ncaab_team_stats').select('team_name, conference, kenpom_rank, adj_offense, adj_defense, adj_tempo, home_record, away_record, ats_record, over_under_record'),
  ]);

  // Build lookup maps
  const paceMap = new Map<string, PaceData>();
  const nameToAbbrev = new Map<string, string>();
  (paceResult.data || []).forEach((p: any) => {
    paceMap.set(p.team_abbrev, { pace_rating: p.pace_rating, pace_rank: p.pace_rank, tempo_factor: p.tempo_factor });
    if (p.team_name) nameToAbbrev.set(p.team_name, p.team_abbrev);
  });

  const defenseMap = new Map<string, number>();
  (defenseResult.data || []).forEach((d: any) => {
    defenseMap.set(d.team_abbreviation, d.overall_rank);
    if (d.team_name) nameToAbbrev.set(d.team_name, d.team_abbreviation);
  });

  const envMap = new Map<string, GameEnvData>();
  (envResult.data || []).forEach((e: any) => {
    envMap.set(`${e.home_team_abbrev}_${e.away_team_abbrev}`, {
      vegas_total: e.vegas_total, vegas_spread: e.vegas_spread,
      shootout_factor: e.shootout_factor, grind_factor: e.grind_factor,
      blowout_probability: e.blowout_probability,
    });
  });

  const homeCourtMap = new Map<string, HomeCourtData>();
  (homeCourtResult.data || []).forEach((h: any) => {
    homeCourtMap.set(h.team_name, { home_win_rate: h.home_win_rate, home_cover_rate: h.home_cover_rate, home_over_rate: h.home_over_rate });
    const abbrev = nameToAbbrev.get(h.team_name);
    if (abbrev) homeCourtMap.set(abbrev, { home_win_rate: h.home_win_rate, home_cover_rate: h.home_cover_rate, home_over_rate: h.home_over_rate });
  });

  // Build NCAAB team stats map
  const ncaabStatsMap = new Map<string, NcaabTeamStats>();
  (ncaabStatsResult.data || []).forEach((t: any) => {
    ncaabStatsMap.set(t.team_name, t as NcaabTeamStats);
  });

  console.log(`[Bot] Intelligence data: ${paceMap.size} pace, ${defenseMap.size} defense, ${envMap.size} env, ${homeCourtMap.size} home court, ${ncaabStatsMap.size} NCAAB teams`);

  // Deduplicate game_bets by home_team + away_team + bet_type (keep most recent)
  const seenGameBets = new Map<string, TeamProp>();
  for (const game of (rawTeamProps || []) as TeamProp[]) {
    const key = `${game.home_team}_${game.away_team}_${game.bet_type}`;
    const existing = seenGameBets.get(key);
    if (!existing || (game.updated_at || '') > (existing.updated_at || '')) {
      seenGameBets.set(key, game);
    }
  }
  const teamProps = Array.from(seenGameBets.values());

  console.log(`[Bot] Raw data: ${(sweetSpots || []).length} sweet spots, ${(playerProps || []).length} unified_props, ${(rawTeamProps || []).length} raw team bets → ${teamProps.length} deduped`);

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
    // Check if this player has real sportsbook odds in unified_props (oddsMap)
    const oddsKey = `${pick.player_name}_${pick.prop_type}`.toLowerCase();
    const hasRealLine = oddsMap.has(oddsKey) || (pick.actual_line !== null && pick.actual_line !== undefined);
    
    const odds = oddsMap.get(oddsKey) || { overOdds: -110, underOdds: -110, line: 0, sport: 'basketball_nba' };
    const side = pick.recommended_side || 'over';
    const americanOdds = side === 'over' ? odds.overOdds : odds.underOdds;
    
    const hitRateDecimal = pick.l10_hit_rate || pick.confidence_score || 0.5;
    const hitRatePercent = hitRateDecimal * 100;
    const projectedValue = pick.projected_value || pick.l10_avg || pick.l10_median || line || 0;
    const edge = projectedValue - (line || 0);
    const categoryWeight = weightMap.get(`${pick.category}__${pick.recommended_side}`) ?? weightMap.get(pick.category) ?? 1.0;
    
    const oddsValueScore = calculateOddsValueScore(americanOdds, hitRateDecimal);
    const catHitRate = calibratedHitRateMap.get(pick.category);
    const compositeScore = calculateCompositeScore(hitRatePercent, edge, oddsValueScore, categoryWeight, catHitRate);
    
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
  }).filter((p: EnrichedPick) => p.americanOdds >= -200 && p.americanOdds <= 200 && !blockedByHitRate.has(p.category) && p.has_real_line);

  // Block NCAAB player props from ever entering the pick pool
  enrichedSweetSpots = enrichedSweetSpots.filter(p => p.sport !== 'basketball_ncaab');

  console.log(`[Bot] Filtered to ${enrichedSweetSpots.length} picks with verified sportsbook lines (removed projected-only legs, blocked NCAAB player props)`);

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
      const categoryWeight = weightMap.get(`${propCategory}__${prop.side || 'over'}`) ?? weightMap.get(propCategory) ?? 1.0;
      
      const oddsValueScore = calculateOddsValueScore(americanOdds, hitRateDecimal);
      const catHitRatePercent = calibratedHitRate ? calibratedHitRate * 100 : undefined;
      const compositeScore = calculateCompositeScore(hitRateDecimal * 100, 0.5, oddsValueScore, categoryWeight, catHitRatePercent);
      
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
      p.line > 0 &&
      !blockedByHitRate.has(p.category)
    );

    // Block NCAAB player props from fallback path too
    enrichedSweetSpots = enrichedSweetSpots.filter(p => p.sport !== 'basketball_ncaab');
    
    console.log(`[Bot] Fallback enriched ${enrichedSweetSpots.length} picks (calibrated hit rates from ${categoryHitRateMap.size} categories, blocked NCAAB player props)`);
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

  // === GAME SCHEDULE GATE ===
  if (teamsPlayingToday.size > 0) {
    const preScheduleCount = enrichedSweetSpots.length;
    const removedBySchedule: string[] = [];

    enrichedSweetSpots = enrichedSweetSpots.filter(pick => {
      const teamName = (pick.team_name || '').toLowerCase().trim();
      if (!teamName) return true; // No team info, rely on other gates
      if (teamsPlayingToday.has(teamName)) return true;
      removedBySchedule.push(`${pick.player_name} (${pick.team_name})`);
      return false;
    });

    console.log(`[GameSchedule] Filtered: ${preScheduleCount} -> ${enrichedSweetSpots.length} (removed ${removedBySchedule.length} players on teams not playing)`);
    if (removedBySchedule.length > 0) {
      console.log(`[GameSchedule] Removed: ${removedBySchedule.slice(0, 15).join(', ')}`);
    }
  } else {
    console.log(`[GameSchedule] WARNING: No teams found playing today - skipping schedule gate`);
  }

  // Enrich team props with real intelligence scoring
  // Resolve team names to abbreviations for lookup
  const resolveAbbrev = (teamName: string): string => {
    return nameToAbbrev.get(teamName) || teamName;
  };

  const enrichedTeamPicks: EnrichedTeamPick[] = (teamProps || []).flatMap((game: TeamProp) => {
    const picks: EnrichedTeamPick[] = [];
    const isPlusMoney = (odds: number | undefined) => odds !== undefined && odds > 0;
    
    // Create a version of the game with abbreviations for scoring
    const homeAbbrev = resolveAbbrev(game.home_team);
    const awayAbbrev = resolveAbbrev(game.away_team);
    const gameForScoring = { ...game, home_team: homeAbbrev, away_team: awayAbbrev };

    // Spread picks
    if (game.bet_type === 'spread' && game.line !== null && game.line !== undefined) {
      if (game.home_odds) {
        const plusBonus = isPlusMoney(game.home_odds) ? 5 : 0;
        const { score, breakdown } = calculateTeamCompositeScore(gameForScoring, 'spread', 'home', paceMap, defenseMap, envMap, homeCourtMap, ncaabStatsMap);
        picks.push({
          id: `${game.id}_spread_home`,
          type: 'team', sport: game.sport, home_team: game.home_team, away_team: game.away_team,
          bet_type: 'spread', side: 'home', line: game.line, odds: game.home_odds,
          category: mapTeamBetToCategory('spread', 'home'),
          sharp_score: game.sharp_score || 50,
          compositeScore: clampScore(30, 95, score + plusBonus),
          confidence_score: score / 100,
          score_breakdown: breakdown,
        });
      }
      if (game.away_odds) {
        const plusBonus = isPlusMoney(game.away_odds) ? 5 : 0;
        const { score, breakdown } = calculateTeamCompositeScore(gameForScoring, 'spread', 'away', paceMap, defenseMap, envMap, homeCourtMap, ncaabStatsMap);
        picks.push({
          id: `${game.id}_spread_away`,
          type: 'team', sport: game.sport, home_team: game.home_team, away_team: game.away_team,
          bet_type: 'spread', side: 'away', line: -(game.line), odds: game.away_odds,
          category: mapTeamBetToCategory('spread', 'away'),
          sharp_score: game.sharp_score || 50,
          compositeScore: clampScore(30, 95, score + plusBonus),
          confidence_score: score / 100,
          score_breakdown: breakdown,
        });
      }
    }
    
    // Total picks
    if (game.bet_type === 'total' && game.over_odds && game.under_odds) {
      const { score: overScore, breakdown: overBreakdown } = calculateTeamCompositeScore(gameForScoring, 'total', 'over', paceMap, defenseMap, envMap, homeCourtMap, ncaabStatsMap);
      const overPlusBonus = isPlusMoney(game.over_odds) ? 5 : 0;
      
      // Weather/pitching research bias adjustment for totals
      let overWeatherBonus = 0;
      let underWeatherBonus = 0;
      const homeKey = (game.home_team || '').toLowerCase();
      const awayKey = (game.away_team || '').toLowerCase();
      const homeBias = weatherBiasMap.get(homeKey);
      const awayBias = weatherBiasMap.get(awayKey);
      if (homeBias === 'over' || awayBias === 'over') {
        overWeatherBonus = 8;
        console.log(`[Bot] Weather/pitching over boost +8 for ${game.home_team} vs ${game.away_team}`);
      }
      if (homeBias === 'under' || awayBias === 'under') {
        underWeatherBonus = 8;
        console.log(`[Bot] Weather/pitching under boost +8 for ${game.home_team} vs ${game.away_team}`);
      }

      // NCAAB research bias adjustments (tempo + sharp signals)
      const isNcaab = game.sport === 'basketball_ncaab';
      if (isNcaab) {
        const homeTempo = ncaabResearch.tempoMismatches.get(homeKey);
        const awayTempo = ncaabResearch.tempoMismatches.get(awayKey);
        if (homeTempo === 'over' || awayTempo === 'over') {
          overWeatherBonus += 6;
          console.log(`[Bot] NCAAB tempo over boost +6 for ${game.home_team} vs ${game.away_team}`);
        }
        if (homeTempo === 'under' || awayTempo === 'under') {
          underWeatherBonus += 6;
          console.log(`[Bot] NCAAB tempo under boost +6 for ${game.home_team} vs ${game.away_team}`);
        }
        // Sharp money signals on totals
        const homeSharp = ncaabResearch.sharpBias.get(homeKey);
        const awaySharp = ncaabResearch.sharpBias.get(awayKey);
        if (homeSharp === 'over' || awaySharp === 'over') {
          overWeatherBonus += 7;
          console.log(`[Bot] NCAAB sharp over boost +7 for ${game.home_team} vs ${game.away_team}`);
        }
        if (homeSharp === 'under' || awaySharp === 'under') {
          underWeatherBonus += 7;
          console.log(`[Bot] NCAAB sharp under boost +7 for ${game.home_team} vs ${game.away_team}`);
        }
      }

      picks.push({
        id: `${game.id}_total_over`,
        type: 'team', sport: game.sport, home_team: game.home_team, away_team: game.away_team,
        bet_type: 'total', side: 'over', line: game.line || 0, odds: game.over_odds,
        category: mapTeamBetToCategory('total', 'over'),
        sharp_score: game.sharp_score || 50,
        compositeScore: clampScore(30, 95, overScore + overPlusBonus + overWeatherBonus),
        confidence_score: overScore / 100,
        score_breakdown: overBreakdown,
      });
      const { score: underScore, breakdown: underBreakdown } = calculateTeamCompositeScore(gameForScoring, 'total', 'under', paceMap, defenseMap, envMap, homeCourtMap, ncaabStatsMap);
      const underPlusBonus = isPlusMoney(game.under_odds) ? 5 : 0;
      picks.push({
        id: `${game.id}_total_under`,
        type: 'team', sport: game.sport, home_team: game.home_team, away_team: game.away_team,
        bet_type: 'total', side: 'under', line: game.line || 0, odds: game.under_odds,
        category: mapTeamBetToCategory('total', 'under'),
        sharp_score: game.sharp_score || 50,
        compositeScore: clampScore(30, 95, underScore + underPlusBonus + underWeatherBonus),
        confidence_score: underScore / 100,
        score_breakdown: underBreakdown,
      });
    }

    // Moneyline picks
    if (game.bet_type === 'h2h') {
      if (game.home_odds) {
        const plusBonus = isPlusMoney(game.home_odds) ? 5 : 0;
        const { score, breakdown } = calculateTeamCompositeScore(gameForScoring, 'moneyline', 'home', paceMap, defenseMap, envMap, homeCourtMap, ncaabStatsMap);
        picks.push({
          id: `${game.id}_ml_home`,
          type: 'team', sport: game.sport, home_team: game.home_team, away_team: game.away_team,
          bet_type: 'moneyline', side: 'home', line: 0, odds: game.home_odds,
          category: mapTeamBetToCategory('moneyline', 'home'),
          sharp_score: game.sharp_score || 50,
          compositeScore: clampScore(30, 95, score + plusBonus),
          confidence_score: score / 100,
          score_breakdown: breakdown,
        });
      }
      if (game.away_odds) {
        const plusBonus = isPlusMoney(game.away_odds) ? 5 : 0;
        const { score, breakdown } = calculateTeamCompositeScore(gameForScoring, 'moneyline', 'away', paceMap, defenseMap, envMap, homeCourtMap, ncaabStatsMap);
        picks.push({
          id: `${game.id}_ml_away`,
          type: 'team', sport: game.sport, home_team: game.home_team, away_team: game.away_team,
          bet_type: 'moneyline', side: 'away', line: 0, odds: game.away_odds,
          category: mapTeamBetToCategory('moneyline', 'away'),
          sharp_score: game.sharp_score || 50,
          compositeScore: clampScore(30, 95, score + plusBonus),
          confidence_score: score / 100,
          score_breakdown: breakdown,
        });
      }
    }
    
    return picks;
  });

  // === ML SNIPER GATE: Surgical moneyline filtering ===
  const preGateCount = enrichedTeamPicks.length;
  const mlBlocked: string[] = [];
  const filteredTeamPicks = enrichedTeamPicks.filter(pick => {
    const isNCAAB = pick.sport?.includes('ncaab') || pick.sport?.includes('college');
    const isNBA = pick.sport?.includes('nba');
    const isML = pick.bet_type === 'moneyline';

    // === ML-specific gates ===
    if (isML) {
      // Gate 1: Raise composite score floor for ALL ML picks to 70 (was 62)
      if (pick.compositeScore < 70) {
        mlBlocked.push(`${pick.home_team} vs ${pick.away_team} ML (composite ${pick.compositeScore.toFixed(0)} < 70)`);
        return false;
      }

      // Gate 2: Odds-value gate — block implied prob >85% or <30%
      const impliedProb = pick.odds < 0
        ? Math.abs(pick.odds) / (Math.abs(pick.odds) + 100)
        : 100 / (pick.odds + 100);
      if (impliedProb > 0.85) {
        mlBlocked.push(`${pick.home_team} vs ${pick.away_team} ML (implied ${(impliedProb * 100).toFixed(0)}% > 85% — too juicy)`);
        return false;
      }
      if (impliedProb < 0.30) {
        mlBlocked.push(`${pick.home_team} vs ${pick.away_team} ML (implied ${(impliedProb * 100).toFixed(0)}% < 30% — too risky)`);
        return false;
      }

      // Gate 3: NCAAB ML — restrict to Top 50 KenPom only
      if (isNCAAB) {
        const teamName = pick.side === 'home' ? pick.home_team : pick.away_team;
        const stats = ncaabStatsMap.get(teamName);
        const rank = stats?.kenpom_rank || 999;
        if (rank > 50) {
          mlBlocked.push(`${teamName} NCAAB ML (rank ${rank} > 50)`);
          return false;
        }
        // NCAAB favorites: only allow odds between -110 and -300
        if (pick.odds < 0 && (pick.odds < -300 || pick.odds > -110)) {
          mlBlocked.push(`${teamName} NCAAB ML fav (odds ${pick.odds} outside -110 to -300)`);
          return false;
        }
        // NCAAB underdogs: only allow odds between +150 and +350
        if (pick.odds > 0 && (pick.odds < 150 || pick.odds > 350)) {
          mlBlocked.push(`${teamName} NCAAB ML dog (odds +${pick.odds} outside +150 to +350)`);
          return false;
        }
      }

      // Gate 4: NBA ML — only home favorites between -110 and -300
      if (isNBA) {
        if (pick.side !== 'home') {
          mlBlocked.push(`${pick.away_team} NBA ML away (blocked — road ML too volatile)`);
          return false;
        }
        if (pick.odds >= 0 || pick.odds < -300 || pick.odds > -110) {
          mlBlocked.push(`${pick.home_team} NBA ML (odds ${pick.odds} outside home fav -110 to -300)`);
          return false;
        }
      }
    }

    // Non-ML NCAAB: keep composite floor at 62
    if (isNCAAB && !isML && pick.compositeScore < 62) {
      return false;
    }

    return true;
  });

  if (mlBlocked.length > 0) {
    console.log(`[ML Sniper] Blocked ${mlBlocked.length} picks: ${mlBlocked.slice(0, 10).join('; ')}`);
  }
  console.log(`[ML Sniper] Team picks: ${preGateCount} → ${filteredTeamPicks.length}`);

  // Replace enrichedTeamPicks with filtered version
  enrichedTeamPicks.length = 0;
  enrichedTeamPicks.push(...filteredTeamPicks);

  // Build golden categories set (60%+ hit rate with 20+ samples)
  const goldenCategories = new Set<string>();
  categoryWeights.forEach(cw => {
    if (cw.current_hit_rate >= 60 && (cw.total_picks || 0) >= 20) {
      goldenCategories.add(cw.category);
    }
  });
  if (goldenCategories.size > 0) {
    console.log(`[Bot] Golden categories (60%+ hit rate, 20+ samples): ${[...goldenCategories].join(', ')}`);
  }

  // Sort by composite score, then interleave with golden category priority
  enrichedSweetSpots.sort((a, b) => b.compositeScore - a.compositeScore);
  enrichedSweetSpots = interleaveByCategory(enrichedSweetSpots, goldenCategories);
  enrichedTeamPicks.sort((a, b) => b.compositeScore - a.compositeScore);

  console.log(`[Bot] Pool built: ${enrichedSweetSpots.length} player props, ${enrichedTeamPicks.length} team props`);

  return {
    playerPicks: enrichedSweetSpots,
    teamPicks: enrichedTeamPicks,
    sweetSpots: enrichedSweetSpots,
    totalPool: enrichedSweetSpots.length + enrichedTeamPicks.length,
    goldenCategories,
  };
}

// ============= DEDUPLICATION =============

/**
 * Create a fingerprint for a parlay based on its sorted leg keys.
 * Two parlays with the same set of player+prop+side (or team+bet+side) legs are duplicates.
 */
function createParlayFingerprint(legs: any[]): string {
  const keys = legs.map(leg => {
    if (leg.type === 'team') {
      return `T:${leg.home_team}_${leg.away_team}_${leg.bet_type}_${leg.side}`.toLowerCase();
    }
    return `P:${leg.player_name}_${leg.prop_type}_${leg.side}_${leg.line}`.toLowerCase();
  });
  return keys.sort().join('|');
}

// ============= TIER GENERATION =============

async function generateTierParlays(
  supabase: any,
  tier: TierName,
  targetDate: string,
  pool: PropPool,
  weightMap: Map<string, number>,
  strategyName: string,
  bankroll: number,
  globalFingerprints: Set<string> = new Set(),
  goldenCategories: Set<string> = new Set()
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
    const isHybridProfile = !!profile.allowTeamLegs && !isTeamProfile;
    const sportFilter = profile.sports || ['all'];
    
    // Filter picks based on profile
    let candidatePicks: (EnrichedPick | EnrichedTeamPick)[] = [];
    
    if (isTeamProfile) {
      candidatePicks = pool.teamPicks.filter(p => {
        if (!profile.betTypes!.includes(p.bet_type)) return false;
        // Apply sport filter so baseball profiles only get baseball picks, etc.
        if (sportFilter.includes('all')) return true;
        return sportFilter.includes(p.sport);
      });
      
      // team_hybrid_cross: filter to specific sports and ensure cross-sport mix
      if (profile.strategy === 'team_hybrid_cross' && profile.sports && !profile.sports.includes('all')) {
        candidatePicks = candidatePicks.filter(p => profile.sports!.includes(p.sport));
        // Sort: highest composite ML pick first (the 1 allowed ML leg), then spreads/totals
        candidatePicks = [...candidatePicks].sort((a, b) => {
          const aIsML = a.bet_type === 'moneyline';
          const bIsML = b.bet_type === 'moneyline';
          // ML picks first (they get picked as the 1 allowed ML leg)
          if (aIsML !== bIsML) return aIsML ? -1 : 1;
          return b.compositeScore - a.compositeScore;
        });
      }
      // team_hybrid: sort ML picks first, then spreads/totals
      if (profile.strategy === 'team_hybrid') {
        candidatePicks = [...candidatePicks].sort((a, b) => {
          const aIsML = a.bet_type === 'moneyline';
          const bIsML = b.bet_type === 'moneyline';
          if (aIsML !== bIsML) return aIsML ? -1 : 1;
          return b.compositeScore - a.compositeScore;
        });
      }
    } else if (isHybridProfile) {
      // HYBRID: player props first (sorted by hit rate), then team props appended
      const playerPicks = pool.sweetSpots.filter(p => {
        if (sportFilter.includes('all')) return true;
        return sportFilter.includes(p.sport || 'basketball_nba');
      });
      const teamPicks = pool.teamPicks
        .filter(p => {
          if (sportFilter.includes('all')) return true;
          return sportFilter.includes(p.sport);
        })
        .sort((a, b) => b.compositeScore - a.compositeScore);
      // Player props first, team props appended at the end
      candidatePicks = [...playerPicks, ...teamPicks];
      console.log(`[Bot] Hybrid pool: ${playerPicks.length} player + ${teamPicks.length} team picks`);
    } else {
      candidatePicks = pool.sweetSpots.filter(p => {
        if (sportFilter.includes('all')) return true;
        return sportFilter.includes(p.sport || 'basketball_nba');
      });
    }

    // Win-rate-first sorting: re-sort by L10 hit rate descending
    if (profile.sortBy === 'hit_rate') {
      candidatePicks = [...candidatePicks].sort((a, b) => {
        const aHitRate = 'l10_hit_rate' in a ? (a as EnrichedPick).l10_hit_rate : (a.confidence_score || 0);
        const bHitRate = 'l10_hit_rate' in b ? (b as EnrichedPick).l10_hit_rate : (b.confidence_score || 0);
        return bHitRate - aHitRate;
      });
    }

    // Execution tier: sort candidates by category weight descending to prioritize golden archetypes
    if (profile.sortBy !== 'hit_rate' && tier === 'execution') {
      candidatePicks = [...candidatePicks].sort((a, b) => {
        const aWeight = weightMap.get(`${a.category}__${a.recommended_side}`) ?? weightMap.get(a.category) ?? 1.0;
        const bWeight = weightMap.get(`${b.category}__${b.recommended_side}`) ?? weightMap.get(b.category) ?? 1.0;
        if (bWeight !== aWeight) return bWeight - aWeight;
        return (b.compositeScore || 0) - (a.compositeScore || 0);
      });
    }

    // Build parlay from candidates
    for (const pick of candidatePicks) {
      if (legs.length >= profile.legs) break;
      
      if (!canUsePickGlobally(pick, tracker, config)) continue;
      if (!canUsePickInParlay(pick, parlayTeamCount, parlayCategoryCount, config, legs)) continue;

      // Hybrid profile: cap team legs AND player legs to ensure mix
      if (isHybridProfile) {
        const isTeamPick = 'type' in pick && pick.type === 'team';
        const currentTeamLegs = legs.filter(l => l.type === 'team').length;
        const currentPlayerLegs = legs.filter(l => l.type !== 'team').length;
        const maxTeamLegs = profile.allowTeamLegs || 1;
        const maxPlayerLegs = profile.legs - maxTeamLegs;
        
        if (isTeamPick && currentTeamLegs >= maxTeamLegs) continue;
        if (!isTeamPick && currentPlayerLegs >= maxPlayerLegs) continue;
      }

      // ML Sniper: cap moneyline legs per parlay (maxMlLegs constraint)
      if (profile.maxMlLegs !== undefined && 'type' in pick && pick.type === 'team') {
        const teamPick = pick as EnrichedTeamPick;
        if (teamPick.bet_type === 'moneyline') {
          const currentMlLegs = legs.filter(l => l.bet_type === 'moneyline').length;
          if (currentMlLegs >= profile.maxMlLegs) continue;
        }
      }

      // Check profile-specific requirements
      const minHitRate = profile.minHitRate || config.minHitRate;
      const minOddsValue = profile.minOddsValue || DEFAULT_MIN_ODDS_VALUE;
      
      const pickConfidence = pick.confidence_score || ('sharp_score' in pick ? (pick as any).sharp_score / 100 : 0.5);
      const hitRatePercent = pickConfidence * 100;
      
      // For hybrid profiles, use a lower hit rate floor for team legs
      const effectiveMinHitRate = (isHybridProfile && 'type' in pick && pick.type === 'team') 
        ? Math.min(minHitRate, 55) 
        : minHitRate;
      if (hitRatePercent < effectiveMinHitRate) continue;
      
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
        const weight = weightMap.get(`${playerPick.category}__${playerPick.recommended_side}`) ?? weightMap.get(playerPick.category) ?? 1.0;
        
        // Select line based on profile (with boost leg limiting)
        const boostLimit = profile.boostLegs ?? (profile.useAltLines ? profile.legs : 0);
        const boostedCount = legs.filter(l => l.line_selection_reason && l.line_selection_reason !== 'main_line' && l.line_selection_reason !== 'safe_profile').length;

        const selectedLine = (profile.useAltLines && boostedCount < boostLimit)
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
          projection_buffer: (playerPick.projected_value || playerPick.l10_avg || 0) - selectedLine.line,
          projected_value: playerPick.projected_value || playerPick.l10_avg || 0,
          line_source: playerPick.line_source || 'projected',
          has_real_line: playerPick.has_real_line || false,
          sport: playerPick.sport || 'basketball_nba',
        };

        // NEGATIVE-EDGE GATE: Block legs where projection contradicts bet direction
        const projBuffer = legData.projection_buffer || 0;
        const projValue = legData.projected_value || 0;
        if (projValue > 0 && projBuffer < 0) {
          console.log(`[NegEdgeBlock] Blocked ${legData.player_name} ${legData.prop_type} ${legData.side} ${legData.line} (proj: ${projValue}, buffer: ${projBuffer.toFixed(1)})`);
          continue;
        }
        
        if (playerPick.team_name) {
          parlayTeamCount.set(playerPick.team_name, (parlayTeamCount.get(playerPick.team_name) || 0) + 1);
        }
      }
      
      legs.push(legData);
      parlayCategoryCount.set(pick.category, (parlayCategoryCount.get(pick.category) || 0) + 1);
    }

    // Only create parlay if we have enough legs
    if (legs.length < profile.legs) {
      if (tier === 'execution') {
        console.log(`[Bot] ${tier}/${profile.strategy}: only ${legs.length}/${profile.legs} legs built from ${candidatePicks.length} candidates`);
      }
    } else {
      // Cross-sport gate: require at least one leg from each specified sport
      if ((profile.strategy === 'team_hybrid_cross' || profile.strategy === 'team_ml_cross') && profile.sports && profile.sports.length > 1) {
        const legSports = new Set(legs.map(l => l.sport));
        const missingSports = profile.sports.filter(s => !legSports.has(s));
        if (missingSports.length > 0) {
          console.log(`[Bot] Skipping ${tier}/team_ml_cross: missing sports ${missingSports.join(', ')}`);
          continue;
        }
      }

      // Golden category gate — enabled for execution tier (Feb 11 analysis)
      // Team legs are exempt from the golden gate check (they don't have sweet-spot categories)
      const ENFORCE_GOLDEN_GATE = true;
      const skipGoldenGate = isHybridProfile || isTeamProfile;
      if (ENFORCE_GOLDEN_GATE && !skipGoldenGate && tier === 'execution' && goldenCategories.size > 0) {
        const playerLegs = legs.filter(l => l.type !== 'team');
        if (playerLegs.length > 0) {
          const goldenLegCount = playerLegs.filter(l => goldenCategories.has(l.category)).length;
          const minGoldenLegs = Math.max(1, playerLegs.length - 1); // Allow 1 non-golden player leg
          if (goldenLegCount < minGoldenLegs) {
            console.log(`[Bot] Skipping ${tier}/${profile.strategy}: only ${goldenLegCount}/${playerLegs.length} golden player legs (need ${minGoldenLegs})`);
            continue;
          }
        }
        // If no player legs (pure team parlay), skip golden gate entirely
      }

      // Deduplication: skip if identical leg combination already exists
      const fingerprint = createParlayFingerprint(legs);
      if (globalFingerprints.has(fingerprint)) {
        console.log(`[Bot] Skipping duplicate ${tier}/${profile.strategy} parlay (fingerprint match)`);
        continue;
      }
      globalFingerprints.add(fingerprint);

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
      
      // Calculate real sportsbook parlay odds by multiplying decimal odds of each leg
      const totalDecimalOdds = legs.reduce((product, l) => {
        const odds = l.american_odds || -110;
        const decimal = odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
        return product * decimal;
      }, 1);
      const expectedOdds = totalDecimalOdds >= 2
        ? Math.round((totalDecimalOdds - 1) * 100)   // positive American
        : Math.round(-100 / (totalDecimalOdds - 1));  // negative American
      
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
      if (combinedProbability < 0.001) { if (tier === 'execution') console.log(`[Bot] ${tier}/${profile.strategy}: failed prob (${combinedProbability.toFixed(4)})`); continue; }
      const effectiveMinEdge = (isHybridProfile || isTeamProfile) ? Math.min(config.minEdge, 0.008) : config.minEdge;
      if (effectiveEdge < effectiveMinEdge) { if (tier === 'execution') console.log(`[Bot] ${tier}/${profile.strategy}: failed edge (${effectiveEdge.toFixed(4)} < ${effectiveMinEdge})`); continue; }
      if (sharpe < config.minSharpe) { if (tier === 'execution') console.log(`[Bot] ${tier}/${profile.strategy}: failed sharpe (${sharpe.toFixed(4)} < ${config.minSharpe})`); continue; }

      // Calculate stake (flat $10 for all tiers)
      const stake = typeof config.stake === 'number' && config.stake > 0 ? config.stake : 10;

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
        tier: tier,
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
      // Side-aware key: category__side (e.g., VOLUME_SCORER__under)
      weightMap.set(`${w.category}__${w.side}`, w.weight);
      // Also keep category-only key as fallback (first non-blocked wins)
      if (!weightMap.has(w.category) || w.weight > 0) {
        weightMap.set(w.category, w.weight);
      }
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

    // === BANKROLL FLOOR PROTECTION ===
    const BANKROLL_FLOOR = 1000;
    if (bankroll <= BANKROLL_FLOOR) {
      console.log(`[Bot v2] Bankroll at floor ($${bankroll}). Pausing generation to protect capital.`);
      await supabase.from('bot_activity_log').insert({
        event_type: 'bankroll_floor_hit',
        message: `Bankroll at $${bankroll} (floor: $${BANKROLL_FLOOR}). Generation paused to protect capital.`,
        severity: 'warning',
        metadata: { bankroll, floor: BANKROLL_FLOOR },
      });
      try {
        await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
          body: JSON.stringify({ type: 'daily_summary', data: { parlaysCount: 0, winRate: 0, edge: 0, bankroll, mode: 'Paused - Bankroll Floor Protection' } }),
        });
      } catch (_) { /* ignore */ }
      return new Response(
        JSON.stringify({ success: true, parlaysGenerated: 0, reason: 'bankroll_floor_protection', bankroll }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Build prop pool
    const pool = await buildPropPool(supabase, targetDate, weightMap, weights as CategoryWeight[] || []);

    // Check if we have real odds data
    const realLinePicks = pool.playerPicks.filter(p => p.has_real_line);
    if (pool.totalPool < 20 || (realLinePicks.length < 5 && pool.teamPicks.length < 5)) {
      const reason = pool.totalPool < 20 
        ? `Insufficient prop pool (${pool.totalPool})` 
        : `No real odds data (${realLinePicks.length} real lines, ${pool.teamPicks.length} team picks)`;
      console.log(`[Bot v2] Skipping generation: ${reason}`);

      // Notify via Telegram
      try {
        await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            type: 'daily_summary',
            data: { parlaysCount: 0, winRate: 0, edge: 0, bankroll, mode: `Skipped - ${reason}` },
          }),
        });
      } catch (_) { /* ignore */ }

      return new Response(
        JSON.stringify({ 
          success: false, 
          message: reason,
          poolSize: pool.totalPool,
          realLinePicks: realLinePicks.length,
          parlaysGenerated: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Generate parlays for each tier
    // Reduce exposure if bankroll is near floor
    const isLowBankroll = bankroll < BANKROLL_FLOOR * 1.2; // Below $1,200
    let tiersToGenerate: TierName[] = singleTier 
      ? [singleTier] 
      : ['exploration', 'validation', 'execution'];
    if (isLowBankroll && !singleTier) {
      tiersToGenerate = tiersToGenerate.filter(t => t !== 'exploration');
      console.log(`[Bot v2] Low bankroll ($${bankroll}). Skipping exploration tier.`);
    }

    const results: Record<string, { count: number; parlays: any[] }> = {};
    let allParlays: any[] = [];

    // Pre-load existing fingerprints from DB to prevent cross-run duplicates
    const globalFingerprints = new Set<string>();
    const { data: existingParlays } = await supabase
      .from('bot_daily_parlays')
      .select('legs')
      .eq('parlay_date', targetDate);
    if (existingParlays) {
      for (const p of existingParlays) {
        const legs = Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs);
        globalFingerprints.add(createParlayFingerprint(legs));
      }
      console.log(`[Bot v2] Pre-loaded ${globalFingerprints.size} existing fingerprints for ${targetDate}`);
    }

    for (const tier of tiersToGenerate) {
      const result = await generateTierParlays(
        supabase,
        tier,
        targetDate,
        pool,
        weightMap,
        strategyName,
        bankroll,
        globalFingerprints,
        pool.goldenCategories
      );
      results[tier] = result;
      allParlays = [...allParlays, ...result.parlays];
    }

    console.log(`[Bot v2] Total parlays created: ${allParlays.length}`);

    // 6. Append new parlays (no longer deletes previous runs so multiple generations accumulate)
    console.log(`[Bot v2] Appending ${allParlays.length} new parlays for ${targetDate}`);

    if (allParlays.length > 0) {
      const { error: insertError } = await supabase
        .from('bot_daily_parlays')
        .insert(allParlays);

      if (insertError) throw insertError;

      // Mark research findings as consumed
      await markResearchConsumed(supabase, targetDate);
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
            exploration: results['exploration']?.count || 0,
            validation: results['validation']?.count || 0,
            execution: results['execution']?.count || 0,
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
