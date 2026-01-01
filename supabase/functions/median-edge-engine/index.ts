import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to calculate median
function median(arr: number[]): number {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Helper to calculate standard deviation
function stdDev(arr: number[]): number {
  if (!arr || arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

// 🆕 Recency-weighted median: game[0] is most recent (weights: 10, 5, 3, 2, 2...)
function recencyWeightedMedian(values: number[]): number {
  if (!values || values.length === 0) return 0;
  const weighted: number[] = [];
  values.forEach((v, i) => {
    const w = Math.max(1, Math.round(10 / (i + 1))); // 10,5,3,2,2...
    for (let k = 0; k < w; k++) weighted.push(v);
  });
  return median(weighted);
}

// 🆕 Log-scaled minutes normalization: prevents low-min spikes from exploding projections
function minutesAdjustedStat(stat: number, minutes: number, expectedMinutes: number): number {
  if (!minutes || minutes <= 0) return stat;
  const ratio = expectedMinutes / minutes;
  return stat * Math.log2(1 + Math.max(0, ratio));
}

// 🆕 FIX #4: Opponent Defense Adjustment - adjusts for matchup difficulty
function opponentAdjustment(stat: number, opponentDefRank?: number): number {
  if (!opponentDefRank || opponentDefRank <= 0) return stat;
  
  // Top 5 defense = harder matchup (-8%)
  // Bottom 5 defense = easier matchup (+8%)
  if (opponentDefRank <= 5) return stat * 0.92;
  if (opponentDefRank >= 25) return stat * 1.08;
  if (opponentDefRank <= 10) return stat * 0.96;
  if (opponentDefRank >= 20) return stat * 1.04;
  return stat;
}

interface EngineInput {
  player_name: string;
  stat_type: 'points' | 'rebounds' | 'assists';
  sportsbook_line: number;
  game_location: 'home' | 'away';
  expected_minutes: number;
  spread: number;
  injury_context: 'none' | 'teammate_out' | 'minutes_limit';
  odds_open: number;
  odds_current: number;
  last_10_game_stats: number[];
  last_10_game_minutes: number[];
  matchup_stats: number[]; // Stats vs specific opponent
  usage_metrics: number[];
  home_stats: number[];
  away_stats: number[];
  games_analyzed: number;
  event_id?: string;
  team_name?: string;
  opponent_team?: string;
  game_time?: string;
  opponent_def_rank?: number; // 🆕 1-30 defense ranking for opponent adjustment
}

interface EngineOutput {
  player_name: string;
  stat_type: string;
  sportsbook_line: number;
  true_median: number;
  edge: number;
  recommendation: string;
  confidence_flag: string;
  alt_line_suggestion: number | null;
  reason_summary: string;
  m1_recent_form: number;
  m2_matchup: number;
  m3_minutes_weighted: number;
  m4_usage: number;
  m5_location: number;
  adjustments: {
    blowout_risk: number;
    injury_boost: number;
    minutes_limit: number;
  };
  is_volatile: boolean;
  std_dev: number;
}

function calculateMedianEdge(input: EngineInput): EngineOutput {
  // Calculate volatility FIRST (needed for dampening)
  const statStdDev = stdDev(input.last_10_game_stats);
  const statMean = input.last_10_game_stats.length > 0 
    ? input.last_10_game_stats.reduce((a, b) => a + b, 0) / input.last_10_game_stats.length 
    : 0;
  const isVolatile = statMean > 0 && (statStdDev / statMean) > 0.35;

  // 1️⃣ RECENT FORM MEDIAN (M1) - 30% weight (last 7 games, RECENCY-WEIGHTED)
  // 🆕 FIX #1: Use recency-weighted median instead of raw median
  const recentStats = input.last_10_game_stats.slice(0, 7);
  const M1 = recencyWeightedMedian(recentStats);

  // 2️⃣ MATCHUP MEDIAN (M2) - 20% weight (games vs specific opponent)
  // If no matchup data, fall back to recent form
  let M2 = input.matchup_stats.length > 0 
    ? median(input.matchup_stats) 
    : M1;
  
  // 🆕 FIX #4: Apply opponent defense adjustment to matchup median
  if (input.opponent_def_rank) {
    M2 = opponentAdjustment(M2, input.opponent_def_rank);
  }

  // 3️⃣ MINUTES-WEIGHTED MEDIAN (M3) - 15% weight (all 10 games)
  // 🆕 FIX #2: Use log-scaled minutes normalization instead of linear
  const adjustedStats = input.last_10_game_stats.map((stat, idx) => {
    const minutes = input.last_10_game_minutes[idx] || input.expected_minutes;
    return minutesAdjustedStat(stat, minutes, input.expected_minutes);
  });
  const M3 = median(adjustedStats);

  // 4️⃣ USAGE-BASED MEDIAN (M4) - 20% weight
  // 🆕 FIX: Proxy using per-minute production (no double counting)
  const perMinute = input.last_10_game_stats.map((stat, i) => {
    const min = input.last_10_game_minutes[i] || input.expected_minutes || 30;
    return min > 0 ? stat / min : stat / 30;
  });
  const M4 = median(perMinute) * input.expected_minutes;

  // 5️⃣ LOCATION SPLIT MEDIAN (M5) - 15% weight
  const M5 = input.game_location === 'home' 
    ? median(input.home_stats) 
    : median(input.away_stats);

  // TRUE MEDIAN CALCULATION (Updated Weights v2)
  // M1: 30% (up from 25%), M2: 20%, M3: 15% (down from 20%), M4: 20%, M5: 15%
  let trueMedian = (M1 * 0.30) + (M2 * 0.20) + (M3 * 0.15) + (M4 * 0.20) + (M5 * 0.15);

  // 🆕 FIX #4: Apply opponent defense adjustment to final median
  if (input.opponent_def_rank) {
    trueMedian = opponentAdjustment(trueMedian, input.opponent_def_rank);
  }

  // Track adjustments
  const adjustments = {
    blowout_risk: 0,
    injury_boost: 0,
    minutes_limit: 0,
  };

  // 🛑 AUTO-ADJUSTMENTS
  // Blowout Risk
  if (input.spread >= 10) {
    adjustments.blowout_risk = -1.0;
    trueMedian -= 1.0;
  }

  // Injury Usage Boost
  if (input.injury_context === 'teammate_out') {
    adjustments.injury_boost = 1.0;
    trueMedian += 1.0;
  }

  // Minutes Restriction
  if (input.injury_context === 'minutes_limit') {
    adjustments.minutes_limit = -1.5;
    trueMedian -= 1.5;
  }

  // Juice Lag Confidence Flag
  const confidenceFlag = (input.odds_current <= input.odds_open - 30) 
    ? 'JUICE_LAG_SHARP' 
    : 'NORMAL';

  // EDGE CALCULATION
  let edge = trueMedian - input.sportsbook_line;

  // 🆕 FIX #5: Volatility-aware edge dampening
  if (isVolatile) {
    edge *= 0.75;
  }

  // 🎯 ACCURACY MODE THRESHOLDS
  const LEAN_EDGE = 1.5;
  const STRONG_EDGE = 4.0;      // moved up from 3.0
  const TRAP_EDGE = 5.0;        // volatile + extreme -> downgrade
  const HARD_NO_BET_EDGE = 8.0; // too extreme = missing context

  let recommendation: string = 'NO BET';
  let reasonSummary = '';

  // Hard no-bet: edge too extreme (likely missing context / mispricing)
  if (Math.abs(edge) >= HARD_NO_BET_EDGE) {
    recommendation = 'NO BET';
    reasonSummary = 'Edge too extreme - likely mispriced or missing context.';
  } else if (input.games_analyzed < 6) {
    // Low sample size protection
    recommendation = 'NO BET';
    reasonSummary = 'Insufficient sample size (need 6+ games).';
  } else {
    // Default: Lean zones (primary picks)
    if (edge >= LEAN_EDGE) recommendation = 'LEAN OVER';
    if (edge <= -LEAN_EDGE) recommendation = 'LEAN UNDER';

    // STRONG requires strict gates (rare, high trust)
    if (
      edge >= STRONG_EDGE &&
      !isVolatile &&
      statStdDev <= 3.0 &&
      input.games_analyzed >= 7
    ) {
      recommendation = 'STRONG OVER';
    }

    if (
      edge <= -STRONG_EDGE &&
      !isVolatile &&
      statStdDev <= 3.0 &&
      input.games_analyzed >= 7
    ) {
      recommendation = 'STRONG UNDER';
    }

    // Trap detection: volatile + big edge => downgrade to LEAN
    if (Math.abs(edge) >= TRAP_EDGE && isVolatile) {
      recommendation = edge > 0 ? 'LEAN OVER' : 'LEAN UNDER';
      reasonSummary = 'Extreme edge downgraded due to volatility - potential trap line.';
    }

    // High variance cap: never allow STRONG
    if (statStdDev >= 3.5 && recommendation.includes('STRONG')) {
      recommendation = recommendation.includes('OVER') ? 'LEAN OVER' : 'LEAN UNDER';
      reasonSummary = (reasonSummary || '') + ' Capped at LEAN due to high variance.';
    }
  }

  // 🔄 ALT LINE SUGGESTION (only for LEAN with thin edge)
  let altLineSuggestion: number | null = null;
  if (recommendation.includes('LEAN') && Math.abs(edge) >= 1.0 && Math.abs(edge) < 2.0) {
    altLineSuggestion = recommendation.includes('OVER')
      ? input.sportsbook_line - 1.5
      : input.sportsbook_line + 1.5;
  }

  // 📝 REASON SUMMARY (only build if not already set by guardrails)
  if (!reasonSummary) {
    const reasonParts: string[] = [];
    if (edge > 0) {
      reasonParts.push(`True median of ${trueMedian.toFixed(1)} exceeds book line of ${input.sportsbook_line} by +${edge.toFixed(1)}`);
    } else {
      reasonParts.push(`True median of ${trueMedian.toFixed(1)} is below book line of ${input.sportsbook_line} by ${edge.toFixed(1)}`);
    }
    
    if (M1 > input.sportsbook_line) reasonParts.push('recent form strong');
    if (M2 > input.sportsbook_line) reasonParts.push('favorable matchup history');
    if (input.opponent_def_rank && input.opponent_def_rank >= 25) reasonParts.push('weak opponent defense');
    if (input.opponent_def_rank && input.opponent_def_rank <= 5) reasonParts.push('elite opponent defense');
    if (adjustments.injury_boost > 0) reasonParts.push('teammate injury usage boost');
    if (adjustments.blowout_risk < 0) reasonParts.push('blowout risk adjustment');
    if (confidenceFlag === 'JUICE_LAG_SHARP') reasonParts.push('sharp line movement detected');
    if (isVolatile) reasonParts.push('volatility dampening applied');
    
    reasonSummary = reasonParts.join(' | ') + '.';
  }

  return {
    player_name: input.player_name,
    stat_type: input.stat_type,
    sportsbook_line: input.sportsbook_line,
    true_median: Number(trueMedian.toFixed(2)),
    edge: Number(edge.toFixed(2)),
    recommendation,
    confidence_flag: confidenceFlag,
    alt_line_suggestion: altLineSuggestion,
    reason_summary: reasonSummary,
    m1_recent_form: Number(M1.toFixed(2)),
    m2_matchup: Number(M2.toFixed(2)),
    m3_minutes_weighted: Number(M3.toFixed(2)),
    m4_usage: Number(M4.toFixed(2)),
    m5_location: Number(M5.toFixed(2)),
    adjustments,
    is_volatile: isVolatile,
    std_dev: Number(statStdDev.toFixed(2)),
  };
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

    const body = await req.json().catch(() => ({}));
    const { action = 'analyze', props = [] } = body;

    console.log(`[median-edge-engine] Action: ${action}, Props count: ${props.length}`);

    if (action === 'analyze' && props.length > 0) {
      // Process provided props
      const results: EngineOutput[] = [];
      
      for (const prop of props) {
        // Validate required fields
        if (!prop.player_name || !prop.stat_type || prop.sportsbook_line === undefined) {
          console.log(`[median-edge-engine] Skipping invalid prop:`, prop);
          continue;
        }

        // Apply guardrails
        if (prop.expected_minutes < 24) {
          console.log(`[median-edge-engine] Suppressing ${prop.player_name} - minutes too low: ${prop.expected_minutes}`);
          continue;
        }

        const result = calculateMedianEdge(prop);
        results.push(result);

        // Save to database
        const { error: insertError } = await supabase
          .from('median_edge_picks')
          .insert({
            player_name: result.player_name,
            stat_type: result.stat_type,
            sportsbook_line: result.sportsbook_line,
            true_median: result.true_median,
            edge: result.edge,
            recommendation: result.recommendation,
            confidence_flag: result.confidence_flag,
            alt_line_suggestion: result.alt_line_suggestion,
            reason_summary: result.reason_summary,
            m1_recent_form: result.m1_recent_form,
            m2_matchup: result.m2_matchup,
            m3_minutes_weighted: result.m3_minutes_weighted,
            m4_usage: result.m4_usage,
            m5_location: result.m5_location,
            adjustments: result.adjustments,
            std_dev: result.std_dev,
            is_volatile: result.is_volatile,
            event_id: prop.event_id,
            team_name: prop.team_name,
            opponent_team: prop.opponent_team,
            game_time: prop.game_time,
            expected_minutes: prop.expected_minutes,
            spread: prop.spread,
            injury_context: prop.injury_context,
            odds_open: prop.odds_open,
            odds_current: prop.odds_current,
            game_date: new Date().toISOString().split('T')[0],
          });

        if (insertError) {
          console.error(`[median-edge-engine] Insert error:`, insertError);
        }
      }

      // Filter for actionable picks
      const actionablePicks = results.filter(r => 
        r.recommendation.includes('STRONG') || r.recommendation.includes('LEAN')
      );

      return new Response(JSON.stringify({
        success: true,
        total_analyzed: results.length,
        actionable_picks: actionablePicks.length,
        picks: actionablePicks,
        all_results: results,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get_picks') {
      // Get today's picks from database
      const today = new Date().toISOString().split('T')[0];
      
      const { data: picks, error } = await supabase
        .from('median_edge_picks')
        .select('*')
        .eq('game_date', today)
        .in('recommendation', ['STRONG OVER', 'STRONG UNDER', 'LEAN OVER', 'LEAN UNDER'])
        .order('edge', { ascending: false });

      if (error) {
        console.error('[median-edge-engine] Fetch error:', error);
        throw error;
      }

      return new Response(JSON.stringify({
        success: true,
        picks: picks || [],
        count: picks?.length || 0,
        date: today,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // AUTO MODE: Fetch props from database and analyze them
    if (action === 'analyze_auto') {
      console.log('[median-edge-engine] Running auto analysis...');
      const today = new Date().toISOString().split('T')[0];
      const now = new Date().toISOString();

      // First, clear today's old picks to avoid duplicates
      const { error: deleteError } = await supabase
        .from('median_edge_picks')
        .delete()
        .eq('game_date', today);
      
      if (deleteError) {
        console.log('[median-edge-engine] Delete error (may be empty):', deleteError.message);
      }

      // Fetch player props from unified_props table (correct table name)
      const { data: playerProps, error: propsError } = await supabase
        .from('unified_props')
        .select('*')
        .gte('commence_time', now)
        .eq('is_active', true)
        .in('prop_type', ['player_points', 'player_rebounds', 'player_assists']);

      if (propsError) {
        console.error('[median-edge-engine] Props fetch error:', propsError);
        return new Response(JSON.stringify({
          success: false,
          error: 'Failed to fetch props: ' + propsError.message,
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log(`[median-edge-engine] Found ${playerProps?.length || 0} props from unified_props`);

      // Deduplicate props by player_name + prop_type to avoid processing same player/stat multiple times
      const propsByPlayerStat = new Map<string, typeof playerProps[0]>();
      for (const prop of (playerProps || [])) {
        const key = `${prop.player_name?.toLowerCase()}_${prop.prop_type}`;
        
        if (!propsByPlayerStat.has(key)) {
          propsByPlayerStat.set(key, prop);
        } else {
          // Prefer fanduel/draftkings, or lower line (more conservative)
          const existing = propsByPlayerStat.get(key)!;
          const existingLine = existing.current_line || existing.line || 999;
          const newLine = prop.current_line || prop.line || 999;
          
          if (prop.bookmaker === 'fanduel' || prop.bookmaker === 'draftkings') {
            propsByPlayerStat.set(key, prop);
          } else if (newLine < existingLine && existing.bookmaker !== 'fanduel' && existing.bookmaker !== 'draftkings') {
            propsByPlayerStat.set(key, prop);
          }
        }
      }
      const dedupedProps = Array.from(propsByPlayerStat.values());
      console.log(`[median-edge-engine] Deduped ${playerProps?.length || 0} props to ${dedupedProps.length} unique player/stat combos`);

      // Fetch game logs for recent stats
      const { data: gameLogs, error: logsError } = await supabase
        .from('nba_player_game_logs')
        .select('*')
        .order('game_date', { ascending: false })
        .limit(1000);

      if (logsError) {
        console.error('[median-edge-engine] Game logs error:', logsError);
      }

      console.log(`[median-edge-engine] Found ${gameLogs?.length || 0} game logs`);

      // 🆕 FIX #4: Fetch opponent defense rankings for matchup adjustments
      const { data: defenseRankings, error: defError } = await supabase
        .from('team_defense_rankings')
        .select('team_abbreviation, team_name, overall_rank')
        .eq('sport', 'NBA')
        .eq('is_current', true);

      if (defError) {
        console.log('[median-edge-engine] Defense rankings fetch error (non-fatal):', defError.message);
      }

      // Create defense rank lookup map
      const defRankMap = new Map<string, number>();
      for (const team of (defenseRankings || [])) {
        if (team.team_abbreviation) {
          defRankMap.set(team.team_abbreviation.toLowerCase(), team.overall_rank);
        }
        if (team.team_name) {
          defRankMap.set(team.team_name.toLowerCase(), team.overall_rank);
        }
      }
      console.log(`[median-edge-engine] Loaded ${defRankMap.size} defense ranking entries`);

      const results: EngineOutput[] = [];
      
      // Helper to determine if player is home based on game_description
      const isPlayerHome = (gameDesc: string, teamName: string): boolean => {
        if (!gameDesc || !teamName) return false;
        // Format: "Away Team @ Home Team"
        const parts = gameDesc.split(' @ ');
        if (parts.length === 2) {
          const homeTeam = parts[1].toLowerCase();
          return homeTeam.includes(teamName.toLowerCase()) || teamName.toLowerCase().includes(homeTeam);
        }
        return false;
      };

      for (const prop of dedupedProps) {
        const playerName = prop.player_name;
        // Map prop_type: player_points -> points, player_rebounds -> rebounds, etc.
        let statType = (prop.prop_type || '').replace('player_', '');
        
        // Normalize stat type
        if (!['points', 'rebounds', 'assists'].includes(statType)) {
          continue;
        }

        // Get player's game logs - use LAST 10 GAMES
        const playerLogs = (gameLogs || [])
          .filter((log: any) => log.player_name?.toLowerCase() === playerName?.toLowerCase())
          .slice(0, 10);

        if (playerLogs.length < 3) {
          continue; // Skip silently to reduce log noise
        }

        // Extract stats based on stat type
        const getStatValue = (log: any): number => {
          if (statType === 'points') return log.points || log.pts || 0;
          if (statType === 'rebounds') return log.rebounds || log.reb || 0;
          if (statType === 'assists') return log.assists || log.ast || 0;
          return 0;
        };

        // Get last 10 games stats and minutes
        const last10Stats = playerLogs.map(getStatValue);
        const last10Minutes = playerLogs.map((log: any) => log.minutes || log.min || 30);
        const avgMinutes = last10Minutes.reduce((a: number, b: number) => a + b, 0) / last10Minutes.length;

        // Skip if minutes too low
        if (avgMinutes < 24) {
          continue;
        }

        // Get matchup-specific stats (games against this opponent)
        const opponentName = prop.opponent_team?.toLowerCase() || '';
        const matchupLogs = (gameLogs || [])
          .filter((log: any) => 
            log.player_name?.toLowerCase() === playerName?.toLowerCase() &&
            (log.opponent?.toLowerCase().includes(opponentName) || 
             opponentName.includes(log.opponent?.toLowerCase() || ''))
          )
          .slice(0, 5);
        const matchupStats = matchupLogs.map(getStatValue);

        // Get home/away splits
        const homeLogs = playerLogs.filter((log: any) => log.is_home === true);
        const awayLogs = playerLogs.filter((log: any) => log.is_home === false);
        const homeStats = homeLogs.map(getStatValue);
        const awayStats = awayLogs.map(getStatValue);

        // Determine home/away from game_description
        const gameIsHome = isPlayerHome(prop.game_description || '', prop.team_name || '');

        // 🆕 FIX #4: Look up opponent defense ranking
        const opponentDefRank = defRankMap.get(opponentName) || 
                                defRankMap.get(prop.opponent_team?.toLowerCase() || '') || 
                                undefined;

        const input: EngineInput = {
          player_name: playerName,
          stat_type: statType as 'points' | 'rebounds' | 'assists',
          sportsbook_line: prop.current_line || prop.line || 0,
          game_location: gameIsHome ? 'home' : 'away',
          expected_minutes: avgMinutes,
          spread: 0, // Not available in unified_props
          injury_context: 'none',
          odds_open: -110, // Default opening odds
          odds_current: prop.over_price || -110,
          last_10_game_stats: last10Stats,
          last_10_game_minutes: last10Minutes,
          matchup_stats: matchupStats,
          usage_metrics: last10Stats, // No longer used for double-counting - FIX #3 handles this internally
          home_stats: homeStats.length > 0 ? homeStats : last10Stats,
          away_stats: awayStats.length > 0 ? awayStats : last10Stats,
          games_analyzed: playerLogs.length,
          event_id: prop.event_id,
          team_name: prop.team_name,
          opponent_team: prop.opponent_team,
          game_time: prop.commence_time,
          opponent_def_rank: opponentDefRank, // 🆕 Pass defense ranking
        };

        const result = calculateMedianEdge(input);
        
        // Only save if it's actionable
        if (result.recommendation !== 'NO BET') {
          results.push(result);

          const { error: insertError } = await supabase.from('median_edge_picks').insert({
            player_name: result.player_name,
            stat_type: result.stat_type,
            sportsbook_line: result.sportsbook_line,
            true_median: result.true_median,
            edge: result.edge,
            recommendation: result.recommendation,
            confidence_flag: result.confidence_flag,
            alt_line_suggestion: result.alt_line_suggestion,
            reason_summary: result.reason_summary,
            m1_recent_form: result.m1_recent_form,
            m2_matchup: result.m2_matchup,
            m3_minutes_weighted: result.m3_minutes_weighted,
            m4_usage: result.m4_usage,
            m5_location: result.m5_location,
            adjustments: result.adjustments,
            std_dev: result.std_dev,
            is_volatile: result.is_volatile,
            event_id: input.event_id,
            team_name: input.team_name,
            opponent_team: input.opponent_team,
            game_time: input.game_time,
            expected_minutes: input.expected_minutes,
            spread: input.spread,
            injury_context: input.injury_context,
            odds_open: input.odds_open,
            odds_current: input.odds_current,
            game_date: today,
          });

          if (insertError) {
            console.error(`[median-edge-engine] Insert error for ${playerName}:`, insertError.message);
          }
        }
      }

      const strongPicks = results.filter(r => r.recommendation.includes('STRONG'));
      const leanPicks = results.filter(r => r.recommendation.includes('LEAN'));

      console.log(`[median-edge-engine] Auto analysis complete: ${strongPicks.length} strong, ${leanPicks.length} lean picks from ${dedupedProps.length} unique props`);

      return new Response(JSON.stringify({
        success: true,
        mode: 'auto',
        total_analyzed: dedupedProps.length,
        actionable_picks: results.length,
        strong_picks: strongPicks.length,
        lean_picks: leanPicks.length,
        picks: results,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Default: return engine info
    return new Response(JSON.stringify({
      success: true,
      engine: 'MEDIAN_EDGE_5_PROP_ENGINE',
      version: '1.0.0',
      description: 'Calculate True Median prop line using 5 independent medians with ±3 edge threshold',
      weights: {
        recent_form: 0.25,
        matchup: 0.20,
        minutes_weighted: 0.20,
        usage: 0.20,
        location: 0.15,
      },
      thresholds: {
        strong_over: '+3.0',
        lean_over: '+1.5',
        lean_under: '-1.5',
        strong_under: '-3.0',
      },
      guardrails: {
        min_expected_minutes: 24,
        volatility_threshold: '35% of mean',
        max_parlay_strong_plays: 2,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[median-edge-engine] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
