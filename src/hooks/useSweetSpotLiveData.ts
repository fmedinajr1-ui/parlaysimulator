import { useMemo } from 'react';
import { useUnifiedLiveFeed } from './useUnifiedLiveFeed';
import type { DeepSweetSpot, LivePropData, PropType } from '@/types/sweetSpot';

// Map propType to the unified feed stat key
const PROP_TO_STAT_KEY: Record<PropType, string> = {
  points: 'points',
  assists: 'assists',
  threes: 'threes',
  blocks: 'blocks',
};

/**
 * Enriches sweet spots with real-time live data from the unified-player-feed
 * Uses 15s refresh interval to keep projections current during games
 */
export function useSweetSpotLiveData(spots: DeepSweetSpot[]) {
  const { games, findPlayer, getPlayerProjection, isLoading, error } = useUnifiedLiveFeed({
    enabled: spots.length > 0,
    refreshInterval: 15000, // 15s refresh
  });
  
  const enrichedSpots = useMemo(() => {
    if (!games.length) return spots;
    
    return spots.map(spot => {
      const result = findPlayer(spot.playerName);
      if (!result) return spot;
      
      const { player, game } = result;
      const projection = getPlayerProjection(spot.playerName, spot.propType);
      
      // Only add live data if game is in progress
      if (game.status !== 'in_progress') return spot;
      
      const liveData: LivePropData = {
        isLive: true,
        currentValue: projection?.current ?? 
          (player.currentStats[PROP_TO_STAT_KEY[spot.propType]] ?? 0),
        projectedFinal: projection?.projected ?? 0,
        gameProgress: game.gameProgress,
        period: String(game.period),
        clock: game.clock || '',
        confidence: projection?.confidence ?? 50,
        riskFlags: player.riskFlags || [],
        trend: projection?.trend ?? 'stable',
        minutesPlayed: player.minutesPlayed ?? 0,
        ratePerMinute: projection?.ratePerMinute ?? 0,
        paceRating: game.pace ?? 100,
      };
      
      return { ...spot, liveData };
    });
  }, [spots, games, findPlayer, getPlayerProjection]);
  
  // Calculate live game count
  const liveGameCount = useMemo(() => {
    return games.filter(g => g.status === 'in_progress').length;
  }, [games]);
  
  // Get spots with active live data
  const liveSpots = useMemo(() => {
    return enrichedSpots.filter(s => s.liveData?.isLive);
  }, [enrichedSpots]);
  
  return {
    spots: enrichedSpots,
    liveSpots,
    liveGameCount,
    isLoading,
    error,
  };
}
