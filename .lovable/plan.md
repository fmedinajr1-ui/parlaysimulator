

## Fix: Phantom Line Filter Bug — Wrong Column Name

### Problem
**Jaylen Wells 0.5 Assists** and other phantom lines are STILL appearing in parlays despite the minimum line filter being added. The filter code exists but is **broken due to a column name mismatch**.

### Root Cause
In `bot-force-fresh-parlays/index.ts`, line 142:
```typescript
const line = Number(ml.current_line || 0);  // BUG: column doesn't exist
```

The query on line 94 selects `book_line` from `mispriced_lines`, NOT `current_line`. So `ml.current_line` is always `undefined`, which evaluates to `Number(0)` = `0`. Since `0` is never less than any minimum threshold, **every phantom line passes the filter**.

### Fix (2 changes, 1 cleanup action)

#### Change 1: Fix column name in `bot-force-fresh-parlays`
**File**: `supabase/functions/bot-force-fresh-parlays/index.ts` (line 142)

Change:
```typescript
const line = Number(ml.current_line || 0);
```
To:
```typescript
const line = Number(ml.book_line || 0);
```

#### Change 2: Clean stale mispriced_lines from today
The old phantom entries (Jaylen Wells 0.5 assists, etc.) were inserted BEFORE the `detect-mispriced-lines` filter was deployed. They need to be purged and re-detected with the filter active.

Run `detect-mispriced-lines` to regenerate today's data (it upserts on the unique constraint, so re-running replaces stale rows). Then void any existing parlays containing phantom legs and regenerate.

#### Change 3: Void and regenerate today's parlays
After fixing the column bug and re-running detection:
1. Void all pending parlays for today
2. Re-trigger the generate pipeline to build a clean slate

### Expected Outcome
- The `book_line` column is correctly read, so 0.5 assist lines (min 1.5) get rejected
- 0.5 block/steal/three lines still pass (those are standard sportsbook lines)
- No more phantom/unbettable lines in any parlays

