import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PlayerProjection {
  current: number;
  projected: number;
  remaining: number;
  confidence: number;
  trend: 'up' | 'down' | 'stable';
  ratePerMinute: number;
}

export interface UnifiedPlayer {
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  currentStats: Record<string, number>;
  projections: Record<string, PlayerProjection>;
  riskFlags: string[];
  minutesPlayed: number;
  estimatedRemaining: number;
  role: string;
  isOnCourt: boolean;
}

export interface UnifiedGame {
  eventId: string;
  period: number;
  clock: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: 'scheduled' | 'in_progress' | 'final' | 'halftime';
  gameProgress: number;
  players: UnifiedPlayer[];
  pace: number;
}

export interface UnifiedFeedResponse {
  games: UnifiedGame[];
  totalPlayers: number;
  liveGames: number;
  lastUpdated: string;
}

interface UseUnifiedLiveFeedOptions {
  eventIds?: string[];
  refreshInterval?: number;
  enabled?: boolean;
}

// Normalize player name for matching
const normalizePlayerName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim();
};

// Match player names with fuzzy logic
const matchPlayerNames = (name1: string, name2: string): boolean => {
  const n1 = normalizePlayerName(name1);
  const n2 = normalizePlayerName(name2);
  
  if (!n1 || !n2) return false;
  if (n1 === n2) return true;
  
  // Check last name match with first initial
  const parts1 = n1.split(' ').filter(p => p.length > 1);
  const parts2 = n2.split(' ').filter(p => p.length > 1);
  
  if (parts1.length === 0 || parts2.length === 0) return false;
  
  const lastName1 = parts1[parts1.length - 1];
  const lastName2 = parts2[parts2.length - 1];
  
  if (lastName1 === lastName2) {
    if (parts1[0] && parts2[0]) {
      return parts1[0][0] === parts2[0][0];
    }
    return true;
  }
  
  return n1.includes(n2) || n2.includes(n1);
};

export function useUnifiedLiveFeed(options: UseUnifiedLiveFeedOptions = {}) {
  const { eventIds, refreshInterval = 15000, enabled = true } = options;
  
  const [data, setData] = useState<UnifiedFeedResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  
  const fetchCountRef = useRef(0);
  const isMountedRef = useRef(true);

  const fetchFeed = useCallback(async () => {
    if (!enabled) return;
    
    try {
      fetchCountRef.current++;
      const fetchId = fetchCountRef.current;
      
      console.log(`[UnifiedFeed] Fetching (${fetchId})...`, eventIds?.length ? `${eventIds.length} events` : 'all live');
      
      const { data: responseData, error: fetchError } = await supabase.functions.invoke(
        'unified-player-feed',
        { body: eventIds?.length ? { eventIds } : {} }
      );
      
      if (!isMountedRef.current) return;
      if (fetchId !== fetchCountRef.current) return; // Stale request
      
      if (fetchError) {
        console.error('[UnifiedFeed] Fetch error:', fetchError);
        setError(fetchError.message);
        return;
      }
      
      if (responseData) {
        setData(responseData);
        setLastFetched(new Date());
        setError(null);
        console.log(`[UnifiedFeed] Got ${responseData.totalPlayers} players from ${responseData.games?.length || 0} games`);
      }
    } catch (err) {
      console.error('[UnifiedFeed] Error:', err);
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [eventIds, enabled]);

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchFeed();
    
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchFeed]);

  // Polling interval
  useEffect(() => {
    if (!enabled || refreshInterval <= 0) return;
    
    const interval = setInterval(fetchFeed, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchFeed, refreshInterval, enabled]);

  // Helper: Find player by name across all games
  const findPlayer = useCallback((playerName: string): { player: UnifiedPlayer; game: UnifiedGame } | null => {
    if (!data?.games) return null;
    
    for (const game of data.games) {
      for (const player of game.players) {
        if (matchPlayerNames(player.playerName, playerName)) {
          return { player, game };
        }
      }
    }
    return null;
  }, [data]);

  // Helper: Get projection for a specific player and prop
  const getPlayerProjection = useCallback((
    playerName: string,
    propType: string
  ): PlayerProjection | null => {
    const result = findPlayer(playerName);
    if (!result) return null;
    
    const normalizedProp = propType.toLowerCase().replace(/[_\s]/g, '');
    
    // Map prop types
    const propMap: Record<string, string> = {
      'playerpoints': 'points',
      'playerrebounds': 'rebounds',
      'playerassists': 'assists',
      'playerthrees': 'threes',
      'playersteals': 'steals',
      'playerblocks': 'blocks',
      'playerptsrebsasts': 'pra',
      'ptsrebast': 'pra',
      '3pm': 'threes',
    };
    
    const statKey = propMap[normalizedProp] || normalizedProp;
    return result.player.projections[statKey] || null;
  }, [findPlayer]);

  // Helper: Get all players with risk flags
  const playersAtRisk = useMemo(() => {
    if (!data?.games) return [];
    
    return data.games.flatMap(game =>
      game.players
        .filter(p => p.riskFlags.length > 0)
        .map(p => ({ ...p, gameInfo: game }))
    );
  }, [data]);

  // Helper: Get live game count
  const liveGameCount = useMemo(() => {
    return data?.games?.filter(g => g.status === 'in_progress').length || 0;
  }, [data]);

  return {
    data,
    games: data?.games || [],
    isLoading,
    error,
    lastFetched,
    refresh: fetchFeed,
    findPlayer,
    getPlayerProjection,
    playersAtRisk,
    liveGameCount,
    totalPlayers: data?.totalPlayers || 0,
  };
}
