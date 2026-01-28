import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ParlayLeg {
  player: string;
  line: number;
  prop_type: string;
  actual_value?: number;
  outcome?: 'hit' | 'miss' | 'push';
}

export interface ParlayOutcome {
  id?: string;
  parlay_date: string;
  total_legs: number;
  wager_amount?: number;
  payout_amount?: number;
  total_odds?: string;
  legs: ParlayLeg[];
  outcome: 'won' | 'lost' | 'push' | 'pending';
  source?: string;
  notes?: string;
  created_at?: string;
}

export function useRecordParlayOutcome() {
  const queryClient = useQueryClient();

  // Fetch all recorded outcomes
  const { data: outcomes = [], isLoading } = useQuery({
    queryKey: ['parlay-outcomes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_parlay_outcomes')
        .select('*')
        .order('parlay_date', { ascending: false });

      if (error) throw error;
      
      return (data || []).map(row => ({
        id: row.id,
        parlay_date: row.parlay_date,
        total_legs: row.total_legs,
        wager_amount: row.wager_amount,
        payout_amount: row.payout_amount,
        total_odds: row.total_odds,
        legs: row.legs as unknown as ParlayLeg[],
        outcome: row.outcome as ParlayOutcome['outcome'],
        source: row.source,
        notes: row.notes,
        created_at: row.created_at,
      })) as ParlayOutcome[];
    },
  });

  // Record a new parlay outcome
  const recordOutcome = useMutation({
    mutationFn: async (outcome: Omit<ParlayOutcome, 'id' | 'created_at'>) => {
      const { data, error } = await supabase
        .from('user_parlay_outcomes')
        .insert([{
          parlay_date: outcome.parlay_date,
          total_legs: outcome.total_legs,
          wager_amount: outcome.wager_amount,
          payout_amount: outcome.payout_amount,
          total_odds: outcome.total_odds,
          legs: JSON.parse(JSON.stringify(outcome.legs)),
          outcome: outcome.outcome,
          source: outcome.source,
          notes: outcome.notes,
        }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parlay-outcomes'] });
      toast.success('Parlay outcome recorded!');
    },
    onError: (error) => {
      toast.error(`Failed to record: ${error.message}`);
    },
  });

  // Analyze patterns from recorded outcomes
  const analyzePatterns = () => {
    const wonParlays = outcomes.filter(o => o.outcome === 'won');
    
    // Extract winning leg patterns
    const legPatterns: Record<string, { hits: number; total: number; avgLine: number }> = {};
    
    wonParlays.forEach(parlay => {
      const legs = parlay.legs as ParlayLeg[];
      legs.forEach(leg => {
        const key = `${leg.prop_type}_${leg.line}`;
        if (!legPatterns[key]) {
          legPatterns[key] = { hits: 0, total: 0, avgLine: 0 };
        }
        legPatterns[key].hits++;
        legPatterns[key].total++;
        legPatterns[key].avgLine = leg.line;
      });
    });

    // Find most successful line ranges
    const lineRanges = {
      'O1.5': 0,
      'O2.5': 0,
      'O3.5': 0,
    };
    
    wonParlays.forEach(parlay => {
      const legs = parlay.legs as ParlayLeg[];
      legs.forEach(leg => {
        if (leg.line === 1.5) lineRanges['O1.5']++;
        else if (leg.line === 2.5) lineRanges['O2.5']++;
        else if (leg.line === 3.5) lineRanges['O3.5']++;
      });
    });

    return {
      totalWins: wonParlays.length,
      totalRecorded: outcomes.length,
      winRate: outcomes.length > 0 ? (wonParlays.length / outcomes.length * 100).toFixed(1) : '0',
      topPatterns: Object.entries(legPatterns)
        .sort((a, b) => b[1].hits - a[1].hits)
        .slice(0, 5),
      lineRangeSuccess: lineRanges,
    };
  };

  // Get winning players for recommendation
  const getWinningPlayers = () => {
    const wonParlays = outcomes.filter(o => o.outcome === 'won');
    const playerHits: Record<string, number> = {};
    
    wonParlays.forEach(parlay => {
      const legs = parlay.legs as ParlayLeg[];
      legs.forEach(leg => {
        playerHits[leg.player] = (playerHits[leg.player] || 0) + 1;
      });
    });

    return Object.entries(playerHits)
      .sort((a, b) => b[1] - a[1])
      .map(([player, hits]) => ({ player, hits }));
  };

  return {
    outcomes,
    isLoading,
    recordOutcome: recordOutcome.mutate,
    isRecording: recordOutcome.isPending,
    analyzePatterns,
    getWinningPlayers,
  };
}
