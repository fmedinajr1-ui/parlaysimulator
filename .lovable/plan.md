
# Fix Stuck Pipeline and Trigger Today's Full Run

## Root Cause

The `engine-cascade-runner` has been **stuck in "running" status since 10:02 AM ET** (4+ hours). It executes 16 steps sequentially, and when one step hangs (likely a slow/timed-out HTTP call to an edge function), every downstream step is blocked. This means:

- 0 mispriced lines detected for today
- 0 category sweet spots analyzed
- 0 parlays generated
- The `data-pipeline-orchestrator` hasn't triggered because the cascade is still "running"

## Fix Plan

### 1. Add Per-Step Timeout to Cascade Runner

Currently, `fetch()` calls to each step have no timeout -- if a step hangs, the entire cascade hangs forever. Add a 90-second `AbortController` timeout per step so that if any step takes too long, it fails gracefully and the cascade continues to the next step.

**File:** `supabase/functions/engine-cascade-runner/index.ts`
- Wrap each `fetch()` call in an `AbortController` with a 90-second timeout
- On timeout, log the step as failed and continue to the next step
- This prevents a single slow function from blocking mispriced detection, risk engine, and parlay generation

### 2. Add Stale Run Cleanup at Cascade Start

Before starting a new cascade run, check for any existing "running" jobs older than 30 minutes and mark them as "failed" with a timeout note. This prevents ghost "running" entries from accumulating and blocking re-triggers.

**File:** `supabase/functions/engine-cascade-runner/index.ts`
- At the top of the handler (after preflight), query `cron_job_history` for `engine-cascade-runner` entries with `status = 'running'` and `started_at` older than 30 minutes
- Update those to `status: 'failed'` with `result: { error: 'Timed out - marked stale by next run' }`

### 3. Manually Trigger the Full Pipeline

After deploying the fix, invoke the cascade runner to execute all 16 steps for today's slate. This will:
- Backfill stats and fetch defense ratings (Steps 0-7)
- Run `detect-mispriced-lines` (Step 8.5) -- with the new edge_pct >= 3 guard
- Run risk engine and prop scoring (Steps 9-12)
- Run matchup intelligence and environment validator (Steps 13-14)
- Build parlays via sharp-parlay-builder and heat-prop-engine (Steps 15-16)

After the cascade completes, separately invoke `bot-generate-daily-parlays` and `nba-mega-parlay-scanner` (lottery) to generate the full slate including lottery picks with the new matchup-aware alt line logic.

## Files Modified

- **`supabase/functions/engine-cascade-runner/index.ts`**
  - Add 90-second `AbortController` timeout per step fetch
  - Add stale "running" job cleanup at cascade start
  - After deployment: manually invoke to generate today's slate
