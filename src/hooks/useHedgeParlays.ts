import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface HedgeParlayLeg {
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  odds: number;
  h2h_games: number;
  h2h_avg: number;
  h2h_hit_rate: number;
  defense_grade: string;
  hedge_role: string;
  team_name: string;
  opponent: string;
  composite_score: number;
}

interface HedgeParlay {
  id: string;
  parlay_date: string;
  parlay_type: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  legs: HedgeParlayLeg[];
  hedge_score: number;
  correlation_score: number;
  h2h_confidence: number;
  total_odds: number;
  outcome: string;
}

function getEasternDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function useHedgeParlays() {
  const queryClient = useQueryClient();
  const today = getEasternDate();

  const { data: parlays, isLoading, error, refetch } = useQuery({
    queryKey: ['hedge-parlays', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hedge_parlays')
        .select('*')
        .eq('parlay_date', today)
        .order('parlay_type');

      if (error) throw error;

      // Parse legs from JSON
      return (data || []).map(parlay => ({
        ...parlay,
        legs: (parlay.legs as unknown as HedgeParlayLeg[]) || []
      })) as HedgeParlay[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const buildMutation = useMutation({
    mutationFn: async () => {
      // First sync matchup history
      const { error: syncError } = await supabase.functions.invoke('sync-matchup-history');
      if (syncError) {
        console.warn('Matchup history sync warning:', syncError);
      }

      // Then build hedge parlays
      const { data, error } = await supabase.functions.invoke('hedge-parlay-builder');
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Built ${data?.parlays?.length || 0} hedge parlays`);
      queryClient.invalidateQueries({ queryKey: ['hedge-parlays'] });
    },
    onError: (error) => {
      console.error('Build hedge parlays error:', error);
      toast.error('Failed to build hedge parlays');
    }
  });

  return {
    parlays: parlays || [],
    isLoading,
    error,
    refetch,
    buildParlays: buildMutation.mutate,
    isBuilding: buildMutation.isPending
  };
}
