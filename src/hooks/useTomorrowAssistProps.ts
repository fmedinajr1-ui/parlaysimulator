import { useTodayProps, getTodayEasternDate, formatEasternDate, TodayPropPick } from './useTodayProps';

// Re-export for backward compatibility
export type TomorrowAssistPick = TodayPropPick;

interface UseTomorrowAssistPropsOptions {
  targetDate?: Date;
  minHitRate?: number;
  category?: 'BIG_ASSIST_OVER' | 'HIGH_ASSIST_UNDER' | 'all';
}

export function useTomorrowAssistProps(options: UseTomorrowAssistPropsOptions = {}) {
  const { category = 'all', ...restOptions } = options;
  
  const result = useTodayProps({ 
    propType: 'assists',
    ...restOptions 
  });
  
  // Filter by category if specified
  let filteredPicks = result.picks;
  if (category !== 'all') {
    filteredPicks = result.picks.filter(p => p.category === category);
  }
  
  // Add category-specific grouping for backward compatibility
  const overPicks = filteredPicks.filter(p => !p.category.includes('UNDER'));
  const underPicks = filteredPicks.filter(p => p.category.includes('UNDER'));
  
  // Recalculate stats for filtered picks
  const stats = {
    totalPicks: filteredPicks.length,
    overCount: overPicks.length,
    underCount: underPicks.length,
    eliteCount: filteredPicks.filter(p => p.l10_hit_rate >= 1).length,
    nearPerfectCount: filteredPicks.filter(p => p.l10_hit_rate >= 0.97 && p.l10_hit_rate < 1).length,
    strongCount: filteredPicks.filter(p => p.l10_hit_rate >= 0.90 && p.l10_hit_rate < 0.97).length,
    uniqueTeams: new Set(filteredPicks.map(p => p.team)).size,
    avgHitRate: filteredPicks.length > 0 
      ? filteredPicks.reduce((sum, p) => sum + p.l10_hit_rate, 0) / filteredPicks.length 
      : 0,
    avgConfidence: filteredPicks.length > 0
      ? filteredPicks.reduce((sum, p) => sum + p.confidence_score, 0) / filteredPicks.length
      : 0,
  };

  return {
    picks: filteredPicks,
    overPicks,
    underPicks,
    isLoading: result.isLoading,
    error: result.error,
    refetch: result.refetch,
    analysisDate: result.analysisDate,
    stats,
  };
}

export { getTodayEasternDate as getTomorrowEasternDate, formatEasternDate };
