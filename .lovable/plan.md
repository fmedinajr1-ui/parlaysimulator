

# Verification Results: What's Working, What's Not

## Status Summary

| Feature | Status | Evidence |
|---------|--------|----------|
| Blanket void removed | **Partially working** | No "L10-fresh rebuild" voids TODAY, but 6 from yesterday still present |
| Swap-Not-Void (exposure cap) | **NOT WORKING** | `legs_swapped = 0` on ALL parlays. 6 voided today with `exposure_cap_quality_regen` — a label that doesn't exist in the current code |
| Pick pool logging | **NOT WORKING** | `bot_daily_pick_pool` table exists but has 0 rows |
| Deterministic side selection | **Code exists** | Present in `category-props-analyzer` but no `deterministic_side_flips` activity log entries today |
| FG efficiency gate | **Code exists** | Present in analyzer but no evidence it ran |
| Daily cap (15) / Exposure cap (1) | **Code exists** | Cap logic is correct in code but old deployed version ran instead |

## Root Cause

**The edge functions were not redeployed after the code changes.** The voided parlays show `exposure_cap_quality_regen` as the lesson_learned — this string does NOT exist anywhere in the current codebase. The new code uses `exposure_cap_no_swap_available`. This proves the old compiled version is still running on the edge.

Today's results: **3 pending, 13 voided** — 6 voided by the old exposure cap code (should have been swapped), 6 from yesterday's blanket void, 1 from old `exposure_cap_player_prop`.

## Fix Plan

### 1. Force-redeploy all 4 modified edge functions
The code is correct but stale deployments are running. Redeploy:
- `bot-quality-regen-loop` (swap-not-void logic)
- `bot-generate-daily-parlays` (pick pool logging)
- `category-props-analyzer` (deterministic side + FG efficiency)
- `bot-daily-diversity-rebalance` (swap logic)

### 2. Invoke category-props-analyzer to verify deterministic flips
After deployment, trigger `category-props-analyzer` with `{ forceRefresh: true }` and check logs for `DETERMINISTIC FLIP` entries.

### 3. Invoke bot-generate-daily-parlays to verify pick pool logging
After deployment, trigger generation and verify `bot_daily_pick_pool` gets populated.

### 4. Invoke bot-quality-regen-loop to verify swap behavior
After deployment, trigger the regen loop and check for `SWAPPED` log entries and `legs_swapped > 0` on parlays.

### 5. Fix stale label in daily cap void
Line 421 of `bot-quality-regen-loop` says `lesson_learned: 'daily_cap_25'` but the cap is now 15. Minor label fix.

## Files to Change
| File | Change |
|------|--------|
| `bot-quality-regen-loop/index.ts` | Fix `daily_cap_25` → `daily_cap_15` label |
| All 4 functions | Force redeploy |

