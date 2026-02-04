
# Quarter Transition Alerts - Implementation Plan

## Overview

Add intelligent alerts that trigger at the end of each quarter, providing specific hedge guidance based on:
- Pace vs. expectation comparison per quarter
- Cumulative production trajectory
- Time remaining and projected finish
- Quarter-over-quarter velocity changes

---

## How It Works

The system will detect when a game transitions between quarters (Q1→Q2, Q2→Halftime, Q3→Q4, End of Game) and display a persistent alert card with guidance specific to that transition point.

```text
┌──────────────────────────────────────────────────────────────────┐
│  🔔 Q1 COMPLETE - PACE CHECK                                     │
├──────────────────────────────────────────────────────────────────┤
│  LeBron OVER 26.5 PTS                                            │
│                                                                  │
│  Q1: 8 pts (32% pace) ✓ ON TRACK                                │
│  Need: 26.5 → Achieved: 32%  → Project: 28.4                     │
│                                                                  │
│  ⚡ Velocity: 0.67/min (need 0.55/min) +22% ahead                │
│                                                                  │
│  🎯 Quarter Insight: Strong start. If Q2 matches,                │
│     could hit by halftime for profit lock opportunity.           │
│                                                                  │
│  ✓ NO ACTION NEEDED - Maintain position                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Sources

**Real-time from unified-player-feed:**
- `period` (current quarter: 1, 2, 3, 4)
- `clock` (time in quarter)
- `gameStatus` ('in_progress', 'halftime')
- `currentValue` (cumulative stat)
- `ratePerMinute` (current production rate)
- `paceRating` (game pace)

**Derived calculations:**
- Expected value per quarter = line / 4
- Quarter velocity = points in quarter / quarter minutes
- Pace gap = actual quarter production - expected quarter production
- Trajectory = if Q1 pace maintained for remaining quarters

---

## Technical Implementation

### 1. New Types in `src/types/sweetSpot.ts`

```typescript
export type QuarterNumber = 1 | 2 | 3 | 4;

export interface QuarterSnapshot {
  quarter: QuarterNumber;
  value: number;           // Stat value at end of quarter
  expectedValue: number;   // What we expected (line / 4)
  velocity: number;        // Rate in that quarter
  paceGap: number;         // +/- vs expected
  cumulative: number;      // Running total
  percentComplete: number; // 25, 50, 75, 100
}

export interface QuarterTransitionAlert {
  type: 'quarter_transition';
  quarter: QuarterNumber;
  headline: string;
  status: 'ahead' | 'on_track' | 'behind' | 'critical';
  
  // Quarter data
  quarterValue: number;
  expectedQuarterValue: number;
  paceGapPct: number;       // +22% ahead, -15% behind
  
  // Projection data
  currentTotal: number;
  projectedFinal: number;
  requiredRemaining: number;
  requiredRate: number;
  
  // Velocity comparison
  currentVelocity: number;  // Rate this quarter
  neededVelocity: number;   // Rate needed for remaining
  velocityDelta: number;    // Current vs needed
  
  // Guidance
  insight: string;
  action: string;
  urgency: 'none' | 'low' | 'medium' | 'high';
}
```

### 2. Quarter Tracking in `LivePropData`

Update the `LivePropData` interface to include quarter history:

```typescript
export interface LivePropData {
  isLive: boolean;
  gameStatus?: 'in_progress' | 'halftime' | 'scheduled' | 'final';
  currentValue: number;
  // ... existing fields ...
  
