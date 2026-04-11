// Category Props Analyzer v5.0 — CLEAN ACCURACY REWRITE
// ─────────────────────────────────────────────────────────────────────────────
//
// BUGS FIXED:
//
// BUG A — MID_SCORER_UNDER has `fadeOnly: true` but CategoryConfig interface
//   does not include this field (lines 101-113). The property is silently
//   ignored at runtime and picks from this category are emitted as UNDER
//   recommendations, which is the WRONG direction (the intent is to fade them
//   = bet OVER). Fixed: added fadeOnly to CategoryConfig interface, and all
//   spots generated from fadeOnly categories are emitted with recommended_side
//   flipped to 'over' with a clear flag.
//
// BUG B — isStarPlayer uses bidirectional substring match (star.includes(normalized))
//   which creates false positives: a player named "Ant" matches "Anthony Edwards"
//   because "anthony edwards".includes("ant") = true. Short names like "Moe",
//   "Tre", "CJ" trigger star blocks incorrectly. Fixed: only check
//   normalized.includes(star) (player name contains the star's name).
//
// BUG C — validate3PTCandidate receives gameLogs already passed in but the
//   L5 cold streak check `l5Avg < l10Avg * 0.85` uses l5Avg which is computed
//   from a slice of the PASSED-IN statValues array. These must already be
//   sorted descending by game_date before the call, but the caller at line 1843
//   uses `l5Avg` computed from logs already ordered correctly. The underlying
//   risk is that allGameLogs for the category is sorted descending at fetch
//   (ascending: false), so slice(0,5) correctly gives the 5 most recent.
//   BUT: the actual code path that calls validate3PTCandidate passes l5Avg
//   computed from l5Logs = l10Logs.slice(0,5) where l10Logs = logs.slice(0,10)
//   and `logs` comes from playerLogs[playerName] which is built by iterating
//   allGameLogs in order. Since allGameLogs is fetched with ascending: false,
//   the first entries are most recent — correct. No code bug here but the
//   fragility is documented.
//
// BUG D — PROJECTION_WEIGHTS constants sum to 1.0 but the actual projection
//   formula at line 780 is a simple additive sum (l10Median + matchupAdj +
//   paceAdj + profileAdj), NOT a weighted blend. The weights are defined
//   but unused in the formula they claim to govern. The code uses a
//   post-hoc shrinkage step to blend with season average, but the weights
//   themselves do nothing. Fixed: removed the misleading PROJECTION_WEIGHTS
//   constant block (the formula stays as-is with its actual behavior documented
//   clearly, no silent no-ops).
//
// BUG E — todayStartUtc used in unified_props sync (line 2301) but is computed
//   using server-local midnight (not ET midnight). If server runs UTC, this
//   includes yesterday's evening games in the sync filter. Fixed: todayStartUtc
//   now computed from the Eastern date string with explicit ET offset.
//
// BUG F — Delete-before-insert for category_sweet_spots is non-atomic:
//   if the insert batch fails mid-way, today's table is left partially empty.
//   Downstream parlay generation reads an incomplete table.
//   Fixed: upsert with unique constraint on (player_name, prop_type, analysis_date)
//   instead of delete+insert. SQL migration required (see bottom of file).
//
// BUG G — unified_props sync normalizes prop type as `player_${spot.prop_type}`
//   unconditionally (line 2286). If spot.prop_type already has a player_ prefix
//   (e.g., "player_points"), the result is "player_player_points" and the
//   unified_props .eq('prop_type', normalizedPropType) match finds nothing.
//   Fixed: strip existing prefix before adding it.
//
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// BUG E FIX: compute ET midnight as UTC timestamp reliably
function getEasternMidnightUtc(): string {
  const etDate = getEasternDate(); // "YYYY-MM-DD" in ET
  // ET is UTC-5 (EST) or UTC-4 (EDT). Use -05:00 as safe floor;
  // Supabase will compare correctly against UTC-stored timestamps.
  return `${etDate}T00:00:00-05:00`;
}

interface GameLog {
  player_name: string;
  game_date: string;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  threes_made: number;
  minutes_played: number;
  opponent?: string;
}

interface MLBGameLog {
  player_name: string;
  game_date: string;
  hits: number;
  walks: number;
  runs: number;
  rbis: number;
  total_bases: number;
  stolen_bases: number;
  home_runs: number;
  strikeouts: number;
  pitcher_strikeouts: number | null;
  innings_pitched: number | null;
  opponent?: string;
}

interface GameEnvironment {
  game_id: string;
  home_team: string;
  away_team: string;
  vegas_total: number;
  vegas_spread: number;
  pace_rating?: string;
  pace_class?: string;
  game_script?: string;
}

const TEAM_ABBREV_TO_NAME: Record<string, string> = {
  'ATL': 'Atlanta Hawks', 'BOS': 'Boston Celtics', 'BKN': 'Brooklyn Nets', 'CHA': 'Charlotte Hornets',
  'CHI': 'Chicago Bulls', 'CLE': 'Cleveland Cavaliers', 'DAL': 'Dallas Mavericks', 'DEN': 'Denver Nuggets',
  'DET': 'Detroit Pistons', 'GSW': 'Golden State Warriors', 'HOU': 'Houston Rockets', 'IND': 'Indiana Pacers',
  'LAC': 'LA Clippers', 'LAL': 'Los Angeles Lakers', 'MEM': 'Memphis Grizzlies', 'MIA': 'Miami Heat',
  'MIL': 'Milwaukee Bucks', 'MIN': 'Minnesota Timberwolves', 'NOP': 'New Orleans Pelicans', 'NYK': 'New York Knicks',
  'OKC': 'Oklahoma City Thunder', 'ORL': 'Orlando Magic', 'PHI': 'Philadelphia 76ers', 'PHX': 'Phoenix Suns',
  'POR': 'Portland Trail Blazers', 'SAC': 'Sacramento Kings', 'SAS': 'San Antonio Spurs', 'TOR': 'Toronto Raptors',
  'UTA': 'Utah Jazz', 'WAS': 'Washington Wizards',
};

function getPaceMultiplier(paceRating: string | undefined): number {
  if (!paceRating) return 0.0;
  switch (paceRating.toUpperCase()) {
    case 'FAST': case 'HIGH': return 0.04;
    case 'MEDIUM': return 0.0;
    case 'LOW': case 'SLOW': return -0.04;
    default: return 0.0;
  }
}

function normalizeOpponentName(opponent: string): string {
  const upper = opponent.toUpperCase().trim();
  if (TEAM_ABBREV_TO_NAME[upper]) return TEAM_ABBREV_TO_NAME[upper];
  const lowerOpp = opponent.toLowerCase().trim();
  for (const [, fullName] of Object.entries(TEAM_ABBREV_TO_NAME)) {
    // BUG B companion: only check fullName.includes(lowerOpp), not bidirectional
    if (fullName.toLowerCase().includes(lowerOpp)) return fullName;
  }
  return opponent;
}

// BUG A FIX: added fadeOnly to CategoryConfig interface
interface CategoryConfig {
  name: string;
  propType: string;
  avgRange: { min: number; max: number };
  lineRange?: { min: number; max: number };
  lines: number[];
  side: 'over' | 'under';
  minHitRate: number;
  supportsBounceBack?: boolean;
  requiredArchetypes?: string[];
  blockedArchetypes?: string[];
  disabled?: boolean;
  fadeOnly?: boolean; // BUG A FIX: picks are meant to be faded (flip recommended_side to 'over')
}

const STAR_PLAYER_NAMES = [
  'luka doncic', 'luka dončić', 'anthony edwards', 'shai gilgeous-alexander',
  'shai gilgeous alexander', 'jayson tatum', 'giannis antetokounmpo',
  'nikola jokic', 'nikola jokić', 'ja morant', 'trae young', 'damian lillard',
  'kyrie irving', 'donovan mitchell', "de'aaron fox", 'deaaron fox',
  'kevin durant', 'lebron james', 'stephen curry', 'joel embiid', 'devin booker',
  'jaylen brown', 'tyrese maxey', 'jimmy butler', 'anthony davis', 'jalen brunson',
  'tyrese haliburton', 'lamelo ball', 'paolo banchero', 'zion williamson',
  'victor wembanyama', 'karl-anthony towns', 'bam adebayo', 'domantas sabonis',
];

