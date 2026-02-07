import type { DeepSweetSpot, HedgeStatus } from '@/types/sweetSpot';

/**
 * Calculate hedge status from live data
 * Shared utility for filtering and display purposes
 */
export function calculateHedgeStatus(spot: DeepSweetSpot): HedgeStatus | null {
  const liveData = spot.liveData;
  
  // No live data or game not in progress
  if (!liveData || (!liveData.isLive && liveData.gameStatus !== 'halftime')) {
    return null;
  }
  
  const confidence = liveData.confidence ?? 50;
  const isOver = (spot.side ?? 'over').toLowerCase() === 'over';
  const currentValue = liveData.currentValue ?? 0;
  const projectedFinal = liveData.projectedFinal ?? 0;
  const line = spot.line;
  
  // Check for already-settled states
  if (isOver && currentValue >= line) {
    return 'profit_lock'; // Already hit for OVER
  }
  if (!isOver && currentValue >= line) {
    return 'urgent'; // Line exceeded for UNDER (lost)
  }
  
  // Check for middle opportunity (profit lock)
  if (liveData.lineMovement && Math.abs(liveData.lineMovement) >= 2) {
    const liveBookLine = liveData.liveBookLine;
    if (liveBookLine) {
      // OVER bet: live line dropped significantly
      if (isOver && liveBookLine < line - 1.5) {
        return 'profit_lock';
      }
      // UNDER bet: live line rose significantly
      if (!isOver && liveBookLine > line + 1.5) {
        return 'profit_lock';
      }
    }
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
  
  // Pace-based override for OVER bets (only if not already comfortably ahead)
  const hasSignificantBuffer = (projectedFinal - line) >= 2;
  if (isOver && (liveData.paceRating ?? 100) < 95 && !hasSignificantBuffer) {
    if (confidence < 45) return 'urgent';
    if (confidence < 55) return 'alert';
  }
  
  // Projection-based status (more accurate than confidence alone)
  if (isOver) {
    const buffer = projectedFinal - line;
    if (buffer >= 2) return 'on_track';
    if (buffer >= 0) return 'monitor';
    if (buffer >= -2) return 'alert';
    return 'urgent';
  } else {
    // UNDER
    const buffer = line - projectedFinal;
    if (buffer >= 2) return 'on_track';
    if (buffer >= 0) return 'monitor';
    if (buffer >= -2) return 'alert';
    return 'urgent';
  }
}

/**
 * Check if a spot is currently "on track" to hit
 */
export function isOnTrack(spot: DeepSweetSpot): boolean {
  const status = calculateHedgeStatus(spot);
  return status === 'on_track' || status === 'profit_lock';
}
