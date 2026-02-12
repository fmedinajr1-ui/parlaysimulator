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
      // NCAAB exploration (5 profiles)
      { legs: 3, strategy: 'ncaab_safe', sports: ['basketball_ncaab'] },
      { legs: 3, strategy: 'ncaab_safe', sports: ['basketball_ncaab'] },
      { legs: 4, strategy: 'ncaab_balanced', sports: ['basketball_ncaab'] },
      { legs: 4, strategy: 'ncaab_mixed', sports: ['basketball_nba', 'basketball_ncaab'] },
      { legs: 5, strategy: 'ncaab_aggressive', sports: ['basketball_ncaab'] },
      // Team props exploration (10 profiles)
      { legs: 3, strategy: 'team_ml', betTypes: ['moneyline'] },
      { legs: 3, strategy: 'team_ml', betTypes: ['moneyline'] },
      { legs: 3, strategy: 'team_ml', betTypes: ['moneyline'] },
      { legs: 3, strategy: 'team_totals', betTypes: ['total'] },
      { legs: 4, strategy: 'team_ml', betTypes: ['moneyline'] },
      { legs: 4, strategy: 'team_mixed', betTypes: ['spread', 'total'] },
      { legs: 3, strategy: 'team_ml_cross', betTypes: ['moneyline'], sports: ['basketball_nba', 'basketball_ncaab'] },
      { legs: 3, strategy: 'team_ml_cross', betTypes: ['moneyline'], sports: ['basketball_nba', 'basketball_ncaab'] },
      { legs: 3, strategy: 'team_totals', betTypes: ['total'] },
      { legs: 4, strategy: 'team_mixed', betTypes: ['spread', 'total', 'moneyline'] },
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
      { legs: 3, strategy: 'validated_ncaab', sports: ['basketball_ncaab'], minOddsValue: 45, minHitRate: 55 },
      { legs: 3, strategy: 'validated_ncaab', sports: ['basketball_ncaab'], minOddsValue: 45, minHitRate: 55 },
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

