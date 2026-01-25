// Category Props Analyzer v4.0 - TRUE PROJECTIONS + ARCHETYPE ENFORCEMENT
// Analyzes props by player category with TRUE projected values (not floor thresholds)
// v4.0: Added projected_value = L10 Median + Matchup Adjustment + Pace Adjustment
// v3.0: Archetype enforcement to prevent misaligned picks
// v2.0 Categories (based on 391 settled picks analysis)
// v1.5: BIG categories ALWAYS recommend OVER with risk_level indicators

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

interface MatchupHistory {
  player_name: string;
  opponent: string;
  prop_type: string;
  games_played: number;
  avg_stat: number;
  max_stat: number;
  min_stat: number;
}

interface GameEnvironment {
  game_id: string;
  home_team: string;
  away_team: string;
  vegas_total: number;
  vegas_spread: number;
  pace_rating?: number;
  pace_class?: string;
  game_script?: string;
}

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
}

// ============ PROJECTION WEIGHTS (v4.0) ============
const PROJECTION_WEIGHTS = {
  L10_MEDIAN: 0.55,      // Base weight for L10 median
  MATCHUP_H2H: 0.30,     // Weight for H2H history vs opponent
  PACE_FACTOR: 0.15,     // Weight for pace/game environment
};

// ============ ARCHETYPE DEFINITIONS (v3.0) ============
const ARCHETYPE_GROUPS = {
  BIGS: ['ELITE_REBOUNDER', 'GLASS_CLEANER', 'STRETCH_BIG', 'RIM_PROTECTOR'],
  GUARDS: ['PLAYMAKER', 'COMBO_GUARD', 'SCORING_GUARD', 'PURE_SHOOTER'],
  WINGS: ['TWO_WAY_WING', 'SCORING_WING'],
  STARS: ['ELITE_REBOUNDER', 'PLAYMAKER', 'PURE_SHOOTER', 'COMBO_GUARD', 'SCORING_WING'],
  ROLE_PLAYERS: ['TWO_WAY_WING', 'STRETCH_BIG', 'RIM_PROTECTOR', 'ROLE_PLAYER', 'UNKNOWN']
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
  'UNKNOWN': { primary: [], blocked: [] }
};

const BOUNCE_BACK_CONFIG = {
  minSeasonVsL10Gap: 1.5,
  minStdDevGap: 0.5,
  maxLineVsSeasonGap: 2.0,
  minL10HitRateForOVER: 0.20,
  maxL10HitRateForOVER: 0.50,
};

// Global caches for projection data
let matchupHistoryCache: Map<string, MatchupHistory> = new Map();
let gameEnvironmentCache: Map<string, GameEnvironment> = new Map();

