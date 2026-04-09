

# Schedule Daily RBI Under/Over Analyzer

## What We're Doing
Set up a pg_cron job to automatically invoke the `mlb-rbi-under-analyzer` edge function daily at 10:00 AM ET, so the cross-referenced Under 0 RBI locks and Over 70%+ plays are sent to Telegram every morning without manual intervention.

## Implementation

### 1. Add to Morning Prep Pipeline
Instead of a standalone cron job, integrate the RBI analyzer into the existing `morning-prep-pipeline` edge function as a new step after the current analysis engines. This keeps all morning analysis coordinated.

**Change:** Add a new step in `morning-prep-pipeline/index.ts` after the engine tracker sync:
```
Step 4: MLB RBI Under Analyzer (cross-referenced with pitcher matchups)
```

### 2. Schedule via pg_cron (if not already scheduled)
The morning prep pipeline likely already has a cron trigger. If not, create one firing at 10:00 AM ET daily using `pg_cron` + `pg_net`.

## Files Changed
1. **Edit:** `supabase/functions/morning-prep-pipeline/index.ts` — add `mlb-rbi-under-analyzer` as Step 4

