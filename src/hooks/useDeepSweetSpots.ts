import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getEasternDate } from "@/lib/dateUtils";
import type { 
  DeepSweetSpot, 
  PropType, 
  QualityTier, 
  MinutesVerdict, 
  MomentumTier,
  L10Stats,
  L5Stats,
  ProductionMetrics,
  H2HData,
  JuiceAnalysis,
  SweetSpotStats,
  PickSide
} from "@/types/sweetSpot";
import { PROP_TYPE_CONFIG, QUALITY_THRESHOLDS, JUICE_THRESHOLDS } from "@/types/sweetSpot";

interface UnifiedProp {
  id: string;
  player_name: string;
  prop_type: string;
  current_line: number;
  over_price: number | null;
  under_price: number | null;
  game_description: string | null;
  commence_time: string | null;
}

interface GameLog {
  player_name: string;
  game_date: string;
  points: number | null;
  assists: number | null;
  threes_made: number | null;
  blocks: number | null;
  minutes_played: number | null;
  usage_rate: number | null;
}

interface MatchupHistory {
  player_name: string;
  opponent: string;
  prop_type: string | null;
  avg_stat: number | null;
  min_stat: number | null;
  max_stat: number | null;
  games_played: number | null;
}

// Map unified_props prop_type to our PropType
function mapPropType(propType: string): PropType | null {
  const normalized = propType.toLowerCase().replace(/[_\s]/g, '');
  if (normalized.includes('point') || normalized === 'pts') return 'points';
  if (normalized.includes('assist') || normalized === 'ast') return 'assists';
  if (normalized.includes('three') || normalized.includes('3pt') || normalized === '3pm') return 'threes';
  if (normalized.includes('block') || normalized === 'blk') return 'blocks';
  return null;
}

// Extract opponent from game description
function extractOpponent(gameDescription: string | null, playerName: string): string {
  if (!gameDescription) return 'Unknown';
  // Format: "Team A @ Team B" or "Team A vs Team B"
  const parts = gameDescription.split(/[@vs]+/i).map(s => s.trim());
  if (parts.length >= 2) {
    // Return the opponent (not the player's team)
    return parts[1] || parts[0];
  }
  return gameDescription;
}

// Extract team name from game description
function extractTeamName(gameDescription: string | null): string {
  if (!gameDescription) return 'Unknown';
  const parts = gameDescription.split(/[@vs]+/i).map(s => s.trim());
  return parts[0] || 'Unknown';
}

// Calculate L10 stats from game logs
function calculateL10Stats(logs: GameLog[], field: string, line: number, side: PickSide): L10Stats {
  const values = logs
    .slice(0, 10)
    .map(log => log[field as keyof GameLog] as number | null)
    .filter((v): v is number => v !== null && v !== undefined);
  
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, median: 0, hitCount: 0, gamesPlayed: 0 };
  }
  
  const sorted = [...values].sort((a, b) => a - b);
  const hitCount = side === 'over' 
    ? values.filter(v => v > line).length 
    : values.filter(v => v < line).length;
  
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    median: sorted[Math.floor(sorted.length / 2)],
    hitCount,
    gamesPlayed: values.length,
  };
}

// Calculate L5 stats for momentum
function calculateL5Stats(logs: GameLog[], field: string): L5Stats {
  const values = logs
    .slice(0, 5)
    .map(log => log[field as keyof GameLog] as number | null)
    .filter((v): v is number => v !== null && v !== undefined);
  
  if (values.length === 0) {
    return { avg: 0, gamesPlayed: 0 };
  }
  
  return {
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    gamesPlayed: values.length,
  };
}

// Calculate momentum tier from L5/L10 ratio
function calculateMomentum(l5Avg: number, l10Avg: number): { tier: MomentumTier; ratio: number } {
  if (l10Avg === 0) return { tier: 'NORMAL', ratio: 1 };
  const ratio = l5Avg / l10Avg;
  
  if (ratio >= 1.15) return { tier: 'HOT', ratio };
  if (ratio <= 0.85) return { tier: 'COLD', ratio };
  return { tier: 'NORMAL', ratio };
}

