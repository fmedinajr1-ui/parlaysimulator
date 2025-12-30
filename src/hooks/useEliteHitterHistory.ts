import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { calculateROI, calculateStreak, calculateBestWorstStreaks, type ParlayResult } from '@/utils/roiCalculator';

interface LegData {
  playerName: string;
  propType: string;
  line: number;
  side: string;
  odds: number;
  sport: string;
  p_leg: number;
  edge: number;
  engines: string[];
}

interface LegOutcome {
  id: string;
  parlay_id: string;
  leg_index: number;
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  outcome: string | null;
  actual_value: number | null;
  predicted_probability: number | null;
}

export interface HistoricalParlay {
  id: string;
  parlay_date: string;
  legs: LegData[];
  combined_probability: number;
  total_odds: number;
  total_edge: number;
  outcome: string;
  source_engines: string[];
  sports: string[];
  settled_at: string | null;
  leg_outcomes?: LegOutcome[];
}

export interface EngineStats {
  engine: string;
  won: number;
  lost: number;
  total: number;
  winRate: number;
  profit: number;
}

export interface EliteHitterStats {
  totalParlays: number;
  won: number;
  lost: number;
  pending: number;
  noData: number;
  winRate: number;
  totalROI: number;
  netProfit: number;
  currentStreak: { type: 'W' | 'L' | 'none'; count: number };
  bestWinStreak: number;
  worstLossStreak: number;
  byEngine: EngineStats[];
  roiTrend: { date: string; cumulativeROI: number }[];
}

export function useEliteHitterHistory() {
  const queryClient = useQueryClient();

  // Real-time subscription for auto-updates
  useEffect(() => {
    const channel = supabase
      .channel('elite-hitter-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'daily_elite_parlays'
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['elite-hitter-history'] });
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'daily_elite_leg_outcomes'
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['elite-hitter-history'] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ['elite-hitter-history'],
    queryFn: async (): Promise<{ parlays: HistoricalParlay[]; stats: EliteHitterStats }> => {
      // Fetch all parlays with leg outcomes
      const { data: parlays, error } = await supabase
        .from('daily_elite_parlays')
        .select(`
          id,
          parlay_date,
          legs,
          combined_probability,
          total_odds,
          total_edge,
          outcome,
          source_engines,
          sports,
          settled_at
        `)
        .order('parlay_date', { ascending: false });

      if (error) throw error;

      // Fetch leg outcomes for all parlays
      const parlayIds = parlays?.map(p => p.id) || [];
      const { data: legOutcomes } = await supabase
        .from('daily_elite_leg_outcomes')
        .select('*')
        .in('parlay_id', parlayIds);

      // Map leg outcomes to parlays
      const historicalParlays: HistoricalParlay[] = (parlays || []).map(p => ({
        ...p,
        legs: (p.legs || []) as unknown as LegData[],
        source_engines: (p.source_engines || []) as unknown as string[],
        sports: (p.sports || []) as unknown as string[],
        leg_outcomes: legOutcomes?.filter(lo => lo.parlay_id === p.id) || [],
      }));

      // Calculate stats
      const settledParlays = historicalParlays.filter(p => 
        p.outcome === 'won' || p.outcome === 'lost'
      );
      
      const won = settledParlays.filter(p => p.outcome === 'won').length;
      const lost = settledParlays.filter(p => p.outcome === 'lost').length;
      const pending = historicalParlays.filter(p => p.outcome === 'pending').length;
      const noData = historicalParlays.filter(p => 
        p.outcome === 'no_data' || p.outcome === 'partial'
      ).length;

      // Calculate ROI
      const parlayResults: ParlayResult[] = historicalParlays.map(p => ({
        outcome: p.outcome,
        totalOdds: p.total_odds || 0,
      }));

      const roiStats = calculateROI(parlayResults);
      const currentStreak = calculateStreak(parlayResults);
      const { bestWin, worstLoss } = calculateBestWorstStreaks(parlayResults);

      // Calculate stats by engine
      const engineMap = new Map<string, { won: number; lost: number; profit: number }>();
      
      settledParlays.forEach(parlay => {
        const engines = parlay.source_engines || [];
        engines.forEach(engine => {
          const current = engineMap.get(engine) || { won: 0, lost: 0, profit: 0 };
          if (parlay.outcome === 'won') {
            current.won++;
            const payout = parlay.total_odds > 0 
              ? parlay.total_odds / 100 
              : 100 / Math.abs(parlay.total_odds);
            current.profit += payout;
          } else {
            current.lost++;
            current.profit -= 1;
          }
          engineMap.set(engine, current);
        });
      });

      const byEngine: EngineStats[] = Array.from(engineMap.entries()).map(([engine, stats]) => ({
        engine,
        won: stats.won,
        lost: stats.lost,
        total: stats.won + stats.lost,
        winRate: stats.won + stats.lost > 0 ? (stats.won / (stats.won + stats.lost)) * 100 : 0,
        profit: stats.profit,
      })).sort((a, b) => b.total - a.total);

      // Calculate ROI trend (cumulative)
      const sortedByDate = [...historicalParlays]
        .filter(p => p.outcome === 'won' || p.outcome === 'lost')
        .sort((a, b) => a.parlay_date.localeCompare(b.parlay_date));

      let cumulative = 0;
      const roiTrend = sortedByDate.map(p => {
        if (p.outcome === 'won') {
          const payout = p.total_odds > 0 
            ? p.total_odds / 100 
            : 100 / Math.abs(p.total_odds);
          cumulative += payout;
        } else {
          cumulative -= 1;
        }
        return { date: p.parlay_date, cumulativeROI: cumulative };
      });

      const stats: EliteHitterStats = {
        totalParlays: historicalParlays.length,
        won,
        lost,
        pending,
        noData,
        winRate: won + lost > 0 ? (won / (won + lost)) * 100 : 0,
        totalROI: roiStats.roiPercentage,
        netProfit: roiStats.netProfit,
        currentStreak,
        bestWinStreak: bestWin,
        worstLossStreak: worstLoss,
        byEngine,
        roiTrend,
      };

      return { parlays: historicalParlays, stats };
    },
    staleTime: 1000 * 30, // 30 seconds
    refetchInterval: 1000 * 60, // Poll every 60s as fallback
  });
}