const CATEGORIES: Record<string, CategoryConfig> = {
  // ============ NEW PROVEN WINNERS (v2.0) ============
  // Based on analysis of 391 settled picks
  
  ASSIST_ANCHOR: {
    name: 'Assist Anchor',
    propType: 'assists',
    avgRange: { min: 3, max: 5.5 },  // Guards averaging 3-5.5 assists
    lines: [3.5, 4.5, 5.5],
    side: 'under',
    minHitRate: 0.60  // 65% historical win rate on assists under 3.5-5
  },
  
  HIGH_REB_UNDER: {
    name: 'High Reb Under',
    propType: 'rebounds',
    avgRange: { min: 8, max: 14 },  // Big men averaging 8-14 rebounds
    lines: [9.5, 10.5, 11.5, 12.5],
    side: 'under',
    minHitRate: 0.55  // 62% historical win rate on rebounds under 10+
  },
  
  MID_SCORER_UNDER: {
    name: 'Mid Scorer Under',
    propType: 'points',
    avgRange: { min: 12, max: 22 },  // Players averaging 12-22 points
    lines: [14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5],
    side: 'under',
    minHitRate: 0.55  // 64% historical win rate on points under 14.5-20
  },
  
  // ============ OPTIMAL WINNERS (v3.0) - ARCHETYPE ENFORCED ============
  // Based on user's winning bet slip patterns with STRICT archetype validation
  
  ELITE_REB_OVER: {
    name: 'Elite Rebounder OVER',
    propType: 'rebounds',
    avgRange: { min: 9, max: 20 },  // Elite centers (Gobert, Nurkic, Wemby)
    lines: [9.5, 10.5, 11.5, 12.5],
    side: 'over',
    minHitRate: 0.55,  // ~65% win rate on elite big boards
    supportsBounceBack: true,
    // v3.0: ONLY elite rebounders/glass cleaners allowed
    requiredArchetypes: ['ELITE_REBOUNDER', 'GLASS_CLEANER', 'RIM_PROTECTOR'],
    blockedArchetypes: ['PLAYMAKER', 'COMBO_GUARD', 'PURE_SHOOTER', 'SCORING_GUARD']
  },
  
  ROLE_PLAYER_REB: {
    name: 'Role Player Reb OVER',
    propType: 'rebounds',
    avgRange: { min: 3, max: 6 },  // Finney-Smith, Kyshawn George type
    lines: [2.5, 3.5, 4.5],
    side: 'over',
    minHitRate: 0.60,  // ~60% win rate on low line reb overs
    // v3.0: Block stars and guards - only wings/bigs allowed
    requiredArchetypes: ['TWO_WAY_WING', 'STRETCH_BIG', 'SCORING_WING', 'ROLE_PLAYER', 'UNKNOWN'],
    blockedArchetypes: ['ELITE_REBOUNDER', 'PLAYMAKER', 'COMBO_GUARD', 'PURE_SHOOTER', 'SCORING_GUARD']
  },
  
  BIG_ASSIST_OVER: {
    name: 'Big Man Assists OVER',
    propType: 'assists',
    avgRange: { min: 2, max: 6 },  // Passing bigs (Vucevic, Sabonis, Jokic, Sengun)
    lines: [2.5, 3.5, 4.5],
    side: 'over',
    minHitRate: 0.60,  // ~70% win rate on low assist lines for bigs
    // v3.0: ONLY bigs allowed - no guards/wings
    requiredArchetypes: ['ELITE_REBOUNDER', 'GLASS_CLEANER', 'STRETCH_BIG', 'RIM_PROTECTOR'],
    blockedArchetypes: ['PLAYMAKER', 'COMBO_GUARD', 'PURE_SHOOTER', 'SCORING_GUARD', 'SCORING_WING']
  },
  
  LOW_SCORER_UNDER: {
    name: 'Low Scorer UNDER',
    propType: 'points',
    avgRange: { min: 5, max: 12 },  // Lu Dort, Reed Sheppard type
    lines: [7.5, 8.5, 9.5, 10.5, 11.5, 12.5],
    side: 'under',
    minHitRate: 0.55,  // ~65% win rate on role player pts under
    // v3.0: Block star scorers
    blockedArchetypes: ['PURE_SHOOTER', 'COMBO_GUARD', 'SCORING_GUARD', 'SCORING_WING']
  },
  
  STAR_FLOOR_OVER: {
    name: 'Star Floor OVER',
    propType: 'points',
    avgRange: { min: 20, max: 40 },  // Stars like Ja Morant, Booker
    lines: [14.5, 15.5, 16.5, 17.5, 18.5, 19.5],  // Well below their avg
    side: 'over',
    minHitRate: 0.65,  // ~75% win rate on star floor plays
    // v3.0: ONLY star scorers
    requiredArchetypes: ['PURE_SHOOTER', 'COMBO_GUARD', 'PLAYMAKER', 'SCORING_GUARD', 'SCORING_WING']
  },
  
  // ============ LEGACY CATEGORIES ============
  BIG_REBOUNDER: {
    name: 'Big Rebounder',
    propType: 'rebounds',
    avgRange: { min: 9, max: 20 },
    lineRange: { min: 9, max: 20 },
    lines: [6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5],
    side: 'over',
    minHitRate: 0.7,
    supportsBounceBack: true,
    requiredArchetypes: ['ELITE_REBOUNDER', 'GLASS_CLEANER', 'STRETCH_BIG', 'RIM_PROTECTOR']
  },
  LOW_LINE_REBOUNDER: {
    name: 'Low Line Rebounder',
    propType: 'rebounds',
    avgRange: { min: 4, max: 6 },
    lines: [3.5, 4.5, 5.5],
    side: 'over',
    minHitRate: 0.7
  },
  NON_SCORING_SHOOTER: {
    name: 'Non-Scoring Shooter',
    propType: 'points',
    avgRange: { min: 8, max: 14 },
    lines: [10.5, 11.5, 12.5, 13.5, 14.5],
    side: 'under',
    minHitRate: 0.7
  },
  VOLUME_SCORER: {
    name: 'Volume Scorer',
    propType: 'points',
    avgRange: { min: 15, max: 40 },
    lineRange: { min: 18, max: 40 },
    lines: [14.5, 16.5, 18.5, 20.5, 22.5, 24.5, 26.5, 28.5, 30.5],
    side: 'over',
    minHitRate: 0.7,
    supportsBounceBack: true
  },
  HIGH_ASSIST: {
    name: 'Playmaker',
    propType: 'assists',
    avgRange: { min: 4, max: 15 },
    lines: [3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5],
    side: 'over',
    minHitRate: 0.7
  },
  THREE_POINT_SHOOTER: {
    name: '3-Point Shooter',
    propType: 'threes',
    avgRange: { min: 1.5, max: 6 },
    lines: [0.5, 1.5, 2.5, 3.5, 4.5],
    side: 'over',
    minHitRate: 0.7
  }
};

// Runtime archetype lookup
let archetypeMap: Record<string, string> = {};

async function loadArchetypes(supabase: any): Promise<void> {
  const { data } = await supabase
    .from('player_archetypes')
    .select('player_name, primary_archetype');
  
  archetypeMap = {};
  for (const a of (data || [])) {
    archetypeMap[a.player_name?.toLowerCase().trim() || ''] = a.primary_archetype;
  }
  console.log(`[Category Analyzer] Loaded ${Object.keys(archetypeMap).length} player archetypes`);
}

function getPlayerArchetype(playerName: string): string {
  return archetypeMap[playerName?.toLowerCase().trim() || ''] || 'UNKNOWN';
}

