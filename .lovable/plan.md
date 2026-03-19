

# Auto-Resume Pipeline on Timeout

## Problem
The orchestrator has a 240s budget but the full pipeline often exceeds this, causing downstream steps (curated pipeline, sharp builder, heat engine, etc.) to be skipped. Currently these skipped steps are just lost until the next scheduled run.

## Solution
Add a **continuation mechanism**: when the orchestrator finishes with skipped steps, it re-invokes itself with a `resume_after` parameter indicating which phase to start from. Each re-invocation gets a fresh 240s budget.

### How It Works

1. Define all steps as an ordered list with phase IDs (e.g., `phase0`, `phase1`, `phase1.5`, `phase2`, `phase3a`, `phase3b`, etc.)
2. Accept an optional `resume_after` param — if provided, skip all phases up to and including that phase
3. Track a `run_id` (passed through re-invocations) and an `attempt` counter (max 4 attempts to prevent infinite loops)
4. When the function finishes with skipped steps, it calls `supabase.functions.invoke("refresh-l10-and-rebuild", { body: { resume_after: lastCompletedPhase, run_id, attempt: attempt + 1 } })` — fire-and-forget (no await, so current invocation can return)
5. Max 4 continuation attempts (covers the full pipeline even in worst case)

### File Changes

**`supabase/functions/refresh-l10-and-rebuild/index.ts`** — Restructure into resumable phases:

```
// Accept resume params
const { resume_after, run_id, attempt } = await req.json().catch(() => ({}));
const currentRunId = run_id || crypto.randomUUID();
const currentAttempt = attempt || 1;
const MAX_ATTEMPTS = 4;

// Define phases as ordered array
const ALL_PHASES = ["phase0","phase1","phase1_5","phase2","phase3a","phase3b","phase3c","phase3d","phase3e","phase3f","phase3g"];

// Skip completed phases on resume
let startIndex = 0;
if (resume_after) {
  startIndex = ALL_PHASES.indexOf(resume_after) + 1;
  log(`RESUMING run ${currentRunId} attempt ${currentAttempt} from phase ${ALL_PHASES[startIndex]}`);
}

// Run phases sequentially, tracking last completed
let lastCompleted = resume_after || null;
// ... execute each phase, update lastCompleted after success ...

// At end: if skipped steps exist AND attempt < MAX_ATTEMPTS, self-invoke
if (skipped.length > 0 && currentAttempt < MAX_ATTEMPTS) {
  log(`Self-continuing: attempt ${currentAttempt + 1}, resuming after ${lastCompleted}`);
  supabase.functions.invoke("refresh-l10-and-rebuild", {
    body: { resume_after: lastCompleted, run_id: currentRunId, attempt: currentAttempt + 1 }
  }); // fire-and-forget
}
```

### Safety Guards
- **Max 4 attempts** — prevents infinite loops
- **Same `run_id`** passed through all continuations for log tracing
- **Fire-and-forget** — current invocation returns immediately, continuation runs independently
- **Idempotent phases** — each sub-function is already safe to call independently

### No DB Table Needed
State is passed via the request body between invocations — no extra table required.

