
# Rotation-Aware Live Hedge Recommendations

## Current State Analysis

The hedge recommendation system currently uses these factors:
1. **Production Rate**: Current stat / minutes played → projected at linear pace
2. **Pace Rating**: Game tempo (fast/slow) with 2H regression modeling
3. **Risk Flags**: Foul trouble, blowout risk, garbage time
4. **Zone Matchups**: Shot chart vs defense analysis for scoring props
5. **Quarter Transitions**: Velocity tracking at period boundaries
6. **Halftime Recalibration**: Historical H1/H2 distribution adjustment

**Missing**: Rotation pattern awareness that understands **when** a player is likely to be on the court vs benched.

---

## Problem Statement

Current hedge recommendations assume linear minute accumulation, but NBA rotations follow predictable patterns:

| Rotation Segment | Typical Timing | Star Minutes | Bench Minutes |
|------------------|----------------|--------------|---------------|
| 1st Rotation | Q1 0:00-6:00, Q2 6:00-0:00 | ~8-10 min | ~4-5 min |
| 2nd Rotation | Q1 6:00-0:00, Q2 12:00-6:00 | ~4-5 min | ~8-10 min |
| 3rd Rotation | Q3 0:00-6:00, Q4 6:00-0:00 | ~8-10 min | ~4-5 min |
| 4th Rotation | Q3 6:00-0:00, Q4 12:00-6:00 | ~4-5 min | ~8-10 min |
| Closer Rotation | Q4 final 5:00 (close games) | ~5 min | 0 min |

### Example Scenario

**Pick**: LeBron James OVER 26.5 points
**Current State**: Q2 8:00 remaining, 12 points, 14 minutes played

**Current System Says**: 
- Rate: 0.86 pts/min × ~22 remaining = +18.9 → Projected 30.9 ✓ ON TRACK

**Reality**: LeBron is about to sit for his 2nd rotation rest (Q2 8:00-0:00). He won't play for ~8 minutes of game time. Actual remaining minutes: ~14-16, not 22.

**Rotation-Aware System Should Say**:
- Rate: 0.86 pts/min × ~15 remaining = +12.9 → Projected 24.9 ⚠️ MONITOR
- "Star entering rest rotation. Expect 6-8 min bench time."

---

## Data Sources Available

### 1. `player_quarter_baselines` (Historical Patterns)
```
- q1_pct, q2_pct, q3_pct, q4_pct: Production distribution per quarter
- q1_rate, q2_rate, q3_rate, q4_rate: Per-minute rates per quarter
- player_tier: 'star', 'starter', 'role_player'
- minutes_avg: Expected total minutes
```

### 2. `quarter_player_snapshots` (Live Rotation Tracking)
```
- rotation_role: 'STARTER', 'CLOSER', 'BENCH_CORE', 'BENCH_FRINGE'
- on_court_stability: 0-1 predictability score
- minutes_played at each quarter boundary
```

### 3. Unified Player Feed (Current State)
```
- minutesPlayed: Current game minutes
- role: 'star', 'starter', 'rotation', 'bench'
- estimatedRemaining: Simple projection (doesn't account for rotation timing)
```

---

## Implementation Plan

### Step 1: Create Rotation Pattern Model

Create a new utility file to model rotation timing:

**File**: `src/lib/rotation-patterns.ts`

This will contain:
- **Rotation window definitions** by player tier (when stars/starters typically sit/play)
- **`estimateRotationMinutes()`**: Given current quarter + clock, calculate expected remaining minutes accounting for upcoming bench stints
- **`isInRestWindow()`**: Detect if player is currently in or approaching a typical rest period
- **`getRotationInsight()`**: Generate human-readable rotation context

```typescript
// Example structure
interface RotationEstimate {
  expectedRemaining: number;      // Rotation-aware remaining minutes
  uncertaintyRange: [number, number]; // Low/high range
  currentPhase: 'active' | 'rest' | 'returning';
  nextTransition: string;         // "Likely to sit in ~4 min"
  closerEligible: boolean;        // Could play closing minutes?
  rotationInsight: string;
}

const STAR_ROTATION_WINDOWS = [
  { start: { quarter: 1, clock: 12 }, end: { quarter: 1, clock: 6 }, onCourt: true },
  { start: { quarter: 1, clock: 6 }, end: { quarter: 1, clock: 0 }, onCourt: false }, // Rest
  { start: { quarter: 2, clock: 12 }, end: { quarter: 2, clock: 6 }, onCourt: false }, // Rest
  { start: { quarter: 2, clock: 6 }, end: { quarter: 2, clock: 0 }, onCourt: true },
  // ... etc
];
```

### Step 2: Create Rotation Analysis Hook

**File**: `src/hooks/useRotationAwareProjection.ts`

This hook will:
1. Fetch `player_quarter_baselines` for tier classification
2. Parse current quarter + clock from `liveData`
3. Calculate rotation-aware remaining minutes
4. Adjust projections using quarter-specific rates (Q3 rate ≠ Q1 rate)

```typescript
interface RotationAwareProjection {
  // Standard projection fields
  projectedFinal: number;
  confidence: number;
  
  // Rotation context
  rotationPhase: 'first' | 'second' | 'third' | 'fourth' | 'closer';
  minutesRemaining: number;
  minutesUncertainty: number;
  isInRestWindow: boolean;
  restWindowRemaining: number;
  
  // Insights
  rotationInsight: string;
  minutesBreakdown: {
    expectedThisQuarter: number;
    expectedNextQuarters: number[];
    closerMinutes: number;
  };
}
```

