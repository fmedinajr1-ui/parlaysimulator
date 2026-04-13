

# Filter Snapback Team Signals: Favorites Only

## Problem
Yesterday's snapback value plays on team markets went 5/5 on favorites and 0/6 on underdogs. We need to filter out underdog-side snapback signals for team markets.

## Change

**File**: `supabase/functions/fanduel-prediction-alerts/index.ts`

In the take_it_now (snapback) signal loop (~line 939), after determining `isTeamMarket` and `snapDirection`, add a gate that blocks team moneyline/h2h signals where the line is positive (underdog). For moneyline props, `last.line` represents the American odds — negative = favorite, positive = underdog.

Add this filter right after line 939 (`const isTeamMarket = ...`):

```
// Favorites-only gate for team market snapbacks (underdogs historically 0%)
if (isTeamMarket && isMoneylineProp(last.prop_type) && last.line > 0) {
  log(`🚫 BLOCKED TIN underdog: ${last.player_name} (${last.line}) — favorites only`);
  continue;
}
```

This blocks any snapback signal on a team with positive odds (underdog), only allowing favorites (negative odds) through. Spread and total team markets are unaffected.

## After Deploy
Re-invoke the function to regenerate today's signals with the filter active.

