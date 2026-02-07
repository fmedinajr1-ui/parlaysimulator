

# Fix: Hedge Alert Should Respect Projection Buffer

## Problem Summary

The screenshot shows **Pelle Larsson OVER 2.5 assists** displaying contradictory information:
- ✅ Projected: **5.8** (exceeds line by 3.3)
- ✅ Rate: **0.18/min** (3x faster than the 0.06/min needed)
- ✅ Pace: **160%** of target
- ❌ But shows: **"⚠️ HEDGE ALERT"** and **"Consider UNDER 2.5"**

The user is correctly confused - **this bet is clearly on track**, but a slow game pace flag (8 = SLOW) is incorrectly triggering an alert.

## Root Cause

In `HedgeRecommendation.tsx`, line 441:

```text
else if (severeRiskCount >= 1 || hitProbability < alertThreshold || hasSlowPace || hasZoneDisadvantage)
```

The `hasSlowPace` flag triggers an alert **regardless of projection buffer**. Even if you're projected to beat the line by 3+ points, a slow pace still flags an alert.

## Solution

Add a **buffer override** that prevents pace-based alerts when the projection is comfortably ahead of the line:

**Logic Change:**
```text
// Skip slow-pace alert if projected to clear line by 2+ (clearly on track)
const hasSignificantBuffer = gapToLine >= 2;
const effectiveSlowPace = hasSlowPace && !hasSignificantBuffer;
```

Then use `effectiveSlowPace` instead of `hasSlowPace` in the alert condition.

## File Changes

### `src/components/sweetspots/HedgeRecommendation.tsx`

| Line | Change |
|------|--------|
| ~325 | After `hasSlowPace` calculation, add buffer override logic |
| ~441 | Replace `hasSlowPace` with `effectiveSlowPace` in the condition |
| ~445-446 | Update slow pace message to only show when pace is actually threatening |

**Before (line ~323-325):**
```typescript
const hasSlowPace = paceRating < 95 && side === 'over';
```

**After:**
```typescript
const hasSlowPace = paceRating < 95 && side === 'over';
// Don't alert for slow pace if projection is comfortably clearing the line
const hasSignificantBuffer = gapToLine >= 2;
const effectivePaceRisk = hasSlowPace && !hasSignificantBuffer;
```

**Before (line ~441):**
```typescript
else if (severeRiskCount >= 1 || hitProbability < alertThreshold || hasSlowPace || hasZoneDisadvantage)
```

**After:**
```typescript
else if (severeRiskCount >= 1 || hitProbability < alertThreshold || effectivePaceRisk || hasZoneDisadvantage)
```

### `src/lib/hedgeStatusUtils.ts`

Apply the same fix to the filter utility for consistency:

| Line | Change |
|------|--------|
| 56-60 | Add buffer check before pace-based alert override |

**Before (lines 56-60):**
```typescript
// Pace-based override for OVER bets
if (isOver && (liveData.paceRating ?? 100) < 95) {
  if (confidence < 45) return 'urgent';
  if (confidence < 55) return 'alert';
}
```

**After:**
```typescript
// Pace-based override for OVER bets (only if not already comfortably ahead)
const hasSignificantBuffer = (projectedFinal - line) >= 2;
if (isOver && (liveData.paceRating ?? 100) < 95 && !hasSignificantBuffer) {
  if (confidence < 45) return 'urgent';
  if (confidence < 55) return 'alert';
}
```

## Expected Outcome

After this fix:

| Scenario | Before | After |
|----------|--------|-------|
| Pelle (5.8 proj vs 2.5 line, slow pace) | ⚠️ HEDGE ALERT | ✓ ON TRACK |
| Player (3.0 proj vs 2.5 line, slow pace) | ⚠️ HEDGE ALERT | ⚠️ HEDGE ALERT (still tight) |
| Player (2.0 proj vs 2.5 line, slow pace) | ⚠️ HEDGE ALERT | 🚨 HEDGE NOW (behind) |

The fix ensures that **projection buffer takes priority** - if you're projected to clear the line by 2+, pace concerns become secondary.

## Quick Answer for Pelle Larsson

**Stay with OVER 2.5 - No hedge needed!** 

- Projected: 5.8 assists (2.3x the line)
- Current rate: 0.18/min (3x what you need)
- This is clearly on track despite the buggy "HEDGE ALERT" display