// Calculate production metrics
function calculateProduction(
  logs: GameLog[], 
  field: string, 
  line: number
): ProductionMetrics {
  const validLogs = logs.filter(log => 
    log.minutes_played !== null && 
    log.minutes_played > 0 &&
    log[field as keyof GameLog] !== null
  );
  
  if (validLogs.length === 0) {
    return {
      statPerMinute: 0,
      avgMinutes: 0,
      minutesNeeded: Infinity,
      verdict: 'UNLIKELY',
    };
  }
  
  // Use total stats / total minutes for accurate weighted production rate
  const totalStats = validLogs.reduce((sum, log) => {
    return sum + (log[field as keyof GameLog] as number);
  }, 0);
  const totalMinutes = validLogs.reduce((sum, log) => {
    return sum + (log.minutes_played || 0);
  }, 0);
  const statPerMinute = totalMinutes > 0 ? totalStats / totalMinutes : 0;
  
  const avgMinutes = validLogs.reduce((sum, log) => sum + (log.minutes_played || 0), 0) / validLogs.length;
  const minutesNeeded = statPerMinute > 0 ? line / statPerMinute : Infinity;
  
  let verdict: MinutesVerdict = 'UNLIKELY';
  if (minutesNeeded <= avgMinutes * 0.9) verdict = 'CAN_MEET';
  else if (minutesNeeded <= avgMinutes * 1.1) verdict = 'RISKY';
  
  return { statPerMinute, avgMinutes, minutesNeeded, verdict };
}

// Calculate juice analysis
function calculateJuice(price: number | null, side: PickSide): JuiceAnalysis {
  const effectivePrice = price ?? -110;
  
  let valueBoost = 0;
  if (effectivePrice >= JUICE_THRESHOLDS.VALUE) {
    valueBoost = 0.15; // Plus money bonus
  } else if (effectivePrice >= JUICE_THRESHOLDS.LIGHT) {
    valueBoost = 0; // Neutral
  } else if (effectivePrice >= JUICE_THRESHOLDS.MEDIUM) {
    valueBoost = -0.05; // Medium juice penalty
  } else {
    valueBoost = -0.10; // Heavy juice penalty
  }
  
  return {
    price: effectivePrice,
    valueBoost,
    isValuePlay: effectivePrice >= JUICE_THRESHOLDS.VALUE,
    isTrap: effectivePrice < JUICE_THRESHOLDS.MEDIUM,
  };
}

// Calculate floor protection
function calculateFloorProtection(l10Stats: L10Stats, line: number, side: PickSide): number {
  if (line === 0) return 1;
  
  if (side === 'over') {
    return l10Stats.min / line;
  } else {
    // For unders, check if max is below line
    return l10Stats.max <= line ? 1.0 : line / l10Stats.max;
  }
}

// Calculate edge
function calculateEdge(l10Avg: number, line: number, side: PickSide): number {
  if (side === 'over') {
    return l10Avg - line;
  } else {
    return line - l10Avg;
  }
}

// Calculate usage boost
function calculateUsageBoost(usageRate: number | null): number {
  if (usageRate === null) return 0;
  if (usageRate >= 30) return 0.10; // High usage = reliable volume
  if (usageRate >= 25) return 0.05;
  if (usageRate >= 20) return 0.02;
  return 0;
}

// Calculate H2H boost
function calculateH2HBoost(h2h: H2HData | null, line: number, side: PickSide): number {
  if (!h2h || h2h.gamesPlayed < 2) return 0;
  
  if (side === 'over') {
    if (h2h.minStat >= line) return 0.15; // Always hits vs this opponent
    if (h2h.avgStat >= line * 1.15) return 0.10;
    if (h2h.avgStat >= line) return 0.05;
    if (h2h.avgStat < line * 0.85) return -0.10; // Struggles vs this opponent
  } else {
    if (h2h.maxStat <= line) return 0.15;
    if (h2h.avgStat <= line * 0.85) return 0.10;
    if (h2h.avgStat <= line) return 0.05;
    if (h2h.avgStat > line * 1.15) return -0.10;
  }
  
  return 0;
}

