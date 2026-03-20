

# Fix Straight Bet Selection: Use Historical Prop Win Rates

## Problem

Today's 15 straight bets are dominated by **points OVER** (53.4% historical hit rate) and **rebounds OVER** (61.6%). These are the two worst-performing categories. Meanwhile, the proven winners are being ignored:

- Rebounds UNDER: **83.8%** hit rate
- Threes OVER: **77.5%** hit rate  
- Assists UNDER: **73.5%**
- Points UNDER: **69.6%**

At -110 odds, you need 52.4% to break even. Points OVER at 53.4% has almost zero edge. The current system just sorts by L10 hit rate without checking if the prop type historically delivers.

## Solution: 3 Changes

### 1. Add Historical Prop Win Rate Multiplier to Straight Bet Generator

In `bot-generate-straight-bets/index.ts`, before ranking candidates, query `category_sweet_spots` for historical hit rates by `prop_type + recommended_side`. Apply a **composite boost/penalty**:

```
PROP_HISTORICAL_RATES = query from settled sweet spots grouped by prop_type + side

For each candidate:
  historical_rate = PROP_HISTORICAL_RATES[prop_type + side] or 60
  if historical_rate >= 75: boost composite_score by +15
  if historical_rate >= 70: boost by +10
  if historical_rate < 60: penalty -20
  if historical_rate < 55: SKIP entirely (not profitable at -110)
```

This would auto-filter out points OVER (53.4%) and prioritize threes OVER (77.5%) and rebounds UNDER (83.8%).

### 2. Increase Max Picks to 20 (From Profitable Categories Only)

With the filter removing low-edge prop types, raise `maxPicks` from 15 to 20. More volume from proven categories = more profit. If fewer than 15 qualify from good categories, that's fine — quality over quantity.

### 3. Add `bot_straight_bet_tracking` View for Daily P&L

Create a database function `get_straight_bet_performance` that returns:
- Daily win/loss/P&L by prop type
- Running total profit
- Best/worst prop categories
- Used by the settlement pipeline to log daily straight bet ROI

This gives you a feedback loop: after tonight's games settle, you'll see exactly which prop types made money and which didn't.

## Expected Impact

- **Before**: 15 picks, ~53-62% avg historical hit rate across categories, thin edge
- **After**: 15-20 picks from 70%+ historical categories only, ~70-78% avg historical hit rate
- At 70% hit rate with 20 picks × $25: **+$168/day expected profit**
- At 75% hit rate: **+$216/day**

## Files Changed

1. `supabase/functions/bot-generate-straight-bets/index.ts` — Add historical rate query, apply boost/penalty, skip sub-55% categories, raise max to 20
2. DB migration — Create `get_straight_bet_performance()` function for tracking

