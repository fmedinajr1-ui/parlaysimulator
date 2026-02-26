

## Pipeline Failure Alerts — Admin-Only Telegram Notifications

### Problem
When pipeline steps fail, errors are logged to `cron_job_history` and `console.error` but **no Telegram alert is sent**. Bugs like the phantom line filter and double-confirmed scanner ran broken for days with zero notification.

### Solution
Add a new `pipeline_failure_alert` message type that sends failure details to admin only (not broadcast to customers). Wire it into both pipeline runners.

---

### Change 1: `bot-send-telegram/index.ts` — Add `pipeline_failure_alert` type

- Add `'pipeline_failure_alert'` to the `NotificationType` union (line 41)
- Add a `formatPipelineFailureAlert()` function that produces a message like:

```text
PIPELINE ALERT — Feb 26

3/17 steps failed in engine-cascade-runner

FAILED:
  refresh-todays-props — HTTP 500 (12.3s)
  nba-player-prop-risk-engine — timeout (30.0s)
  sharp-parlay-builder — no picks (2.1s)

SUCCEEDED: 14/17
Duration: 4m 32s
Trigger: scheduled
```

- Wire it into the `formatMessage` switch statement
- This type is NOT in the broadcast list (line 1125), so it only goes to admin automatically

### Change 2: `engine-cascade-runner/index.ts` — Send alert on failures

After the cascade loop completes (around line 250), if `failCount > 0`:
- Call `bot-send-telegram` with `type: 'pipeline_failure_alert'`
- Include: runner name, failed step names + errors + durations, success/fail counts, total duration, trigger source

Also add **immediate alerts for critical steps** — if any of these fail, send an alert right away without waiting for the full cascade to finish:
- `refresh-todays-props` (no props = no picks)
- `nba-player-prop-risk-engine` (no picks = no parlays)
- `sharp-parlay-builder` / `heat-prop-engine` (no parlays = nothing to deliver)

### Change 3: `data-pipeline-orchestrator/index.ts` — Send alert on failures

At the end of the pipeline (around line 298), if `failedSteps > 0`:
- Call `bot-send-telegram` with `type: 'pipeline_failure_alert'`
- Include: mode, failed function names + error messages, phase info, total duration

Also in the fatal catch block (line 304): send an alert with the crash error message.

---

### Technical Notes

**Files modified:**
1. `supabase/functions/bot-send-telegram/index.ts` — new type + formatter
2. `supabase/functions/engine-cascade-runner/index.ts` — post-run + critical step alerts
3. `supabase/functions/data-pipeline-orchestrator/index.ts` — post-run + fatal error alerts

**Alert behavior:**
- Admin-only (not in the customer broadcast list)
- Only fires when failures occur (no spam on clean runs)
- Critical step alerts fire immediately; summary fires at end
- Includes step names, HTTP codes, durations for fast diagnosis

