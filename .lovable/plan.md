
# Fix: Stop Recommending UNDER on Star/Starter Players

## Problem Summary
The system is recommending UNDER bets on starter-level players who have high projected minutes and significant scoring upside. This is fundamentally flawed because:

1. **MID_SCORER_UNDER has a 45% hit rate** - It's a losing category
2. **No archetype protection** - Players like Jusuf Nurkic (15 ppg), Miles Bridges (14.6 ppg), and RJ Barrett (14.5 ppg) are being included
3. **These players are starters** with 28+ minutes who can explode any given night

---

## Current Data Evidence

| Player | Line | L10 Avg | L10 Max | Category | Hit Rate Issue |
|--------|------|---------|---------|----------|----------------|
| Jusuf Nurkic | 20.5 | 15.3 | 20 | MID_SCORER_UNDER | Could drop 20+ easily |
| Miles Bridges | 20.5 | 14.6 | 20 | MID_SCORER_UNDER | Already hit 20 once in L10 |
| RJ Barrett | 19.5 | 14.5 | 21 | MID_SCORER_UNDER | L10 Max EXCEEDS line |

### Historical Performance by Points Category

| Category | Hit Rate | Recommendation |
|----------|----------|----------------|
| LOW_SCORER_UNDER | 65.4% | KEEP |
| VOLUME_SCORER | 51.8% | KEEP |
| STAR_FLOOR_OVER | 45.1% | REVIEW |
| MID_SCORER_UNDER | 45.0% | REMOVE/BLOCK |

---

## Solution Plan

### 1. Disable MID_SCORER_UNDER Category

Remove this losing category from the active analyzer until it can be redesigned with proper filters.

**File**: `supabase/functions/category-props-analyzer/index.ts`

```text
MID_SCORER_UNDER: {
  name: 'Mid Scorer Under',
  propType: 'points',
  avgRange: { min: 12, max: 22 },
  lines: [14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5],
  side: 'under',
  minHitRate: 0.55,
  // ADD: Block all starters and high-minute players
  disabled: true,  // <- NEW: Disable until redesigned
}
```

### 2. Add Minutes-Based Filter for All UNDER Categories

Block any UNDER recommendation for players averaging 28+ minutes (starter threshold).

**File**: `supabase/functions/category-props-analyzer/index.ts`

Add logic in the processing loop:
```typescript
// Block starters from ALL points UNDER categories
if (config.propType === 'points' && config.side === 'under') {
  const avgMinutes = playerStats?.avg_minutes ?? 30;
  if (avgMinutes >= 28) {
    console.log(`[Category Analyzer] Starter blocked from UNDER: ${playerName} (${avgMinutes} min avg)`);
    continue;
  }
}
```

### 3. Strengthen determineOptimalSide in useDeepSweetSpots.ts

Add production rate check to prevent UNDER on high-usage scorers.

**File**: `src/hooks/useDeepSweetSpots.ts`

```typescript
function determineOptimalSide(l10Stats: L10Stats, line: number, production: ProductionMetrics): PickSide {
  // NEW: Block UNDER if player produces at high rate (starter-level)
  if (production.avgMinutes >= 28 && production.statPerMinute >= 0.45) {
    return 'over'; // Force OVER for high-minute scorers
  }
  
  // ... existing logic
}
```

### 4. Add Archetype Restrictions to NON_SCORING_SHOOTER

Currently this category has no restrictions and could include scorers.

**File**: `supabase/functions/category-props-analyzer/index.ts`

```typescript
NON_SCORING_SHOOTER: {
  name: 'Non-Scoring Shooter',
  propType: 'points',
  avgRange: { min: 8, max: 14 },
  lines: [10.5, 11.5, 12.5, 13.5, 14.5],
  side: 'under',
  minHitRate: 0.7,
  // ADD: Block star scorers and combo guards
  blockedArchetypes: ['PURE_SHOOTER', 'COMBO_GUARD', 'SCORING_GUARD', 'PLAYMAKER']
}
```

---

## Technical Details

### Files to Modify

1. **`supabase/functions/category-props-analyzer/index.ts`**
   - Add `disabled: true` to MID_SCORER_UNDER
   - Add archetype restrictions to NON_SCORING_SHOOTER
   - Add minutes-based filter for all points UNDER categories

2. **`src/hooks/useDeepSweetSpots.ts`**
   - Update `determineOptimalSide` to check production metrics
   - Block UNDER for players with 28+ avg minutes and high stat rate

3. **`src/components/market/SweetSpotPicksCard.tsx`**
   - Filter out MID_SCORER_UNDER from the display

### Validation Logic

```text
For any points UNDER pick:
1. Must be LOW_SCORER_UNDER category (5-12 ppg players)
2. Must average < 28 minutes (not a starter)
3. Must NOT have star/scorer archetype
4. L10 Max must be < 1.3x the line (existing ceiling protection)
```

---

## Expected Outcome

- Remove all starter-level UNDER recommendations
- Focus points UNDER only on true role players (12 ppg, 20 min)
- Expected hit rate improvement: 45% -> 60%+ (matching LOW_SCORER_UNDER)
- Clearer picks that align with common sense (don't bet UNDER on starters)
