import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useParlayBuilder } from "@/contexts/ParlayBuilderContext";
import { toast } from "sonner";

// Get today's date in Eastern Time for consistent filtering
function getEasternDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// Normalize player name for fuzzy matching (handles dots, case, extra spaces)
function normalizePlayerName(name: string): string {
  return name.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

export interface SweetSpotPick {
  id: string;
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  confidence_score: number;
  edge: number;
  archetype: string | null;
  category?: string | null;
  team_name?: string;
  event_id?: string;
  game_date?: string;
  injuryStatus?: string | null;
  l10HitRate?: number | null;
}

// v3.0: ARCHETYPE-PROP ALIGNMENT VALIDATION
const ARCHETYPE_PROP_BLOCKED: Record<string, string[]> = {
  'ELITE_REBOUNDER': ['points', 'threes'],
  'GLASS_CLEANER': ['points', 'threes', 'assists'],
  'RIM_PROTECTOR': ['points', 'threes'],
  'PURE_SHOOTER': ['rebounds', 'blocks'],
  'PLAYMAKER': ['rebounds', 'blocks'],
  'COMBO_GUARD': ['rebounds', 'blocks'],
  'SCORING_GUARD': ['rebounds', 'blocks'],
};

// Safe prop normalization helper - handles null/undefined and strips non-alpha chars
const normalizeProp = (p?: string | null): string =>
  (p || '').toLowerCase().replace(/[^a-z]/g, ''); // "Points + Rebounds" -> "pointsrebounds"

function isPickArchetypeAligned(pick: SweetSpotPick): boolean {
  if (!pick.archetype || pick.archetype === 'UNKNOWN') return true;
  
  // Safe prop normalization (prevents crash on null prop_type)
  const propNorm = normalizeProp(pick.prop_type);
  
  // ========== CATEGORY OVERRIDE: BIG_ASSIST_OVER ==========
  // Passing bigs (Vucevic, Sabonis, Jokic) are specifically targeted for BIG_ASSIST_OVER
  // Even if their archetype normally blocks assists, allow it for this category
  if (pick.category === 'BIG_ASSIST_OVER' && propNorm.includes('assist')) {
    console.log(`[SweetSpot] ✅ BIG_ASSIST_OVER override: ${pick.player_name} (${pick.archetype}) allowed for assists`);
    return true;
  }
  
  const blockedProps = ARCHETYPE_PROP_BLOCKED[pick.archetype];
  if (!blockedProps) return true;
  
  for (const blocked of blockedProps) {
    if (propNorm.includes(blocked.replace(/[^a-z]/g, ''))) {
      console.warn(`[SweetSpot] Filtering misaligned: ${pick.player_name} (${pick.archetype}) for ${pick.prop_type}`);
      return false;
    }
  }
  
  return true;
}

export interface H2HData {
  opponent: string;
  gamesPlayed: number;
  avgStat: number;
  hitRate: number;
  maxStat: number;
  minStat: number;
}

// Renamed from GameContext to prevent collision with Scout.tsx's GameContext
export interface ParlayEnvContext {
  vegasTotal: number;
  paceRating: string;  // 'FAST' | 'MEDIUM' | 'SLOW'
  gameScript: string;  // 'SHOOTOUT' | 'GRIND_OUT' | 'COMPETITIVE' | 'BLOWOUT' | 'HARD_BLOWOUT'
  grindFactor: number;
  opponent: string;
}

/**
 * Decision trace for debugging pick selection (v3.2)
 * Captures all factors that influenced a pick's inclusion/exclusion
 */
export interface DecisionTrace {
  playerName: string;
  category: string | null;
  
  // Archetype alignment
  archetypeAligned: boolean;
  archetypeReason?: string;
  
  // Pattern scoring
  patternScore: number;
  patternReasons: string[];
  
  // Defense context
  defenseRank?: number;
  defenseBlocked: boolean;
  
  // L10 context
  l10HitRate?: number;
  l10Missing: boolean;
  
  // Final score breakdown
  scoreBreakdown: {
    pattern: number;
    l10Contribution: number;
    confContribution: number;
    missingL10Penalty: number;
    totalScore: number;
  };
  
  // Outcome
  selected: boolean;
  blockReason?: string;
}

export interface DreamTeamLeg {
  pick: SweetSpotPick;
  team: string;
  score: number;
  h2h?: H2HData;
  gameContext?: ParlayEnvContext;
  opponentDefenseRank?: number;
  patternScore?: number;
}

// ========== WINNING PATTERN RULES v3.1 ==========
// Based on $714+ winning slips: game script + line thresholds + defensive matchups
const WINNING_PATTERN_RULES: Record<string, {
  minLine?: number;
  maxLine?: number;
  preferredPace?: string[];
  maxVegasTotal?: number;
  minVegasTotal?: number;
  preferredGameScript?: string[];
  excludedGameScript?: string[];
  preferredOpponentDefenseRank?: number; // Lower = stronger defense
  statType?: string;
}> = {
  'ELITE_REB_OVER': {
    minLine: 10.5,
    maxLine: 15.5,
    preferredPace: ['SLOW', 'MEDIUM'], // Normalized: was LOW/MEDIUM
    maxVegasTotal: 222, // Grind games = more rebounds
    preferredGameScript: ['COMPETITIVE', 'GRIND_OUT'],
    statType: 'rebounds',
  },
  'ROLE_PLAYER_REB': {
    minLine: 3.5,
    maxLine: 6.5,
    preferredPace: ['SLOW', 'MEDIUM'], // Normalized: was LOW/MEDIUM
    statType: 'rebounds',
  },
  'LOW_SCORER_UNDER': {
    minLine: 4.5,
    maxLine: 10.5,
    preferredOpponentDefenseRank: 12, // vs TOP 12 points defense
    preferredGameScript: ['GRIND_OUT', 'COMPETITIVE'],
    statType: 'points',
  },
  'BIG_ASSIST_OVER': {
    minLine: 2.5,
    maxLine: 5.5,
    excludedGameScript: ['GRIND_OUT'], // Bigs don't pass in slow games
    statType: 'assists',
  },
  'STAR_FLOOR_OVER': {
    minLine: 18.5,
    preferredGameScript: ['SHOOTOUT', 'COMPETITIVE'],
    minVegasTotal: 218, // High-scoring games
    statType: 'points',
  },
  'MID_SCORER_UNDER': {
    minLine: 10.5,
    maxLine: 18.5,
    preferredOpponentDefenseRank: 15, // vs decent defense
    preferredGameScript: ['GRIND_OUT', 'COMPETITIVE'],
    statType: 'points',
  },
  'ASSIST_ANCHOR': {
    maxLine: 6.5,
    preferredGameScript: ['GRIND_OUT'],
    statType: 'assists',
  },
  'HIGH_REB_UNDER': {
    minLine: 8.5,
    preferredPace: ['FAST'], // Normalized: was HIGH
    statType: 'rebounds',
  },
};

interface PatternCheckResult {
  passes: boolean;
  score: number;
  reason: string;
}

// ========== PACE/SCRIPT NORMALIZATION v3.1 ==========
// Handles vocabulary mismatch: Rules use LOW/HIGH, DB uses SLOW/FAST
type Pace = 'FAST' | 'MEDIUM' | 'SLOW';
type Script = 'SHOOTOUT' | 'GRIND_OUT' | 'COMPETITIVE' | 'BLOWOUT' | 'HARD_BLOWOUT';

const normalizePace = (v?: string): Pace => {
  const p = (v || 'MEDIUM').toUpperCase();
  // Handle old rule vocab + any weird inputs
  if (p === 'LOW') return 'SLOW';
  if (p === 'HIGH') return 'FAST';
  if (p === 'SLOW' || p === 'MEDIUM' || p === 'FAST') return p as Pace;
  return 'MEDIUM';
};

const normalizeScript = (v?: string): Script => {
  const s = (v || 'COMPETITIVE').toUpperCase();
  if (s === 'HARD_BLOWOUT') return 'HARD_BLOWOUT';
  if (s === 'BLOWOUT') return 'BLOWOUT';
  if (s === 'GRIND_OUT') return 'GRIND_OUT';
  if (s === 'SHOOTOUT') return 'SHOOTOUT';
  return 'COMPETITIVE';
};

// Helper: Convert full team name to abbreviation for defensive lookups
function teamNameToAbbrev(teamName: string): string {
  if (!teamName) return '';
  const abbrevMap: Record<string, string> = {
    'atlanta hawks': 'atl', 'boston celtics': 'bos', 'brooklyn nets': 'bkn', 'charlotte hornets': 'cha',
    'chicago bulls': 'chi', 'cleveland cavaliers': 'cle', 'dallas mavericks': 'dal', 'denver nuggets': 'den',
    'detroit pistons': 'det', 'golden state warriors': 'gsw', 'houston rockets': 'hou', 'indiana pacers': 'ind',
    'los angeles clippers': 'lac', 'la clippers': 'lac', 'los angeles lakers': 'lal', 'la lakers': 'lal',
    'memphis grizzlies': 'mem', 'miami heat': 'mia', 'milwaukee bucks': 'mil', 'minnesota timberwolves': 'min',
    'new orleans pelicans': 'nop', 'new york knicks': 'nyk', 'oklahoma city thunder': 'okc', 'orlando magic': 'orl',
    'philadelphia 76ers': 'phi', 'phoenix suns': 'phx', 'portland trail blazers': 'por', 'sacramento kings': 'sac',
    'san antonio spurs': 'sas', 'toronto raptors': 'tor', 'utah jazz': 'uta', 'washington wizards': 'was',
  };
  const lower = teamName.toLowerCase();
  // Direct match first
  if (abbrevMap[lower]) return abbrevMap[lower];
  // Partial match
  for (const [name, abbrev] of Object.entries(abbrevMap)) {
    if (lower.includes(name) || name.includes(lower)) return abbrev;
  }
  return teamName.slice(0, 3).toLowerCase();
}

// ========== PRODUCTION-GRADE PATTERN MATCHER v3.1 ==========
// Handles: pace normalization, excluded script blocks, grindFactor bonuses, clean reason strings
function matchesWinningPattern(
  pick: SweetSpotPick,
  gameContext: ParlayEnvContext | undefined,
  opponentDefenseRank: number | undefined
): PatternCheckResult {
  const rules = WINNING_PATTERN_RULES[pick.category || ''];
  if (!rules) return { passes: true, score: 0, reason: 'No specific rules' };

  let score = 0;
  const reasons: string[] = [];
  const failures: string[] = [];

  const side = (pick.side || '').toLowerCase();
  const isUnder = side === 'under';

  // --------------------------
  // 1) LINE THRESHOLDS (HARD BLOCK)
  // --------------------------
  if (rules.minLine != null && pick.line < rules.minLine) {
    return { passes: false, score: 0, reason: `Line ${pick.line} < min ${rules.minLine}` };
  }
  if (rules.maxLine != null && pick.line > rules.maxLine) {
    return { passes: false, score: 0, reason: `Line ${pick.line} > max ${rules.maxLine}` };
  }
  score += 2;
  reasons.push('Line ✓');

  // ------------------------------------------
  // 2) CONTEXT: allow missing with penalty
  // ------------------------------------------
  const needsContext =
    !!(rules.preferredGameScript?.length ||
       rules.excludedGameScript?.length ||
       rules.preferredPace?.length ||
       rules.maxVegasTotal != null ||
       rules.minVegasTotal != null);

  if (!gameContext && needsContext) {
    score -= 2;
    reasons.push('No context (-2)');
    return { passes: true, score, reason: reasons.join(' | ') };
  }

  // --------------------------
  // 3) GAME CONTEXT SCORING
  // --------------------------
  if (gameContext) {
    const script = normalizeScript(gameContext.gameScript);
    const pace = normalizePace(gameContext.paceRating);
    const total = Number(gameContext.vegasTotal);

    // (A) Excluded scripts = HARD BLOCK
    if (rules.excludedGameScript?.length) {
      const excluded = rules.excludedGameScript.map(s => normalizeScript(s));
      if (excluded.includes(script)) {
        failures.push(`Script ${script} excluded`);
        return { passes: false, score: 0, reason: failures.join(', ') };
      }
    }

    // (B) Preferred script = strong bonus, else light penalty
    if (rules.preferredGameScript?.length) {
      const preferred = rules.preferredGameScript.map(s => normalizeScript(s));
      if (preferred.includes(script)) {
        score += 3;
        reasons.push(`${script} ✓`);
      } else {
        score -= 1;
        reasons.push(`${script} ✗`);
      }
    }

    // (C) Pace (normalized SLOW/MEDIUM/FAST)
    if (rules.preferredPace?.length) {
      const preferred = rules.preferredPace.map(p => normalizePace(p));
      if (preferred.includes(pace)) {
        score += 2;
        reasons.push(`Pace ${pace} ✓`);
      } else {
        score -= 1;
        reasons.push(`Pace ${pace} ✗`);
      }
    }

    // (D) Vegas total checks
    if (rules.maxVegasTotal != null) {
      if (total <= rules.maxVegasTotal) {
        score += 2;
        reasons.push(`Total ${total} ≤ ${rules.maxVegasTotal} ✓`);
      } else {
        score -= 2;
        reasons.push(`Total ${total} > ${rules.maxVegasTotal} ✗`);
      }
    }

    if (rules.minVegasTotal != null) {
      if (total >= rules.minVegasTotal) {
        score += 2;
        reasons.push(`Total ${total} ≥ ${rules.minVegasTotal} ✓`);
      } else {
        score -= 1;
        reasons.push(`Total ${total} < ${rules.minVegasTotal} ✗`);
      }
    }

    // (E) GrindFactor tie-in (small, safe)
    if (typeof gameContext.grindFactor === 'number') {
      if (isUnder && gameContext.grindFactor >= 0.65) {
        score += 1;
        reasons.push('Grind ↑ (UNDER) ✓');
      }
      if (!isUnder && gameContext.grindFactor >= 0.75 && rules.statType === 'points') {
        score -= 1;
        reasons.push('Grind ↑ (PTS OVER) ✗');
      }
    }
  }

  // ----------------------------------------------------
  // 4) DEFENSE: required + hard blocks for UNDERS
  // ----------------------------------------------------
  if (rules.preferredOpponentDefenseRank != null) {
    if (!opponentDefenseRank) {
      if (isUnder) {
        return { passes: false, score: 0, reason: 'UNDER requires defense rank verification' };
      }
      score -= 1;
      reasons.push('No DEF rank (-1)');
      return { passes: true, score, reason: reasons.join(' | ') };
    }

    if (opponentDefenseRank <= rules.preferredOpponentDefenseRank) {
      score += 4;
      reasons.push(`vs #${opponentDefenseRank} DEF ✓`);
    } else {
      if (isUnder) {
        return {
          passes: false,
          score: 0,
          reason: `UNDER vs weak DEF #${opponentDefenseRank} (need top ${rules.preferredOpponentDefenseRank})`
        };
      }
      score -= 2;
      reasons.push(`vs #${opponentDefenseRank} DEF (weak)`);
    }
  }

  return { passes: true, score, reason: reasons.join(' | ') || 'Base criteria met' };
}

// OPTIMAL WINNERS FORMULA v3.0 - Based on user's winning bet slip patterns
// Mirrors $714+ winning parlays: Elite Rebounders + Role Player Props + Unders
// Historical Win Rates from actual winning slips:
// - Elite Reb OVER (Gobert/Nurkic): ~65% win rate
// - Role Player Reb OVER (Finney-Smith/George): ~60% win rate
// - Big Assists OVER (Vucevic): ~70% win rate
// - Low Scorer UNDER (Dort/Sheppard): ~65% win rate
// - Mid Scorer UNDER: 64% win rate
// - Star Floor OVER (Ja Morant): ~75% win rate
const PROVEN_FORMULA = [
  { category: 'ELITE_REB_OVER', side: 'over', count: 1 },      // Gobert/Nurkic type
  { category: 'ROLE_PLAYER_REB', side: 'over', count: 1 },     // Finney-Smith type
  { category: 'BIG_ASSIST_OVER', side: 'over', count: 1 },     // Vucevic type
  { category: 'LOW_SCORER_UNDER', side: 'under', count: 1 },   // Dort/Sheppard type
  { category: 'MID_SCORER_UNDER', side: 'under', count: 1 },   // Nesmith type
  { category: 'STAR_FLOOR_OVER', side: 'over', count: 1 },     // Ja Morant type
];

/**
 * Normalize confidence score to 0-100 scale (v3.2)
 * Handles both 0-1 and 0-100 input formats from different data sources
 */
const normalizeConf = (c?: number): number => {
  if (c == null) return 70;         // default 70/100
  if (c <= 1) return c * 100;       // treat as 0–1 → scale to 0–100
  return c;                         // already 0–100
};

/**
 * Unified pick scoring function (v3.2)
 * Ensures deterministic, stable selection across sorting and final leg assignment
 * Weights: Pattern score (1x) + L10 hit rate (6x) + Confidence (0.04x scaled to 0-100)
 * FIX v3.2: Normalize confidence + penalize missing L10 data
 */
const scorePick = (p: {
  _patternScore?: number;
  l10HitRate?: number | null;
  confidence_score?: number;
}): number => {
  const pat = p._patternScore ?? 0;
  const l10 = p.l10HitRate ?? 0.6;  // More conservative default (was 0.7)
  const conf = normalizeConf(p.confidence_score);
  
  // Penalize picks with missing L10 data (unknowns shouldn't beat real data)
  const missingL10Penalty = (p.l10HitRate == null) ? -0.5 : 0;
  
  // Pattern is main driver, L10 is strong signal, confidence is tiebreaker
  return (pat * 1.0) + (l10 * 6.0) + (conf * 0.04) + missingL10Penalty;
};

// Dream Team constraints
const MAX_PLAYERS_PER_TEAM = 1;
const TARGET_LEG_COUNT = 6;

interface SlateStatus {
  currentDate: string;
  displayedDate: string;
  isNextSlate: boolean;
}

type H2HMapType = Map<string, {
  opponent: string;
  gamesPlayed: number;
  avgStat: number;
  hitRateOver: number;
  hitRateUnder: number;
  maxStat: number;
  minStat: number;
}>;

type GameContextMapType = Map<string, ParlayEnvContext>;
type DefenseMapType = Map<string, number>;

interface QueryResult {
  picks: SweetSpotPick[];
  h2hMap: H2HMapType;
  gameContextMap: GameContextMapType;
  defenseMap: DefenseMapType;
  slateStatus: SlateStatus;
}

export function useSweetSpotParlayBuilder() {
  const { addLeg, clearParlay } = useParlayBuilder();

  // Fetch all sweet spot picks with team data - cross-reference with active props, injuries, and matchup intelligence
  const { data: queryResult, isLoading, refetch } = useQuery({
    queryKey: ['sweet-spot-parlay-picks'],
    queryFn: async (): Promise<QueryResult> => {
      const today = getEasternDate();
      const now = new Date().toISOString();
      
      // ========== DIAGNOSTIC TRACKING ==========
      const diagnostics = {
        timestamp: new Date().toISOString(),
        targetDate: '',
        totalCandidates: { category: 0, riskEngine: 0 },
        filters: {
          archetypeBlocked: { count: 0, players: [] as string[] },
          matchupBlocked: { count: 0, players: [] as string[] },
          outPlayers: { count: 0, players: [] as string[] },
          sideConflicts: { count: 0, players: [] as string[] },
          notInActiveSlate: { count: 0, players: [] as string[] },
        },
        passedValidation: { category: 0, riskEngine: 0 },
      };
      
      console.group('🎯 [Optimal Parlay Diagnostics]');
      console.log(`📅 Query started at: ${diagnostics.timestamp}`);
      
      // First get active props (future games only) to filter out stale picks
      const { data: activeProps } = await supabase
        .from('unified_props')
        .select('player_name, commence_time')
        .gte('commence_time', now);
      
      // Check if today has any remaining active games
      const todayActiveProps = (activeProps || []).filter(p => {
        const propDate = new Date(p.commence_time).toLocaleDateString('en-CA', { 
          timeZone: 'America/New_York' 
        });
        return propDate === today;
      });

      // Determine target date - today or next available slate
      let targetDate = today;
      let targetPlayers = new Set(
        todayActiveProps.map(p => p.player_name?.toLowerCase()).filter(Boolean)
      );
      let isNextSlate = false;

      if (todayActiveProps.length === 0 && activeProps && activeProps.length > 0) {
        // Find the earliest future date with props
        const futureProps = (activeProps || [])
          .map(p => ({
            ...p,
            gameDate: new Date(p.commence_time).toLocaleDateString('en-CA', { 
              timeZone: 'America/New_York' 
            })
          }))
          .sort((a, b) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime());

        if (futureProps.length > 0) {
          targetDate = futureProps[0].gameDate;
          targetPlayers = new Set(
            futureProps
              .filter(p => p.gameDate === targetDate)
              .map(p => p.player_name?.toLowerCase())
              .filter(Boolean)
          );
          isNextSlate = true;
          console.log(`⏭️ Today's slate complete. Switching to next slate: ${targetDate}`);
        }
      }

      diagnostics.targetDate = targetDate;
      console.log(`📆 Target date: ${targetDate}`);
      console.log(`👥 Active players in slate: ${targetPlayers.size}`);

      // Fetch injury reports for target date
      const { data: injuryReports } = await supabase
        .from('nba_injury_reports')
        .select('player_name, status, injury_type')
        .eq('game_date', targetDate);
      
      // ========== GAME ENVIRONMENT FETCH (Vegas lines, pace, script) ==========
      const { data: gameEnvironments } = await supabase
        .from('game_environment')
        .select('home_team_abbrev, away_team_abbrev, vegas_total, pace_rating, game_script, grind_factor')
        .eq('game_date', targetDate);
      
      // Create team -> game context map (uses ParlayEnvContext)
      const gameContextMap = new Map<string, ParlayEnvContext>();
      (gameEnvironments || []).forEach(g => {
        const context: ParlayEnvContext = {
          vegasTotal: Number(g.vegas_total) || 220,
          paceRating: g.pace_rating || 'MEDIUM',
          gameScript: g.game_script || 'COMPETITIVE',
          grindFactor: Number(g.grind_factor) || 0.5,
          opponent: '',
        };
        // Map both teams to their context, with opponent info
        if (g.home_team_abbrev) {
          gameContextMap.set(g.home_team_abbrev.toLowerCase(), { ...context, opponent: g.away_team_abbrev || '' });
        }
        if (g.away_team_abbrev) {
          gameContextMap.set(g.away_team_abbrev.toLowerCase(), { ...context, opponent: g.home_team_abbrev || '' });
        }
      });
      
      console.log(`🎮 Game environments loaded: ${gameContextMap.size} teams`);
      if (gameEnvironments && gameEnvironments.length > 0) {
        console.table(gameEnvironments.map(g => ({
          matchup: `${g.away_team_abbrev} @ ${g.home_team_abbrev}`,
          total: g.vegas_total,
          pace: g.pace_rating,
          script: g.game_script,
        })));
      }
      
      // ========== DEFENSIVE RATINGS FETCH ==========
      const { data: defenseRatings } = await supabase
        .from('team_defensive_ratings')
        .select('team_name, stat_type, defensive_rank, stat_allowed_per_game');
      
      // FIX: Create opponent defense map using ABBREVIATIONS as keys (not full team names)
      // This fixes the mismatch where lookups used "min_points" but map had "minnesota timberwolves_points"
      const defenseMap = new Map<string, number>();
      (defenseRatings || []).forEach(d => {
        // Store by abbreviation (e.g., "min_points" instead of "minnesota timberwolves_points")
        const abbrevKey = `${teamNameToAbbrev(d.team_name || '')}_${d.stat_type?.toLowerCase()}`;
        defenseMap.set(abbrevKey, d.defensive_rank ?? 15);
        
        // Also store by full name for compatibility
        const fullKey = `${d.team_name?.toLowerCase()}_${d.stat_type?.toLowerCase()}`;
        defenseMap.set(fullKey, d.defensive_rank ?? 15);
      });
      
      console.log(`🛡️ Defense ratings loaded: ${defenseMap.size} entries (keyed by abbrev + full name)`);
      
      // ========== H2H HISTORY FETCH ==========
      const { data: matchupHistoryData } = await supabase
        .from('matchup_history')
        .select('player_name, opponent, prop_type, games_played, avg_stat, hit_rate_over, hit_rate_under, max_stat, min_stat');
      
      // Create H2H lookup map: player_opponent_prop -> H2H stats
      const h2hMap = new Map<string, {
        opponent: string;
        gamesPlayed: number;
        avgStat: number;
        hitRateOver: number;
        hitRateUnder: number;
        maxStat: number;
        minStat: number;
      }>();
      
      (matchupHistoryData || []).forEach(h => {
        const key = `${h.player_name?.toLowerCase()}_${h.opponent?.toLowerCase()}_${h.prop_type?.toLowerCase()}`;
        h2hMap.set(key, {
          opponent: h.opponent || '',
          gamesPlayed: h.games_played || 0,
          avgStat: Number(h.avg_stat) || 0,
          hitRateOver: Number(h.hit_rate_over) || 0,
          hitRateUnder: Number(h.hit_rate_under) || 0,
          maxStat: Number(h.max_stat) || 0,
          minStat: Number(h.min_stat) || 0,
        });
      });
      
      console.log(`📊 H2H records loaded: ${h2hMap.size}`);

      // Create sets for different injury statuses
      const outPlayers = new Set(
        (injuryReports || [])
          .filter(r => r.status?.toLowerCase().includes('out'))
          .map(r => r.player_name?.toLowerCase())
          .filter(Boolean)
      );

      const questionablePlayers = new Map<string, string>(
        (injuryReports || [])
          .filter(r => !r.status?.toLowerCase().includes('out'))
          .map(r => [r.player_name?.toLowerCase() || '', r.status || ''])
      );

      console.log(`🏥 Injuries: ${outPlayers.size} OUT, ${questionablePlayers.size} questionable/GTD`);

      // NEW: Fetch blocked picks from matchup intelligence (head-to-head logic)
      const { data: blockedPicks } = await supabase
        .from('matchup_intelligence')
        .select('player_name, prop_type, side, line, block_reason')
        .eq('game_date', targetDate)
        .eq('is_blocked', true);

      const blockedSet = new Set(
        (blockedPicks || []).map(p => 
          `${p.player_name?.toLowerCase()}_${p.prop_type?.toLowerCase()}_${p.side?.toLowerCase()}`
        )
      );
      
      // Log blocked picks details
      console.log(`🚫 Matchup Intelligence Blocks: ${blockedSet.size}`);
      if (blockedPicks && blockedPicks.length > 0) {
        console.table(blockedPicks.map(p => ({
          player: p.player_name,
          prop: p.prop_type,
          side: p.side,
          reason: p.block_reason
        })));
      }

      // NEW v3.1: Fetch Game Environment Validation results (Vegas-math pre-filter)
      const { data: envValidations } = await supabase
        .from('game_environment_validation')
        .select('player_name, prop_type, side, line, validation_status, rejection_reason, confidence_adjustment')
        .eq('game_date', targetDate);

      const validationMap = new Map<string, { status: string; reason: string; adjustment: number }>(
        (envValidations || []).map(v => [
          `${v.player_name?.toLowerCase()}_${v.prop_type?.toLowerCase()}_${v.side?.toLowerCase()}`,
          { 
            status: v.validation_status || 'PENDING', 
            reason: v.rejection_reason || '',
            adjustment: v.confidence_adjustment || 0
          }
        ])
      );
      
      // Log validation summary
      const validationCounts = { approved: 0, conditional: 0, rejected: 0 };
      envValidations?.forEach(v => {
        if (v.validation_status === 'APPROVED') validationCounts.approved++;
        else if (v.validation_status === 'CONDITIONAL') validationCounts.conditional++;
        else if (v.validation_status === 'REJECTED') validationCounts.rejected++;
      });
      console.log(`🎯 Game Environment Validation: ${validationCounts.approved} 🟢 | ${validationCounts.conditional} 🟡 | ${validationCounts.rejected} 🔴`);

      // Get player team data from cache
      const { data: playerCache } = await supabase
        .from('bdl_player_cache')
        .select('player_name, team_name');

      const teamMap = new Map<string, string>();
      playerCache?.forEach(p => {
        if (p.player_name && p.team_name) {
          teamMap.set(p.player_name.toLowerCase(), p.team_name);
        }
      });

      // Calculate date range (today or yesterday in case of late analysis)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

      // PRIORITY 1: Get OPTIMAL WINNERS from category_sweet_spots (v3.0 categories)
      const { data: categoryPicks, error: categoryError } = await supabase
        .from('category_sweet_spots')
        .select('*')
        .gte('analysis_date', yesterdayStr)
        .lte('analysis_date', targetDate)
        .in('category', [
          // v3.0 Optimal winners (user's winning patterns)
          'ELITE_REB_OVER', 'ROLE_PLAYER_REB', 'BIG_ASSIST_OVER', 
          'LOW_SCORER_UNDER', 'STAR_FLOOR_OVER',
          // v2.0 Proven winners (still valid)
          'ASSIST_ANCHOR', 'HIGH_REB_UNDER', 'MID_SCORER_UNDER'
        ])
        .or('is_active.eq.true,l10_hit_rate.gte.0.55')
        .not('actual_line', 'is', null)
        .order('l10_hit_rate', { ascending: false });

      if (categoryError) {
        console.error('Error fetching category sweet spots:', categoryError);
      }

      // Build category recommendations map for side enforcement
      const categoryRecommendations = new Map<string, { side: string; l10HitRate: number }>();
      (categoryPicks || []).forEach(pick => {
        const key = `${pick.player_name?.toLowerCase()}_${pick.prop_type?.toLowerCase()}`;
        if (pick.recommended_side) {
          categoryRecommendations.set(key, {
            side: pick.recommended_side.toLowerCase(),
            l10HitRate: pick.l10_hit_rate || 0
          });
        }
      });

      // Filter category picks with ALL validation rules
      const validCategoryPicks = (categoryPicks || []).filter(pick => {
        const playerKey = pick.player_name?.toLowerCase();
        if (!playerKey) return false;
        
        // FIX: Use fuzzy matching for player names (handles "P.J." vs "PJ", etc.)
        const normalizedKey = normalizePlayerName(pick.player_name || '');
        const hasExactMatch = targetPlayers.has(playerKey);
        const hasFuzzyMatch = [...targetPlayers].some(p => normalizePlayerName(p) === normalizedKey);
        
        if (!hasExactMatch && !hasFuzzyMatch) {
          return false;
        }
        if (outPlayers.has(playerKey)) {
          console.log(`[SweetSpotParlay] Excluding OUT player from categories: ${pick.player_name}`);
          return false;
        }
        
        // v3.0: Apply archetype alignment check
        if (!isPickArchetypeAligned({
          id: pick.id,
          player_name: pick.player_name || '',
          prop_type: pick.prop_type || '',
          line: pick.actual_line || 0,
          side: pick.recommended_side || 'over',
          confidence_score: pick.confidence_score || 0,
          edge: 0,
          archetype: pick.archetype,
        })) {
          console.log(`[SweetSpotParlay] Blocking archetype-misaligned category: ${pick.player_name} (${pick.archetype}) for ${pick.prop_type}`);
          return false;
        }
        
        // Check matchup intelligence blocking
        const blockKey = `${playerKey}_${pick.prop_type?.toLowerCase()}_${pick.recommended_side?.toLowerCase()}`;
        if (blockedSet.has(blockKey)) {
          console.log(`[SweetSpotParlay] Blocking matchup-blocked category: ${pick.player_name} ${pick.prop_type} ${pick.recommended_side}`);
          return false;
        }
        
        return true;
      });

      console.log(`[SweetSpotParlay] Proven category picks: ${validCategoryPicks.length} (from ${categoryPicks?.length || 0})`);

      // PRIORITY 2: Get risk engine picks as fallback
      const { data: riskPicks, error: riskError } = await supabase
        .from('nba_risk_engine_picks')
        .select('*')
        .eq('is_sweet_spot', true)
        .eq('game_date', targetDate)
        .order('confidence_score', { ascending: false });

      if (riskError) {
        console.error('Error fetching risk engine sweet spots:', riskError);
      }

      // Filter risk picks with ALL validation rules
      const validRiskPicks = (riskPicks || []).filter(pick => {
        const playerKey = pick.player_name?.toLowerCase();
        if (!playerKey) return false;
        
        // FIX: Use fuzzy matching for player names (handles "P.J." vs "PJ", etc.)
        const normalizedKey = normalizePlayerName(pick.player_name || '');
        const hasExactMatch = targetPlayers.has(playerKey);
        const hasFuzzyMatch = [...targetPlayers].some(p => normalizePlayerName(p) === normalizedKey);
        
        if (!hasExactMatch && !hasFuzzyMatch) {
          return false;
        }
        if (outPlayers.has(playerKey)) {
          console.log(`[SweetSpotParlay] Excluding OUT player from risk engine: ${pick.player_name}`);
          return false;
        }
        
        // v3.0: Apply archetype alignment check
        if (!isPickArchetypeAligned({
          id: pick.id,
          player_name: pick.player_name || '',
          prop_type: pick.prop_type || '',
          line: pick.line || 0,
          side: pick.side || 'over',
          confidence_score: pick.confidence_score || 0,
          edge: pick.edge || 0,
          archetype: pick.archetype,
        })) {
          console.log(`[SweetSpotParlay] Blocking archetype-misaligned risk: ${pick.player_name} (${pick.archetype}) for ${pick.prop_type}`);
          return false;
        }
        
        // Check matchup intelligence blocking
        const blockKey = `${playerKey}_${pick.prop_type?.toLowerCase()}_${pick.side?.toLowerCase()}`;
        if (blockedSet.has(blockKey)) {
          console.log(`[SweetSpotParlay] Blocking matchup-blocked risk: ${pick.player_name} ${pick.prop_type} ${pick.side}`);
          return false;
        }
        
        // Check if category has a DIFFERENT side recommendation - skip if conflict
        const catKey = `${playerKey}_${pick.prop_type?.toLowerCase()}`;
        const categoryRec = categoryRecommendations.get(catKey);
        if (categoryRec && categoryRec.side !== pick.side?.toLowerCase()) {
          console.log(`[SweetSpotParlay] Skipping risk pick - category recommends ${categoryRec.side}, risk says ${pick.side}: ${pick.player_name}`);
          return false;
        }
        
        return true;
      });

      console.log(`[SweetSpotParlay] Risk engine picks: ${validRiskPicks.length} (filtered from ${riskPicks?.length || 0})`);

      // Combine picks with category picks taking priority
      const allPicks: SweetSpotPick[] = [];
      const seenPlayers = new Set<string>();

      // Add category picks first (proven formulas) - ALWAYS use recommended_side
      validCategoryPicks.forEach(pick => {
        const playerKey = pick.player_name?.toLowerCase();
        if (playerKey && !seenPlayers.has(playerKey)) {
          seenPlayers.add(playerKey);
          const injuryStatus = questionablePlayers.get(playerKey) || null;
          
          allPicks.push({
            id: pick.id,
            player_name: pick.player_name || '',
            prop_type: pick.prop_type || '',
            line: pick.actual_line || pick.recommended_line || 0,
            side: pick.recommended_side || 'over', // ENFORCE category recommendation
            confidence_score: pick.confidence_score || 0.8,
            edge: (pick.l10_hit_rate || 0.7) * 10 - 5,
            archetype: pick.archetype,
            category: pick.category,
            team_name: teamMap.get(playerKey) || 'Unknown',
            game_date: pick.analysis_date,
            injuryStatus,
            l10HitRate: pick.l10_hit_rate,
          });
        }
      });

      // Add risk engine picks that aren't duplicates and don't conflict with categories
      validRiskPicks.forEach(pick => {
        const playerKey = pick.player_name?.toLowerCase();
        if (playerKey && !seenPlayers.has(playerKey)) {
          seenPlayers.add(playerKey);
          const injuryStatus = questionablePlayers.get(playerKey) || null;
          
          allPicks.push({
            id: pick.id,
            player_name: pick.player_name || '',
            prop_type: pick.prop_type || '',
            line: pick.line || 0,
            side: pick.side || 'over',
            confidence_score: pick.confidence_score || 0,
            edge: pick.edge || 0,
            archetype: pick.archetype,
            category: null,
            team_name: teamMap.get(playerKey) || pick.team_name || 'Unknown',
            event_id: pick.event_id,
            game_date: pick.game_date,
            injuryStatus,
          });
        }
      });

      // v3.1: Apply Game Environment Validation filter
      const validatedPicks = allPicks.filter(pick => {
        const key = `${pick.player_name?.toLowerCase()}_${pick.prop_type?.toLowerCase()}_${pick.side?.toLowerCase()}`;
        const validation = validationMap.get(key);
        
        if (!validation) return true; // No validation = allow (new/pending picks)
        
        // Block REJECTED picks
        if (validation.status === 'REJECTED') {
          console.log(`[GameEnvValidator] ❌ REJECTED: ${pick.player_name} ${pick.prop_type} ${pick.side} - ${validation.reason}`);
          diagnostics.filters.archetypeBlocked.count++; // Reusing counter for env blocking
          return false;
        }
        
        // Allow CONDITIONAL only if L10 hit rate >= 70% (strong override signal)
        if (validation.status === 'CONDITIONAL') {
          if ((pick.l10HitRate || 0) >= 0.7) {
            console.log(`[GameEnvValidator] 🟡 CONDITIONAL (allowed): ${pick.player_name} - high L10 hit rate (${((pick.l10HitRate || 0) * 100).toFixed(0)}%) overrides`);
            // Apply confidence adjustment from validation
            pick.confidence_score = Math.max(0, Math.min(1, pick.confidence_score + (validation.adjustment / 100)));
            return true;
          }
          console.log(`[GameEnvValidator] 🟡 CONDITIONAL (blocked): ${pick.player_name} - ${validation.reason}`);
          return false;
        }
        
        // APPROVED - apply any positive confidence adjustment
        if (validation.adjustment > 0) {
          pick.confidence_score = Math.min(1, pick.confidence_score + (validation.adjustment / 100));
        }
        
        return true; // APPROVED
      });

      console.log(`[SweetSpotParlay] After Game Environment Validation: ${validatedPicks.length}/${allPicks.length} picks passed`);
      console.groupEnd();

      return {
        picks: validatedPicks,
        h2hMap,
        gameContextMap,
        defenseMap,
        slateStatus: {
          currentDate: today,
          displayedDate: targetDate,
          isNextSlate,
        }
      };
    },
    staleTime: 60000,
  });

  const sweetSpotPicks = queryResult?.picks;
  const h2hMap = queryResult?.h2hMap || new Map();
  const gameContextMap = queryResult?.gameContextMap || new Map();
  const defenseMap = queryResult?.defenseMap || new Map();
  const slateStatus = queryResult?.slateStatus || { currentDate: getEasternDate(), displayedDate: getEasternDate(), isNextSlate: false };

  // Build optimal 6-leg parlay prioritizing proven category formulas
  const buildOptimalParlay = (): DreamTeamLeg[] => {
    console.group('🏆 [Optimal Parlay Builder v3.1 - Pattern Enforced]');
    
    if (!sweetSpotPicks || sweetSpotPicks.length === 0) {
      console.log('❌ No sweet spot picks available');
      console.groupEnd();
      return [];
    }

    console.log(`📊 Total candidates: ${sweetSpotPicks.length}`);
    
    // Helper: Get team abbreviation from team name
    const getTeamAbbrev = (teamName: string | undefined): string => {
      if (!teamName) return '';
      // FIX: Use full team names to avoid substring conflicts (e.g., "nets" matching "hornets")
      const abbrevMap: Record<string, string> = {
        // Full names first (most specific matches)
        'charlotte hornets': 'CHA', 'brooklyn nets': 'BKN',
        'atlanta hawks': 'ATL', 'boston celtics': 'BOS', 'chicago bulls': 'CHI',
        'cleveland cavaliers': 'CLE', 'dallas mavericks': 'DAL', 'denver nuggets': 'DEN',
        'detroit pistons': 'DET', 'golden state warriors': 'GSW', 'houston rockets': 'HOU',
        'indiana pacers': 'IND', 'los angeles clippers': 'LAC', 'la clippers': 'LAC',
        'los angeles lakers': 'LAL', 'la lakers': 'LAL', 'memphis grizzlies': 'MEM',
        'miami heat': 'MIA', 'milwaukee bucks': 'MIL', 'minnesota timberwolves': 'MIN',
        'new orleans pelicans': 'NOP', 'new york knicks': 'NYK', 'oklahoma city thunder': 'OKC',
        'orlando magic': 'ORL', 'philadelphia 76ers': 'PHI', 'phoenix suns': 'PHX',
        'portland trail blazers': 'POR', 'sacramento kings': 'SAC', 'san antonio spurs': 'SAS',
        'toronto raptors': 'TOR', 'utah jazz': 'UTA', 'washington wizards': 'WAS',
        // Short names (less specific - checked after full names)
        'hornets': 'CHA', 'nets': 'BKN', 'hawks': 'ATL', 'celtics': 'BOS', 'bulls': 'CHI',
        'cavaliers': 'CLE', 'mavericks': 'DAL', 'nuggets': 'DEN', 'pistons': 'DET',
        'warriors': 'GSW', 'rockets': 'HOU', 'pacers': 'IND', 'clippers': 'LAC',
        'lakers': 'LAL', 'grizzlies': 'MEM', 'heat': 'MIA', 'bucks': 'MIL',
        'timberwolves': 'MIN', 'pelicans': 'NOP', 'knicks': 'NYK', 'thunder': 'OKC',
        'magic': 'ORL', '76ers': 'PHI', 'suns': 'PHX', 'trail blazers': 'POR', 'blazers': 'POR',
        'kings': 'SAC', 'spurs': 'SAS', 'raptors': 'TOR', 'jazz': 'UTA', 'wizards': 'WAS',
      };
      const lower = teamName.toLowerCase();
      
      // First, try exact match on full names (most reliable)
      if (abbrevMap[lower]) return abbrevMap[lower];
      
      // Then try substring matching, prioritizing longer matches first
      const sortedEntries = Object.entries(abbrevMap).sort((a, b) => b[0].length - a[0].length);
      for (const [name, abbrev] of sortedEntries) {
        if (lower.includes(name)) return abbrev;
      }
      return teamName.slice(0, 3).toUpperCase();
    };
    
    // Track archetype blocks for diagnostics
    const archetypeBlocked: string[] = [];

    // v3.0: Final archetype alignment filter (defense in depth)
    const alignedPicks = sweetSpotPicks.filter(pick => {
      const aligned = isPickArchetypeAligned(pick);
      if (!aligned) {
        archetypeBlocked.push(`${pick.player_name} (${pick.archetype}) → ${pick.prop_type}`);
      }
      return aligned;
    });
    
    if (archetypeBlocked.length > 0) {
      console.log(`🚫 Archetype Blocked (${archetypeBlocked.length}):`);
      archetypeBlocked.forEach(b => console.log(`   ❌ ${b}`));
    }
    
    console.log(`✅ Aligned picks: ${alignedPicks.length}/${sweetSpotPicks.length}`);
    
    // ========== H2H VALIDATION ==========
    // Helper to find H2H data for a pick
    const getH2HForPick = (pick: SweetSpotPick): H2HData | undefined => {
      const playerKey = pick.player_name?.toLowerCase() || '';
      const propKey = pick.prop_type?.toLowerCase() || '';
      
      for (const [key, data] of h2hMap.entries()) {
        if (key.startsWith(`${playerKey}_`) && key.endsWith(`_${propKey}`)) {
          const isOver = pick.side?.toLowerCase() === 'over';
          return {
            opponent: data.opponent,
            gamesPlayed: data.gamesPlayed,
            avgStat: data.avgStat,
            hitRate: isOver ? data.hitRateOver : data.hitRateUnder,
            maxStat: data.maxStat,
            minStat: data.minStat,
          };
        }
      }
      return undefined;
    };
    
    // Helper: Get game context for a pick (with diagnostic logging)
    const getGameContextForPick = (pick: SweetSpotPick): ParlayEnvContext | undefined => {
      const teamAbbrev = getTeamAbbrev(pick.team_name);
      const context = gameContextMap.get(teamAbbrev.toLowerCase());
      
      // Debug logging for chain verification
      if (!context && pick.category) {
        console.log(`[Debug Chain] ${pick.player_name}: Team "${pick.team_name}" → Abbrev "${teamAbbrev}" → Context: MISSING`);
        console.log(`[Debug Chain] Available teams in gameContextMap: ${Array.from(gameContextMap.keys()).join(', ')}`);
      }
      
      return context;
    };
    
    // Helper: Get opponent defense rank for a pick (with diagnostic logging)
    // FIX v3.2: Bulletproof multi-key lookup with teamNameToAbbrev fallback
    const getOpponentDefenseRank = (pick: SweetSpotPick): number | undefined => {
      const ctx = getGameContextForPick(pick);
      if (!ctx?.opponent) {
        if (pick.category) {
          console.log(`[Debug DEF] ${pick.player_name}: No game context or opponent`);
        }
        return undefined;
      }

      // FIX v3.2: Use rules.statType as source of truth with whitelist validation
      const rules = WINNING_PATTERN_RULES[pick.category || ''];
      const allowedStatTypes = new Set(['points', 'rebounds', 'assists']);
      let statType = (rules?.statType || '').toLowerCase();

      // FIX v3.2: Whitelist statType to prevent bad keys like "min_pts"
      if (!allowedStatTypes.has(statType)) {
        const propNorm = normalizeProp(pick.prop_type);
        statType = propNorm.includes('rebound') ? 'rebounds'
          : propNorm.includes('assist') ? 'assists'
          : 'points';
      }

      const oppRaw = (ctx.opponent || '').trim();
      const oppLower = oppRaw.toLowerCase();

      // 1) Try as-is abbrev (expected fast path - opponent is usually abbrev)
      const key1 = `${oppLower}_${statType}`;
      const r1 = defenseMap.get(key1);
      if (r1 != null) {
        if (pick.category) {
          console.log(`[Debug DEF] ${pick.player_name}: vs ${oppRaw} → #${r1} ${statType} DEF (key: ${key1})`);
        }
        return r1;
      }

      // 2) Try normalize via teamNameToAbbrev (handles full names, "MIN", etc.)
      const oppAbbrev = teamNameToAbbrev(oppRaw).toLowerCase();
      if (oppAbbrev && oppAbbrev !== oppLower) {
        const key2 = `${oppAbbrev}_${statType}`;
        const r2 = defenseMap.get(key2);
        if (r2 != null) {
          if (pick.category) {
            console.log(`[Debug DEF] ${pick.player_name}: vs ${oppRaw} → #${r2} ${statType} DEF (key: ${key2}, normalized)`);
          }
          return r2;
        }
      }

      // 3) Debug log for miss (only when categorized)
      if (pick.category) {
        const triedKeys = oppAbbrev && oppAbbrev !== oppLower 
          ? `[${key1}], [${oppAbbrev}_${statType}]`
          : `[${key1}]`;
        console.log(`[Debug DEF] MISS ${pick.player_name}: opp="${oppRaw}" stat=${statType} tried ${triedKeys}`);
      }

      return undefined;
    };
    
    // H2H validation filter
    const h2hBlocked: string[] = [];
    const h2hValidatedPicks = alignedPicks.filter(pick => {
      const h2h = getH2HForPick(pick);
      
      if (!h2h || h2h.gamesPlayed < 2) return true;
      
      const isOver = pick.side?.toLowerCase() === 'over';
      
      if (h2h.hitRate < 0.40 && h2h.gamesPlayed >= 3) {
        h2hBlocked.push(`${pick.player_name} - ${(h2h.hitRate * 100).toFixed(0)}% ${pick.side} vs ${h2h.opponent} (${h2h.gamesPlayed}g)`);
        return false;
      }
      
      if (isOver && h2h.avgStat < pick.line * 0.75 && h2h.gamesPlayed >= 3) {
        h2hBlocked.push(`${pick.player_name} OVER - H2H avg ${h2h.avgStat.toFixed(1)} vs line ${pick.line}`);
        return false;
      }
      
      if (!isOver && h2h.avgStat > pick.line * 1.25 && h2h.gamesPlayed >= 3) {
        h2hBlocked.push(`${pick.player_name} UNDER - H2H avg ${h2h.avgStat.toFixed(1)} vs line ${pick.line}`);
        return false;
      }
      
      return true;
    });
    
    if (h2hBlocked.length > 0) {
      console.log(`📊 [H2H] Blocked (${h2hBlocked.length}):`);
      h2hBlocked.forEach(b => console.log(`   ❌ ${b}`));
    }
    console.log(`✅ H2H validated: ${h2hValidatedPicks.length}/${alignedPicks.length}`);

    // ========== PATTERN VALIDATION ==========
    console.log(`\n🎯 [Pattern Validation v3.1]`);
    const patternBlocked: string[] = [];
    const patternValidatedPicks = h2hValidatedPicks.filter(pick => {
      const gameContext = getGameContextForPick(pick);
      const opponentDefenseRank = getOpponentDefenseRank(pick);
      
      const patternCheck = matchesWinningPattern(pick, gameContext, opponentDefenseRank);
      
      if (!patternCheck.passes) {
        patternBlocked.push(`${pick.player_name} ${pick.category}: ${patternCheck.reason}`);
        return false;
      }
      
      return true;
    });
    
    if (patternBlocked.length > 0) {
      console.log(`📋 [Pattern] Blocked (${patternBlocked.length}):`);
      patternBlocked.forEach(b => console.log(`   ❌ ${b}`));
    }
    console.log(`✅ Pattern validated: ${patternValidatedPicks.length}/${h2hValidatedPicks.length}`);

    // ========== DETAILED CATEGORY CANDIDATE LOGGING ==========
    console.log('\n🔍 [CATEGORY CANDIDATES - Pre-Selection Analysis]');
    const archetypeOverridesApplied: string[] = [];
    
    for (const formula of PROVEN_FORMULA) {
      const candidates = patternValidatedPicks.filter(p => 
        p.category === formula.category && 
        p.side.toLowerCase() === formula.side
      );
      console.log(`\n📂 ${formula.category} (${formula.side.toUpperCase()}) - ${candidates.length} candidates:`);
      candidates.slice(0, 8).forEach((c, i) => {
        const gameCtx = getGameContextForPick(c);
        const defRank = getOpponentDefenseRank(c);
        const defInfo = defRank ? `#${defRank} DEF` : 'No DEF';
        const scriptInfo = gameCtx ? gameCtx.gameScript : 'No Script';
        console.log(`   ${i + 1}. ${c.player_name} | Line: ${c.line} | L10: ${c.l10HitRate ? Math.round(c.l10HitRate * 100) + '%' : 'N/A'} | Team: ${c.team_name || 'Unknown'} | ${scriptInfo} | vs ${defInfo}`);
        
        // Track archetype overrides for BIG_ASSIST_OVER
        if (c.category === 'BIG_ASSIST_OVER' && c.prop_type?.toLowerCase().includes('assist')) {
          archetypeOverridesApplied.push(`${c.player_name} (${c.archetype || 'UNKNOWN'})`);
        }
      });
      if (candidates.length > 8) {
        console.log(`   ... and ${candidates.length - 8} more`);
      }
      if (candidates.length === 0) {
        console.log(`   ⚠️ No candidates available for this category`);
      }
    }
    
    // Log archetype overrides summary
    if (archetypeOverridesApplied.length > 0) {
      console.log(`\n✅ [Archetype Overrides for BIG_ASSIST_OVER]: ${[...new Set(archetypeOverridesApplied)].join(', ')}`);
    }

    // ========== DEFENSE VALIDATION SUMMARY ==========
    console.log(`\n🛡️ [DEFENSE VALIDATION SUMMARY - UNDER Picks]`);
    const underCategories = ['LOW_SCORER_UNDER', 'MID_SCORER_UNDER', 'HIGH_REB_UNDER'];
    patternValidatedPicks
      .filter(p => underCategories.includes(p.category || ''))
      .forEach(p => {
        const defRank = getOpponentDefenseRank(p);
        const rules = WINNING_PATTERN_RULES[p.category || ''];
        const requiredRank = rules?.preferredOpponentDefenseRank || 'N/A';
        const status = defRank && typeof requiredRank === 'number' && defRank <= requiredRank ? '✅ PASS' : '❌ FAIL';
        console.log(`   ${status} ${p.player_name} (${p.category}) vs #${defRank || 'N/A'} DEF (need top ${requiredRank})`);
      });

    const selectedLegs: DreamTeamLeg[] = [];
    const usedTeams = new Set<string>();
    const usedPlayers = new Set<string>();

    // Step 1: Fill from proven categories first (with pattern scoring)
    console.log('\n🏆 [CATEGORY SELECTION LOOP]');
    for (const formula of PROVEN_FORMULA) {
      console.log(`\n--- Processing ${formula.category} (${formula.side.toUpperCase()}) ---`);
      
      const categoryPicks = patternValidatedPicks
        .filter(p => 
          p.category === formula.category && 
          p.side.toLowerCase() === formula.side &&
          !usedPlayers.has(p.player_name.toLowerCase()) &&
          !usedTeams.has((p.team_name || '').toLowerCase())
        )
        .map(p => {
          // Calculate pattern score for sorting
          const gameContext = getGameContextForPick(p);
          const opponentDefenseRank = getOpponentDefenseRank(p);
          const patternCheck = matchesWinningPattern(p, gameContext, opponentDefenseRank);
          return { ...p, _patternScore: patternCheck.score, _gameContext: gameContext, _opponentDefenseRank: opponentDefenseRank };
        })
        // Sort by unified scorePick function for deterministic selection
        .sort((a, b) => {
          return scorePick(b) - scorePick(a);
        });

      // Log scoring breakdown for top candidates (v3.2: shows full score decomposition)
      if (categoryPicks.length > 0) {
        console.log(`   📊 Ranking ${categoryPicks.length} candidates (after team/player dedup):`);
        categoryPicks.slice(0, 5).forEach((p, i) => {
          const pat = p._patternScore ?? 0;
          const l10 = p.l10HitRate ?? 0.6;
          const conf = normalizeConf(p.confidence_score);
          const penalty = p.l10HitRate == null ? -0.5 : 0;
          const total = scorePick({ _patternScore: p._patternScore, l10HitRate: p.l10HitRate, confidence_score: p.confidence_score });
          console.log(`      ${i + 1}. ${p.player_name} | Pat: ${pat} | L10: ${p.l10HitRate ? Math.round(p.l10HitRate * 100) + '%' : 'MISS'} (${(l10 * 6).toFixed(1)}) | Conf: ${conf.toFixed(0)} (${(conf * 0.04).toFixed(2)}) | Penalty: ${penalty} | Total: ${total.toFixed(2)}`);
        });
      } else {
        console.log(`   ⚠️ No available candidates (all filtered by team/player dedup)`);
      }

      let added = 0;
      for (const pick of categoryPicks) {
        // Detailed skip reason logging
        if (added >= formula.count) {
          console.log(`   ⏭️ ${pick.player_name}: SKIPPED - Category slot filled (${added}/${formula.count})`);
          continue;
        }
        if (selectedLegs.length >= TARGET_LEG_COUNT) {
          console.log(`   ⏭️ ${pick.player_name}: SKIPPED - Parlay full (${selectedLegs.length} legs)`);
          break;
        }

        const team = (pick.team_name || 'Unknown').toLowerCase();
        
        // These checks are redundant after pre-filter, but log for clarity
        if (usedTeams.has(team)) {
          console.log(`   ⏭️ ${pick.player_name}: SKIPPED - Team "${team}" already used`);
          continue;
        }
        if (usedPlayers.has(pick.player_name.toLowerCase())) {
          console.log(`   ⏭️ ${pick.player_name}: SKIPPED - Player already selected`);
          continue;
        }

        const h2h = getH2HForPick(pick);
        const gameContext = pick._gameContext;
        const opponentDefenseRank = pick._opponentDefenseRank;
        
        const h2hInfo = h2h && h2h.gamesPlayed >= 2 
          ? `| H2H: ${(h2h.hitRate * 100).toFixed(0)}% (${h2h.gamesPlayed}g)`
          : '';
        const contextInfo = gameContext 
          ? `| ${gameContext.gameScript} | Total: ${gameContext.vegasTotal}`
          : '';
        const defInfo = opponentDefenseRank 
          ? `| vs #${opponentDefenseRank} DEF`
          : '';
        
        console.log(`   ✅ SELECTED: ${pick.player_name} ${pick.prop_type} ${pick.side.toUpperCase()} ${pick.line} | L10: ${pick.l10HitRate ? Math.round(pick.l10HitRate * 100) + '%' : 'N/A'} ${h2hInfo} ${contextInfo} ${defInfo}`);
        
        selectedLegs.push({
          pick,
          team: pick.team_name || 'Unknown',
          score: scorePick({ _patternScore: pick._patternScore, l10HitRate: pick.l10HitRate, confidence_score: pick.confidence_score }),
          h2h,
          gameContext,
          opponentDefenseRank,
          patternScore: pick._patternScore,
        });
        usedTeams.add(team);
        usedPlayers.add(pick.player_name.toLowerCase());
        added++;
      }

      console.log(`   📌 ${formula.category}: Added ${added}/${formula.count}`);
    }

    // Step 2: Fill remaining slots from pattern-validated picks if needed
    if (selectedLegs.length < TARGET_LEG_COUNT) {
      console.log(`[Optimal] Need ${TARGET_LEG_COUNT - selectedLegs.length} more legs, checking remaining picks...`);
      
      const remainingPicks = patternValidatedPicks
        .filter(p => 
          !usedPlayers.has(p.player_name.toLowerCase()) &&
          !usedTeams.has((p.team_name || '').toLowerCase())
        )
        .map(p => {
          const gameContext = getGameContextForPick(p);
          const opponentDefenseRank = getOpponentDefenseRank(p);
          const patternCheck = matchesWinningPattern(p, gameContext, opponentDefenseRank);
          return { ...p, _patternScore: patternCheck.score, _gameContext: gameContext, _opponentDefenseRank: opponentDefenseRank };
        })
        .sort((a, b) => {
          return scorePick(b) - scorePick(a);
        });

      for (const pick of remainingPicks) {
        if (selectedLegs.length >= TARGET_LEG_COUNT) break;

        const team = (pick.team_name || 'Unknown').toLowerCase();
        const h2h = getH2HForPick(pick);
        const gameContext = pick._gameContext;
        const opponentDefenseRank = pick._opponentDefenseRank;
        
        console.log(`[Optimal] ➕ FALLBACK: ${pick.player_name} ${pick.prop_type} ${pick.side.toUpperCase()} ${pick.line}`);
        
        selectedLegs.push({
          pick,
          team: pick.team_name || 'Unknown',
          score: scorePick({ _patternScore: pick._patternScore, l10HitRate: pick.l10HitRate, confidence_score: pick.confidence_score }),
          h2h,
          gameContext,
          opponentDefenseRank,
          patternScore: pick._patternScore,
        });
        usedTeams.add(team);
        usedPlayers.add(pick.player_name.toLowerCase());
      }
    }

    // ========== FINAL DIAGNOSTIC SUMMARY ==========
    console.log(`\n📋 FINAL SELECTION (${selectedLegs.length}/${TARGET_LEG_COUNT} legs):`);
    console.table(selectedLegs.map((leg, i) => ({
      '#': i + 1,
      player: leg.pick.player_name,
      prop: `${leg.pick.prop_type} ${leg.pick.side.toUpperCase()} ${leg.pick.line}`,
      category: leg.pick.category || 'Risk Engine',
      archetype: leg.pick.archetype || 'UNKNOWN',
      L10: leg.pick.l10HitRate ? `${Math.round(leg.pick.l10HitRate * 100)}%` : 'N/A',
      team: leg.team,
      score: leg.score.toFixed(2)
    })));
    
    // Enhanced selection trace with full context
    console.log('\n📋 SELECTION TRACE (Full Context):');
    selectedLegs.forEach((leg, i) => {
      const whySelected = [
        leg.pick.category ? `Category: ${leg.pick.category}` : 'Fallback',
        `PatternScore: ${leg.patternScore || 0}`,
        leg.h2h ? `H2H: ${(leg.h2h.hitRate * 100).toFixed(0)}%` : 'No H2H',
        leg.gameContext ? `Script: ${leg.gameContext.gameScript}` : 'No Context',
        leg.opponentDefenseRank ? `vs #${leg.opponentDefenseRank} DEF` : 'No DEF',
      ].join(' | ');
      console.log(`   ${i + 1}. ${leg.pick.player_name} → ${whySelected}`);
    });
    
    const categoryCount = selectedLegs.filter(l => l.pick.category).length;
    const riskEngineCount = selectedLegs.length - categoryCount;
    console.log(`\n📈 Sources: ${categoryCount} Category picks, ${riskEngineCount} Risk Engine picks`);
    
    // ========== TOP-LEVEL BUILD SUMMARY ==========
    console.log(`\n========== 🏆 OPTIMAL PARLAY BUILD SUMMARY ==========`);
    console.log(`📅 Target Date: ${slateStatus.displayedDate}`);
    console.log(`🎯 Final Parlay Legs: ${selectedLegs.length}/${TARGET_LEG_COUNT}`);
    if (selectedLegs.length > 0) {
      console.table(selectedLegs.map((leg, i) => ({
        '#': i + 1,
        Player: leg.pick.player_name,
        Category: leg.pick.category || 'Fallback',
        Prop: `${leg.pick.side.toUpperCase()} ${leg.pick.line} ${leg.pick.prop_type}`,
        L10: leg.pick.l10HitRate ? `${(leg.pick.l10HitRate * 100).toFixed(0)}%` : 'N/A',
        H2H: leg.h2h ? `${(leg.h2h.hitRate * 100).toFixed(0)}%` : '-',
        DEF: leg.opponentDefenseRank ? `#${leg.opponentDefenseRank}` : '-',
      })));
    } else {
      console.warn('⚠️ No picks passed validation. Check filters above.');
    }
    console.log(`=====================================================\n`);
    console.groupEnd();

    return selectedLegs;
  };

  // Add optimal parlay to builder
  const addOptimalParlayToBuilder = () => {
    const optimalLegs = buildOptimalParlay();
    
    if (optimalLegs.length === 0) {
      toast.error('No sweet spot picks available to build parlay');
      return;
    }

    clearParlay();

    optimalLegs.forEach(leg => {
      const description = `${leg.pick.player_name} ${leg.pick.prop_type} ${leg.pick.side.toUpperCase()} ${leg.pick.line}`;
      
      addLeg({
        source: 'sharp',
        description,
        odds: -110,
        playerName: leg.pick.player_name,
        propType: leg.pick.prop_type,
        line: leg.pick.line,
        side: leg.pick.side as 'over' | 'under',
        confidenceScore: leg.pick.confidence_score,
      });
    });

    toast.success(`Added ${optimalLegs.length}-leg Sweet Spot Dream Team parlay!`);
  };

  const optimalParlay = sweetSpotPicks ? buildOptimalParlay() : [];

  // Calculate combined stats
  const combinedStats = {
    avgConfidence: optimalParlay.length > 0 
      ? optimalParlay.reduce((sum, l) => sum + l.pick.confidence_score, 0) / optimalParlay.length 
      : 0,
    avgEdge: optimalParlay.length > 0 
      ? optimalParlay.reduce((sum, l) => sum + l.pick.edge, 0) / optimalParlay.length 
      : 0,
    avgL10HitRate: optimalParlay.length > 0
      ? optimalParlay.reduce((sum, l) => sum + (l.pick.l10HitRate || 0), 0) / optimalParlay.length
      : 0,
    uniqueTeams: new Set(optimalParlay.map(l => l.team)).size,
    propTypes: [...new Set(optimalParlay.map(l => l.pick.prop_type))],
    legCount: optimalParlay.length,
    categories: [...new Set(optimalParlay.map(l => l.pick.category).filter(Boolean))],
  };

  return {
    sweetSpotPicks,
    optimalParlay,
    combinedStats,
    isLoading,
    refetch,
    addOptimalParlayToBuilder,
    buildOptimalParlay,
    slateStatus,
  };
}
