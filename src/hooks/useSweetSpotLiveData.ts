import { useMemo } from 'react';
import { useUnifiedLiveFeed } from './useUnifiedLiveFeed';
import { useBatchShotChartAnalysis } from './useBatchShotChartAnalysis';
import type { DeepSweetSpot, LivePropData, PropType, ShotChartAnalysis } from '@/types/sweetSpot';

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
  
  // Batch shot chart data for all players
  const { getMatchup, isLoading: shotChartLoading } = useBatchShotChartAnalysis(spots.length > 0);
  
  const enrichedSpots = useMemo(() => {
    return spots.map(spot => {
      const result = findPlayer(spot.playerName);
      
      // Get shot chart matchup for scoring props (works even without live game)
      let shotChartMatchup: ShotChartAnalysis | undefined = undefined;
      if ((spot.propType === 'points' || spot.propType === 'threes') && spot.opponentName) {
        shotChartMatchup = getMatchup(spot.playerName, spot.opponentName, spot.propType) ?? undefined;
      }
      
      // If player not in live feed, still return with shot chart data if available
      if (!result) {
        if (shotChartMatchup) {
          return {
            ...spot,
            liveData: {
              isLive: false,
              currentValue: 0,
              projectedFinal: 0,
              gameProgress: 0,
              period: '',
              clock: '',
              confidence: 50,
              riskFlags: [],
              trend: 'stable' as const,
              minutesPlayed: 0,
              ratePerMinute: 0,
              paceRating: 100,
              shotChartMatchup,
            },
          };
        }
        return spot;
      }
      
      const { player, game } = result;
      const projection = getPlayerProjection(spot.playerName, spot.propType);
      
      // Only add full live data if game is in progress
      if (game.status !== 'in_progress') {
        if (shotChartMatchup) {
          return {
            ...spot,
            liveData: {
              isLive: false,
              currentValue: 0,
              projectedFinal: 0,
              gameProgress: 0,
              period: '',
              clock: '',
              confidence: 50,
              riskFlags: [],
              trend: 'stable' as const,
              minutesPlayed: 0,
              ratePerMinute: 0,
              paceRating: 100,
              shotChartMatchup,
            },
          };
        }
        return spot;
      }
      
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
        shotChartMatchup,
      };
      
      return { ...spot, liveData };
    });
  }, [spots, games, findPlayer, getPlayerProjection, getMatchup]);
  
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
    isLoading: isLoading || shotChartLoading,
    error,
  };
}
