

# Use Real Sportsbook Odds for Parlay Payouts

## Problem
The current `expected_odds` is calculated from hit-rate probability (`1/probability - 1`), which gives "fair" odds -- not real sportsbook odds. Real parlays multiply the actual decimal odds of each leg together. For example, a 3-leg parlay at -110, +120, -105 multiplies those decimal equivalents to get the true parlay odds.

## How Real Sportsbook Parlay Math Works

```text
Leg 1: -110 => decimal 1.909
Leg 2: +120 => decimal 2.200
Leg 3: -105 => decimal 1.952

Total decimal odds = 1.909 x 2.200 x 1.952 = 8.20
Total American odds = +720

$10 stake => payout = $10 x 8.20 = $82.00
Profit = $82.00 - $10.00 = $72.00
```

## Changes

### 1. Generator: Calculate real parlay odds (`bot-generate-daily-parlays/index.ts`)
Replace the current `expectedOdds` formula (lines 1662-1665) with actual sportsbook math:

```
// OLD: expectedOdds from probability (fake odds)
const expectedOdds = combinedProbability > 0
  ? Math.round((1 / combinedProbability - 1) * 100)
  : 10000;

// NEW: multiply actual decimal odds from each leg
const totalDecimalOdds = legs.reduce((product, l) => {
  const odds = l.american_odds || -110;
  const decimal = odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
  return product * decimal;
}, 1);
const expectedOdds = totalDecimalOdds >= 2
  ? Math.round((totalDecimalOdds - 1) * 100)   // positive American
  : Math.round(-100 / (totalDecimalOdds - 1));  // negative American
```

### 2. Settlement: Use real odds for payout (`bot-settle-and-learn/index.ts`)
The settlement payout formula on line 424 currently does:
```
const payout = stake * ((expected_odds || 500) / 100 + 1);
```

This only works for positive American odds. Update to handle both positive and negative:
```
const odds = parlay.expected_odds || 500;
const decimalOdds = odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
const payout = stake * decimalOdds;
```

### 3. Backfill existing parlays
Run a SQL update to recalculate `expected_odds` for existing parlays using the stored leg odds, then recalculate `profit_loss` and `simulated_payout` for won parlays using the corrected odds.

```sql
-- This will be done programmatically since we need to read
-- each parlay's legs JSON, multiply decimal odds, and update.
-- A backend function call or manual query will handle this.
```

### Files Modified
- `supabase/functions/bot-generate-daily-parlays/index.ts` -- real parlay odds calculation
- `supabase/functions/bot-settle-and-learn/index.ts` -- correct payout formula for +/- odds
- Database backfill for existing parlays' `expected_odds`, `profit_loss`, `simulated_payout`