function clampScore(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

function calculateTeamCompositeScore(
  game: TeamProp,
  betType: string,
  side: string,
  paceMap: Map<string, PaceData>,
  defenseMap: Map<string, number>,
  envMap: Map<string, GameEnvData>,
  homeCourtMap: Map<string, HomeCourtData>
): { score: number; breakdown: Record<string, number> } {
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
    .in('category', ['injury_intel', 'statistical_models'])
    .eq('research_date', gameDate)
    .is('action_taken', null);

  if (error) {
    console.warn(`[ResearchIntel] Failed to mark research consumed:`, error.message);
  } else {
    console.log(`[ResearchIntel] Marked research findings as consumed for ${gameDate}`);
  }
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

  const [activePlayersToday, injuryData, teamsPlayingToday, researchBlocklist, researchEdge] = await Promise.all([
    fetchActivePlayersToday(supabase, startUtc, endUtc),
    fetchInjuryBlocklist(supabase, gameDate),
    fetchTeamsPlayingToday(supabase, startUtc, endUtc, gameDate),
    fetchResearchInjuryIntel(supabase, gameDate),
    fetchResearchEdgeThreshold(supabase),
  ]);
  const { blocklist, penalties } = injuryData;

  // Merge research injury intel into blocklist
  for (const player of researchBlocklist) {
    blocklist.add(player);
  }
  if (researchBlocklist.size > 0) {
    console.log(`[Bot] Merged ${researchBlocklist.size} research-sourced OUT players into blocklist`);
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

  // 4. Fetch team intelligence data in parallel
  const [paceResult, defenseResult, envResult, homeCourtResult] = await Promise.all([
    supabase.from('nba_team_pace_projections').select('team_abbrev, team_name, pace_rating, pace_rank, tempo_factor'),
    supabase.from('team_defense_rankings').select('team_abbreviation, team_name, overall_rank').eq('is_current', true),
    supabase.from('game_environment').select('home_team_abbrev, away_team_abbrev, vegas_total, vegas_spread, shootout_factor, grind_factor, blowout_probability').eq('game_date', gameDate),
    supabase.from('home_court_advantage_stats').select('team_name, home_win_rate, home_cover_rate, home_over_rate').eq('sport', 'basketball_nba'),
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
    // Also map by abbreviation
    const abbrev = nameToAbbrev.get(h.team_name);
    if (abbrev) homeCourtMap.set(abbrev, { home_win_rate: h.home_win_rate, home_cover_rate: h.home_cover_rate, home_over_rate: h.home_over_rate });
  });

  console.log(`[Bot] Intelligence data: ${paceMap.size} pace, ${defenseMap.size} defense, ${envMap.size} env, ${homeCourtMap.size} home court`);

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

  console.log(`[Bot] Filtered to ${enrichedSweetSpots.length} picks with verified sportsbook lines (removed projected-only legs)`);

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
        const { score, breakdown } = calculateTeamCompositeScore(gameForScoring, 'spread', 'home', paceMap, defenseMap, envMap, homeCourtMap);
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
        const { score, breakdown } = calculateTeamCompositeScore(gameForScoring, 'spread', 'away', paceMap, defenseMap, envMap, homeCourtMap);
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
      const { score: overScore, breakdown: overBreakdown } = calculateTeamCompositeScore(gameForScoring, 'total', 'over', paceMap, defenseMap, envMap, homeCourtMap);
      const overPlusBonus = isPlusMoney(game.over_odds) ? 5 : 0;
      picks.push({
        id: `${game.id}_total_over`,
        type: 'team', sport: game.sport, home_team: game.home_team, away_team: game.away_team,
        bet_type: 'total', side: 'over', line: game.line || 0, odds: game.over_odds,
        category: mapTeamBetToCategory('total', 'over'),
        sharp_score: game.sharp_score || 50,
        compositeScore: clampScore(30, 95, overScore + overPlusBonus),
        confidence_score: overScore / 100,
        score_breakdown: overBreakdown,
      });
      const { score: underScore, breakdown: underBreakdown } = calculateTeamCompositeScore(gameForScoring, 'total', 'under', paceMap, defenseMap, envMap, homeCourtMap);
      const underPlusBonus = isPlusMoney(game.under_odds) ? 5 : 0;
      picks.push({
        id: `${game.id}_total_under`,
        type: 'team', sport: game.sport, home_team: game.home_team, away_team: game.away_team,
        bet_type: 'total', side: 'under', line: game.line || 0, odds: game.under_odds,
        category: mapTeamBetToCategory('total', 'under'),
        sharp_score: game.sharp_score || 50,
        compositeScore: clampScore(30, 95, underScore + underPlusBonus),
        confidence_score: underScore / 100,
        score_breakdown: underBreakdown,
      });
    }

    // Moneyline picks
    if (game.bet_type === 'h2h') {
      if (game.home_odds) {
        const plusBonus = isPlusMoney(game.home_odds) ? 5 : 0;
        const { score, breakdown } = calculateTeamCompositeScore(gameForScoring, 'moneyline', 'home', paceMap, defenseMap, envMap, homeCourtMap);
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
        const { score, breakdown } = calculateTeamCompositeScore(gameForScoring, 'moneyline', 'away', paceMap, defenseMap, envMap, homeCourtMap);
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
    const sportFilter = profile.sports || ['all'];
    
    // Filter picks based on profile
    let candidatePicks: (EnrichedPick | EnrichedTeamPick)[] = [];
    
    if (isTeamProfile) {
      candidatePicks = pool.teamPicks.filter(p => 
        profile.betTypes!.includes(p.bet_type)
      );
      
      // team_ml_cross: filter to specific sports and ensure cross-sport mix
      if (profile.strategy === 'team_ml_cross' && profile.sports && !profile.sports.includes('all')) {
        candidatePicks = candidatePicks.filter(p => profile.sports!.includes(p.sport));
        // Sort: favorites first (higher composite), then underdogs for asymmetric mix
        candidatePicks = [...candidatePicks].sort((a, b) => {
          // Prioritize favorites (negative odds = favorite)
          const aIsFav = a.odds < 0;
          const bIsFav = b.odds < 0;
          if (aIsFav !== bIsFav) return aIsFav ? -1 : 1;
          return b.compositeScore - a.compositeScore;
        });
      }
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
    if (legs.length >= profile.legs) {
      // Cross-sport ML gate: require at least one leg from each specified sport
      if (profile.strategy === 'team_ml_cross' && profile.sports && profile.sports.length > 1) {
        const legSports = new Set(legs.map(l => l.sport));
        const missingSports = profile.sports.filter(s => !legSports.has(s));
        if (missingSports.length > 0) {
          console.log(`[Bot] Skipping ${tier}/team_ml_cross: missing sports ${missingSports.join(', ')}`);
          continue;
        }
      }

      // Golden category gate — enabled for execution tier (Feb 11 analysis)
      const ENFORCE_GOLDEN_GATE = true;
      if (ENFORCE_GOLDEN_GATE && tier === 'execution' && goldenCategories.size > 0) {
        const goldenLegCount = legs.filter(l => goldenCategories.has(l.category)).length;
        const minGoldenLegs = Math.floor(profile.legs / 2);
        if (goldenLegCount < minGoldenLegs) {
          console.log(`[Bot] Skipping ${tier}/${profile.strategy}: only ${goldenLegCount}/${profile.legs} golden legs (need ${minGoldenLegs})`);
          continue;
        }
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
      if (combinedProbability < 0.001) continue;
      if (effectiveEdge < config.minEdge) continue;
      if (sharpe < config.minSharpe) continue;

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
    const globalFingerprints = new Set<string>();

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