// Calculate composite sweet spot score (0-100)
function calculateSweetSpotScore(
  floorProtection: number,
  edge: number,
  hitRateL10: number,
  usageBoost: number,
  juiceBoost: number,
  h2hBoost: number,
  line: number
): number {
  // Normalize edge to 0-1 scale (assuming max edge of ~10)
  const normalizedEdge = Math.min(Math.max(edge / 10, -1), 1);
  const edgeScore = (normalizedEdge + 1) / 2; // Convert -1..1 to 0..1
  
  // Normalize floor protection (cap at 1.5 for scoring)
  const floorScore = Math.min(floorProtection, 1.5) / 1.5;
  
  const score = 
    (floorScore * 0.25) +
    (edgeScore * 0.20) +
    (hitRateL10 * 0.25) +
    ((usageBoost + 0.1) / 0.2 * 0.10) + // Normalize usage boost
    ((juiceBoost + 0.15) / 0.30 * 0.10) + // Normalize juice boost
    ((h2hBoost + 0.15) / 0.30 * 0.10); // Normalize h2h boost
  
  return Math.round(score * 100);
}

// Classify quality tier
function classifyQualityTier(
  floorProtection: number,
  hitRateL10: number,
  edge: number
): QualityTier {
  // ELITE: L10 min >= line AND 100% hit rate
  if (floorProtection >= QUALITY_THRESHOLDS.ELITE.minFloor && 
      hitRateL10 >= QUALITY_THRESHOLDS.ELITE.minHitRate) {
    return 'ELITE';
  }
  
  // PREMIUM: L10 min >= line OR 90%+ hit rate with positive edge
  if (floorProtection >= QUALITY_THRESHOLDS.PREMIUM.minFloor ||
      (hitRateL10 >= QUALITY_THRESHOLDS.PREMIUM.minHitRate && edge > 0)) {
    return 'PREMIUM';
  }
  
  // STRONG: 80-89% hit rate with positive edge
  if (hitRateL10 >= QUALITY_THRESHOLDS.STRONG.minHitRate && edge > 0) {
    return 'STRONG';
  }
  
  // STANDARD: 70-79% hit rate
  if (hitRateL10 >= QUALITY_THRESHOLDS.STANDARD.minHitRate) {
    return 'STANDARD';
  }
  
  // AVOID: Negative edge OR <70% hit rate
  return 'AVOID';
}

// Determine optimal side (over vs under)
function determineOptimalSide(l10Stats: L10Stats, line: number): PickSide {
  const overHitRate = l10Stats.gamesPlayed > 0 
    ? l10Stats.hitCount / l10Stats.gamesPlayed 
    : 0;
  const underHitRate = l10Stats.gamesPlayed > 0
    ? (l10Stats.gamesPlayed - l10Stats.hitCount) / l10Stats.gamesPlayed
    : 0;
    
  // Check floor protection for over
  const overFloor = l10Stats.min / line;
  
  // If L10 min covers the line, strongly favor over
  if (overFloor >= 1.0) return 'over';
  
  // If L10 max is below line, favor under
  if (l10Stats.max < line) return 'under';
  
  // Otherwise, pick side with better hit rate
  return overHitRate >= underHitRate ? 'over' : 'under';
}

