import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MatchupFavorite {
  player_name: string;
  opponent: string;
  games_played: number;
  avg_3pt_vs_team: number;
  worst_3pt_vs_team: number;
  best_3pt_vs_team: number;
  matchup_tier: 'ELITE_MATCHUP' | 'GOOD_MATCHUP' | 'VOLATILE_MATCHUP';
}

export interface PlayerMatchupProfile {
  player_name: string;
  elite_matchups: string[];
  good_matchups: string[];
  volatile_matchups: string[];
  best_opponent: { team: string; avg: number } | null;
}

export function use3PTMatchupAnalysis(playerName?: string, opponent?: string) {
  // Fetch all 3PT matchup favorites
  const { data: allMatchups = [], isLoading: isLoadingAll } = useQuery({
    queryKey: ['3pt-matchup-favorites'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_3pt_matchup_favorites')
        .select('*');

      if (error) throw error;
      return data as MatchupFavorite[];
    },
    staleTime: 300000, // 5 minutes
  });

  // Get specific player's matchup history
  const { data: playerMatchup, isLoading: isLoadingPlayer } = useQuery({
    queryKey: ['3pt-matchup', playerName, opponent],
    queryFn: async () => {
      if (!playerName) return null;

      let query = supabase
        .from('matchup_history')
        .select('*')
        .eq('prop_type', 'player_threes')
        .ilike('player_name', `%${playerName}%`);

      if (opponent) {
        query = query.ilike('opponent', `%${opponent}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!playerName,
  });

  // Get elite matchups (min >= 2)
  const eliteMatchups = allMatchups.filter(m => m.matchup_tier === 'ELITE_MATCHUP');

  // Get good matchups (min >= 1)
  const goodMatchups = allMatchups.filter(m => m.matchup_tier === 'GOOD_MATCHUP');

  // Build player profiles
  const buildPlayerProfile = (name: string): PlayerMatchupProfile | null => {
    const playerMatches = allMatchups.filter(
      m => m.player_name.toLowerCase().includes(name.toLowerCase())
    );

    if (playerMatches.length === 0) return null;

    const elite = playerMatches
      .filter(m => m.matchup_tier === 'ELITE_MATCHUP')
      .map(m => m.opponent);

    const good = playerMatches
      .filter(m => m.matchup_tier === 'GOOD_MATCHUP')
      .map(m => m.opponent);

    const volatile = playerMatches
      .filter(m => m.matchup_tier === 'VOLATILE_MATCHUP')
      .map(m => m.opponent);

    const best = playerMatches.reduce((acc, m) => 
      !acc || m.avg_3pt_vs_team > acc.avg_3pt_vs_team ? m : acc
    , null as MatchupFavorite | null);

    return {
      player_name: name,
      elite_matchups: elite,
      good_matchups: good,
      volatile_matchups: volatile,
      best_opponent: best ? { team: best.opponent, avg: best.avg_3pt_vs_team } : null,
    };
  };

  // Get matchup boost factor for a player vs opponent
  const getMatchupBoost = (player: string, opp: string, line: number): number => {
    const match = allMatchups.find(
      m => m.player_name.toLowerCase().includes(player.toLowerCase()) &&
           m.opponent.toLowerCase().includes(opp.toLowerCase())
    );

    if (!match) return 1.0;

    // Dominant matchup: avg >= 2x line
    if (match.avg_3pt_vs_team >= line * 2.0) return 1.25;
    // Good matchup: avg >= 1.5x line
    if (match.avg_3pt_vs_team >= line * 1.5) return 1.15;
    // Safe matchup: min >= line
    if (match.worst_3pt_vs_team >= line) return 1.10;
    
    return 1.0;
  };

  // Find players with elite matchups today
  const findTodaysEliteMatchups = (todaysOpponents: string[]) => {
    return allMatchups.filter(m => 
      m.matchup_tier === 'ELITE_MATCHUP' &&
      todaysOpponents.some(opp => 
        m.opponent.toLowerCase().includes(opp.toLowerCase())
      )
    );
  };

  return {
    allMatchups,
    eliteMatchups,
    goodMatchups,
    playerMatchup,
    isLoading: isLoadingAll || isLoadingPlayer,
    buildPlayerProfile,
    getMatchupBoost,
    findTodaysEliteMatchups,
  };
}
