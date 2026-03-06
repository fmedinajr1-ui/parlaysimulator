

# Cross-Sport NHL+MLB Optimal Combo Parlays

## Concept
Create a new strategy that combines NHL and MLB picks into mixed-sport optimal combo parlays, leveraging the strong hit rates from both sports (MLB: 63% overall, NHL: solid L10 data).

## Approach

### New Edge Function: `cross-sport-optimal-daily`
A lightweight orchestrator that:

1. **Fetches today's candidates** from `category_sweet_spots` where `analysis_date = today` and category starts with `NHL_` or `MLB_` (or similar sport markers)
2. **Deduplicates by player**, caps pool at top 25 by hit rate
3. **Builds mixed-sport combos** using the same combinatorial C(n,3) and C(n,4) logic, with an added constraint: **each combo must contain at least 1 NHL leg AND at least 1 MLB leg** (enforcing the cross-sport nature)
4. **Inserts to `bot_daily_parlays`** with strategy name `cross_sport_optimal` (execution tier: 70%+ per leg, exploration: 60%+)
5. **Broadcasts** a consolidated Telegram message

### Strategy Profiles
- **Execution (1 parlay)**: 3-leg, every leg >= 70% L10 hit rate, must have both sports represented
- **Exploration (2 parlays)**: 3-leg at 60%+ and 4-leg at 60%+, mixed sport requirement

### Updates to `broadcast-new-strategies`
Add `cross_sport_optimal` to the strategy name whitelist.

### Scheduling
Add to the cron schedule after NHL runs (12:30 PM ET / 16:30 UTC) since it needs both MLB and NHL sweet spots to be fresh. Or invoke it at the end of `nhl-floor-lock-daily` as a Phase 2D.

**Simpler option**: Add it as Phase 2D inside `nhl-floor-lock-daily` since NHL candidates are already loaded — just need to also fetch MLB candidates at that point.

## Implementation — Phase 2D in `nhl-floor-lock-daily`

1. After Phase 2C (ceiling shot), fetch MLB candidates: `category_sweet_spots WHERE analysis_date = today AND category LIKE 'MLB_%'`
2. Merge NHL + MLB candidate pools, deduplicate by player, cap at 25
3. Run `buildOptimalCombos()` with mixed-sport filter: reject any combo that doesn't have both `NHL_` and `MLB_` categories
4. Insert with strategy `cross_sport_optimal`
5. Add to broadcast message

### Files Changed
1. `supabase/functions/nhl-floor-lock-daily/index.ts` — add Phase 2D cross-sport optimal combo builder
2. `supabase/functions/broadcast-new-strategies/index.ts` — add `cross_sport_optimal` to whitelist