### Step 3: Integrate into Hedge Recommendations

**File**: `src/components/sweetspots/HedgeRecommendation.tsx`

Modify `calculateEnhancedHedgeAction()` to:
1. Use rotation-aware remaining minutes instead of linear `48 * (1 - gameProgress/100)`
2. Add rotation phase to risk assessment (URGENT if approaching rest window while behind)
3. Display rotation context in the recommendation message

Key changes:
```typescript
// BEFORE: Linear minutes estimate
const minutesRemaining = Math.max(0, 48 * (1 - gameProgress / 100));

// AFTER: Rotation-aware estimate
const rotationEstimate = calculateRotationMinutes(spot, liveData);
const minutesRemaining = rotationEstimate.expectedRemaining;

// Add rotation-specific urgency
if (rotationEstimate.isInRestWindow && status === 'behind') {
  status = 'alert';
  message += ` Player in rest rotation - limited production window.`;
}

if (rotationEstimate.currentPhase === 'rest' && side === 'over') {
  status = 'urgent';
  message = `Player currently benched. On track to miss line at current pace.`;
}
```

### Step 4: Add Rotation Display Component

**File**: `src/components/sweetspots/RotationStatusBadge.tsx`

Visual indicator showing:
- Current rotation phase (1st/2nd/Closer)
- Minutes expected this stint
- Time until next rotation transition
- Closer eligibility status

### Step 5: Enhance Quarter Transition Alerts

**File**: `src/hooks/useQuarterTransition.ts`

Update transition alerts to include rotation context:
- "Q2 Complete: Star entering 2nd rotation rest. Expect ~6 min bench time."
- "Q3 Complete: Closer eligible in close game. +5 min boost likely."

---

## Technical Details

### Rotation Window Mapping

| Player Tier | Q1 | Q2 Early | Q2 Late | Q3 | Q4 Early | Q4 Late |
|-------------|-----|----------|---------|-----|----------|---------|
| Star | PLAY | REST | PLAY | PLAY | REST | CLOSER |
| Starter | PLAY | REST | PLAY | PLAY | REST | SITUATIONAL |
| Bench Core | REST | PLAY | REST | REST | PLAY | REST |
| Bench Fringe | SPOT | SPOT | SPOT | SPOT | SPOT | GARBAGE |

### Minutes Calculation Formula

```typescript
function calculateRotationMinutes(
  playerTier: 'star' | 'starter' | 'role_player',
  currentQuarter: number,
  clockMinutes: number,
  scoreDiff: number,
  isOnCourt: boolean
): number {
  // Get remaining windows where player expected to play
  const playWindows = getExpectedPlayWindows(playerTier, currentQuarter, clockMinutes);
  
  // Sum expected minutes from each window
  let expectedMinutes = 0;
  for (const window of playWindows) {
    expectedMinutes += window.expectedMinutes;
  }
  
  // Apply close-game closer bonus
  if (currentQuarter >= 4 && Math.abs(scoreDiff) <= 8 && playerTier === 'star') {
    expectedMinutes += 3; // Stars play through in close games
  }
  
  // Apply blowout penalty
  if (Math.abs(scoreDiff) >= 20 && currentQuarter >= 3) {
    expectedMinutes *= 0.6; // Starters sit in blowouts
  }
  
  return expectedMinutes;
}
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/lib/rotation-patterns.ts` | CREATE | Rotation window definitions + helpers |
| `src/hooks/useRotationAwareProjection.ts` | CREATE | Hook to calculate rotation-aware projections |
| `src/components/sweetspots/RotationStatusBadge.tsx` | CREATE | Visual rotation phase indicator |
| `src/components/sweetspots/HedgeRecommendation.tsx` | MODIFY | Integrate rotation-aware logic |
| `src/hooks/useQuarterTransition.ts` | MODIFY | Add rotation context to alerts |
| `src/hooks/useSweetSpotLiveData.ts` | MODIFY | Pass rotation data through pipeline |

---

## Expected Outcomes

### Before (Current System)
```
LeBron James - OVER 26.5 PTS
Q2 8:00 | 12 pts | Rate: 0.86/min
✓ ON TRACK - Projected 30.9
Hold position. No hedge needed.
```

### After (Rotation-Aware)
```
LeBron James - OVER 26.5 PTS
Q2 8:00 | 12 pts | Rate: 0.86/min
🔄 2ND ROTATION (Rest ~6 min)
⚠️ MONITOR - Projected 26.1
Entering bench window. ~15 min remaining (not 22).
Watch for Q2 return at 6:00 mark.
```

---

## Accuracy Improvements

This enhancement targets:
1. **False Positives**: Reduce "ON TRACK" calls when player is about to sit
2. **False Negatives**: Avoid panic hedges when bench player is about to return
3. **Closer Awareness**: Boost projections in close Q4 games for stars
4. **Role-Specific Timing**: Different windows for starters vs. bench players

Historical pattern data from `player_quarter_baselines` (q1_pct, q2_pct, etc.) will validate whether a player typically produces more in specific quarters, further refining the rotation model.
