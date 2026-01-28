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
} from "@/types/scout-agent";

// ===== CONFIGURABLE THRESHOLDS =====
// Relaxed for testing - tighten once data pipeline is validated

const LOCK_MODE_THRESHOLDS = {
  // Gate 1: Minutes & Rotation
  MIN_FIRST_HALF_MINUTES: 8, // Lowered to 8 - starters usually have 10-15 at halftime
  MAX_FOULS_ALLOWED: 4, // Was 3, relaxed for testing

  // Gate 3: Edge vs Uncertainty
  EDGE_UNCERTAINTY_MULTIPLIER: 1.0, // Lowered from 1.25 - more permissive
  MIN_ABSOLUTE_EDGE: 0.3, // Lowered from 0.5

  // Gate 4: Stricter Under Rules
  MIN_FATIGUE_FOR_UNDER: 40, // Lowered to 40 - vision rarely hits 65+
  MAX_VARIANCE_RATIO: 0.4, // Was 0.30, relaxed for testing

  // Confidence Filter
  MIN_CONFIDENCE: 55, // Lowered to 55 for testing
};

// ===== GATE 1: MINUTES & ROTATION =====

function passesMinutesGate(edge: PropEdge, playerState: PlayerLiveState | undefined): LockModeGate {
  // Accept rotation roles from edge OR infer from minutes played
  const role = edge.rotationRole?.toUpperCase();
  const minutesPlayed = edge.minutesPlayed || playerState?.minutesEstimate || 0;

  // RELAXED: If no rotation role, infer from minutes played
  // Players with 10+ minutes at halftime are treated as starters
  const isStarterOrCloser = role === "STARTER" || role === "CLOSER" || role === "BENCH_CORE" || minutesPlayed >= 10; // High-minute fallback

  const hasStableMinutes = !edge.rotationVolatilityFlag;
  const noFoulTrouble = (playerState?.foulCount || 0) <= LOCK_MODE_THRESHOLDS.MAX_FOULS_ALLOWED;
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
        ? `Not STARTER/CLOSER/HIGH-MIN (role: ${role || "undefined"}, min: ${minutesPlayed.toFixed(0)})`
        : !hasStableMinutes
          ? "Minutes volatile"
          : !noFoulTrouble
            ? `Foul trouble (${playerState?.foulCount || 0} fouls)`
            : `1H minutes ${minutesPlayed.toFixed(0)} < ${LOCK_MODE_THRESHOLDS.MIN_FIRST_HALF_MINUTES}`
      : undefined,
  };
}

// ===== GATE 2: STAT TYPE PRIORITY =====

function getStatTier(prop: PropType): LockModeStatTier | null {
  if (prop === "Rebounds" || prop === "Assists") return "TIER_1";
  if (prop === "PRA") return "TIER_2";
  if (prop === "Points") return "TIER_3";
  return null; // Blocks Threes, Steals, Blocks
}

function passesStatTypeGate(prop: PropType): LockModeGate {
  const tier = getStatTier(prop);

  // Debug logging
  console.log(`[Lock Mode] Gate 2 Stat Type: ${prop} → ${tier || "BLOCKED"}`);

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

  // Debug logging
  console.log(`[Lock Mode] Gate 3 Edge ${edge.player} ${edge.prop}:`, {
    expectedFinal: edge.expectedFinal,
    line: edge.line,
    projectedEdge: projectedEdge.toFixed(2),
    uncertainty: uncertainty.toFixed(2),
    threshold: threshold.toFixed(2),
    minAbsoluteEdge: LOCK_MODE_THRESHOLDS.MIN_ABSOLUTE_EDGE,
    passed,
  });

  return {
    passed,
    reason: !passed
      ? `Edge ${projectedEdge.toFixed(1)} < ${threshold.toFixed(1)} (unc × ${LOCK_MODE_THRESHOLDS.EDGE_UNCERTAINTY_MULTIPLIER})`
      : undefined,
  };
}

