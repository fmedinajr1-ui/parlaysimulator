import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getEasternDate } from '@/lib/dateUtils';
import { calculateHedgeStatus } from '@/lib/hedgeStatusUtils';
import type { DeepSweetSpot } from '@/types/sweetSpot';

// Quarter boundary thresholds (game progress %)
const QUARTER_BOUNDARIES = {
  1: { min: 22, max: 28 },
  2: { min: 47, max: 53 },
  3: { min: 72, max: 78 },
  4: { min: 92, max: 100 },
};

interface HedgeSnapshotPayload {
  sweet_spot_id?: string;
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  quarter: number;
  game_progress: number;
  hedge_status: string;
  hit_probability: number;
  current_value: number;
  projected_final: number;
  rate_per_minute?: number;
  rate_needed?: number;
  gap_to_line?: number;
  pace_rating?: number;
  zone_matchup_score?: number;
  rotation_tier?: string;
  risk_flags?: string[];
  live_book_line?: number;
  line_movement?: number;
  analysis_date: string;
}

/**
 * Hook that automatically records hedge status snapshots at quarter boundaries
 */
export function useHedgeStatusRecorder(spots: DeepSweetSpot[]) {
  const recordedRef = useRef<Map<string, Set<number>>>(new Map());
  
  const isAlreadyRecorded = useCallback((spotId: string, quarter: number): boolean => {
    return recordedRef.current.get(spotId)?.has(quarter) ?? false;
  }, []);
  
  const markAsRecorded = useCallback((spotId: string, quarter: number) => {
    if (!recordedRef.current.has(spotId)) {
      recordedRef.current.set(spotId, new Set());
    }
    recordedRef.current.get(spotId)!.add(quarter);
  }, []);
  
  const shouldRecordAtProgress = useCallback((quarter: number, progress: number): boolean => {
    const boundary = QUARTER_BOUNDARIES[quarter as keyof typeof QUARTER_BOUNDARIES];
    if (!boundary) return false;
    return progress >= boundary.min && progress <= boundary.max;
  }, []);
  
  const recordSnapshot = useCallback(async (spot: DeepSweetSpot, quarter: number) => {
    if (!spot.liveData) return;
    
    // Use shared calculateHedgeStatus — same logic as UI
    const hedgeStatus = calculateHedgeStatus(spot) ?? 'unknown';
    const hitProbability = spot.liveData.confidence ?? 50;
    const analysisDate = getEasternDate();
    
    const payload: HedgeSnapshotPayload = {
      sweet_spot_id: spot.id || undefined,
      player_name: spot.playerName,
      prop_type: spot.propType,
      line: spot.line,
      side: spot.side ?? 'over',
      quarter,
      game_progress: spot.liveData.gameProgress ?? 0,
      hedge_status: hedgeStatus,
      hit_probability: hitProbability,
      current_value: spot.liveData.currentValue ?? 0,
      projected_final: spot.liveData.projectedFinal ?? 0,
      rate_per_minute: spot.liveData.ratePerMinute,
      rate_needed: calculateRateNeeded(spot),
      gap_to_line: (spot.liveData.projectedFinal ?? 0) - spot.line,
      pace_rating: spot.liveData.paceRating,
      zone_matchup_score: spot.liveData.shotChartMatchup?.overallMatchupScore,
      rotation_tier: undefined,
      risk_flags: spot.liveData.riskFlags,
      live_book_line: spot.liveData.liveBookLine,
      line_movement: spot.liveData.lineMovement,
      analysis_date: analysisDate,
    };
    
    try {
      const { error } = await supabase.functions.invoke('record-hedge-snapshot', {
        body: payload,
      });
      
      if (error) {
        console.error('[HedgeStatusRecorder] Failed to record snapshot:', error);
      } else {
        console.log('[HedgeStatusRecorder] Recorded Q%d snapshot for %s (%s)', 
          quarter, spot.playerName, hedgeStatus);
      }
    } catch (err) {
      console.error('[HedgeStatusRecorder] Error invoking edge function:', err);
    }
  }, []);
  
  useEffect(() => {
    const liveSpots = spots.filter(s => s.liveData?.isLive && s.playerName);
    
    liveSpots.forEach(spot => {
      const progress = spot.liveData?.gameProgress ?? 0;
      const compositeKey = `${spot.playerName}_${spot.propType}_${spot.line}`;
      
      for (let q = 1; q <= 4; q++) {
        if (shouldRecordAtProgress(q, progress) && !isAlreadyRecorded(compositeKey, q)) {
          recordSnapshot(spot, q);
          markAsRecorded(compositeKey, q);
        }
      }
    });
  }, [spots, shouldRecordAtProgress, isAlreadyRecorded, markAsRecorded, recordSnapshot]);
  
  const recordedCount = Array.from(recordedRef.current.values())
    .reduce((sum, set) => sum + set.size, 0);
  
  return {
    recordedCount,
    recordedSpots: recordedRef.current.size,
  };
}

function calculateRateNeeded(spot: DeepSweetSpot): number | undefined {
  const liveData = spot.liveData;
  if (!liveData || !liveData.gameProgress) return undefined;
  
  const remaining = (100 - liveData.gameProgress) / 100;
  const remainingMinutes = remaining * 48;
  
  if (remainingMinutes <= 0) return undefined;
  
  const needed = spot.line - (liveData.currentValue ?? 0);
  return needed / remainingMinutes;
}
