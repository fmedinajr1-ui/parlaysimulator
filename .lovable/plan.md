

# Standardize Execution Tier Stakes to Flat $100

## The Problem

Yesterday's execution tier showed **wildly inconsistent stake sizes**:
- $10 (l3_cross_engine — **lost**)
- $100 (elite_categories executions — void/pending)  
- $250 (bidirectional_bench_under — pending)

The database shows `execution_stake = 250` with `baseline_execution_stake = 250`, but various code paths are hardcoding different amounts: `$10`, `$100`, `$250`.

## The Fix

Standardize **all** execution tier parlays to a flat **$100** stake by:
1. Hardcoding `simulated_stake = 100` in execution tier insertion paths
2. Updating the `bot_stake_config` table defaults
3. Removing the light-slate stake halving that drops execution from $250 → $125

## Changes

### 1. `supabase/functions/bot-generate-daily-parlays/index.ts`
- Lines 6858, 8519, 9529, 10180, 10365, 10665: Change hardcoded execution stakes from `$10`, `$100`, `$250`, dynamic values → flat `$100`
- Line 9565: Change default `TIER_CONFIG.execution.stake` from `300` → `100`
- Lines 9931-9954: Remove or simplify light-slate throttle that halves execution stakes

### 2. Database update
```sql
UPDATE bot_stake_config 
SET execution_stake = 100, 
    baseline_execution_stake = 100;
```

### 3. `src/components/bot/StakeCalculator.tsx`
- Update `TIERS` array: execution stake reference from `$200` → `$100`
- Update `BANKROLL_PLANS`: execution column values to match $100 flat

### 4. `src/components/bot/StakeConfigPanel.tsx`
- Default `execution_stake` field to `100` instead of `250`
- Update recommendation formula: `execBase` calculation → flat $100

## Result
- Every execution tier parlay gets exactly **$100** simulated stake
- No more $10 micro-bets or $250 oversized bets
- Consistent capital allocation across all execution strategies

