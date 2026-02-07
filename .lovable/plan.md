

# Fix: Side-Aware Messaging for ON TRACK Status

## Problem

For **UNDER bets**, the "ON TRACK" message shows confusing/wrong language:

| Bet | Current Display | Issue |
|-----|-----------------|-------|
| Kevin Porter Jr. UNDER 9.5 | "Projected 2.0 **exceeds** line 9.5 by 7.5" | 2.0 doesn't exceed 9.5! |

The word "exceeds" only makes sense for OVER bets. For UNDER bets, the projection being **lower** than the line is what makes it on track.

## Root Cause

Line 480 in `HedgeRecommendation.tsx`:
```typescript
message = `Projected ${projectedFinal.toFixed(1)} exceeds line ${hedgeLine} by ${gapToLine.toFixed(1)}...`
```

This hardcoded message ignores the bet side, making UNDER bet status confusing.

## Solution

Update the ON TRACK message to use side-aware language:

| Bet Side | Before (Wrong) | After (Fixed) |
|----------|----------------|---------------|
| OVER 2.5 | "Projected 5.8 exceeds line 2.5" | "Projected 5.8 clears OVER 2.5" |
| UNDER 9.5 | "Projected 2.0 exceeds line 9.5" | "Projected 2.0 clears UNDER 9.5" |

## File Changes

### `src/components/sweetspots/HedgeRecommendation.tsx`

**Line 480** - Update ON TRACK message:

```typescript
// Before:
message = `Projected ${projectedFinal.toFixed(1)} exceeds line ${hedgeLine} by ${gapToLine.toFixed(1)}. ${hitProbability}% probability. Rate: ${currentRate.toFixed(2)}/min.`;

// After:
message = `Projected ${projectedFinal.toFixed(1)} clears ${side.toUpperCase()} ${hedgeLine} by ${gapToLine.toFixed(1)}. ${hitProbability}% probability. Rate: ${currentRate.toFixed(2)}/min.`;
```

### Also update related messages

**Line 467** - MONITOR message (same issue):
```typescript
// Before:
message = `Slightly off pace. Projected ${projectedFinal.toFixed(1)} vs line ${hedgeLine}...`

// After (add side for clarity):
message = `Slightly off pace. Projected ${projectedFinal.toFixed(1)} vs ${side.toUpperCase()} ${hedgeLine}...`
```

## Expected Outcome

Kevin Porter Jr. UNDER 9.5 will now correctly show:

> "Projected 2.0 clears UNDER 9.5 by 7.5. 85% probability."

This makes it immediately clear that being projected **below** 9.5 is favorable for an UNDER bet.