  // NEW: Quarter tracking
  currentQuarter: number;
  quarterHistory: QuarterSnapshot[];
  quarterTransition?: QuarterTransitionAlert;
}
```

### 3. Quarter Detection Hook

Create `src/hooks/useQuarterTransition.ts`:

```typescript
export function useQuarterTransition(spots: DeepSweetSpot[]) {
  // Track previous quarter per game
  const prevQuarters = useRef<Map<string, number>>(new Map());
  
  // Detect quarter transitions
  const spotsWithTransitions = useMemo(() => {
    return spots.map(spot => {
      if (!spot.liveData?.isLive) return spot;
      
      const currentQuarter = parseInt(spot.liveData.period);
      const prevQuarter = prevQuarters.current.get(spot.id) || 0;
      
      // Detect transition
      if (currentQuarter > prevQuarter && prevQuarter > 0) {
        const transition = calculateQuarterTransition(
          spot,
          prevQuarter as QuarterNumber
        );
        return { ...spot, liveData: { ...spot.liveData, quarterTransition: transition }};
      }
      
      // Also detect halftime
      if (spot.liveData.gameStatus === 'halftime' && prevQuarter === 2) {
        const transition = calculateHalftimeTransition(spot);
        return { ...spot, liveData: { ...spot.liveData, quarterTransition: transition }};
      }
      
      prevQuarters.current.set(spot.id, currentQuarter);
      return spot;
    });
  }, [spots]);
  
  return spotsWithTransitions;
}
```

### 4. Transition Calculation Logic

```typescript
function calculateQuarterTransition(
  spot: DeepSweetSpot,
  completedQuarter: QuarterNumber
): QuarterTransitionAlert {
  const { liveData, line, side } = spot;
  const currentTotal = liveData.currentValue;
  
  // Expected per quarter (simple: line / 4)
  const expectedPerQuarter = line / 4;
  const expectedAtQuarterEnd = expectedPerQuarter * completedQuarter;
  
  // Calculate pace gap
  const paceGap = currentTotal - expectedAtQuarterEnd;
  const paceGapPct = (paceGap / expectedAtQuarterEnd) * 100;
  
  // Velocity analysis
  const quarterMinutes = 12;
  const minutesPlayed = completedQuarter * quarterMinutes;
  const currentVelocity = currentTotal / minutesPlayed;
  
  // What's needed for remaining quarters
  const remaining = line - currentTotal;
  const remainingMinutes = (4 - completedQuarter) * 12;
  const requiredVelocity = remainingMinutes > 0 ? remaining / remainingMinutes : 0;
  const velocityDelta = currentVelocity - requiredVelocity;
  
  // Determine status
  let status: 'ahead' | 'on_track' | 'behind' | 'critical';
  let urgency: 'none' | 'low' | 'medium' | 'high';
  
  if (side === 'over') {
    if (paceGapPct >= 20) { status = 'ahead'; urgency = 'none'; }
    else if (paceGapPct >= -10) { status = 'on_track'; urgency = 'none'; }
    else if (paceGapPct >= -25) { status = 'behind'; urgency = 'medium'; }
    else { status = 'critical'; urgency = 'high'; }
  } else {
    // For UNDER, being "behind" (lower) is good
    if (paceGapPct <= -20) { status = 'ahead'; urgency = 'none'; }
    else if (paceGapPct <= 10) { status = 'on_track'; urgency = 'none'; }
    else if (paceGapPct <= 25) { status = 'behind'; urgency = 'medium'; }
    else { status = 'critical'; urgency = 'high'; }
  }
  
  // Generate insight based on quarter
  const insight = generateQuarterInsight(completedQuarter, paceGapPct, side, velocityDelta);
  const action = generateQuarterAction(status, urgency, side, completedQuarter);
  
  return {
    type: 'quarter_transition',
    quarter: completedQuarter,
    headline: `Q${completedQuarter} COMPLETE`,
    status,
    quarterValue: currentTotal / completedQuarter, // Avg per Q so far
    expectedQuarterValue: expectedPerQuarter,
    paceGapPct,
    currentTotal,
    projectedFinal: liveData.projectedFinal,
    requiredRemaining: remaining,
    requiredRate: requiredVelocity,
    currentVelocity,
    neededVelocity: requiredVelocity,
    velocityDelta,
    insight,
    action,
    urgency,
  };
}
```

### 5. New Component: `QuarterTransitionCard.tsx`

```typescript
export function QuarterTransitionCard({ transition, spot }: Props) {
  const colors = getTransitionColors(transition.status);
  
  return (
    <div className={cn("p-3 rounded-lg border mb-2", colors.bg, colors.border)}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Bell className="w-4 h-4" />
        <span className={cn("font-bold text-sm", colors.text)}>
          🔔 {transition.headline}
        </span>
        <span className={cn("ml-auto px-2 py-0.5 rounded text-xs font-bold", colors.badge)}>
          {transition.status.toUpperCase()}
        </span>
      </div>
      
      {/* Progress Bar */}
      <div className="mb-2">
        <div className="flex justify-between text-xs mb-1">
          <span>Q{transition.quarter}: {transition.currentTotal}</span>
          <span>Need: {spot.line}</span>
        </div>
        <Progress value={(transition.currentTotal / spot.line) * 100} />
        <div className="flex justify-between text-xs mt-1 text-muted-foreground">
          <span>Expected: {(transition.expectedQuarterValue * transition.quarter).toFixed(1)}</span>
          <span className={transition.paceGapPct >= 0 ? "text-primary" : "text-destructive"}>
            {transition.paceGapPct >= 0 ? '+' : ''}{transition.paceGapPct.toFixed(0)}%
          </span>
        </div>
      </div>
      
      {/* Velocity Comparison */}
      <div className="flex items-center gap-2 text-xs mb-2">
        <Zap className="w-3 h-3" />
        <span className="text-muted-foreground">
          Velocity: <span className="font-mono font-bold">{transition.currentVelocity.toFixed(2)}</span>/min
        </span>
        <span className="text-muted-foreground">|</span>
        <span className="text-muted-foreground">
          Need: <span className="font-mono font-bold">{transition.neededVelocity.toFixed(2)}</span>/min
        </span>
        <span className={cn(
          "font-bold",
          transition.velocityDelta >= 0 ? "text-primary" : "text-destructive"
        )}>
          ({transition.velocityDelta >= 0 ? '+' : ''}{((transition.velocityDelta / transition.neededVelocity) * 100).toFixed(0)}%)
        </span>
      </div>
      
      {/* Insight */}
      <p className="text-xs text-muted-foreground mb-2">
        🎯 {transition.insight}
      </p>
      
      {/* Action */}
      <div className={cn(
        "p-2 rounded text-xs font-semibold",
        transition.urgency === 'high' ? "bg-destructive/20 text-destructive" :
        transition.urgency === 'medium' ? "bg-orange-500/20 text-orange-500" :
        "bg-primary/20 text-primary"
      )}>
        {transition.action}
      </div>
    </div>
  );
}
```

### 6. Integration with HedgeRecommendation

Update `HedgeRecommendation.tsx` to show the quarter transition card above the main hedge content:

```typescript
export function HedgeRecommendation({ spot }: HedgeRecommendationProps) {
  // ... existing logic ...
  
  return (
    <div className={cn("mt-2 p-3 rounded-lg border", colors.bg, colors.border)}>
      {/* Quarter Transition Alert (if active) */}
      {spot.liveData?.quarterTransition && (
        <QuarterTransitionCard 
          transition={spot.liveData.quarterTransition} 
          spot={spot} 
        />
      )}
      
      {/* Halftime Indicator */}
      {/* ... rest of existing content ... */}
    </div>
  );
}
```

### 7. Insight Generation Logic

```typescript
function generateQuarterInsight(
  quarter: QuarterNumber,
  paceGapPct: number,
  side: 'over' | 'under',
  velocityDelta: number
): string {
  if (quarter === 1) {
    if (side === 'over') {
      if (paceGapPct >= 20) return "Strong Q1 start. If Q2 matches, watch for halftime profit lock.";
      if (paceGapPct >= 0) return "Solid pace. Stay patient through Q2.";
      if (paceGapPct >= -15) return "Slightly slow Q1. Common for pacing - monitor Q2 burst.";
      return "Slow start. Need acceleration in Q2 or consider light hedge.";
    } else {
      if (paceGapPct <= -20) return "Great Q1 for UNDER. Low usage trend looking favorable.";
      if (paceGapPct >= 20) return "Warning: Q1 pace threatens UNDER. Watch for continuation.";
    }
  }
  
  if (quarter === 2) {
    // Halftime analysis
    if (side === 'over') {
      if (paceGapPct >= 15) return "Strong 1st half. Consider small profit lock on UNDER.";
      if (paceGapPct >= -10) return "On track at half. Q3 historically has highest scoring.";
      return "Behind at halftime. Need big 2nd half or hedge now.";
    }
  }
  
  if (quarter === 3) {
    if (side === 'over') {
      if (paceGapPct >= 10) return "Cruising. Q4 is cushion territory.";
      if (paceGapPct < -15) return "Q4 crunch time. Stars usually close strong but hedge may be wise.";
    }
  }
  
  return "Tracking production. Continue monitoring.";
}

