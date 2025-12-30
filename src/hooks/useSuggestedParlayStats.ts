import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { calculateStreak, calculateBestWorstStreaks, calculateROI, ParlayResult } from "@/utils/roiCalculator";

interface SuggestedParlayResult {
  id: string;
  outcome: string;
  total_odds: number;
  settled_at: string | null;
  created_at: string;
  sport: string;
  confidence_score: number;
  suggestion_reason: string;
  legs: any[];
  leg_outcomes: any[];
}

interface ParlayStats {
  totalParlays: number;
  wonParlays: number;
  lostParlays: number;
  pendingParlays: number;
  winRate: number;
  currentStreak: { type: 'W' | 'L' | 'none'; count: number };
  bestWinStreak: number;
  worstLossStreak: number;
  roi: number;
  totalUnits: number;
}

export function useSuggestedParlayStats() {
  const { user } = useAuth();
  const [parlays, setParlays] = useState<SuggestedParlayResult[]>([]);
  const [stats, setStats] = useState<ParlayStats>({
    totalParlays: 0,
    wonParlays: 0,
    lostParlays: 0,
    pendingParlays: 0,
    winRate: 0,
    currentStreak: { type: 'none', count: 0 },
    bestWinStreak: 0,
    worstLossStreak: 0,
    roi: 0,
    totalUnits: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchParlays();
    }
  }, [user]);

  const fetchParlays = async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('suggested_parlays')
        .select('id, outcome, total_odds, settled_at, created_at, sport, confidence_score, suggestion_reason, legs, leg_outcomes')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;

      const typedData = (data || []).map(item => ({
        ...item,
        legs: item.legs as any[],
        leg_outcomes: (item.leg_outcomes || []) as any[],
      }));

      setParlays(typedData);
      calculateStats(typedData);
    } catch (error) {
      console.error('Error fetching suggested parlay history:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const calculateStats = (data: SuggestedParlayResult[]) => {
    const won = data.filter(p => p.outcome === 'won').length;
    const lost = data.filter(p => p.outcome === 'lost').length;
    const pending = data.filter(p => p.outcome === 'pending').length;
    const settled = won + lost;

    // Convert to ParlayResult format for streak calculations
    const parlayResults: ParlayResult[] = data
      .filter(p => p.outcome === 'won' || p.outcome === 'lost')
      .map(p => ({
        outcome: p.outcome,
        totalOdds: p.total_odds,
        stake: 1, // Assume 1 unit per parlay
      }));

    const currentStreak = calculateStreak(parlayResults);
    const { bestWin, worstLoss } = calculateBestWorstStreaks(parlayResults);
    const roiStats = calculateROI(parlayResults);

    setStats({
      totalParlays: data.length,
      wonParlays: won,
      lostParlays: lost,
      pendingParlays: pending,
      winRate: settled > 0 ? (won / settled) * 100 : 0,
      currentStreak,
      bestWinStreak: bestWin,
      worstLossStreak: worstLoss,
      roi: roiStats.roiPercentage,
      totalUnits: roiStats.netProfit,
    });
  };

  const refreshResults = async () => {
    try {
      // Call the verification function
      await supabase.functions.invoke('verify-suggested-parlay-outcomes');
      // Refresh the data
      await fetchParlays();
    } catch (error) {
      console.error('Error refreshing results:', error);
    }
  };

  return { parlays, stats, isLoading, refreshResults };
}
