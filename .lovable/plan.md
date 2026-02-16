
# Clean Up Telegram Parlay Display

## Issues
1. Strategy names like "premium_boost_exploration_single_pick_value" clutter the display -- remove them
2. Still capped at 5 parlays per tier with "+X more" text -- show ALL parlays
3. The spread formatting falls through to the generic branch, showing raw "AWAY 1.5 SPREAD" instead of clean "Take [Team] -1.5"

## Changes

### File: `supabase/functions/telegram-webhook/index.ts`

**`handleParlays()` (lines 576-603)**
- Remove the strategy_name label from each parlay header
- Remove the 5-parlay cap -- show ALL parlays per tier
- Simplify parlay header to just show leg count, odds, and status
- Remove the "+X more" overflow text entirely

New parlay format per entry:
```
  1. (3-leg) +450 PENDING
     Take East Texas A&M -1.5 (-110)
     Take UNDER 135.5 (-110)
     Take Murray St -3.5 (-110)
     Avg Score: 74 | Avg Hit: 72%
```

**`formatLegDisplay()` (lines 772-833)**
- Fix the spread fallback logic: when `bet_type` is missing but `prop_type` contains "spread", detect it and format properly
- When `bet_type` is missing entirely, infer from `prop_type` field (spread, total, h2h/moneyline)
- For spreads: resolve team name using `side` (home/away) and format as "Take [Team] [line]"
- For totals: format as "Take OVER/UNDER [line]"
- Remove the raw "AWAY 1.5 SPREAD" style fallback

### File: `supabase/functions/bot-send-telegram/index.ts`
- No changes needed (generation notification is separate and already clean)

## Result
One consolidated message (auto-split if needed) showing every pick cleanly:
- No strategy name labels
- No "+X more" cutoffs
- Clean action-first lines for all bet types
