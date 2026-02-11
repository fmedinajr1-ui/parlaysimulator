

# Fix P&L Calculation in bot-settle-and-learn

## Root Cause: Overwrite vs Accumulate

The settlement cron runs **3 times daily** (6 AM, 12 PM, 6 PM ET). Each run writes to `bot_activation_status` for today's date. The problem is on **line 526**:

```typescript
// BUG: Overwrites instead of accumulating
daily_profit_loss: totalProfitLoss,
simulated_bankroll: newBankroll,
```

Here's what happens:
1. **Run 1 (6 AM):** Settles 20 parlays, P&L = +$4,344. Writes `daily_profit_loss: 4344` 
2. **Run 2 (12 PM):** Settles 1 more parlay, P&L = +$50. **Overwrites** `daily_profit_loss: 50` (the $4,344 is lost!)
3. **Run 3 (6 PM):** Settles 0 parlays, P&L = $0. **Overwrites** `daily_profit_loss: 0`

The `parlays_won` and `parlays_lost` correctly accumulate (`existingToday.parlays_won + parlaysWon`), but `daily_profit_loss` and `simulated_bankroll` do not.

**Proof from data:** Feb 9 parlays have $5,194 in wins and -$850 in losses (net +$4,344), but `bot_activation_status` shows `daily_profit_loss: 0` and `simulated_bankroll: 1000`.

## Secondary Issue: Zero Stakes

Most parlays have `simulated_stake: 0` from the generator. The settlement code has a fallback (`parlay.simulated_stake || 50`), which works but produces inconsistent P&L. The generator should set a proper default stake.

## Fix (2 changes in 1 file)

### Change 1: Accumulate P&L on update (line 526)

```typescript
// BEFORE (overwrites)
daily_profit_loss: totalProfitLoss,
simulated_bankroll: newBankroll,

// AFTER (accumulates)
daily_profit_loss: (existingToday.daily_profit_loss || 0) + totalProfitLoss,
simulated_bankroll: (existingToday.simulated_bankroll || prevBankroll) + totalProfitLoss,
is_profitable_day: ((existingToday.daily_profit_loss || 0) + totalProfitLoss) > 0,
```

Also update `consecutive_profitable_days` and `is_real_mode_ready` to use the accumulated value.

### Change 2: Fix bankroll reference for `newBankroll` variable

The `newBankroll` variable (line 509) is used later for Telegram and logging. It should reflect the accumulated value:

```typescript
// Compute accumulated values for downstream use
const accumulatedPnL = (existingToday?.daily_profit_loss || 0) + totalProfitLoss;
const accumulatedBankroll = existingToday 
  ? (existingToday.simulated_bankroll || prevBankroll) + totalProfitLoss
  : prevBankroll + totalProfitLoss;
```

### Change 3: Default stake in generator

In `bot-generate-daily-parlays`, ensure `simulated_stake` defaults to 50 when generating parlays, so the settlement doesn't rely on a fallback.

## File Modified

- `supabase/functions/bot-settle-and-learn/index.ts` -- accumulate P&L and bankroll across runs
- `supabase/functions/bot-generate-daily-parlays/index.ts` -- default simulated_stake to 50

## Expected Result

- `daily_profit_loss` correctly accumulates across all 3 daily cron runs
- `simulated_bankroll` properly tracks cumulative gains/losses from $1,000 starting point
- P&L Calendar shows real green/red days instead of $0 everywhere
- Consecutive profitable day tracking works, enabling real-mode activation logic

