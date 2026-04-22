import { useMemo } from 'react';
import { useUnifiedLiveFeed } from './useUnifiedLiveFeed';
import { useBatchShotChartAnalysis } from './useBatchShotChartAnalysis';
import { useQuarterTransition } from './useQuarterTransition';
import { useHalftimeRecalibration } from './useHalftimeRecalibration';
import { useLiveSweetSpotLines } from './useLiveSweetSpotLines';
import { useHedgeStatusRecorder } from './useHedgeStatusRecorder';
import { calculateHedgeStatus } from '@/lib/hedgeStatusUtils';
import { calculateTriSignalProjection } from '@/lib/triSignalProjection';
import type { DeepSweetSpot, LivePropData, PropType, ShotChartAnalysis } from '@/types/sweetSpot';

// Map propType to the unified feed stat key
const PROP_TO_STAT_KEY: Record<PropType, string> = {
  points: 'points',
  assists: 'assists',
  threes: 'threes',
  blocks: 'blocks',
  rebounds: 'rebounds',
  steals: 'steals',
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
                selectedBook: liveLineData?.selectedBook ?? spot.selectedBook ?? undefined,
                hasActiveBookLine: liveLineData?.hasActiveBookLine ?? spot.hasActiveBookLine ?? undefined,
                lineFreshness: liveLineData?.lineFreshness ?? spot.lineFreshness ?? undefined,
                lineDrift: liveLineData?.lineDrift ?? spot.lineDrift ?? undefined,
              closestLine: liveLineData?.closestLine,
              closestBookmaker: liveLineData?.closestBookmaker,
              closestDelta: liveLineData?.closestDelta,
              isScanning: liveLineData?.isScanning,
              allBookLines: liveLineData?.allBookLines,
            },
          };
        }
        return spot;
      }
      
      const { player, game } = result;
      const projection = getPlayerProjection(spot.playerName, spot.propType);
      
      // Game found but not actively in progress — preserve pre-game projections
      if (game.status !== 'in_progress' && game.status !== 'halftime') {
        const preGameProjection = projection?.projected ?? (spot.edge + spot.line);
        const preGameCurrent = projection?.current ?? 0;
        
        return {
          ...spot,
          liveData: {
            isLive: false,
            gameStatus: game.status as any,
            currentValue: preGameCurrent,
            projectedFinal: preGameProjection,
            gameProgress: 0,
            period: '',
            clock: '',
            confidence: projection?.confidence ?? spot.sweetSpotScore ?? 50,
            riskFlags: [],
            trend: 'stable' as const,
            minutesPlayed: 0,
            ratePerMinute: 0,
            paceRating: game.pace ?? 100,
            shotChartMatchup,
            currentQuarter: 0,
            quarterHistory: [],
            liveBookLine: liveLineData?.liveBookLine,
            lineMovement: liveLineData?.lineMovement,
            lastLineUpdate: liveLineData?.lastUpdate,
            bookmaker: liveLineData?.bookmaker,
                selectedBook: liveLineData?.selectedBook ?? spot.selectedBook ?? undefined,
                hasActiveBookLine: liveLineData?.hasActiveBookLine ?? spot.hasActiveBookLine ?? undefined,
                lineFreshness: liveLineData?.lineFreshness ?? spot.lineFreshness ?? undefined,
                lineDrift: liveLineData?.lineDrift ?? spot.lineDrift ?? undefined,
            closestLine: liveLineData?.closestLine,
            closestBookmaker: liveLineData?.closestBookmaker,
            closestDelta: liveLineData?.closestDelta,
            isScanning: liveLineData?.isScanning,
            allBookLines: liveLineData?.allBookLines,
          },
        };
      }
      
      const currentQuarter = parseInt(String(game.period)) || 0;
      
      // Tri-signal projection: blend rate, book line, and FG efficiency
      const currentValue = projection?.current ?? 
        (player.currentStats[PROP_TO_STAT_KEY[spot.propType]] ?? 0);
      const rawProjected = projection?.projected ?? 0;
      const ratePerMinute = projection?.ratePerMinute ?? 0;
      const remainingMinutes = player.estimatedRemaining ?? 0;
      
      const triSignal = calculateTriSignalProjection({
        currentValue,
        ratePerMinute,
        remainingMinutes,
        gameProgress: game.gameProgress,
        propType: spot.propType,
        liveBookLine: liveLineData?.liveBookLine ?? liveLineData?.closestLine,
        fgPct: player.currentStats?.fgPct,
        baselineFgPct: undefined, // baseline from L10 can be added later
      });
      
      const projectedFinal = triSignal.projectedFinal || rawProjected;

      const liveData: LivePropData = {
        isLive: true,
        gameStatus: game.status as 'in_progress' | 'halftime',
        currentValue,
        projectedFinal,
        gameProgress: game.gameProgress,
        period: String(game.period),
        clock: game.clock || '',
        confidence: Math.max(projection?.confidence ?? 50, triSignal.confidence),
        riskFlags: player.riskFlags || [],
        trend: projection?.trend ?? 'stable',
        minutesPlayed: player.minutesPlayed ?? 0,
        ratePerMinute,
        paceRating: game.pace ?? 100,
        shotChartMatchup,
        currentQuarter,
        quarterHistory: [],
        liveBookLine: liveLineData?.liveBookLine,
        lineMovement: liveLineData?.lineMovement,
        lastLineUpdate: liveLineData?.lastUpdate,
        bookmaker: liveLineData?.bookmaker,
        closestLine: liveLineData?.closestLine,
        closestBookmaker: liveLineData?.closestBookmaker,
        closestDelta: liveLineData?.closestDelta,
        isScanning: liveLineData?.isScanning,
        allBookLines: liveLineData?.allBookLines,
      };
      
      return { ...spot, liveData };
    });
  }, [spots, games, findPlayer, getPlayerProjection, getMatchup, getLineData]);
  
  // Apply quarter transition detection
  const spotsWithTransitions = useQuarterTransition(enrichedSpots);
  
  // Apply halftime recalibration
  const spotsWithRecalibration = useHalftimeRecalibration(spotsWithTransitions);
  
  // Recalculate hedge status AFTER halftime recalibration so it uses 2H-adjusted projections
  const finalSpots = useMemo(() => {
    return spotsWithRecalibration.map(spot => {
      if (!spot.liveData) return spot;
      const hedgeStatus = calculateHedgeStatus(spot) ?? undefined;
      if (hedgeStatus === spot.liveData.hedgeStatus) return spot;
      return {
        ...spot,
        liveData: { ...spot.liveData, hedgeStatus },
      };
    });
  }, [spotsWithRecalibration]);
  
  // Record hedge status at quarter boundaries
  const { recordedCount } = useHedgeStatusRecorder(finalSpots);
  
  // Calculate live game count
  const liveGameCount = useMemo(() => {
    return games.filter(g => g.status === 'in_progress').length;
  }, [games]);
  
  // Get spots with active live data
  const liveSpots = useMemo(() => {
    return finalSpots.filter(s => s.liveData?.isLive);
  }, [finalSpots]);
  
  // Get spots with significant line movement
  const spotsWithLineMovement = useMemo(() => {
    return finalSpots.filter(s => hasSignificantMovement(s.id));
  }, [finalSpots, hasSignificantMovement]);
  
  return {
    spots: finalSpots,
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
