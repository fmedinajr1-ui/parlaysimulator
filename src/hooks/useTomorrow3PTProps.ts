import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Get tomorrow's date in Eastern Time (America/New_York)
 */
function getTomorrowEasternDate(): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Get a specific date in Eastern Time format
 */
function formatEasternDate(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export interface Tomorrow3PTPick {
  id: string;
  player_name: string;
  prop_type: string;
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
  edge: number | null;
}

interface UseTomorrow3PTPropsOptions {
  targetDate?: Date;
  minHitRate?: number;
}

export function useTomorrow3PTProps(options: UseTomorrow3PTPropsOptions = {}) {
  const { targetDate, minHitRate = 0 } = options;
  
  const analysisDate = targetDate 
    ? formatEasternDate(targetDate) 
    : getTomorrowEasternDate();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tomorrow-3pt-props', analysisDate, minHitRate],
    queryFn: async (): Promise<Tomorrow3PTPick[]> => {
      console.group('🎯 [Tomorrow 3PT Props]');
      console.log(`📅 Target date: ${analysisDate}`);

      // Step 1: Get players with games on the target date
      const { data: upcomingProps } = await supabase
        .from('unified_props')
        .select('player_name')
        .gte('commence_time', `${analysisDate}T00:00:00`)
        .lt('commence_time', `${analysisDate}T23:59:59`);

      const activePlayers = new Set(
        (upcomingProps || []).map(p => p.player_name?.toLowerCase()).filter(Boolean)
      );

      console.log(`🎮 Found ${activePlayers.size} players with games on ${analysisDate}`);

      if (activePlayers.size === 0) {
        console.log('⚠️ No players with games on this date');
        console.groupEnd();
        return [];
      }

      // Step 2: Fetch THREE_POINT_SHOOTER picks for the target date
      const { data: sweetSpots, error: ssError } = await supabase
        .from('category_sweet_spots')
        .select('*')
        .eq('analysis_date', analysisDate)
        .eq('category', 'THREE_POINT_SHOOTER')
        .gte('l10_hit_rate', minHitRate)
        .order('l10_hit_rate', { ascending: false });

      if (ssError) {
        console.error('Error fetching 3PT props:', ssError);
        console.groupEnd();
        throw ssError;
      }

      console.log(`🏀 Raw 3PT picks found: ${sweetSpots?.length || 0}`);

      // Step 3: Filter to only players with actual games
      const filteredSpots = (sweetSpots || []).filter(spot => 
        activePlayers.has(spot.player_name?.toLowerCase())
      );

      console.log(`✅ Filtered to ${filteredSpots.length} picks with active games`);

      if (filteredSpots.length === 0) {
        console.log('⚠️ No 3PT picks for players with games');
        console.groupEnd();
        return [];
      }

      // Fetch reliability scores
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

      // Fetch player team data
      const { data: playerCache } = await supabase
        .from('bdl_player_cache')
        .select('player_name, team_name');

      const teamMap = new Map<string, string>();
      playerCache?.forEach(p => {
        if (p.player_name && p.team_name) {
          teamMap.set(p.player_name.toLowerCase(), p.team_name);
        }
      });

      // Fetch live lines from unified_props
      const { data: liveLines } = await supabase
        .from('unified_props')
        .select('player_name, current_line')
        .eq('prop_type', 'player_threes')
        .gte('commence_time', `${analysisDate}T00:00:00`)
        .lt('commence_time', `${analysisDate}T23:59:59`);

      const linesMap = new Map<string, number>();
      liveLines?.forEach(p => {
        if (p.player_name && p.current_line) {
          linesMap.set(p.player_name.toLowerCase(), p.current_line);
        }
      });

      // Fetch L5 averages from game logs
      const playerNames = filteredSpots.map(p => p.player_name).filter(Boolean);
      
      const { data: gameLogs } = await supabase
        .from('nba_player_game_logs')
        .select('player_name, threes_made, game_date')
        .in('player_name', playerNames)
        .order('game_date', { ascending: false });

      // Group by player and calculate L5 avg
      const l5Map = new Map<string, number>();
      const grouped: Record<string, number[]> = {};
      gameLogs?.forEach(log => {
        const key = log.player_name?.toLowerCase();
        if (!key) return;
        if (!grouped[key]) grouped[key] = [];
        if (grouped[key].length < 5 && log.threes_made !== null) {
          grouped[key].push(log.threes_made);
        }
      });
      Object.entries(grouped).forEach(([name, threes]) => {
        if (threes.length > 0) {
          const avg = threes.reduce((s, a) => s + a, 0) / threes.length;
          l5Map.set(name, avg);
        }
      });

      // Transform picks (using filtered spots)
      const picks: Tomorrow3PTPick[] = filteredSpots.map(pick => {
        const playerKey = pick.player_name?.toLowerCase() || '';
        const reliabilityKey = `${playerKey}_player_threes`;
        const reliability = reliabilityMap.get(reliabilityKey);
        const team = teamMap.get(playerKey) || 'Unknown';
        
        // Use live line from unified_props, fallback to actual_line, then recommended
        const actualLine = linesMap.get(playerKey) ?? pick.actual_line ?? pick.recommended_line;
        
        const edge = pick.projected_value && actualLine
          ? pick.projected_value - actualLine
          : null;

        const l5Avg = l5Map.get(playerKey) ?? null;

        return {
          id: pick.id,
          player_name: pick.player_name || '',
          prop_type: pick.prop_type || 'player_threes',
          recommended_line: pick.recommended_line || 0.5,
          actual_line: actualLine,
          l10_hit_rate: pick.l10_hit_rate || 0,
          l10_avg: pick.l10_avg ?? null,
          l5_avg: l5Avg,
          confidence_score: pick.confidence_score || 0,
          projected_value: pick.projected_value,
          team,
          reliabilityTier: reliability?.tier || null,
          reliabilityHitRate: reliability?.hitRate || null,
          analysis_date: pick.analysis_date || analysisDate,
          edge,
        };
      });

      console.log(`✅ Processed ${picks.length} 3PT picks`);
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
  
  // Calculate summary stats
  const stats = {
    totalPicks: picks.length,
    eliteCount: picks.filter(p => p.l10_hit_rate >= 1).length,
    nearPerfectCount: picks.filter(p => p.l10_hit_rate >= 0.97 && p.l10_hit_rate < 1).length,
    strongCount: picks.filter(p => p.l10_hit_rate >= 0.90 && p.l10_hit_rate < 0.97).length,
    uniqueTeams: new Set(picks.map(p => p.team)).size,
    avgHitRate: picks.length > 0 
      ? picks.reduce((sum, p) => sum + p.l10_hit_rate, 0) / picks.length 
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

export { getTomorrowEasternDate, formatEasternDate };
