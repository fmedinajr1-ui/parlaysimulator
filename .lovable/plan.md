
# Fix Sweet Spots UNDER Selection Logic

## Problem Identified

The UNDER picks keep going OVER because of **two critical bugs**:

### Bug 1: Inverted Side Selection Logic (Line 345)

**Current Code:**
```typescript
// If no strong floor for OVER, check if UNDER is safer
// High ceiling (max is 30%+ above line) + weak floor = favor UNDER
if (!hasStrongFloor && underCeiling > 1.3) {
  return 'under';
}
```

**Why It's Wrong:**
- `underCeiling > 1.3` means L10 Max is 30%+ ABOVE the line
- This is the WORST condition for an UNDER bet!
- Example: Miles Bridges L10 Max = 8, Line = 3.5 → underCeiling = 2.3
- The code says "if ceiling is really high, pick UNDER" - completely backwards!

**The Fix:**
```typescript
// Only favor UNDER if the ceiling is close to or below the line
// High ceiling = risky for UNDER, so we need the OPPOSITE logic
if (underCeiling <= 1.1) {
  return 'under'; // L10 Max is within 10% of line - safe UNDER
}
```

---

### Bug 2: No Ceiling Protection Filter for UNDERs

The code has these filters for OVERs (lines 481-488):
```typescript
// Skip high variance OVER picks
if (optimalSide === 'over' && coeffOfVariation > 0.4) continue;

// Require minimum edge for OVERs
if (optimalSide === 'over' && edge < line * 0.10) continue;
```

But **NO equivalent protection for UNDERs!** We need:
```typescript
// NEW: Skip UNDER picks where ceiling is too high (L10 Max > line * 1.5)
if (optimalSide === 'under' && l10Stats.max > line * 1.5) {
  continue; // Too risky - player has exceeded line by 50%+ in L10
}

// NEW: Require minimum ceiling protection for UNDERs
const ceilingProtection = line / l10Stats.max;
if (optimalSide === 'under' && ceilingProtection < 0.7) {
  continue; // Ceiling protection too weak - L10 Max is 43%+ above line
}
```

---

## Example Analysis from Screenshot

| Player | Line | L10 Max | Ceiling Protection | Current Decision | Should Be |
|--------|------|---------|-------------------|------------------|-----------|
| Harrison Barnes | 1.5 | 3 | 50% | UNDER ❌ | SKIP |
| Miles Bridges | 3.5 | 8 | 44% | UNDER ❌ | SKIP |

Both would be filtered out with ceiling protection < 70% rule.

---

## Implementation Summary

### File: `src/hooks/useDeepSweetSpots.ts`

**Change 1: Fix `determineOptimalSide()` (Lines 343-347)**
- Remove the inverted ceiling logic
- Only recommend UNDER when L10 Max is reasonably close to the line

**Change 2: Add UNDER ceiling filters (After Line 488)**
- Skip UNDERs where L10 Max exceeds line by more than 50%
- Skip UNDERs where ceiling protection is below 70%

---

## Technical Details

### Updated `determineOptimalSide()`:

```typescript
function determineOptimalSide(l10Stats: L10Stats, line: number): PickSide {
  const overHitRate = l10Stats.gamesPlayed > 0 
    ? l10Stats.hitCount / l10Stats.gamesPlayed 
    : 0;
  const underHitRate = 1 - overHitRate;
  
  const overFloor = line > 0 ? l10Stats.min / line : 0;
  const hasStrongFloor = overFloor >= 0.5;
  
  // If L10 min covers the line, strongly favor over
  if (overFloor >= 1.0) return 'over';
  
  // If L10 max is below line, strongly favor under
  if (l10Stats.max < line) return 'under';
  
  // NEW: Check if ceiling is safe for UNDER (max within 30% of line)
  const ceilingRatio = line > 0 ? l10Stats.max / line : Infinity;
  const hasSafeCeiling = ceilingRatio <= 1.3;
  
  // Favor UNDER only if ceiling is safe
  if (hasSafeCeiling && underHitRate >= 0.7) {
    return 'under';
  }
  
  // Favor OVER if has strong floor
  if (hasStrongFloor) {
    return 'over';
  }
  
  // Default to side with better hit rate
  return overHitRate >= underHitRate ? 'over' : 'under';
}
```

### New UNDER Ceiling Filters:

```typescript
// After line 488 (after OVER filters)

// NEW: Skip UNDER picks where L10 Max far exceeds the line
if (optimalSide === 'under') {
  const ceilingProtection = line / l10Stats.max;
  
  // Skip if L10 Max is more than 50% above the line
  if (l10Stats.max > line * 1.5) {
    continue; // Player's ceiling is way too high for UNDER
  }
  
  // Skip if ceiling protection is below 70%
  if (ceilingProtection < 0.70) {
    continue; // Too risky - not enough ceiling protection
  }
}
```

---

## Expected Impact

| Metric | Before | After (Expected) |
|--------|--------|------------------|
| UNDER hit rate | ~60% | 70%+ |
| Bad UNDER picks per day | 20-30 | 5-10 |
| Filtered out (high ceiling) | 0 | 10-20 |

The 70% ceiling protection threshold means we only recommend UNDER when:
- L10 Max ≤ 1.43x the line (e.g., Max 5 on a 3.5 line)

This would have filtered out both Harrison Barnes (Max 2x line) and Miles Bridges (Max 2.3x line).
