
# Daily Bot Diagnostics Pipeline

## Overview

Create an automated daily health check that runs every morning, validates the entire bot pipeline is working, tracks improvement trends over time, and sends a Telegram report. This ensures nothing silently breaks and gives you visibility into whether the bot is actually getting better.

## What Gets Checked

The diagnostic will run 7 health checks and 3 improvement metrics:

### Health Checks (pass/warn/fail)
1. **Data freshness** -- Are upcoming props loaded? Are game logs recent?
2. **Weight calibration** -- When was the last calibration? Any stale weights?
3. **Parlay generation** -- Did yesterday's generation run? How many parlays were created?
4. **Settlement pipeline** -- Are there unsettled parlays older than 48 hours?
5. **Blocked categories** -- How many categories are blocked? Is it growing?
6. **Orphaned data** -- Any parlays referencing missing sweet spot IDs?
7. **Cron health** -- Did each scheduled job fire in the last 24 hours? (checked via bot_activity_log)

### Improvement Tracking (trend arrows)
1. **Win rate trend** -- 7-day rolling win rate vs. prior 7 days
2. **Bankroll trajectory** -- Current simulated bankroll vs. 7 days ago
3. **Category convergence** -- Are weights stabilizing (less volatility = more confidence)?

## New Components

### 1. Edge function: `bot-daily-diagnostics`
Runs all checks, stores results in `bot_diagnostic_runs` table, and sends a Telegram summary.

### 2. Database table: `bot_diagnostic_runs`
Stores each diagnostic run with pass/warn/fail counts and full results JSON for historical tracking.

### 3. Cron job
Scheduled daily at 8:00 AM ET (13:00 UTC) to run the diagnostic before the day's first parlay generation.

### 4. Telegram notification type
New `diagnostic_report` type added to `bot-send-telegram` with a formatted health report.

## Telegram Report Format

```text
BOT DAILY DIAGNOSTIC
=======================
Date: Feb 10

HEALTH CHECKS
  Data Freshness ............. PASS
  Weight Calibration ......... PASS
  Parlay Generation .......... PASS
  Settlement Pipeline ........ WARN (3 unsettled >48h)
  Blocked Categories ......... PASS (2/16)
  Orphaned Data .............. PASS
  Cron Jobs .................. PASS

IMPROVEMENT TRENDS
  Win Rate: 42% -> 48% (+6%)
  Bankroll: $980 -> $1,040 (+$60)
  Weight Stability: 0.12 -> 0.08 (converging)

Overall: 6/7 PASS, 1 WARN, 0 FAIL
```

## Technical Details

### Database migration
Create `bot_diagnostic_runs` table:
- `id` (uuid, PK)
- `run_date` (date)
- `checks_passed` (int)
- `checks_warned` (int)
- `checks_failed` (int)
- `overall_status` (text: healthy/degraded/critical)
- `results` (jsonb -- full check details)
- `improvement_metrics` (jsonb -- trend data)
- `created_at` (timestamptz)

### Edge function logic (`bot-daily-diagnostics`)
1. Query `unified_props` for upcoming count
2. Query `bot_category_weights` for blocked count, last calibrated timestamps
3. Query `bot_daily_parlays` for yesterday's generation count and unsettled backlog
4. Query `bot_activation_status` for last 14 days to compute win rate trends
5. Query `bot_activity_log` for last 24h to verify cron jobs fired
6. Check for orphaned parlay legs (legs referencing missing sweet spot IDs)
7. Compute 7-day vs prior-7-day improvement metrics
8. Insert results into `bot_diagnostic_runs`
9. Send Telegram report via `bot-send-telegram`

### Updates to `bot-send-telegram`
Add `diagnostic_report` notification type with the formatted health check output.

### Cron schedule
Daily at 13:00 UTC (8:00 AM ET), before the first parlay generation cycle.

### Execution order
1. Create `bot_diagnostic_runs` table (migration)
2. Create `bot-daily-diagnostics` edge function
3. Update `bot-send-telegram` with new notification type
4. Schedule cron job
