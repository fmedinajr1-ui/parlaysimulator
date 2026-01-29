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

export interface TomorrowAssistPick {
  id: string;
  player_name: string;
  prop_type: string;
  category: string;
  recommended_line: number;
  actual_line: number | null;
  l10_hit_rate: number;
  l10_avg: number | null;
  confidence_score: number;
  projected_value: number | null;
  team: string;
  reliabilityTier: string | null;
  reliabilityHitRate: number | null;
  analysis_date: string;
  edge: number | null;
  recommended_side: string;
}

interface UseTomorrowAssistPropsOptions {
  targetDate?: Date;
  minHitRate?: number;
  category?: 'BIG_ASSIST_OVER' | 'HIGH_ASSIST_UNDER' | 'all';
}

export function useTomorrowAssistProps(options: UseTomorrowAssistPropsOptions = {}) {
  const { targetDate, minHitRate = 0, category = 'all' } = options;
  
  const analysisDate = targetDate 
    ? formatEasternDate(targetDate) 
    : getTomorrowEasternDate();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tomorrow-assist-props', analysisDate, minHitRate, category],
    queryFn: async (): Promise<TomorrowAssistPick[]> => {
      console.group('🏀 [Tomorrow Assist Props]');
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

      // Step 2: Build query for category sweet spots
      let query = supabase
        .from('category_sweet_spots')
        .select('*')
        .eq('analysis_date', analysisDate)
        .gte('l10_hit_rate', minHitRate)
        .order('l10_hit_rate', { ascending: false });

      // Filter by category
      if (category === 'all') {
        query = query.in('category', ['BIG_ASSIST_OVER', 'HIGH_ASSIST_UNDER']);
      } else {
        query = query.eq('category', category);
      }

      const { data: sweetSpots, error: ssError } = await query;

      if (ssError) {
        console.error('Error fetching assist props:', ssError);
        console.groupEnd();
        throw ssError;
      }

      console.log(`🏀 Raw assist picks found: ${sweetSpots?.length || 0}`);

      // Step 3: Filter to only players with actual games
      const filteredSpots = (sweetSpots || []).filter(spot => 
        activePlayers.has(spot.player_name?.toLowerCase())
      );

      console.log(`✅ Filtered to ${filteredSpots.length} picks with active games`);

      if (filteredSpots.length === 0) {
        console.log('⚠️ No assist picks for players with games');
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

      // Transform picks (using filtered spots)
      const picks: TomorrowAssistPick[] = filteredSpots.map(pick => {
        const playerKey = pick.player_name?.toLowerCase() || '';
        const reliabilityKey = `${playerKey}_player_assists`;
        const reliability = reliabilityMap.get(reliabilityKey);
        const team = teamMap.get(playerKey) || 'Unknown';
        
        const edge = pick.projected_value && pick.actual_line
          ? pick.projected_value - pick.actual_line
          : null;

        return {
          id: pick.id,
          player_name: pick.player_name || '',
          prop_type: pick.prop_type || 'player_assists',
          category: pick.category || '',
          recommended_line: pick.recommended_line || 0.5,
          actual_line: pick.actual_line,
          l10_hit_rate: pick.l10_hit_rate || 0,
          l10_avg: pick.l10_avg,
          confidence_score: pick.confidence_score || 0,
          projected_value: pick.projected_value,
          team,
          reliabilityTier: reliability?.tier || null,
          reliabilityHitRate: reliability?.hitRate || null,
          analysis_date: pick.analysis_date || analysisDate,
          edge,
          recommended_side: pick.recommended_side || (pick.category?.includes('UNDER') ? 'UNDER' : 'OVER'),
        };
      });

      // Group by category for logging
      const overCount = picks.filter(p => p.category === 'BIG_ASSIST_OVER').length;
      const underCount = picks.filter(p => p.category === 'HIGH_ASSIST_UNDER').length;
      
      console.log(`✅ Processed ${picks.length} assist picks`);
      console.log(`📊 BIG_ASSIST_OVER: ${overCount} | HIGH_ASSIST_UNDER: ${underCount}`);
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
  const overPicks = picks.filter(p => p.category === 'BIG_ASSIST_OVER');
  const underPicks = picks.filter(p => p.category === 'HIGH_ASSIST_UNDER');
  
  const stats = {
    totalPicks: picks.length,
    overCount: overPicks.length,
    underCount: underPicks.length,
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
    overPicks,
    underPicks,
    isLoading,
    error,
    refetch,
    analysisDate,
    stats,
  };
}

export { getTomorrowEasternDate, formatEasternDate };
