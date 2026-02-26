

## Self-Aware Pipeline Doctor — AI-Powered Auto-Diagnosis and Fix Suggestions

### What It Does
A new edge function `bot-pipeline-doctor` that runs after every pipeline completion and daily diagnostics. It analyzes failures, correlates them with profit/loss impact, identifies root causes using known bug patterns, and sends you a Telegram message with specific fix recommendations. Think of it as your bot's immune system.

### How It Works

```text
Pipeline Run Completes (with failures)
         |
         v
  bot-pipeline-doctor
         |
    +----+----+
    |         |
 Analyze   Correlate
 Failures  with P&L
    |         |
    +----+----+
         |
    Root Cause
    Detection
         |
    Fix Suggestion
    Generation
         |
    Telegram Report
    + Store in DB
```

### Architecture

**New edge function: `bot-pipeline-doctor`**

1. **Failure Pattern Matcher** — Maintains a knowledge base of known bug signatures:
   - Scale mismatches (e.g., `70` vs `0.70` — the double-confirmed bug pattern)
   - Column name errors (e.g., `player_avg` vs `player_avg_l10`)
   - Empty result sets from scanners/analyzers (silent failures)
   - HTTP timeout patterns (step taking >25s consistently)
   - Zero-output generators (ran but produced 0 parlays)
   - Stale data indicators (props older than 6 hours at generation time)
   - Settlement backlog (pending parlays older than 48 hours)

2. **Profit Impact Correlator** — Cross-references today's failures with:
   - Days where similar failures occurred vs days without
   - Win rate delta on failure days vs clean days
   - Which specific failed steps correlate with losing days

3. **Fix Suggestion Engine** — For each detected problem, generates a specific recommendation:
   - "Settlement pipeline has 12 unsettled parlays >48h. Run `auto-settle-parlays` manually."
   - "Zero parlays generated today — `refresh-todays-props` returned 0 props. Check Odds API key budget."
   - "Risk engine produced picks but sharp-parlay-builder output 0 parlays — check minimum composite threshold, may be too aggressive."
   - "Weight calibration is 72h stale — run `calibrate-bot-weights` to refresh."

4. **Auto-Remediation** (safe actions only) — For known-safe fixes, the doctor can auto-trigger:
   - Re-run stale calibration
   - Re-trigger settlement for backlogged parlays
   - Force a data refresh if props are stale
   - Log remediation actions for audit trail

**New DB table: `bot_doctor_reports`**
- Stores each diagnosis with: detected problems, root causes, suggested fixes, auto-remediation actions taken, profit impact estimate

**New Telegram message type: `doctor_report`**
- Admin-only alert with diagnosis summary

### Telegram Message Format

```text
PIPELINE DOCTOR — Feb 26

3 problems detected, 1 auto-fixed

DIAGNOSED:
  1. sharp-parlay-builder output 0 parlays
     Cause: composite threshold too high (95) for today's slate (37 picks)
     Fix: Lower execution min_composite to 85 or run bot-force-fresh-parlays
     Impact: -$45 estimated (missed execution tier)

  2. Settlement backlog: 8 parlays >48h
     Cause: verify-sweet-spot-outcomes returning null lines
     Fix: AUTO-FIXED — triggered auto-settle-parlays
     Impact: Bankroll tracking delayed

  3. Weight calibration stale (72h)
     Cause: calibrate-bot-weights skipped in last 2 runs
     Fix: AUTO-FIXED — triggered calibration
     Impact: Category weights may be suboptimal

Win rate on similar failure days: 31% vs 47% clean days
Estimated daily profit impact: -$62
```

### Integration Points

- **Triggered by**: `engine-cascade-runner` and `data-pipeline-orchestrator` at the end of each run (after the failure alert, add a doctor call)
- **Also triggered by**: `bot-daily-diagnostics` at the end of its daily run
- **Scheduled**: Can also run standalone via cron as a nightly review

### Changes Summary

| File | Change |
|------|--------|
| `supabase/functions/bot-pipeline-doctor/index.ts` | **New** — Core diagnosis engine with pattern matching, profit correlation, fix suggestions, and auto-remediation |
| `supabase/functions/bot-send-telegram/index.ts` | Add `doctor_report` message type and formatter |
| `supabase/functions/engine-cascade-runner/index.ts` | Call `bot-pipeline-doctor` after pipeline completion |
| `supabase/functions/data-pipeline-orchestrator/index.ts` | Call `bot-pipeline-doctor` after pipeline completion |
| `supabase/functions/bot-daily-diagnostics/index.ts` | Call `bot-pipeline-doctor` after diagnostics complete |
| Database migration | Create `bot_doctor_reports` table |

### Technical Details

**Known Bug Pattern Database** (hardcoded in the function, expandable):

Each pattern has: `id`, `signature` (how to detect), `rootCause`, `suggestedFix`, `autoRemediable`, `remediationAction`

Example patterns:
- `zero_parlays`: Check `bot_daily_parlays` count for today = 0 after generation phase
- `stale_calibration`: Check `bot_category_weights.last_calibrated_at` > 48h
- `settlement_backlog`: Check pending parlays > 48h old
- `empty_scanner`: Check `cron_job_history` result shows 0 output from scanners
- `critical_step_fail`: Any of the 4 critical steps failed in cascade runner
- `prop_drought`: 0 upcoming props in `unified_props`
- `budget_exhausted`: API budget tracker shows >95% used

**Auto-Remediation Safety Rules:**
- Only triggers functions that are idempotent (safe to re-run)
- Maximum 2 auto-remediations per day (prevent loops)
- Logs every action to `bot_activity_log` with event_type `doctor_remediation`
- Never modifies thresholds or weights automatically — only suggests those changes

