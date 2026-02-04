import { useMemo } from 'react';
import type { DeepSweetSpot, HalftimeRecalibration } from '@/types/sweetSpot';

// Default regression factors (derived from typical NBA patterns)
const DEFAULT_2H_REGRESSION = 0.92; // 2H typically 8% lower than 1H
const STAR_REGRESSION = 0.95;       // Stars regress less
const ROLE_PLAYER_REGRESSION = 0.88; // Role players regress more

/**
 * Calculate halftime recalibration data for a spot
 * Uses L10 historical baselines and tier-based regression
 */
function calculateHalftimeRecalibration(
  spot: DeepSweetSpot
): HalftimeRecalibration | null {
  const { liveData, line, side, l10Stats, production } = spot;
  
  // Only calculate at halftime
  if (liveData?.gameStatus !== 'halftime') return null;
  
  const actual1H = liveData.currentValue;
  const rate1H = liveData.ratePerMinute;
  const minutesPlayed = liveData.minutesPlayed;
  
  // Calculate expected 1H based on historical L10 average
  // Assuming even distribution, expected 1H = L10 avg / 2
  const expected1H = l10Stats.avg / 2;
  const variance1H = expected1H > 0 
    ? ((actual1H - expected1H) / expected1H) * 100 
    : 0;
  
  // Historical rate analysis
  const historical1HRate = production.statPerMinute || 0;
  
  // Estimate 2H regression based on production tier
  const regressionFactor = production.avgMinutes >= 32 
    ? STAR_REGRESSION 
    : production.avgMinutes >= 24 
      ? DEFAULT_2H_REGRESSION 
      : ROLE_PLAYER_REGRESSION;
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
  
  // Generate insight based on variance
  let insight: string;
  let confidenceBoost: number;
  let recommendation: string;
  
  if (variance1H >= 15) {
    // Hot start
    insight = `Player exceeded 1H baseline by ${variance1H.toFixed(0)}%. ` +
      `Historical data shows ${((1 - regressionFactor) * 100).toFixed(0)}% regression in 2H.`;
    confidenceBoost = side === 'over' ? 5 : -10;
    recommendation = side === 'over' 
      ? `Strong 1H suggests ${side.toUpperCase()} likely to hit. Consider profit lock.`
      : `1H pace threatening UNDER. Monitor for hedge opportunity.`;
  } else if (variance1H <= -15) {
    // Cold start
    insight = `Player underperformed 1H baseline by ${Math.abs(variance1H).toFixed(0)}%. ` +
      `2H surge possible but not guaranteed.`;
    confidenceBoost = side === 'over' ? -10 : 5;
    recommendation = side === 'over'
      ? `Behind at half. Need 2H burst or consider hedge.`
      : `UNDER tracking well. Hold position.`;
  } else {
    // On track
    insight = `1H production within expected range (${variance1H >= 0 ? '+' : ''}${variance1H.toFixed(0)}%). ` +
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
    halfDistribution: 0.5,
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
 * Recalculates 2nd-half projections using historical patterns
 */
export function useHalftimeRecalibration(spots: DeepSweetSpot[]): DeepSweetSpot[] {
  return useMemo(() => {
    return spots.map(spot => {
      // Only process halftime spots with live data
      if (!spot.liveData || spot.liveData.gameStatus !== 'halftime') {
        return spot;
      }
      
      const recalibration = calculateHalftimeRecalibration(spot);
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
  }, [spots]);
}
