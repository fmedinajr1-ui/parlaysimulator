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

// ============= SPREAD CAP =============
const MAX_SPREAD_LINE = 10; // Spreads above this trigger alt line shopping or get blocked

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
    stake: 20,
    minConfidence: 0.45,
    profiles: [
      // Multi-sport exploration — capped at 4 legs max
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
      { legs: 4, strategy: 'explore_aggressive', sports: ['basketball_nba'] },
      { legs: 4, strategy: 'explore_aggressive', sports: ['all'] },
      { legs: 4, strategy: 'explore_aggressive', sports: ['all'] },
      { legs: 4, strategy: 'explore_longshot', sports: ['all'] },
      { legs: 4, strategy: 'explore_longshot', sports: ['all'] },
      // NCAAB exploration — totals/spreads focused
      { legs: 3, strategy: 'ncaab_totals', sports: ['basketball_ncaab'], betTypes: ['total'] },
      { legs: 3, strategy: 'ncaab_totals', sports: ['basketball_ncaab'], betTypes: ['total'] },
      { legs: 3, strategy: 'ncaab_totals', sports: ['basketball_ncaab'], betTypes: ['total'] },
      { legs: 3, strategy: 'ncaab_unders', sports: ['basketball_ncaab'], betTypes: ['total'] },
      { legs: 3, strategy: 'ncaab_unders', sports: ['basketball_ncaab'], betTypes: ['total'] },
      { legs: 3, strategy: 'ncaab_spreads', sports: ['basketball_ncaab'], betTypes: ['spread'] },
      { legs: 4, strategy: 'ncaab_spreads', sports: ['basketball_ncaab'], betTypes: ['spread'] },
      { legs: 3, strategy: 'ncaab_mixed', sports: ['basketball_ncaab'], betTypes: ['spread', 'total'] },
      // NCAA Baseball exploration — PAUSED (needs more data)
      // { legs: 3, strategy: 'baseball_totals', sports: ['baseball_ncaa'], betTypes: ['total'] },
      // { legs: 3, strategy: 'baseball_spreads', sports: ['baseball_ncaa'], betTypes: ['spread'] },
      // PGA Golf exploration — PAUSED (collecting outright data via BLOCKED_SPORTS)
      // { legs: 2, strategy: 'golf_outright', sports: ['golf_pga'], betTypes: ['outright'] },
      // { legs: 2, strategy: 'golf_outright', sports: ['golf_pga'], betTypes: ['outright'] },
      // { legs: 3, strategy: 'golf_cross', sports: ['golf_pga', 'basketball_nba'], betTypes: ['outright', 'spread', 'total'] },
      // Team props exploration — ML Sniper: hybrid profiles with maxMlLegs: 1
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
      // Cross-sport exploration — capped at 4 legs
      { legs: 3, strategy: 'cross_sport', sports: ['basketball_nba', 'icehockey_nhl'] },
      { legs: 3, strategy: 'cross_sport', sports: ['basketball_nba', 'basketball_ncaab'] },
      { legs: 3, strategy: 'cross_sport', sports: ['basketball_ncaab', 'icehockey_nhl'] },
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'] },
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'] },
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'] },
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'] },
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'] },
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'] },
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'] },
      { legs: 3, strategy: 'tennis_focus', sports: ['tennis_atp', 'tennis_wta', 'tennis_pingpong'] },
      { legs: 3, strategy: 'tennis_focus', sports: ['tennis_atp', 'tennis_wta', 'tennis_pingpong'] },
      // Table tennis exploration
      { legs: 3, strategy: 'table_tennis_focus', sports: ['tennis_pingpong'] },
      { legs: 3, strategy: 'table_tennis_focus', sports: ['tennis_pingpong'] },
      // Nighttime mixed
      { legs: 4, strategy: 'nighttime_mixed', sports: ['tennis_atp', 'tennis_wta', 'tennis_pingpong', 'icehockey_nhl'] },
      { legs: 4, strategy: 'nighttime_mixed', sports: ['tennis_atp', 'tennis_wta', 'tennis_pingpong', 'icehockey_nhl'] },
      { legs: 4, strategy: 'nhl_focus', sports: ['icehockey_nhl'] },
      { legs: 4, strategy: 'nhl_focus', sports: ['icehockey_nhl'] },
      { legs: 4, strategy: 'max_diversity', sports: ['all'] },
      { legs: 4, strategy: 'max_diversity', sports: ['all'] },
      { legs: 4, strategy: 'max_diversity', sports: ['all'] },
      { legs: 4, strategy: 'max_diversity', sports: ['all'] },
      { legs: 4, strategy: 'max_diversity', sports: ['all'] },
      { legs: 3, strategy: 'props_only', sports: ['basketball_nba'] },
      { legs: 3, strategy: 'props_only', sports: ['icehockey_nhl'] },
      { legs: 4, strategy: 'props_mixed', sports: ['basketball_nba', 'icehockey_nhl'] },
      { legs: 4, strategy: 'props_mixed', sports: ['all'] },
      { legs: 4, strategy: 'props_mixed', sports: ['all'] },
      // Whale signal exploration
      { legs: 2, strategy: 'whale_signal', sports: ['all'] },
      { legs: 3, strategy: 'whale_signal', sports: ['all'] },
      // NCAAB accuracy profiles (2-leg for light-slate resilience)
      { legs: 2, strategy: 'ncaab_accuracy_totals', sports: ['basketball_ncaab'], betTypes: ['total'], sortBy: 'composite' },
      { legs: 2, strategy: 'ncaab_accuracy_totals', sports: ['basketball_ncaab'], betTypes: ['total'], sortBy: 'composite' },
      { legs: 2, strategy: 'ncaab_accuracy_spreads', sports: ['basketball_ncaab'], betTypes: ['spread'], sortBy: 'composite' },
      { legs: 2, strategy: 'ncaab_accuracy_spreads', sports: ['basketball_ncaab'], betTypes: ['spread'], sortBy: 'composite' },
      { legs: 2, strategy: 'ncaab_accuracy_mixed', sports: ['basketball_ncaab'], betTypes: ['spread', 'total'], sortBy: 'composite' },
      { legs: 2, strategy: 'ncaab_accuracy_mixed', sports: ['basketball_ncaab'], betTypes: ['spread', 'total'], sortBy: 'composite' },
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
    stake: 20,
    minConfidence: 0.52,
    profiles: [
      // ALL 3-LEG: Validated tier capped at 3 legs for win rate optimization
      { legs: 3, strategy: 'validated_conservative', sports: ['basketball_nba'], minOddsValue: 45, minHitRate: 55 },
      { legs: 3, strategy: 'validated_conservative', sports: ['basketball_nba'], minOddsValue: 45, minHitRate: 55 },
      { legs: 3, strategy: 'validated_conservative', sports: ['icehockey_nhl'], minOddsValue: 45, minHitRate: 55 },
      { legs: 3, strategy: 'validated_ncaab_totals', sports: ['basketball_ncaab'], betTypes: ['total'], minOddsValue: 45, minHitRate: 55 },
      { legs: 3, strategy: 'validated_ncaab_spreads', sports: ['basketball_ncaab'], betTypes: ['spread'], minOddsValue: 45, minHitRate: 55 },
      // { legs: 3, strategy: 'validated_baseball_totals', sports: ['baseball_ncaa'], betTypes: ['total'], minOddsValue: 45, minHitRate: 55 }, // PAUSED
      { legs: 3, strategy: 'validated_balanced', sports: ['basketball_nba'], minOddsValue: 42, minHitRate: 55 },
      { legs: 3, strategy: 'validated_balanced', sports: ['basketball_nba', 'icehockey_nhl'], minOddsValue: 42, minHitRate: 55 },
      { legs: 3, strategy: 'validated_balanced', sports: ['basketball_nba', 'basketball_ncaab'], minOddsValue: 42, minHitRate: 55 },
      { legs: 3, strategy: 'validated_standard', sports: ['basketball_nba'], minOddsValue: 40, minHitRate: 55 },
      { legs: 3, strategy: 'validated_standard', sports: ['all'], minOddsValue: 40, minHitRate: 55 },
      { legs: 3, strategy: 'validated_standard', sports: ['all'], minOddsValue: 40, minHitRate: 55, useAltLines: true },
      { legs: 3, strategy: 'validated_team', betTypes: ['spread', 'total'], minOddsValue: 45, minHitRate: 55 },
      { legs: 3, strategy: 'validated_team', betTypes: ['spread', 'total'], minOddsValue: 45, minHitRate: 55 },
      { legs: 3, strategy: 'validated_team', betTypes: ['spread', 'total'], minOddsValue: 42, minHitRate: 55 },
      { legs: 3, strategy: 'validated_cross', sports: ['all'], minOddsValue: 42, minHitRate: 55 },
      { legs: 3, strategy: 'validated_aggressive', sports: ['all'], minOddsValue: 40, minHitRate: 52, useAltLines: true },
      { legs: 3, strategy: 'validated_tennis', sports: ['tennis_atp', 'tennis_wta', 'tennis_pingpong'], betTypes: ['moneyline', 'total'], minOddsValue: 45, minHitRate: 52 },
      { legs: 3, strategy: 'validated_nighttime', sports: ['tennis_atp', 'tennis_wta', 'tennis_pingpong', 'icehockey_nhl'], betTypes: ['moneyline', 'total', 'spread'], minOddsValue: 42, minHitRate: 52 },
      { legs: 3, strategy: 'validated_winrate', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'validated_winrate', sports: ['basketball_nba'], minHitRate: 58, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'proving_cash', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
      { legs: 3, strategy: 'proving_cash', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
      { legs: 3, strategy: 'proving_boosted', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: true, boostLegs: 2, minBufferMultiplier: 1.5 },
      { legs: 3, strategy: 'proving_boost', sports: ['all'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: true, boostLegs: 2, preferPlusMoney: true, minBufferMultiplier: 1.2 },
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
    stake: 20,
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
      { legs: 3, strategy: 'ncaab_unders', sports: ['basketball_ncaab'], betTypes: ['total'], minHitRate: 55, sortBy: 'composite' },
      { legs: 3, strategy: 'ncaab_spreads', sports: ['basketball_ncaab'], betTypes: ['spread'], minHitRate: 55, sortBy: 'composite' },
      { legs: 3, strategy: 'ncaab_mixed', sports: ['basketball_ncaab'], betTypes: ['spread', 'total'], minHitRate: 55, sortBy: 'composite' },
      // NCAA Baseball execution — PAUSED (needs more data)
      // { legs: 3, strategy: 'baseball_totals', sports: ['baseball_ncaa'], betTypes: ['total'], minHitRate: 55, sortBy: 'composite' },
      // Whale signal execution
      { legs: 2, strategy: 'whale_signal', sports: ['all'], minHitRate: 55, sortBy: 'composite' },
    ],
  },
};

// ============= BLOCKED SPORTS (paused until more data collected) =============
const BLOCKED_SPORTS = ['baseball_ncaa', 'golf_pga'];

// ============= STALE ODDS DETECTION =============
const STALE_ODDS_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

function isStaleOdds(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return true; // No timestamp = stale
  const updatedTime = new Date(updatedAt).getTime();
  const now = Date.now();
  return (now - updatedTime) > STALE_ODDS_THRESHOLD_MS;
}

// ============= SPORT-SHIFT WEIGHTING =============
// When dominant sports (NBA) are dark, boost available sports
const SPORT_SHIFT_WEIGHTS: Record<string, number> = {
  'basketball_nba': 1.0,
  'icehockey_nhl': 1.0,
  'basketball_ncaab': 1.0,
  'tennis_atp': 1.0,
  'tennis_wta': 1.0,
  'tennis_pingpong': 1.0,
  'golf_pga': 1.0,
};

function computeSportShiftMultipliers(availableSports: Set<string>): Map<string, number> {
  const multipliers = new Map<string, number>();
  const dominantSports = ['basketball_nba', 'icehockey_nhl'];
  const dominantMissing = dominantSports.filter(s => !availableSports.has(s));
  
  if (dominantMissing.length === 0) {
    // All dominant sports present — no shift needed
    for (const sport of availableSports) multipliers.set(sport, 1.0);
    return multipliers;
  }
  
  // Calculate boost: redistribute missing dominant weight across available sports
  const boostPerSport = (dominantMissing.length * 0.3) / Math.max(availableSports.size, 1);
  for (const sport of availableSports) {
    multipliers.set(sport, 1.0 + boostPerSport);
  }
  console.log(`[SportShift] Dominant sports dark: ${dominantMissing.join(', ')}. Boosting available sports by +${(boostPerSport * 100).toFixed(0)}%`);
  return multipliers;
}

// ============= DYNAMIC STAKE SIZING =============
function getDynamicStake(tier: TierName, isLightSlate: boolean, baseStake: number): number {
  if (!isLightSlate) return baseStake;
  // Light-slate: full for execution, half for validation, quarter for exploration
  switch (tier) {
    case 'execution': return baseStake;         // $100 stays $100
    case 'validation': return baseStake * 0.5;  // $100 → $50
    case 'exploration': return baseStake * 0.25; // $100 → $25
    default: return baseStake;
  }
}

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

  // CRITICAL: Block teams with no KenPom data — cap at 40 (below selection threshold)
  if (!homeStats || !awayStats) {
    breakdown.no_data_penalty = -15;
    return { score: 40, breakdown };
  }

  // Also block if either team is missing key efficiency data
  if (!homeStats.adj_offense || !homeStats.adj_defense || !awayStats.adj_offense || !awayStats.adj_defense) {
    breakdown.missing_efficiency = -15;
    return { score: 40, breakdown };
  }

  const homeOff = homeStats.adj_offense;
  const homeDef = homeStats.adj_defense;
  const awayOff = awayStats.adj_offense;
  const awayDef = awayStats.adj_defense;
  const homeRank = homeStats.kenpom_rank || 200;
  const awayRank = awayStats.kenpom_rank || 200;
  const homeTempo = homeStats.adj_tempo || 67;
  const awayTempo = awayStats.adj_tempo || 67;

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

    // === NEW: Projected total sanity check for OVERs ===
    if (side === 'over') {
      const avgTempo = (homeTempo + awayTempo) / 2;
      const avgD1PPG = 70;
      const projectedTotal = (homeOff + awayOff - homeDef - awayDef + avgD1PPG * 2) * (avgTempo / 67);
      const line = game.line || 0;
      if (line > projectedTotal + 5) {
        score -= 10;
        breakdown.line_above_projection = -10;
      }
    }

    // === NEW: Defensive matchup penalty for OVERs ===
    // Both teams with strong defense (adj_defense < 70 = allow < 70 ppg) makes OVER risky
    if (side === 'over' && homeDef < 70 && awayDef < 70) {
      score -= 12;
      breakdown.both_strong_defense = -12;
    }

    // === NEW: UNDER bonus for low-scoring matchups ===
    // Both teams scoring below average (< 72 adj_offense) favors UNDER
    if (side === 'under' && homeOff < 72 && awayOff < 72) {
      score += 8;
      breakdown.low_scoring_teams = 8;
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
  ncaabStatsMap?: Map<string, NcaabTeamStats>,
  nhlStatsMap?: Map<string, NhlTeamStats>,
  baseballStatsMap?: Map<string, BaseballTeamStats>
): { score: number; breakdown: Record<string, number> } {
  const sport = (game.sport || '').toLowerCase();

  // Route NCAAB games to specialized scoring
  if ((sport.includes('ncaab') || sport.includes('college')) && ncaabStatsMap && ncaabStatsMap.size > 0) {
    return calculateNcaabTeamCompositeScore(game, betType, side, ncaabStatsMap);
  }

  // Route NHL to dedicated scoring
  if (sport.includes('nhl') || sport.includes('icehockey')) {
    return calculateNhlTeamCompositeScore(game, betType, side, nhlStatsMap);
  }

   // Route NCAA Baseball to dedicated scoring
  if (sport.includes('baseball')) {
    return calculateBaseballTeamCompositeScore(game, betType, side, baseballStatsMap);
  }

  // Route Golf to dedicated scoring
  if (sport.includes('golf')) {
    return calculateGolfCompositeScore(game, betType, side);
  }

  // Route Tennis to dedicated scoring
  if (sport.includes('tennis') || sport.includes('pingpong')) {
    return calculateTennisCompositeScore(game, betType, side);
  }

  // Route WNBA to dedicated scoring (adjusted NBA)
  if (sport.includes('wnba')) {
    return calculateWnbaTeamCompositeScore(game, betType, side, paceMap, defenseMap, envMap, homeCourtMap);
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

// ============= GOLF SCORING ENGINE =============
// Golf outrights: player_name in home_team, tournament in away_team, odds in home_odds
function calculateGolfCompositeScore(
  game: TeamProp,
  betType: string,
  side: string
): { score: number; breakdown: Record<string, number> } {
  let score = 50;
  const breakdown: Record<string, number> = { base: 50 };

  // Only outright bets are supported for golf
  if (betType !== 'outright') {
    breakdown.unsupported_bet_type = -20;
    return { score: 30, breakdown };
  }

  const odds = game.home_odds || 0;

  // === Odds Value (35% weight) ===
  // Plus-money outrights have implied probability edge opportunities
  const impliedProb = americanToImplied(odds);

  // Sweet spot: +500 to +3000 range (longshots with value)
  if (odds >= 500 && odds <= 3000) {
    const oddsBonus = Math.round((1 / impliedProb - 5) * 2); // Reward longer odds
    score += clampScore(0, 15, oddsBonus);
    breakdown.odds_value = clampScore(0, 15, oddsBonus);
  } else if (odds >= 200 && odds < 500) {
    // Short favorites: moderate value
    score += 5;
    breakdown.odds_value = 5;
  } else if (odds > 3000) {
    // Extreme longshots: too risky for parlays
    score -= 10;
    breakdown.extreme_longshot = -10;
  } else if (odds < 200 && odds > 0) {
    // Heavy favorite in outright = low value
    score -= 5;
    breakdown.low_value_favorite = -5;
  }

  // === Course History Proxy (25% weight) ===
  // Without real course history data, we use odds tier as a proxy
  // Top-10 odds players (implied prob > 5%) get a course fitness bonus
  if (impliedProb > 0.05 && impliedProb < 0.20) {
    score += 8;
    breakdown.contender_tier = 8;
  } else if (impliedProb >= 0.02 && impliedProb <= 0.05) {
    score += 4;
    breakdown.mid_field_tier = 4;
  }

  // === Recent Form Proxy (20% weight) ===
  // Approximated via odds positioning — top-15 implied players are in form
  if (impliedProb > 0.03) {
    const formBonus = Math.round(impliedProb * 50);
    score += clampScore(0, 10, formBonus);
    breakdown.form_proxy = clampScore(0, 10, formBonus);
  }

  // === Field Strength (10% weight) ===
  // Major tournaments get a bonus (more data, more predictable)
  const tournament = (game.away_team || '').toLowerCase();
  if (tournament.includes('masters') || tournament.includes('pga championship') || 
      tournament.includes('u.s. open') || tournament.includes('open championship')) {
    score += 5;
    breakdown.major_tournament = 5;
  }

  // === Weather/Course Fit Placeholder (10%) ===
  // No data yet — neutral weight
  breakdown.weather_placeholder = 0;

  return { score: clampScore(30, 95, score), breakdown };
}

// ============= NHL TEAM STATS INTERFACE =============
interface NhlTeamStats {
  team_abbrev: string;
  team_name: string;
  shots_for_per_game: number;
  shots_against_per_game: number;
  shot_differential: number;
  goals_for_per_game: number;
  goals_against_per_game: number;
  games_played: number;
  wins: number;
  losses: number;
  save_pct: number;
  win_pct: number;
}

// ============= BASEBALL TEAM STATS INTERFACE =============
interface BaseballTeamStats {
  team_name: string;
  national_rank: number | null;
  runs_per_game: number | null;
  runs_allowed_per_game: number | null;
  era: number | null;
  batting_avg: number | null;
  home_record: string | null;
  away_record: string | null;
}

// ============= NHL SCORING ENGINE =============
function calculateNhlTeamCompositeScore(
  game: TeamProp,
  betType: string,
  side: string,
  nhlStatsMap?: Map<string, NhlTeamStats>
): { score: number; breakdown: Record<string, number> } {
  let score = 50;
  const breakdown: Record<string, number> = { base: 50 };

  if (!nhlStatsMap || nhlStatsMap.size === 0) {
    breakdown.no_data = -10;
    return { score: 40, breakdown };
  }

  const resolveNhl = (name: string): NhlTeamStats | undefined => {
    const direct = nhlStatsMap.get(name);
    if (direct) return direct;
    const lower = name.toLowerCase();
    for (const [k, v] of nhlStatsMap) {
      if (k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase())) return v;
    }
    return undefined;
  };

  const homeStats = resolveNhl(game.home_team);
  const awayStats = resolveNhl(game.away_team);

  if (!homeStats || !awayStats) {
    breakdown.missing_team = -10;
    return { score: 40, breakdown };
  }

  if (betType === 'total') {
    // Save percentage: higher = fewer goals = UNDER (25% weight)
    const avgSavePct = (homeStats.save_pct + awayStats.save_pct) / 2;
    if (side === 'under' && avgSavePct > 0.910) {
      const saveBonus = Math.round((avgSavePct - 0.900) * 250);
      score += clampScore(0, 15, saveBonus);
      breakdown.save_pct = clampScore(0, 15, saveBonus);
    } else if (side === 'over' && avgSavePct < 0.900) {
      const saveBonus = Math.round((0.910 - avgSavePct) * 200);
      score += clampScore(0, 12, saveBonus);
      breakdown.low_save_pct = clampScore(0, 12, saveBonus);
    }

    // Goals-against average (20% weight)
    const avgGAA = (homeStats.goals_against_per_game + awayStats.goals_against_per_game) / 2;
    if (side === 'under' && avgGAA < 2.8) {
      const gaaBonus = Math.round((3.0 - avgGAA) * 30);
      score += clampScore(0, 12, gaaBonus);
      breakdown.low_gaa = clampScore(0, 12, gaaBonus);
    } else if (side === 'over' && avgGAA > 3.2) {
      const gaaBonus = Math.round((avgGAA - 3.0) * 25);
      score += clampScore(0, 10, gaaBonus);
      breakdown.high_gaa = clampScore(0, 10, gaaBonus);
    }

    // Shots on goal for OVER (15% weight)
    const avgShots = (homeStats.shots_for_per_game + awayStats.shots_for_per_game) / 2;
    if (side === 'over' && avgShots > 32) {
      const shotBonus = Math.round((avgShots - 30) * 3);
      score += clampScore(0, 10, shotBonus);
      breakdown.high_shots = clampScore(0, 10, shotBonus);
    }

    // Shot suppression for UNDER (15% weight)
    const avgShotsAgainst = (homeStats.shots_against_per_game + awayStats.shots_against_per_game) / 2;
    if (side === 'under' && avgShotsAgainst < 28) {
      const suppressBonus = Math.round((30 - avgShotsAgainst) * 3);
      score += clampScore(0, 10, suppressBonus);
      breakdown.shot_suppression = clampScore(0, 10, suppressBonus);
    }
  }

  if (betType === 'spread' || betType === 'moneyline') {
    // Shot differential (strongest predictor for game winner)
    const homeShotDiff = homeStats.shot_differential;
    const awayShotDiff = awayStats.shot_differential;
    const diffEdge = side === 'home' ? homeShotDiff - awayShotDiff : awayShotDiff - homeShotDiff;
    const shotBonus = clampScore(-12, 12, diffEdge * 1.5);
    score += shotBonus;
    breakdown.shot_differential = shotBonus;

    // Save percentage edge
    const sideSave = side === 'home' ? homeStats.save_pct : awayStats.save_pct;
    const oppSave = side === 'home' ? awayStats.save_pct : homeStats.save_pct;
    if (sideSave > oppSave + 0.01) {
      const saveEdge = Math.round((sideSave - oppSave) * 500);
      score += clampScore(0, 8, saveEdge);
      breakdown.save_edge = clampScore(0, 8, saveEdge);
    }

    // Win % edge
    const sideWinPct = side === 'home' ? homeStats.win_pct : awayStats.win_pct;
    const oppWinPct = side === 'home' ? awayStats.win_pct : homeStats.win_pct;
    const winEdge = sideWinPct - oppWinPct;
    if (winEdge > 0.05) {
      const winBonus = Math.round(winEdge * 60);
      score += clampScore(0, 8, winBonus);
      breakdown.win_pct_edge = clampScore(0, 8, winBonus);
    }

    // Home ice advantage (~2 pts, weaker than NBA)
    if (side === 'home') {
      score += 3;
      breakdown.home_ice = 3;
    }
  }

  // Penalize heavy ML favorites
  if (betType === 'moneyline') {
    const odds = side === 'home' ? (game.home_odds || -110) : (game.away_odds || -110);
    const impliedProb = americanToImplied(odds);
    if (impliedProb > 0.70) {
      score -= 10;
      breakdown.heavy_fav_penalty = -10;
    }
  }

  return { score: clampScore(30, 95, score), breakdown };
}

// ============= NCAA BASEBALL SCORING ENGINE =============
function calculateBaseballTeamCompositeScore(
  game: TeamProp,
  betType: string,
  side: string,
  baseballStatsMap?: Map<string, BaseballTeamStats>
): { score: number; breakdown: Record<string, number> } {
  let score = 50;
  const breakdown: Record<string, number> = { base: 50 };

  if (!baseballStatsMap || baseballStatsMap.size === 0) {
    breakdown.no_data = -10;
    return { score: 40, breakdown };
  }

  const resolveBaseball = (name: string): BaseballTeamStats | undefined => {
    const direct = baseballStatsMap.get(name);
    if (direct) return direct;
    const lower = name.toLowerCase();
    for (const [k, v] of baseballStatsMap) {
      if (k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase())) return v;
    }
    return undefined;
  };

  const homeStats = resolveBaseball(game.home_team);
  const awayStats = resolveBaseball(game.away_team);

  if (!homeStats || !awayStats) {
    breakdown.missing_team = -10;
    return { score: 40, breakdown };
  }

  if (betType === 'total') {
    // ERA matchup (30% weight) — lower combined ERA = fewer runs = UNDER
    const homeERA = homeStats.era || 4.5;
    const awayERA = awayStats.era || 4.5;
    const avgERA = (homeERA + awayERA) / 2;
    if (side === 'under' && avgERA < 3.5) {
      const eraBonus = Math.round((4.0 - avgERA) * 15);
      score += clampScore(0, 15, eraBonus);
      breakdown.low_era = clampScore(0, 15, eraBonus);
    } else if (side === 'over' && avgERA > 5.0) {
      const eraBonus = Math.round((avgERA - 4.0) * 10);
      score += clampScore(0, 12, eraBonus);
      breakdown.high_era = clampScore(0, 12, eraBonus);
    }

    // Run differential (20% weight)
    const homeRPG = homeStats.runs_per_game || 5;
    const awayRPG = awayStats.runs_per_game || 5;
    const combinedRPG = homeRPG + awayRPG;
    if (side === 'over' && combinedRPG > 12) {
      const runBonus = Math.round((combinedRPG - 10) * 3);
      score += clampScore(0, 10, runBonus);
      breakdown.high_scoring = clampScore(0, 10, runBonus);
    } else if (side === 'under' && combinedRPG < 8) {
      const runBonus = Math.round((10 - combinedRPG) * 3);
      score += clampScore(0, 10, runBonus);
      breakdown.low_scoring = clampScore(0, 10, runBonus);
    }

    // Batting average (15% weight)
    const homeBA = homeStats.batting_avg || 0.260;
    const awayBA = awayStats.batting_avg || 0.260;
    const avgBA = (homeBA + awayBA) / 2;
    if (side === 'over' && avgBA > 0.280) {
      const baBonus = Math.round((avgBA - 0.260) * 200);
      score += clampScore(0, 8, baBonus);
      breakdown.high_batting = clampScore(0, 8, baBonus);
    } else if (side === 'under' && avgBA < 0.240) {
      const baBonus = Math.round((0.260 - avgBA) * 200);
      score += clampScore(0, 8, baBonus);
      breakdown.low_batting = clampScore(0, 8, baBonus);
    }
  }

  if (betType === 'spread' || betType === 'moneyline') {
    // ERA differential (30% weight) — pitcher matchup is king
    const sideERA = side === 'home' ? (homeStats.era || 4.5) : (awayStats.era || 4.5);
    const oppERA = side === 'home' ? (awayStats.era || 4.5) : (homeStats.era || 4.5);
    // Lower ERA is better — so opponent having higher ERA is good for us
    const eraDiff = oppERA - sideERA;
    const eraBonus = clampScore(-15, 15, eraDiff * 5);
    score += eraBonus;
    breakdown.era_edge = eraBonus;

    // Run differential (20% weight)
    const sideRPG = side === 'home' ? (homeStats.runs_per_game || 5) : (awayStats.runs_per_game || 5);
    const sideRA = side === 'home' ? (homeStats.runs_allowed_per_game || 5) : (awayStats.runs_allowed_per_game || 5);
    const runDiff = sideRPG - sideRA;
    if (runDiff > 1) {
      const runBonus = Math.round(runDiff * 4);
      score += clampScore(0, 10, runBonus);
      breakdown.run_diff = clampScore(0, 10, runBonus);
    }

    // Home field advantage (15% weight) — massive in college baseball
    if (side === 'home') {
      score += 6;
      breakdown.home_field = 6;
      // Extra boost for strong home records
      if (homeStats.home_record) {
        const hr = parseRecord(homeStats.home_record);
        if (hr.rate > 0.65 && hr.wins + hr.losses >= 8) {
          const hrBonus = Math.round((hr.rate - 0.55) * 30);
          score += clampScore(0, 8, hrBonus);
          breakdown.strong_home = clampScore(0, 8, hrBonus);
        }
      }
    }

    // National rank (10% weight)
    const sideRank = side === 'home' ? (homeStats.national_rank || 999) : (awayStats.national_rank || 999);
    const oppRank = side === 'home' ? (awayStats.national_rank || 999) : (homeStats.national_rank || 999);
    if (sideRank <= 25 && oppRank > 50) {
      score += 8;
      breakdown.rank_mismatch = 8;
    } else if (sideRank <= 50 && oppRank > 100) {
      score += 5;
      breakdown.rank_edge = 5;
    }
  }

  // Penalize heavy ML favorites
  if (betType === 'moneyline') {
    const odds = side === 'home' ? (game.home_odds || -110) : (game.away_odds || -110);
    const impliedProb = americanToImplied(odds);
    if (impliedProb > 0.75) {
      score -= 10;
      breakdown.heavy_fav_penalty = -10;
    }
  }

  return { score: clampScore(30, 95, score), breakdown };
}

// ============= TENNIS SCORING ENGINE =============
function calculateTennisCompositeScore(
  game: TeamProp,
  betType: string,
  side: string
): { score: number; breakdown: Record<string, number> } {
  let score = 50;
  const breakdown: Record<string, number> = { base: 50 };

  // Tennis has limited structured data — use odds-implied analysis
  const sideOdds = side === 'home' ? (game.home_odds || -110) : (game.away_odds || -110);
  const oppOdds = side === 'home' ? (game.away_odds || -110) : (game.home_odds || -110);
  const sideProb = americanToImplied(sideOdds);
  const oppProb = americanToImplied(oppOdds);

  if (betType === 'moneyline' || betType === 'h2h') {
    // Ranking differential via implied probability gap
    const probGap = sideProb - oppProb;
    if (probGap > 0.15) {
      const rankBonus = Math.round(probGap * 40);
      score += clampScore(0, 12, rankBonus);
      breakdown.ranking_edge = clampScore(0, 12, rankBonus);
    } else if (probGap < -0.15) {
      score -= 8;
      breakdown.underdog_penalty = -8;
    }

    // Penalize heavy favorites (> -300)
    if (sideProb > 0.75) {
      score -= 12;
      breakdown.heavy_fav_penalty = -12;
    }

    // Plus money value
    if (sideOdds > 0 && sideProb > 0.40) {
      score += 6;
      breakdown.plus_money_value = 6;
    }
  }

  if (betType === 'total' || betType === 'spread') {
    // Sets totals: use line proximity to common outcomes (2 or 3 sets)
    const line = game.line || 0;
    if (betType === 'total') {
      // Most matches are 2 or 3 sets; totals around 22-23 games are common
      if (side === 'under' && line > 23) {
        score += 6;
        breakdown.high_total_under = 6;
      } else if (side === 'over' && line < 21) {
        score += 6;
        breakdown.low_total_over = 6;
      }
    }
    if (betType === 'spread') {
      // Large spreads in tennis (> 4.5 games) favor favorites
      const absLine = Math.abs(line);
      if (absLine > 5) {
        score -= 5;
        breakdown.large_spread_risk = -5;
      }
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
  whalePicks: EnrichedPick[];
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

// === GAP 2: Per-leg minimum score gate by parlay size ===
function minScoreByParlaySize(legs: number): number {
  if (legs <= 2) return 60;  // 2-leg parlays: lower floor for NCAAB accuracy profiles
  if (legs <= 3) return 80;
  if (legs <= 5) return 90;
  return 95;
}

// === GAP 3: Leg-count penalty (house edge cost) ===
function parlayLegCountPenalty(legsCount: number): number {
  return 1 - 0.03 * Math.max(0, legsCount - 3);
}

// === GAP 4: Same-game correlation detection ===
function hasSameGameCorrelation(legs: any[]): boolean {
  const eventIds = new Set<string>();
  const matchups = new Set<string>();
  for (const leg of legs) {
    // Check event_id overlap
    const eventId = leg.id?.split('_')[0] || leg.event_id || '';
    if (eventId && eventIds.has(eventId)) return true;
    if (eventId) eventIds.add(eventId);
    // Check home_team + away_team overlap
    if (leg.home_team && leg.away_team) {
      const matchupKey = [leg.home_team, leg.away_team].sort().join('__').toLowerCase();
      if (matchups.has(matchupKey)) return true;
      matchups.add(matchupKey);
    }
  }
  return false;
}

// === GAP 5: Parlay-level composite score floor by tier ===
function parlayScoreFloor(tier: string): number {
  if (tier === 'exploration') return 75;
  if (tier === 'validation') return 80;
  return 85; // execution
}

function calculateCompositeScore(
  hitRate: number,
  edge: number,
  oddsValueScore: number,
  categoryWeight: number,
  calibratedHitRate?: number,
  side?: string,
  legCount?: number
): number {
  const hitRateScore = Math.min(100, hitRate);
  const edgeScore = Math.min(100, Math.max(0, edge * 20 + 50));
  const weightScore = categoryWeight * 66.67;
  
  // === GAP 1: Dynamic hit-rate weight by parlay size ===
  // When building 4+ leg parlays, shift weight to emphasize hit rate (50%)
  const isLongParlay = (legCount ?? 0) >= 4;
  const hitWeight = isLongParlay ? 0.50 : 0.40;
  const edgeWeight = 0.20;
  const oddsWeight = isLongParlay ? 0.15 : 0.20;
  const catWeight = isLongParlay ? 0.15 : 0.20;

  let baseScore = Math.round(
    (hitRateScore * hitWeight) +
    (edgeScore * edgeWeight) +
    (oddsValueScore * oddsWeight) +
    (weightScore * catWeight)
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

  // === FIX 4: Boost player prop UNDERs — 74% historical hit rate ===
  if (side === 'under') {
    baseScore = Math.round(baseScore * 1.15);
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

function mapTeamBetToCategory(betType: string, side: string, odds?: number): string {
  if (betType === 'moneyline') {
    if (odds !== undefined && odds !== 0) {
      return odds < 0 ? 'ML_FAVORITE' : 'ML_UNDERDOG';
    }
    // Fallback when odds unavailable: home=favorite, away=underdog
    return side === 'home' ? 'ML_FAVORITE' : 'ML_UNDERDOG';
  }
  const categoryMap: Record<string, Record<string, string>> = {
    spread: { home: 'SHARP_SPREAD', away: 'SHARP_SPREAD' },
    total: { over: 'OVER_TOTAL', under: 'UNDER_TOTAL' },
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
    .in('category', ['injury_intel', 'statistical_models', 'ncaa_baseball_pitching', 'weather_totals_impact', 'ncaab_kenpom_matchups', 'ncaab_injury_lineups', 'ncaab_sharp_signals', 'nba_nhl_sharp_signals', 'value_line_discrepancies', 'situational_spots', 'tennis_sharp_signals', 'tennis_form_matchups', 'table_tennis_signals'])
    .eq('research_date', gameDate)
    .is('action_taken', null);

  if (error) {
    console.warn(`[ResearchIntel] Failed to mark research consumed:`, error.message);
  } else {
    console.log(`[ResearchIntel] Marked research findings as consumed for ${gameDate}`);
  }
}

// ============= TENNIS / TABLE TENNIS RESEARCH INTELLIGENCE =============

interface TennisIntelSignal {
  boost: number;
  direction: string;
  reason: string;
}

async function fetchResearchTennisIntel(supabase: any, gameDate: string): Promise<Map<string, TennisIntelSignal>> {
  const tennisIntel = new Map<string, TennisIntelSignal>();

  try {
    const { data: findings } = await supabase
      .from('bot_research_findings')
      .select('category, summary, key_insights')
      .in('category', ['tennis_sharp_signals', 'tennis_form_matchups', 'table_tennis_signals'])
      .eq('research_date', gameDate)
      .gte('relevance_score', 0.40);

    if (!findings || findings.length === 0) {
      console.log(`[TennisIntel] No tennis/TT research findings for ${gameDate}`);
      return tennisIntel;
    }

    for (const finding of findings) {
      const text = `${finding.summary} ${(finding.key_insights || []).join(' ')}`.toLowerCase();

      // Extract player names and signals using pattern matching
      if (finding.category === 'tennis_sharp_signals') {
        // Look for sharp money signals with player names
        const sharpPatterns = [
          /(?:sharp|professional|steam|whale)\s+(?:money|action|move)\s+(?:on|loading|backing)\s+([a-z\s.'-]+?)(?:\s+(?:at|to|moneyline|ml|over|under|match))/gi,
          /([a-z][a-z\s.'-]{3,25})\s+(?:has|seeing|getting)\s+(?:sharp|steam|whale|professional)\s+(?:money|action)/gi,
          /(?:line\s+move|steam\s+move|reverse\s+line)\s+(?:on|for|towards)\s+([a-z][a-z\s.'-]{3,25})/gi,
        ];
        for (const pattern of sharpPatterns) {
          let match;
          while ((match = pattern.exec(text)) !== null) {
            const playerName = match[1].trim().toLowerCase();
            if (playerName.length > 3 && playerName.length < 30 && !playerName.includes('total') && !playerName.includes('game')) {
              const existing = tennisIntel.get(playerName);
              const newBoost = 7;
              if (!existing || existing.boost < newBoost) {
                tennisIntel.set(playerName, { boost: newBoost, direction: 'sharp', reason: 'tennis sharp signal' });
              }
            }
          }
        }
      }

      if (finding.category === 'tennis_form_matchups') {
        // Hot streak detection (4+ wins in last 5)
        const hotPatterns = [
          /([a-z][a-z\s.'-]{3,25})\s+(?:is|has been|on a)\s+(?:hot|strong|excellent|dominant|winning)\s+(?:streak|form|run)/gi,
          /([a-z][a-z\s.'-]{3,25})\s+(?:won|winning)\s+(?:4|5|6|7|8|9|10)\s+(?:of|out of)\s+(?:last|their last)/gi,
          /([a-z][a-z\s.'-]{3,25})\s+(?:4|5)-(?:0|1)\s+(?:in|over)\s+(?:last|recent)/gi,
        ];
        for (const pattern of hotPatterns) {
          let match;
          while ((match = pattern.exec(text)) !== null) {
            const playerName = match[1].trim().toLowerCase();
            if (playerName.length > 3 && playerName.length < 30) {
              const existing = tennisIntel.get(playerName);
              if (!existing || existing.boost < 6) {
                tennisIntel.set(playerName, { boost: 6, direction: 'hot_form', reason: 'hot streak' });
              }
            }
          }
        }

        // Cold/fatigue detection
        const coldPatterns = [
          /([a-z][a-z\s.'-]{3,25})\s+(?:is|has been|on a)\s+(?:cold|poor|struggling|losing|fatigued|tired)/gi,
          /([a-z][a-z\s.'-]{3,25})\s+(?:lost|losing)\s+(?:3|4|5|6|7)\s+(?:of|out of)\s+(?:last|their last)/gi,
          /(?:fatigue|exhaustion|tired|3rd\+?\s+match)\s+(?:for|concern|flag|warning)\s+([a-z][a-z\s.'-]{3,25})/gi,
          /([a-z][a-z\s.'-]{3,25})\s+(?:playing|played)\s+(?:3rd|4th|5th|3\+)\s+match/gi,
        ];
        for (const pattern of coldPatterns) {
          let match;
          while ((match = pattern.exec(text)) !== null) {
            const playerName = match[1].trim().toLowerCase();
            if (playerName.length > 3 && playerName.length < 30) {
              tennisIntel.set(playerName, { boost: -4, direction: 'cold_fatigued', reason: 'cold/fatigued' });
            }
          }
        }

        // Surface specialist detection (70%+ win rate on surface)
        const surfacePatterns = [
          /([a-z][a-z\s.'-]{3,25})\s+(?:has|with|boasts)\s+(?:a\s+)?(?:7[0-9]|8[0-9]|9[0-9])%?\s+(?:win\s+rate|record)\s+on\s+(?:hard|clay|grass)/gi,
          /([a-z][a-z\s.'-]{3,25})\s+(?:specialist|dominant|strong)\s+on\s+(?:hard|clay|grass)\s+(?:court|surface)/gi,
        ];
        for (const pattern of surfacePatterns) {
          let match;
          while ((match = pattern.exec(text)) !== null) {
            const playerName = match[1].trim().toLowerCase();
            if (playerName.length > 3 && playerName.length < 30) {
              const existing = tennisIntel.get(playerName);
              const newBoost = (existing?.boost || 0) + 5;
              tennisIntel.set(playerName, { 
                boost: Math.min(newBoost, 12), 
                direction: existing?.direction || 'surface_specialist', 
                reason: `${existing?.reason || ''} + surface specialist`.trim() 
              });
            }
          }
        }
      }

      if (finding.category === 'table_tennis_signals') {
        // Table tennis sharp signals
        const ttSharpPatterns = [
          /(?:sharp|professional|steam)\s+(?:money|action|move)\s+(?:on|loading|backing)\s+([a-z][a-z\s.'-]{3,25})/gi,
          /([a-z][a-z\s.'-]{3,25})\s+(?:has|seeing|getting)\s+(?:sharp|steam|professional)\s+(?:money|action)/gi,
        ];
        for (const pattern of ttSharpPatterns) {
          let match;
          while ((match = pattern.exec(text)) !== null) {
            const playerName = match[1].trim().toLowerCase();
            if (playerName.length > 3 && playerName.length < 30) {
              const existing = tennisIntel.get(playerName);
              if (!existing || existing.boost < 6) {
                tennisIntel.set(playerName, { boost: 6, direction: 'tt_sharp', reason: 'table tennis sharp signal' });
              }
            }
          }
        }

        // Table tennis fatigue
        const ttFatiguePatterns = [
          /([a-z][a-z\s.'-]{3,25})\s+(?:is|has been|on)\s+(?:fatigued|tired|3\+\s+match|back-to-back)/gi,
          /(?:fatigue|exhaustion|3\+\s+match\s+day)\s+(?:for|concern|flag)\s+([a-z][a-z\s.'-]{3,25})/gi,
        ];
        for (const pattern of ttFatiguePatterns) {
          let match;
          while ((match = pattern.exec(text)) !== null) {
            const playerName = match[1].trim().toLowerCase();
            if (playerName.length > 3 && playerName.length < 30) {
              tennisIntel.set(playerName, { boost: -3, direction: 'tt_fatigued', reason: 'table tennis fatigue' });
            }
          }
        }
      }
    }

    console.log(`[TennisIntel] Extracted ${tennisIntel.size} player signals from tennis/TT research`);
    for (const [player, signal] of tennisIntel) {
      console.log(`[TennisIntel]   ${player}: boost=${signal.boost > 0 ? '+' : ''}${signal.boost} (${signal.reason})`);
    }
  } catch (err) {
    console.warn(`[TennisIntel] Error fetching tennis/TT research:`, err);
  }

  return tennisIntel;
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

// === NEW: Fetch NBA/NHL whale signals, value discrepancies, and situational spots ===
async function fetchResearchWhaleAndSituational(supabase: any, gameDate: string): Promise<{
  whaleSignals: Map<string, { direction: 'over' | 'under' | 'home' | 'away'; boost: number }>;
  valueDiscrepancies: Map<string, { direction: 'over' | 'under' | 'home' | 'away'; boost: number }>;
  situationalSpots: Map<string, { type: string; direction: 'over' | 'under' | 'home' | 'away'; boost: number }>;
}> {
  const whaleSignals = new Map<string, { direction: 'over' | 'under' | 'home' | 'away'; boost: number }>();
  const valueDiscrepancies = new Map<string, { direction: 'over' | 'under' | 'home' | 'away'; boost: number }>();
  const situationalSpots = new Map<string, { type: string; direction: 'over' | 'under' | 'home' | 'away'; boost: number }>();

  try {
    const { data: findings } = await supabase
      .from('bot_research_findings')
      .select('category, summary, key_insights')
      .in('category', ['nba_nhl_sharp_signals', 'value_line_discrepancies', 'situational_spots'])
      .eq('research_date', gameDate)
      .gte('relevance_score', 0.40);

    if (!findings || findings.length === 0) {
      console.log(`[ResearchIntel] No whale/value/situational findings for ${gameDate}`);
      return { whaleSignals, valueDiscrepancies, situationalSpots };
    }

    for (const f of findings) {
      const text = f.summary + ' ' + (Array.isArray(f.key_insights) ? f.key_insights.join(' ') : String(f.key_insights || ''));

      if (f.category === 'nba_nhl_sharp_signals') {
        // Extract sharp/whale signals on overs/unders
        const overMatches = text.matchAll(/(?:sharp|whale|syndicate|steam)\s*(?:money|action|bettors?)?\s*(?:on|loading|hammering)\s*(?:the\s+)?over\s*(?:in|for|:)?\s*(?:the\s+)?([A-Z][a-z]+(?:\s+(?:vs\.?|at|@|-)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)?)/gi);
        for (const match of overMatches) {
          const key = match[1].trim().toLowerCase().split(/\s+/)[0]; // First team name
          whaleSignals.set(key, { direction: 'over', boost: 8 });
          console.log(`[ResearchIntel] NBA/NHL whale OVER signal: ${key}`);
        }
        const underMatches = text.matchAll(/(?:sharp|whale|syndicate|steam)\s*(?:money|action|bettors?)?\s*(?:on|loading|hammering)\s*(?:the\s+)?under\s*(?:in|for|:)?\s*(?:the\s+)?([A-Z][a-z]+(?:\s+(?:vs\.?|at|@|-)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)?)/gi);
        for (const match of underMatches) {
          const key = match[1].trim().toLowerCase().split(/\s+/)[0];
          whaleSignals.set(key, { direction: 'under', boost: 8 });
          console.log(`[ResearchIntel] NBA/NHL whale UNDER signal: ${key}`);
        }
        // Spread signals
        const spreadMatches = text.matchAll(/(?:sharp|whale)\s*(?:money|action)?\s*(?:on|loading)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*(?:[-+]\d)/gi);
        for (const match of spreadMatches) {
          const key = match[1].trim().toLowerCase();
          whaleSignals.set(key, { direction: 'home', boost: 7 }); // Direction refined by context
        }
        console.log(`[ResearchIntel] NBA/NHL whale signals: ${whaleSignals.size} detected`);
      }

      if (f.category === 'value_line_discrepancies') {
        // Extract value plays: "X-point value on [team]" or "models project [team] by X"
        const valueMatches = text.matchAll(/(\d+(?:\.\d+)?)[- ]+point\s+(?:value|edge|discrepancy)\s+(?:on|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi);
        for (const match of valueMatches) {
          const gap = parseFloat(match[1]);
          const team = match[2].trim().toLowerCase();
          if (gap >= 3) {
            valueDiscrepancies.set(team, { direction: 'home', boost: Math.min(10, Math.round(gap * 1.5)) });
            console.log(`[ResearchIntel] Value discrepancy: ${team} (${gap}pt edge) → +${Math.min(10, Math.round(gap * 1.5))} boost`);
          }
        }
        // Total value: "over/under value by X points"
        const totalValueMatches = text.matchAll(/(?:over|under)\s*(?:value|edge)\s*(?:by\s*)?(\d+(?:\.\d+)?)\s*(?:points?)?\s*(?:in|for|:)?\s*([A-Z][a-z]+(?:\s+(?:vs\.?|at|@)\s+[A-Z][a-z]+)?)/gi);
        for (const match of totalValueMatches) {
          const gap = parseFloat(match[1]);
          const key = match[2].trim().toLowerCase().split(/\s+/)[0];
          const dir = text.toLowerCase().includes('over') ? 'over' : 'under';
          if (gap >= 3) {
            valueDiscrepancies.set(key + '_total', { direction: dir as any, boost: Math.min(9, Math.round(gap * 1.2)) });
          }
        }
        console.log(`[ResearchIntel] Value discrepancies: ${valueDiscrepancies.size} detected`);
      }

      if (f.category === 'situational_spots') {
        // Extract situational angles
        const situations = [
          { regex: /letdown\s*(?:spot|game).*?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi, type: 'letdown', boost: 6, direction: 'away' as const },
          { regex: /revenge\s*(?:game|spot|matchup).*?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi, type: 'revenge', boost: 5, direction: 'home' as const },
          { regex: /(?:fatigue|tired|exhausted|back-to-back|b2b).*?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi, type: 'fatigue', boost: 7, direction: 'away' as const },
          { regex: /lookahead\s*(?:spot|game).*?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi, type: 'lookahead', boost: 6, direction: 'away' as const },
        ];
        for (const sit of situations) {
          const matches = text.matchAll(sit.regex);
          for (const match of matches) {
            const team = match[1].trim().toLowerCase();
            if (team.length > 2 && team.length < 30) {
              situationalSpots.set(team, { type: sit.type, direction: sit.direction, boost: sit.boost });
              console.log(`[ResearchIntel] Situational ${sit.type}: ${team} → +${sit.boost} boost for opponent`);
            }
          }
        }
        console.log(`[ResearchIntel] Situational spots: ${situationalSpots.size} detected`);
      }
    }
  } catch (err) {
    console.warn(`[ResearchIntel] Error fetching whale/situational research:`, err);
  }

  return { whaleSignals, valueDiscrepancies, situationalSpots };
}

// ============= PROP POOL BUILDER =============

async function buildPropPool(supabase: any, targetDate: string, weightMap: Map<string, number>, categoryWeights: CategoryWeight[], isLightSlateMode: boolean = false): Promise<PropPool> {
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

  const [activePlayersToday, injuryData, teamsPlayingToday, researchBlocklist, researchEdge, weatherBiasMap, ncaabResearch, whaleAndSituational, tennisIntel] = await Promise.all([
    fetchActivePlayersToday(supabase, startUtc, endUtc),
    fetchInjuryBlocklist(supabase, gameDate),
    fetchTeamsPlayingToday(supabase, startUtc, endUtc, gameDate),
    fetchResearchInjuryIntel(supabase, gameDate),
    fetchResearchEdgeThreshold(supabase),
    fetchResearchPitchingWeather(supabase, gameDate),
    fetchResearchNcaabIntel(supabase, gameDate),
    fetchResearchWhaleAndSituational(supabase, gameDate),
    fetchResearchTennisIntel(supabase, gameDate),
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

  // === GAME CONTEXT FLAGS (revenge, B2B fatigue, blowout, thin slate) ===
  interface GameContextFlag {
    type: string;
    game_id?: string;
    home_team?: string;
    away_team?: string;
    team?: string;
    sport?: string;
    penalty?: number;
    boost?: number;
    max_legs_override?: number;
    game_count?: number;
  }

  let gameContextFlags: GameContextFlag[] = [];
  let thinSlateOverride = false;
  let maxLegsOverride: number | null = null;

  try {
    const { data: contextFindings } = await supabase
      .from('bot_research_findings')
      .select('key_insights')
      .eq('category', 'game_context')
      .eq('research_date', gameDate)
      .order('created_at', { ascending: false })
      .limit(1);

    if (contextFindings?.[0]?.key_insights) {
      const insights = contextFindings[0].key_insights as string[];
      const jsonInsight = insights.find((i: string) => i.startsWith('{'));
      if (jsonInsight) {
        const parsed = JSON.parse(jsonInsight);
        gameContextFlags = parsed.context_flags || [];
      }
    }

    const thinSlateFlag = gameContextFlags.find(f => f.type === 'thin_slate');
    if (thinSlateFlag) {
      thinSlateOverride = true;
      maxLegsOverride = thinSlateFlag.max_legs_override || 3;
      console.log(`[Bot] THIN SLATE MODE: ${thinSlateFlag.game_count} games, max legs overridden to ${maxLegsOverride}`);
    }

    console.log(`[Bot] Game context flags: ${gameContextFlags.length} (revenge=${gameContextFlags.filter(f => f.type === 'revenge_game').length}, b2b=${gameContextFlags.filter(f => f.type === 'b2b_fatigue').length}, blowout=${gameContextFlags.filter(f => f.type === 'blowout_risk').length})`);
  } catch (ctxErr) {
    console.warn(`[Bot] Failed to load game context flags:`, ctxErr);
  }

  // Build lookup maps for context penalties/boosts
  const b2bTeams = new Set<string>();
  const blowoutGames = new Map<string, number>();
  const revengeGames = new Map<string, number>();

  for (const flag of gameContextFlags) {
    if (flag.type === 'b2b_fatigue' && flag.team) {
      b2bTeams.add(flag.team.toLowerCase());
    }
    if (flag.type === 'blowout_risk') {
      if (flag.home_team) blowoutGames.set(flag.home_team.toLowerCase(), flag.penalty || -8);
      if (flag.away_team) blowoutGames.set(flag.away_team.toLowerCase(), flag.penalty || -8);
    }
    if (flag.type === 'revenge_game') {
      if (flag.home_team) revengeGames.set(flag.home_team.toLowerCase(), flag.boost || 5);
      if (flag.away_team) revengeGames.set(flag.away_team.toLowerCase(), flag.boost || 5);
    }
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

  // 4. Whale picks from whale_picks table
  const { data: rawWhalePicks } = await supabase
    .from('whale_picks')
    .select('*')
    .eq('is_expired', false)
    .gte('sharp_score', 45)
    .gte('start_time', startUtc)
    .lte('start_time', endUtc)
    .order('sharp_score', { ascending: false })
    .limit(30);

  console.log(`[Bot] Fetched ${(rawWhalePicks || []).length} whale picks (sharp_score >= 45)`);

  // 4. Fetch team intelligence data in parallel (including NCAAB stats)
  const [paceResult, defenseResult, envResult, homeCourtResult, ncaabStatsResult, nhlStatsResult, baseballStatsResult] = await Promise.all([
    supabase.from('nba_team_pace_projections').select('team_abbrev, team_name, pace_rating, pace_rank, tempo_factor'),
    supabase.from('team_defense_rankings').select('team_abbreviation, team_name, overall_rank').eq('is_current', true),
    supabase.from('game_environment').select('home_team_abbrev, away_team_abbrev, vegas_total, vegas_spread, shootout_factor, grind_factor, blowout_probability').eq('game_date', gameDate),
    supabase.from('home_court_advantage_stats').select('team_name, home_win_rate, home_cover_rate, home_over_rate').eq('sport', 'basketball_nba'),
    supabase.from('ncaab_team_stats').select('team_name, conference, kenpom_rank, adj_offense, adj_defense, adj_tempo, home_record, away_record, ats_record, over_under_record'),
    supabase.from('nhl_team_pace_stats').select('team_abbrev, team_name, shots_for_per_game, shots_against_per_game, shot_differential, goals_for_per_game, goals_against_per_game, games_played, wins, losses, save_pct, win_pct'),
    supabase.from('ncaa_baseball_team_stats').select('team_name, national_rank, runs_per_game, runs_allowed_per_game, era, batting_avg, home_record, away_record'),
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

  // Build NHL team stats map
  const nhlStatsMap = new Map<string, NhlTeamStats>();
  (nhlStatsResult.data || []).forEach((t: any) => {
    nhlStatsMap.set(t.team_abbrev, t as NhlTeamStats);
    if (t.team_name) nhlStatsMap.set(t.team_name, t as NhlTeamStats);
  });

  // Build Baseball team stats map
  const baseballStatsMap = new Map<string, BaseballTeamStats>();
  (baseballStatsResult.data || []).forEach((t: any) => {
    baseballStatsMap.set(t.team_name, t as BaseballTeamStats);
  });

  // Build NCAA Baseball teams set for quality gate
  const baseballTeamsSet = new Set<string>();
  (baseballStatsResult.data || []).forEach((t: any) => baseballTeamsSet.add(t.team_name));

  console.log(`[Bot] Intelligence data: ${paceMap.size} pace, ${defenseMap.size} defense, ${envMap.size} env, ${homeCourtMap.size} home court, ${ncaabStatsMap.size} NCAAB teams, ${nhlStatsMap.size} NHL teams, ${baseballStatsMap.size} baseball teams`);

  console.log(`[Bot] Intelligence data: ${paceMap.size} pace, ${defenseMap.size} defense, ${envMap.size} env, ${homeCourtMap.size} home court, ${ncaabStatsMap.size} NCAAB teams, ${baseballTeamsSet.size} baseball teams`);

  // Deduplicate game_bets by home_team + away_team + bet_type (prefer FanDuel > DraftKings > others)
  const BOOK_PRIORITY: Record<string, number> = { fanduel: 3, draftkings: 2 };
  const getBookPriority = (b: string) => BOOK_PRIORITY[b?.toLowerCase()] || 1;
  const seenGameBets = new Map<string, TeamProp>();
  for (const game of (rawTeamProps || []) as TeamProp[]) {
    const key = `${game.home_team}_${game.away_team}_${game.bet_type}`;
    const existing = seenGameBets.get(key);
    if (!existing || getBookPriority((game as any).bookmaker) > getBookPriority((existing as any).bookmaker)) {
      seenGameBets.set(key, game);
    }
  }
  const allTeamProps = Array.from(seenGameBets.values());

  // === STALE ODDS FILTER ===
  const staleCount = allTeamProps.filter(tp => isStaleOdds(tp.updated_at)).length;
  const teamProps = allTeamProps.filter(tp => {
    if (isStaleOdds(tp.updated_at)) {
      return false; // Skip picks with odds data > 6 hours old
    }
    return true;
  });
  if (staleCount > 0) {
    console.log(`[StaleOdds] Filtered out ${staleCount} team props with odds data > 6 hours old`);
  }

  // === SPORT-SHIFT WEIGHTING ===
  const availableSports = new Set<string>();
  teamProps.forEach(tp => { if (tp.sport) availableSports.add(tp.sport); });
  (playerProps || []).forEach((pp: any) => { if (pp.sport) availableSports.add(pp.sport); });
  const sportShiftMultipliers = computeSportShiftMultipliers(availableSports);
  console.log(`[SportShift] Available sports: ${[...availableSports].join(', ')}`);

  console.log(`[Bot] Raw data: ${(sweetSpots || []).length} sweet spots, ${(playerProps || []).length} unified_props, ${(rawTeamProps || []).length} raw team bets → ${teamProps.length} deduped (${staleCount} stale removed)`);

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
    const pickSport = pick.sport || 'basketball_nba';
    const categoryWeight = weightMap.get(`${pick.category}__${pick.recommended_side}__${pickSport}`) ?? weightMap.get(`${pick.category}__${pick.recommended_side}`) ?? weightMap.get(pick.category) ?? 1.0;
    
    const oddsValueScore = calculateOddsValueScore(americanOdds, hitRateDecimal);
    const catHitRate = calibratedHitRateMap.get(pick.category);
    const compositeScore = calculateCompositeScore(hitRatePercent, edge, oddsValueScore, categoryWeight, catHitRate, side);
    
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

  // === APPLY GAME CONTEXT PENALTIES/BOOSTS TO PLAYER PICKS ===
  let contextAdjustments = 0;
  for (const pick of enrichedSweetSpots) {
    const teamName = (pick.team_name || '').toLowerCase();
    
    // B2B fatigue penalty: -6 for players on back-to-back teams
    if (teamName && b2bTeams.has(teamName)) {
      pick.compositeScore = Math.max(0, pick.compositeScore - 6);
      contextAdjustments++;
    }
    
    // Blowout risk penalty: -8 for player props in blowout games
    if (teamName && blowoutGames.has(teamName)) {
      pick.compositeScore = Math.max(0, pick.compositeScore + (blowoutGames.get(teamName) || -8));
      contextAdjustments++;
    }
  }
  if (contextAdjustments > 0) {
    console.log(`[Bot] Applied ${contextAdjustments} game context adjustments to player picks`);
  }
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
      const propSport = prop.sport || 'basketball_nba';
      const categoryWeight = weightMap.get(`${propCategory}__${prop.side || 'over'}__${propSport}`) ?? weightMap.get(`${propCategory}__${prop.side || 'over'}`) ?? weightMap.get(propCategory) ?? 1.0;
      
      const oddsValueScore = calculateOddsValueScore(americanOdds, hitRateDecimal);
      const catHitRatePercent = calibratedHitRate ? calibratedHitRate * 100 : undefined;
      const compositeScore = calculateCompositeScore(hitRateDecimal * 100, 0.5, oddsValueScore, categoryWeight, catHitRatePercent, prop.side || 'over');
      
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
      // === Situational & value boosts for spreads ===
      let homeSpreadBoost = 0;
      let awaySpreadBoost = 0;
      const hKey = (game.home_team || '').toLowerCase();
      const aKey = (game.away_team || '').toLowerCase();
      
      // If away team is in a letdown/lookahead/fatigue spot, boost home spread
      const awaySit = whaleAndSituational.situationalSpots.get(aKey);
      if (awaySit) {
        homeSpreadBoost += awaySit.boost;
        console.log(`[Bot] Situational ${awaySit.type} boost +${awaySit.boost} for ${game.home_team} (${game.away_team} in ${awaySit.type} spot)`);
      }
      // If home team is in a letdown/lookahead/fatigue spot, boost away spread
      const homeSit = whaleAndSituational.situationalSpots.get(hKey);
      if (homeSit) {
        awaySpreadBoost += homeSit.boost;
        console.log(`[Bot] Situational ${homeSit.type} boost +${homeSit.boost} for ${game.away_team} (${game.home_team} in ${homeSit.type} spot)`);
      }
      // Value discrepancy boosts for spreads
      const homeValSpread = whaleAndSituational.valueDiscrepancies.get(hKey);
      if (homeValSpread && (homeValSpread.direction === 'home')) {
        homeSpreadBoost += homeValSpread.boost;
        console.log(`[Bot] Value discrepancy spread boost +${homeValSpread.boost} for ${game.home_team}`);
      }
      const awayValSpread = whaleAndSituational.valueDiscrepancies.get(aKey);
      if (awayValSpread && (awayValSpread.direction === 'away')) {
        awaySpreadBoost += awayValSpread.boost;
        console.log(`[Bot] Value discrepancy spread boost +${awayValSpread.boost} for ${game.away_team}`);
      }
      // Whale/sharp spread signals
      const homeWhaleSpread = whaleAndSituational.whaleSignals.get(hKey);
      if (homeWhaleSpread && homeWhaleSpread.direction === 'home') {
        homeSpreadBoost += homeWhaleSpread.boost;
        console.log(`[Bot] Whale spread boost +${homeWhaleSpread.boost} for ${game.home_team}`);
      }
      const awayWhaleSpread = whaleAndSituational.whaleSignals.get(aKey);
      if (awayWhaleSpread && awayWhaleSpread.direction === 'away') {
        awaySpreadBoost += awayWhaleSpread.boost;
        console.log(`[Bot] Whale spread boost +${awayWhaleSpread.boost} for ${game.away_team}`);
      }

      if (game.home_odds) {
        const plusBonus = isPlusMoney(game.home_odds) ? 5 : 0;
        const { score, breakdown } = calculateTeamCompositeScore(gameForScoring, 'spread', 'home', paceMap, defenseMap, envMap, homeCourtMap, ncaabStatsMap, nhlStatsMap, baseballStatsMap);
        picks.push({
          id: `${game.id}_spread_home`,
          type: 'team', sport: game.sport, home_team: game.home_team, away_team: game.away_team,
          bet_type: 'spread', side: 'home', line: game.line, odds: game.home_odds,
          category: mapTeamBetToCategory('spread', 'home'),
          sharp_score: game.sharp_score || 50,
          compositeScore: clampScore(30, 95, score + plusBonus + homeSpreadBoost),
          confidence_score: score / 100,
          score_breakdown: breakdown,
        });
      }
      if (game.away_odds) {
        const plusBonus = isPlusMoney(game.away_odds) ? 5 : 0;
        const { score, breakdown } = calculateTeamCompositeScore(gameForScoring, 'spread', 'away', paceMap, defenseMap, envMap, homeCourtMap, ncaabStatsMap, nhlStatsMap, baseballStatsMap);
        picks.push({
          id: `${game.id}_spread_away`,
          type: 'team', sport: game.sport, home_team: game.home_team, away_team: game.away_team,
          bet_type: 'spread', side: 'away', line: -(game.line), odds: game.away_odds,
          category: mapTeamBetToCategory('spread', 'away'),
          sharp_score: game.sharp_score || 50,
          compositeScore: clampScore(30, 95, score + plusBonus + awaySpreadBoost),
          confidence_score: score / 100,
          score_breakdown: breakdown,
        });
      }
    }
    
    // Total picks
    if (game.bet_type === 'total' && game.over_odds && game.under_odds) {
      const { score: overScore, breakdown: overBreakdown } = calculateTeamCompositeScore(gameForScoring, 'total', 'over', paceMap, defenseMap, envMap, homeCourtMap, ncaabStatsMap, nhlStatsMap, baseballStatsMap);
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

      // === NEW: Whale/sharp signal boosts for NBA/NHL ===
      const homeWhale = whaleAndSituational.whaleSignals.get(homeKey);
      const awayWhale = whaleAndSituational.whaleSignals.get(awayKey);
      if (homeWhale?.direction === 'over' || awayWhale?.direction === 'over') {
        overWeatherBonus += 8;
        console.log(`[Bot] Whale OVER boost +8 for ${game.home_team} vs ${game.away_team}`);
      }
      if (homeWhale?.direction === 'under' || awayWhale?.direction === 'under') {
        underWeatherBonus += 8;
        console.log(`[Bot] Whale UNDER boost +8 for ${game.home_team} vs ${game.away_team}`);
      }

      // === NEW: Value line discrepancy boosts ===
      const homeValue = whaleAndSituational.valueDiscrepancies.get(homeKey + '_total') || whaleAndSituational.valueDiscrepancies.get(homeKey);
      const awayValue = whaleAndSituational.valueDiscrepancies.get(awayKey + '_total') || whaleAndSituational.valueDiscrepancies.get(awayKey);
      if (homeValue?.direction === 'over' || awayValue?.direction === 'over') {
        overWeatherBonus += (homeValue?.boost || awayValue?.boost || 6);
        console.log(`[Bot] Value discrepancy OVER boost for ${game.home_team} vs ${game.away_team}`);
      }
      if (homeValue?.direction === 'under' || awayValue?.direction === 'under') {
        underWeatherBonus += (homeValue?.boost || awayValue?.boost || 6);
        console.log(`[Bot] Value discrepancy UNDER boost for ${game.home_team} vs ${game.away_team}`);
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
      const { score: underScore, breakdown: underBreakdown } = calculateTeamCompositeScore(gameForScoring, 'total', 'under', paceMap, defenseMap, envMap, homeCourtMap, ncaabStatsMap, nhlStatsMap, baseballStatsMap);
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
        const { score, breakdown } = calculateTeamCompositeScore(gameForScoring, 'moneyline', 'home', paceMap, defenseMap, envMap, homeCourtMap, ncaabStatsMap, nhlStatsMap, baseballStatsMap);
        picks.push({
          id: `${game.id}_ml_home`,
          type: 'team', sport: game.sport, home_team: game.home_team, away_team: game.away_team,
          bet_type: 'moneyline', side: 'home', line: 0, odds: game.home_odds,
          category: mapTeamBetToCategory('moneyline', 'home', game.home_odds),
          sharp_score: game.sharp_score || 50,
          compositeScore: clampScore(30, 95, score + plusBonus),
          confidence_score: score / 100,
          score_breakdown: breakdown,
        });
      }
      if (game.away_odds) {
        const plusBonus = isPlusMoney(game.away_odds) ? 5 : 0;
        const { score, breakdown } = calculateTeamCompositeScore(gameForScoring, 'moneyline', 'away', paceMap, defenseMap, envMap, homeCourtMap, ncaabStatsMap, nhlStatsMap, baseballStatsMap);
        picks.push({
          id: `${game.id}_ml_away`,
          type: 'team', sport: game.sport, home_team: game.home_team, away_team: game.away_team,
          bet_type: 'moneyline', side: 'away', line: 0, odds: game.away_odds,
          category: mapTeamBetToCategory('moneyline', 'away', game.away_odds),
          sharp_score: game.sharp_score || 50,
          compositeScore: clampScore(30, 95, score + plusBonus),
          confidence_score: score / 100,
          score_breakdown: breakdown,
        });
      }
    }
    
    return picks;
  });

  // === TENNIS/TABLE TENNIS RESEARCH BOOST APPLICATION ===
  const tennisSports = new Set(['tennis_atp', 'tennis_wta', 'tennis_pingpong']);
  if (tennisIntel.size > 0) {
    let tennisBoostsApplied = 0;
    for (const pick of enrichedTeamPicks) {
      if (!tennisSports.has(pick.sport || '')) continue;
      const homeKey = (pick.home_team || '').toLowerCase().trim();
      const awayKey = (pick.away_team || '').toLowerCase().trim();
      const targetKey = pick.side === 'home' ? homeKey : awayKey;
      const opponentKey = pick.side === 'home' ? awayKey : homeKey;

      // Check if the picked player/team has research intel
      const targetSignal = tennisIntel.get(targetKey);
      const opponentSignal = tennisIntel.get(opponentKey);

      if (targetSignal) {
        pick.compositeScore = clampScore(30, 95, pick.compositeScore + targetSignal.boost);
        tennisBoostsApplied++;
        console.log(`[TennisIntel] Applied ${targetSignal.boost > 0 ? '+' : ''}${targetSignal.boost} to ${targetKey} (${targetSignal.reason})`);
      }
      // If opponent is fatigued/cold, boost the pick
      if (opponentSignal && opponentSignal.boost < 0) {
        const reverseBoost = Math.abs(opponentSignal.boost);
        pick.compositeScore = clampScore(30, 95, pick.compositeScore + reverseBoost);
        tennisBoostsApplied++;
        console.log(`[TennisIntel] Opponent penalty reverse +${reverseBoost} for ${targetKey} (opponent ${opponentKey} ${opponentSignal.reason})`);
      }
    }
    console.log(`[TennisIntel] Applied ${tennisBoostsApplied} boosts to tennis/TT team picks`);
  }

  // === DYNAMIC CATEGORY BLOCKING FOR TEAM PICKS ===
  // Build blocked combos from category weights (category_side with <40% hit rate and 10+ picks)
  const blockedTeamCombos = new Set<string>();
  categoryWeights.forEach(cw => {
    if (cw.current_hit_rate < 40 && (cw.total_picks || 0) >= 10) {
      blockedTeamCombos.add(`${cw.category}_${cw.side}`);
    }
  });
  if (blockedTeamCombos.size > 0) {
    console.log(`[Bot] Dynamic team blocks (hit rate <40%, 10+ picks): ${[...blockedTeamCombos].join(', ')}`);
  }

  // === ML SNIPER GATE: Surgical moneyline filtering ===
  const preGateCount = enrichedTeamPicks.length;
  const mlBlocked: string[] = [];
  const filteredTeamPicks = enrichedTeamPicks.filter(pick => {
    const isNCAAB = pick.sport?.includes('ncaab') || pick.sport?.includes('college');
    const isNBA = pick.sport?.includes('nba');
    const isML = pick.bet_type === 'moneyline';

    // === FIX 1: Block NCAAB OVER totals — only 31% historical hit rate ===
    if (isNCAAB && pick.bet_type === 'total' && pick.side === 'over') {
      mlBlocked.push(`${pick.home_team} vs ${pick.away_team} NCAAB OVER total BLOCKED (31% hit rate)`);
      return false;
    }

    // === FIX 5: Dynamic category blocking from bot_category_weights ===
    const pickComboKey = `${pick.category}_${pick.side}`;
    if (blockedTeamCombos.has(pickComboKey)) {
      mlBlocked.push(`${pick.home_team} vs ${pick.away_team} ${pick.category}_${pick.side} BLOCKED (dynamic: <40% hit rate)`);
      return false;
    }

    // === FIX 3: Dynamic composite score floor (light-slate adaptive) ===
    // On light-slate days (0 player props or <25 total pool), lower floor from 65 to 55
    const effectiveTeamFloor = isLightSlateMode ? 55 : 65;
    if (pick.compositeScore < effectiveTeamFloor) {
      mlBlocked.push(`${pick.home_team} vs ${pick.away_team} ${pick.bet_type} (composite ${pick.compositeScore.toFixed(0)} < ${effectiveTeamFloor} team floor)`);
      return false;
    }

    // === ML-specific gates ===
    if (isML) {
      // === FIX 2: Home ML requires composite >= 75 (was 70) ===
      if (pick.side === 'home' && pick.compositeScore < 75) {
        mlBlocked.push(`${pick.home_team} vs ${pick.away_team} HOME ML (composite ${pick.compositeScore.toFixed(0)} < 75 — home ML 25% hit rate)`);
        return false;
      }

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

      // Gate 3: NCAAB ML — hard block ALL favorites (5% historical hit rate)
      if (isNCAAB) {
        if (pick.odds < 0) {
          mlBlocked.push(`NCAAB ML_FAVORITE blocked (5% historical hit rate, odds ${pick.odds})`);
          return false;
        }
        // NCAAB underdogs: allow but still require Top 50 KenPom
        const teamName = pick.side === 'home' ? pick.home_team : pick.away_team;
        const stats = ncaabStatsMap.get(teamName);
        const rank = stats?.kenpom_rank || 999;
        if (rank > 50) {
          mlBlocked.push(`${teamName} NCAAB ML dog (rank ${rank} > 50)`);
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

    // Non-ML NCAAB: use dynamic floor (light-slate: 55, normal: 65)
    if (isNCAAB && !isML && pick.compositeScore < effectiveTeamFloor) {
      return false;
    }

    // NCAAB Quality Gate: block obscure matchups to avoid unsettleable voids
    // Block if EITHER team is outside Top 200 KenPom or has no data
    if (isNCAAB && ncaabStatsMap && ncaabStatsMap.size > 0) {
      const homeStats = ncaabStatsMap.get(pick.home_team);
      const awayStats = ncaabStatsMap.get(pick.away_team);
      const homeRank = homeStats?.kenpom_rank || 999;
      const awayRank = awayStats?.kenpom_rank || 999;
      
      if (homeRank > 200 || awayRank > 200) {
        mlBlocked.push(`${pick.home_team} vs ${pick.away_team} NCAAB (rank #${homeRank} vs #${awayRank}, need both ≤200)`);
        return false;
      }
    }

    // NCAA Baseball Quality Gate: only include games where both teams exist in ncaa_baseball_team_stats
    const isBaseball = pick.sport?.includes('baseball_ncaa') || pick.sport?.includes('baseball');
    if (isBaseball && baseballTeamsSet && baseballTeamsSet.size > 0) {
      const homeInStats = baseballTeamsSet.has(pick.home_team);
      const awayInStats = baseballTeamsSet.has(pick.away_team);
      if (!homeInStats || !awayInStats) {
        mlBlocked.push(`${pick.home_team} vs ${pick.away_team} Baseball (missing stats: home=${homeInStats}, away=${awayInStats})`);
        return false;
      }
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

  // === APPLY GAME CONTEXT BOOSTS TO TEAM PICKS ===
  let teamContextAdjustments = 0;
  for (const pick of enrichedTeamPicks) {
    const homeKey = (pick.home_team || '').toLowerCase();
    const awayKey = (pick.away_team || '').toLowerCase();
    
    // Revenge game boost: +5 for team bets in revenge games
    const revengeBoost = revengeGames.get(homeKey) || revengeGames.get(awayKey);
    if (revengeBoost) {
      pick.compositeScore = Math.min(95, pick.compositeScore + revengeBoost);
      teamContextAdjustments++;
    }
    
    // Blowout risk penalty for team props too (but less severe, -4)
    const blowoutPenalty = blowoutGames.get(homeKey) || blowoutGames.get(awayKey);
    if (blowoutPenalty && pick.bet_type === 'total') {
      pick.compositeScore = Math.max(0, pick.compositeScore - 4);
      teamContextAdjustments++;
    }
  }
  if (teamContextAdjustments > 0) {
    console.log(`[Bot] Applied ${teamContextAdjustments} game context adjustments to team picks`);
  }

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

  // === CONVERT WHALE PICKS TO ENRICHED FORMAT ===
  // Build a lookup from deduped game_bets (which prefers FanDuel) for line override
  const gameBetLineMap = new Map<string, number>();
  teamProps.forEach((tp: any) => {
    if (tp.home_team && tp.away_team && tp.bet_type) {
      const k = `${tp.away_team}_${tp.home_team}_${tp.bet_type}`.toLowerCase();
      gameBetLineMap.set(k, tp.line);
    }
  });

  const enrichedWhalePicks: EnrichedPick[] = (rawWhalePicks || []).map((wp: any) => {
    const sharpScore = wp.sharp_score || 55;
    const category = mapPropTypeToCategory(wp.stat_type || wp.prop_type || 'points');
    const side = (wp.pick_side || 'over').toLowerCase();
    let line = wp.pp_line || wp.line || 0;
    
    // Detect team bets (player_name contains "@" for matchup format like "Arizona @ Michigan")
    const isTeamBet = (wp.stat_type === 'spread' || wp.stat_type === 'moneyline' || wp.stat_type === 'total') 
      && wp.player_name?.includes('@');
    
    if (isTeamBet && wp.player_name) {
      // Try to override line with FanDuel-preferred game_bets line
      const parts = wp.player_name.split('@').map((s: string) => s.trim());
      const awayTeam = parts[0] || '';
      const homeTeam = parts[1] || '';
      const gbKey = `${awayTeam}_${homeTeam}_${wp.stat_type}`.toLowerCase();
      const fdLine = gameBetLineMap.get(gbKey);
      if (fdLine != null) {
        line = fdLine; // Use the FanDuel-preferred line (home perspective)
        console.log(`[Bot] Whale pick line override: ${wp.player_name} ${wp.stat_type} ${wp.pp_line || wp.line} → ${fdLine} (FanDuel preferred)`);
      }
      
      // For team spread away picks, negate the line (stored as home team perspective)
      if (wp.stat_type === 'spread' && side === 'away') {
        line = -line;
      }
    }
    
    const americanOdds = -110; // Default for player props
    const hitRateDecimal = sharpScore / 100;
    const oddsValueScore = calculateOddsValueScore(americanOdds, hitRateDecimal);
    const compositeScore = 50 + (sharpScore * 0.3);
    
    return {
      id: wp.id,
      player_name: wp.player_name,
      prop_type: wp.stat_type || wp.prop_type || 'points',
      line,
      recommended_side: side,
      category,
      confidence_score: hitRateDecimal,
      l10_hit_rate: hitRateDecimal,
      projected_value: Math.abs(line),
      sport: wp.sport || 'basketball_nba',
      event_id: wp.event_id,
      americanOdds,
      oddsValueScore,
      compositeScore,
      has_real_line: true,
      line_source: 'whale_signal',
    } as EnrichedPick;
  }).filter((p: EnrichedPick) => Math.abs(p.line) > 0 && p.player_name);

  // === APPLY SPORT-SHIFT MULTIPLIERS ===
  let sportShiftApplied = 0;
  for (const pick of enrichedSweetSpots) {
    const mult = sportShiftMultipliers.get(pick.sport || 'basketball_nba') || 1.0;
    if (mult !== 1.0) {
      pick.compositeScore = Math.min(95, Math.round(pick.compositeScore * mult));
      sportShiftApplied++;
    }
  }
  for (const pick of enrichedTeamPicks) {
    const mult = sportShiftMultipliers.get(pick.sport || 'basketball_nba') || 1.0;
    if (mult !== 1.0) {
      pick.compositeScore = Math.min(95, Math.round(pick.compositeScore * mult));
      sportShiftApplied++;
    }
  }
  if (sportShiftApplied > 0) {
    console.log(`[SportShift] Boosted composite scores for ${sportShiftApplied} picks from non-dominant sports`);
  }

  console.log(`[Bot] Pool built: ${enrichedSweetSpots.length} player props, ${enrichedTeamPicks.length} team props, ${enrichedWhalePicks.length} whale picks`);

  return {
    playerPicks: enrichedSweetSpots,
    teamPicks: enrichedTeamPicks,
    sweetSpots: enrichedSweetSpots,
    whalePicks: enrichedWhalePicks,
    totalPool: enrichedSweetSpots.length + enrichedTeamPicks.length + enrichedWhalePicks.length,
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

/**
 * Create a mirror fingerprint that strips the 'side' from team legs.
 * This catches parlays that cover the same matchups but with flipped sides (e.g., OVER vs UNDER).
 */
function createMirrorFingerprint(legs: any[]): string {
  const keys = legs.map(leg => {
    if (leg.type === 'team') {
      return `T:${leg.home_team}_${leg.away_team}_${leg.bet_type}`.toLowerCase();
    }
    return `P:${leg.player_name}_${leg.prop_type}_${leg.line}`.toLowerCase();
  });
  return keys.sort().join('|');
}

/**
 * Snap a fractional line to the nearest 0.5 sportsbook increment.
 */
function snapLine(raw: number, betType?: string): number {
  // For spreads, always snap to .5 to avoid pushes (e.g., 2.1667 → 2.5, not 2.0)
  if (betType === 'spread') {
    const floor = Math.floor(raw);
    return floor + 0.5;
  }
  return Math.round(raw * 2) / 2;
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
  globalMirrorPrints: Set<string> = new Set(),
  goldenCategories: Set<string> = new Set(),
  isThinSlate: boolean = false,
  winningPatterns: any = null
): Promise<{ count: number; parlays: any[] }> {
  // Clone config so we can override thresholds for thin slates without mutating the original
  const config = { ...TIER_CONFIG[tier] };

  // Thin-slate relaxation: loosen validation AND exploration tier gates (execution stays strict)
  if (isThinSlate && tier === 'validation') {
    config.minHitRate = 48;
    config.minEdge = 0.004;
    config.minSharpe = 0.01;
    config.minConfidence = 0.48;
    console.log(`[Bot] 🔶 Thin-slate: validation gates relaxed (hitRate≥48%, edge≥0.004, sharpe≥0.01)`);
  }
  if (isThinSlate && tier === 'exploration') {
    config.minHitRate = 40;
    config.minEdge = 0.002;
    config.minSharpe = 0.005;
    config.minConfidence = 0.40;
    console.log(`[Bot] 🔶 Thin-slate: exploration gates relaxed (hitRate≥40%, edge≥0.002)`);
  }

  const tracker = createUsageTracker();
  const parlaysToCreate: any[] = [];

  console.log(`[Bot] Generating ${tier} tier (${config.count} target)`);

  // === BASEBALL SEASON GATE ===
  // Skip NCAA baseball profiles before March 1st (no reliable score coverage)
  const etDateForGate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const isBaseballSeasonActive = etDateForGate >= `${etDateForGate.slice(0, 4)}-03-01`;
  if (!isBaseballSeasonActive) {
    console.log(`[Bot] Baseball season gate: ACTIVE (${etDateForGate} < March 1st) — skipping baseball_ncaa profiles`);
  }

  for (const profile of config.profiles) {
    // Season gate: skip baseball profiles before March 1st
    if (!isBaseballSeasonActive && profile.sports?.includes('baseball_ncaa')) {
      continue;
    }
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
    
    // WHALE SIGNAL: draw exclusively from whale picks pool
    const isWhaleProfile = profile.strategy.startsWith('whale_signal');
    
    if (isWhaleProfile) {
      candidatePicks = [...pool.whalePicks].filter(p => !BLOCKED_SPORTS.includes(p.sport)).sort((a, b) => b.compositeScore - a.compositeScore);
      if (candidatePicks.length < profile.legs) {
        console.log(`[Bot] ${tier}/whale_signal: only ${candidatePicks.length} whale picks available, need ${profile.legs}`);
        continue;
      }
      console.log(`[Bot] ${tier}/whale_signal: using ${candidatePicks.length} whale picks`);
    } else if (isTeamProfile) {
      candidatePicks = pool.teamPicks.filter(p => {
        if (!profile.betTypes!.includes(p.bet_type)) return false;
        // Block picks from paused sports
        if (BLOCKED_SPORTS.includes(p.sport)) return false;
        // Apply sport filter so baseball profiles only get baseball picks, etc.
        if (!sportFilter.includes('all') && !sportFilter.includes(p.sport)) return false;
        // ncaab_unders: only allow UNDER side for totals
        if (profile.strategy === 'ncaab_unders' && p.bet_type === 'total') {
          return (p as EnrichedTeamPick).side?.toUpperCase() === 'UNDER';
        }
        return true;
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
        // Block picks from paused sports
        if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
        if (sportFilter.includes('all')) return true;
        return sportFilter.includes(p.sport || 'basketball_nba');
      });
      const teamPicks = pool.teamPicks
        .filter(p => {
          // Block picks from paused sports
          if (BLOCKED_SPORTS.includes(p.sport)) return false;
          if (sportFilter.includes('all')) return true;
          return sportFilter.includes(p.sport);
        })
        .sort((a, b) => b.compositeScore - a.compositeScore);
      // Player props first, team props appended at the end
      candidatePicks = [...playerPicks, ...teamPicks];
      console.log(`[Bot] Hybrid pool: ${playerPicks.length} player + ${teamPicks.length} team picks`);
    } else {
      candidatePicks = pool.sweetSpots.filter(p => {
        // Block picks from paused sports
        if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
        if (sportFilter.includes('all')) return true;
        return sportFilter.includes(p.sport || 'basketball_nba');
      });
    }

    // === ACCURACY-FIRST SORTING (all tiers) ===
    // Sort by: category weight (sport-aware) → calibrated hit rate → composite score
    candidatePicks = [...candidatePicks].sort((a, b) => {
      const aSport = a.sport || 'basketball_nba';
      const bSport = b.sport || 'basketball_nba';
      const aWeight = weightMap.get(`${a.category}__${a.recommended_side}__${aSport}`) ?? weightMap.get(`${a.category}__${a.recommended_side}`) ?? weightMap.get(a.category) ?? 1.0;
      const bWeight = weightMap.get(`${b.category}__${b.recommended_side}__${bSport}`) ?? weightMap.get(`${b.category}__${b.recommended_side}`) ?? weightMap.get(b.category) ?? 1.0;
      
      // Primary: category weight (blocked=0 sink to bottom, boosted=1.2 rise to top)
      if (bWeight !== aWeight) return bWeight - aWeight;
      
      // Secondary: L10 hit rate (player props) or confidence score (team props)
      const aHitRate = 'l10_hit_rate' in a ? (a as EnrichedPick).l10_hit_rate : (a.confidence_score || 0);
      const bHitRate = 'l10_hit_rate' in b ? (b as EnrichedPick).l10_hit_rate : (b.confidence_score || 0);
      if (bHitRate !== aHitRate) return bHitRate - aHitRate;
      
      // Tertiary: composite score
      return (b.compositeScore || 0) - (a.compositeScore || 0);
    });

    // Build parlay from candidates
    // Anti-stacking rule from pattern replay: cap same-side totals
    const maxSameSidePerParlay = winningPatterns?.max_same_side_per_parlay || 2;
    const parlaySideCount = new Map<string, number>(); // "total_over" -> count
    
    // Apply thin slate leg override
    const effectiveMaxLegs = isThinSlate 
      ? Math.min(profile.legs, 3) 
      : profile.legs;

    for (const pick of candidatePicks) {
      if (legs.length >= effectiveMaxLegs) break;
      
      if (!canUsePickGlobally(pick, tracker, config)) continue;
      if (!canUsePickInParlay(pick, parlayTeamCount, parlayCategoryCount, config, legs)) continue;
      
      // Pattern replay: anti-stacking (e.g., max 2 OVER totals per parlay)
      const pickBetType = ('bet_type' in pick ? pick.bet_type : pick.prop_type) || '';
      const pickSide = pick.recommended_side || '';
      const sideKey = `${pickBetType}_${pickSide}`.toLowerCase();
      if ((parlaySideCount.get(sideKey) || 0) >= maxSameSidePerParlay) {
        continue;
      }

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
        
        // SPREAD CAP: Block high spreads or shop for alt lines
        if (teamPick.bet_type === 'spread' && Math.abs(teamPick.line) >= MAX_SPREAD_LINE) {
          console.log(`[SpreadCap] High spread detected: ${teamPick.home_team} vs ${teamPick.away_team} line=${teamPick.line}, shopping for alt...`);
          
          // Try to fetch alternate spread lines
          let altApplied = false;
          try {
            const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
            const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
            const teamToLookup = teamPick.side === 'home' ? teamPick.home_team : teamPick.away_team;
            
            const altResponse = await fetch(`${supabaseUrl}/functions/v1/fetch-alternate-lines`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseKey}`,
              },
              body: JSON.stringify({
                eventId: teamPick.id.split('_spread_')[0],
                teamName: teamToLookup,
                propType: 'spread',
                sport: teamPick.sport,
              }),
            });
            
            if (altResponse.ok) {
              const altData = await altResponse.json();
              const altLines: { line: number; overOdds: number }[] = altData.lines || [];
              
              // Find best alt spread: abs(line) between 7 and MAX_SPREAD_LINE, reasonable odds
              const isNegative = teamPick.line < 0;
              const viableAlts = altLines.filter(alt => {
                const absLine = Math.abs(alt.line);
                // Same sign as original
                if (isNegative && alt.line > 0) return false;
                if (!isNegative && alt.line < 0) return false;
                // Target range
                if (absLine < 7 || absLine > MAX_SPREAD_LINE) return false;
                // Reasonable odds (-150 to +200)
                if (alt.overOdds < -150 || alt.overOdds > 200) return false;
                return true;
              });
              
              if (viableAlts.length > 0) {
                // Pick the one closest to -10 / +10
                viableAlts.sort((a, b) => Math.abs(Math.abs(a.line) - 10) - Math.abs(Math.abs(b.line) - 10));
                const bestAlt = viableAlts[0];
                console.log(`[SpreadCap] Alt spread found: ${teamPick.line} → ${bestAlt.line} @ ${bestAlt.overOdds}`);
                teamPick.line = bestAlt.line;
                teamPick.odds = bestAlt.overOdds;
                altApplied = true;
              }
            }
          } catch (err) {
            console.error(`[SpreadCap] Error fetching alt spreads:`, err);
          }
          
          // Hard block: if no alt was found, skip this pick entirely
          if (!altApplied) {
            console.log(`[SpreadCap] BLOCKED: No viable alt spread for ${teamPick.home_team} vs ${teamPick.away_team} (line=${teamPick.line})`);
            continue;
          }
        }
        
        legData = {
          id: teamPick.id,
          type: 'team',
          home_team: teamPick.home_team,
          away_team: teamPick.away_team,
          bet_type: teamPick.bet_type,
          side: teamPick.side,
          line: snapLine(teamPick.line, teamPick.bet_type),
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
        const playerSport = playerPick.sport || 'basketball_nba';
        const weight = weightMap.get(`${playerPick.category}__${playerPick.recommended_side}__${playerSport}`) ?? weightMap.get(`${playerPick.category}__${playerPick.recommended_side}`) ?? weightMap.get(playerPick.category) ?? 1.0;
        
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
          line: snapLine(selectedLine.line, playerPick.prop_type),
          side: playerPick.recommended_side || 'over',
          category: playerPick.category,
          weight,
          hit_rate: hitRatePercent,
          american_odds: selectedLine.odds,
          odds_value_score: playerPick.oddsValueScore,
          composite_score: playerPick.compositeScore,
          outcome: 'pending',
          original_line: snapLine(playerPick.line, playerPick.prop_type),
          selected_line: snapLine(selectedLine.line, playerPick.prop_type),
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
      
      // === GAP 2: Per-leg minimum score gate by parlay size ===
      const legCompositeScore = legData.composite_score || legData.sharp_score || 0;
      const minScore = minScoreByParlaySize(effectiveMaxLegs);
      if (legCompositeScore < minScore) {
        if (tier === 'execution') console.log(`[ScoreGate] Blocked ${legData.player_name || legData.home_team} (score ${legCompositeScore} < ${minScore} for ${effectiveMaxLegs}-leg parlay)`);
        continue;
      }

      legs.push(legData);
      parlayCategoryCount.set(pick.category, (parlayCategoryCount.get(pick.category) || 0) + 1);
      // Track side count for anti-stacking
      const legBetType = ('bet_type' in pick ? pick.bet_type : pick.prop_type) || '';
      const legSide = pick.recommended_side || '';
      const legSideKey = `${legBetType}_${legSide}`.toLowerCase();
      parlaySideCount.set(legSideKey, (parlaySideCount.get(legSideKey) || 0) + 1);
    }

    // Only create parlay if we have enough legs
    if (legs.length < profile.legs) {
      console.log(`[Bot] ${tier}/${profile.strategy}: only ${legs.length}/${profile.legs} legs built from ${candidatePicks.length} candidates`);
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
      // Mirror dedup: skip if same matchups exist with flipped sides
      const mirrorPrint = createMirrorFingerprint(legs);
      if (globalMirrorPrints.has(mirrorPrint)) {
        console.log(`[Bot] Skipping mirror duplicate ${tier}/${profile.strategy} parlay (same games, flipped sides)`);
        continue;
      }
      globalFingerprints.add(fingerprint);
      globalMirrorPrints.add(mirrorPrint);

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
      let effectiveEdge = hasPositiveSignals ? Math.max(edge, 0.005) : edge;
      
      // === GAP 3: Leg-count penalty (house edge cost) ===
      const penaltyMultiplier = parlayLegCountPenalty(legs.length);
      if (penaltyMultiplier < 1) {
        effectiveEdge *= penaltyMultiplier;
        if (tier === 'execution') console.log(`[LegPenalty] Applied 3% x ${legs.length - 3} penalty to edge (${edge.toFixed(4)} → ${effectiveEdge.toFixed(4)})`);
      }

      // === GAP 4: Correlation tax (same-game haircut) ===
      if (hasSameGameCorrelation(legs)) {
        effectiveEdge *= 0.85;
        console.log(`[CorrTax] Same-game correlation tax applied (15% haircut) for ${tier}/${profile.strategy}`);
      }

      const sharpe = effectiveEdge / (0.5 * Math.sqrt(legs.length));

      // Check tier thresholds
      const probFloor = (isThinSlate && tier !== 'execution') ? 0.0005 : 0.001;
      if (combinedProbability < probFloor) { if (tier === 'execution') console.log(`[Bot] ${tier}/${profile.strategy}: failed prob (${combinedProbability.toFixed(4)})`); continue; }
      const effectiveMinEdge = (isHybridProfile || isTeamProfile) ? Math.min(config.minEdge, 0.008) : config.minEdge;
      if (effectiveEdge < effectiveMinEdge) { if (tier === 'execution') console.log(`[Bot] ${tier}/${profile.strategy}: failed edge (${effectiveEdge.toFixed(4)} < ${effectiveMinEdge})`); continue; }
      if (sharpe < config.minSharpe) { if (tier === 'execution') console.log(`[Bot] ${tier}/${profile.strategy}: failed sharpe (${sharpe.toFixed(4)} < ${config.minSharpe})`); continue; }

      // === GAP 5: Parlay-level composite score floor ===
      const avgLegCompositeScore = legs.reduce((sum, l) => sum + (l.composite_score || l.sharp_score || 0), 0) / legs.length;
      const adjustedAvgScore = avgLegCompositeScore * penaltyMultiplier;
      const scoreFloor = parlayScoreFloor(tier);
      if (adjustedAvgScore < scoreFloor) {
        if (tier === 'execution') console.log(`[ParlayFloor] Rejected ${tier}/${profile.strategy} parlay (avg score ${adjustedAvgScore.toFixed(1)} < ${scoreFloor} floor)`);
        continue;
      }

      // Calculate stake (flat $100 for all tiers)
      const stake = typeof config.stake === 'number' && config.stake > 0 ? config.stake : 100;

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

// ============= ROUND ROBIN BANKROLL DOUBLER =============

interface RoundRobinLeg {
  id: string;
  player_name: string;
  team_name?: string;
  prop_type: string;
  line: number;
  side: string;
  category: string;
  weight: number;
  hit_rate: number;
  american_odds?: number;
  composite_score?: number;
  type?: string;
  home_team?: string;
  away_team?: string;
  bet_type?: string;
  original_line?: number;
  selected_line?: number;
  projected_value?: number;
}

function getCombinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  const [first, ...rest] = arr;
  const withFirst = getCombinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = getCombinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

function americanToDecimal(odds: number): number {
  return odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
}

function decimalToAmerican(dec: number): number {
  if (dec >= 2) return Math.round((dec - 1) * 100);
  return Math.round(-100 / (dec - 1));
}

async function generateRoundRobinParlays(
  supabase: any,
  targetDate: string,
  bankroll: number
): Promise<{ megaParlay: any | null; subParlays: any[]; totalInserted: number }> {
  console.log(`[RoundRobin] Starting bankroll doubler for ${targetDate}`);

  // 1. Fetch all today's parlays to extract legs
  const { data: todayParlays, error } = await supabase
    .from('bot_daily_parlays')
    .select('*')
    .eq('parlay_date', targetDate)
    .neq('tier', 'round_robin');

  if (error) throw error;
  if (!todayParlays || todayParlays.length === 0) {
    throw new Error('No parlays found for today. Run standard generation first.');
  }

  // 2. Extract and deduplicate all legs
  const legMap = new Map<string, RoundRobinLeg>();
  for (const parlay of todayParlays) {
    const legs = Array.isArray(parlay.legs) ? parlay.legs : JSON.parse(parlay.legs);
    for (const leg of legs) {
      const key = `${(leg.player_name || leg.home_team || '').toLowerCase()}_${leg.prop_type || leg.bet_type}_${leg.side}`;
      const existing = legMap.get(key);
      const score = leg.composite_score || leg.hit_rate || 0;
      if (!existing || score > (existing.composite_score || existing.hit_rate || 0)) {
        legMap.set(key, leg);
      }
    }
  }

  // 3. Filter to elite legs: 60%+ hit rate, positive composite
  let eliteLegs = Array.from(legMap.values()).filter(leg => {
    const hr = leg.hit_rate || 0;
    const cs = leg.composite_score || 0;
    return hr >= 60 && cs > 0;
  });

  // Sort by composite score descending
  eliteLegs.sort((a, b) => (b.composite_score || 0) - (a.composite_score || 0));

  // Cap at top 10
  eliteLegs = eliteLegs.slice(0, 10);

  if (eliteLegs.length < 4) {
    throw new Error(`Only ${eliteLegs.length} elite legs found (need at least 4). Lower-quality slate today.`);
  }

  console.log(`[RoundRobin] Found ${eliteLegs.length} elite legs from ${todayParlays.length} parlays`);

  // 4. Calculate mega-parlay odds
  const megaDecimalOdds = eliteLegs.reduce((acc, leg) => {
    const odds = leg.american_odds || -110;
    return acc * americanToDecimal(odds);
  }, 1);

  const megaAmericanOdds = decimalToAmerican(megaDecimalOdds);
  const megaCombinedProb = 1 / megaDecimalOdds;
  const megaEdge = megaCombinedProb * (megaDecimalOdds - 1) - (1 - megaCombinedProb);

  // 5. Build mega-parlay
  const STAKE = 20;
  const megaParlay = {
    parlay_date: targetDate,
    legs: eliteLegs,
    leg_count: eliteLegs.length,
    combined_probability: megaCombinedProb,
    expected_odds: megaAmericanOdds,
    simulated_win_rate: megaCombinedProb,
    simulated_edge: megaEdge,
    simulated_sharpe: 0,
    strategy_name: 'bankroll_doubler',
    strategy_version: 1,
    outcome: 'pending',
    is_simulated: true,
    simulated_stake: STAKE,
    simulated_payout: STAKE * megaDecimalOdds,
    tier: 'round_robin',
    selection_rationale: `Mega-parlay: Top ${eliteLegs.length} elite legs combined. Target: ${megaAmericanOdds > 0 ? '+' : ''}${megaAmericanOdds} odds (~$${(STAKE * megaDecimalOdds).toFixed(0)} payout on $${STAKE}).`,
  };

  // 6. Generate round robin sub-combinations (4-leg combos)
  const subSize = Math.min(4, eliteLegs.length - 1);
  const combos = getCombinations(eliteLegs, subSize);
  
  // Cap at 15 sub-parlays
  const cappedCombos = combos.slice(0, 15);

  // === GAP 6: Round Robin EV and Score Gates ===
  const subParlays: any[] = [];
  let skippedCombos = 0;
  for (let idx = 0; idx < cappedCombos.length; idx++) {
    const combo = cappedCombos[idx];
    const decOdds = combo.reduce((acc, leg) => {
      const odds = leg.american_odds || -110;
      return acc * americanToDecimal(odds);
    }, 1);
    const amOdds = decimalToAmerican(decOdds);
    const prob = 1 / decOdds;
    let comboEdge = prob * (decOdds - 1) - (1 - prob);

    // Apply leg-count penalty (Gap 3) to round robin edge
    comboEdge *= parlayLegCountPenalty(combo.length);

    // Apply correlation tax if applicable
    if (hasSameGameCorrelation(combo)) {
      comboEdge *= 0.85;
    }

    // EV gate: require 2% minimum edge
    if (comboEdge < 0.02) {
      skippedCombos++;
      continue;
    }

    // Score gate: require average composite_score >= 82
    const avgComposite = combo.reduce((sum, l) => sum + (l.composite_score || l.hit_rate || 0), 0) / combo.length;
    if (avgComposite < 82) {
      console.log(`[RoundRobin] Skipped combo ${idx + 1} (avg score ${avgComposite.toFixed(1)} < 82)`);
      skippedCombos++;
      continue;
    }

    subParlays.push({
      parlay_date: targetDate,
      legs: combo,
      leg_count: combo.length,
      combined_probability: prob,
      expected_odds: amOdds,
      simulated_win_rate: prob,
      simulated_edge: comboEdge,
      simulated_sharpe: 0,
      strategy_name: 'bankroll_doubler',
      strategy_version: 1,
      outcome: 'pending',
      is_simulated: true,
      simulated_stake: STAKE,
      simulated_payout: STAKE * decOdds,
      tier: 'round_robin',
      selection_rationale: `Round robin combo ${idx + 1 - skippedCombos}/${cappedCombos.length - skippedCombos}: ${combo.length}-leg sub-parlay. ${amOdds > 0 ? '+' : ''}${amOdds} odds.`,
    });
  }
  if (skippedCombos > 0) {
    console.log(`[RoundRobin] Skipped ${skippedCombos}/${cappedCombos.length} combos (edge < 0.02 or avg score < 82)`);
  }

  // 7. Check for existing round robin parlays today (max 1 run per day)
  const { data: existing } = await supabase
    .from('bot_daily_parlays')
    .select('id')
    .eq('parlay_date', targetDate)
    .eq('tier', 'round_robin')
    .limit(1);

  if (existing && existing.length > 0) {
    throw new Error('Round robin already generated for today. Max 1 run per day.');
  }

  // 8. Insert all
  const allToInsert = [megaParlay, ...subParlays];
  const { error: insertError } = await supabase
    .from('bot_daily_parlays')
    .insert(allToInsert);

  if (insertError) throw insertError;

  // 9. Log activity
  await supabase.from('bot_activity_log').insert({
    event_type: 'round_robin_generated',
    message: `Bankroll Doubler: 1 mega-parlay (${eliteLegs.length}L, ${megaAmericanOdds > 0 ? '+' : ''}${megaAmericanOdds}) + ${subParlays.length} sub-parlays`,
    metadata: {
      eliteLegsCount: eliteLegs.length,
      megaOdds: megaAmericanOdds,
      subParlayCount: subParlays.length,
      subSize,
      megaPayout: STAKE * megaDecimalOdds,
    },
    severity: 'success',
  });

  console.log(`[RoundRobin] Created 1 mega + ${subParlays.length} subs = ${allToInsert.length} total`);

  return { megaParlay, subParlays, totalInserted: allToInsert.length };
}

// ============= MONSTER PARLAY GENERATION (+10,000 odds) =============

function generateMonsterParlays(
  pool: PropPool,
  globalFingerprints: Set<string>,
  targetDate: string,
  strategyName: string,
  weightMap: Map<string, number>,
  bankroll: number,
): any[] {
  console.log(`[Bot v2] 🔥 MONSTER PARLAY: Evaluating big-slate eligibility...`);

  // 1. Build quality candidate pool from all sources
  const allRawCandidates: any[] = [
    ...pool.teamPicks.map(p => ({ ...p, pickType: 'team' })),
    ...pool.playerPicks.map(p => ({ ...p, pickType: 'player' })),
    ...pool.whalePicks.map(p => ({ ...p, pickType: 'whale' })),
    ...pool.sweetSpots.map(p => ({ ...p, pickType: 'player' })),
  ].filter(p => !BLOCKED_SPORTS.includes(p.sport || 'basketball_nba'));

  // Deduplicate: keep highest composite per player/team key
  const dedupMap = new Map<string, any>();
  for (const pick of allRawCandidates) {
    const key = pick.pickType === 'team'
      ? `${pick.home_team}_${pick.away_team}_${pick.bet_type}_${pick.side}`.toLowerCase()
      : `${pick.player_name}_${pick.prop_type}_${pick.recommended_side || pick.side}`.toLowerCase();
    const existing = dedupMap.get(key);
    if (!existing || (pick.compositeScore || 0) > (existing.compositeScore || 0)) {
      dedupMap.set(key, pick);
    }
  }

  // Filter: hit rate >= 55%, composite >= 60, positive edge
  const qualityCandidates = [...dedupMap.values()]
    .filter(p => {
      const hitRate = ((p.confidence_score || p.l10_hit_rate || 0) * 100);
      const composite = p.compositeScore || 0;
      const edge = p.edge || p.simulated_edge || 0;
      if (hitRate < 55 || composite < 60 || edge <= 0) return false;

      // Weight check
      const pickSide = p.side || p.recommended_side || 'over';
      const pickSport = p.sport || 'basketball_nba';
      let pickCategory = p.category || '';
      if (pickCategory === 'TOTAL' || pickCategory === 'TEAM_TOTAL') {
        const prefix = pickSide === 'over' ? 'OVER' : 'UNDER';
        pickCategory = pickCategory === 'TOTAL' ? `${prefix}_TOTAL` : `${prefix}_TEAM_TOTAL`;
      }
      const sportKey = `${pickCategory}__${pickSide}__${pickSport}`;
      const sideKey = `${pickCategory}__${pickSide}`;
      const catWeight = weightMap.get(sportKey) ?? weightMap.get(sideKey) ?? weightMap.get(pickCategory) ?? 1.0;
      if (catWeight < 0.5) return false;

      // Spread cap
      if ((p.bet_type === 'spread' || p.prop_type === 'spread') && Math.abs(p.line || 0) >= MAX_SPREAD_LINE) return false;

      return true;
    })
    .sort((a, b) => {
      const hrA = ((a.confidence_score || a.l10_hit_rate || 0) * 100);
      const hrB = ((b.confidence_score || b.l10_hit_rate || 0) * 100);
      return hrB - hrA; // Sort by hit rate descending (accuracy-first)
    });

  // 2. Big-slate gate: need 15+ quality candidates across 2+ sports
  const activeSports = new Set(qualityCandidates.map(c => c.sport || 'basketball_nba'));
  if (qualityCandidates.length < 15 || activeSports.size < 2) {
    console.log(`[Bot v2] 🔥 MONSTER PARLAY: Skipped (${qualityCandidates.length} candidates, ${activeSports.size} sports — need 15+ candidates, 2+ sports)`);
    return [];
  }

  console.log(`[Bot v2] 🔥 MONSTER PARLAY: Big slate detected! ${qualityCandidates.length} quality candidates across ${activeSports.size} sports`);

  // 3. Helpers
  const getGameKey = (p: any) => {
    if (p.home_team && p.away_team) return `${p.home_team}__${p.away_team}`.toLowerCase();
    if (p.event_id) return p.event_id;
    return `${p.team_name || p.player_name}`.toLowerCase();
  };

  const getTeamKey = (p: any) => {
    if (p.pickType === 'team') return (p.side === 'home' ? p.home_team : p.away_team || p.home_team).toLowerCase();
    return (p.team_name || '').toLowerCase();
  };

  const isMirrorPick = (selected: any[], pick: any): boolean => {
    for (const s of selected) {
      if (s.pickType === 'team' && pick.pickType === 'team') {
        if (s.home_team === pick.home_team && s.away_team === pick.away_team && s.bet_type === pick.bet_type) {
          if (s.side !== pick.side) return true;
        }
      }
      if (s.player_name && pick.player_name && s.player_name === pick.player_name && s.prop_type === pick.prop_type) {
        if ((s.recommended_side || s.side) !== (pick.recommended_side || pick.side)) return true;
      }
    }
    return false;
  };

  const hasCorrelation = (selected: any[], pick: any): boolean => {
    for (const s of selected) {
      if (getGameKey(s) === getGameKey(pick)) return true; // No same-game
    }
    return false;
  };

  const calculateCombinedOdds = (legs: any[]): { decimalOdds: number; americanOdds: number } => {
    const decimalOdds = legs.reduce((acc, leg) => {
      const odds = leg.americanOdds || leg.odds || leg.american_odds || -110;
      return acc * americanToDecimal(odds);
    }, 1);
    return { decimalOdds, americanOdds: decimalToAmerican(decimalOdds) };
  };

  // 4. Greedy leg selection with diversity constraints
  function selectLegs(candidates: any[], targetOdds: number, maxLegs: number): any[] {
    const selected: any[] = [];
    const usedTeams = new Set<string>();
    const sportCount: Record<string, number> = {};

    for (const pick of candidates) {
      if (selected.length >= maxLegs) break;

      const teamKey = getTeamKey(pick);
      if (teamKey && usedTeams.has(teamKey)) continue;

      const sport = pick.sport || 'basketball_nba';
      if ((sportCount[sport] || 0) >= 2) continue;

      if (isMirrorPick(selected, pick)) continue;
      if (hasCorrelation(selected, pick)) continue;

      selected.push(pick);
      if (teamKey) usedTeams.add(teamKey);
      sportCount[sport] = (sportCount[sport] || 0) + 1;

      // Check if we've hit the odds target with 6+ legs
      if (selected.length >= 6) {
        const { americanOdds } = calculateCombinedOdds(selected);
        if (americanOdds >= targetOdds) break;
      }
    }
    return selected;
  }

  // 5. Build leg data (reuse pattern from mini-parlays)
  const buildMonsterLeg = (pick: any) => {
    if (pick.pickType === 'team' || pick.type === 'team') {
      return {
        id: pick.id,
        type: 'team',
        home_team: pick.home_team,
        away_team: pick.away_team,
        bet_type: pick.bet_type,
        side: pick.side,
        line: snapLine(pick.line, pick.bet_type),
        category: pick.category,
        american_odds: pick.odds || -110,
        sharp_score: pick.sharp_score,
        composite_score: pick.compositeScore || 0,
        hit_rate: ((pick.confidence_score || pick.l10_hit_rate || 0.5) * 100),
        outcome: 'pending',
        sport: pick.sport,
      };
    }
    return {
      id: pick.id,
      player_name: pick.player_name,
      team_name: pick.team_name,
      prop_type: pick.prop_type,
      line: snapLine(pick.line, pick.prop_type),
      side: pick.recommended_side || 'over',
      category: pick.category,
      weight: 1,
      hit_rate: ((pick.confidence_score || pick.l10_hit_rate || 0.5) * 100),
      american_odds: pick.americanOdds || -110,
      composite_score: pick.compositeScore || 0,
      outcome: 'pending',
      original_line: snapLine(pick.line, pick.prop_type),
      selected_line: snapLine(pick.line, pick.prop_type),
      projected_value: pick.projected_value || pick.l10_avg || 0,
      sport: pick.sport || 'basketball_nba',
    };
  };

  const monsters: any[] = [];

  // 6. Build Conservative Monster (+10,000 target)
  const conservativeLegs = selectLegs(qualityCandidates, 10000, 8);
  if (conservativeLegs.length < 6) {
    console.log(`[Bot v2] 🔥 MONSTER PARLAY: Only ${conservativeLegs.length} legs selected (need 6+). Skipping.`);
    return [];
  }

  const conservativeResult = calculateCombinedOdds(conservativeLegs);
  if (conservativeResult.americanOdds < 10000) {
    console.log(`[Bot v2] 🔥 MONSTER PARLAY: Combined odds +${conservativeResult.americanOdds} < +10,000. Skipping.`);
    return [];
  }

  const conservativeBuiltLegs = conservativeLegs.map(buildMonsterLeg);
  const avgHitRate = conservativeBuiltLegs.reduce((sum, l) => sum + (l.hit_rate || 0), 0) / conservativeBuiltLegs.length;
  const combinedProb = conservativeLegs.reduce((acc, p) => {
    const hr = (p.confidence_score || p.l10_hit_rate || 0.5);
    return acc * hr;
  }, 1);

  // Dedup fingerprint
  const consFp = conservativeBuiltLegs.map(l =>
    l.player_name ? `${l.player_name}_${l.prop_type}_${l.side}` : `${l.home_team}_${l.bet_type}_${l.side}`
  ).sort().join('||').toLowerCase();

  if (!globalFingerprints.has(consFp)) {
    globalFingerprints.add(consFp);
    monsters.push({
      parlay_date: targetDate,
      legs: conservativeBuiltLegs,
      leg_count: conservativeBuiltLegs.length,
      combined_probability: combinedProb,
      expected_odds: conservativeResult.americanOdds,
      simulated_win_rate: combinedProb,
      simulated_edge: Math.max(combinedProb - (1 / conservativeResult.decimalOdds), 0.005),
      simulated_sharpe: 0,
      strategy_name: 'monster_parlay_conservative',
      selection_rationale: `🔥 Monster Parlay: ${conservativeBuiltLegs.length} accuracy-first legs targeting +${conservativeResult.americanOdds}. Avg hit rate: ${avgHitRate.toFixed(1)}%. Every leg has 55%+ historical accuracy.`,
      outcome: 'pending',
      is_simulated: true,
      simulated_stake: 10,
      simulated_payout: 10 * conservativeResult.decimalOdds,
      tier: 'monster',
    });
    console.log(`[Bot v2] 🔥 MONSTER Conservative: ${conservativeBuiltLegs.length}L, +${conservativeResult.americanOdds}, avg HR ${avgHitRate.toFixed(1)}%`);
  }

  // 7. Aggressive Monster (+15,000-25,000) if pool allows
  const conservativeIds = new Set(conservativeLegs.map(l => l.id));
  const remainingCandidates = qualityCandidates.filter(c => !conservativeIds.has(c.id));

  if (remainingCandidates.length >= 2) {
    // Rebuild full pool but shuffle to get different combination
    const aggressivePool = [...qualityCandidates].sort((a, b) => {
      // Sort by composite descending for aggressive (different ordering = different picks)
      return (b.compositeScore || 0) - (a.compositeScore || 0);
    });
    const aggressiveLegs = selectLegs(aggressivePool, 15000, 8);

    if (aggressiveLegs.length >= 6) {
      const aggressiveResult = calculateCombinedOdds(aggressiveLegs);
      if (aggressiveResult.americanOdds >= 15000) {
        const aggressiveBuiltLegs = aggressiveLegs.map(buildMonsterLeg);
        const aggAvgHR = aggressiveBuiltLegs.reduce((sum, l) => sum + (l.hit_rate || 0), 0) / aggressiveBuiltLegs.length;
        const aggCombinedProb = aggressiveLegs.reduce((acc, p) => acc * (p.confidence_score || p.l10_hit_rate || 0.5), 1);

        const aggFp = aggressiveBuiltLegs.map(l =>
          l.player_name ? `${l.player_name}_${l.prop_type}_${l.side}` : `${l.home_team}_${l.bet_type}_${l.side}`
        ).sort().join('||').toLowerCase();

        if (!globalFingerprints.has(aggFp)) {
          globalFingerprints.add(aggFp);
          monsters.push({
            parlay_date: targetDate,
            legs: aggressiveBuiltLegs,
            leg_count: aggressiveBuiltLegs.length,
            combined_probability: aggCombinedProb,
            expected_odds: aggressiveResult.americanOdds,
            simulated_win_rate: aggCombinedProb,
            simulated_edge: Math.max(aggCombinedProb - (1 / aggressiveResult.decimalOdds), 0.005),
            simulated_sharpe: 0,
            strategy_name: 'monster_parlay_aggressive',
            selection_rationale: `🔥🔥 Aggressive Monster: ${aggressiveBuiltLegs.length} legs targeting +${aggressiveResult.americanOdds}. Avg hit rate: ${aggAvgHR.toFixed(1)}%. High-upside moonshot.`,
            outcome: 'pending',
            is_simulated: true,
            simulated_stake: 10,
            simulated_payout: 10 * aggressiveResult.decimalOdds,
            tier: 'monster',
          });
          console.log(`[Bot v2] 🔥🔥 MONSTER Aggressive: ${aggressiveBuiltLegs.length}L, +${aggressiveResult.americanOdds}, avg HR ${aggAvgHR.toFixed(1)}%`);
        }
      }
    }
  }

  console.log(`[Bot v2] 🔥 MONSTER PARLAY: ${monsters.length} monster parlays created`);
  return monsters;
}

// ============= DRY-RUN SYNTHETIC POOL =============

function generateSyntheticPool(): PropPool {
  console.log(`[DryRun] Generating synthetic prop pool for gate testing`);

  const NBA_TEAMS = [
    { name: 'Los Angeles Lakers', abbrev: 'LAL' },
    { name: 'Boston Celtics', abbrev: 'BOS' },
    { name: 'Denver Nuggets', abbrev: 'DEN' },
    { name: 'Milwaukee Bucks', abbrev: 'MIL' },
    { name: 'Phoenix Suns', abbrev: 'PHX' },
    { name: 'Golden State Warriors', abbrev: 'GSW' },
    { name: 'Dallas Mavericks', abbrev: 'DAL' },
    { name: 'Philadelphia 76ers', abbrev: 'PHI' },
  ];

  const PLAYERS = [
    { name: 'LeBron James', team: 'Los Angeles Lakers', propType: 'player_points', line: 25.5, hitRate: 0.72, proj: 28 },
    { name: 'Jayson Tatum', team: 'Boston Celtics', propType: 'player_points', line: 27.5, hitRate: 0.68, proj: 29 },
    { name: 'Nikola Jokic', team: 'Denver Nuggets', propType: 'player_assists', line: 8.5, hitRate: 0.74, proj: 10 },
    { name: 'Giannis Antetokounmpo', team: 'Milwaukee Bucks', propType: 'player_rebounds', line: 11.5, hitRate: 0.70, proj: 13 },
    { name: 'Devin Booker', team: 'Phoenix Suns', propType: 'player_points', line: 26.5, hitRate: 0.65, proj: 27 },
    { name: 'Stephen Curry', team: 'Golden State Warriors', propType: 'player_threes', line: 4.5, hitRate: 0.60, proj: 5.2 },
    { name: 'Luka Doncic', team: 'Dallas Mavericks', propType: 'player_points', line: 29.5, hitRate: 0.63, proj: 30 },
    { name: 'Joel Embiid', team: 'Philadelphia 76ers', propType: 'player_points', line: 30.5, hitRate: 0.58, proj: 28 },
    { name: 'Anthony Davis', team: 'Los Angeles Lakers', propType: 'player_rebounds', line: 11.5, hitRate: 0.66, proj: 12.5 },
    { name: 'Jrue Holiday', team: 'Boston Celtics', propType: 'player_assists', line: 5.5, hitRate: 0.55, proj: 5 },
    // Low-quality picks to exercise rejection gates
    { name: 'Bench Player A', team: 'Phoenix Suns', propType: 'player_points', line: 8.5, hitRate: 0.42, proj: 7 },
    { name: 'Bench Player B', team: 'Dallas Mavericks', propType: 'player_rebounds', line: 3.5, hitRate: 0.40, proj: 3 },
    { name: 'Role Player C', team: 'Denver Nuggets', propType: 'player_assists', line: 2.5, hitRate: 0.50, proj: 2.8 },
    { name: 'Starter D', team: 'Milwaukee Bucks', propType: 'player_points', line: 18.5, hitRate: 0.62, proj: 19 },
    { name: 'Guard E', team: 'Golden State Warriors', propType: 'player_assists', line: 6.5, hitRate: 0.58, proj: 6 },
  ];

  const GAMES = [
    { home: NBA_TEAMS[0], away: NBA_TEAMS[1], eventId: 'syn_game_1', total: 224.5, spread: -3.5 },
    { home: NBA_TEAMS[2], away: NBA_TEAMS[3], eventId: 'syn_game_2', total: 231.5, spread: -5.5 },
    { home: NBA_TEAMS[4], away: NBA_TEAMS[5], eventId: 'syn_game_3', total: 228.0, spread: -2.5 },
    { home: NBA_TEAMS[6], away: NBA_TEAMS[7], eventId: 'syn_game_4', total: 219.5, spread: -1.5 },
  ];

  // Generate player picks with varying quality
  const playerPicks: EnrichedPick[] = PLAYERS.map((p, i) => {
    const side = p.proj > p.line ? 'over' : 'under';
    const edge = Math.abs(p.proj - p.line);
    const americanOdds = -110;
    const oddsValueScore = calculateOddsValueScore(americanOdds, p.hitRate);
    const category = mapPropTypeToCategory(p.propType);
    const compositeScore = calculateCompositeScore(p.hitRate * 100, edge, oddsValueScore, 1.0, p.hitRate * 100, side);

    return {
      id: `syn_pick_${i}`,
      player_name: p.name,
      team_name: p.team,
      prop_type: p.propType,
      line: p.line,
      recommended_side: side,
      category,
      confidence_score: p.hitRate,
      l10_hit_rate: p.hitRate,
      projected_value: p.proj,
      sport: 'basketball_nba',
      event_id: GAMES.find(g => g.home.name === p.team || g.away.name === p.team)?.eventId || 'syn_game_1',
      americanOdds,
      oddsValueScore,
      compositeScore,
      has_real_line: true,
      line_source: 'synthetic_dry_run',
    } as EnrichedPick;
  });

  // Generate team picks
  const teamPicks: EnrichedTeamPick[] = [];
  for (const game of GAMES) {
    // Spread picks
    teamPicks.push({
      id: `${game.eventId}_spread_home`,
      type: 'team', sport: 'basketball_nba',
      home_team: game.home.name, away_team: game.away.name,
      bet_type: 'spread', side: 'home', line: game.spread,
      odds: -110, category: 'TEAM_SPREAD_HOME',
      sharp_score: 60, compositeScore: 72, confidence_score: 0.58,
      recommended_side: 'home',
    } as EnrichedTeamPick);
    teamPicks.push({
      id: `${game.eventId}_spread_away`,
      type: 'team', sport: 'basketball_nba',
      home_team: game.home.name, away_team: game.away.name,
      bet_type: 'spread', side: 'away', line: -game.spread,
      odds: -110, category: 'TEAM_SPREAD_AWAY',
      sharp_score: 55, compositeScore: 68, confidence_score: 0.55,
      recommended_side: 'away',
    } as EnrichedTeamPick);
    // Total picks
    teamPicks.push({
      id: `${game.eventId}_total_over`,
      type: 'team', sport: 'basketball_nba',
      home_team: game.home.name, away_team: game.away.name,
      bet_type: 'total', side: 'over', line: game.total,
      odds: -110, category: 'TEAM_TOTAL_OVER',
      sharp_score: 58, compositeScore: 75, confidence_score: 0.57,
      recommended_side: 'over',
    } as EnrichedTeamPick);
    teamPicks.push({
      id: `${game.eventId}_total_under`,
      type: 'team', sport: 'basketball_nba',
      home_team: game.home.name, away_team: game.away.name,
      bet_type: 'total', side: 'under', line: game.total,
      odds: -110, category: 'TEAM_TOTAL_UNDER',
      sharp_score: 62, compositeScore: 78, confidence_score: 0.60,
      recommended_side: 'under',
    } as EnrichedTeamPick);
  }

  console.log(`[DryRun] Synthetic pool: ${playerPicks.length} player props, ${teamPicks.length} team props`);

  return {
    playerPicks,
    teamPicks,
    sweetSpots: playerPicks,
    whalePicks: [],
    totalPool: playerPicks.length + teamPicks.length,
    goldenCategories: new Set(['HIGH_SCORER_OVER', 'ELITE_ASSIST_OVER']),
  };
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
    const action = body.action || 'generate';
    const targetDate = body.date || getEasternDateRange().gameDate;

    // === ROUND ROBIN ACTION ===
    if (action === 'round_robin') {
      console.log(`[Bot v2] Round robin requested for ${targetDate}`);
      
      // Get bankroll
      const { data: activationStatus } = await supabase
        .from('bot_activation_status')
        .select('simulated_bankroll')
        .order('check_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      const bankroll = activationStatus?.simulated_bankroll || 1000;
      
      const result = await generateRoundRobinParlays(supabase, targetDate, bankroll);
      
      return new Response(
        JSON.stringify({
          success: true,
          action: 'round_robin',
          megaParlay: result.megaParlay ? {
            legCount: result.megaParlay.leg_count,
            odds: result.megaParlay.expected_odds,
            payout: result.megaParlay.simulated_payout,
          } : null,
          subParlays: result.subParlays.length,
          totalInserted: result.totalInserted,
          date: targetDate,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const singleTier = body.tier as TierName | undefined;
    const winningPatterns = body.winning_patterns || null;
    const generationSource = body.source || 'manual';
    const isDryRun = body.dry_run === true;

    if (isDryRun) {
      console.log(`[Bot v2] 🧪 DRY-RUN MODE: No DB writes, synthetic data fallback enabled`);
    }

    console.log(`[Bot v2] Generating tiered parlays for ${targetDate} (source: ${generationSource})`);
    if (winningPatterns) {
      console.log(`[Bot v2] Pattern replay active: ${winningPatterns.hot_patterns?.length || 0} hot, ${winningPatterns.cold_patterns?.length || 0} cold patterns`);
    }

    // 1. Load category weights (all sports, including blocked for sport-specific overrides)
    const { data: allWeights, error: weightsError } = await supabase
      .from('bot_category_weights')
      .select('*');

    if (weightsError) throw weightsError;

    // Filter active weights for general use, but keep all for sport-specific map
    const weights = (allWeights || []).filter((w: CategoryWeight) => !w.is_blocked && w.weight >= 0.5);

    if (weightsError) throw weightsError;

    const weightMap = new Map<string, number>();
    // First: load sport-specific entries (including blocked ones with weight=0)
    (allWeights || []).forEach((w: CategoryWeight) => {
      if (w.sport && w.sport !== 'team_all') {
        // Sport-specific key always written (blocked = weight 0, prevents fallback to global)
        weightMap.set(`${w.category}__${w.side}__${w.sport}`, w.is_blocked ? 0 : w.weight);
      }
    });
    // Then: load global fallback keys from non-blocked weights only
    (weights || []).forEach((w: CategoryWeight) => {
      weightMap.set(`${w.category}__${w.side}`, w.weight);
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
    if (bankroll <= BANKROLL_FLOOR && !isDryRun) {
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

    // 4. Pre-detect light-slate mode (before pool building so ML Sniper can adapt)
    // Quick check: count player props available today
    const { startUtc: preStartUtc, endUtc: preEndUtc } = getEasternDateRange();
    const { count: playerPropCount } = await supabase
      .from('category_sweet_spots')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .gte('created_at', preStartUtc)
      .lte('created_at', preEndUtc);

    const { count: sportCount } = await supabase
      .from('game_bets')
      .select('sport', { count: 'exact', head: true })
      .gte('commence_time', preStartUtc)
      .lte('commence_time', preEndUtc);

    // === ZERO-GAME GRACEFUL MODE ===
    // If 0 games scheduled, skip generation entirely and notify
    if ((sportCount || 0) === 0) {
      console.log(`[Bot v2] 🚫 ZERO-GAME MODE: No games scheduled for ${targetDate}. Skipping generation.`);
      await supabase.from('bot_activity_log').insert({
        event_type: 'zero_game_day',
        message: `No games scheduled for ${targetDate}. Generation skipped.`,
        severity: 'info',
        metadata: { date: targetDate, playerProps: playerPropCount || 0 },
      });
      try {
        await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
          body: JSON.stringify({
            type: 'daily_summary',
            data: { parlaysCount: 0, winRate: 0, edge: 0, bankroll, mode: '🚫 No Slate Today - Zero games scheduled' },
          }),
        });
      } catch (_) { /* ignore */ }
      return new Response(
        JSON.stringify({ success: true, parlaysGenerated: 0, reason: 'zero_game_day', date: targetDate }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isLightSlateMode = (playerPropCount || 0) === 0 || (sportCount || 0) <= 2;
    if (isLightSlateMode) {
      console.log(`[Bot v2] 🌙 LIGHT-SLATE MODE: ${playerPropCount || 0} player props, ${sportCount || 0} sports. Lowering ML Sniper floor to 55, relaxing constraints.`);
    }

    // Build prop pool (passes light-slate flag for adaptive ML Sniper floor)
    let pool = await buildPropPool(supabase, targetDate, weightMap, weights as CategoryWeight[] || [], isLightSlateMode);

    // Check if we have real odds data
    const realLinePicks = pool.playerPicks.filter(p => p.has_real_line);
    // On light-slate days, lower the pool minimum to allow team-only generation
    const minPoolSize = isLightSlateMode ? 3 : 5;
    const minRealLines = isLightSlateMode ? 0 : 3;
    if (pool.totalPool < minPoolSize || (!isLightSlateMode && realLinePicks.length < 3 && pool.teamPicks.length < 3)) {
      if (isDryRun) {
        console.log(`[DryRun] Real pool empty — injecting synthetic data to exercise scoring gates`);
        pool = generateSyntheticPool();
      } else {
        const reason = pool.totalPool < minPoolSize 
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
    }

    // 5. Detect thin slate mode (combines with light-slate)
    const isThinSlate = pool.totalPool < 25 || isLightSlateMode;
    if (isThinSlate) {
      console.log(`[Bot v2] 🔶 THIN SLATE MODE: ${pool.totalPool} picks. Relaxing validation gates.`);
    }

    // Generate parlays for each tier
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
    const globalMirrorPrints = new Set<string>();
    const { data: existingParlays } = await supabase
      .from('bot_daily_parlays')
      .select('legs, leg_count')
      .eq('parlay_date', targetDate);
    const existingSingleKeys = new Set<string>();
    if (existingParlays) {
      for (const p of existingParlays) {
        const legs = Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs);
        globalFingerprints.add(createParlayFingerprint(legs));
        globalMirrorPrints.add(createMirrorFingerprint(legs));
        // Pre-load single-pick dedup keys
        if (p.leg_count === 1 && legs[0]) {
          const leg = legs[0];
          const key = leg.type === 'team'
            ? `${leg.home_team}_${leg.away_team}_${leg.bet_type}_${leg.side}`.toLowerCase()
            : `${leg.player_name}_${leg.prop_type}_${leg.side}`.toLowerCase();
          existingSingleKeys.add(key);
        }
      }
      console.log(`[Bot v2] Pre-loaded ${globalFingerprints.size} fingerprints + ${globalMirrorPrints.size} mirror prints + ${existingSingleKeys.size} single-pick keys for ${targetDate}`);
    }

    // Light-slate: increase usage limits for exploration tier
    if (isLightSlateMode) {
      TIER_CONFIG.exploration.maxTeamUsage = 5;
      TIER_CONFIG.exploration.maxCategoryUsage = 8;
      console.log(`[Bot v2] Light-slate: exploration maxTeamUsage=5, maxCategoryUsage=8`);
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
        globalMirrorPrints,
        pool.goldenCategories,
        isThinSlate,
        winningPatterns
      );
      results[tier] = result;
      allParlays = [...allParlays, ...result.parlays];
    }

    // === MONSTER PARLAY (big-slate only) ===
    const monsterParlays = generateMonsterParlays(pool, globalFingerprints, targetDate, strategyName, weightMap, bankroll);
    if (monsterParlays.length > 0) {
      allParlays.push(...monsterParlays);
      console.log(`[Bot v2] 🔥 Monster parlays: ${monsterParlays.length} created (${monsterParlays.map((m: any) => '+' + m.expected_odds).join(', ')})`);
    }

    // === 2-LEG MINI-PARLAY HYBRID FALLBACK ===
    if (allParlays.length < 10) {
      console.log(`[Bot v2] 🔗 MINI-PARLAY FALLBACK: Only ${allParlays.length} parlays. Attempting 2-leg mini-parlays.`);

      // Build candidate pool (same merge + dedup as singles)
      const miniCandidates: any[] = [
        ...[
          ...pool.teamPicks.map(p => ({ ...p, pickType: 'team' })),
          ...pool.playerPicks.map(p => ({ ...p, pickType: 'player' })),
          ...pool.whalePicks.map(p => ({ ...p, pickType: 'whale' })),
          ...pool.sweetSpots.map(p => ({ ...p, pickType: 'player' })),
        ]
          .filter(p => !BLOCKED_SPORTS.includes(p.sport || 'basketball_nba'))
          .reduce((acc, pick) => {
            const key = pick.pickType === 'team'
              ? `${pick.home_team}_${pick.away_team}_${pick.bet_type}_${pick.side}`.toLowerCase()
              : `${pick.player_name}_${pick.prop_type}_${pick.recommended_side || pick.side}`.toLowerCase();
            const existing = acc.get(key);
            if (!existing || (pick.compositeScore || 0) > (existing.compositeScore || 0)) {
              acc.set(key, pick);
            }
            return acc;
          }, new Map<string, any>())
          .values()
      ]
        .filter(p => {
          const composite = p.compositeScore || 0;
          const hitRate = (p.confidence_score || p.l10_hit_rate || 0.5) * 100;
          if (composite < 58 || hitRate < 50) return false;

          // Weight check
          const pickSide = p.side || p.recommended_side || 'over';
          const pickSport = p.sport || 'basketball_nba';
          let pickCategory = p.category || '';
          if (pickCategory === 'TOTAL' || pickCategory === 'TEAM_TOTAL') {
            const prefix = pickSide === 'over' ? 'OVER' : 'UNDER';
            pickCategory = pickCategory === 'TOTAL' ? `${prefix}_TOTAL` : `${prefix}_TEAM_TOTAL`;
          }
          const sportKey = `${pickCategory}__${pickSide}__${pickSport}`;
          const sideKey = `${pickCategory}__${pickSide}`;
          const catWeight = weightMap.get(sportKey) ?? weightMap.get(sideKey) ?? weightMap.get(pickCategory) ?? 1.0;
          if (catWeight < 0.5) return false;

          // Spread cap
          if ((p.bet_type === 'spread' || p.prop_type === 'spread') && Math.abs(p.line || 0) >= MAX_SPREAD_LINE) return false;

          return true;
        })
        .sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));

      console.log(`[Bot v2] Mini-parlay candidate pool: ${miniCandidates.length}`);

      // Helper: get game identity for a pick
      const getGameKey = (p: any) => {
        if (p.home_team && p.away_team) return `${p.home_team}__${p.away_team}`.toLowerCase();
        if (p.event_id) return p.event_id;
        return `${p.team_name || p.player_name}`.toLowerCase();
      };

      // Helper: mirror check (same matchup, opposite sides)
      const isMirrorPair = (a: any, b: any) => {
        if (a.pickType === 'team' && b.pickType === 'team') {
          if (a.home_team === b.home_team && a.away_team === b.away_team && a.bet_type === b.bet_type) {
            return a.side !== b.side;
          }
        }
        if (a.player_name && b.player_name && a.player_name === b.player_name && a.prop_type === b.prop_type) {
          return (a.recommended_side || a.side) !== (b.recommended_side || b.side);
        }
        return false;
      };

      interface MiniParlay {
        leg1: any;
        leg2: any;
        avgComposite: number;
        avgHitRate: number;
        combinedProb: number;
        combinedEdge: number;
        combinedSharpe: number;
        combinedOdds: number;
      }

      const miniParlays: MiniParlay[] = [];
      const usedMiniKeys = new Set<string>();
      const MAX_MINI_PARLAYS = 16;

      for (let i = 0; i < miniCandidates.length && miniParlays.length < MAX_MINI_PARLAYS * 3; i++) {
        for (let j = i + 1; j < miniCandidates.length && miniParlays.length < MAX_MINI_PARLAYS * 3; j++) {
          const p1 = miniCandidates[i];
          const p2 = miniCandidates[j];

          // Different games only
          if (getGameKey(p1) === getGameKey(p2)) continue;

          // No mirror pairs
          if (isMirrorPair(p1, p2)) continue;

          // Dedup fingerprint
          const fp = [
            p1.pickType === 'team' ? `${p1.home_team}_${p1.bet_type}_${p1.side}` : `${p1.player_name}_${p1.prop_type}_${p1.recommended_side || p1.side}`,
            p2.pickType === 'team' ? `${p2.home_team}_${p2.bet_type}_${p2.side}` : `${p2.player_name}_${p2.prop_type}_${p2.recommended_side || p2.side}`,
          ].sort().join('||').toLowerCase();

          if (usedMiniKeys.has(fp)) continue;
          if (globalFingerprints.has(fp)) continue;

          const comp1 = p1.compositeScore || 0;
          const comp2 = p2.compositeScore || 0;
          const avgComposite = (comp1 + comp2) / 2;
          if (avgComposite < 60) continue;

          const hr1 = (p1.confidence_score || p1.l10_hit_rate || 0.5) * 100;
          const hr2 = (p2.confidence_score || p2.l10_hit_rate || 0.5) * 100;
          const avgHitRate = (hr1 + hr2) / 2;

          const prob1 = hr1 / 100;
          const prob2 = hr2 / 100;
          const combinedProb = prob1 * prob2;
          if (combinedProb < 0.25) continue;

          const odds1 = p1.americanOdds || p1.odds || -110;
          const odds2 = p2.americanOdds || p2.odds || -110;
          const ip1 = odds1 < 0 ? Math.abs(odds1) / (Math.abs(odds1) + 100) : 100 / (odds1 + 100);
          const ip2 = odds2 < 0 ? Math.abs(odds2) / (Math.abs(odds2) + 100) : 100 / (odds2 + 100);
          const combinedImplied = ip1 * ip2;
          const combinedEdge = combinedProb - combinedImplied;
          if (combinedEdge <= 0) continue;

          // Calculate combined American odds from implied
          const combinedOdds = combinedImplied >= 0.5
            ? Math.round(-100 * combinedImplied / (1 - combinedImplied))
            : Math.round(100 * (1 - combinedImplied) / combinedImplied);

          const combinedSharpe = combinedEdge / Math.max(Math.sqrt(combinedProb * (1 - combinedProb)), 0.1);

          usedMiniKeys.add(fp);
          miniParlays.push({
            leg1: p1, leg2: p2,
            avgComposite, avgHitRate, combinedProb, combinedEdge, combinedSharpe, combinedOdds,
          });
        }
      }

      // Sort by combined edge descending
      miniParlays.sort((a, b) => b.combinedEdge - a.combinedEdge);

      // Assign tiers with caps
      const miniTierCaps = { execution: 3, validation: 5, exploration: 8 };
      const miniTierCounts = { execution: 0, validation: 0, exploration: 0 };
      let totalMiniCreated = 0;

      for (const mp of miniParlays) {
        if (totalMiniCreated >= MAX_MINI_PARLAYS) break;

        let tier: TierName;
        if (mp.avgComposite >= 70 && mp.avgHitRate >= 58 && miniTierCounts.execution < miniTierCaps.execution) {
          tier = 'execution';
        } else if (mp.avgComposite >= 62 && miniTierCounts.validation < miniTierCaps.validation) {
          tier = 'validation';
        } else if (miniTierCounts.exploration < miniTierCaps.exploration) {
          tier = 'exploration';
        } else {
          continue;
        }

        // Build leg data for each leg
        const buildLeg = (pick: any) => {
          if (pick.pickType === 'team' || pick.type === 'team') {
            return {
              id: pick.id,
              type: 'team',
              home_team: pick.home_team,
              away_team: pick.away_team,
              bet_type: pick.bet_type,
              side: pick.side,
              line: snapLine(pick.line, pick.bet_type),
              category: pick.category,
              american_odds: pick.odds || -110,
              sharp_score: pick.sharp_score,
              composite_score: pick.compositeScore || 0,
              outcome: 'pending',
              sport: pick.sport,
            };
          }
          return {
            id: pick.id,
            player_name: pick.player_name,
            team_name: pick.team_name,
            prop_type: pick.prop_type,
            line: snapLine(pick.line, pick.prop_type),
            side: pick.recommended_side || 'over',
            category: pick.category,
            weight: 1,
            hit_rate: (pick.confidence_score || pick.l10_hit_rate || 0.5) * 100,
            american_odds: pick.americanOdds || -110,
            odds_value_score: pick.oddsValueScore,
            composite_score: pick.compositeScore || 0,
            outcome: 'pending',
            original_line: snapLine(pick.line, pick.prop_type),
            selected_line: snapLine(pick.line, pick.prop_type),
            line_selection_reason: 'mini_parlay',
            projection_buffer: (pick.projected_value || pick.l10_avg || 0) - pick.line,
            projected_value: pick.projected_value || pick.l10_avg || 0,
            line_source: pick.line_source || 'projected',
            has_real_line: pick.has_real_line || false,
            sport: pick.sport || 'basketball_nba',
          };
        };

        const leg1Data = buildLeg(mp.leg1);
        const leg2Data = buildLeg(mp.leg2);

        const leg1Name = leg1Data.player_name || `${leg1Data.home_team} vs ${leg1Data.away_team}`;
        const leg2Name = leg2Data.player_name || `${leg2Data.home_team} vs ${leg2Data.away_team}`;

        allParlays.push({
          parlay_date: targetDate,
          legs: [leg1Data, leg2Data],
          leg_count: 2,
          combined_probability: mp.combinedProb,
          expected_odds: mp.combinedOdds,
          simulated_win_rate: mp.combinedProb,
          simulated_edge: Math.max(mp.combinedEdge, 0.005),
          simulated_sharpe: mp.combinedSharpe,
          strategy_name: `${strategyName}_${tier}_mini_parlay`,
          selection_rationale: `${tier} mini-parlay: ${leg1Name} (${mp.leg1.compositeScore?.toFixed(0) || '?'}) + ${leg2Name} (${mp.leg2.compositeScore?.toFixed(0) || '?'}) | avg composite ${mp.avgComposite.toFixed(0)}`,
          outcome: 'pending',
          is_simulated: tier !== 'execution',
          simulated_stake: getDynamicStake(tier, isLightSlateMode, 100),
          tier: tier,
        });

        // Add fingerprint to prevent DB duplication
        const fp = [
          mp.leg1.pickType === 'team' ? `${mp.leg1.home_team}_${mp.leg1.bet_type}_${mp.leg1.side}` : `${mp.leg1.player_name}_${mp.leg1.prop_type}_${mp.leg1.recommended_side || mp.leg1.side}`,
          mp.leg2.pickType === 'team' ? `${mp.leg2.home_team}_${mp.leg2.bet_type}_${mp.leg2.side}` : `${mp.leg2.player_name}_${mp.leg2.prop_type}_${mp.leg2.recommended_side || mp.leg2.side}`,
        ].sort().join('||').toLowerCase();
        globalFingerprints.add(fp);

        miniTierCounts[tier]++;
        totalMiniCreated++;
      }

      console.log(`[Bot v2] 🔗 Mini-parlays created: ${totalMiniCreated} (exec=${miniTierCounts.execution}, valid=${miniTierCounts.validation}, explore=${miniTierCounts.exploration})`);
    }

    // === SINGLE PICK FALLBACK ===
    // If fewer than 10 parlays generated, create single picks (1-leg straight bets)
    if (allParlays.length < 10) {
      console.log(`[Bot v2] 🎯 SINGLE PICK FALLBACK: Only ${allParlays.length} parlays generated. Creating single picks.`);
      
      // Merge all picks, sort by composite score
      const allPicksForSingles: any[] = [
        ...[
          ...pool.teamPicks.map(p => ({ ...p, pickType: 'team' })),
          ...pool.playerPicks.map(p => ({ ...p, pickType: 'player' })),
          ...pool.whalePicks.map(p => ({ ...p, pickType: 'whale' })),
          ...pool.sweetSpots.map(p => ({ ...p, pickType: 'player' })),
        ]
          .filter(p => !BLOCKED_SPORTS.includes(p.sport || 'basketball_nba'))
          .reduce((acc, pick) => {
            const key = pick.pickType === 'team'
              ? `${pick.home_team}_${pick.away_team}_${pick.bet_type}_${pick.side}`.toLowerCase()
              : `${pick.player_name}_${pick.prop_type}_${pick.recommended_side || pick.side}`.toLowerCase();
            const existing = acc.get(key);
            if (!existing || (pick.compositeScore || 0) > (existing.compositeScore || 0)) {
              acc.set(key, pick);
            }
            return acc;
          }, new Map<string, any>())
          .values()
      ]
        .sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));

      console.log(`[Bot v2] Single pick pool: ${allPicksForSingles.length} candidates (team=${pool.teamPicks.length}, player=${pool.playerPicks.length}, whale=${pool.whalePicks.length}, sweetSpots=${pool.sweetSpots.length})`);

      const singlePickTiers: { tier: TierName; minComposite: number; minHitRate: number; maxCount: number }[] = [
        { tier: 'exploration', minComposite: 55, minHitRate: 45, maxCount: 15 },
        { tier: 'validation', minComposite: 60, minHitRate: 50, maxCount: 5 },
        { tier: 'execution', minComposite: 70, minHitRate: 58, maxCount: 3 },
      ];

      const usedSingleKeys = new Set<string>(existingSingleKeys);

      for (const spTier of singlePickTiers) {
        let singlesCreated = 0;
        for (const pick of allPicksForSingles) {
          if (singlesCreated >= spTier.maxCount) break;

          const composite = pick.compositeScore || 0;
          const hitRate = (pick.confidence_score || pick.l10_hit_rate || 0.5) * 100;
          if (composite < spTier.minComposite || hitRate < spTier.minHitRate) continue;

          // === WEIGHT CHECK + TOTAL SIDE FLIP ===
          // Respect bot_category_weights blocking for single picks too
          const pickSide = pick.side || pick.recommended_side || 'over';
          const pickSport = pick.sport || 'basketball_nba';
          
          // Normalize generic "TOTAL"/"TEAM_TOTAL" to side-specific variant for weight lookup
          let pickCategory = pick.category || '';
          if (pickCategory === 'TOTAL' || pickCategory === 'TEAM_TOTAL') {
            const prefix = pickSide === 'over' ? 'OVER' : 'UNDER';
            pickCategory = pickCategory === 'TOTAL' 
              ? `${prefix}_TOTAL` 
              : `${prefix}_TEAM_TOTAL`;
          }
          
          const sportKey = `${pickCategory}__${pickSide}__${pickSport}`;
          const sideKey = `${pickCategory}__${pickSide}`;
          const catWeight = weightMap.get(sportKey) ?? weightMap.get(sideKey) ?? weightMap.get(pickCategory) ?? 1.0;

          if (catWeight === 0) {
            // Blocked category — try flipping totals
            if (pick.bet_type === 'total' || pick.bet_type === 'team_total') {
              const flippedSide = pickSide === 'over' ? 'under' : 'over';
              const flippedCategory = pickSide === 'over'
                ? pickCategory.replace('OVER', 'UNDER')
                : pickCategory.replace('UNDER', 'OVER');
              const flippedSportKey = `${flippedCategory}__${flippedSide}__${pickSport}`;
              const flippedSideKey = `${flippedCategory}__${flippedSide}`;
              const flippedWeight = weightMap.get(flippedSportKey) ?? weightMap.get(flippedSideKey) ?? weightMap.get(flippedCategory) ?? 1.0;

              if (flippedWeight > 0) {
                console.log(`[Bot v2] 🔄 SINGLE FLIP: ${pickCategory}/${pickSide} blocked → flipped to ${flippedCategory}/${flippedSide} (weight ${flippedWeight})`);
                pick.side = flippedSide;
                pick.category = flippedCategory;
                if (pick.recommended_side) pick.recommended_side = flippedSide;
              } else {
                console.log(`[Bot v2] 🚫 SINGLE SKIP: ${pickCategory}/${pickSide} blocked, flip also blocked`);
                continue;
              }
            } else {
              console.log(`[Bot v2] 🚫 SINGLE SKIP: ${pickCategory}/${pickSide} blocked (weight=0)`);
              continue;
            }
          } else if (catWeight < 0.5) {
            console.log(`[Bot v2] 🚫 SINGLE SKIP: ${pickCategory}/${pickSide} too weak for singles (weight=${catWeight})`);
            continue;
          }

          // SPREAD CAP for singles: block spreads above MAX_SPREAD_LINE
          if (
            (pick.bet_type === 'spread' || pick.prop_type === 'spread') &&
            Math.abs(pick.line || 0) >= MAX_SPREAD_LINE
          ) {
            console.log(`[Bot v2] 🚫 SINGLE SKIP (SpreadCap): ${pick.player_name || pick.home_team} spread ${pick.line} exceeds max ${MAX_SPREAD_LINE}`);
            continue;
          }

          // Dedup key
          const singleKey = pick.pickType === 'team'
            ? `${pick.home_team}_${pick.away_team}_${pick.bet_type}_${pick.side}`.toLowerCase()
            : `${pick.player_name}_${pick.prop_type}_${pick.recommended_side}`.toLowerCase();
          if (usedSingleKeys.has(singleKey)) continue;
          usedSingleKeys.add(singleKey);

          // Build the single leg
          let legData: any;
          if (pick.pickType === 'team' || pick.type === 'team') {
            legData = {
              id: pick.id,
              type: 'team',
              home_team: pick.home_team,
              away_team: pick.away_team,
              bet_type: pick.bet_type,
              side: pick.side,
              line: snapLine(pick.line, pick.bet_type),
              category: pick.category,
              american_odds: pick.odds || -110,
              sharp_score: pick.sharp_score,
              composite_score: composite,
              outcome: 'pending',
              sport: pick.sport,
            };
          } else {
            legData = {
              id: pick.id,
              player_name: pick.player_name,
              team_name: pick.team_name,
              prop_type: pick.prop_type,
              line: snapLine(pick.line, pick.prop_type),
              side: pick.recommended_side || 'over',
              category: pick.category,
              weight: 1,
              hit_rate: hitRate,
              american_odds: pick.americanOdds || -110,
              odds_value_score: pick.oddsValueScore,
              composite_score: composite,
              outcome: 'pending',
              original_line: snapLine(pick.line, pick.prop_type),
              selected_line: snapLine(pick.line, pick.prop_type),
              line_selection_reason: 'single_pick',
              projection_buffer: (pick.projected_value || pick.l10_avg || 0) - pick.line,
              projected_value: pick.projected_value || pick.l10_avg || 0,
              line_source: pick.line_source || 'projected',
              has_real_line: pick.has_real_line || false,
              sport: pick.sport || 'basketball_nba',
            };
          }

          const odds = legData.american_odds || -110;
          const impliedProb = odds < 0
            ? Math.abs(odds) / (Math.abs(odds) + 100)
            : 100 / (odds + 100);
          const edge = (hitRate / 100) - impliedProb;

          const strategyType = composite >= 70 ? 'single_pick_accuracy' : 'single_pick_value';

          allParlays.push({
            parlay_date: targetDate,
            legs: [legData],
            leg_count: 1,
            combined_probability: hitRate / 100,
            expected_odds: odds,
            simulated_win_rate: hitRate / 100,
            simulated_edge: Math.max(edge, 0.005),
            simulated_sharpe: edge / 0.5,
            strategy_name: `${strategyName}_${spTier.tier}_${strategyType}`,
            selection_rationale: `${spTier.tier} tier: ${strategyType} (1-leg single pick, composite ${composite.toFixed(0)})`,
            outcome: 'pending',
            is_simulated: spTier.tier !== 'execution',
            simulated_stake: getDynamicStake(spTier.tier, isLightSlateMode, 100),
            tier: spTier.tier,
          });

          singlesCreated++;
        }
        console.log(`[Bot v2] Single picks created for ${spTier.tier}: ${singlesCreated}`);
      }
    }

    console.log(`[Bot v2] Total parlays + singles created: ${allParlays.length}`);

    // === DRY-RUN: Skip all DB writes and return detailed gate analysis ===
    if (isDryRun) {
      const tierSummary: Record<string, any> = {};
      for (const [tier, result] of Object.entries(results)) {
        tierSummary[tier] = {
          count: result.count,
          legDistribution: result.parlays.reduce((acc, p) => {
            acc[p.leg_count] = (acc[p.leg_count] || 0) + 1;
            return acc;
          }, {} as Record<number, number>),
        };
      }

      // Build detailed parlay breakdown for dry-run analysis
      const parlayDetails = allParlays.map((p, i) => ({
        index: i + 1,
        tier: p.tier,
        strategy: p.strategy_name,
        legCount: p.leg_count,
        legs: (Array.isArray(p.legs) ? p.legs : []).map((l: any) => ({
          name: l.player_name || `${l.home_team} vs ${l.away_team}`,
          type: l.type || 'player',
          betType: l.prop_type || l.bet_type,
          side: l.side,
          line: l.line,
          compositeScore: l.composite_score || l.sharp_score || 0,
          hitRate: l.hit_rate || 0,
        })),
        combinedProbability: p.combined_probability,
        edge: p.simulated_edge,
        sharpe: p.simulated_sharpe,
        odds: p.expected_odds,
        avgLegScore: (Array.isArray(p.legs) ? p.legs : []).reduce((s: number, l: any) => s + (l.composite_score || l.sharp_score || 0), 0) / (p.leg_count || 1),
      }));

      console.log(`[DryRun] Complete: ${allParlays.length} parlays generated (0 written to DB)`);

      return new Response(
        JSON.stringify({
          success: true,
          dry_run: true,
          parlaysGenerated: allParlays.length,
          parlaysWrittenToDb: 0,
          tierSummary,
          poolSize: pool.totalPool,
          playerPicks: pool.playerPicks.length,
          teamPicks: pool.teamPicks.length,
          syntheticData: pool.playerPicks.some(p => p.line_source === 'synthetic_dry_run'),
          parlayDetails,
          gateConfig: {
            gap1_dynamicWeighting: 'Hit-rate weight 50% for 4+ legs (vs 40% for ≤3)',
            gap2_perLegMinScore: { '≤3_legs': 80, '4-5_legs': 90, '6+_legs': 95 },
            gap3_legCountPenalty: '3% per leg beyond 3rd',
            gap4_correlationTax: '15% edge haircut for same-game legs',
            gap5_parlayScoreFloor: { exploration: 75, validation: 80, execution: 85 },
            gap6_roundRobinGates: { minEdge: 0.02, minAvgScore: 82 },
          },
          date: targetDate,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    // 10. Send Telegram notification with top picks preview
    try {
      // Extract top 5 legs by composite score across all parlays
      const allLegs: any[] = [];
      const seenKeys = new Set<string>();
      for (const p of allParlays) {
        const legs = Array.isArray(p.legs) ? p.legs : [];
        for (const leg of legs) {
          const key = leg.type === 'team'
            ? `team_${(leg.home_team || '').toLowerCase()}_${leg.bet_type}_${leg.side}`
            : `${(leg.player_name || '').toLowerCase()}_${leg.prop_type}_${leg.side}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          allLegs.push(leg);
        }
      }
      allLegs.sort((a, b) => (b.composite_score || 0) - (a.composite_score || 0));
      const topPicks = allLegs.slice(0, 5);

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
            topPicks,
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