// BUG B FIX: only check normalized.includes(star), not bidirectional
function isStarPlayer(playerName: string): boolean {
  const normalized = playerName.toLowerCase().trim();
  return STAR_PLAYER_NAMES.some(star => normalized.includes(star));
}

// BUG D FIX: removed PROJECTION_WEIGHTS constants — they were never used in the
// actual projection formula and created a false impression of a weighted blend.
// The actual formula: rawProjection = l10Median + matchupAdj + paceAdj + profileAdj
// with post-hoc shrinkage blended against season average.
// All logic below reflects what the code actually does.

const MIN_EDGE_THRESHOLDS: Record<string, number> = {
  points: 5.5, rebounds: 3.0, assists: 2.5, threes: 1.2, blocks: 1.0, steals: 0.8,
};

const THREES_FILTER_CONFIG = {
  MIN_EDGE_BY_VARIANCE: { LOW: 0.3, MEDIUM: 0.8, HIGH: 1.2 } as Record<string, number>,
  MAX_VARIANCE_BY_EDGE: { FAVORABLE: 3.0, NEUTRAL: 1.5, TIGHT: 1.0 } as Record<string, number>,
  MIN_FLOOR_FOR_TIGHT_LINES: 2,
  HOT_STREAK_MULTIPLIER: 1.15,
  COLD_STREAK_MULTIPLIER: 0.85,
};

function validate3PTCandidate(
  _playerName: string, actualLine: number, l10Avg: number,
  l10Min: number, stdDev: number, l5Avg: number
): { passes: boolean; reason: string; tier: string } {
  const varianceTier = stdDev <= 1.0 ? 'LOW' : stdDev <= 1.5 ? 'MEDIUM' : 'HIGH';
  const edge = l10Avg - actualLine;
  const edgeQuality = edge >= 1.0 ? 'FAVORABLE' : edge >= 0.5 ? 'NEUTRAL' : 'TIGHT';
  if (varianceTier === 'HIGH' && edgeQuality === 'NEUTRAL')
    return { passes: false, reason: `HIGH variance + NEUTRAL edge = 0% historical`, tier: 'BLOCKED' };
  if (varianceTier === 'MEDIUM' && edgeQuality === 'TIGHT')
    return { passes: false, reason: `MEDIUM variance + TIGHT edge = 0% historical`, tier: 'BLOCKED' };
  if (edgeQuality === 'TIGHT' && l10Min < THREES_FILTER_CONFIG.MIN_FLOOR_FOR_TIGHT_LINES)
    return { passes: false, reason: `TIGHT edge requires L10 Min >= ${THREES_FILTER_CONFIG.MIN_FLOOR_FOR_TIGHT_LINES}`, tier: 'BLOCKED' };
  if (l5Avg < l10Avg * THREES_FILTER_CONFIG.COLD_STREAK_MULTIPLIER)
    return { passes: false, reason: `COLD streak: L5 (${l5Avg.toFixed(1)}) < L10*0.85`, tier: 'COLD' };
  const minEdge = THREES_FILTER_CONFIG.MIN_EDGE_BY_VARIANCE[varianceTier];
  if (edge < minEdge)
    return { passes: false, reason: `Edge ${edge.toFixed(1)} below minimum ${minEdge}`, tier: 'LOW_EDGE' };
  const maxVariance = THREES_FILTER_CONFIG.MAX_VARIANCE_BY_EDGE[edgeQuality];
  if (stdDev > maxVariance)
    return { passes: false, reason: `Variance ${stdDev.toFixed(2)} exceeds max ${maxVariance}`, tier: 'HIGH_VARIANCE' };
  if (l5Avg > l10Avg * THREES_FILTER_CONFIG.HOT_STREAK_MULTIPLIER)
    return { passes: true, reason: `HOT streak: L5 (${l5Avg.toFixed(1)}) > L10*1.15`, tier: 'HOT' };
  if (varianceTier === 'LOW') return { passes: true, reason: `LOW variance (100% historical)`, tier: 'ELITE' };
  if (edgeQuality === 'FAVORABLE' && l10Min >= 2) return { passes: true, reason: `Strong floor + favorable edge`, tier: 'PREMIUM' };
  return { passes: true, reason: `Standard pick`, tier: 'STANDARD' };
}

const ARCHETYPE_GROUPS = {
  BIGS: ['ELITE_REBOUNDER', 'GLASS_CLEANER', 'STRETCH_BIG', 'RIM_PROTECTOR'],
  GUARDS: ['PLAYMAKER', 'COMBO_GUARD', 'SCORING_GUARD', 'PURE_SHOOTER'],
  WINGS: ['TWO_WAY_WING', 'SCORING_WING'],
};

const ARCHETYPE_PROP_ALIGNMENT: Record<string, { primary: string[], blocked: string[] }> = {
  'ELITE_REBOUNDER': { primary: ['rebounds', 'blocks'], blocked: ['threes'] },
  'GLASS_CLEANER': { primary: ['rebounds'], blocked: ['points', 'threes', 'assists'] },
  'PURE_SHOOTER': { primary: ['points', 'threes'], blocked: ['rebounds', 'blocks'] },
  'PLAYMAKER': { primary: ['assists'], blocked: ['rebounds', 'blocks'] },
  'COMBO_GUARD': { primary: ['points', 'assists'], blocked: ['rebounds', 'blocks'] },
  'TWO_WAY_WING': { primary: ['points', 'rebounds'], blocked: ['blocks'] },
  'STRETCH_BIG': { primary: ['points', 'rebounds', 'threes'], blocked: [] },
  'RIM_PROTECTOR': { primary: ['blocks', 'rebounds'], blocked: ['points', 'threes'] },
  'SCORING_WING': { primary: ['points'], blocked: ['assists', 'blocks'] },
  'SCORING_GUARD': { primary: ['points', 'assists'], blocked: ['rebounds', 'blocks'] },
  'ROLE_PLAYER': { primary: [], blocked: ['points'] },
  'UNKNOWN': { primary: [], blocked: [] },
};

const BOUNCE_BACK_CONFIG = {
  minSeasonVsL10Gap: 1.5, minStdDevGap: 0.5, maxLineVsSeasonGap: 2.0,
  minL10HitRateForOVER: 0.20, maxL10HitRateForOVER: 0.50,
};

let matchupHistoryCache: Map<string, any> = new Map();
let gameEnvironmentCache: Map<string, GameEnvironment> = new Map();

interface PlayerBehaviorProfile {
  player_name: string;
  three_pt_peak_quarters: { q1: number; q2: number; q3: number; q4: number } | null;
  best_matchups: { opponent: string; stat: string; avg_vs: number; games: number }[] | null;
  worst_matchups: { opponent: string; stat: string; avg_vs: number; games: number }[] | null;
  fatigue_tendency: string | null;
  blowout_minutes_reduction: number | null;
  film_sample_count: number | null;
  profile_confidence: number | null;
}
let playerProfileCache: Map<string, PlayerBehaviorProfile> = new Map();

