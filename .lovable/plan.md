
# Fix: 2-Leg Mini-Parlay Fallback Loop Bypasses block_two_leg_parlays

## What Happened During Verification

The trigger + verify run confirmed the hot-streak system is working correctly:
- 3 hot-streak categories detected and boosted (+15 composite on 19 picks)
- 4 execution-tier parlays generated, ALL 3-leg, ALL using hot_streak_lock strategy
- BIG_REBOUNDER (Amen Thompson rebounds under) appears in 3 of 4 execution parlays at composite score 95

However, the 2-leg block is still leaking. 9 two-leg parlays were inserted during the 14:39 UTC run — after the deployed fix. This confirms the fix at line 4747 is targeting the wrong location.

## Root Cause: Two Separate Code Paths

The current fix (line 4747) filters profiles from `TIER_CONFIG.exploration.profiles`. But mini-parlays are NOT generated from `TIER_CONFIG` profiles at all.

There is a completely separate fallback loop at **line 5121**:

```
// === 2-LEG MINI-PARLAY HYBRID FALLBACK ===
if (allParlays.length < 6) {
  // ... builds mini-parlay candidate pool ...
  // ... generates ALL 2-leg combinations ...
  // ... pushes directly to allParlays ...
  // NO check for block_two_leg_parlays anywhere in this block
}
```

This loop fires when `allParlays.length < 6`. Today only 4 execution parlays were generated, so `4 < 6` = true, and the loop runs regardless of the `block_two_leg_parlays` flag. The inserted parlays have strategy names like `premium_boost_exploration_mini_parlay` which is built at line 5376 from `${strategyName}_${tier}_mini_parlay`.

The fix at line 4747 filtered exploration tier profile entries — but this fallback loop doesn't use profile entries at all. It is a standalone imperative loop that runs after all tier generation completes.

## The Fix: 1 Line Change at Line 5121

Wrap the entire mini-parlay fallback block with a guard:

**Before (line 5121):**
```ts
if (allParlays.length < 6) {
```

**After:**
```ts
if (allParlays.length < 6 && !stakeConfig?.block_two_leg_parlays) {
```

This is the correct, complete fix. One condition added to the existing if-statement that gates the entire 2-leg generation path. When `block_two_leg_parlays = true`, the loop is skipped entirely and no 2-leg parlays are created from any path.

## Why the Threshold Is 6 (and Why It Triggers Today)

The fallback fires when fewer than 6 parlays total have been generated. Today's run produced 4 execution parlays, which triggered the fallback. With `block_two_leg_parlays = true`, the system should instead accept that 4 high-quality 3-leg parlays at $500 stake is the correct output — not pad the count with 9 lower-quality 2-leg parlays.

## Files Changed

| File | Change | Line |
|---|---|---|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Add `&& !stakeConfig?.block_two_leg_parlays` to the mini-parlay fallback if-condition | 5121 |

No migrations. No new functions. No schema changes. Single-condition addition.

## Verification Plan After Fix

After deploying:
1. Delete today's 9 two-leg parlays from `bot_daily_parlays` for Feb 19
2. Re-trigger `bot-review-and-optimize` for Feb 19
3. Confirm `SELECT COUNT(*) FROM bot_daily_parlays WHERE parlay_date = '2026-02-19' AND leg_count = 2` returns 0
4. Confirm execution parlays still contain BIG_REBOUNDER picks

## LOW_LINE_REBOUNDER Note

The second hot-streak category (LOW_LINE_REBOUNDER under, +7 streak) did not appear in today's parlays. This is expected — it means the NBA prop pool for Feb 19 did not have any picks classified as LOW_LINE_REBOUNDER in the odds scraper data. The hot-streak boost is correctly configured; it simply has no picks to boost in today's slate. Tomorrow's cron run will pick up whatever players are available on that day's NBA slate.
