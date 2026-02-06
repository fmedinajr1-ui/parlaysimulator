import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SidePerformanceWeek {
  weekStart: string;
  side: 'over' | 'under';
  hits: number;
  misses: number;
  totalPicks: number;
  hitRate: number;
  avgCeilingProtection: number | null;
  avgL10HitRate: number;
}

export interface SideSummary {
  side: 'over' | 'under';
  totalHits: number;
  totalMisses: number;
  overallHitRate: number;
  weeklyTrend: 'improving' | 'stable' | 'declining';
  recentWeekRate: number;
}

interface WeeklyData {
  weekStart: string;
  over: SidePerformanceWeek | null;
  under: SidePerformanceWeek | null;
}

function calculateTrend(weeklyData: SidePerformanceWeek[]): 'improving' | 'stable' | 'declining' {
  if (weeklyData.length < 2) return 'stable';
  
  // Get the two most recent weeks with data
  const sortedWeeks = [...weeklyData].sort((a, b) => 
    new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime()
  );
  
  if (sortedWeeks.length < 2) return 'stable';
  
  const recentRate = sortedWeeks[0].hitRate;
  const previousRate = sortedWeeks[1].hitRate;
  
  const difference = recentRate - previousRate;
  
  if (difference > 5) return 'improving';
  if (difference < -5) return 'declining';
  return 'stable';
}

export function useSidePerformanceTracking(daysBack: number = 60) {
  const query = useQuery({
    queryKey: ['side-performance-tracking', daysBack],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_side_performance_tracking', {
        days_back: daysBack
      });

      if (error) throw error;

      // Transform the raw data
      const weeklyData: SidePerformanceWeek[] = (data || []).map((row: any) => ({
        weekStart: row.week_start,
        side: row.side as 'over' | 'under',
        hits: row.hits,
        misses: row.misses,
        totalPicks: row.total_picks,
        hitRate: row.hit_rate || 0,
        avgCeilingProtection: row.avg_ceiling_protection,
        avgL10HitRate: row.avg_l10_hit_rate || 0,
      }));

      // Separate by side
      const overData = weeklyData.filter(w => w.side === 'over');
      const underData = weeklyData.filter(w => w.side === 'under');

      // Calculate summaries
      const overSummary: SideSummary = {
        side: 'over',
        totalHits: overData.reduce((sum, w) => sum + w.hits, 0),
        totalMisses: overData.reduce((sum, w) => sum + w.misses, 0),
        overallHitRate: 0,
        weeklyTrend: calculateTrend(overData),
        recentWeekRate: overData.length > 0 ? 
          overData.sort((a, b) => new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime())[0].hitRate : 0,
      };
      overSummary.overallHitRate = overSummary.totalHits + overSummary.totalMisses > 0
        ? Math.round((overSummary.totalHits / (overSummary.totalHits + overSummary.totalMisses)) * 1000) / 10
        : 0;

      const underSummary: SideSummary = {
        side: 'under',
        totalHits: underData.reduce((sum, w) => sum + w.hits, 0),
        totalMisses: underData.reduce((sum, w) => sum + w.misses, 0),
        overallHitRate: 0,
        weeklyTrend: calculateTrend(underData),
        recentWeekRate: underData.length > 0 ? 
          underData.sort((a, b) => new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime())[0].hitRate : 0,
      };
      underSummary.overallHitRate = underSummary.totalHits + underSummary.totalMisses > 0
        ? Math.round((underSummary.totalHits / (underSummary.totalHits + underSummary.totalMisses)) * 1000) / 10
        : 0;

      // Combine into weekly breakdown
      const weekStarts = [...new Set(weeklyData.map(w => w.weekStart))].sort(
        (a, b) => new Date(b).getTime() - new Date(a).getTime()
      );

      const combinedWeekly: WeeklyData[] = weekStarts.map(weekStart => ({
        weekStart,
        over: overData.find(w => w.weekStart === weekStart) || null,
        under: underData.find(w => w.weekStart === weekStart) || null,
      }));

      return {
        weeklyData: combinedWeekly,
        overSummary,
        underSummary,
        overData,
        underData,
      };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return {
    weeklyData: query.data?.weeklyData || [],
    overSummary: query.data?.overSummary,
    underSummary: query.data?.underSummary,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
