import { useQuery } from "@tanstack/react-query";
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

export function useManualBuilder(statFilter: string = "all") {
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

  return {
    props: props || [],
    isLoading: propsLoading,
    getDefenseForMatchup,
    parseTeams,
  };
}
