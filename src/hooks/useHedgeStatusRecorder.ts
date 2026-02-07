import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { DeepSweetSpot } from '@/types/sweetSpot';

// Quarter boundary thresholds (game progress %)
const QUARTER_BOUNDARIES = {
  1: { min: 22, max: 28 },   // End of Q1: ~24%
  2: { min: 47, max: 53 },   // End of Q2 (Halftime): ~50%
  3: { min: 72, max: 78 },   // End of Q3: ~75%
  4: { min: 92, max: 100 },  // Late Q4: 92%+
};

interface HedgeSnapshotPayload {
  sweet_spot_id: string;
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
}

/**
 * Hook that automatically records hedge status snapshots at quarter boundaries
 * This data is used to analyze which hedge recommendations are most accurate
 */
export function useHedgeStatusRecorder(spots: DeepSweetSpot[]) {
  // Track which (spotId, quarter) combinations have been recorded this session
  const recordedRef = useRef<Map<string, Set<number>>>(new Map());
  
  const isAlreadyRecorded = useCallback((spotId: string, quarter: number): boolean => {
    const recorded = recordedRef.current.get(spotId);
    return recorded?.has(quarter) ?? false;
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
    
    // Calculate hedge status and hit probability from live data
    const hedgeStatus = calculateHedgeStatus(spot);
    const hitProbability = spot.liveData.confidence ?? 50;
    
    const payload: HedgeSnapshotPayload = {
      sweet_spot_id: spot.id,
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
      rotation_tier: undefined, // Would need to be passed from rotation analysis
      risk_flags: spot.liveData.riskFlags,
      live_book_line: spot.liveData.liveBookLine,
      line_movement: spot.liveData.lineMovement,
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
  
  // Main effect: check each spot and record at quarter boundaries
  useEffect(() => {
    // Only record for spots that have a valid database ID (UUID format from category_sweet_spots)
    // Client-generated spots won't have valid FK references
    const isValidDatabaseId = (id: string): boolean => {
      // UUID v4 pattern check - database IDs are UUIDs
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      return uuidPattern.test(id);
    };
    
    const liveSpots = spots.filter(s => 
      s.liveData?.isLive && 
      s.id && 
      isValidDatabaseId(s.id)
    );
    
    liveSpots.forEach(spot => {
      const progress = spot.liveData?.gameProgress ?? 0;
      
      // Check if we should record for any quarter
      for (let q = 1; q <= 4; q++) {
        if (shouldRecordAtProgress(q, progress) && !isAlreadyRecorded(spot.id, q)) {
          recordSnapshot(spot, q);
          markAsRecorded(spot.id, q);
        }
      }
    });
  }, [spots, shouldRecordAtProgress, isAlreadyRecorded, markAsRecorded, recordSnapshot]);
  
  // Return stats for debugging
  const recordedCount = Array.from(recordedRef.current.values())
    .reduce((sum, set) => sum + set.size, 0);
  
  return {
    recordedCount,
    recordedSpots: recordedRef.current.size,
  };
}

/**
 * Calculate hedge status from live data
 * Mirrors the logic in HedgeRecommendation.tsx
 */
function calculateHedgeStatus(spot: DeepSweetSpot): string {
  const liveData = spot.liveData;
  if (!liveData) return 'unknown';
  
  const confidence = liveData.confidence ?? 50;
  const isOver = (spot.side ?? 'over').toLowerCase() === 'over';
  
  // Check for already-settled states
  if (isOver && liveData.currentValue >= spot.line) {
    return 'profit_lock';
  }
  if (!isOver && liveData.currentValue >= spot.line) {
    return 'urgent'; // Line exceeded for UNDER
  }
  
  // Risk factor overrides
  const hasBlowout = liveData.riskFlags?.includes('blowout');
  const hasFoulTrouble = liveData.riskFlags?.includes('foul_trouble');
  const gameProgress = liveData.gameProgress ?? 0;
  
  if (hasBlowout && gameProgress > 60) {
    return 'urgent';
  }
  if (hasBlowout && hasFoulTrouble) {
    return 'urgent';
  }
  
  // Pace-based override for OVER bets
  if (isOver && (liveData.paceRating ?? 100) < 95) {
    if (confidence < 45) return 'urgent';
    if (confidence < 55) return 'alert';
  }
  
  // Standard thresholds
  if (confidence >= 65) return 'on_track';
  if (confidence >= 45) return 'monitor';
  if (confidence >= 25) return 'alert';
  return 'urgent';
}

/**
 * Calculate rate needed to hit the line
 */
function calculateRateNeeded(spot: DeepSweetSpot): number | undefined {
  const liveData = spot.liveData;
  if (!liveData || !liveData.gameProgress) return undefined;
  
  const remaining = (100 - liveData.gameProgress) / 100;
  const remainingMinutes = remaining * 48; // Assuming 48 minute game
  
  if (remainingMinutes <= 0) return undefined;
  
  const needed = spot.line - (liveData.currentValue ?? 0);
  return needed / remainingMinutes;
}
