

## Disable Losing Strategies + Boost Double-Confirmed

### The Problem

Two strategy families are burning money:

- **master_parlay**: 0 wins out of 15 settled (0% win rate), -$650 total P/L. The 6-leg format is structurally doomed -- even with 62% hit rate legs, combined win probability is ~6%.
- **premium_boost / max_boost**: Legacy strategies no longer in the codebase but still have pending parlays. The `premium_boost` prefix came from old code. Most sub-strategies are 0-win money pits (team_ml 0-7, execution_mini_parlay 0-4, cross_sport 0-4).

Meanwhile, **double_confirmed_conviction** (sweet spot 70%+ hit rate AND mispriced 15%+ edge) and **mispriced_edge** strategies show the highest conviction signal and have generated the biggest winners.

### Plan

**Step 1: Remove `master_parlay` from TIER_CONFIG** (bot-generate-daily-parlays)

- Delete the 6-leg `master_parlay` profile from the execution tier (line 247-249)
- Remove the `generateMasterParlay()` call in the main handler (~line 6457-6467)
- Keep the `generateMasterParlay` function code commented out (not deleted) in case you want it back later

**Step 2: Void all pending master_parlay and premium_boost/max_boost parlays**

- Run a SQL update to set `outcome = 'void'` and `profit_loss = 0` for all pending parlays matching these strategy names
- This prevents them from being settled and counting against your record

**Step 3: Add more double_confirmed_conviction profiles to fill the gaps**

Replace the removed master_parlay slot and redistribute volume toward the winning strategy:

Execution tier additions (replace master_parlay slot):
```text
{ legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 65, sortBy: 'composite' }
{ legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'hit_rate' }
```

Validation tier addition:
```text
{ legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 60, sortBy: 'composite' }
```

Exploration tier addition:
```text
{ legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba', 'baseball_mlb'], minHitRate: 55 }
```

**Step 4: Add master_parlay/premium_boost/max_boost to integrity check exclusions**

Update `bot-parlay-integrity-check` to exclude these voided strategies from flagging.

### Technical Details

**File 1: `supabase/functions/bot-generate-daily-parlays/index.ts`**
- Line 247-249: Delete the `master_parlay` profile from execution tier
- Lines ~6457-6467: Comment out the `generateMasterParlay()` call and its surrounding logic (master parlay insert)
- Add 2 new `double_confirmed_conviction` profiles to execution (replacing master_parlay slot)
- Add 1 new `double_confirmed_conviction` profile to validation
- Add 1 new `double_confirmed_conviction` profile to exploration

**File 2: `supabase/functions/bot-parlay-integrity-check/index.ts`**
- Add `master_parlay`, `premium_boost`, `max_boost` patterns to the `EXCLUDED_STRATEGIES` list

**Database: Void pending losers**
```sql
UPDATE bot_daily_parlays
SET outcome = 'void', profit_loss = 0, updated_at = now()
WHERE outcome = 'pending'
AND (strategy_name ILIKE '%master_parlay%'
  OR strategy_name ILIKE '%premium_boost%'
  OR strategy_name ILIKE '%max_boost%');
```

### Files Modified

1. `supabase/functions/bot-generate-daily-parlays/index.ts` -- Remove master_parlay profile, comment out generator call, add double_confirmed profiles
2. `supabase/functions/bot-parlay-integrity-check/index.ts` -- Exclude voided strategies from integrity checks
3. Database migration -- Void all pending master_parlay/premium_boost/max_boost parlays

### Expected Outcome

- No more 6-leg master parlays burning $500/day
- No more legacy premium_boost/max_boost parlays
- 4 additional double_confirmed_conviction profiles across all tiers (the strategy with the highest conviction signal)
- All pending losing-strategy parlays voided so they don't affect settlement

