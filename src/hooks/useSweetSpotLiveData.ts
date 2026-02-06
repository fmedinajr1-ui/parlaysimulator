import { useMemo } from 'react';
import { useUnifiedLiveFeed } from './useUnifiedLiveFeed';
import { useBatchShotChartAnalysis } from './useBatchShotChartAnalysis';
import { useQuarterTransition } from './useQuarterTransition';
import { useHalftimeRecalibration } from './useHalftimeRecalibration';
import { useLiveSweetSpotLines } from './useLiveSweetSpotLines';
import { useHedgeStatusRecorder } from './useHedgeStatusRecorder';
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
 * v7.2: Now includes live book line tracking for hedge recommendations
 */
export function useSweetSpotLiveData(spots: DeepSweetSpot[]) {
  const { games, findPlayer, getPlayerProjection, isLoading, error } = useUnifiedLiveFeed({
    enabled: spots.length > 0,
    refreshInterval: 15000, // 15s refresh
  });
  
  // Batch shot chart data for all players
  const { getMatchup, isLoading: shotChartLoading } = useBatchShotChartAnalysis(spots.length > 0);
  
  // v7.2: Live line tracking for hedge recommendations
  const { 
    getLineData, 
    hasSignificantMovement,
    getStaleness,
    isLoading: linesLoading,
    refresh: refreshLines,
    liveSpotCount 
  } = useLiveSweetSpotLines(spots, {
    enabled: spots.length > 0,
    intervalMs: 30000, // 30s refresh for lines
  });
  
  const enrichedSpots = useMemo(() => {
    return spots.map(spot => {
      const result = findPlayer(spot.playerName);
      
      // Get shot chart matchup for scoring props (works even without live game)
      let shotChartMatchup: ShotChartAnalysis | undefined = undefined;
      if ((spot.propType === 'points' || spot.propType === 'threes') && spot.opponentName) {
        shotChartMatchup = getMatchup(spot.playerName, spot.opponentName, spot.propType) ?? undefined;
        
        // DEBUG: Log matchup attachment
        console.log('[SweetSpotLiveData] Matchup lookup:', {
          player: spot.playerName,
          opponent: spot.opponentName,
          propType: spot.propType,
          hasMatchup: !!shotChartMatchup,
          matchupScore: shotChartMatchup?.overallMatchupScore ?? null,
          zoneCount: shotChartMatchup?.zones?.length ?? 0,
        });
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
              // v7.2: Live line data
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
              // v7.2: Live line data
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
        // v7.2: Live line data
        liveBookLine: liveLineData?.liveBookLine,
        lineMovement: liveLineData?.lineMovement,
        lastLineUpdate: liveLineData?.lastUpdate,
        bookmaker: liveLineData?.bookmaker,
      };
      
      return { ...spot, liveData };
    });
    
    // DEBUG: Summary log
    const spotsWithMatchups = enrichedSpots.filter(s => s.liveData?.shotChartMatchup);
    const spotsWithLiveLines = enrichedSpots.filter(s => s.liveData?.liveBookLine !== undefined);
    console.log('[SweetSpotLiveData] Summary:', {
      totalSpots: spots.length,
      enrichedCount: enrichedSpots.length,
      spotsWithMatchups: spotsWithMatchups.length,
      spotsWithLiveLines: spotsWithLiveLines.length,
      pointsSpots: spots.filter(s => s.propType === 'points').length,
      threesSpots: spots.filter(s => s.propType === 'threes').length,
    });
    
    return enrichedSpots;
  }, [spots, games, findPlayer, getPlayerProjection, getMatchup, getLineData]);
  
  // Apply quarter transition detection
  const spotsWithTransitions = useQuarterTransition(enrichedSpots);
  
  // Apply halftime recalibration (after transitions, updates projectedFinal and confidence)
  const spotsWithRecalibration = useHalftimeRecalibration(spotsWithTransitions);
  
  // Record hedge status at quarter boundaries for accuracy tracking
  const { recordedCount } = useHedgeStatusRecorder(spotsWithRecalibration);
  
  // Calculate live game count
  const liveGameCount = useMemo(() => {
    return games.filter(g => g.status === 'in_progress').length;
  }, [games]);
  
  // Get spots with active live data
  const liveSpots = useMemo(() => {
    return spotsWithRecalibration.filter(s => s.liveData?.isLive);
  }, [spotsWithRecalibration]);
  
  // Get spots with significant line movement (for alerts)
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
    getStaleness,
    hedgeSnapshotsRecorded: recordedCount,
    isLoading: isLoading || shotChartLoading || linesLoading,
    error,
  };
}
