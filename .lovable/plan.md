

# Fix Zero-Game False Positive + Shift Generation to Pre-Tip

## Root Cause (Found It)

The pipeline keeps reporting "zero game day" despite 8 NBA games existing because of a **two-layer data gap**:

1. **`game_bets` table is empty** — The Odds API is returning 401/422 errors on player prop endpoints, so `whale-odds-scraper` collects 0 team bets. The last `game_bets` data is from March 15.
2. **Zero-game check only looks at `game_bets`** — Line 9948 counts `sportCount` from `game_bets.commence_time`. Since the table is empty → `sportCount = 0` → immediate `zero_game_day` exit.
3. **Meanwhile, 1,783 NBA props exist in `unified_props`** and 742 sweet spots exist — the data IS there, just not in `game_bets`.

The scraper's `full` mode ran at 12 PM ET today and used 158 API calls but got **0 props and 0 team bets** because every prop batch returned 401/422. The team market endpoints also returned nothing. So `game_bets` never got populated for today.

## Changes

### 1. Fix zero-game detection to use `unified_props` as fallback
**File**: `supabase/functions/bot-generate-daily-parlays/index.ts` (~line 9940-9978)

Currently the zero-game check only queries `game_bets`. Add a secondary check against `unified_props` so that if `game_bets` is empty but live props exist, generation proceeds:

```
// Current (broken):
sportCount from game_bets → 0 → zero_game_day

// Fixed:
sportCount from game_bets → 0 → check unified_props count
  → 1,783 props found → proceed with generation
```

Also fix the `playerPropCount` query — it checks `category_sweet_spots.created_at` against the noon-to-noon ET window, but sweet spots were created at 11:01 AM ET (before noon cutoff). Change to use `analysis_date = targetDate` instead of `created_at` timestamp filtering.

### 2. Shift main generation to pre-tip (5:30 PM ET)
**Cron change**: Move `refresh-l10-and-rebuild` from `0 15 * * *` (10 AM ET) to `30 22 * * *` (5:30 PM ET).

Keep `morning-data-refresh` at 8 AM ET for data collection (game logs, odds). Add a new lightweight **morning prep** cron at 10 AM ET that runs only:
- `whale-odds-scraper` (full mode)
- `category-props-analyzer`
- `bot-matchup-defense-scanner`
- `bot-game-context-analyzer` (triggers slate advisory)

This gives customers the morning advisory but delays actual parlay generation until ~90 minutes before tip-off when lineups are confirmed.

### 3. Add `game_bets` staleness alert
In `bot-game-context-analyzer`, check if `game_bets` has 0 rows for today. If so, send an admin Telegram warning: "⚠️ game_bets feed is stale — API may be returning errors. Props still available via unified_props."

## Files to Change

| File | Change |
|------|--------|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Fix zero-game check to fallback to `unified_props`; fix `playerPropCount` to use `analysis_date` |
| `supabase/functions/bot-game-context-analyzer/index.ts` | Add `game_bets` staleness warning to admin |
| Cron SQL | Reschedule `refresh-l10-and-rebuild` to 5:30 PM ET; add 10 AM ET morning-prep cron |