// ===== GATE 4: STRICTER UNDER RULES =====

function passesUnderGate(edge: PropEdge, playerState: PlayerLiveState | undefined): LockModeGate {
  if (edge.lean === "OVER") return { passed: true };

  const fatigue = playerState?.fatigueScore || 0;
  const fatigueOk = fatigue >= LOCK_MODE_THRESHOLDS.MIN_FATIGUE_FOR_UNDER;

  const l10Avg = edge.line; // Approximate baseline
  const stdDev = edge.uncertainty || 0;
  const varianceLow = l10Avg > 0 ? stdDev / l10Avg <= LOCK_MODE_THRESHOLDS.MAX_VARIANCE_RATIO : false;

  const noBreakout = !edge.riskFlags?.includes("BREAKOUT_RISK");
  const noGarbageTime = !edge.riskFlags?.includes("BLOWOUT_RISK");

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
          ? "Variance too high"
          : !noBreakout
            ? "Breakout signal detected"
            : "Garbage time risk"
      : undefined,
  };
}

// ===== CONFIDENCE FILTER =====

function passesConfidenceGate(edge: PropEdge): boolean {
  const confidence = edge.calibratedProb ? edge.calibratedProb * 100 : edge.confidence;

  // Debug logging
  console.log(`[Lock Mode] Confidence check ${edge.player} ${edge.prop}:`, {
    confidence,
    minRequired: LOCK_MODE_THRESHOLDS.MIN_CONFIDENCE,
    passed: confidence >= LOCK_MODE_THRESHOLDS.MIN_CONFIDENCE,
  });

  if (confidence < LOCK_MODE_THRESHOLDS.MIN_CONFIDENCE) return false;

  // Block if variance flags present (but relaxed - don't block EARLY_PROJECTION)
  if (edge.riskFlags?.includes("HIGH_VARIANCE")) return false;

  return true;
}

// ===== SLOT MATCHING =====

function getSlotType(edge: PropEdge, playerState: PlayerLiveState | undefined): LockModeLegSlot | null {
  const role = playerState?.role || "SECONDARY";
  const prop = edge.prop;
  const lean = edge.lean;
  const minutesPlayed = edge.minutesPlayed || 0;

  // Debug logging for slot matching
  console.log(`[Lock Mode] Slot matching ${edge.player} ${prop} ${lean}:`, {
    role,
    fatigue: playerState?.fatigueScore,
    minutes: minutesPlayed,
    currentStat: edge.currentStat,
    edgeMargin: edge.edgeMargin,
  });

  // Slot 1: BIG/WING Rebound OVER - expanded for any player with good rebounding
  if (prop === "Rebounds" && lean === "OVER") {
    if (role === "BIG" || role === "PRIMARY") {
      return "BIG_REB_OVER";
    }
    // Allow any player with 3+ rebounds at halftime
    if ((edge.currentStat || 0) >= 3) {
      return "BIG_REB_OVER";
    }
    // High-minute players with good edge
    if (minutesPlayed >= 10 && (edge.edgeMargin || 0) >= 1.5) {
      return "BIG_REB_OVER";
    }
  }

  // Slot 2: Assist OVER - expanded for any high-minute playmaker
  if (prop === "Assists" && lean === "OVER") {
    if (role === "PRIMARY" || role === "SECONDARY") {
      return "ASSIST_OVER";
    }
    // Any player with 2+ assists at halftime
    if ((edge.currentStat || 0) >= 2) {
      return "ASSIST_OVER";
    }
  }

  // Slot 3: FLEX - very flexible for testing
  // Points OVER for any high-minute player
  if (prop === "Points" && lean === "OVER" && minutesPlayed >= 8) {
    return "FLEX";
  }
  if (prop === "PRA" && lean === "OVER") {
    return "FLEX";
  }
  // Any UNDER with fatigue
  if (lean === "UNDER" && (playerState?.fatigueScore || 0) >= LOCK_MODE_THRESHOLDS.MIN_FATIGUE_FOR_UNDER) {
    return "FLEX";
  }
  // High-edge rebounds can also be FLEX
  if (prop === "Rebounds" && lean === "OVER" && (edge.edgeMargin || 0) >= 2) {
    return "FLEX";
  }
  // High-edge assists can also be FLEX
  if (prop === "Assists" && lean === "OVER" && (edge.edgeMargin || 0) >= 1.5) {
    return "FLEX";
  }

  return null;
}

