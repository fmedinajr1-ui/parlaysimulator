

# Fix Settlement Data Pipeline: Complete Diagnosis and Corrections

## Root Cause Analysis

The settlement pipeline has a chain of failures preventing accurate results:

### Problem 1: Game Log Scraper Returns Incomplete Data
The ESPN box score fetcher (`backfill-player-stats`) only captures ~219 of ~300+ players per game day. Key stars like Giannis Antetokounmpo, Karl-Anthony Towns, Domantas Sabonis, Derrick White, and many others are missing from Feb 9 game logs. The scraper likely fails silently on some box scores (ESPN API returns paginated or partial data for some games).

### Problem 2: Backfill Only Targets 7 Players
The `backfill-player-stats` function only looks up player names from pending parlays (`playerNamesFound: 7`). It should be backfilling ALL players who played that day, especially those in `category_sweet_spots`.

### Problem 3: `verify-sweet-spot-outcomes` Only Processes `pending`, Not `no_data`
Once a pick is marked `no_data` (because game logs weren't available yet), the verification function **never retries it** -- it only queries `outcome = 'pending'` (line 129). Even if game logs arrive later, those 168 picks stay stuck as `no_data` forever.

### Problem 4: Parlays Can't Settle Because 133 Legs Point to `no_data` Picks
48 parlays remain pending because their underlying sweet spot picks are `no_data`. The settlement correctly waits (after our previous fix), but it will wait indefinitely.

### Current State (Feb 9)
- 107 sweet spot picks: `hit`
- 25 sweet spot picks: `miss`  
- 168 sweet spot picks: `no_data` (stuck -- game logs missing)
- 48 parlays: `pending`, 2: `lost`, 1: `won`

---

## Fix Plan

### Fix 1: Update `verify-sweet-spot-outcomes` to Retry `no_data` Picks
Change the query filter from `outcome = 'pending'` to `outcome IN ('pending', 'no_data')`. This way, when game logs become available (e.g., after a backfill), previously `no_data` picks get another chance to be verified.

**File**: `supabase/functions/verify-sweet-spot-outcomes/index.ts`
- Line 129: Change `.eq('outcome', 'pending')` to `.in('outcome', ['pending', 'no_data'])`

### Fix 2: Improve Backfill to Target All Sweet Spot Players
Update `backfill-player-stats` to also pull player names from `category_sweet_spots` where `outcome = 'no_data'` for the target date range. This ensures the backfill fetches stats for all players the bot has picks on, not just the 7 from pending parlays.

**File**: `supabase/functions/backfill-player-stats/index.ts`
- After the existing pending parlay player name collection, also query `category_sweet_spots` for `no_data` players and add them to the set.

### Fix 3: Add BallDontLie as Fallback in Verification
The BDL API returned 804 stats vs ESPN's 800, suggesting it has fuller coverage. The backfill already uses both sources. But the stats it inserts may not cover all the missing players if the BDL game ID mapping is incomplete. We need to ensure the upsert is working correctly and not skipping players due to name mismatches.

### Fix 4: Run Immediate Data Correction
After deploying the fixes:
1. Reset the 168 `no_data` picks for Feb 9 back to `pending` so they get re-verified
2. Trigger `backfill-player-stats` for Feb 9 to pull any missing game logs
3. Trigger `verify-sweet-spot-outcomes` for Feb 9 to re-grade all picks
4. Trigger `bot-settle-and-learn` with date Feb 9 to finalize parlays

### Fix 5: Add Turnovers to Backfill Insert
The `backfill-player-stats` upsert is missing the `turnovers` field (the game log table has it, but the insert doesn't include it). Add it to prevent `no_data` on turnover props.

---

## Technical Details

### File: `supabase/functions/verify-sweet-spot-outcomes/index.ts`
**Line 129**: Change filter to also retry `no_data` picks:
```typescript
// Before
.eq('outcome', 'pending');
// After  
.in('outcome', ['pending', 'no_data']);
```

### File: `supabase/functions/backfill-player-stats/index.ts`
After the pending parlay player name collection (~line 300), add:
```typescript
// Also get players from no_data sweet spots
const { data: noDataPicks } = await supabase
  .from('category_sweet_spots')
  .select('player_name')
  .in('outcome', ['pending', 'no_data'])
  .gte('analysis_date', start)
  .lte('analysis_date', end);

for (const pick of noDataPicks || []) {
  if (pick.player_name) playerNames.add(pick.player_name);
}
```

### SQL Data Reset (to be run after deployment)
```sql
UPDATE category_sweet_spots 
SET outcome = 'pending', actual_value = NULL, settled_at = NULL
WHERE analysis_date = '2026-02-09' AND outcome = 'no_data';
```

### Post-Deploy Sequence
1. Deploy updated `verify-sweet-spot-outcomes` and `backfill-player-stats`
2. Reset `no_data` picks to `pending`
3. Invoke `backfill-player-stats` for Feb 9
4. Invoke `verify-sweet-spot-outcomes` for Feb 9
5. Invoke `bot-settle-and-learn` for Feb 9
6. Verify final state: all picks should be `hit`, `miss`, `push`, or legitimately `no_data` (player didn't play)

