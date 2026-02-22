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
  lineMovement: number;
  bookmaker: string;
  lastUpdate: string;
  overPrice?: number;
  underPrice?: number;
  allBookLines?: BookLine[];
}

interface UseLiveSweetSpotLinesOptions {
  enabled?: boolean;
  intervalMs?: number;
  turboMode?: boolean;  // 6s polling when hedge alerts active
}

const TURBO_INTERVAL = 6000;
const NORMAL_INTERVAL = 10000;
const CACHE_TTL = 8000;

/**
 * Fetches live book lines for active Sweet Spot picks
 * v7.3: Uses fetch-batch-odds for single API call, turbo mode for hedge alerts
 */
export function useLiveSweetSpotLines(
  spots: DeepSweetSpot[],
  options: UseLiveSweetSpotLinesOptions = {}
) {
  const { enabled = true, turboMode = false } = options;
  const intervalMs = options.intervalMs ?? (turboMode ? TURBO_INTERVAL : NORMAL_INTERVAL);
  
  const [lineData, setLineData] = useState<Map<string, LiveLineData>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null);
  
  // Track which spots are live games
  const liveSpots = useMemo(() => {
    return spots.filter(s => s.liveData?.isLive || s.liveData?.gameStatus === 'halftime');
  }, [spots]);
  
  // Cache ref
  const cacheRef = useRef<Map<string, { data: LiveLineData; fetchedAt: number }>>(new Map());
  
  const getCacheKey = useCallback((spot: DeepSweetSpot): string => {
    return `${spot.playerName.toLowerCase()}_${spot.propType}_${spot.opponentName?.toLowerCase() || ''}`;
  }, []);
  
  // Batch fetch all live lines in ONE call
  const fetchAllLines = useCallback(async () => {
    if (!enabled || liveSpots.length === 0) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Filter out spots with fresh cache
      const spotsToFetch = liveSpots.filter(s => {
        const cached = cacheRef.current.get(getCacheKey(s));
        return !cached || Date.now() - cached.fetchedAt >= CACHE_TTL;
      });
      
      if (spotsToFetch.length === 0) {
        // All cached — just refresh from cache
        setLineData(prev => {
          const newMap = new Map(prev);
          for (const spot of liveSpots) {
            const cached = cacheRef.current.get(getCacheKey(spot));
            if (cached) newMap.set(spot.id, cached.data);
          }
          return newMap;
        });
        setLastFetchTime(new Date());
        setIsLoading(false);
        return;
      }
      
      // Build batch request
      const players = spotsToFetch.map(s => ({
        player_name: s.playerName,
        prop_type: PROP_TO_MARKET[s.propType],
      }));
      
      console.log(`[LiveLines] Batch fetching ${players.length} players (turbo: ${turboMode})`);
      
      const { data, error: fnError } = await supabase.functions.invoke('fetch-batch-odds', {
        body: {
          sport: 'basketball_nba',
          players,
          preferred_bookmakers: ['hardrockbet', 'fanduel', 'draftkings'],
          return_all_books: true,
        }
      });
      
      if (fnError) {
        console.warn('[LiveLines] Batch fetch error, falling back:', fnError);
        throw new Error('Batch fetch failed');
      }
      
      if (!data?.success || !data?.results) {
        console.warn('[LiveLines] No results from batch endpoint');
        setIsLoading(false);
        return;
      }
      
      // Map results back to spots
      setLineData(prev => {
        const newMap = new Map(prev);
        
        for (const spot of spotsToFetch) {
          const marketKey = PROP_TO_MARKET[spot.propType];
          const result = data.results.find((r: any) =>
            r.player_name.toLowerCase() === spot.playerName.toLowerCase() &&
            r.prop_type === marketKey
          );
          
          if (!result?.success || !result.odds) continue;
          
          const liveBookLine = result.odds.line;
          const lineMovement = liveBookLine - spot.line;
          
          const allBookLines: BookLine[] = (result.all_odds || []).map((o: any) => ({
            line: o.line,
            bookmaker: o.bookmaker || 'unknown',
            overPrice: o.over_price,
            underPrice: o.under_price,
          }));
          
          if (allBookLines.length === 0) {
            allBookLines.push({
              line: liveBookLine,
              bookmaker: result.odds.bookmaker || 'unknown',
              overPrice: result.odds.over_price,
              underPrice: result.odds.under_price,
            });
          }
          
          const liveData: LiveLineData = {
            liveBookLine,
            lineMovement,
            bookmaker: result.odds.bookmaker || 'unknown',
            lastUpdate: new Date().toISOString(),
            overPrice: result.odds.over_price,
            underPrice: result.odds.under_price,
            allBookLines,
          };
          
          // Update cache
          cacheRef.current.set(getCacheKey(spot), { data: liveData, fetchedAt: Date.now() });
          newMap.set(spot.id, liveData);
          
          console.log(`[LiveLines] ${spot.playerName} ${spot.propType}: ${spot.line} → ${liveBookLine} (${lineMovement >= 0 ? '+' : ''}${lineMovement.toFixed(1)})`);
        }
        
        return newMap;
      });
      
      setLastFetchTime(new Date());
      console.log(`[LiveLines] Batch complete: ${data.results.filter((r: any) => r.success).length}/${spotsToFetch.length} found`);
      
    } catch (err) {
      console.error('[LiveLines] Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch live lines');
    } finally {
      setIsLoading(false);
    }
  }, [enabled, liveSpots, getCacheKey, turboMode]);
  
  // Initial fetch and interval
  useEffect(() => {
    if (!enabled || liveSpots.length === 0) return;
    
    fetchAllLines();
    const interval = setInterval(fetchAllLines, intervalMs);
    return () => clearInterval(interval);
  }, [enabled, liveSpots.length, intervalMs, fetchAllLines]);
  
  const getLineData = useCallback((spotId: string): LiveLineData | undefined => {
    return lineData.get(spotId);
  }, [lineData]);
  
  const hasSignificantMovement = useCallback((spotId: string): boolean => {
    const data = lineData.get(spotId);
    return data ? Math.abs(data.lineMovement) >= 2 : false;
  }, [lineData]);
  
  const getStaleness = useCallback((spotId: string): 'fresh' | 'stale' | 'expired' => {
    const data = lineData.get(spotId);
    if (!data) return 'expired';
    const ageMs = Date.now() - new Date(data.lastUpdate).getTime();
    if (ageMs < 60000) return 'fresh';
    if (ageMs < 120000) return 'stale';
    return 'expired';
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
