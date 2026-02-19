import type { DeepSweetSpot, HedgeStatus } from '@/types/sweetSpot';

/**
 * Progress-aware buffer thresholds
 * Early game = wider buffers (projections volatile), late game = tighter
 */
interface BufferThresholds {
  onTrack: number;
  monitor: number;
  alert: number;
}

export function getBufferThresholds(gameProgress: number): BufferThresholds {
  if (gameProgress < 25) return { onTrack: 4, monitor: 1, alert: -2 };
  if (gameProgress < 50) return { onTrack: 3, monitor: 0.5, alert: -1.5 };
  if (gameProgress < 75) return { onTrack: 2, monitor: 0, alert: -1 };
  return { onTrack: 1.5, monitor: -0.5, alert: -1 };
}

/**
 * Calculate hedge status from live data
 * Shared utility for filtering, display, and snapshot recording
 */
export function calculateHedgeStatus(spot: DeepSweetSpot): HedgeStatus | null {
  const liveData = spot.liveData;
  
  // No live data or game not in progress
  if (!liveData || (!liveData.isLive && liveData.gameStatus !== 'halftime')) {
    return null;
  }
  
  const isOver = (spot.side ?? 'over').toLowerCase() === 'over';
  const currentValue = liveData.currentValue ?? 0;
  const projectedFinal = liveData.projectedFinal ?? 0;
  const line = spot.line;
  const gameProgress = liveData.gameProgress ?? 0;
  
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
      if (isOver && liveBookLine < line - 1.5) return 'profit_lock';
      if (!isOver && liveBookLine > line + 1.5) return 'profit_lock';
    }
  }
  
  // Risk factor overrides
  const hasBlowout = liveData.riskFlags?.includes('blowout');
  const hasFoulTrouble = liveData.riskFlags?.includes('foul_trouble');
  
  if (hasBlowout && gameProgress > 60) return 'urgent';
  if (hasBlowout && hasFoulTrouble) return 'urgent';
  
  // Pace-based override for OVER bets (only if not already comfortably ahead)
  const buffer = isOver ? projectedFinal - line : line - projectedFinal;
  const hasSignificantBuffer = buffer >= 2;
  if (isOver && (liveData.paceRating ?? 100) < 95 && !hasSignificantBuffer) {
    const confidence = liveData.confidence ?? 50;
    if (confidence < 45) return 'urgent';
    if (confidence < 55) return 'alert';
  }
  
  // Progress-aware projection-based status
  const thresholds = getBufferThresholds(gameProgress);
  
  if (buffer >= thresholds.onTrack) return 'on_track';
  if (buffer >= thresholds.monitor) return 'monitor';
  if (buffer >= thresholds.alert) return 'alert';
  return 'urgent';
}

/**
 * Check if a spot is currently "on track" to hit
 */
export function isOnTrack(spot: DeepSweetSpot): boolean {
  const status = calculateHedgeStatus(spot);
  return status === 'on_track' || status === 'profit_lock';
}
