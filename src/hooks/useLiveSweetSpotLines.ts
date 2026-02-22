import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { DeepSweetSpot, PropType } from '@/types/sweetSpot';

// Map propType to odds API market key
const PROP_TO_MARKET: Record<PropType, string> = {
  points: 'player_points',
  assists: 'player_assists',
  threes: 'player_threes',
  blocks: 'player_blocks',
};

export interface BookLine {
  line: number;
  bookmaker: string;
  overPrice?: number;
  underPrice?: number;
}

export interface LiveLineData {
  liveBookLine: number;
  lineMovement: number;       // liveBookLine - originalLine
  bookmaker: string;
  lastUpdate: string;
  overPrice?: number;
  underPrice?: number;
  allBookLines?: BookLine[];
}

interface UseLiveSweetSpotLinesOptions {
  enabled?: boolean;
  intervalMs?: number;        // Default 30s
}

/**
 * Fetches live book lines for active Sweet Spot picks
 * Uses fetch-current-odds edge function with caching to minimize API calls
 */
export function useLiveSweetSpotLines(
  spots: DeepSweetSpot[],
  options: UseLiveSweetSpotLinesOptions = {}
) {
  const { enabled = true, intervalMs = 30000 } = options;
  
  const [lineData, setLineData] = useState<Map<string, LiveLineData>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null);
  
  // Track which spots are live games
  const liveSpots = useMemo(() => {
    return spots.filter(s => s.liveData?.isLive || s.liveData?.gameStatus === 'halftime');
  }, [spots]);
  
  // Cache to avoid refetching same player/prop combo
  const cacheRef = useRef<Map<string, { data: LiveLineData; fetchedAt: number }>>(new Map());
  const CACHE_TTL = 25000; // 25s cache (slightly less than refresh interval)
  
  // Generate cache key for a spot
  const getCacheKey = useCallback((spot: DeepSweetSpot): string => {
    return `${spot.playerName.toLowerCase()}_${spot.propType}_${spot.opponentName?.toLowerCase() || ''}`;
  }, []);
  
  // Fetch live line for a single spot
  const fetchLineForSpot = useCallback(async (spot: DeepSweetSpot): Promise<{ spotId: string; data: LiveLineData | null }> => {
    const cacheKey = getCacheKey(spot);
    const cached = cacheRef.current.get(cacheKey);
    
    // Return cached if fresh
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return { spotId: spot.id, data: cached.data };
    }
    
    try {
      // We need event_id - for now we'll use game description to construct a search
      // The fetch-current-odds function needs event_id, so we'll need to look it up
      // For MVP: use the player name and prop type to search
      const marketKey = PROP_TO_MARKET[spot.propType];
      
      const { data, error } = await supabase.functions.invoke('fetch-current-odds', {
        body: {
          sport: 'basketball_nba',
          player_name: spot.playerName,
          prop_type: marketKey,
          preferred_bookmakers: ['hardrockbet', 'fanduel', 'draftkings'],
          search_all_books: true,
          return_all_books: true,
        }
      });
      
      if (error) {
        console.warn(`[LiveLines] Error fetching line for ${spot.playerName}:`, error);
        return { spotId: spot.id, data: null };
      }
      
      if (!data?.success || !data?.odds) {
        return { spotId: spot.id, data: null };
      }
      
      const liveBookLine = data.odds.line;
      const lineMovement = liveBookLine - spot.line;
      
      // Build allBookLines from response
      const allBookLines: BookLine[] = (data.all_odds || []).map((o: any) => ({
        line: o.line,
        bookmaker: o.bookmaker || 'unknown',
        overPrice: o.over_price,
        underPrice: o.under_price,
      }));
      // If no all_odds, at least include the primary
      if (allBookLines.length === 0) {
        allBookLines.push({
          line: liveBookLine,
          bookmaker: data.odds.bookmaker || 'unknown',
          overPrice: data.odds.over_price,
          underPrice: data.odds.under_price,
        });
      }

      const liveData: LiveLineData = {
        liveBookLine,
        lineMovement,
        bookmaker: data.odds.bookmaker || 'unknown',
        lastUpdate: new Date().toISOString(),
        overPrice: data.odds.over_price,
        underPrice: data.odds.under_price,
        allBookLines,
      };
      
      // Update cache
      cacheRef.current.set(cacheKey, { data: liveData, fetchedAt: Date.now() });
      
      console.log(`[LiveLines] ${spot.playerName} ${spot.propType}: Original ${spot.line} → Live ${liveBookLine} (${lineMovement >= 0 ? '+' : ''}${lineMovement.toFixed(1)})`);
      
      return { spotId: spot.id, data: liveData };
    } catch (err) {
      console.error(`[LiveLines] Exception for ${spot.playerName}:`, err);
      return { spotId: spot.id, data: null };
    }
  }, [getCacheKey]);
  
  // Batch fetch all live lines
  const fetchAllLines = useCallback(async () => {
    if (!enabled || liveSpots.length === 0) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Fetch in parallel with a limit of 5 concurrent requests
      const batchSize = 5;
      const results: { spotId: string; data: LiveLineData | null }[] = [];
      
      for (let i = 0; i < liveSpots.length; i += batchSize) {
        const batch = liveSpots.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(fetchLineForSpot));
        results.push(...batchResults);
      }
      
      // Update state with new data
      setLineData(prev => {
        const newMap = new Map(prev);
        for (const result of results) {
          if (result.data) {
            newMap.set(result.spotId, result.data);
          }
        }
        return newMap;
      });
      
      setLastFetchTime(new Date());
      
      console.log(`[LiveLines] Fetched ${results.filter(r => r.data).length}/${liveSpots.length} live lines`);
    } catch (err) {
      console.error('[LiveLines] Batch fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch live lines');
    } finally {
      setIsLoading(false);
    }
  }, [enabled, liveSpots, fetchLineForSpot]);
  
  // Initial fetch and interval
  useEffect(() => {
    if (!enabled || liveSpots.length === 0) return;
    
    // Initial fetch
    fetchAllLines();
    
    // Set up interval
    const interval = setInterval(fetchAllLines, intervalMs);
    
    return () => clearInterval(interval);
  }, [enabled, liveSpots.length, intervalMs, fetchAllLines]);
  
  // Helper to get line data for a specific spot
  const getLineData = useCallback((spotId: string): LiveLineData | undefined => {
    return lineData.get(spotId);
  }, [lineData]);
  
  // Helper to check if a line has moved significantly (±2 points)
  const hasSignificantMovement = useCallback((spotId: string): boolean => {
    const data = lineData.get(spotId);
    return data ? Math.abs(data.lineMovement) >= 2 : false;
  }, [lineData]);
  
  // Calculate staleness (time since last update)
  const getStaleness = useCallback((spotId: string): 'fresh' | 'stale' | 'expired' => {
    const data = lineData.get(spotId);
    if (!data) return 'expired';
    
    const ageMs = Date.now() - new Date(data.lastUpdate).getTime();
    if (ageMs < 60000) return 'fresh';      // < 1 min
    if (ageMs < 120000) return 'stale';     // < 2 min
    return 'expired';                        // > 2 min
  }, [lineData]);
  
  return {
    lineData,
    getLineData,
    hasSignificantMovement,
    getStaleness,
    isLoading,
    error,
    lastFetchTime,
    refresh: fetchAllLines,
    liveSpotCount: liveSpots.length,
  };
}
