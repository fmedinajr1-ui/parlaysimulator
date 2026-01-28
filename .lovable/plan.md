
# Fix Incorrect Accuracy Grading

## Problem Summary

The outcome verification function uses `recommended_line` (always 0.5, a placeholder) instead of `actual_line` (the real betting line), causing massive misgrading of picks.

**Impact:**
- 59 OVER picks incorrectly marked as "hit" (actual score < line)
- 8 UNDER picks incorrectly marked as "hit" (actual score > line)
- True system accuracy is 15-30% lower than displayed

---

## Root Cause

File: `supabase/functions/verify-sweet-spot-outcomes/index.ts`

```typescript
// Line 225 - BUG
const line = pick.recommended_line || 0;  // Uses wrong column!
```

Should be:
```typescript
const line = pick.actual_line || pick.recommended_line || 0;
```

---

## Fix Plan

### Step 1: Fix the Verification Edge Function

Update `verify-sweet-spot-outcomes/index.ts`:
- Change line 127 to also select `actual_line`
- Change line 225 to prioritize `actual_line` over `recommended_line`

### Step 2: Create Re-Grading Script

Run a one-time database update to fix all existing incorrectly graded picks:

```sql
UPDATE category_sweet_spots
SET outcome = CASE 
  -- Push (exact match)
  WHEN actual_value = actual_line THEN 'push'
  -- Over picks
  WHEN recommended_side = 'over' AND actual_value > actual_line THEN 'hit'
  WHEN recommended_side = 'over' AND actual_value < actual_line THEN 'miss'
  -- Under picks
  WHEN recommended_side = 'under' AND actual_value < actual_line THEN 'hit'
  WHEN recommended_side = 'under' AND actual_value > actual_line THEN 'miss'
  ELSE outcome
END
WHERE outcome IN ('hit', 'miss', 'push')
AND actual_line IS NOT NULL
AND actual_value IS NOT NULL;
```

---

## Corrected Accuracy by Category

After fix, the true accuracy will be:

| Category | Corrected Hit Rate | Record |
|----------|-------------------|--------|
| BIG_ASSIST_OVER | **70.0%** | 14-6 |
| THREE_POINT_SHOOTER | **69.4%** | 34-15 |
| LOW_SCORER_UNDER | **68.0%** | 34-16 |
| ROLE_PLAYER_REB | **65.5%** | 36-19 |
| ASSIST_ANCHOR | **60.0%** | 6-4 |
| VOLUME_SCORER | **58.0%** | 29-21 |
| STAR_FLOOR_OVER | **57.1%** | 20-15 |
| BIG_REBOUNDER | **51.4%** | 18-17 |
| MID_SCORER_UNDER | **50.0%** | 6-6 |
| NON_SCORING_SHOOTER | **50.0%** | 3-3 |
| HIGH_REB_UNDER | **50.0%** | 1-1 |
| LOW_LINE_REBOUNDER | **41.7%** | 5-7 |
| ELITE_REB_OVER | **33.3%** | 1-2 |
| HIGH_ASSIST | **21.1%** | 4-15 |

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/verify-sweet-spot-outcomes/index.ts` | Fix line selection to use `actual_line` |
| Database migration | Re-grade all existing settled picks |

---

## Expected Outcome

After the fix:
1. All existing picks will be re-graded correctly
2. Future picks will use the proper `actual_line` for verification
3. Dashboard will show true accuracy (not inflated)
4. Categories with low real accuracy (HIGH_ASSIST, LOW_LINE_REBOUNDER) can be deprioritized or removed from parlay recommendations
