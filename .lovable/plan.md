

# Fix: Profit Lock / Middle Bet Logic

## The Bug

The system shows "BET UNDER 2.5 NOW - Lock in guaranteed profit" when:
- User bet **OVER 2.5**
- Current value is **4**

This is **impossible** - you cannot bet UNDER 2.5 when the player already has 4 (the under has already lost).

## Root Cause

The "profit lock" logic at line 228-236 in `HedgeRecommendation.tsx` doesn't understand that:
1. **True profit lock (middling)** requires the line to have MOVED since original bet
2. You need a **different line** to create a middle, not the same line in opposite direction

### Current Code (Broken):
```typescript
const alreadyHit = side === 'over' ? currentValue >= line : currentValue < line && projectedFinal < line;
if (alreadyHit && side === 'over') {
  message = `Current ${currentValue} already exceeds line ${line}. Bet ${oppositeSide} now...`;
  action = `BET ${oppositeSide} ${line} NOW - Lock in guaranteed profit`;
}
```

This incorrectly suggests betting UNDER the **same line** that's already been exceeded.

## The Fix

Replace the broken "profit lock" alert with a simple **"Already Won"** status for OVER bets where current > line:

### File: `src/components/sweetspots/HedgeRecommendation.tsx`

**Change the profit lock logic (lines 228-237):**

```typescript
// Check if bet has already won
if (side === 'over' && currentValue >= line) {
  // OVER already hit - this is a WIN, not a hedge opportunity
  return {
    status: 'on_track',
    headline: '✅ ALREADY HIT',
    message: `Line cleared! Current ${currentValue} exceeds line ${line}. Your OVER ${line} bet has won.`,
    action: 'Bet is already successful. Watch for final confirmation.',
    urgency: 'none',
    trendDirection: 'stable',
    hitProbability: 100,
    rateNeeded: 0,
    currentRate,
    timeRemaining,
    gapToLine: currentValue - line,
  };
}

// For UNDER: check if still safe
if (side === 'under' && currentValue >= line) {
  // UNDER already lost - player exceeded the line
  return {
    status: 'urgent',
    headline: '❌ LINE EXCEEDED',
    message: `Player at ${currentValue} has exceeded line ${line}. Your UNDER ${line} bet has lost.`,
    action: 'Bet has already failed. No hedge possible.',
    urgency: 'high',
    trendDirection: 'worsening',
    hitProbability: 0,
    rateNeeded: 0,
    currentRate,
    timeRemaining,
    gapToLine: line - currentValue,
  };
}
```

## Future Enhancement: True Middle Bet Detection

A proper "profit lock" feature would need:
1. **Track the original line** when bet was placed
2. **Track current market line** (may have moved)
3. If original OVER 2.5, and current market offers UNDER 5.5 → middle opportunity exists (if player ends 3-5)

This requires tracking line movement data, which is a separate feature enhancement.

## Summary

| Scenario | Current (Broken) | Fixed |
|----------|-----------------|-------|
| OVER 2.5, current = 4 | "Bet UNDER 2.5" (impossible) | "Already Hit - Bet won" |
| UNDER 2.5, current = 4 | Not handled well | "Line Exceeded - Bet lost" |
| OVER 2.5, current = 1 | Works correctly | Works correctly |

## Files to Modify

- `src/components/sweetspots/HedgeRecommendation.tsx` - Fix lines 228-237