// ===== MAIN BUILDER =====

function buildDrivers(edge: PropEdge, playerState: PlayerLiveState | undefined): string[] {
  const drivers: string[] = [];

  // Add role-based driver
  const role = playerState?.role || edge.rotationRole;
  if (role) {
    if (role === "STARTER" || role === "CLOSER") {
      drivers.push("Stable closer minutes");
    } else if (role === "PRIMARY") {
      drivers.push("Primary option");
    } else if (role === "BIG") {
      drivers.push("Strong box-outs");
    }
  }

  // Add stat-specific drivers
  if (edge.prop === "Rebounds") {
    drivers.push("Elite positioning");
  } else if (edge.prop === "Assists") {
    drivers.push("Primary playmaker");
  } else if (edge.prop === "Points") {
    drivers.push("Star floor active");
  }

  // Add fatigue driver for unders
  if (edge.lean === "UNDER" && (playerState?.fatigueScore || 0) >= 65) {
    drivers.push(`Fatigue spike: ${playerState?.fatigueScore}%`);
  }

  // Limit to 2 drivers
  return drivers.slice(0, 2);
}

export function buildLockModeSlip(
  edges: PropEdge[],
  playerStates: Map<string, PlayerLiveState>,
  gameTime: string,
): LockModeSlip {
  const candidates: LockModeLeg[] = [];

  for (const edge of edges) {
    // Find player state
    const playerKey = Array.from(playerStates.keys()).find((key) =>
      key.toLowerCase().includes(edge.player.toLowerCase().split(" ").pop() || ""),
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

    // Consolidated per-edge summary
    console.log(`[Lock Mode] === ${edge.player} ${edge.prop} ${edge.lean} ===`, {
      gates: {
        minutes: minutesGate.passed ? "✓" : `✗ ${minutesGate.reason}`,
        statType: statTypeGate.passed ? "✓" : `✗ ${statTypeGate.reason}`,
        edgeUncertainty: edgeUncertaintyGate.passed ? "✓" : `✗ ${edgeUncertaintyGate.reason}`,
        underRules: edge.lean === "UNDER" ? (underGate.passed ? "✓" : `✗ ${underGate.reason}`) : "N/A",
        confidence: passesConfidenceGate(edge) ? "✓" : "✗ Low confidence",
      },
      allGatesPass,
      slot: allGatesPass ? getSlotType(edge, playerState) || "NO_SLOT" : "BLOCKED",
    });

    if (!allGatesPass) continue;

    // Determine slot
    const slot = getSlotType(edge, playerState);
    if (!slot) {
      // Log why slot matching failed
      console.log(`[Lock Mode] Slot FAILED ${edge.player} ${edge.prop} ${edge.lean}:`, {
        role: playerState?.role,
        currentStat: edge.currentStat,
        minutesPlayed: edge.minutesPlayed,
        edgeMargin: edge.edgeMargin,
        fatigue: playerState?.fatigueScore,
        reason: "No matching slot criteria met",
      });
      continue;
    }

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
        underRules: edge.lean === "UNDER" ? underGate : undefined,
      },
    };

    candidates.push(leg);
  }

  // Sort by confidence and edge
  // CRITICAL FIX: Added stable tie-breakers to ensure deterministic ordering
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
    if (b.calibratedConfidence !== a.calibratedConfidence) return b.calibratedConfidence - a.calibratedConfidence;

    // Stable tie-breaker: player name (alphabetical)
    const nameCompare = (a.player || "").localeCompare(b.player || "");
    if (nameCompare !== 0) return nameCompare;

    // Final tie-breaker: prop for complete determinism
    return (a.prop || "").localeCompare(b.prop || "");
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

  // Final slip summary
  console.log(`[Lock Mode] ========== SLIP SUMMARY ==========`);
  console.log(`[Lock Mode] Total edges evaluated: ${edges.length}`);
  console.log(`[Lock Mode] Candidates that passed all gates: ${candidates.length}`);
  console.log(`[Lock Mode] Slots filled:`, {
    BIG_REB_OVER: slots.BIG_REB_OVER?.player || "EMPTY",
    ASSIST_OVER: slots.ASSIST_OVER?.player || "EMPTY",
    FLEX: slots.FLEX?.player || "EMPTY",
  });
  console.log(`[Lock Mode] Valid slip: ${filledLegs.length === 3 ? "YES" : "NO"}`);
  if (missingSlots.length > 0) {
    console.log(`[Lock Mode] Missing slots: ${missingSlots.join(", ")}`);
  }
  console.log(`[Lock Mode] ====================================`);

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
    case "BIG_REB_OVER":
      return "Rebound Over";
    case "ASSIST_OVER":
      return "Assist Over";
    case "FLEX":
      return "Flex Pick";
  }
}

