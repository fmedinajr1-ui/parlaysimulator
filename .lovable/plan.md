

## Hedge Performance Tracking by OVER/UNDER Side

### What This Does
Adds **side-segmented hedge performance analytics** so you can see how accurate your hedge recommendations are for OVER bets vs UNDER bets separately. This builds better hedging intelligence by revealing patterns like "UNDER bets at halftime with 'Alert' status still hit 45% of the time -- don't hedge yet" vs "OVER bets with 'Alert' at Q3 only hit 15% -- hedge immediately."

### Current State
- **529 snapshots** already recorded in the database with `side` (over/under) tracked
- **0 settled** -- the `settle-hedge-snapshots` function hasn't matched outcomes yet
- Existing `get_hedge_status_accuracy` RPC groups by quarter + status but **ignores side**
- Existing `HedgeStatusAccuracyCard` shows one combined view with no OVER/UNDER split

### What Changes

**1. New RPC: `get_hedge_side_performance`** (database migration)

Returns hedge accuracy broken down by side + status + quarter:

```text
| side  | quarter | hedge_status | total | hits | misses | hit_rate |
|-------|---------|--------------|-------|------|--------|----------|
| over  | 2       | on_track     | 9     | 7    | 2      | 77.8%    |
| over  | 2       | urgent       | 14    | 2    | 12     | 14.3%    |
| under | 2       | on_track     | 54    | 41   | 13     | 75.9%    |
| under | 3       | urgent       | 12    | 1    | 11     | 8.3%    |
```

Also returns side-level summary stats (overall OVER hit rate, overall UNDER hit rate, best/worst performing status per side).

**2. Updated `HedgeStatusAccuracyCard`** (UI enhancement)

Add a **side toggle** (OVER | UNDER | ALL) above the existing quarter tabs:

```text
  [OVER] [UNDER] [ALL]        <-- new toggle
  [Q1] [Halftime] [Q3] [Q4]   <-- existing tabs

  Status      | Picks | Hits | Hit Rate
  On Track    |  9    |  7   | 77.8%
  Monitor     |  3    |  2   | 66.7%
  Alert       |  0    |  0   | --
  Urgent      | 14    |  2   | 14.3%
```

**3. New "Side Intelligence Insights"**

Auto-generated insights based on OVER vs UNDER performance differences:

- "OVER bets with 'Alert' at Q3 hit only 15% -- hedge aggressively"
- "UNDER bets hold better through halftime (76% vs 58% for OVER)"  
- "Your UNDER hedges are 2x more accurate than OVER hedges"

These insights feed back into the hedge recommendation logic over time.

**4. Fix `settle-hedge-snapshots` edge function**

Currently 529 unsettled snapshots. The settlement logic looks correct but may not be running. Add a `prop_type` match to the lookup key since the same player can have multiple prop types, and ensure the function is invoked on a schedule or manually.

### Technical Details

**Database Migration (1 new RPC function):**

```sql
CREATE OR REPLACE FUNCTION get_hedge_side_performance(days_back INTEGER DEFAULT 30)
RETURNS TABLE (
  side TEXT,
  quarter INTEGER,
  hedge_status TEXT,
  total_picks BIGINT,
  hits BIGINT,
  misses BIGINT,
  hit_rate NUMERIC,
  avg_projected_final NUMERIC,
  avg_gap_to_line NUMERIC
)
```

Groups by `side, quarter, hedge_status` and joins with `category_sweet_spots` for outcomes -- same pattern as existing `get_hedge_status_accuracy` but with `side` dimension added.

**Files to modify:**

| File | Change |
|------|--------|
| `supabase/migrations/new.sql` | New RPC `get_hedge_side_performance` |
| `src/components/sweetspots/HedgeStatusAccuracyCard.tsx` | Add side toggle (OVER/UNDER/ALL), call new RPC, generate side-specific insights |
| `supabase/functions/settle-hedge-snapshots/index.ts` | Add `prop_type` to lookup key for accurate matching |

**No new files. No new tables. 3 files modified (1 migration, 1 component, 1 edge function).**

### Settlement Fix Detail

Current bug in `settle-hedge-snapshots/index.ts` line 68:
```typescript
// Current: missing prop_type in key
const key = `${o.player_name.toLowerCase()}_${o.prop_type}_${o.analysis_date}`;
```

The lookup key includes `prop_type` but the snapshot lookup on line 74 also includes it -- so the key format is actually correct. The real issue is likely that `category_sweet_spots.actual_value` is null for recent games (results not backfilled yet). The function itself is correct but needs to be triggered after game results are available.

