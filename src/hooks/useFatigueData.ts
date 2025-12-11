// Fatigue data hook - NBA team fatigue scores
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface FatigueScore {
  id: string;
  team_name: string;
  opponent: string;
  fatigue_score: number;
  fatigue_category: string;
  is_back_to_back: boolean;
  is_three_in_four: boolean;
  is_altitude_game: boolean;
  travel_miles: number;
  timezone_changes: number;
  game_date: string;
  event_id: string;
}

export function useFatigueData() {
  return useQuery({
    queryKey: ['nba-fatigue-scores', new Date().toISOString().split('T')[0]],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('nba_fatigue_scores')
        .select('*')
        .eq('game_date', today);
      
      if (error) throw error;
      return data as FatigueScore[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

export function getFatigueByTeam(fatigueData: FatigueScore[] | undefined, teamName: string): FatigueScore | undefined {
  if (!fatigueData) return undefined;
  
  // Normalize team name for matching
  const normalizedInput = teamName.toLowerCase().trim();
  
  return fatigueData.find(f => {
    const normalizedTeam = f.team_name.toLowerCase();
    return normalizedTeam.includes(normalizedInput) || normalizedInput.includes(normalizedTeam);
  });
}

export function extractTeamsFromDescription(description: string): { team1: string; team2: string } | null {
  // Common patterns: "Lakers vs Celtics", "LAL @ BOS", "Team1 at Team2"
  const vsPattern = /(.+?)\s+(?:vs\.?|@|at)\s+(.+)/i;
  const match = description.match(vsPattern);
  
  if (match) {
    return {
      team1: match[1].trim(),
      team2: match[2].trim()
    };
  }
  
  return null;
}