// v3.0: Check if player passes archetype requirements for a category
function passesArchetypeValidation(playerName: string, config: CategoryConfig): { passes: boolean; reason: string } {
  const archetype = getPlayerArchetype(playerName);
  
  // Check blocked archetypes first
  if (config.blockedArchetypes && config.blockedArchetypes.includes(archetype)) {
    return { passes: false, reason: `Archetype ${archetype} is blocked for this category` };
  }
  
  // If required archetypes specified, player must match one
  if (config.requiredArchetypes && config.requiredArchetypes.length > 0) {
    if (!config.requiredArchetypes.includes(archetype)) {
      // Allow UNKNOWN archetype if no required match (fallback for missing data)
      if (archetype === 'UNKNOWN') {
        return { passes: true, reason: `Archetype unknown - allowing with caution` };
      }
      return { passes: false, reason: `Archetype ${archetype} not in required list: ${config.requiredArchetypes.join(', ')}` };
    }
  }
  
  return { passes: true, reason: `Archetype ${archetype} valid for category` };
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - avg, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function calculateHitRate(values: number[], line: number, side: 'over' | 'under'): number {
  if (values.length === 0) return 0;
  const hits = values.filter(v => side === 'over' ? v > line : v < line).length;
  return hits / values.length;
}

function getStatValue(log: GameLog, propType: string): number {
  switch (propType) {
    case 'points': return log.points || 0;
    case 'rebounds': return log.rebounds || 0;
    case 'assists': return log.assists || 0;
    case 'steals': return log.steals || 0;
    case 'blocks': return log.blocks || 0;
    case 'threes': return log.threes_made || 0;
    default: return 0;
  }
}

// ============ TRUE PROJECTION CALCULATION (v4.0) ============
function calculateTrueProjection(
  playerName: string,
  propType: string,
  statValues: number[],
  opponent: string | null
): { projectedValue: number; matchupAdj: number; paceAdj: number; projectionSource: string } {
  // 1. BASE: L10 Median (more stable than average for betting)
  const l10Median = calculateMedian(statValues);
  
  // 2. MATCHUP ADJUSTMENT: Check H2H history vs opponent
  let matchupAdj = 0;
  let projectionSource = 'L10_MEDIAN';
  
  if (opponent) {
    const matchupKey = `${playerName.toLowerCase().trim()}_${propType}_${opponent.toLowerCase().trim()}`;
    const matchup = matchupHistoryCache.get(matchupKey);
    
    if (matchup && matchup.games_played >= 2) {
      const h2hAvg = matchup.avg_stat;
      // Calculate adjustment: difference from L10 median weighted at 30%
      matchupAdj = (h2hAvg - l10Median) * PROJECTION_WEIGHTS.MATCHUP_H2H;
      projectionSource = matchup.games_played >= 5 ? 'L10+H2H_STRONG' : 'L10+H2H';
    }
  }
  
  // 3. PACE ADJUSTMENT: Check game environment
  let paceAdj = 0;
  if (opponent) {
    // Look up game environment for this matchup
    for (const [_, env] of gameEnvironmentCache) {
      const homeMatch = env.home_team?.toLowerCase().includes(opponent.toLowerCase()) ||
                       env.away_team?.toLowerCase().includes(opponent.toLowerCase());
      if (homeMatch && env.pace_rating) {
        // Pace multiplier: normalize around 100 (average pace = 100)
        const paceMultiplier = (env.pace_rating / 100) - 1.0;
        paceAdj = paceMultiplier * l10Median * PROJECTION_WEIGHTS.PACE_FACTOR;
        
        // For UNDER picks in slow games, invert the adjustment
        if (env.pace_class === 'SLOW' && paceAdj < 0) {
          projectionSource += '+SLOW';
        } else if (env.pace_class === 'FAST' && paceAdj > 0) {
          projectionSource += '+FAST';
        }
        break;
      }
    }
  }
  
  // 4. FINAL PROJECTION (rounded to 0.5)
  const rawProjection = l10Median + matchupAdj + paceAdj;
  const projectedValue = Math.round(rawProjection * 2) / 2;
  
  return {
    projectedValue,
    matchupAdj: Math.round(matchupAdj * 10) / 10,
    paceAdj: Math.round(paceAdj * 10) / 10,
    projectionSource
  };
}

// Load matchup history into cache
async function loadMatchupHistory(supabase: any): Promise<void> {
  const { data, error } = await supabase
    .from('matchup_history')
    .select('player_name, opponent, prop_type, games_played, avg_stat, max_stat, min_stat');
  
  if (error) {
    console.warn('[Category Analyzer] Matchup history load error:', error.message);
    return;
  }
  
  matchupHistoryCache.clear();
  for (const m of (data || [])) {
    // Key: playername_proptype_opponent
    const propType = m.prop_type?.replace('player_', '') || '';
    const key = `${m.player_name?.toLowerCase().trim()}_${propType}_${m.opponent?.toLowerCase().trim()}`;
    matchupHistoryCache.set(key, m);
  }
  console.log(`[Category Analyzer] Loaded ${matchupHistoryCache.size} matchup history records`);
}

// Load game environment into cache
async function loadGameEnvironment(supabase: any): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('game_environment')
    .select('game_id, home_team, away_team, vegas_total, vegas_spread, pace_rating, pace_class, game_script')
    .gte('game_date', today);
  
  if (error) {
    console.warn('[Category Analyzer] Game environment load error:', error.message);
    return;
  }
  
  gameEnvironmentCache.clear();
  for (const g of (data || [])) {
    gameEnvironmentCache.set(g.game_id, g);
  }
  console.log(`[Category Analyzer] Loaded ${gameEnvironmentCache.size} game environment records`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { category, minHitRate = 0.7, forceRefresh = false } = await req.json().catch(() => ({}));

    console.log(`[Category Analyzer v4.0] Starting analysis with TRUE PROJECTIONS for category: ${category || 'ALL'}`);

    // v4.0: Load all projection data sources
    await Promise.all([
      loadArchetypes(supabase),
      loadMatchupHistory(supabase),
      loadGameEnvironment(supabase)
    ]);

    // Get today's date for analysis
    const today = new Date().toISOString().split('T')[0];

    // Check if we already have fresh data
    if (!forceRefresh) {
      const { data: existingData } = await supabase
        .from('category_sweet_spots')
        .select('*')
        .eq('analysis_date', today)
        .eq('is_active', true);

      if (existingData && existingData.length > 0) {
        console.log(`[Category Analyzer] Found ${existingData.length} existing sweet spots for today`);
        
        if (category) {
          const filtered = existingData.filter((d: any) => d.category === category);
          return new Response(JSON.stringify({
            success: true,
            data: filtered,
            cached: true,
            count: filtered.length
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        
        return new Response(JSON.stringify({
          success: true,
          data: existingData,
          cached: true,
          count: existingData.length
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Fetch all game logs from last 30 days to ensure we have L10 for most players
    // Use pagination to get all logs (Supabase has 1000 row limit)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let allGameLogs: GameLog[] = [];
    let page = 0;
    const pageSize = 1000;
    
    while (true) {
      const { data: gameLogs, error: logsError } = await supabase
        .from('nba_player_game_logs')
        .select('player_name, game_date, points, rebounds, assists, steals, blocks, threes_made, minutes_played')
        .gte('game_date', thirtyDaysAgo.toISOString().split('T')[0])
        .order('game_date', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (logsError) {
        console.error('[Category Analyzer] Error fetching game logs:', logsError);
        throw new Error(`Failed to fetch game logs: ${logsError.message}`);
      }

      if (!gameLogs || gameLogs.length === 0) break;
      
      allGameLogs = allGameLogs.concat(gameLogs as GameLog[]);
      console.log(`[Category Analyzer] Fetched page ${page + 1} with ${gameLogs.length} logs`);
      
      if (gameLogs.length < pageSize) break;
      page++;
    }

    console.log(`[Category Analyzer] Total game logs fetched: ${allGameLogs.length}`);

    if (allGameLogs.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No game logs found',
        data: []
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Group logs by player
    const playerLogs: Record<string, GameLog[]> = {};
    for (const log of allGameLogs) {
      const name = log.player_name;
      if (!playerLogs[name]) playerLogs[name] = [];
      playerLogs[name].push(log);
    }

    console.log(`[Category Analyzer] Grouped logs for ${Object.keys(playerLogs).length} players`);

    // Analyze each category
    const categoriesToAnalyze = category ? [category] : Object.keys(CATEGORIES);
    const sweetSpots: any[] = [];
    let archetypeBlockedCount = 0;

    for (const catKey of categoriesToAnalyze) {
      const config = CATEGORIES[catKey];
      if (!config) continue;

      console.log(`[Category Analyzer] Analyzing category: ${catKey}`);
      let playersInRange = 0;
      let qualifiedPlayers = 0;
      let blockedByArchetype = 0;

      for (const [playerName, logs] of Object.entries(playerLogs)) {
        // Take last 10 games only
        const l10Logs = logs.slice(0, 10);
        if (l10Logs.length < 5) continue; // Need at least 5 games for reliable analysis

        const statValues = l10Logs.map(log => getStatValue(log, config.propType));
        const l10Avg = statValues.reduce((a, b) => a + b, 0) / statValues.length;
        const l10StdDev = calculateStdDev(statValues);

        // v1.4: DUAL ELIGIBILITY - Check avgRange OR lineRange
        const avgEligible = l10Avg >= config.avgRange.min && l10Avg <= config.avgRange.max;
        
        // For line-based eligibility, we need to check against actual bookmaker line later
        // For now, mark players who might qualify via lineRange for later validation
        const potentialLineEligible = config.lineRange !== undefined;

        // v3.0: ARCHETYPE VALIDATION - Must pass before being considered
        const archetypeCheck = passesArchetypeValidation(playerName, config);
        if (!archetypeCheck.passes) {
          if (avgEligible && playersInRange < 5) {
            // Only log first few blocked for debugging
            console.log(`[Category Analyzer] ⛔ ${catKey}: ${playerName} blocked - ${archetypeCheck.reason}`);
          }
          blockedByArchetype++;
          continue; // Skip this player for this category
        }
        
        // If neither eligibility path is possible, skip
        if (!avgEligible && !potentialLineEligible) continue;
        
        playersInRange++;

        const l10Min = Math.min(...statValues);
        const l10Max = Math.max(...statValues);
        const l10Median = calculateMedian(statValues);

        // Find the best line for this player
        let bestLine: number | null = null;
        let bestHitRate = 0;

        for (const line of config.lines) {
          const hitRate = calculateHitRate(statValues, line, config.side);
          
          if (hitRate >= (minHitRate || config.minHitRate) && hitRate > bestHitRate) {
            bestHitRate = hitRate;
            bestLine = line;
          }
        }

        // Log top candidates even if they don't qualify
        if (playersInRange <= 5) {
          console.log(`[Category Analyzer] ${catKey} - ${playerName}: avg=${l10Avg.toFixed(1)}, bestLine=${bestLine}, hitRate=${(bestHitRate * 100).toFixed(0)}%, avgEligible=${avgEligible}, potentialLineEligible=${potentialLineEligible}`);
        }

        // Calculate confidence score based on consistency and hit rate
        const consistency = l10Avg > 0 ? 1 - (l10StdDev / l10Avg) : 0;

        if (bestLine !== null && bestHitRate >= (minHitRate || config.minHitRate)) {
          qualifiedPlayers++;
          
          const confidenceScore = (bestHitRate * 0.6) + (Math.max(0, consistency) * 0.4);

          sweetSpots.push({
            category: catKey,
            player_name: playerName,
            prop_type: config.propType,
            recommended_line: bestLine,
            recommended_side: config.side,
            l10_hit_rate: Math.round(bestHitRate * 100) / 100,
            l10_avg: Math.round(l10Avg * 10) / 10,
            l10_min: l10Min,
            l10_max: l10Max,
            l10_median: Math.round(l10Median * 10) / 10,
            games_played: l10Logs.length,
            archetype: getPlayerArchetype(playerName), // v3.0: Store actual archetype
            confidence_score: Math.round(confidenceScore * 100) / 100,
            analysis_date: today,
            is_active: true,
            eligibility_type: 'AVG_RANGE' // Track how they qualified
          });
        } else if (!avgEligible && potentialLineEligible) {
          // v1.4: Player doesn't meet avgRange but might qualify via lineRange
          // Add as potential bounce-back candidate for later validation
          sweetSpots.push({
            category: catKey,
            player_name: playerName,
            prop_type: config.propType,
            recommended_line: null, // Will be set during validation
            recommended_side: config.side,
            l10_hit_rate: null,
            l10_avg: Math.round(l10Avg * 10) / 10,
            l10_min: l10Min,
            l10_max: l10Max,
            l10_median: Math.round(l10Median * 10) / 10,
            l10_std_dev: Math.round(l10StdDev * 10) / 10,
            games_played: l10Logs.length,
            archetype: getPlayerArchetype(playerName), // v3.0: Store actual archetype
            confidence_score: 0, // Will be calculated during validation
            analysis_date: today,
            is_active: false, // Will be activated during validation if eligible
            eligibility_type: 'LINE_RANGE_PENDING', // Needs line-based validation
            requires_bounce_back_check: config.supportsBounceBack || false
          });
        }
      }
      
      console.log(`[Category Analyzer] ${catKey}: ${playersInRange} in range, ${qualifiedPlayers} qualified, ${blockedByArchetype} blocked by archetype`);
      archetypeBlockedCount += blockedByArchetype;
    }

    console.log(`[Category Analyzer] Found ${sweetSpots.length} total sweet spots before validation (${archetypeBlockedCount} total blocked by archetype)`);


    // ======= NEW: Validate against actual bookmaker lines from unified_props =======
    console.log(`[CAT-ANALYZER-CRITICAL] Starting unified_props fetch...`);
    
    // Fetch actual lines from unified_props for upcoming games
    const nowIso = new Date().toISOString();
    console.log(`[CAT-ANALYZER-CRITICAL] Using timestamp: ${nowIso}`);
    
    const { data: upcomingProps, error: propsError } = await supabase
      .from('unified_props')
      .select('player_name, prop_type, current_line, over_price, under_price, bookmaker, commence_time, game_description')
      .gte('commence_time', nowIso)
      .order('commence_time', { ascending: true });

    if (propsError) {
      console.error(`[CAT-ANALYZER-CRITICAL] Error fetching unified_props: ${propsError.message}`);
    }

    console.log(`[CAT-ANALYZER-CRITICAL] Found ${upcomingProps?.length || 0} upcoming props`);

    // Create lookup map for actual lines (key: playername_proptype)
    // v4.1: Include opponent extraction from game_description for accurate projections
    const actualLineMap = new Map<string, { line: number; overPrice: number; underPrice: number; bookmaker: string; opponent: string | null; playerTeam: string | null }>();
    for (const prop of upcomingProps || []) {
      if (!prop.player_name || !prop.prop_type || prop.current_line == null) continue;
      
      // v4.1: Parse opponent from game_description (e.g., "MIN @ CHI" or "Denver Nuggets @ Chicago Bulls")
      // Since we don't have player's team, we'll just extract both teams for later matching
      let opponent: string | null = null;
      let playerTeam: string | null = null;
      if (prop.game_description) {
        const atMatch = prop.game_description.match(/^(.+?)\s*@\s*(.+)$/i);
        const vsMatch = prop.game_description.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
        const parts = atMatch || vsMatch;
        if (parts && parts.length >= 3) {
          // Store both teams - will need to match player to team later via game logs
          playerTeam = parts[1].trim(); // Away team (placeholder - may need player roster lookup)
          opponent = parts[2].trim();   // Home team
        }
      }
      
      const key = `${prop.player_name.toLowerCase().trim()}_${prop.prop_type.toLowerCase()}`;
      // Only keep first occurrence (most recent)
      if (!actualLineMap.has(key)) {
        actualLineMap.set(key, {
          line: prop.current_line,
          overPrice: prop.over_price,
          underPrice: prop.under_price,
          bookmaker: prop.bookmaker,
          opponent: opponent,
          playerTeam: playerTeam
        });
      }
    }

    console.log(`[CAT-ANALYZER-CRITICAL] Built lookup map with ${actualLineMap.size} unique player/prop combinations`);

    // Validate each sweet spot against actual lines and recalculate hit rates
    const validatedSpots: any[] = [];
    let validatedCount = 0;
    let droppedCount = 0;
    let noGameCount = 0;
    let bounceBackCount = 0;
    let lineEligibleCount = 0;

    // Fetch season stats for bounce back detection
    const { data: seasonStats } = await supabase
      .from('player_season_stats')
      .select('player_name, avg_points, avg_rebounds, avg_assists, avg_threes');
    
    const seasonStatsMap = new Map<string, any>();
    for (const stat of seasonStats || []) {
      seasonStatsMap.set(stat.player_name?.toLowerCase().trim(), stat);
    }
    
    console.log(`[Category Analyzer] Loaded season stats for ${seasonStatsMap.size} players`);

    for (const spot of sweetSpots) {
      const key = `${spot.player_name.toLowerCase().trim()}_${spot.prop_type.toLowerCase()}`;
      const actualData = actualLineMap.get(key);
      
      if (!actualData) {
        // No upcoming game found - mark as inactive
        spot.is_active = false;
        spot.actual_line = null;
        spot.actual_hit_rate = null;
        spot.line_difference = null;
        spot.bookmaker = null;
        validatedSpots.push(spot);
        noGameCount++;
        continue;
      }
      
      // Recalculate L10 hit rate against actual bookmaker line
      const logs = playerLogs[spot.player_name];
      if (logs && logs.length >= 5) {
        const l10Logs = logs.slice(0, 10);
        const statValues = l10Logs.map(log => getStatValue(log, spot.prop_type));
        const l10Avg = statValues.reduce((a, b) => a + b, 0) / statValues.length;
        const l10StdDev = calculateStdDev(statValues);
        
        // v4.1: Get UPCOMING opponent from unified_props (not historical from game logs)
        const upcomingOpponent = actualData.opponent || null;
        
        // v4.1: Calculate TRUE PROJECTION using correct upcoming opponent
        const projection = calculateTrueProjection(
          spot.player_name,
          spot.prop_type,
          statValues,
          upcomingOpponent
        );
        
        // Add projection data to spot
        spot.projected_value = projection.projectedValue;
        spot.matchup_adjustment = projection.matchupAdj;
        spot.pace_adjustment = projection.paceAdj;
        spot.projection_source = projection.projectionSource;
        
        // v4.1: Log projection for debugging
        console.log(`[Projection] ${spot.player_name} ${spot.prop_type} vs ${upcomingOpponent || 'unknown'}: Proj=${projection.projectedValue?.toFixed(1)}, MatchupAdj=${projection.matchupAdj.toFixed(1)}, PaceAdj=${projection.paceAdj.toFixed(1)}`);
        
        // v1.4: Handle LINE_RANGE_PENDING spots (line-based eligibility)
        if (spot.eligibility_type === 'LINE_RANGE_PENDING') {
          const config = CATEGORIES[spot.category];
          
          // Check if actual line qualifies via lineRange
          const lineEligible = config.lineRange && 
            actualData.line >= config.lineRange.min && 
            actualData.line <= config.lineRange.max;
          
          if (!lineEligible) {
            spot.is_active = false;
            validatedSpots.push(spot);
            continue;
          }
          
          lineEligibleCount++;
          console.log(`[Category Analyzer] [LINE-ELIGIBLE] ${spot.player_name}: L10 avg ${l10Avg.toFixed(1)} below range but line ${actualData.line} qualifies`);
          
          // Get season average for bounce back detection
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
          
          // Check for bounce back candidate
          const seasonVsL10Gap = seasonAvg - l10Avg;
          const stdDevGap = l10StdDev > 0 ? seasonVsL10Gap / l10StdDev : 0;
          const lineVsSeasonGap = Math.abs(actualData.line - seasonAvg);
          
          const isBounceBackCandidate = 
            config.supportsBounceBack &&
            seasonVsL10Gap >= BOUNCE_BACK_CONFIG.minSeasonVsL10Gap &&
            stdDevGap >= BOUNCE_BACK_CONFIG.minStdDevGap &&
            lineVsSeasonGap <= BOUNCE_BACK_CONFIG.maxLineVsSeasonGap;
          
          if (isBounceBackCandidate) {
            // Check OVER hit rate - low L10 OVER hit rate = due for bounce
            const l10OverHitRate = calculateHitRate(statValues, actualData.line, 'over');
            
            // Ideal bounce back: Low L10 hit rate (20-50%) + Season avg >= line
            if (l10OverHitRate >= BOUNCE_BACK_CONFIG.minL10HitRateForOVER &&
                l10OverHitRate <= BOUNCE_BACK_CONFIG.maxL10HitRateForOVER &&
                seasonAvg >= actualData.line * 0.95) { // Season avg within 5% of line
              
              bounceBackCount++;
              spot.recommended_side = 'over';
              spot.recommended_line = actualData.line;
              spot.actual_line = actualData.line;
              spot.actual_hit_rate = Math.round(l10OverHitRate * 100) / 100;
              spot.bookmaker = actualData.bookmaker;
              spot.is_active = true;
              spot.eligibility_type = 'BOUNCE_BACK';
              spot.bounce_back_score = Math.round(stdDevGap * 100) / 100;
              spot.season_avg = Math.round(seasonAvg * 10) / 10;
              
              // Confidence based on how far below mean + season baseline
              const confidenceScore = Math.min(0.85, 0.5 + (stdDevGap * 0.15) + ((seasonAvg - actualData.line) / actualData.line * 0.5));
              spot.confidence_score = Math.round(confidenceScore * 100) / 100;
              
              validatedCount++;
              console.log(`[Category Analyzer] 🔥 BOUNCE-BACK ${spot.player_name} ${spot.prop_type} OVER ${actualData.line}: Season ${seasonAvg.toFixed(1)} vs L10 ${l10Avg.toFixed(1)} (${stdDevGap.toFixed(2)} std devs below)`);
              validatedSpots.push(spot);
              continue;
            }
          }
          
          // v1.5: For BIG categories, ALWAYS recommend OVER with risk indicator
          const overHitRate = calculateHitRate(statValues, actualData.line, 'over');
          
          spot.recommended_side = 'over';
          spot.recommended_line = actualData.line;
          spot.actual_line = actualData.line;
          spot.actual_hit_rate = Math.round(overHitRate * 100) / 100;
          spot.bookmaker = actualData.bookmaker;
          spot.is_active = true;
          spot.eligibility_type = 'LINE_ELIGIBLE_OVER';
          
          // Add risk level based on L10 hit rate
          if (overHitRate >= 0.70) {
            spot.risk_level = 'LOW';
            spot.recommendation = 'Strong play - 70%+ L10 hit rate';
          } else if (overHitRate >= 0.50) {
            spot.risk_level = 'MEDIUM';
            spot.recommendation = 'Decent value - watch for variance';
          } else if (overHitRate >= 0.30) {
            spot.risk_level = 'HIGH';
            spot.recommendation = 'High variance - potential regression play';
          } else {
            spot.risk_level = 'EXTREME';
            spot.recommendation = 'Extreme variance - use caution';
          }
          
          // Confidence adjusted by hit rate (scaled 0.4-0.9)
          const confidence = Math.max(0.4, Math.min(0.9, overHitRate * 0.8 + 0.3));
          spot.confidence_score = Math.round(confidence * 100) / 100;
          
          lineEligibleCount++;
          validatedCount++;
          console.log(`[Category Analyzer] ✓ LINE-ELIGIBLE-OVER ${spot.player_name} ${spot.prop_type}: OVER ${actualData.line} (${(overHitRate * 100).toFixed(0)}% L10, ${spot.risk_level} risk)`);
          validatedSpots.push(spot);
          continue;
        }
        
        // v3.0 OPTIMAL WINNER categories - trust L10 hit rate for activation
        // These categories have specific line ranges designed for favorable odds
        const OPTIMAL_WINNER_CATEGORIES = [
          'ELITE_REB_OVER', 'ROLE_PLAYER_REB', 'BIG_ASSIST_OVER', 
          'LOW_SCORER_UNDER', 'STAR_FLOOR_OVER'
        ];

        if (OPTIMAL_WINNER_CATEGORIES.includes(spot.category)) {
          // Use the L10 hit rate calculated during initial analysis (not recalculated against actual line)
          const config = CATEGORIES[spot.category];
          const actualHitRate = calculateHitRate(statValues, actualData.line, spot.recommended_side);
          
          spot.actual_line = actualData.line;
          spot.actual_hit_rate = Math.round(actualHitRate * 100) / 100;
          spot.line_difference = spot.recommended_line ? Math.round((actualData.line - spot.recommended_line) * 10) / 10 : null;
          spot.bookmaker = actualData.bookmaker;
          
          // Activate based on ORIGINAL L10 hit rate (stored during analysis)
          spot.is_active = (spot.l10_hit_rate || 0) >= (config?.minHitRate || 0.55);
          
          // Add risk level based on actual line hit rate
          if (actualHitRate >= 0.60) {
            spot.risk_level = 'LOW';
            spot.recommendation = `Strong play - ${(actualHitRate * 100).toFixed(0)}% vs actual line`;
          } else if (actualHitRate >= 0.45) {
            spot.risk_level = 'MEDIUM';
            spot.recommendation = `Moderate risk - ${(actualHitRate * 100).toFixed(0)}% vs actual, ${((spot.l10_hit_rate || 0) * 100).toFixed(0)}% L10`;
          } else {
            spot.risk_level = 'HIGH';
            spot.recommendation = `Higher risk - L10 favorable but actual line tighter`;
          }
          
          if (spot.is_active) {
            validatedCount++;
            console.log(`[Category Analyzer] ✓ OPTIMAL ${spot.category} ${spot.player_name}: ${spot.recommended_side.toUpperCase()} ${actualData.line} (L10: ${((spot.l10_hit_rate || 0) * 100).toFixed(0)}%, Actual: ${(actualHitRate * 100).toFixed(0)}%)`);
          } else {
            droppedCount++;
            console.log(`[Category Analyzer] ✗ OPTIMAL ${spot.player_name}: L10 hit rate ${((spot.l10_hit_rate || 0) * 100).toFixed(0)}% below threshold`);
          }
          
          validatedSpots.push(spot);
          continue; // Skip standard validation
        }

        // Standard validation for AVG_RANGE qualified spots (legacy categories)
        const actualHitRate = calculateHitRate(statValues, actualData.line, spot.recommended_side);
        
        spot.actual_line = actualData.line;
        spot.actual_hit_rate = Math.round(actualHitRate * 100) / 100;
        spot.line_difference = spot.recommended_line ? Math.round((actualData.line - spot.recommended_line) * 10) / 10 : null;
        spot.bookmaker = actualData.bookmaker;
        
        // v1.2: TIERED HIT RATE REQUIREMENTS for BIG_REBOUNDER
        // High-volume rebounders against tough lines still have value at lower thresholds
        let requiredHitRate = 0.70; // Default 70%
        
        if (spot.category === 'BIG_REBOUNDER') {
          if (actualData.line > 10.5) {
            requiredHitRate = 0.60; // 60% for very high lines (10.5+)
          } else if (actualData.line >= 8.5) {
            requiredHitRate = 0.65; // 65% for high lines (8.5-10.5)
          }
          // Lines <= 8.5 keep 70% requirement
        }
        
        spot.is_active = actualHitRate >= requiredHitRate;
        
        if (spot.is_active) {
          validatedCount++;
          console.log(`[Category Analyzer] ✓ ${spot.player_name} ${spot.prop_type}: recommended=${spot.recommended_line}, actual=${actualData.line}, hitRate=${(actualHitRate * 100).toFixed(0)}% (req: ${(requiredHitRate * 100).toFixed(0)}%)`);
        } else {
          droppedCount++;
          console.log(`[Category Analyzer] ✗ ${spot.player_name} ${spot.prop_type}: dropped (hitRate ${(actualHitRate * 100).toFixed(0)}% < ${(requiredHitRate * 100).toFixed(0)}% at actual line ${actualData.line})`);
          
          // v1.5: For BIG categories, keep as OVER with risk indicator instead of switching to UNDER
          if (spot.category === 'BIG_REBOUNDER' || spot.category === 'VOLUME_SCORER') {
            // Re-enable with risk indicator
            spot.is_active = true;
            spot.recommended_side = 'over'; // Keep as OVER
            droppedCount--; // Undo the drop
            validatedCount++;
            
            // Set risk level based on actual hit rate
            if (actualHitRate >= 0.50) {
              spot.risk_level = 'MEDIUM';
              spot.recommendation = `Moderate risk - ${(actualHitRate * 100).toFixed(0)}% L10 hit rate`;
            } else if (actualHitRate >= 0.30) {
              spot.risk_level = 'HIGH';
              spot.recommendation = `High variance - ${(actualHitRate * 100).toFixed(0)}% L10, regression possible`;
            } else {
              spot.risk_level = 'EXTREME';
              spot.recommendation = `Extreme variance - ${(actualHitRate * 100).toFixed(0)}% L10, use caution`;
            }
            
            console.log(`[Category Analyzer] ⚠ ${spot.player_name} ${spot.prop_type}: OVER ${actualData.line} with ${spot.risk_level} risk (${(actualHitRate * 100).toFixed(0)}% L10)`);
          }
        }
      }
      
      validatedSpots.push(spot);
    }

    console.log(`[Category Analyzer] Validation complete: ${validatedCount} active, ${droppedCount} dropped, ${noGameCount} no game today, ${bounceBackCount} bounce-back, ${lineEligibleCount} line-eligible`);

    // Sort by confidence score (active first, then by score)
    validatedSpots.sort((a, b) => {
      if (a.is_active !== b.is_active) return b.is_active ? 1 : -1;
      return b.confidence_score - a.confidence_score;
    });

    // Upsert to database (clear old data first for today)
    if (validatedSpots.length > 0) {
      // Delete existing data for today
      const { error: deleteError } = await supabase
        .from('category_sweet_spots')
        .delete()
        .eq('analysis_date', today);

      if (deleteError) {
        console.error('[Category Analyzer] Error deleting old data:', deleteError);
      } else {
        console.log(`[Category Analyzer] Deleted old data for ${today}`);
      }

      // Deduplicate spots by player_name + prop_type (keep highest confidence per player/prop)
      const deduped = new Map<string, any>();
      for (const spot of validatedSpots) {
        const key = `${spot.player_name.toLowerCase()}_${spot.prop_type}`;
        const existing = deduped.get(key);
        if (!existing || (spot.is_active && !existing.is_active) || 
            (spot.is_active === existing.is_active && (spot.confidence_score || 0) > (existing.confidence_score || 0))) {
          deduped.set(key, spot);
        }
      }
      
      const dedupedSpots = Array.from(deduped.values());
      console.log(`[Category Analyzer] Deduplicated ${validatedSpots.length} spots to ${dedupedSpots.length}`);

      // Insert in batches of 100 to avoid hitting limits
      const BATCH_SIZE = 100;
      let insertedCount = 0;
      let insertErrors = 0;
      
      for (let i = 0; i < dedupedSpots.length; i += BATCH_SIZE) {
        const batch = dedupedSpots.slice(i, i + BATCH_SIZE);
        const { error: insertError } = await supabase
          .from('category_sweet_spots')
          .insert(batch);

        if (insertError) {
          console.error(`[Category Analyzer] Batch ${Math.floor(i/BATCH_SIZE) + 1} error:`, insertError.message);
          insertErrors++;
        } else {
          insertedCount += batch.length;
        }
      }
      
      console.log(`[Category Analyzer] Inserted ${insertedCount}/${dedupedSpots.length} sweet spots (${insertErrors} errors)`);
    }

    // Group by category for response (only active ones)
    const activeSpots = validatedSpots.filter(s => s.is_active);
    const grouped: Record<string, any[]> = {};
    for (const spot of activeSpots) {
      if (!grouped[spot.category]) grouped[spot.category] = [];
      grouped[spot.category].push(spot);
    }

    return new Response(JSON.stringify({
      success: true,
      data: activeSpots,
      grouped,
      count: activeSpots.length,
      totalAnalyzed: validatedSpots.length,
      droppedBelowThreshold: droppedCount,
      noUpcomingGame: noGameCount,
      bounceBackPicks: bounceBackCount,
      lineEligiblePicks: lineEligibleCount,
      categories: Object.keys(grouped),
      analyzedAt: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Category Analyzer] Error:', errorMessage);
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
