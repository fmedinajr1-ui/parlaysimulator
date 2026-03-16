

# Why It Shows "Failed" & Fix Plan

## Two Problems Found

### 1. `bot-generate-daily-parlays` was never actually redeployed
The code file has all the changes (timeout prevention at line 10078, global timeout guard at line 10270, composite filter at line 11041), but the **deployed version is stale**. Logs still show `"Generating exploration tier (150 target)"` — proof the old code is running. The function must be redeployed.

### 2. `refresh-l10-and-rebuild` orchestrator times out
This function calls 15+ sub-functions sequentially. It ran from 16:05:28 to 16:08:26 (~3 minutes), exceeding the edge function wall-clock limit. The client gets "Failed to fetch" and shows the error toast. The sub-functions (including parlay generation) **did execute** — 35 parlays were generated and sent for approval — but the orchestrator died before completing all downstream steps (curated pipeline, force-fresh, sharp builder, heat engine, ladder, etc.).

The "failed" toast is misleading: parlays were generated, but half the pipeline steps never ran.

## Plan

### Step 1: Redeploy `bot-generate-daily-parlays`
Force redeploy so the timeout prevention + composite filter code actually runs. No code changes needed.

### Step 2: Split `refresh-l10-and-rebuild` into 2 phases
The current function tries to do too much in one invocation. Split it so Phase 3 (rebuild) sub-functions are invoked in parallel where possible, and add a timeout guard to skip remaining steps gracefully instead of dying silently.

**File**: `supabase/functions/refresh-l10-and-rebuild/index.ts`

Changes:
- Add a `functionStartTime` and check elapsed time before each step
- Run independent rebuild steps in parallel (e.g., `detect-mispriced-lines` + `bot-matchup-defense-scanner` can run concurrently)
- If approaching timeout (~240s), skip remaining steps and return partial results instead of crashing
- Log which steps completed vs. skipped

### Step 3: Redeploy `refresh-l10-and-rebuild`

### Files to Edit
1. `supabase/functions/refresh-l10-and-rebuild/index.ts` — add timeout guard + parallelize independent steps
2. Redeploy both `bot-generate-daily-parlays` and `refresh-l10-and-rebuild`

