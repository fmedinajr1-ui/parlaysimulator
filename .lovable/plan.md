
Implement an automatic “missing pool” recovery path so parlay generation can rebuild `bot_daily_pick_pool` from `nba_risk_engine_picks` on demand instead of failing with status-only output.

## What will be changed

### 1. Keep `build-daily-pick-pool` as the single source of truth
The project already has a dedicated builder in `supabase/functions/build-daily-pick-pool/index.ts`. That function should remain the canonical converter from:
- `nba_risk_engine_picks`
- optional fallback `category_sweet_spots`

into:
- `bot_daily_pick_pool`

No second pool-building implementation should be introduced elsewhere.

### 2. Add automatic self-healing inside `parlay-engine-v2`
Update `supabase/functions/parlay-engine-v2/index.ts` so it does this before declaring `empty_pick_pool`:

1. Load `bot_daily_pick_pool` for the target date
2. If the pool is missing or below a configurable minimum threshold:
   - invoke `build-daily-pick-pool`
   - reload the pool
3. Only return `empty_pick_pool` / `thin_pool` if the pool is still insufficient after the rebuild attempt

This makes the engine resilient when:
- the orchestrator was skipped
- the pool was cleared manually
- a scheduled run partially failed
- someone invokes generation directly through another function

### 3. Make the rebuild attempt safe and idempotent
The auto-build path should:
- only run once per request
- target the same ET date the engine is generating for
- preserve the builder’s existing dedupe logic
- avoid infinite retry loops
- surface whether the pool was:
  - already present
  - auto-rebuilt successfully
  - still too thin after rebuild

### 4. Return explicit diagnostics about the auto-build
Extend `parlay-engine-v2` responses to include structured fields such as:
- `pool_auto_build_attempted`
- `pool_auto_build_success`
- `pool_before_count`
- `pool_after_count`
- `pool_build_diagnostics`

That way, a zero-output day becomes debuggable immediately instead of looking like a silent engine failure.

### 5. Tighten the degraded reason contract
Refine the engine’s failure states so they distinguish:
- `empty_pick_pool` — no pool even after rebuild
- `thin_pick_pool` — pool exists but below minimum threshold
- `no_book_matched_candidates` — pool exists but no live lines matched
- `no_valid_parlays_built` — candidates exist but strategy constraints rejected all builds

This will make alerts and downstream debugging much clearer.

### 6. Keep the orchestrator, but make it complementary rather than the only path
`refresh-l10-and-rebuild` already invokes `build-daily-pick-pool`. That should stay in place for scheduled runs.

Small refinement:
- keep the proactive pool-build phase in `supabase/functions/refresh-l10-and-rebuild/index.ts`
- update its status messaging so it reflects whether the pool was built fresh, reused, or remained thin
- rely on `parlay-engine-v2` as the final safety net if a later run finds the pool missing anyway

### 7. Ensure broadcast flows inherit the fix automatically
`parlay-engine-v2-broadcast` already calls `parlay-engine-v2` when `generate_first` is enabled. Once `parlay-engine-v2` can auto-build a missing pool, that broadcast path will inherit the same recovery behavior without needing duplicate logic.

## Files to update

- `supabase/functions/parlay-engine-v2/index.ts`
- `supabase/functions/refresh-l10-and-rebuild/index.ts`

Likely no new file is required, because:
- `supabase/functions/build-daily-pick-pool/index.ts` already exists and should be reused

## Behavior after the change

If `bot_daily_pick_pool` is missing for today:

```text
parlay-engine-v2
→ checks pool
→ detects empty/thin pool
→ invokes build-daily-pick-pool
→ reloads pool
→ continues generation if pool recovered
→ otherwise returns a precise degraded reason
```

## Technical details

- Use the existing ET date helper behavior so the pool date and parlay date stay aligned.
- Keep score integrity intact: continue using the composite score written by `build-daily-pick-pool` as the ranking confidence.
- Do not move pool-building logic into frontend code.
- Do not introduce raw SQL or duplicate conversion code.
- The auto-build should use validated defaults such as:
  - `minimum_risk_rows: 8`
  - `minimum_pool_rows: 12`
  - `fallback_limit: 40`
- The rebuild attempt should be request-scoped only, not stored in globals.

## Validation after implementation

1. Invoke `parlay-engine-v2` for a date with an empty pool
2. Confirm it automatically calls the pool builder
3. Confirm `bot_daily_pick_pool` is populated
4. Confirm the engine either:
   - generates parlays, or
   - returns a precise degraded reason with pool diagnostics
5. Confirm orchestrator logs and alerts reflect the recovered-vs-failed state clearly

## Expected outcome

After this change:
- missing pools will no longer cause confusing “messages only” runs
- the system will auto-convert `nba_risk_engine_picks` into `bot_daily_pick_pool` when needed
- scheduled rebuilds remain proactive
- direct generation paths become self-healing
- failures become explicit and diagnosable instead of silent
