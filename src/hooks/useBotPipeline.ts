import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getEasternDate } from "@/lib/dateUtils";
import { useMemo } from "react";

export interface PipelineLeg {
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  team_name?: string;
  sport?: string;
  composite_score?: number;
  confidence_score?: number;
  hit_rate?: number;
  l10_hit_rate?: number;
  american_odds?: number;
  category?: string;
  type?: string;
  l3_avg?: number;
  l10_avg?: number;
  season_avg?: number;
  _gameContext?: {
    envCluster?: string;
    envClusterStrength?: number;
    defenseStrength?: string;
    pace?: string;
    vegasTotal?: number;
    teamTotalSignal?: string;
    teamTotalComposite?: number;
    blowoutRisk?: boolean;
    gameKey?: string;
    opponentAbbrev?: string;
    defenseRank?: number;
  };
}

export interface PipelineParlay {
  id: string;
  strategy_name: string;
  tier: string | null;
  legs: PipelineLeg[];
  leg_count: number;
  combined_probability: number;
  expected_odds: number;
  outcome: string | null;
  selection_rationale: string | null;
  created_at: string;
  dna_grade: string | null;
}

export interface UniquePick extends PipelineLeg {
  pickKey: string;
  parlayIds: string[];
  strategyNames: string[];
  rationaleSnippets: string[];
}

function makePickKey(leg: PipelineLeg): string {
  return `${leg.player_name}|${leg.prop_type}|${leg.line}|${leg.side}`;
}

export function useBotPipeline() {
  const today = getEasternDate();

  const query = useQuery({
    queryKey: ["bot-pipeline", today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bot_daily_parlays")
        .select("*")
        .eq("parlay_date", today)
        .eq("outcome", "pending")
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data || []) as unknown as PipelineParlay[];
    },
    staleTime: 60000,
    refetchInterval: 60000,
  });

  const parlays = query.data || [];

  const { uniquePicks, picksByGame, picksByCluster } = useMemo(() => {
    const pickMap = new Map<string, UniquePick>();

    for (const parlay of parlays) {
      const legs = (parlay.legs as unknown as PipelineLeg[]) || [];
      for (const leg of legs) {
        const key = makePickKey(leg);
        if (!pickMap.has(key)) {
          pickMap.set(key, {
            ...leg,
            pickKey: key,
            parlayIds: [parlay.id],
            strategyNames: [parlay.strategy_name],
            rationaleSnippets: parlay.selection_rationale ? [parlay.selection_rationale] : [],
          });
        } else {
          const existing = pickMap.get(key)!;
          if (!existing.parlayIds.includes(parlay.id)) {
            existing.parlayIds.push(parlay.id);
          }
          if (!existing.strategyNames.includes(parlay.strategy_name)) {
            existing.strategyNames.push(parlay.strategy_name);
          }
          if (parlay.selection_rationale && !existing.rationaleSnippets.includes(parlay.selection_rationale)) {
            existing.rationaleSnippets.push(parlay.selection_rationale);
          }
        }
      }
    }

    const allPicks = Array.from(pickMap.values()).sort(
      (a, b) => (b.composite_score || 0) - (a.composite_score || 0)
    );

    // Group by game
    const byGame = new Map<string, UniquePick[]>();
    for (const pick of allPicks) {
      const gameKey = pick._gameContext?.gameKey || "unknown";
      if (!byGame.has(gameKey)) byGame.set(gameKey, []);
      byGame.get(gameKey)!.push(pick);
    }

    // Group by env cluster
    const byCluster = new Map<string, UniquePick[]>();
    for (const pick of allPicks) {
      const cluster = pick._gameContext?.envCluster || "UNKNOWN";
      if (!byCluster.has(cluster)) byCluster.set(cluster, []);
      byCluster.get(cluster)!.push(pick);
    }

    return { uniquePicks: allPicks, picksByGame: byGame, picksByCluster: byCluster };
  }, [parlays]);

  const parlaysByTier = useMemo(() => {
    const grouped = new Map<string, PipelineParlay[]>();
    for (const p of parlays) {
      const tier = p.tier || "unknown";
      if (!grouped.has(tier)) grouped.set(tier, []);
      grouped.get(tier)!.push(p);
    }
    // Sort: execution first
    const sorted = new Map<string, PipelineParlay[]>();
    const order = ["execution", "exploration", "validation", "bankroll_doubler"];
    for (const t of order) {
      if (grouped.has(t)) sorted.set(t, grouped.get(t)!);
    }
    for (const [k, v] of grouped) {
      if (!sorted.has(k)) sorted.set(k, v);
    }
    return sorted;
  }, [parlays]);

  return {
    parlays,
    uniquePicks,
    picksByGame,
    picksByCluster,
    parlaysByTier,
    today,
    isLoading: query.isLoading,
    error: query.error,
  };
}
