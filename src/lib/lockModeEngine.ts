/**
 * Lock Mode Engine - 3-Leg Risk Elimination System
 * 
 * Outputs exactly 3 legs with highest structural certainty.
 * If any slot cannot be filled, returns zero results.
 */

import type {
  PropEdge,
  PlayerLiveState,
  PropType,
  LockModeStatTier,
  LockModeLegSlot,
  LockModeGate,
  LockModeLeg,
  LockModeSlip,
} from '@/types/scout-agent';

// ===== CONFIGURABLE THRESHOLDS =====
// Relaxed for initial testing - can be tightened once data pipeline is validated

const LOCK_MODE_THRESHOLDS = {
  // Gate 1: Minutes & Rotation
  MIN_FIRST_HALF_MINUTES: 10,      // Was 14, relaxed for testing
  MAX_FOULS_ALLOWED: 4,            // Was 3, relaxed for testing
  
  // Gate 3: Edge vs Uncertainty
  EDGE_UNCERTAINTY_MULTIPLIER: 1.25,
  MIN_ABSOLUTE_EDGE: 0.5,
  
  // Gate 4: Stricter Under Rules
  MIN_FATIGUE_FOR_UNDER: 45,       // Was 65, relaxed for testing
  MAX_VARIANCE_RATIO: 0.35,        // Was 0.30, relaxed for testing
  
  // Confidence Filter
  MIN_CONFIDENCE: 65,              // Was 72, relaxed for testing
};

// ===== GATE 1: MINUTES & ROTATION =====

function passesMinutesGate(
  edge: PropEdge,
  playerState: PlayerLiveState | undefined
): LockModeGate {
  const role = edge.rotationRole?.toUpperCase();
  const isStarterOrCloser = role === 'STARTER' || role === 'CLOSER';
  const hasStableMinutes = !edge.rotationVolatilityFlag;
  const noFoulTrouble = (playerState?.foulCount || 0) <= LOCK_MODE_THRESHOLDS.MAX_FOULS_ALLOWED;
  
  // Check first-half minutes played (from minutesPlayed in edge or boxScore)
  const minutesPlayed = edge.minutesPlayed || playerState?.minutesEstimate || 0;
  const minFirstHalfMinutes = minutesPlayed >= LOCK_MODE_THRESHOLDS.MIN_FIRST_HALF_MINUTES;

  const passed = isStarterOrCloser && hasStableMinutes && noFoulTrouble && minFirstHalfMinutes;

  // Debug logging
  console.log(`[Lock Mode] Gate 1 ${edge.player} ${edge.prop}:`, {
    role,
    isStarterOrCloser,
    hasStableMinutes,
    noFoulTrouble,
    minutesPlayed,
    minFirstHalfMinutes,
    passed,
  });

  return {
    passed,
    reason: !passed
      ? !isStarterOrCloser
        ? `Not STARTER/CLOSER (role: ${role || 'undefined'})`
        : !hasStableMinutes
        ? 'Minutes volatile'
        : !noFoulTrouble
        ? `Foul trouble (${playerState?.foulCount || 0} fouls)`
        : `1H minutes ${minutesPlayed.toFixed(0)} < ${LOCK_MODE_THRESHOLDS.MIN_FIRST_HALF_MINUTES}`
      : undefined,
  };
}

// ===== GATE 2: STAT TYPE PRIORITY =====

function getStatTier(prop: PropType): LockModeStatTier | null {
  if (prop === 'Rebounds' || prop === 'Assists') return 'TIER_1';
  if (prop === 'PRA') return 'TIER_2';
  if (prop === 'Points') return 'TIER_3';
  return null; // Blocks Threes, Steals, Blocks
}

function passesStatTypeGate(prop: PropType): LockModeGate {
  const tier = getStatTier(prop);
  return {
    passed: tier !== null,
    reason: tier === null ? `${prop} not allowed in Lock Mode` : undefined,
  };
}

// ===== GATE 3: EDGE VS UNCERTAINTY =====

function passesEdgeUncertaintyGate(edge: PropEdge): LockModeGate {
  const projectedEdge = Math.abs((edge.expectedFinal || 0) - edge.line);
  const uncertainty = edge.uncertainty || 1;

  // Edge must be >= multiplier x uncertainty
  const threshold = uncertainty * LOCK_MODE_THRESHOLDS.EDGE_UNCERTAINTY_MULTIPLIER;
  const passed = projectedEdge >= threshold && projectedEdge > LOCK_MODE_THRESHOLDS.MIN_ABSOLUTE_EDGE;

  return {
    passed,
    reason: !passed
      ? `Edge ${projectedEdge.toFixed(1)} < ${threshold.toFixed(1)} (unc × ${LOCK_MODE_THRESHOLDS.EDGE_UNCERTAINTY_MULTIPLIER})`
      : undefined,
  };
}

