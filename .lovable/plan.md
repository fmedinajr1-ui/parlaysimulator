

# Trigger Parlay Generation Now + Add Missing Cron

## Current State
- **0 parlays** generated for today (March 16)
- No `refresh-l10-and-rebuild` cron exists — only `engine-cascade-*` jobs (which have been timing out)
- The memory says `refresh-l10-and-rebuild` should run at 10:00 AM ET (15:00 UTC) but the cron was never created

## Plan

### Step 1: Trigger `refresh-l10-and-rebuild` immediately
Invoke the edge function right now via `curl_edge_functions` to generate today's parlays. This runs the full pipeline: game log sync → L10 recompute → void stale parlays → full rebuild (matchups, risk engine, sharp/heat parlays, diversity rebalance, etc.)

### Step 2: Add the missing daily cron job
Schedule `refresh-l10-and-rebuild` to run daily at **10:00 AM ET (15:00 UTC)** via `pg_cron` so this doesn't happen again:

```sql
select cron.schedule(
  'refresh-l10-and-rebuild-daily',
  '0 15 * * *',
  $$ select net.http_post(
    url:='https://pajakaqphlxoqjtrxzmi.supabase.co/functions/v1/refresh-l10-and-rebuild',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."}'::jsonb,
    body:='{}'::jsonb
  ) as request_id; $$
);
```

This ensures parlays auto-generate daily independent of the cascade runner (which has been unreliable).

