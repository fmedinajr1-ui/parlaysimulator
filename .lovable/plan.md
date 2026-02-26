

## Lower Quality Regen Target to 38%

### Problem
The deployed quality regen loop uses a 45% target, but the average `combined_probability` for generated parlays naturally lands around 39-40%. All 3 attempts scored 39.7-39.9%, wasting cycles without ever meeting the target. Parlays ARE kept (the void fix works), but the loop burns all 3 attempts unnecessarily.

### Change

**File: `supabase/functions/bot-quality-regen-loop/index.ts`**

- Change the default `targetHitRate` from 45 to **38**
- This means attempt 1 will likely meet the target immediately, saving 2 unnecessary generation cycles
- The target is still meaningful -- it filters out batches with abnormally low probability

**File: `src/components/market/SlateRefreshControls.tsx`**

- Update the `target_hit_rate` parameter passed to the quality regen step from 45 to **38**

### Expected Result
- Quality regen meets target on attempt 1, saving ~60 seconds of pipeline time
- No behavior change for parlay quality (same generation logic)
- Logs will show `targetMet: true` instead of `false`

