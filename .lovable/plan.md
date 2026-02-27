

## Auto-Update Hit Rates Across All Engines

### Problem Summary

Yesterday (Feb 25) hit **41%** overall. Today (Feb 26) dropped to **23.6%** on 250 parlays. The core issue: **engine hit rates are not feeding back into strategy selection**. Specifically:

1. `bot_strategies.win_rate` shows 0 for 5 of 6 strategies -- the settlement engine never updates it
2. `bot_prop_type_performance` is partially stale (some props stuck at Feb 24)
3. Player performance has suspicious 25/25 perfect records suggesting double-counting
4. No automated mechanism recalculates strategy-level hit rates after settlement

### Strategy Breakdown (Feb 26)

```text
Strategy                              Wins/Total  Hit Rate
------------------------------------------------------
cross_sport (exploration)              8/14       57.1%
shootout_stack (execution)            14/42       33.3%
grind_stack (execution)               14/42       33.3%
force_mispriced_conviction             7/26       26.9%
mispriced_edge (exploration)          16/119      13.4%  <-- 119 parlays!
mispriced_edge (validation)            0/7         0.0%
```

### What Needs to Happen

#### 1. Create `bot-update-engine-hit-rates` edge function

A new function that runs after every settlement cycle to refresh ALL performance tables:

**A) Update `bot_strategies` table** with actual win rates computed from `bot_daily_parlays`:
- For each strategy, query settled parlays (won + lost) from last 7 days
- Calculate win_rate, times_used, times_won
- Update the `bot_strategies` row

**B) Refresh `bot_prop_type_performance`** to ensure all prop types (not just `player_*` variants) are current:
- Aggregate from settled parlay legs
- Update `last_updated`, `hit_rate`, `total_legs`, `legs_won`
- Auto-set `is_blocked = true` when hit_rate < 25% and total_legs >= 10
- Auto-set `is_boosted = true` when hit_rate > 65% and total_legs >= 10

**C) Refresh `bot_player_performance`** with deduplication guard:
- Query settled legs grouped by player + prop_type + side
- Upsert with proper dedup to prevent inflated perfect records
- Recalculate streak from most recent 5 outcomes

**D) Update `strategy_performance`** table (currently empty) with per-strategy daily stats

#### 2. Wire into settlement pipeline

Add a call to `bot-update-engine-hit-rates` at the end of `bot-settle-and-learn` so hit rates refresh every time parlays settle.

#### 3. Add cron safety net

Schedule a daily 11:30 PM ET run to catch any missed updates.

### Technical Details

**New file:** `supabase/functions/bot-update-engine-hit-rates/index.ts`

The function will:
1. Query `bot_daily_parlays` for settled outcomes grouped by `strategy_name`
2. Extract base strategy (e.g., `elite_categories_v1` from `elite_categories_v1_execution_grind_stack`)
3. Compute rolling 7-day and all-time hit rates
4. Upsert into `bot_strategies` (win_rate, times_used, times_won)
5. Reaggregate `bot_prop_type_performance` from leg-level data
6. Validate `bot_player_performance` and remove duplicate inflation
7. Log results to `bot_activity_log`

**Modified file:** `supabase/functions/bot-settle-and-learn/index.ts`
- Add call to `bot-update-engine-hit-rates` after settlement completes

**Cron job:** Daily at 11:30 PM ET as a safety net

### Success Criteria

1. `bot_strategies.win_rate` reflects actual 7-day performance (not 0 or stale values)
2. All prop types in `bot_prop_type_performance` have `last_updated` within 24 hours
3. Player performance records do not show inflated perfect streaks from double-counting
4. Generation engine uses fresh hit rates to filter and weight picks
5. Underperforming strategies get lower weight or auto-blocked in next generation cycle

