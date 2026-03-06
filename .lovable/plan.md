

# Enforce Morning-First Data Refresh for All 3 Sports

## Current State

| Job | Schedule (UTC) | Schedule (ET) |
|-----|---------------|---------------|
| `nba-stats-fetcher-daily` | 12:00 UTC | 7:00 AM ET |
| `nba-stats-fetcher-4h` | every 4h | every 4h |
| `nhl-stats-fetcher-daily` | 11:15 UTC | 6:15 AM ET |
| `nhl-stats-fetcher-6h` | every 6h (offset :30) | every 6h |
| `mlb-data-ingestion-daily` | 14:00 UTC | 9:00 AM ET |

**Problem**: The schedules are scattered. NBA and NHL have early morning runs but MLB doesn't run until 9 AM ET. There's no single "morning data refresh" that guarantees all 3 sports are fresh before the pipeline starts generating picks.

## Plan

### 1. Create a new `morning-data-refresh` edge function
A lightweight orchestrator that calls all 3 data ingestion functions in sequence:
1. `nba-stats-fetcher` (sync mode, 5 days back, ESPN)
2. `nhl-stats-fetcher`
3. `mlb-data-ingestion`

Logs results to `cron_job_history` and sends a Telegram summary confirming all 3 sports refreshed (or reporting failures).

### 2. Schedule it as the first job every morning
- **8:00 AM ET (13:00 UTC)** — runs before everything else
- This guarantees fresh data for all downstream pipelines (refresh-l10 at 10 AM, NHL floor lock at 12 PM, etc.)

### 3. Keep existing individual schedules as safety nets
The existing per-sport cron jobs stay in place as backup/refresh-throughout-day jobs. The morning orchestrator is the guaranteed "first thing" run.

### Files
1. **New**: `supabase/functions/morning-data-refresh/index.ts` — orchestrator calling all 3 fetchers
2. **Cron**: New `pg_cron` job `morning-data-refresh-daily` at `0 13 * * *` (8 AM ET)

