// v3.1 — force redeploy: composite filter + thin-slate timeout prevention 2026-03-16
/**
 * bot-generate-daily-parlays (v2.1 - Tiered System)
 * 
 * Generates 240+ daily parlays across three tiers:
 * - Exploration (150/day): Edge discovery, $0 stake, 2K iterations
 * - Validation (50/day): Pattern confirmation, simulated stake, 10K iterations
 * - Execution (40/day): Best bets, Kelly stakes, 25K iterations
 * 
 * Runs at 9 AM ET daily via cron.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Props banned from parlays — too binary/volatile
const BLOCKED_PARLAY_PROPS = new Set(['player_steals', 'player_blocks']);
const MAX_REBOUND_LEGS_PER_PARLAY = 1;

// ============= DAY TYPE CLASSIFIER (matchup-driven prop type signal) =============
type DayType = 'POINTS' | 'THREES' | 'REBOUNDS' | 'ASSISTS' | 'BALANCED';
interface DayTypeSignal {
  primary: DayType;
  secondary: DayType | null;
  confidence: number;
  propScores: Record<string, { avgScore: number; vectors: number; games: number }>;
}

const PROP_TO_DAY_TYPE: Record<string, DayType> = {
  points: 'POINTS', threes: 'THREES', rebounds: 'REBOUNDS', assists: 'ASSISTS',
};
const DAY_TYPE_TO_PROP_TYPES: Record<DayType, string[]> = {
  POINTS: ['player_points'],
  THREES: ['player_threes'],
  REBOUNDS: ['player_rebounds'],
  ASSISTS: ['player_assists'],
  BALANCED: [],
};

async function getDayTypeSignal(supabase: any, gameDate: string): Promise<DayTypeSignal | null> {
  try {
    const { data, error } = await supabase
      .from('bot_research_findings')
      .select('summary')
      .eq('research_date', gameDate)
      .eq('category', 'matchup_defense_scan')
      .order('relevance_score', { ascending: false })
      .limit(1);

    if (error || !data?.[0]?.summary) {
      console.log(`[Bot v2] 📊 Day Type: No matchup scan found for ${gameDate}`);
      return null;
    }

    const summary = data[0].summary as string;
    const propScores: Record<string, { scores: number[]; vectors: number; games: Set<string> }> = {
      points: { scores: [], vectors: 0, games: new Set() },
      threes: { scores: [], vectors: 0, games: new Set() },
      rebounds: { scores: [], vectors: 0, games: new Set() },
      assists: { scores: [], vectors: 0, games: new Set() },
    };

    const gameBlocks = summary.split(' | ');
    for (const block of gameBlocks) {
      const gameKeyMatch = block.match(/^([A-Z]+@[A-Z]+)/);
      const gameKey = gameKeyMatch?.[1] || 'UNK';
      const propPattern = /(points|threes|rebounds|assists)\(OFF\d+vDEF\d+=([0-9.]+)\)/g;
      let match;
      while ((match = propPattern.exec(block)) !== null) {
        const propType = match[1];
        const score = parseFloat(match[2]);
        if (propScores[propType]) {
          propScores[propType].scores.push(score);
          propScores[propType].vectors++;
          propScores[propType].games.add(gameKey);
        }
      }
    }

    const ranked = Object.entries(propScores)
      .map(([key, data]) => ({
        key,
        avgScore: data.scores.length > 0 ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length : 0,
        vectors: data.vectors,
        games: data.games.size,
      }))
      .sort((a, b) => b.avgScore - a.avgScore);

    const top = ranked[0];
    const second = ranked[1];

    const isBalanced = top && second &&
      Math.abs(top.avgScore - second.avgScore) < 2 &&
      top.vectors === second.vectors;

    const primary: DayType = isBalanced ? 'BALANCED' : (PROP_TO_DAY_TYPE[top.key] || 'BALANCED');
    let secondary: DayType | null = null;
    if (!isBalanced && second && second.avgScore >= 15 && second.vectors >= 3) {
      secondary = PROP_TO_DAY_TYPE[second.key] || null;
    }

    const gap = top && second ? top.avgScore - second.avgScore : top?.avgScore || 0;
    const confidence = Math.min(95, Math.round(50 + gap * 2 + (top?.vectors || 0) * 2));

    const result: DayTypeSignal = {
      primary,
      secondary,
      confidence,
      propScores: Object.fromEntries(ranked.map(r => [r.key, { avgScore: Math.round(r.avgScore * 10) / 10, vectors: r.vectors, games: r.games }])),
    };

    console.log(`[Bot v2] 📊 Day Type: ${primary}${secondary ? ` + ${secondary}` : ''} (confidence ${confidence}%) — ${JSON.stringify(result.propScores)}`);
    return result;
  } catch (err) {
    console.warn(`[Bot v2] Day Type signal failed: ${err}`);
    return null;
  }
}

// Returns a composite score boost/penalty based on whether a pick's prop type aligns with today's matchup signal
function getDayTypeBoost(propType: string, daySignal: DayTypeSignal | null): number {
  if (!daySignal || daySignal.primary === 'BALANCED') return 0;
  const normalized = normalizePropType(propType);
  const primaryProps = DAY_TYPE_TO_PROP_TYPES[daySignal.primary] || [];
  const secondaryProps = daySignal.secondary ? (DAY_TYPE_TO_PROP_TYPES[daySignal.secondary] || []) : [];

  if (primaryProps.includes(normalized)) return 8;   // Matches dominant day type
  if (secondaryProps.includes(normalized)) return 4;  // Matches secondary day type
  // Penalize props that contradict the day type (but don't hard-block)
  return -5;
}

// Normalize prop type variants to canonical form to prevent split tracking
function normalizePropType(raw: string): string {
  const lower = (raw || '').toLowerCase().trim();
  const map: Record<string, string> = {
    'points': 'player_points', 'pts': 'player_points', 'player_points': 'player_points',
    'rebounds': 'player_rebounds', 'reb': 'player_rebounds', 'player_rebounds': 'player_rebounds',
    'assists': 'player_assists', 'ast': 'player_assists', 'player_assists': 'player_assists',
    'threes': 'player_threes', '3pm': 'player_threes', 'three_pointers': 'player_threes', 'player_threes': 'player_threes',
    'blocks': 'player_blocks', 'blk': 'player_blocks', 'player_blocks': 'player_blocks',
    'steals': 'player_steals', 'stl': 'player_steals', 'player_steals': 'player_steals',
    'turnovers': 'player_turnovers', 'to': 'player_turnovers', 'player_turnovers': 'player_turnovers',
  };
  return map[lower] || lower;
}

// ============= GAME CONTEXT + PLAYER MATCHUP SIGNALS =============
interface GameContextFlag {
  type: string; // 'revenge_game' | 'b2b_fatigue' | 'blowout_risk' | 'thin_slate'
  team?: string;
  home_team?: string;
  away_team?: string;
  boost?: number;
  penalty?: number;
}
interface PlayerMatchupGrade {
  overallGrade: string;
  overallScore: number;
  propEdgeType: string;
  recommendedSide: string;
}

let gameContextFlags: Map<string, GameContextFlag[]> = new Map();
let playerMatchupMap: Map<string, PlayerMatchupGrade> = new Map();

async function fetchGameContextFlags(supabase: any, gameDate: string): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('bot_research_findings')
      .select('key_insights')
      .eq('research_date', gameDate)
      .eq('category', 'game_context')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !data?.[0]?.key_insights) {
      console.log(`[Bot v2] 🎯 Game Context: No context flags for ${gameDate}`);
      return;
    }

    const insights = data[0].key_insights as any[];
    // Last entry is the JSON blob with all flags
    for (const insight of insights) {
      let parsed: any = null;
      if (typeof insight === 'string') {
        try { parsed = JSON.parse(insight); } catch { continue; }
      } else {
        parsed = insight;
      }
      if (parsed?.context_flags && Array.isArray(parsed.context_flags)) {
        for (const flag of parsed.context_flags) {
          const teams = [flag.team, flag.home_team, flag.away_team].filter(Boolean).map((t: string) => t.toLowerCase());
          for (const t of teams) {
            if (!gameContextFlags.has(t)) gameContextFlags.set(t, []);
            gameContextFlags.get(t)!.push(flag);
          }
        }
      }
    }

    const revenge = [...gameContextFlags.values()].flat().filter(f => f.type === 'revenge_game').length;
    const b2b = [...gameContextFlags.values()].flat().filter(f => f.type === 'b2b_fatigue').length;
    const blowout = [...gameContextFlags.values()].flat().filter(f => f.type === 'blowout_risk').length;
    console.log(`[Bot v2] 🎯 Game Context: ${revenge} revenge games, ${b2b} B2B fatigue, ${blowout} blowout risk`);
  } catch (err) {
    console.warn(`[Bot v2] Game context fetch failed: ${err}`);
  }
}

async function fetchPlayerMatchupGrades(supabase: any, gameDate: string): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('bot_research_findings')
      .select('key_insights')
      .eq('research_date', gameDate)
      .eq('category', 'matchup_defense_scan')
      .order('relevance_score', { ascending: false })
      .limit(1);

    if (error || !data?.[0]?.key_insights) {
      console.log(`[Bot v2] 🎯 Matchup Grades: No scan data for ${gameDate}`);
      return;
    }

    const insights = data[0].key_insights as any[];
    for (const insight of insights) {
      let parsed: any = null;
      if (typeof insight === 'string') {
        try { parsed = JSON.parse(insight); } catch { continue; }
      } else {
        parsed = insight;
      }
      // Look for player-level grade objects
      if (parsed?.playerName && parsed?.overallGrade) {
        playerMatchupMap.set(parsed.playerName.toLowerCase().trim(), {
          overallGrade: parsed.overallGrade,
          overallScore: parsed.overallScore || 0,
          propEdgeType: parsed.propEdgeType || 'none',
          recommendedSide: parsed.recommendedSide || 'pass',
        });
      }
      // Also handle arrays of players
      if (Array.isArray(parsed?.players)) {
        for (const p of parsed.players) {
          if (p.playerName && p.overallGrade) {
            playerMatchupMap.set(p.playerName.toLowerCase().trim(), {
              overallGrade: p.overallGrade,
              overallScore: p.overallScore || 0,
              propEdgeType: p.propEdgeType || 'none',
              recommendedSide: p.recommendedSide || 'pass',
            });
          }
        }
      }
    }

    const grades = [...playerMatchupMap.values()];
    const aPlus = grades.filter(g => g.overallGrade === 'A+' || g.overallGrade === 'A').length;
    const bPlus = grades.filter(g => g.overallGrade === 'B+' || g.overallGrade === 'B').length;
    const cOrD = grades.filter(g => g.overallGrade === 'C' || g.overallGrade === 'D').length;
    console.log(`[Bot v2] 🎯 Matchup Grades loaded: ${grades.length} players (${aPlus} A+/A, ${bPlus} B+/B, ${cOrD} C/D)`);
  } catch (err) {
    console.warn(`[Bot v2] Matchup grades fetch failed: ${err}`);
  }
}

function getMatchupContextBoost(playerName: string, teamName: string, propType: string): number {
  let boost = 0;
  const normalizedPlayer = (playerName || '').toLowerCase().trim();
  const normalizedTeam = (teamName || '').toLowerCase().trim();
  const normalizedProp = normalizePropType(propType);

  // Player matchup grade boost
  const grade = playerMatchupMap.get(normalizedPlayer);
  if (grade) {
    const gradeBoosts: Record<string, number> = {
      'A+': 10, 'A': 6, 'B+': 3, 'B': 0, 'C': -4, 'D': -4,
    };
    boost += gradeBoosts[grade.overallGrade] ?? 0;

    // Prop edge type alignment
    const edgeProps: Record<string, string[]> = {
      'points': ['player_points'],
      'threes': ['player_threes'],
      'both': ['player_points', 'player_threes'],
    };
    const alignedProps = edgeProps[grade.propEdgeType] || [];
    if (alignedProps.length > 0) {
      if (alignedProps.includes(normalizedProp)) {
        boost += 5; // Prop matches player's edge type
      } else {
        boost += -3; // Prop contradicts player's edge type
      }
    }
  }

  // Game context flags for this team
  const teamFlags = gameContextFlags.get(normalizedTeam) || [];
  for (const flag of teamFlags) {
    switch (flag.type) {
      case 'revenge_game': boost += 5; break;
      case 'b2b_fatigue': boost += -6; break;
      case 'blowout_risk': boost += -8; break;
    }
  }

  return boost;
}

function isBlowoutRiskGame(teamName: string): boolean {
  const flags = gameContextFlags.get((teamName || '').toLowerCase().trim()) || [];
  return flags.some(f => f.type === 'blowout_risk');
}

// ============= DYNAMIC WINNING ARCHETYPE DETECTION =============
const FALLBACK_ARCHETYPE_CATEGORIES = ['THREE_POINT_SHOOTER', 'BIG_REBOUNDER', 'HIGH_ASSIST'];

async function detectWinningArchetypes(supabase: any): Promise<{ categories: Set<string>; ranked: { category: string; winRate: number; appearances: number }[]; usedFallback: boolean }> {
  try {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    
    const { data: settledParlays, error } = await supabase
      .from('bot_daily_parlays')
      .select('outcome, legs')
      .gte('parlay_date', fourteenDaysAgo)
      .in('outcome', ['won', 'lost']);

    if (error || !settledParlays || settledParlays.length === 0) {
      console.log(`[Bot v2] Dynamic Archetypes: No settled data (${error?.message || 'empty'}), using fallback`);
      return { categories: new Set(FALLBACK_ARCHETYPE_CATEGORIES), ranked: [], usedFallback: true };
    }

    // Count wins/total per category+side at the parlay level
    const categoryStats = new Map<string, { wins: number; total: number }>();
    
    for (const parlay of settledParlays) {
      const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
      const isWin = parlay.outcome === 'won';
      const seenCategories = new Set<string>();
      
      for (const leg of legs) {
        const cat = (leg as any).category || '';
        if (!cat) continue;
        // Count each category once per parlay (parlay-level win rate)
        if (!seenCategories.has(cat)) {
          seenCategories.add(cat);
          const stats = categoryStats.get(cat) || { wins: 0, total: 0 };
          stats.total++;
          if (isWin) stats.wins++;
          categoryStats.set(cat, stats);
        }
      }
    }

    // Filter: min 8 appearances, >25% win rate, sort by win rate, cap at 6
    const ranked = Array.from(categoryStats.entries())
      .map(([category, stats]) => ({
        category,
        winRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
        appearances: stats.total,
      }))
      .filter(c => c.appearances >= 8 && c.winRate > 25)
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 6);

    if (ranked.length === 0) {
      console.log(`[Bot v2] Dynamic Archetypes: No categories met thresholds, using fallback`);
      return { categories: new Set(FALLBACK_ARCHETYPE_CATEGORIES), ranked: [], usedFallback: true };
    }

    const categories = new Set(ranked.map(r => r.category));
    const logStr = ranked.map(r => `${r.category} (${r.winRate.toFixed(1)}%, ${r.appearances} apps)`).join(', ');
    console.log(`[Bot v2] 🎯 Dynamic Archetypes: ${logStr} | Fallback: false`);

    return { categories, ranked, usedFallback: false };
  } catch (err) {
    console.log(`[Bot v2] Dynamic Archetypes error: ${err.message}, using fallback`);
    return { categories: new Set(FALLBACK_ARCHETYPE_CATEGORIES), ranked: [], usedFallback: true };
  }
}

// ============= DYNAMIC MISPRICED EDGE PROMOTION =============
async function detectWinningMispricedPatterns(supabase: any): Promise<{ sports: string[]; legCount: number; winRate: number; sampleSize: number }[]> {
  try {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    
    const { data: settledParlays, error } = await supabase
      .from('bot_daily_parlays')
      .select('outcome, legs, leg_count')
      .gte('parlay_date', fourteenDaysAgo)
      .eq('strategy_name', 'mispriced_edge')
      .in('outcome', ['won', 'lost']);

    if (error || !settledParlays || settledParlays.length === 0) {
      console.log(`[Bot v2] Mispriced Promotion: No settled mispriced_edge data (${error?.message || 'empty'})`);
      return [];
    }

    // Group by sport composition + leg count
    const patternStats = new Map<string, { wins: number; total: number; sports: string[]; legCount: number }>();
    
    for (const parlay of settledParlays) {
      const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
      const legCount = parlay.leg_count || legs.length;
      const isWin = parlay.outcome === 'won';
      
      // Extract unique sports from legs
      const sportSet = new Set<string>();
      for (const leg of legs) {
        const sport = (leg as any).sport_key || (leg as any).sport || '';
        if (sport) sportSet.add(sport);
      }
      const sports = Array.from(sportSet).sort();
      const sportKey = sports.length > 1 ? 'cross_sport' : (sports[0] || 'all');
      const patternKey = `${sportKey}|${legCount}`;
      
      const stats = patternStats.get(patternKey) || { wins: 0, total: 0, sports: sports.length > 0 ? sports : ['all'], legCount };
      stats.total++;
      if (isWin) stats.wins++;
      patternStats.set(patternKey, stats);
    }

    // Filter: >= 40% win rate, >= 5 appearances
    const winningPatterns = Array.from(patternStats.values())
      .map(stats => ({
        sports: stats.sports,
        legCount: stats.legCount,
        winRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
        sampleSize: stats.total,
      }))
      .filter(p => p.winRate >= 40 && p.sampleSize >= 5)
      .sort((a, b) => b.winRate - a.winRate);

    if (winningPatterns.length > 0) {
      const logStr = winningPatterns.map(p => `${p.sports.join('+')} ${p.legCount}L (${p.winRate.toFixed(1)}%, n=${p.sampleSize})`).join(', ');
      console.log(`[Bot v2] 🎯 Winning Mispriced Patterns: ${logStr}`);
    } else {
      console.log(`[Bot v2] Mispriced Promotion: No patterns met 40% WR / 5 sample threshold`);
    }

    return winningPatterns;
  } catch (err) {
    console.log(`[Bot v2] Mispriced Promotion error: ${err.message}`);
    return [];
  }
}

function autoPromoteToExecution(winningPatterns: { sports: string[]; legCount: number; winRate: number; sampleSize: number }[]): any[] {
  const promoted: any[] = [];
  const maxPromoted = 1; // Reduced from 4 to 1 — mispriced_edge has 0.5% ROI, limit auto-promotion

  for (const pattern of winningPatterns) {
    if (promoted.length >= maxPromoted) break;
    
    const sportsFilter = pattern.sports.length > 1 ? ['all'] : pattern.sports;
    
    // Create two profiles per pattern: one hit_rate sorted, one composite sorted
    promoted.push({
      legs: pattern.legCount,
      strategy: 'mispriced_edge_promoted',
      sports: sportsFilter,
      minHitRate: 60,
      sortBy: 'hit_rate',
      useAltLines: false,
    });
    console.log(`[Bot v2] ✅ Promoted mispriced_edge → execution: ${sportsFilter.join('+')} ${pattern.legCount}L (observed ${pattern.winRate.toFixed(1)}% WR, n=${pattern.sampleSize}) [hit_rate]`);

    if (promoted.length >= maxPromoted) break;

    promoted.push({
      legs: pattern.legCount,
      strategy: 'mispriced_edge_promoted',
      sports: sportsFilter,
      minHitRate: 60,
      sortBy: 'composite',
      useAltLines: false,
    });
    console.log(`[Bot v2] ✅ Promoted mispriced_edge → execution: ${sportsFilter.join('+')} ${pattern.legCount}L (observed ${pattern.winRate.toFixed(1)}% WR, n=${pattern.sampleSize}) [composite]`);
  }

  return promoted;
}

// ============= UNIFIED ENVIRONMENT SCORE ENGINE =============
// L10 strategy hit rate data (loaded at runtime)
let strategyHitRates = new Map<string, { winRate: number; total: number }>();
let strategyWeightMultipliers = new Map<string, number>();
let currentDayTypeSignal: DayTypeSignal | null = null;

async function fetchStrategyHitRates(supabase: any): Promise<void> {
  try {
    const { data: strategies } = await supabase
      .from('bot_strategies')
      .select('strategy_name, win_rate, times_used, times_won, is_active')
      .eq('is_active', true);

    if (!strategies || strategies.length === 0) {
      console.log(`[L10 Feed] No active strategies found`);
      return;
    }

    // Compute average win rate for relative weighting
    let totalWinRate = 0;
    let countWithData = 0;
    for (const s of strategies) {
      const wr = s.win_rate || 0;
      strategyHitRates.set(s.strategy_name, { winRate: wr, total: s.times_used || 0 });
      if (wr > 0 && s.times_used >= 5) {
        totalWinRate += wr;
        countWithData++;
      }
    }
    const avgWinRate = countWithData > 0 ? totalWinRate / countWithData : 35;

    // Compute weight multipliers relative to average
    for (const s of strategies) {
      const wr = s.win_rate || 0;
      if (s.times_used < 5 || wr === 0) {
        strategyWeightMultipliers.set(s.strategy_name, 1.0); // No data = neutral
        continue;
      }
      // Scale: 57% strategy at 35% avg = 1.63x; 13% strategy at 35% avg = 0.37x
      const multiplier = Math.max(0.2, Math.min(2.0, wr / avgWinRate));
      strategyWeightMultipliers.set(s.strategy_name, multiplier);
    }

    const logStr = strategies
      .filter((s: any) => s.win_rate > 0)
      .map((s: any) => `${s.strategy_name}:${s.win_rate}%→${(strategyWeightMultipliers.get(s.strategy_name) || 1).toFixed(2)}x`)
      .join(', ');
    console.log(`[L10 Feed] Strategy multipliers (avg=${avgWinRate.toFixed(1)}%): ${logStr}`);
  } catch (err) {
    console.warn(`[L10 Feed] Failed to load strategy hit rates: ${err}`);
  }
}

function getStrategyVolumeCap(strategy: string, defaultCap: number): number {
  // Extract base strategy name for lookup
  const base = strategy
    .replace(/_execution_.*$/, '')
    .replace(/_exploration.*$/, '')
    .replace(/_validation.*$/, '')
    .replace(/_bankroll_doubler.*$/, '');

  const rates = strategyHitRates.get(base);
  if (!rates || rates.total < 5) return defaultCap; // Not enough data

  if (rates.winRate < 15) {
    console.log(`[L10 Feed] 🚫 Strategy '${base}' at ${rates.winRate}% → hard cap 5`);
    return Math.min(defaultCap, 5);
  }
  if (rates.winRate < 25) {
    console.log(`[L10 Feed] ⚠️ Strategy '${base}' at ${rates.winRate}% → cap 10`);
    return Math.min(defaultCap, 10);
  }
  return defaultCap;
}

// ============= L10 COMPOSITE SCORE AMPLIFIER =============
function getStrategyCompositeBoost(strategy: string): number {
  const base = strategy
    .replace(/_execution_.*$/, '')
    .replace(/_exploration.*$/, '')
    .replace(/_validation.*$/, '')
    .replace(/_bankroll_doubler.*$/, '');

  const rates = strategyHitRates.get(base);
  if (!rates || rates.total < 5) return 0;

  if (rates.winRate > 55) return 15;
  if (rates.winRate > 45) return 8;
  if (rates.winRate < 25) return -15;
  return 0;
}

// ============= GOD MODE MATCHUP HARD-BLOCK =============
// Returns { pass: boolean, penalty: number } for bidirectional matchup check
function passesGodModeMatchup(
  pick: any,
  defenseDetailMap: Map<string, any>,
  tier: string
): { pass: boolean; penalty: number } {
  if (tier !== 'execution') return { pass: true, penalty: 0 };
  
  const side = (pick.recommended_side || pick.side || '').toLowerCase();
  const isOver = side === 'over';
  const isUnder = side === 'under';
  if (!isOver && !isUnder) return { pass: true, penalty: 0 };
  
  // Get opponent defense rank and team offense rank
  const oppDefRank = (pick as any).defenseMatchupRank ?? null;
  const teamOffRank = (pick as any).offenseMatchupRank ?? null;
  
  if (oppDefRank == null || teamOffRank == null) return { pass: true, penalty: 0 };

  // HARD BLOCK: OVER vs top-5 defense + weak offense (rank >= 25)
  if (isOver && oppDefRank <= 5 && teamOffRank >= 25) {
    console.log(`[GodModeMatchup] HARD BLOCK: ${pick.player_name || 'pick'} OVER vs top-${oppDefRank} defense + weak offense (rank ${teamOffRank})`);
    return { pass: false, penalty: -999 };
  }
  // HARD BLOCK: UNDER vs bottom-5 defense + strong offense (rank <= 5)
  if (isUnder && oppDefRank >= 25 && teamOffRank <= 5) {
    console.log(`[GodModeMatchup] HARD BLOCK: ${pick.player_name || 'pick'} UNDER vs weak defense (rank ${oppDefRank}) + strong offense (rank ${teamOffRank})`);
    return { pass: false, penalty: -999 };
  }

  // SLIDING PENALTY: borderline matchups
  let penalty = 0;
  if (isOver && oppDefRank <= 10 && teamOffRank >= 20) {
    penalty = -10;
  } else if (isUnder && oppDefRank >= 20 && teamOffRank <= 10) {
    penalty = -10;
  }
  
  return { pass: true, penalty };
}

// ============= MATCHUP-AWARE ALT LINE ADJUSTMENT SYSTEM =============
// Checks if a pick's matchup context warrants adjusting to a safer (downgrade) or higher-value (upgrade) line
function shouldAdjustLine(
  pick: any,
  defenseDetailMap: Map<string, any>,
  propType: string,
  side: string,
  currentLine: number,
  isGodMode: boolean = false
): { shouldAdjust: boolean; recommendedLine: number; reason: string; direction: 'downgrade' | 'upgrade' | 'none' } {
  const noAdjust = { shouldAdjust: false, recommendedLine: currentLine, reason: '', direction: 'none' as const };
  const isOver = side.toLowerCase() === 'over';
  const isUnder = side.toLowerCase() === 'under';
  if (!isOver && !isUnder) return noAdjust;

  // Get defense detail for opponent
  const oppTeam = (pick as any).opponent_team || (pick as any).oppTeamName || '';
  const oppDefDetail = defenseDetailMap.get(oppTeam) || defenseDetailMap.get(oppTeam.toLowerCase());
  
  const propLower = (propType || '').toLowerCase();
  let propSpecificDefRank: number | null = null;
  
  if (oppDefDetail) {
    if (propLower.includes('three') || propLower === '3pm' || propLower === 'threes') {
      propSpecificDefRank = oppDefDetail.opp_threes_rank ?? oppDefDetail.overall_rank ?? null;
    } else if (propLower.includes('point') || propLower === 'pts' || propLower === 'points') {
      propSpecificDefRank = oppDefDetail.opp_points_rank ?? oppDefDetail.overall_rank ?? null;
    } else if (propLower.includes('reb')) {
      propSpecificDefRank = oppDefDetail.opp_rebounds_rank ?? oppDefDetail.overall_rank ?? null;
    } else if (propLower.includes('ast') || propLower.includes('assist')) {
      propSpecificDefRank = oppDefDetail.opp_assists_rank ?? oppDefDetail.overall_rank ?? null;
    } else {
      propSpecificDefRank = oppDefDetail.overall_rank ?? null;
    }
  }
  
  if (propSpecificDefRank == null) {
    propSpecificDefRank = (pick as any).defenseMatchupRank ?? null;
  }
  
  if (propSpecificDefRank == null) return noAdjust;

  // Get player averages
  const projectedValue = pick.projected_value || pick.l10_avg || 0;
  const defAdjAvg = (pick as any).defense_adjusted_avg || projectedValue;
  
  // Stat-aware step sizes
  let stepSize = 1.0;
  if (propLower.includes('three') || propLower.includes('block') || propLower.includes('steal') || propLower === '3pm') {
    stepSize = 0.5;
  } else if (propLower.includes('pra') || propLower.includes('pts_rebs') || propLower.includes('pts_asts') || propLower.includes('rebs_asts')) {
    stepSize = 1.5;
  }

  // === DOWNGRADE CHECKS (existing logic - tough defense, tight margin) ===
  const defRankThreshold = isGodMode ? 15 : 10;
  const tightMarginThreshold = stepSize;
  
  if (isOver) {
    const marginFromLine = defAdjAvg - currentLine;
    const l10Margin = projectedValue - currentLine;
    
    if (propSpecificDefRank <= defRankThreshold && (marginFromLine <= tightMarginThreshold || l10Margin <= tightMarginThreshold * 2)) {
      const recommendedLine = currentLine - stepSize;
      const reason = `top_${propSpecificDefRank}_defense_tight_margin`;
      console.log(`[LineAdjust] DOWNGRADE ${pick.player_name} ${propType} OVER ${currentLine} -> ${recommendedLine} (OPP def rank ${propSpecificDefRank}, adj avg ${defAdjAvg.toFixed(1)}, l10 ${projectedValue.toFixed(1)})`);
      return { shouldAdjust: true, recommendedLine, reason, direction: 'downgrade' };
    }
  } else if (isUnder) {
    const marginFromLine = currentLine - defAdjAvg;
    const l10Margin = currentLine - projectedValue;
    
    if (propSpecificDefRank >= (30 - defRankThreshold) && (marginFromLine <= tightMarginThreshold || l10Margin <= tightMarginThreshold * 2)) {
      const recommendedLine = currentLine + stepSize;
      const reason = `weak_defense_rank_${propSpecificDefRank}_tight_margin`;
      console.log(`[LineAdjust] DOWNGRADE ${pick.player_name} ${propType} UNDER ${currentLine} -> ${recommendedLine} (OPP def rank ${propSpecificDefRank}, adj avg ${defAdjAvg.toFixed(1)}, l10 ${projectedValue.toFixed(1)})`);
      return { shouldAdjust: true, recommendedLine, reason, direction: 'downgrade' };
    }
  }

  // === UPGRADE CHECKS (new logic - weak defense, large buffer -> better odds) ===
  const upgradeDefRankThreshold = isGodMode ? 18 : 20; // rank >= this = weak defense
  const maxUpgradeSteps = 2; // safety cap: max 2 steps up
  
  if (isOver) {
    // OVER + weak defense = player should crush -> upgrade line for plus money
    const bufferFromLine = defAdjAvg - currentLine;
    const l10Buffer = projectedValue - currentLine;
    
    if (propSpecificDefRank >= upgradeDefRankThreshold && bufferFromLine > stepSize * 2 && l10Buffer > stepSize * 3) {
      // Calculate how many steps we can upgrade (capped at maxUpgradeSteps)
      const maxSteps = Math.min(Math.floor(bufferFromLine / stepSize) - 1, maxUpgradeSteps);
      if (maxSteps >= 1) {
        const recommendedLine = currentLine + (stepSize * maxSteps);
        const reason = `weak_defense_rank_${propSpecificDefRank}_large_buffer`;
        console.log(`[LineAdjust] UPGRADE ${pick.player_name} ${propType} OVER ${currentLine} -> ${recommendedLine} (OPP def rank ${propSpecificDefRank}, adj avg ${defAdjAvg.toFixed(1)}, l10 ${projectedValue.toFixed(1)}, buffer ${bufferFromLine.toFixed(1)})`);
        return { shouldAdjust: true, recommendedLine, reason, direction: 'upgrade' };
      }
    }
  } else if (isUnder) {
    // UNDER + elite defense = stats suppressed -> upgrade line (move up) for plus money
    const bufferFromLine = currentLine - defAdjAvg;
    const l10Buffer = currentLine - projectedValue;
    
    if (propSpecificDefRank <= (30 - upgradeDefRankThreshold) && bufferFromLine > stepSize * 2 && l10Buffer > stepSize * 3) {
      const maxSteps = Math.min(Math.floor(bufferFromLine / stepSize) - 1, maxUpgradeSteps);
      if (maxSteps >= 1) {
        const recommendedLine = currentLine - (stepSize * maxSteps);
        const reason = `elite_defense_rank_${propSpecificDefRank}_large_buffer`;
        console.log(`[LineAdjust] UPGRADE ${pick.player_name} ${propType} UNDER ${currentLine} -> ${recommendedLine} (OPP def rank ${propSpecificDefRank}, adj avg ${defAdjAvg.toFixed(1)}, l10 ${projectedValue.toFixed(1)}, buffer ${bufferFromLine.toFixed(1)})`);
        return { shouldAdjust: true, recommendedLine, reason, direction: 'upgrade' };
      }
    }
  }

  return noAdjust;
}

// Finds an available alt line from the pick's alternateLines or oddsMap (works for both upgrades and downgrades)
function findAvailableAltLine(
  pick: any,
  recommendedLine: number,
  side: string,
  oddsMap: Map<string, any>,
  playerProps: any[],
  direction: 'downgrade' | 'upgrade' = 'downgrade'
): { line: number; odds: number } | null {
  const isOver = side.toLowerCase() === 'over';
  const logTag = direction === 'upgrade' ? '[LineUpgrade]' : '[LineDowngrade]';
  
  // 1. Check pick's existing alternateLines array
  const altLines: AlternateLine[] = pick.alternateLines || [];
  for (const alt of altLines) {
    if (Math.abs(alt.line - recommendedLine) < 0.01) {
      const odds = isOver ? alt.overOdds : alt.underOdds;
      if (odds && odds !== 0) {
        console.log(`${logTag} Found alt line ${recommendedLine} in alternateLines (odds: ${odds})`);
        return { line: recommendedLine, odds };
      }
    }
  }

  // 2. Check unified_props for the same player + prop type at the recommended line
  const playerName = (pick.player_name || '').toLowerCase().trim();
  const propType = (pick.prop_type || '').toLowerCase();
  
  for (const prop of (playerProps || [])) {
    const pName = (prop.player_name || '').toLowerCase().trim();
    const pType = (prop.prop_type || '').toLowerCase();
    if (pName === playerName && pType === propType && Math.abs((prop.current_line || 0) - recommendedLine) < 0.01) {
      const odds = isOver ? (prop.over_price || -110) : (prop.under_price || -110);
      console.log(`${logTag} Found alt line ${recommendedLine} in unified_props (odds: ${odds})`);
      return { line: recommendedLine, odds };
    }
  }

  // 3. Check if any alt line exists between current and recommended (closest line in the right direction)
  const currentLine = pick.line || 0;
  const closestAlts = altLines
    .filter(alt => {
      if (direction === 'upgrade') {
        // For upgrades: look for lines ABOVE current, up to recommended
        return isOver ? (alt.line > currentLine && alt.line <= recommendedLine) : (alt.line < currentLine && alt.line >= recommendedLine);
      } else {
        // For downgrades: look for lines BELOW current, down to recommended
        return isOver ? (alt.line < currentLine && alt.line >= recommendedLine) : (alt.line > currentLine && alt.line <= recommendedLine);
      }
    })
    .sort((a, b) => {
      if (direction === 'upgrade') {
        return isOver ? (b.line - a.line) : (a.line - b.line); // highest first for over upgrades
      }
      return isOver ? (b.line - a.line) : (a.line - b.line); // closest to original first
    });
  
  if (closestAlts.length > 0) {
    const best = closestAlts[0];
    const odds = isOver ? best.overOdds : best.underOdds;
    if (odds && odds !== 0) {
      console.log(`${logTag} Found closest alt line ${best.line} (target was ${recommendedLine}, odds: ${odds})`);
      return { line: best.line, odds };
    }
  }

  console.log(`${logTag} No alt line found for ${pick.player_name} ${propType} at ${recommendedLine} - keeping original`);
  return null;
}

function calculateEnvironmentScore(
  paceRating: number | null,
  oppDefenseRank: number | null,
  blowoutProbability: number | null,
  propType: string,
  side: 'over' | 'under' | string,
  oppRebRank?: number | null,
  oppAstRank?: number | null,
  oppPointsRank?: number | null,
  oppThreesRank?: number | null,
  // NEW: Offensive rank parameters for bidirectional matchup scoring
  teamOffPointsRank?: number | null,
  teamOffReboundsRank?: number | null,
  teamOffAssistsRank?: number | null,
  teamOffThreesRank?: number | null,
  teamOffPaceRank?: number | null
): { envScore: number; confidenceAdjustment: number; components: { pace: number; matchup: number; rebAst: number; blowout: number } } {
  const isOver = side.toLowerCase() === 'over';
  const propLower = propType.toLowerCase();

  // 1. Pace Factor (0-1): normalize pace 94-106 range
  let paceFactor = 0.5;
  if (paceRating != null) {
    paceFactor = Math.max(0, Math.min(1, (paceRating - 94) / 12));
    if (!isOver) paceFactor = 1 - paceFactor;
  }

  // 2. Prop-Specific Defense (0-1): route to the RIGHT rank for each prop type
  let effectiveDefRank = oppDefenseRank; // fallback to overall
  let effectiveOffRank: number | null = null; // team's offensive rank for this prop type

  if (propLower.includes('three') || propLower === '3pm' || propLower === 'threes') {
    effectiveDefRank = oppThreesRank ?? oppDefenseRank;
    effectiveOffRank = teamOffThreesRank ?? null;
  } else if (propLower.includes('point') || propLower === 'pts' || propLower === 'points') {
    effectiveDefRank = oppPointsRank ?? oppDefenseRank;
    effectiveOffRank = teamOffPointsRank ?? null;
  } else if (propLower.includes('reb')) {
    effectiveDefRank = oppRebRank ?? oppDefenseRank;
    effectiveOffRank = teamOffReboundsRank ?? null;
  } else if (propLower.includes('ast') || propLower.includes('assist')) {
    effectiveDefRank = oppAstRank ?? oppDefenseRank;
    effectiveOffRank = teamOffAssistsRank ?? null;
  } else if (propLower === 'pra' || propLower.includes('pts_rebs_asts')) {
    const ptsR = oppPointsRank ?? oppDefenseRank ?? 15;
    const rebR = oppRebRank ?? oppDefenseRank ?? 15;
    const astR = oppAstRank ?? oppDefenseRank ?? 15;
    effectiveDefRank = Math.round((ptsR * 0.5 + rebR * 0.25 + astR * 0.25));
    // Weighted average offensive ranks for combo
    const offPts = teamOffPointsRank ?? 15;
    const offReb = teamOffReboundsRank ?? 15;
    const offAst = teamOffAssistsRank ?? 15;
    effectiveOffRank = Math.round((offPts * 0.5 + offReb * 0.25 + offAst * 0.25));
  } else if (propLower === 'pr' || propLower.includes('pts_rebs')) {
    const ptsR = oppPointsRank ?? oppDefenseRank ?? 15;
    const rebR = oppRebRank ?? oppDefenseRank ?? 15;
    effectiveDefRank = Math.round((ptsR * 0.6 + rebR * 0.4));
    effectiveOffRank = Math.round(((teamOffPointsRank ?? 15) * 0.6 + (teamOffReboundsRank ?? 15) * 0.4));
  } else if (propLower === 'pa' || propLower.includes('pts_asts')) {
    const ptsR = oppPointsRank ?? oppDefenseRank ?? 15;
    const astR = oppAstRank ?? oppDefenseRank ?? 15;
    effectiveDefRank = Math.round((ptsR * 0.6 + astR * 0.4));
    effectiveOffRank = Math.round(((teamOffPointsRank ?? 15) * 0.6 + (teamOffAssistsRank ?? 15) * 0.4));
  } else if (propLower === 'ra' || propLower.includes('rebs_asts')) {
    const rebR = oppRebRank ?? oppDefenseRank ?? 15;
    const astR = oppAstRank ?? oppDefenseRank ?? 15;
    effectiveDefRank = Math.round((rebR * 0.5 + astR * 0.5));
    effectiveOffRank = Math.round(((teamOffReboundsRank ?? 15) * 0.5 + (teamOffAssistsRank ?? 15) * 0.5));
  }

  // BIDIRECTIONAL MATCHUP SCORING: combine defense weakness + offensive strength
  let matchupFactor = 0.5;
  if (effectiveDefRank != null) {
    const defFactor = (effectiveDefRank - 1) / 29; // 1=tough(0.0), 30=soft(1.0)
    if (effectiveOffRank != null) {
      // For OVER: want weak defense (high rank=1.0) + strong offense (low rank → invert: 1-(rank-1)/29)
      const offFactor = 1 - (effectiveOffRank - 1) / 29; // 1=strong(1.0), 30=weak(0.0)
      matchupFactor = defFactor * 0.6 + offFactor * 0.4;
    } else {
      matchupFactor = defFactor; // fallback to defense-only
    }
    if (!isOver) matchupFactor = 1 - matchupFactor;
  }

  // 3. Reb/Ast Environment (0-1)
  let rebAstFactor = 0.5;
  if (propLower.includes('reb') && oppRebRank != null) {
    rebAstFactor = (oppRebRank - 1) / 29;
    if (!isOver) rebAstFactor = 1 - rebAstFactor;
  } else if (propLower.includes('ast') && oppAstRank != null) {
    rebAstFactor = (oppAstRank - 1) / 29;
    if (!isOver) rebAstFactor = 1 - rebAstFactor;
  } else if ((propLower.includes('pra') || (propLower.includes('pts') && propLower.includes('reb')) || (propLower.includes('pts') && propLower.includes('ast'))) && oppRebRank != null && oppAstRank != null) {
    const rebVal = (oppRebRank - 1) / 29;
    const astVal = (oppAstRank - 1) / 29;
    rebAstFactor = (rebVal + astVal) / 2;
    if (!isOver) rebAstFactor = 1 - rebAstFactor;
  }

  // 4. Blowout Risk (0-1): directly from game_environment
  const blowoutFactor = Math.max(0, Math.min(1, blowoutProbability ?? 0));

  // Updated composite: pace(0.25) + matchup(0.35) + rebAst(0.2) + blowout(-0.2)
  const envScore = (paceFactor * 0.25) + (matchupFactor * 0.35) + (rebAstFactor * 0.2) + (blowoutFactor * -0.2);

  // Scale to confidence adjustment: -20 to +20
  const raw = Math.round((envScore - 0.3) * 50);
  const confidenceAdjustment = Math.max(-20, Math.min(20, raw));

  return {
    envScore,
    confidenceAdjustment,
    components: { pace: paceFactor, matchup: matchupFactor, rebAst: rebAstFactor, blowout: blowoutFactor },
  };
}

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
  sortBy?: 'composite' | 'hit_rate' | 'shuffle' | 'env_cluster_shootout' | 'env_cluster_grind' | 'l3_score' | 'combined_l3_matchup' | 'combined';
  side?: 'over' | 'under';
  boostLegs?: number;
  allowTeamLegs?: number;
  maxMlLegs?: number;
  preferCategories?: string[];
  contrarian?: boolean; // When true, flip the recommended_side from sweet spots
  maxCategoryUsage?: number;
  gameFilter?: 'blowout'; // When set, restrict to games matching this filter
}

const TIER_CONFIG: Record<TierName, TierConfig> = {
  exploration: {
    count: 150,
    iterations: 2000,
    maxPlayerUsage: 5,
    maxTeamUsage: 3,
    maxCategoryUsage: 6,
    minHitRate: 45,
    minEdge: 0.003,
    minSharpe: 0.01,
    stake: 100,
    minConfidence: 0.60, // RAISED from 0.45 → 0.60 (legs with 0.55-0.65 confidence hit at 47% — coin flip)
    profiles: [
      // ============= OPTIMAL COMBO EXPLORATION (CAPPED: max 5/day, thresholds raised) =============
      { legs: 3, strategy: 'optimal_combo', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'hit_rate' },
      // KILLED: 4-leg optimal_combo exploration (7% win rate Mar 15-27)
      // { legs: 4, strategy: 'optimal_combo', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'optimal_combo', sports: ['all'], minHitRate: 65, sortBy: 'hit_rate' },
      // ============= FLOOR LOCK EXPLORATION (PRIORITY — processed first to avoid timeout) =============
      { legs: 3, strategy: 'floor_lock', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'floor_lock', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'composite' },
      { legs: 3, strategy: 'floor_lock', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'shuffle' },
      { legs: 3, strategy: 'floor_lock', sports: ['all'], minHitRate: 60, sortBy: 'hit_rate' },
      // ============= SWEET SPOT L3: KILLED 4-leg exploration (7% win rate on 4-leggers Mar 15-27) =============
      // { legs: 4, strategy: 'sweet_spot_l3', sports: ['all'], minHitRate: 50, sortBy: 'l3_score' },
      // { legs: 4, strategy: 'sweet_spot_l3', sports: ['icehockey_nhl'], minHitRate: 50, sortBy: 'l3_score' },
      // { legs: 4, strategy: 'sweet_spot_l3', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'l3_score' },
      // ============= L3 + MATCHUP COMBO: KILLED 4-leg exploration =============
      // { legs: 4, strategy: 'l3_matchup_combo', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'combined_l3_matchup' },
      // { legs: 4, strategy: 'l3_matchup_combo', sports: ['basketball_nba'], minHitRate: 50, sortBy: 'combined_l3_matchup' },
      // ============= L3 SWEET + MISPRICED HYBRID: KILLED 4-leg exploration =============
      // { legs: 4, strategy: 'l3_sweet_mispriced_hybrid', sports: ['basketball_nba'], minHitRate: 50, sortBy: 'combined' },
      // { legs: 4, strategy: 'l3_sweet_mispriced_hybrid', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'combined' },
      // ============= CEILING SHOT EXPLORATION (PRIORITY — processed first to avoid timeout) =============
      { legs: 3, strategy: 'ceiling_shot', sports: ['basketball_nba'], minHitRate: 45, sortBy: 'composite', useAltLines: true, preferPlusMoney: true },
      { legs: 3, strategy: 'ceiling_shot', sports: ['basketball_nba'], minHitRate: 45, sortBy: 'shuffle', useAltLines: true, preferPlusMoney: true },
      { legs: 3, strategy: 'ceiling_shot', sports: ['all'], minHitRate: 45, sortBy: 'composite', useAltLines: true, preferPlusMoney: true },
      { legs: 3, strategy: 'ceiling_shot', sports: ['all'], minHitRate: 45, sortBy: 'shuffle', useAltLines: true, preferPlusMoney: true },
      // Multi-sport exploration — capped at 4 legs max
      // VERIFIED-SOURCE EXPLORATION: mispriced_edge REDUCED (0.5% ROI) + double_confirmed_conviction
      // PAUSED: mispriced_edge NBA composite — { legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'composite' },
      // PAUSED: mispriced_edge NBA hit_rate — { legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['baseball_mlb'], minHitRate: 55, sortBy: 'composite' },
      // PAUSED: mispriced_edge NHL — { legs: 3, strategy: 'mispriced_edge', sports: ['icehockey_nhl'], minHitRate: 55, sortBy: 'composite' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['all'], minHitRate: 55, sortBy: 'composite' },
      // REDIRECTED: 3 mispriced_edge slots → cross_sport_4 + double_confirmed_conviction
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'], minHitRate: 50, sortBy: 'composite' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'composite' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 55, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 55, sortBy: 'composite' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 55, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'composite' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'hit_rate' },
      // Triple-confirmed: sweet spot + mispriced + risk engine agreement
      { legs: 3, strategy: 'triple_confirmed_conviction', sports: ['all'], minHitRate: 60, sortBy: 'composite' },
      // Multi-engine consensus: 3+ engines agree on same pick
      { legs: 3, strategy: 'multi_engine_consensus', sports: ['all'], minHitRate: 55, sortBy: 'composite' },
      // NCAAB exploration — UNDERS ONLY (70.6% hit rate confirmed, overs/spreads blocked)
      { legs: 3, strategy: 'ncaab_accuracy', sports: ['basketball_ncaab'], betTypes: ['total'], side: 'under', minHitRate: 60, sortBy: 'hit_rate', maxCategoryUsage: 3 },
      { legs: 3, strategy: 'ncaab_unders_probe', sports: ['basketball_ncaab'], betTypes: ['total'], side: 'under', minHitRate: 58, sortBy: 'composite', maxCategoryUsage: 3 },
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
      // cross_sport_4 PROMOTED TO EXECUTION (8-0 record, $3,930 profit) — 2 exploration feeders kept below
      { legs: 3, strategy: 'tennis_focus', sports: ['tennis_atp', 'tennis_wta', 'tennis_pingpong'] },
      { legs: 3, strategy: 'tennis_focus', sports: ['tennis_atp', 'tennis_wta', 'tennis_pingpong'] },
      // Table tennis exploration — OVER TOTALS ONLY
      { legs: 3, strategy: 'table_tennis_focus', sports: ['tennis_pingpong'], betTypes: ['total'], side: 'over' },
      { legs: 3, strategy: 'table_tennis_focus', sports: ['tennis_pingpong'], betTypes: ['total'], side: 'over' },
      // Nighttime mixed (reduced from 2 to 1)
      { legs: 4, strategy: 'nighttime_mixed', sports: ['tennis_atp', 'tennis_wta', 'tennis_pingpong', 'icehockey_nhl'] },
      { legs: 4, strategy: 'nhl_focus', sports: ['icehockey_nhl'] },
      { legs: 4, strategy: 'nhl_focus', sports: ['icehockey_nhl'] },
      // Max diversity (reduced from 5 to 2)
      { legs: 4, strategy: 'max_diversity', sports: ['all'] },
      { legs: 4, strategy: 'max_diversity', sports: ['all'] },
      { legs: 3, strategy: 'props_only', sports: ['basketball_nba'] },
      { legs: 3, strategy: 'props_only', sports: ['icehockey_nhl'] },
      // Props mixed (reduced from 3 to 1)
      { legs: 4, strategy: 'props_mixed', sports: ['basketball_nba', 'icehockey_nhl'] },
      // Whale signal exploration (3-leg only — 2-leg permanently removed)
      { legs: 3, strategy: 'whale_signal', sports: ['all'] },
      // Mispriced edge parlays — BOOSTED: doubled allocation based on 61.8% win rate + $17.9k profit
      { legs: 3, strategy: 'mispriced_edge', sports: ['all'] },
      { legs: 4, strategy: 'mispriced_edge', sports: ['all'] },
      // NEW mispriced_edge profiles (8 added — proven optimal 3-leg structure)
      { legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba'], minHitRate: 52, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['icehockey_nhl'], minHitRate: 52, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['all'], minHitRate: 50, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['all'], minHitRate: 50, sortBy: 'composite' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'composite' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba', 'icehockey_nhl'], minHitRate: 52, sortBy: 'composite' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['all'], minHitRate: 55, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['basketball_ncaab'], minHitRate: 52, sortBy: 'composite' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba'] },
      { legs: 3, strategy: 'mispriced_edge', sports: ['baseball_mlb'] },
      { legs: 3, strategy: 'mispriced_edge', sports: ['baseball_mlb'], minHitRate: 52, sortBy: 'hit_rate' },
      // Double-confirmed: sweet spot hit rate 70%+ AND mispriced edge 15%+
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'] },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'] },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba', 'baseball_mlb'], minHitRate: 55 },
      // WINNING ARCHETYPE: 3PT — REDUCED from 3 to 1 (3PM overs underperforming)
      { legs: 3, strategy: 'winning_archetype_3pt_scorer', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'hit_rate', preferCategories: ['THREE_POINT_SHOOTER'] },
      // WINNING ARCHETYPE: REBOUNDER + ASSISTS combo
      { legs: 3, strategy: 'winning_archetype_reb_ast', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'composite', preferCategories: ['BIG_REBOUNDER', 'HIGH_ASSIST'] },
      { legs: 3, strategy: 'winning_archetype_reb_ast', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'hit_rate', preferCategories: ['BIG_REBOUNDER', 'HIGH_ASSIST'] },
      { legs: 3, strategy: 'winning_archetype_reb_ast', sports: ['basketball_nba'], minHitRate: 52, sortBy: 'composite', preferCategories: ['BIG_REBOUNDER', 'HIGH_ASSIST'] },
       // NCAAB accuracy profiles — REMOVED (deduplicated above, kept 2 conservative ones only)
      // === SHUFFLE VARIATION PROFILES (break deterministic selection) ===
      { legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'shuffle' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba'], minHitRate: 52, sortBy: 'shuffle' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['icehockey_nhl'], minHitRate: 55, sortBy: 'shuffle' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['all'], minHitRate: 52, sortBy: 'shuffle' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['all'], minHitRate: 50, sortBy: 'shuffle' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba'], minHitRate: 50, sortBy: 'shuffle' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba', 'icehockey_nhl'], minHitRate: 52, sortBy: 'shuffle' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['basketball_ncaab'], minHitRate: 52, sortBy: 'shuffle' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['all'], minHitRate: 55, sortBy: 'shuffle' },
      { legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba'], minHitRate: 58, sortBy: 'shuffle' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 55, sortBy: 'shuffle' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'shuffle' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 52, sortBy: 'shuffle' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 52, sortBy: 'shuffle' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba', 'icehockey_nhl'], minHitRate: 52, sortBy: 'shuffle' },
      { legs: 3, strategy: 'cross_sport', sports: ['basketball_nba', 'icehockey_nhl'], sortBy: 'shuffle' },
      { legs: 3, strategy: 'cross_sport', sports: ['basketball_nba', 'basketball_ncaab'], sortBy: 'shuffle' },
      { legs: 3, strategy: 'cross_sport', sports: ['basketball_ncaab', 'icehockey_nhl'], sortBy: 'shuffle' },
      // cross_sport_4 EXPLORATION FEEDERS (discover new combos for execution graduation)
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'], minHitRate: 45, sortBy: 'shuffle' },
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'], minHitRate: 45, sortBy: 'composite' },
      // === MATCHUP-FIRST EXPLORATION: all legs attack weak defenses (rank 20+) ===
      { legs: 3, strategy: 'matchup_exploit', sports: ['basketball_nba'], minHitRate: 45, sortBy: 'composite', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      { legs: 3, strategy: 'matchup_exploit', sports: ['basketball_nba'], minHitRate: 45, sortBy: 'hit_rate', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      { legs: 3, strategy: 'matchup_exploit', sports: ['basketball_nba'], minHitRate: 45, sortBy: 'shuffle', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      { legs: 3, strategy: 'matchup_exploit', sports: ['basketball_nba'], minHitRate: 50, sortBy: 'composite', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      { legs: 3, strategy: 'matchup_exploit', sports: ['basketball_nba'], minHitRate: 50, sortBy: 'shuffle', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      { legs: 3, strategy: 'matchup_exploit', sports: ['basketball_nba'], minHitRate: 48, sortBy: 'hit_rate', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      { legs: 4, strategy: 'matchup_exploit', sports: ['basketball_nba'], minHitRate: 42, sortBy: 'composite', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      { legs: 4, strategy: 'matchup_exploit', sports: ['basketball_nba'], minHitRate: 42, sortBy: 'shuffle', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      { legs: 4, strategy: 'matchup_exploit', sports: ['basketball_nba'], minHitRate: 45, sortBy: 'composite', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      { legs: 4, strategy: 'matchup_exploit', sports: ['basketball_nba'], minHitRate: 45, sortBy: 'shuffle', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      // === SAME-TEAM STACKING: 3 players from same team vs soft defense ===
      { legs: 3, strategy: 'matchup_team_stack', sports: ['basketball_nba'], minHitRate: 42, sortBy: 'composite', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.3 },
      { legs: 3, strategy: 'matchup_team_stack', sports: ['basketball_nba'], minHitRate: 42, sortBy: 'hit_rate', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.3 },
      { legs: 3, strategy: 'matchup_team_stack', sports: ['basketball_nba'], minHitRate: 42, sortBy: 'shuffle', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.3 },
      { legs: 3, strategy: 'matchup_team_stack', sports: ['basketball_nba'], minHitRate: 48, sortBy: 'composite', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.3 },
      { legs: 3, strategy: 'matchup_team_stack', sports: ['basketball_nba'], minHitRate: 48, sortBy: 'shuffle', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.3 },
      { legs: 3, strategy: 'matchup_team_stack', sports: ['basketball_nba'], minHitRate: 48, sortBy: 'hit_rate', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.3 },
      // === MISPRICED + MATCHUP COMBO: mispriced edge AND defense rank 20+ ===
      { legs: 3, strategy: 'matchup_mispriced', sports: ['basketball_nba'], minHitRate: 50, sortBy: 'composite', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      { legs: 3, strategy: 'matchup_mispriced', sports: ['basketball_nba'], minHitRate: 50, sortBy: 'shuffle', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      { legs: 3, strategy: 'matchup_mispriced', sports: ['basketball_nba'], minHitRate: 50, sortBy: 'composite', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      { legs: 3, strategy: 'matchup_mispriced', sports: ['basketball_nba'], minHitRate: 50, sortBy: 'shuffle', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      // ============= GRIND UNDER EXPLORATION: NBA under plays =============
      { legs: 3, strategy: 'grind_under_core', sports: ['basketball_nba'], minHitRate: 48, sortBy: 'hit_rate', side: 'under' },
      { legs: 3, strategy: 'grind_under_core', sports: ['basketball_nba'], minHitRate: 48, sortBy: 'composite', side: 'under' },
      { legs: 3, strategy: 'grind_under_core', sports: ['basketball_nba'], minHitRate: 45, sortBy: 'env_cluster_grind', side: 'under' },
      { legs: 3, strategy: 'grind_under_core', sports: ['basketball_nba'], minHitRate: 45, sortBy: 'shuffle', side: 'under' },
      { legs: 3, strategy: 'grind_under_core', sports: ['all'], minHitRate: 45, sortBy: 'hit_rate', side: 'under' },
      { legs: 3, strategy: 'grind_under_core', sports: ['all'], minHitRate: 45, sortBy: 'shuffle', side: 'under' },
      // ============= SWEET SPOT PLUS: 4-leg (moved from execution — better fit for exploration risk) =============
      { legs: 4, strategy: 'sweet_spot_plus', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'hit_rate' },
      { legs: 4, strategy: 'sweet_spot_plus', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'composite' },
      { legs: 4, strategy: 'sweet_spot_plus', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'shuffle' },
      { legs: 4, strategy: 'sweet_spot_plus', sports: ['all'], minHitRate: 55, sortBy: 'hit_rate' },
      { legs: 4, strategy: 'sweet_spot_plus', sports: ['all'], minHitRate: 55, sortBy: 'composite' },
      { legs: 4, strategy: 'sweet_spot_plus', sports: ['all'], minHitRate: 55, sortBy: 'shuffle' },
      // ============= ROLE-STACKED 5/8-LEG: REMOVED (0% historical win rate on 5+ leggers — March 12 analysis) =============
      // (floor_lock + ceiling_shot moved to TOP of exploration profiles to avoid timeout)
      // ============= CONTRARIAN PROFILES: flip side for scenario diversity =============
      { legs: 3, strategy: 'contrarian_flip', sports: ['basketball_nba'], minHitRate: 40, sortBy: 'hit_rate', contrarian: true },
      { legs: 3, strategy: 'contrarian_flip', sports: ['basketball_nba'], minHitRate: 40, sortBy: 'shuffle', contrarian: true },
      { legs: 3, strategy: 'contrarian_flip', sports: ['all'], minHitRate: 40, sortBy: 'hit_rate', contrarian: true },
      { legs: 3, strategy: 'contrarian_flip', sports: ['all'], minHitRate: 40, sortBy: 'composite', contrarian: true },
      { legs: 4, strategy: 'contrarian_flip', sports: ['basketball_nba'], minHitRate: 38, sortBy: 'shuffle', contrarian: true },
      // ============= BLOWOUT SCRIPT: underdog starters PRA unders + bench minutes plays =============
      { legs: 3, strategy: 'blowout_script', sports: ['basketball_nba'], minHitRate: 45, sortBy: 'hit_rate', gameFilter: 'blowout' },
      { legs: 3, strategy: 'blowout_script', sports: ['basketball_nba'], minHitRate: 45, sortBy: 'shuffle', gameFilter: 'blowout' },
      { legs: 4, strategy: 'blowout_script', sports: ['basketball_nba'], minHitRate: 42, sortBy: 'hit_rate', gameFilter: 'blowout' },
      { legs: 3, strategy: 'blowout_script', sports: ['basketball_nba'], minHitRate: 48, sortBy: 'composite', gameFilter: 'blowout' },
    ],
  },
  validation: {
    count: 50,
    iterations: 10000,
    maxPlayerUsage: 5,
    maxTeamUsage: 2,
    maxCategoryUsage: 3,
    minHitRate: 52,
    minEdge: 0.008,
    minSharpe: 0.02,
    stake: 100,
    minConfidence: 0.52,
    profiles: [
      // ALL 3-LEG: Validated tier capped at 3 legs for win rate optimization
      // DISABLED: validated_conservative (0% win rate) — replaced with top performers
      { legs: 3, strategy: 'cross_sport_4', sports: ['all'], minHitRate: 50, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'cross_sport_4', sports: ['all'], minHitRate: 50, sortBy: 'composite' },
      // NCAAB validation — UNDERS ONLY (70.6% hit rate, spreads/overs remain blocked)
      { legs: 3, strategy: 'validated_ncaab_unders', sports: ['basketball_ncaab'], betTypes: ['total'], side: 'under', minOddsValue: 45, minHitRate: 62, maxCategoryUsage: 3 },
      // { legs: 3, strategy: 'validated_baseball_totals', sports: ['baseball_ncaa'], betTypes: ['total'], minOddsValue: 45, minHitRate: 55 }, // PAUSED
      { legs: 3, strategy: 'validated_balanced', sports: ['basketball_nba'], minOddsValue: 42, minHitRate: 55 },
      { legs: 3, strategy: 'validated_balanced', sports: ['basketball_nba', 'icehockey_nhl'], minOddsValue: 42, minHitRate: 55 },
      { legs: 3, strategy: 'validated_balanced', sports: ['basketball_nba', 'basketball_ncaab'], minOddsValue: 42, minHitRate: 55 },
      // REPLACED: 3 validated_standard with double_confirmed_conviction for verified-source coverage
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 55, sortBy: 'composite' },
      // Triple-confirmed validation
      { legs: 3, strategy: 'triple_confirmed_conviction', sports: ['all'], minHitRate: 65, sortBy: 'composite' },
      // Multi-engine consensus validation
      { legs: 3, strategy: 'multi_engine_consensus', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'composite' },
      // WINNING ARCHETYPE VALIDATION: 3PT — REDUCED from 2 to 1
      { legs: 3, strategy: 'winning_archetype_3pt_scorer', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', preferCategories: ['THREE_POINT_SHOOTER'] },
      // WINNING ARCHETYPE VALIDATION: REBOUNDER + ASSISTS
      { legs: 3, strategy: 'winning_archetype_reb_ast', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'composite', preferCategories: ['BIG_REBOUNDER', 'HIGH_ASSIST'] },
      { legs: 3, strategy: 'winning_archetype_reb_ast', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', preferCategories: ['BIG_REBOUNDER', 'HIGH_ASSIST'] },
      { legs: 3, strategy: 'validated_team', betTypes: ['spread', 'total'], minOddsValue: 45, minHitRate: 55 },
      { legs: 3, strategy: 'validated_team', betTypes: ['spread', 'total'], minOddsValue: 45, minHitRate: 55 },
      { legs: 3, strategy: 'validated_team', betTypes: ['spread', 'total'], minOddsValue: 42, minHitRate: 55 },
      { legs: 3, strategy: 'validated_cross', sports: ['all'], minOddsValue: 42, minHitRate: 55 },
      // Mispriced edge — validated tier (REDUCED: 0.5% ROI, kept 2 of 8)
      { legs: 3, strategy: 'mispriced_edge', sports: ['all'], minHitRate: 58 },
      // PAUSED: mispriced_edge 4-leg — { legs: 4, strategy: 'mispriced_edge', sports: ['basketball_nba'], minHitRate: 52 },
      // REDIRECTED: 6 mispriced_edge validation slots → cross_sport_4 + double_confirmed_conviction
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'], minHitRate: 52, sortBy: 'hit_rate' },
      { legs: 4, strategy: 'cross_sport_4', sports: ['basketball_nba', 'icehockey_nhl'], minHitRate: 52, sortBy: 'composite' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 62, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 58, sortBy: 'composite' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'shuffle' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 62, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'validated_tennis', sports: ['tennis_atp', 'tennis_wta', 'tennis_pingpong'], betTypes: ['moneyline', 'total'], minOddsValue: 45, minHitRate: 52 },
      { legs: 3, strategy: 'validated_nighttime', sports: ['tennis_atp', 'tennis_wta', 'tennis_pingpong', 'icehockey_nhl'], betTypes: ['moneyline', 'total', 'spread'], minOddsValue: 42, minHitRate: 52 },
      { legs: 3, strategy: 'validated_winrate', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'validated_winrate', sports: ['basketball_nba'], minHitRate: 58, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'proving_cash', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
      { legs: 3, strategy: 'proving_cash', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
      { legs: 3, strategy: 'proving_boosted', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: true, boostLegs: 2, minBufferMultiplier: 1.5 },
      { legs: 3, strategy: 'proving_boost', sports: ['all'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: true, boostLegs: 2, preferPlusMoney: true, minBufferMultiplier: 1.2 },
      // === SHUFFLE VARIATION PROFILES (break deterministic selection) ===
      // DISABLED: validated_conservative shuffle variants — replaced with top performers
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 55, sortBy: 'shuffle' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'shuffle' },
      { legs: 3, strategy: 'validated_balanced', sports: ['basketball_nba'], minOddsValue: 42, minHitRate: 55, sortBy: 'shuffle' },
      { legs: 3, strategy: 'validated_balanced', sports: ['basketball_nba'], minOddsValue: 42, minHitRate: 55, sortBy: 'shuffle' },
      { legs: 3, strategy: 'validated_balanced', sports: ['basketball_nba', 'icehockey_nhl'], minOddsValue: 42, minHitRate: 55, sortBy: 'shuffle' },
      { legs: 3, strategy: 'validated_balanced', sports: ['basketball_nba', 'basketball_ncaab'], minOddsValue: 42, minHitRate: 55, sortBy: 'shuffle' },
      { legs: 3, strategy: 'validated_balanced', sports: ['all'], minOddsValue: 42, minHitRate: 55, sortBy: 'shuffle' },
      // PAUSED: mispriced_edge shuffle variants (0.5% ROI) — redirected to high-ROI strategies
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 58, sortBy: 'shuffle' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 62, sortBy: 'shuffle' },
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'], minHitRate: 52, sortBy: 'shuffle' },
      { legs: 4, strategy: 'cross_sport_4', sports: ['basketball_nba', 'basketball_ncaab'], minHitRate: 52, sortBy: 'shuffle' },
      // WINNING ARCHETYPE shuffle — 3PT REDUCED from 2 to 0, kept reb_ast
      { legs: 3, strategy: 'winning_archetype_reb_ast', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'shuffle', preferCategories: ['BIG_REBOUNDER', 'HIGH_ASSIST'] },
      // GRIND UNDER VALIDATION: NBA under plays
      { legs: 3, strategy: 'grind_under_core', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'hit_rate', side: 'under' },
      { legs: 3, strategy: 'grind_under_core', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'composite', side: 'under' },
      { legs: 3, strategy: 'grind_under_core', sports: ['basketball_nba'], minHitRate: 52, sortBy: 'env_cluster_grind', side: 'under' },
      { legs: 3, strategy: 'grind_under_core', sports: ['basketball_nba'], minHitRate: 52, sortBy: 'shuffle', side: 'under' },
      // ============= CONTRARIAN PROFILES: flip side for scenario diversity =============
      { legs: 3, strategy: 'contrarian_flip', sports: ['basketball_nba'], minHitRate: 42, sortBy: 'hit_rate', contrarian: true },
      { legs: 3, strategy: 'contrarian_flip', sports: ['basketball_nba'], minHitRate: 42, sortBy: 'shuffle', contrarian: true },
      { legs: 3, strategy: 'contrarian_flip', sports: ['all'], minHitRate: 42, sortBy: 'composite', contrarian: true },
    ],
  },
  execution: {
    count: 50,
    iterations: 25000,
    maxPlayerUsage: 5,
    maxTeamUsage: 2,
    maxCategoryUsage: 2,
    minHitRate: 65,
    minEdge: 0.008,
    minSharpe: 0.02,
    stake: 100,
    minConfidence: 0.65,
    profiles: [
      // ============= OPTIMAL COMBO EXECUTION (PRIORITY — combinatorial optimizer) =============
      { legs: 3, strategy: 'optimal_combo', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'hit_rate' },
      { legs: 4, strategy: 'optimal_combo', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'optimal_combo', sports: ['all'], minHitRate: 70, sortBy: 'hit_rate' },
      // ============= FLOOR LOCK EXECUTION (PRIORITY — processed first to avoid timeout) =============
      { legs: 3, strategy: 'floor_lock', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'floor_lock', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'composite' },
      { legs: 3, strategy: 'floor_lock', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'shuffle' },
      { legs: 3, strategy: 'floor_lock', sports: ['all'], minHitRate: 70, sortBy: 'hit_rate' },
      // ============= CEILING SHOT EXECUTION (PRIORITY — processed first to avoid timeout) =============
      { legs: 3, strategy: 'ceiling_shot', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'composite', useAltLines: true, preferPlusMoney: true },
      { legs: 3, strategy: 'ceiling_shot', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'shuffle', useAltLines: true, preferPlusMoney: true },
      { legs: 3, strategy: 'ceiling_shot', sports: ['all'], minHitRate: 55, sortBy: 'composite', useAltLines: true, preferPlusMoney: true },
      // ============= SWEET SPOT CORE: 3-leg parlays from Sweet Spot engine (minHitRate=55, engine pre-vetted) =============
      // --- Sorted by hit_rate ---
      { legs: 3, strategy: 'sweet_spot_core', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'sweet_spot_core', sports: ['all'], minHitRate: 55, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'sweet_spot_core', sports: ['icehockey_nhl'], minHitRate: 55, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'sweet_spot_core', sports: ['basketball_nba', 'icehockey_nhl'], minHitRate: 55, sortBy: 'hit_rate' },
      // --- Sorted by composite ---
      { legs: 3, strategy: 'sweet_spot_core', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'composite' },
      { legs: 3, strategy: 'sweet_spot_core', sports: ['all'], minHitRate: 55, sortBy: 'composite' },
      { legs: 3, strategy: 'sweet_spot_core', sports: ['icehockey_nhl'], minHitRate: 55, sortBy: 'composite' },
      // --- Sorted by shuffle (combinatorial diversity) ---
      { legs: 3, strategy: 'sweet_spot_core', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'shuffle' },
      { legs: 3, strategy: 'sweet_spot_core', sports: ['all'], minHitRate: 55, sortBy: 'shuffle' },
      { legs: 3, strategy: 'sweet_spot_core', sports: ['icehockey_nhl'], minHitRate: 55, sortBy: 'shuffle' },
      { legs: 3, strategy: 'sweet_spot_core', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'shuffle' },
      { legs: 3, strategy: 'sweet_spot_core', sports: ['all'], minHitRate: 55, sortBy: 'shuffle' },
      // --- Sorted by env_cluster (SHOOTOUT-first smart stacking) --- CAPPED: 1 profile (was 4, 16% win rate)
      { legs: 3, strategy: 'sweet_spot_core', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'env_cluster_shootout' },
      // --- Sorted by env_cluster (GRIND-first smart stacking) --- BOOSTED: 6 profiles (was 4)
      { legs: 3, strategy: 'sweet_spot_core', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'env_cluster_grind' },
      { legs: 3, strategy: 'sweet_spot_core', sports: ['all'], minHitRate: 55, sortBy: 'env_cluster_grind' },
      { legs: 3, strategy: 'sweet_spot_core', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'env_cluster_grind' },
      { legs: 3, strategy: 'sweet_spot_core', sports: ['all'], minHitRate: 55, sortBy: 'env_cluster_grind' },
      { legs: 3, strategy: 'sweet_spot_core', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'env_cluster_grind' },
      { legs: 3, strategy: 'sweet_spot_core', sports: ['all'], minHitRate: 55, sortBy: 'env_cluster_grind' },
      // --- Higher hit rate tiers for premium picks ---
      { legs: 3, strategy: 'sweet_spot_core', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'sweet_spot_core', sports: ['all'], minHitRate: 70, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'sweet_spot_core', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'env_cluster_shootout' },
      { legs: 3, strategy: 'sweet_spot_core', sports: ['all'], minHitRate: 70, sortBy: 'env_cluster_grind' },
      // ============= SWEET SPOT L3: moved to EXPLORATION tier (NHL picks blocked by execution gates) =============
      // ============= SWEET SPOT PLUS: moved to EXPLORATION tier (4-leggers underperform in execution) =============
      // ============= PRIORITY: HIGH-CONVICTION STRATEGIES (BOOSTED — 54.5% WR, 13 profiles) =============
      { legs: 3, strategy: 'triple_confirmed_conviction', sports: ['all'], minHitRate: 70, sortBy: 'composite' },
      { legs: 3, strategy: 'triple_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'composite' },
      { legs: 3, strategy: 'triple_confirmed_conviction', sports: ['all'], minHitRate: 70, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 70, sortBy: 'composite', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'composite' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 65, sortBy: 'composite' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'hit_rate', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 80, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 80, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 70, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'shuffle' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 70, sortBy: 'shuffle' },
      // NEW: Additional conviction profiles (boosted to 13 total)
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 75, sortBy: 'composite', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 75, sortBy: 'hit_rate' },
      // ============= MIXED CONVICTION STACK =============
      { legs: 3, strategy: 'mixed_conviction_stack', sports: ['all'], minHitRate: 65, sortBy: 'composite' },
      { legs: 3, strategy: 'mixed_conviction_stack', sports: ['basketball_nba'], minHitRate: 62, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'mixed_conviction_stack', sports: ['all'], minHitRate: 60, sortBy: 'hit_rate' },
      // ============= GOD MODE EXECUTION TIER =============
      { legs: 3, strategy: 'god_mode_lock', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'hit_rate', useAltLines: false },
      { legs: 3, strategy: 'god_mode_lock', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'composite', useAltLines: false },
      { legs: 3, strategy: 'god_mode_lock', sports: ['all'], minHitRate: 70, sortBy: 'hit_rate', useAltLines: false },
      { legs: 3, strategy: 'god_mode_lock', sports: ['all'], minHitRate: 70, sortBy: 'composite', useAltLines: false },
      { legs: 3, strategy: 'god_mode_lock', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'shuffle', useAltLines: false },
      { legs: 3, strategy: 'god_mode_lock', sports: ['all'], minHitRate: 70, sortBy: 'shuffle', useAltLines: false },
      // ROLE-STACKED 3/5/8-LEG: structural diversity with SAFE/BALANCED/GREAT_ODDS roles
      { legs: 3, strategy: 'role_stacked_3leg', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: true },
      { legs: 3, strategy: 'role_stacked_3leg', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: true },
      // 5-leg and 8-leg role-stacked REMOVED from execution (0% win rate on 5+ leggers) — moved to exploration
      // ============= REDUCED: Standard execution (kept for diversity) =============
      { legs: 3, strategy: 'cash_lock', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'hit_rate', useAltLines: false },
      { legs: 3, strategy: 'cash_lock', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'shuffle', useAltLines: false },
      { legs: 3, strategy: 'boosted_cash', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'hit_rate', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
      { legs: 3, strategy: 'golden_lock', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
      { legs: 3, strategy: 'golden_lock', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'shuffle', useAltLines: false },
      { legs: 3, strategy: 'whale_signal', sports: ['all'], minHitRate: 55, sortBy: 'composite' },
      // PAUSED: mispriced_edge execution (0.5% ROI) — redirected to high-ROI strategies
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'], minHitRate: 58, sortBy: 'composite' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 68, sortBy: 'hit_rate' },
      // NCAAB EXECUTION: UNDERS ONLY
      { legs: 3, strategy: 'ncaab_unders_only', sports: ['basketball_ncaab'], betTypes: ['total'], side: 'under', minHitRate: 62, sortBy: 'hit_rate', useAltLines: false, maxCategoryUsage: 3 },
      { legs: 3, strategy: 'hot_streak_lock', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'hit_rate', useAltLines: false },
      { legs: 3, strategy: 'hot_streak_lock', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'shuffle', useAltLines: false },
      // ============= BLOWOUT SCRIPT EXECUTION: underdog starters PRA unders + garbage time plays =============
      { legs: 3, strategy: 'blowout_script', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'hit_rate', gameFilter: 'blowout' },
      { legs: 3, strategy: 'blowout_script', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'shuffle', gameFilter: 'blowout' },
      // ============= GRIND UNDER: NBA under plays — proven winners from March 3rd analysis =============
      { legs: 3, strategy: 'grind_under_core', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', side: 'under' },
      { legs: 3, strategy: 'grind_under_core', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'composite', side: 'under' },
      { legs: 3, strategy: 'grind_under_core', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'env_cluster_grind', side: 'under' },
      { legs: 3, strategy: 'grind_under_core', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'shuffle', side: 'under' },
      // ============= DOUBLE CONFIRMED CONVICTION EXECUTION (PROMOTED — 66.7% win rate) =============
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'composite' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'composite' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 60, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 60, sortBy: 'hit_rate' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'shuffle' },
      { legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba', 'icehockey_nhl'], minHitRate: 60, sortBy: 'composite' },
      // ============= CROSS SPORT 4-LEG EXECUTION (PROMOTED — 8-0 record, $3,930 profit) =============
      // --- Sorted by composite (default high-confidence selection) ---
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'], minHitRate: 55, sortBy: 'composite' },
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'], minHitRate: 55, sortBy: 'composite' },
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'], minHitRate: 55, sortBy: 'composite' },
      // --- Sorted by hit_rate (prioritize proven hitters) ---
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'], minHitRate: 55, sortBy: 'hit_rate' },
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'], minHitRate: 55, sortBy: 'hit_rate' },
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'], minHitRate: 55, sortBy: 'hit_rate' },
      // --- Sorted by shuffle (break deterministic overlap) ---
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'], minHitRate: 55, sortBy: 'shuffle' },
      { legs: 4, strategy: 'cross_sport_4', sports: ['all'], minHitRate: 55, sortBy: 'shuffle' },
      // --- Sport-specific pairs (proven correlations) ---
      { legs: 4, strategy: 'cross_sport_4', sports: ['basketball_nba', 'icehockey_nhl'], minHitRate: 55, sortBy: 'composite' },
      { legs: 4, strategy: 'cross_sport_4', sports: ['basketball_nba', 'basketball_ncaab'], minHitRate: 55, sortBy: 'composite' },
      // --- Additional sport-pair diversity ---
      { legs: 4, strategy: 'cross_sport_4', sports: ['basketball_nba', 'icehockey_nhl'], minHitRate: 55, sortBy: 'shuffle' },
      { legs: 4, strategy: 'cross_sport_4', sports: ['basketball_nba', 'icehockey_nhl'], minHitRate: 55, sortBy: 'shuffle' },
      { legs: 4, strategy: 'cross_sport_4', sports: ['basketball_nba', 'basketball_ncaab'], minHitRate: 55, sortBy: 'hit_rate' },
      { legs: 4, strategy: 'cross_sport_4', sports: ['basketball_nba', 'basketball_ncaab'], minHitRate: 55, sortBy: 'hit_rate' },
      // (floor_lock + ceiling_shot moved to TOP of execution profiles to avoid timeout)
      // ============= CONTRARIAN PROFILES: flip side for scenario diversity =============
      { legs: 3, strategy: 'contrarian_flip', sports: ['basketball_nba'], minHitRate: 50, sortBy: 'hit_rate', contrarian: true },
      { legs: 3, strategy: 'contrarian_flip', sports: ['basketball_nba'], minHitRate: 50, sortBy: 'shuffle', contrarian: true },
    ],
  },
};

// ============= BLOCKED SPORTS (paused until more data collected) =============
const BLOCKED_SPORTS = ['baseball_ncaa', 'golf_pga'];

// ============= BLOCKED CATEGORIES (catastrophic hit rates + non-NBA sports mislabeled) =============
const BLOCKED_CATEGORIES = new Set([
  'OVER_TOTAL',      // 10.2% hit rate
  'UNDER_TOTAL',     // 18.2% hit rate
  'ML_FAVORITE',     // 20% hit rate
  'BIG_ASSIST_OVER', // 10.3% hit rate → 0% Mar 15-27
  'VOLUME_SCORER',   // 0% hit rate across ALL strategies
  'ROLE_PLAYER_REB', // 0% hit rate across ALL strategies
  'REBOUNDS',        // 13% hit rate Mar 15-27 — toxic category
  'HIGH_REB_UNDER',  // 29% hit rate Mar 15-27 — below threshold
  'uncategorized',   // No signal — unclassified legs drag down win rate
  // MLB categories — UNBLOCKED (data pipeline now active)
]);

// ============= CASH LOCK FLIP MAP (force historically-losing categories to winning side) =============
const CASH_LOCK_FLIP_MAP: Record<string, 'over' | 'under'> = {
  'REBOUNDS': 'under',             // 0% as over -> force under
  'THREES': 'under',              // 0% as over -> force under
  'THREE_POINT_SHOOTER': 'under', // 34.5% as over -> force under
  'HIGH_ASSIST': 'over',          // 0% as under, 62.5% as over -> force over
  'MID_SCORER_UNDER': 'over',    // 25% as under -> force over
};

// ============= BLOCKED PROP TYPES (static fallback + dynamic from bot_prop_type_performance) =============
const STATIC_BLOCKED_PROP_TYPES = new Set([
  // steals and blocks unblocked to match Feb 23 winning config
]);

// Dynamic prop type performance data (loaded at runtime)
let dynamicBlockedPropTypes = new Set<string>();
let dynamicBoostedPropTypes = new Map<string, number>(); // prop_type -> boost multiplier

async function loadPropTypePerformance(supabase: any): Promise<void> {
  try {
    const { data: propPerf } = await supabase
      .from('bot_prop_type_performance')
      .select('prop_type, is_blocked, is_boosted, boost_multiplier, hit_rate, total_legs');
    
    if (propPerf && propPerf.length > 0) {
      dynamicBlockedPropTypes = new Set(
        propPerf.filter((p: any) => p.is_blocked).map((p: any) => p.prop_type)
      );
      dynamicBoostedPropTypes = new Map(
        propPerf.filter((p: any) => p.is_boosted)
          .map((p: any) => [p.prop_type, p.boost_multiplier && p.boost_multiplier > 1.0 ? p.boost_multiplier : 1.15])
      );
      console.log(`[Bot] Dynamic prop gates: ${dynamicBlockedPropTypes.size} blocked, ${dynamicBoostedPropTypes.size} boosted`);
    }
  } catch (err) {
    console.warn(`[Bot] Failed to load prop type performance: ${err}`);
  }
}

function isPropTypeBlocked(propType: string): boolean {
  const pt = propType.toLowerCase();
  return STATIC_BLOCKED_PROP_TYPES.has(pt) || dynamicBlockedPropTypes.has(pt);
}

// Player performance data (loaded at runtime)
let playerPerformanceMap = new Map<string, { legsPlayed: number; legsWon: number; hitRate: number; streak: number }>();

async function loadPlayerPerformance(supabase: any): Promise<void> {
  try {
    const { data: playerPerf } = await supabase
      .from('bot_player_performance')
      .select('player_name, prop_type, side, legs_played, legs_won, hit_rate, streak')
      .gte('legs_played', 3); // Only load players with meaningful data
    
    if (playerPerf && playerPerf.length > 0) {
      for (const p of playerPerf) {
        const key = `${(p.player_name || '').toLowerCase()}|${normalizePropType(p.prop_type || '')}`;
        playerPerformanceMap.set(key, {
          legsPlayed: p.legs_played,
          legsWon: p.legs_won,
          hitRate: p.hit_rate,
          streak: p.streak || 0,
        });
      }
      console.log(`[Bot] Loaded ${playerPerformanceMap.size} player performance records`);
    }
  } catch (err) {
    console.warn(`[Bot] Failed to load player performance: ${err}`);
  }
}

function getPlayerBonus(playerName: string, propType: string, tier?: string): number {
  const key = `${playerName.toLowerCase()}|${normalizePropType(propType)}`;
  const perf = playerPerformanceMap.get(key);
  if (!perf || perf.legsPlayed < 5) return 0;
  
  // GOD MODE: Proven winners get +20 in execution tier (upgraded from +15)
  if (perf.hitRate >= 0.70 && perf.streak >= 0) {
    return tier === 'execution' ? 20 : 15;
  }
  if (perf.hitRate >= 0.70) return 15;  // Proven winner (on losing streak — standard bonus)
  if (perf.hitRate >= 0.50) return 5;   // Reliable
  if (perf.hitRate < 0.30) return -999;  // Hard-block: serial loser
  return 0;
}

// Check if a pick qualifies for GOD MODE pool
function isGodModePick(pick: any): boolean {
  // Must be triple-confirmed OR multi-engine (3+)
  const isHighConviction = pick.isTripleConfirmed || (pick.engineCount >= 3);
  if (!isHighConviction) return false;
  
  // Must be a proven winner (70%+ L10, 5+ legs)
  const playerKey = `${(pick.player_name || '').toLowerCase()}|${normalizePropType(pick.prop_type || '')}`;
  const perf = playerPerformanceMap.get(playerKey);
  if (!perf || perf.legsPlayed < 5 || perf.hitRate < 0.70) return false;
  
  // Must not be on a losing streak
  if (perf.streak < 0) return false;
  
  // Must have favorable matchup (matchupFactor >= 0.6)
  const envScore = (pick as any).environmentScore;
  if (envScore != null && envScore < 0.35) return false; // env score maps to matchup quality
  
  return true;
}

// ============= STALE ODDS DETECTION =============
const STALE_ODDS_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours (NBA/NHL props)
const STALE_ODDS_THRESHOLD_GAME_DAY_MS = 24 * 60 * 60 * 1000; // 24 hours (NCAAB game-day totals — odds set morning, valid all day)

function isStaleOdds(updatedAt: string | null | undefined, sport?: string | null): boolean {
  if (!updatedAt) return true; // No timestamp = stale
  const updatedTime = new Date(updatedAt).getTime();
  const now = Date.now();
  // NCAAB game-day odds are set in the morning and remain valid all day
  const threshold = (sport === 'basketball_ncaab') ? STALE_ODDS_THRESHOLD_GAME_DAY_MS : STALE_ODDS_THRESHOLD_MS;
  return (now - updatedTime) > threshold;
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
  // L10 floor/ceiling data for floor_lock and ceiling_shot strategies
  l10_min?: number;
  l10_max?: number;
  l10_avg?: number;
  l10_median?: number;
  // DNA scoring fields
  l3_avg?: number;
  l5_avg?: number;
  l10_std_dev?: number;
  season_avg?: number;
  matchup_adjustment?: number;
  pace_adjustment?: number;
  h2h_matchup_boost?: number;
  bounce_back_score?: number;
  line_difference?: number;
}

interface EnrichedPick extends SweetSpotPick {
  americanOdds: number;
  oddsValueScore: number;
  compositeScore: number;
  has_real_line?: boolean;
  line_source?: string;
  line_verified_at?: string | null;
  isDoubleConfirmed?: boolean;
  isTripleConfirmed?: boolean;
  engineCount?: number;
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
  composite_score?: number | null; // Pre-computed by dedicated scorer (e.g. NCAAB KenPom-based scorer)
  recommended_side?: string | null; // 'OVER' | 'UNDER' | null
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

// ============= GAME CONTEXT FOR INTELLIGENT STACKING =============

type EnvironmentCluster = 'SHOOTOUT' | 'GRIND' | 'NEUTRAL';

interface PickGameContext {
  pace: 'fast' | 'neutral' | 'slow';
  defenseStrength: 'soft' | 'neutral' | 'tough';
  vegasTotal: number | null;
  blowoutRisk: boolean;
  gameKey: string; // "team1__team2" for same-game detection
  opponentAbbrev: string | null;
  teamTotalSignal?: 'OVER' | 'UNDER' | null;
  teamTotalComposite?: number | null;
  teamTotalSport?: string | null;
  envCluster?: EnvironmentCluster;
  envClusterStrength?: number; // how many signals matched (1-4)
}

// ============= ENVIRONMENT CLUSTER CLASSIFIER =============
function classifyEnvironmentCluster(ctx: PickGameContext | null | undefined, side?: string): { cluster: EnvironmentCluster; strength: number } {
  if (!ctx) return { cluster: 'NEUTRAL', strength: 0 };

  let shootoutSignals = 0;
  let grindSignals = 0;

  // Pace
  if (ctx.pace === 'fast') shootoutSignals++;
  if (ctx.pace === 'slow') grindSignals++;

  // Defense
  if (ctx.defenseStrength === 'soft') shootoutSignals++;
  if (ctx.defenseStrength === 'tough') grindSignals++;

  // Vegas total
  if (ctx.vegasTotal != null) {
    if (ctx.vegasTotal >= 225) shootoutSignals++;
    if (ctx.vegasTotal <= 210) grindSignals++;
  }

  // Team total signal
  if (ctx.teamTotalSignal === 'OVER') shootoutSignals++;
  if (ctx.teamTotalSignal === 'UNDER') grindSignals++;

  // Side alignment bonus
  const pickSide = (side || '').toLowerCase();
  if (pickSide === 'over' && shootoutSignals > 0) shootoutSignals++;
  if (pickSide === 'under' && grindSignals > 0) grindSignals++;

  // Classify: need at least 1 signal, prefer the stronger cluster
  if (shootoutSignals >= 2 && shootoutSignals > grindSignals) {
    return { cluster: 'SHOOTOUT', strength: shootoutSignals };
  }
  if (grindSignals >= 2 && grindSignals > shootoutSignals) {
    return { cluster: 'GRIND', strength: grindSignals };
  }
  if (shootoutSignals >= 1 && grindSignals === 0) {
    return { cluster: 'SHOOTOUT', strength: shootoutSignals };
  }
  if (grindSignals >= 1 && shootoutSignals === 0) {
    return { cluster: 'GRIND', strength: grindSignals };
  }

  return { cluster: 'NEUTRAL', strength: 0 };
}

function classifyPace(paceRating: number, sport: string): 'fast' | 'neutral' | 'slow' {
  if (sport.includes('nba') || sport.includes('wnba')) {
    if (paceRating >= 101) return 'fast';
    if (paceRating <= 97) return 'slow';
  }
  return 'neutral';
}

function classifyDefense(rank: number): 'soft' | 'neutral' | 'tough' {
  if (rank <= 10) return 'tough';
  if (rank >= 20) return 'soft';
  return 'neutral';
}

// Build a map: teamAbbrev → { opponentAbbrev, gameKey, vegasTotal, blowoutProb, teamTotalSignal }
function buildTeamGameContextMap(
  envMap: Map<string, GameEnvData>,
  paceMap: Map<string, PaceData>,
  defenseMap: Map<string, number>,
  nameToAbbrev: Map<string, string>,
  teamTotalMap?: Map<string, { side: string; compositeScore: number; sport: string }>
): Map<string, PickGameContext> {
  const contextMap = new Map<string, PickGameContext>();

  for (const [key, env] of envMap.entries()) {
    const [homeAbbrev, awayAbbrev] = key.split('_');
    if (!homeAbbrev || !awayAbbrev) continue;

    const homePace = paceMap.get(homeAbbrev);
    const awayPace = paceMap.get(awayAbbrev);
    const avgPace = (homePace && awayPace) ? (homePace.pace_rating + awayPace.pace_rating) / 2 : 99;

    const gameKey = [homeAbbrev, awayAbbrev].sort().join('__').toLowerCase();

    // Look up team total signal for this game (try both teams)
    const totalSignalHome = teamTotalMap?.get(homeAbbrev);
    const totalSignalAway = teamTotalMap?.get(awayAbbrev);
    const totalSignal = totalSignalHome || totalSignalAway;

    // Home team context: opponent defense = away team's defense rank
    const awayDefRank = defenseMap.get(awayAbbrev) ?? 15;
    contextMap.set(homeAbbrev, {
      pace: classifyPace(avgPace, 'basketball_nba'),
      defenseStrength: classifyDefense(awayDefRank),
      vegasTotal: env.vegas_total,
      blowoutRisk: env.blowout_probability > 0.3,
      gameKey,
      opponentAbbrev: awayAbbrev,
      teamTotalSignal: totalSignal ? totalSignal.side as 'OVER' | 'UNDER' : null,
      teamTotalComposite: totalSignal ? totalSignal.compositeScore : null,
      teamTotalSport: totalSignal ? totalSignal.sport : null,
    });

    // Away team context: opponent defense = home team's defense rank
    const homeDefRank = defenseMap.get(homeAbbrev) ?? 15;
    contextMap.set(awayAbbrev, {
      pace: classifyPace(avgPace, 'basketball_nba'),
      defenseStrength: classifyDefense(homeDefRank),
      vegasTotal: env.vegas_total,
      blowoutRisk: env.blowout_probability > 0.3,
      gameKey,
      opponentAbbrev: homeAbbrev,
      teamTotalSignal: totalSignal ? totalSignal.side as 'OVER' | 'UNDER' : null,
      teamTotalComposite: totalSignal ? totalSignal.compositeScore : null,
      teamTotalSport: totalSignal ? totalSignal.sport : null,
    });
  }

  return contextMap;
}

// Anti-correlation: detect contradictory legs within a parlay
function hasAntiCorrelation(newPick: any, existingLegs: any[]): { blocked: boolean; reason: string } {
  const newTeam = (newPick.team_name || '').toLowerCase();
  const newSide = (newPick.recommended_side || newPick.side || '').toLowerCase();
  const newPropType = newPick.prop_type || newPick.bet_type || '';
  const isNewPlayerProp = !!newPick.player_name;

  for (const leg of existingLegs) {
    const legTeam = (leg.team_name || '').toLowerCase();
    const legSide = (leg.side || leg.recommended_side || '').toLowerCase();
    const legBetType = leg.bet_type || leg.prop_type || '';
    const isLegTeamBet = leg.type === 'team';
    const isLegPlayerProp = !!leg.player_name;

    // Rule 1: Player OVER + same team UNDER total = contradiction
    if (newTeam && legTeam && newTeam === legTeam) {
      if (isNewPlayerProp && newSide === 'over' && isLegTeamBet && legBetType === 'total' && legSide === 'under') {
        return { blocked: true, reason: `${newPick.player_name} OVER conflicts with ${legTeam} UNDER total` };
      }
      if (isLegPlayerProp && legSide === 'over' && !isNewPlayerProp && newPropType === 'total' && newSide === 'under') {
        return { blocked: true, reason: `UNDER total conflicts with ${leg.player_name} OVER on same team` };
      }
    }

    // Rule 2: Two player props on SAME player, SAME stat, OPPOSITE sides
    if (newPick.player_name && leg.player_name &&
        newPick.player_name.toLowerCase() === leg.player_name.toLowerCase() &&
        normalizePropTypeCategory(newPropType) === normalizePropTypeCategory(legBetType) &&
        newSide !== legSide) {
      return { blocked: true, reason: `Mirror: ${newPick.player_name} ${newSide} vs ${legSide} ${newPropType}` };
    }

    // Rule 3: Opponent player OVER + team UNDER total
    // If we have a team UNDER total for Game X, and we're adding a player OVER from the OTHER team in Game X
    if (isLegTeamBet && legBetType === 'total' && legSide === 'under' && isNewPlayerProp && newSide === 'over') {
      const legHomeTeam = (leg.home_team || '').toLowerCase();
      const legAwayTeam = (leg.away_team || '').toLowerCase();
      if (newTeam === legHomeTeam || newTeam === legAwayTeam) {
        return { blocked: true, reason: `${newPick.player_name} OVER conflicts with game UNDER total` };
      }
    }
    // Reverse: adding team UNDER total when player OVER from same game exists
    if (!isNewPlayerProp && newPropType === 'total' && newSide === 'under' && isLegPlayerProp && legSide === 'over') {
      const newHomeTeam = (newPick.home_team || '').toLowerCase();
      const newAwayTeam = (newPick.away_team || '').toLowerCase();
      if (legTeam === newHomeTeam || legTeam === newAwayTeam) {
        return { blocked: true, reason: `Game UNDER total conflicts with ${leg.player_name} OVER` };
      }
    }
  }
  return { blocked: false, reason: '' };
}

// Coherence scoring: how well do the legs fit together based on game environment?
function calculateParlayCoherence(legs: any[]): number {
  if (legs.length < 2) return 100;

  let coherenceScore = 100;
  const overLegs = legs.filter(l => (l.side || l.recommended_side) === 'over' && l.player_name);
  const underLegs = legs.filter(l => (l.side || l.recommended_side) === 'under' && l.player_name);

  // Game environment alignment bonuses/penalties (STRENGTHENED)
  for (const leg of overLegs) {
    const ctx = leg._gameContext as PickGameContext | undefined;
    if (!ctx) continue;
    if (ctx.pace === 'fast') coherenceScore += 6;
    if (ctx.pace === 'slow') coherenceScore -= 8;
    if (ctx.defenseStrength === 'soft') coherenceScore += 6;
    // GRIND+tough defense OVER gets amplified penalty (-20 instead of -8)
    if (ctx.defenseStrength === 'tough' && ctx.envCluster === 'GRIND') {
      coherenceScore -= 20;
    } else if (ctx.defenseStrength === 'tough') {
      coherenceScore -= 8;
    }

    // TEAM TOTAL ALIGNMENT: Player OVER vs game total signal
    if (ctx.teamTotalSignal && ctx.teamTotalComposite) {
      if (ctx.teamTotalSignal === 'OVER' && ctx.teamTotalComposite >= 70) {
        coherenceScore += 10; // Aligned: player OVER in OVER game
      } else if (ctx.teamTotalSignal === 'UNDER' && ctx.teamTotalComposite >= 70) {
        coherenceScore -= 18; // Conflict: player OVER in strong UNDER game
      }
    }
  }
  for (const leg of underLegs) {
    const ctx = leg._gameContext as PickGameContext | undefined;
    if (!ctx) continue;
    if (ctx.pace === 'slow') coherenceScore += 6;
    if (ctx.pace === 'fast') coherenceScore -= 7;
    if (ctx.defenseStrength === 'tough') coherenceScore += 6;
    if (ctx.defenseStrength === 'soft') coherenceScore -= 6;

    // TEAM TOTAL ALIGNMENT: Player UNDER vs game total signal
    if (ctx.teamTotalSignal && ctx.teamTotalComposite) {
      if (ctx.teamTotalSignal === 'UNDER' && ctx.teamTotalComposite >= 70) {
        coherenceScore += 10; // Aligned: player UNDER in UNDER game
      } else if (ctx.teamTotalSignal === 'OVER' && ctx.teamTotalComposite >= 70) {
        coherenceScore -= 14; // Conflict: player UNDER in strong OVER game
      }
    }
  }

  // === ENVIRONMENT CLUSTER COHERENCE ===
  const clusters = legs.map(l => {
    const ctx = l._gameContext as PickGameContext | undefined;
    return ctx?.envCluster || 'NEUTRAL';
  });
  const shootoutCount = clusters.filter(c => c === 'SHOOTOUT').length;
  const grindCount = clusters.filter(c => c === 'GRIND').length;

  // All same cluster = BIG bonus (smart stacking)
  if (shootoutCount === legs.length) coherenceScore += 20;
  else if (grindCount === legs.length) coherenceScore += 20;
  // Mixed shootout+grind = heavy penalty (incoherent stack)
  else if (shootoutCount > 0 && grindCount > 0) coherenceScore -= 25;

  // Positive correlation bonus: player OVER + same team ML/spread = correlated upside
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i];
      const b = legs[j];
      const aTeam = (a.team_name || a.home_team || '').toLowerCase();
      const bTeam = (b.team_name || b.home_team || '').toLowerCase();
      if (!aTeam || !bTeam || aTeam !== bTeam) continue;

      const aIsPlayer = !!a.player_name;
      const bIsPlayer = !!b.player_name;
      const aIsTeamML = a.type === 'team' && a.bet_type === 'moneyline';
      const bIsTeamML = b.type === 'team' && b.bet_type === 'moneyline';
      const aSide = (a.side || a.recommended_side || '').toLowerCase();
      const bSide = (b.side || b.recommended_side || '').toLowerCase();

      // Player OVER points/assists + same team ML = positive correlation (+5)
      if ((aIsPlayer && aSide === 'over' && bIsTeamML) ||
          (bIsPlayer && bSide === 'over' && aIsTeamML)) {
        coherenceScore += 5;
      }
    }
  }

  return Math.max(0, Math.min(150, coherenceScore));
}

// Calculate coherence bonus for a candidate pick relative to already-selected legs
function pickCoherenceBonus(pick: any, existingLegs: any[]): number {
  if (existingLegs.length === 0) return 0;

  let bonus = 0;
  const pickSide = (pick.recommended_side || pick.side || '').toLowerCase();
  const pickCtx = pick._gameContext as PickGameContext | undefined;
  const isPlayerPick = !!pick.player_name;

  if (!pickCtx || !isPlayerPick) return 0;

  const pickCluster = pickCtx.envCluster || 'NEUTRAL';

  for (const leg of existingLegs) {
    const legCtx = leg._gameContext as PickGameContext | undefined;
    if (!legCtx) continue;
    const legSide = (leg.side || leg.recommended_side || '').toLowerCase();
    const legCluster = legCtx.envCluster || 'NEUTRAL';

    // Both overs in fast-pace games = strong synergy
    if (pickSide === 'over' && legSide === 'over' && pickCtx.pace === 'fast' && legCtx.pace === 'fast') {
      bonus += 8;
    }
    // Both overs in soft-defense games = strong synergy
    if (pickSide === 'over' && legSide === 'over' && pickCtx.defenseStrength === 'soft' && legCtx.defenseStrength === 'soft') {
      bonus += 8;
    }
    // Both unders in slow-pace games = strong synergy
    if (pickSide === 'under' && legSide === 'under' && pickCtx.pace === 'slow' && legCtx.pace === 'slow') {
      bonus += 8;
    }
    // Both unders in tough-defense games = strong synergy
    if (pickSide === 'under' && legSide === 'under' && pickCtx.defenseStrength === 'tough' && legCtx.defenseStrength === 'tough') {
      bonus += 8;
    }
    // OVER in slow pace mixed with UNDER in fast pace = heavily incoherent
    if ((pickSide === 'over' && pickCtx.pace === 'slow' && legSide === 'under' && legCtx.pace === 'fast') ||
        (pickSide === 'under' && pickCtx.pace === 'fast' && legSide === 'over' && legCtx.pace === 'slow')) {
      bonus -= 10;
    }
    // Same environment cluster match = synergy
    if (pickCluster !== 'NEUTRAL' && pickCluster === legCluster) {
      bonus += 6;
    }
    // Mixed cluster (SHOOTOUT + GRIND) = heavy penalty
    if ((pickCluster === 'SHOOTOUT' && legCluster === 'GRIND') ||
        (pickCluster === 'GRIND' && legCluster === 'SHOOTOUT')) {
      bonus -= 8;
    }

    // === DEFENSE-STRENGTH MATCHING ===
    // If existing legs all face soft defense, penalize tough-defense candidates
    if (pickCtx.defenseStrength === 'tough' && legCtx.defenseStrength === 'soft') {
      bonus -= 15;
    }
    if (pickCtx.defenseStrength === 'soft' && legCtx.defenseStrength === 'tough') {
      bonus -= 15;
    }
  }

  return bonus;
}

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
  defenseDetailMap: Map<string, any>,
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

  // Route Table Tennis to dedicated Over-only scoring engine
  if (sport.includes('pingpong')) {
    return calculateTableTennisOverScore(game, betType, side);
  }

  // Route Tennis to dedicated scoring
  if (sport.includes('tennis')) {
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
    // Unified Environment Score for totals
    const homePace = paceMap.get(homeAbbrev);
    const awayPace = paceMap.get(awayAbbrev);
    const avgPaceRating = (homePace && awayPace) ? (homePace.pace_rating + awayPace.pace_rating) / 2 : null;
    const oppAbbrev = side === 'over' ? awayAbbrev : homeAbbrev;
    const oppDefDetail = defenseDetailMap.get(oppAbbrev);
    const oppDefRank = oppDefDetail?.overall_rank ?? (defenseMap.get(oppAbbrev) || null);
    const blowoutProb = env?.blowout_probability ?? null;

    const envResult = calculateEnvironmentScore(
      avgPaceRating, oppDefRank, blowoutProb, 'total', side,
      oppDefDetail?.opp_rebounds_rank, oppDefDetail?.opp_assists_rank
    );
    score += envResult.confidenceAdjustment;
    breakdown.environment_score = envResult.confidenceAdjustment;

    // Shootout / grind factor (keep these as supplementary)
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

// ============= TABLE TENNIS OVER TOTAL POINTS ENGINE =============
// Uses Tier 1 weighted expected total + Tier 2 normal approximation for P(Over)
// Only scores Over picks — Under/ML/Spread get score 0 (blocked)

// Normal CDF approximation (Abramowitz & Stegun)
function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1.0 / (1.0 + p * Math.abs(x));
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1.0 + sign * y);
}

// Global cache for TT stats (populated once per generation run)
let ttStatsCache: Map<string, any> | null = null;

async function getTTStatsCache(supabase: any): Promise<Map<string, any>> {
  if (ttStatsCache) return ttStatsCache;
  const { data } = await supabase
    .from('tt_match_stats')
    .select('*')
    .gte('last_updated', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
  
  ttStatsCache = new Map();
  if (data) {
    for (const row of data) {
      ttStatsCache.set(row.player_name.toLowerCase(), row);
    }
  }
  return ttStatsCache;
}

function calculateTableTennisOverScore(
  game: TeamProp,
  betType: string,
  side: string
): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = { base: 50 };

  // === OVER-ONLY FILTER ===
  // Block all non-Over picks for table tennis
  if (betType !== 'total' || side !== 'over') {
    breakdown.tt_over_only_block = -50;
    return { score: 0, breakdown };
  }

  // Get the book line
  const line = game.line || 0;
  if (line <= 0) {
    breakdown.no_line = -20;
    return { score: 30, breakdown };
  }

  // Try to use cached stats (sync fallback — stats loaded earlier in generation)
  // If no stats available, use odds-implied fallback with penalty
  const p1Name = (game.home_team || '').toLowerCase();
  const p2Name = (game.away_team || '').toLowerCase();
  
  const p1Stats = ttStatsCache?.get(p1Name);
  const p2Stats = ttStatsCache?.get(p2Name);

  // Default stats for unknown players
  const defaults = {
    avg_match_total: 80, avg_period_total: 20,
    pct_3_sets: 0.40, pct_4_sets: 0.35, pct_5_sets: 0.25,
    recent_over_rate: 0.50, std_dev_total: 8, sample_size: 0,
  };

  const s1 = p1Stats || defaults;
  const s2 = p2Stats || defaults;
  const hasRealData = (p1Stats?.sample_size > 0) || (p2Stats?.sample_size > 0);

  // === STEP B: Expected Sets ===
  const avgP3 = (s1.pct_3_sets + s2.pct_3_sets) / 2;
  const avgP4 = (s1.pct_4_sets + s2.pct_4_sets) / 2;
  const avgP5 = (s1.pct_5_sets + s2.pct_5_sets) / 2;
  const S_hat = 3 * avgP3 + 4 * avgP4 + 5 * avgP5;
  breakdown.expected_sets = Math.round(S_hat * 100) / 100;

  // === STEP A: Expected Total ===
  const AMT1 = s1.avg_match_total;
  const AMT2 = s2.avg_match_total;
  const APT1 = s1.avg_period_total;
  const APT2 = s2.avg_period_total;
  const ET = 0.45 * AMT1 + 0.45 * AMT2 + 0.10 * (APT1 + APT2) * S_hat;
  breakdown.expected_total = Math.round(ET * 10) / 10;

  // === STEP C: Recent Over Adjustment ===
  const avgRO = (s1.recent_over_rate + s2.recent_over_rate) / 2;
  const k = 0.25;
  const sigma_default = 8;
  const sigma_set = 3;
  const Adj = k * (avgRO - 0.50) * sigma_default;
  const ET_final = ET + Adj;
  breakdown.recent_over_adj = Math.round(Adj * 10) / 10;
  breakdown.adjusted_total = Math.round(ET_final * 10) / 10;

  // === STEP D: P(Over) via Normal Approximation ===
  const APT_avg = (APT1 + APT2) / 2;
  const VarS = (9 * avgP3 + 16 * avgP4 + 25 * avgP5) - S_hat * S_hat;
  const sigma2 = (sigma_set * sigma_set) * S_hat + VarS * (APT_avg * APT_avg);
  const sigma = Math.sqrt(Math.max(sigma2, 1));
  const z = (line - ET_final) / sigma;
  const probOver = 1 - normalCDF(z);
  breakdown.prob_over = Math.round(probOver * 1000) / 1000;
  breakdown.sigma = Math.round(sigma * 10) / 10;
  breakdown.margin = Math.round((ET_final - line) * 10) / 10;

  // === DECISION LOGIC ===
  let score = 50;

  if (probOver >= 0.65) {
    // Strong Over signal
    score = 80 + Math.round((probOver - 0.65) * 100);
    breakdown.strong_over = score - 50;
  } else if (probOver >= 0.60) {
    // Lean Over
    score = 68 + Math.round((probOver - 0.60) * 200);
    breakdown.lean_over = score - 50;
  } else if (probOver >= 0.55) {
    // Marginal — reduced confidence
    score = 55 + Math.round((probOver - 0.55) * 200);
    breakdown.marginal_over = score - 50;
  } else if (probOver < 0.45) {
    // Block — probability too low
    score = 0;
    breakdown.prob_too_low = -50;
    return { score: 0, breakdown };
  } else {
    // Neutral zone (0.45 - 0.55) — low confidence
    score = 45;
    breakdown.neutral_zone = -5;
  }

  // === DATA CONFIDENCE PENALTY ===
  if (!hasRealData) {
    score = Math.round(score * 0.75); // 25% penalty for no real data
    breakdown.no_data_penalty = -Math.round(score * 0.25);
  } else {
    const combinedSample = (s1.sample_size || 0) + (s2.sample_size || 0);
    if (combinedSample < 10) {
      score = Math.round(score * 0.85); // 15% penalty for small sample
      breakdown.small_sample_penalty = -Math.round(score * 0.15);
    }
  }

  // === MARGIN CHECK (secondary) ===
  const margin = ET_final - line;
  if (margin >= 4.0) {
    score += 5;
    breakdown.strong_margin_bonus = 5;
  } else if (margin < 0 && probOver < 0.58) {
    score -= 5;
    breakdown.negative_margin = -5;
  }

  return { score: Math.max(0, Math.min(95, score)), breakdown };
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

interface BlowoutGameInfo {
  home_team: string;
  away_team: string;
  spread: number; // negative = home favored, positive = away favored
  underdog: string; // team abbreviation of the underdog
  favorite: string; // team abbreviation of the favorite
}

interface PropPool {
  playerPicks: EnrichedPick[];
  teamPicks: EnrichedTeamPick[];
  sweetSpots: EnrichedPick[];
  whalePicks: EnrichedPick[];
  mispricedPicks: EnrichedPick[];
  doubleConfirmedPicks: EnrichedPick[];
  tripleConfirmedPicks: EnrichedPick[];
  multiEnginePicks: EnrichedPick[];
  totalPool: number;
  goldenCategories: Set<string>;
  defenseDetailMap: Map<string, any>;
  oddsMap: Map<string, any>;
  playerProps: any[];
  blowoutGames: BlowoutGameInfo[];
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
  legCount?: number,
  playerBonus?: number
): number {
  const hitRateScore = Math.min(100, hitRate);
  const edgeScore = Math.min(100, Math.max(0, edge * 20 + 50));
  const weightScore = categoryWeight * 66.67;
  
  // === GAP 1: Dynamic hit-rate weight by parlay size ===
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

  // === PLAYER PERFORMANCE BONUS: Proven winners get boosted, serial losers get penalized ===
  if (playerBonus && playerBonus !== 0) {
    baseScore += playerBonus;
  }

  return Math.max(0, baseScore);
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

function getMinBuffer(propType: string, line: number = 10, isConviction: boolean = false): number {
  // Stat-aware + conviction-aware minimum buffer
  // Low-line props (threes, blocks, steals) need smaller absolute buffers
  // Conviction picks (double/triple-confirmed, multi-engine 3+) get reduced thresholds
  if (line <= 1.0) return isConviction ? 0.1 : 0.2;
  if (line <= 3.0) return isConviction ? 0.3 : 0.5;
  if (line <= 6.0) return isConviction ? 0.5 : 0.75;
  // Standard props (points, rebounds, assists) with lines 6+
  return isConviction ? 0.75 : 1.0;
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
  
  if (!strategy.includes('aggressive') && !strategy.includes('alt') && !strategy.includes('boosted') && !strategy.includes('golden') && !strategy.includes('cash_lock')) {
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

// ============= FLOOR LOCK: Select standard line only if L10 floor clears it =============
function selectFloorLine(
  pick: EnrichedPick
): SelectedLine | null {
  const l10Min = (pick as any).l10_min;
  const line = pick.line;
  if (l10Min == null || l10Min <= 0 || line <= 0) return null;
  
  const side = (pick.recommended_side || 'over').toLowerCase();
  if (side === 'over' && l10Min >= line) {
    const floorMargin = l10Min - line;
    return { line, odds: pick.americanOdds, reason: `floor_lock_margin_${floorMargin.toFixed(1)}` };
  }
  if (side === 'under') {
    const l10Max = (pick as any).l10_max;
    if (l10Max != null && l10Max <= line) {
      const ceilingMargin = line - l10Max;
      return { line, odds: pick.americanOdds, reason: `floor_lock_under_margin_${ceilingMargin.toFixed(1)}` };
    }
  }
  return null;
}
// ============= OPTIMAL COMBO: Combinatorial optimizer for highest combined L10 hit rate =============
function buildOptimalComboParlays(
  pool: { sweetSpots: EnrichedPick[] },
  profile: ParlayProfile,
  sportFilter: string[],
  BLOCKED_SPORTS: string[],
  maxCombos: number = 5,
): EnrichedPick[][] {
  const minHitRate = profile.minHitRate || 70;
  const legCount = profile.legs || 3;
  
  // Filter candidates: must have L10 hit rate data and pass gate
  const candidates = pool.sweetSpots.filter(p => {
    if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
    if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
    if (!p.has_real_line) return false;
    const hr = p.l10_hit_rate || p.confidence_score || 0;
    const hrPct = hr <= 1 ? hr * 100 : hr;
    return hrPct >= minHitRate;
  });
  
  if (candidates.length < legCount) {
    console.log(`[OptimalCombo] Only ${candidates.length} candidates with ${minHitRate}%+ L10 hit rate, need ${legCount}`);
    return [];
  }
  
  // Sort by L10 hit rate desc and cap at top 30 to keep C(30,3)=4060 manageable
  const sorted = [...candidates].sort((a, b) => {
    const aHr = (a.l10_hit_rate || 0) <= 1 ? (a.l10_hit_rate || 0) * 100 : (a.l10_hit_rate || 0);
    const bHr = (b.l10_hit_rate || 0) <= 1 ? (b.l10_hit_rate || 0) * 100 : (b.l10_hit_rate || 0);
    return bHr - aHr;
  }).slice(0, 30);
  
  console.log(`[OptimalCombo] Evaluating C(${sorted.length}, ${legCount}) combinations...`);
  
  // Generate all valid combinations and score them
  const combos: { picks: EnrichedPick[]; score: number }[] = [];
  
  function generateCombinations(start: number, current: EnrichedPick[]) {
    if (current.length === legCount) {
      // Check for correlations: no same player+prop combo, allow same player with different props
      const playerProps = new Set<string>();
      const gameIds = new Set<string>();
      let valid = true;
      for (const p of current) {
        const pName = (p.player_name || '').toLowerCase();
        const pProp = normalizePropTypeForCorrelation(p.prop_type || '');
        const ppKey = `${pName}|${pProp}`;
        if (playerProps.has(ppKey)) { valid = false; break; }
        playerProps.add(ppKey);
        // Also check combo/base overlap for same player
        const existingSoFar = current.slice(0, current.indexOf(p));
        const playerExistingLegs = existingSoFar
          .filter(e => (e.player_name || '').toLowerCase() === pName)
          .map(e => ({ player_name: e.player_name, prop_type: e.prop_type || '' }));
        if (playerExistingLegs.length > 0 && hasCorrelatedProp(playerExistingLegs, p.player_name, p.prop_type || '')) { valid = false; break; }
        const gId = (p as any).game_id || (p as any).event_id || '';
        if (gId && gameIds.has(gId)) {
          // Allow same game but different players (that's fine for props)
        }
      }
      if (!valid) return;
      
      // Check category usage: max 4 same category (relaxed for optimal_combo)
      const catCount = new Map<string, number>();
      for (const p of current) {
        const cat = p.category || '';
        catCount.set(cat, (catCount.get(cat) || 0) + 1);
        if ((catCount.get(cat) || 0) > 4) { valid = false; break; }
      }
      if (!valid) return;
      
      // Score by product of individual L10 hit rates
      const score = current.reduce((acc, p) => {
        const hr = p.l10_hit_rate || p.confidence_score || 0;
        const hrPct = hr <= 1 ? hr : hr / 100;
        return acc * hrPct;
      }, 1);
      
      combos.push({ picks: [...current], score });
      return;
    }
    for (let i = start; i < sorted.length; i++) {
      current.push(sorted[i]);
      generateCombinations(i + 1, current);
      current.pop();
    }
  }
  
  generateCombinations(0, []);
  
  if (combos.length === 0) {
    console.log(`[OptimalCombo] No valid ${legCount}-leg combinations found`);
    return [];
  }
  
  // Sort by combined probability (highest first)
  combos.sort((a, b) => b.score - a.score);
  
  // Select top non-overlapping combinations
  const selectedCombos: EnrichedPick[][] = [];
  const usedPlayers = new Set<string>();
  
  for (const combo of combos) {
    if (selectedCombos.length >= maxCombos) break;
    
    // Check if any player in this combo was already used
    const comboPlayers = combo.picks.map(p => (p.player_name || '').toLowerCase());
    const hasOverlap = comboPlayers.some(p => usedPlayers.has(p));
    
    if (!hasOverlap) {
      selectedCombos.push(combo.picks);
      comboPlayers.forEach(p => usedPlayers.add(p));
      const hrStr = combo.picks.map(p => {
        const hr = p.l10_hit_rate || 0;
        return `${p.player_name} ${(hr <= 1 ? hr * 100 : hr).toFixed(0)}%`;
      }).join(' × ');
      console.log(`[OptimalCombo] ✅ Combo ${selectedCombos.length}: ${hrStr} = ${(combo.score * 100).toFixed(1)}% combined`);
    }
  }
  
  console.log(`[OptimalCombo] Selected ${selectedCombos.length} non-overlapping ${legCount}-leg combos from ${combos.length} valid combinations`);
  return selectedCombos;
}

// ============= CEILING SHOT: Find alt line near player's L10 ceiling with plus-money odds =============
function selectCeilingLine(
  pick: EnrichedPick,
  alternateLines: AlternateLine[]
): SelectedLine | null {
  const l10Max = (pick as any).l10_max;
  const l10Avg = (pick as any).l10_avg || pick.projected_value || 0;
  const mainLine = pick.line;
  const side = (pick.recommended_side || 'over').toLowerCase();
  
  if (l10Max == null || l10Max <= 0 || !alternateLines || alternateLines.length === 0) return null;
  
  if (side === 'over') {
    // Find alt lines between mainLine and l10Max that have plus-money odds
    // Target: within 1-2 steps of l10Max (player has shown they can reach this)
    const targetMin = mainLine + 1; // Must be above standard line
    const targetMax = l10Max; // Can't exceed what they've actually done
    
    const viableAlts = alternateLines
      .filter(alt => {
        if (alt.line < targetMin || alt.line > targetMax) return false;
        const odds = alt.overOdds;
        return odds >= -130; // Relaxed from plus-money only — allow slight juice for ceiling shots
      })
      .map(alt => ({
        ...alt,
        distFromCeiling: l10Max - alt.line,
        relevantOdds: alt.overOdds,
      }))
      // Sort by highest line first (closest to ceiling = best value)
      .sort((a, b) => b.line - a.line);
    
    if (viableAlts.length === 0) return null;
    
    // Pick the highest viable alt line (closest to ceiling)
    const best = viableAlts[0];
    return {
      line: best.line,
      odds: best.relevantOdds,
      reason: `ceiling_shot_l10max_${l10Max}_alt_${best.line}`,
      originalLine: mainLine,
      oddsImprovement: best.relevantOdds - pick.americanOdds,
    };
  }
  
  if (side === 'under') {
    // For under ceiling shots: find lower alt lines with plus-money
    const l10Min = (pick as any).l10_min || 0;
    const targetMax = mainLine - 1;
    const targetMin = l10Min;
    
    const viableAlts = alternateLines
      .filter(alt => {
        if (alt.line > targetMax || alt.line < targetMin) return false;
        const odds = alt.underOdds;
        return odds >= -130; // Relaxed from plus-money only
      })
      .map(alt => ({
        ...alt,
        relevantOdds: alt.underOdds,
      }))
      .sort((a, b) => a.line - b.line); // Lowest line first for unders
    
    if (viableAlts.length === 0) return null;
    
    const best = viableAlts[0];
    return {
      line: best.line,
      odds: best.relevantOdds,
      reason: `ceiling_shot_under_l10min_${l10Min}_alt_${best.line}`,
      originalLine: mainLine,
      oddsImprovement: best.relevantOdds - pick.americanOdds,
    };
  }
  
  return null;
}

// ============= STRICT PROP OVERLAP PREVENTION =============
function normalizePropTypeForCorrelation(raw: string): string {
  const s = (raw || '').replace(/^(player_|batter_|pitcher_)/, '').toLowerCase().trim();
  if (/points.*rebounds.*assists|pts.*rebs.*asts|^pra$/.test(s)) return 'pra';
  if (/points.*rebounds|pts.*rebs|^pr$/.test(s)) return 'pr';
  if (/points.*assists|pts.*asts|^pa$/.test(s)) return 'pa';
  if (/rebounds.*assists|rebs.*asts|^ra$/.test(s)) return 'ra';
  if (/three_pointers|threes_made|^threes$/.test(s)) return 'threes';
  return s;
}

const COMBO_BASES: Record<string, string[]> = {
  pra: ['points', 'rebounds', 'assists'],
  pr: ['points', 'rebounds'],
  pa: ['points', 'assists'],
  ra: ['rebounds', 'assists'],
};

function hasCorrelatedProp(
  existingLegs: Array<{ player_name: string; prop_type: string }>,
  candidatePlayer: string,
  candidateProp: string
): boolean {
  const player = candidatePlayer.toLowerCase().trim();
  const prop = normalizePropTypeForCorrelation(candidateProp);

  const playerLegs = existingLegs
    .filter(l => l.player_name.toLowerCase().trim() === player)
    .map(l => normalizePropTypeForCorrelation(l.prop_type));

  if (playerLegs.length === 0) return false;

  // Combo + base overlap check
  const combos = Object.keys(COMBO_BASES);
  if (combos.includes(prop)) {
    const bases = COMBO_BASES[prop];
    if (playerLegs.some(s => bases.includes(s))) return true;
    if (playerLegs.some(s => combos.includes(s))) return true;
  }
  for (const existing of playerLegs) {
    if (combos.includes(existing)) {
      const bases = COMBO_BASES[existing];
      if (bases?.includes(prop)) return true;
    }
  }

  // Same player with different, non-correlated prop is ALLOWED
  // Check for exact same prop type (block duplicate prop on same player)
  if (playerLegs.includes(prop)) return true;
  
  return false; // Different prop type, no combo overlap = OK
}

// Normalize prop type to a canonical category for concentration tracking
function normalizePropTypeCategory(propType: string): string {
  const lower = (propType || '').toLowerCase();
  if (lower.includes('rebound')) return 'rebounds';
  if (lower.includes('assist')) return 'assists';
  if (lower.includes('three') || lower.includes('3pt')) return 'threes';
  if (lower.includes('block')) return 'blocks';
  if (lower.includes('steal')) return 'steals';
  if (lower.includes('point') && !lower.includes('rebound') && !lower.includes('assist')) return 'points';
  if (lower.includes('total') || lower.includes('spread') || lower.includes('moneyline')) return 'team_' + lower.split('_')[0];
  return 'other';
}

function canUsePickGlobally(pick: EnrichedPick | EnrichedTeamPick, tracker: UsageTracker, tierConfig: TierConfig, currentTier?: TierName, isSweetSpotProfile?: boolean, strategyName?: string): boolean {
  // === BLOCKED CATEGORIES GATE ===
  if (BLOCKED_CATEGORIES.has(pick.category)) {
    return false;
  }

  // === GLOBAL FLIP GATE ===
  // Force historically-losing categories to their winning side for ALL strategies
  if (strategyName) {
    const forcedSide = CASH_LOCK_FLIP_MAP[pick.category];
    if (forcedSide && 'recommended_side' in pick) {
      const pickSide = (pick as EnrichedPick).recommended_side?.toLowerCase();
      if (pickSide && pickSide !== forcedSide) {
        return false; // Skip pick - wrong side for this category in cash_lock
      }
    }
  }
  
  let key: string;
  
  if ('type' in pick && pick.type === 'team') {
    key = createTeamPickKey(pick.id, pick.bet_type, pick.side);
  } else {
    const playerPick = pick as EnrichedPick;
    key = createPickKey(playerPick.player_name, playerPick.prop_type, playerPick.recommended_side);
  }
  
  // Per-tier usedPicks check REMOVED — the global exposure cap (max 3 per player+prop+side)
  // handles cross-parlay dedup. The old check blocked each pick after 1 use within a tier,
  // limiting each tier to ~9 parlays with only ~28 unique picks.
  
  if ('player_name' in pick) {
    const playerCount = tracker.playerUsageCount.get(pick.player_name) || 0;
    if (playerCount >= tierConfig.maxPlayerUsage) return false;
  }
  
  // === CONFIDENCE GATE REMOVED ===
  // Tier-specific gates handle quality: Execution uses 70% L10 hit rate gate (65% thin pool, 75% light slate),
  // Validation uses minConfidence 0.52, Exploration uses minConfidence 0.45.
  // The redundant 70% global gate was starving all tiers of picks.
  
   // === GLOBAL SLATE EXPOSURE CAP (max 3 per player+prop+side globally) ===
  if ('player_name' in pick) {
    const playerPropSideKey = `${(pick.player_name || '').toLowerCase().trim()}|${normalizePropType((pick as any).prop_type || '')}|${((pick as any).recommended_side || (pick as any).side || 'over').toLowerCase()}`;
    const currentUsage = globalSlatePlayerPropUsage.get(playerPropSideKey) || 0;
    if (currentUsage >= 3) {
      return false;
    }
  }
  
  // === DEFENSE HARD-BLOCK GATE (execution tier only: no OVER vs top-5 stat-specific defense) ===
  if (currentTier === 'execution' && (pick as any).defenseHardBlocked) return false;
  
  // === THREES L10 FLOOR (execution only: 70% L10 required for threes) ===
  if (currentTier === 'execution' && (pick as any).threesL10Blocked) return false;
  
  return true;
}

function canUsePickInParlay(
  pick: EnrichedPick | EnrichedTeamPick,
  parlayTeamCount: Map<string, number>,
  parlayCategoryCount: Map<string, number>,
  tierConfig: TierConfig,
  existingLegs?: any[],
  parlayPropTypeCount?: Map<string, number>,
  totalLegs?: number,
  volumeMode: boolean = false
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
  
  // === PROP TYPE CONCENTRATION CAP ===
  // For 3-leg parlays: no cap (pool is small enough)
  // For 4+ legs: max 60% same prop type (or 67% in volume mode)
  if (parlayPropTypeCount && totalLegs && totalLegs > 3) {
    const propType = 'prop_type' in pick ? normalizePropTypeCategory(pick.prop_type) : 
                     'bet_type' in pick ? normalizePropTypeCategory(pick.bet_type) : 'other';
    const currentCount = parlayPropTypeCount.get(propType) || 0;
    const maxPropTypeLegs = volumeMode 
      ? Math.max(2, Math.floor(totalLegs * 0.67))
      : Math.max(2, Math.floor(totalLegs * 0.6));
    if (currentCount >= maxPropTypeLegs) {
      console.log(`[PropTypeCap] Blocked ${('player_name' in pick ? pick.player_name : pick.home_team)} - ${propType} already at ${currentCount}/${maxPropTypeLegs} max for ${totalLegs}-leg parlay`);
      return false;
    }
  }
  
  // Team conflict detection: no contradictory or duplicate same-game legs
  if ('type' in pick && pick.type === 'team' && existingLegs) {
    if (!canAddTeamLegToParlay(pick as EnrichedTeamPick, existingLegs)) return false;
  }
  
  // STRICT: No correlated props for same player in parlay
  if ('player_name' in pick && existingLegs && existingLegs.length > 0) {
    const playerLegsInParlay = existingLegs
      .filter((l: any) => l.player_name)
      .map((l: any) => ({ player_name: l.player_name, prop_type: l.prop_type || l.bet_type || '' }));
    if (hasCorrelatedProp(playerLegsInParlay, (pick as any).player_name, (pick as any).prop_type || (pick as any).bet_type || '')) return false;
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

  // Source 3: Derive teams from unified_props active players + bdl_player_cache
  // This ensures correct detection even when upcoming_games_cache is stale
  const { data: activeProps } = await supabase
    .from('unified_props')
    .select('player_name')
    .gte('created_at', new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
    .limit(1000);

  if (activeProps && activeProps.length > 0) {
    const playerNames = [...new Set((activeProps as any[]).map((p: any) => p.player_name).filter(Boolean))];
    // Batch in chunks of 200 to avoid query limits
    for (let i = 0; i < playerNames.length; i += 200) {
      const batch = playerNames.slice(i, i + 200);
      const { data: playerTeams } = await supabase
        .from('bdl_player_cache')
        .select('player_name, team_name')
        .in('player_name', batch);

      (playerTeams || []).forEach((p: any) => {
        if (p.team_name) teams.add(p.team_name.toLowerCase().trim());
      });
    }
    console.log(`[GameSchedule] After unified_props cross-ref: ${teams.size} teams playing today (from ${playerNames.length} active players)`);
  }

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
    .select('player_name, alert_type, updated_at')
    .gte('game_date', yesterdayStr)
    .lte('game_date', gameDate);

  if (error) {
    console.error('[AvailabilityGate] Error fetching injury blocklist:', error);
    return { blocklist, penalties };
  }

  // Log freshness of injury data
  if (data && data.length > 0) {
    const mostRecent = data.reduce((latest: string, a: any) => a.updated_at > latest ? a.updated_at : latest, '');
    const ageMs = Date.now() - new Date(mostRecent).getTime();
    const ageHours = (ageMs / 3600000).toFixed(1);
    console.log(`[AvailabilityGate] Injury data freshness: most recent update ${ageHours}h ago (${mostRecent})`);
    if (ageMs > 3 * 3600000) {
      console.warn(`[AvailabilityGate] ⚠️ WARNING: Injury data is ${ageHours}h stale — lineup scraper may not have run recently`);
    }
  } else {
    console.warn('[AvailabilityGate] ⚠️ No injury alerts found for today — lineup scraper may not have run');
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

// === MATCHUP DEFENSE SCAN INTELLIGENCE ===
async function fetchMatchupDefenseScan(supabase: any, gameDate: string): Promise<Map<string, { prop_type: string; priority: 'prime' | 'favorable' | 'avoid'; defense_rank: number }>> {
  const matchupMap = new Map<string, { prop_type: string; priority: 'prime' | 'favorable' | 'avoid'; defense_rank: number }>();
  try {
    const { data } = await supabase
      .from('bot_research_findings')
      .select('key_insights')
      .eq('category', 'matchup_defense_scan')
      .eq('research_date', gameDate)
      .maybeSingle();

    if (data?.key_insights?.recommendations) {
      for (const rec of data.key_insights.recommendations) {
        const key = `${(rec.attacking_team || '').toUpperCase()}|${(rec.prop_type || '').toLowerCase()}`;
        matchupMap.set(key, {
          prop_type: rec.prop_type,
          priority: rec.priority,
          defense_rank: rec.defense_rank,
        });
      }
      console.log(`[MatchupBoost] Loaded ${matchupMap.size} matchup recommendations for ${gameDate}`);
    }
  } catch (err) {
    console.log(`[MatchupBoost] Failed to load matchup scan: ${err.message}`);
  }
  return matchupMap;
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
    if (cw.current_hit_rate < 30 && (cw.total_picks || 0) >= 10) {
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

  const [activePlayersToday, injuryData, teamsPlayingToday, researchBlocklist, researchEdge, weatherBiasMap, ncaabResearch, whaleAndSituational, tennisIntel, matchupDefenseScan] = await Promise.all([
    fetchActivePlayersToday(supabase, startUtc, endUtc),
    fetchInjuryBlocklist(supabase, gameDate),
    fetchTeamsPlayingToday(supabase, startUtc, endUtc, gameDate),
    fetchResearchInjuryIntel(supabase, gameDate),
    fetchResearchEdgeThreshold(supabase),
    fetchResearchPitchingWeather(supabase, gameDate),
    fetchResearchNcaabIntel(supabase, gameDate),
    fetchResearchWhaleAndSituational(supabase, gameDate),
    fetchResearchTennisIntel(supabase, gameDate),
    fetchMatchupDefenseScan(supabase, gameDate),
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

  // Build blowout game info for blowout_script strategy
  const blowoutGameInfos: BlowoutGameInfo[] = [];
  for (const flag of gameContextFlags) {
    if (flag.type === 'blowout_risk' && flag.home_team && flag.away_team) {
      const spread = (flag as any).spread || 0;
      // Determine underdog: positive spread = home is underdog, negative = away is underdog
      // If no spread data in flag, we'll fill from envMap later
      blowoutGameInfos.push({
        home_team: flag.home_team.toLowerCase(),
        away_team: flag.away_team.toLowerCase(),
        spread,
        underdog: spread >= 0 ? flag.home_team.toLowerCase() : flag.away_team.toLowerCase(),
        favorite: spread >= 0 ? flag.away_team.toLowerCase() : flag.home_team.toLowerCase(),
      });
    }
  }

  // 1. Sweet spot picks (analyzed player props) - only picks with real market lines
  const { data: sweetSpots } = await supabase
    .from('category_sweet_spots')
    .select('*, actual_line, recommended_line, bookmaker')
    .eq('analysis_date', targetDate)
    .not('actual_line', 'is', null)
    .gte('confidence_score', 0.45)
    .order('confidence_score', { ascending: false })
    .limit(500);

  // === STEP 1: BUILD SWEET SPOT LOOKUP MAP FOR CROSS-REFERENCING ===
  const PROP_TYPE_NORMALIZE: Record<string, string> = {
    'player_points': 'points', 'player_rebounds': 'rebounds', 'player_assists': 'assists',
    'player_threes': 'threes', 'player_blocks': 'blocks', 'player_steals': 'steals',
    'player_points_rebounds': 'pr', 'player_points_assists': 'pa',
    'player_rebounds_assists': 'ra', 'player_points_rebounds_assists': 'pra',
    'batter_hits': 'hits', 'batter_total_bases': 'total_bases', 'batter_rbis': 'rbis',
    'batter_runs': 'runs', 'batter_walks': 'walks',
    'pitcher_strikeouts': 'strikeouts', 'pitcher_earned_runs': 'earned_runs', 'pitcher_outs': 'outs',
    // Non-prefixed aliases for combo props
    'points_rebounds_assists': 'pra', 'pts_rebs_asts': 'pra', 'pra': 'pra',
    'points_rebounds': 'pr', 'pts_rebs': 'pr', 'pr': 'pr',
    'points_assists': 'pa', 'pts_asts': 'pa', 'pa': 'pa',
    'rebounds_assists': 'ra', 'rebs_asts': 'ra', 'ra': 'ra',
    'three_pointers': 'threes', 'threes_made': 'threes', 'threes': 'threes',
    'points': 'points', 'rebounds': 'rebounds', 'assists': 'assists',
    'blocks': 'blocks', 'steals': 'steals',
    'hits': 'hits', 'total_bases': 'total_bases', 'rbis': 'rbis',
    'runs': 'runs', 'walks': 'walks', 'strikeouts': 'strikeouts',
    'earned_runs': 'earned_runs', 'outs': 'outs',
  };

  const sweetSpotLookup = new Map<string, {
    l10_hit_rate: number; archetype: string; category: string;
    confidence_score: number; l10_avg: number; recommended_side: string;
  }>();
  for (const ss of (sweetSpots || [])) {
    const key = `${(ss.player_name || '').toLowerCase().trim()}|${(ss.prop_type || '').toLowerCase().trim()}`;
    sweetSpotLookup.set(key, {
      l10_hit_rate: ss.l10_hit_rate || 0,
      archetype: ss.archetype || 'UNKNOWN',
      category: ss.category || '',
      confidence_score: ss.confidence_score || 0,
      l10_avg: ss.l10_avg || 0,
      recommended_side: ss.recommended_side || 'over',
    });
  }
  console.log(`[Bot] Sweet spot lookup map built: ${sweetSpotLookup.size} entries for cross-referencing`);

  // 2. Live odds from unified_props - FanDuel preferred, fallback to all books
  const { data: fanduelProps } = await supabase
    .from('unified_props')
    .select('*')
    .eq('is_active', true)
    .eq('bookmaker', 'fanduel')
    .gte('commence_time', startUtc)
    .lt('commence_time', endUtc)
    .limit(500);

  let playerProps = fanduelProps;
  let oddsSource = 'fanduel';

  if (!fanduelProps || fanduelProps.length < 20) {
    console.log(`[Bot] FanDuel props thin (${fanduelProps?.length || 0}), falling back to all bookmakers`);
    const { data: allProps } = await supabase
      .from('unified_props')
      .select('*')
      .eq('is_active', true)
      .gte('commence_time', startUtc)
      .lt('commence_time', endUtc)
      .limit(500);
    playerProps = allProps;
    oddsSource = 'all_books';
  }

  console.log(`[Bot] Odds source: ${oddsSource} (${playerProps?.length || 0} props loaded)`);

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

  // 5. Mispriced lines — statistical edge picks
  const { data: rawMispricedLines } = await supabase
    .from('mispriced_lines')
    .select('player_name, prop_type, signal, edge_pct, confidence_tier, book_line, player_avg_l10, sport, defense_adjusted_avg, opponent_defense_rank, shooting_context')
    .eq('analysis_date', targetDate)
    .gte('edge_pct', 3) // require minimum 3% positive edge
    .order('edge_pct', { ascending: false })
    .limit(100);

  // 5b. Correct-priced lines — stable anchor picks (3-14% edge)
  const { data: rawCorrectPricedLines } = await supabase
    .from('correct_priced_lines')
    .select('player_name, prop_type, signal, edge_pct, confidence_tier, book_line, player_avg_l10, sport, defense_adjusted_avg, opponent_defense_rank')
    .eq('analysis_date', targetDate)
    .gte('edge_pct', 3)
    .order('edge_pct', { ascending: false })
    .limit(100);

  console.log(`[Bot] Fetched ${(rawMispricedLines || []).length} mispriced lines, ${(rawCorrectPricedLines || []).length} correct-priced lines for ${targetDate}`);

  const [paceResult, defenseResult, envResult, homeCourtResult, ncaabStatsResult, nhlStatsResult, baseballStatsResult] = await Promise.all([
    supabase.from('nba_team_pace_projections').select('team_abbrev, team_name, pace_rating, pace_rank, tempo_factor'),
    supabase.from('team_defense_rankings').select('team_abbreviation, team_name, overall_rank, opp_rebounds_allowed_pg, opp_assists_allowed_pg, opp_rebounds_rank, opp_assists_rank, opp_points_rank, opp_threes_rank, off_points_rank, off_rebounds_rank, off_assists_rank, off_threes_rank, off_pace_rank').eq('is_current', true),
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
    if (p.team_name) {
      nameToAbbrev.set(p.team_name, p.team_abbrev);
      nameToAbbrev.set(p.team_name.toLowerCase(), p.team_abbrev);
    }
  });

  const defenseMap = new Map<string, number>();
  const defenseDetailMap = new Map<string, { overall_rank: number; opp_rebounds_rank: number | null; opp_assists_rank: number | null; opp_points_rank: number | null; opp_threes_rank: number | null; off_points_rank: number | null; off_rebounds_rank: number | null; off_assists_rank: number | null; off_threes_rank: number | null; off_pace_rank: number | null }>();
  (defenseResult.data || []).forEach((d: any) => {
    defenseMap.set(d.team_abbreviation, d.overall_rank);
    const detail = {
      overall_rank: d.overall_rank,
      opp_rebounds_rank: d.opp_rebounds_rank,
      opp_assists_rank: d.opp_assists_rank,
      opp_points_rank: d.opp_points_rank,
      opp_threes_rank: d.opp_threes_rank,
      off_points_rank: d.off_points_rank,
      off_rebounds_rank: d.off_rebounds_rank,
      off_assists_rank: d.off_assists_rank,
      off_threes_rank: d.off_threes_rank,
      off_pace_rank: d.off_pace_rank,
    };
    defenseDetailMap.set(d.team_abbreviation, detail);
    if (d.team_name) {
      nameToAbbrev.set(d.team_name, d.team_abbreviation);
      nameToAbbrev.set(d.team_name.toLowerCase(), d.team_abbreviation);
      defenseDetailMap.set(d.team_name, detail);
      defenseDetailMap.set(d.team_name.toLowerCase(), detail);
    }
  });

  const envMap = new Map<string, GameEnvData>();
  (envResult.data || []).forEach((e: any) => {
    envMap.set(`${e.home_team_abbrev}_${e.away_team_abbrev}`, {
      vegas_total: e.vegas_total, vegas_spread: e.vegas_spread,
      shootout_factor: e.shootout_factor, grind_factor: e.grind_factor,
      blowout_probability: e.blowout_probability,
    });
  });

  // Supplement blowout game info from envMap spread data (for games not caught by context analyzer)
  for (const [key, env] of envMap.entries()) {
    const [homeAbbrev, awayAbbrev] = key.split('_');
    if (!homeAbbrev || !awayAbbrev) continue;
    if (Math.abs(env.vegas_spread) >= 8) {
      const alreadyTracked = blowoutGameInfos.some(
        bg => (bg.home_team === homeAbbrev.toLowerCase() || bg.away_team === homeAbbrev.toLowerCase())
      );
      if (!alreadyTracked) {
        // vegas_spread convention: negative = home favored
        const underdog = env.vegas_spread < 0 ? awayAbbrev.toLowerCase() : homeAbbrev.toLowerCase();
        const favorite = env.vegas_spread < 0 ? homeAbbrev.toLowerCase() : awayAbbrev.toLowerCase();
        blowoutGameInfos.push({
          home_team: homeAbbrev.toLowerCase(),
          away_team: awayAbbrev.toLowerCase(),
          spread: env.vegas_spread,
          underdog,
          favorite,
        });
      }
    }
  }
  if (blowoutGameInfos.length > 0) {
    console.log(`[Bot] 💥 Blowout games detected: ${blowoutGameInfos.map(bg => `${bg.underdog} (+${Math.abs(bg.spread).toFixed(1)}) vs ${bg.favorite}`).join(', ')}`);
  }

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

  // === LOAD TEAM TOTAL SIGNALS FOR CROSS-REFERENCE ===
  const { data: teamTotalBets } = await supabase
    .from('game_bets')
    .select('home_team, away_team, recommended_side, composite_score, sport')
    .eq('bet_type', 'total')
    .eq('is_active', true)
    .in('sport', ['basketball_nba', 'basketball_ncaab']);

  const teamTotalSignalMap = new Map<string, { side: string; compositeScore: number; sport: string }>();
  for (const tb of teamTotalBets || []) {
    if (!tb.recommended_side || !tb.composite_score) continue;
    const entry = {
      side: tb.recommended_side.toUpperCase(),
      compositeScore: Number(tb.composite_score),
      sport: tb.sport || '',
    };
    // Map by team abbreviation (try nameToAbbrev lookup)
    for (const teamName of [tb.home_team, tb.away_team]) {
      if (!teamName) continue;
      const abbrev = nameToAbbrev.get(teamName.toLowerCase()) || teamName.toLowerCase();
      teamTotalSignalMap.set(abbrev, entry);
    }
  }
  console.log(`[Bot] Loaded ${teamTotalSignalMap.size} team total signals for cross-reference`);

  // === BUILD TEAM GAME CONTEXT MAP FOR INTELLIGENT STACKING ===
  const teamGameContextMap = buildTeamGameContextMap(envMap, paceMap, defenseMap, nameToAbbrev, teamTotalSignalMap);
  console.log(`[Bot] Built game context map for ${teamGameContextMap.size} teams (stacking intelligence + team totals)`);

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
  const staleCount = allTeamProps.filter(tp => isStaleOdds(tp.updated_at, tp.sport)).length;
  const teamProps = allTeamProps.filter(tp => {
    if (isStaleOdds(tp.updated_at, tp.sport)) {
      return false; // Skip picks with odds data beyond threshold (6h NBA/NHL, 24h NCAAB)
    }
    return true;
  });
  if (staleCount > 0) {
    console.log(`[StaleOdds] Filtered out ${staleCount} team props with stale odds (>6h NBA/NHL, >24h NCAAB)`);
  }

  // === SPORT-SHIFT WEIGHTING ===
  const availableSports = new Set<string>();
  teamProps.forEach(tp => { if (tp.sport) availableSports.add(tp.sport); });
  (playerProps || []).forEach((pp: any) => { if (pp.sport) availableSports.add(pp.sport); });
  const sportShiftMultipliers = computeSportShiftMultipliers(availableSports);
  console.log(`[SportShift] Available sports: ${[...availableSports].join(', ')}`);

  console.log(`[Bot] Raw data: ${(sweetSpots || []).length} sweet spots, ${(playerProps || []).length} unified_props, ${(rawTeamProps || []).length} raw team bets → ${teamProps.length} deduped (${staleCount} stale removed)`);

  // Build odds map with normalized aliases for prop type + player name matching
  const oddsMap = new Map<string, { overOdds: number; underOdds: number; line: number; sport: string; event_id?: string }>();
  const stripTrailingPeriods = (name: string) => name.replace(/\.(\s|$)/g, '$1').trim();
  (playerProps || []).forEach((od: any) => {
    const rawName = (od.player_name || '').toLowerCase();
    const normName = stripTrailingPeriods(rawName);
    const rawProp = (od.prop_type || '').toLowerCase();
    const normProp = PROP_TYPE_NORMALIZE[rawProp] || rawProp;
    const entry = {
      overOdds: od.over_price || -110,
      underOdds: od.under_price || -110,
      line: od.current_line,
      sport: od.sport,
      event_id: od.event_id || undefined,
    };
    // Index under raw key
    oddsMap.set(`${rawName}_${rawProp}`, entry);
    // Index under normalized prop type (e.g., player_threes → threes)
    if (normProp !== rawProp) oddsMap.set(`${rawName}_${normProp}`, entry);
    // Index under normalized name (strip trailing periods: Jr. → Jr)
    if (normName !== rawName) {
      oddsMap.set(`${normName}_${rawProp}`, entry);
      if (normProp !== rawProp) oddsMap.set(`${normName}_${normProp}`, entry);
    }
  });
  console.log(`[OddsMap] Built ${oddsMap.size} entries (with normalized aliases)`);

  // === PLAYER TEAM MAP: Resolve team_name for each player from most recent game log ===
  // category_sweet_spots has no team_name column — we must look it up from nba_player_game_logs
  const playerTeamMap = new Map<string, string>();
  try {
    const { data: playerTeamRows } = await supabase
      .from('bdl_player_cache')
      .select('player_name, team_name')
      .not('team_name', 'is', null);
    for (const row of playerTeamRows || []) {
      const key = (row.player_name || '').toLowerCase().trim();
      if (key && row.team_name && !playerTeamMap.has(key)) {
        playerTeamMap.set(key, row.team_name);
      }
    }
    console.log(`[PlayerTeamMap] Resolved ${playerTeamMap.size} player→team mappings from bdl_player_cache`);
  } catch (ptmErr) {
    console.warn(`[PlayerTeamMap] Failed to build player team map: ${ptmErr}`);
  }

  // === DERIVE SPORT FROM CATEGORY ===
  // category_sweet_spots has no sport column — derive from category prefix
  function deriveSportFromCategory(category: string): string {
    const cat = (category || '').toUpperCase();
    if (cat.startsWith('NHL_')) return 'icehockey_nhl';
    if (cat.startsWith('MLB_') || cat.startsWith('PITCHER_') || cat.startsWith('HITTER_') || cat.startsWith('BATTER_')) return 'baseball_mlb';
    if (cat.startsWith('NCAAB_')) return 'basketball_ncaab';
    if (cat.startsWith('NCAAF_')) return 'americanfootball_ncaaf';
    if (cat.startsWith('NFL_')) return 'americanfootball_nfl';
    return 'basketball_nba';
  }

  // Enrich sweet spots
  let enrichedSweetSpots: EnrichedPick[] = (sweetSpots || []).map((pick: SweetSpotPick) => {
    // Resolve oddsKey FIRST — used for both line override and odds lookup
    const rawProp = (pick.prop_type || '').toLowerCase();
    const normProp = PROP_TYPE_NORMALIZE[rawProp] || rawProp;
    const rawOddsKey = `${pick.player_name}_${rawProp}`.toLowerCase();
    const normOddsKey = `${pick.player_name}_${normProp}`.toLowerCase();
    const oddsEntry = oddsMap.get(rawOddsKey) || oddsMap.get(normOddsKey) || oddsMap.get(stripTrailingPeriods(rawOddsKey)) || oddsMap.get(stripTrailingPeriods(normOddsKey));

    // CRITICAL: Use the real sportsbook line from unified_props when available.
    // category_sweet_spots stores recommended_line=0.5 for THREE_POINT_SHOOTER (historical sweet spot)
    // but the actual sportsbook line is 2.5 or 3.5. The oddsMap has the correct current_line.
    const realSportsbookLine = oddsEntry?.line && oddsEntry.line > 0 ? oddsEntry.line : null;
    const line = pick.actual_line ?? realSportsbookLine ?? pick.recommended_line ?? pick.line;
    const lineWasOverridden = !pick.actual_line && realSportsbookLine !== null && realSportsbookLine !== pick.recommended_line;

    // Check if this player has real sportsbook odds in unified_props (oddsMap)
    const hasRealLine = !!oddsEntry || (pick.actual_line !== null && pick.actual_line !== undefined);

    const odds = oddsEntry || { overOdds: -110, underOdds: -110, line: 0, sport: 'basketball_nba' };
    const side = pick.recommended_side || 'over';
    const americanOdds = side === 'over' ? odds.overOdds : odds.underOdds;

    // If the line was overridden to the real sportsbook line (e.g., 2.5 instead of 0.5),
    // cap the historical hit rate at 75% since the 0.5 hit rate doesn't apply to the real line
    const rawHitRateDecimal = pick.l10_hit_rate || pick.confidence_score || 0.5;
    const hitRateDecimal = lineWasOverridden ? Math.min(rawHitRateDecimal, 0.75) : rawHitRateDecimal;
    const hitRatePercent = hitRateDecimal * 100;
    const projectedValue = pick.projected_value || pick.l10_avg || pick.l10_median || line || 0;
    const edge = projectedValue - (line || 0);
    const pickSport = pick.sport || deriveSportFromCategory(pick.category);
    const categoryWeight = weightMap.get(`${pick.category}__${pick.recommended_side}__${pickSport}`) ?? weightMap.get(`${pick.category}__${pick.recommended_side}`) ?? weightMap.get(pick.category) ?? 1.0;
    
    const oddsValueScore = calculateOddsValueScore(americanOdds, hitRateDecimal);
    const catHitRate = calibratedHitRateMap.get(pick.category);
    const playerBonus = getPlayerBonus(pick.player_name, pick.prop_type);
    let compositeScore = calculateCompositeScore(hitRatePercent, edge, oddsValueScore, categoryWeight, catHitRate, side, undefined, playerBonus);
    // Apply day-type matchup boost/penalty
    const dayBoost = getDayTypeBoost(pick.prop_type, currentDayTypeSignal);
    compositeScore += dayBoost;
    
    // Resolve team_name: category_sweet_spots has no team_name column, so we pull from playerTeamMap
    const resolvedTeamName = (pick as any).team_name || 
      playerTeamMap.get((pick.player_name || '').toLowerCase().trim()) || '';

    // Attach game context for stacking intelligence
    const teamAbbrev = nameToAbbrev.get(resolvedTeamName) || nameToAbbrev.get(resolvedTeamName.toLowerCase()) || '';
    const gameCtx = teamAbbrev ? teamGameContextMap.get(teamAbbrev) : undefined;

    return {
      ...pick,
      line,
      recommended_side: side,
      americanOdds,
      oddsValueScore,
      compositeScore,
      has_real_line: hasRealLine,
      line_source: hasRealLine ? 'verified' : 'projected',
      sport: pick.sport || deriveSportFromCategory(pick.category),
      team_name: resolvedTeamName,
      event_id: oddsEntry?.event_id || pick.event_id || undefined,
      _gameContext: (() => {
        if (!gameCtx) return null;
        const side = (pick.recommended_side || '').toLowerCase();
        const { cluster, strength } = classifyEnvironmentCluster(gameCtx, side);
        return { ...gameCtx, envCluster: cluster, envClusterStrength: strength };
      })(),
    };
  }).filter((p: EnrichedPick) => {
    // ALL picks in this array are sweet spots (from category_sweet_spots) — engine already vetted them
    // Only block if hit-rate blocked category
    if (blockedByHitRate.has(p.category)) return false;
    // REQUIRE real FanDuel sportsbook line — NO exceptions
    if (!p.has_real_line) return false;
    return true;
  });

  // Block NCAAB player props from ever entering the pick pool
  enrichedSweetSpots = enrichedSweetSpots.filter(p => p.sport !== 'basketball_ncaab');

  // === INLINE L3 BACKFILL: Compute l3_avg from nba_player_game_logs for NBA picks missing it ===
  {
    const missingL3 = enrichedSweetSpots.filter(p => (p as any).l3_avg == null && (p.sport || 'basketball_nba') === 'basketball_nba');
    if (missingL3.length > 0) {
      const uniqueNames = [...new Set(missingL3.map(p => p.player_name))];
      console.log(`[L3Backfill] ${missingL3.length} NBA picks missing l3_avg, fetching game logs for ${uniqueNames.length} players`);
      
      // Batch fetch game logs for these players (last 3 games each)
      const l3Map = new Map<string, Map<string, number>>();
      const batchSize = 50;
      for (let i = 0; i < uniqueNames.length; i += batchSize) {
        const batch = uniqueNames.slice(i, i + batchSize);
        const { data: logs } = await supabase
          .from('nba_player_game_logs')
          .select('player_name, game_date, pts, reb, ast, stl, blk, fg3m, tov, pra')
          .in('player_name', batch)
          .order('game_date', { ascending: false })
          .limit(batch.length * 3);
        
        if (logs) {
          for (const log of logs) {
            const name = log.player_name;
            if (!l3Map.has(name)) l3Map.set(name, new Map());
            const playerLogs = l3Map.get(name)!;
            // Only keep first 3 per player
            if (playerLogs.size >= 3) continue;
            // Store each stat type
            const statMap: Record<string, number> = {
              points: log.pts || 0,
              rebounds: log.reb || 0,
              assists: log.ast || 0,
              steals: log.stl || 0,
              blocks: log.blk || 0,
              threes: log.fg3m || 0,
              turnovers: log.tov || 0,
              pts_rebs_asts: log.pra || 0,
            };
            const dateKey = log.game_date;
            if (!playerLogs.has(dateKey)) {
              playerLogs.set(dateKey, 0); // placeholder
            }
            // Store full stat row keyed by date
            if (!(l3Map as any)._stats) (l3Map as any)._stats = new Map();
            const statsStore = (l3Map as any)._stats as Map<string, any[]>;
            if (!statsStore.has(name)) statsStore.set(name, []);
            const existing = statsStore.get(name)!;
            if (existing.length < 3) existing.push(statMap);
          }
        }
      }
      
      // Apply L3 averages to picks
      let backfilled = 0;
      const statsStore = (l3Map as any)._stats as Map<string, any[]> | undefined;
      for (const pick of missingL3) {
        const playerStats = statsStore?.get(pick.player_name);
        if (!playerStats || playerStats.length < 3) continue;
        
        const propType = (pick.prop_type || '').toLowerCase();
        let statKey = 'points';
        if (propType.includes('rebound')) statKey = 'rebounds';
        else if (propType.includes('assist')) statKey = 'assists';
        else if (propType.includes('steal')) statKey = 'steals';
        else if (propType.includes('block')) statKey = 'blocks';
        else if (propType.includes('three') || propType.includes('3p')) statKey = 'threes';
        else if (propType.includes('turnover')) statKey = 'turnovers';
        else if (propType.includes('pts') && propType.includes('reb') && propType.includes('ast')) statKey = 'pts_rebs_asts';
        
        const values = playerStats.map((s: any) => s[statKey] || 0);
        const l3Avg = Math.round((values.reduce((a: number, b: number) => a + b, 0) / values.length) * 100) / 100;
        (pick as any).l3_avg = l3Avg;
        backfilled++;
      }
      console.log(`[L3Backfill] Backfilled l3_avg for ${backfilled}/${missingL3.length} NBA picks`);
    }
  }

  // === L3 RECENCY GATE: Block picks with sharp recent performance declines ===
  {
    const preL3Count = enrichedSweetSpots.length;
    let l3Blocked = 0;
    enrichedSweetSpots = enrichedSweetSpots.filter(p => {
      const l3Avg = (p as any).l3_avg;
      const l10Avg = (p as any).l10_avg;
      if (l3Avg == null) {
        console.log(`[L3Gate] Blocked ${p.player_name} ${p.prop_type}: no L3 data available`);
        l3Blocked++;
        return false;
      }
      if (l10Avg == null || l10Avg === 0) return true; // No L10 data, allow through
      const ratio = l3Avg / l10Avg;
      const side = (p.recommended_side || '').toLowerCase();
      // OVER picks: block if L3 avg dropped 25%+ below L10 avg (player trending down)
      if (side === 'over' && ratio < 0.75) {
        console.log(`[L3Gate] Blocked OVER ${p.player_name} ${p.prop_type}: L3=${l3Avg.toFixed(1)} vs L10=${l10Avg.toFixed(1)} (ratio ${ratio.toFixed(2)})`);
        l3Blocked++;
        return false;
      }
      // UNDER picks: block if L3 avg surged 25%+ above L10 avg (player trending up)
      if (side === 'under' && ratio > 1.25) {
        console.log(`[L3Gate] Blocked UNDER ${p.player_name} ${p.prop_type}: L3=${l3Avg.toFixed(1)} vs L10=${l10Avg.toFixed(1)} (ratio ${ratio.toFixed(2)})`);
        l3Blocked++;
        return false;
      }
      return true;
    });
    if (l3Blocked > 0) {
      console.log(`[L3Gate] Blocked ${l3Blocked}/${preL3Count} picks due to L3 recency decline`);
    }
  }

  // Block catastrophic prop types (static + dynamic from bot_prop_type_performance)
    {
      const prePropTypeCount = enrichedSweetSpots.length;
      enrichedSweetSpots = enrichedSweetSpots.filter(p => {
        const propType = (p.prop_type || p.bet_type || '').toLowerCase();
        if (isPropTypeBlocked(propType)) {
          console.log(`[BlockedPropType] Filtered ${propType} pick for ${p.player_name}`);
          return false;
        }
        return true;
      });
      if (prePropTypeCount !== enrichedSweetSpots.length) {
        console.log(`[BlockedPropType] Removed ${prePropTypeCount - enrichedSweetSpots.length} blocked prop type picks`);
      }
    }

    // Apply prop type boost multiplier from performance data
    for (const pick of enrichedSweetSpots) {
      const propType = (pick.prop_type || '').toLowerCase();
      const boostMultiplier = dynamicBoostedPropTypes.get(propType);
      if (boostMultiplier && boostMultiplier > 1.0) {
        pick.compositeScore = Math.round(pick.compositeScore * boostMultiplier);
      }
    }

  console.log(`[Bot] Filtered to ${enrichedSweetSpots.length} picks with verified sportsbook lines (removed projected-only legs, blocked NCAAB player props, blocked prop types)`);

  // === BLOWUP RISK FILTER: Block/penalize UNDER picks on high-ceiling volatile players ===
  let blowupBlocked = 0;
  let blowupPenalized = 0;
  for (const pick of enrichedSweetSpots) {
    const side = (pick.recommended_side || '').toLowerCase();
    if (side !== 'under') continue;
    
    const l10Max = (pick as any).l10_max;
    const l10Avg = (pick as any).l10_avg || pick.projected_value || 0;
    const l10StdDev = (pick as any).l10_std_dev;
    const line = pick.line || 0;
    if (!l10Max || l10Max <= 0 || line <= 0) continue;
    
    const ceilingRatio = l10Max / line;
    const margin = line - l10Avg;
    
    // HARD BLOCK: Ceiling is 50%+ above the line — player can easily blow past it
    if (ceilingRatio >= 1.5) {
      console.log(`[BlowupRisk] 🚫 HARD BLOCK: ${pick.player_name} UNDER ${line} — L10 max ${l10Max} is ${Math.round((ceilingRatio - 1) * 100)}% above line`);
      pick.compositeScore = 0;
      (pick as any).blowupBlocked = true;
      blowupBlocked++;
      continue;
    }
    
    // HARD BLOCK: High variance relative to margin — std dev alone can blow past line
    if (l10StdDev && margin > 0 && l10StdDev > margin * 1.5) {
      console.log(`[BlowupRisk] 🚫 HARD BLOCK: ${pick.player_name} UNDER ${line} — L10 std_dev ${l10StdDev.toFixed(1)} > margin ${margin.toFixed(1)} × 1.5`);
      pick.compositeScore = 0;
      (pick as any).blowupBlocked = true;
      blowupBlocked++;
      continue;
    }
    
    // SOFT PENALTY: Ceiling is 25-50% above line — deprioritize
    if (ceilingRatio >= 1.25) {
      console.log(`[BlowupRisk] ⚠️ PENALTY: ${pick.player_name} UNDER ${line} — L10 max ${l10Max} is ${Math.round((ceilingRatio - 1) * 100)}% above line (-15)`);
      pick.compositeScore = Math.max(0, pick.compositeScore - 15);
      blowupPenalized++;
    }
  }
  if (blowupBlocked > 0 || blowupPenalized > 0) {
    console.log(`[BlowupRisk] Blocked ${blowupBlocked}, penalized ${blowupPenalized} UNDER picks for blowup ceiling risk`);
  }

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
    
    // TEAM TOTAL ALIGNMENT: Adjust composite scores based on game total signal
    const ctx = pick._gameContext as PickGameContext | undefined;
    if (ctx?.teamTotalSignal && ctx?.teamTotalComposite && ctx.teamTotalComposite >= 70) {
      const pickSide = (pick.recommended_side || pick.side || '').toLowerCase();
      const isAligned = (pickSide === 'over' && ctx.teamTotalSignal === 'OVER') ||
                        (pickSide === 'under' && ctx.teamTotalSignal === 'UNDER');
      const isConflict = (pickSide === 'over' && ctx.teamTotalSignal === 'UNDER') ||
                         (pickSide === 'under' && ctx.teamTotalSignal === 'OVER');

      if (isAligned) {
        pick.compositeScore += 8;
        contextAdjustments++;
      } else if (isConflict) {
        const penalty = pickSide === 'over' ? -12 : -10;
        pick.compositeScore = Math.max(0, pick.compositeScore + penalty);
        contextAdjustments++;
      }

      // NCAAB HARD-BLOCK: Player OVERs in strong UNDER games
      if (ctx.teamTotalSport === 'basketball_ncaab' && 
          ctx.teamTotalSignal === 'UNDER' && ctx.teamTotalComposite >= 75 &&
          pickSide === 'over' && pick.player_name) {
        pick.compositeScore = 0; // Effectively blocks from selection
        contextAdjustments++;
      }

      // NCAAB UNDER BOOST: Player UNDERs in strong UNDER games
      if (ctx.teamTotalSport === 'basketball_ncaab' &&
          ctx.teamTotalSignal === 'UNDER' && ctx.teamTotalComposite >= 75 &&
          pickSide === 'under') {
        pick.compositeScore += 10;
        contextAdjustments++;
      }
    }
  }
  if (contextAdjustments > 0) {
    console.log(`[Bot] Applied ${contextAdjustments} game context adjustments (incl. team total alignment)`);
  }

  // === MATCHUP-FIRST: Build Matchup Opportunity Map ===
  // For each game today, check opponent defense weaknesses and tag attacking teams
  const matchupOpportunityMap = new Map<string, { stat: string; oppDefRank: number }[]>();
  try {
    const STAT_DEF_FIELDS = [
      { stat: 'points', field: 'opp_points_rank' },
      { stat: 'rebounds', field: 'opp_rebounds_rank' },
      { stat: 'assists', field: 'opp_assists_rank' },
      { stat: 'threes', field: 'opp_threes_rank' },
    ];
    // Use envMap to get game pairings (home_team_abbrev vs away_team_abbrev)
    for (const [envKey] of envMap.entries()) {
      const [homeAbbrev, awayAbbrev] = envKey.split('_');
      if (!homeAbbrev || !awayAbbrev) continue;
      
      // Check home team's defense weaknesses (away team attacks)
      const homeDef = defenseDetailMap.get(homeAbbrev);
      if (homeDef) {
        const awayOpps: { stat: string; oppDefRank: number }[] = [];
        for (const sf of STAT_DEF_FIELDS) {
          const rank = (homeDef as any)[sf.field];
          if (rank != null && rank >= 20) {
            awayOpps.push({ stat: sf.stat, oppDefRank: rank });
          }
        }
        if (awayOpps.length > 0) {
          const existing = matchupOpportunityMap.get(awayAbbrev) || [];
          matchupOpportunityMap.set(awayAbbrev, [...existing, ...awayOpps]);
        }
      }
      
      // Check away team's defense weaknesses (home team attacks)
      const awayDef = defenseDetailMap.get(awayAbbrev);
      if (awayDef) {
        const homeOpps: { stat: string; oppDefRank: number }[] = [];
        for (const sf of STAT_DEF_FIELDS) {
          const rank = (awayDef as any)[sf.field];
          if (rank != null && rank >= 20) {
            homeOpps.push({ stat: sf.stat, oppDefRank: rank });
          }
        }
        if (homeOpps.length > 0) {
          const existing = matchupOpportunityMap.get(homeAbbrev) || [];
          matchupOpportunityMap.set(homeAbbrev, [...existing, ...homeOpps]);
        }
      }
    }
    console.log(`[MatchupFirst] Built matchup opportunity map: ${matchupOpportunityMap.size} teams with exploitable weaknesses`);
    for (const [team, opps] of matchupOpportunityMap.entries()) {
      console.log(`[MatchupFirst]   ${team}: ${opps.map(o => `${o.stat}(rank ${o.oppDefRank})`).join(', ')}`);
    }
  } catch (moErr) {
    console.log(`[MatchupFirst] ⚠️ Failed to build matchup opportunity map: ${(moErr as any).message}`);
  }

  // === MATCHUP-FIRST: Apply Alignment Boosts to enriched sweet spots ===
  let matchupAlignedCount = 0;
  for (const pick of enrichedSweetSpots) {
    const teamName = (pick.team_name || '').toLowerCase().trim();
    const teamAbbrev = nameToAbbrev.get(teamName) || nameToAbbrev.get(pick.team_name || '') || '';
    if (!teamAbbrev) continue;
    
    const opportunities = matchupOpportunityMap.get(teamAbbrev);
    if (!opportunities || opportunities.length === 0) continue;
    
    // Check if pick's prop type aligns with any opponent weakness
    const propLower = (pick.prop_type || '').toLowerCase();
    let pickStat = '';
    if (propLower.includes('rebound')) pickStat = 'rebounds';
    else if (propLower.includes('assist')) pickStat = 'assists';
    else if (propLower.includes('three') || propLower.includes('3pt')) pickStat = 'threes';
    else if (propLower.includes('point') && !propLower.includes('rebound') && !propLower.includes('assist')) pickStat = 'points';
    
    if (!pickStat) continue;
    
    const matchingOpp = opportunities.find(o => o.stat === pickStat);
    if (!matchingOpp) continue;
    
    // Apply tiered boost based on how weak the defense is
    let boost = 0;
    if (matchingOpp.oppDefRank >= 28) boost = 22;       // Elite matchup exploitation
    else if (matchingOpp.oppDefRank >= 25) boost = 18;   // Prime matchup
    else if (matchingOpp.oppDefRank >= 20) boost = 12;   // Favorable matchup
    
    pick.compositeScore = Math.min(98, pick.compositeScore + boost);
    (pick as any).matchupAligned = true;
    (pick as any).matchupBoost = boost;
    (pick as any).matchupDefRank = matchingOpp.oppDefRank;
    matchupAlignedCount++;
    console.log(`[MatchupFirst] 🎯 ${pick.player_name} ${pick.prop_type} +${boost} (opp ${pickStat} defense rank ${matchingOpp.oppDefRank})`);
  }
  console.log(`[MatchupFirst] Tagged ${matchupAlignedCount} picks as matchup-aligned out of ${enrichedSweetSpots.length} total`);

  // === FETCH PLAYER PROP ALTERNATE LINES ===
  // Check if any execution profile uses alt lines
  const allProfiles = Object.values(TIER_CONFIG).flatMap((tc: any) => tc.profiles || []);
  const anyProfileUsesAltLines = allProfiles.some((p: any) => p.useAltLines === true);
  if (anyProfileUsesAltLines) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    // Select top 15 NBA player picks by composite score with sufficient projection buffer
    const altLineCandidates = enrichedSweetSpots
      .filter(p => {
        if (!p.event_id || !p.player_name) return false;
        if ((p.sport || 'basketball_nba') !== 'basketball_nba') return false;
        const buffer = (p.projected_value || 0) - p.line;
        const minBuffer = getMinBuffer(p.prop_type);
        return buffer >= minBuffer;
      })
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, 15);

    if (altLineCandidates.length > 0) {
      console.log(`[AltLines] Fetching alternate lines for ${altLineCandidates.length} player prop candidates`);
      let altLinesFetched = 0;
      
      for (const pick of altLineCandidates) {
        try {
          const altResponse = await fetch(`${supabaseUrl}/functions/v1/fetch-alternate-lines`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              eventId: pick.event_id,
              playerName: pick.player_name,
              propType: pick.prop_type,
              sport: pick.sport || deriveSportFromCategory(pick.category),
            }),
          });
          
          if (altResponse.ok) {
            const altData = await altResponse.json();
            if (altData.lines && altData.lines.length > 0) {
              pick.alternateLines = altData.lines;
              altLinesFetched++;
              console.log(`[AltLines] Fetched ${altData.lines.length} alternate lines for ${pick.player_name} ${pick.prop_type}`);
            }
          }
          // 100ms delay between calls to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          console.warn(`[AltLines] Failed to fetch alt lines for ${pick.player_name}: ${err}`);
        }
      }
      console.log(`[AltLines] Completed: ${altLinesFetched}/${altLineCandidates.length} picks received alternate lines`);
    } else {
      console.log(`[AltLines] No qualifying candidates for alternate line fetching`);
    }

    // === CEILING-SPECIFIC ALT LINE FETCH PASS ===
    // Build team→event_id map from unified_props for resolving missing event_ids
    const teamEventIdMap = new Map<string, string>();
    (playerProps || []).forEach((od: any) => {
      if (!od.event_id) return;
      const team = (od.team_name || '').toLowerCase().trim();
      if (team && !teamEventIdMap.has(team)) {
        teamEventIdMap.set(team, od.event_id);
      }
    });
    console.log(`[CeilingAltLines] Built team→event_id map with ${teamEventIdMap.size} teams`);

    // Find ceiling candidates that need alt lines but don't have them yet
    const ceilingAltCandidates = enrichedSweetSpots.filter(p => {
      if ((p as any).alternateLines && (p as any).alternateLines.length > 0) return false; // already have alt lines
      const l10Max = (p as any).l10_max;
      if (l10Max == null || l10Max <= 0) return false;
      // Use sportsbook line from oddsMap if available, else fall back
      const rawPropAlt = (p.prop_type || '').toLowerCase();
      const normPropAlt = PROP_TYPE_NORMALIZE[rawPropAlt] || rawPropAlt;
      const oddsKey = `${(p.player_name || '').toLowerCase()}_${rawPropAlt}`;
      const normKey = `${(p.player_name || '').toLowerCase()}_${normPropAlt}`;
      const oddsEntry = oddsMap.get(oddsKey) || oddsMap.get(normKey);
      const sportsbookLine = oddsEntry?.line && oddsEntry.line > 0 ? oddsEntry.line : null;
      const compareLine = p.line || sportsbookLine || (p as any).recommended_line;
      if (!compareLine || compareLine <= 0) return false;
      // Ceiling gate: l10_max must be 30%+ above the line
      if (l10Max < compareLine * 1.3) return false;
      // Resolve event_id if missing
      if (!p.event_id) {
        const teamName = (p.team_name || '').toLowerCase().trim();
        const teamAbbrev = nameToAbbrev.get(teamName) || nameToAbbrev.get(p.team_name || '') || '';
        // Try team name first, then abbreviation
        const resolvedEventId = teamEventIdMap.get(teamName) || teamEventIdMap.get(teamAbbrev);
        if (resolvedEventId) {
          (p as any).event_id = resolvedEventId;
          p.event_id = resolvedEventId;
        }
      }
      return !!p.event_id;
    }).slice(0, 15);

    if (ceilingAltCandidates.length > 0) {
      console.log(`[CeilingAltLines] Fetching alt lines for ${ceilingAltCandidates.length} ceiling-shot candidates`);
      let ceilingAltFetched = 0;
      for (const pick of ceilingAltCandidates) {
        try {
          const altResponse = await fetch(`${supabaseUrl}/functions/v1/fetch-alternate-lines`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              eventId: pick.event_id,
              playerName: pick.player_name,
              propType: pick.prop_type,
              sport: pick.sport || deriveSportFromCategory(pick.category),
            }),
          });
          if (altResponse.ok) {
            const altData = await altResponse.json();
            if (altData.lines && altData.lines.length > 0) {
              (pick as any).alternateLines = altData.lines;
              ceilingAltFetched++;
              console.log(`[CeilingAltLines] ✅ ${pick.player_name} ${pick.prop_type}: ${altData.lines.length} alt lines (l10_max=${(pick as any).l10_max})`);
            } else {
              console.log(`[CeilingAltLines] ❌ ${pick.player_name} ${pick.prop_type}: no alt lines returned`);
            }
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          console.warn(`[CeilingAltLines] Failed for ${pick.player_name}: ${err}`);
        }
      }
      console.log(`[CeilingAltLines] Completed: ${ceilingAltFetched}/${ceilingAltCandidates.length} ceiling candidates received alt lines`);
    } else {
      console.log(`[CeilingAltLines] No qualifying ceiling candidates for alt line fetch`);
    }
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
      let compositeScore = calculateCompositeScore(hitRateDecimal * 100, 0.5, oddsValueScore, categoryWeight, catHitRatePercent, prop.side || 'over');
      compositeScore += getDayTypeBoost(prop.prop_type, currentDayTypeSignal);
      
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

    // Block catastrophic prop types in fallback path too
    enrichedSweetSpots = enrichedSweetSpots.filter(p => {
      const propType = (p.prop_type || p.bet_type || '').toLowerCase();
      if (isPropTypeBlocked(propType)) {
        console.log(`[BlockedPropType] Filtered ${propType} fallback pick for ${p.player_name}`);
        return false;
      }
      return true;
    });
    
    console.log(`[Bot] Fallback enriched ${enrichedSweetSpots.length} picks (calibrated hit rates from ${categoryHitRateMap.size} categories, blocked NCAAB player props, blocked prop types)`);
  }

  // === APPLY AVAILABILITY GATE TO PLAYER PICKS ===
  const preFilterCount = enrichedSweetSpots.length;
  const filteredOutPlayers: string[] = [];

  // Sweet spots: only filter by injury (OUT/DOUBTFUL) + GTD penalty. 
  // Do NOT require activePlayersToday — the game schedule gate handles team check.
  enrichedSweetSpots = enrichedSweetSpots.filter(pick => {
    const normalizedName = pick.player_name.toLowerCase().trim();

    // Block: OUT or DOUBTFUL
    if (blocklist.has(normalizedName)) {
      filteredOutPlayers.push(`${pick.player_name} (injury blocklist)`);
      return false;
    }

    // Penalize: GTD/QUESTIONABLE - reduce confidence but don't block
    const penalty = penalties.get(normalizedName);
    if (penalty) {
      pick.confidence_score *= penalty;
      pick.l10_hit_rate *= penalty;
      pick.compositeScore = Math.round(pick.compositeScore * penalty);
    }

    return true;
  });

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
        const { score, breakdown } = calculateTeamCompositeScore(gameForScoring, 'spread', 'home', paceMap, defenseMap, envMap, homeCourtMap, defenseDetailMap, ncaabStatsMap, nhlStatsMap, baseballStatsMap);
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
        const { score, breakdown } = calculateTeamCompositeScore(gameForScoring, 'spread', 'away', paceMap, defenseMap, envMap, homeCourtMap, defenseDetailMap, ncaabStatsMap, nhlStatsMap, baseballStatsMap);
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
      const { score: overScore, breakdown: overBreakdown } = calculateTeamCompositeScore(gameForScoring, 'total', 'over', paceMap, defenseMap, envMap, homeCourtMap, defenseDetailMap, ncaabStatsMap, nhlStatsMap, baseballStatsMap);
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

      // Calculate under score up front (needed below for effective score logic)
      const { score: underScore, breakdown: underBreakdown } = calculateTeamCompositeScore(gameForScoring, 'total', 'under', paceMap, defenseMap, envMap, homeCourtMap, defenseDetailMap, ncaabStatsMap, nhlStatsMap, baseballStatsMap);
      const underPlusBonus = isPlusMoney(game.under_odds) ? 5 : 0;

      // For NCAAB totals: prefer the pre-computed composite_score from the DB (KenPom-based scorer)
      // over the re-calculated score which lacks NCAAB intelligence data.
      // The DB recommended_side tells us which side the dedicated scorer favors.
      const isNcaabTotal = game.sport === 'basketball_ncaab' && game.bet_type === 'total';
      const dbScore = game.composite_score ?? null;
      const dbFavorsUnder = game.recommended_side?.toUpperCase() === 'UNDER';
      const dbFavorsOver = game.recommended_side?.toUpperCase() === 'OVER';

      const effectiveOverScore = (isNcaabTotal && dbScore !== null)
        ? (dbFavorsOver ? dbScore : Math.max(30, dbScore - 20)) // penalize the non-recommended side
        : (overScore ?? 50);
      const effectiveUnderScore = (isNcaabTotal && dbScore !== null)
        ? (dbFavorsUnder ? dbScore : Math.max(30, dbScore - 20))
        : (underScore ?? 50);

      picks.push({
        id: `${game.id}_total_over`,
        type: 'team', sport: game.sport, home_team: game.home_team, away_team: game.away_team,
        bet_type: 'total', side: 'over', line: game.line || 0, odds: game.over_odds,
        category: mapTeamBetToCategory('total', 'over'),
        sharp_score: game.sharp_score || 50,
        compositeScore: clampScore(30, 95, effectiveOverScore + overPlusBonus + overWeatherBonus),
        confidence_score: effectiveOverScore / 100,
        score_breakdown: overBreakdown,
      });
      picks.push({
        id: `${game.id}_total_under`,
        type: 'team', sport: game.sport, home_team: game.home_team, away_team: game.away_team,
        bet_type: 'total', side: 'under', line: game.line || 0, odds: game.under_odds,
        category: mapTeamBetToCategory('total', 'under'),
        sharp_score: game.sharp_score || 50,
        compositeScore: clampScore(30, 95, effectiveUnderScore + underPlusBonus + underWeatherBonus),
        confidence_score: effectiveUnderScore / 100,
        score_breakdown: underBreakdown,
      });
    }

    // Moneyline picks
    if (game.bet_type === 'h2h') {
      if (game.home_odds) {
        const plusBonus = isPlusMoney(game.home_odds) ? 5 : 0;
        const { score, breakdown } = calculateTeamCompositeScore(gameForScoring, 'moneyline', 'home', paceMap, defenseMap, envMap, homeCourtMap, defenseDetailMap, ncaabStatsMap, nhlStatsMap, baseballStatsMap);
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
        const { score, breakdown } = calculateTeamCompositeScore(gameForScoring, 'moneyline', 'away', paceMap, defenseMap, envMap, homeCourtMap, defenseDetailMap, ncaabStatsMap, nhlStatsMap, baseballStatsMap);
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
  // Build blocked combos from category weights (category_side + sport, <40% hit rate and 10+ picks)
  // Also build an exemptions map: if a sport has its OWN entry with hit_rate >= 40, it overrides the team_all block
  const blockedTeamCombos = new Set<string>(); // "SPORT|CATEGORY_SIDE" or "team_all|CATEGORY_SIDE"
  const sportExemptions = new Set<string>(); // "SPORT|CATEGORY_SIDE" keys where sport-specific hit rate >= 40

  categoryWeights.forEach(cw => {
    const sportKey = cw.sport || 'team_all';
    const comboKey = `${cw.category}_${cw.side}`;
    const fullKey = `${sportKey}|${comboKey}`;
    if (cw.current_hit_rate < 30 && (cw.total_picks || 0) >= 10) {
      blockedTeamCombos.add(fullKey);
    } else if (cw.current_hit_rate >= 30 && sportKey !== 'team_all') {
      // This sport has a healthy hit rate — exempt it from any team_all block
      sportExemptions.add(fullKey);
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

    // === CIRCUIT BREAKER: Block NCAAB totals where projected_total is the hardcoded 100 fallback ===
    // Independent backstop — even if the scorer produces a broken projection in an edge case,
    // picks built on projected_total ≤ 100 against lines > 125 never enter parlays
    if (isNCAAB && pick.bet_type === 'total') {
      const breakdown = pick.score_breakdown as any;
      const projTotal = breakdown?.projected_total;
      const line = pick.line || 0;
      if (projTotal !== undefined && projTotal <= 100 && line > 125) {
        mlBlocked.push(
          `${pick.home_team} vs ${pick.away_team} NCAAB total BLOCKED — projected_total=${projTotal} is hardcoded fallback, line=${line}`
        );
        return false;
      }
    }

    // === FIX 5: Dynamic category blocking from bot_category_weights (sport-scoped, with exemptions) ===
    // If the pick's sport has a healthy sport-specific hit rate, it overrides any team_all block
    const pickComboKey = `${pick.category}_${pick.side}`;
    const sportScopedKey = `${pick.sport}|${pickComboKey}`;
    const teamAllKey = `team_all|${pickComboKey}`;
    const isExempted = sportExemptions.has(sportScopedKey); // sport-specific good rate overrides team_all block
    if (!isExempted && (blockedTeamCombos.has(sportScopedKey) || blockedTeamCombos.has(teamAllKey))) {
      mlBlocked.push(`${pick.home_team} vs ${pick.away_team} ${pickComboKey} BLOCKED (dynamic: <40% hit rate for ${pick.sport})`);
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
    // Dynamic rank cutoff: widen to 300 on light-slate days so mid-major games qualify
    // Skip rank gate entirely for NCAAB totals — the pre-scored composite_score already encodes team quality
    const RANK_CUTOFF = isLightSlateMode ? 300 : 200;
    if (isNCAAB && ncaabStatsMap && ncaabStatsMap.size > 0 && pick.bet_type !== 'total') {
      const homeStats = ncaabStatsMap.get(pick.home_team);
      const awayStats = ncaabStatsMap.get(pick.away_team);
      const homeRank = homeStats?.kenpom_rank || 999;
      const awayRank = awayStats?.kenpom_rank || 999;
      
      if (homeRank > RANK_CUTOFF || awayRank > RANK_CUTOFF) {
        mlBlocked.push(`${pick.home_team} vs ${pick.away_team} NCAAB (rank #${homeRank} vs #${awayRank}, need both ≤${RANK_CUTOFF})`);
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
  console.log(`[ML Sniper] Team picks: ${preGateCount} → ${filteredTeamPicks.length} (rank cutoff: ${isLightSlateMode ? 300 : 200})`);

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

  // === HOT-STREAK COMPOSITE BOOST ===
  // Picks from categories with current_streak >= 3 and hit_rate >= 65% get +15 composite score
  // This ensures hot-streak categories front-load the pool and get priority in 3-leg parlay assembly
  const HOT_STREAK_MIN_STREAK = 3;
  const HOT_STREAK_MIN_HIT_RATE = 65;
  const hotStreakCategories = new Set<string>();
  categoryWeights.forEach((w: CategoryWeight) => {
    const hitRate = (w.total_hits ?? 0) / Math.max(w.total_picks ?? 1, 1) * 100;
    if (!w.is_blocked && (w.current_streak || 0) >= HOT_STREAK_MIN_STREAK && hitRate >= HOT_STREAK_MIN_HIT_RATE) {
      hotStreakCategories.add(`${w.category}__${w.side}`);
      hotStreakCategories.add(w.category);
    }
  });
  if (hotStreakCategories.size > 0) {
    console.log(`[HotStreak] ${hotStreakCategories.size / 2} hot-streak categories active (streak >= ${HOT_STREAK_MIN_STREAK}, hit rate >= ${HOT_STREAK_MIN_HIT_RATE}%)`);
  }
  let hotStreakBoosted = 0;
  for (const pick of enrichedSweetSpots) {
    const catKey = `${pick.category}__${pick.recommended_side}`;
    if (hotStreakCategories.has(catKey) || hotStreakCategories.has(pick.category)) {
      pick.compositeScore = Math.min(95, pick.compositeScore + 15);
      (pick as any).isHotStreak = true;
      hotStreakBoosted++;
    }
  }
  if (hotStreakBoosted > 0) {
    console.log(`[HotStreak] +15 composite boost applied to ${hotStreakBoosted} picks from hot-streak categories`);
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
    const mult = sportShiftMultipliers.get(pick.sport || deriveSportFromCategory(pick.category)) || 1.0;
    if (mult !== 1.0) {
      pick.compositeScore = Math.min(95, Math.round(pick.compositeScore * mult));
      sportShiftApplied++;
    }
  }
  for (const pick of enrichedTeamPicks) {
    const mult = sportShiftMultipliers.get(pick.sport || deriveSportFromCategory(pick.category)) || 1.0;
    if (mult !== 1.0) {
      pick.compositeScore = Math.min(95, Math.round(pick.compositeScore * mult));
      sportShiftApplied++;
    }
  }
  if (sportShiftApplied > 0) {
    console.log(`[SportShift] Boosted composite scores for ${sportShiftApplied} picks from non-dominant sports`);
  }

  // === DEFENSE MATCHUP COMPOSITE ADJUSTMENTS (NBA player props) ===
  // Apply soft bonuses/penalties based on today's opponent defensive ranking.
  // This enriches ALL picks before parlay assembly — the master parlay will hard-filter on top of this.
  let savedDefOpponentMap = new Map<string, string>();
  let defMapPool = new Map<string, Map<string, number>>();
  try {
    const { startUtc: defStartUtc, endUtc: defEndUtc } = getEasternDateRange();
    const { data: todayNbaGames } = await supabase
      .from('game_bets')
      .select('home_team, away_team')
      .eq('sport', 'basketball_nba')
      .gte('commence_time', defStartUtc)
      .lte('commence_time', defEndUtc);

    const defOpponentMap = new Map<string, string>();
    if (todayNbaGames && todayNbaGames.length > 0) {
      for (const g of todayNbaGames) {
        const home = (g.home_team || '').toLowerCase().trim();
        const away = (g.away_team || '').toLowerCase().trim();
        if (home && away) { defOpponentMap.set(home, away); defOpponentMap.set(away, home); }
      }
    }

    const { data: defRankData } = await supabase
      .from('nba_opponent_defense_stats')
      .select('team_name, stat_category, defense_rank');

    defMapPool = new Map<string, Map<string, number>>();
    if (defRankData && defRankData.length > 0) {
      for (const row of defRankData) {
        const key = (row.team_name || '').toLowerCase().trim();
        if (!defMapPool.has(key)) defMapPool.set(key, new Map());
        defMapPool.get(key)!.set((row.stat_category || 'overall').toLowerCase(), row.defense_rank);
      }
    }

    let defAdjApplied = 0;
    let envScoreApplied = 0;
    let unresolvedTeamCount = 0;
    for (const pick of enrichedSweetSpots) {
      if ((pick.sport || deriveSportFromCategory(pick.category)) !== 'basketball_nba') continue;
      const resolvedTeam = (pick as any).team_name || playerTeamMap.get((pick.player_name || '').toLowerCase().trim()) || '';
      const teamKey = normalizeBdlTeamName(resolvedTeam);
      if (!teamKey) unresolvedTeamCount++;
      const side = (pick.recommended_side || 'over').toLowerCase();
      const rank = getOpponentDefenseRank(teamKey, pick.prop_type || 'points', defOpponentMap, defMapPool);
      const adj = getDefenseMatchupAdjustment(rank, side);
      // Always store defense rank for line adjustment system
      if (rank != null) {
        (pick as any).defenseMatchupRank = rank;
        (pick as any).defenseMatchupAdj = adj;
      }
      if (adj !== 0) {
        pick.compositeScore = Math.min(95, Math.max(0, pick.compositeScore + adj));
        defAdjApplied++;
      }

      // Compute environment_score for this player prop
      const oppTeamName = defOpponentMap.get(teamKey);
      (pick as any).opponent_team = oppTeamName || '';
      const teamAbbrev = nameToAbbrev.get(teamKey) || nameToAbbrev.get((pick as any).team_name || '') || '';
      const oppAbbrev = oppTeamName ? (nameToAbbrev.get(oppTeamName) || '') : '';
      const homePace = teamAbbrev ? paceMap.get(teamAbbrev) : undefined;
      const awayPace = oppAbbrev ? paceMap.get(oppAbbrev) : undefined;
      const avgPaceRating = (homePace && awayPace) ? (homePace.pace_rating + awayPace.pace_rating) / 2 : (homePace?.pace_rating ?? awayPace?.pace_rating ?? null);
      const oppDefDetail = oppAbbrev ? defenseDetailMap.get(oppAbbrev) : (oppTeamName ? defenseDetailMap.get(oppTeamName) : undefined);
      const oppDefRank = oppDefDetail?.overall_rank ?? rank;
      // Find blowout probability from envMap
      let blowoutProb: number | null = null;
      for (const [envKey, envData] of envMap.entries()) {
        const [h, a] = envKey.split('_');
        if (h === teamAbbrev || a === teamAbbrev || h === oppAbbrev || a === oppAbbrev) {
          blowoutProb = envData.blowout_probability ?? null;
          break;
        }
      }

      // Get team's offensive ranks for bidirectional matchup scoring
      const teamDetail = teamAbbrev ? defenseDetailMap.get(teamAbbrev) : undefined;
      const envResult = calculateEnvironmentScore(
        avgPaceRating, oppDefRank, blowoutProb,
        pick.prop_type || 'points', side,
        oppDefDetail?.opp_rebounds_rank, oppDefDetail?.opp_assists_rank,
        oppDefDetail?.opp_points_rank, oppDefDetail?.opp_threes_rank,
        teamDetail?.off_points_rank, teamDetail?.off_rebounds_rank,
        teamDetail?.off_assists_rank, teamDetail?.off_threes_rank, teamDetail?.off_pace_rank
      );
      (pick as any).environmentScore = envResult.confidenceAdjustment;
      (pick as any).environmentComponents = envResult.components;
      // APPLY environment adjustment to composite score
      pick.compositeScore = Math.min(95, Math.max(0, pick.compositeScore + envResult.confidenceAdjustment));
      envScoreApplied++;

      // === PROP-SPECIFIC DEFENSE HARD-GATES ===
      const propLowerGate = (pick.prop_type || '').toLowerCase();
      const sideGate = (pick.recommended_side || 'over').toLowerCase();
      let propSpecificDefRank: number | null = null;
      if (propLowerGate.includes('three') || propLowerGate === '3pm' || propLowerGate === 'threes') {
        propSpecificDefRank = oppDefDetail?.opp_threes_rank ?? null;
      } else if (propLowerGate.includes('point') || propLowerGate === 'pts' || propLowerGate === 'points') {
        propSpecificDefRank = oppDefDetail?.opp_points_rank ?? null;
      } else if (propLowerGate.includes('reb')) {
        propSpecificDefRank = oppDefDetail?.opp_rebounds_rank ?? null;
      } else if (propLowerGate.includes('ast') || propLowerGate.includes('assist')) {
        propSpecificDefRank = oppDefDetail?.opp_assists_rank ?? null;
      }
      if (propSpecificDefRank != null && sideGate === 'over') {
        if (propSpecificDefRank <= 5) {
          // Hard-block: tag pick so execution tier skips it
          (pick as any).defenseHardBlocked = true;
          console.log(`[DefenseGate] Hard-blocked OVER ${pick.player_name} ${propLowerGate} vs top-5 ${propLowerGate} defense (rank ${propSpecificDefRank})`);
        } else if (propSpecificDefRank <= 10) {
          pick.compositeScore = Math.max(0, pick.compositeScore - 15);
          console.log(`[DefenseGate] Penalized -15 OVER ${pick.player_name} ${propLowerGate} vs top-10 defense (rank ${propSpecificDefRank})`);
        }
      }
      if (propSpecificDefRank != null && sideGate === 'over' && propSpecificDefRank >= 21) {
        pick.compositeScore = Math.min(95, pick.compositeScore + 10);
        console.log(`[DefenseGate] Boosted +10 OVER ${pick.player_name} ${propLowerGate} vs bottom-10 defense (rank ${propSpecificDefRank})`);
      }

      // === 3PM OFFENSIVE RANKING GATE: block 3PM overs if team doesn't shoot well from three ===
      if ((propLowerGate.includes('three') || propLowerGate === '3pm' || propLowerGate === 'threes') && sideGate === 'over') {
        const teamOffThreesRank = teamDetail?.off_threes_rank ?? null;
        if (teamOffThreesRank != null) {
          if (teamOffThreesRank >= 20) {
            // Bottom third offensively at 3PM — hard-block
            (pick as any).defenseHardBlocked = true;
            console.log(`[3PMOffGate] Hard-blocked 3PM OVER ${pick.player_name} — team off_threes_rank ${teamOffThreesRank} (bottom third)`);
          } else if (teamOffThreesRank >= 15) {
            // Below average — heavy penalty
            pick.compositeScore = Math.max(0, pick.compositeScore - 12);
            console.log(`[3PMOffGate] Penalized -12 3PM OVER ${pick.player_name} — team off_threes_rank ${teamOffThreesRank} (below avg)`);
          }
        }
      }

      // === THREES L10 FLOOR FOR EXECUTION ===
      if ((propLowerGate.includes('three') || propLowerGate === '3pm' || propLowerGate === 'threes') && pick.l10_hit_rate != null && pick.l10_hit_rate < 0.70) {
        (pick as any).threesL10Blocked = true;
      }

      // === MATCHUP DEFENSE SCAN BOOST ===
      const pickTeamAbbrev = (teamAbbrev || '').toUpperCase();
      const matchupPropKey = propLowerGate.includes('three') || propLowerGate === '3pm' ? 'threes'
        : propLowerGate.includes('point') || propLowerGate === 'pts' ? 'points'
        : propLowerGate.includes('reb') ? 'rebounds'
        : propLowerGate.includes('ast') || propLowerGate.includes('assist') ? 'assists'
        : propLowerGate;
      const matchupKey = `${pickTeamAbbrev}|${matchupPropKey}`;
      const matchupSignal = matchupDefenseScan.get(matchupKey);
      if (matchupSignal) {
        const defRank = matchupSignal.defense_rank || 0;
        if (sideGate === 'over' && defRank >= 28) {
          // ELITE: rank 28+ (e.g., WAS #30)
          pick.compositeScore = Math.min(95, pick.compositeScore + 22);
          (pick as any).matchupBoost = 22;
          (pick as any).matchupPriority = 'elite';
          console.log(`[MatchupBoost] +22 ELITE boost ${pick.player_name} ${matchupPropKey} OVER (opp rank ${defRank})`);
        } else if (matchupSignal.priority === 'prime' && sideGate === 'over') {
          // PRIME: rank 25-27 (e.g., DET #25-27)
          pick.compositeScore = Math.min(95, pick.compositeScore + 18);
          (pick as any).matchupBoost = 18;
          (pick as any).matchupPriority = 'prime';
          console.log(`[MatchupBoost] +18 PRIME boost ${pick.player_name} ${matchupPropKey} OVER (opp rank ${defRank})`);
        } else if (matchupSignal.priority === 'favorable' && sideGate === 'over') {
          // FAVORABLE: rank 20-24
          pick.compositeScore = Math.min(95, pick.compositeScore + 12);
          (pick as any).matchupBoost = 12;
          (pick as any).matchupPriority = 'favorable';
          console.log(`[MatchupBoost] +12 FAVORABLE boost ${pick.player_name} ${matchupPropKey} OVER (opp rank ${defRank})`);
        } else if (matchupSignal.priority === 'avoid' && sideGate === 'over') {
          pick.compositeScore = Math.max(0, pick.compositeScore - 20);
          (pick as any).matchupBoost = -20;
          (pick as any).matchupPriority = 'avoid';
          (pick as any).defenseHardBlocked = true;
          console.log(`[MatchupBoost] -20 AVOID block ${pick.player_name} ${matchupPropKey} OVER (opp rank ${defRank})`);
        }
      }
    }

    // Save defOpponentMap for mispriced enrichment later
    savedDefOpponentMap = defOpponentMap;

    if (defAdjApplied > 0) {
      console.log(`[DefenseMatchup] Applied composite adjustments to ${defAdjApplied} NBA picks based on opponent defense rankings`);
    }
    if (envScoreApplied > 0) {
      console.log(`[EnvironmentScore] Computed environment_score for ${envScoreApplied} sweet spot picks`);
    }
    if (unresolvedTeamCount > 0) {
      console.log(`[EnvironmentScore] WARNING: ${unresolvedTeamCount} picks had no resolved team_name`);
    }
  } catch (defErr) {
    console.log(`[DefenseMatchup] ⚠️ Failed to apply defense adjustments: ${defErr.message}`);
  }

  // === RETURNING HITTER BOOST ===
  try {
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(yesterdayDate);

    const { data: yesterdayHits } = await supabase
      .from('bot_parlay_legs')
      .select('player_name')
      .eq('outcome', 'hit')
      .gte('created_at', `${yesterdayStr}T00:00:00`)
      .lt('created_at', `${targetDate}T00:00:00`);

    if (yesterdayHits && yesterdayHits.length > 0) {
      const hittersSet = new Set(
        yesterdayHits.map(h => (h.player_name || '').toLowerCase().trim())
      );
      hittersSet.delete('');
      let boosted = 0;
      for (const pick of enrichedSweetSpots) {
        if (hittersSet.has(pick.player_name.toLowerCase().trim())) {
          pick.confidence_score = Math.min(1.0, pick.confidence_score + 0.05);
          pick.l10_hit_rate = Math.min(1.0, pick.l10_hit_rate + 0.05);
          pick.compositeScore = Math.min(99, pick.compositeScore + 3);
          boosted++;
        }
      }
      console.log(`[ReturningHitter] Boosted ${boosted} picks from ${hittersSet.size} players who hit yesterday (${yesterdayStr})`);
    } else {
      console.log(`[ReturningHitter] No yesterday hit data found, skipping boost`);
    }
  } catch (rhErr) {
    console.log(`[ReturningHitter] ⚠️ Failed to apply boost: ${rhErr.message}`);
  }

  // === CROSS-ENGINE CONVICTION BOOST ===
  // Fetch risk engine + PropV2 + Sharp/Heat picks for multi-engine consensus
  const [riskEngineResult, propV2Result, sharpResult, heatResult] = await Promise.all([
    supabase.from('nba_risk_engine_picks')
      .select('player_name, prop_type, side, confidence_score')
      .eq('game_date', targetDate),
    supabase.from('prop_engine_v2_picks')
      .select('player_name, prop_type, side, ses_score')
      .eq('game_date', targetDate),
    supabase.from('sharp_ai_parlays')
      .select('leg_1, leg_2, parlay_type')
      .eq('parlay_date', targetDate),
    supabase.from('heat_parlays')
      .select('legs, parlay_type')
      .eq('parlay_date', targetDate),
  ]);

  const riskEnginePicks = riskEngineResult.data || [];
  const riskEngineMap = new Map<string, { side: string; confidence: number }>();
  for (const rp of riskEnginePicks) {
    const normProp = PROP_TYPE_NORMALIZE[(rp.prop_type || '').toLowerCase()] || (rp.prop_type || '').replace(/^(player_|batter_|pitcher_)/, '').toLowerCase().trim();
    const key = `${(rp.player_name || '').toLowerCase().trim()}|${normProp}`;
    riskEngineMap.set(key, { side: rp.side, confidence: rp.confidence_score });
  }

  // Build unified multi-engine map: key = "player|prop_type", value = { engines[], sides[] }
  const multiEngineMap = new Map<string, { engines: string[]; sides: string[] }>();
  const addToMultiEngine = (playerName: string, propType: string, side: string, engine: string) => {
    if (!playerName || !propType) return;
    const normProp = PROP_TYPE_NORMALIZE[(propType || '').toLowerCase()] || (propType || '').replace(/^(player_|batter_|pitcher_)/, '').toLowerCase().trim();
    const key = `${playerName.toLowerCase().trim()}|${normProp}`;
    if (!multiEngineMap.has(key)) multiEngineMap.set(key, { engines: [], sides: [] });
    const entry = multiEngineMap.get(key)!;
    if (!entry.engines.includes(engine)) {
      entry.engines.push(engine);
      entry.sides.push(side.toLowerCase());
    }
  };

  // Risk engine
  for (const rp of riskEnginePicks) {
    addToMultiEngine(rp.player_name, rp.prop_type, rp.side || 'over', 'risk');
  }
  // PropV2 engine
  for (const p of (propV2Result.data || [])) {
    addToMultiEngine(p.player_name, p.prop_type, p.side || 'over', 'propv2');
  }
  // Sharp AI parlays — extract legs
  for (const parlay of (sharpResult.data || [])) {
    for (const legKey of ['leg_1', 'leg_2']) {
      const leg = parlay[legKey];
      if (leg && typeof leg === 'object') {
        addToMultiEngine(leg.player_name || '', leg.prop_type || leg.stat_type || '', leg.side || 'over', 'sharp');
      }
    }
  }
  // Heat parlays — extract legs
  for (const parlay of (heatResult.data || [])) {
    if (Array.isArray(parlay.legs)) {
      for (const leg of parlay.legs) {
        if (leg && typeof leg === 'object') {
          addToMultiEngine(leg.player_name || '', leg.prop_type || leg.stat_type || '', leg.side || 'over', 'heat');
        }
      }
    }
  }

  console.log(`[Bot] Cross-engine conviction: ${riskEngineMap.size} risk, ${propV2Result.data?.length || 0} propV2, ${sharpResult.data?.length || 0} sharp, ${heatResult.data?.length || 0} heat | multiEngineMap: ${multiEngineMap.size} unique picks`);
  // MLB engine cross-reference ENABLED

  // === STEP 2: ENRICH MISPRICED LINES + CROSS-REFERENCE WITH SWEET SPOTS ===
  let doubleConfirmedCount = 0;
  const enrichedMispricedPicks: EnrichedPick[] = (rawMispricedLines || []).map((ml: any) => {
    const side = (ml.signal || 'OVER').toLowerCase();
    const category = mapPropTypeToCategory(ml.prop_type);
    const absEdge = ml.edge_pct || 0; // no Math.abs — negatives filtered at source
    const tierBonus = ml.confidence_tier === 'ELITE' ? 15 : ml.confidence_tier === 'HIGH' ? 10 : 5;
    
    // Cross-engine conviction multiplier: if risk engine agrees on side, boost score
    const normProp = PROP_TYPE_NORMALIZE[(ml.prop_type || '').toLowerCase()] || (ml.prop_type || '').replace(/^(player_|batter_|pitcher_)/, '').toLowerCase().trim();
    const riskKey = `${(ml.player_name || '').toLowerCase().trim()}|${normProp}`;
    const riskMatch = riskEngineMap.get(riskKey);
    const riskConfirmed = riskMatch && riskMatch.side.toLowerCase() === side;
    const convictionBoost = riskConfirmed ? 12 : (riskMatch ? 3 : 0);

    // MLB engine cross-reference boost — ENABLED
    const mlbMultiKey = `${(ml.player_name || '').toLowerCase().trim()}|${normProp}`;
    const mlbMultiMatch = multiEngineMap.get(mlbMultiKey);
    const mlbBoost = (mlbMultiMatch && mlbMultiMatch.engines.size >= 2) ? 8 : 0;
    
    // === DOUBLE-CONFIRMED CROSS-REFERENCE ===
    // Normalize mispriced prop_type to sweet spot prop_type format
    const normalizedPropType = PROP_TYPE_NORMALIZE[ml.prop_type?.toLowerCase()] || normProp;
    const sweetSpotKey = `${(ml.player_name || '').toLowerCase().trim()}|${normalizedPropType}`;
    const sweetSpotMatch = sweetSpotLookup.get(sweetSpotKey);
    
    let isDoubleConfirmed = false;
    let doubleConfirmedBonus = 0;
    let realHitRate = absEdge >= 30 ? 0.70 : absEdge >= 20 ? 0.62 : 0.55; // default fake rate
    let matchedArchetype = '';
    let matchedCategory = category;
    
    if (sweetSpotMatch && sweetSpotMatch.l10_hit_rate > 0) {
      // === DIRECTION-CONFLICT FILTER ===
      // Check if mispriced signal direction agrees with sweet spot recommendation
      const sweetSpotSide = (sweetSpotMatch.recommended_side || '').toLowerCase().trim();
      const sidesAgree = sweetSpotSide === side;
      
      if (!sidesAgree) {
        // Direction conflict: sweet spot and mispriced signal disagree on OVER/UNDER
        console.warn(`[DIRECTION CONFLICT] ${ml.player_name} ${ml.prop_type} | sweetSpot=${sweetSpotSide.toUpperCase()} mispriced=${side.toUpperCase()} | Skipping double-confirmed bonus, keeping fake hit rate`);
        // Keep default fake hit rate, no bonus, not double-confirmed
        isDoubleConfirmed = false;
        doubleConfirmedBonus = 0;
      } else {
        // Sides agree — proceed with real hit rate enrichment
        realHitRate = sweetSpotMatch.l10_hit_rate / 100; // stored as percentage (e.g., 70 = 70%)
        if (realHitRate > 1) realHitRate = sweetSpotMatch.l10_hit_rate / 100;
        if (realHitRate <= 0.01) realHitRate = sweetSpotMatch.l10_hit_rate; // stored as 0.70 already
        
        matchedArchetype = sweetSpotMatch.archetype;
        matchedCategory = sweetSpotMatch.category || category;
        
        // Double-confirmed: sweet spot hit rate 70%+ AND mispriced edge 15%+
        if (realHitRate >= 0.70 && absEdge >= 15) {
          isDoubleConfirmed = true;
          doubleConfirmedBonus = 20;
          doubleConfirmedCount++;
          console.log(`[Bot] 🔥 DOUBLE-CONFIRMED: ${ml.player_name} ${ml.prop_type} ${side} | hitRate=${(realHitRate * 100).toFixed(0)}% edge=${absEdge.toFixed(1)}% arch=${matchedArchetype}`);
        } else {
          // Partial match: still use real hit rate but smaller bonus
          doubleConfirmedBonus = 8;
          console.log(`[Bot] ✅ Sweet spot matched: ${ml.player_name} ${ml.prop_type} | hitRate=${(realHitRate * 100).toFixed(0)}% (partial, edge=${absEdge.toFixed(1)}%)`);
        }
      }
    }

    // === TRIPLE-CONFIRMED + MULTI-ENGINE TAGGING ===
    let isTripleConfirmed = false;
    let tripleConfirmedBonus = 0;
    if (isDoubleConfirmed && riskConfirmed) {
      isTripleConfirmed = true;
      tripleConfirmedBonus = 30; // replaces +20 double + +12 risk
      console.log(`[Bot] 🔥🔥🔥 TRIPLE-CONFIRMED: ${ml.player_name} ${ml.prop_type} ${side} | hitRate=${(realHitRate * 100).toFixed(0)}% edge=${absEdge.toFixed(1)}% riskConf=${riskMatch?.confidence}`);
    }

    // Multi-engine consensus: count how many engines agree on this pick
    const multiMatch = multiEngineMap.get(riskKey);
    let engineCount = 0;
    if (multiMatch) {
      // Count engines that agree on the same side
      const agreeingEngines = multiMatch.engines.filter((_, i) => multiMatch.sides[i] === side);
      engineCount = agreeingEngines.length;
    }
    // Add risk + sweet spot as implicit engines if they agree
    if (riskConfirmed) engineCount++;
    if (isDoubleConfirmed) engineCount++;
    const multiEngineBonus = engineCount >= 4 ? 25 : engineCount >= 3 ? 16 : engineCount >= 2 ? 8 : 0;

    // Use triple-confirmed bonus if applicable (replaces double+risk bonuses)
    const effectiveConvictionBoost = isTripleConfirmed ? 0 : convictionBoost; // risk boost already in tripleConfirmedBonus
    const effectiveDoubleBonus = isTripleConfirmed ? 0 : doubleConfirmedBonus; // replaced by tripleConfirmedBonus
    
    const compositeScore = Math.min(98, 50 + (absEdge * 0.3) + tierBonus + effectiveConvictionBoost + effectiveDoubleBonus + tripleConfirmedBonus + multiEngineBonus + mlbBoost);
    const hitRate = realHitRate;

    // Look up real odds from the odds map
    const oddsKey = `${ml.player_name}_${ml.prop_type}`.toLowerCase();
    const oddsEntry = oddsMap.get(oddsKey);
    const americanOdds = side === 'over' 
      ? (oddsEntry?.overOdds || -110) 
      : (oddsEntry?.underOdds || -110);

    return {
      id: `mispriced_${ml.player_name}_${ml.prop_type}`,
      player_name: ml.player_name,
      prop_type: ml.prop_type,
      line: ml.book_line || 0,
      recommended_side: side,
      category: matchedCategory,
      confidence_score: hitRate,
      l10_hit_rate: hitRate,
      projected_value: ml.defense_adjusted_avg || ml.player_avg_l10 || 0,
      sport: ml.sport || 'basketball_nba',
      americanOdds,
      oddsValueScore: calculateOddsValueScore(americanOdds, hitRate),
      compositeScore,
      has_real_line: true,
      line_source: isTripleConfirmed ? 'triple_confirmed' : isDoubleConfirmed ? 'double_confirmed' : 'mispriced_edge',
      isDoubleConfirmed,
      isTripleConfirmed,
      engineCount,
      archetype: matchedArchetype,
      edge_pct: ml.edge_pct || 0,
    } as EnrichedPick;
  }).filter((p: any) => Math.abs(p.line) > 0 && p.player_name && (p.edge_pct >= 3));

  console.log(`[Bot] 🔥 Double-confirmed picks: ${doubleConfirmedCount} out of ${enrichedMispricedPicks.length} mispriced lines`);

  // === STEP 2b: ENRICH CORRECT-PRICED LINES (3-14% edge, stable anchors) ===
  const enrichedCorrectPricedPicks: EnrichedPick[] = (rawCorrectPricedLines || []).map((cl: any) => {
    const side = (cl.signal || 'OVER').toLowerCase();
    const category = mapPropTypeToCategory(cl.prop_type);
    const absEdge = cl.edge_pct || 0;

    // Cross-reference with sweet spots for real hit rate
    const normProp = PROP_TYPE_NORMALIZE[(cl.prop_type || '').toLowerCase()] || (cl.prop_type || '').replace(/^(player_|batter_|pitcher_)/, '').toLowerCase().trim();
    const sweetSpotKey = `${(cl.player_name || '').toLowerCase().trim()}|${normProp}`;
    const sweetSpotMatch = sweetSpotLookup.get(sweetSpotKey);

    let realHitRate = absEdge >= 10 ? 0.60 : 0.55;
    let matchedCategory = category;
    
    if (sweetSpotMatch && sweetSpotMatch.l10_hit_rate > 0) {
      const sweetSpotSide = (sweetSpotMatch.recommended_side || '').toLowerCase().trim();
      if (sweetSpotSide === side) {
        realHitRate = sweetSpotMatch.l10_hit_rate / 100;
        if (realHitRate > 1) realHitRate = sweetSpotMatch.l10_hit_rate / 100;
        if (realHitRate <= 0.01) realHitRate = sweetSpotMatch.l10_hit_rate;
        matchedCategory = sweetSpotMatch.category || category;
      }
    }

    const compositeScore = Math.min(85, 40 + (absEdge * 0.5) + (realHitRate * 30));

    const oddsKey = `${cl.player_name}_${cl.prop_type}`.toLowerCase();
    const oddsEntry = oddsMap.get(oddsKey);
    const americanOdds = side === 'over'
      ? (oddsEntry?.overOdds || -110)
      : (oddsEntry?.underOdds || -110);

    return {
      id: `correct_priced_${cl.player_name}_${cl.prop_type}`,
      player_name: cl.player_name,
      prop_type: cl.prop_type,
      line: cl.book_line || 0,
      recommended_side: side,
      category: matchedCategory,
      confidence_score: realHitRate,
      l10_hit_rate: realHitRate,
      projected_value: cl.defense_adjusted_avg || cl.player_avg_l10 || 0,
      sport: cl.sport || 'basketball_nba',
      americanOdds,
      oddsValueScore: calculateOddsValueScore(americanOdds, realHitRate),
      compositeScore,
      has_real_line: true,
      line_source: 'correct_priced',
      isDoubleConfirmed: false,
      isTripleConfirmed: false,
      engineCount: 0,
      archetype: '',
      edge_pct: cl.edge_pct || 0,
    } as EnrichedPick;
  }).filter((p: any) => Math.abs(p.line) > 0 && p.player_name && (p.edge_pct >= 3));

  // Filter correct-priced picks through same gates as mispriced
  const filteredCorrectPricedPicks = enrichedCorrectPricedPicks.filter(pick => {
    const propType = (pick.prop_type || '').toLowerCase();
    const normProp = PROP_TYPE_NORMALIZE[propType] || propType;
    if (isPropTypeBlocked(propType) || isPropTypeBlocked(normProp)) return false;
    const playerBonus = getPlayerBonus(pick.player_name, normProp);
    if (playerBonus <= -999) return false;
    if (activePlayersToday.size > 0) {
      const normalizedName = pick.player_name.toLowerCase().trim();
      return activePlayersToday.has(normalizedName) && !blocklist.has(normalizedName);
    }
    return !blocklist.has(pick.player_name.toLowerCase().trim());
  });

  console.log(`[Bot] ✅ Correct-priced picks: ${filteredCorrectPricedPicks.length} (from ${enrichedCorrectPricedPicks.length} raw)`);

  // Filter blocked prop types from mispriced picks (steals, blocks, etc.)
  const preBlockedMispricedCount = enrichedMispricedPicks.length;
  const unblockedMispricedPicks = enrichedMispricedPicks.filter(pick => {
    const propType = (pick.prop_type || '').toLowerCase();
    const normProp = PROP_TYPE_NORMALIZE[propType] || propType;
    if (isPropTypeBlocked(propType) || isPropTypeBlocked(normProp)) {
      console.log(`[BlockedPropType] Filtered mispriced ${propType} for ${pick.player_name}`);
      return false;
    }
    // Hard-block serial losers
    const playerBonus = getPlayerBonus(pick.player_name, normProp);
    if (playerBonus <= -999) {
      console.log(`[HardBlock] Filtered serial loser ${pick.player_name} (${normProp}) from mispriced`);
      return false;
    }
    return true;
  });
  if (preBlockedMispricedCount !== unblockedMispricedPicks.length) {
    console.log(`[BlockedPropType] Removed ${preBlockedMispricedCount - unblockedMispricedPicks.length} blocked/losing mispriced picks`);
  }

  // Apply availability gate to mispriced picks
  const filteredMispricedPicks = unblockedMispricedPicks.filter(pick => {
    if (activePlayersToday.size > 0) {
      const normalizedName = pick.player_name.toLowerCase().trim();
      return activePlayersToday.has(normalizedName) && !blocklist.has(normalizedName);
    }
    return !blocklist.has(pick.player_name.toLowerCase().trim());
  });

  // === ENVIRONMENT SCORE ENRICHMENT FOR MISPRICED PICKS ===
  try {
    let mispricedEnvApplied = 0;
    for (const pick of enrichedMispricedPicks) {
      if ((pick.sport || deriveSportFromCategory(pick.category)) !== 'basketball_nba') continue;
      const resolvedTeam = (pick as any).team_name || playerTeamMap.get((pick.player_name || '').toLowerCase().trim()) || '';
      const teamKey = normalizeBdlTeamName(resolvedTeam);
      if (!teamKey) continue;
      const side = (pick.recommended_side || 'over').toLowerCase();

      // Always store defense rank for mispriced picks (enables line adjustment system)
      const mispRank = getOpponentDefenseRank(teamKey, pick.prop_type || 'points', savedDefOpponentMap, defMapPool);
      const mispAdj = getDefenseMatchupAdjustment(mispRank, side);
      if (mispRank != null) {
        (pick as any).defenseMatchupRank = mispRank;
        (pick as any).defenseMatchupAdj = mispAdj;
      }

      const oppTeamName = savedDefOpponentMap.get(teamKey);
      (pick as any).opponent_team = oppTeamName || '';
      const teamAbbrev = nameToAbbrev.get(teamKey) || nameToAbbrev.get(resolvedTeam) || '';
      const oppAbbrev2 = oppTeamName ? (nameToAbbrev.get(oppTeamName) || '') : '';
      const homePace2 = teamAbbrev ? paceMap.get(teamAbbrev) : undefined;
      const awayPace2 = oppAbbrev2 ? paceMap.get(oppAbbrev2) : undefined;
      const avgPaceRating2 = (homePace2 && awayPace2) ? (homePace2.pace_rating + awayPace2.pace_rating) / 2 : (homePace2?.pace_rating ?? awayPace2?.pace_rating ?? null);
      const oppDefDetail2 = oppAbbrev2 ? defenseDetailMap.get(oppAbbrev2) : (oppTeamName ? defenseDetailMap.get(oppTeamName) : undefined);
      const oppDefRank2 = oppDefDetail2?.overall_rank ?? null;
      let blowoutProb2: number | null = null;
      for (const [envKey, envData] of envMap.entries()) {
        const [h, a] = envKey.split('_');
        if (h === teamAbbrev || a === teamAbbrev || h === oppAbbrev2 || a === oppAbbrev2) {
          blowoutProb2 = envData.blowout_probability ?? null;
          break;
        }
      }

      const teamDetail2 = teamAbbrev ? defenseDetailMap.get(teamAbbrev) : undefined;
      const envResult2 = calculateEnvironmentScore(
        avgPaceRating2, oppDefRank2, blowoutProb2,
        pick.prop_type || 'points', side,
        oppDefDetail2?.opp_rebounds_rank, oppDefDetail2?.opp_assists_rank,
        oppDefDetail2?.opp_points_rank, oppDefDetail2?.opp_threes_rank,
        teamDetail2?.off_points_rank, teamDetail2?.off_rebounds_rank,
        teamDetail2?.off_assists_rank, teamDetail2?.off_threes_rank, teamDetail2?.off_pace_rank
      );
      (pick as any).environmentScore = envResult2.confidenceAdjustment;
      (pick as any).environmentComponents = envResult2.components;
      // APPLY environment adjustment to composite score
      pick.compositeScore = Math.min(95, Math.max(0, pick.compositeScore + envResult2.confidenceAdjustment));
      mispricedEnvApplied++;
    }
    if (mispricedEnvApplied > 0) {
      console.log(`[EnvironmentScore] Enriched ${mispricedEnvApplied} mispriced picks with environment_score`);
    }
  } catch (envErr) {
    console.log(`[EnvironmentScore] ⚠️ Failed to enrich mispriced picks: ${(envErr as any).message}`);
  }

  // === STEP 4: BOOST SWEET SPOT PICKS THAT HAVE MISPRICED MATCHES ===
  // Build a reverse lookup: mispriced lines keyed by normalized player|prop
  const mispricedLookup = new Map<string, { edge_pct: number; signal: string; defense_adjusted_avg: number | null; opponent_defense_rank: number | null }>();
  for (const ml of (rawMispricedLines || [])) {
    const normProp = PROP_TYPE_NORMALIZE[ml.prop_type?.toLowerCase()] || (ml.prop_type || '').replace(/^(player_|batter_|pitcher_)/, '').toLowerCase().trim();
    const key = `${(ml.player_name || '').toLowerCase().trim()}|${normProp}`;
    mispricedLookup.set(key, { edge_pct: Math.abs(ml.edge_pct || 0), signal: (ml.signal || '').toLowerCase(), defense_adjusted_avg: ml.defense_adjusted_avg, opponent_defense_rank: ml.opponent_defense_rank });
  }

  // Boost enrichedSweetSpots that also appear in mispriced lines
  let sweetSpotBoostedCount = 0;
  for (const ss of enrichedSweetSpots) {
    const ssKey = `${(ss.player_name || '').toLowerCase().trim()}|${(ss.prop_type || '').toLowerCase().trim()}`;
    const mispricedMatch = mispricedLookup.get(ssKey);
    if (mispricedMatch && mispricedMatch.edge_pct >= 15) {
      const sideMatch = mispricedMatch.signal === (ss.recommended_side || '').toLowerCase();
      if (sideMatch) {
        ss.compositeScore = Math.min(98, ss.compositeScore + 15);
        (ss as any).isDoubleConfirmed = true;
        (ss as any).mispricedEdge = mispricedMatch.edge_pct;
        sweetSpotBoostedCount++;
      }
    }
  }
  if (sweetSpotBoostedCount > 0) {
    console.log(`[Bot] 🔥 Boosted ${sweetSpotBoostedCount} sweet spot picks with mispriced edge confirmation`);
  }

  // Build double-confirmed pool: filtered mispriced picks with double confirmation
  const doubleConfirmedPicks = filteredMispricedPicks.filter((p: any) => p.isDoubleConfirmed === true);
  // Build triple-confirmed pool: double-confirmed + risk engine agreement
  const tripleConfirmedPicks = filteredMispricedPicks.filter((p: any) => p.isTripleConfirmed === true);
  // Build multi-engine consensus pool: 3+ engines agree on the same pick
  const multiEnginePicks = filteredMispricedPicks
    .filter((p: any) => (p.engineCount || 0) >= 3)
    .sort((a: any, b: any) => (b.compositeScore || 0) - (a.compositeScore || 0));
  console.log(`[Bot] Pool built: ${enrichedSweetSpots.length} player props, ${enrichedTeamPicks.length} team props, ${enrichedWhalePicks.length} whale picks, ${filteredMispricedPicks.length} mispriced picks, ${filteredCorrectPricedPicks.length} correct-priced, ${doubleConfirmedPicks.length} double-confirmed, ${tripleConfirmedPicks.length} triple-confirmed, ${multiEnginePicks.length} multi-engine(3+)`);

  return {
    playerPicks: enrichedSweetSpots,
    teamPicks: enrichedTeamPicks,
    sweetSpots: enrichedSweetSpots,
    whalePicks: enrichedWhalePicks,
    mispricedPicks: filteredMispricedPicks,
    correctPricedPicks: filteredCorrectPricedPicks,
    doubleConfirmedPicks,
    tripleConfirmedPicks,
    multiEnginePicks,
    totalPool: enrichedSweetSpots.length + enrichedTeamPicks.length + enrichedWhalePicks.length + filteredMispricedPicks.length + filteredCorrectPricedPicks.length,
    goldenCategories,
    defenseDetailMap,
    oddsMap,
    playerProps: playerProps || [],
    blowoutGames: blowoutGameInfos,
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

let globalGameUsage: Map<string, number> | undefined;
let globalMatchupUsage: Map<string, number> | undefined;
let globalTeamUsage: Map<string, number> | undefined;
let globalSlatePlayerPropUsage: Map<string, number> = new Map();
const MAX_GLOBAL_PLAYER_PROP_USAGE = 2;

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
  winningPatterns: any = null,
  isLightSlateMode: boolean = false,
  volumeMode: boolean = false,
  dynamicArchetypes: { categories: Set<string>; ranked: { category: string; winRate: number; appearances: number }[] } = { categories: new Set(FALLBACK_ARCHETYPE_CATEGORIES), ranked: [] },
  isThinPool: boolean = false
): Promise<{ count: number; parlays: any[] }> {
  // Clone config so we can override thresholds for thin slates without mutating the original
  const config = { ...TIER_CONFIG[tier] };
  const defenseDetailMap = pool.defenseDetailMap;
  const oddsMap = pool.oddsMap;
  const playerProps = pool.playerProps;

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
  if (isThinSlate && tier === 'execution') {
    config.minHitRate = 55;
    config.minEdge = 0.005;
    config.minSharpe = 0.015;
    config.minConfidence = 0.55;
    console.log(`[Bot] 🔶 Thin-slate: execution gates relaxed (hitRate≥55%, edge≥0.005)`);
  }

  // Light-slate: raise spread cap so large-spread games aren't blocked when pool is thin
  const effectiveSpreadCap = isLightSlateMode ? 25 : MAX_SPREAD_LINE;

  const tracker = createUsageTracker();
  const parlaysToCreate: any[] = [];
  const loggedNegEdgeKeys = new Set<string>(); // dedup NegEdgeBlock log spam across all profiles
  const rejectionCounters: Record<string, number> = { notEnoughLegs: 0, prob: 0, edge: 0, sharpe: 0, scoreFloor: 0, coherence: 0, duplicate: 0, mirror: 0, gameUsage: 0, teamUsage: 0, matchupUsage: 0, profileSkipped: 0, strategyCap: 0, crossSport: 0, envCluster: 0, godMode: 0 };

  console.log(`[Bot] Generating ${tier} tier (${config.count} target)`);

  // === BASEBALL SEASON GATE ===
  // Skip NCAA baseball profiles before March 1st (no reliable score coverage)
  const etDateForGate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const isBaseballSeasonActive = etDateForGate >= `${etDateForGate.slice(0, 4)}-03-01`;
  if (!isBaseballSeasonActive) {
    console.log(`[Bot] Baseball season gate: ACTIVE (${etDateForGate} < March 1st) — skipping baseball_ncaa profiles`);
  }

  // === STRATEGY DIVERSITY CAP ===
  // No single strategy can exceed 30% of the tier's total count
  const strategyDiversityCap = Math.max(2, Math.ceil(config.count * 0.30));
  const strategyCountMap = new Map<string, number>();
  console.log(`[Bot] Strategy diversity cap: max ${strategyDiversityCap} parlays per strategy (30% of ${config.count})`);

  const tierStartTime = Date.now();
  const TIMEOUT_MS = 140_000; // 140s wall-clock guard (Edge Function limit ~150s)
  let profileIndex = 0;

  for (const profile of config.profiles) {
    // === TIMEOUT GUARD ===
    const elapsed = Date.now() - tierStartTime;
    if (elapsed > TIMEOUT_MS) {
      const remaining = config.profiles.length - profileIndex;
      console.log(`[Bot] ⏰ TIMEOUT GUARD: ${elapsed}ms elapsed, skipping ${remaining} remaining profiles in ${tier} tier`);
      break;
    }
    profileIndex++;
    // Season gate: skip baseball profiles before March 1st
    if (!isBaseballSeasonActive && profile.sports?.includes('baseball_ncaa')) {
      continue;
    }
    if (parlaysToCreate.length >= config.count) break;

    // KILL 4-LEG EXPLORATION: 7% win rate on 4-leggers Mar 15-27 — only keep execution 4-leggers
    if (tier === 'exploration' && profile.legs >= 4) {
      continue;
    }

    // Priority strategies bypass the diversity cap — these are cross-referenced highest-conviction picks
    // NOTE: optimal_combo REMOVED from priority list — now subject to hard cap of 5/day (was 72% of losing volume)
    const PRIORITY_STRATEGIES = new Set(['sweet_spot_core', 'sweet_spot_plus', 'sweet_spot_l3', 'l3_matchup_combo', 'l3_sweet_mispriced_hybrid', 'double_confirmed_conviction', 'triple_confirmed_conviction', 'mixed_conviction_stack', 'floor_lock', 'ceiling_shot']);
    
    // HARD CAP: optimal_combo limited to 5 parlays per tier (was unlimited, caused 72% volume imbalance)
    if (profile.strategy === 'optimal_combo') {
      const optimalComboCount = strategyCountMap.get('optimal_combo') || 0;
      if (optimalComboCount >= 5) {
        console.log(`[Bot] ⏭️ optimal_combo HARD CAP reached (${optimalComboCount}/5), skipping`);
        continue;
      }
    }

    // Enforce strategy diversity cap + L10 volume throttling (skip for priority strategies)
    if (!PRIORITY_STRATEGIES.has(profile.strategy)) {
      const currentStrategyCount = strategyCountMap.get(profile.strategy) || 0;
      const l10VolumeCap = getStrategyVolumeCap(profile.strategy, strategyDiversityCap);
      const effectiveCap = Math.min(strategyDiversityCap, l10VolumeCap);
      if (currentStrategyCount >= effectiveCap) {
        console.log(`[Bot] ⏭️ Strategy cap reached for '${profile.strategy}' (${currentStrategyCount}/${effectiveCap}${l10VolumeCap < strategyDiversityCap ? ' L10-throttled' : ''}), skipping`);
        continue;
      }
    }

    const legs: any[] = [];
    const parlayTeamCount = new Map<string, number>();
    const parlayCategoryCount = new Map<string, number>();
    const parlayPropTypeCount = new Map<string, number>();

    // Determine which picks to use based on profile
    const isTeamProfile = profile.betTypes && profile.betTypes.length > 0;
    const isHybridProfile = !!profile.allowTeamLegs && !isTeamProfile;
    const sportFilter = profile.sports || ['all'];
    
    // Filter picks based on profile
    let candidatePicks: (EnrichedPick | EnrichedTeamPick)[] = [];
    
    // SWEET SPOT CORE: draw ONLY from sweet spots, all 3 legs must be sweet spot picks
    const isSweetSpotCoreProfile = profile.strategy === 'sweet_spot_core';
    // SWEET SPOT PLUS: 3 sweet spot legs + 1 bonus engine leg
    const isSweetSpotPlusProfile = profile.strategy === 'sweet_spot_plus';
    // WHALE SIGNAL: draw exclusively from whale picks pool
    const isWhaleProfile = profile.strategy.startsWith('whale_signal');
    // MISPRICED EDGE: draw exclusively from mispriced lines pool
    const isMispricedProfile = profile.strategy.startsWith('mispriced_edge');
    // DOUBLE-CONFIRMED: draw exclusively from double-confirmed picks (sweet spot + mispriced)
    const isDoubleConfirmedProfile = profile.strategy.startsWith('double_confirmed');
    // TRIPLE-CONFIRMED: sweet spot + mispriced + risk engine agreement
    const isTripleConfirmedProfile = profile.strategy.startsWith('triple_confirmed');
    // MULTI-ENGINE CONSENSUS: 3+ engines agree on the same pick
    const isMultiEngineProfile = profile.strategy.startsWith('multi_engine');
    // GOD MODE LOCK: intersection of triple-confirmed + proven winners + favorable matchup
    const isGodModeLockProfile = profile.strategy === 'god_mode_lock';
    // ROLE-STACKED 3/5/8-LEG: intentional SAFE/BALANCED/GREAT_ODDS stacking
    const isRoleStackedProfile = profile.strategy.startsWith('role_stacked');
    // MIXED CONVICTION STACK: mispriced + correct-priced + conviction
    const isMixedConvictionProfile = profile.strategy === 'mixed_conviction_stack';
    // MATCHUP EXPLOIT: all legs must attack weak defenses (matchupBoost > 0)
    const isMatchupExploitProfile = profile.strategy === 'matchup_exploit';
    // MATCHUP TEAM STACK: same team stacking against soft defense
    const isMatchupTeamStackProfile = profile.strategy === 'matchup_team_stack';
    // MATCHUP MISPRICED: intersection of mispriced edge AND matchup boost
    const isMatchupMispricedProfile = profile.strategy === 'matchup_mispriced';
    // FLOOR LOCK: L10 floor clears the line — safest possible picks
    const isFloorLockProfile = profile.strategy === 'floor_lock';
    // CEILING SHOT: Alt lines near L10 ceiling at plus-money odds
    const isCeilingShotProfile = profile.strategy === 'ceiling_shot';
    // OPTIMAL COMBO: Combinatorial optimizer for highest combined L10 hit rate
    const isOptimalComboProfile = profile.strategy === 'optimal_combo';
    // SWEET SPOT L3: 5-leg parlays scored by L3 recency
    const isSweetSpotL3Profile = profile.strategy === 'sweet_spot_l3';
    // L3 + MATCHUP COMBO: hybrid L3 recency + defensive matchup rankings
    const isL3MatchupComboProfile = profile.strategy === 'l3_matchup_combo';
    // L3 SWEET + MISPRICED HYBRID: 2 sweet spot legs + 3 L3-confirmed mispriced legs
    const isL3SweetMispricedHybridProfile = profile.strategy === 'l3_sweet_mispriced_hybrid';
    // BLOWOUT SCRIPT: same-game underdog unders + garbage time plays
    const isBlowoutScriptProfile = profile.strategy === 'blowout_script';

    // === OPTIMAL COMBO: Build pre-assembled combos via combinatorial optimization ===
    if (isOptimalComboProfile) {
      const optimalCombos = buildOptimalComboParlays(pool, profile, sportFilter, BLOCKED_SPORTS, 5);
      if (optimalCombos.length === 0) {
        console.log(`[Bot] ${tier}/optimal_combo: no valid combinations found`);
        continue;
      }
      // Each combo becomes a separate parlay — push directly and skip greedy loop
      for (const combo of optimalCombos) {
        if (parlaysToCreate.length >= config.count) break;
        const comboLegs = combo.map(pick => {
          const weight = 1.0;
          const rawL10 = (pick as any).l10_hit_rate || 0;
          const l10Pct = rawL10 <= 1 ? rawL10 * 100 : rawL10;
          const selectedLine = { line: pick.line, odds: pick.americanOdds, reason: 'optimal_combo_standard' };
          return {
            id: pick.id,
            player_name: pick.player_name,
            team_name: pick.team_name,
            prop_type: pick.prop_type,
            line: pick.line,
            side: pick.recommended_side || 'over',
            category: pick.category,
            weight,
            hit_rate: l10Pct,
            l10_hit_rate: l10Pct,
            confidence_score: pick.confidence_score || 0.5,
            american_odds: pick.americanOdds || -110,
            odds_value_score: pick.oddsValueScore,
            composite_score: pick.compositeScore,
            outcome: 'pending',
            original_line: pick.line,
            selected_line: pick.line,
            line_selection_reason: 'optimal_combo_standard',
            odds_improvement: 0,
            projection_buffer: (pick.projected_value || pick.l10_avg || 0) - pick.line,
            projected_value: pick.projected_value || pick.l10_avg || 0,
            line_source: pick.line_source || 'projected',
            has_real_line: pick.has_real_line || false,
            sport: pick.sport || deriveSportFromCategory(pick.category),
            defense_rank: (pick as any).defenseMatchupRank ?? null,
            defense_adj: (pick as any).defenseMatchupAdj ?? 0,
            l10_avg: pick.l10_avg || 0,
            l3_avg: pick.l3_avg || 0,
            l5_avg: pick.l5_avg || 0,
            l10_std_dev: pick.l10_std_dev || 0,
            season_avg: pick.season_avg || 0,
            matchup_adjustment: pick.matchup_adjustment || 0,
            pace_adjustment: pick.pace_adjustment || 0,
            h2h_matchup_boost: pick.h2h_matchup_boost || 0,
            bounce_back_score: pick.bounce_back_score || 0,
            line_difference: pick.line_difference || 0,
            l10_min: pick.l10_min || 0,
            l10_median: pick.l10_median || 0,
            h2h_avg_vs_opponent: (pick as any).h2h_avg_vs_opponent || 0,
            games_played: (pick as any).games_played || 0,
            projected_value: (pick as any).projected_value || 0,
          };
        });
        
        const combinedProb = comboLegs.reduce((p, l) => p * (l.hit_rate / 100), 1);
        const totalDecimalOdds = comboLegs.reduce((p, l) => {
          const odds = l.american_odds || -110;
          const decimal = odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
          return p * decimal;
        }, 1);
        const expectedOdds = totalDecimalOdds >= 2
          ? Math.round((totalDecimalOdds - 1) * 100)
          : Math.round(-100 / (totalDecimalOdds - 1));
        
        const hrStr = comboLegs.map(l => `${l.player_name} ${l.hit_rate.toFixed(0)}%`).join(' × ');
        
        // Fingerprint dedup
        const fingerprint = comboLegs.map(l => `${l.player_name}_${l.prop_type}_${l.side}_${l.line}`).sort().join('||');
        if (globalFingerprints.has(fingerprint)) continue;
        globalFingerprints.add(fingerprint);
        
        parlaysToCreate.push({
          parlay_date: targetDate,
          legs: comboLegs,
          leg_count: comboLegs.length,
          combined_probability: combinedProb,
          expected_odds: Math.min(expectedOdds, 10000),
          simulated_win_rate: combinedProb,
          simulated_edge: combinedProb - comboLegs.reduce((p, l) => p * americanToImplied(l.american_odds || -110), 1),
          simulated_sharpe: 0.1,
          strategy_name: `${strategyName}_${tier}_optimal_combo`,
          selection_rationale: `🎲 OPTIMAL COMBO: ${comboLegs.length}-leg parlay — ${hrStr} = ${(combinedProb * 100).toFixed(1)}% combined probability`,
          outcome: 'pending',
          is_simulated: tier !== 'execution',
          simulated_stake: typeof config.stake === 'number' && config.stake > 0 ? config.stake : 100,
          tier: tier,
        });
        
        strategyCountMap.set(profile.strategy, (strategyCountMap.get(profile.strategy) || 0) + 1);
        console.log(`[Bot] Created ${tier}/optimal_combo ${comboLegs.length}-leg parlay #${parlaysToCreate.length} (${(combinedProb * 100).toFixed(1)}% combined)`);
      }
      continue; // Skip the standard greedy loop for this profile
    }
    
    if (isSweetSpotCoreProfile) {
      // === SWEET SPOT CORE: All legs from category_sweet_spots — engine pre-vetted ===
      const filteredSweets = pool.sweetSpots.filter(p => {
        if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
        if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
        const hr = p.l10_hit_rate || p.confidence_score || 0;
        const hrPct = hr <= 1 ? hr * 100 : hr;
        return hrPct >= (profile.minHitRate || 55);
      });

      // Smart Stacking: sort by environment cluster then by confidence
      const sortBy = profile.sortBy || 'composite';
      if (sortBy === 'env_cluster_shootout') {
        // Group SHOOTOUT picks first, then GRIND, then NEUTRAL — within each group sort by confidence
        candidatePicks = filteredSweets.sort((a, b) => {
          const aCluster = (a._gameContext as any)?.envCluster || 'NEUTRAL';
          const bCluster = (b._gameContext as any)?.envCluster || 'NEUTRAL';
          const clusterOrder: Record<string, number> = { SHOOTOUT: 0, NEUTRAL: 1, GRIND: 2 };
          const orderDiff = (clusterOrder[aCluster] ?? 1) - (clusterOrder[bCluster] ?? 1);
          if (orderDiff !== 0) return orderDiff;
          return (b.compositeScore || 0) - (a.compositeScore || 0);
        });
      } else if (sortBy === 'env_cluster_grind') {
        // Group GRIND picks first, then NEUTRAL, then SHOOTOUT
        candidatePicks = filteredSweets.sort((a, b) => {
          const aCluster = (a._gameContext as any)?.envCluster || 'NEUTRAL';
          const bCluster = (b._gameContext as any)?.envCluster || 'NEUTRAL';
          const clusterOrder: Record<string, number> = { GRIND: 0, NEUTRAL: 1, SHOOTOUT: 2 };
          const orderDiff = (clusterOrder[aCluster] ?? 1) - (clusterOrder[bCluster] ?? 1);
          if (orderDiff !== 0) return orderDiff;
          return (b.compositeScore || 0) - (a.compositeScore || 0);
        });
      } else if (sortBy === 'hit_rate') {
        candidatePicks = filteredSweets.sort((a, b) => {
          const aHr = (a.l10_hit_rate || 0) <= 1 ? (a.l10_hit_rate || 0) * 100 : (a.l10_hit_rate || 0);
          const bHr = (b.l10_hit_rate || 0) <= 1 ? (b.l10_hit_rate || 0) * 100 : (b.l10_hit_rate || 0);
          return bHr - aHr;
        });
      } else if (sortBy === 'shuffle') {
        candidatePicks = filteredSweets.sort(() => Math.random() - 0.5);
      } else {
        candidatePicks = filteredSweets.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));
      }

      if (candidatePicks.length < profile.legs) {
        console.log(`[Bot] ${tier}/sweet_spot_core: only ${candidatePicks.length} sweet spots with ${profile.minHitRate}%+ hit rate, need ${profile.legs}`);
        continue;
      }
      console.log(`[Bot] ${tier}/sweet_spot_core: ${candidatePicks.length} sweet spot candidates (minHR=${profile.minHitRate}%, sort=${sortBy})`);
    } else if (isSweetSpotL3Profile) {
      // === SWEET SPOT L3: 5-leg parlays scored by L3 average vs line ===
      const l3Filtered = pool.sweetSpots.filter(p => {
        if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
        if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
        const l3 = (p as any).l3_avg;
        if (l3 == null) return false;
        const hr = p.l10_hit_rate || p.confidence_score || 0;
        const hrPct = hr <= 1 ? hr * 100 : hr;
        if (hrPct < (profile.minHitRate || 55)) return false;
        const side = (p.recommended_side || 'over').toLowerCase();
        if (side === 'over' && l3 <= p.line) return false;
        if (side === 'under' && l3 >= p.line) return false;
        return true;
      });
      // Score by L3 distance from line
      candidatePicks = l3Filtered.map(p => {
        const l3 = (p as any).l3_avg;
        const side = (p.recommended_side || 'over').toLowerCase();
        const l3Score = side === 'over' ? l3 - p.line : p.line - l3;
        (p as any)._l3Score = l3Score;
        return p;
      }).sort((a, b) => ((b as any)._l3Score || 0) - ((a as any)._l3Score || 0));

      if (candidatePicks.length < profile.legs) {
        console.log(`[Bot] ${tier}/sweet_spot_l3: only ${candidatePicks.length} L3-qualified picks, need ${profile.legs}`);
        continue;
      }
      console.log(`[Bot] ${tier}/sweet_spot_l3: ${candidatePicks.length} candidates sorted by L3 score (top: ${candidatePicks[0]?.player_name} L3=${((candidatePicks[0] as any)?.l3_avg || 0).toFixed(1)})`);
    } else if (isL3MatchupComboProfile) {
      // === L3 + MATCHUP COMBO: hybrid L3 recency + defensive matchup rankings ===
      // Uses _gameContext.opponentAbbrev + defenseDetailMap for prop-specific defense rank
      const getPropDefRank = (p: any): number => {
        const ctx = p._gameContext as any;
        const oppAbbrev = ctx?.opponentAbbrev;
        if (!oppAbbrev) return 0;
        const defDetail = defenseDetailMap.get(oppAbbrev);
        if (!defDetail) return 0;
        const propType = (p.prop_type || '').toLowerCase();
        if (propType.includes('rebound')) return defDetail.opp_rebounds_rank || defDetail.overall_rank || 0;
        if (propType.includes('assist')) return defDetail.opp_assists_rank || defDetail.overall_rank || 0;
        if (propType.includes('three') || propType.includes('3p')) return defDetail.opp_threes_rank || defDetail.overall_rank || 0;
        if (propType.includes('point')) return defDetail.opp_points_rank || defDetail.overall_rank || 0;
        return defDetail.overall_rank || 0;
      };

      const l3MatchupFiltered = pool.sweetSpots.filter(p => {
        if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
        if ((p.sport || 'basketball_nba') !== 'basketball_nba') return false;
        const l3 = (p as any).l3_avg;
        if (l3 == null) return false;
        const hr = p.l10_hit_rate || p.confidence_score || 0;
        const hrPct = hr <= 1 ? hr * 100 : hr;
        if (hrPct < (profile.minHitRate || 55)) return false;
        const side = (p.recommended_side || 'over').toLowerCase();
        if (side === 'over' && l3 <= p.line) return false;
        if (side === 'under' && l3 >= p.line) return false;
        const defRank = getPropDefRank(p);
        if (defRank < 18) return false;
        return true;
      });

      // Score by combined L3 margin + defensive rank
      candidatePicks = l3MatchupFiltered.map(p => {
        const l3 = (p as any).l3_avg;
        const side = (p.recommended_side || 'over').toLowerCase();
        const l3Margin = side === 'over' ? l3 - p.line : p.line - l3;
        const defRank = getPropDefRank(p);
        // Normalize: L3 margin (0-10 range) + defense rank (18-30 → 0-12 range)
        const l3Score = Math.min(l3Margin, 10); // cap at 10
        const defScore = defRank - 18; // 0-12 range
        const combinedScore = (l3Score * 0.5) + (defScore * 0.5);
        (p as any)._l3MatchupScore = combinedScore;
        (p as any)._l3Score = l3Margin;
        (p as any)._defRank = defRank;
        return p;
      }).sort((a, b) => ((b as any)._l3MatchupScore || 0) - ((a as any)._l3MatchupScore || 0));

      if (candidatePicks.length < profile.legs) {
        console.log(`[Bot] ${tier}/l3_matchup_combo: only ${candidatePicks.length} L3+matchup picks (need ${profile.legs}). Top: ${candidatePicks[0]?.player_name || 'none'}`);
        continue;
      }
      const top = candidatePicks[0];
      console.log(`[Bot] ${tier}/l3_matchup_combo: ${candidatePicks.length} candidates (top: ${top?.player_name} L3=${((top as any)?.l3_avg || 0).toFixed(1)} vs line ${top?.line} DEF#${(top as any)?._defRank} score=${((top as any)?._l3MatchupScore || 0).toFixed(2)})`);
    } else if (isL3SweetMispricedHybridProfile) {
      // === L3 SWEET + MISPRICED HYBRID: 2 sweet spot legs + 3 L3-confirmed mispriced legs ===
      const requiredLegs = profile.legs;
      const sweetLegs = Math.min(2, requiredLegs - 1);
      const mispricedLegs = requiredLegs - sweetLegs;
      const usedNames = new Set<string>();

      // Pool 1: Sweet spot picks with L3 clearing line
      const sweetCandidates = pool.sweetSpots.filter(p => {
        if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
        if ((p.sport || 'basketball_nba') !== 'basketball_nba') return false;
        const l3 = (p as any).l3_avg;
        if (l3 == null) return false;
        const hr = p.l10_hit_rate || p.confidence_score || 0;
        const hrPct = hr <= 1 ? hr * 100 : hr;
        if (hrPct < (profile.minHitRate || 50)) return false;
        const side = (p.recommended_side || 'over').toLowerCase();
        if (side === 'over' && l3 <= p.line) return false;
        if (side === 'under' && l3 >= p.line) return false;
        return true;
      }).map(p => {
        const l3 = (p as any).l3_avg;
        const side = (p.recommended_side || 'over').toLowerCase();
        (p as any)._l3Score = side === 'over' ? l3 - p.line : p.line - l3;
        return p;
      }).sort((a, b) => ((b as any)._l3Score || 0) - ((a as any)._l3Score || 0));

      // Pool 2: Mispriced picks with L3 confirmation
      const mispricedCandidates = (pool.mispricedPicks || []).filter(p => {
        if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
        if ((p.sport || 'basketball_nba') !== 'basketball_nba') return false;
        const ctx = (p as any).shooting_context || (p as any)._shootingContext || {};
        if (ctx.l3_confirms !== true) return false;
        const hr = (p as any).l10_hit_rate || p.confidence_score || 0;
        const hrPct = hr <= 1 ? hr * 100 : hr;
        if (hrPct < (profile.minHitRate || 50)) return false;
        // Ensure positive directional edge
        if ((p as any).edge_pct <= 3) return false;
        return true;
      }).sort((a, b) => ((b as any).edge_pct || 0) - ((a as any).edge_pct || 0));

      if (sweetCandidates.length < sweetLegs || mispricedCandidates.length < mispricedLegs) {
        console.log(`[Bot] ${tier}/l3_sweet_mispriced_hybrid: insufficient candidates (sweet=${sweetCandidates.length}/${sweetLegs}, mispriced=${mispricedCandidates.length}/${mispricedLegs})`);
        continue;
      }

      // Pick top sweet spot legs, then fill mispriced avoiding same player
      const selectedSweet = [];
      for (const p of sweetCandidates) {
        if (selectedSweet.length >= sweetLegs) break;
        const name = (p.player_name || '').toLowerCase();
        if (usedNames.has(name)) continue;
        usedNames.add(name);
        selectedSweet.push(p);
      }

      const selectedMispriced = [];
      for (const p of mispricedCandidates) {
        if (selectedMispriced.length >= mispricedLegs) break;
        const name = (p.player_name || '').toLowerCase();
        if (usedNames.has(name)) continue;
        usedNames.add(name);
        selectedMispriced.push(p);
      }

      if (selectedSweet.length < sweetLegs || selectedMispriced.length < mispricedLegs) {
        console.log(`[Bot] ${tier}/l3_sweet_mispriced_hybrid: dedup reduced below threshold (sweet=${selectedSweet.length}, mispriced=${selectedMispriced.length})`);
        continue;
      }

      candidatePicks = [...selectedSweet, ...selectedMispriced];
      console.log(`[Bot] ${tier}/l3_sweet_mispriced_hybrid: ${sweetLegs} sweet + ${mispricedLegs} mispriced = ${candidatePicks.length} legs (top sweet: ${selectedSweet[0]?.player_name}, top mispriced: ${selectedMispriced[0]?.player_name} edge=${((selectedMispriced[0] as any)?.edge_pct || 0).toFixed(1)}%)`);
    } else if (isSweetSpotPlusProfile) {
      // === SWEET SPOT PLUS: 3 sweet spot legs + 1 bonus from other engines ===
      const sweetCandidates = pool.sweetSpots.filter(p => {
        if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
        if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
        const hr = p.l10_hit_rate || p.confidence_score || 0;
        const hrPct = hr <= 1 ? hr * 100 : hr;
        return hrPct >= (profile.minHitRate || 55);
      }).sort((a, b) => {
        const sortBy = profile.sortBy || 'composite';
        if (sortBy === 'env_cluster_shootout') {
          const aC = (a._gameContext as any)?.envCluster || 'NEUTRAL';
          const bC = (b._gameContext as any)?.envCluster || 'NEUTRAL';
          const o: Record<string, number> = { SHOOTOUT: 0, NEUTRAL: 1, GRIND: 2 };
          const d = (o[aC] ?? 1) - (o[bC] ?? 1);
          if (d !== 0) return d;
        } else if (sortBy === 'env_cluster_grind') {
          const aC = (a._gameContext as any)?.envCluster || 'NEUTRAL';
          const bC = (b._gameContext as any)?.envCluster || 'NEUTRAL';
          const o: Record<string, number> = { GRIND: 0, NEUTRAL: 1, SHOOTOUT: 2 };
          const d = (o[aC] ?? 1) - (o[bC] ?? 1);
          if (d !== 0) return d;
        } else if (sortBy === 'hit_rate') {
          const aHr = (a.l10_hit_rate || 0) <= 1 ? (a.l10_hit_rate || 0) * 100 : (a.l10_hit_rate || 0);
          const bHr = (b.l10_hit_rate || 0) <= 1 ? (b.l10_hit_rate || 0) * 100 : (b.l10_hit_rate || 0);
          return bHr - aHr;
        } else if (sortBy === 'shuffle') {
          return Math.random() - 0.5;
        }
        return (b.compositeScore || 0) - (a.compositeScore || 0);
      });

      if (sweetCandidates.length < 3) {
        console.log(`[Bot] ${tier}/sweet_spot_plus: only ${sweetCandidates.length} sweet spots, need 3 for base`);
        continue;
      }

      // Collect used player names from top 3 sweet spots
      const usedNames = new Set(sweetCandidates.slice(0, 3).map(p => (p.player_name || '').toLowerCase()));

      // Bonus leg: best pick from other engines NOT already in parlay
      const bonusCandidates = [
        ...(pool.mispricedPicks || []),
        ...(pool.whalePicks || []),
        ...(pool.doubleConfirmedPicks || []),
        ...(pool.multiEnginePicks || []),
      ].filter(p => {
        if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
        if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
        if (usedNames.has((p.player_name || '').toLowerCase())) return false;
        // Quality gate: composite >= 65 and hit rate >= 55% (relaxed for thin slates)
        if (p.compositeScore < 65) return false;
        const hr = (p as any).l10_hit_rate || p.confidence_score || 0;
        const hrPct = hr <= 1 ? hr * 100 : hr;
        if (hrPct < 55) return false;
        return true;
      }).sort((a, b) => b.compositeScore - a.compositeScore);

      if (bonusCandidates.length === 0) {
        console.log(`[Bot] ${tier}/sweet_spot_plus: no bonus candidates pass quality gate, falling back to sweet_spot_core`);
        candidatePicks = sweetCandidates;
        // Override to 3 legs
        (profile as any)._overrideLegs = 3;
      } else {
        // Build candidate array: 3 sweet spots + bonus candidates appended
        candidatePicks = [...sweetCandidates.slice(0, 3), ...bonusCandidates];
        console.log(`[Bot] ${tier}/sweet_spot_plus: 3 sweet spots + ${bonusCandidates.length} bonus candidates (best: ${bonusCandidates[0]?.player_name})`);
      }
    } else if (isMixedConvictionProfile) {
      // === MIXED CONVICTION STACK: 3-leg with one from each conviction source ===
      const usedNames = new Set<string>();
      const minHitRate = (profile.minHitRate || 65) / 100;

      // LEG 1: Best conviction leg (triple > double confirmed, highest composite)
      const convictionPool = [
        ...(pool.tripleConfirmedPicks || []),
        ...(pool.doubleConfirmedPicks || []),
      ].filter(p => {
        if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
        if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
        return true;
      }).sort((a, b) => {
        // Triple > double, then by composite
        const aTriple = (a as any).isTripleConfirmed ? 1 : 0;
        const bTriple = (b as any).isTripleConfirmed ? 1 : 0;
        if (bTriple !== aTriple) return bTriple - aTriple;
        return b.compositeScore - a.compositeScore;
      });

      const convictionLeg = convictionPool[0];
      if (convictionLeg) usedNames.add((convictionLeg.player_name || '').toLowerCase());

      // LEG 2: Best mispriced leg (different player, highest edge)
      const mispricedPool = [...(pool.mispricedPicks || [])]
        .filter(p => {
          if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
          if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
          if (usedNames.has((p.player_name || '').toLowerCase())) return false;
          return true;
        })
        .sort((a: any, b: any) => (b.edge_pct || 0) - (a.edge_pct || 0));

      const mispricedLeg = mispricedPool[0];
      if (mispricedLeg) usedNames.add((mispricedLeg.player_name || '').toLowerCase());

      // LEG 3: Best correct-priced leg (different player, highest hit rate, 65%+ required)
      const correctPricedPool = [...(pool.correctPricedPicks || [])]
        .filter(p => {
          if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
          if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
          if (usedNames.has((p.player_name || '').toLowerCase())) return false;
          const hr = p.l10_hit_rate || p.confidence_score || 0;
          const hrPct = hr <= 1 ? hr * 100 : hr;
          return hrPct >= (minHitRate * 100);
        })
        .sort((a, b) => {
          const aHr = (a.l10_hit_rate || 0) <= 1 ? (a.l10_hit_rate || 0) * 100 : (a.l10_hit_rate || 0);
          const bHr = (b.l10_hit_rate || 0) <= 1 ? (b.l10_hit_rate || 0) * 100 : (b.l10_hit_rate || 0);
          return bHr - aHr;
        });

      const correctPricedLeg = correctPricedPool[0];

      const mixedLegs = [convictionLeg, mispricedLeg, correctPricedLeg].filter(Boolean);
      if (mixedLegs.length < 3) {
        console.log(`[Bot] ${tier}/mixed_conviction_stack: insufficient picks (conviction=${convictionLeg ? 1 : 0}, mispriced=${mispricedLeg ? 1 : 0}, correct_priced=${correctPricedLeg ? 1 : 0}), skipping`);
        continue;
      }

      // Tag leg roles
      (mixedLegs[0] as any)._legRole = 'conviction';
      (mixedLegs[1] as any)._legRole = 'mispriced';
      (mixedLegs[2] as any)._legRole = 'correct_priced';

      candidatePicks = mixedLegs as EnrichedPick[];
      console.log(`[Bot] ${tier}/mixed_conviction_stack: conviction=${convictionLeg!.player_name}, mispriced=${mispricedLeg!.player_name}, correct_priced=${correctPricedLeg!.player_name}`);
    } else if (isRoleStackedProfile) {
      // Build 3-pass role-based parlay from enrichedSweetSpots
      const nbaPlayerPicks = pool.sweetSpots.filter(p => {
        if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
        if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
        return true;
      });

      // PASS 1: SAFE — l10_hit_rate >= 70%, no defense hard-block, strongest composite
      const safePick = nbaPlayerPicks
        .filter(p => {
          const hr = p.l10_hit_rate || p.confidence_score || 0;
          const hrPct = hr <= 1 ? hr * 100 : hr;
          if (hrPct < 70) return false;
          const defRank = (p as any).defenseMatchupRank ?? null;
          if (defRank !== null && defRank < 15) return false;
          return true;
        })
        .sort((a, b) => {
          const aHr = (a.l10_hit_rate || 0) <= 1 ? (a.l10_hit_rate || 0) * 100 : (a.l10_hit_rate || 0);
          const bHr = (b.l10_hit_rate || 0) <= 1 ? (b.l10_hit_rate || 0) * 100 : (b.l10_hit_rate || 0);
          return bHr - aHr;
        })[0];

      // PASS 2: BALANCED — l10_hit_rate >= 60%, isDoubleConfirmed || isMispriced, composite >= 75
      const usedSafeName = safePick ? (safePick.player_name || '').toLowerCase() : '';
      const balancedPick = nbaPlayerPicks
        .filter(p => {
          if ((p.player_name || '').toLowerCase() === usedSafeName) return false;
          const hr = p.l10_hit_rate || p.confidence_score || 0;
          const hrPct = hr <= 1 ? hr * 100 : hr;
          if (hrPct < 60) return false;
          if (!(p as any).isDoubleConfirmed && !(p as any).isMispriced) return false;
          if (p.compositeScore < 75) return false;
          const defRank = (p as any).defenseMatchupRank ?? null;
          if (defRank !== null && defRank < 18) return false;
          return true;
        })
        .sort((a, b) => b.compositeScore - a.compositeScore)[0];

      // PASS 3: GREAT ODDS — plus-money alt line or highest oddsValueScore, volume candidate preferred
      const usedNames = new Set([usedSafeName, balancedPick ? (balancedPick.player_name || '').toLowerCase() : '']);
      const greatOddsPick = nbaPlayerPicks
        .filter(p => {
          if (usedNames.has((p.player_name || '').toLowerCase())) return false;
          const hr = p.l10_hit_rate || p.confidence_score || 0;
          const hrPct = hr <= 1 ? hr * 100 : hr;
          if (hrPct < 55) return false;
          return true;
        })
        .sort((a, b) => {
          // Prefer plus-money odds, then oddsValueScore
          const aPlus = a.americanOdds >= 120 ? 1 : 0;
          const bPlus = b.americanOdds >= 120 ? 1 : 0;
          if (bPlus !== aPlus) return bPlus - aPlus;
          return (b.oddsValueScore || 0) - (a.oddsValueScore || 0);
        })[0];

      // Build candidatePicks from the 3 role picks
      const rolePicks = [safePick, balancedPick, greatOddsPick].filter(Boolean);
      if (rolePicks.length < 3) {
        // Fallback: fill from top composite
        const remaining = nbaPlayerPicks
          .filter(p => !usedNames.has((p.player_name || '').toLowerCase()))
          .sort((a, b) => b.compositeScore - a.compositeScore);
        for (const p of remaining) {
          if (rolePicks.length >= 3) break;
          if (!usedNames.has((p.player_name || '').toLowerCase())) {
            rolePicks.push(p);
            usedNames.add((p.player_name || '').toLowerCase());
          }
        }
      }
      candidatePicks = rolePicks as EnrichedPick[];
      
      // Tag the leg roles for later
      const roleLabels = ['safe', 'balanced', 'great_odds'];
      for (let ri = 0; ri < candidatePicks.length; ri++) {
        (candidatePicks[ri] as any)._legRole = roleLabels[ri] || 'fallback';
      }
      
      console.log(`[Bot] ${tier}/role_stacked_3leg: ${candidatePicks.length} role picks (safe: ${safePick ? safePick.player_name : 'none'}, balanced: ${balancedPick ? balancedPick.player_name : 'none'}, great_odds: ${greatOddsPick ? greatOddsPick.player_name : 'none'})`);
    } else if (isGodModeLockProfile) {
      // GOD MODE: filter for picks that pass ALL quality gates simultaneously
      const godCandidates = [
        ...(pool.tripleConfirmedPicks || []),
        ...(pool.multiEnginePicks || []).filter(p => (p as any).engineCount >= 3),
      ];
      candidatePicks = godCandidates
        .filter(p => {
          if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
          if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
          // Must be a GOD MODE pick (proven winner + favorable matchup + high conviction)
          return isGodModePick(p);
        })
        .sort((a, b) => b.compositeScore - a.compositeScore);
      
      if (candidatePicks.length < profile.legs) {
        // Fallback: triple-confirmed OR multi-engine with 70%+ L10 hit rate
        const fallback = [...(pool.tripleConfirmedPicks || []), ...(pool.doubleConfirmedPicks || [])]
          .filter(p => {
            if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
            if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
            const playerKey = `${(p.player_name || '').toLowerCase()}|${((p as any).prop_type || '').toLowerCase()}`;
            const perf = playerPerformanceMap.get(playerKey);
            return perf && perf.legsPlayed >= 5 && perf.hitRate >= 0.70;
          })
          .sort((a, b) => b.compositeScore - a.compositeScore);
        
        if (fallback.length >= profile.legs) {
          candidatePicks = fallback;
          console.log(`[GOD MODE] Fallback: ${fallback.length} proven winners from triple+double confirmed`);
        } else {
          console.log(`[GOD MODE] Only ${candidatePicks.length} god-mode + ${fallback.length} fallback picks, need ${profile.legs}`);
          continue;
        }
      } else {
        console.log(`[GOD MODE] 🔥 Using ${candidatePicks.length} GOD MODE picks for ${profile.legs}-leg parlay`);
      }
    } else if (isTripleConfirmedProfile) {
      // Triple-confirmed: use triple pool, fallback to double-confirmed, then mispriced
      candidatePicks = [...(pool.tripleConfirmedPicks || [])]
        .filter(p => {
          if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
          if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
          return true;
        })
        .sort((a, b) => b.compositeScore - a.compositeScore);
      if (candidatePicks.length < profile.legs) {
        // Fallback to double-confirmed
        const dcFallback = [...(pool.doubleConfirmedPicks || [])]
          .filter(p => {
            if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
            if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
            return true;
          })
          .sort((a, b) => b.compositeScore - a.compositeScore);
        if (dcFallback.length >= profile.legs) {
          candidatePicks = dcFallback;
          console.log(`[Bot] ${tier}/triple_confirmed: fallback to ${dcFallback.length} double-confirmed picks`);
        } else {
          console.log(`[Bot] ${tier}/triple_confirmed: only ${candidatePicks.length} triple + ${dcFallback.length} double picks, need ${profile.legs}`);
          continue;
        }
      } else {
        console.log(`[Bot] ${tier}/triple_confirmed: using ${candidatePicks.length} triple-confirmed picks for ${profile.legs}-leg parlay`);
      }
    } else if (isMultiEngineProfile) {
      // Multi-engine consensus: use picks with 3+ engine agreement
      candidatePicks = [...(pool.multiEnginePicks || [])]
        .filter(p => {
          if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
          if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
          return true;
        })
        .sort((a, b) => b.compositeScore - a.compositeScore);
      if (candidatePicks.length < profile.legs) {
        // Fallback to mispriced sorted by engineCount
        const meFallback = [...(pool.mispricedPicks || [])]
          .filter(p => {
            if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
            if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
            return (p as any).engineCount >= 2;
          })
          .sort((a: any, b: any) => (b.engineCount || 0) - (a.engineCount || 0));
        if (meFallback.length >= profile.legs) {
          candidatePicks = meFallback;
          console.log(`[Bot] ${tier}/multi_engine: fallback to ${meFallback.length} mispriced picks with 2+ engines`);
        } else {
          console.log(`[Bot] ${tier}/multi_engine: only ${candidatePicks.length} multi-engine + ${meFallback.length} fallback picks, need ${profile.legs}`);
          continue;
        }
      } else {
        console.log(`[Bot] ${tier}/multi_engine: using ${candidatePicks.length} multi-engine picks for ${profile.legs}-leg parlay`);
      }
    } else if (isDoubleConfirmedProfile) {
      candidatePicks = [...(pool.doubleConfirmedPicks || [])]
        .filter(p => {
          if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
          if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
          return true;
        })
        .sort((a, b) => b.compositeScore - a.compositeScore);
      if (candidatePicks.length < profile.legs) {
        // === SMARTER DOUBLE-CONFIRMED FALLBACK TIERS ===
        let fallbackTier = '';
        // Tier A: mispriced picks with 65%+ hit rate (partial double-confirmed)
        const tierA = [...(pool.mispricedPicks || [])]
          .filter(p => {
            if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
            if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
            return (p as any).l10_hit_rate >= 0.65 && !(p as any).isDoubleConfirmed;
          })
          .sort((a, b) => b.compositeScore - a.compositeScore);
        if (tierA.length >= profile.legs) {
          candidatePicks = tierA;
          fallbackTier = 'A (mispriced 65%+ hit rate)';
        } else {
          // Tier B: sweet spots with mispriced edge 10%+ (near-miss)
          const tierB = [...(pool.sweetSpots || [])]
            .filter(p => {
              if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
              if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
              return (p as any).isDoubleConfirmed || (p as any).mispricedEdge >= 10;
            })
            .sort((a, b) => b.compositeScore - a.compositeScore);
          if (tierB.length >= profile.legs) {
            candidatePicks = tierB;
            fallbackTier = 'B (sweet spots with 10%+ edge)';
          } else {
            // Tier C: risk-confirmed mispriced with 60%+ hit rate
            const tierC = [...(pool.mispricedPicks || [])]
              .filter(p => {
                if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
                if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
                return (p as any).l10_hit_rate >= 0.60;
              })
              .sort((a, b) => b.compositeScore - a.compositeScore);
            if (tierC.length >= profile.legs) {
              candidatePicks = tierC;
              fallbackTier = 'C (mispriced 60%+ hit rate)';
            }
          }
        }
        if (fallbackTier) {
          console.log(`[Bot] ${tier}/double_confirmed: FALLBACK tier ${fallbackTier} with ${candidatePicks.length} picks for ${profile.legs}-leg parlay`);
        } else {
          console.log(`[Bot] ${tier}/double_confirmed: only ${candidatePicks.length} picks + all fallbacks exhausted, need ${profile.legs}`);
          continue;
        }
      } else {
        console.log(`[Bot] ${tier}/double_confirmed: using ${candidatePicks.length} double-confirmed picks for ${profile.legs}-leg parlay`);
      }
    } else if (isMatchupExploitProfile) {
      // === MATCHUP EXPLOIT: all legs must attack weak defenses (matchupBoost > 0) ===
      const matchupPool = [...pool.sweetSpots, ...(pool.mispricedPicks || [])]
        .filter(p => {
          if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
          if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
          if (!((p as any).matchupBoost > 0)) return false;
          const hr = (p as any).l10_hit_rate || p.confidence_score || 0;
          const hrPct = hr <= 1 ? hr * 100 : hr;
          return hrPct >= (profile.minHitRate || 45);
        });
      // Deduplicate by player+prop
      const seenMatchup = new Set<string>();
      const dedupedMatchup = matchupPool.filter(p => {
        const key = `${(p.player_name || '').toLowerCase()}|${((p as any).prop_type || p.category || '').toLowerCase()}`;
        if (seenMatchup.has(key)) return false;
        seenMatchup.add(key);
        return true;
      });
      const sortBy = profile.sortBy || 'composite';
      if (sortBy === 'hit_rate') {
        candidatePicks = dedupedMatchup.sort((a, b) => {
          const aHr = ((a as any).l10_hit_rate || 0) <= 1 ? ((a as any).l10_hit_rate || 0) * 100 : ((a as any).l10_hit_rate || 0);
          const bHr = ((b as any).l10_hit_rate || 0) <= 1 ? ((b as any).l10_hit_rate || 0) * 100 : ((b as any).l10_hit_rate || 0);
          return bHr - aHr;
        });
      } else if (sortBy === 'shuffle') {
        candidatePicks = dedupedMatchup.sort(() => Math.random() - 0.5);
      } else {
        candidatePicks = dedupedMatchup.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));
      }
      if (candidatePicks.length < profile.legs) {
        console.log(`[Bot] ${tier}/matchup_exploit: only ${candidatePicks.length} matchup-boosted picks, need ${profile.legs}`);
        continue;
      }
      console.log(`[Bot] ${tier}/matchup_exploit: ${candidatePicks.length} matchup-boosted picks (sort=${sortBy}, minHR=${profile.minHitRate}%)`);
      // Player exposure capped at 1 globally — no matchup override
    } else if (isMatchupTeamStackProfile) {
      // === MATCHUP TEAM STACK: same-team stacking against soft defense ===
      const matchupTeamPool = [...pool.sweetSpots, ...(pool.mispricedPicks || [])]
        .filter(p => {
          if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
          if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
          if (!((p as any).matchupBoost > 0)) return false;
          const hr = (p as any).l10_hit_rate || p.confidence_score || 0;
          const hrPct = hr <= 1 ? hr * 100 : hr;
          return hrPct >= (profile.minHitRate || 45);
        });
      // Deduplicate
      const seenTS = new Set<string>();
      const dedupedTS = matchupTeamPool.filter(p => {
        const key = `${(p.player_name || '').toLowerCase()}|${((p as any).prop_type || p.category || '').toLowerCase()}`;
        if (seenTS.has(key)) return false;
        seenTS.add(key);
        return true;
      });
      // Group by team abbreviation
      const teamGroups = new Map<string, typeof dedupedTS>();
      for (const p of dedupedTS) {
        const team = ((p as any).team_abbrev || (p as any).team_name || '').toUpperCase().slice(0, 3);
        if (!team) continue;
        if (!teamGroups.has(team)) teamGroups.set(team, []);
        teamGroups.get(team)!.push(p);
      }
      // Find best team with enough picks
      let bestTeam = '';
      let bestTeamScore = -1;
      for (const [team, picks] of teamGroups) {
        if (picks.length < profile.legs) continue;
        const avgScore = picks.reduce((s, p) => s + (p.compositeScore || 0), 0) / picks.length;
        if (avgScore > bestTeamScore) {
          bestTeamScore = avgScore;
          bestTeam = team;
        }
      }
      if (!bestTeam || !teamGroups.has(bestTeam)) {
        console.log(`[Bot] ${tier}/matchup_team_stack: no team has ${profile.legs}+ matchup-boosted picks (teams: ${[...teamGroups.entries()].map(([t, p]) => `${t}:${p.length}`).join(', ')})`);
        continue;
      }
      const teamPicks = teamGroups.get(bestTeam)!;
      const sortBy = profile.sortBy || 'composite';
      if (sortBy === 'hit_rate') {
        candidatePicks = teamPicks.sort((a, b) => {
          const aHr = ((a as any).l10_hit_rate || 0) <= 1 ? ((a as any).l10_hit_rate || 0) * 100 : ((a as any).l10_hit_rate || 0);
          const bHr = ((b as any).l10_hit_rate || 0) <= 1 ? ((b as any).l10_hit_rate || 0) * 100 : ((b as any).l10_hit_rate || 0);
          return bHr - aHr;
        });
      } else if (sortBy === 'shuffle') {
        candidatePicks = teamPicks.sort(() => Math.random() - 0.5);
      } else {
        candidatePicks = teamPicks.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));
      }
      console.log(`[Bot] ${tier}/matchup_team_stack: stacking ${bestTeam} with ${candidatePicks.length} matchup picks (avg score ${bestTeamScore.toFixed(1)})`);
    } else if (isMatchupMispricedProfile) {
      // === MATCHUP MISPRICED: intersection of mispriced edge AND matchup boost ===
      const matchupMispricedPool = [...(pool.mispricedPicks || [])]
        .filter(p => {
          if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
          if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
          if (!((p as any).matchupBoost > 0)) return false;
          const hr = (p as any).l10_hit_rate || p.confidence_score || 0;
          const hrPct = hr <= 1 ? hr * 100 : hr;
          return hrPct >= (profile.minHitRate || 45);
        });
      const sortBy = profile.sortBy || 'composite';
      if (sortBy === 'shuffle') {
        candidatePicks = matchupMispricedPool.sort(() => Math.random() - 0.5);
      } else {
        candidatePicks = matchupMispricedPool.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));
      }
      if (candidatePicks.length < profile.legs) {
        console.log(`[Bot] ${tier}/matchup_mispriced: only ${candidatePicks.length} mispriced+matchup picks, need ${profile.legs}`);
        continue;
      }
      console.log(`[Bot] ${tier}/matchup_mispriced: ${candidatePicks.length} mispriced+matchup picks (sort=${sortBy})`);
    } else if (isFloorLockProfile) {
      // === FLOOR LOCK: All legs must have L10 floor clearing the line ===
      const withL10Min = pool.sweetSpots.filter(p => (p as any).l10_min != null);
      const floorCandidates = pool.sweetSpots.filter(p => {
        if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
        if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
        const hr = p.l10_hit_rate || p.confidence_score || 0;
        const hrPct = hr <= 1 ? hr * 100 : hr;
        if (hrPct < (profile.minHitRate || 70)) return false;
        // Use actual_line if available, else fall back to recommended_line
        const compareLine = p.line || (p as any).recommended_line;
        if (!compareLine || compareLine <= 0) return false;
        // FLOOR GATE: L10 min must clear at least 85% of the line (relaxed — strict 100% finds 0 candidates with real sportsbook lines)
        // Safety backstop: require l10_hit_rate >= 70% to ensure consistency
        const l10Min = (p as any).l10_min;
        const l10Hr = p.l10_hit_rate || p.confidence_score || 0;
        const l10HrPct = l10Hr <= 1 ? l10Hr * 100 : l10Hr;
        if (l10HrPct < 70) return false; // Must clear line 70%+ of the time
        const side = (p.recommended_side || 'over').toLowerCase();
        if (side === 'over') {
          return l10Min != null && l10Min > 0 && l10Min >= compareLine * 0.85;
        } else if (side === 'under') {
          const l10Max = (p as any).l10_max;
          return l10Max != null && l10Max > 0 && l10Max <= compareLine * 1.15;
        }
        return false;
      });
      console.log(`[Bot] floor_lock pool: ${withL10Min.length} picks with l10_min, ${floorCandidates.length} pass floor gate (need ${profile.legs})`);
      // Sort by floor margin (how far floor exceeds line)
      const sortBy = profile.sortBy || 'composite';
      if (sortBy === 'hit_rate') {
        candidatePicks = floorCandidates.sort((a, b) => {
          const aHr = (a.l10_hit_rate || 0) <= 1 ? (a.l10_hit_rate || 0) * 100 : (a.l10_hit_rate || 0);
          const bHr = (b.l10_hit_rate || 0) <= 1 ? (b.l10_hit_rate || 0) * 100 : (b.l10_hit_rate || 0);
          return bHr - aHr;
        });
      } else if (sortBy === 'shuffle') {
        candidatePicks = floorCandidates.sort(() => Math.random() - 0.5);
      } else {
        // Sort by floor margin descending (safest picks first)
        candidatePicks = floorCandidates.sort((a, b) => {
          const aMargin = ((a as any).l10_min || 0) - a.line;
          const bMargin = ((b as any).l10_min || 0) - b.line;
          return bMargin - aMargin;
        });
      }
      if (candidatePicks.length < profile.legs) {
        console.log(`[Bot] ${tier}/floor_lock: only ${candidatePicks.length} floor-cleared picks, need ${profile.legs}`);
        continue;
      }
      console.log(`[Bot] ${tier}/floor_lock: 🔒 ${candidatePicks.length} picks where L10 floor clears line (sort=${sortBy})`);
    } else if (isCeilingShotProfile) {
      // === CEILING SHOT: L10 ceiling 30%+ above standard line, alt lines at plus-money ===
      const withL10Max = pool.sweetSpots.filter(p => (p as any).l10_max != null);
      const ceilingCandidates = pool.sweetSpots.filter(p => {
        if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
        if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
        const hr = p.l10_hit_rate || p.confidence_score || 0;
        const hrPct = hr <= 1 ? hr * 100 : hr;
        if (hrPct < (profile.minHitRate || 45)) return false;
        // Use sportsbook line from oddsMap if available, else fall back to recommended_line
        const oddsKey = `${(p.player_name || '').toLowerCase()}_${(p.prop_type || '').toLowerCase()}`;
        const ceilingOddsEntry = oddsMap.get(oddsKey);
        const ceilingSportsbookLine = ceilingOddsEntry?.line && ceilingOddsEntry.line > 0 ? ceilingOddsEntry.line : null;
        const compareLine = p.line || ceilingSportsbookLine || (p as any).recommended_line;
        if (!compareLine || compareLine <= 0) return false;
        // CEILING GATE: L10 max must be 30%+ above standard line
        const l10Max = (p as any).l10_max;
        if (l10Max == null || l10Max <= 0) return false;
        const side = (p.recommended_side || 'over').toLowerCase();
        if (side === 'over') {
          return l10Max >= compareLine * 1.3;
        } else if (side === 'under') {
          const l10Min = (p as any).l10_min;
          return l10Min != null && l10Min > 0 && compareLine >= l10Min * 1.3;
        }
        return false;
      });
      console.log(`[Bot] ceiling_shot pool: ${withL10Max.length} picks with l10_max, ${ceilingCandidates.length} pass ceiling gate (need ${profile.legs})`);
      // Must have alternate lines OR very high ceiling (l10_max >= 1.5x line) for ceiling shot
      const ceilingWithAlts = ceilingCandidates.filter(p => {
        const alts = (p as any).alternateLines || [];
        const ceilingLine = selectCeilingLine(p, alts);
        if (ceilingLine) {
          (p as any)._ceilingLine = ceilingLine;
          return true;
        }
        // Fallback: if l10_max >= 1.5x the line, allow standard line (very high ceiling)
        const l10Max = (p as any).l10_max || 0;
        const compareLine = p.line || (p as any).recommended_line || 0;
        if (l10Max >= compareLine * 1.5 && compareLine > 0) {
          (p as any)._ceilingLine = { line: compareLine, odds: p.americanOdds || -110, reason: `ceiling_fallback_l10max_${l10Max}`, originalLine: compareLine, oddsImprovement: 0 };
          console.log(`[CeilingShot] Fallback: ${p.player_name} ${p.prop_type} l10_max=${l10Max} >= ${compareLine}*1.5, using standard line`);
          return true;
        }
        return false;
      });
      const sortBy = profile.sortBy || 'composite';
      if (sortBy === 'shuffle') {
        candidatePicks = ceilingWithAlts.sort(() => Math.random() - 0.5);
      } else {
        // Sort by ceiling upside (how far ceiling exceeds alt line)
        candidatePicks = ceilingWithAlts.sort((a, b) => {
          const aUpside = ((a as any).l10_max || 0) - ((a as any)._ceilingLine?.line || a.line);
          const bUpside = ((b as any).l10_max || 0) - ((b as any)._ceilingLine?.line || b.line);
          return bUpside - aUpside;
        });
      }
      if (candidatePicks.length < profile.legs) {
        console.log(`[Bot] ${tier}/ceiling_shot: only ${candidatePicks.length} ceiling picks with plus-money alts, need ${profile.legs}`);
        continue;
      }
      console.log(`[Bot] ${tier}/ceiling_shot: 🎯 ${candidatePicks.length} ceiling picks with plus-money alt lines (sort=${sortBy})`);
    } else if (isBlowoutScriptProfile) {
      // === BLOWOUT SCRIPT: Build legs from blowout games (spread 8+) ===
      // Underdog starters → UNDER on points, PRA, assists (benched Q4)
      // Underdog role/bench → UNDER on all props (less opportunity)
      // Favorite bench → OVER on points, rebounds (garbage time minutes)
      const blowoutData = pool.blowoutGames || [];
      if (blowoutData.length === 0) {
        console.log(`[Bot] ${tier}/blowout_script: no blowout games detected (spread 8+), skipping`);
        continue;
      }

      // Collect underdog and favorite team names/abbrevs
      const underdogTeams = new Set(blowoutData.map(bg => bg.underdog));
      const favoriteTeams = new Set(blowoutData.map(bg => bg.favorite));
      // Also map full game keys for same-game correlation
      const blowoutGameKeys = new Set<string>();
      for (const bg of blowoutData) {
        blowoutGameKeys.add([bg.home_team, bg.away_team].sort().join('__'));
      }

      // BLOWOUT PROP TYPES: props that are most affected by garbage time
      const underdogStarProps = new Set(['player_points', 'points', 'player_assists', 'assists', 'pra', 'pts_rebs_asts', 'player_points_rebounds_assists']);
      const underdogAllProps = new Set(['player_points', 'points', 'player_rebounds', 'rebounds', 'player_assists', 'assists', 'pra', 'pts_rebs_asts', 'player_points_rebounds_assists', 'player_threes', 'threes']);
      const favoriteBenchProps = new Set(['player_points', 'points', 'player_rebounds', 'rebounds']);

      const blowoutCandidates = pool.sweetSpots.filter(p => {
        if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
        if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
        const hr = p.l10_hit_rate || p.confidence_score || 0;
        const hrPct = hr <= 1 ? hr * 100 : hr;
        if (hrPct < (profile.minHitRate || 45)) return false;

        const teamName = (p.team_name || '').toLowerCase();
        const propType = normalizePropType(p.prop_type || '');
        const pickSide = (p.recommended_side || '').toLowerCase();
        const gameCtx = (p as any)._gameContext as PickGameContext | undefined;

        // Check if this pick is from a blowout game
        const isUnderdog = underdogTeams.has(teamName);
        const isFavorite = favoriteTeams.has(teamName);
        if (!isUnderdog && !isFavorite) return false;

        // For underdog players: force UNDER side
        if (isUnderdog) {
          if (pickSide !== 'under') {
            // Override: force to under for blowout script
            (p as any)._blowoutOverride = 'under';
          }
          // Accept any prop type for underdogs (all should go under in blowout)
          if (underdogAllProps.has(propType)) return true;
          return false;
        }

        // For favorite bench players: force OVER on points/rebounds
        if (isFavorite) {
          if (pickSide !== 'over') {
            (p as any)._blowoutOverride = 'over';
          }
          // Only select lower-line props (bench player indicators: line < 15 for points)
          const line = p.line || 0;
          if (favoriteBenchProps.has(propType) && line <= 18) return true;
          return false;
        }

        return false;
      });

      // Apply blowout overrides to candidate side
      for (const pick of blowoutCandidates) {
        if ((pick as any)._blowoutOverride) {
          (pick as any)._originalSide = pick.recommended_side;
          pick.recommended_side = (pick as any)._blowoutOverride;
        }
      }

      const sortBy = profile.sortBy || 'hit_rate';
      if (sortBy === 'shuffle') {
        candidatePicks = blowoutCandidates.sort(() => Math.random() - 0.5);
      } else if (sortBy === 'hit_rate') {
        candidatePicks = blowoutCandidates.sort((a, b) => {
          const aHr = (a.l10_hit_rate || 0) <= 1 ? (a.l10_hit_rate || 0) * 100 : (a.l10_hit_rate || 0);
          const bHr = (b.l10_hit_rate || 0) <= 1 ? (b.l10_hit_rate || 0) * 100 : (b.l10_hit_rate || 0);
          return bHr - aHr;
        });
      } else {
        candidatePicks = blowoutCandidates.sort((a, b) => b.compositeScore - a.compositeScore);
      }

      if (candidatePicks.length < profile.legs) {
        console.log(`[Bot] ${tier}/blowout_script: only ${candidatePicks.length} blowout picks available, need ${profile.legs}`);
        continue;
      }
      const underdogCount = candidatePicks.filter(p => underdogTeams.has((p.team_name || '').toLowerCase())).length;
      const favoriteCount = candidatePicks.filter(p => favoriteTeams.has((p.team_name || '').toLowerCase())).length;
      console.log(`[Bot] ${tier}/blowout_script: 💥 ${candidatePicks.length} blowout picks (${underdogCount} underdog unders, ${favoriteCount} favorite overs) from ${blowoutData.length} blowout games (sort=${sortBy})`);
    } else if (isMispricedProfile) {
      candidatePicks = [...pool.mispricedPicks]
        .filter(p => {
          if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
          if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
          return true;
        })
        .sort((a, b) => b.compositeScore - a.compositeScore);
      if (candidatePicks.length < profile.legs) {
        console.log(`[Bot] ${tier}/mispriced_edge: only ${candidatePicks.length} mispriced picks available, need ${profile.legs}`);
        continue;
      }
      console.log(`[Bot] ${tier}/mispriced_edge: using ${candidatePicks.length} mispriced picks for ${profile.legs}-leg parlay`);
    } else if (isWhaleProfile) {
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
        // Generic: if profile declares a required side (e.g. 'under'), enforce it for totals
        if (profile.side && p.bet_type === 'total') {
          return (p as EnrichedTeamPick).side?.toLowerCase() === profile.side.toLowerCase();
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
        // SOURCE VERIFICATION GATE: execution/validation require verified sources
        if (tier !== 'exploration') {
          const source = (p as any).line_source || (p as any).verified_source || 'projected';
          if (source === 'projected' || source === 'synthetic_dry_run') return false;
        }
        // SIDE FILTER: grind_under_core and similar profiles enforce recommended_side
        // CONTRARIAN: flip the recommended side for scenario diversity
        if (profile.contrarian) {
          const pickSide = ((p as any).recommended_side || '').toLowerCase();
          const flippedSide = pickSide === 'over' ? 'under' : 'over';
          // Override the pick's side for this profile — attach flipped side
          (p as any)._contrarianFlippedSide = flippedSide;
          // Only include picks where the flipped side still has reasonable data
          const hitRate = (p as any).l10_hit_rate || 0;
          if (hitRate < 0.40 && hitRate < 40) return false; // skip if original hit rate too low to flip
        } else if (profile.side) {
          const pickSide = ((p as any).recommended_side || '').toLowerCase();
          if (pickSide !== profile.side.toLowerCase()) return false;
        }
        if (sportFilter.includes('all')) return true;
        return sportFilter.includes(p.sport || 'basketball_nba');
      });
    }

    // === WINNING ARCHETYPE CATEGORIES (dynamic) ===
    const WINNING_ARCHETYPE_CATEGORIES = dynamicArchetypes.categories;
    const isArchetypeProfile = profile.strategy.startsWith('winning_archetype');
    // Dynamically assign preferCategories for archetype profiles based on detected winners
    let profilePreferCategories = profile.preferCategories || [];
    if (isArchetypeProfile && dynamicArchetypes.ranked.length > 0) {
      const rankedCats = dynamicArchetypes.ranked.map(r => r.category);
      if (profile.strategy.includes('3pt_scorer')) {
        profilePreferCategories = rankedCats.slice(0, 2);
      } else if (profile.strategy.includes('reb_ast')) {
        profilePreferCategories = rankedCats.slice(2, 4);
      } else {
        profilePreferCategories = rankedCats.slice(0, 3);
      }
    }

    // === ACCURACY-FIRST SORTING (all tiers) ===
    // Sort by: proven winner priority → archetype bonus → L10 strategy boost → category weight → hit rate → composite
    const isGodModeProfile = profile.strategy === 'god_mode_lock';
    candidatePicks = [...candidatePicks].sort((a, b) => {
      // GOD MODE PRIORITY: proven winners with favorable matchup float to absolute top
      const aIsProven = ('player_name' in a) ? (getPlayerBonus(a.player_name, (a as any).prop_type, tier) >= 15 ? 25 : 0) : 0;
      const bIsProven = ('player_name' in b) ? (getPlayerBonus(b.player_name, (b as any).prop_type, tier) >= 15 ? 25 : 0) : 0;
      if (bIsProven !== aIsProven) return bIsProven - aIsProven;

      // Winning archetype bonus: +15 composite for matching categories
      const aArchetypeBonus = WINNING_ARCHETYPE_CATEGORIES.has(a.category) ? 15 : 0;
      const bArchetypeBonus = WINNING_ARCHETYPE_CATEGORIES.has(b.category) ? 15 : 0;

      // Profile-specific category preference: if profile has preferCategories, prioritize those
      const aPreferred = profilePreferCategories.length > 0 && profilePreferCategories.includes(a.category) ? 20 : 0;
      const bPreferred = profilePreferCategories.length > 0 && profilePreferCategories.includes(b.category) ? 20 : 0;

      // L10 strategy composite boost
      const aStratBoost = getStrategyCompositeBoost(profile.strategy);
      const bStratBoost = aStratBoost; // same strategy for same profile

      const aSport = a.sport || 'basketball_nba';
      const bSport = b.sport || 'basketball_nba';
      const aWeight = weightMap.get(`${a.category}__${a.recommended_side}__${aSport}`) ?? weightMap.get(`${a.category}__${a.recommended_side}`) ?? weightMap.get(a.category) ?? 1.0;
      const bWeight = weightMap.get(`${b.category}__${b.recommended_side}__${bSport}`) ?? weightMap.get(`${b.category}__${b.recommended_side}`) ?? weightMap.get(b.category) ?? 1.0;
      
      // Primary: profile preference + archetype bonus + strategy boost
      const aTotalBonus = aPreferred + aArchetypeBonus + aStratBoost;
      const bTotalBonus = bPreferred + bArchetypeBonus + bStratBoost;
      if (bTotalBonus !== aTotalBonus) return bTotalBonus - aTotalBonus;

      // Secondary: category weight (blocked=0 sink to bottom, boosted=1.2 rise to top)
      if (bWeight !== aWeight) return bWeight - aWeight;
      
      // Tertiary: L10 hit rate (player props) or confidence score (team props)
      const aHitRate = 'l10_hit_rate' in a ? (a as EnrichedPick).l10_hit_rate : (a.confidence_score || 0);
      const bHitRate = 'l10_hit_rate' in b ? (b as EnrichedPick).l10_hit_rate : (b.confidence_score || 0);
      if (bHitRate !== aHitRate) return bHitRate - aHitRate;
      
      // Quaternary: composite score
      return (b.compositeScore || 0) - (a.compositeScore || 0);
    });
    
    if (isArchetypeProfile) {
      console.log(`[Bot] ${tier}/winning_archetype: ${profile.strategy} preferring [${profilePreferCategories.join(', ')}] from ${candidatePicks.length} candidates`);
    }

    // Build parlay from candidates
    // Anti-stacking rule from pattern replay: cap same-side totals
    const maxSameSidePerParlay = winningPatterns?.max_same_side_per_parlay || 2;
    const parlaySideCount = new Map<string, number>(); // "total_over" -> count
    
    // Apply thin slate leg override
    const effectiveMaxLegs = isThinSlate 
      ? Math.min(profile.legs, 3) 
      : profile.legs;

    // === COHERENCE-AWARE SELECTION: re-rank candidates after each leg ===
    let remainingCandidates = [...candidatePicks];
    
    // Light shuffle for ALL tiers to prevent deterministic duplicate parlays
    // For explicit 'shuffle' sortBy: shuffle 100%. For others: shuffle top 30% to preserve quality ranking.
    const shufflePct = profile.sortBy === 'shuffle' ? 1.0 : (tier === 'exploration' ? 0.7 : 0.3);
    const shuffleCount = Math.max(3, Math.floor(remainingCandidates.length * shufflePct));
    const topSlice = remainingCandidates.slice(0, shuffleCount);
    for (let i = topSlice.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [topSlice[i], topSlice[j]] = [topSlice[j], topSlice[i]];
    }
    remainingCandidates = [...topSlice, ...remainingCandidates.slice(shuffleCount)];
    
    while (legs.length < effectiveMaxLegs && remainingCandidates.length > 0) {
      // After the first leg, re-sort remaining candidates by coherence bonus
      if (legs.length > 0) {
        remainingCandidates.sort((a, b) => {
          const aBonus = pickCoherenceBonus(a, legs);
          const bBonus = pickCoherenceBonus(b, legs);
          // Primary: coherence-adjusted composite score
          return ((b.compositeScore || 0) + bBonus * 10) - ((a.compositeScore || 0) + aBonus * 10);
        });
      }
      
      let pickedOne = false;
      for (let ci = 0; ci < remainingCandidates.length; ci++) {
        const pick = remainingCandidates[ci];
      
      if (!canUsePickGlobally(pick, tracker, config, tier, isSweetSpotCoreProfile || isSweetSpotPlusProfile || isSweetSpotL3Profile, profile.strategy)) {
        if (isSweetSpotL3Profile && legs.length < 2) console.log(`[L3Debug] GlobalGate blocked: ${(pick as any).player_name} ${(pick as any).prop_type}`);
        continue;
      }
      // Sweet spot core/plus: always use volume mode (engine pre-vetted, allow 2 same prop type)
      const effectiveVolumeMode = volumeMode || isSweetSpotCoreProfile || isSweetSpotPlusProfile;
      // Relax team usage cap for matchup_team_stack profiles (allow same-team stacking)
      const effectiveConfig = isMatchupTeamStackProfile ? { ...config, maxTeamUsage: 6 } : config;
      if (!canUsePickInParlay(pick, parlayTeamCount, parlayCategoryCount, effectiveConfig, legs, parlayPropTypeCount, profile.legs, effectiveVolumeMode)) {
        if (isSweetSpotL3Profile && legs.length < 2) console.log(`[L3Debug] ParlayGate blocked: ${(pick as any).player_name} ${(pick as any).prop_type}`);
        continue;
      }
      
       // === WINNING PATTERN GATE: Execution tier requires 90%+ L10 hit rate per leg (March 12 analysis) ===
       if (tier === 'execution') {
         const rawL10 = (pick as any).l10_hit_rate || (pick as any).confidence_score || 0;
         const legL10Pct = rawL10 <= 1 ? rawL10 * 100 : rawL10;
         if (legL10Pct < 90) {
           continue;
         }
       }
       
       // === GOD MODE MATCHUP HARD-BLOCK (execution tier) ===
      // BYPASS for L3 strategy — L3 recency is the primary signal, not matchup defense
      if (tier === 'execution' && 'player_name' in pick && !isSweetSpotL3Profile) {
        const matchupResult = passesGodModeMatchup(pick, defenseDetailMap, tier);
        if (!matchupResult.pass) {
          continue;
        }
        // Apply sliding penalty to composite for borderline matchups
        if (matchupResult.penalty !== 0) {
          (pick as any).compositeScore = Math.max(0, (pick.compositeScore || 0) + matchupResult.penalty);
        }
      }
      
      // === GRIND+OVER HARD-BLOCK: prevent OVER picks in GRIND-cluster games with tough defense ===
      const pickSideForGrind = pick.recommended_side || pick.side || '';
      const grindCtx = (pick as any)._gameContext as PickGameContext | undefined;
      if (
        pickSideForGrind.toLowerCase() === 'over' &&
        grindCtx?.envCluster === 'GRIND' &&
        grindCtx?.defenseStrength === 'tough' &&
        strategyName !== 'bench_under' &&
        strategyName !== 'grind_under_core'
      ) {
        console.log(`[GrindOverBlock] Skipped: ${pick.player_name || 'unknown'} OVER in GRIND+tough defense game`);
        rejectionCounters.envCluster = (rejectionCounters.envCluster || 0) + 1;
        continue;
      }
      
      // === ANTI-CORRELATION BLOCKING: prevent contradictory legs ===
      const antiCorr = hasAntiCorrelation(pick, legs);
      if (antiCorr.blocked) {
        console.log(`[AntiCorr] Blocked: ${antiCorr.reason}`);
        continue;
      }
      
      // === SPREAD CAP: max 1 spread leg per parlay ===
      const pickBetType = ('bet_type' in pick ? pick.bet_type : pick.prop_type) || '';
      if (pickBetType === 'spread') {
        const currentSpreads = legs.filter(l => l.bet_type === 'spread').length;
        if (currentSpreads >= 1) continue;
      }

      // Pattern replay: anti-stacking (e.g., max 2 OVER totals per parlay)
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
      // Effective gate rate: use L10 hit rate (percent) for player props, fallback to confidence
      const rawL10 = 'player_name' in pick ? ((pick as any).l10_hit_rate || 0) : 0;
      const l10Pct = rawL10 <= 1 ? rawL10 * 100 : rawL10;
      const effectiveHitRateForStorage = ('player_name' in pick && l10Pct > 0) ? l10Pct : hitRatePercent;
      
      // === EXECUTION TIER L10 HIT RATE GATE ===
      // Execution tier requires L10 hit rate >= 80% for player props (85% on light slates)
      // EXEMPT: floor_lock and ceiling_shot strategies have their own dedicated gates
      const isFloorCeilingStrategy = isFloorLockProfile || isCeilingShotProfile;
      if (tier === 'execution' && 'player_name' in pick && !isFloorCeilingStrategy && !isSweetSpotL3Profile) {
        const l10Hr = (pick as any).l10_hit_rate || 0;
        const l10HrPct = l10Hr <= 1 ? l10Hr * 100 : l10Hr;
        const execL10Gate = isLightSlateMode ? 75 : (isThinPool ? 65 : 70);
        if (l10HrPct < execL10Gate) {
          continue;
        }
      }
      
      // === BUFFER GATE: Skip legs where L10 avg vs line buffer < 10% ===
      if ('player_name' in pick) {
        const pickL10Avg = (pick as any).l10_avg || (pick as any).projected_value || 0;
        const pickLine = (pick as any).line || (pick as any).recommended_line || 0;
        const pickSide = ((pick as any).recommended_side || (pick as any).side || 'OVER').toUpperCase();
        if (pickL10Avg > 0 && pickLine > 0) {
          const bufferPct = pickSide === 'OVER'
            ? ((pickL10Avg - pickLine) / pickLine) * 100
            : ((pickLine - pickL10Avg) / pickLine) * 100;
          if (bufferPct < 10) {
            continue; // Thin margin — skip
          }
        }
      }
      
      // For hybrid profiles, use a lower hit rate floor for team legs
      // EXEMPT: floor_lock and ceiling_shot already filtered by their own floor/ceiling gates
      const effectiveMinHitRate = (isHybridProfile && 'type' in pick && pick.type === 'team') 
        ? Math.min(minHitRate, 55) 
        : minHitRate;
      if (!isFloorCeilingStrategy && hitRatePercent < effectiveMinHitRate) continue;
      
      if ('oddsValueScore' in pick && pick.oddsValueScore < minOddsValue) continue;

      // For player picks, handle line selection
      let legData: any;
      
      if ('type' in pick && pick.type === 'team') {
        const teamPick = pick as EnrichedTeamPick;
        
        // SPREAD CAP: Block high spreads or shop for alt lines
        if (teamPick.bet_type === 'spread' && Math.abs(teamPick.line) >= effectiveSpreadCap) {
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
              
              // Find best alt spread: abs(line) between 7 and effectiveSpreadCap, reasonable odds
              const isNegative = teamPick.line < 0;
              const viableAlts = altLines.filter(alt => {
                const absLine = Math.abs(alt.line);
                // Same sign as original
                if (isNegative && alt.line > 0) return false;
                if (!isNegative && alt.line < 0) return false;
                // Target range
                if (absLine < 7 || absLine > effectiveSpreadCap) return false;
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
          score_breakdown: teamPick.score_breakdown || null,
          projected_total: (teamPick.score_breakdown as any)?.projected_total ?? null,
        };
        
        parlayTeamCount.set(teamPick.home_team, (parlayTeamCount.get(teamPick.home_team) || 0) + 1);
        parlayTeamCount.set(teamPick.away_team, (parlayTeamCount.get(teamPick.away_team) || 0) + 1);
      } else {
        const playerPick = pick as EnrichedPick;
        const playerSport = playerPick.sport || deriveSportFromCategory(playerPick.category);
        const weight = weightMap.get(`${playerPick.category}__${playerPick.recommended_side}__${playerSport}`) ?? weightMap.get(`${playerPick.category}__${playerPick.recommended_side}`) ?? weightMap.get(playerPick.category) ?? 1.0;
        
        // Select line based on profile (with boost leg limiting)
        const boostLimit = profile.boostLegs ?? (profile.useAltLines ? profile.legs : 0);
        const boostedCount = legs.filter(l => l.line_selection_reason && l.line_selection_reason !== 'main_line' && l.line_selection_reason !== 'safe_profile').length;

        // CEILING SHOT: Override line selection with ceiling alt line
        let selectedLine: SelectedLine;
        if (isCeilingShotProfile && (playerPick as any)._ceilingLine) {
          selectedLine = (playerPick as any)._ceilingLine as SelectedLine;
          console.log(`[CeilingShot] ${playerPick.player_name} ${playerPick.prop_type}: line ${playerPick.line} → ${selectedLine.line} @ +${selectedLine.odds} (L10 max: ${(playerPick as any).l10_max})`);
        } else if (isFloorLockProfile) {
          // Floor lock: always use standard line (safety IS the floor)
          const floorResult = selectFloorLine(playerPick);
          selectedLine = floorResult || { line: playerPick.line, odds: playerPick.americanOdds, reason: 'floor_lock_standard' };
        } else if (profile.useAltLines && boostedCount < boostLimit) {
          selectedLine = selectOptimalLine(
            playerPick,
            playerPick.alternateLines || [],
            profile.strategy,
            profile.preferPlusMoney || false,
            profile.minBufferMultiplier || 1.0
          );
        } else {
          selectedLine = { line: playerPick.line, odds: playerPick.americanOdds, reason: 'main_line' };
        }

        // === MATCHUP LINE ADJUSTMENT: Check if matchup warrants a safer (downgrade) or higher-value (upgrade) alt line ===
        let wasLineAdjusted = false;
        let lineAdjustmentDirection: 'downgrade' | 'upgrade' | null = null;
        let originalLineBeforeAdjust: number | null = null;
        let adjustReason = '';
        
        const isGodModeProfile = profile.strategy === 'god_mode_lock';
        const pickSide = playerPick.recommended_side || 'over';
        const adjustResult = shouldAdjustLine(
          playerPick, defenseDetailMap,
          playerPick.prop_type, pickSide,
          selectedLine.line, isGodModeProfile
        );
        
        if (adjustResult.shouldAdjust) {
          const altResult = findAvailableAltLine(
            playerPick, adjustResult.recommendedLine,
            pickSide, oddsMap, playerProps || [],
            adjustResult.direction
          );
          if (altResult) {
            originalLineBeforeAdjust = selectedLine.line;
            selectedLine.line = altResult.line;
            selectedLine.odds = altResult.odds;
            selectedLine.reason = `${adjustResult.direction}_${adjustResult.reason}`;
            wasLineAdjusted = true;
            lineAdjustmentDirection = adjustResult.direction;
            adjustReason = adjustResult.reason;
            const tag = adjustResult.direction === 'upgrade' ? 'LineUpgrade' : 'LineDowngrade';
            console.log(`[${tag}] ✅ Applied: ${playerPick.player_name} ${playerPick.prop_type} ${pickSide} ${originalLineBeforeAdjust} -> ${altResult.line} (${adjustReason})`);
          } else {
            adjustReason = `no_alt_available_${adjustResult.reason}`;
            const tag = adjustResult.direction === 'upgrade' ? 'LineUpgrade' : 'LineDowngrade';
            console.log(`[${tag}] ⚠️ Flagged but no alt: ${playerPick.player_name} ${playerPick.prop_type} ${pickSide} ${selectedLine.line} (${adjustReason})`);
          }
        }

        legData = {
          id: playerPick.id,
          player_name: playerPick.player_name,
          team_name: playerPick.team_name,
          prop_type: playerPick.prop_type,
          line: snapLine(selectedLine.line, playerPick.prop_type),
          side: (playerPick as any)._contrarianFlippedSide || playerPick.recommended_side || 'over',
          category: playerPick.category,
          weight,
          hit_rate: effectiveHitRateForStorage,
          l10_hit_rate: l10Pct,
          confidence_score: pickConfidence,
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
          sport: playerPick.sport || deriveSportFromCategory(playerPick.category),
          defense_rank: (playerPick as any).defenseMatchupRank ?? null,
          defense_adj: (playerPick as any).defenseMatchupAdj ?? 0,
          environment_score: (playerPick as any).environmentScore ?? null,
          environment_components: (playerPick as any).environmentComponents ?? null,
          was_downgraded: wasLineAdjusted && lineAdjustmentDirection === 'downgrade',
          was_line_adjusted: wasLineAdjusted,
          line_adjustment_direction: lineAdjustmentDirection,
          original_line_before_downgrade: originalLineBeforeAdjust,
          downgrade_reason: adjustReason || null,
          leg_role: (playerPick as any)._legRole || null,
          // DNA scoring fields
          l10_avg: playerPick.l10_avg || 0,
          l3_avg: playerPick.l3_avg || 0,
          l5_avg: playerPick.l5_avg || 0,
          l10_std_dev: playerPick.l10_std_dev || 0,
          season_avg: playerPick.season_avg || 0,
          matchup_adjustment: playerPick.matchup_adjustment || 0,
          pace_adjustment: playerPick.pace_adjustment || 0,
          h2h_matchup_boost: playerPick.h2h_matchup_boost || 0,
          bounce_back_score: playerPick.bounce_back_score || 0,
          line_difference: playerPick.line_difference || 0,
          l10_min: playerPick.l10_min || 0,
          l10_median: playerPick.l10_median || 0,
          h2h_avg_vs_opponent: (playerPick as any).h2h_avg_vs_opponent || 0,
          games_played: (playerPick as any).games_played || 0,
          projected_value: (playerPick as any).projected_value || 0,
        };

        // MINIMUM PROJECTION BUFFER GATE (stat-aware + conviction-aware)
        // BYPASS for L3 strategy — uses L3 recency score, not projection buffer
        const projBuffer = legData.projection_buffer || 0;
        const projValue = legData.projected_value || 0;
        if (!isSweetSpotL3Profile) {
          const isConvictionPick = playerPick.isTripleConfirmed || playerPick.isDoubleConfirmed || (playerPick.engineCount >= 3);
          const minBuf = getMinBuffer(legData.prop_type, selectedLine.line, isConvictionPick);
          if (projValue > 0 && Math.abs(projBuffer) < minBuf) {
            const bufKey = `${legData.player_name}_${legData.prop_type}_${legData.side}_${legData.line}`;
            if (!loggedNegEdgeKeys.has(bufKey)) {
              console.log(`[BufferGate] Blocked ${legData.player_name} ${legData.prop_type} ${legData.side} ${legData.line} (proj: ${projValue}, buffer: ${projBuffer.toFixed(2)} < ${minBuf} min${isConvictionPick ? ' [conviction]' : ''})`);
              loggedNegEdgeKeys.add(bufKey);
            }
            continue;
          }
          // NEGATIVE-EDGE GATE: Block legs where projection contradicts bet direction
          if (projValue > 0 && projBuffer < 0) {
            const negKey = `${legData.player_name}_${legData.prop_type}_${legData.side}_${legData.line}`;
            if (!loggedNegEdgeKeys.has(negKey)) {
              console.log(`[NegEdgeBlock] Blocked ${legData.player_name} ${legData.prop_type} ${legData.side} ${legData.line} (proj: ${projValue}, buffer: ${projBuffer.toFixed(1)})`);
              loggedNegEdgeKeys.add(negKey);
            }
            continue;
          }
        }
        // EDGE_PCT SAFETY NET: Block any pick with negative or insufficient edge_pct from mispriced_lines
        if (playerPick.edge_pct !== undefined && playerPick.edge_pct < 3) {
          const edgeKey = `${legData.player_name}_${legData.prop_type}_edge`;
          if (!loggedNegEdgeKeys.has(edgeKey)) {
            console.log(`[EdgePctBlock] Blocked ${legData.player_name} ${legData.prop_type} ${legData.side} (edge_pct: ${playerPick.edge_pct.toFixed(1)}% < 3% min)`);
            loggedNegEdgeKeys.add(edgeKey);
          }
          continue;
        }
        
        if (playerPick.team_name) {
          parlayTeamCount.set(playerPick.team_name, (parlayTeamCount.get(playerPick.team_name) || 0) + 1);
        }
      }
      
      // === GAP 2: Per-leg minimum score gate by parlay size ===
      // Bypass for L3 strategy (uses L3 score, not composite) and floor_lock/optimal_combo (pre-assembled)
      if (!isSweetSpotL3Profile && !isL3MatchupComboProfile && !isFloorLockProfile && !isOptimalComboProfile) {
        const legCompositeScore = legData.composite_score || legData.sharp_score || 0;
        const minScore = minScoreByParlaySize(effectiveMaxLegs);
        if (legCompositeScore < minScore) {
          if (tier === 'execution') console.log(`[ScoreGate] Blocked ${legData.player_name || legData.home_team} (score ${legCompositeScore} < ${minScore} for ${effectiveMaxLegs}-leg parlay)`);
          continue;
        }
      }

      // === GHOST LEG GATE: skip legs with no player_name ===
      if (legData.type !== 'team' && !legData.player_name) {
        console.log(`[GhostBlock] Skipped leg with no player_name (prop: ${legData.prop_type})`);
        continue;
      }
      // === VOLATILE PROP BLOCK: steals/blocks banned from parlays ===
      const normPropCheck = normalizePropType(legData.prop_type || '');
      if (BLOCKED_PARLAY_PROPS.has(normPropCheck)) {
        console.log(`[VolatileBlock] Blocked ${legData.player_name} ${legData.prop_type} — steals/blocks banned from parlays`);
        continue;
      }
      // === REBOUND CAP: max 1 rebound leg per parlay ===
      if (normPropCheck === 'player_rebounds' && (parlayPropTypeCount.get('rebounds') || 0) >= MAX_REBOUND_LEGS_PER_PARLAY) {
        console.log(`[ReboundCap] Blocked ${legData.player_name} — max ${MAX_REBOUND_LEGS_PER_PARLAY} rebound leg per parlay`);
        continue;
      }

      legs.push(legData);
      parlayCategoryCount.set(pick.category, (parlayCategoryCount.get(pick.category) || 0) + 1);
      // Track prop type count for concentration cap
      const legPropType = 'prop_type' in pick ? normalizePropTypeCategory(pick.prop_type) :
                          'bet_type' in pick ? normalizePropTypeCategory(pick.bet_type) : 'other';
      parlayPropTypeCount.set(legPropType, (parlayPropTypeCount.get(legPropType) || 0) + 1);
      // Track side count for anti-stacking
      const legBetType = ('bet_type' in pick ? pick.bet_type : pick.prop_type) || '';
      const legSide = pick.recommended_side || '';
      const legSideKey = `${legBetType}_${legSide}`.toLowerCase();
      parlaySideCount.set(legSideKey, (parlaySideCount.get(legSideKey) || 0) + 1);
      
      // Remove picked candidate and break inner loop to re-sort remaining
      remainingCandidates.splice(ci, 1);
      pickedOne = true;
      break;
      }
      // If no candidate was picked in this pass, stop (all remaining are blocked)
      if (!pickedOne) break;
    }

    // Only create parlay if we have enough legs (with 3-leg fallback for small pools)
    if (legs.length < profile.legs) {
      if (legs.length >= 3 && (pool.playerPicks.length < 100 || isThinPool)) {
        // Accept as 3-leg fallback when pool is too small for requested leg count
        console.log(`[Bot] ${tier}/${profile.strategy}: accepting ${legs.length}-leg fallback (pool ${pool.playerPicks.length} picks, thin pool mode)`);
      } else {
        rejectionCounters.notEnoughLegs++;
        console.log(`[Bot] ${tier}/${profile.strategy}: only ${legs.length}/${profile.legs} legs built from ${candidatePicks.length} candidates`);
        continue;
      }
    }
    {
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
      // THIN POOL BYPASS: disable golden gate when pool is too small (< 100 picks)
      const ENFORCE_GOLDEN_GATE = !isThinPool;
      const skipGoldenGate = isHybridProfile || isTeamProfile;
      if (ENFORCE_GOLDEN_GATE && !skipGoldenGate && tier === 'execution' && goldenCategories.size > 0) {
        const playerLegs = legs.filter(l => l.type !== 'team');
        if (playerLegs.length > 0) {
          const goldenLegCount = playerLegs.filter(l => goldenCategories.has(l.category)).length;
          const minGoldenLegs = Math.max(1, Math.floor(playerLegs.length * 0.5)); // 50% golden legs (relaxed from all-1)
          if (goldenLegCount < minGoldenLegs) {
            console.log(`[Bot] Skipping ${tier}/${profile.strategy}: only ${goldenLegCount}/${playerLegs.length} golden player legs (need ${minGoldenLegs})`);
            continue;
          }
        }
        // If no player legs (pure team parlay), skip golden gate entirely
      }

      // Deduplication: skip if identical leg combination already exists
      // Strategy-aware fingerprints for exploration tier allow same combo under different strategies
      const fpStrategy = tier === 'exploration' ? profile.strategy : '';
      const fingerprint = createParlayFingerprint(legs) + (fpStrategy ? `||S:${fpStrategy}` : '');
      if (globalFingerprints.has(fingerprint)) {
        rejectionCounters.duplicate++;
        continue;
      }
      // Mirror dedup: skip if same matchups exist with flipped sides
      const mirrorPrint = createMirrorFingerprint(legs);
      if (globalMirrorPrints.has(mirrorPrint)) {
        rejectionCounters.mirror++;
        continue;
      }

      // Game-level dedup: dynamic caps based on slate size
      const MAX_GAME_USAGE = isLightSlateMode ? 6 : 3;
      const MAX_MATCHUP_USAGE = isLightSlateMode ? 5 : 2;
      const gameKeys = legs.filter(l => l.type === 'team').map(l => 
        `${[l.home_team, l.away_team].sort().join('_vs_')}`.toLowerCase()
      );
      const matchupKey = gameKeys.sort().join('||');
      
      let gameOverused = false;
      for (const gk of gameKeys) {
        if (!globalGameUsage) globalGameUsage = new Map();
        if ((globalGameUsage.get(gk) || 0) >= MAX_GAME_USAGE) {
          gameOverused = true;
          break;
        }
      }
      if (gameOverused) {
        console.log(`[Bot] Skipping ${tier}/${profile.strategy}: game usage cap hit`);
        continue;
      }

      // Team concentration cap: no single team may appear in more than MAX_TEAM_PARLAY_CAP parlays
      const MAX_TEAM_PARLAY_CAP = isLightSlateMode ? 6 : 4;
      const teamKeys = legs
        .filter((l: any) => l.type === 'team')
        .flatMap((l: any) => [l.home_team, l.away_team])
        .filter(Boolean)
        .map((t: string) => t.toLowerCase().trim());

      let teamOverused = false;
      for (const tk of teamKeys) {
        if (!globalTeamUsage) globalTeamUsage = new Map();
        if ((globalTeamUsage.get(tk) || 0) >= MAX_TEAM_PARLAY_CAP) {
          teamOverused = true;
          break;
        }
      }
      if (teamOverused) {
        console.log(`[Bot] Skipping ${tier}/${profile.strategy}: team concentration cap hit`);
        continue;
      }

      // Matchup-level dedup: same set of team pairs limited to 2 parlays
      if (matchupKey && matchupKey.length > 0) {
        if (!globalMatchupUsage) globalMatchupUsage = new Map();
        if ((globalMatchupUsage.get(matchupKey) || 0) >= MAX_MATCHUP_USAGE) {
          console.log(`[Bot] Skipping ${tier}/${profile.strategy}: matchup combo cap hit`);
          continue;
        }
      }

      globalFingerprints.add(fingerprint);
      globalMirrorPrints.add(mirrorPrint);
      
      // Track game and matchup usage
      for (const gk of gameKeys) {
        if (!globalGameUsage) globalGameUsage = new Map();
        globalGameUsage.set(gk, (globalGameUsage.get(gk) || 0) + 1);
      }
      if (matchupKey && matchupKey.length > 0) {
        if (!globalMatchupUsage) globalMatchupUsage = new Map();
        globalMatchupUsage.set(matchupKey, (globalMatchupUsage.get(matchupKey) || 0) + 1);
      }

      // Track team usage
      for (const tk of teamKeys) {
        if (!globalTeamUsage) globalTeamUsage = new Map();
        globalTeamUsage.set(tk, (globalTeamUsage.get(tk) || 0) + 1);
      }

      // Mark all picks as used + track global slate exposure
      for (const leg of legs) {
        if (leg.type === 'team') {
          tracker.usedPicks.add(createTeamPickKey(leg.id, leg.bet_type, leg.side));
        } else {
          const playerPick = pool.sweetSpots.find(p => p.id === leg.id);
          if (playerPick) markPickUsed(playerPick, tracker);
          // Track global player+prop+side exposure (canonical key must match canUsePickGlobally check)
          if (leg.player_name && leg.prop_type) {
            const globalKey = `${(leg.player_name || '').toLowerCase().trim()}|${normalizePropType(leg.prop_type || '')}|${(leg.side || 'over').toLowerCase()}`;
            globalSlatePlayerPropUsage.set(globalKey, (globalSlatePlayerPropUsage.get(globalKey) || 0) + 1);
          }
        }
      }

      // Calculate combined probability using product of individual hit rates (geometric)
      const combinedProbability = legs.reduce((product, l) => {
        const hr = l.hit_rate ? l.hit_rate / 100 : l.sharp_score ? l.sharp_score / 100 : 0.5;
        return product * hr;
      }, 1);

      // === COMBINED PROBABILITY FLOOR (GOD MODE gate) ===
      // Reject parlays where combined probability is too low (each leg must average ~58.5%+ for 3-leg)
      if (tier === 'execution' && combinedProbability < 0.20) {
        console.log(`[ProbFloor] Rejected ${tier}/${profile.strategy}: combinedProbability ${(combinedProbability * 100).toFixed(1)}% < 20% floor`);
        continue;
      }
      
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
      if (combinedProbability < probFloor) { rejectionCounters.prob++; if (tier === 'execution') console.log(`[Bot] ${tier}/${profile.strategy}: failed prob (${combinedProbability.toFixed(4)})`); continue; }
      const effectiveMinEdge = (isHybridProfile || isTeamProfile) ? Math.min(config.minEdge, 0.008) : config.minEdge;
      if (effectiveEdge < effectiveMinEdge) { rejectionCounters.edge++; if (tier !== 'execution') console.log(`[Bot] ${tier}/${profile.strategy}: failed edge (${effectiveEdge.toFixed(4)} < ${effectiveMinEdge})`); continue; }
      if (sharpe < config.minSharpe) { rejectionCounters.sharpe++; if (tier !== 'execution') console.log(`[Bot] ${tier}/${profile.strategy}: failed sharpe (${sharpe.toFixed(4)} < ${config.minSharpe})`); continue; }

      // === GAP 5: Parlay-level composite score floor ===
      const avgLegCompositeScore = legs.reduce((sum, l) => sum + (l.composite_score || l.sharp_score || 0), 0) / legs.length;
      const adjustedAvgScore = avgLegCompositeScore * penaltyMultiplier;
      const scoreFloor = parlayScoreFloor(tier);
      if (adjustedAvgScore < scoreFloor) {
        rejectionCounters.scoreFloor++;
        if (tier !== 'execution') console.log(`[ParlayFloor] Rejected ${tier}/${profile.strategy} parlay (avg score ${adjustedAvgScore.toFixed(1)} < ${scoreFloor} floor)`);
        continue;
      }

      // === COHERENCE GATE: GOD MODE=85, execution=80, validation=70 ===
      const coherence = calculateParlayCoherence(legs);
      const isGodModeParlay = profile.strategy === 'god_mode_lock';
      const coherenceFloor = isGodModeParlay ? 85 : (tier === 'execution' ? 80 : (tier === 'validation' ? 70 : 60));
      if (coherence < coherenceFloor) {
        rejectionCounters.coherence++;
        if (tier !== 'execution') console.log(`[CoherenceGate] Rejected ${tier}/${profile.strategy} parlay (coherence ${coherence} < ${coherenceFloor}${isGodModeParlay ? ' GOD MODE' : ''})`);
        continue;
      }

      // === ENVIRONMENT CLUSTER HOMOGENEITY (execution tier): no SHOOTOUT+GRIND mixing ===
      if (tier === 'execution') {
        const legClusters = legs.map(l => {
          const ctx = l._gameContext as PickGameContext | undefined;
          return ctx?.envCluster || 'NEUTRAL';
        }).filter(c => c !== 'NEUTRAL');
        const hasShootout = legClusters.includes('SHOOTOUT');
        const hasGrind = legClusters.includes('GRIND');
        if (hasShootout && hasGrind) {
          console.log(`[ClusterEnforcer] Rejected ${tier}/${profile.strategy}: mixed SHOOTOUT+GRIND clusters`);
          continue;
        }
      }

      // === MATCHUP ALIGNMENT (GOD MODE): OVER legs must face bottom-half defense, UNDER face top-half ===
      if (isGodModeParlay) {
        let matchupAligned = true;
        for (const leg of legs) {
          if (leg.type === 'team') continue;
          const defRank = leg.defense_rank;
          if (defRank == null) continue;
          const legSide = (leg.side || '').toLowerCase();
          if (legSide === 'over' && defRank <= 15) {
            matchupAligned = false; // OVER vs top-half defense = misaligned
            break;
          }
          if (legSide === 'under' && defRank > 15) {
            matchupAligned = false; // UNDER vs bottom-half defense = misaligned
            break;
          }
        }
        if (!matchupAligned) {
          console.log(`[GodModeMatchup] Rejected god_mode_lock parlay: defense alignment mismatch`);
          continue;
        }
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
        selection_rationale: profile.strategy === 'floor_lock' 
          ? `🔒 FLOOR LOCK: ${legs.length}-leg safe parlay — every leg's L10 floor clears the line`
          : profile.strategy === 'ceiling_shot'
          ? `🎯 CEILING SHOT: ${legs.length}-leg risky parlay — alt lines near L10 ceiling at plus-money odds`
          : `${tier} tier: ${profile.strategy} (${profile.legs}-leg)`,
        outcome: 'pending',
        is_simulated: tier !== 'execution',
        simulated_stake: stake,
        tier: tier,
      });

      // Track strategy count for diversity cap
      strategyCountMap.set(profile.strategy, (strategyCountMap.get(profile.strategy) || 0) + 1);
      console.log(`[Bot] Created ${tier}/${profile.strategy} ${legs.length}-leg parlay #${parlaysToCreate.length}`);
    }
  }

  // === POST-GENERATION DIVERSITY TRIM ===
  // The pre-generation cap uses config.count (target), but actual output may be much smaller.
  // Enforce 30% cap on ACTUAL output to prevent any strategy from dominating.
  const actualCount = parlaysToCreate.length;
  const actualDiversityCap = Math.max(2, Math.ceil(actualCount * 0.30));
  const postTrimStrategyCount = new Map<string, number>();
  const trimmedParlays: typeof parlaysToCreate = [];
  
  const POST_TRIM_PRIORITY = new Set(['double_confirmed_conviction', 'triple_confirmed_conviction', 'optimal_combo', 'floor_lock', 'ceiling_shot']);
  for (const parlay of parlaysToCreate) {
    const strategy = parlay.strategy_name || 'unknown';
    const currentCount = postTrimStrategyCount.get(strategy) || 0;
    // Priority strategies bypass the post-trim diversity cap
    if (!POST_TRIM_PRIORITY.has(strategy) && currentCount >= actualDiversityCap) {
      console.log(`[Bot] ✂️ Post-trim: voiding excess '${strategy}' parlay (${currentCount + 1} > ${actualDiversityCap} cap on ${actualCount} actual)`);
      continue; // Skip this parlay
    }
    postTrimStrategyCount.set(strategy, currentCount + 1);
    trimmedParlays.push(parlay);
  }
  
  if (trimmedParlays.length < actualCount) {
    console.log(`[Bot] Post-generation diversity trim: ${actualCount} → ${trimmedParlays.length} parlays (removed ${actualCount - trimmedParlays.length} excess)`);
  }

  // Diagnostic summary
  const nonZero = Object.entries(rejectionCounters).filter(([_, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(', ');
  console.log(`[Bot] ${tier} DIAGNOSTIC: ${trimmedParlays.length} created | rejections: ${nonZero || 'none'} | profiles=${config.profiles.length} pool=${pool.playerPicks.length}`);

  return { count: trimmedParlays.length, parlays: trimmedParlays };
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
  config?: { exploration_stake?: number },
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

      // Spread cap (monster parlays only run on big slates, use base cap)
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
  const monsterMinCandidates = activeSports.size >= 3 ? 15 : 10;
  if (qualityCandidates.length < monsterMinCandidates || activeSports.size < 2) {
    console.log(`[Bot v2] 🔥 MONSTER PARLAY: Skipped (${qualityCandidates.length} candidates, ${activeSports.size} sports — need ${monsterMinCandidates}+ candidates, 2+ sports)`);
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
    const monsterPropTypeCount = new Map<string, number>();

    for (const pick of candidates) {
      if (selected.length >= maxLegs) break;

      const teamKey = getTeamKey(pick);
      if (teamKey && usedTeams.has(teamKey)) continue;

      const sport = pick.sport || deriveSportFromCategory(pick.category);
      if ((sportCount[sport] || 0) >= 2) continue;

      if (isMirrorPick(selected, pick)) continue;
      if (hasCorrelation(selected, pick)) continue;

      // ANTI-CORRELATION BLOCKING (monster parlays)
      const monsterAntiCorr = hasAntiCorrelation(pick, selected);
      if (monsterAntiCorr.blocked) {
        console.log(`[Monster AntiCorr] ${monsterAntiCorr.reason}`);
        continue;
      }

      // PROP TYPE CONCENTRATION CAP (40% max)
      const pickPropType = normalizePropTypeCategory(pick.prop_type || pick.bet_type || '');
      const currentPropCount = monsterPropTypeCount.get(pickPropType) || 0;
      const monsterVolumeMode = pool.playerPicks.length < 60;
      const maxPropLegs = monsterVolumeMode
        ? Math.max(3, Math.floor(maxLegs * 0.5))
        : Math.max(1, Math.floor(maxLegs * 0.4));
      if (currentPropCount >= maxPropLegs) {
        console.log(`[Monster PropTypeCap] Blocked ${pick.player_name || pick.home_team} - ${pickPropType} at ${currentPropCount}/${maxPropLegs}`);
        continue;
      }

      // MINIMUM PROJECTION BUFFER (stat-aware + conviction-aware)
      if (pick.projected_value && pick.line) {
        const side = pick.recommended_side || pick.side || 'over';
        const buffer = side === 'over' ? pick.projected_value - pick.line : pick.line - pick.projected_value;
        const isMonsterConviction = pick.isTripleConfirmed || pick.isDoubleConfirmed || (pick.engineCount >= 3);
        const monsterMinBuf = getMinBuffer(pick.prop_type, pick.line, isMonsterConviction);
        if (Math.abs(buffer) < monsterMinBuf && pick.projected_value > 0) {
          console.log(`[Monster BufferGate] Blocked ${pick.player_name} ${pick.prop_type} (buffer: ${buffer.toFixed(2)} < ${monsterMinBuf}${isMonsterConviction ? ' [conviction]' : ''})`);
          continue;
        }
      }

      selected.push(pick);
      if (teamKey) usedTeams.add(teamKey);
      sportCount[sport] = (sportCount[sport] || 0) + 1;
      monsterPropTypeCount.set(pickPropType, currentPropCount + 1);

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
      sport: pick.sport || deriveSportFromCategory(pick.category),
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
      simulated_stake: config?.exploration_stake ?? 75,
      simulated_payout: (config?.exploration_stake ?? 75) * conservativeResult.decimalOdds,
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
            simulated_stake: config?.exploration_stake ?? 75,
            simulated_payout: (config?.exploration_stake ?? 75) * aggressiveResult.decimalOdds,
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
    let compositeScore = calculateCompositeScore(p.hitRate * 100, edge, oddsValueScore, 1.0, p.hitRate * 100, side);
    compositeScore += getDayTypeBoost(p.propType, currentDayTypeSignal);

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
    mispricedPicks: [],
    doubleConfirmedPicks: [],
    tripleConfirmedPicks: [],
    multiEnginePicks: [],
    totalPool: playerPicks.length + teamPicks.length,
    goldenCategories: new Set(['HIGH_SCORER_OVER', 'ELITE_ASSIST_OVER']),
    defenseDetailMap: new Map(),
  };
}

// ============= DEFENSE MATCHUP FILTER HELPERS =============

/**
 * Map prop_type string to the stat_category key used in nba_opponent_defense_stats
 */
function propTypeToDefenseStat(propType: string): string {
  const pt = (propType || '').toLowerCase();
  if (pt.includes('rebound')) return 'rebounds';
  if (pt.includes('assist')) return 'assists';
  if (pt.includes('three') || pt.includes('3pt') || pt.includes('3p')) return 'threes';
  if (pt.includes('block')) return 'blocks';
  return 'points';
}

/**
 * Normalize BDL team names to match game_bets naming conventions.
 * e.g. "LA Clippers" → "Los Angeles Clippers"
 */
function normalizeBdlTeamName(name: string): string {
  const fixes: Record<string, string> = {
    'la clippers': 'los angeles clippers',
  };
  const lower = (name || '').toLowerCase().trim();
  return fixes[lower] ?? lower;
}

/**
 * Get opponent defense rank for a player prop pick.
 * opponentMap: team_name_lower → opponent_team_name_lower (today's schedule)
 * defenseMap: team_name_lower → { stat_category → defense_rank }
 * Returns null if no data (no data = don't block)
 */
function getOpponentDefenseRank(
  playerTeamName: string,
  propType: string,
  opponentMap: Map<string, string>,
  defenseMap: Map<string, Map<string, number>>
): number | null {
  const teamKey = (playerTeamName || '').toLowerCase().trim();
  const opponent = opponentMap.get(teamKey);
  if (!opponent) return null;
  const defRanks = defenseMap.get(opponent);
  if (!defRanks) return null;
  const statKey = propTypeToDefenseStat(propType);
  return defRanks.get(statKey) ?? defRanks.get('overall') ?? null;
}

/**
 * Check if a pick passes the defensive matchup threshold for inclusion in master parlay.
 * For OVER picks: need soft defense (rank >= 17, meaning 17th-worst = lots allowed)
 * For UNDER picks: need strong defense (rank <= 15)
 * null rank = no data = allow (don't block on missing data)
 */
function passesDefenseMatchup(opponentRank: number | null, side: string): boolean {
  if (opponentRank === null) return true;
  const s = (side || '').toLowerCase();
  if (s === 'over') return opponentRank >= 17;
  if (s === 'under') return opponentRank <= 15;
  return true;
}

/**
 * Get defensive matchup composite adjustment for regular execution picks.
 * This provides soft bonuses/penalties across ALL execution tier picks (not just master parlay).
 */
function getDefenseMatchupAdjustment(opponentRank: number | null, side: string): number {
  if (opponentRank === null) return 0;
  const s = (side || '').toLowerCase();
  if (s === 'over') {
    if (opponentRank >= 25) return 8;  // Very soft defense — big boost
    if (opponentRank >= 20) return 4;  // Soft defense
    if (opponentRank <= 8) return -10; // Tough defense — big penalty
    return 0;
  } else if (s === 'under') {
    if (opponentRank <= 8) return 8;   // Very strong defense — confirms under
    if (opponentRank <= 15) return 6;  // Strong defense — confirms under
    if (opponentRank >= 25) return -8; // Soft defense — hurts under
    return 0;
  }
  return 0;
}

// ============= GENERATE MASTER PARLAY =============
/**
 * Builds a single 6-leg NBA master parlay targeting +500 to +2000 odds.
 * - Loads today's NBA opponent matchups from game_bets
 * - Loads defense ranks from nba_opponent_defense_stats
 * - Filters to picks that pass defensive matchup validation
 * - Enforces 1 pick per archetype AND 1 pick per team (no same-team correlation)
 * - Targets 5 player props from diverse archetypes + 1 anchor leg
 * - Stakes at bankroll_doubler_stake ($500 default)
 */
async function generateMasterParlay(
  supabase: any,
  pool: { playerPicks: EnrichedPick[]; teamPicks: EnrichedPick[]; whalePicks: EnrichedPick[] },
  targetDate: string,
  strategyName: string,
  bankroll: number,
  globalFingerprints: Set<string>,
  stakeAmount: number
): Promise<any | null> {
  console.log(`[MasterParlay] 🏆 Building 6-leg bankroll doubler for ${targetDate}`);

  // Load today's NBA games to build team → opponent map
  const { startUtc, endUtc } = getEasternDateRange();
  const { data: todayGames } = await supabase
    .from('game_bets')
    .select('home_team, away_team, sport')
    .eq('sport', 'basketball_nba')
    .gte('commence_time', startUtc)
    .lte('commence_time', endUtc);

  // Build bidirectional opponent map: team_lower → opponent_lower
  const opponentMap = new Map<string, string>();
  if (todayGames && todayGames.length > 0) {
    for (const g of todayGames) {
      const home = (g.home_team || '').toLowerCase().trim();
      const away = (g.away_team || '').toLowerCase().trim();
      if (home && away) {
        opponentMap.set(home, away);
        opponentMap.set(away, home);
      }
    }
    console.log(`[MasterParlay] Opponent map built from ${todayGames.length} NBA games: ${opponentMap.size / 2} matchups`);
  } else {
    console.log(`[MasterParlay] ⚠️ No NBA games found for today — defense filter will use null (allow-all) mode`);
  }

  // Load defensive rankings from nba_opponent_defense_stats
  const { data: defStats } = await supabase
    .from('nba_opponent_defense_stats')
    .select('team_name, stat_category, defense_rank');

  // Build defenseMap: team_lower → Map<stat_category, rank>
  const defenseMap = new Map<string, Map<string, number>>();
  if (defStats && defStats.length > 0) {
    for (const row of defStats) {
      const key = (row.team_name || '').toLowerCase().trim();
      if (!defenseMap.has(key)) defenseMap.set(key, new Map());
      defenseMap.get(key)!.set((row.stat_category || 'overall').toLowerCase(), row.defense_rank);
    }
    console.log(`[MasterParlay] Defense map loaded: ${defenseMap.size} teams`);
  }

  // NBA player prop candidates (real lines only, not blocked sports)
  const nbaCandidates = pool.playerPicks.filter(p =>
    (p.sport === 'basketball_nba' || !p.sport) &&
    p.has_real_line &&
    Math.abs(p.line || 0) > 0 &&
    p.player_name &&
    (p.l10_hit_rate || p.confidence_score || 0) >= 0.62
  );

  // Enrich each candidate with defense rank + check pass/fail
  type EnrichedMasterCandidate = EnrichedPick & {
    defenseRank: number | null;
    defenseAdj: number;
    passesMatchup: boolean;
    masterScore: number;
    teamLower: string;
  };

  const enrichedCandidates: EnrichedMasterCandidate[] = nbaCandidates.map(pick => {
    // Get the player's team from available fields
    const teamLower = normalizeBdlTeamName((pick as any).team_name || '');
    const side = (pick.recommended_side || 'over').toLowerCase();
    const defenseRank = getOpponentDefenseRank(teamLower, pick.prop_type || 'points', opponentMap, defenseMap);
    const defenseAdj = getDefenseMatchupAdjustment(defenseRank, side);
    const passesMatchup = passesDefenseMatchup(defenseRank, side);
    const hitRate = (pick.l10_hit_rate || pick.confidence_score || 0) * 100;
    // Master score = composite + defense adjustment + hit-rate bonus
    const masterScore = (pick.compositeScore || 60) + defenseAdj + (hitRate >= 70 ? 5 : hitRate >= 65 ? 3 : 0);

    return { ...pick, defenseRank, defenseAdj, passesMatchup, masterScore, teamLower };
  });

  // Log each candidate's defense outcome for diagnostics
  for (const c of enrichedCandidates) {
    const rankStr = c.defenseRank !== null ? `rank ${c.defenseRank}` : 'rank null (no data)';
    const result = c.passesMatchup ? '✅ PASS' : '❌ BLOCK';
    console.log(`[MasterParlay] ${result} ${c.player_name} (${c.teamLower}) ${c.recommended_side || 'over'} ${c.prop_type} — opponent ${rankStr} | masterScore ${c.masterScore}`);
  }

  // Hard-filter: must pass defensive matchup
  const validCandidates = enrichedCandidates
    .filter(c => c.passesMatchup)
    .sort((a, b) => b.masterScore - a.masterScore);

  console.log(`[MasterParlay] ${nbaCandidates.length} NBA candidates → ${validCandidates.length} pass defense matchup filter`);

  if (validCandidates.length < 4) {
    console.log(`[MasterParlay] ⚠️ Not enough defense-validated candidates (${validCandidates.length}/${nbaCandidates.length}). Skipping master parlay.`);
    return null;
  }

  // Greedily select legs enforcing: 1 per archetype, 1 per team
  const selectedLegs: EnrichedMasterCandidate[] = [];
  const usedArchetypes = new Set<string>();
  const usedTeams = new Set<string>();

  for (const candidate of validCandidates) {
    if (selectedLegs.length >= 6) break;
    const archetype = candidate.archetype || candidate.category || 'UNKNOWN';
    const teamKey = candidate.teamLower;

    // Enforce archetype diversity (max 1 per archetype)
    if (usedArchetypes.has(archetype)) continue;
    // Enforce team diversity (max 1 player per team)
    if (teamKey && usedTeams.has(teamKey)) continue;

    // Ghost leg gate
    if (!candidate.player_name) { console.log(`[GhostBlock] Master parlay: skipped leg with no player_name`); continue; }
    // Volatile prop block
    const masterNormProp = normalizePropType(candidate.prop_type || '');
    if (BLOCKED_PARLAY_PROPS.has(masterNormProp)) { console.log(`[VolatileBlock] Master: blocked ${candidate.player_name} ${candidate.prop_type}`); continue; }
    // Rebound cap
    const masterRebCount = selectedLegs.filter(l => normalizePropType(l.prop_type || '') === 'player_rebounds').length;
    if (masterNormProp === 'player_rebounds' && masterRebCount >= MAX_REBOUND_LEGS_PER_PARLAY) { console.log(`[ReboundCap] Master: blocked ${candidate.player_name}`); continue; }

    selectedLegs.push(candidate);
    usedArchetypes.add(archetype);
    if (teamKey) usedTeams.add(teamKey);
  }

  // Need at least 5 legs for a meaningful master parlay
  if (selectedLegs.length < 5) {
    console.log(`[MasterParlay] ⚠️ Only ${selectedLegs.length} diverse legs found. Skipping master parlay.`);
    return null;
  }

  // Build the parlay legs array
  const parlayLegs = selectedLegs.map((pick, idx) => {
    const rawHitRate = pick.l10_hit_rate || pick.confidence_score || 0.62;
    // Cap hit rate at 75% for any pick where hit rate is suspiciously high (≥ 1.0 = was computed against 0.5 line)
    // This prevents fake 100% hit rates when the player's threes were scored at the trivial OVER 0.5 line
    const cappedHitRate = rawHitRate >= 1.0 ? 0.75 : rawHitRate;
    return {
      type: 'player',
      player_name: pick.player_name,
      prop_type: pick.prop_type,
      line: pick.line,
      side: pick.recommended_side || 'over',
      sport: pick.sport || deriveSportFromCategory(pick.category),
      americanOdds: pick.americanOdds || -110,
      hit_rate: Math.round(cappedHitRate * 100),
      defense_rank: (pick as EnrichedMasterCandidate).defenseRank,
      defense_adj: (pick as EnrichedMasterCandidate).defenseAdj,
      environment_score: (pick as any).environmentScore ?? null,
      environment_components: (pick as any).environmentComponents ?? null,
      archetype: pick.archetype || pick.category,
      leg_index: idx,
    };
  });

  // Calculate combined odds and probability (cap hit rates at 75% for any that were inflated by 0.5 lines)
  const combinedProbability = selectedLegs.reduce((acc, pick) => {
    const rawP = pick.l10_hit_rate || pick.confidence_score || 0.62;
    const p = rawP >= 1.0 ? 0.75 : rawP;
    return acc * p;
  }, 1.0);

  // Convert each leg's American odds to decimal, multiply for parlay odds
  const combinedDecimalOdds = selectedLegs.reduce((acc, pick) => {
    const odds = pick.americanOdds || -110;
    const decimal = odds < 0 ? (100 / Math.abs(odds)) + 1 : (odds / 100) + 1;
    return acc * decimal;
  }, 1.0);
  const combinedAmericanOdds = combinedDecimalOdds >= 2
    ? Math.round((combinedDecimalOdds - 1) * 100)
    : Math.round(-100 / (combinedDecimalOdds - 1));

  // Dedup fingerprint
  const fingerprint = createParlayFingerprint(parlayLegs);
  if (globalFingerprints.has(fingerprint)) {
    console.log(`[MasterParlay] Duplicate master parlay — skipping`);
    return null;
  }
  globalFingerprints.add(fingerprint);

  const defRankSummary = selectedLegs.map(l =>
    `${l.player_name?.split(' ').pop()} ${l.recommended_side} vs def#${(l as EnrichedMasterCandidate).defenseRank ?? 'N/A'}`
  ).join(', ');

  const parlayRecord = {
    parlay_date: targetDate,
    legs: parlayLegs,
    leg_count: parlayLegs.length,
    combined_probability: combinedProbability,
    expected_odds: combinedAmericanOdds,
    simulated_win_rate: combinedProbability,
    simulated_edge: Math.max(combinedProbability - (1 / (combinedDecimalOdds)), -0.1),
    simulated_sharpe: combinedProbability * 2,
    strategy_name: `master_parlay_${strategyName}`,
    selection_rationale: `6-leg NBA Bankroll Doubler | Defense-filtered matchups | ${defRankSummary} | Target: +${combinedAmericanOdds}`,
    outcome: 'pending',
    is_simulated: false,
    simulated_stake: stakeAmount,
    tier: 'execution',
    category_weights_snapshot: { master_parlay: true, legs: parlayLegs.length, defense_filtered: true },
  };

  console.log(`[MasterParlay] ✅ Built ${parlayLegs.length}-leg master parlay: +${combinedAmericanOdds} odds | prob ${(combinedProbability * 100).toFixed(1)}% | ${defRankSummary}`);
  return parlayRecord;
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
    const adminOnly = body.admin_only === true;

    // ============= LOAD DYNAMIC STAKE CONFIG =============
    // Read stakes from bot_stake_config table so they can be updated without code deploys
    const { data: stakeConfig } = await supabase
      .from('bot_stake_config')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (stakeConfig) {
      TIER_CONFIG.execution.stake = 100; // Flat $100 — ignore DB value for execution
      TIER_CONFIG.validation.stake = stakeConfig.validation_stake ?? 150;
      TIER_CONFIG.exploration.stake = stakeConfig.exploration_stake ?? 50;
      console.log(`[Bot v2] Loaded stake config: exec=$${stakeConfig.execution_stake}, val=$${stakeConfig.validation_stake}, expl=$${stakeConfig.exploration_stake}, block2leg=${stakeConfig.block_two_leg_parlays}`);
      
      // Block 2-leg parlays from execution tier if configured
      if (stakeConfig.block_two_leg_parlays) {
        TIER_CONFIG.execution.profiles = TIER_CONFIG.execution.profiles.filter(p => p.legs !== 2);
        TIER_CONFIG.validation.profiles = TIER_CONFIG.validation.profiles.filter(p => p.legs !== 2);
        // Fix: Also block exploration mini-parlay and whale_signal 2-leg paths (previously bypassed this flag)
        TIER_CONFIG.exploration.profiles = TIER_CONFIG.exploration.profiles.filter(p => {
          if (p.legs === 2 && p.strategy.includes('mini_parlay')) return false;
          if (p.legs === 2 && p.strategy === 'whale_signal') return false;
          return p.legs !== 2;
        });
        console.log(`[Bot v2] 2-leg parlays BLOCKED from all tiers including exploration mini-parlay and whale_signal paths`);
      }
    } else {
      console.log(`[Bot v2] No stake config found, using hardcoded TIER_CONFIG defaults`);
    }

    // ============= LOAD PLAYER, PROP TYPE, STRATEGY PERFORMANCE & DAY TYPE SIGNAL =============
    await Promise.all([
      loadPropTypePerformance(supabase),
      loadPlayerPerformance(supabase),
      fetchStrategyHitRates(supabase),
      getDayTypeSignal(supabase, targetDate).then(signal => { currentDayTypeSignal = signal; }),
    ]);

    // ============= DAY TYPE PROFILE ADJUSTMENT =============
    // Dynamically adjust archetype profiles based on today's matchup signal
    if (currentDayTypeSignal && currentDayTypeSignal.primary !== 'BALANCED' && currentDayTypeSignal.confidence >= 60) {
      const dayType = currentDayTypeSignal.primary;
      for (const tierName of ['exploration', 'validation', 'execution'] as const) {
        const tier = TIER_CONFIG[tierName];
        let profiles = [...tier.profiles];
        
        if (dayType === 'THREES' || dayType === 'POINTS') {
          // Skip 2 of 3 rebound archetype profiles (keep 1 for diversity)
          let rebSkipped = 0;
          profiles = profiles.filter(p => {
            if (p.strategy === 'winning_archetype_reb_ast' && rebSkipped < 2) {
              rebSkipped++;
              return false;
            }
            return true;
          });
          // Duplicate 3PT profiles on Threes days
          if (dayType === 'THREES') {
            const threesProfiles = profiles.filter(p => p.strategy === 'winning_archetype_3pt_scorer');
            profiles.push(...threesProfiles);
          }
        } else if (dayType === 'REBOUNDS') {
          // Skip 3PT archetype profiles on Rebounds days
          let threeSkipped = 0;
          profiles = profiles.filter(p => {
            if (p.strategy === 'winning_archetype_3pt_scorer' && threeSkipped < 1) {
              threeSkipped++;
              return false;
            }
            return true;
          });
        }
        
        tier.profiles = profiles;
      }
      console.log(`[Bot v2] 📊 Day Type profile adjustment applied: ${dayType} — rebalanced archetype profiles`);
    }

    // ============= STALE HIT RATE DETECTION + AUTO-REFRESH =============
    // If bot_strategies haven't been updated in 24 hours, trigger immediate refresh
    try {
      const { data: latestStrat } = await supabase
        .from('bot_strategies')
        .select('updated_at')
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (latestStrat?.updated_at) {
        const lastUpdate = new Date(latestStrat.updated_at).getTime();
        const hoursSinceUpdate = (Date.now() - lastUpdate) / (1000 * 60 * 60);
        if (hoursSinceUpdate > 24) {
          console.log(`[GOD MODE] ⚠️ Strategy hit rates stale (${hoursSinceUpdate.toFixed(1)}h old). Triggering auto-refresh...`);
          try {
            const refreshUrl = `${supabaseUrl}/functions/v1/bot-update-engine-hit-rates`;
            await fetch(refreshUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
              body: JSON.stringify({}),
            });
            // Re-fetch after refresh
            await fetchStrategyHitRates(supabase);
            console.log(`[GOD MODE] ✅ Hit rates auto-refreshed successfully`);
          } catch (refreshErr) {
            console.warn(`[GOD MODE] Auto-refresh failed: ${refreshErr}`);
          }
        } else {
          console.log(`[GOD MODE] Hit rates fresh (${hoursSinceUpdate.toFixed(1)}h old)`);
        }
      }
    } catch (staleErr) {
      console.warn(`[GOD MODE] Stale check failed: ${staleErr}`);
    }

    // Log strategy multipliers to activity log for monitoring
    const multiplierLog: Record<string, number> = {};
    for (const [name, mult] of strategyWeightMultipliers) {
      multiplierLog[name] = Math.round(mult * 100) / 100;
    }
    try {
      await supabase.from('bot_activity_log').insert({
        event_type: 'god_mode_strategy_multipliers',
        message: `GOD MODE: Strategy multipliers loaded for ${Object.keys(multiplierLog).length} strategies`,
        metadata: multiplierLog,
        severity: 'info',
      });
    } catch (_) { /* ignore */ }
    
    // Log player performance summary
    let provenWinners = 0, reliablePlayers = 0, avoidPlayers = 0;
    for (const [, perf] of playerPerformanceMap) {
      if (perf.legsPlayed >= 5 && perf.hitRate >= 0.70) provenWinners++;
      else if (perf.legsPlayed >= 5 && perf.hitRate >= 0.50) reliablePlayers++;
      else if (perf.legsPlayed >= 5 && perf.hitRate < 0.30) avoidPlayers++;
    }
    console.log(`[Bot] Player patterns: ${provenWinners} proven winners, ${reliablePlayers} reliable, ${avoidPlayers} to avoid`);

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
    const regenBoost = Math.min(Math.max(parseInt(body.regen_boost) || 0, 0), 2); // 0, 1, or 2

    if (isDryRun) {
      console.log(`[Bot v2] 🧪 DRY-RUN MODE: No DB writes, synthetic data fallback enabled`);
    }

    // Apply regen_boost: progressively tighten minHitRate and minConfidence (coherence gate)
    if (regenBoost > 0) {
      const hitRateBoost = regenBoost * 5; // +5 or +10
      const confidenceBoost = regenBoost * 0.05; // +0.05 or +0.10
      for (const tierKey of Object.keys(TIER_CONFIG) as TierName[]) {
        TIER_CONFIG[tierKey].minHitRate += hitRateBoost;
        TIER_CONFIG[tierKey].minConfidence += confidenceBoost;
        // Also boost per-profile minHitRate
        for (const profile of TIER_CONFIG[tierKey].profiles) {
          if (profile.minHitRate) {
            profile.minHitRate += hitRateBoost;
          }
        }
      }
      console.log(`[Bot v2] 🔄 REGEN BOOST ${regenBoost}: minHitRate +${hitRateBoost}, minConfidence +${confidenceBoost.toFixed(2)} applied to all tiers`);
    }

    console.log(`[Bot v2] Generating tiered parlays for ${targetDate} (source: ${generationSource}, regen_boost: ${regenBoost})`);
    if (winningPatterns) {
      console.log(`[Bot v2] Pattern replay active: ${winningPatterns.hot_patterns?.length || 0} hot, ${winningPatterns.cold_patterns?.length || 0} cold patterns`);
    }

    // 0. Pre-load TT stats cache for table tennis scoring engine
    ttStatsCache = null; // Reset for fresh run
    await getTTStatsCache(supabase);
    console.log(`[Bot v2] TT stats cache: ${ttStatsCache?.size || 0} players loaded`);

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

    // === ADAPTIVE INTELLIGENCE INTEGRATION ===
    // Read latest adaptation state for regime weights, Bayesian rates, gate overrides, correlations
    let adaptationState: any = null;
    try {
      const { data: adaptState } = await supabase
        .from('bot_adaptation_state')
        .select('*')
        .order('adaptation_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (adaptState) {
        adaptationState = adaptState;
        console.log(`[Bot v2] 🧠 Adaptive Intelligence loaded: regime=${adaptState.current_regime}, score=${adaptState.adaptation_score}/100`);
        
        // Apply gate overrides from adaptive intelligence
        const gates = adaptState.gate_overrides as Record<string, number> | null;
        if (gates) {
          // Override tier configs dynamically
          if (gates.minEdge) {
            TIER_CONFIG.execution.minEdge = gates.minEdge;
            TIER_CONFIG.validation.minEdge = Math.max(gates.minEdge * 0.8, 0.003);
          }
          if (gates.minHitRate) {
            TIER_CONFIG.execution.minHitRate = gates.minHitRate;
            TIER_CONFIG.validation.minHitRate = Math.max(gates.minHitRate - 5, 40);
          }
          console.log(`[Bot v2] 🚪 Gate overrides applied: minEdge=${gates.minEdge}, minHitRate=${gates.minHitRate}, minComposite=${gates.minComposite}`);
        }
        
        // Apply regime multipliers to weightMap
        (allWeights || []).forEach((w: any) => {
          if (w.regime_multiplier && w.regime_multiplier !== 1.0) {
            const sportKey = w.sport ? `${w.category}__${w.side}__${w.sport}` : null;
            const sideKey = `${w.category}__${w.side}`;
            const currentWeight = weightMap.get(sportKey || sideKey) || weightMap.get(sideKey) || w.weight || 1.0;
            const adjustedWeight = currentWeight * w.regime_multiplier;
            if (sportKey && weightMap.has(sportKey)) weightMap.set(sportKey, adjustedWeight);
            if (weightMap.has(sideKey)) weightMap.set(sideKey, adjustedWeight);
          }
          
          // Use Bayesian hit rate where available (replaces raw hit rate in weight calculations)
          if (w.bayesian_hit_rate && w.bayesian_hit_rate > 0) {
            // Store for reference — the pool builder will use this
            (w as any)._bayesian_hit_rate = w.bayesian_hit_rate;
          }
        });
        
        console.log(`[Bot v2] 🧠 Regime multipliers and Bayesian rates applied to weight map`);
      }
    } catch (adaptErr) {
      console.log(`[Bot v2] ⚠️ Adaptive intelligence not available: ${adaptErr.message}`);
    }

    // === DYNAMIC ARCHETYPE DETECTION ===
    const archetypeResult = await detectWinningArchetypes(supabase);
    const dynamicArchetypes = { categories: archetypeResult.categories, ranked: archetypeResult.ranked };

    // === DYNAMIC MISPRICED EDGE PROMOTION ===
    const winningMispricedPatterns = await detectWinningMispricedPatterns(supabase);
    if (winningMispricedPatterns.length > 0) {
      const promotedProfiles = autoPromoteToExecution(winningMispricedPatterns);
      TIER_CONFIG.execution.profiles.push(...promotedProfiles);
      console.log(`[Bot v2] 🚀 Promoted ${promotedProfiles.length} mispriced_edge patterns to execution tier`);
    } else {
      console.log(`[Bot v2] No mispriced_edge patterns qualified for promotion`);
    }

    // 2. Get active strategy — prefer elite_categories_v1 (proven +$10,308 profit, 55.6% WR)
    let strategyName = 'tiered_v2';
    const { data: eliteStrategy } = await supabase
      .from('bot_strategies')
      .select('*')
      .eq('is_active', true)
      .ilike('strategy_name', '%elite_categories_v1%')
      .limit(1)
      .maybeSingle();

    if (eliteStrategy) {
      strategyName = eliteStrategy.strategy_name;
      console.log(`[Bot v2] ✅ Using proven strategy: ${strategyName}`);
    } else {
      // Fallback: get any active strategy
      const { data: fallbackStrategy } = await supabase
        .from('bot_strategies')
        .select('*')
        .eq('is_active', true)
        .order('win_rate', { ascending: false })
        .limit(1)
        .maybeSingle();
      strategyName = fallbackStrategy?.strategy_name || 'tiered_v2';
      console.log(`[Bot v2] ⚠️ elite_categories_v1 not found, using fallback: ${strategyName}`);
    }

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
          body: JSON.stringify({ type: 'daily_summary', admin_only: adminOnly, data: { parlaysCount: 0, winRate: 0, edge: 0, bankroll, mode: 'Paused - Bankroll Floor Protection' } }),
        });
      } catch (_) { /* ignore */ }
      return new Response(
        JSON.stringify({ success: true, parlaysGenerated: 0, reason: 'bankroll_floor_protection', bankroll }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Pre-detect light-slate mode (before pool building so ML Sniper can adapt)
    // Quick check: count player props available today — use analysis_date instead of created_at
    const { startUtc: preStartUtc, endUtc: preEndUtc } = getEasternDateRange();
    const { count: playerPropCount } = await supabase
      .from('category_sweet_spots')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('analysis_date', targetDate);

    const { count: sportCount } = await supabase
      .from('game_bets')
      .select('sport', { count: 'exact', head: true })
      .gte('commence_time', preStartUtc)
      .lte('commence_time', preEndUtc);

    // === ZERO-GAME FALLBACK: Check unified_props if game_bets is empty ===
    let effectiveSportCount = sportCount || 0;
    if (effectiveSportCount === 0) {
      console.log(`[Bot v2] ⚠️ game_bets returned 0 games — checking unified_props fallback...`);
      const { count: propsCount } = await supabase
        .from('unified_props')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)
        .gte('commence_time', preStartUtc)
        .lt('commence_time', preEndUtc);

      if ((propsCount || 0) > 0) {
        // Derive sport count from unified_props
        const { data: propSports } = await supabase
          .from('unified_props')
          .select('sport')
          .eq('is_active', true)
          .gte('commence_time', preStartUtc)
          .lt('commence_time', preEndUtc)
          .limit(500);
        const uniqueSports = new Set((propSports || []).map((p: any) => p.sport).filter(Boolean));
        effectiveSportCount = uniqueSports.size || 1;
        console.log(`[Bot v2] ✅ Props fallback: ${propsCount} active props across ${effectiveSportCount} sport(s). Proceeding.`);
        await supabase.from('bot_activity_log').insert({
          event_type: 'game_bets_stale_props_fallback',
          message: `game_bets empty but ${propsCount} unified_props found. Proceeding with generation.`,
          severity: 'warning',
          metadata: { date: targetDate, propsCount, sportCount: effectiveSportCount },
        });
      }
    }

    // === ZERO-GAME GRACEFUL MODE ===
    // Only skip if BOTH game_bets AND unified_props have nothing
    if (effectiveSportCount === 0 && (playerPropCount || 0) === 0) {
      console.log(`[Bot v2] 🚫 ZERO-GAME MODE: No games or props for ${targetDate}. Skipping generation.`);
      await supabase.from('bot_activity_log').insert({
        event_type: 'zero_game_day',
        message: `No games or props found for ${targetDate}. Generation skipped.`,
        severity: 'info',
        metadata: { date: targetDate, playerProps: 0, gameBets: 0, unifiedProps: 0 },
      });
      try {
        await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
           body: JSON.stringify({
             type: 'daily_summary',
             admin_only: adminOnly,
             data: { parlaysCount: 0, winRate: 0, edge: 0, bankroll, mode: '🚫 No Slate Today - Zero games scheduled' },
          }),
        });
      } catch (_) { /* ignore */ }
      return new Response(
        JSON.stringify({ success: true, parlaysGenerated: 0, reason: 'zero_game_day', date: targetDate }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isLightSlateMode = (playerPropCount || 0) === 0 || effectiveSportCount <= 2;
    const isVolumeMode = (playerPropCount || 0) > 0 && (playerPropCount || 0) < 30;
    const effectiveSpreadCap = isLightSlateMode ? 25 : MAX_SPREAD_LINE;
    if (isLightSlateMode) {
      console.log(`[Bot v2] 🌙 LIGHT-SLATE MODE: ${playerPropCount || 0} player props, ${sportCount || 0} sports.`);

      // === LIGHT-SLATE VOLUME THROTTLE ===
      // On thin game days, REDUCE volume and stakes instead of relaxing quality gates.
      // This prevents high-volume Execution-tier losses on Wednesdays and other light days.
      const origExecCount = TIER_CONFIG.execution.count;
      const origExecStake = TIER_CONFIG.execution.stake;
      const origValCount = TIER_CONFIG.validation.count;
      const origValStake = TIER_CONFIG.validation.stake;

      TIER_CONFIG.execution.count = Math.min(TIER_CONFIG.execution.count, 15);
      // Execution stays flat $100 even on light slates — no halving
      TIER_CONFIG.validation.count = Math.min(TIER_CONFIG.validation.count, 10);
      TIER_CONFIG.validation.stake = Math.round(TIER_CONFIG.validation.stake * 0.5);

      // Filter execution profiles to high-conviction strategies only
      const HIGH_CONVICTION_STRATEGIES = new Set([
        'double_confirmed_conviction', 'triple_confirmed_conviction',
        'multi_engine_consensus', 'optimal_combo', 'floor_lock',
        'cross_sport_4', 'god_mode_lock', 'sweet_spot_core',
        'mixed_conviction_stack', 'cash_lock', 'golden_lock',
        'hot_streak_lock', 'ncaab_unders_only',
      ]);
      const origExecProfiles = TIER_CONFIG.execution.profiles.length;
      TIER_CONFIG.execution.profiles = TIER_CONFIG.execution.profiles.filter(
        p => HIGH_CONVICTION_STRATEGIES.has(p.strategy)
      );

      console.log(`[Bot v2] 🚦 LIGHT-SLATE THROTTLE: exec ${origExecCount}→${TIER_CONFIG.execution.count} parlays (stake $${origExecStake}→$${TIER_CONFIG.execution.stake}), val ${origValCount}→${TIER_CONFIG.validation.count} (stake $${origValStake}→$${TIER_CONFIG.validation.stake}), exec profiles ${origExecProfiles}→${TIER_CONFIG.execution.profiles.length}`);
    }
    if (isVolumeMode) {
      console.log(`[Bot v2] 📈 VOLUME MODE: Only ${playerPropCount} player props — relaxing usage caps for more parlays.`);
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
               admin_only: adminOnly,
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

    // 5b. Detect thin pool mode — player pick pool survived all filters but is too small for parlay assembly
    const isThinPool = pool.playerPicks.length < 100;
    if (isThinPool) {
      console.log(`[Bot v2] 🟠 THIN POOL MODE: Only ${pool.playerPicks.length} player picks survived filters (< 100). Relaxing parlay assembly gates.`);
    }

    // 5c. TIMEOUT PREVENTION: Reduce tier targets on thin slates/pools so all tiers + composite filter complete within 150s
    if (isThinPool || isThinSlate) {
      const origExpCount = TIER_CONFIG.exploration.count;
      const origExpIter = TIER_CONFIG.exploration.iterations;
      TIER_CONFIG.exploration.count = Math.min(TIER_CONFIG.exploration.count, 30);
      TIER_CONFIG.exploration.iterations = Math.min(TIER_CONFIG.exploration.iterations, 800);
      TIER_CONFIG.validation.count = Math.min(TIER_CONFIG.validation.count, 15);
      TIER_CONFIG.execution.count = Math.min(TIER_CONFIG.execution.count, 15);
      console.log(`[Bot v2] ⏱️ TIMEOUT PREVENTION: Thin slate tier reduction — exp ${origExpCount}→${TIER_CONFIG.exploration.count} (iter ${origExpIter}→${TIER_CONFIG.exploration.iterations}), val→${TIER_CONFIG.validation.count}, exec→${TIER_CONFIG.execution.count}`);
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

    // Pre-load existing fingerprints ONLY for exact-duplicate blocking (not usage tracking)
    // Each generation batch starts fresh for usage maps to avoid fingerprint saturation
    const globalFingerprints = new Set<string>();
    const globalMirrorPrints = new Set<string>();
    globalGameUsage = new Map();
    globalMatchupUsage = new Map();
    globalTeamUsage = new Map();
    globalSlatePlayerPropUsage = new Map();
    const { data: existingParlays } = await supabase
      .from('bot_daily_parlays')
      .select('legs, leg_count, outcome')
      .eq('parlay_date', targetDate);
    if (existingParlays) {
      for (const p of existingParlays) {
        const legs = Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs);
        // Only block exact fingerprint duplicates — do NOT add mirror prints from existing parlays
        // Mirror blocking is scoped to within THIS run only to prevent cross-run over-blocking
        globalFingerprints.add(createParlayFingerprint(legs));
        
        // === CROSS-ATTEMPT EXPOSURE CAP: pre-populate player+prop+side usage from PENDING parlays ===
        if (p.outcome === 'pending') {
          for (const leg of legs) {
            if (leg.player_name && leg.prop_type) {
              const playerPropSideKey = `${(leg.player_name || '').toLowerCase().trim()}|${normalizePropType(leg.prop_type || '')}|${(leg.side || 'over').toLowerCase()}`;
              globalSlatePlayerPropUsage.set(playerPropSideKey, (globalSlatePlayerPropUsage.get(playerPropSideKey) || 0) + 1);
            }
          }
        }
      }
      const preloadedUsage = Array.from(globalSlatePlayerPropUsage.entries()).filter(([_, v]) => v >= 1);
      const existingPendingCount = (existingParlays || []).filter(p => p.outcome === 'pending').length;
      console.log(`[Bot v2] Pre-loaded ${globalFingerprints.size} fingerprints + ${globalSlatePlayerPropUsage.size} player usage counts for ${targetDate} (${preloadedUsage.length} at 1+ usage, ${existingPendingCount} existing pending)`);
    }

    // Light-slate: increase usage limits for exploration tier
    if (isLightSlateMode) {
      TIER_CONFIG.exploration.maxTeamUsage = 5;
      TIER_CONFIG.exploration.maxCategoryUsage = 8;
      console.log(`[Bot v2] Light-slate: exploration maxTeamUsage=5, maxCategoryUsage=8`);
    }

    // Volume mode: relax constraints for small pools to produce more parlays
    if (isVolumeMode) {
      // maxPlayerUsage stays at 1 even in volume mode — only relax team/category caps
      TIER_CONFIG.exploration.maxTeamUsage = 5;
      TIER_CONFIG.exploration.maxCategoryUsage = 10;
      TIER_CONFIG.exploration.minHitRate = 40;
      console.log(`[Bot v2] Volume mode: exploration maxPlayerUsage=4, maxTeamUsage=5, maxCategoryUsage=10, minHitRate=40`);
    }

    // ============= ENVIRONMENT-CLUSTERED PARLAY ASSEMBLY =============
    // Pre-cluster picks by game environment and build parlays within each cluster FIRST
    const clusterParlays: any[] = [];
    if (tiersToGenerate.includes('execution') && !isLightSlateMode) {
      const allPicks = [...pool.playerPicks];
      const shootoutPicks = allPicks.filter(p => {
        const ctx = (p as any)._gameContext as PickGameContext | undefined;
        return ctx?.envCluster === 'SHOOTOUT';
      });
      const grindPicks = allPicks.filter(p => {
        const ctx = (p as any)._gameContext as PickGameContext | undefined;
        return ctx?.envCluster === 'GRIND';
      });

      console.log(`[EnvCluster] SHOOTOUT: ${shootoutPicks.length} picks, GRIND: ${grindPicks.length} picks`);

      // Build clustered parlays for clusters with 3+ picks
      for (const [clusterName, clusterPool] of [['shootout', shootoutPicks], ['grind', grindPicks]] as const) {
        if (clusterPool.length < 3) {
          console.log(`[EnvCluster] ${clusterName} cluster too small (${clusterPool.length}), skipping`);
          continue;
        }

        // Sort by composite score (strongest picks first)
        const sorted = [...clusterPool].sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));
        
        // Build up to 3 parlays per cluster
        const usedPlayers = new Set<string>();
        // Shootout stack at 16% WR — cap at 1; grind stays at 3
        const maxClusterParlays = clusterName === 'shootout' ? 1 : 3;
        for (let pi = 0; pi < maxClusterParlays; pi++) {
          const legs: any[] = [];
          for (const pick of sorted) {
            if (legs.length >= 3) break;
            const pName = (pick.player_name || '').toLowerCase();
            const ppKey = `${pName}|${normalizePropTypeForCorrelation(pick.prop_type || '')}`;
            if (usedPlayers.has(ppKey)) continue;
            // Check combo/base overlap with existing legs
            if (legs.length > 0) {
              const existingForCorr = legs.map((l: any) => ({ player_name: l.player_name, prop_type: l.prop_type || '' }));
              if (hasCorrelatedProp(existingForCorr, pick.player_name, pick.prop_type || '')) continue;
            }
            
            // === 70% L10 HIT RATE GATE for cluster builder ===
            const clusterL10Hr = (pick as any).l10_hit_rate || 0;
            const clusterL10HrPct = clusterL10Hr <= 1 ? clusterL10Hr * 100 : clusterL10Hr;
            if (clusterL10HrPct < 70) {
              console.log(`[EnvCluster] ❌ L10 GATE: ${pick.player_name} ${pick.prop_type} L10=${clusterL10HrPct.toFixed(0)}% conf=${((pick.confidence_score || 0) * 100).toFixed(0)}% < 70%`);
              continue;
            }

            // Check anti-correlation
            const antiCorr = hasAntiCorrelation(pick, legs);
            if (antiCorr.blocked) continue;

            // Ghost leg gate
            if (!pick.player_name) { console.log(`[GhostBlock] Cluster: skipped leg with no player_name`); continue; }
            // Volatile prop block
            const clusterNormProp = normalizePropType(pick.prop_type || '');
            if (BLOCKED_PARLAY_PROPS.has(clusterNormProp)) { console.log(`[VolatileBlock] Cluster: blocked ${pick.player_name} ${pick.prop_type}`); continue; }
            // Rebound cap
            const clusterRebCount = legs.filter((l: any) => normalizePropType(l.prop_type || '') === 'player_rebounds').length;
            if (clusterNormProp === 'player_rebounds' && clusterRebCount >= MAX_REBOUND_LEGS_PER_PARLAY) { console.log(`[ReboundCap] Cluster: blocked ${pick.player_name}`); continue; }

            legs.push({
              player_name: pick.player_name,
              team_name: pick.team_name,
              prop_type: pick.prop_type,
              line: pick.line,
              side: pick.recommended_side,
              category: pick.category,
              weight: pick.weight,
              hit_rate: clusterL10HrPct,
              l10_hit_rate: clusterL10HrPct,
              confidence_score: pick.confidence_score,
              american_odds: pick.americanOdds,
              composite_score: pick.compositeScore,
              sport: pick.sport,
              type: 'player',
              _gameContext: (pick as any)._gameContext,
            });
            usedPlayers.add(ppKey);
          }

          if (legs.length < 3) break;

          // Calculate coherence (should be high since all same cluster)
          const coherence = calculateParlayCoherence(legs) + 10; // +10 cluster bonus
          if (coherence < 70) {
            console.log(`[EnvCluster] ${clusterName} parlay #${pi + 1} failed coherence (${coherence})`);
            continue;
          }

          // Calculate combined probability and odds
          const combinedProb = legs.reduce((p, l) => p * ((l.hit_rate || 50) / 100), 1);
          const decimalOdds = legs.reduce((acc, l) => {
            const odds = l.american_odds || -110;
            return acc * (odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1);
          }, 1);
          const americanOdds = decimalOdds >= 2 ? Math.round((decimalOdds - 1) * 100) : Math.round(-100 / (decimalOdds - 1));

          const fingerprint = legs.map(l => `${l.player_name}_${l.prop_type}_${l.side}`).sort().join('|');
          if (globalFingerprints.has(fingerprint)) continue;
          globalFingerprints.add(fingerprint);

          clusterParlays.push({
            parlay_date: targetDate,
            legs,
            leg_count: legs.length,
            combined_probability: combinedProb,
            expected_odds: Math.min(americanOdds, 10000),
            simulated_win_rate: combinedProb,
            simulated_edge: combinedProb - (1 / decimalOdds),
            simulated_sharpe: (combinedProb - (1 / decimalOdds)) / (0.5 * Math.sqrt(legs.length)),
            strategy_name: `${strategyName}_execution_${clusterName}_stack`,
            selection_rationale: `execution tier: ${clusterName}_stack (3-leg environment cluster)`,
            outcome: 'pending',
            is_simulated: false,
            simulated_stake: 100,
            tier: 'execution',
          });

          console.log(`[EnvCluster] ✅ Created ${clusterName}_stack parlay #${pi + 1} (coherence: ${coherence})`);
        }
      }

      if (clusterParlays.length > 0) {
        allParlays.push(...clusterParlays);
        console.log(`[EnvCluster] 🌊 ${clusterParlays.length} clustered parlays created (ride the same wave)`);
      }
    }

    const _tierLoopStartTime = Date.now();
    for (const tier of tiersToGenerate) {
      // Global timeout guard: ensure composite filter + DB insert can still run
      const _tierElapsed = Date.now() - _tierLoopStartTime;
      if (_tierElapsed > 120_000) {
        console.log(`[Bot v2] ⏰ Global timeout approaching (${_tierElapsed}ms elapsed), skipping remaining tiers: ${tiersToGenerate.slice(tiersToGenerate.indexOf(tier)).join(', ')}`);
        break;
      }
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
        winningPatterns,
        isLightSlateMode,
        isVolumeMode,
        dynamicArchetypes,
        isThinPool
      );
      results[tier] = result;
      allParlays = [...allParlays, ...result.parlays];
      console.log(`[Bot v2] ✅ Tier '${tier}' completed in ${Date.now() - _tierLoopStartTime}ms total (${result.parlays.length} parlays)`);
    }

    // === MONSTER PARLAY (big-slate only — disabled on light slates) ===
    if (!isLightSlateMode) {
      const monsterParlays = generateMonsterParlays(pool, globalFingerprints, targetDate, strategyName, weightMap, bankroll, stakeConfig ? { exploration_stake: stakeConfig.exploration_stake } : undefined);
      if (monsterParlays.length > 0) {
        allParlays.push(...monsterParlays);
        console.log(`[Bot v2] 🔥 Monster parlays: ${monsterParlays.length} created (${monsterParlays.map((m: any) => '+' + m.expected_odds).join(', ')})`);
      }
    } else {
      console.log(`[Bot v2] 🚦 Monster parlays SKIPPED (light-slate mode)`);
    }

    // === MULTI-LEG ROLE-STACKED TICKET BUILDER (5-leg and 8-leg) ===
    // Replicates the manual curation process: SAFE / BALANCED / GREAT_ODDS roles
    try {
      // Collect all execution-quality player picks with L10 data
      const multiLegCandidates = pool.playerPicks
        .filter(p => {
          if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
          const hr = p.l10_hit_rate || p.confidence_score || 0;
          const hrPct = hr <= 1 ? hr * 100 : hr;
          return hrPct >= 65 && p.has_real_line;
        })
        .map(p => {
          const hr = p.l10_hit_rate || p.confidence_score || 0;
          const hrPct = hr <= 1 ? hr * 100 : hr;
          const odds = p.americanOdds || -110;
          // Assign role based on characteristics
          let role: 'SAFE' | 'BALANCED' | 'GREAT_ODDS' = 'BALANCED';
          if (hrPct >= 80) role = 'SAFE';
          else if (odds >= 120) role = 'GREAT_ODDS';
          else if (hrPct >= 70) role = 'SAFE';
          return { ...p, hrPct, role, odds };
        })
        .sort((a, b) => b.compositeScore - a.compositeScore);

      const safePicks = multiLegCandidates.filter(p => p.role === 'SAFE');
      const balancedPicks = multiLegCandidates.filter(p => p.role === 'BALANCED');
      const greatOddsPicks = multiLegCandidates.filter(p => p.role === 'GREAT_ODDS');

      console.log(`[MultiLeg] Candidates: ${multiLegCandidates.length} total (SAFE=${safePicks.length}, BALANCED=${balancedPicks.length}, GREAT_ODDS=${greatOddsPicks.length})`);

      // Helper to build a multi-leg ticket
      const buildMultiLegTicket = (legCount: number, tierLabel: string): any | null => {
        const usedPlayers = new Set<string>();
        const selectedLegs: any[] = [];
        
        // Role allocation: SAFE first, then BALANCED, then GREAT_ODDS
        const roleTargets = legCount === 5
          ? { SAFE: 2, BALANCED: 2, GREAT_ODDS: 1 }
          : { SAFE: 3, BALANCED: 3, GREAT_ODDS: 2 }; // 8-leg

        for (const [role, target] of Object.entries(roleTargets)) {
          const rolePool = role === 'SAFE' ? safePicks : role === 'BALANCED' ? balancedPicks : greatOddsPicks;
          let added = 0;
          for (const pick of rolePool) {
            if (added >= target) break;
            const pName = (pick.player_name || '').toLowerCase();
            const ppKey = `${pName}|${normalizePropTypeForCorrelation(pick.prop_type || '')}`;
            if (usedPlayers.has(ppKey)) continue;
            // Check combo/base overlap with existing legs
            if (selectedLegs.length > 0) {
              const existingForCorr = selectedLegs.map((l: any) => ({ player_name: l.player_name, prop_type: l.prop_type || '' }));
              if (hasCorrelatedProp(existingForCorr, pick.player_name, pick.prop_type || '')) continue;
            }
            
            // Check global fingerprint
            const fp = `${pName}_${pick.prop_type}_${pick.recommended_side}`;
            // Skip anti-correlation with existing legs
            const antiCorr = hasAntiCorrelation(pick, selectedLegs);
            if (antiCorr.blocked) continue;

            // Ghost leg, volatile, rebound gates
            if (!pick.player_name) { console.log(`[GhostBlock] MultiLeg: skipped leg with no player_name`); continue; }
            const mlNormProp = normalizePropType(pick.prop_type || '');
            if (BLOCKED_PARLAY_PROPS.has(mlNormProp)) { console.log(`[VolatileBlock] MultiLeg: blocked ${pick.player_name} ${pick.prop_type}`); continue; }
            const mlRebCount = selectedLegs.filter((l: any) => normalizePropType(l.prop_type || '') === 'player_rebounds').length;
            if (mlNormProp === 'player_rebounds' && mlRebCount >= MAX_REBOUND_LEGS_PER_PARLAY) { console.log(`[ReboundCap] MultiLeg: blocked ${pick.player_name}`); continue; }

            selectedLegs.push({
              player_name: pick.player_name,
              team_name: pick.team_name,
              prop_type: pick.prop_type,
              line: pick.line,
              side: pick.recommended_side || 'over',
              category: pick.category,
              weight: 1,
              hit_rate: pick.hrPct,
              american_odds: pick.odds,
              composite_score: pick.compositeScore,
              outcome: 'pending',
              leg_role: role,
              sport: pick.sport,
              type: 'player',
            });
            usedPlayers.add(ppKey);
            added++;
          }
        }

        if (selectedLegs.length < legCount) {
          // Fill remaining from any available candidate
          for (const pick of multiLegCandidates) {
            if (selectedLegs.length >= legCount) break;
            const pName = (pick.player_name || '').toLowerCase();
            const ppKey = `${pName}|${normalizePropTypeForCorrelation(pick.prop_type || '')}`;
            if (usedPlayers.has(ppKey)) continue;
            if (selectedLegs.length > 0) {
              const existingForCorr = selectedLegs.map((l: any) => ({ player_name: l.player_name, prop_type: l.prop_type || '' }));
              if (hasCorrelatedProp(existingForCorr, pick.player_name, pick.prop_type || '')) continue;
            }
            const antiCorr = hasAntiCorrelation(pick, selectedLegs);
            if (antiCorr.blocked) continue;
            // Ghost leg, volatile, rebound gates for FILLER
            if (!pick.player_name) { console.log(`[GhostBlock] Filler: skipped leg with no player_name`); continue; }
            const fillNormProp = normalizePropType(pick.prop_type || '');
            if (BLOCKED_PARLAY_PROPS.has(fillNormProp)) { console.log(`[VolatileBlock] Filler: blocked ${pick.player_name} ${pick.prop_type}`); continue; }
            const fillRebCount = selectedLegs.filter((l: any) => normalizePropType(l.prop_type || '') === 'player_rebounds').length;
            if (fillNormProp === 'player_rebounds' && fillRebCount >= MAX_REBOUND_LEGS_PER_PARLAY) { console.log(`[ReboundCap] Filler: blocked ${pick.player_name}`); continue; }

            selectedLegs.push({
              player_name: pick.player_name,
              team_name: pick.team_name,
              prop_type: pick.prop_type,
              line: pick.line,
              side: pick.recommended_side || 'over',
              category: pick.category,
              weight: 1,
              hit_rate: pick.hrPct,
              american_odds: pick.odds,
              composite_score: pick.compositeScore,
              outcome: 'pending',
              leg_role: 'FILLER',
              sport: pick.sport,
              type: 'player',
            });
            usedPlayers.add(ppKey);
          }
        }

        if (selectedLegs.length < legCount) {
          console.log(`[MultiLeg] Not enough picks for ${legCount}-leg ticket (got ${selectedLegs.length})`);
          return null;
        }

        // Calculate combined odds
        const combinedDecimal = selectedLegs.reduce((acc, leg) => {
          const o = leg.american_odds || -110;
          return acc * (o > 0 ? (o / 100) + 1 : (100 / Math.abs(o)) + 1);
        }, 1);
        const combinedAmerican = combinedDecimal >= 2 ? Math.round((combinedDecimal - 1) * 100) : Math.round(-100 / (combinedDecimal - 1));
        const combinedProb = 1 / combinedDecimal;
        const stake = legCount <= 5 ? 100 : 25; // Execution-tier role-stacked = flat $100
        const payout = Math.round(stake * combinedDecimal);

        const fingerprint = selectedLegs.map(l => `${l.player_name}_${l.prop_type}_${l.side}`).sort().join('|');
        if (globalFingerprints.has(fingerprint)) return null;
        globalFingerprints.add(fingerprint);

        const roleBreakdown = selectedLegs.map(l => l.leg_role).join('/');
        console.log(`[MultiLeg] ✅ Built ${legCount}-leg ${tierLabel} ticket: +${combinedAmerican} odds | Roles: ${roleBreakdown} | $${stake} → $${payout}`);

        return {
          parlay_date: targetDate,
          legs: selectedLegs,
          leg_count: selectedLegs.length,
          combined_probability: combinedProb,
          expected_odds: combinedAmerican,
          simulated_win_rate: combinedProb,
          simulated_edge: 0,
          simulated_sharpe: 0,
          strategy_name: `role_stacked_${legCount}leg`,
          selection_rationale: `${tierLabel}: ${legCount}-leg role-stacked (${roleBreakdown}) | +${combinedAmerican}`,
          outcome: 'pending',
          is_simulated: false,
          simulated_stake: stake,
          simulated_payout: payout,
          tier: legCount <= 5 ? 'execution' : 'validation',
          approval_status: 'pending_approval',
        };
      };

      // 5-leg and 8-leg role-stacked tickets REMOVED (0% historical win rate — March 12 analysis)
      // Kept buildMultiLegTicket function for potential future use but no longer called
    } catch (multiLegErr) {
      console.error(`[MultiLeg] Error building multi-leg tickets:`, multiLegErr);
    }

    // === MASTER PARLAY: DISABLED (0-15 record, -$650 P/L) ===
    // Kept for reference — uncomment to re-enable
    // const masterParlayStake = stakeConfig?.bankroll_doubler_stake ?? 500;
    // console.log(`[Bot v2] 🏆 Calling generateMasterParlay — ${pool.playerPicks.length} player picks in pool, stake $${masterParlayStake}`);
    // const masterParlay = await generateMasterParlay(
    //   supabase, pool, targetDate, strategyName, bankroll, globalFingerprints, masterParlayStake
    // );
    // if (masterParlay) {
    //   allParlays.push(masterParlay);
    //   console.log(`[Bot v2] 🏆 MASTER PARLAY: ${masterParlay.leg_count} legs | +${masterParlay.expected_odds} odds | $${masterParlayStake} stake`);
    // }

    // === 2-LEG MINI-PARLAY HYBRID FALLBACK ===
    if (allParlays.length < 6 && !stakeConfig?.block_two_leg_parlays) {
      console.log(`[Bot v2] 🔗 MINI-PARLAY FALLBACK: Only ${allParlays.length} parlays. Attempting 2-leg mini-parlays.`);

      // Build candidate pool (same merge + dedup as singles)
      const miniCandidates: any[] = [
        ...[
          ...pool.teamPicks.map(p => ({ ...p, pickType: 'team' })),
          ...pool.playerPicks.map(p => ({ ...p, pickType: 'player' })),
          ...pool.whalePicks.map(p => ({ ...p, pickType: 'whale' })),
          ...pool.sweetSpots.map(p => ({ ...p, pickType: 'player' })),
        ]
          .filter(p => {
            if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
            // NCAAB mini-parlay: only allow total unders (70.6% hit rate), block spreads/overs
            if (p.sport === 'basketball_ncaab') {
              return (p.bet_type === 'total' || p.prop_type === 'total') && (p.side === 'under' || p.recommended_side === 'under');
            }
            return true;
          })
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

          // Spread cap (light-slate: raised to 25)
          if ((p.bet_type === 'spread' || p.prop_type === 'spread') && Math.abs(p.line || 0) >= effectiveSpreadCap) return false;

          return true;
        })
        .sort((a, b) => {
          const hrA = ((a.confidence_score || a.l10_hit_rate || 0) * 100);
          const hrB = ((b.confidence_score || b.l10_hit_rate || 0) * 100);
          if (hrB !== hrA) return hrB - hrA; // Hit-rate first
          return (b.compositeScore || 0) - (a.compositeScore || 0); // Then composite
        });

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
      const MAX_MINI_PARLAYS = isLightSlateMode ? 10 : 6;

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
      const miniTierCaps = { execution: 0, validation: 3, exploration: 6 }; // mini-parlays NEVER go to execution tier
      const miniTierCounts = { execution: 0, validation: 0, exploration: 0 };
      let totalMiniCreated = 0;

      for (const mp of miniParlays) {
        if (totalMiniCreated >= MAX_MINI_PARLAYS) break;

        // === TEAM CONCENTRATION CAP (mini-parlay path) ===
        const MAX_TEAM_PARLAY_CAP_MINI = isLightSlateMode ? 6 : 4;
        const miniTeamKeys: string[] = [];
        for (const pick of [mp.leg1, mp.leg2]) {
          if (pick.pickType === 'team' || pick.type === 'team') {
            if (pick.home_team) miniTeamKeys.push(pick.home_team.toLowerCase().trim());
            if (pick.away_team) miniTeamKeys.push(pick.away_team.toLowerCase().trim());
          }
        }
        let miniTeamOverused = false;
        for (const tk of miniTeamKeys) {
          if (!globalTeamUsage) globalTeamUsage = new Map();
          if ((globalTeamUsage.get(tk) || 0) >= MAX_TEAM_PARLAY_CAP_MINI) {
            miniTeamOverused = true;
            break;
          }
        }
        if (miniTeamOverused) continue;

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
            sport: pick.sport || deriveSportFromCategory(pick.category),
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

        // Track team usage for cap enforcement
        for (const tk of miniTeamKeys) {
          if (!globalTeamUsage) globalTeamUsage = new Map();
          globalTeamUsage.set(tk, (globalTeamUsage.get(tk) || 0) + 1);
        }

        miniTierCounts[tier]++;
        totalMiniCreated++;
      }

      console.log(`[Bot v2] 🔗 Mini-parlays created: ${totalMiniCreated} (exec=${miniTierCounts.execution}, valid=${miniTierCounts.validation}, explore=${miniTierCounts.exploration})`);
    }

    // Single-pick generation removed — only multi-leg parlays belong in bot_daily_parlays

    // === SWEEP PASS: Force-build parlays from leftover mispriced lines ===
    try {
      // Collect all player+prop combos already used in any parlay (this run + existing)
      const usedPlayerProps = new Set<string>();
      const allExistingLegs = [...allParlays];
      if (existingParlays) {
        for (const p of existingParlays) {
          allExistingLegs.push(p);
        }
      }
      for (const p of allExistingLegs) {
        const legs = Array.isArray(p.legs) ? p.legs : (typeof p.legs === 'string' ? JSON.parse(p.legs) : []);
        for (const leg of legs) {
          if (leg.player_name && leg.prop_type) {
            usedPlayerProps.add(`${leg.player_name.toLowerCase().trim()}|${(leg.prop_type || '').toLowerCase().trim()}`);
          }
        }
      }

      // Filter mispriced lines to unused ones with positive edge
      const unusedMispriced = (rawMispricedLines || []).filter((ml: any) => {
        const key = `${(ml.player_name || '').toLowerCase().trim()}|${(ml.prop_type || '').toLowerCase().trim()}`;
        if (usedPlayerProps.has(key)) return false;
        if ((ml.edge_pct || 0) < 3) return false; // block negative/low edge
        return true;
      });

      // Sort by edge percentage descending (all positive now)
      unusedMispriced.sort((a: any, b: any) => (b.edge_pct || 0) - (a.edge_pct || 0));

      console.log(`[Bot v2] 🧹 SWEEP: ${unusedMispriced.length} unused mispriced lines (of ${(rawMispricedLines || []).length} total)`);

      if (unusedMispriced.length >= 3) {
        const MAX_SWEEP_PARLAYS = 10;
        let sweepCount = 0;
        const usedInSweep = new Set<number>(); // track indices used

        for (let start = 0; start < unusedMispriced.length && sweepCount < MAX_SWEEP_PARLAYS; start++) {
          if (usedInSweep.has(start)) continue;
          const leg1 = unusedMispriced[start];
          const leg1Name = (leg1.player_name || '').toLowerCase().trim();
          const sweepLegs = [leg1];
          const sweepPlayerProps = new Set([`${leg1Name}|${normalizePropTypeForCorrelation(leg1.prop_type || '')}`]);
          const sweepIndices = [start];
          let overCount = (leg1.signal || '').toUpperCase() === 'OVER' ? 1 : 0;
          let underCount = (leg1.signal || '').toUpperCase() === 'UNDER' ? 1 : 0;

          // Find 2 more legs
          for (let j = start + 1; j < unusedMispriced.length && sweepLegs.length < 3; j++) {
            if (usedInSweep.has(j)) continue;
            const candidate = unusedMispriced[j];
            const candName = (candidate.player_name || '').toLowerCase().trim();
            const candPpKey = `${candName}|${normalizePropTypeForCorrelation(candidate.prop_type || '')}`;

            // No same player+prop combo
            if (sweepPlayerProps.has(candPpKey)) continue;
            // Check combo/base overlap for same player
            const sweepExisting = sweepLegs.map((l: any) => ({ player_name: l.player_name || '', prop_type: l.prop_type || '' }));
            if (hasCorrelatedProp(sweepExisting, candidate.player_name || '', candidate.prop_type || '')) continue;

            // Prefer mixing OVER/UNDER for hedge protection
            const candSide = (candidate.signal || '').toUpperCase();
            const wouldBeOver = overCount + (candSide === 'OVER' ? 1 : 0);
            const wouldBeUnder = underCount + (candSide === 'UNDER' ? 1 : 0);
            // Skip if all 3 would be same direction AND we have other candidates
            if (sweepLegs.length === 2 && (wouldBeOver === 3 || wouldBeUnder === 3)) {
              // Only skip if this isn't the last chance
              const remaining = unusedMispriced.slice(j + 1).filter((_: any, idx: number) => !usedInSweep.has(j + 1 + idx));
              if (remaining.length > 0) continue;
            }

            sweepLegs.push(candidate);
            sweepPlayerProps.add(candPpKey);
            sweepIndices.push(j);
            if (candSide === 'OVER') overCount++;
            else underCount++;
          }

          if (sweepLegs.length < 3) continue;

          // Mark indices as used
          for (const idx of sweepIndices) usedInSweep.add(idx);

          // Build parlay legs
          const parlayLegs = sweepLegs.map((ml: any) => ({
            player_name: ml.player_name,
            prop_type: ml.prop_type,
            line: ml.book_line,
            side: (ml.signal || 'OVER').toLowerCase(),
            category: ml.prop_type,
            weight: 1,
            hit_rate: 0,
            american_odds: -110,
            composite_score: Math.abs(ml.edge_pct || 0),
            outcome: 'pending',
            original_line: ml.book_line,
            selected_line: ml.book_line,
            line_selection_reason: 'sweep_mispriced',
            projection_buffer: (ml.player_avg_l10 || 0) - (ml.book_line || 0),
            projected_value: ml.player_avg_l10 || 0,
            line_source: 'mispriced_sweep',
            has_real_line: true,
            sport: ml.sport || 'basketball_nba',
            edge_pct: ml.edge_pct,
            confidence_tier: ml.confidence_tier,
          }));

          // Combined probability estimate (conservative: 45% per leg for sweep)
          const combinedProb = Math.pow(0.45, 3);
          const combinedOdds = Math.round(100 * (1 - combinedProb) / combinedProb);
          const avgEdge = sweepLegs.reduce((s: number, ml: any) => s + Math.abs(ml.edge_pct || 0), 0) / sweepLegs.length;

          allParlays.push({
            parlay_date: targetDate,
            legs: parlayLegs,
            leg_count: 3,
            combined_probability: combinedProb,
            expected_odds: combinedOdds,
            simulated_win_rate: combinedProb,
            simulated_edge: avgEdge / 100,
            simulated_sharpe: 0,
            strategy_name: 'leftover_sweep',
            selection_rationale: `Sweep: ${sweepLegs.map((ml: any) => `${ml.player_name} ${ml.prop_type} ${ml.signal} ${ml.edge_pct > 0 ? '+' : ''}${ml.edge_pct?.toFixed(0)}%`).join(' | ')}`,
            outcome: 'pending',
            is_simulated: true,
            simulated_stake: 50,
            tier: 'sweep',
          });

          sweepCount++;
        }

        console.log(`[Bot v2] 🧹 SWEEP: Created ${sweepCount} sweep parlays from leftover mispriced lines`);
      }
    } catch (sweepErr) {
      console.error(`[Bot v2] Sweep pass error:`, sweepErr);
    }

    console.log(`[Bot v2] Total parlays created: ${allParlays.length}`);

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

    // 6. Tag all parlays with generation source for attribution tracking
    for (const p of allParlays) {
      p.selection_rationale = `${p.selection_rationale || ''} [source:${generationSource}]`.trim();
    }

    // === DAILY PARLAY CAP (25 total) ===
    const DAILY_PARLAY_CAP = 25;
    const { count: currentPendingCount } = await supabase
      .from('bot_daily_parlays')
      .select('*', { count: 'exact', head: true })
      .eq('parlay_date', targetDate)
      .eq('outcome', 'pending');
    
    const existingPendingTotal = currentPendingCount || 0;
    const slotsRemaining = Math.max(0, DAILY_PARLAY_CAP - existingPendingTotal);
    
    if (slotsRemaining === 0) {
      console.log(`[Bot v2] ⛔ Daily cap reached: ${existingPendingTotal} pending parlays already at cap of ${DAILY_PARLAY_CAP}`);
      allParlays = [];
    } else if (allParlays.length > slotsRemaining) {
      // Keep highest combined_probability parlays up to the cap
      allParlays.sort((a: any, b: any) => (b.combined_probability || 0) - (a.combined_probability || 0));
      const trimmed = allParlays.length - slotsRemaining;
      allParlays = allParlays.slice(0, slotsRemaining);
      console.log(`[Bot v2] ✂️ Daily cap trim: kept ${slotsRemaining} of ${slotsRemaining + trimmed} parlays (cap=${DAILY_PARLAY_CAP}, existing=${existingPendingTotal})`);
    }

    // Append new parlays with fingerprint dedup — skip any parlay whose legs already exist today
    console.log(`[Bot v2] Appending ${allParlays.length} new parlays for ${targetDate} (source: ${generationSource})`);

    if (allParlays.length > 0) {
      // Fetch existing leg fingerprints for today to prevent duplicates at source
      const { data: existingParlays } = await supabase
        .from('bot_daily_parlays')
        .select('legs')
        .eq('parlay_date', targetDate)
        .in('outcome', ['pending', 'won', 'lost']);

      const existingFingerprints = new Set<string>();
      if (existingParlays) {
        for (const ep of existingParlays) {
          const legs = Array.isArray(ep.legs) ? ep.legs : [];
          const fp = JSON.stringify(
            legs.map((l: any) => `${(l.player_name || '').toLowerCase()}_${(l.prop_type || '').toLowerCase()}_${(l.side || '').toLowerCase()}`)
              .sort()
          );
          existingFingerprints.add(fp);
        }
      }

      const dedupedParlays = allParlays.filter((p: any) => {
        const legs = Array.isArray(p.legs) ? p.legs : [];
        const fp = JSON.stringify(
          legs.map((l: any) => `${(l.player_name || '').toLowerCase()}_${(l.prop_type || '').toLowerCase()}_${(l.side || '').toLowerCase()}`)
            .sort()
        );
        if (existingFingerprints.has(fp)) return false;
        existingFingerprints.add(fp); // also dedup within this batch
        return true;
      });

      const skippedDupes = allParlays.length - dedupedParlays.length;
      if (skippedDupes > 0) {
        console.log(`[Bot v2] 🧹 Dedup: skipped ${skippedDupes} duplicate parlays at insert time`);
      }

      // === COMPOSITE AVERAGE FILTER: L10/L5/L3/H2H conflict detection ===
      const compositeConflicts: any[] = [];
      try {
        // Collect all unique NBA player names across all deduped parlays
        const NBA_PROP_TYPES_COMPOSITE = ['player_points', 'player_rebounds', 'player_assists', 'player_threes',
          'player_steals', 'player_blocks', 'player_turnovers', 'player_pra', 'player_pts_rebs', 'player_pts_asts',
          'player_rebs_asts', 'points', 'rebounds', 'assists', 'threes', 'steals', 'blocks', 'turnovers', 'pra'];
        
        const allLegs: { leg: any; parlayIndex: number; parlayTier: string; parlayId: string }[] = [];
        for (let pi = 0; pi < dedupedParlays.length; pi++) {
          const p = dedupedParlays[pi];
          const legs = Array.isArray(p.legs) ? p.legs : [];
          for (const leg of legs) {
            const normProp = normalizePropType(leg.prop_type || '');
            if (NBA_PROP_TYPES_COMPOSITE.includes(normProp) || NBA_PROP_TYPES_COMPOSITE.includes((leg.prop_type || '').toLowerCase())) {
              allLegs.push({ leg, parlayIndex: pi, parlayTier: p.tier || p.strategy_name || 'unknown', parlayId: String(pi + 1) });
            }
          }
        }

        if (allLegs.length > 0) {
          const uniquePlayerNames = [...new Set(allLegs.map(l => l.leg.player_name).filter(Boolean))];
          console.log(`[CompositeFilter] Checking ${allLegs.length} NBA legs across ${dedupedParlays.length} parlays for ${uniquePlayerNames.length} players`);

          // Batch-fetch last 10 game logs for all players
          const playerGameLogs = new Map<string, any[]>();
          const batchSize = 50;
          for (let i = 0; i < uniquePlayerNames.length; i += batchSize) {
            const batch = uniquePlayerNames.slice(i, i + batchSize);
            const { data: logs } = await supabase
              .from('nba_player_game_logs')
              .select('player_name, game_date, points, rebounds, assists, steals, blocks, threes_made, turnovers, opponent')
              .in('player_name', batch)
              .order('game_date', { ascending: false })
              .limit(batch.length * 15); // enough for 10 games + H2H lookback
            
            if (logs) {
              for (const log of logs) {
                const name = log.player_name;
                if (!playerGameLogs.has(name)) playerGameLogs.set(name, []);
                playerGameLogs.get(name)!.push(log);
              }
            }
          }

          // Prop type to game log column mapping
          const propToColumn: Record<string, string> = {
            player_points: 'points', points: 'points',
            player_rebounds: 'rebounds', rebounds: 'rebounds',
            player_assists: 'assists', assists: 'assists',
            player_threes: 'threes_made', threes: 'threes_made',
            player_steals: 'steals', steals: 'steals',
            player_blocks: 'blocks', blocks: 'blocks',
            player_turnovers: 'turnovers', turnovers: 'turnovers',
            player_pra: '_pra', pra: '_pra',
          };

          for (const { leg, parlayIndex, parlayTier, parlayId } of allLegs) {
            const playerName = leg.player_name;
            const logs = playerGameLogs.get(playerName);
            if (!logs || logs.length < 3) continue;

            const normProp = normalizePropType(leg.prop_type || '');
            const col = propToColumn[normProp] || propToColumn[(leg.prop_type || '').toLowerCase()];
            if (!col) continue;

            const line = leg.line ?? leg.recommended_line ?? 0;
            if (line <= 0) continue;
            const side = (leg.side || leg.recommended_side || '').toLowerCase();
            if (side !== 'over' && side !== 'under') continue;

            // Extract stat values from logs
            const getVal = (log: any) => {
              if (col === '_pra') return (log.points || 0) + (log.rebounds || 0) + (log.assists || 0);
              return log[col] || 0;
            };

            const l10Games = logs.slice(0, 10);
            const l5Games = logs.slice(0, 5);
            const l3Games = logs.slice(0, 3);

            const avg = (arr: any[]) => arr.length === 0 ? 0 : arr.reduce((s, g) => s + getVal(g), 0) / arr.length;
            const l10Avg = avg(l10Games);
            const l5Avg = avg(l5Games);
            const l3Avg = avg(l3Games);

            // H2H: find games vs today's opponent
            const playerTeam = playerTeamMap.get((playerName || '').toLowerCase().trim());
            const teamCtx = playerTeam ? teamGameContextMap.get(playerTeam) : null;
            const todayOpponent = teamCtx?.opponentAbbrev || '';
            const h2hGames = todayOpponent ? logs.filter((g: any) => 
              (g.opponent || '').toLowerCase().includes(todayOpponent.toLowerCase()) ||
              todayOpponent.toLowerCase().includes((g.opponent || '').toLowerCase())
            ) : [];
            const h2hAvg = avg(h2hGames);
            const h2hCount = h2hGames.length;

            // Weighted composite
            let composite: number;
            if (h2hCount >= 2) {
              composite = (l10Avg * 0.20) + (l5Avg * 0.25) + (l3Avg * 0.30) + (h2hAvg * 0.25);
            } else {
              composite = (l10Avg * 0.25) + (l5Avg * 0.30) + (l3Avg * 0.45);
            }

            // Conflict detection
            const isConflict = (side === 'over' && composite < line) || (side === 'under' && composite > line);
            if (isConflict) {
              const propLabelMap: Record<string, string> = {
                player_points: 'PTS', points: 'PTS', player_rebounds: 'REB', rebounds: 'REB',
                player_assists: 'AST', assists: 'AST', player_threes: '3PT', threes: '3PT',
                player_steals: 'STL', steals: 'STL', player_blocks: 'BLK', blocks: 'BLK',
                player_turnovers: 'TO', turnovers: 'TO', player_pra: 'PRA', pra: 'PRA',
              };
              const propLabel = propLabelMap[normProp] || propLabelMap[(leg.prop_type || '').toLowerCase()] || leg.prop_type;
              compositeConflicts.push({
                player_name: playerName,
                prop_type: propLabel,
                side: side.toUpperCase(),
                line,
                l10_avg: Math.round(l10Avg * 100) / 100,
                l5_avg: Math.round(l5Avg * 100) / 100,
                l3_avg: Math.round(l3Avg * 100) / 100,
                h2h_avg: h2hCount >= 2 ? Math.round(h2hAvg * 100) / 100 : null,
                h2h_games: h2hCount,
                composite: Math.round(composite * 100) / 100,
                parlay_id: parlayId,
                parlay_tier: parlayTier,
                opponent: todayOpponent || 'N/A',
              });
              console.log(`[CompositeFilter] ❌ CONFLICT: ${playerName} ${propLabel} ${side.toUpperCase()} ${line} | L10:${l10Avg.toFixed(1)} L5:${l5Avg.toFixed(1)} L3:${l3Avg.toFixed(1)} H2H:${h2hCount >= 2 ? h2hAvg.toFixed(1) : 'N/A'}(${h2hCount}g) | Composite:${composite.toFixed(1)} vs line ${line}`);
            }
          }
          console.log(`[CompositeFilter] Scan complete: ${compositeConflicts.length} conflicts found across ${allLegs.length} NBA legs`);

          // === v7.0 HARD BLOCK: Remove conflicting legs from parlays (not just demote) ===
          if (compositeConflicts.length > 0) {
            // Build set of conflict keys: parlayIndex_legPlayerName_legPropType
            const conflictKeys = new Set(
              compositeConflicts.map(c => `${parseInt(c.parlay_id, 10) - 1}_${(c.player_name || '').toLowerCase()}_${(c.prop_type || '').toLowerCase()}`)
            );

            let totalLegsDropped = 0;
            let parlaysVoided = 0;
            
            for (let pi = 0; pi < dedupedParlays.length; pi++) {
              const parlay = dedupedParlays[pi];
              const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
              
              // Check if this parlay has any conflicting legs
              const cleanLegs = legs.filter((leg: any) => {
                const normProp = normalizePropType(leg.prop_type || '');
                const propLabelMap: Record<string, string> = {
                  player_points: 'PTS', points: 'PTS', player_rebounds: 'REB', rebounds: 'REB',
                  player_assists: 'AST', assists: 'AST', player_threes: '3PT', threes: '3PT',
                  player_steals: 'STL', steals: 'STL', player_blocks: 'BLK', blocks: 'BLK',
                  player_turnovers: 'TO', turnovers: 'TO', player_pra: 'PRA', pra: 'PRA',
                };
                const propLabel = propLabelMap[normProp] || propLabelMap[(leg.prop_type || '').toLowerCase()] || leg.prop_type;
                const key = `${pi}_${(leg.player_name || '').toLowerCase()}_${(propLabel || '').toLowerCase()}`;
                return !conflictKeys.has(key);
              });
              
              const droppedCount = legs.length - cleanLegs.length;
              if (droppedCount > 0) {
                totalLegsDropped += droppedCount;
                
                if (cleanLegs.length < 2) {
                  // Too few legs remaining — void the parlay
                  parlay.outcome = 'void';
                  parlay.lesson_learned = `composite_hard_block: ${droppedCount} conflicting legs dropped, ${cleanLegs.length} remaining < 2`;
                  parlaysVoided++;
                  console.log(`[CompositeFilter] 🚫 VOIDED parlay #${pi + 1}: ${droppedCount} legs dropped, only ${cleanLegs.length} remain`);
                } else {
                  // Update parlay with clean legs
                  parlay.legs = cleanLegs;
                  parlay.leg_count = cleanLegs.length;
                  parlay.selection_rationale = `⚠️ ${droppedCount} composite-conflicting leg(s) hard-blocked: ${parlay.selection_rationale || ''}`;
                  console.log(`[CompositeFilter] ✂️ Dropped ${droppedCount} conflicting legs from parlay #${pi + 1} (${cleanLegs.length} legs remaining)`);
                }
              }
            }
            
            // Remove voided parlays from the insert batch
            const beforeVoidCount = dedupedParlays.length;
            const activeOnly = dedupedParlays.filter((p: any) => p.outcome !== 'void');
            // Keep voided ones for insert too (to record the void)
            
            console.log(`[CompositeFilter] v7.0 HARD BLOCK: dropped ${totalLegsDropped} conflicting legs, voided ${parlaysVoided} parlays (${activeOnly.length}/${beforeVoidCount} active)`);
          }
        }
      } catch (compErr) {
        console.error('[CompositeFilter] Error during composite check:', compErr);
      }

      if (dedupedParlays.length === 0) {
        console.log(`[Bot v2] All ${allParlays.length} parlays were duplicates — nothing to insert`);
      } else {
        const { error: insertError } = await supabase
          .from('bot_daily_parlays')
          .insert(dedupedParlays);

        if (insertError) throw insertError;
      }

      // Set ALL parlays to pending_approval for admin review
      await supabase
        .from('bot_daily_parlays')
        .update({ approval_status: 'pending_approval' })
        .eq('parlay_date', targetDate);

      // Send approval request to admin via Telegram
      try {
        const { data: allParlaysWithIds } = await supabase
          .from('bot_daily_parlays')
          .select('*')
          .eq('parlay_date', targetDate)
          .eq('approval_status', 'pending_approval')
          .order('created_at', { ascending: false });

        if (allParlaysWithIds && allParlaysWithIds.length > 0) {
          await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`,
            },
             body: JSON.stringify({
               type: 'parlay_approval_request',
               admin_only: adminOnly,
               data: {
                 parlays: allParlaysWithIds,
                 date: targetDate,
               },
             }),
          });
          console.log(`[Bot v2] Sent ${allParlaysWithIds.length} parlays for admin approval`);
        }
      } catch (approvalErr) {
        console.error('[Bot v2] Failed to send approval request:', approvalErr);
      }

      // Send composite conflict report to admin if any conflicts found
      if (compositeConflicts.length > 0) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              type: 'composite_conflict_report',
              admin_only: true,
              data: {
                conflicts: compositeConflicts,
                date: targetDate,
              },
            }),
          });
          console.log(`[CompositeFilter] Sent ${compositeConflicts.length} conflicts to admin Telegram`);
        } catch (compTgErr) {
          console.error('[CompositeFilter] Failed to send Telegram report:', compTgErr);
        }
      }

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

    // 9b. Dump full pick pool to bot_daily_pick_pool for visibility
    try {
      // Collect all player picks that were considered
      const allPoolPicks = [
        ...pool.playerPicks.map((p: any) => ({ ...p, pickType: 'player' })),
        ...pool.sweetSpots.map((p: any) => ({ ...p, pickType: 'sweet_spot' })),
      ];

      // Build set of picks that made it into parlays
      const usedPickKeys = new Set<string>();
      for (const p of allParlays) {
        const legs = Array.isArray(p.legs) ? p.legs : [];
        for (const leg of legs) {
          const key = `${(leg.player_name || '').toLowerCase().trim()}|${(leg.prop_type || '').toLowerCase().trim()}|${(leg.side || 'over').toLowerCase()}`;
          usedPickKeys.add(key);
        }
      }

      // Deduplicate pool picks
      const seenPoolKeys = new Set<string>();
      const poolRows: any[] = [];

      for (const pick of allPoolPicks) {
        const playerName = (pick.player_name || pick.playerName || '').toString();
        const propType = (pick.prop_type || pick.propType || '').toString();
        const side = (pick.side || pick.recommended_side || 'over').toString();
        const key = `${playerName.toLowerCase().trim()}|${propType.toLowerCase().trim()}|${side.toLowerCase()}`;
        
        if (seenPoolKeys.has(key) || !playerName) continue;
        seenPoolKeys.add(key);

        const wasUsed = usedPickKeys.has(key);

        poolRows.push({
          pick_date: targetDate,
          player_name: playerName,
          prop_type: propType,
          recommended_side: side,
          recommended_line: pick.line || pick.actual_line || pick.recommended_line || null,
          l10_hit_rate: pick.l10_hit_rate || pick.hit_rate || null,
          l10_avg: pick.l10_avg || pick.l10_average || null,
          l3_avg: pick.l3_avg || null,
          confidence_score: pick.confidence_score || pick.composite_score || null,
          composite_score: pick.composite_score || null,
          projected_value: pick.projected_value || null,
          rejection_reason: wasUsed ? null : 'not_selected',
          was_used_in_parlay: wasUsed,
          category: pick.category || null,
        });
      }

      if (poolRows.length > 0) {
        // Delete old pool for this date first
        await supabase.from('bot_daily_pick_pool').delete().eq('pick_date', targetDate);

        // Insert in batches
        for (let i = 0; i < poolRows.length; i += 100) {
          const batch = poolRows.slice(i, i + 100);
          await supabase.from('bot_daily_pick_pool').insert(batch);
        }
        console.log(`[Bot v2] 📋 Pick pool logged: ${poolRows.length} picks (${poolRows.filter(r => r.was_used_in_parlay).length} used, ${poolRows.filter(r => !r.was_used_in_parlay).length} bench)`);
      }

      // Send bench picks digest via Telegram (top 10 unused)
      const benchPicks = poolRows
        .filter(r => !r.was_used_in_parlay)
        .sort((a, b) => (b.confidence_score || 0) - (a.confidence_score || 0))
        .slice(0, 10);

      if (benchPicks.length > 0 && !generationSource.startsWith('quality_regen')) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
            body: JSON.stringify({
              type: 'bench_picks_digest',
              admin_only: true,
              data: {
                benchPicks,
                totalPool: poolRows.length,
                usedCount: poolRows.filter(r => r.was_used_in_parlay).length,
                benchCount: poolRows.filter(r => !r.was_used_in_parlay).length,
                date: targetDate,
              },
            }),
          });
        } catch (tgErr) {
          console.error('[Bot v2] Bench picks Telegram failed:', tgErr);
        }
      }
    } catch (poolErr) {
      console.error('[Bot v2] Pick pool logging failed:', poolErr);
    }

    // SKIP during quality regen attempts — the regen loop sends its own summary
    if (!generationSource.startsWith('quality_regen')) {
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
             admin_only: adminOnly,
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
    } else {
      console.log(`[Bot v2] Skipping Telegram notification for ${generationSource} (quality regen suppressed)`);
    }

    // Step 11: Run integrity check — SKIP for pipeline sub-sources that are followed by rebalance
    // (quality_regen, smart_review, review_optimize — these get integrity checked post-rebalance)
    const SKIP_INTEGRITY_SOURCES = ['quality_regen', 'smart_review', 'review_optimize', 'curated_pipeline', 'refresh_rebuild'];
    const shouldSkipIntegrity = SKIP_INTEGRITY_SOURCES.some(prefix => generationSource.startsWith(prefix));
    
    if (!shouldSkipIntegrity) {
      try {
        console.log(`[Bot v2] Running integrity check for standalone source: ${generationSource}`);
        await fetch(`${supabaseUrl}/functions/v1/bot-parlay-integrity-check`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({ date: targetDate }),
        });
      } catch (integrityError) {
        console.error('[Bot v2] Integrity check failed:', integrityError);
      }
    } else {
      console.log(`[Bot v2] Skipping integrity check for ${generationSource} (will run post-rebalance)`);
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
