
# Fix Sweet Spots Over/Under Selection Logic

## Problem Summary

The Sweet Spots system is selecting OVER/UNDER plays with **51.8% actual hit rate** for OVERS (basically coin flip) despite showing 80-90%+ L10 hit rates. The data shows:

| L10 Hit Rate Bucket | Actual Hit Rate | Total Picks |
|---------------------|-----------------|-------------|
| 90%+ | 50.8% | 323 |
| 80-89% | 47.9% | 142 |
| 70-79% | 58.6% | 128 |

This proves the L10 hit rate calculation is **not predictive** of actual outcomes.

---

## Root Causes Identified

### 1. Books Already Price In L10 Performance

When a player's L10 average is 5.0 threes, the book sets the line at 4.5 (not 2.5). The system sees "80% L10 hit rate vs 2.5 line" but the **actual betting line is 4.5**, making the edge much smaller.

### 2. No Floor Protection Enforcement for OVERs

Current logic recommends OVER plays with `l10_min = 0`, meaning the player has hit 0 in the L10. This provides zero floor protection. Example from database:
- Tyrese Maxey OVER 29.5: L10 min = 6, L10 max = 40 → player can hit 6 or 40 points

### 3. determineOptimalSide() Has Weak UNDER Detection

The current logic at line 326 defaults to OVER when hit rates are equal:
```typescript
return overHitRate >= underHitRate ? 'over' : 'under';
```

This biases toward OVERs even when UNDERs would be safer.

### 4. Quality Tier Classification Ignores Variance

A player with L10 values [5, 5, 5, 5, 5, 25, 25, 25, 25, 25] has high variance but could still qualify as "ELITE" if the calculated metrics align.

---

## Solution: Tightened Selection Criteria

### File: `src/hooks/useDeepSweetSpots.ts`

#### Change 1: Enforce Strict Floor Protection for OVERs

Only recommend OVER if `L10 min > line * 0.5` (player's worst game was at least 50% of the line):

```typescript
// In determineOptimalSide() - Line 308-328
function determineOptimalSide(l10Stats: L10Stats, line: number): PickSide {
  const overHitRate = l10Stats.gamesPlayed > 0 
    ? l10Stats.hitCount / l10Stats.gamesPlayed 
    : 0;
  
  // NEW: Calculate TRUE under hit rate (games where value < line)
  // The current method assumes OVER hits + UNDER hits = total games, which is true for .5 lines
  // but we should be explicit
  const underHitRate = 1 - overHitRate;
  
  // Check floor protection for over
  const overFloor = l10Stats.min / line;
  const underCeiling = l10Stats.max / line;
  
  // NEW: Strong floor = L10 min covers at least 50% of line
  const hasStrongFloor = overFloor >= 0.5;
  
  // If L10 min covers the line, strongly favor over
  if (overFloor >= 1.0) return 'over';
  
  // If L10 max is below line, favor under
  if (l10Stats.max < line) return 'under';
  
  // NEW: If no strong floor for OVER, check if UNDER is safer
  if (!hasStrongFloor && underCeiling > 1.3) {
    // High ceiling (max is 30%+ above line) + weak floor = favor UNDER
    return 'under';
  }
  
  // Otherwise, pick side with better hit rate (bias toward UNDER on ties)
  return overHitRate > underHitRate ? 'over' : 'under';
}
```

#### Change 2: Add Variance Filter

Skip picks with high coefficient of variation (stdDev / avg > 0.4):

```typescript
// After line 441 (after L10 stats calculation)
const l10StdDev = Math.sqrt(
  l10Stats.gamesPlayed > 0 
    ? l10StatsValues.reduce((sum, v) => sum + Math.pow(v - l10Stats.avg, 2), 0) / l10Stats.gamesPlayed
    : 0
);
const coefficientOfVariation = l10Stats.avg > 0 ? l10StdDev / l10Stats.avg : 1;

// Skip high variance picks for OVERs
if (optimalSide === 'over' && coefficientOfVariation > 0.4) {
  continue; // Too risky - player is inconsistent
}
```

#### Change 3: Require Minimum Edge for OVERs

Only recommend OVER if L10 avg exceeds line by at least 10%:

```typescript
// After edge calculation (line 446)
if (optimalSide === 'over' && edge < line * 0.10) {
  continue; // Edge too small - books have priced this in
}
```

#### Change 4: Tighten Quality Tier Requirements

Update `classifyQualityTier()` to require stronger metrics:

```typescript
function classifyQualityTier(
  floorProtection: number,
  hitRateL10: number,
  edge: number,
  side: PickSide  // NEW: Add side parameter
): QualityTier {
  // ELITE for OVER: L10 min >= line AND 100% hit rate
  // ELITE for UNDER: L10 max < line AND 100% hit rate
  if (floorProtection >= 1.0 && hitRateL10 >= 1.0) {
    return 'ELITE';
  }
  
  // PREMIUM: 90%+ hit rate with strong edge (20%+ of line)
  if (hitRateL10 >= 0.9 && edge >= (side === 'over' ? 0.15 : 0.10)) {
    return 'PREMIUM';
  }
  
  // STRONG: 80-89% hit rate with positive edge
  if (hitRateL10 >= 0.8 && edge > 0) {
    return 'STRONG';
  }
  
  // STANDARD: 70-79% hit rate with floor protection >= 0.7
  if (hitRateL10 >= 0.7 && floorProtection >= 0.7) {
    return 'STANDARD';
  }
  
  return 'AVOID';
}
```

---

## Expected Impact

| Metric | Before | After (Expected) |
|--------|--------|------------------|
| OVER actual hit rate | 51.8% | 65%+ |
| UNDER actual hit rate | 60.4% | 65%+ |
| Total picks per day | ~80-100 | ~30-50 |
| ELITE picks per day | ~20 | ~5-10 (truly elite) |

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useDeepSweetSpots.ts` | Update `determineOptimalSide()`, add variance filter, add edge filter, update `classifyQualityTier()` |

---

## Implementation Steps

1. Add variance calculation after L10 stats
2. Update `determineOptimalSide()` with stronger floor/ceiling logic
3. Add minimum edge filter for OVERs (10% of line)
4. Add variance filter for OVERs (CV < 0.4)
5. Update quality tier requirements to include edge thresholds
6. Add `side` parameter to `classifyQualityTier()`

