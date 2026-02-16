
# Fix: OVER_TOTAL Category Mismatch + Clean Up Feb 16 Data

## Root Cause

The weight-check logic looks up picks using their raw `category` field (e.g., `TOTAL`), but `bot_category_weights` stores sport-specific entries as `OVER_TOTAL` / `UNDER_TOTAL`. The lookup `TOTAL__over__basketball_ncaab` finds no match, falls through to the default weight of `1.0`, and the block/flip logic never triggers.

## Two-Part Fix

### Part 1: Delete bad existing data for Feb 16

Delete the 18 duplicate single picks from the second run (16:24) and the 4 OVER_TOTAL picks from the first run (16:23) that should have been blocked.

```text
-- Delete 18 duplicates from second run
DELETE FROM bot_daily_parlays 
WHERE parlay_date = '2026-02-16' AND leg_count = 1 
AND created_at >= '2026-02-16 16:24:00+00';

-- Delete remaining OVER total picks from first run
DELETE FROM bot_daily_parlays 
WHERE parlay_date = '2026-02-16' AND leg_count = 1
AND legs->0->>'side' = 'over'
AND (legs->0->>'prop_type' = 'total' OR legs->0->>'category' = 'TOTAL');
```

### Part 2: Fix category normalization in the weight lookup

In `supabase/functions/bot-generate-daily-parlays/index.ts`, add category normalization before the weight check so that a pick with `category: "TOTAL"` and `side: "over"` resolves to `OVER_TOTAL` for lookup purposes.

Around line 4605, before the weight lookup:

```text
// Normalize generic "TOTAL" category to side-specific variant
let pickCategory = pick.category || '';
if (pickCategory === 'TOTAL' || pickCategory === 'TEAM_TOTAL') {
  const prefix = pickSide === 'over' ? 'OVER' : 'UNDER';
  pickCategory = pickCategory === 'TOTAL' 
    ? `${prefix}_TOTAL` 
    : `${prefix}_TEAM_TOTAL`;
}
```

This ensures:
- `TOTAL` + `over` maps to `OVER_TOTAL` (blocked for NCAAB, weight=0)
- `TOTAL` + `under` maps to `UNDER_TOTAL` (active for NCAAB, weight=1.20)
- The existing flip logic then correctly converts blocked OVER to UNDER

### Expected Result After Fix

| Before | After |
|--------|-------|
| 36 single picks (18 dupes) | 18 single picks (no dupes) |
| 8 OVER_TOTAL NCAAB picks | 0 OVER_TOTAL NCAAB picks |
| Weight check bypassed for "TOTAL" category | Correctly maps to OVER_TOTAL / UNDER_TOTAL |

## Technical Details

| Aspect | Detail |
|--------|--------|
| File modified | `supabase/functions/bot-generate-daily-parlays/index.ts` |
| Lines affected | ~4605 (add normalization before weight lookup) |
| DB cleanup | Delete 22 bad rows from `bot_daily_parlays` |
| Risk | Low -- normalization only affects the lookup key, not stored data |
