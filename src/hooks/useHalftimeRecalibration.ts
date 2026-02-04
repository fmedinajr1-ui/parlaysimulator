import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { DeepSweetSpot, HalftimeRecalibration } from '@/types/sweetSpot';

// Default regression factors (used when no database baseline exists)
const DEFAULT_2H_REGRESSION = 0.92; // 2H typically 8% lower than 1H
const STAR_REGRESSION = 0.95;       // Stars regress less
const ROLE_PLAYER_REGRESSION = 0.88; // Role players regress more

interface QuarterBaseline {
  player_name: string;
  prop_type: string;
  q1_pct: number;
  q2_pct: number;
  q3_pct: number;
  q4_pct: number;
  h1_pct: number;
  h2_pct: number;
  q1_rate: number;
  q2_rate: number;
  q3_rate: number;
  q4_rate: number;
  game_avg: number;
  minutes_avg: number;
  player_tier: string;
}

/**
 * Calculate halftime recalibration data for a spot
 * Uses database baselines when available, falls back to tier-based defaults
 */
function calculateHalftimeRecalibration(
  spot: DeepSweetSpot,
  baseline?: QuarterBaseline
): HalftimeRecalibration | null {
  const { liveData, line, side, l10Stats, production } = spot;
  
  // Only calculate at halftime
  if (liveData?.gameStatus !== 'halftime') return null;
  
  const actual1H = liveData.currentValue;
  const rate1H = liveData.ratePerMinute;
  
  // Use database baseline if available, otherwise calculate from L10
  let expected1H: number;
  let historical1HRate: number;
  let regressionFactor: number;
  let h1Pct: number;
  let h2Pct: number;
  
  if (baseline) {
    // Use database baseline
    expected1H = baseline.game_avg * baseline.h1_pct;
    historical1HRate = (baseline.q1_rate + baseline.q2_rate) / 2;
    h1Pct = baseline.h1_pct;
    h2Pct = baseline.h2_pct;
    
    // Derive regression from half distribution
    regressionFactor = h2Pct <= h1Pct 
      ? h2Pct / h1Pct  // If 2H is less than 1H
      : 1.0;           // If 2H is equal or more
      
    console.log('[HalftimeRecalibration] Using database baseline for', spot.playerName, {
      expected1H,
      h1Pct,
      h2Pct,
      playerTier: baseline.player_tier,
    });
  } else {
    // Fallback: Calculate expected 1H based on historical L10 average
    expected1H = l10Stats.avg / 2;
    historical1HRate = production.statPerMinute || 0;
    
    // Estimate regression based on production tier
    regressionFactor = production.avgMinutes >= 32 
      ? STAR_REGRESSION 
      : production.avgMinutes >= 24 
        ? DEFAULT_2H_REGRESSION 
        : ROLE_PLAYER_REGRESSION;
    
    h1Pct = 0.5;
    h2Pct = 0.5;
  }
  
  const variance1H = expected1H > 0 
    ? ((actual1H - expected1H) / expected1H) * 100 
    : 0;
  
  // Calculate 2H rate with regression
  const historical2HRate = historical1HRate * regressionFactor;
  
  // Simple linear projection (current pace)
  const expected2HMinutes = 24; // Standard 2nd half minutes
  const linearProjection = actual1H + (rate1H * expected2HMinutes);
  
  // Recalibrated projection using historical 2H rate
  const baseRecalibratedProjection = actual1H + (historical2HRate * expected2HMinutes);
  
  // Fatigue adjustment (placeholder - would come from quarter_player_snapshots)
  const fatigueScore = 0;
  const fatigueAdjustment = fatigueScore > 60 ? -0.05 : 0;
  
  // Pace adjustment
  const paceRating = liveData.paceRating || 100;
  const paceAdjustment = (paceRating - 100) / 100 * 0.5; // ±5% per 10 pace points
  
  // Minutes adjustment (stars play more in 2H of close games)
  const minutesAdjustment = 0; // Placeholder for future enhancement
  
  // Apply adjustments to recalibrated projection
  const recalibratedProjection = baseRecalibratedProjection * 
    (1 + fatigueAdjustment) * 
    (1 + paceAdjustment);
  
  const projectionDelta = linearProjection - recalibratedProjection;

  // Half distributions
  const halfDistribution = h1Pct;
  // Generate insight based on variance
  let insight: string;
  let confidenceBoost: number;
  let recommendation: string;
  
  const hasBaseline = !!baseline;
  const baselineNote = hasBaseline 
    ? ` (based on ${baseline?.player_tier} pattern)` 
    : '';
  
  if (variance1H >= 15) {
    // Hot start
    insight = `Player exceeded 1H baseline by ${variance1H.toFixed(0)}%${baselineNote}. ` +
      `Historical data shows ${((1 - regressionFactor) * 100).toFixed(0)}% regression in 2H.`;
    confidenceBoost = side === 'over' ? 5 : -10;
    recommendation = side === 'over' 
      ? `Strong 1H suggests ${side.toUpperCase()} likely to hit. Consider profit lock.`
      : `1H pace threatening UNDER. Monitor for hedge opportunity.`;
  } else if (variance1H <= -15) {
    // Cold start
    insight = `Player underperformed 1H baseline by ${Math.abs(variance1H).toFixed(0)}%${baselineNote}. ` +
      `2H surge possible but not guaranteed.`;
    confidenceBoost = side === 'over' ? -10 : 5;
    recommendation = side === 'over'
      ? `Behind at half. Need 2H burst or consider hedge.`
      : `UNDER tracking well. Hold position.`;
  } else {
    // On track
    insight = `1H production within expected range (${variance1H >= 0 ? '+' : ''}${variance1H.toFixed(0)}%)${baselineNote}. ` +
      `Projecting standard 2H regression.`;
    confidenceBoost = 0;
    recommendation = `On track. No action needed.`;
  }
  
  return {
    actual1H,
    expected1H: Math.round(expected1H * 10) / 10,
    variance1H: Math.round(variance1H * 10) / 10,
    historical1HRate: Math.round(historical1HRate * 100) / 100,
    historical2HRate: Math.round(historical2HRate * 100) / 100,
    halfDistribution,
    regressionFactor,
    linearProjection: Math.round(linearProjection * 10) / 10,
    recalibratedProjection: Math.round(recalibratedProjection * 10) / 10,
    projectionDelta: Math.round(projectionDelta * 10) / 10,
    fatigueAdjustment,
    paceAdjustment: Math.round(paceAdjustment * 100) / 100,
    minutesAdjustment,
    confidenceBoost,
    insight,
    recommendation,
  };
}

