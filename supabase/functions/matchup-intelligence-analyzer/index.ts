import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Eastern Time helper
function getEasternDate(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { 
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(now);
}

// Team name normalization
const TEAM_ABBREV_MAP: Record<string, string> = {
  'ATL': 'Atlanta Hawks', 'BOS': 'Boston Celtics', 'BKN': 'Brooklyn Nets',
  'CHA': 'Charlotte Hornets', 'CHI': 'Chicago Bulls', 'CLE': 'Cleveland Cavaliers',
  'DAL': 'Dallas Mavericks', 'DEN': 'Denver Nuggets', 'DET': 'Detroit Pistons',
  'GSW': 'Golden State Warriors', 'HOU': 'Houston Rockets', 'IND': 'Indiana Pacers',
  'LAC': 'Los Angeles Clippers', 'LAL': 'Los Angeles Lakers', 'MEM': 'Memphis Grizzlies',
  'MIA': 'Miami Heat', 'MIL': 'Milwaukee Bucks', 'MIN': 'Minnesota Timberwolves',
  'NOP': 'New Orleans Pelicans', 'NYK': 'New York Knicks', 'OKC': 'Oklahoma City Thunder',
  'ORL': 'Orlando Magic', 'PHI': 'Philadelphia 76ers', 'PHX': 'Phoenix Suns',
  'POR': 'Portland Trail Blazers', 'SAC': 'Sacramento Kings', 'SAS': 'San Antonio Spurs',
  'TOR': 'Toronto Raptors', 'UTA': 'Utah Jazz', 'WAS': 'Washington Wizards'
};

const NAME_TO_ABBREV: Record<string, string> = {};
Object.entries(TEAM_ABBREV_MAP).forEach(([abbrev, name]) => {
  NAME_TO_ABBREV[name.toLowerCase()] = abbrev;
  NAME_TO_ABBREV[abbrev.toLowerCase()] = abbrev;
});

function normalizeTeamName(team: string): string {
  const lower = team.toLowerCase().trim();
  if (NAME_TO_ABBREV[lower]) return NAME_TO_ABBREV[lower];
  for (const [name, abbrev] of Object.entries(NAME_TO_ABBREV)) {
    if (lower.includes(name) || name.includes(lower)) return abbrev;
  }
  return team;
}

// Position group classification
type PositionGroup = 'guards' | 'wings' | 'bigs';

function classifyPositionGroup(position: string | undefined, archetype: string | undefined): PositionGroup {
  const pos = (position || '').toUpperCase();
  const arch = (archetype || '').toUpperCase();
  
  // Check archetype first (more accurate)
  if (['ELITE_REBOUNDER', 'GLASS_CLEANER', 'RIM_PROTECTOR', 'STRETCH_BIG', 'POST_SCORER'].some(a => arch.includes(a))) {
    return 'bigs';
  }
  if (['GUARD', 'PLAYMAKER', 'COMBO_GUARD', 'SCORING_GUARD', 'POINT_GUARD', 'FLOOR_GENERAL'].some(a => arch.includes(a))) {
    return 'guards';
  }
  if (['WING', 'SMALL_FORWARD', 'SWINGMAN', '3_AND_D'].some(a => arch.includes(a))) {
    return 'wings';
  }
  
  // Fall back to position
  if (['PG', 'SG', 'G'].includes(pos)) return 'guards';
  if (['C', 'PF'].includes(pos)) return 'bigs';
  if (['SF', 'F', 'GF', 'FC'].includes(pos)) return 'wings';
  
  // Default to wings (safest assumption)
  return 'wings';
}

// Risk flag definitions
interface RiskFlag {
  code: string;
  label: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidenceAdjustment: number;
}

const RISK_FLAGS: Record<string, RiskFlag> = {
  // Original flags
  WEAK_DEFENSE_UNDER: { code: 'WEAK_DEF_UNDER', label: 'Weak Defense for Under', severity: 'critical', confidenceAdjustment: -10 },
  STRONG_DEFENSE_OVER: { code: 'STRONG_DEF_OVER', label: 'Strong Defense for Over', severity: 'high', confidenceAdjustment: -3 },
  BLOWOUT_RISK_OVER: { code: 'BLOWOUT_OVER', label: 'Blowout Risk for Over', severity: 'critical', confidenceAdjustment: -8 },
  BLOWOUT_RISK_UNDER: { code: 'BLOWOUT_UNDER', label: 'Blowout Risk for Under', severity: 'high', confidenceAdjustment: -4 },
  TIGHT_LINE: { code: 'TIGHT_LINE', label: 'Line Within 1 of Median', severity: 'medium', confidenceAdjustment: -2 },
  UNSUSTAINABLE_RATE: { code: 'UNSUSTAIN_RATE', label: 'Unsustainable Hit Rate', severity: 'medium', confidenceAdjustment: -1.5 },
  HIGH_PACE_GAME: { code: 'HIGH_PACE', label: 'High Pace Game', severity: 'low', confidenceAdjustment: 1 },
  LOW_PACE_GAME: { code: 'LOW_PACE', label: 'Low Pace Game', severity: 'low', confidenceAdjustment: -1 },
  FAVORABLE_MATCHUP: { code: 'FAV_MATCHUP', label: 'Favorable Matchup', severity: 'low', confidenceAdjustment: 2 },
  ARCHETYPE_MISMATCH: { code: 'ARCH_MISMATCH', label: 'Archetype-Prop Mismatch', severity: 'critical', confidenceAdjustment: -15 },
  CATEGORY_SIDE_CONFLICT: { code: 'CAT_CONFLICT', label: 'Category Side Conflict', severity: 'high', confidenceAdjustment: -8 },
  
  // NEW: Position-specific defense flags
  POS_DEFENSE_WEAK: { code: 'POS_DEF_WEAK', label: 'Weak Position Defense', severity: 'low', confidenceAdjustment: 2 },
  POS_DEFENSE_STRONG: { code: 'POS_DEF_STRONG', label: 'Strong Position Defense', severity: 'medium', confidenceAdjustment: -2 },
  POS_DEFENSE_ELITE: { code: 'POS_DEF_ELITE', label: 'Elite Position Defense', severity: 'high', confidenceAdjustment: -4 },
  
  // NEW: Game script flags
  SHOOTOUT_POINTS_BOOST: { code: 'SHOOTOUT_PTS', label: 'Shootout Boosts Points', severity: 'low', confidenceAdjustment: 3 },
  SHOOTOUT_REB_PENALTY: { code: 'SHOOTOUT_REB', label: 'Shootout Hurts Rebounds Under', severity: 'medium', confidenceAdjustment: -2 },
  GRIND_POINTS_PENALTY: { code: 'GRIND_PTS', label: 'Grind-Out Hurts Points Over', severity: 'medium', confidenceAdjustment: -2 },
  GRIND_REB_BOOST: { code: 'GRIND_REB', label: 'Grind-Out Boosts Rebounds', severity: 'low', confidenceAdjustment: 2 },
  GARBAGE_TIME_RISK: { code: 'GARBAGE_TIME', label: 'Garbage Time Risk', severity: 'critical', confidenceAdjustment: -6 },
  STARTER_BLOWOUT_BLOCK: { code: 'STARTER_BLOWOUT', label: 'Starter in Blowout', severity: 'critical', confidenceAdjustment: -8 },
};

// v3.0: ARCHETYPE-PROP BLOCKING (strict)
const ARCHETYPE_PROP_BLOCKED: Record<string, string[]> = {
  'ELITE_REBOUNDER': ['points', 'threes'],
  'GLASS_CLEANER': ['points', 'threes', 'assists'],
  'RIM_PROTECTOR': ['points', 'threes'],
  'PURE_SHOOTER': ['rebounds', 'blocks'],
  'PLAYMAKER': ['rebounds', 'blocks'],
  'COMBO_GUARD': ['rebounds', 'blocks'],
  'SCORING_GUARD': ['rebounds', 'blocks'],
};

function isArchetypePropBlocked(archetype: string | undefined, propType: string): boolean {
  if (!archetype || archetype === 'UNKNOWN') return false;
  const blockedProps = ARCHETYPE_PROP_BLOCKED[archetype.toUpperCase()];
  if (!blockedProps) return false;
  const propLower = propType.toLowerCase();
  return blockedProps.some(b => propLower.includes(b));
}

interface MatchupInput {
  playerName: string;
  playerTeam: string;
  opponentTeam: string;
  propType: string;
  side: string;
  line: number;
  median?: number;
  l10HitRate?: number;
  archetype?: string;
  position?: string;
  isStarter?: boolean;
  isStar?: boolean;
  categorySide?: string;
  categoryHitRate?: number;
}

interface GameEnvRecord {
  game_id: string;
  game_date: string;
  home_team: string;
  away_team: string;
  vegas_total: number | null;
  vegas_spread: number | null;
  home_implied_total: number | null;
  away_implied_total: number | null;
  blowout_probability: number | null;
  game_script: string | null;
  game_script_confidence: number | null;
  shootout_factor: number | null;
  grind_factor: number | null;
  garbage_time_risk: number | null;
}

interface MatchupResult {
  playerName: string;
  propType: string;
  side: string;
  line: number;
  positionGroup: PositionGroup;
  opponentDefensiveRank: number | null;
  opponentStatAllowed: number | null;
  positionDefenseRank: number | null;
  positionDefenseAllowed: number | null;
  matchupScore: number;
  vegasTotal: number | null;
  vegasSpread: number | null;
  impliedTeamTotal: number | null;
  gameScript: string | null;
  gameScriptConfidence: number | null;
  blowoutRisk: number;
  garbageTimeRisk: number;
  isBlocked: boolean;
  blockReason: string | null;
  riskFlags: string[];
  confidenceAdjustment: number;
  recommendation: 'PROCEED' | 'CAUTION' | 'AVOID' | 'BLOCK';
  analysisNotes: string[];
}

interface DefenseRecord {
  team_name: string;
  stat_type: string;
  position_group: string;
  defensive_rank: number;
  stat_allowed_per_game: number;
  vs_guards_rank: number | null;
  vs_guards_allowed: number | null;
  vs_wings_rank: number | null;
  vs_wings_allowed: number | null;
  vs_bigs_rank: number | null;
  vs_bigs_allowed: number | null;
}

// Enhanced blocking rules with game script and position defense
function applyBlockingRules(
  input: MatchupInput,
  overallDefense: { rank: number; allowed: number } | null,
  positionDefense: { rank: number; allowed: number } | null,
  gameEnv: GameEnvRecord | null,
  positionGroup: PositionGroup
): { blocked: boolean; reason: string | null; flags: string[] } {
  const flags: string[] = [];
  
  const side = input.side.toLowerCase();
  const propType = input.propType.toLowerCase();
  const archetype = input.archetype?.toUpperCase() || '';
  const isElite = input.isStar || ['STAR', 'ELITE', 'PRIMARY'].some(a => archetype.includes(a));
  const gameScript = gameEnv?.game_script || 'COMPETITIVE';
  const garbageTimeRisk = gameEnv?.garbage_time_risk || 0;
  const shootoutFactor = gameEnv?.shootout_factor || 0.5;
  const grindFactor = gameEnv?.grind_factor || 0.5;
  
  // v3.0 Rule 0: ARCHETYPE-PROP MISMATCH BLOCK (CRITICAL)
  if (isArchetypePropBlocked(input.archetype, input.propType)) {
    console.log(`[Matchup] ARCHETYPE BLOCKED: ${input.playerName} (${input.archetype}) for ${input.propType}`);
    return {
      blocked: true,
      reason: `BLOCKED: Archetype ${input.archetype} cannot bet ${input.propType}`,
      flags: [RISK_FLAGS.ARCHETYPE_MISMATCH.code]
    };
  }
  
  // v3.0 Rule 0b: CATEGORY SIDE CONFLICT BLOCK
  if (input.categorySide && input.categoryHitRate && input.categoryHitRate >= 0.7) {
    if (input.categorySide.toLowerCase() !== side) {
      console.log(`[Matchup] CATEGORY CONFLICT: ${input.playerName} ${propType} - Category says ${input.categorySide} (${Math.round(input.categoryHitRate * 100)}% L10), pick says ${side}`);
      return {
        blocked: true,
        reason: `BLOCKED: Category recommends ${input.categorySide.toUpperCase()} with ${Math.round(input.categoryHitRate * 100)}% L10 hit rate`,
        flags: [RISK_FLAGS.CATEGORY_SIDE_CONFLICT.code]
      };
    }
  }
  
  // NEW: Position-specific defense blocking
  if (positionDefense) {
    if (side === 'over' && positionDefense.rank <= 5 && propType.includes('point')) {
      flags.push(RISK_FLAGS.POS_DEFENSE_ELITE.code);
      // Block if elite position defense
      if (positionDefense.rank <= 3) {
        return {
          blocked: true,
          reason: `BLOCKED: Elite ${positionGroup} defense (Rank #${positionDefense.rank}) for points OVER`,
          flags
        };
      }
    }
    
    if (side === 'under' && positionDefense.rank >= 25 && propType.includes('point')) {
      // Weak position defense = bad for under
      flags.push(RISK_FLAGS.POS_DEFENSE_WEAK.code);
      if (isElite && positionDefense.rank >= 28) {
        return {
          blocked: true,
          reason: `BLOCKED: Terrible ${positionGroup} defense (Rank #${positionDefense.rank}) for points UNDER`,
          flags
        };
      }
    }
    
    // Position defense advantage for overs
    if (side === 'over' && positionDefense.rank >= 20) {
      flags.push(RISK_FLAGS.POS_DEFENSE_WEAK.code);
    }
    
    // Position defense disadvantage for overs
    if (side === 'over' && positionDefense.rank <= 10) {
      flags.push(RISK_FLAGS.POS_DEFENSE_STRONG.code);
    }
  }
  
  // NEW: Game Script Blocking Rules
  if (gameScript === 'HARD_BLOWOUT' && garbageTimeRisk >= 0.6) {
    if (side === 'over' && (input.isStarter || isElite) && input.line >= 20) {
      return {
        blocked: true,
        reason: `BLOCKED: Hard blowout (${Math.round(garbageTimeRisk * 100)}% garbage time risk) - starters will sit`,
        flags: [RISK_FLAGS.STARTER_BLOWOUT_BLOCK.code]
      };
    }
    flags.push(RISK_FLAGS.GARBAGE_TIME_RISK.code);
  }
  
  // Shootout game script implications
  if (gameScript === 'SHOOTOUT' || shootoutFactor >= 0.7) {
    if (side === 'over' && propType.includes('point')) {
      flags.push(RISK_FLAGS.SHOOTOUT_POINTS_BOOST.code);
    }
    if (side === 'under' && propType.includes('rebound')) {
      flags.push(RISK_FLAGS.SHOOTOUT_REB_PENALTY.code);
    }
  }
  
  // Grind-out game script implications
  if (gameScript === 'GRIND_OUT' || grindFactor >= 0.7) {
    if (side === 'over' && propType.includes('point')) {
      flags.push(RISK_FLAGS.GRIND_POINTS_PENALTY.code);
    }
    if (side === 'over' && propType.includes('rebound')) {
      flags.push(RISK_FLAGS.GRIND_REB_BOOST.code);
    }
  }
  
  // Original Rule 1: Star UNDER vs Weak Defense BLOCK
  if (isElite && side === 'under' && propType.includes('point') && overallDefense?.rank && overallDefense.rank > 20) {
    return {
      blocked: true,
      reason: `BLOCKED: Cannot bet UNDER on stars vs weak defense (Rank #${overallDefense.rank})`,
      flags: [RISK_FLAGS.WEAK_DEFENSE_UNDER.code]
    };
  }
  
  // Rule 2: Blowout Favorite Playmaker UNDER Block (assists)
  if (gameEnv?.vegas_spread && gameEnv.vegas_spread < -5 && side === 'under' && 
      (propType.includes('assist') || propType.includes('ast'))) {
    flags.push(RISK_FLAGS.BLOWOUT_RISK_UNDER.code);
    if (archetype.includes('GUARD') || archetype.includes('PLAYMAKER')) {
      return {
        blocked: true,
        reason: `BLOCKED: Blowout wins increase assist opportunities (spread: ${gameEnv.vegas_spread})`,
        flags
      };
    }
  }
  
  // Rule 3: Heavy Underdog Star OVER Block
  if (gameEnv?.vegas_spread && gameEnv.vegas_spread > 8 && side === 'over' && 
      propType.includes('point') && input.line >= 25 && isElite) {
    return {
      blocked: true,
      reason: `BLOCKED: Blowout loss reduces star minutes/touches (spread: +${gameEnv.vegas_spread})`,
      flags: [RISK_FLAGS.BLOWOUT_RISK_OVER.code]
    };
  }
  
  // Rule 4: Tight Line Variance Penalty
  if (input.median && Math.abs(input.median - input.line) < 1.0) {
    flags.push(RISK_FLAGS.TIGHT_LINE.code);
  }
  
  // Rule 5: Role Player Extreme Hit Rate Skepticism
  if (input.l10HitRate && input.l10HitRate >= 0.95 && !isElite && !input.isStarter) {
    flags.push(RISK_FLAGS.UNSUSTAINABLE_RATE.code);
  }
  
  // Rule 6: Strong Defense OVER penalty
  if (side === 'over' && propType.includes('point') && overallDefense?.rank && overallDefense.rank <= 10) {
    flags.push(RISK_FLAGS.STRONG_DEFENSE_OVER.code);
  }
  
  // Rule 7: Weak Defense OVER boost (favorable)
  if (side === 'over' && propType.includes('point') && overallDefense?.rank && overallDefense.rank > 20) {
    flags.push(RISK_FLAGS.FAVORABLE_MATCHUP.code);
  }
  
  // Rule 8: High blowout probability general warning
  if (gameEnv?.blowout_probability && gameEnv.blowout_probability > 0.5) {
    flags.push(side === 'over' ? RISK_FLAGS.BLOWOUT_RISK_OVER.code : RISK_FLAGS.BLOWOUT_RISK_UNDER.code);
  }
  
  // Rule 9: High pace game boost for overs
  if (gameEnv?.vegas_total && gameEnv.vegas_total > 230 && side === 'over') {
    flags.push(RISK_FLAGS.HIGH_PACE_GAME.code);
  }
  
  // Rule 10: Low pace game penalty for overs
  if (gameEnv?.vegas_total && gameEnv.vegas_total < 215 && side === 'over') {
    flags.push(RISK_FLAGS.LOW_PACE_GAME.code);
  }
  
  return { blocked: false, reason: null, flags };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { action, props, playerName, opponentTeam, propType, side, line } = await req.json();
    const today = getEasternDate();

    // Action: analyze_batch - Analyze multiple props at once
    if (action === 'analyze_batch') {
      // Auto-fetch picks from nba_risk_engine_picks if props not provided
      let propsToAnalyze = Array.isArray(props) && props.length > 0 ? props : null;
      
      if (!propsToAnalyze) {
        console.log('[Matchup] No props provided, fetching from nba_risk_engine_picks...');
        const { data: riskPicks, error: riskError } = await supabase
          .from('nba_risk_engine_picks')
          .select('*')
          .eq('game_date', today)
          .is('rejection_reason', null)
          .gte('confidence_score', 5.0);
        
        if (riskError) {
          console.error('[Matchup] Error fetching risk picks:', riskError);
          throw riskError;
        }
        
        propsToAnalyze = (riskPicks || []).map((pick: any) => ({
          playerName: pick.player_name,
          playerTeam: pick.team_name || pick.team,
          opponentTeam: pick.opponent,
          propType: pick.prop_type,
          side: pick.side,
          line: pick.line,
          median: pick.true_median,
          l10HitRate: pick.l10_hit_rate,
          archetype: pick.archetype || pick.player_role,
          position: pick.position,
          isStarter: pick.is_star || pick.is_ball_dominant,
          isStar: pick.is_star,
        }));
        
        console.log(`[Matchup] Fetched ${propsToAnalyze.length} approved picks from risk engine`);
      }
      
      if (!propsToAnalyze || propsToAnalyze.length === 0) {
        return new Response(JSON.stringify({
          success: true,
          analyzed: 0,
          blocked: 0,
          caution: 0,
          results: [],
          message: 'No props to analyze'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      console.log(`[Matchup] Analyzing ${propsToAnalyze.length} props for matchup intelligence`);
      
      // Fetch all defensive ratings (including position-specific)
      const { data: defenseData } = await supabase
        .from('team_defensive_ratings')
        .select('*');
      
      // Fetch today's game environments (with game script)
      const { data: gameEnvData } = await supabase
        .from('game_environment')
        .select('*')
        .eq('game_date', today);
      
      // Fetch category sweet spots for side enforcement
      const { data: categoryData } = await supabase
        .from('category_sweet_spots')
        .select('player_name, prop_type, recommended_side, l10_hit_rate')
        .gte('l10_hit_rate', 0.7);
      
      // Create category recommendations map
      const categoryMap = new Map<string, { side: string; hitRate: number }>();
      (categoryData || []).forEach((c: { player_name: string; prop_type: string; recommended_side: string; l10_hit_rate: number }) => {
        const key = `${c.player_name?.toLowerCase()}_${c.prop_type?.toLowerCase()}`;
        categoryMap.set(key, { side: c.recommended_side, hitRate: c.l10_hit_rate });
      });
      
      console.log(`[Matchup] Loaded ${categoryMap.size} category recommendations`);
      
      // Create lookup maps
      // Defense map: team_stat_position -> { rank, allowed }
      const defenseMap = new Map<string, DefenseRecord>();
      (defenseData || []).forEach((d: DefenseRecord) => {
        const key = `${normalizeTeamName(d.team_name)}_${d.stat_type}_${d.position_group}`.toLowerCase();
        defenseMap.set(key, d);
      });
      
      const gameEnvMap = new Map<string, GameEnvRecord>();
      (gameEnvData || []).forEach((g: GameEnvRecord) => {
        gameEnvMap.set(normalizeTeamName(g.home_team), g);
        gameEnvMap.set(normalizeTeamName(g.away_team), g);
      });
      
      const results: MatchupResult[] = [];
      
      for (const prop of propsToAnalyze) {
        const oppTeam = normalizeTeamName(prop.opponentTeam || '');
        const playerTeam = normalizeTeamName(prop.playerTeam || '');
        
        // Classify player position group
        const positionGroup = classifyPositionGroup(prop.position, prop.archetype);
        
        // Get prop type for defense lookup
        let defenseStatType = 'points';
        if (prop.propType?.toLowerCase().includes('rebound')) defenseStatType = 'rebounds';
        else if (prop.propType?.toLowerCase().includes('assist')) defenseStatType = 'assists';
        else if (prop.propType?.toLowerCase().includes('three')) defenseStatType = 'threes';
        
        // Get overall defense (position_group = 'all')
        const overallDefenseKey = `${oppTeam}_${defenseStatType}_all`.toLowerCase();
        const overallDefenseRecord = defenseMap.get(overallDefenseKey);
        const overallDefense = overallDefenseRecord 
          ? { rank: overallDefenseRecord.defensive_rank, allowed: overallDefenseRecord.stat_allowed_per_game }
          : null;
        
        // Get position-specific defense
        const posDefenseKey = `${oppTeam}_${defenseStatType}_${positionGroup}`.toLowerCase();
        const posDefenseRecord = defenseMap.get(posDefenseKey);
        const positionDefense = posDefenseRecord
          ? { rank: posDefenseRecord.defensive_rank, allowed: posDefenseRecord.stat_allowed_per_game }
          : null;
        
        // Find game environment
        const gameEnv = gameEnvMap.get(oppTeam) || gameEnvMap.get(playerTeam) || null;
        let vegasSpread = gameEnv?.vegas_spread || null;
        let impliedTotal = null;
        let blowoutProb = 0.15;
        let garbageTimeRisk = 0.15;
        
        if (gameEnv) {
          // Adjust spread perspective based on which team the player is on
          if (gameEnv.home_team && normalizeTeamName(gameEnv.home_team) === playerTeam) {
            vegasSpread = gameEnv.vegas_spread;
            impliedTotal = gameEnv.home_implied_total;
          } else {
            vegasSpread = gameEnv.vegas_spread ? -gameEnv.vegas_spread : null;
            impliedTotal = gameEnv.away_implied_total;
          }
          blowoutProb = gameEnv.blowout_probability || 0.15;
          garbageTimeRisk = gameEnv.garbage_time_risk || 0.15;
        }
        
        // Lookup category recommendation for this player/prop
        const catKey = `${prop.playerName?.toLowerCase()}_${prop.propType?.toLowerCase()}`;
        const categoryRec = categoryMap.get(catKey);
        
        // Apply blocking rules with position defense and game script
        const blockResult = applyBlockingRules(
          {
            playerName: prop.playerName,
            playerTeam: prop.playerTeam,
            opponentTeam: oppTeam,
            propType: prop.propType,
            side: prop.side,
            line: prop.line,
            median: prop.median,
            l10HitRate: prop.l10HitRate,
            archetype: prop.archetype,
            position: prop.position,
            isStarter: prop.isStarter,
            isStar: prop.isStar,
            categorySide: categoryRec?.side,
            categoryHitRate: categoryRec?.hitRate,
          },
          overallDefense,
          positionDefense,
          gameEnv,
          positionGroup
        );
        
        // Calculate confidence adjustment from flags
        let confidenceAdjustment = 0;
        const analysisNotes: string[] = [];
        
        for (const flagCode of blockResult.flags) {
          const flag = Object.values(RISK_FLAGS).find(f => f.code === flagCode);
          if (flag) {
            confidenceAdjustment += flag.confidenceAdjustment;
            analysisNotes.push(flag.label);
          }
        }
        
        // Calculate matchup score (-10 to +10) using position-specific defense
        let matchupScore = 0;
        const defenseToUse = positionDefense || overallDefense;
        if (defenseToUse?.rank) {
          const rankFactor = (defenseToUse.rank - 15) / 3;
          matchupScore = prop.side?.toLowerCase() === 'over' ? rankFactor : -rankFactor;
        }
        
        // Add game script factor to matchup score
        if (gameEnv?.game_script) {
          if (gameEnv.game_script === 'SHOOTOUT' && prop.side?.toLowerCase() === 'over' && prop.propType?.includes('point')) {
            matchupScore += 1.5;
          }
          if (gameEnv.game_script === 'GRIND_OUT' && prop.side?.toLowerCase() === 'over' && prop.propType?.includes('point')) {
            matchupScore -= 1.5;
          }
        }
        
        // Determine recommendation
        let recommendation: 'PROCEED' | 'CAUTION' | 'AVOID' | 'BLOCK' = 'PROCEED';
        if (blockResult.blocked) {
          recommendation = 'BLOCK';
        } else if (confidenceAdjustment <= -5) {
          recommendation = 'AVOID';
        } else if (confidenceAdjustment < -2) {
          recommendation = 'CAUTION';
        }
        
        results.push({
          playerName: prop.playerName,
          propType: prop.propType,
          side: prop.side,
          line: prop.line,
          positionGroup,
          opponentDefensiveRank: overallDefense?.rank || null,
          opponentStatAllowed: overallDefense?.allowed || null,
          positionDefenseRank: positionDefense?.rank || null,
          positionDefenseAllowed: positionDefense?.allowed || null,
          matchupScore,
          vegasTotal: gameEnv?.vegas_total || null,
          vegasSpread,
          impliedTeamTotal: impliedTotal,
          gameScript: gameEnv?.game_script || null,
          gameScriptConfidence: gameEnv?.game_script_confidence || null,
          blowoutRisk: blowoutProb,
          garbageTimeRisk,
          isBlocked: blockResult.blocked,
          blockReason: blockResult.reason,
          riskFlags: blockResult.flags,
          confidenceAdjustment,
          recommendation,
          analysisNotes,
        });
      }
      
      // Save to matchup_intelligence table
      const toUpsert = results.map(r => ({
        player_name: r.playerName,
        opponent_team: propsToAnalyze.find((p: any) => p.playerName === r.playerName)?.opponentTeam || '',
        prop_type: r.propType,
        side: r.side,
        line: r.line,
        game_date: today,
        position_group: r.positionGroup,
        player_position: propsToAnalyze.find((p: any) => p.playerName === r.playerName)?.position || null,
        opponent_defensive_rank: r.opponentDefensiveRank,
        opponent_stat_allowed: r.opponentStatAllowed,
        position_defense_rank: r.positionDefenseRank,
        position_defense_allowed: r.positionDefenseAllowed,
        matchup_score: r.matchupScore,
        vegas_total: r.vegasTotal,
        vegas_spread: r.vegasSpread,
        implied_team_total: r.impliedTeamTotal,
        game_script: r.gameScript,
        game_script_confidence: r.gameScriptConfidence,
        blowout_risk: r.blowoutRisk,
        prop_implications: {
          garbageTimeRisk: r.garbageTimeRisk,
          analysisNotes: r.analysisNotes,
        },
        is_blocked: r.isBlocked,
        block_reason: r.blockReason,
        risk_flags: r.riskFlags,
        confidence_adjustment: r.confidenceAdjustment,
        updated_at: new Date().toISOString(),
      }));
      
      if (toUpsert.length > 0) {
        await supabase
          .from('matchup_intelligence')
          .upsert(toUpsert, { onConflict: 'player_name,prop_type,side,line,game_date' });
      }
      
      const blockedCount = results.filter(r => r.isBlocked).length;
      const cautionCount = results.filter(r => r.recommendation === 'CAUTION' || r.recommendation === 'AVOID').length;
      
      console.log(`[Matchup] Analysis complete: ${blockedCount} blocked, ${cautionCount} caution/avoid, ${results.length - blockedCount - cautionCount} proceed`);
      
      return new Response(JSON.stringify({
        success: true,
        analyzed: results.length,
        blocked: blockedCount,
        caution: cautionCount,
        proceed: results.length - blockedCount - cautionCount,
        results,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Action: get_intelligence - Get cached matchup intelligence for a player
    if (action === 'get_intelligence') {
      const { data } = await supabase
        .from('matchup_intelligence')
        .select('*')
        .eq('player_name', playerName)
        .eq('prop_type', propType)
        .eq('game_date', today)
        .maybeSingle();
      
      return new Response(JSON.stringify({
        success: true,
        intelligence: data,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Action: get_blocked - Get all blocked props for today
    if (action === 'get_blocked') {
      const { data } = await supabase
        .from('matchup_intelligence')
        .select('*')
        .eq('game_date', today)
        .eq('is_blocked', true);
      
      return new Response(JSON.stringify({
        success: true,
        blocked: data || [],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Action: get_all - Get all matchup intelligence for today
    if (action === 'get_all') {
      const { data } = await supabase
        .from('matchup_intelligence')
        .select('*')
        .eq('game_date', today)
        .order('matchup_score', { ascending: false });
      
      return new Response(JSON.stringify({
        success: true,
        intelligence: data || [],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    return new Response(JSON.stringify({ error: 'Invalid action. Use: analyze_batch, get_intelligence, get_blocked, get_all' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('[Matchup] Error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
