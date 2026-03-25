

# Pipeline Error Telegram Alerts (Admin Only)

## What This Does
Adds automatic Telegram alerts to the admin when the pipeline encounters errors, produces zero output, or fatally crashes. All alerts use the existing `pipeline_failure_alert` type with `admin_only: true` so only the admin receives them — no customer broadcast.

## Changes

### File: `supabase/functions/refresh-l10-and-rebuild/index.ts`

**1. Add `sendPipelineAlert` helper** (after line 30)
- A small async function that invokes `bot-send-telegram` with `type: 'pipeline_failure_alert'` and `admin_only: true`
- Fire-and-forget (catches errors silently so alerts never break the pipeline)

**2. Modify `invokeStep` to alert on failure** (lines 46-57)
- After logging an error/exception, call `sendPipelineAlert` with the step name and error message
- Include elapsed time for debugging

**3. Zero-output detection after generation phases**
- After phase3c (parlays), phase3i (straights), and phase3_lottery (lottery): query `bot_daily_parlays` / `bot_straight_bets` for today's count
- If count is 0 and the step returned "ok", send a warning alert: "Step completed OK but produced 0 records"

**4. End-of-run summary if any failures** (after line 372)
- Collect all steps from `results` where status is not "ok" or "skipped:timeout"
- If any failed, send a consolidated alert listing failed steps, success count, and total duration

**5. Fatal catch block alert** (line 403-417)
- Before returning the 500 response, send a critical alert with the fatal error message

## Telegram Message Flow
All alerts go through the existing `bot-send-telegram` → `formatPipelineFailureAlert` formatter with `admin_only: true`, so only `TELEGRAM_CHAT_ID` (the admin) receives them. No changes needed to `bot-send-telegram`.

## No Other Files Changed

