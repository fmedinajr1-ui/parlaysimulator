

# Strategy Optimization: Flip Underperforming OVER Categories to UNDER

## Analysis Summary

Based on the January 2026 performance data, I've identified categories that should be flipped from OVER to UNDER recommendations:

### Category Performance (Jan 2026)

| Category | Current Side | Hit Rate | Record | Action |
|----------|--------------|----------|--------|--------|
| HIGH_ASSIST | OVER | 21.1% | 4-15 | Already flipped to UNDER |
| LOW_LINE_REBOUNDER | OVER | 41.7% | 5-7 | **FLIP TO UNDER** |
| BIG_REBOUNDER | OVER | 51.4% | 18-17 | Keep as-is (breakeven) |
| BIG_ASSIST_OVER | OVER | 70.0% | 14-6 | Keep (performing well) |
| THREE_POINT_SHOOTER | OVER | 69.4% | 34-15 | Keep (performing well) |

### Tonight's Active LOW_LINE_REBOUNDER Picks (3 players)

| Player | Current Pick | L10 Avg | L10 Hit Rate | Proposed Pick |
|--------|--------------|---------|--------------|---------------|
| Sam Hauser | O 3.5 REB | 5.3 | 90% | **U 3.5 REB** |
| Matas Buzelis | O 3.5 REB | 5.2 | 80% | **U 3.5 REB** |
| Jaden McDaniels | O 3.5 REB | 4.8 | 70% | **U 3.5 REB** |

---

## Implementation Plan

### Step 1: Database - Flip Tonight's LOW_LINE_REBOUNDER Picks

Update the 3 active picks from OVER to UNDER:

```sql
UPDATE category_sweet_spots
SET 
  recommended_side = 'under',
  category = 'LOW_LINE_REBOUNDER_UNDER'
WHERE category = 'LOW_LINE_REBOUNDER'
AND analysis_date = '2026-01-28'
AND outcome = 'pending'
AND is_active = true;
```

### Step 2: Edge Function - Add New UNDER Categories

Modify `supabase/functions/category-props-analyzer/index.ts` to add two new permanent UNDER categories:

```text
+---------------------------+      +---------------------------+
|   HIGH_ASSIST_UNDER       |      |  LOW_LINE_REBOUNDER_UNDER |
+---------------------------+      +---------------------------+
| propType: assists         |      | propType: rebounds        |
| avgRange: 4-15            |      | avgRange: 4-6             |
| lines: 3.5-9.5            |      | lines: 3.5-5.5            |
| side: UNDER               |      | side: UNDER               |
| minHitRate: 0.70          |      | minHitRate: 0.70          |
+---------------------------+      +---------------------------+
```

### Step 3: UI Updates (Optional)

Add new category tabs to `CategoryPropsCard.tsx` to display UNDER categories:
- Add `HIGH_ASSIST_UNDER` and `LOW_LINE_REBOUNDER_UNDER` to `CATEGORY_CONFIG`

---

## Technical Details

### Edge Function Changes

**File**: `supabase/functions/category-props-analyzer/index.ts`

Add to `CATEGORIES` constant (around line 293):

```typescript
HIGH_ASSIST_UNDER: {
  name: 'Assist Under',
  propType: 'assists',
  avgRange: { min: 4, max: 15 },
  lines: [3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5],
  side: 'under',
  minHitRate: 0.7
},
LOW_LINE_REBOUNDER_UNDER: {
  name: 'Low Line Reb Under',
  propType: 'rebounds',
  avgRange: { min: 4, max: 6 },
  lines: [3.5, 4.5, 5.5],
  side: 'under',
  minHitRate: 0.7
},
```

### Database Updates

1. **Flip LOW_LINE_REBOUNDER picks** for tonight (3 players)
2. **Deploy updated edge function** so future refreshes generate UNDER picks

---

## Expected Outcomes

| Category | Before (OVER) | After (UNDER) | Projected Improvement |
|----------|---------------|---------------|----------------------|
| HIGH_ASSIST | 21.1% | ~78.9% | +57.8 pts |
| LOW_LINE_REBOUNDER | 41.7% | ~58.3% | +16.6 pts |

**Total Impact**: Converting 2 underperforming OVER categories to UNDER should significantly improve overall system accuracy.

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/category-props-analyzer/index.ts` | Add HIGH_ASSIST_UNDER and LOW_LINE_REBOUNDER_UNDER categories |
| Database | Flip 3 LOW_LINE_REBOUNDER picks to UNDER |