// BUG A FIX: MID_SCORER_UNDER now has fadeOnly: true declared in the interface
const CATEGORIES: Record<string, CategoryConfig> = {
  ASSIST_ANCHOR: {
    name: 'Assist Anchor', propType: 'assists', avgRange: { min: 3, max: 5.5 },
    lines: [3.5, 4.5, 5.5], side: 'under', minHitRate: 0.60,
  },
  HIGH_REB_UNDER: {
    name: 'High Reb Under', propType: 'rebounds', avgRange: { min: 8, max: 14 },
    lines: [9.5, 10.5, 11.5, 12.5], side: 'under', minHitRate: 0.55,
  },
  MID_SCORER_UNDER: {
    name: 'Mid Scorer Under', propType: 'points', avgRange: { min: 12, max: 22 },
    lines: [14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5], side: 'under', minHitRate: 0.55,
    fadeOnly: true, // BUG A FIX: picks are faded — emit as OVER recommendation
  },
  ELITE_REB_OVER: {
    name: 'Elite Rebounder OVER', propType: 'rebounds', avgRange: { min: 9, max: 20 },
    lines: [9.5, 10.5, 11.5, 12.5], side: 'over', minHitRate: 0.55,
    supportsBounceBack: true,
    requiredArchetypes: ['ELITE_REBOUNDER', 'GLASS_CLEANER', 'RIM_PROTECTOR'],
    blockedArchetypes: ['PLAYMAKER', 'COMBO_GUARD', 'PURE_SHOOTER', 'SCORING_GUARD'],
  },
  ROLE_PLAYER_REB: {
    name: 'Role Player Reb OVER', propType: 'rebounds', avgRange: { min: 3, max: 6 },
    lines: [2.5, 3.5, 4.5], side: 'over', minHitRate: 0.60,
    requiredArchetypes: ['TWO_WAY_WING', 'STRETCH_BIG', 'SCORING_WING', 'ROLE_PLAYER', 'UNKNOWN'],
    blockedArchetypes: ['ELITE_REBOUNDER', 'PLAYMAKER', 'COMBO_GUARD', 'PURE_SHOOTER', 'SCORING_GUARD'],
  },
  BIG_ASSIST_OVER: {
    name: 'Big Man Assists OVER', propType: 'assists', avgRange: { min: 2, max: 6 },
    lines: [2.5, 3.5, 4.5], side: 'over', minHitRate: 0.60,
    requiredArchetypes: ['ELITE_REBOUNDER', 'GLASS_CLEANER', 'STRETCH_BIG', 'RIM_PROTECTOR'],
    blockedArchetypes: ['PLAYMAKER', 'COMBO_GUARD', 'PURE_SHOOTER', 'SCORING_GUARD', 'SCORING_WING'],
  },
  LOW_SCORER_UNDER: {
    name: 'Low Scorer UNDER', propType: 'points', avgRange: { min: 5, max: 12 },
    lines: [7.5, 8.5, 9.5, 10.5, 11.5, 12.5], side: 'under', minHitRate: 0.55,
  },
  THREE_POINT_SHOOTER: {
    name: '3PT Shooter', propType: 'threes', avgRange: { min: 1.5, max: 4 },
    lines: [1.5, 2.5, 3.5], side: 'over', minHitRate: 0.55,
    requiredArchetypes: ['PURE_SHOOTER', 'COMBO_GUARD', 'SCORING_GUARD', 'STRETCH_BIG'],
    blockedArchetypes: ['ELITE_REBOUNDER', 'GLASS_CLEANER', 'RIM_PROTECTOR', 'ROLE_PLAYER'],
  },
  BIG_REBOUNDER: {
    name: 'Big Man Rebounder', propType: 'rebounds', avgRange: { min: 7, max: 18 },
    lines: [7.5, 8.5, 9.5, 10.5, 11.5, 12.5], side: 'over', minHitRate: 0.55,
    supportsBounceBack: true,
    requiredArchetypes: ['ELITE_REBOUNDER', 'GLASS_CLEANER', 'STRETCH_BIG', 'RIM_PROTECTOR'],
    blockedArchetypes: ['PLAYMAKER', 'PURE_SHOOTER', 'SCORING_GUARD'],
  },
  HIGH_ASSIST: {
    name: 'High Assist', propType: 'assists', avgRange: { min: 5, max: 12 },
    lines: [4.5, 5.5, 6.5, 7.5, 8.5], side: 'over', minHitRate: 0.55,
    requiredArchetypes: ['PLAYMAKER', 'COMBO_GUARD', 'SCORING_GUARD'],
    blockedArchetypes: ['ELITE_REBOUNDER', 'GLASS_CLEANER', 'RIM_PROTECTOR'],
  },
  HIGH_SCORER: {
    name: 'High Scorer', propType: 'points', avgRange: { min: 20, max: 45 },
    lines: [19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5],
    side: 'over', minHitRate: 0.55, supportsBounceBack: true,
    requiredArchetypes: ['PLAYMAKER', 'COMBO_GUARD', 'SCORING_GUARD', 'SCORING_WING', 'STRETCH_BIG'],
    blockedArchetypes: ['GLASS_CLEANER', 'RIM_PROTECTOR'],
  },
};

const MLB_CATEGORIES = new Set(['PITCHER_K', 'BATTER_HITS', 'BATTER_RBI', 'BATTER_TB']);

// Helper functions
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function calculateStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function calculateHitRate(values: number[], line: number, side: string): number {
  if (values.length === 0) return 0;
  const hits = values.filter(v => side === 'over' ? v > line : v < line).length;
  return hits / values.length;
}

function getStatValue(log: GameLog, propType: string): number {
  switch (propType) {
    case 'points': return log.points || 0;
    case 'rebounds': return log.rebounds || 0;
    case 'assists': return log.assists || 0;
    case 'threes': return log.threes_made || 0;
    case 'steals': return log.steals || 0;
    case 'blocks': return log.blocks || 0;
    default: return 0;
  }
}

function getMLBStatValue(log: MLBGameLog, propType: string): number {
  switch (propType) {
    case 'pitcher_strikeouts': return log.pitcher_strikeouts ?? 0;
    case 'hits': return log.hits || 0;
    case 'rbis': return log.rbis || 0;
    case 'total_bases': return log.total_bases || 0;
    default: return 0;
  }
}

let archetypeCache: Map<string, string> = new Map();

async function loadArchetypes(supabase: any): Promise<void> {
  archetypeCache.clear();
  const { data, error } = await supabase
    .from('player_archetypes').select('player_name, primary_archetype').limit(5000);
  if (error) { console.warn('[Category Analyzer] Archetype load error:', error.message); return; }
  for (const row of (data || [])) {
    archetypeCache.set(row.player_name?.toLowerCase().trim(), row.primary_archetype || 'UNKNOWN');
  }
  console.log(`[Category Analyzer] Loaded ${archetypeCache.size} archetypes`);
}

function getPlayerArchetype(playerName: string): string {
  return archetypeCache.get(playerName.toLowerCase().trim()) || 'UNKNOWN';
}

function passesArchetypeValidation(playerName: string, config: CategoryConfig): { passes: boolean; reason: string } {
  if (!config.requiredArchetypes && !config.blockedArchetypes) return { passes: true, reason: 'no_archetype_config' };
  const archetype = getPlayerArchetype(playerName);
  if (config.blockedArchetypes?.includes(archetype)) return { passes: false, reason: `${archetype} blocked for ${config.name}` };
  if (config.requiredArchetypes && !config.requiredArchetypes.includes(archetype)) return { passes: false, reason: `${archetype} not in required list for ${config.name}` };
  return { passes: true, reason: 'archetype_ok' };
}

async function loadMatchupHistory(supabase: any): Promise<void> {
  matchupHistoryCache.clear();
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('matchup_history')
      .select('player_name, opponent, prop_type, games_played, avg_stat, max_stat, min_stat')
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) { console.warn('[Category Analyzer] Matchup history load error:', error.message); break; }
    if (!data?.length) break;
    for (const m of data) {
      const key = `${m.player_name?.toLowerCase().trim()}_${m.prop_type || ''}_${m.opponent?.toLowerCase().trim()}`;
      matchupHistoryCache.set(key, m);
    }
    if (data.length < pageSize) break;
    page++;
  }
  console.log(`[Category Analyzer] Loaded ${matchupHistoryCache.size} matchup records`);
}

async function loadGameEnvironment(supabase: any): Promise<void> {
  const today = getEasternDate();
  const { data, error } = await supabase
    .from('game_environment')
    .select('game_id, home_team, away_team, vegas_total, vegas_spread, pace_rating, game_script')
    .gte('game_date', today);
  if (error) { console.warn('[Category Analyzer] Game environment load error:', error.message); return; }
  gameEnvironmentCache.clear();
  for (const g of (data || [])) gameEnvironmentCache.set(g.game_id, g);
  console.log(`[Category Analyzer] Loaded ${gameEnvironmentCache.size} game environments`);
}

async function loadPlayerProfiles(supabase: any): Promise<void> {
  const { data, error } = await supabase
    .from('player_behavior_profiles')
    .select('player_name, three_pt_peak_quarters, best_matchups, worst_matchups, fatigue_tendency, blowout_minutes_reduction, film_sample_count, profile_confidence')
    .gte('games_analyzed', 5);
  if (error) { console.warn('[Category Analyzer] Player profiles load error:', error.message); return; }
  playerProfileCache.clear();
  for (const p of (data || [])) playerProfileCache.set(p.player_name?.toLowerCase().trim(), p);
  console.log(`[Category Analyzer] Loaded ${playerProfileCache.size} player profiles`);
}

