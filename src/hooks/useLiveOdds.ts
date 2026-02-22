import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface LiveOddsParams {
  eventId?: string;
  playerName: string;
  propType: string;
  bookmaker?: string;
  enabled?: boolean;
}

interface LiveOddsResult {
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
  bookmaker: string | null;
  lastUpdated: Date | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const CACHE_DURATION_MS = 60 * 1000; // 60 seconds cache
const oddsCache = new Map<string, { data: any; timestamp: number }>();

export function useLiveOdds({
  eventId,
  playerName,
  propType,
  bookmaker = 'fanduel',
  enabled = true,
}: LiveOddsParams): LiveOddsResult {
  const [line, setLine] = useState<number | null>(null);
  const [overPrice, setOverPrice] = useState<number | null>(null);
  const [underPrice, setUnderPrice] = useState<number | null>(null);
  const [currentBookmaker, setCurrentBookmaker] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cacheKey = `${eventId}-${playerName}-${propType}`;

  const refresh = useCallback(async () => {
    if (!eventId || !playerName || !propType) {
      return;
    }

    // Check cache first
    const cached = oddsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
      setLine(cached.data.line);
      setOverPrice(cached.data.overPrice);
      setUnderPrice(cached.data.underPrice);
      setCurrentBookmaker(cached.data.bookmaker);
      setLastUpdated(new Date(cached.timestamp));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('fetch-current-odds', {
        body: {
          event_id: eventId,
          sport: 'basketball_nba',
          player_name: playerName,
          prop_type: propType,
          preferred_bookmakers: ['hardrockbet', 'fanduel', 'draftkings'],
          search_all_books: true,
        },
      });

      if (fnError) throw fnError;

      if (data?.success && data?.odds) {
        const oddsData = {
          line: data.odds.line,
          overPrice: data.odds.over_price,
          underPrice: data.odds.under_price,
          bookmaker: data.odds.bookmaker || bookmaker,
        };

        setLine(oddsData.line);
        setOverPrice(oddsData.overPrice);
        setUnderPrice(oddsData.underPrice);
        setCurrentBookmaker(oddsData.bookmaker);
        setLastUpdated(new Date());

        // Update cache
        oddsCache.set(cacheKey, { data: oddsData, timestamp: Date.now() });
      } else {
        setError(data?.message || 'No odds found');
      }
    } catch (err) {
      console.error('Error fetching live odds:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch odds');
    } finally {
      setIsLoading(false);
    }
  }, [eventId, playerName, propType, bookmaker, cacheKey]);

  useEffect(() => {
    if (enabled) {
      refresh();
    }
  }, [enabled, refresh]);

  return {
    line,
    overPrice,
    underPrice,
    bookmaker: currentBookmaker,
    lastUpdated,
    isLoading,
    error,
    refresh,
  };
}

// Utility hook to refresh odds for the entire prop market
export function useRefreshPropMarketOdds() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('nba-player-prop-risk-engine', {
        body: { 
          action: 'analyze_slate', 
          mode: 'full_slate', 
          use_live_odds: true,
          preferred_bookmakers: ['hardrockbet', 'fanduel', 'draftkings']
        },
      });

      if (error) throw error;
      
      // Clear the odds cache
      oddsCache.clear();
      setLastRefresh(new Date());
      
      return { success: true, ...data };
    } catch (err) {
      console.error('Error refreshing prop market odds:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Failed to refresh' };
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  return { refreshAll, isRefreshing, lastRefresh };
}