// ===== GATE 4: STRICTER UNDER RULES =====

function passesUnderGate(
  edge: PropEdge,
  playerState: PlayerLiveState | undefined
): LockModeGate {
  if (edge.lean === 'OVER') return { passed: true };

  const fatigue = playerState?.fatigueScore || 0;
  const fatigueOk = fatigue >= LOCK_MODE_THRESHOLDS.MIN_FATIGUE_FOR_UNDER;

  const l10Avg = edge.line; // Approximate baseline
  const stdDev = edge.uncertainty || 0;
  const varianceLow = l10Avg > 0 ? stdDev / l10Avg <= LOCK_MODE_THRESHOLDS.MAX_VARIANCE_RATIO : false;

  const noBreakout = !edge.riskFlags?.includes('BREAKOUT_RISK');
  const noGarbageTime = !edge.riskFlags?.includes('BLOWOUT_RISK');

  const passed = fatigueOk && varianceLow && noBreakout && noGarbageTime;

  // Debug logging
  console.log(`[Lock Mode] Gate 4 UNDER ${edge.player} ${edge.prop}:`, {
    fatigue,
    fatigueOk,
    varianceLow,
    noBreakout,
    noGarbageTime,
    passed,
  });

  return {
    passed,
    reason: !passed
      ? !fatigueOk
        ? `Fatigue ${fatigue} < ${LOCK_MODE_THRESHOLDS.MIN_FATIGUE_FOR_UNDER}`
        : !varianceLow
        ? 'Variance too high'
        : !noBreakout
        ? 'Breakout signal detected'
        : 'Garbage time risk'
      : undefined,
  };
}

// ===== CONFIDENCE FILTER =====

function passesConfidenceGate(edge: PropEdge): boolean {
  const confidence = edge.calibratedProb ? edge.calibratedProb * 100 : edge.confidence;
  if (confidence < LOCK_MODE_THRESHOLDS.MIN_CONFIDENCE) return false;
  
  // Block if variance flags present
  if (edge.riskFlags?.includes('HIGH_VARIANCE')) return false;
  if (edge.riskFlags?.includes('EARLY_PROJECTION')) return false;
  
  return true;
}

// ===== SLOT MATCHING =====

function getSlotType(edge: PropEdge, playerState: PlayerLiveState | undefined): LockModeLegSlot | null {
  const role = playerState?.role || 'SECONDARY';
  const prop = edge.prop;
  const lean = edge.lean;

  // Debug logging for slot matching
  console.log(`[Lock Mode] Slot matching ${edge.player} ${prop} ${lean}:`, {
    role,
    fatigue: playerState?.fatigueScore,
  });

  // Slot 1: BIG/WING Rebound OVER - expanded to include SECONDARY players with high rebounds
  if (prop === 'Rebounds' && lean === 'OVER') {
    if (role === 'BIG' || role === 'PRIMARY') {
      return 'BIG_REB_OVER';
    }
    // Also allow SECONDARY players who are rebounding well
    if (role === 'SECONDARY' && (edge.currentStat || 0) >= 4) {
      return 'BIG_REB_OVER';
    }
  }

  // Slot 2: Assist OVER
  if (prop === 'Assists' && lean === 'OVER') {
    if (role === 'PRIMARY' || role === 'SECONDARY') {
      return 'ASSIST_OVER';
    }
  }

  // Slot 3: FLEX (Points OVER for stars, PRA for bigs, fatigue UNDER, high-confidence any)
  if (prop === 'Points' && lean === 'OVER' && (role === 'PRIMARY' || role === 'SECONDARY')) {
    return 'FLEX';
  }
  if (prop === 'PRA' && lean === 'OVER' && (role === 'BIG' || role === 'PRIMARY')) {
    return 'FLEX';
  }
  if (lean === 'UNDER' && (playerState?.fatigueScore || 0) >= LOCK_MODE_THRESHOLDS.MIN_FATIGUE_FOR_UNDER) {
    return 'FLEX';
  }
  // High-edge rebounds can also be FLEX
  if (prop === 'Rebounds' && lean === 'OVER' && (edge.edgeMargin || 0) >= 3) {
    return 'FLEX';
  }

  return null;
}

// ===== MAIN BUILDER =====

