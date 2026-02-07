
# Fix Hedge Status Recording System

## Problem Analysis

The hedge status recording system is **not capturing any data** because of an ID mismatch between the frontend and database:

| Component | Data Source | ID Type |
|-----------|-------------|---------|
| `useDeepSweetSpots` | `unified_props` table | UUID from `unified_props.id` |
| `useHedgeStatusRecorder` | Expects | UUID from `category_sweet_spots.id` |
| `record-hedge-snapshot` | Validates | UUID exists in `category_sweet_spots` |

The frontend generates spots using `unified_props.id`, but the hedge recorder requires `category_sweet_spots.id`. Since these are **different UUIDs for the same player/prop**, the foreign key validation fails silently.

**Database Status:**
- `category_sweet_spots`: 400 records for Feb 6 (populated daily by `category-props-analyzer`)
- `sweet_spot_hedge_snapshots`: 0 records (nothing recorded due to ID mismatch)

## Solution

Remove the strict foreign key dependency and record snapshots using a composite key (player_name + prop_type + line + analysis_date) instead of relying on exact UUID matching.

### 1. Update Edge Function (`record-hedge-snapshot`)

**File:** `supabase/functions/record-hedge-snapshot/index.ts`

Changes:
- Remove the `category_sweet_spots` lookup validation
- Make `sweet_spot_id` nullable in the insert
- Add `analysis_date` field for linking snapshots to picks
- Use the payload data directly without FK validation

```text
Before:
- Check if sweet_spot_id exists in category_sweet_spots
- Skip if not found (causing 0 recordings)

After:
- Accept payload directly
- Record with nullable sweet_spot_id
- Link via player_name + prop_type + line + date for outcome verification
```

### 2. Update Database Schema

**Migration:** Add `analysis_date` column to `sweet_spot_hedge_snapshots`

```sql
ALTER TABLE sweet_spot_hedge_snapshots
  ADD COLUMN IF NOT EXISTS analysis_date date DEFAULT CURRENT_DATE;

-- Make sweet_spot_id nullable (remove FK constraint if exists)
ALTER TABLE sweet_spot_hedge_snapshots
  ALTER COLUMN sweet_spot_id DROP NOT NULL;

-- Add composite index for efficient outcome matching
CREATE INDEX IF NOT EXISTS idx_hedge_snapshots_lookup 
  ON sweet_spot_hedge_snapshots(player_name, prop_type, line, analysis_date);
```

### 3. Update Client Hook (`useHedgeStatusRecorder`)

**File:** `src/hooks/useHedgeStatusRecorder.ts`

Changes:
- Remove UUID validation filter
- Add `analysis_date` to payload
- Record for all live spots regardless of ID format

```typescript
// Before: Only record spots with valid category_sweet_spots UUIDs
const isValidDatabaseId = (id: string): boolean => {
  const uuidPattern = /^[0-9a-f]{8}-...$/i;
  return uuidPattern.test(id);
};

// After: Record all live spots
const liveSpots = spots.filter(s => s.liveData?.isLive && s.id);
```

### 4. Update Accuracy Query

**Create RPC:** `get_hedge_status_accuracy_v2`

Link snapshots to outcomes via player_name + prop_type + line + date:

```sql
CREATE OR REPLACE FUNCTION get_hedge_status_accuracy_v2(
  start_date date DEFAULT CURRENT_DATE - INTERVAL '30 days',
  end_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  hedge_status text,
  quarter int,
  total_picks bigint,
  hits bigint,
  misses bigint,
  hit_rate numeric,
  avg_probability int,
  sample_confidence text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.hedge_status,
    s.quarter,
    COUNT(*) as total_picks,
    COUNT(*) FILTER (WHERE c.outcome = 'hit') as hits,
    COUNT(*) FILTER (WHERE c.outcome = 'miss') as misses,
    ROUND(
      COUNT(*) FILTER (WHERE c.outcome = 'hit')::numeric / 
      NULLIF(COUNT(*) FILTER (WHERE c.outcome IN ('hit', 'miss')), 0) * 100, 1
    ) as hit_rate,
    AVG(s.hit_probability)::int as avg_probability,
    CASE 
      WHEN COUNT(*) >= 50 THEN 'HIGH'
      WHEN COUNT(*) >= 20 THEN 'MEDIUM'
      ELSE 'LOW'
    END as sample_confidence
  FROM sweet_spot_hedge_snapshots s
  LEFT JOIN category_sweet_spots c ON 
    LOWER(s.player_name) = LOWER(c.player_name) AND
    s.prop_type = c.prop_type AND
    ABS(s.line - COALESCE(c.actual_line, c.recommended_line)) < 0.5 AND
    s.analysis_date = c.analysis_date
  WHERE s.analysis_date BETWEEN start_date AND end_date
  GROUP BY s.hedge_status, s.quarter
  ORDER BY s.quarter, s.hedge_status;
END;
$$ LANGUAGE plpgsql;
```

## Technical Details

### File Changes Summary

| File | Change |
|------|--------|
| `supabase/functions/record-hedge-snapshot/index.ts` | Remove FK validation, add analysis_date |
| `src/hooks/useHedgeStatusRecorder.ts` | Remove UUID filter, add analysis_date to payload |
| Database migration | Add analysis_date column, nullable sweet_spot_id, composite index |
| Database RPC | Create `get_hedge_status_accuracy_v2` for outcome matching |

### Data Flow After Fix

```text
1. Live game in progress (e.g., Q1 at 24% progress)
2. useHedgeStatusRecorder detects quarter boundary
3. Sends payload with:
   - player_name: "Kevin Porter Jr."
   - prop_type: "assists"
   - line: 9.5
   - side: "under"
   - quarter: 1
   - hedge_status: "on_track"
   - analysis_date: "2026-02-07"
4. Edge function records to sweet_spot_hedge_snapshots
5. After game settles, RPC matches via player_name + prop_type + line + date
6. Accuracy Dashboard shows: "ON TRACK at Q1: 85% hit rate"
```

### Expected Outcome

After this fix:
- Snapshots will be recorded at each quarter boundary during live games
- The Accuracy Dashboard will show hedge status accuracy (on_track, monitor, alert, urgent)
- You'll be able to see which status levels are most reliable for parlay building
