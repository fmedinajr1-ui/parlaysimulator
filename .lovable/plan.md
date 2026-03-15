

# Root Cause: Zero Parlays on March 15

## Diagnosis

This is **not an API issue**. All external APIs succeeded:
- ESPN: 631 game log records fetched, 0 API errors
- BDL: 300 records, 567/600 rate limit remaining
- The Odds API: 501 props in `unified_props` for today's 7 games

**Two bugs** are blocking every parlay engine:

### Bug 1: `category_sweet_spots` query missing date filter (PRIMARY BLOCKER)
The `sharp-parlay-builder`, `heat-prop-engine`, and `bot-generate-daily-parlays` all load category recommendations with:
```sql
SELECT ... FROM category_sweet_spots WHERE l10_hit_rate >= 0.7
```
This returns **22,430 rows** across all historical dates, but only 2,619 have `l3_avg` populated. The code builds an in-memory map keyed by `player_proptype` — so older records with NULL `l3_avg` **overwrite** today's valid records. Every player then fails the L3 gate and gets skipped.

**Fix:** Add `analysis_date = today` filter to `loadCategoryRecommendations()` in all 4 affected engines:
- `sharp-parlay-builder/index.ts` (line ~55)
- `heat-prop-engine/index.ts` (same pattern)
- `bot-curated-pipeline/index.ts` (line ~154)
- `bot-generate-daily-parlays/index.ts` (line ~4820 area)

### Bug 2: `game_bets` not populated for today's games
The `bot-curated-pipeline` queries `game_bets` for today's games but the latest entry is from `2026-03-15 02:40:00+00` (last night). Today's 7 games (MIN@OKC, DAL@CLE, IND@MIL, DET@TOR, POR@PHI, GSW@NYK, UTA@SAC) exist in `unified_props` but not in `game_bets`. The whale-odds-scraper either didn't run or didn't write to `game_bets`.

**Fix:** Re-run the whale-odds-scraper to populate `game_bets`, OR update `bot-curated-pipeline` to fall back to `unified_props` for game discovery.

## Implementation Plan

### Step 1: Fix L3 date filter in all 4 engines
Add `analysis_date = today` to the `category_sweet_spots` query in each function's `loadCategoryRecommendations()`. This reduces the result set from 22,430 to ~400 rows, all with valid L3 data.

### Step 2: Populate `game_bets` for today
Invoke the whale-odds-scraper to refresh `game_bets` with today's NBA games.

### Step 3: Re-run the parlay pipeline
Trigger a Clean & Rebuild to regenerate parlays with the fixed data.

### Step 4: Deploy all 4 updated edge functions

