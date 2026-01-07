import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============ STEP 1: GAME SCRIPT CLASSIFICATION ============
type GameScript = 'COMPETITIVE' | 'SOFT_BLOWOUT' | 'HARD_BLOWOUT';

function classifyGameScript(spread: number): GameScript {
  const absSpread = Math.abs(spread);
  if (absSpread <= 7) return 'COMPETITIVE';
  if (absSpread <= 12) return 'SOFT_BLOWOUT';
  return 'HARD_BLOWOUT';
}

// ============ STEP 2: PLAYER ROLE CLASSIFICATION ============
type PlayerRole = 'STAR' | 'SECONDARY_GUARD' | 'WING' | 'BIG';

function classifyPlayerRole(
  usageRate: number,
  avgMinutes: number,
  position: string
): PlayerRole {
  // STAR: Usage >= 28% OR team's primary scorer
  if (usageRate >= 28) return 'STAR';
  
  // BIG: Center / interior forward
  if (['C', 'PF', 'F-C', 'C-F'].includes(position)) return 'BIG';
  
  // SECONDARY GUARD: Ball handler but not primary
  if (['PG', 'SG', 'G', 'G-F'].includes(position) && usageRate >= 18) return 'SECONDARY_GUARD';
  
  // WING: 2-way perimeter player, minutes >= 30
  if (avgMinutes >= 30) return 'WING';
  
  // Default fallback
  return ['PG', 'SG', 'G', 'G-F'].includes(position) ? 'SECONDARY_GUARD' : 'WING';
}

// ============ STEP 3: STAT TYPE BLACKLIST ============
function isStatBlacklisted(
  propType: string,
  side: string,
  role: PlayerRole,
  gameScript: GameScript,
  threePtAttempts?: number
): { blocked: boolean; reason?: string } {
  const statLower = propType.toLowerCase();
  const isOver = side.toLowerCase() === 'over';
  
  // Guard PRA - NEVER
  if ((role === 'SECONDARY_GUARD') && 
      (statLower.includes('points_rebounds_assists') || statLower.includes('pra'))) {
    return { blocked: true, reason: 'Guard PRA blacklisted' };
  }
  
  // Big PRA OVER - NEVER
  if (role === 'BIG' && (statLower.includes('points_rebounds_assists') || statLower.includes('pra')) && isOver) {
    return { blocked: true, reason: 'Big PRA OVER blacklisted' };
  }
  
  // Any PRA OVER in Blowout games - NEVER
  if ((statLower.includes('points_rebounds_assists') || statLower.includes('pra')) && isOver && 
      gameScript !== 'COMPETITIVE') {
    return { blocked: true, reason: 'PRA OVER in blowout blacklisted' };
  }
  
  // Guard Rebounds - NEVER
  if (role === 'SECONDARY_GUARD' && statLower === 'player_rebounds') {
    return { blocked: true, reason: 'Guard rebounds blacklisted' };
  }
  
  // 3PT Made unless attempts >= 7 and role is shooter
  if (statLower.includes('threes') && (!threePtAttempts || threePtAttempts < 7)) {
    return { blocked: true, reason: '3PT blocked: <7 attempts avg' };
  }
  
  return { blocked: false };
}

// ============ STEP 4: ALLOWED STAT TYPES BY ROLE ============
function getAllowedStats(role: PlayerRole, gameScript: GameScript): string[] {
  switch (role) {
    case 'STAR':
      if (gameScript === 'COMPETITIVE') {
        return ['points', 'rebounds'];
      }
      // Blowout: only UNDERs for stars
      return ['points_under', 'pra_under', 'points_rebounds_assists_under'];
      
    case 'SECONDARY_GUARD':
      return ['assists', 'points_assists'];
      
    case 'WING':
      return ['rebounds', 'points'];
      
    case 'BIG':
      const bigStats = ['rebounds', 'points_under'];
      // PRA UNDER only in blowouts
      if (gameScript !== 'COMPETITIVE') {
        bigStats.push('pra_under', 'points_rebounds_assists_under');
      }
      return bigStats;
      
    default:
      return [];
  }
}

function isStatAllowed(
  propType: string,
  side: string,
  role: PlayerRole,
  gameScript: GameScript
): boolean {
  const allowed = getAllowedStats(role, gameScript);
  const statLower = propType.toLowerCase();
  const sideLower = side.toLowerCase();
  
  // Check if this stat+side combo is allowed
  for (const a of allowed) {
    // Handle explicit under requirements
    if (a.includes('_under')) {
      const baseStat = a.replace('_under', '');
      if (statLower.includes(baseStat) && sideLower === 'under') {
        return true;
      }
    } else {
      // Regular stat - any side allowed unless restricted elsewhere
      if (statLower.includes(a)) {
        return true;
      }
    }
  }
  
  return false;
}