// ===== LIVE LINE SCANNER: Line Fit Scoring =====

import type { LineFitResult, LineTimingStatus } from "@/types/scout-agent";

/**
 * Calculate how favorable the current book line is vs. our projection
 * Returns a score (0-100) and timing status (BET_NOW / WAIT / AVOID)
 */
export function calculateLineFitScore(
  projection: number,
  liveBookLine: number,
  lean: "OVER" | "UNDER",
  originalLine: number,
): LineFitResult {
  // Calculate edge vs. live line
  const liveEdge = lean === "OVER" ? projection - liveBookLine : liveBookLine - projection;

  // Calculate original edge
  const originalEdge = lean === "OVER" ? projection - originalLine : originalLine - projection;

  // Line moved in our favor? (positive = good)
  const lineFavorability = liveEdge - originalEdge;

  // Scoring rules based on edge strength and line movement
  if (liveEdge >= 2.5) {
    // Strong edge with live line
    if (lineFavorability >= 0.5) {
      return { score: 95, status: "BET_NOW" }; // Line moved in favor
    }
    return { score: 85, status: "BET_NOW" }; // Good edge maintained
  }

  if (liveEdge >= 1.5) {
    // Moderate edge
    if (lineFavorability < -1.0) {
      return { score: 50, status: "WAIT" }; // Line moved against us significantly
    }
    return { score: 75, status: "BET_NOW" };
  }

  if (liveEdge >= 0.5) {
    // Thin edge - wait for better line
    if (lineFavorability >= 0) {
      return { score: 65, status: "WAIT" };
    }
    return { score: 55, status: "WAIT" };
  }

  // Edge disappeared or reversed
  return { score: 30, status: "AVOID" };
}

/**
 * Detect when a line looks too good (potential trap)
 * Returns true if the line appears suspicious
 */
export function detectTrapLine(
  projection: number,
  liveBookLine: number,
  lean: "OVER" | "UNDER",
  lineMovementHistory: number[],
): boolean {
  const edge = lean === "OVER" ? projection - liveBookLine : liveBookLine - projection;

  // If edge is HUGE (>5), the book likely knows something
  if (edge > 5) {
    console.log("[Lock Mode] TRAP WARNING: Edge too large:", edge.toFixed(2));
    return true;
  }

  // If line moved rapidly in one direction, be cautious
  const recentMovement = lineMovementHistory.slice(-3);
  if (recentMovement.length >= 3) {
    const totalMovement = recentMovement.reduce((a, b) => a + b, 0);
    if (Math.abs(totalMovement) > 3) {
      console.log("[Lock Mode] TRAP WARNING: Rapid line movement:", totalMovement.toFixed(2));
      return true;
    }
  }

  return false;
}
