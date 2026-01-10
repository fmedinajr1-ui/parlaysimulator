import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

export interface PropResult {
  id: string;
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  outcome: 'hit' | 'miss' | 'push';
  actual_value: number | null;
  confidence_score: number;
  game_date: string;
  settled_at: string | null;
  team_name?: string;
  opponent?: string;
}

export interface PropResultsStats {
  totalWins: number;
  totalLosses: number;
  totalPushes: number;
  winRate: number;
  totalSettled: number;
}

export function usePropResults(days: number = 7) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['prop-results', days],
    queryFn: async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const startDateStr = startDate.toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('nba_risk_engine_picks')
        .select('id, player_name, prop_type, line, side, outcome, actual_value, confidence_score, game_date, settled_at, team_name, opponent')
        .in('outcome', ['hit', 'miss', 'push'])
        .gte('game_date', startDateStr)
        .order('game_date', { ascending: false })
        .order('settled_at', { ascending: false })
        .limit(200);

      if (error) throw error;
      return (data || []) as PropResult[];
    },
    refetchInterval: 30000,
  });

  // Real-time subscription for outcome updates
  useEffect(() => {
    const channel = supabase
      .channel('prop-results-realtime')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'nba_risk_engine_picks',
          filter: 'outcome=neq.pending',
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['prop-results'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  // Calculate stats from results
  const stats: PropResultsStats = {
    totalWins: query.data?.filter(p => p.outcome === 'hit').length || 0,
    totalLosses: query.data?.filter(p => p.outcome === 'miss').length || 0,
    totalPushes: query.data?.filter(p => p.outcome === 'push').length || 0,
    totalSettled: query.data?.length || 0,
    winRate: 0,
  };

  if (stats.totalSettled > 0) {
    const decisioned = stats.totalWins + stats.totalLosses;
    stats.winRate = decisioned > 0 ? (stats.totalWins / decisioned) * 100 : 0;
  }

  // Group results by date
  const groupedByDate = query.data?.reduce((acc, result) => {
    const date = result.game_date;
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(result);
    return acc;
  }, {} as Record<string, PropResult[]>) || {};

  return {
    ...query,
    stats,
    groupedByDate,
  };
}
