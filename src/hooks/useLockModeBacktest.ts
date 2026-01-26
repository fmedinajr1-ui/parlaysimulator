import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface BacktestSummary {
  dateRange: { start: string; end: string };
  totalSlates: number;
  slipsGenerated: number;
  slipsPassed: number;
  totalLegs: number;
  legsHit: number;
  legsMissed: number;
  legsPushed: number;
  legHitRate: number;
  parlayWinRate: number;
  parlaysWon: number;
  gateBlockStats: {
    minutes: number;
    statType: number;
    edge: number;
    under: number;
    confidence: number;
  };
  avgEdge: number;
}

export interface BacktestRun {
  id: string;
  run_name: string | null;
  date_range_start: string;
  date_range_end: string;
  config: Record<string, any>;
  total_slates: number;
  slips_generated: number;
  slips_passed: number;
  total_legs: number;
  legs_hit: number;
  legs_missed: number;
  legs_pushed: number;
  leg_hit_rate: number;
  parlay_win_rate: number;
  gate_block_stats: Record<string, number>;
  avg_edge_value: number;
  created_at: string;
  completed_at: string | null;
}

export interface BacktestSlip {
  id: string;
  run_id: string;
  slate_date: string;
  slip_valid: boolean;
  legs: Array<{
    player: string;
    prop: string;
    line: number;
    side: string;
    projected: number;
    actual: number | null;
    outcome: string | null;
    edge: number;
    confidence: number;
    slot: string;
  }>;
  leg_count: number;
  legs_hit: number;
  legs_missed: number;
  legs_pushed: number;
  all_legs_hit: boolean;
  missing_slots: string[];
  blocked_candidates: any[];
  created_at: string;
}

export function useLockModeBacktest() {
  const queryClient = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);

  // Fetch all backtest runs
  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['lock-mode-backtest-runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lock_mode_backtest_runs' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return data as unknown as BacktestRun[];
    },
  });

  // Fetch slips for a specific run
  const fetchSlips = async (runId: string): Promise<BacktestSlip[]> => {
    const { data, error } = await supabase
      .from('lock_mode_backtest_slips' as any)
      .select('*')
      .eq('run_id', runId)
      .order('slate_date', { ascending: false });

    if (error) throw error;
    return data as unknown as BacktestSlip[];
  };

  // Run backtest mutation
  const runBacktest = useMutation({
    mutationFn: async ({ 
      dateStart, 
      dateEnd, 
      runName 
    }: { 
      dateStart: string; 
      dateEnd: string; 
      runName?: string;
    }) => {
      setIsRunning(true);
      
      const { data, error } = await supabase.functions.invoke('run-lock-mode-backtest', {
        body: { dateStart, dateEnd, runName },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      return data as { success: boolean; runId: string; summary: BacktestSummary };
    },
    onSuccess: (data) => {
      setIsRunning(false);
      queryClient.invalidateQueries({ queryKey: ['lock-mode-backtest-runs'] });
      toast.success(
        `Backtest complete! Parlay win rate: ${data.summary.parlayWinRate.toFixed(1)}%`
      );
    },
    onError: (error: Error) => {
      setIsRunning(false);
      toast.error(`Backtest failed: ${error.message}`);
    },
  });

  return {
    runs,
    runsLoading,
    isRunning,
    runBacktest,
    fetchSlips,
  };
}
