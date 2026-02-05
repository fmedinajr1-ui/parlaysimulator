import { useRef, useMemo, useEffect } from 'react';
import type { DeepSweetSpot, QuarterNumber, QuarterTransitionAlert, QuarterSnapshot } from '@/types/sweetSpot';
import { inferPlayerTier, calculateRotationMinutes } from '@/lib/rotation-patterns';

// How long to keep the alert visible after a quarter ends (in ms)
const ALERT_PERSISTENCE_MS = 3 * 60 * 1000; // 3 minutes

// Generate quarter-specific insight based on performance
function generateQuarterInsight(
  quarter: QuarterNumber,
  paceGapPct: number,
  side: 'over' | 'under',
  velocityDelta: number,
  playerTier?: 'star' | 'starter' | 'role_player'
): string {
  const tierLabel = playerTier === 'star' ? 'Stars' : playerTier === 'starter' ? 'Starters' : 'Bench players';
  
  if (quarter === 1) {
    if (side === 'over') {
      if (paceGapPct >= 20) return "Strong Q1 start. If Q2 matches, watch for halftime profit lock.";
      if (paceGapPct >= 0) return "Solid pace. Stay patient through Q2.";
      if (paceGapPct >= -15) return `Slightly slow Q1. ${tierLabel} often ramp up after 1st rotation.`;
      return "Slow start. Need acceleration in Q2 or consider light hedge.";
    } else {
      if (paceGapPct <= -20) return "Great Q1 for UNDER. Low usage trend looking favorable.";
      if (paceGapPct <= 10) return "On track for UNDER. Player pacing as expected.";
      if (paceGapPct >= 20) return "Warning: Q1 pace threatens UNDER. Watch for continuation.";
      return "UNDER at risk. Player exceeding expected production.";
    }
  }
  
  if (quarter === 2) {
    // Halftime analysis
    if (side === 'over') {
      if (paceGapPct >= 15) return `Strong 1st half. ${tierLabel} typically maintain pace in 2H.`;
      if (paceGapPct >= -10) return `On track at half. ${tierLabel === 'Stars' ? 'Stars' : 'Key players'} play full 2nd half stints.`;
      if (paceGapPct >= -20) return `Slightly behind at half. ${tierLabel} often surge in 3rd quarter.`;
      return "Behind at halftime. Need big 2nd half or hedge now.";
    } else {
      if (paceGapPct <= -15) return "UNDER looking strong. 1st half production well below line.";
      if (paceGapPct <= 10) return "UNDER on track. Monitor 2nd half pace carefully.";
      return "UNDER at risk. May need hedge if Q3 continues this pace.";
    }
  }
  
  if (quarter === 3) {
    if (side === 'over') {
      if (paceGapPct >= 10) return "Cruising. Q4 is cushion territory.";
      if (paceGapPct >= -5) return `Close heading to Q4. ${tierLabel} get closing minutes in tight games.`;
      if (paceGapPct < -15) return `Q4 crunch time. ${tierLabel === 'Stars' ? 'Stars play through' : 'Limited closing time'} - hedge may be wise.`;
      return `Behind heading to Q4. ${tierLabel === 'Bench players' ? 'Bench may get garbage time' : 'Watch for closer minutes'}.`;
    } else {
      if (paceGapPct <= -10) return "UNDER looking safe. One quarter to go.";
      if (paceGapPct <= 5) return "UNDER manageable. Watch for late game situations.";
      return "UNDER at risk in Q4. Garbage time could go either way.";
    }
  }
  
  return "Tracking production. Continue monitoring.";
}

