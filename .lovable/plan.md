

# Revive Ladder Challenge + Schedule Daily for 7 Days

## Current State
- The `nba-ladder-challenge` function exists (532 lines) and is fully built out, but has the **same deprecated `serve` import** issue as the mega parlay scanner — it will 404 on invocation.
- It has a dedup cap of 3 picks per day (skips if ≥3 exist).
- No cron job is set up — it only runs when manually invoked.

## Plan

### 1. Fix `nba-ladder-challenge/index.ts` — Update Deno serve pattern
- **Line 1**: Remove `import { serve } from "https://deno.land/std@0.168.0/http/server.ts";`
- **Line 69** (the `serve(async (req) => {` call): Replace with `Deno.serve(async (req) => {`

### 2. Deploy & invoke immediately
Generate today's ladder challenge picks right away.

### 3. Set up a daily cron job for 7 days
Use `pg_cron` + `pg_net` to schedule the ladder challenge function to run daily. We'll set it to fire once per day at a time when NBA lines are available (e.g., 2:00 PM ET / 18:00 UTC). The cron will auto-generate ladder picks for the next 7 days without manual intervention.

```sql
select cron.schedule(
  'daily-ladder-challenge',
  '0 18 * * *',  -- 6 PM UTC = ~2 PM ET daily
  $$ select net.http_post(
    url:='https://pajakaqphlxoqjtrxzmi.supabase.co/functions/v1/nba-ladder-challenge',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer <anon_key>"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id; $$
);
```

After 7 days we can unschedule it, or keep it running if you like it.

### 4. Send slate status update
Trigger `bot-slate-status-update` after today's generation to push updated counts to Telegram.

