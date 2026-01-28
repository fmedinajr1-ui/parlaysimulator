import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SettledPick {
  player_name: string;
  analysis_date: string;
  category: string;
  prop_type: string;
  recommended_side: string | null;
  line: number | null;
  score: number | null;
  outcome: 'hit' | 'miss' | 'push';
  l10_hit_rate: number | null;
  confidence_score: number | null;
}

interface UseSettledPicksOptions {
  category?: string;
  propType?: string;
  outcome?: string;
  limit?: number;
}

export function useSettledPicks(options: UseSettledPicksOptions = {}) {
  const { category, propType, outcome, limit = 50 } = options;

  return useQuery({
    queryKey: ['settled-picks', category, propType, outcome, limit],
    queryFn: async () => {
      let query = supabase
        .from('category_sweet_spots')
        .select(`
          player_name,
          analysis_date,
          category,
          prop_type,
          recommended_side,
          actual_line,
          actual_value,
          outcome,
          l10_hit_rate,
          confidence_score
        `)
        .in('outcome', ['hit', 'miss', 'push'])
        .order('analysis_date', { ascending: false })
        .order('player_name', { ascending: true });

      if (category && category !== 'all') {
        query = query.eq('category', category);
      }
      if (propType && propType !== 'all') {
        query = query.eq('prop_type', propType);
      }
      if (outcome && outcome !== 'all') {
        query = query.eq('outcome', outcome);
      }

      query = query.limit(limit);

      const { data, error } = await query;

      if (error) throw error;

      return (data || []).map(row => ({
        player_name: row.player_name,
        analysis_date: row.analysis_date,
        category: row.category,
        prop_type: row.prop_type,
        recommended_side: row.recommended_side,
        line: row.actual_line,
        score: row.actual_value,
        outcome: row.outcome as 'hit' | 'miss' | 'push',
        l10_hit_rate: row.l10_hit_rate,
        confidence_score: row.confidence_score,
      })) as SettledPick[];
    },
  });
}

export function useSettledPicksCount() {
  return useQuery({
    queryKey: ['settled-picks-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('category_sweet_spots')
        .select('*', { count: 'exact', head: true })
        .in('outcome', ['hit', 'miss', 'push']);

      if (error) throw error;
      return count || 0;
    },
  });
}

export function useSettledPicksCategories() {
  return useQuery({
    queryKey: ['settled-picks-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('category_sweet_spots')
        .select('category')
        .in('outcome', ['hit', 'miss', 'push']);

      if (error) throw error;
      
      const uniqueCategories = [...new Set((data || []).map(d => d.category))];
      return uniqueCategories.sort();
    },
  });
}