// Generate action recommendation based on status
function generateQuarterAction(
  status: 'ahead' | 'on_track' | 'behind' | 'critical',
  urgency: 'none' | 'low' | 'medium' | 'high',
  side: 'over' | 'under',
  quarter: QuarterNumber
): string {
  const remainingQs = 4 - quarter;
  
  if (status === 'ahead') {
    if (quarter >= 2) {
      return `✓ Consider small profit lock on opposite side if ${remainingQs}Q+ buffer`;
    }
    return `✓ HOLD - Strong position. ${remainingQs} quarter${remainingQs > 1 ? 's' : ''} remaining.`;
  }
  
  if (status === 'on_track') {
    return `✓ HOLD - No action needed. ${remainingQs} quarter${remainingQs > 1 ? 's' : ''} remaining.`;
  }
  
  if (status === 'behind') {
    return `⚠️ Watch Q${quarter + 1} closely. Prepare hedge if trend continues.`;
  }
  
  return `🚨 HEDGE RECOMMENDED - ${remainingQs} quarter${remainingQs > 1 ? 's' : ''} may not be enough at current pace.`;
}

// Calculate the transition alert for a completed quarter
export function calculateQuarterTransition(
  spot: DeepSweetSpot,
  completedQuarter: QuarterNumber
): QuarterTransitionAlert {
  const { liveData, line, side } = spot;
  const currentTotal = liveData?.currentValue ?? 0;
  const projectedFinal = liveData?.projectedFinal ?? 0;
  const minutesPlayed = liveData?.minutesPlayed ?? 0;
  const gameProgress = liveData?.gameProgress ?? 0;
  
  // Infer player tier for rotation context
  const playerTier = inferPlayerTier(minutesPlayed, gameProgress);
  
  // Get rotation-aware remaining minutes estimate
  const rotationEstimate = calculateRotationMinutes(
    playerTier,
    completedQuarter + 1, // Next quarter
    12, // Start of quarter
    0, // scoreDiff
    minutesPlayed
  );
  
  // Expected per quarter (simple: line / 4)
  const expectedPerQuarter = line / 4;
  const expectedAtQuarterEnd = expectedPerQuarter * completedQuarter;
  
  // Calculate pace gap
  const paceGap = currentTotal - expectedAtQuarterEnd;
  const paceGapPct = expectedAtQuarterEnd > 0 ? (paceGap / expectedAtQuarterEnd) * 100 : 0;
  
  // Velocity analysis
  const gameMinutes = completedQuarter * 12;
  const actualMinutesPlayed = minutesPlayed || gameMinutes * 0.75;
  const currentVelocity = actualMinutesPlayed > 0 ? currentTotal / actualMinutesPlayed : 0;
  
  // What's needed for remaining quarters (using rotation-aware minutes)
  const remaining = line - currentTotal;
  const remainingPlayMinutes = rotationEstimate.expectedRemaining;
  const requiredVelocity = remainingPlayMinutes > 0 ? remaining / remainingPlayMinutes : 0;
  const velocityDelta = currentVelocity - requiredVelocity;
  
  // Determine status based on pace gap and bet side
  let status: 'ahead' | 'on_track' | 'behind' | 'critical';
  let urgency: 'none' | 'low' | 'medium' | 'high';
  
  if (side === 'over') {
    if (paceGapPct >= 20) { status = 'ahead'; urgency = 'none'; }
    else if (paceGapPct >= -10) { status = 'on_track'; urgency = 'none'; }
    else if (paceGapPct >= -25) { status = 'behind'; urgency = 'medium'; }
    else { status = 'critical'; urgency = 'high'; }
  } else {
    // For UNDER, being "behind" (lower production) is good
    if (paceGapPct <= -20) { status = 'ahead'; urgency = 'none'; }
    else if (paceGapPct <= 10) { status = 'on_track'; urgency = 'none'; }
    else if (paceGapPct <= 25) { status = 'behind'; urgency = 'medium'; }
    else { status = 'critical'; urgency = 'high'; }
  }
  
  // Generate insight and action
  const insight = generateQuarterInsight(completedQuarter, paceGapPct, side, velocityDelta, playerTier);
  const action = generateQuarterAction(status, urgency, side, completedQuarter);
  
  return {
    type: 'quarter_transition',
    quarter: completedQuarter,
    headline: `Q${completedQuarter} COMPLETE`,
    status,
    quarterValue: completedQuarter > 0 ? currentTotal / completedQuarter : 0, // Avg per Q so far
    expectedQuarterValue: expectedPerQuarter,
    paceGapPct,
    currentTotal,
    projectedFinal,
    requiredRemaining: Math.max(0, remaining),
    requiredRate: requiredVelocity,
    currentVelocity,
    neededVelocity: requiredVelocity, 
    velocityDelta,
    insight,
    action,
    urgency,
  };
}

