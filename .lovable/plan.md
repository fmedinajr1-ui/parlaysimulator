

## Ensure All Functions Are Ready for Tomorrow

### Current Status

**Working correctly:**
- Morning data refresh (8 AM ET) -- scheduled, ran successfully today
- Engine cascade (5 AM, 9 AM, 10 AM, 4 PM ET) -- scheduled, but 2 runs timed out today (stale-job cleanup handled it)
- NHL floor lock (12 PM ET) -- scheduled
- Matchup broadcast (1:30 PM ET) -- scheduled, ran successfully with 70 player-backed targets after L3 fix
- Ladder challenge (2 PM ET) -- scheduled
- PP scraper, whale detector, odds scraper -- all running on 5/15/30 min intervals
- `broadcast-new-strategies` -- already whitelists `l3_cross_engine`
- Bidirectional scanner -- L3 soft gate fix deployed and working

**Issue found:**
- `l3-cross-engine-parlay` has **no cron schedule** -- it was built and invoked manually today but will NOT run automatically tomorrow

### Plan

**1. Schedule `l3-cross-engine-parlay` at 2:00 PM ET (19:00 UTC)**

This runs after the matchup broadcast (1:30 PM ET) and before the ladder challenge (2:00 PM ET → move ladder to 2:30 PM ET), ensuring all engine data (sweet spots, mispriced lines, high conviction) is fresh.

Add a `pg_cron` job:
```sql
SELECT cron.schedule(
  'l3-cross-engine-parlay-daily',
  '0 19 * * *',  -- 2:00 PM ET
  $$ SELECT net.http_post(...) $$
);
```

**2. Shift ladder challenge to 2:30 PM ET (18:30 UTC)**

Update existing cron from `0 18 * * *` to `30 19 * * *` to avoid overlap with the new L3 parlay job.

### Files Changed
None -- cron schedule changes only (SQL inserts via database tool).

