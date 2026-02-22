
## Fix: Hedge Status Accuracy Card showing "No accuracy data yet"

### Root Cause
The `get_hedge_side_performance` RPC function references `s.created_at`, but the `sweet_spot_hedge_snapshots` table uses `captured_at` as the timestamp column. This causes the RPC to throw an error, so the card falls back to the "No accuracy data yet" state.

Meanwhile, the database **does** have 59 settled snapshots with real OVER/UNDER performance data ready to display.

### Fix (1 database migration)

Replace `s.created_at` with `s.captured_at` in the `get_hedge_side_performance` function:

```sql
CREATE OR REPLACE FUNCTION get_hedge_side_performance(days_back INTEGER DEFAULT 30)
...
  WHERE s.outcome IS NOT NULL
    AND s.captured_at >= NOW() - (days_back || ' days')::INTERVAL
...
```

### Expected Result After Fix
The Hedge Status Accuracy card will populate with:
- **OVER side**: 41 settled snapshots showing urgent status at Q3/Q4 hitting 0%, profit_lock hitting 100%
- **UNDER side**: 18 settled snapshots showing on_track hitting 100%, monitor mixed
- **Side Intelligence insights** comparing OVER vs UNDER accuracy
- **ALL/OVER/UNDER toggle** filtering the data by side

No UI changes needed -- the component code is correct, it's just receiving an empty dataset due to the RPC error.