// Calculate halftime-specific transition
function calculateHalftimeTransition(spot: DeepSweetSpot): QuarterTransitionAlert {
  const transition = calculateQuarterTransition(spot, 2);
  return {
    ...transition,
    headline: 'HALFTIME',
    insight: transition.insight + ' 2nd half adjustments common.',
  };
}

interface QuarterTransitionState {
  quarter: number;
  timestamp: number;
  alert: QuarterTransitionAlert;
}

/**
 * Hook that detects quarter transitions and generates alerts
 * Alerts persist for 3 minutes after a quarter ends
 */
export function useQuarterTransition(spots: DeepSweetSpot[]) {
  // Track previous quarter per spot and active alerts
  const prevQuarters = useRef<Map<string, number>>(new Map());
  const activeAlerts = useRef<Map<string, QuarterTransitionState>>(new Map());
  
  // Cleanup expired alerts periodically
  useEffect(() => {
    const cleanup = setInterval(() => {
      const now = Date.now();
      activeAlerts.current.forEach((state, spotId) => {
        if (now - state.timestamp > ALERT_PERSISTENCE_MS) {
          activeAlerts.current.delete(spotId);
        }
      });
    }, 30000); // Check every 30 seconds
    
    return () => clearInterval(cleanup);
  }, []);
  
  // Detect transitions and update spots
  const spotsWithTransitions = useMemo(() => {
    const now = Date.now();
    
    return spots.map(spot => {
      if (!spot.liveData?.isLive && spot.liveData?.gameStatus !== 'halftime') {
        return spot;
      }
      
      const currentQuarter = parseInt(spot.liveData?.period || '0') || 0;
      const prevQuarter = prevQuarters.current.get(spot.id) || 0;
      
      // Detect quarter transition (quarter just increased)
      if (currentQuarter > prevQuarter && prevQuarter > 0 && prevQuarter <= 4) {
        const transition = calculateQuarterTransition(spot, prevQuarter as QuarterNumber);
        activeAlerts.current.set(spot.id, {
          quarter: prevQuarter,
          timestamp: now,
          alert: transition,
        });
      }
      
      // Detect halftime (game status changed to halftime from Q2)
      if (spot.liveData?.gameStatus === 'halftime' && prevQuarter === 2) {
        const existingAlert = activeAlerts.current.get(spot.id);
        if (!existingAlert || existingAlert.quarter !== 2) {
          const transition = calculateHalftimeTransition(spot);
          activeAlerts.current.set(spot.id, {
            quarter: 2,
            timestamp: now,
            alert: transition,
          });
        }
      }
      
      // Update the previous quarter tracker
      prevQuarters.current.set(spot.id, currentQuarter);
      
      // Check for active alert to attach
      const alertState = activeAlerts.current.get(spot.id);
      if (alertState && now - alertState.timestamp < ALERT_PERSISTENCE_MS) {
        return {
          ...spot,
          liveData: {
            ...spot.liveData,
            currentQuarter,
            quarterHistory: [],
            quarterTransition: alertState.alert,
          },
        };
      }
      
      // No active alert, but add quarter tracking
      return {
        ...spot,
        liveData: {
          ...spot.liveData!,
          currentQuarter,
          quarterHistory: [],
        },
      };
    });
  }, [spots]);
  
  return spotsWithTransitions;
}