function buildDrivers(edge: PropEdge, playerState: PlayerLiveState | undefined): string[] {
  const drivers: string[] = [];
  
  // Add role-based driver
  const role = playerState?.role || edge.rotationRole;
  if (role) {
    if (role === 'STARTER' || role === 'CLOSER') {
      drivers.push('Stable closer minutes');
    } else if (role === 'PRIMARY') {
      drivers.push('Primary option');
    } else if (role === 'BIG') {
      drivers.push('Strong box-outs');
    }
  }

  // Add stat-specific drivers
  if (edge.prop === 'Rebounds') {
    drivers.push('Elite positioning');
  } else if (edge.prop === 'Assists') {
    drivers.push('Primary playmaker');
  } else if (edge.prop === 'Points') {
    drivers.push('Star floor active');
  }

  // Add fatigue driver for unders
  if (edge.lean === 'UNDER' && (playerState?.fatigueScore || 0) >= 65) {
    drivers.push(`Fatigue spike: ${playerState?.fatigueScore}%`);
  }

  // Limit to 2 drivers
  return drivers.slice(0, 2);
}

export function buildLockModeSlip(
  edges: PropEdge[],
  playerStates: Map<string, PlayerLiveState>,
  gameTime: string
): LockModeSlip {
  const candidates: LockModeLeg[] = [];

  for (const edge of edges) {
    // Find player state
    const playerKey = Array.from(playerStates.keys()).find((key) =>
      key.toLowerCase().includes(edge.player.toLowerCase().split(' ').pop() || '')
    );
    const playerState = playerKey ? playerStates.get(playerKey) : undefined;

    // Run all gates
    const minutesGate = passesMinutesGate(edge, playerState);
    const statTypeGate = passesStatTypeGate(edge.prop);
    const edgeUncertaintyGate = passesEdgeUncertaintyGate(edge);
    const underGate = passesUnderGate(edge, playerState);

    // Check if all gates pass
    const allGatesPass =
      minutesGate.passed &&
      statTypeGate.passed &&
      edgeUncertaintyGate.passed &&
      underGate.passed &&
      passesConfidenceGate(edge);

    if (!allGatesPass) continue;

    // Determine slot
    const slot = getSlotType(edge, playerState);
    if (!slot) continue;

    // Build candidate leg
    const leg: LockModeLeg = {
      player: edge.player,
      prop: edge.prop,
      line: edge.line,
      lean: edge.lean,
      projected: edge.expectedFinal || 0,
      uncertainty: edge.uncertainty || 0,
      edge: Math.abs((edge.expectedFinal || 0) - edge.line),
      minutesRemaining: edge.remainingMinutes || 0,
      minutesUncertainty: edge.minutesUncertainty || 0,
      calibratedConfidence: edge.calibratedProb ? edge.calibratedProb * 100 : edge.confidence,
      drivers: buildDrivers(edge, playerState),
      slot,
      gates: {
        minutes: minutesGate,
        statType: statTypeGate,
        edgeVsUncertainty: edgeUncertaintyGate,
        underRules: edge.lean === 'UNDER' ? underGate : undefined,
      },
    };

    candidates.push(leg);
  }

  // Sort by confidence and edge
  candidates.sort((a, b) => {
    // First by slot priority (BIG_REB_OVER > ASSIST_OVER > FLEX)
    const slotOrder: Record<LockModeLegSlot, number> = {
      BIG_REB_OVER: 1,
      ASSIST_OVER: 2,
      FLEX: 3,
    };
    const slotDiff = slotOrder[a.slot] - slotOrder[b.slot];
    if (slotDiff !== 0) return slotDiff;

    // Then by confidence
    return b.calibratedConfidence - a.calibratedConfidence;
  });

  // Fill slots
  const slots: Record<LockModeLegSlot, LockModeLeg | null> = {
    BIG_REB_OVER: null,
    ASSIST_OVER: null,
    FLEX: null,
  };

  for (const leg of candidates) {
    if (!slots[leg.slot]) {
      slots[leg.slot] = leg;
    }
  }

  // Check if all 3 slots filled
  const filledLegs = Object.values(slots).filter((l): l is LockModeLeg => l !== null);
  const missingSlots = (Object.entries(slots) as [LockModeLegSlot, LockModeLeg | null][])
    .filter(([, leg]) => leg === null)
    .map(([slot]) => slot);

  if (filledLegs.length < 3) {
    return {
      legs: [],
      generatedAt: new Date().toISOString(),
      gameTime,
      isValid: false,
      blockReason: `Missing ${3 - filledLegs.length} slot(s)`,
      missingSlots,
    };
  }

  return {
    legs: filledLegs,
    generatedAt: new Date().toISOString(),
    gameTime,
    isValid: true,
  };
}

// ===== UTILITY: Get Slot Display Name =====

export function getSlotDisplayName(slot: LockModeLegSlot): string {
  switch (slot) {
    case 'BIG_REB_OVER':
      return 'Rebound Over';
    case 'ASSIST_OVER':
      return 'Assist Over';
    case 'FLEX':
      return 'Flex Pick';
  }
}
