

# Fix: nba-stats-fetcher Silently Returning 0 Records

## Root Cause

The `nba-stats-fetcher` has been running every 30 minutes on Feb 19 and reporting `status: "completed"` with **0 records** every time. Two compounding issues:

1. **Silent failure on empty results**: The function treats 0 ESPN records as a soft warning (`console.warn`) but still reports `status: "completed"`. Downstream systems (settlement, L5 history) see no data and mark legs as VOID or pending indefinitely.

2. **`daysBack=7` too narrow during schedule gaps**: The NBA All-Star break (roughly Feb 14-19) means no regular-season games for ~5 days. With the default 7-day lookback, the ESPN scoreboard loop finds 0 completed games. Even the BDL path returns 0 because it queries by season and there are no new games to surface.

The last successful fetch was Feb 18 at 20:00 UTC, which pulled 33 records (likely the All-Star Game or a single exhibition). Before that, regular game data stops at Feb 12 (70 records) and Feb 11 (300 records -- a full slate).

## Fix (3 changes to `supabase/functions/nba-stats-fetcher/index.ts`)

### Change 1: Add `fetchWithValidation` Wrapper

Add a validation wrapper around the ESPN scoreboard fetch that:
- Checks `response.ok`
- Logs the actual HTTP status and URL on failure (not just silently returns empty)
- Distinguishes "API is down" from "genuinely 0 games today"

### Change 2: Auto-Expand Lookback When 0 Games Found

After the initial ESPN fetch with `daysBack` returns 0 completed games, automatically retry with `daysBack * 2` (up to 14 days). This ensures that during All-Star break, off-days, or schedule gaps, the function still picks up recent pre-break games.

```text
Pass 1: daysBack=7  -> 0 completed games
Pass 2: daysBack=14 -> finds Feb 11-12 games (370 records)
```

### Change 3: Report Accurate Status

When both ESPN and BDL return 0 records after the expanded lookback:
- Set `status: "no_data"` instead of `"completed"` in `cron_job_history`
- Add a `warning` field: `"No NBA games found in last {daysBack} days -- possible schedule gap or API issue"`
- This makes it visible in monitoring and prevents confusion with successful runs

### Summary of Code Changes

**File**: `supabase/functions/nba-stats-fetcher/index.ts`

| Section | Change |
|---------|--------|
| Lines 209-347 (`fetchESPNGameLogs`) | Add retry with expanded `daysBack` when 0 completed games found on first pass |
| Lines 417-446 (ESPN fetch block) | Replace `console.warn` with proper error tracking; set `results.espnWarning` |
| Lines 628-638 (status reporting) | Use `"no_data"` status when `statsInserted === 0` and no errors |

No new files, no DB migrations, no new secrets needed.
