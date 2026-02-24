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
  
  // Only block when there's truly no useful data or game is done
  if (!liveData) return null;
  if (liveData.gameStatus === 'final') return null;
  if (!liveData.projectedFinal && !liveData.currentValue) return null;
  
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

/**
 * Unified action labels derived from engine hedge status.
 * Single source of truth for all UI components.
 */
export type HedgeActionLabel = 'LOCK' | 'HOLD' | 'MONITOR' | 'HEDGE ALERT' | 'HEDGE NOW';

const STATUS_TO_ACTION: Record<string, HedgeActionLabel> = {
  profit_lock: 'LOCK',
  on_track: 'HOLD',
  monitor: 'MONITOR',
  alert: 'HEDGE ALERT',
  urgent: 'HEDGE NOW',
};

/**
 * Standalone function that takes raw prop values and returns a unified action label.
 * Used by HedgeModeTable, PropHedgeIndicator, and any other UI that needs
 * consistent hedge action wording without requiring a full DeepSweetSpot object.
 */
export function getHedgeActionLabel(params: {
  currentValue: number;
  projectedFinal: number;
  line: number;
  side: string;
  gameProgress?: number;
  paceRating?: number;
  confidence?: number;
  riskFlags?: string[];
  liveBookLine?: number;
  lineMovement?: number;
}): HedgeActionLabel {
  const {
    currentValue,
    projectedFinal,
    line,
    side,
    gameProgress = 50,
    paceRating = 100,
    confidence = 50,
    riskFlags = [],
    liveBookLine,
    lineMovement,
  } = params;

  const isOver = side.toUpperCase() !== 'UNDER';

  // Already-settled states
  if (isOver && currentValue >= line) return 'LOCK';
  if (!isOver && currentValue >= line) return 'HEDGE NOW';

  // Middle / line-movement profit lock
  if (lineMovement && Math.abs(lineMovement) >= 2 && liveBookLine) {
    if (isOver && liveBookLine < line - 1.5) return 'LOCK';
    if (!isOver && liveBookLine > line + 1.5) return 'LOCK';
  }

  // Risk flag overrides
  const hasBlowout = riskFlags.includes('blowout');
  const hasFoulTrouble = riskFlags.includes('foul_trouble');
  if (hasBlowout && gameProgress > 60) return 'HEDGE NOW';
  if (hasBlowout && hasFoulTrouble) return 'HEDGE NOW';

  // Pace override for OVER bets
  const buffer = isOver ? projectedFinal - line : line - projectedFinal;
  const hasSignificantBuffer = buffer >= 2;
  if (isOver && paceRating < 95 && !hasSignificantBuffer) {
    if (confidence < 45) return 'HEDGE NOW';
    if (confidence < 55) return 'HEDGE ALERT';
  }

  // Progress-aware thresholds
  const thresholds = getBufferThresholds(gameProgress);
  if (buffer >= thresholds.onTrack) return 'HOLD';
  if (buffer >= thresholds.monitor) return 'MONITOR';
  if (buffer >= thresholds.alert) return 'HEDGE ALERT';
  return 'HEDGE NOW';
}

/**
 * Convert an engine HedgeStatus to a unified action label.
 */
export function hedgeStatusToActionLabel(status: HedgeStatus): HedgeActionLabel {
  return STATUS_TO_ACTION[status] ?? 'MONITOR';
}
