
Investigate the empty pools in a strict top-down order, because the current evidence shows the pool is not failing at the UI layer — it is failing upstream before generation.

## What the investigation already shows

### Confirmed facts
- `bot_daily_pick_pool` has data for prior days, but nothing for `2026-04-22`.
  - Latest counts found:
    - `2026-04-21`: 317
    - `2026-04-20`: 146
- `nba_risk_engine_picks` currently has no recent rows returned by date/mode checks.
- `bot_daily_parlays` still had rows on `2026-04-21`, which means yesterday’s pipeline produced downstream output from an earlier working input set.
- `bot_straight_bets` has no recent daily production pattern; the latest rows are from `2026-04-09`.
- `unified_props` is not empty:
  - active FanDuel props exist for both `2026-04-22` and `2026-04-23`
  - but `fresh_fanduel_props_2h = 0`
- `refresh-todays-props` upserts props without writing `odds_updated_at`, while the orchestrator freshness gate relies on `coalesce(odds_updated_at, updated_at, created_at)`.
- The rebuild function’s latest logs show it was still inside StatMuse batches around 200s elapsed, right before shutdown. That means the pipeline may be timing out before it even reaches the phases that refresh props, run the risk engine, or generate parlays.

### Most likely failure chain
```text
refresh-l10-and-rebuild
  -> spends too long in StatMuse phase
  -> shuts down before later phases
  -> fresh props gate never meaningfully recovers
  -> risk engine either never runs or has no fresh inputs
  -> no process writes today's bot_daily_pick_pool
  -> parlay-engine-v2 receives empty pool
  -> pools look empty in app
```

### Important structural finding
In the current codebase, I found:
- readers of `bot_daily_pick_pool`
- the table creation migration
- diagnostics that count pool rows

But I did not find any active function in the repo that inserts into `bot_daily_pick_pool`.

That means one of these is true:
1. the writer function was removed from the codebase but historical rows remain in the database
2. the writer exists under a renamed function path not matching the table name
3. the old pipeline depended on a legacy function that is no longer deployed
4. the pool is supposed to be built from `nba_risk_engine_picks`, but that bridging step is currently missing

## Step-by-step investigation plan

### 1. Verify whether the rebuild is dying before the pool-building stages
Inspect the rebuild runtime and phase completion sequence for today’s runs:
- confirm whether `phase2`, `phase3b`, and `phase3c` are reached
- confirm whether shutdown occurs during `phase1_5` StatMuse scraping
- map actual last completed phase vs expected downstream side effects

Goal:
- determine whether the pipeline is failing due to sequencing/timeout before any pool generation logic can run

### 2. Identify the real source of `bot_daily_pick_pool`
Audit the current backend for the actual writer path:
- search for renamed or indirect writers
- inspect legacy orchestration assumptions
- compare yesterday’s surviving output shape against the current code
- determine whether the pool should be sourced from:
  - `nba_risk_engine_picks`
  - `category_sweet_spots`
  - another intermediate table
  - a removed legacy function

Goal:
- answer the core question: what is supposed to populate `bot_daily_pick_pool` today?

### 3. Check whether the risk engine is producing candidates but not bridging them into the pool
Trace `nba-player-prop-risk-engine` end-to-end:
- verify it is invoked in the rebuild after the timeout-prone phases
- verify it writes rows for today
- verify its filters are not over-rejecting because of stale or mismatched inputs
- compare approved vs rejected counts and reasons

Goal:
- separate “no candidates produced” from “candidates produced but never copied into pool”

### 4. Fix the freshness contract on upstream props
The current prop refresh writes active props, but the freshness diagnostics still report zero fresh FanDuel props. I’ll inspect and then correct the freshness contract so all downstream phases agree on recency:
- ensure refreshed rows update a canonical freshness timestamp
- standardize all freshness checks to the same source field
- verify today/tomorrow slate rows are being judged correctly in ET

Goal:
- stop false “stale input” conditions from blocking later steps

### 5. Reduce or defer the StatMuse phase so the rebuild can reach generation
Because the rebuild logs show long runtime inside StatMuse, I’ll adjust the orchestration so pool-critical work happens first:
- move pool-critical prop refresh / risk engine / pool generation ahead of long per-player enrichment
- or cap/defer StatMuse batching so it cannot consume the entire runtime budget
- preserve enrichment as optional/non-blocking instead of gatekeeping slate generation

Goal:
- make the rebuild reliably reach candidate generation on every run

### 6. Restore or implement the missing pool-builder
Once the real intended source is confirmed, I’ll restore the missing bridge:
- if a legacy function is still the correct design, restore/repoint it
- if the pool should now derive from `nba_risk_engine_picks`, implement a dedicated pool-builder function
- normalize the fields required by downstream readers:
  - `pick_date`
  - `player_name`
  - `prop_type`
  - `recommended_side`
  - `recommended_line`
  - `confidence_score`
  - `composite_score`
  - `projected_value`
  - `l10_hit_rate`, `l10_avg`, `l3_avg`
  - `category`
  - `rejection_reason`
  - `was_used_in_parlay`

Goal:
- guarantee that today’s pool is explicitly generated instead of assumed

### 7. Add explicit diagnostics for every handoff
Add structured counts after each pipeline stage:
- active props loaded
- fresh FanDuel props
- risk engine approved rows
- pool rows written
- parlay candidates surviving line validation
- parlays inserted
- straight bets inserted

Also return “zero-output reasons” directly in the response payload.

Goal:
- make the next empty-pool incident obvious in one run

### 8. Verify with post-run database checks
After the fixes:
- confirm `bot_daily_pick_pool` has rows for today
- confirm `nba_risk_engine_picks` has today’s `mode='full_slate'` rows
- confirm `bot_daily_parlays` gets today’s pending rows
- confirm the UI bench/pipeline views stop showing empty-state because the database is actually populated

## Files most likely involved
- `supabase/functions/refresh-l10-and-rebuild/index.ts`
- `supabase/functions/refresh-todays-props/index.ts`
- `supabase/functions/nba-player-prop-risk-engine/index.ts`
- one new or restored pool-builder function under `supabase/functions/`
- possibly a migration only if the pool needs missing indexes/defaults, not for simple population logic

## Technical details
```text
Observed current state
active unified_props exist
  but freshness gate says 0 fresh props
  and rebuild appears to timeout during StatMuse
  and no active writer is present for bot_daily_pick_pool
  and today's pool is empty

Target state
rebuild reaches pool-critical phases first
  -> props receive consistent freshness timestamps
  -> risk engine produces approved candidates
  -> dedicated pool-builder writes bot_daily_pick_pool
  -> parlay engine consumes today's pool
  -> parlays/straights generate
```

## Expected outcome
After this investigation and fix:
- we’ll know exactly why pools are empty today, not just where they are empty
- the pipeline will stop timing out before candidate generation
- upstream prop freshness will be measured consistently
- `bot_daily_pick_pool` will be repopulated for today from a real, explicit source
- downstream parlays and straight bets will have valid inputs again
