import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ParlayAccuracyRow {
  section: string;
  label: string;
  totalParlays: number;
  wins: number;
  losses: number;
  voids: number;
  winRate: number | null;
  missBy1: number;
  missBy1Pct: number | null;
  avgLegs: number;
  netProfit: number;
  sampleConfidence: string;
}

export interface ParlayAccuracyData {
  overall: ParlayAccuracyRow | null;
  byTier: ParlayAccuracyRow[];
  byLegCount: ParlayAccuracyRow[];
  byStrategy: ParlayAccuracyRow[];
  isLoading: boolean;
  error: Error | null;
}

interface RawRow {
  section: string;
  label: string;
  total_parlays: number;
  wins: number;
  losses: number;
  voids: number;
  win_rate: number | null;
  miss_by_1: number;
  miss_by_1_pct: number | null;
  avg_legs: number;
  net_profit: number;
  sample_confidence: string;
}

function mapRow(r: RawRow): ParlayAccuracyRow {
  return {
    section: r.section,
    label: r.label,
    totalParlays: r.total_parlays,
    wins: r.wins,
    losses: r.losses,
    voids: r.voids,
    winRate: r.win_rate,
    missBy1: r.miss_by_1,
    missBy1Pct: r.miss_by_1_pct,
    avgLegs: r.avg_legs,
    netProfit: r.net_profit,
    sampleConfidence: r.sample_confidence,
  };
}

export function useParlayAccuracy(daysBack: number = 30): ParlayAccuracyData {
  const { data, isLoading, error } = useQuery({
    queryKey: ["parlay-accuracy", daysBack],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_parlay_accuracy_dashboard", {
        days_back: daysBack,
      });
      if (error) throw error;
      return (data as unknown as RawRow[]).map(mapRow);
    },
    staleTime: 1000 * 60 * 5,
  });

  const rows = data || [];

  return {
    overall: rows.find((r) => r.section === "overall") || null,
    byTier: rows.filter((r) => r.section === "tier").sort((a, b) => b.totalParlays - a.totalParlays),
    byLegCount: rows
      .filter((r) => r.section === "leg_count")
      .sort((a, b) => {
        const aNum = parseInt(a.label);
        const bNum = parseInt(b.label);
        return aNum - bNum;
      }),
    byStrategy: rows.filter((r) => r.section === "strategy"),
    isLoading,
    error: error as Error | null,
  };
}
