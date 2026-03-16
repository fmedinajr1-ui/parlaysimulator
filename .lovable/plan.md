

# Root Cause: Two Bugs Blocking Parlay Generation

## Bug 1: `scraped_at` column doesn't exist on `unified_props`

In `bot-generate-daily-parlays/index.ts` line 3666, the Source 3 cross-ref queries:
```
.gte('scraped_at', new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
```
But `unified_props` has no `scraped_at` column — it's `created_at`. The query silently fails (returns null/empty), so **zero teams are added from Source 3**. The stale `upcoming_games_cache` (last updated January 9th) and NHL-only `game_bets` remain the only sources, causing the GameSchedule filter to remove 172 of 233 NBA players.

**Result**: Pool stays at 61 picks instead of ~230+.

**Fix**: Change `scraped_at` to `created_at` on line 3666.

## Bug 2: `requires_bounce_back_check` column missing from `category_sweet_spots`

In `category-props-analyzer/index.ts` line 1428, the analyzer tries to insert `requires_bounce_back_check: config.supportsBounceBack || false` into `category_sweet_spots`, but that column doesn't exist in the table schema. This causes batch insert errors, losing **335 of 735 sweet spots** (only 400 saved today).

**Result**: Fewer sweet spots → fewer enriched picks entering the pool.

**Fix**: Either add the column via migration, or remove it from the insert object in the analyzer.

## Plan

### Change 1 — Fix `scraped_at` → `created_at` (bot-generate-daily-parlays)
- File: `supabase/functions/bot-generate-daily-parlays/index.ts`, line 3666
- Change `.gte('scraped_at', ...)` to `.gte('created_at', ...)`

### Change 2 — Add `requires_bounce_back_check` column (database migration)
- Add the missing boolean column with default `false` to `category_sweet_spots`
- This lets all 735 sweet spots save successfully

### Change 3 — Redeploy both functions
- `bot-generate-daily-parlays` — fix takes effect on next pipeline run
- `category-props-analyzer` — already has the code, just needs the column to exist

### Expected Impact
- Sweet spots: 400 → ~735 (all batches succeed)
- Team detection: Source 3 finds all 16 teams from today's 8 NBA games
- Pool: 61 → ~230+ picks (GameSchedule stops removing NBA players)
- Parlays: Assembly engine can build 3-5 leg parlays from 230+ candidates