// ============ STEP 5: MEDIAN BAD GAME CHECK ============
function passesMedianBadGameCheck(
  gameLogs: number[],
  line: number,
  side: string
): { passes: boolean; badGameFloor: number } {
  if (gameLogs.length < 5) {
    return { passes: false, badGameFloor: 0 };
  }
  
  // Sort and take the "bad games" (bottom 3)
  const sorted = [...gameLogs].sort((a, b) => a - b);
  const badGames = sorted.slice(0, 3);
  const badGameFloor = Math.min(...badGames);
  
  if (side.toLowerCase() === 'over') {
    // All bad games must still clear the line
    const passes = badGames.every(g => g > line);
    return { passes, badGameFloor };
  } else {
    // For under: all bad games must still go under
    const passes = badGames.every(g => g < line);
    return { passes, badGameFloor: Math.max(...badGames) };
  }
}

// ============ STEP 6: MINUTES CONFIDENCE FILTER ============
type MinutesConfidence = 'LOCKED' | 'MEDIUM' | 'RISKY';

function classifyMinutes(avgMinutes: number): MinutesConfidence {
  if (avgMinutes >= 32) return 'LOCKED';
  if (avgMinutes >= 24) return 'MEDIUM';
  return 'RISKY';
}

// ============ STEP 7: CONFIDENCE SCORING ============
interface ConfidenceFactors {
  roleStatAlignment: number;
  minutesCertainty: number;
  gameScriptFit: number;
  medianDistance: number;
  badGameSurvival: number;
}

function calculateConfidence(
  role: PlayerRole,
  propType: string,
  side: string,
  minutesClass: MinutesConfidence,
  gameScript: GameScript,
  edge: number,
  passesBadGameCheck: boolean
): { score: number; factors: ConfidenceFactors } {
  const factors: ConfidenceFactors = {
    roleStatAlignment: 0,
    minutesCertainty: 0,
    gameScriptFit: 0,
    medianDistance: 0,
    badGameSurvival: 0,
  };
  
  // Role + Stat Alignment (0-2.5)
  if (isStatAllowed(propType, side, role, gameScript)) {
    factors.roleStatAlignment = 2.5;
  } else {
    factors.roleStatAlignment = 1.0;
  }
  
  // Minutes Certainty (0-2.0)
  switch (minutesClass) {
    case 'LOCKED': factors.minutesCertainty = 2.0; break;
    case 'MEDIUM': factors.minutesCertainty = 1.2; break;
    case 'RISKY': factors.minutesCertainty = 0.5; break;
  }
  
  // Game Script Fit (0-2.0)
  if (gameScript === 'COMPETITIVE') {
    factors.gameScriptFit = 2.0;
  } else if (gameScript === 'SOFT_BLOWOUT') {
    factors.gameScriptFit = 1.3;
  } else {
    factors.gameScriptFit = 0.8;
  }
  
  // Median Distance / Edge (0-2.5)
  const absEdge = Math.abs(edge);
  if (absEdge >= 3.0) {
    factors.medianDistance = 2.5;
  } else if (absEdge >= 2.0) {
    factors.medianDistance = 2.0;
  } else if (absEdge >= 1.0) {
    factors.medianDistance = 1.5;
  } else {
    factors.medianDistance = 0.5;
  }
  
  // Bad Game Survival (0-1.0)
  factors.badGameSurvival = passesBadGameCheck ? 1.0 : 0;
  
  const totalScore = Object.values(factors).reduce((a, b) => a + b, 0);
  
  return { score: totalScore, factors };
}

// ============ HELPER FUNCTIONS ============
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function generateReason(
  role: PlayerRole,
  gameScript: GameScript,
  edge: number,
  minutesClass: MinutesConfidence,
  side: string
): string {
  const parts: string[] = [];
  
  parts.push(`${role} in ${gameScript.toLowerCase().replace('_', ' ')} game`);
  
  if (edge > 0) {
    parts.push(`+${edge.toFixed(1)} edge`);
  } else {
    parts.push(`${edge.toFixed(1)} edge`);
  }
  
  if (minutesClass === 'LOCKED') {
    parts.push('locked minutes');
  }
  
  parts.push(`${side.toUpperCase()} play`);
  
  return parts.join(', ');
}

function inferPosition(playerName: string): string {
  // Default fallback - in production would use player data
  return 'SF';
}

// Prop type to game log column mapping
const PROP_TO_COLUMN: Record<string, string> = {
  'player_points': 'pts',
  'player_rebounds': 'reb',
  'player_assists': 'ast',
  'player_points_rebounds_assists': 'pts_reb_ast',
  'player_threes': 'fg3m',
  'player_steals': 'stl',
  'player_blocks': 'blk',
  'player_turnovers': 'tov',
  'player_points_rebounds': 'pts_reb',
  'player_points_assists': 'pts_ast',
  'player_rebounds_assists': 'reb_ast',
};