/**
 * Hook that enriches spots with halftime recalibration data
 * Fetches player baselines from database and recalculates 2nd-half projections
 */
export function useHalftimeRecalibration(spots: DeepSweetSpot[]): DeepSweetSpot[] {
  // Get unique player names at halftime for baseline lookup
  const halftimePlayers = useMemo(() => {
    return spots
      .filter(s => s.liveData?.gameStatus === 'halftime')
      .map(s => ({ player: s.playerName, propType: s.propType }));
  }, [spots]);

  // Fetch baselines for halftime players
  const { data: baselines } = useQuery({
    queryKey: ['quarter-baselines', halftimePlayers],
    queryFn: async () => {
      if (halftimePlayers.length === 0) return [];
      
      const playerNames = [...new Set(halftimePlayers.map(p => p.player))];
      
      const { data, error } = await supabase
        .from('player_quarter_baselines')
        .select('*')
        .in('player_name', playerNames);
      
      if (error) {
        console.warn('[useHalftimeRecalibration] Error fetching baselines:', error);
        return [];
      }
      
      return data as QuarterBaseline[];
    },
    enabled: halftimePlayers.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Create lookup map for baselines
  const baselineMap = useMemo(() => {
    const map = new Map<string, QuarterBaseline>();
    if (baselines) {
      for (const b of baselines) {
        map.set(`${b.player_name}-${b.prop_type}`, b);
      }
    }
    return map;
  }, [baselines]);

  return useMemo(() => {
    return spots.map(spot => {
      // Only process halftime spots with live data
      if (!spot.liveData || spot.liveData.gameStatus !== 'halftime') {
        return spot;
      }
      
      // Look up baseline for this player/prop
      const baseline = baselineMap.get(`${spot.playerName}-${spot.propType}`);
      
      const recalibration = calculateHalftimeRecalibration(spot, baseline);
      if (!recalibration) return spot;
      
      // Update the spot with recalibration data
      return {
        ...spot,
        liveData: {
          ...spot.liveData,
          halftimeRecalibration: recalibration,
          // Update projected final with recalibrated value
          projectedFinal: recalibration.recalibratedProjection,
          // Adjust confidence based on 1H performance
          confidence: Math.max(1, Math.min(99, 
            (spot.liveData.confidence || 50) + recalibration.confidenceBoost
          )),
        },
      };
    });
  }, [spots, baselineMap]);
}
