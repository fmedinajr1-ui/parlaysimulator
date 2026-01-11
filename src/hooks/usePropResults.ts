import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

export interface PropResult {
  id: string;
  source: 'risk' | 'sharp' | 'heat';
  type: 'pick' | 'parlay';
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  outcome: 'hit' | 'miss' | 'push' | 'partial' | 'pending';
  actual_value: number | null;
  confidence_score: number;
  game_date: string;
  settled_at: string | null;
  team_name?: string;
  opponent?: string;
  // Parlay-specific fields
  parlay_type?: string;
  legs?: ParlayLeg[];
  total_odds?: number;
  verified_legs_count?: number;
}

export interface ParlayLeg {
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  outcome?: 'hit' | 'miss' | 'push' | 'pending';
  actual_value?: number;
}

export interface PropResultsStats {
  totalWins: number;
  totalLosses: number;
  totalPushes: number;
  totalPending: number;
  winRate: number;
  totalSettled: number;
  byEngine: {
    risk: { wins: number; losses: number; pushes: number; pending: number };
    sharp: { wins: number; losses: number; pushes: number; pending: number };
    heat: { wins: number; losses: number; pushes: number; pending: number };
  };
}

export type EngineFilter = 'all' | 'risk' | 'sharp' | 'heat';

export function usePropResults(days: number = 7) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['prop-results', days],
    queryFn: async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const startDateStr = startDate.toISOString().split('T')[0];

      const results: PropResult[] = [];

      // Fetch Risk Engine picks (including pending for live tracking)
      const { data: riskData, error: riskError } = await supabase
        .from('nba_risk_engine_picks')
        .select('id, player_name, prop_type, line, side, outcome, actual_value, confidence_score, game_date, settled_at, team_name, opponent')
        .in('outcome', ['hit', 'miss', 'push', 'pending'])
        .gte('game_date', startDateStr)
        .order('game_date', { ascending: false })
        .order('settled_at', { ascending: false, nullsFirst: true })
        .limit(200);

      if (riskError) console.error('Risk fetch error:', riskError);

      for (const pick of (riskData || [])) {
        results.push({
          ...pick,
          source: 'risk',
          type: 'pick',
          outcome: pick.outcome as 'hit' | 'miss' | 'push',
        });
      }

      // Fetch Sharp AI parlays (including partial and pending)
      const { data: sharpData, error: sharpError } = await supabase
        .from('sharp_ai_parlays')
        .select('id, parlay_date, parlay_type, legs, outcome, settled_at, total_odds, verified_legs_count')
        .gte('parlay_date', startDateStr)
        .order('parlay_date', { ascending: false })
        .limit(50);

      if (sharpError) console.error('Sharp fetch error:', sharpError);

      for (const parlay of (sharpData || [])) {
        const legs = parlay.legs as any[];
        const outcome = parlay.outcome || 'pending';
        
        results.push({
          id: parlay.id,
          source: 'sharp',
          type: 'parlay',
          player_name: `${legs?.length || 0}-Leg Parlay`,
          prop_type: parlay.parlay_type || 'SHARP',
          line: 0,
          side: '',
          outcome: outcome as 'hit' | 'miss' | 'push' | 'partial' | 'pending',
          actual_value: null,
          confidence_score: 0,
          game_date: parlay.parlay_date,
          settled_at: parlay.settled_at,
          parlay_type: parlay.parlay_type,
          legs: legs?.map((leg: any) => ({
            player_name: leg.player_name || leg.player || '',
            prop_type: leg.prop_type || leg.market || '',
            line: leg.line || leg.target || 0,
            side: leg.side || leg.pick || 'over',
            outcome: leg.outcome || 'pending',
            actual_value: leg.actual_value,
          })),
          total_odds: parlay.total_odds,
          verified_legs_count: parlay.verified_legs_count || 0,
        });
      }

      // Fetch Heat parlays (including partial and pending)
      const { data: heatData, error: heatError } = await supabase
        .from('heat_parlays')
        .select('id, parlay_date, parlay_type, leg_1, leg_2, outcome, settled_at, verified_legs_count')
        .gte('parlay_date', startDateStr)
        .order('parlay_date', { ascending: false })
        .limit(50);

      if (heatError) console.error('Heat fetch error:', heatError);

      for (const parlay of (heatData || [])) {
        const legs = [parlay.leg_1, parlay.leg_2].filter(Boolean) as any[];
        const outcome = parlay.outcome || 'pending';
        
        results.push({
          id: parlay.id,
          source: 'heat',
          type: 'parlay',
          player_name: `${legs.length}-Leg Parlay`,
          prop_type: parlay.parlay_type || 'HEAT',
          line: 0,
          side: '',
          outcome: outcome as 'hit' | 'miss' | 'push' | 'partial' | 'pending',
          actual_value: null,
          confidence_score: 0,
          game_date: parlay.parlay_date,
          settled_at: parlay.settled_at,
          parlay_type: parlay.parlay_type,
          legs: legs.map((leg: any) => ({
            player_name: leg.player_name || leg.player || '',
            prop_type: leg.market_type || leg.prop_type || '',
            line: leg.line || 0,
            side: leg.side || 'over',
            outcome: leg.outcome || 'pending',
            actual_value: leg.actual_value,
          })),
          verified_legs_count: parlay.verified_legs_count || 0,
        });
      }

      // Sort all results by game_date desc
      results.sort((a, b) => {
        const dateCompare = new Date(b.game_date).getTime() - new Date(a.game_date).getTime();
        if (dateCompare !== 0) return dateCompare;
        return (b.settled_at || '').localeCompare(a.settled_at || '');
      });

      return results;
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
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sharp_ai_parlays',
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['prop-results'] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'heat_parlays',
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
  const settledResults = query.data?.filter(p => ['hit', 'miss', 'push'].includes(p.outcome)) || [];
  const pendingResults = query.data?.filter(p => ['partial', 'pending'].includes(p.outcome)) || [];
  
  const stats: PropResultsStats = {
    totalWins: settledResults.filter(p => p.outcome === 'hit').length,
    totalLosses: settledResults.filter(p => p.outcome === 'miss').length,
    totalPushes: settledResults.filter(p => p.outcome === 'push').length,
    totalPending: pendingResults.length,
    totalSettled: settledResults.length,
    winRate: 0,
    byEngine: {
      risk: {
        wins: settledResults.filter(p => p.source === 'risk' && p.outcome === 'hit').length,
        losses: settledResults.filter(p => p.source === 'risk' && p.outcome === 'miss').length,
        pushes: settledResults.filter(p => p.source === 'risk' && p.outcome === 'push').length,
        pending: query.data?.filter(p => p.source === 'risk' && ['partial', 'pending'].includes(p.outcome)).length || 0,
      },
      sharp: {
        wins: settledResults.filter(p => p.source === 'sharp' && p.outcome === 'hit').length,
        losses: settledResults.filter(p => p.source === 'sharp' && p.outcome === 'miss').length,
        pushes: settledResults.filter(p => p.source === 'sharp' && p.outcome === 'push').length,
        pending: query.data?.filter(p => p.source === 'sharp' && ['partial', 'pending'].includes(p.outcome)).length || 0,
      },
      heat: {
        wins: settledResults.filter(p => p.source === 'heat' && p.outcome === 'hit').length,
        losses: settledResults.filter(p => p.source === 'heat' && p.outcome === 'miss').length,
        pushes: settledResults.filter(p => p.source === 'heat' && p.outcome === 'push').length,
        pending: query.data?.filter(p => p.source === 'heat' && ['partial', 'pending'].includes(p.outcome)).length || 0,
      },
    },
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
