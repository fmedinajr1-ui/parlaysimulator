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
  // Check direct mapping
  if (NAME_TO_ABBREV[lower]) return NAME_TO_ABBREV[lower];
  // Check partial match
  for (const [name, abbrev] of Object.entries(NAME_TO_ABBREV)) {
    if (lower.includes(name) || name.includes(lower)) return abbrev;
  }
  return team;
}

// Risk flag definitions
interface RiskFlag {
  code: string;
  label: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidenceAdjustment: number;
}

const RISK_FLAGS: Record<string, RiskFlag> = {
  WEAK_DEFENSE_UNDER: { code: 'WEAK_DEF_UNDER', label: 'Weak Defense for Under', severity: 'critical', confidenceAdjustment: -10 },
  STRONG_DEFENSE_OVER: { code: 'STRONG_DEF_OVER', label: 'Strong Defense for Over', severity: 'high', confidenceAdjustment: -3 },
  BLOWOUT_RISK_OVER: { code: 'BLOWOUT_OVER', label: 'Blowout Risk for Over', severity: 'critical', confidenceAdjustment: -8 },
  BLOWOUT_RISK_UNDER: { code: 'BLOWOUT_UNDER', label: 'Blowout Risk for Under', severity: 'high', confidenceAdjustment: -4 },
  TIGHT_LINE: { code: 'TIGHT_LINE', label: 'Line Within 1 of Median', severity: 'medium', confidenceAdjustment: -2 },
  UNSUSTAINABLE_RATE: { code: 'UNSUSTAIN_RATE', label: 'Unsustainable Hit Rate', severity: 'medium', confidenceAdjustment: -1.5 },
  HIGH_PACE_GAME: { code: 'HIGH_PACE', label: 'High Pace Game', severity: 'low', confidenceAdjustment: 1 },
  LOW_PACE_GAME: { code: 'LOW_PACE', label: 'Low Pace Game', severity: 'low', confidenceAdjustment: -1 },
  FAVORABLE_MATCHUP: { code: 'FAV_MATCHUP', label: 'Favorable Matchup', severity: 'low', confidenceAdjustment: 2 },
};

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
  isStarter?: boolean;
}

interface MatchupResult {
  playerName: string;
  propType: string;
  side: string;
  line: number;
  opponentDefensiveRank: number | null;
  opponentStatAllowed: number | null;
  matchupScore: number;
  vegasTotal: number | null;
  vegasSpread: number | null;
  impliedTeamTotal: number | null;
  blowoutRisk: number;
  isBlocked: boolean;
  blockReason: string | null;
  riskFlags: string[];
  confidenceAdjustment: number;
  recommendation: 'PROCEED' | 'CAUTION' | 'AVOID' | 'BLOCK';
  analysisNotes: string[];
}

