import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useParlayBuilder } from "@/contexts/ParlayBuilderContext";
import { toast } from "sonner";

// Get today's date in Eastern Time for consistent filtering
function getEasternDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
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

function isPickArchetypeAligned(pick: SweetSpotPick): boolean {
  if (!pick.archetype || pick.archetype === 'UNKNOWN') return true;
  
  const blockedProps = ARCHETYPE_PROP_BLOCKED[pick.archetype];
  if (!blockedProps) return true;
  
  const propLower = pick.prop_type.toLowerCase();
  for (const blocked of blockedProps) {
    if (propLower.includes(blocked)) {
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

export interface GameContext {
  vegasTotal: number;
  paceRating: string;
  gameScript: string;
  grindFactor: number;
  opponent: string;
}

export interface DreamTeamLeg {
  pick: SweetSpotPick;
  team: string;
  score: number;
  h2h?: H2HData;
  gameContext?: GameContext;
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
    preferredPace: ['LOW', 'MEDIUM'],
    maxVegasTotal: 222, // Grind games = more rebounds
    preferredGameScript: ['COMPETITIVE', 'GRIND_OUT'],
    statType: 'rebounds',
  },
  'ROLE_PLAYER_REB': {
    minLine: 3.5,
    maxLine: 6.5,
    preferredPace: ['LOW', 'MEDIUM'],
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
    preferredPace: ['HIGH'], // High pace = fewer rebounds
    statType: 'rebounds',
  },
};

interface PatternCheckResult {
  passes: boolean;
  score: number;
  reason: string;
}

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

function matchesWinningPattern(
  pick: SweetSpotPick,
  gameContext: GameContext | undefined,
  opponentDefenseRank: number | undefined
): PatternCheckResult {
  const rules = WINNING_PATTERN_RULES[pick.category || ''];
  if (!rules) return { passes: true, score: 0, reason: 'No specific rules' };

  let score = 0;
  const reasons: string[] = [];
  const failures: string[] = [];

  // Line threshold check (CRITICAL)
  if (rules.minLine && pick.line < rules.minLine) {
    failures.push(`Line ${pick.line} < min ${rules.minLine}`);
    return { passes: false, score: 0, reason: failures.join(', ') };
  }
  if (rules.maxLine && pick.line > rules.maxLine) {
    failures.push(`Line ${pick.line} > max ${rules.maxLine}`);
    return { passes: false, score: 0, reason: failures.join(', ') };
  }
  score += 2; // Passed line check
  reasons.push(`Line ✓`);

  // FIX: If no game context available but rules require it, allow with penalty (don't block)
  if (!gameContext && (rules.preferredGameScript || rules.preferredPace || rules.maxVegasTotal || rules.minVegasTotal)) {
    console.log(`[Pattern] ⚠️ No game context for ${pick.player_name} (${pick.category}) - allowing with penalty`);
    score -= 2; // Penalty for missing context
    reasons.push(`No context (penalized)`);
    return { passes: true, score, reason: reasons.join(' | ') };
  }

  // Game script check
  if (gameContext) {
    if (rules.preferredGameScript) {
      if (rules.preferredGameScript.includes(gameContext.gameScript)) {
        score += 3;
        reasons.push(`${gameContext.gameScript} ✓`);
      } else {
        score -= 1; // Non-ideal but not blocked
      }
    }
    if (rules.excludedGameScript) {
      if (rules.excludedGameScript.includes(gameContext.gameScript)) {
        failures.push(`Script ${gameContext.gameScript} excluded`);
        return { passes: false, score: 0, reason: failures.join(', ') };
      }
    }

    // Vegas total check
    if (rules.maxVegasTotal && gameContext.vegasTotal > rules.maxVegasTotal) {
      score -= 2; // Penalize high-scoring games for rebound overs
    } else if (rules.maxVegasTotal && gameContext.vegasTotal <= rules.maxVegasTotal) {
      score += 2;
      reasons.push(`Total ${gameContext.vegasTotal} ✓`);
    }
    
    if (rules.minVegasTotal && gameContext.vegasTotal >= rules.minVegasTotal) {
      score += 2;
      reasons.push(`High total ✓`);
    } else if (rules.minVegasTotal && gameContext.vegasTotal < rules.minVegasTotal) {
      score -= 1;
    }

    // Pace check
    if (rules.preferredPace && rules.preferredPace.includes(gameContext.paceRating)) {
      score += 2;
      reasons.push(`${gameContext.paceRating} pace ✓`);
    }
  }

  // FIX: If no opponent defense rank but rules require it, allow with penalty
  if (rules.preferredOpponentDefenseRank && !opponentDefenseRank) {
    console.log(`[Pattern] ⚠️ No defense rank for ${pick.player_name} opponent - allowing with penalty`);
    score -= 1;
    reasons.push(`No DEF rank (penalized)`);
    return { passes: true, score, reason: reasons.join(' | ') };
  }

  // Defensive matchup check (CRITICAL for UNDERS)
  if (rules.preferredOpponentDefenseRank && opponentDefenseRank) {
    if (opponentDefenseRank <= rules.preferredOpponentDefenseRank) {
      score += 4; // Big bonus for favorable defense matchup
      reasons.push(`vs #${opponentDefenseRank} DEF ✓`);
    } else {
      // For UNDER picks, weak defense is bad
      if (pick.side?.toLowerCase() === 'under') {
        score -= 2;
      }
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

type GameContextMapType = Map<string, GameContext>;
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
      
      // Create team -> game context map
      const gameContextMap = new Map<string, GameContext>();
      (gameEnvironments || []).forEach(g => {
        const context: GameContext = {
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
        defenseMap.set(abbrevKey, d.defensive_rank || 15);
        
        // Also store by full name for compatibility
        const fullKey = `${d.team_name?.toLowerCase()}_${d.stat_type?.toLowerCase()}`;
        defenseMap.set(fullKey, d.defensive_rank || 15);
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
        if (!targetPlayers.has(playerKey)) return false;
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
        if (!targetPlayers.has(playerKey)) return false;
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
      const abbrevMap: Record<string, string> = {
        'hawks': 'ATL', 'celtics': 'BOS', 'nets': 'BKN', 'hornets': 'CHA',
        'bulls': 'CHI', 'cavaliers': 'CLE', 'mavericks': 'DAL', 'nuggets': 'DEN',
        'pistons': 'DET', 'warriors': 'GSW', 'rockets': 'HOU', 'pacers': 'IND',
        'clippers': 'LAC', 'lakers': 'LAL', 'grizzlies': 'MEM', 'heat': 'MIA',
        'bucks': 'MIL', 'timberwolves': 'MIN', 'pelicans': 'NOP', 'knicks': 'NYK',
        'thunder': 'OKC', 'magic': 'ORL', '76ers': 'PHI', 'suns': 'PHX',
        'trail blazers': 'POR', 'blazers': 'POR', 'kings': 'SAC', 'spurs': 'SAS',
        'raptors': 'TOR', 'jazz': 'UTA', 'wizards': 'WAS',
      };
      const lower = teamName.toLowerCase();
      for (const [name, abbrev] of Object.entries(abbrevMap)) {
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
    const getGameContextForPick = (pick: SweetSpotPick): GameContext | undefined => {
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
    const getOpponentDefenseRank = (pick: SweetSpotPick): number | undefined => {
      const gameContext = getGameContextForPick(pick);
      if (!gameContext || !gameContext.opponent) {
        if (pick.category) {
          console.log(`[Debug DEF] ${pick.player_name}: No game context or opponent`);
        }
        return undefined;
      }
      
      // Determine stat type for defense lookup
      const propLower = pick.prop_type?.toLowerCase() || '';
      let statType = 'points';
      if (propLower.includes('rebound')) statType = 'rebounds';
      else if (propLower.includes('assist')) statType = 'assists';
      
      // FIX: opponent is already an abbreviation from gameContextMap (e.g., "chi", "min")
      const defenseKey = `${gameContext.opponent.toLowerCase()}_${statType}`;
      const rank = defenseMap.get(defenseKey);
      
      // Debug logging for defense lookup
      if (!rank && pick.category) {
        console.log(`[Debug DEF] ${pick.player_name}: Opponent "${gameContext.opponent}" → Key "${defenseKey}" → Rank: MISSING`);
        console.log(`[Debug DEF] Sample defense keys: ${Array.from(defenseMap.keys()).slice(0, 10).join(', ')}`);
      } else if (pick.category) {
        console.log(`[Debug DEF] ${pick.player_name}: vs ${gameContext.opponent} → #${rank} ${statType} DEF`);
      }
      
      return rank;
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

    const selectedLegs: DreamTeamLeg[] = [];
    const usedTeams = new Set<string>();
    const usedPlayers = new Set<string>();

    // Step 1: Fill from proven categories first (with pattern scoring)
    for (const formula of PROVEN_FORMULA) {
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
        // Sort by: pattern score + L10 hit rate (weighted)
        .sort((a, b) => {
          const scoreA = (a._patternScore || 0) + ((a.l10HitRate || 0) * 5);
          const scoreB = (b._patternScore || 0) + ((b.l10HitRate || 0) * 5);
          return scoreB - scoreA;
        });

      let added = 0;
      for (const pick of categoryPicks) {
        if (added >= formula.count) break;
        if (selectedLegs.length >= TARGET_LEG_COUNT) break;

        const team = (pick.team_name || 'Unknown').toLowerCase();
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
        
        console.log(`[Optimal] ✅ ${pick.player_name} ${pick.prop_type} ${pick.side.toUpperCase()} ${pick.line} | ${pick.category} | L10: ${pick.l10HitRate ? Math.round(pick.l10HitRate * 100) + '%' : 'N/A'} ${h2hInfo} ${contextInfo} ${defInfo}`);
        
        selectedLegs.push({
          pick,
          team: pick.team_name || 'Unknown',
          score: (pick.confidence_score * 0.4) + ((pick.l10HitRate || 0.7) * 6) + (pick._patternScore || 0),
          h2h,
          gameContext,
          opponentDefenseRank,
          patternScore: pick._patternScore,
        });
        usedTeams.add(team);
        usedPlayers.add(pick.player_name.toLowerCase());
        added++;
      }

      if (added > 0) {
        console.log(`[Optimal] ${formula.category}: Added ${added}/${formula.count}`);
      }
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
          const scoreA = (a._patternScore || 0) + ((a.l10HitRate || 0) * 5) + a.confidence_score;
          const scoreB = (b._patternScore || 0) + ((b.l10HitRate || 0) * 5) + b.confidence_score;
          return scoreB - scoreA;
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
          score: (pick.confidence_score * 0.6) + (Math.min(pick.edge, 10) * 0.4) + (pick._patternScore || 0),
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
    
    const categoryCount = selectedLegs.filter(l => l.pick.category).length;
    const riskEngineCount = selectedLegs.length - categoryCount;
    console.log(`\n📈 Sources: ${categoryCount} Category picks, ${riskEngineCount} Risk Engine picks`);
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
