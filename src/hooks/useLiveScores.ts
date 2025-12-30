import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface PlayerStat {
  playerId: string;
  playerName: string;
  team: string;
  position?: string;
  points?: number;
  rebounds?: number;
  assists?: number;
  minutes?: string;
  passingYards?: number;
  rushingYards?: number;
  receivingYards?: number;
  [key: string]: any;
}

export interface LiveGame {
  id: string;
  eventId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: 'scheduled' | 'in_progress' | 'final' | 'halftime' | 'postponed';
  period: string | null;
  clock: string | null;
  startTime: Date;
  lastUpdated: Date;
  playerStats: PlayerStat[];
  quarterScores: Record<string, { period: number; score: number }[]>;
}

interface UseLiveScoresOptions {
  sport?: string;
  eventId?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function useLiveScores(options: UseLiveScoresOptions = {}) {
  const { sport, eventId, autoRefresh = true, refreshInterval = 30000 } = options;
  const [games, setGames] = useState<LiveGame[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const transformGame = useCallback((row: any): LiveGame => ({
    id: row.id,
    eventId: row.event_id,
    sport: row.sport,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    homeScore: row.home_score || 0,
    awayScore: row.away_score || 0,
    status: row.game_status as LiveGame['status'],
    period: row.period,
    clock: row.clock,
    startTime: new Date(row.start_time),
    lastUpdated: new Date(row.last_updated),
    playerStats: row.player_stats || [],
    quarterScores: row.quarter_scores || {},
  }), []);

  const fetchGames = useCallback(async () => {
    try {
      let query = supabase
        .from('live_game_scores')
        .select('*')
        .order('start_time', { ascending: true });

      if (sport) {
        query = query.eq('sport', sport.toUpperCase());
      }

      if (eventId) {
        query = query.eq('event_id', eventId);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) {
        console.error('Error fetching live scores:', fetchError);
        setError(fetchError.message);
        return;
      }

      const transformedGames = (data || []).map(transformGame);
      setGames(transformedGames);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error('Error in fetchGames:', err);
      setError('Failed to fetch live scores');
    } finally {
      setIsLoading(false);
    }
  }, [sport, eventId, transformGame]);

  // Trigger a manual sync via edge function
  const triggerSync = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('sync-live-scores', {
        body: sport ? { sport } : {},
      });

      if (error) {
        console.error('Sync error:', error);
        return false;
      }

      console.log('Sync result:', data);
      await fetchGames();
      return true;
    } catch (err) {
      console.error('Error triggering sync:', err);
      return false;
    }
  }, [sport, fetchGames]);

  // Set up realtime subscription
  useEffect(() => {
    fetchGames();

    // Subscribe to realtime changes
    const channel = supabase
      .channel('live-scores-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'live_game_scores',
        },
        (payload) => {
          console.log('Realtime update:', payload);

          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const newGame = transformGame(payload.new);
            
            // Filter by sport/eventId if specified
            if (sport && newGame.sport !== sport.toUpperCase()) return;
            if (eventId && newGame.eventId !== eventId) return;

            setGames((prev) => {
              const existingIndex = prev.findIndex((g) => g.eventId === newGame.eventId);
              if (existingIndex >= 0) {
                const updated = [...prev];
                updated[existingIndex] = newGame;
                return updated;
              }
              return [...prev, newGame];
            });
            setLastUpdated(new Date());
          } else if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as any)?.event_id;
            if (deletedId) {
              setGames((prev) => prev.filter((g) => g.eventId !== deletedId));
            }
          }
        }
      )
      .subscribe((status) => {
        console.log('Realtime subscription status:', status);
        setIsConnected(status === 'SUBSCRIBED');
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [sport, eventId, fetchGames, transformGame]);

  // Auto-refresh interval as fallback
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchGames();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchGames]);

  // Helper functions
  const getGameByEvent = useCallback(
    (eventId: string) => games.find((g) => g.eventId === eventId),
    [games]
  );

  const getLiveGames = useCallback(
    () => games.filter((g) => g.status === 'in_progress' || g.status === 'halftime'),
    [games]
  );

  const getPlayerStat = useCallback(
    (eventId: string, playerName: string) => {
      const game = getGameByEvent(eventId);
      if (!game) return null;
      return game.playerStats.find(
        (p) => p.playerName?.toLowerCase().includes(playerName.toLowerCase())
      );
    },
    [getGameByEvent]
  );

  const getGameProgress = useCallback((game: LiveGame): number => {
    if (game.status === 'scheduled') return 0;
    if (game.status === 'final') return 100;
    if (game.status === 'halftime') return 50;

    const period = game.period;
    if (!period) return 0;

    // NBA/NCAAB: 4 quarters
    if (game.sport === 'NBA' || game.sport === 'NCAAB') {
      const q = parseInt(period.replace(/\D/g, '')) || 1;
      if (period.includes('OT')) return 100 + (q * 10);
      return (q / 4) * 100;
    }

    // NFL/NCAAF: 4 quarters
    if (game.sport === 'NFL' || game.sport === 'NCAAF') {
      const q = parseInt(period.replace(/\D/g, '')) || 1;
      if (period.includes('OT')) return 100;
      return (q / 4) * 100;
    }

    // NHL: 3 periods
    if (game.sport === 'NHL') {
      const p = parseInt(period.replace(/\D/g, '')) || 1;
      if (period.includes('OT')) return 100;
      return (p / 3) * 100;
    }

    // MLB: 9 innings
    if (game.sport === 'MLB') {
      const inning = parseInt(period) || 1;
      return Math.min((inning / 9) * 100, 100);
    }

    return 50;
  }, []);

  return {
    games,
    liveGames: getLiveGames(),
    isLoading,
    isConnected,
    lastUpdated,
    error,
    refresh: fetchGames,
    triggerSync,
    getGameByEvent,
    getPlayerStat,
    getGameProgress,
  };
}