// Blocking rules based on today's failures
function applyBlockingRules(
  input: MatchupInput,
  defensiveRank: number | null,
  gameEnv: { vegasSpread: number | null; vegasTotal: number | null; blowoutProb: number } | null
): { blocked: boolean; reason: string | null; flags: string[] } {
  const flags: string[] = [];
  const notes: string[] = [];
  
  const side = input.side.toLowerCase();
  const propType = input.propType.toLowerCase();
  const archetype = input.archetype?.toLowerCase() || '';
  const isElite = ['star', 'elite', 'primary'].some(a => archetype.includes(a));
  
  // Rule 1: Star UNDER vs Weak Defense BLOCK
  // Would have blocked: Bam Adebayo Under 17.5 vs Kings (bottom-5 defense)
  if (isElite && side === 'under' && propType.includes('point') && defensiveRank && defensiveRank > 20) {
    return {
      blocked: true,
      reason: `BLOCKED: Cannot bet UNDER on stars vs weak defense (Rank #${defensiveRank})`,
      flags: [RISK_FLAGS.WEAK_DEFENSE_UNDER.code]
    };
  }
  
  // Rule 2: Blowout Favorite Playmaker UNDER Block (assists)
  // Would have blocked: Coby White Under 4.5 Assists
  if (gameEnv?.vegasSpread && gameEnv.vegasSpread < -5 && side === 'under' && 
      (propType.includes('assist') || propType.includes('ast'))) {
    flags.push(RISK_FLAGS.BLOWOUT_RISK_UNDER.code);
    if (archetype.includes('guard') || archetype.includes('playmaker')) {
      return {
        blocked: true,
        reason: `BLOCKED: Blowout wins increase assist opportunities (spread: ${gameEnv.vegasSpread})`,
        flags
      };
    }
  }
  
  // Rule 3: Heavy Underdog Star OVER Block
  // Would have blocked: James Harden Over 30.5 Points (Clippers lost by 28)
  if (gameEnv?.vegasSpread && gameEnv.vegasSpread > 8 && side === 'over' && 
      propType.includes('point') && input.line >= 25 && isElite) {
    return {
      blocked: true,
      reason: `BLOCKED: Blowout loss reduces star minutes/touches (spread: +${gameEnv.vegasSpread})`,
      flags: [RISK_FLAGS.BLOWOUT_RISK_OVER.code]
    };
  }
  
  // Rule 4: Tight Line Variance Penalty
  // Would have flagged: Julius Randle Over 19.5 (avg 22.7, line tight)
  if (input.median && Math.abs(input.median - input.line) < 1.0) {
    flags.push(RISK_FLAGS.TIGHT_LINE.code);
    notes.push(`Line within 1 point of median (${input.median.toFixed(1)} vs ${input.line})`);
  }
  
  // Rule 5: Role Player Extreme Hit Rate Skepticism
  // Would have flagged: Royce O'Neale Rebounds OVER (100% L10 hit rate)
  if (input.l10HitRate && input.l10HitRate >= 0.95 && !isElite && !input.isStarter) {
    flags.push(RISK_FLAGS.UNSUSTAINABLE_RATE.code);
    notes.push(`Unsustainable ${(input.l10HitRate * 100).toFixed(0)}% hit rate for role player`);
  }
  
  // Rule 6: Strong Defense OVER penalty
  if (side === 'over' && propType.includes('point') && defensiveRank && defensiveRank <= 10) {
    flags.push(RISK_FLAGS.STRONG_DEFENSE_OVER.code);
  }
  
  // Rule 7: Weak Defense OVER boost (favorable)
  if (side === 'over' && propType.includes('point') && defensiveRank && defensiveRank > 20) {
    flags.push(RISK_FLAGS.FAVORABLE_MATCHUP.code);
  }
  
  // Rule 8: High blowout probability general warning
  if (gameEnv?.blowoutProb && gameEnv.blowoutProb > 0.5) {
    flags.push(side === 'over' ? RISK_FLAGS.BLOWOUT_RISK_OVER.code : RISK_FLAGS.BLOWOUT_RISK_UNDER.code);
  }
  
  // Rule 9: High pace game boost for overs
  if (gameEnv?.vegasTotal && gameEnv.vegasTotal > 230 && side === 'over') {
    flags.push(RISK_FLAGS.HIGH_PACE_GAME.code);
  }
  
  // Rule 10: Low pace game penalty for overs
  if (gameEnv?.vegasTotal && gameEnv.vegasTotal < 215 && side === 'over') {
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
    if (action === 'analyze_batch' && Array.isArray(props)) {
      console.log(`[Matchup] Analyzing ${props.length} props for matchup intelligence`);
      
      // Fetch all defensive ratings
      const { data: defenseData } = await supabase
        .from('team_defensive_ratings')
        .select('*');
      
      // Fetch today's game environments
      const { data: gameEnvData } = await supabase
        .from('game_environment')
        .select('*')
        .eq('game_date', today);
      
      type GameEnvRecord = {
        game_id: string;
        game_date: string;
        home_team: string;
        away_team: string;
        vegas_total: number | null;
        vegas_spread: number | null;
        home_implied_total: number | null;
        away_implied_total: number | null;
        blowout_probability: number | null;
      };
      
      // Create lookup maps
      const defenseMap = new Map<string, { rank: number; allowed: number }>();
      (defenseData || []).forEach((d: { team_name: string; stat_type: string; defensive_rank: number; stat_allowed_per_game: number }) => {
        const key = `${normalizeTeamName(d.team_name)}_${d.stat_type}`.toLowerCase();
        defenseMap.set(key, { rank: d.defensive_rank, allowed: d.stat_allowed_per_game });
      });
      
      const gameEnvMap = new Map<string, GameEnvRecord>();
      (gameEnvData || []).forEach(g => {
        gameEnvMap.set(normalizeTeamName(g.home_team), g);
        gameEnvMap.set(normalizeTeamName(g.away_team), g);
      });
      
      const results: MatchupResult[] = [];
      
      for (const prop of props) {
        const oppTeam = normalizeTeamName(prop.opponentTeam || '');
        const playerTeam = normalizeTeamName(prop.playerTeam || '');
        
        // Get prop type for defense lookup
        let defenseStatType = 'points';
        if (prop.propType?.toLowerCase().includes('rebound')) defenseStatType = 'rebounds';
        else if (prop.propType?.toLowerCase().includes('assist')) defenseStatType = 'assists';
        else if (prop.propType?.toLowerCase().includes('three')) defenseStatType = 'threes';
        
        const defenseKey = `${oppTeam}_${defenseStatType}`.toLowerCase();
        const defense = defenseMap.get(defenseKey);
        
        // Find game environment
        const gameEnv = gameEnvMap.get(oppTeam) || gameEnvMap.get(playerTeam);
        let vegasSpread = gameEnv?.vegas_spread || null;
        let impliedTotal = null;
        let blowoutProb = 0.15;
        
        if (gameEnv) {
          // Adjust spread perspective based on which team the player is on
          if (gameEnv.home_team && normalizeTeamName(gameEnv.home_team) === playerTeam) {
            vegasSpread = gameEnv.vegas_spread; // Negative = player's team favored
            impliedTotal = gameEnv.home_implied_total;
          } else {
            vegasSpread = gameEnv.vegas_spread ? -gameEnv.vegas_spread : null; // Flip for away team
            impliedTotal = gameEnv.away_implied_total;
          }
          blowoutProb = gameEnv.blowout_probability || 0.15;
        }
        
        // Apply blocking rules
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
            isStarter: prop.isStarter,
          },
          defense?.rank || null,
          gameEnv ? { vegasSpread, vegasTotal: gameEnv.vegas_total, blowoutProb } : null
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
        
        // Calculate matchup score (-10 to +10)
        let matchupScore = 0;
        if (defense?.rank) {
          // For OVER bets, high rank (weak defense) is good
          // For UNDER bets, low rank (strong defense) is good
          const rankFactor = (defense.rank - 15) / 3; // -5 to +5 scale
          matchupScore = prop.side?.toLowerCase() === 'over' ? rankFactor : -rankFactor;
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
          opponentDefensiveRank: defense?.rank || null,
          opponentStatAllowed: defense?.allowed || null,
          matchupScore,
          vegasTotal: gameEnv?.vegas_total || null,
          vegasSpread,
          impliedTeamTotal: impliedTotal,
          blowoutRisk: blowoutProb,
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
        opponent_team: props.find(p => p.playerName === r.playerName)?.opponentTeam || '',
        prop_type: r.propType,
        side: r.side,
        line: r.line,
        game_date: today,
        opponent_defensive_rank: r.opponentDefensiveRank,
        opponent_stat_allowed: r.opponentStatAllowed,
        matchup_score: r.matchupScore,
        vegas_total: r.vegasTotal,
        vegas_spread: r.vegasSpread,
        implied_team_total: r.impliedTeamTotal,
        blowout_risk: r.blowoutRisk,
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
      
      console.log(`[Matchup] Analysis complete: ${blockedCount} blocked, ${cautionCount} caution/avoid`);
      
      return new Response(JSON.stringify({
        success: true,
        analyzed: results.length,
        blocked: blockedCount,
        caution: cautionCount,
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
    
    return new Response(JSON.stringify({ error: 'Invalid action' }), {
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