let sideOverrideMap: Map<string, 'over' | 'under'> = new Map();

async function loadSideOverrides(supabase: any): Promise<Map<string, 'over' | 'under'>> {
  sideOverrideMap.clear();
  const { data, error } = await supabase
    .from('bot_category_weights').select('category, side, weight, is_blocked').order('weight', { ascending: false });
  if (error || !data) return sideOverrideMap;
  const categoryBestSide = new Map<string, { side: string; weight: number }>();
  for (const w of data) {
    if (w.is_blocked || (w.weight || 0) <= 0) continue;
    const existing = categoryBestSide.get(w.category);
    if (!existing || (w.weight || 0) > existing.weight) categoryBestSide.set(w.category, { side: w.side, weight: w.weight || 0 });
  }
  for (const [cat, best] of categoryBestSide) sideOverrideMap.set(cat, best.side as 'over' | 'under');
  console.log(`[Category Analyzer] Loaded ${sideOverrideMap.size} side overrides`);
  return sideOverrideMap;
}

async function autoFlipUnderperformingCategories(supabase: any): Promise<string[]> {
  const flipped: string[] = [];
  const { data: outcomes, error } = await supabase
    .from('category_sweet_spots').select('category, recommended_side, outcome')
    .not('outcome', 'is', null).not('settled_at', 'is', null);
  if (error || !outcomes) return flipped;

  const stats = new Map<string, { hits: number; graded: number }>();
  for (const row of outcomes) {
    if (row.outcome !== 'hit' && row.outcome !== 'miss') continue;
    const key = `${row.category}__${row.recommended_side || 'over'}`;
    let s = stats.get(key);
    if (!s) { s = { hits: 0, graded: 0 }; stats.set(key, s); }
    s.graded++;
    if (row.outcome === 'hit') s.hits++;
  }

  for (const [key, s] of stats) {
    const [category, side] = key.split('__');
    if (side !== 'over' || s.graded < 30) continue;
    const hitRate = s.hits / s.graded;
    if (hitRate >= 0.50) continue;

    const { data: sportSpecific } = await supabase.from('bot_category_weights')
      .select('id, sport').eq('category', category).eq('side', 'over')
      .not('sport', 'is', null).not('sport', 'eq', 'team_all');
    if (sportSpecific?.length > 0) {
      flipped.push(`${category}: over ${(hitRate * 100).toFixed(1)}% — SKIPPED (sport-specific overrides)`);
      continue;
    }

    await supabase.from('bot_category_weights')
      .update({ weight: 0.50, updated_at: new Date().toISOString() })
      .eq('category', category).eq('side', 'over').or('sport.is.null,sport.eq.team_all');

    const underWeight = hitRate < 0.40 ? 1.00 : 1.10;
    const { data: existing } = await supabase.from('bot_category_weights')
      .select('id').eq('category', category).eq('side', 'under').or('sport.is.null,sport.eq.team_all').limit(1);

    if (existing?.length > 0) {
      await supabase.from('bot_category_weights')
        .update({ weight: underWeight, is_blocked: false, updated_at: new Date().toISOString() }).eq('id', existing[0].id);
    } else {
      await supabase.from('bot_category_weights').insert({
        category, side: 'under', sport: 'basketball_nba', weight: underWeight,
        current_hit_rate: 55, total_picks: 0, total_hits: 0, is_blocked: false,
        current_streak: 0, best_streak: 0, worst_streak: 0,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
    }
    sideOverrideMap.set(category, 'under');
    flipped.push(`${category}: over ${(hitRate * 100).toFixed(1)}% → flipped to under`);
  }

  if (flipped.length > 0) console.log(`[Category Analyzer] Auto-flipped: ${flipped.join('; ')}`);
  return flipped;
}

// Projection calculation (documented to reflect what it actually does)
function calculateTrueProjection(
  playerName: string, propType: string, statValues: number[],
  opponent: string | null, seasonAvg?: number, stdDev?: number
): {
  projectedValue: number; matchupAdj: number; paceAdj: number; profileAdj: number;
  projectionSource: string; varianceRatio: number; shrinkageFactor: number; profileFlags: string[];
} {
  const l10Median = calculateMedian(statValues);
  const l10Avg = statValues.length > 0 ? statValues.reduce((a, b) => a + b, 0) / statValues.length : 0;
  const varianceRatio = l10Avg > 0 && stdDev ? stdDev / l10Avg : 0;
  let projectionSource = 'L10_MEDIAN';
  const profileFlags: string[] = [];

  // Matchup adjustment
  let matchupAdj = 0;
  if (opponent) {
    const normalizedOpp = normalizeOpponentName(opponent).toLowerCase().trim();
    const matchupKey = `${playerName.toLowerCase().trim()}_${propType}_${normalizedOpp}`;
    const matchup = matchupHistoryCache.get(matchupKey);
    if (matchup && matchup.games_played >= 2) {
      const matchupDiff = matchup.avg_stat - l10Median;
      matchupAdj = Math.max(-2, Math.min(2, matchupDiff * 0.5));
      projectionSource += '+MATCHUP';
    }
  }

  // Pace adjustment
  let paceAdj = 0;
  for (const [, env] of gameEnvironmentCache) {
    const isPlayerGame = env.home_team?.toLowerCase().includes(playerName.toLowerCase().slice(0, 5)) ||
      env.away_team?.toLowerCase().includes(playerName.toLowerCase().slice(0, 5));
    if (isPlayerGame && env.pace_rating) {
      paceAdj = getPaceMultiplier(env.pace_rating) * l10Avg;
      projectionSource += '+PACE';
      break;
    }
  }

  // Profile adjustment
  let profileAdj = 0;
  const profile = playerProfileCache.get(playerName.toLowerCase().trim());
  if (profile) {
    if (propType === 'threes' && profile.three_pt_peak_quarters) {
      const peakQ = Object.entries(profile.three_pt_peak_quarters)
        .reduce((max, [q, pct]) => (pct as number) > max.pct ? { q, pct: pct as number } : max, { q: 'q1', pct: 0 });
      if (peakQ.pct > 30) { profileAdj += 0.4; profileFlags.push(`PEAK_Q${peakQ.q.replace('q', '')}`); }
    }
    if (opponent && profile.best_matchups) {
      const normalizedOpp = normalizeOpponentName(opponent).toLowerCase();
      if (profile.best_matchups.some(m => m.opponent?.toLowerCase().includes(normalizedOpp))) {
        profileAdj += 0.5; profileFlags.push('BEST_MATCHUP');
      }
    }
    if (opponent && profile.worst_matchups) {
      const normalizedOpp = normalizeOpponentName(opponent).toLowerCase();
      if (profile.worst_matchups.some(m => m.opponent?.toLowerCase().includes(normalizedOpp))) {
        profileAdj -= 0.5; profileFlags.push('WORST_MATCHUP');
      }
    }
    if (profile.fatigue_tendency?.toLowerCase().includes('fatigue')) { profileAdj -= 0.3; profileFlags.push('FATIGUE_RISK'); }
    if ((profile.blowout_minutes_reduction || 0) > 5) profileFlags.push('BLOWOUT_RISK');
    if ((profile.film_sample_count || 0) >= 3) profileFlags.push('FILM_VERIFIED');
    if (profileAdj !== 0) projectionSource += '+PROFILE';
  }

  // Variance shrinkage: high variance = regress more toward season mean
  const shrinkageFactor = Math.max(0.70, Math.min(0.95, 1 - varianceRatio * 0.4));

  // Additive projection then blend with season average
  let rawProjection = l10Median + matchupAdj + paceAdj + profileAdj;
  if (seasonAvg && seasonAvg > 0) {
    rawProjection = (rawProjection * shrinkageFactor) + (seasonAvg * (1 - shrinkageFactor));
    projectionSource += '+REGRESSED';
  }

  // FG efficiency gate for scoring/threes
  if ((propType === 'points' || propType === 'threes') && seasonAvg && seasonAvg > 0) {
    const l10VsSeasonRatio = l10Avg / seasonAvg;
    if (l10VsSeasonRatio > 1.15) {
      rawProjection -= (l10VsSeasonRatio - 1.15) * rawProjection * 0.3;
      projectionSource += '+FG_REGRESS_DOWN';
    } else if (l10VsSeasonRatio < 0.85) {
      rawProjection += (0.85 - l10VsSeasonRatio) * rawProjection * 0.2;
      projectionSource += '+FG_REGRESS_UP';
    }
  }

  return {
    projectedValue: Math.round(rawProjection * 2) / 2,
    matchupAdj: Math.round(matchupAdj * 10) / 10,
    paceAdj: Math.round(paceAdj * 10) / 10,
    profileAdj: Math.round(profileAdj * 10) / 10,
    projectionSource, varianceRatio: Math.round(varianceRatio * 100) / 100,
    shrinkageFactor: Math.round(shrinkageFactor * 100) / 100, profileFlags,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { category, minHitRate = 0.7, forceRefresh = false } = await req.json().catch(() => ({}));
    console.log(`[Category Analyzer v5.0] Starting for category: ${category || 'ALL'}`);

    const [, , , , sideOverrides] = await Promise.all([
      loadArchetypes(supabase),
      loadMatchupHistory(supabase),
      loadGameEnvironment(supabase),
      loadPlayerProfiles(supabase),
      loadSideOverrides(supabase),
    ]);

    await autoFlipUnderperformingCategories(supabase);

    const today = getEasternDate();
    // BUG E FIX: use ET midnight for timestamp comparisons
    const todayStartUtc = getEasternMidnightUtc();

    // Return cached data if available
    if (!forceRefresh) {
      const { data: existingData } = await supabase
        .from('category_sweet_spots').select('*').eq('analysis_date', today).eq('is_active', true);
      if (existingData?.length > 0) {
        const filtered = category ? existingData.filter((d: any) => d.category === category) : existingData;
        return new Response(JSON.stringify({ success: true, data: filtered, cached: true, count: filtered.length }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Fetch game logs
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
    const pageSize = 1000;

    let allGameLogs: GameLog[] = [];
    for (let page = 0; ; page++) {
      const { data, error } = await supabase.from('nba_player_game_logs')
        .select('player_name, game_date, points, rebounds, assists, steals, blocks, threes_made, minutes_played')
        .gte('game_date', thirtyDaysAgoStr).order('game_date', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);
      if (error) throw new Error(`NBA logs: ${error.message}`);
      if (!data?.length) break;
      allGameLogs = allGameLogs.concat(data as GameLog[]);
      if (data.length < pageSize) break;
    }

    for (let page = 0; ; page++) {
      const { data, error } = await supabase.from('ncaab_player_game_logs')
        .select('player_name, game_date, points, rebounds, assists, steals, blocks, threes_made, minutes_played')
        .gte('game_date', thirtyDaysAgoStr).order('game_date', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);
      if (error) { console.warn('[Category Analyzer] NCAAB logs warning:', error.message); break; }
      if (!data?.length) break;
      allGameLogs = allGameLogs.concat(data as GameLog[]);
      if (data.length < pageSize) break;
    }
    console.log(`[Category Analyzer] Total game logs: ${allGameLogs.length}`);

    let allMLBLogs: MLBGameLog[] = [];
    for (let page = 0; ; page++) {
      const { data, error } = await supabase.from('mlb_player_game_logs')
        .select('player_name, game_date, hits, walks, runs, rbis, total_bases, stolen_bases, home_runs, strikeouts, pitcher_strikeouts, innings_pitched, opponent')
        .order('game_date', { ascending: false }).range(page * pageSize, (page + 1) * pageSize - 1);
      if (error) { console.warn('[Category Analyzer] MLB logs warning:', error.message); break; }
      if (!data?.length) break;
      allMLBLogs = allMLBLogs.concat(data as MLBGameLog[]);
      if (data.length < pageSize) break;
    }

    if (!allGameLogs.length) {
      return new Response(JSON.stringify({ success: false, error: 'No game logs found', data: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Group logs by player
    const playerLogs: Record<string, GameLog[]> = {};
    for (const log of allGameLogs) {
      if (!playerLogs[log.player_name]) playerLogs[log.player_name] = [];
      playerLogs[log.player_name].push(log);
    }

    const mlbPlayerLogs: Record<string, MLBGameLog[]> = {};
    for (const log of allMLBLogs) {
      if (!mlbPlayerLogs[log.player_name]) mlbPlayerLogs[log.player_name] = [];
      mlbPlayerLogs[log.player_name].push(log);
    }

    // Load historical outcomes for deterministic side selection
    let historicalOutcomes: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: hPage } = await supabase.from('category_sweet_spots')
        .select('player_name, prop_type, recommended_side, outcome')
        .not('outcome', 'is', null).not('settled_at', 'is', null)
        .in('outcome', ['hit', 'miss']).range(offset, offset + 999);
      if (!hPage?.length) break;
      historicalOutcomes = historicalOutcomes.concat(hPage);
      if (hPage.length < 1000) break;
    }

    const playerSideHistory = new Map<string, { overHits: number; overTotal: number; underHits: number; underTotal: number }>();
    for (const row of historicalOutcomes) {
      const key = `${(row.player_name || '').toLowerCase().trim()}|${(row.prop_type || '').toLowerCase().trim()}`;
      let entry = playerSideHistory.get(key);
      if (!entry) { entry = { overHits: 0, overTotal: 0, underHits: 0, underTotal: 0 }; playerSideHistory.set(key, entry); }
      const side = (row.recommended_side || 'over').toLowerCase();
      if (side === 'over') { entry.overTotal++; if (row.outcome === 'hit') entry.overHits++; }
      else { entry.underTotal++; if (row.outcome === 'hit') entry.underHits++; }
    }

    const sweetSpots: any[] = [];
    const deterministicFlips: string[] = [];
    const categoriesToAnalyze = category
      ? (MLB_CATEGORIES.has(category) ? [] : [category])
      : Object.keys(CATEGORIES).filter(k => !MLB_CATEGORIES.has(k));

    for (const catKey of categoriesToAnalyze) {
      const config = CATEGORIES[catKey];
      if (!config || config.disabled) continue;

      let effectiveSide = sideOverrides.get(catKey) || config.side;

      // BUG A FIX: if fadeOnly, the category analyzes from its default side
      // but emits the OPPOSITE side as the recommendation
      const isFadeOnly = config.fadeOnly === true;

      console.log(`[Category Analyzer] Analyzing: ${catKey} (side: ${effectiveSide}${isFadeOnly ? ', FADE_ONLY' : ''})`);
      let playersInRange = 0, qualifiedPlayers = 0, blockedByArchetype = 0, blockedByMinutes = 0;

      for (const [playerName, logs] of Object.entries(playerLogs)) {
        const l10Logs = logs.slice(0, 10);
        if (l10Logs.length < 5) continue;

        const statValues = l10Logs.map(log => getStatValue(log, config.propType));
        const l10Avg = statValues.reduce((a, b) => a + b, 0) / statValues.length;
        const l10StdDev = calculateStdDev(statValues);

        const avgEligible = l10Avg >= config.avgRange.min && l10Avg <= config.avgRange.max;
        const potentialLineEligible = config.lineRange !== undefined;

        if (!avgEligible && !potentialLineEligible) continue;

        const archetypeCheck = passesArchetypeValidation(playerName, config);
        if (!archetypeCheck.passes) { blockedByArchetype++; continue; }

        // Deterministic side selection
        const histKey = `${playerName.toLowerCase().trim()}|${config.propType.toLowerCase().trim()}`;
        const hist = playerSideHistory.get(histKey);
        let playerEffectiveSide = effectiveSide;

        if (hist) {
          const historicalSamples = hist.overTotal + hist.underTotal;
          if (historicalSamples >= 7) {
            const overRate = hist.overTotal > 0 ? hist.overHits / hist.overTotal : null;
            const underRate = hist.underTotal > 0 ? hist.underHits / hist.underTotal : null;

            if (overRate !== null && overRate >= 0.60 && hist.overTotal >= 7 && playerEffectiveSide !== 'over') {
              const msg = `🔄 FORCE FLIP: ${playerName} ${config.propType} → OVER (${(overRate*100).toFixed(0)}%, n=${hist.overTotal})`;
              deterministicFlips.push(msg); playerEffectiveSide = 'over';
            } else if (underRate !== null && underRate >= 0.60 && hist.underTotal >= 7 && playerEffectiveSide !== 'under') {
              const msg = `🔄 FORCE FLIP: ${playerName} ${config.propType} → UNDER (${(underRate*100).toFixed(0)}%, n=${hist.underTotal})`;
              deterministicFlips.push(msg); playerEffectiveSide = 'under';
            } else if (overRate !== null && overRate < 0.48 && underRate !== null && underRate > 0.52 && playerEffectiveSide !== 'under') {
              const msg = `🔄 DETERMINISTIC: ${playerName} ${config.propType} → UNDER (${(underRate*100).toFixed(0)}% under)`;
              deterministicFlips.push(msg); playerEffectiveSide = 'under';
            } else if (underRate !== null && underRate < 0.48 && overRate !== null && overRate > 0.52 && playerEffectiveSide !== 'over') {
              const msg = `🔄 DETERMINISTIC: ${playerName} ${config.propType} → OVER (${(overRate*100).toFixed(0)}% over)`;
              deterministicFlips.push(msg); playerEffectiveSide = 'over';
            }
          }
        }

        // Star player block for under recommendations
        if (playerEffectiveSide === 'under' && isStarPlayer(playerName)) {
          console.log(`[Category Analyzer] ⭐ STAR BLOCKED: ${playerName} from ${catKey}`);
          continue;
        }

        // Starter protection: block starters from points UNDER
        if (config.propType === 'points' && playerEffectiveSide === 'under') {
          const avgMin = l10Logs.reduce((s, g) => s + (g.minutes_played || 0), 0) / l10Logs.length;
          if (avgMin >= 28) { blockedByMinutes++; continue; }
        }

        // Breakout detection for UNDER categories
        if (playerEffectiveSide === 'under') {
          const l5Values = statValues.slice(0, 5);
          const l5Avg = l5Values.reduce((a, b) => a + b, 0) / l5Values.length;
          if (config.propType === 'points' && l5Values.some(v => v >= 25)) { continue; } // recent explosion
          const l5Min = l10Logs.slice(0, 5).reduce((s, g) => s + (g.minutes_played || 0), 0) / l10Logs.slice(0, 5).length;
          const l10Min2 = l10Logs.reduce((s, g) => s + (g.minutes_played || 0), 0) / l10Logs.length;
          const trendingCount = [
            l10Logs.length >= 10 && l5Avg > l10Avg * 1.15,
            l10Logs.length >= 10 && l5Min > l10Min2 * 1.10,
            config.propType === 'points' && l5Values.every(v => v >= l10Avg * 1.1),
          ].filter(Boolean).length;
          if (trendingCount >= 2) continue;
        }

        if (!avgEligible && potentialLineEligible) {
          sweetSpots.push({
            category: catKey, player_name: playerName, prop_type: config.propType,
            recommended_line: null, recommended_side: playerEffectiveSide,
            l10_hit_rate: null, l10_avg: Math.round(l10Avg * 10) / 10,
            l10_min: Math.min(...statValues), l10_max: Math.max(...statValues),
            l10_median: Math.round(calculateMedian(statValues) * 10) / 10,
            l10_std_dev: Math.round(l10StdDev * 10) / 10,
            games_played: l10Logs.length, archetype: getPlayerArchetype(playerName),
            confidence_score: 0, analysis_date: today, is_active: false,
            eligibility_type: 'LINE_RANGE_PENDING',
            requires_bounce_back_check: config.supportsBounceBack || false,
            fade_only: isFadeOnly,
          });
          continue;
        }

        playersInRange++;
        const l10Min = Math.min(...statValues);
        const l10Max = Math.max(...statValues);
        const l10Median = calculateMedian(statValues);

        let bestLine: number | null = null;
        let bestHitRate = 0;
        for (const line of config.lines) {
          const hitRate = calculateHitRate(statValues, line, playerEffectiveSide);
          if (hitRate >= (minHitRate || config.minHitRate) && hitRate > bestHitRate) {
            bestHitRate = hitRate; bestLine = line;
          }
        }

        // UNDER criteria check
        if (playerEffectiveSide === 'under') {
          const varianceRatio = l10Avg > 0 ? l10StdDev / l10Avg : 1;
          if (varianceRatio > 0.30) continue;
          const l5Avg2 = statValues.slice(0, 5).reduce((a, b) => a + b, 0) / Math.max(statValues.slice(0, 5).length, 1);
          if (l5Avg2 > l10Avg * 1.08) continue;
          if (bestHitRate < 0.65) continue;
        }

        if (bestLine === null || bestHitRate < (minHitRate || config.minHitRate)) continue;
        qualifiedPlayers++;

        const l3Values = statValues.slice(0, 3);
        const l3Avg = l3Values.length >= 3 ? Math.round((l3Values.reduce((a, b) => a + b, 0) / l3Values.length) * 10) / 10 : null;
        const l5Vals = statValues.slice(0, 5);
        const l5Avg = l5Vals.length >= 5 ? Math.round((l5Vals.reduce((a, b) => a + b, 0) / l5Vals.length) * 10) / 10 : null;

        // Recency decline block
        if (l3Avg !== null && l10Avg > 0) {
          const declineRatio = l3Avg / l10Avg;
          if (playerEffectiveSide === 'over' && declineRatio < 0.75) continue;
          if (playerEffectiveSide === 'under' && declineRatio > 1.25) continue;
        }

        const consistency = l10Avg > 0 ? 1 - (l10StdDev / l10Avg) : 0;
        const baseConfidence = (bestHitRate * 0.50) + (Math.max(0, consistency) * 0.30);
        const variancePenalty = l10Avg > 0 ? (l10StdDev / l10Avg) * 0.12 : 0;
        const sideBonus = playerEffectiveSide === 'over' ? 0.06 : 0;
        const sampleBonus = l10Logs.length >= 10 ? 0.04 : 0;
        const confidenceScore = Math.min(0.92, Math.max(0.35, baseConfidence - variancePenalty + sideBonus + sampleBonus));

        // BUG A FIX: if fadeOnly, flip the recommended_side for the output
        // The analysis runs on config.side to find the correct line,
        // but the recommendation emits the OPPOSITE side
        const outputSide = isFadeOnly ? (playerEffectiveSide === 'under' ? 'over' : 'under') : playerEffectiveSide;

        sweetSpots.push({
          category: catKey, player_name: playerName, prop_type: config.propType,
          recommended_line: bestLine, recommended_side: outputSide,
          l10_hit_rate: Math.round(bestHitRate * 100) / 100,
          l10_avg: Math.round(l10Avg * 10) / 10, l10_min: l10Min, l10_max: l10Max,
          l10_median: Math.round(l10Median * 10) / 10, l3_avg: l3Avg, l5_avg: l5Avg,
          games_played: l10Logs.length, archetype: getPlayerArchetype(playerName),
          confidence_score: Math.round(confidenceScore * 100) / 100,
          analysis_date: today, is_active: true, eligibility_type: 'AVG_RANGE',
          fade_only: isFadeOnly,
        });
      }
      console.log(`[Category Analyzer] ${catKey}: ${playersInRange} in range, ${qualifiedPlayers} qualified, ${blockedByArchetype} archetype blocked`);
    }

    // MLB analysis
    for (const catKey of (category ? (MLB_CATEGORIES.has(category) ? [category] : []) : Array.from(MLB_CATEGORIES))) {
      const config = CATEGORIES[catKey];
      if (!config) continue;
      const effectiveSide = sideOverrides.get(catKey) || config.side;
      const isPitcherCategory = config.propType === 'pitcher_strikeouts';

      for (const [playerName, logs] of Object.entries(mlbPlayerLogs)) {
        const relevantLogs = isPitcherCategory
          ? logs.filter(l => l.pitcher_strikeouts != null && l.pitcher_strikeouts !== undefined)
          : logs;
        const l10Logs = relevantLogs.slice(0, 10);
        if (l10Logs.length < 5) continue;

        const statValues = l10Logs.map(log => getMLBStatValue(log, config.propType));
        const l10Avg = statValues.reduce((a, b) => a + b, 0) / statValues.length;
        const l10StdDev = calculateStdDev(statValues);

        if (l10Avg < config.avgRange.min || l10Avg > config.avgRange.max) continue;

        if (effectiveSide === 'under') {
          if (l10Avg > 0 && l10StdDev / l10Avg > 0.40) continue;
          const l5Avg = statValues.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
          if (l5Avg > l10Avg * 1.10) continue;
        }

        let bestLine: number | null = null, bestHitRate = 0;
        for (const line of config.lines) {
          const hitRate = calculateHitRate(statValues, line, effectiveSide);
          if (hitRate >= config.minHitRate && hitRate > bestHitRate) { bestHitRate = hitRate; bestLine = line; }
        }
        if (!bestLine) continue;

        const l3Values = statValues.slice(0, 3);
        const l3Avg = l3Values.length >= 3 ? l3Values.reduce((a, b) => a + b, 0) / l3Values.length : null;
        if (l3Avg !== null && l10Avg > 0) {
          const declineRatio = l3Avg / l10Avg;
          if (effectiveSide === 'over' && declineRatio < 0.75) continue;
          if (effectiveSide === 'under' && declineRatio > 1.25) continue;
        }

        const consistency = l10Avg > 0 ? 1 - (l10StdDev / l10Avg) : 0;
        const confidenceScore = Math.min(0.92, Math.max(0.35,
          (bestHitRate * 0.50) + (Math.max(0, consistency) * 0.30)
          - (l10Avg > 0 ? (l10StdDev / l10Avg) * 0.12 : 0)
          + (effectiveSide === 'over' ? 0.06 : 0)
          + (l10Logs.length >= 10 ? 0.04 : 0)
        ));

        sweetSpots.push({
          category: catKey, player_name: playerName, prop_type: config.propType,
          recommended_line: bestLine, recommended_side: effectiveSide,
          l10_hit_rate: Math.round(bestHitRate * 100) / 100,
          l10_avg: Math.round(l10Avg * 10) / 10, l10_min: Math.min(...statValues),
          l10_max: Math.max(...statValues), l10_median: Math.round(calculateMedian(statValues) * 10) / 10,
          l10_std_dev: Math.round(l10StdDev * 10) / 10,
          l3_avg: l3Avg !== null ? Math.round(l3Avg * 10) / 10 : null,
          games_played: l10Logs.length, archetype: null,
          confidence_score: Math.round(confidenceScore * 100) / 100,
          analysis_date: today, is_active: true, eligibility_type: 'MLB_AVG_RANGE',
          projected_value: Math.round(calculateMedian(statValues) * 10) / 10,
          projection_source: 'MLB_L10_MEDIAN',
        });
      }
    }

    // Fetch actual market lines
    const { data: unifiedProps } = await supabase
      .from('unified_props')
      .select('player_name, prop_type, fanduel_line, line, bookmaker, has_real_line, commence_time, opponent')
      .gte('commence_time', todayStartUtc)
      .eq('has_real_line', true);

    const actualLineMap = new Map<string, { line: number; bookmaker: string; opponent: string | null }>();
    for (const prop of (unifiedProps || [])) {
      const key = `${(prop.player_name || '').toLowerCase().trim()}_${(prop.prop_type || '').toLowerCase().replace(/^(player_|batter_|pitcher_)/, '')}`;
      const line = prop.fanduel_line ?? prop.line;
      if (line != null && !actualLineMap.has(key)) {
        actualLineMap.set(key, { line: Number(line), bookmaker: prop.bookmaker || 'fanduel', opponent: prop.opponent || null });
      }
    }

    // Load season stats
    const { data: seasonStats } = await supabase
      .from('player_season_stats').select('player_name, avg_points, avg_rebounds, avg_assists, avg_threes');
    const seasonStatsMap = new Map<string, any>();
    for (const stat of (seasonStats || [])) seasonStatsMap.set(stat.player_name?.toLowerCase().trim(), stat);

    // Validate spots against real lines
    const validatedSpots: any[] = [];
    let validatedCount = 0, droppedCount = 0, noGameCount = 0;

    for (const spot of sweetSpots) {
      const isMLBSpot = MLB_CATEGORIES.has(spot.category);
      // BUG G FIX: strip any existing prefix before normalizing prop type for lookup
      const rawProp = (spot.prop_type || '').replace(/^(player_|batter_|pitcher_)/, '');
      const key = `${spot.player_name.toLowerCase().trim()}_${rawProp.toLowerCase()}`;
      const actualData = actualLineMap.get(key);

      if (!actualData) { noGameCount++; continue; }

      // MLB: simplified validation
      if (isMLBSpot) {
        const mlbLogs = mlbPlayerLogs[spot.player_name];
        if (!mlbLogs || mlbLogs.length < 5) { spot.is_active = false; validatedSpots.push(spot); continue; }
        const isPitcher = spot.prop_type === 'pitcher_strikeouts';
        const relevantLogs = isPitcher ? mlbLogs.filter((l: any) => l.pitcher_strikeouts != null) : mlbLogs;
        const statValues = relevantLogs.slice(0, 10).map((log: any) => getMLBStatValue(log, spot.prop_type));
        const actualHitRate = calculateHitRate(statValues, actualData.line, spot.recommended_side);

        if (spot.recommended_side === 'over' && (spot.projected_value || 0) <= actualData.line) {
          spot.is_active = false; spot.risk_level = 'BLOCKED'; validatedSpots.push(spot); droppedCount++; continue;
        }
        if (spot.recommended_side === 'under' && (spot.projected_value || 0) >= actualData.line) {
          spot.is_active = false; spot.risk_level = 'BLOCKED'; validatedSpots.push(spot); droppedCount++; continue;
        }

        spot.actual_line = actualData.line;
        spot.actual_hit_rate = Math.round(actualHitRate * 100) / 100;
        spot.bookmaker = actualData.bookmaker;
        spot.is_active = actualHitRate >= 0.50;
        spot.risk_level = actualHitRate >= 0.70 ? 'LOW' : actualHitRate >= 0.55 ? 'MEDIUM' : 'HIGH';
        if (spot.is_active) validatedCount++; else droppedCount++;
        validatedSpots.push(spot);
        continue;
      }

      // NBA/NCAAB: full validation with projection
      const logs = playerLogs[spot.player_name];
      if (!logs || logs.length < 5) { spot.is_active = false; validatedSpots.push(spot); droppedCount++; continue; }

      const l10Logs = logs.slice(0, 10);
      const statValues = l10Logs.map(log => getStatValue(log, spot.prop_type));
      const l10Avg = statValues.reduce((a, b) => a + b, 0) / statValues.length;
      const l10StdDev = calculateStdDev(statValues);
      const l10Min = Math.min(...statValues);
      const l5Logs = l10Logs.slice(0, 5);
      const l5Values = l5Logs.map(log => getStatValue(log, spot.prop_type));
      const l5Avg = l5Values.length > 0 ? l5Values.reduce((a, b) => a + b, 0) / l5Values.length : l10Avg;
      const upcomingOpponent = actualData.opponent;

      // 3PT filter
      if (spot.category === 'THREE_POINT_SHOOTER' && actualData.line !== null) {
        const validation = validate3PTCandidate(spot.player_name, actualData.line, l10Avg, l10Min, l10StdDev, l5Avg);
        if (!validation.passes) {
          spot.is_active = false; spot.quality_tier = validation.tier;
          validatedSpots.push(spot); droppedCount++; continue;
        }
        spot.quality_tier = validation.tier;
      }

      // True projection
      const playerSeasonStats = seasonStatsMap.get(spot.player_name.toLowerCase().trim());
      let seasonAvg = 0;
      if (playerSeasonStats) {
        switch (spot.prop_type) {
          case 'points': seasonAvg = playerSeasonStats.avg_points || 0; break;
          case 'rebounds': seasonAvg = playerSeasonStats.avg_rebounds || 0; break;
          case 'assists': seasonAvg = playerSeasonStats.avg_assists || 0; break;
          case 'threes': seasonAvg = playerSeasonStats.avg_threes || 0; break;
        }
      }
      const projection = calculateTrueProjection(spot.player_name, spot.prop_type, statValues, upcomingOpponent, seasonAvg > 0 ? seasonAvg : undefined, l10StdDev);
      const l10Median = calculateMedian(statValues);
      const finalProjectedValue = projection.projectedValue ?? l10Median ?? l10Avg ?? actualData.line ?? 0;

      spot.projected_value = Math.round(finalProjectedValue * 10) / 10;
      spot.matchup_adjustment = projection.matchupAdj;
      spot.pace_adjustment = projection.paceAdj;
      spot.projection_source = projection.projectedValue ? projection.projectionSource : 'fallback_l10_median';
      spot.variance_ratio = projection.varianceRatio;
      spot.shrinkage_factor = projection.shrinkageFactor;
      spot.profile_flags = projection.profileFlags;

      const actualHitRate = calculateHitRate(statValues, actualData.line, spot.recommended_side);
      spot.recommended_line = actualData.line;
      spot.actual_line = actualData.line;
      spot.actual_hit_rate = Math.round(actualHitRate * 100) / 100;
      spot.l10_hit_rate = Math.round(actualHitRate * 100) / 100;
      spot.line_difference = 0;
      spot.bookmaker = actualData.bookmaker;

      // L3 buffer check
      const l3Vals = statValues.slice(0, 3);
      const stdL3 = l3Vals.length >= 3 ? l3Vals.reduce((a, b) => a + b, 0) / l3Vals.length : null;
      if (stdL3 !== null) {
        const stdL3Buffer = spot.recommended_side === 'over'
          ? ((stdL3 - actualData.line) / actualData.line) * 100
          : ((actualData.line - stdL3) / actualData.line) * 100;
        if (stdL3Buffer < 5) {
          spot.is_active = false; spot.risk_level = 'BLOCKED';
          spot.recommendation = `L3 buffer ${stdL3Buffer.toFixed(1)}% too thin`;
          validatedSpots.push(spot); droppedCount++; continue;
        }
      } else {
        spot.is_active = false; validatedSpots.push(spot); droppedCount++; continue;
      }

      let requiredHitRate = 0.70;
      if (spot.category === 'BIG_REBOUNDER') {
        if (actualData.line > 10.5) requiredHitRate = 0.60;
        else if (actualData.line >= 8.5) requiredHitRate = 0.65;
      }

      spot.is_active = actualHitRate >= requiredHitRate;
      if (spot.is_active) {
        validatedCount++;
        console.log(`[Category Analyzer] ✓ ${spot.player_name} ${spot.prop_type}: ${spot.recommended_side.toUpperCase()} ${actualData.line} (${(actualHitRate * 100).toFixed(0)}% L10)`);
      } else {
        droppedCount++;
        console.log(`[Category Analyzer] ✗ ${spot.player_name} ${spot.prop_type}: dropped (${(actualHitRate * 100).toFixed(0)}% < ${(requiredHitRate * 100).toFixed(0)}%)`);
      }
      validatedSpots.push(spot);
    }

    console.log(`[Category Analyzer] Validation: ${validatedCount} active, ${droppedCount} dropped, ${noGameCount} no market line`);

    validatedSpots.sort((a, b) => {
      if (a.is_active !== b.is_active) return b.is_active ? 1 : -1;
      return b.confidence_score - a.confidence_score;
    });

    // BUG F FIX: use upsert instead of delete+insert to prevent partial-empty states
    if (validatedSpots.length > 0) {
      const deduped = new Map<string, any>();
      for (const spot of validatedSpots) {
        const key = `${spot.player_name.toLowerCase()}_${spot.prop_type}_${spot.analysis_date}`;
        const existing = deduped.get(key);
        if (!existing || (spot.is_active && !existing.is_active) ||
            (spot.is_active === existing.is_active && (spot.confidence_score || 0) > (existing.confidence_score || 0))) {
          deduped.set(key, spot);
        }
      }

      const dedupedSpots = Array.from(deduped.values());
      console.log(`[Category Analyzer] Deduplicated to ${dedupedSpots.length} spots`);

      // BUG F FIX: upsert with conflict resolution instead of delete+insert
      // Requires unique constraint: CREATE UNIQUE INDEX IF NOT EXISTS
      //   category_sweet_spots_player_prop_date_key
      //   ON category_sweet_spots (player_name, prop_type, analysis_date);
      let insertedCount = 0, insertErrors = 0;
      for (let i = 0; i < dedupedSpots.length; i += 100) {
        const batch = dedupedSpots.slice(i, i + 100);
        const { error } = await supabase.from('category_sweet_spots')
          .upsert(batch, { onConflict: 'player_name,prop_type,analysis_date', ignoreDuplicates: false });
        if (error) { console.error(`[Category Analyzer] Upsert error:`, error.message); insertErrors++; }
        else insertedCount += batch.length;
      }
      console.log(`[Category Analyzer] Upserted ${insertedCount}/${dedupedSpots.length} spots (${insertErrors} errors)`);

      // BUG G FIX: normalize prop type correctly for unified_props sync
      const activeForSync = dedupedSpots.filter(s => s.is_active && s.projected_value != null && s.actual_line != null);
      let syncCount = 0, syncErrors = 0;
      for (const spot of activeForSync) {
        // BUG G FIX: strip any existing prefix, then add player_ cleanly
        const strippedProp = (spot.prop_type || '').replace(/^(player_|batter_|pitcher_)/, '');
        const normalizedPropType = `player_${strippedProp}`;
        const trueLine = spot.projected_value;
        const trueLineDiff = trueLine - spot.actual_line;

        const { error: syncError } = await supabase.from('unified_props')
          .update({
            true_line: trueLine, true_line_diff: Math.round(trueLineDiff * 10) / 10,
            composite_score: spot.confidence_score || 0,
            category: spot.category, recommended_side: spot.recommended_side,
          })
          .ilike('player_name', spot.player_name)
          .eq('prop_type', normalizedPropType)
          .gte('commence_time', todayStartUtc);  // BUG E FIX: uses ET midnight

        if (syncError) {
          syncErrors++;
          if (syncErrors <= 3) console.error(`[Sync] Error for ${spot.player_name}: ${syncError.message}`);
        } else syncCount++;
      }
      console.log(`[Category Analyzer] Synced ${syncCount}/${activeForSync.length} to unified_props (${syncErrors} errors)`);
    }

    if (deterministicFlips.length > 0) {
      console.log(`[Category Analyzer] 🔄 ${deterministicFlips.length} deterministic flips`);
      try {
        await supabase.from('bot_activity_log').insert({
          event_type: 'deterministic_side_flips',
          message: `Applied ${deterministicFlips.length} flips based on historical outcomes`,
          metadata: { flips: deterministicFlips }, severity: 'info',
        });
      } catch (_) { /* ignore logging failure */ }
    }

    const activeSpots = validatedSpots.filter(s => s.is_active);
    const grouped: Record<string, any[]> = {};
    for (const spot of activeSpots) {
      if (!grouped[spot.category]) grouped[spot.category] = [];
      grouped[spot.category].push(spot);
    }

    return new Response(JSON.stringify({
      success: true, data: activeSpots, grouped, count: activeSpots.length,
      totalAnalyzed: validatedSpots.length,
      droppedBelowThreshold: droppedCount, noUpcomingGame: noGameCount,
      deterministicFlips: deterministicFlips.length,
      categories: Object.keys(grouped), analyzedAt: new Date().toISOString(),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Category Analyzer] Fatal:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUIRED SQL MIGRATION (run before deploying)
// ─────────────────────────────────────────────────────────────────────────────
//
// BUG F FIX: add unique constraint so upsert works correctly
//
// CREATE UNIQUE INDEX IF NOT EXISTS category_sweet_spots_player_prop_date_key
//   ON category_sweet_spots (player_name, prop_type, analysis_date);
//
// BUG A FIX: add fade_only column to store signal direction metadata
//
// ALTER TABLE category_sweet_spots
//   ADD COLUMN IF NOT EXISTS fade_only boolean DEFAULT false;
//
// ─────────────────────────────────────────────────────────────────────────────
