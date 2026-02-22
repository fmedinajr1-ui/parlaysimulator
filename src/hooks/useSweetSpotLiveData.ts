import { useMemo } from 'react';
import { useUnifiedLiveFeed } from './useUnifiedLiveFeed';
import { useBatchShotChartAnalysis } from './useBatchShotChartAnalysis';
import { useQuarterTransition } from './useQuarterTransition';
import { useHalftimeRecalibration } from './useHalftimeRecalibration';
import { useLiveSweetSpotLines } from './useLiveSweetSpotLines';
import { useHedgeStatusRecorder } from './useHedgeStatusRecorder';
import { calculateHedgeStatus } from '@/lib/hedgeStatusUtils';
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
 * v7.3: Turbo mode for faster hedge detection, adaptive refresh intervals
 */
export function useSweetSpotLiveData(spots: DeepSweetSpot[]) {
  // Check if any spot has active hedge alerts for turbo mode
  const hasActiveHedgeAlerts = useMemo(() => {
    return spots.some(s => {
      const status = s.liveData?.hedgeStatus;
      return status === 'alert' || status === 'urgent';
    });
  }, [spots]);

  const { games, findPlayer, getPlayerProjection, isLoading, error } = useUnifiedLiveFeed({
    enabled: spots.length > 0,
    refreshInterval: hasActiveHedgeAlerts ? 8000 : 15000, // 8s when hedge alerts active
  });
  
  // Batch shot chart data for all players
  const { getMatchup, isLoading: shotChartLoading } = useBatchShotChartAnalysis(spots.length > 0);
  
  // v7.3: Live line tracking with turbo mode
  const { 
    getLineData, 
    hasSignificantMovement,
    getStaleness,
    isLoading: linesLoading,
    lastFetchTime,
    refresh: refreshLines,
    liveSpotCount 
  } = useLiveSweetSpotLines(spots, {
    enabled: spots.length > 0,
    turboMode: hasActiveHedgeAlerts, // 6s when alerts, 10s otherwise
  });
  
  const enrichedSpots = useMemo(() => {
    return spots.map(spot => {
      const result = findPlayer(spot.playerName);
      
      // Get shot chart matchup for scoring props
      let shotChartMatchup: ShotChartAnalysis | undefined = undefined;
      if ((spot.propType === 'points' || spot.propType === 'threes') && spot.opponentName) {
        shotChartMatchup = getMatchup(spot.playerName, spot.opponentName, spot.propType) ?? undefined;
      }
      
      // v7.2: Get live line data for this spot
      const liveLineData = getLineData(spot.id);
      
      // If player not in live feed, still return with shot chart data if available
      if (!result) {
        if (shotChartMatchup || liveLineData) {
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
              currentQuarter: 0,
              quarterHistory: [],
              liveBookLine: liveLineData?.liveBookLine,
              lineMovement: liveLineData?.lineMovement,
              lastLineUpdate: liveLineData?.lastUpdate,
              bookmaker: liveLineData?.bookmaker,
            },
          };
        }
        return spot;
      }
      
      const { player, game } = result;
      const projection = getPlayerProjection(spot.playerName, spot.propType);
      
      // Only add full live data if game is in progress or halftime
      if (game.status !== 'in_progress' && game.status !== 'halftime') {
        if (shotChartMatchup || liveLineData) {
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
              currentQuarter: 0,
              quarterHistory: [],
              liveBookLine: liveLineData?.liveBookLine,
              lineMovement: liveLineData?.lineMovement,
              lastLineUpdate: liveLineData?.lastUpdate,
              bookmaker: liveLineData?.bookmaker,
            },
          };
        }
        return spot;
      }
      
      const currentQuarter = parseInt(String(game.period)) || 0;
      
      const liveData: LivePropData = {
        isLive: true,
        gameStatus: game.status as 'in_progress' | 'halftime',
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
        currentQuarter,
        quarterHistory: [],
        liveBookLine: liveLineData?.liveBookLine,
        lineMovement: liveLineData?.lineMovement,
        lastLineUpdate: liveLineData?.lastUpdate,
        bookmaker: liveLineData?.bookmaker,
      };
      
      // Create temp spot with liveData to calculate hedge status
      const enrichedSpot = { ...spot, liveData };
      liveData.hedgeStatus = calculateHedgeStatus(enrichedSpot) ?? undefined;
      
      return enrichedSpot;
    });
  }, [spots, games, findPlayer, getPlayerProjection, getMatchup, getLineData]);
  
  // Apply quarter transition detection
  const spotsWithTransitions = useQuarterTransition(enrichedSpots);
  
  // Apply halftime recalibration
  const spotsWithRecalibration = useHalftimeRecalibration(spotsWithTransitions);
  
  // Record hedge status at quarter boundaries
  const { recordedCount } = useHedgeStatusRecorder(spotsWithRecalibration);
  
  // Calculate live game count
  const liveGameCount = useMemo(() => {
    return games.filter(g => g.status === 'in_progress').length;
  }, [games]);
  
  // Get spots with active live data
  const liveSpots = useMemo(() => {
    return spotsWithRecalibration.filter(s => s.liveData?.isLive);
  }, [spotsWithRecalibration]);
  
  // Get spots with significant line movement
  const spotsWithLineMovement = useMemo(() => {
    return spotsWithRecalibration.filter(s => hasSignificantMovement(s.id));
  }, [spotsWithRecalibration, hasSignificantMovement]);
  
  return {
    spots: spotsWithRecalibration,
    liveSpots,
    liveGameCount,
    liveSpotCount,
    spotsWithLineMovement,
    refreshLines,
    lastFetchTime,
    getStaleness,
    hedgeSnapshotsRecorded: recordedCount,
    isLoading: isLoading || shotChartLoading || linesLoading,
    error,
  };
}
