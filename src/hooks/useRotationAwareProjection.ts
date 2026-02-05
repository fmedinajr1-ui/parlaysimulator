 import { useMemo } from 'react';
 import {
   calculateRotationMinutes,
   inferPlayerTier,
   getMinutesBreakdown,
   isApproachingRestWindow,
   type PlayerTier,
   type RotationEstimate
 } from '@/lib/rotation-patterns';
 import type { DeepSweetSpot } from '@/types/sweetSpot';
 
 export interface RotationAwareProjection {
   // Core projection
   projectedFinal: number;
   confidence: number;
   
   // Rotation context
   playerTier: PlayerTier;
   rotationEstimate: RotationEstimate;
   minutesRemaining: number;
   
   // Flags
   isApproachingRest: boolean;
   isInRest: boolean;
   
   // Breakdown
   minutesBreakdown: {
     thisQuarter: number;
     q2: number;
     q3: number;
     q4: number;
     closer: number;
   };
   
   // Display
   rotationInsight: string;
   nextTransition: string;
 }
 
 /**
  * Hook to calculate rotation-aware projections for a sweet spot
  */
 export function useRotationAwareProjection(spot: DeepSweetSpot): RotationAwareProjection | null {
   return useMemo(() => {
     if (!spot.liveData?.isLive && spot.liveData?.gameStatus !== 'halftime') {
       return null;
     }
     
     const { liveData, line, side } = spot;
     const { 
       currentValue, 
       projectedFinal: linearProjection, 
       gameProgress, 
       period, 
       clock,
       minutesPlayed,
       ratePerMinute,
       confidence: baseConfidence
     } = liveData;
     
     // Parse quarter and clock
     const currentQuarter = parseInt(period) || 1;
     const clockParts = (clock || '12:00').split(':');
     const clockMinutes = parseInt(clockParts[0]) || 12;
     
     // Infer player tier from minutes pace
     const playerTier = inferPlayerTier(minutesPlayed, gameProgress);
     
     // Get score differential (if available in risk flags)
     // Default to 0 for close game behavior
     const scoreDiff = 0; // TODO: Add score diff to liveData
     
     // Calculate rotation-aware minutes
     const rotationEstimate = calculateRotationMinutes(
       playerTier,
       currentQuarter,
       clockMinutes,
       scoreDiff,
       minutesPlayed
     );
     
     // Get minutes breakdown
     const minutesBreakdown = getMinutesBreakdown(playerTier, currentQuarter, clockMinutes);
     
     // Check rest window flags
     const isApproachingRest = isApproachingRestWindow(playerTier, currentQuarter, clockMinutes);
     const isInRest = rotationEstimate.currentPhase === 'rest';
     
     // Calculate rotation-aware projected final
     const expectedProduction = ratePerMinute * rotationEstimate.expectedRemaining;
     const rotationAwareProjection = currentValue + expectedProduction;
     
     // Blend with linear projection (60% rotation-aware, 40% linear for stability)
     const blendedProjection = rotationAwareProjection * 0.6 + linearProjection * 0.4;
     
     // Adjust confidence based on rotation context
     let adjustedConfidence = baseConfidence;
     
     if (isInRest) {
       // Lower confidence during rest - harder to project
       adjustedConfidence -= 10;
     } else if (isApproachingRest && side === 'over') {
       // About to sit - reduce confidence for OVER bets
       const gapToLine = blendedProjection - line;
       if (gapToLine < 2) {
         adjustedConfidence -= 15; // Close to line and about to sit
       }
     }
     
     // Boost confidence for closers in Q4
     if (rotationEstimate.closerEligible && currentQuarter === 4) {
       adjustedConfidence += 5;
     }
     
     // Cap confidence
     adjustedConfidence = Math.max(20, Math.min(95, adjustedConfidence));
     
     return {
       projectedFinal: Math.round(blendedProjection * 10) / 10,
       confidence: Math.round(adjustedConfidence),
       playerTier,
       rotationEstimate,
       minutesRemaining: rotationEstimate.expectedRemaining,
       isApproachingRest,
       isInRest,
       minutesBreakdown,
       rotationInsight: rotationEstimate.rotationInsight,
       nextTransition: rotationEstimate.nextTransition
     };
   }, [spot]);
 }
 
 /**
  * Lightweight function to get rotation estimate without full hook
  * For use in non-reactive contexts
  */
 export function getRotationEstimate(
   minutesPlayed: number,
   gameProgress: number,
   period: string,
   clock: string,
   scoreDiff: number = 0
 ): RotationEstimate {
   const currentQuarter = parseInt(period) || 1;
   const clockParts = (clock || '12:00').split(':');
   const clockMinutes = parseInt(clockParts[0]) || 12;
   
   const playerTier = inferPlayerTier(minutesPlayed, gameProgress);
   
   return calculateRotationMinutes(
     playerTier,
     currentQuarter,
     clockMinutes,
     scoreDiff,
     minutesPlayed
   );
 }