function generateQuarterAction(
  status: string,
  urgency: string,
  side: 'over' | 'under',
  quarter: QuarterNumber
): string {
  const remainingQs = 4 - quarter;
  
  if (status === 'ahead' || status === 'on_track') {
    if (quarter >= 2 && status === 'ahead') {
      return `✓ Consider small profit lock on opposite side if ${remainingQs}Q+ buffer`;
    }
    return `✓ HOLD - No action needed. ${remainingQs} quarter${remainingQs > 1 ? 's' : ''} remaining.`;
  }
  
  if (status === 'behind') {
    return `⚠️ Watch Q${quarter + 1} closely. Prepare hedge if trend continues.`;
  }
  
  return `🚨 HEDGE RECOMMENDED - ${remainingQs} quarter${remainingQs > 1 ? 's' : ''} may not be enough at current pace.`;
}
```

---

## Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| MODIFY | `src/types/sweetSpot.ts` | Add QuarterSnapshot, QuarterTransitionAlert types |
| MODIFY | `src/hooks/useSweetSpotLiveData.ts` | Add quarter tracking to enriched data |
| CREATE | `src/hooks/useQuarterTransition.ts` | Quarter detection and transition calculation |
| CREATE | `src/components/sweetspots/QuarterTransitionCard.tsx` | UI component for quarter alerts |
| MODIFY | `src/components/sweetspots/HedgeRecommendation.tsx` | Integrate QuarterTransitionCard |

---

## User Experience Flow

1. **Q1 Ends (25% complete)**
   - Alert shows Q1 production vs. expected
   - Velocity comparison appears
   - Early indication if on track or adjustments needed

2. **Halftime (50% complete)**
   - Comprehensive 1st half analysis
   - Clear projection for 2nd half
   - Profit lock opportunities highlighted if ahead

3. **Q3 Ends (75% complete)**
   - "Crunch time" analysis
   - Strong recommendation if behind
   - Q4 expectations set

4. **Q4/End of Game**
   - Final outcome tracking
   - Win/loss confirmation

---

## Alert Persistence

Quarter transition alerts will:
- Appear immediately when quarter ends
- Persist for ~3 minutes into the next quarter (allowing user to see)
- Auto-dismiss when meaningful action happens in new quarter
- Always be overridden by more urgent hedge alerts (blowout, foul trouble)

