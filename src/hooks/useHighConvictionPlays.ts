import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getEasternDate } from "@/lib/dateUtils";

export interface HighConvictionPlay {
  player_name: string;
  prop_type: string;
  displayPropType: string;
  signal: string;
  edge_pct: number;
  confidence_tier: string;
  current_line: number;
  player_avg: number;
  sport: string;
  engines: { engine: string; side: string; confidence?: number }[];
  sideAgreement: boolean;
  convictionScore: number;
}

export function useHighConvictionPlays() {
  const today = getEasternDate();

  return useQuery({
    queryKey: ['high-conviction-plays', today],
    queryFn: async (): Promise<{ plays: HighConvictionPlay[]; stats: { total: number; allAgree: number; engineCounts: Record<string, number> } }> => {
      const { data, error } = await supabase
        .from('high_conviction_results')
        .select('*')
        .eq('analysis_date', today)
        .order('conviction_score', { ascending: false });

      if (error) {
        console.error('[HighConviction] Query error:', error);
        return { plays: [], stats: { total: 0, allAgree: 0, engineCounts: {} } };
      }

      const plays: HighConvictionPlay[] = (data || []).map((row: any) => ({
        player_name: row.player_name,
        prop_type: row.prop_type,
        displayPropType: row.display_prop_type || row.prop_type,
        signal: row.signal,
        edge_pct: Number(row.edge_pct),
        confidence_tier: row.confidence_tier || 'MEDIUM',
        current_line: Number(row.current_line),
        player_avg: Number(row.player_avg),
        sport: row.sport || 'NBA',
        engines: Array.isArray(row.engines) ? row.engines : [],
        sideAgreement: row.side_agreement || false,
        convictionScore: Number(row.conviction_score),
      }));

      const engineCounts: Record<string, number> = {};
      for (const p of plays) {
        for (const e of p.engines) {
          engineCounts[e.engine] = (engineCounts[e.engine] || 0) + 1;
        }
      }

      return {
        plays,
        stats: {
          total: plays.length,
          allAgree: plays.filter(p => p.sideAgreement).length,
          engineCounts,
        },
      };
    },
    staleTime: 60000,
  });
}
