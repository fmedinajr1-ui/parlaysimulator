

# Fix Sweet Spot Void Rate — Stop Generating Unsettleable Picks

## Problem
The `category-props-analyzer` generates picks for every player with game logs (~845/day), then checks `unified_props` for matching market lines. Players without matching props are marked `is_active = false` but still inserted into `category_sweet_spots` with `outcome = 'pending'`. This creates 75-90% unsettled noise that pollutes hit-rate stats, clogs the settlement pipeline, and makes tracking unreliable.

## Root Cause (category-props-analyzer/index.ts, lines 1758-1767)
When no matching prop exists in `unified_props`, the spot is marked inactive but still pushed into `validatedSpots` and upserted to the DB. The settlement function (`verify-sweet-spot-outcomes`) then loops over these forever, never finding game data to resolve them.

## Plan

### Step 1: Skip inserting picks with no market line
**File:** `supabase/functions/category-props-analyzer/index.ts`

In the validation loop (line 1758), when `actualData` is null (no matching prop in `unified_props`), **do not push** the spot into `validatedSpots`. Simply increment `noGameCount` and `continue`. This prevents ~700+ phantom picks per day from ever entering the database.

Add a summary log: `"Dropped X picks with no market line (not inserted)"`.

### Step 2: Auto-void stale unsettled picks in the settlement function
**File:** `supabase/functions/verify-sweet-spot-outcomes/index.ts`

Add a cleanup step at the start: any pick older than 2 days with `outcome = 'pending'` and `actual_line IS NULL` should be batch-updated to `outcome = 'void'` with a reason like `'no_market_line'`. This cleans the existing backlog and prevents future accumulation.

### Step 3: Add market-line gate to the parlay generator pickup query
**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

When querying `category_sweet_spots` for parlay legs, add `.not('actual_line', 'is', null)` to the query filter. This ensures only picks with real book lines can enter parlays — a safety net even if Step 1 misses something.

### Step 4: Clean existing backlog
Create a one-time migration to mark all historical `category_sweet_spots` rows where `actual_line IS NULL` and `outcome IN ('pending', 'no_data')` as `outcome = 'void'`. This immediately clears the noise from past runs.

```sql
UPDATE category_sweet_spots
SET outcome = 'void', settled_at = now()
WHERE actual_line IS NULL
  AND outcome IN ('pending', 'no_data')
  AND analysis_date < CURRENT_DATE;
```

## Expected Impact
- Daily pick count drops from ~845 to ~45-100 (only market-backed picks)
- Void rate drops from 75-90% to near 0%
- Settlement pipeline runs faster with no phantom picks to skip
- Hit-rate tracking becomes accurate (based only on real book lines)
- Parlay legs guaranteed to have verifiable lines

## Files Changed
1. `supabase/functions/category-props-analyzer/index.ts` — Drop no-line picks before insert
2. `supabase/functions/verify-sweet-spot-outcomes/index.ts` — Auto-void stale pending picks
3. `supabase/functions/bot-generate-daily-parlays/index.ts` — Add actual_line filter to pickup query
4. One database migration to clean backlog

