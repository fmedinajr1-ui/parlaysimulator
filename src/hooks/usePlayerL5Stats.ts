import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface L5Game {
  value: number;
  gameDate: string;
}

interface L5Result {
  games: L5Game[];
  hitCount: number;
  total: number;
}

const PROP_COLUMN_MAP: Record<string, string> = {
  Points: 'points',
  Rebounds: 'rebounds',
  Assists: 'assists',
  Threes: 'threes_made',
};

export function usePlayerL5Stats(playerName: string, propType: string, line: number, lean: 'OVER' | 'UNDER') {
  return useQuery<L5Result>({
    queryKey: ['player-l5', playerName, propType],
    queryFn: async () => {
      const col = PROP_COLUMN_MAP[propType];
      if (!col) return { games: [], hitCount: 0, total: 0 };

      const { data, error } = await supabase
        .from('nba_player_game_logs')
        .select(`game_date, ${col}`)
        .ilike('player_name', `%${playerName.split(' ').pop()}%`)
        .order('game_date', { ascending: false })
        .limit(5);

      if (error || !data || data.length === 0) return { games: [], hitCount: 0, total: 0 };

      const games: L5Game[] = data.map((row: any) => ({
        value: row[col] ?? 0,
        gameDate: row.game_date,
      }));

      const hitCount = games.filter(g => 
        lean === 'OVER' ? g.value > line : g.value < line
      ).length;

      return { games, hitCount, total: games.length };
    },
    staleTime: 300000, // 5 min cache
    enabled: !!playerName && !!propType && line > 0,
  });
}
