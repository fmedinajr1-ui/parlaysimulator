

# Fix: Bot Settlement Pipeline Blocked by `is_active` Filter

## Problem Chain

The settle-and-learn cycle cannot complete because of a cascading dependency:

```text
Sweet Spots (is_active: false)
  --> Verifier skips them (requires is_active: true)
    --> No outcomes settled
      --> Bot settlement finds all legs "pending"
        --> All parlays stay pending forever
```

Evidence from the database:
- Feb 7: 300 sweet spots, ALL `is_active: false`, ALL `outcome: pending`
- Feb 8: 400 sweet spots, ALL `is_active: false`, ALL `outcome: pending`
- Feb 9: 300 sweet spots, ALL `is_active: false`, ALL `outcome: pending`
- Game logs exist through Feb 8 (447 records), so data IS available to grade

Only Feb 6 has any settled outcomes (27 hits, 32 misses) because those 66 picks happened to be `is_active: true`.

## Solution

### Fix 1: Remove `is_active` filter from `verify-sweet-spot-outcomes/index.ts`

Same fix we applied to the generator. The `analysis_date` and `outcome = 'pending'` filters are sufficient. The `is_active` flag was meant for manual activation of "elite picks" but it blocks the entire automated pipeline.

Change at line 130: Remove `.eq('is_active', true)` from the pending picks query.

### Fix 2: Also allow bot settlement to process today's parlays

Currently `bot-settle-and-learn` only looks at yesterday's date. But games finish throughout the day, so today's parlays for completed games should also be settleable. Add a parameter to allow settling today's date as well, or expand the query to include both today and yesterday.

Change at lines 110-113: Query for both yesterday AND today when settling, so parlays from earlier today (for games that have finished) can be processed.

### Fix 3: Trigger the full chain after deploying

1. Run `verify-sweet-spot-outcomes` for Feb 7 and Feb 8 (backfill)
2. Run `bot-settle-and-learn` to settle the Feb 6 parlays (which have some settled outcomes)
3. Verify the learning loop updates category weights

## Technical Changes

### File: `supabase/functions/verify-sweet-spot-outcomes/index.ts`
- Line 130: Remove `.eq('is_active', true)`

### File: `supabase/functions/bot-settle-and-learn/index.ts`
- Lines 110-122: Change date logic to query both yesterday and today, or accept a `targetDate` parameter from the request body
- This allows the settlement to process parlays for games that have already completed today

## Expected Outcome

After these fixes and a manual trigger:
- 700+ sweet spots from Feb 7-8 will be graded against existing game logs
- Bot parlays with settled legs will be marked won/lost
- Category weights will update based on real outcomes
- The learning loop will be fully functional for the first time
