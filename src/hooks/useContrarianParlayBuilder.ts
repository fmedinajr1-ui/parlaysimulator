import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getEasternDate } from '@/lib/dateUtils';

export interface FadeCategory {
  category: string;
  originalSide: 'over' | 'under';
  hitRate: number;
  fadeHitRate: number;
  record: string;
}

export interface ContrarianPick {
  id: string;
  playerName: string;
  propType: string;
  originalCategory: string;
  originalSide: 'over' | 'under';
  fadeSide: 'over' | 'under';
  line: number;
  l10Avg: number;
  fadeEdge: number;
  categoryHitRate: number;
  fadeHitRate: number;
  hasPositiveEdge: boolean;
  confidence: number;
  gameTime?: string;
  opponent?: string;
}

// Categories with historically poor performance (< 50% hit rate)
export const FADE_CATEGORIES: FadeCategory[] = [
  { category: 'ELITE_REB_OVER', originalSide: 'over', hitRate: 20, fadeHitRate: 80, record: '1-4' },
  { category: 'HIGH_ASSIST', originalSide: 'over', hitRate: 31.4, fadeHitRate: 68.6, record: '11-24' },
  { category: 'MID_SCORER_UNDER', originalSide: 'under', hitRate: 45, fadeHitRate: 55, record: '9-11' },
];

async function fetchContrarianPicks(): Promise<ContrarianPick[]> {
  const todayET = getEasternDate();
  
  // Query category_sweet_spots for picks in fade categories
  const { data: sweetSpots, error: spotsError } = await supabase
    .from('category_sweet_spots')
    .select('*')
    .in('category', FADE_CATEGORIES.map(c => c.category))
    .eq('is_active', true)
    .gte('analysis_date', todayET);
  
  if (spotsError) {
    console.error('Error fetching sweet spots:', spotsError);
    throw spotsError;
  }
  
  if (!sweetSpots || sweetSpots.length === 0) {
    return [];
  }
  
  // Get player names to fetch live lines
  const playerNames = [...new Set(sweetSpots.map(s => s.player_name))];
  
  // Fetch current lines from unified_props
  const { data: liveProps, error: propsError } = await supabase
    .from('unified_props')
    .select('player_name, prop_type, current_line, commence_time, game_description')
    .in('player_name', playerNames)
    .gte('commence_time', new Date().toISOString());
  
  if (propsError) {
    console.error('Error fetching live props:', propsError);
  }
  
  // Build a map of player -> prop -> line
  const lineMap = new Map<string, { line: number; gameTime?: string; opponent?: string }>();
  (liveProps || []).forEach(prop => {
    const key = `${prop.player_name.toLowerCase()}-${prop.prop_type?.toLowerCase()}`;
    // Extract opponent from game_description (e.g., "Team A vs Team B")
    const opponent = prop.game_description?.split(' vs ')?.[1]?.substring(0, 3) || undefined;
    lineMap.set(key, {
      line: prop.current_line,
      gameTime: prop.commence_time,
      opponent
    });
  });
  
  // Process each sweet spot and calculate fade edge
  const contrarianPicks: ContrarianPick[] = [];
  
  for (const spot of sweetSpots) {
    const fadeCategory = FADE_CATEGORIES.find(c => c.category === spot.category);
    if (!fadeCategory) continue;
    
    const originalSide = spot.recommended_side?.toLowerCase() as 'over' | 'under' || fadeCategory.originalSide;
    const fadeSide: 'over' | 'under' = originalSide === 'over' ? 'under' : 'over';
    
    const l10Avg = spot.l10_avg || 0;
    const line = spot.actual_line || spot.recommended_line || 0;
    
    // Calculate fade edge
    // For OVER original → fade to UNDER: edge is positive if L10 avg < line
    // For UNDER original → fade to OVER: edge is positive if L10 avg > line
    let fadeEdge: number;
    let hasPositiveEdge: boolean;
    
    if (originalSide === 'over') {
      // Fading to UNDER - want L10 avg below line
      fadeEdge = line - l10Avg;
      hasPositiveEdge = fadeEdge > 0;
    } else {
      // Fading to OVER - want L10 avg above line  
      fadeEdge = l10Avg - line;
      hasPositiveEdge = fadeEdge > 0;
    }
    
    // Look up live line data
    const propKey = `${spot.player_name.toLowerCase()}-${spot.prop_type?.toLowerCase()}`;
    const liveData = lineMap.get(propKey);
    
    // Calculate confidence based on fade hit rate and edge magnitude
    const edgeBonus = Math.min(Math.abs(fadeEdge) * 5, 15);
    const confidence = hasPositiveEdge 
      ? Math.min(fadeCategory.fadeHitRate + edgeBonus, 95)
      : Math.max(fadeCategory.fadeHitRate - 20, 30);
    
    contrarianPicks.push({
      id: spot.id,
      playerName: spot.player_name,
      propType: spot.prop_type,
      originalCategory: spot.category,
      originalSide,
      fadeSide,
      line: liveData?.line || line,
      l10Avg,
      fadeEdge: Math.round(fadeEdge * 10) / 10,
      categoryHitRate: fadeCategory.hitRate,
      fadeHitRate: fadeCategory.fadeHitRate,
      hasPositiveEdge,
      confidence: Math.round(confidence),
      gameTime: liveData?.gameTime,
      opponent: liveData?.opponent
    });
  }
  
  // Sort by:
  // 1. Positive edge first
  // 2. Higher fade hit rate
  // 3. Larger absolute edge
  return contrarianPicks.sort((a, b) => {
    if (a.hasPositiveEdge !== b.hasPositiveEdge) {
      return a.hasPositiveEdge ? -1 : 1;
    }
    if (a.fadeHitRate !== b.fadeHitRate) {
      return b.fadeHitRate - a.fadeHitRate;
    }
    return Math.abs(b.fadeEdge) - Math.abs(a.fadeEdge);
  });
}

export function useContrarianParlayBuilder() {
  const query = useQuery({
    queryKey: ['contrarian-picks', getEasternDate()],
    queryFn: fetchContrarianPicks,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 10 * 60 * 1000, // 10 minutes
  });
  
  // Filter to only picks with positive edge (smart fades)
  const smartFades = (query.data || []).filter(p => p.hasPositiveEdge);
  
  // All fades including risky ones
  const allFades = query.data || [];
  
  // Get top 3 for parlay building
  const topFades = smartFades.slice(0, 3);
  
  // Category stats
  const categoryStats = FADE_CATEGORIES.map(cat => {
    const picks = allFades.filter(p => p.originalCategory === cat.category);
    const smartPicks = picks.filter(p => p.hasPositiveEdge);
    return {
      ...cat,
      totalPicks: picks.length,
      smartPicks: smartPicks.length,
      avgFadeEdge: picks.length > 0 
        ? Math.round(picks.reduce((sum, p) => sum + p.fadeEdge, 0) / picks.length * 10) / 10
        : 0
    };
  });
  
  return {
    ...query,
    smartFades,
    allFades,
    topFades,
    categoryStats,
    fadeCategories: FADE_CATEGORIES
  };
}
