

## Fix: Pipeline Cron Silently Failing Due to 5-Second pg_net Timeout

### Root Cause Found

The `pg_net` extension (which pg_cron uses to make HTTP calls) has a **hardcoded 5-second timeout**. The orchestrator's `full` mode takes 2-3 minutes to complete. Every cron-triggered `full` pipeline call has been **silently timing out** since Feb 18.

Evidence from `net._http_response`:
```
error_msg: "Timeout of 5000 ms reached. Total time: 5006.945 ms"
```

This means:
- The 10:00 UTC `full` cron -- **dead** (5s timeout)
- The 13:00 UTC `full` cron -- **dead** (5s timeout)  
- The `verify` and `regen` crons work because they complete in under 5 seconds (they call fewer functions)

Feb 23's 97 parlays came from **separate standalone crons** (scraper, analyzers, generators running independently), NOT from the orchestrator.

### The Fix

**Split the monolithic `full` pipeline into phased cron jobs** that each complete within 5 seconds (they just fire off the edge function and return immediately -- the edge function runs asynchronously).

#### Step 1: Update the orchestrator to support a `fire-and-forget` dispatch pattern

Add a new mode called `'dispatch'` to the orchestrator that triggers each phase as a separate async call (not awaiting the sub-functions sequentially). This way pg_cron's HTTP call returns immediately.

Alternatively (simpler and more reliable): **Replace the single `full` cron with 3 separate phased cron entries**:

| Cron Job | Schedule (UTC) | Mode | Duration |
|----------|---------------|------|----------|
| `pipeline-collect` | `0 13 * * *` (8 AM ET) | `collect` | ~60s |
| `pipeline-analyze` | `5 13 * * *` (8:05 AM ET) | `analyze` | ~45s |
| `pipeline-generate` | `15 13 * * *` (8:15 AM ET) | `generate` | ~30s |
| `pipeline-calibrate` | `20 13 * * *` (8:20 AM ET) | `calibrate` | ~20s |

Each mode runs a subset of functions and completes within the edge function's 400s wall time. The pg_cron call still times out at 5s from pg_net's perspective, BUT the edge function continues running in the background (edge functions don't abort when the caller disconnects).

#### Step 2: Add afternoon NBA-focused pipeline run

NBA props don't appear until ~4 PM ET (21:00 UTC). Add a second collection+analysis+generation cycle:

| Cron Job | Schedule (UTC) | Mode |
|----------|---------------|------|
| `pipeline-collect-afternoon` | `0 21 * * *` (4 PM ET) | `collect` |
| `pipeline-analyze-afternoon` | `10 21 * * *` (4:10 PM ET) | `analyze` |
| `pipeline-generate-afternoon` | `20 21 * * *` (4:20 PM ET) | `generate` |

This ensures NBA props are collected after they're published and parlays are generated with fresh data.

#### Step 3: Remove duplicate/conflicting cron entries

Remove `daily-data-pipeline-8am-est` (duplicate of `data-pipeline-orchestrator-full`) and the old `data-pipeline-orchestrator-full` entry that always times out.

#### Step 4: Add a self-healing watchdog

Update the orchestrator to log a warning if it detects that the last `collect` phase ran more than 6 hours ago when `generate` mode is triggered. This prevents generating parlays from stale data.

### Implementation Details

**Database migration**: Drop old cron jobs, create new phased cron entries.

**Edge function change** (`data-pipeline-orchestrator/index.ts`): Add a stale-data guard at the top of the `generate` mode:

```typescript
if (mode === 'generate') {
  const { data: lastCollect } = await supabase
    .from('cron_job_history')
    .select('completed_at')
    .eq('job_name', 'whale-odds-scraper')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
    
  const hoursAgo = lastCollect 
    ? (Date.now() - new Date(lastCollect.completed_at).getTime()) / 3600000 
    : 999;
    
  if (hoursAgo > 6) {
    console.warn(`[Pipeline] Data is ${hoursAgo.toFixed(1)}h stale -- triggering collect first`);
    await runFunction('whale-odds-scraper', { mode: 'full', sports: ['basketball_nba', 'icehockey_nhl'] });
  }
}
```

### Files Modified
- `supabase/functions/data-pipeline-orchestrator/index.ts` -- Add stale-data guard to generate mode
- Database migration -- Replace 2 failing cron jobs with 6-7 phased cron entries (morning + afternoon cycles)

### Expected Outcome
- Pipeline runs reliably every day without silent failures
- Morning cycle (8 AM ET): Collects all available sports, analyzes, generates
- Afternoon cycle (4 PM ET): Catches NBA props that weren't available in the morning
- Stale-data guard prevents generating parlays from old data even if cron timing drifts

