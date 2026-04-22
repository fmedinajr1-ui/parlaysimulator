
Implement a bounded, one-time stale-line fallback so today’s marginal slate can still generate outputs without permanently weakening the live-line safety gates.

## What will change

### 1. Add a request-scoped freshness override contract
Introduce a small shared helper/contract used by both generation engines to calculate the effective stale-line threshold per run.

Files:
- `supabase/functions/_shared/parlay-engine-v2/config.ts`
- new shared helper alongside parlay engine config/utilities if needed

Behavior:
- keep the current global default threshold as the baseline
- allow a per-invocation override such as:
  - `stale_line_fallback_enabled`
  - `stale_line_fallback_once`
  - `stale_line_fallback_max_age_min`
  - `stale_line_fallback_scope` (`affected_only`)
- ensure this override is request-scoped only, never persisted globally

Goal:
- avoid changing the normal safety posture for all future runs
- make fallback explicit and auditable in diagnostics

### 2. Make `parlay-engine-v2` support a one-time stale-line retry
Update the parlay engine so it first runs with the normal freshness threshold, then performs exactly one fallback pass only if the zero-output cause is stale-line rejection on an otherwise viable pool.

File:
- `supabase/functions/parlay-engine-v2/index.ts`

Behavior:
- first pass uses the normal freshness threshold
- capture detailed counts:
  - `stale_book_line`
  - `line_moved`
  - `no_price_for_side`
  - `book_line_inactive`
  - candidate count before/after freshness gate
- trigger fallback only when all of these are true:
  - pool is not empty/thin
  - initial output is zero or below viable threshold
  - stale-line rejections are the dominant blocker
  - there are affected candidates in the same run
- second pass relaxes freshness only for the affected game/market candidates from pass one
- return diagnostics showing:
  - fallback attempted
  - fallback activated
  - original max age
  - fallback max age
  - affected player/prop or game-market count
  - parlays built via fallback

Important:
- do not relax drift checks
- do not relax inactive/missing-price checks
- do not broaden to unrelated games/markets
- do not run more than once per invocation

### 3. Make `bot-generate-straight-bets` use the same bounded fallback logic
Mirror the same one-time freshness fallback in straight-bet generation so straights and parlays stay aligned.

File:
- `supabase/functions/bot-generate-straight-bets/index.ts`

Behavior:
- first pass applies the standard freshness gate
- if rows were rejected mostly for staleness and no straights were produced, retry once with a relaxed freshness threshold
- restrict the retry to the affected matched rows from the first pass only
- report:
  - `stale_rejected_initial`
  - `stale_rejected_recovered`
  - `fallback_attempted`
  - `fallback_applied`
  - `fallback_scope`
  - `fallback_book_matched_rows`
  - `fallback_standard_inserted`
  - `fallback_ceiling_inserted`

This keeps both engines consistent and prevents one from generating while the other still fails for the same stale-line edge case.

### 4. Teach the orchestrator to invoke the fallback deliberately
Update the orchestrator so today’s run can escalate into the stale-line fallback only when the initial generation result indicates that stale freshness is the real blocker.

File:
- `supabase/functions/refresh-l10-and-rebuild/index.ts`

Behavior:
- keep the existing normal generation pass first
- inspect the returned diagnostics from:
  - `parlay-engine-v2`
  - `bot-generate-straight-bets`
- if output is zero and the engine reports stale-line-dominant failure, invoke that engine one more time with fallback enabled
- only do this once per engine per run
- include clear run results such as:
  - `ok:fallback_recovered`
  - `warning:fallback_failed`
  - `blocked:not_stale_dominant`
- update Telegram/pipeline alerts so the message distinguishes:
  - normal zero-output
  - recovered via stale fallback
  - unrecoverable even after stale fallback

### 5. Keep the fallback narrowly scoped to the affected game/market
The user asked for affected game/market only, so the retry must not globally relax freshness for the entire slate.

Implementation shape:
- identify affected candidates from first pass by a stable key such as:
  - `player_name + prop_type + recommended_side + recommended_line`
  - plus game context when available
- optionally group to a game/market key if multiple legs from the same stale cluster are involved
- second pass should only waive freshness for those affected keys
- all other candidates continue using the default threshold

This preserves data integrity while still rescuing today’s marginal slate.

### 6. Add strong diagnostics so the next failure is obvious
Expand degraded reasons and metadata rather than hiding fallback decisions.

Expected diagnostics additions:
- `degraded_reason_initial`
- `degraded_reason_final`
- `stale_fallback_eligible`
- `stale_fallback_attempted`
- `stale_fallback_applied`
- `stale_fallback_scope`
- `stale_fallback_max_age_min`
- `stale_candidates_recovered`
- `outputs_recovered_from_fallback`

Expected degraded/final reasons:
- `no_book_matched_candidates`
- `stale_book_lines_dominant`
- `fallback_recovered_partial`
- `fallback_recovered_success`
- `no_valid_outputs_even_after_fallback`

### 7. Add tests for the new bounded retry behavior
Add/extend edge-function tests to prove the fallback is safe and one-time only.

Files:
- `supabase/functions/bot-generate-straight-bets/index_test.ts`
- add tests for `parlay-engine-v2` or extracted helpers

Test coverage:
1. normal fresh lines produce output without fallback
2. stale-only blocker triggers exactly one fallback retry
3. fallback applies only to affected game/market keys
4. drifted lines still remain rejected during fallback
5. inactive or missing-price rows still remain rejected during fallback
6. fallback does not run when pool is thin/empty
7. fallback does not run twice in one invocation
8. diagnostics clearly report recovered vs unrecovered state

## Technical details

- Keep the default `MAX_BOOK_LINE_AGE_MIN` intact as the standard baseline.
- Prefer extracting freshness gating into a shared helper so parlay and straight generators use identical logic.
- The fallback max age should be conservative and explicit, not open-ended.
- Preserve FanDuel priority and existing bookmaker matching behavior.
- Preserve `MAX_LINE_DRIFT` exactly as-is.
- Preserve idempotent same-day insertion behavior.
- Keep all fallback state in-memory/request-local; do not write permanent override flags to the database.

## Expected outcome

After this change:
- today’s marginal stale-line scenario can recover automatically once
- parlays and straight bets can still generate when freshness is the only blocker
- the fallback will not silently weaken future runs
- failures will clearly say whether stale-line recovery was attempted, applied, and successful
