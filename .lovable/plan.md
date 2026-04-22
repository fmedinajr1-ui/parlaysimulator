
Fix the StatMuse phase so it no longer blocks the pipeline, times out the rebuild, or does expensive one-player-at-a-time scraping during slate generation.

## What will be changed

### 1. Stop treating StatMuse scraping as a per-player synchronous gate
In `supabase/functions/refresh-l10-and-rebuild/index.ts`, the current `phase1_5` loops through slate players and invokes `scrape-statmuse-quarter-stats` once per player. That design is the main runtime problem.

I’ll replace that phase with a fast, bounded workflow:
1. check which slate players are actually missing recent quarter baselines
2. process only the missing players
3. send them in small batches instead of one invocation per player
4. enforce a hard cap on how many players can be scraped in one rebuild run
5. downgrade the phase to non-fatal so generation continues if StatMuse is slow or partially unavailable

Result: the rebuild reaches prop refresh, risk engine, and parlay generation instead of dying in quarter-stat enrichment.

### 2. Make StatMuse enrichment incremental instead of re-scraping everyone
The rebuild currently pulls recent `unified_props` players and tries to scrape all of them. But the database already has fresh `player_quarter_baselines` rows for many players.

I’ll change the phase logic to:
- look up existing `player_quarter_baselines` for today’s slate players
- skip players whose `data_source='statmuse'` rows were updated recently
- only scrape missing or stale players
- log counts like:
  - total slate players
  - already covered
  - missing/stale
  - actually attempted
  - completed / failed / skipped for time budget

Result: much less duplicate scraping and much shorter runtime.

### 3. Batch the StatMuse function calls
Instead of:
```text
1 player -> 1 function call -> 4 remote scrapes -> sleep -> next player
```

I’ll move to:
```text
N players -> 1 function call -> internal loop with controlled limits
```

The rebuild will invoke `scrape-statmuse-quarter-stats` with small batches (for example 3-5 players per call), which reduces function invocation overhead and makes progress tracking cleaner.

Result: lower orchestration overhead and fewer chances of timing out before later phases.

### 4. Add a strict time budget inside the StatMuse phase
The orchestrator already has a global timeout guard, but the StatMuse phase still consumes too much of the total runtime budget.

I’ll add a phase-level budget so StatMuse stops early once it has consumed its allowed window, records a warning, and lets the rebuild continue.

Result: StatMuse becomes “best effort enrichment” instead of “pipeline blocker.”

### 5. Make scrape-statmuse-quarter-stats more resilient
In `supabase/functions/scrape-statmuse-quarter-stats/index.ts`, I’ll harden the function so one scrape issue does not waste the whole batch:
- validate HTTP responses before parsing JSON
- distinguish fetch failure vs parse failure vs insufficient data
- return structured per-player results
- reduce unnecessary waits where possible
- stop logging success when only partial data was recovered
- preserve partial success if 2+ quarters are valid, but report exactly what was missing

Result: clearer diagnostics and fewer silent bad runs.

### 6. Use the existing game-log baseline path as fallback coverage
There is already a working `calculate-quarter-baselines` function that writes to `player_quarter_baselines` using game logs, while `get-player-quarter-profile` prioritizes:
1. live snapshots
2. StatMuse baselines
3. tier fallback

I’ll use that existing architecture to prevent empty quarter profiles:
- ensure the rebuild can rely on existing non-StatMuse baselines if StatMuse is incomplete
- avoid making StatMuse the only route to quarter profile availability
- keep StatMuse as higher-quality enrichment, not mandatory infrastructure

Result: quarter profile consumers still have usable data even when StatMuse underperforms.

### 7. Improve observability for this exact phase
I’ll add structured results to `refresh-l10-and-rebuild` for the StatMuse section, such as:
- `slate_players_total`
- `statmuse_recent_baseline_players`
- `statmuse_missing_players`
- `statmuse_batches_attempted`
- `statmuse_players_processed`
- `statmuse_players_failed`
- `statmuse_phase_status` (`completed`, `partial`, `skipped_timeout`, `no_missing_players`)

Result: next time this breaks, the UI/logs will show whether the issue is coverage, scraping, or time budget.

## Files to update
- `supabase/functions/refresh-l10-and-rebuild/index.ts`
- `supabase/functions/scrape-statmuse-quarter-stats/index.ts`

## Technical details

### Current problem
```text
refresh-l10-and-rebuild
  -> Phase 1.5 fetches slate players
  -> invokes scrape-statmuse-quarter-stats once per player
  -> each player does 4 StatMuse scrapes + waits
  -> total runtime balloons
  -> later phases may never run
```

### Target behavior
```text
refresh-l10-and-rebuild
  -> identify only missing/stale quarter-baseline players
  -> batch those players
  -> enforce a small StatMuse time budget
  -> mark phase partial/non-fatal if budget is hit
  -> continue to props refresh, risk engine, and generation
```

### Why this is the right fix
- the database already contains recent `statmuse` baseline rows, so re-scraping everyone is wasteful
- `get-player-quarter-profile` already supports multiple quarter-data sources, so the pipeline does not need StatMuse to be a hard gate
- the timeout issue is architectural, not just parser quality

## Expected outcome
After this change:
- the StatMuse phase will stop monopolizing rebuild runtime
- the rebuild will consistently reach the pool/generation phases
- quarter baseline coverage will still improve incrementally
- missing or slow StatMuse data will show up as warnings, not total pipeline failure
