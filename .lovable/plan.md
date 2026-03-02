

# Cash Lock Flip Map: Keep Winners, Flip Losers

## Summary
Add a `CASH_LOCK_FLIP_MAP` that forces historically-losing categories to use the opposite side when building `cash_lock` parlays. Also block two globally-terrible categories (`VOLUME_SCORER`, `ROLE_PLAYER_REB`) from all strategies.

## Changes (single file)

**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

### 1. Add CASH_LOCK_FLIP_MAP constant (after line 967)

New constant mapping poison categories to their forced winning side:

```text
REBOUNDS       -> force 'under'  (was 0% as over)
THREES         -> force 'under'  (was 0% as over)
VOLUME_SCORER  -> force 'under'  (was 0% as over)
ROLE_PLAYER_REB-> force 'under'  (was 0% as over)
THREE_POINT_SHOOTER -> force 'under' (34.5% as over)
HIGH_ASSIST    -> force 'over'   (was 0% as under, 62.5% as over)
MID_SCORER_UNDER -> force 'over' (25% as under)
```

### 2. Block worst categories globally (lines 962-967)

Add `VOLUME_SCORER` and `ROLE_PLAYER_REB` to the `BLOCKED_CATEGORIES` set. These have 0% hit rates across ALL strategies.

### 3. Apply flip logic in canUsePickGlobally (lines 3014-3059)

When building a `cash_lock` parlay, after the blocked categories check:
- Look up the pick's category in `CASH_LOCK_FLIP_MAP`
- If the map specifies a forced side and the pick's `recommended_side` doesn't match, return `false` (skip the pick)
- This requires passing the current strategy name into `canUsePickGlobally`

Since `canUsePickGlobally` doesn't currently receive the strategy name, we'll add an optional `strategyName` parameter. The call site at line 6606 already has access to the profile's strategy name and will pass it through.

### 4. Re-generate parlays

After deploying, invoke `bot-generate-daily-parlays` with `source: "cash_lock_flip"` to generate fresh cash_lock parlays using the new flip logic.

## Expected Result
- Cash lock parlays only include legs on the historically-winning side for each category
- The "1 poison leg kills the parlay" pattern is eliminated
- `VOLUME_SCORER` and `ROLE_PLAYER_REB` blocked from ALL strategies globally
- Cash lock hit rate should improve significantly from 7.8%

