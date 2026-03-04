

## Problem: Same Player-Prop Appearing in 6-9 Parlays Despite "Max 1" Rule

### Root Cause

The `MAX_GLOBAL_PLAYER_PROP_USAGE = 1` cap in `bot-generate-daily-parlays` only works **within a single function invocation**. Each engine resets its own tracking map:

- `bot-generate-daily-parlays` — tracks via `globalSlatePlayerPropUsage` (resets per call)
- `bot-force-fresh-parlays` — uses `MAX_PLAYER_PROP_EXPOSURE = 5` (way too high)
- `curated_pipeline` — separate invocation, separate tracking
- `nba-mega-parlay-scanner` — separate `allUsedPlayers` set

Result: Baylor Scheierman threes shows up 9 times across pending parlays. The "1 per player-prop" rule is never enforced **across engines**.

### The Only Place to Fix This: `bot-daily-diversity-rebalance`

This is the **final post-generation pass** that runs after all engines. Currently it only caps by strategy family (30%). It needs a second pass that enforces max-1-per-player-prop across the entire pending slate.

### Fix: Add Player-Prop Exposure Cap to Diversity Rebalance

**File: `supabase/functions/bot-daily-diversity-rebalance/index.ts`**

After the existing strategy-family cap, add a second pass:

1. Fetch all pending parlays with their `legs` JSONB column
2. Build a map of `player_name|prop_type` → list of parlay IDs (sorted by `combined_probability` descending)
3. For each player-prop combo appearing in more than 1 parlay, keep only the highest-probability parlay and void the rest with `lesson_learned: 'exposure_cap_player_prop'`
4. Log the total voided count

This also requires fixing `bot-force-fresh-parlays` to lower `MAX_PLAYER_PROP_EXPOSURE` from 5 to 1, so it stops generating duplicates at the source.

### Changes

| File | Change |
|------|--------|
| `supabase/functions/bot-daily-diversity-rebalance/index.ts` | Add second pass after strategy cap: enforce max-1-per-player-prop across all pending parlays by voiding duplicates (keep highest probability) |
| `supabase/functions/bot-force-fresh-parlays/index.ts` | Change `MAX_PLAYER_PROP_EXPOSURE` from `5` to `1` |

