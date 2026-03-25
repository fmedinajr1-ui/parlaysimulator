

# Tune DNA Audit + Auto-Retry Until Graded Parlays Exist

## Problem

The DNA scorer voids 100% of parlays because `NO_FD_LINE` is treated as a **prunable weakness** (same as `NEG_BUFFER` and `LOW_DNA`). Since most legs have `line_source: "unified_props"` (which sets `has_real_line: true`), the actual failure is likely that `has_real_line` defaults to `false` when not explicitly set in the leg JSON. Any leg with a flag gets pruned, and once too many legs are pruned, the parlay drops below 2 legs → auto-voided as F.

## Changes

### 1. Reclassify `NO_FD_LINE` as informational, not prunable (`score-parlays-dna/index.ts`)

- Split flags into **hard flags** (prune-worthy) and **soft flags** (informational)
- **Hard flags** (trigger pruning): `NO_PLAYER`, `NEG_BUFFER` (buffer < -5%), `LOW_DNA` (score < 30)
- **Soft flags** (informational only): `NO_FD_LINE` — logged but does NOT count toward weak leg classification
- Change `weakLegs` filter to only check for hard flags
- A leg with only `NO_FD_LINE` is no longer pruned — it stays in the parlay and can contribute to an A or B grade

### 2. Soften `NEG_BUFFER` threshold

- Change from `-5%` to `-10%` — a small negative buffer is normal variance, not a disqualifier
- Only prune legs that are significantly misaligned with the player's recent performance

### 3. Add auto-retry loop to orchestrator (`refresh-l10-and-rebuild/index.ts`)

After Phase 3g (DNA audit), add a check:
- Query `bot_daily_parlays` for today's pending parlays with a non-null `dna_grade`
- If **zero graded pending parlays** remain:
  - Log a warning and re-invoke the generation phases (3c through 3g) as a retry
  - Track retry count via a new `regen_attempt` parameter (max 2 retries)
  - On retry, skip phases 0–3b (data already fresh) and jump straight to generation
- If graded parlays exist, proceed to Phase 3h (slate status) as normal

### 4. Add `regen_attempt` tracking to orchestrator

- Accept `regen_attempt` in the request body (default 0)
- On empty-slate detection after DNA audit, self-invoke with `resume_after: "phase3b"` and `regen_attempt: current + 1`
- Max 2 regen attempts to avoid infinite loops

## Files Changed

1. **`supabase/functions/score-parlays-dna/index.ts`** — Reclassify NO_FD_LINE as soft flag, widen NEG_BUFFER to -10%
2. **`supabase/functions/refresh-l10-and-rebuild/index.ts`** — Add post-DNA empty-slate check with auto-retry of generation phases

