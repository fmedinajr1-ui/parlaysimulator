import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { startOfMonth, endOfMonth, format } from "date-fns";

export interface ArchiveResult {
  id: string;
  engine: string;
  source_id: string | null;
  game_date: string;
  created_at: string;
  settled_at: string | null;
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  team_name: string | null;
  opponent: string | null;
  sport: string;
  outcome: string | null;
  actual_value: number | null;
  confidence_score: number | null;
  edge: number | null;
  signal_label: string | null;
  reason: string | null;
  is_parlay: boolean;
  parlay_type: string | null;
  parlay_legs: any[] | null;
  archived_at: string;
}

export interface MonthlySnapshot {
  id: string;
  month_year: string;
  engine: string;
  sport: string;
  total_picks: number;
  total_hits: number;
  total_misses: number;
  total_pushes: number;
  hit_rate: number | null;
  prop_type_breakdown: unknown;
  signal_breakdown: unknown;
}

export interface ArchiveStats {
  totalPicks: number;
  totalHits: number;
  totalMisses: number;
  totalPushes: number;
  totalPending: number;
  hitRate: number;
  byEngine: Record<string, { hits: number; misses: number; pushes: number; pending: number; hitRate: number }>;
  propTypeBreakdown: Record<string, { hits: number; misses: number; pushes: number; hitRate: number }>;
}

export function useArchiveResults(month: Date) {
  const monthStart = format(startOfMonth(month), 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(month), 'yyyy-MM-dd');
  const monthYear = format(startOfMonth(month), 'yyyy-MM-dd');

  // Fetch archived results for the month
  const resultsQuery = useQuery({
    queryKey: ['archive-results', monthStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prop_results_archive')
        .select('*')
        .gte('game_date', monthStart)
        .lte('game_date', monthEnd)
        .order('game_date', { ascending: false })
        .order('archived_at', { ascending: false });

      if (error) {
        console.error('Archive results fetch error:', error);
        throw error;
      }

      return data as ArchiveResult[];
    },
  });

  // Fetch monthly snapshot stats
  const snapshotQuery = useQuery({
    queryKey: ['archive-snapshot', monthYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('monthly_accuracy_snapshot')
        .select('*')
        .eq('month_year', monthYear);

      if (error) {
        console.error('Monthly snapshot fetch error:', error);
        throw error;
      }

      return (data || []) as MonthlySnapshot[];
    },
  });

  // Calculate stats from results
  const results = resultsQuery.data || [];
  
  const settledResults = results.filter(r => ['hit', 'miss', 'push'].includes(r.outcome || ''));
  const pendingResults = results.filter(r => !r.outcome || r.outcome === 'pending');

  const stats: ArchiveStats = {
    totalPicks: results.length,
    totalHits: settledResults.filter(r => r.outcome === 'hit').length,
    totalMisses: settledResults.filter(r => r.outcome === 'miss').length,
    totalPushes: settledResults.filter(r => r.outcome === 'push').length,
    totalPending: pendingResults.length,
    hitRate: 0,
    byEngine: {},
    propTypeBreakdown: {},
  };

  // Calculate overall hit rate
  const decisioned = stats.totalHits + stats.totalMisses;
  stats.hitRate = decisioned > 0 ? (stats.totalHits / decisioned) * 100 : 0;

  // Calculate engine breakdown
  const engines = [...new Set(results.map(r => r.engine))];
  for (const engine of engines) {
    const engineResults = results.filter(r => r.engine === engine);
    const engineSettled = engineResults.filter(r => ['hit', 'miss', 'push'].includes(r.outcome || ''));
    const hits = engineSettled.filter(r => r.outcome === 'hit').length;
    const misses = engineSettled.filter(r => r.outcome === 'miss').length;
    const pushes = engineSettled.filter(r => r.outcome === 'push').length;
    const pending = engineResults.filter(r => !r.outcome || r.outcome === 'pending').length;
    const engineDecisioned = hits + misses;
    
    stats.byEngine[engine] = {
      hits,
      misses,
      pushes,
      pending,
      hitRate: engineDecisioned > 0 ? (hits / engineDecisioned) * 100 : 0,
    };
  }

  // Calculate prop type breakdown
  const propTypes = [...new Set(results.map(r => r.prop_type))];
  for (const propType of propTypes) {
    const propResults = results.filter(r => r.prop_type === propType);
    const propSettled = propResults.filter(r => ['hit', 'miss', 'push'].includes(r.outcome || ''));
    const hits = propSettled.filter(r => r.outcome === 'hit').length;
    const misses = propSettled.filter(r => r.outcome === 'miss').length;
    const pushes = propSettled.filter(r => r.outcome === 'push').length;
    const propDecisioned = hits + misses;
    
    stats.propTypeBreakdown[propType] = {
      hits,
      misses,
      pushes,
      hitRate: propDecisioned > 0 ? (hits / propDecisioned) * 100 : 0,
    };
  }

  // Group results by date
  const groupedByDate = results.reduce((acc, result) => {
    const date = result.game_date;
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(result);
    return acc;
  }, {} as Record<string, ArchiveResult[]>);

  return {
    results: resultsQuery.data,
    snapshot: snapshotQuery.data,
    stats,
    groupedByDate,
    isLoading: resultsQuery.isLoading || snapshotQuery.isLoading,
    error: resultsQuery.error || snapshotQuery.error,
  };
}

// Get list of available months with archive data
export function useArchiveMonths() {
  return useQuery({
    queryKey: ['archive-months'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prop_results_archive')
        .select('game_month')
        .order('game_month', { ascending: false });

      if (error) {
        console.error('Archive months fetch error:', error);
        throw error;
      }

      // Get unique months
      const uniqueMonths = [...new Set(data?.map(d => d.game_month).filter(Boolean))];
      return uniqueMonths as string[];
    },
  });
}