export function useDeepSweetSpots() {
  const todayET = getEasternDate();
  
  return useQuery({
    queryKey: ['deep-sweet-spots', todayET],
    queryFn: async (): Promise<{ spots: DeepSweetSpot[]; stats: SweetSpotStats }> => {
      // Calculate UTC boundaries for today in Eastern Time
      const todayStart = new Date(`${todayET}T00:00:00-05:00`);
      const tomorrowStart = new Date(todayStart);
      tomorrowStart.setDate(tomorrowStart.getDate() + 1);
      
      // Fetch live lines from unified_props
      const { data: propsData, error: propsError } = await supabase
        .from('unified_props')
        .select('id, player_name, prop_type, current_line, over_price, under_price, game_description, commence_time')
        .gte('commence_time', todayStart.toISOString())
        .lt('commence_time', tomorrowStart.toISOString())
        .not('current_line', 'is', null);
      
      if (propsError) {
        console.error('[useDeepSweetSpots] Props fetch error:', propsError);
        throw propsError;
      }
      
      const props = (propsData || []) as UnifiedProp[];
      
      // Filter to supported prop types
      const supportedProps = props
        .map(p => ({ ...p, mappedType: mapPropType(p.prop_type) }))
        .filter((p): p is typeof p & { mappedType: PropType } => p.mappedType !== null);
      
      if (supportedProps.length === 0) {
        return { 
          spots: [], 
          stats: {
            totalPicks: 0,
            eliteCount: 0,
            premiumCount: 0,
            strongCount: 0,
            standardCount: 0,
            avoidCount: 0,
            uniqueTeams: 0,
            byPropType: { points: 0, assists: 0, threes: 0, blocks: 0 },
          }
        };
      }
      
      // Get unique player names
      const playerNames = [...new Set(supportedProps.map(p => p.player_name))];
      
      // Fetch L10 game logs for all players
      const { data: logsData, error: logsError } = await supabase
        .from('nba_player_game_logs')
        .select('player_name, game_date, points, assists, threes_made, blocks, minutes_played, usage_rate')
        .in('player_name', playerNames)
        .order('game_date', { ascending: false })
        .limit(playerNames.length * 15); // Get extra to ensure L10 for each
      
      if (logsError) {
        console.error('[useDeepSweetSpots] Logs fetch error:', logsError);
      }
      
      const logs = (logsData || []) as GameLog[];
      
      // Group logs by player
      const logsByPlayer = new Map<string, GameLog[]>();
      for (const log of logs) {
        const existing = logsByPlayer.get(log.player_name) || [];
        existing.push(log);
        logsByPlayer.set(log.player_name, existing);
      }
      
      // Fetch matchup history
      const { data: matchupData, error: matchupError } = await supabase
        .from('matchup_history')
        .select('player_name, opponent, prop_type, avg_stat, min_stat, max_stat, games_played')
        .in('player_name', playerNames);
      
      if (matchupError) {
        console.error('[useDeepSweetSpots] Matchup fetch error:', matchupError);
      }
      
      const matchups = (matchupData || []) as MatchupHistory[];
      
      // Group matchups by player+opponent
      const matchupsByPlayerOpponent = new Map<string, MatchupHistory>();
      for (const m of matchups) {
        const key = `${m.player_name}|${m.opponent}`;
        matchupsByPlayerOpponent.set(key, m);
      }
      
      // Process each prop into a DeepSweetSpot
      const spots: DeepSweetSpot[] = [];
      
      for (const prop of supportedProps) {
        const playerLogs = logsByPlayer.get(prop.player_name) || [];
        if (playerLogs.length < 5) continue; // Need minimum data
        
        const propConfig = PROP_TYPE_CONFIG[prop.mappedType];
        const field = propConfig.gameLogField;
        const line = prop.current_line;
        
        // Calculate L10 stats for OVER first to determine optimal side
        const l10StatsOver = calculateL10Stats(playerLogs, field, line, 'over');
        const optimalSide = determineOptimalSide(l10StatsOver, line);
        
        // Recalculate with optimal side
        const l10Stats = optimalSide === 'over' 
          ? l10StatsOver 
          : calculateL10Stats(playerLogs, field, line, 'under');
        
        const l5Stats = calculateL5Stats(playerLogs, field);
        const { tier: momentum, ratio: momentumRatio } = calculateMomentum(l5Stats.avg, l10Stats.avg);
        
        const production = calculateProduction(playerLogs, field, line);
        const floorProtection = calculateFloorProtection(l10Stats, line, optimalSide);
        const edge = calculateEdge(l10Stats.avg, line, optimalSide);
        const hitRateL10 = l10Stats.gamesPlayed > 0 ? l10Stats.hitCount / l10Stats.gamesPlayed : 0;
        
        // Get usage rate from most recent log
        const usageRate = playerLogs[0]?.usage_rate ?? null;
        const usageBoost = calculateUsageBoost(usageRate);
        
        // Get juice for the optimal side
        const price = optimalSide === 'over' ? prop.over_price : prop.under_price;
        const juice = calculateJuice(price, optimalSide);
        
        // Extract opponent and get H2H data
        const opponentName = extractOpponent(prop.game_description, prop.player_name);
        const matchupKey = `${prop.player_name}|${opponentName}`;
        const matchupRecord = matchupsByPlayerOpponent.get(matchupKey);
        
        let h2h: H2HData | null = null;
        if (matchupRecord && matchupRecord.games_played && matchupRecord.games_played > 0) {
          const matchupField = propConfig.matchupKey as keyof MatchupHistory;
          const avgStat = (matchupRecord[matchupField] as number) ?? 0;
          
          h2h = {
            opponentName,
            avgStat,
            minStat: avgStat * 0.8, // Estimate min as 80% of avg
            maxStat: avgStat * 1.2, // Estimate max as 120% of avg
            gamesPlayed: matchupRecord.games_played,
            hitRate: avgStat > line ? 1 : avgStat / line,
          };
        }
        
        const h2hBoost = calculateH2HBoost(h2h, line, optimalSide);
        
        // Calculate final score and tier
        const sweetSpotScore = calculateSweetSpotScore(
          floorProtection,
          edge,
          hitRateL10,
          usageBoost,
          juice.valueBoost,
          h2hBoost,
          line
        );
        
        const qualityTier = classifyQualityTier(floorProtection, hitRateL10, edge);
        
        // Skip AVOID tier with very low hit rates
        if (qualityTier === 'AVOID' && hitRateL10 < 0.5) continue;
        
        spots.push({
          id: prop.id,
          playerName: prop.player_name,
          teamName: extractTeamName(prop.game_description),
          opponentName,
          propType: prop.mappedType,
          side: optimalSide,
          line,
          overPrice: prop.over_price ?? -110,
          underPrice: prop.under_price ?? -110,
          gameDescription: prop.game_description ?? '',
          gameTime: prop.commence_time ?? '',
          l10Stats,
          floorProtection,
          edge,
          hitRateL10,
          l5Stats,
          momentum,
          momentumRatio,
          production,
          h2h,
          h2hBoost,
          juice,
          usageRate,
          usageBoost,
          sweetSpotScore,
          qualityTier,
          analysisTimestamp: new Date().toISOString(),
        });
      }
      
      // DEDUPLICATION: Keep only best line per player+propType
      const uniqueSpots = new Map<string, DeepSweetSpot>();
      for (const spot of spots) {
        const key = `${spot.playerName.toLowerCase()}|${spot.propType}`;
        const existing = uniqueSpots.get(key);
        if (!existing || 
            spot.floorProtection > existing.floorProtection ||
            (spot.floorProtection === existing.floorProtection && spot.sweetSpotScore > existing.sweetSpotScore)) {
          uniqueSpots.set(key, spot);
        }
      }
      const dedupedSpots = Array.from(uniqueSpots.values());
      
      // Sort by quality tier priority then score
      const tierOrder: Record<QualityTier, number> = {
        ELITE: 0,
        PREMIUM: 1,
        STRONG: 2,
        STANDARD: 3,
        AVOID: 4,
      };
      
      dedupedSpots.sort((a, b) => {
        const tierDiff = tierOrder[a.qualityTier] - tierOrder[b.qualityTier];
        if (tierDiff !== 0) return tierDiff;
        return b.sweetSpotScore - a.sweetSpotScore;
      });
      
      // Calculate stats from deduplicated spots
      const stats: SweetSpotStats = {
        totalPicks: dedupedSpots.length,
        eliteCount: dedupedSpots.filter(s => s.qualityTier === 'ELITE').length,
        premiumCount: dedupedSpots.filter(s => s.qualityTier === 'PREMIUM').length,
        strongCount: dedupedSpots.filter(s => s.qualityTier === 'STRONG').length,
        standardCount: dedupedSpots.filter(s => s.qualityTier === 'STANDARD').length,
        avoidCount: dedupedSpots.filter(s => s.qualityTier === 'AVOID').length,
        uniqueTeams: new Set(dedupedSpots.map(s => s.teamName)).size,
        byPropType: {
          points: dedupedSpots.filter(s => s.propType === 'points').length,
          assists: dedupedSpots.filter(s => s.propType === 'assists').length,
          threes: dedupedSpots.filter(s => s.propType === 'threes').length,
          blocks: dedupedSpots.filter(s => s.propType === 'blocks').length,
        },
      };
      
      return { spots: dedupedSpots, stats };
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 30, // 30 minutes
  });
}
