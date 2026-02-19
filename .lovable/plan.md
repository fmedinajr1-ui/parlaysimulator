
# Trigger + Verify: Hot-Streak 3-Leg Generation for Feb 19

## Current State

The code changes are confirmed deployed and correct in `bot-generate-daily-parlays/index.ts`:
- Hot-streak lock profiles added at lines 223-228
- +15 composite boost logic at lines 3302-3326
- 2-leg exploration/mini-parlay fix at lines 4746-4752

**But the function has not been run today.** Zero parlays exist for Feb 19. The Feb 18 parlays still show 2-leg `mini_parlay` entries because the fix was deployed after yesterday's 10:00 UTC cron ran.

The live hot-streak data in `bot_category_weights` right now:
- `BIG_REBOUNDER` under — 100% hit rate, +9 streak
- `LOW_LINE_REBOUNDER` under — 100% hit rate, +7 streak
- `VOLUME_SCORER` under — 100% hit rate, +3 streak
- `MID_SCORER_UNDER` — only 38.9% hit rate despite +24 streak (will NOT get boost — below 65% threshold)

All three qualifying categories will trigger the hot-streak boost. The two NBA-specific `hot_streak_lock` profiles are designed to pull exactly these picks together.

---

## What This Plan Does

### Step 1 — Trigger `bot-generate-daily-parlays` via `bot-review-and-optimize`

Rather than calling the generator directly (which skips the review/optimization layer), trigger it through `bot-review-and-optimize` with `source: 'pipeline'` and `target_date: '2026-02-19'`. This mirrors exactly how the 10:00 UTC cron calls it — giving a true pre-flight test.

The call will be made via `supabase.functions.invoke('bot-review-and-optimize', { body: { source: 'pipeline' } })` from a new minimal edge function trigger, or directly via `curl_edge_functions`.

### Step 2 — Verify via Database Query

After the function completes (~60-90 seconds), run these verification checks:

**Check A — Execution tier parlays exist today:**
```sql
SELECT tier, strategy_name, leg_count, legs 
FROM bot_daily_parlays 
WHERE parlay_date = '2026-02-19' AND tier = 'execution'
```
Expected: At least 2 rows with `strategy_name LIKE '%hot_streak_lock%'` and `leg_count = 3`

**Check B — Hot-streak categories appear in the legs JSONB:**
```sql
SELECT legs FROM bot_daily_parlays 
WHERE parlay_date = '2026-02-19' AND tier = 'execution'
```
We look inside `legs` JSONB for `category` values matching `BIG_REBOUNDER` or `LOW_LINE_REBOUNDER` — confirming they were boosted to the top of the pool and pulled into the same parlay.

**Check C — Zero 2-leg parlays:**
```sql
SELECT COUNT(*) FROM bot_daily_parlays 
WHERE parlay_date = '2026-02-19' AND leg_count = 2
```
Expected: 0 (confirming the block fix is working across all tiers)

**Check D — Edge function logs confirm hot-streak boost:**
```
[HotStreak] 3 hot-streak categories active (streak >= 3, hit rate >= 65%)
[HotStreak] +15 composite boost applied to N picks from hot-streak categories
[Bot v2] 2-leg parlays BLOCKED from all tiers including exploration mini-parlay and whale_signal paths
```

### Step 3 — Read Logs + Surface Results

After calling the function, read the logs from `bot-generate-daily-parlays` and `bot-review-and-optimize` to confirm:
1. Hot-streak boost fired (look for `[HotStreak]` log lines)
2. Stake config loaded correctly (`exec=$500, val=$200, expl=$75`)
3. 2-leg block confirmation log line present
4. Summary shows `execution: N parlays generated`

---

## Files Changed

None. This is a **run-and-verify** operation only — no code changes. The function is already deployed with all three fixes. We just need to fire it and read the output.

---

## Expected Output

If everything works:
- **3–4 execution-tier 3-leg parlays** for Feb 19, at least 2 containing `BIG_REBOUNDER under` + `LOW_LINE_REBOUNDER under` together
- **Zero 2-leg parlays** across all tiers
- **+15 composite boost** visible in logs for 3+ picks
- **$500/$200/$75 stakes** confirmed in the load log
- Total: ~15–20 parlays for the day across all tiers

If the hot-streak lock profiles don't find enough picks (e.g., NBA slate is too small), they gracefully fall back to the next profiles in the execution tier — this is expected behavior and not a failure.
