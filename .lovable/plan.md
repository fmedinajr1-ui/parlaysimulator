
Implement an operator-facing diagnostics view so you can see exactly why legs are not producing, starting from the first engine, through the pool, and into live book scanning/matching.

## What will be built

### 1. Add a backend diagnostics function for “why no legs”
Create a dedicated admin diagnostics endpoint that returns the full chain for a selected date without generating or mutating anything.

Files:
- new `supabase/functions/bot-leg-production-diagnostics/index.ts`
- optionally small shared helpers if needed

It will return:

#### Stage A — First engine output
From `nba_risk_engine_picks`:
- total rows for the day
- approved rows
- rejected rows
- top rejection reasons
- approved pick list with:
  - player
  - prop
  - side
  - line
  - confidence
  - edge
  - l10 hit rate
  - created time

#### Stage B — Pool builder output
From `bot_daily_pick_pool`:
- total pool rows
- rows sourced from risk engine vs fallback
- top pool candidates
- duplicates/invalids inferred from builder diagnostics where possible
- row-by-row pool details:
  - player
  - prop
  - side
  - line
  - category
  - composite score
  - l10/l3 values
  - projected value

#### Stage C — Live book scan status
From `unified_props`:
- whether books are being scanned at all
- bookmaker breakdown
- fresh vs stale counts
- FanDuel count
- latest update timestamps
- matched rows for pool players
- unmatched rows
- row-level book details:
  - player
  - prop
  - bookmaker
  - current line
  - over/under price
  - is_active
  - odds_updated_at / updated_at
  - computed age minutes
  - game description
  - commence time

#### Stage D — Generation blockers
A computed explanation layer that shows:
- thin risk output
- thin pool
- no matching book lines
- stale lines
- drifted lines
- inactive lines
- missing prices
- final “why 0 parlays / 0 straights” reason

This gives you the exact raw data needed to manually tune rows.

### 2. Add a dedicated admin page to inspect the full chain
Build a new admin/debug page that surfaces all of the above in a readable way.

Likely files:
- new `src/pages/BotLegDiagnostics.tsx`
- new hook like `src/hooks/useBotLegDiagnostics.ts`
- lightweight table/card components if needed
- route wiring in the app router

Page sections:
1. Engine Summary
2. Risk Engine Approved Picks
3. Risk Engine Rejections
4. Daily Pick Pool
5. Book Scan Coverage
6. Book Match Failures
7. Parlay/straight generation blockers

### 3. Make the page show “start first engine and what pool is giving”
The first visible cards on the page will explicitly answer your request:

#### First engine card
- total risk-engine rows today
- approved count
- rejected count
- latest run time
- top rejection reasons

#### Pool card
- pool row count
- status: ready / thin / empty
- fallback used or not
- top 20 pool rows
- rows missing live book matches

That lets you immediately see whether the problem starts upstream or at book matching.

### 4. Show whether we are scanning the books
Add a clear “Book Scan Health” panel sourced from `unified_props`.

It will show:
- total live props today
- fresh props in last 2h
- FanDuel props in last 2h
- counts by bookmaker
- latest seen update per bookmaker
- number of pool candidates with at least one live book row
- number of pool candidates with zero live book rows

This will make it obvious whether the issue is:
- no book ingestion
- stale book ingestion
- book mismatch by player/prop naming
- too few active lines

### 5. Show row-level failures so you can manually tailor fixes
For each pool leg, show a computed status such as:
- matched_fresh
- matched_stale
- matched_line_moved
- matched_missing_price
- matched_inactive
- no_book_match

Columns:
- player
- prop
- side
- recommended line
- best matched bookmaker
- live line
- line drift
- age minutes
- status
- failure reason

This is the most important manual-fix view because it tells you exactly which legs need intervention.

### 6. Include parlay and straight-bet previews/blockers
The diagnostics page should also show what each downstream engine would do with the current data.

For parlays:
- candidate count after matching
- stale rejected
- drift rejected
- no-price rejected
- degraded reason
- preview of eligible legs if any

For straight bets:
- standard candidates
- ceiling candidates
- stale rejected
- drift rejected
- missing price rejected
- degraded reason

This keeps the page focused on the production problem instead of just raw tables.

### 7. Reuse existing explorer pages where helpful
There is already a `BotPipeline` page, but it only reads generated parlays and becomes empty when nothing was produced.
This new diagnostics page should not depend on parlays existing.

Existing pages/hooks to align with:
- `src/pages/BotPipeline.tsx`
- `src/hooks/useBotPipeline.ts`
- existing admin/bot dashboard patterns

### 8. Add filters so manual debugging is practical
Controls on the page:
- date selector
- bookmaker filter
- player search
- prop-type filter
- “show only failed matches”
- “show only stale”
- “show only unmatched”
- refresh button

This makes it usable for surgical manual cleanup.

### 9. Keep it read-only and admin-only
The page should expose data for inspection, not mutate it.

Rules:
- admin-gated route
- no database writes
- no auto-regeneration
- purely diagnostic and export-friendly

### 10. Optional export for manual intervention
Add a copy/export option so you can pull the exact affected rows outside the app.

Useful outputs:
- JSON copy for the whole diagnostic payload
- CSV export for failed legs/book mismatches only

## Technical details

- Use a dedicated diagnostics function rather than large client-side fan-out queries so the logic for matching pool rows to `unified_props` stays identical and centralized.
- Match rows by normalized `player_name + prop_type`, using the same book priority already used in:
  - `parlay-engine-v2`
  - `bot-generate-straight-bets`
- Compute freshness age from `odds_updated_at ?? updated_at`.
- Surface FanDuel freshness separately because the orchestrator’s odds gate depends on fresh FanDuel counts.
- Keep diagnostics compatible with current degraded reasons:
  - `empty_pick_pool`
  - `thin_pick_pool`
  - `no_book_matched_candidates`
  - `no_valid_parlays_built`
  - `no_valid_straight_bets_built`
- If helpful, the diagnostics endpoint can accept `date` and `bookmaker` params only.

## Expected outcome

After this change, you’ll be able to open one admin page and immediately see:
- what the first engine produced
- what the pool builder produced
- whether books are actually being scanned
- which legs matched live books
- which legs failed and why
- why parlays and straights did or did not generate

That gives you the exact data needed to go in and manually tailor fixes for a few rows when the slate is marginal.
