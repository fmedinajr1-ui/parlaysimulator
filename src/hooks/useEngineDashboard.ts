import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getEasternDate, getEasternDateDaysAgo } from "@/lib/dateUtils";

interface EngineStats {
  picksToday: number;
  avgConfidence: number;
  lastRun: string | null;
  isActive: boolean;
  roleDistribution?: Record<string, number>;
  decisionDistribution?: Record<string, number>;
  avgSES?: number;
}

interface ParlayStats {
  parlaysToday: number;
  parlayDetails: Array<{ type: string; legs: number; odds: number }>;
  weeklyRecord: { wins: number; losses: number; pending: number };
  lastRun: string | null;
  isActive: boolean;
  watchlistCount?: number;
  doNotBetCount?: number;
}

interface EngineDashboardData {
  riskEngine: EngineStats;
  propEngineV2: EngineStats;
  sharpBuilder: ParlayStats;
  heatEngine: ParlayStats;
  overall: {
    totalPicks: number;
    totalParlays: number;
    winRate7Day: number;
  };
  isLoading: boolean;
  refetch: () => void;
}

export function useEngineDashboard(): EngineDashboardData {
  const today = getEasternDate();
  const sevenDaysAgo = getEasternDateDaysAgo(7);

  // Risk Engine stats
  const { data: riskEngineData, refetch: refetchRisk } = useQuery({
    queryKey: ['engine-dashboard-risk', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nba_risk_engine_picks')
        .select('*')
        .eq('game_date', today);
      
      if (error) throw error;
      return data || [];
    },
    staleTime: 30000,
  });

  // Prop Engine v2 stats
  const { data: propV2Data, refetch: refetchPropV2 } = useQuery({
    queryKey: ['engine-dashboard-propv2', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prop_engine_v2_picks')
        .select('*')
        .eq('game_date', today);
      
      if (error) throw error;
      return data || [];
    },
    staleTime: 30000,
  });

  // Sharp parlay stats
  const { data: sharpData, refetch: refetchSharp } = useQuery({
    queryKey: ['engine-dashboard-sharp', today, sevenDaysAgo],
    queryFn: async () => {
      const [todayResult, weeklyResult] = await Promise.all([
        supabase
          .from('sharp_ai_parlays')
          .select('id, parlay_type, parlay_date, estimated_odds, outcome, created_at')
          .eq('parlay_date', today) as any,
        supabase
          .from('sharp_ai_parlays')
          .select('id, parlay_type, parlay_date, estimated_odds, outcome, created_at')
          .gte('parlay_date', sevenDaysAgo)
          .lte('parlay_date', today) as any
      ]);
      
      return {
        today: (todayResult.data || []) as any[],
        weekly: (weeklyResult.data || []) as any[]
      };
    },
    staleTime: 30000,
  });

  // Heat engine stats
  const { data: heatData, refetch: refetchHeat } = useQuery({
    queryKey: ['engine-dashboard-heat', today, sevenDaysAgo],
    queryFn: async () => {
      const [todayResult, weeklyResult, watchlistResult, doNotBetResult] = await Promise.all([
        supabase
          .from('heat_parlays')
          .select('id, parlay_type, parlay_date, total_odds, outcome, created_at')
          .eq('parlay_date', today) as any,
        supabase
          .from('heat_parlays')
          .select('id, parlay_type, parlay_date, total_odds, outcome, created_at')
          .gte('parlay_date', sevenDaysAgo)
          .lte('parlay_date', today) as any,
        supabase.from('heat_watchlist').select('id'),
        supabase.from('heat_do_not_bet').select('id')
      ]);
      
      return {
        today: (todayResult.data || []) as any[],
        weekly: (weeklyResult.data || []) as any[],
        watchlistCount: watchlistResult.data?.length || 0,
        doNotBetCount: doNotBetResult.data?.length || 0
      };
    },
    staleTime: 30000,
  });

  const { isLoading } = useQuery({
    queryKey: ['engine-dashboard-combined'],
    queryFn: async () => null,
    enabled: false,
  });

  // Calculate risk engine stats
  const riskRoleDistribution: Record<string, number> = {};
  if (riskEngineData) {
    for (const p of riskEngineData) {
      const role = p.player_role || 'Unknown';
      riskRoleDistribution[role] = (riskRoleDistribution[role] || 0) + 1;
    }
  }

  const riskEngine: EngineStats = {
    picksToday: riskEngineData?.length || 0,
    avgConfidence: riskEngineData?.length 
      ? riskEngineData.reduce((sum, p) => sum + (p.confidence_score || 0), 0) / riskEngineData.length 
      : 0,
    lastRun: riskEngineData?.[0]?.created_at || null,
    isActive: isWithinMinutes(riskEngineData?.[0]?.created_at, 30),
    roleDistribution: riskRoleDistribution,
  };

  // Calculate prop v2 stats
  const propDecisionDistribution: Record<string, number> = {};
  if (propV2Data) {
    for (const p of propV2Data) {
      const decision = p.decision || 'Unknown';
      propDecisionDistribution[decision] = (propDecisionDistribution[decision] || 0) + 1;
    }
  }

  const propEngineV2: EngineStats = {
    picksToday: propV2Data?.length || 0,
    avgSES: propV2Data?.length
      ? propV2Data.reduce((sum, p) => sum + (p.ses_score || 0), 0) / propV2Data.length
      : 0,
    avgConfidence: 0,
    lastRun: propV2Data?.[0]?.created_at || null,
    isActive: isWithinMinutes(propV2Data?.[0]?.created_at, 30),
    decisionDistribution: propDecisionDistribution,
  };

  // Calculate sharp builder stats
  const sharpWeeklyRecord = calculateWeeklyRecord(sharpData?.weekly || []);
  const sharpBuilder: ParlayStats = {
    parlaysToday: sharpData?.today?.length || 0,
    parlayDetails: (sharpData?.today || []).map(p => ({
      type: p.parlay_type || 'Unknown',
      legs: 2, // Sharp parlays use leg_1 and leg_2
      odds: p.estimated_odds || 0,
    })),
    weeklyRecord: sharpWeeklyRecord,
    lastRun: sharpData?.today?.[0]?.created_at || null,
    isActive: isWithinMinutes(sharpData?.today?.[0]?.created_at, 360),
  };

  // Calculate heat engine stats
  const heatWeeklyRecord = calculateWeeklyRecord(heatData?.weekly || []);
  const heatEngine: ParlayStats = {
    parlaysToday: heatData?.today?.length || 0,
    parlayDetails: (heatData?.today || []).map(p => ({
      type: p.parlay_type || 'Unknown',
      legs: 2, // Heat parlays use leg_1 and leg_2
      odds: p.total_odds || 0,
    })),
    weeklyRecord: heatWeeklyRecord,
    lastRun: heatData?.today?.[0]?.created_at || null,
    isActive: isWithinMinutes(heatData?.today?.[0]?.created_at, 360),
    watchlistCount: heatData?.watchlistCount || 0,
    doNotBetCount: heatData?.doNotBetCount || 0,
  };

  // Calculate overall stats
  const allWeeklyParlays = [...(sharpData?.weekly || []), ...(heatData?.weekly || [])];
  const totalWins = allWeeklyParlays.filter(p => p.outcome === 'won').length;
  const totalLosses = allWeeklyParlays.filter(p => p.outcome === 'lost').length;
  const winRate = totalWins + totalLosses > 0 ? (totalWins / (totalWins + totalLosses)) * 100 : 0;

  const overall = {
    totalPicks: riskEngine.picksToday + propEngineV2.picksToday,
    totalParlays: sharpBuilder.parlaysToday + heatEngine.parlaysToday,
    winRate7Day: winRate,
  };

  const refetch = () => {
    refetchRisk();
    refetchPropV2();
    refetchSharp();
    refetchHeat();
  };

  return {
    riskEngine,
    propEngineV2,
    sharpBuilder,
    heatEngine,
    overall,
    isLoading,
    refetch,
  };
}

function isWithinMinutes(dateString: string | null, minutes: number): boolean {
  if (!dateString) return false;
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return diffMs < minutes * 60 * 1000;
}

function calculateWeeklyRecord(parlays: any[]): { wins: number; losses: number; pending: number } {
  return parlays.reduce(
    (acc, p) => {
      if (p.outcome === 'won') acc.wins++;
      else if (p.outcome === 'lost') acc.losses++;
      else acc.pending++;
      return acc;
    },
    { wins: 0, losses: 0, pending: 0 }
  );
}
