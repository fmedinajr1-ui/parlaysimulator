import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getEasternDate } from '@/lib/dateUtils';
import { calculateHedgeStatus } from '@/lib/hedgeStatusUtils';
import type { DeepSweetSpot } from '@/types/sweetSpot';

// Widened quarter boundary thresholds (game progress %)
const QUARTER_BOUNDARIES = {
  1: { min: 20, max: 30 },
  2: { min: 45, max: 55 },
  3: { min: 70, max: 80 },
  4: { min: 88, max: 100 },
};

// Interval fallback: record every 60s for any live spot
const INTERVAL_MS = 60_000;

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

function getCurrentQuarter(progress: number): number {
  if (progress < 25) return 1;
  if (progress < 50) return 2;
  if (progress < 75) return 3;
  return 4;
}

/**
 * Hook that automatically records hedge status snapshots at quarter boundaries
 * AND on a 60-second interval as a fallback for continuous coverage.
 */
export function useHedgeStatusRecorder(spots: DeepSweetSpot[]) {
  const recordedRef = useRef<Map<string, Set<number>>>(new Map());
  const intervalRecordedRef = useRef<Map<string, number>>(new Map()); // key -> last recorded timestamp
  
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
  
  // Quarter-boundary recording (on spots change)
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
  
  // Interval-based fallback: record every 60s for all live spots
  useEffect(() => {
    const interval = setInterval(() => {
      const liveSpots = spots.filter(s => s.liveData?.isLive && s.playerName);
      const now = Date.now();
      
      liveSpots.forEach(spot => {
        const compositeKey = `${spot.playerName}_${spot.propType}_${spot.line}`;
        const lastRecorded = intervalRecordedRef.current.get(compositeKey) ?? 0;
        
        if (now - lastRecorded >= INTERVAL_MS) {
          const progress = spot.liveData?.gameProgress ?? 0;
          const quarter = getCurrentQuarter(progress);
          recordSnapshot(spot, quarter);
          intervalRecordedRef.current.set(compositeKey, now);
        }
      });
    }, INTERVAL_MS);
    
    return () => clearInterval(interval);
  }, [spots, recordSnapshot]);
  
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
