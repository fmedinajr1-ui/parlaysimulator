import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ManualProp {
  id: string;
  player_name: string;
  prop_type: string;
  current_line: number;
  over_price: number | null;
  under_price: number | null;
  bookmaker: string | null;
  game_description: string | null;
  event_id: string | null;
  commence_time: string | null;
  confidence: number | null;
}

export interface DefenseGrade {
  team: string;
  stat_type: string;
  rank: number;
  grade: string;
}

export interface H2HRecord {
  player_name: string;
  opponent: string;
  stat_type: string;
  avg_value: number;
  games_played: number;
}

export interface PropProjection {
  player_name: string;
  prop_type: string;
  projected_value: number | null;
  l10_median: number | null;
  l10_avg: number | null;
  recommended_side: string | null;
  confidence_score: number | null;
  actual_line: number | null;
}

function getDefenseGrade(rank: number): string {
  if (rank <= 5) return "A";
  if (rank <= 10) return "B";
  if (rank <= 15) return "C";
  if (rank <= 20) return "D";
  return "F";
}

// Parse team names from game_description like "Boston Celtics vs Miami Heat"
function parseTeams(gameDescription: string | null): { home: string | null; away: string | null } {
  if (!gameDescription) return { home: null, away: null };
  const parts = gameDescription.split(" vs ");
  if (parts.length === 2) {
    return { away: parts[0].trim(), home: parts[1].trim() };
  }
  return { home: null, away: null };
}

interface PlayerL10Stats {
  player_name: string;
  last_10_avg_points: number | null;
  last_10_avg_rebounds: number | null;
  last_10_avg_assists: number | null;
  last_10_avg_threes: number | null;
}

export function useManualBuilder(statFilter: string = "all") {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);

  // Fetch today's props
  const { data: props, isLoading: propsLoading } = useQuery({
    queryKey: ["manual-builder-props", statFilter],
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      
      let query = supabase
        .from("unified_props")
        .select("id, event_id, player_name, prop_type, current_line, over_price, under_price, bookmaker, game_description, commence_time, confidence")
        .gte("commence_time", today)
        .order("current_line", { ascending: true });

      if (statFilter !== "all") {
        query = query.ilike("prop_type", `%${statFilter}%`);
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      return data as ManualProp[];
    },
  });

  // Fetch defensive ratings
  const { data: defenseRatings } = useQuery({
    queryKey: ["manual-builder-defense"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_defensive_ratings")
        .select("team_name, stat_type, defensive_rank")
        .order("defensive_rank", { ascending: true });

      if (error) throw error;

      const grades: Record<string, DefenseGrade> = {};
      data?.forEach((d) => {
        const key = `${d.team_name}-${d.stat_type}`;
        grades[key] = {
          team: d.team_name,
          stat_type: d.stat_type,
          rank: d.defensive_rank || 15,
          grade: getDefenseGrade(d.defensive_rank || 15),
        };
      });
      return grades;
    },
  });

  // Fetch projections from category_sweet_spots
  const { data: projections } = useQuery({
    queryKey: ["manual-builder-projections"],
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("category_sweet_spots")
        .select("player_name, prop_type, projected_value, l10_median, l10_avg, recommended_side, confidence_score, actual_line")
        .eq("analysis_date", today)
        .eq("is_active", true);
      
      if (error) throw error;
      return data as PropProjection[];
    },
  });

  // Fetch L10 stats as fallback for props without sweet spot analysis
  const { data: playerStats } = useQuery({
    queryKey: ["manual-builder-player-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_season_stats")
        .select("player_name, last_10_avg_points, last_10_avg_rebounds, last_10_avg_assists, last_10_avg_threes");
      
      if (error) throw error;
      return data as PlayerL10Stats[];
    },
  });

  // Helper to get projection for a specific prop (with L10 fallback)
  const getProjectionForProp = (playerName: string, propType: string): PropProjection | null => {
    // Normalize prop type
    const normalizedProp = propType.toLowerCase().replace('player_', '').replace(/_/g, '');
    
    // First try category_sweet_spots (high-confidence)
    if (projections) {
      const sweetSpot = projections.find(p => 
        p.player_name.toLowerCase() === playerName.toLowerCase() &&
        p.prop_type.toLowerCase().replace(/_/g, '') === normalizedProp
      );
      if (sweetSpot) return sweetSpot;
    }
    
    // Fallback to L10 stats
    if (playerStats) {
      const stats = playerStats.find(p => 
        p.player_name.toLowerCase() === playerName.toLowerCase()
      );
      
      if (stats) {
        const projectedValue = normalizedProp === 'points' ? stats.last_10_avg_points :
                               normalizedProp === 'rebounds' ? stats.last_10_avg_rebounds :
                               normalizedProp === 'assists' ? stats.last_10_avg_assists :
                               normalizedProp === 'threes' ? stats.last_10_avg_threes :
                               null;
        
        if (projectedValue !== null) {
          return {
            player_name: playerName,
            prop_type: propType,
            projected_value: projectedValue,
            l10_median: null,
            l10_avg: projectedValue,
            recommended_side: null,
            confidence_score: null,
            actual_line: null,
          };
        }
      }
    }
    
    return null;
  };

  const getDefenseForMatchup = (gameDescription: string | null, propType: string): DefenseGrade | null => {
    if (!gameDescription || !defenseRatings) return null;
    
    const { home } = parseTeams(gameDescription);
    if (!home) return null;
    
    // Map prop type to stat type
    let statType = "points";
    if (propType.includes("rebound")) statType = "rebounds";
    else if (propType.includes("assist")) statType = "assists";
    else if (propType.includes("three") || propType.includes("3pt")) statType = "threes";
    else if (propType.includes("steal")) statType = "steals";
    else if (propType.includes("block")) statType = "blocks";

    const key = `${home}-${statType}`;
    return defenseRatings[key] || null;
  };

  // Realtime subscription for automatic updates
  useEffect(() => {
    const channel = supabase
      .channel('manual-builder-props-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'unified_props',
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['manual-builder-props'] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'unified_props',
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['manual-builder-props'] });
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return {
    props: props || [],
    isLoading: propsLoading,
    isConnected,
    getDefenseForMatchup,
    getProjectionForProp,
    parseTeams,
  };
}
