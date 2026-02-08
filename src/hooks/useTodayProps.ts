import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Get today's date in Eastern Time (America/New_York)
 */
export function getTodayEasternDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Format a specific date in Eastern Time format
 */
export function formatEasternDate(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Get UTC time boundaries for games on an Eastern date.
 * Games on Jan 29th Eastern (7pm ET) are stored as Jan 30th 00:00 UTC.
 */
function getUTCBoundariesForEasternDate(easternDate: string) {
  const nextDay = new Date(easternDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayStr = nextDay.toISOString().split('T')[0];
  
  return {
    startUTC: `${nextDayStr}T00:00:00`,
    endUTC: `${nextDayStr}T12:00:00`,
  };
}

// Configuration for each prop type
const PROP_CONFIG = {
  threes: {
    propType: 'threes',
    sweetSpotCategories: ['THREE_POINT_SHOOTER'],
    gameLogField: 'threes_made' as const,
    reliabilityKey: 'player_threes',
  },
  assists: {
    propType: 'assists',
    sweetSpotCategories: ['BIG_ASSIST_OVER', 'HIGH_ASSIST_UNDER', 'HIGH_ASSIST', 'ASSIST_ANCHOR'],
    gameLogField: 'assists' as const,
    reliabilityKey: 'player_assists',
  },
} as const;

export type PropType = keyof typeof PROP_CONFIG;

export interface TodayPropPick {
  id: string;
  player_name: string;
  prop_type: string;
  category: string;
  recommended_line: number;
  actual_line: number | null;
  l10_hit_rate: number;
  l10_avg: number | null;
  l5_avg: number | null;
  confidence_score: number;
  projected_value: number | null;
  team: string;
  reliabilityTier: string | null;
  reliabilityHitRate: number | null;
  analysis_date: string;
  /** Edge per framework: L10_avg − line (OVER) or line − L10_avg (UNDER). */
  edge: number | null;
  recommended_side: 'OVER' | 'UNDER';
  /** Hit rate vs actual market line (when actual_line is set). Use for display when available. */
  actual_hit_rate: number | null;
}

interface UseTodayPropsOptions {
  propType: PropType;
  targetDate?: Date;
  minHitRate?: number;
}

export function useTodayProps(options: UseTodayPropsOptions) {
  const { propType, targetDate, minHitRate = 0 } = options;
  const config = PROP_CONFIG[propType];
  
  const analysisDate = targetDate 
    ? formatEasternDate(targetDate) 
    : getTodayEasternDate();

  const { startUTC, endUTC } = getUTCBoundariesForEasternDate(analysisDate);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['today-props', propType, analysisDate, minHitRate],
    queryFn: async (): Promise<TodayPropPick[]> => {
      console.group(`🎯 [Today ${propType.toUpperCase()} Props]`);
      console.log(`📅 Analysis date: ${analysisDate}`);
      console.log(`⏰ UTC boundaries: ${startUTC} to ${endUTC}`);

      // Step 1: Get players with games AND their live lines using correct prop_type and UTC boundaries
      const { data: liveProps } = await supabase
        .from('unified_props')
        .select('player_name, current_line')
        .eq('prop_type', config.propType)
        .gte('commence_time', startUTC)
        .lt('commence_time', endUTC);

      const activePlayers = new Set<string>();
      const linesMap = new Map<string, number>();
      
      (liveProps || []).forEach(p => {
        const playerKey = p.player_name?.toLowerCase();
        if (playerKey) {
          activePlayers.add(playerKey);
          if (p.current_line !== null) {
            linesMap.set(playerKey, p.current_line);
          }
        }
      });

      console.log(`🎮 Found ${activePlayers.size} players with games (prop_type: ${config.propType})`);
      console.log(`📊 Live lines found for ${linesMap.size} players`);

      if (activePlayers.size === 0) {
        console.log('⚠️ No players with games on this date');
        console.groupEnd();
        return [];
      }

      // Step 2: Fetch sweet spots for the target date
      const { data: sweetSpots, error: ssError } = await supabase
        .from('category_sweet_spots')
        .select('*')
        .eq('analysis_date', analysisDate)
        .in('category', config.sweetSpotCategories)
        .gte('l10_hit_rate', minHitRate)
        .order('l10_hit_rate', { ascending: false });

      if (ssError) {
        console.error(`Error fetching ${propType} props:`, ssError);
        console.groupEnd();
        throw ssError;
      }

      console.log(`🏀 Raw ${propType} picks found: ${sweetSpots?.length || 0}`);

      // Step 3: Filter to only players with actual games
      const filteredSpots = (sweetSpots || []).filter(spot => 
        activePlayers.has(spot.player_name?.toLowerCase())
      );

      console.log(`✅ Filtered to ${filteredSpots.length} picks with active games`);

      if (filteredSpots.length === 0) {
        console.log(`⚠️ No ${propType} picks for players with games`);
        console.groupEnd();
        return [];
      }

      // Step 4: Fetch L5 averages from game logs
      const playerNames = filteredSpots.map(p => p.player_name).filter(Boolean);
      
      const { data: gameLogs } = await supabase
        .from('nba_player_game_logs')
        .select(`player_name, ${config.gameLogField}, game_date`)
        .in('player_name', playerNames)
        .order('game_date', { ascending: false })
        .limit(playerNames.length * 10);

      // Group by player and calculate L5 avg
      const l5Map = new Map<string, number>();
      const grouped: Record<string, number[]> = {};
      
      (gameLogs || []).forEach(log => {
        const key = log.player_name?.toLowerCase();
        if (!key) return;
        if (!grouped[key]) grouped[key] = [];
        const value = log[config.gameLogField];
        if (grouped[key].length < 5 && value !== null) {
          grouped[key].push(value as number);
        }
      });
      
      Object.entries(grouped).forEach(([name, values]) => {
        if (values.length > 0) {
          const avg = values.reduce((s, a) => s + a, 0) / values.length;
          l5Map.set(name, avg);
        }
      });

      console.log(`📈 L5 averages calculated for ${l5Map.size} players`);

      // Step 5: Fetch reliability scores
      const { data: reliabilityScores } = await supabase
        .from('player_reliability_scores')
        .select('player_name, prop_type, reliability_tier, hit_rate');

      const reliabilityMap = new Map<string, { tier: string; hitRate: number }>();
      (reliabilityScores || []).forEach(r => {
        const key = `${r.player_name?.toLowerCase()}_${r.prop_type?.toLowerCase()}`;
        reliabilityMap.set(key, {
          tier: r.reliability_tier || 'unknown',
          hitRate: r.hit_rate || 0,
        });
      });

      // Step 6: Fetch player team data
      const { data: playerCache } = await supabase
        .from('bdl_player_cache')
        .select('player_name, team_name');

      const teamMap = new Map<string, string>();
      playerCache?.forEach(p => {
        if (p.player_name && p.team_name) {
          teamMap.set(p.player_name.toLowerCase(), p.team_name);
        }
      });

      // Step 7: Transform picks
      const picks: TodayPropPick[] = filteredSpots.map(pick => {
        const playerKey = pick.player_name?.toLowerCase() || '';
        const reliabilityKey = `${playerKey}_${config.reliabilityKey}`;
        const reliability = reliabilityMap.get(reliabilityKey);
        const team = teamMap.get(playerKey) || 'Unknown';
        
        // Use live line from unified_props, fallback to actual_line, then recommended
        const actualLine = linesMap.get(playerKey) ?? pick.actual_line ?? pick.recommended_line;
        
        const l5Avg = l5Map.get(playerKey) ?? null;
        const l10Avg = pick.l10_avg ?? null;
        
        // Determine recommended side from category or explicit field
        const recommendedSide: 'OVER' | 'UNDER' = 
          pick.recommended_side === 'UNDER' || pick.category?.includes('UNDER') 
            ? 'UNDER' 
            : 'OVER';

        // Edge calculation per framework: L10_avg − line (OVER) or line − L10_avg (UNDER)
        let edge: number | null = null;
        if (actualLine != null) {
          if (l10Avg != null) {
            edge = recommendedSide === 'OVER' ? l10Avg - actualLine : actualLine - l10Avg;
          } else if (pick.projected_value != null) {
            // Fallback to projected_value if no L10 avg
            edge = pick.projected_value - actualLine;
          }
        }

        return {
          id: pick.id,
          player_name: pick.player_name || '',
          prop_type: pick.prop_type || config.reliabilityKey,
          category: pick.category || '',
          recommended_line: pick.recommended_line || 0.5,
          actual_line: actualLine,
          l10_hit_rate: pick.l10_hit_rate || 0,
          l10_avg: l10Avg,
          l5_avg: l5Avg,
          confidence_score: pick.confidence_score || 0,
          projected_value: pick.projected_value,
          team,
          reliabilityTier: reliability?.tier || null,
          reliabilityHitRate: reliability?.hitRate || null,
          analysis_date: pick.analysis_date || analysisDate,
          edge,
          recommended_side: recommendedSide,
          actual_hit_rate: pick.actual_hit_rate ?? null,
        };
      });

      console.log(`✅ Processed ${picks.length} ${propType} picks`);
      if (picks.length > 0) {
        const eliteCount = picks.filter(p => p.l10_hit_rate >= 1).length;
        const uniqueTeams = new Set(picks.map(p => p.team)).size;
        console.log(`🔥 Elite (100% L10): ${eliteCount} | Unique teams: ${uniqueTeams}`);
      }
      console.groupEnd();

      return picks;
    },
    staleTime: 60000,
  });

  const picks = data || [];
  
  // Helper: get display hit rate (actual_hit_rate when we have actual_line, else l10_hit_rate)
  const displayHitRate = (p: TodayPropPick) =>
    p.actual_line != null && p.actual_hit_rate != null ? p.actual_hit_rate : p.l10_hit_rate;

  // Calculate summary stats using display hit rate
  const stats = {
    totalPicks: picks.length,
    eliteCount: picks.filter(p => displayHitRate(p) >= 1).length,
    nearPerfectCount: picks.filter(p => displayHitRate(p) >= 0.97 && displayHitRate(p) < 1).length,
    strongCount: picks.filter(p => displayHitRate(p) >= 0.90 && displayHitRate(p) < 0.97).length,
    uniqueTeams: new Set(picks.map(p => p.team)).size,
    avgHitRate: picks.length > 0 
      ? picks.reduce((sum, p) => sum + displayHitRate(p), 0) / picks.length 
      : 0,
    avgConfidence: picks.length > 0
      ? picks.reduce((sum, p) => sum + p.confidence_score, 0) / picks.length
      : 0,
  };

  return {
    picks,
    isLoading,
    error,
    refetch,
    analysisDate,
    stats,
  };
}
