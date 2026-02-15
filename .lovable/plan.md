
# Automate Bot Review-and-Optimize + Trigger Now

## What Changes

1. **Replace the direct generation cron with smart generation**: Update the existing `bot-generate-parlays-4h` cron job to call `bot-review-and-optimize` instead of `bot-generate-daily-parlays`. This way every automated generation first reviews historical patterns, then generates optimized parlays.

2. **Also integrate into the pipeline orchestrator**: In `data-pipeline-orchestrator`, Phase 3 (Generation) currently calls `bot-generate-daily-parlays` directly. Change it to call `bot-review-and-optimize` instead, so pipeline runs also get pattern-optimized generation.

3. **Trigger it right now**: Immediately invoke `bot-review-and-optimize` to run the analysis and generate today's optimized parlays.

## Technical Details

### Database Migration (cron job update)
```sql
-- Replace direct generation cron with smart review-and-optimize
SELECT cron.unschedule('bot-generate-parlays-4h');

SELECT cron.schedule(
  'bot-review-and-optimize-4h',
  '0 */4 * * *',
  $$ SELECT net.http_post(
    url := 'https://pajakaqphlxoqjtrxzmi.supabase.co/functions/v1/bot-review-and-optimize',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ..."}'::jsonb,
    body := '{"source": "cron_4h"}'::jsonb
  ) AS request_id; $$
);
```

### File Change: `supabase/functions/data-pipeline-orchestrator/index.ts`
- Line 120: Change `bot-generate-daily-parlays` to `bot-review-and-optimize` so the pipeline uses smart generation.

### Immediate Trigger
- Call `bot-review-and-optimize` via edge function invoke right after deployment.

### Config Update: `supabase/config.toml`
- Add `[functions.bot-review-and-optimize]` with `verify_jwt = false` (needed for cron calls).
