import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface MinutesStabilityResult {
  /** 0-100 where 100 = perfectly consistent minutes */
  stabilityIndex: number;
  avgMinutes: number;
  stdMinutes: number;
  gamesUsed: number;
}

/**
 * Fetches L10 minutes for a list of players from nba_player_game_logs
 * and computes a minutes_stability_index (0-100).
 *
 * Stability = max(0, 100 - CV * 200) where CV = stdDev / mean
 * A CV of 0.05 (5%) → stability 90. A CV of 0.50 → stability 0.
 */
export function useMinutesStability(playerNames: string[]) {
  const { data: stabilityMap, isLoading } = useQuery({
    queryKey: ['minutes-stability', playerNames.sort().join(',')],
    queryFn: async () => {
      if (playerNames.length === 0) return new Map<string, MinutesStabilityResult>();

      const { data, error } = await supabase
        .from('nba_player_game_logs')
        .select('player_name, min')
        .in('player_name', playerNames)
        .order('game_date', { ascending: false })
        .limit(playerNames.length * 10);

      if (error || !data) return new Map<string, MinutesStabilityResult>();

      // Group by player, take L10
      const byPlayer = new Map<string, number[]>();
      for (const row of data) {
        const name = row.player_name;
        const mins = typeof row.min === 'string' ? parseFloat(row.min) : (row.min ? parseFloat(String(row.min)) : 0);
        if (mins <= 0) continue;
        const existing = byPlayer.get(name) || [];
        if (existing.length < 10) {
          existing.push(mins);
          byPlayer.set(name, existing);
        }
      }

      const result = new Map<string, MinutesStabilityResult>();
      for (const [name, minutes] of byPlayer) {
        if (minutes.length < 3) {
          result.set(name, { stabilityIndex: 50, avgMinutes: 0, stdMinutes: 0, gamesUsed: minutes.length });
          continue;
        }
        const avg = minutes.reduce((a, b) => a + b, 0) / minutes.length;
        const variance = minutes.reduce((s, m) => s + (m - avg) ** 2, 0) / minutes.length;
        const std = Math.sqrt(variance);
        const cv = avg > 0 ? std / avg : 0;
        const stabilityIndex = Math.max(0, Math.min(100, Math.round(100 - cv * 200)));
        result.set(name, { stabilityIndex, avgMinutes: avg, stdMinutes: std, gamesUsed: minutes.length });
      }

      return result;
    },
    enabled: playerNames.length > 0,
    staleTime: 5 * 60 * 1000, // Cache for 5 min
  });

  const getStability = useMemo(() => {
    return (playerName: string): MinutesStabilityResult => {
      return stabilityMap?.get(playerName) ?? { stabilityIndex: 50, avgMinutes: 0, stdMinutes: 0, gamesUsed: 0 };
    };
  }, [stabilityMap]);

  return { getStability, isLoading };
}
