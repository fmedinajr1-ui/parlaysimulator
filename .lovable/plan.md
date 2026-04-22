
Fix the backend end-to-end so today’s run can either generate real parlays and straight picks or fail with exact reasons, then add automatic retest/recovery loops for the known breakpoints.

## What’s actually broken right now

- Today (`2026-04-22`) has only 1 approved row in `nba_risk_engine_picks`.
- `bot_daily_pick_pool` has only 1 row for today, so parlay generation is correctly degrading as `thin_pick_pool`.
- There is currently no deployed straight-pick generator at all. In `refresh-l10-and-rebuild`, phase `3i` explicitly marks `bot-generate-straight-bets` as unavailable instead of generating anything.
- So this is not one bug; it is a broken daily pipeline chain:
  1. risk-engine output is too thin
  2. pick-pool recovery can only build from what exists
  3. parlay engine has too few candidates
  4. straight-pick generation is missing entirely

## Implementation plan

### 1. Restore straight-pick generation in the backend
Create and deploy a real backend function for straight picks so the orchestrator stops pretending that step exists.

Files:
- `supabase/functions/bot-generate-straight-bets/index.ts` (new)
- `supabase/functions/refresh-l10-and-rebuild/index.ts`

Behavior:
- Read today’s `bot_daily_pick_pool`
- Join to fresh `unified_props` book lines, prioritizing FanDuel
- Build two bet classes:
  - `standard_straight`
  - `ceiling_straight`
- Insert rows into `bot_straight_bets`
- Return diagnostics:
  - `pool_rows_loaded`
  - `book_matched_rows`
  - `standard_inserted`
  - `ceiling_inserted`
  - `degraded_reason`

This will match the existing UI/data contract already expecting `bot_straight_bets`, `bet_type`, `ceiling_line`, `ceiling_reason`, and related fields.

### 2. Replace the “unavailable” straight-bet phase with a real invoke
Update phase `3i` in `refresh-l10-and-rebuild` to:
- call `bot-generate-straight-bets`
- capture success/error/degraded state
- send zero-output alerts only when the generator actually ran and still produced nothing
- include straight-bet diagnostics in the final pipeline result

This turns phase `3i` from a placeholder into a functioning generation step.

### 3. Harden the risk-engine output so today can produce enough picks
The real upstream blocker is that today’s risk engine only produced one approved pick. Fix the backend selection gates so a thin slate does not collapse the entire day.

Files to inspect/update:
- `supabase/functions/nba-player-prop-risk-engine/index.ts`
- possibly any helper logic it depends on

Changes:
- add structured diagnostics for why candidates are rejected today
- distinguish “no raw props available” from “over-filtered to zero/one approved pick”
- add a conservative degraded fallback when approved rows are below target:
  - relax only the least dangerous gates
  - preserve duplicate/player caps and hard invalid-data checks
- return counts like:
  - raw props scanned
  - valid props after normalization
  - rejected by each gate
  - approved count
  - fallback mode activated or not

Goal:
- get the engine to produce enough approved picks for same-day downstream generation without blindly lowering quality.

### 4. Add automatic self-healing between risk picks, pool, parlays, and straights
Make the orchestrator resilient instead of single-pass.

In `refresh-l10-and-rebuild`:
- after the risk-engine step, verify approved risk-pick count
- if below threshold, run one controlled fallback pass
- rebuild the pick pool
- verify pool count
- run parlay generation
- run straight-pick generation
- if either output is zero while prerequisites were present, trigger one bounded retry with diagnostics

This creates a request-scoped “repair loop” instead of leaving the system half-alive.

### 5. Keep parlay auto-build, but extend diagnostics further
`parlay-engine-v2` already auto-builds a missing pool. Extend it so it reports:
- whether the pool was missing vs thin
- how many candidates failed book matching
- how many were rejected by line freshness/drift
- whether zero-output came from:
  - not enough picks
  - no fresh FanDuel lines
  - strategy constraints
  - same-game diversity filters

This makes the next failure obvious immediately.

### 6. Make straight-pick generation use the same source-of-truth as parlays
Do not create a second independent pick-selection universe.

Straight picks should be built from:
- `bot_daily_pick_pool` as the canonical candidate source
- `unified_props` as the live line source

That keeps rankings, scores, and daily selection logic aligned with the parlay system.

### 7. Add idempotency so retries do not duplicate today’s output
Before inserting same-day outputs:
- either clear pending same-day generated rows for that date/source
- or upsert using a deterministic dedupe key

Apply to:
- `bot_daily_parlays`
- `bot_straight_bets`

This is necessary because the user specifically wants automatic re-test and retry behavior.

### 8. Add targeted tests for the repaired backend chain
Add Deno tests for:
- pool auto-build when today’s pool is empty
- parlay degraded reasons
- straight-bet generation from a small viable pool
- ceiling-straight generation rules
- retry path not duplicating inserts
- thin-risk-pick fallback behavior

Priority functions:
- `parlay-engine-v2`
- `bot-generate-straight-bets`
- any extracted helper logic from the risk engine

### 9. Validate with live backend retests after implementation
After code changes:
1. deploy updated backend functions
2. invoke the risk-engine path for today
3. invoke pool rebuild
4. invoke parlay generation
5. invoke straight-bet generation
6. run the full orchestrator
7. verify database counts for today:
   - approved risk picks
   - pool rows
   - parlays
   - straight bets
8. if any stage returns degraded output, inspect logs and apply one more fix pass immediately

## Expected result

After this fix:
- today’s run will stop ending in “messages only”
- missing/thin pick pools will be rebuilt automatically when possible
- straight picks will actually be generated because the backend step will exist
- the pipeline will retry once when a recoverable stage fails
- when output is still impossible, the backend will say exactly why

## Technical details

- Use ET date helpers consistently across all generation steps.
- Keep `build-daily-pick-pool` as the only pool-builder.
- Build `bot-generate-straight-bets` as a backend function, not frontend logic.
- Straight-pick selection should reuse `composite_score`, `l10_hit_rate`, `l10_avg`, `l3_avg`, and matched live prices from `unified_props`.
- Preserve hard safety filters:
  - stale book lines
  - missing prices
  - excessive line drift
  - duplicate player/prop spam
- Add bounded retries only once per run to avoid infinite loops.
- Use precise degraded reasons such as:
  - `insufficient_risk_picks`
  - `thin_pick_pool`
  - `no_book_matched_candidates`
  - `no_valid_parlays_built`
  - `no_valid_straight_bets_built`

## Immediate priority order

1. Implement `bot-generate-straight-bets`
2. Wire phase `3i` to invoke it
3. Harden `nba-player-prop-risk-engine` for thin-day fallback
4. Add orchestrator self-healing/retry checks
5. Retest the full backend chain live for today
