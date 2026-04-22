
Fix the actual break in the parlay pipeline: today’s run is producing status messages because the orchestrator completes, but the parlay engine has nothing meaningful to build from.

## What the current investigation confirms

- `bot_daily_pick_pool` is empty for today (`2026-04-22`) but had `317` rows yesterday.
- `bot_daily_parlays` is empty for today, while yesterday had pending parlays.
- `nba_risk_engine_picks` has only `1` pick today, and it is the only approved `full_slate` risk-engine output.
- `parlay-engine-v2` does not build from `nba_risk_engine_picks` directly. It only reads `bot_daily_pick_pool`.
- There is no active writer in the current codebase that populates `bot_daily_pick_pool` from today’s risk picks.
- Even if the pool-builder existed, today’s upstream volume is still too thin: one approved pick is not enough to generate valid parlays.
- Recent backend logs also show the PrizePicks scraper is getting `403`s, which likely reduces upstream prop coverage and contributes to the low-risk-pick count.

## Root cause

This is a two-layer failure:

1. Structural break:
   - `parlay-engine-v2` expects `bot_daily_pick_pool`
   - the current pipeline never populates that table for today

2. Upstream starvation:
   - today’s risk engine only produced 1 usable pick
   - so downstream generation would still be starved unless we add a fallback or pool-building strategy that can draw from other approved sources

## Implementation plan

### 1. Add a dedicated daily pick-pool builder
Create a backend function that rebuilds `bot_daily_pick_pool` for a target date from approved sources, in priority order.

Primary source:
- `nba_risk_engine_picks`
  - use approved/full-slate rows only
  - map:
    - `side` -> `recommended_side`
    - `line` -> `recommended_line`
    - `confidence_score` -> both `confidence_score` and normalized `composite_score`
    - `true_median` / `l10_avg` fallback -> `projected_value`
    - `l10_hit_rate`, `l10_avg`
    - signal/category mapping from risk-engine metadata instead of `"uncategorized"` where possible

Fallback sources when risk volume is too low:
- `category_sweet_spots`
- optionally other already-approved pick sources used elsewhere in the app/backend

Behavior:
- clear/rebuild only the target date’s rows
- dedupe by player + prop + side + line
- reject rows missing side/line/player
- write structured diagnostics: source counts, inserted count, skipped count, dedupe count

### 2. Wire the pool builder into the orchestrator before parlay generation
Update `refresh-l10-and-rebuild/index.ts` so the sequence becomes:

```text
refresh props
-> run risk engine
-> build daily pick pool
-> verify pool count
-> run parlay-engine-v2
-> run downstream scanners
```

Add an explicit pre-generation gate:
- if `bot_daily_pick_pool` count is below a minimum threshold, do not silently continue
- mark the run as degraded/failed
- send a clear admin alert with:
  - risk pick count
  - pool count
  - fresh prop count
  - likely cause

This prevents “messages but no parlays” behavior.

### 3. Make `parlay-engine-v2` fail loudly and diagnostically on empty input
Adjust `supabase/functions/parlay-engine-v2/index.ts` so that:
- empty pool returns a structured response explaining why no parlays were built
- it reports:
  - pool rows loaded
  - candidates after book matching
  - leg rejections by reason
- in non-dry-run mode, if zero pool rows are present, it should return a clear failure/degraded status instead of appearing successful

This will make future breakages obvious.

### 4. Improve pool scoring so the engine can rank candidates properly
Use the existing project rule from memory:
- final pool confidence should be driven by a meaningful composite score, not flat/raw hit-rate defaults

Implementation details:
- compute `confidence_score` / `composite_score` from available upstream fields:
  - model confidence
  - hit rate
  - edge
  - category weighting
  - optional price sanity
- avoid writing generic `"uncategorized"` unless no better label exists
- preserve enough score variance for engine ranking and strategy selection

### 5. Add a resilience fallback when risk-engine volume is too low
Because today only one risk pick exists, the pipeline needs a controlled fallback path.

Add fallback policy in the pool builder:
- if risk-engine approved picks < threshold, supplement from `category_sweet_spots`
- only include rows that have:
  - active line
  - actual/recommended line
  - confidence floor
  - valid side
- tag fallback origin in `category` or a source field so diagnostics stay honest

Goal:
- allow the engine to generate a slate on thin days without pretending everything came from the risk engine

### 6. Tighten upstream observability around the low-volume source problem
The pool issue is the immediate blocker, but upstream coverage is also broken.

Add diagnostics to the orchestrator alert payload:
- fresh prop count
- risk-engine approved count
- pool built count
- category fallback count
- parlay insert count

Also investigate and patch the current broken data inputs that are reducing candidate volume:
- PrizePicks scraper `403` failures
- any source-specific schema issues causing props not to qualify
- source mismatches that prevent approved picks from becoming usable pool rows

This part should be done after the pool builder is restored, so we separate “missing bridge” from “low source volume”.

### 7. Verify with an end-to-end rebuild
After implementation:
- trigger the rebuild for today
- confirm:
  - `bot_daily_pick_pool` is populated
  - `parlay-engine-v2` receives candidates
  - `bot_daily_parlays` gets new pending rows
  - UI shows actual parlays instead of only status messaging

Validation checks:
- count rows in `bot_daily_pick_pool` for today
- inspect a sample of inserted pool rows for correct side/line/category/confidence
- run `parlay-engine-v2` dry-run and verify `candidates_in > 0`
- confirm inserted parlays for today
- verify no silent “ok with zero output” path remains

## Files likely to change

- `supabase/functions/refresh-l10-and-rebuild/index.ts`
- `supabase/functions/parlay-engine-v2/index.ts`
- new backend function for pool building, likely:
  - `supabase/functions/build-daily-pick-pool/index.ts`

Potentially also:
- source mapping helpers or shared utilities for score normalization
- tests for the new pool-builder and parlay empty-input diagnostics

## Technical notes

- No schema change is strictly required because `bot_daily_pick_pool` already exists with the needed columns.
- This is primarily an orchestration and data-bridging fix.
- The most important behavioral change is: zero-input generation must become an explicit failure state, not a “successful run with warnings.”
- The fallback path should be conservative, so it restores output without degrading slate quality too aggressively.

## Expected outcome

After this fix:
- today’s approved picks will actually be transformed into parlay candidates
- empty-pool days will be surfaced immediately instead of hidden behind status messages
- parlay generation will either produce real slates or fail with a precise reason
- the app will stop appearing “alive” while generating nothing
