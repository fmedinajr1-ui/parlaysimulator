
## Auto-Schedule Daily Hedge Snapshot Settlement

### What This Does
Adds a daily cron job that automatically runs `settle-hedge-snapshots` every morning at **6:00 UTC (1:00 AM ET)** to settle yesterday's hedge snapshots. This runs after the existing verification/backfill jobs (which complete by ~11 PM ET), ensuring game results are available for matching.

### Implementation
One SQL insert to create the cron job — follows the exact same pattern as the 15+ existing cron jobs already configured.

```sql
SELECT cron.schedule(
  'daily-settle-hedge-snapshots',
  '0 6 * * *',  -- 6:00 UTC = 1:00 AM ET
  $$
  SELECT net.http_post(
    url:='https://pajakaqphlxoqjtrxzmi.supabase.co/functions/v1/settle-hedge-snapshots',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer <anon_key>"}'::jsonb,
    body:='{"scheduled": true}'::jsonb
  ) as request_id;
  $$
);
```

### Scheduling Logic

```text
Timeline (Eastern Time):
  8:00 AM  - Daily pipeline collects data + generates sweet spots
  7:00 PM+ - NBA games play out
 11:00 PM  - verify-sharp-outcomes settles game results
 12:00 AM  - auto-settle-parlays runs
  1:00 AM  - settle-hedge-snapshots (NEW) settles hedge performance data
  ~~~next morning~~~
  8:00 AM  - Pipeline runs again with updated hedge accuracy feeding insights
```

### Technical Details

- **No new files** — just a SQL insert to register the cron job
- **No code changes** — the `settle-hedge-snapshots` edge function already works correctly
- Results will appear in the `cron_job_history` table and the CronJobHistoryPanel in the admin dashboard
- The Hedge Status Accuracy card will automatically reflect newly settled data on each refresh
