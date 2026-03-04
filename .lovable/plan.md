

## Problem: Old Parlays Polluting Telegram + Dedup Not Deploying

### What's Happening

1. **148 total records for today** — 121 voided + 27 pending. Clean & Rebuild correctly voids old parlays before regenerating, but the voided records stay in the database.

2. **Telegram "120 parlays" message** — The `bot-generate-daily-parlays` function sends a `parlays_generated` Telegram notification after each run reporting how many it created. Across 3 quality regen attempts, it reports the cumulative count. Customers see this as "120 parlays created" even though most are voided.

3. **Quality regen dedup NOT executing** — Zero records have `quality_regen_kept_attempt_X` or `quality_regen_dedup_identical` as `lesson_learned`. The deployed version of `bot-quality-regen-loop` doesn't have the latest dedup code — it's still running the old version. This means the 3 identical copies of `role_stacked_5leg`, `role_stacked_8leg`, and `shootout_stack` are never cleaned up.

### Fixes

**Fix 1: Suppress parlay count Telegram messages during regen loop**
In `bot-generate-daily-parlays`, when called with a `source` parameter (from quality regen), skip sending the `parlays_generated` Telegram notification. This prevents customers from seeing "120 parlays created" messages during internal regeneration cycles.

**Fix 2: Add a final Telegram summary after Clean & Rebuild completes**
In `SlateRefreshControls.tsx`, after all steps complete, invoke `bot-slate-status-update` (already exists) to send customers a clean summary of only the ACTIVE parlays — not the voided ones.

**Fix 3: Redeploy quality regen with working dedup**
The dedup code in `bot-quality-regen-loop` exists in the codebase but isn't deployed. Force a redeploy by adding a version comment to trigger the deploy pipeline.

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Skip `parlays_generated` Telegram notification when `source` param starts with `quality_regen` |
| `src/components/market/SlateRefreshControls.tsx` | Add `bot-slate-status-update` as the final step after diversity rebalance |
| `supabase/functions/bot-quality-regen-loop/index.ts` | Add version marker comment to force redeploy; ensure dedup runs after all attempts |

