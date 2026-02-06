import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface AccuracyBreakdown {
  category: string;
  grade: string;
  side: string;
  total_picks: number;
  hits: number;
  misses: number;
  pushes: number;
  hit_rate: number;
  avg_edge_score: number;
}

interface AggregatedStats {
  ptsTotal: number;
  ptsHits: number;
  ptsMisses: number;
  ptsHitRate: number;
  threesTotal: number;
  threesHits: number;
  threesMisses: number;
  threesHitRate: number;
  byGrade: {
    grade: string;
    total: number;
    hits: number;
    hitRate: number;
  }[];
  bySide: {
    side: string;
    total: number;
    hits: number;
    hitRate: number;
  }[];
  hasData: boolean;
}

export function useMatchupScannerAccuracy(daysBack: number = 30) {
  return useQuery({
    queryKey: ['matchup-scanner-accuracy', daysBack],
    queryFn: async (): Promise<AggregatedStats> => {
      const { data, error } = await supabase
        .rpc('get_matchup_scanner_accuracy_breakdown', { days_back: daysBack });

      if (error) {
        console.error('[useMatchupScannerAccuracy] RPC error:', error);
        throw error;
      }

      const rows = (data || []) as AccuracyBreakdown[];
      
      // Aggregate by category
      const ptsRows = rows.filter(r => r.category === 'MATCHUP_SCANNER_PTS');
      const threesRows = rows.filter(r => r.category === 'MATCHUP_SCANNER_3PT');
      
      const sumStats = (arr: AccuracyBreakdown[]) => ({
        total: arr.reduce((sum, r) => sum + Number(r.total_picks), 0),
        hits: arr.reduce((sum, r) => sum + Number(r.hits), 0),
        misses: arr.reduce((sum, r) => sum + Number(r.misses), 0),
      });
      
      const ptsStats = sumStats(ptsRows);
      const threesStats = sumStats(threesRows);
      
      // Aggregate by grade
      const gradeMap = new Map<string, { total: number; hits: number }>();
      rows.forEach(r => {
        const existing = gradeMap.get(r.grade) || { total: 0, hits: 0 };
        gradeMap.set(r.grade, {
          total: existing.total + Number(r.total_picks),
          hits: existing.hits + Number(r.hits),
        });
      });
      
      const byGrade = Array.from(gradeMap.entries())
        .map(([grade, stats]) => ({
          grade,
          total: stats.total,
          hits: stats.hits,
          hitRate: stats.total > 0 ? (stats.hits / stats.total) * 100 : 0,
        }))
        .sort((a, b) => {
          const order = ['A+', 'A', 'B+', 'B'];
          return order.indexOf(a.grade) - order.indexOf(b.grade);
        });
      
      // Aggregate by side
      const sideMap = new Map<string, { total: number; hits: number }>();
      rows.forEach(r => {
        const side = r.side.toUpperCase();
        const existing = sideMap.get(side) || { total: 0, hits: 0 };
        sideMap.set(side, {
          total: existing.total + Number(r.total_picks),
          hits: existing.hits + Number(r.hits),
        });
      });
      
      const bySide = Array.from(sideMap.entries())
        .map(([side, stats]) => ({
          side,
          total: stats.total,
          hits: stats.hits,
          hitRate: stats.total > 0 ? (stats.hits / stats.total) * 100 : 0,
        }));
      
      const hasData = rows.length > 0;
      
      return {
        ptsTotal: ptsStats.total,
        ptsHits: ptsStats.hits,
        ptsMisses: ptsStats.misses,
        ptsHitRate: ptsStats.total > 0 ? (ptsStats.hits / ptsStats.total) * 100 : 0,
        threesTotal: threesStats.total,
        threesHits: threesStats.hits,
        threesMisses: threesStats.misses,
        threesHitRate: threesStats.total > 0 ? (threesStats.hits / threesStats.total) * 100 : 0,
        byGrade,
        bySide,
        hasData,
      };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });
}
