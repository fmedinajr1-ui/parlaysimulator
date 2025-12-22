import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface NewsItem {
  id: string;
  event_id: string;
  sport: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  news_type: 'injury' | 'lineup' | 'market_move' | 'weather' | 'sharp_action' | 'trap_alert' | 'upset_signal';
  headline: string;
  impact_level: 'low' | 'medium' | 'high';
  market_impact: boolean;
  player_name?: string;
  created_at: string;
  isNew?: boolean;
}

export interface GameWithNews {
  event_id: string;
  sport: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  news_count: number;
  activity_score: number;
  last_news_at?: string;
  news: NewsItem[];
}

const SPORT_FILTER_MAP: Record<string, string[]> = {
  all: [],
  nfl: ['americanfootball_nfl', 'football_nfl', 'nfl'],
  nhl: ['icehockey_nhl', 'hockey_nhl', 'nhl'],
  nba: ['basketball_nba', 'nba'],
};

export function useGameNewsStream(sportFilter: string = 'all') {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set());

  // Fetch games with their news
  const { data: games = [], isLoading, refetch } = useQuery({
    queryKey: ['game-news-stream', sportFilter],
    queryFn: async () => {
      const now = new Date().toISOString();
      
      // Fetch upcoming games
      let gamesQuery = supabase
        .from('upcoming_games_cache')
        .select('*')
        .gte('commence_time', now)
        .order('activity_score', { ascending: false })
        .order('commence_time', { ascending: true })
        .limit(20);

      // Apply sport filter
      if (sportFilter !== 'all' && SPORT_FILTER_MAP[sportFilter]) {
        const sportKeys = SPORT_FILTER_MAP[sportFilter];
        if (sportKeys.length > 0) {
          gamesQuery = gamesQuery.or(sportKeys.map(s => `sport.ilike.%${s}%`).join(','));
        }
      }

      const { data: gamesData, error: gamesError } = await gamesQuery;
      
      if (gamesError) {
        console.error('[useGameNewsStream] Error fetching games:', gamesError);
        return [];
      }

      if (!gamesData || gamesData.length === 0) {
        return [];
      }

      // Fetch news for these games
      const eventIds = gamesData.map(g => g.event_id);
      const { data: newsData, error: newsError } = await supabase
        .from('game_news_feed')
        .select('*')
        .in('event_id', eventIds)
        .order('created_at', { ascending: false });

      if (newsError) {
        console.error('[useGameNewsStream] Error fetching news:', newsError);
      }

      // Group news by event
      const newsMap = new Map<string, NewsItem[]>();
      (newsData || []).forEach((item: any) => {
        const existing = newsMap.get(item.event_id) || [];
        existing.push({
          ...item,
          isNew: newItemIds.has(item.id),
        } as NewsItem);
        newsMap.set(item.event_id, existing);
      });

      // Combine games with news
      const result: GameWithNews[] = gamesData.map((game: any) => ({
        ...game,
        news: newsMap.get(game.event_id) || [],
      }));

      return result;
    },
    refetchInterval: 60000, // Refetch every minute
    staleTime: 30000,
  });

  // Real-time subscription for new news items
  useEffect(() => {
    const channel = supabase
      .channel('game-news-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'game_news_feed',
        },
        (payload) => {
          console.log('[useGameNewsStream] New news item:', payload.new);
          
          // Mark as new for animation
          const newId = (payload.new as any).id;
          setNewItemIds(prev => new Set([...prev, newId]));
          
          // Clear the "new" status after 3 seconds
          setTimeout(() => {
            setNewItemIds(prev => {
              const next = new Set(prev);
              next.delete(newId);
              return next;
            });
          }, 3000);
          
          // Invalidate query to refetch
          queryClient.invalidateQueries({ queryKey: ['game-news-stream'] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'upcoming_games_cache',
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['game-news-stream'] });
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
        console.log('[useGameNewsStream] Subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const triggerRefresh = useCallback(async () => {
    // Optionally trigger the edge function to aggregate fresh news
    try {
      await supabase.functions.invoke('game-news-aggregator', {
        body: { sport: sportFilter !== 'all' ? sportFilter : undefined },
      });
      await refetch();
    } catch (err) {
      console.error('[useGameNewsStream] Refresh error:', err);
    }
  }, [sportFilter, refetch]);

  return {
    games,
    isLoading,
    isConnected,
    refetch,
    triggerRefresh,
  };
}