function getColumnForProp(propType: string): string {
  const normalized = propType.toLowerCase().replace(/\s+/g, '_');
  return PROP_TO_COLUMN[normalized] || 'pts';
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { action, mode = 'full_slate' } = await req.json();

    console.log(`[Risk Engine] Action: ${action}, Mode: ${mode}`);

    if (action === 'analyze_slate') {
      const today = new Date().toISOString().split('T')[0];
      
      // 1. Fetch active NBA props from unified_props
      const { data: props, error: propsError } = await supabase
        .from('unified_props')
        .select('*')
        .eq('sport', 'basketball_nba')
        .eq('is_active', true)
        .gte('commence_time', today);

      if (propsError) {
        console.error('[Risk Engine] Error fetching props:', propsError);
        throw propsError;
      }

      console.log(`[Risk Engine] Found ${props?.length || 0} active props`);

      // 2. Fetch upcoming games with spreads
      const { data: games } = await supabase
        .from('upcoming_games_cache')
        .select('*')
        .eq('sport', 'basketball_nba')
        .gte('commence_time', today);

      // 3. Fetch player usage metrics
      const { data: usageMetrics } = await supabase
        .from('player_usage_metrics')
        .select('*');

      // 4. Fetch recent game logs
      const { data: gameLogs } = await supabase
        .from('nba_player_game_logs')
        .select('*')
        .order('game_date', { ascending: false })
        .limit(5000);

      const approvedProps: any[] = [];
      const rejectedProps: any[] = [];
      const processedPlayers = new Set<string>();

      for (const prop of (props || [])) {
        try {
          // Skip if we already have a prop from this player (no multiple props from same player)
          if (processedPlayers.has(prop.player_name)) {
            rejectedProps.push({
              ...prop,
              rejection_reason: 'Multiple props from same player not allowed'
            });
            continue;
          }

        // Find game context
        const game = games?.find(g => 
          g.event_id === prop.event_id ||
          prop.description?.includes(g.home_team) ||
          prop.description?.includes(g.away_team)
        );
        
        // Try to get spread from game, fallback to record differential estimate
        let spread = game?.spread || 0;
        if (spread === 0 && prop.record_differential) {
          // Each 0.1 win % differential ~ 3 point spread
          spread = prop.record_differential * 30;
        }
        
        // STEP 1: Game Script Classification
        const gameScript = classifyGameScript(spread);
        
        // Get player metrics
        const playerUsage = usageMetrics?.find(u => 
          u.player_name?.toLowerCase() === prop.player_name?.toLowerCase()
        );
        
        const avgMinutes = playerUsage?.avg_minutes || 28;
        const usageRate = playerUsage?.usage_rate || 20;
        const position = playerUsage?.position || inferPosition(prop.player_name);
        
        // STEP 2: Player Role Classification
        const role = classifyPlayerRole(usageRate, avgMinutes, position);
        
        // Determine side (over/under)
        const side = prop.recommended_side || 
          (prop.edge && prop.edge > 0 ? 'over' : 'under') ||
          'over';
        
        // STEP 3: Blacklist Check
        const threePtAttempts = playerUsage?.avg_3pt_attempts || 0;
        const blacklistCheck = isStatBlacklisted(
          prop.prop_type,
          side,
          role,
          gameScript,
          threePtAttempts
        );
        
        if (blacklistCheck.blocked) {
          rejectedProps.push({
            ...prop,
            rejection_reason: blacklistCheck.reason,
            player_role: role,
            game_script: gameScript
          });
          continue;
        }
        
        // STEP 4: Allowed Stats Check
        if (!isStatAllowed(prop.prop_type, side, role, gameScript)) {
          rejectedProps.push({
            ...prop,
            rejection_reason: `Stat not allowed for ${role} in ${gameScript}`,
            player_role: role,
            game_script: gameScript
          });
          continue;
        }
        
        // Get player's recent game logs for this stat
        const column = getColumnForProp(prop.prop_type);
        const playerLogs = gameLogs?.filter(log => 
          log.player_name?.toLowerCase() === prop.player_name?.toLowerCase()
        ).slice(0, 10);
        
        const statValues = playerLogs?.map(log => {
          if (column === 'pts_reb_ast') {
            return (log.pts || 0) + (log.reb || 0) + (log.ast || 0);
          }
          if (column === 'pts_reb') {
            return (log.pts || 0) + (log.reb || 0);
          }
          if (column === 'pts_ast') {
            return (log.pts || 0) + (log.ast || 0);
          }
          if (column === 'reb_ast') {
            return (log.reb || 0) + (log.ast || 0);
          }
          return log[column] || 0;
        }) || [];
        
        // STEP 5: Median Bad Game Check
        const { passes: passesBadGame, badGameFloor } = passesMedianBadGameCheck(
          statValues,
          prop.current_line || prop.line,
          side
        );
        
        if (!passesBadGame && statValues.length >= 5) {
          rejectedProps.push({
            ...prop,
            rejection_reason: 'Fails bad game survival check',
            player_role: role,
            game_script: gameScript,
            bad_game_floor: badGameFloor
          });
          continue;
        }
        
        // STEP 6: Minutes Confidence Filter
        const minutesClass = classifyMinutes(avgMinutes);
        const isOver = side.toLowerCase() === 'over';
        
        if (minutesClass === 'RISKY' && isOver) {
          rejectedProps.push({
            ...prop,
            rejection_reason: 'Risky minutes + OVER not allowed',
            player_role: role,
            game_script: gameScript,
            minutes_class: minutesClass
          });
          continue;
        }
        
        // Calculate median and edge
        const trueMedian = calculateMedian(statValues);
        const line = prop.current_line || prop.line;
        const edge = isOver ? trueMedian - line : line - trueMedian;
        
        // STEP 7: Confidence Scoring
        const { score, factors } = calculateConfidence(
          role,
          prop.prop_type,
          side,
          minutesClass,
          gameScript,
          edge,
          passesBadGame
        );
        
        // Minimum confidence threshold: 7.7
        if (score < 7.7) {
          rejectedProps.push({
            ...prop,
            rejection_reason: `Confidence ${score.toFixed(1)} < 7.7 threshold`,
            player_role: role,
            game_script: gameScript,
            confidence_score: score
          });
          continue;
        }
        
        // APPROVED!
        const reason = generateReason(role, gameScript, edge, minutesClass, side);
        
        approvedProps.push({
          player_name: prop.player_name,
          team_name: prop.team_name,
          opponent: game?.away_team === prop.team_name ? game?.home_team : game?.away_team,
          prop_type: prop.prop_type,
          line,
          side,
          player_role: role,
          game_script: gameScript,
          minutes_class: minutesClass,
          avg_minutes: avgMinutes,
          usage_rate: usageRate,
          spread,
          true_median: trueMedian,
          edge,
          bad_game_floor: badGameFloor,
          confidence_score: score,
          confidence_factors: factors,
          reason,
          event_id: prop.event_id,
          game_date: today
        });
        
        processedPlayers.add(prop.player_name);
        } catch (propError: unknown) {
          const errorMessage = propError instanceof Error ? propError.message : 'Unknown error';
          console.error(`[Risk Engine] Error processing ${prop.player_name}:`, propError);
          rejectedProps.push({
            ...prop,
            rejection_reason: `Processing error: ${errorMessage}`
          });
          continue;
        }
      }
      
      // Sort by confidence
      approvedProps.sort((a, b) => b.confidence_score - a.confidence_score);
      
      // Daily Hitter Mode: Filter to >= 8.2 confidence, max 3 picks
      let finalPicks = approvedProps;
      if (mode === 'daily_hitter') {
        finalPicks = approvedProps
          .filter(p => p.confidence_score >= 8.2)
          .slice(0, 3);
      }
      
      // Store approved picks in database
      if (finalPicks.length > 0) {
        const { error: insertError } = await supabase
          .from('nba_risk_engine_picks')
          .upsert(
            finalPicks.map(pick => ({
              ...pick,
              mode,
              created_at: new Date().toISOString()
            })),
            { onConflict: 'player_name,game_date,prop_type' }
          );
        
        if (insertError) {
          console.error('[Risk Engine] Error storing picks:', insertError);
        }
      }
      
      console.log(`[Risk Engine] Approved: ${finalPicks.length}, Rejected: ${rejectedProps.length}`);
      
      return new Response(JSON.stringify({
        success: true,
        approvedCount: finalPicks.length,
        rejectedCount: rejectedProps.length,
        approved: finalPicks,
        rejected: rejectedProps.slice(0, 20), // Limit rejected for response size
        mode,
        gameDate: today
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (action === 'get_picks') {
      const today = new Date().toISOString().split('T')[0];
      
      let query = supabase
        .from('nba_risk_engine_picks')
        .select('*')
        .eq('game_date', today)
        .order('confidence_score', { ascending: false });
      
      if (mode === 'daily_hitter') {
        query = query.gte('confidence_score', 8.2).limit(3);
      }
      
      const { data: picks, error } = await query;
      
      if (error) {
        throw error;
      }
      
      return new Response(JSON.stringify({
        success: true,
        picks: picks || [],
        mode
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ 
      error: 'Invalid action. Use "analyze_slate" or "get_picks"' 
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Risk Engine] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ 
      success: false,
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
