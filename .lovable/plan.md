

# MLB Cascade Parlay Settlement & Earnings Tracker

## What We're Building
A new edge function `mlb-cascade-parlay-settler` that automatically settles the 20 daily MLB cascade parlay tickets and tracks profit/loss, plus a Telegram earnings summary.

## How Settlement Works

Each leg is "Player X Under 0.5 RBI". Settlement is straightforward:
1. Pull all `pending` parlays from `bot_daily_parlays` where `strategy_name = 'mlb_cascade_parlays'`
2. Extract player names from each leg
3. Cross-reference against `mlb_player_game_logs` for the matching game date
4. If player had **0 RBI** → leg **hits**. If **≥1 RBI** → leg **misses**. If no game log found → leg is **void** (DNP)
5. All legs hit → parlay **won** (profit = `simulated_payout - simulated_stake`). Any leg missed → **lost** (profit = `-simulated_stake`). Contains void → apply void policy (void leg removed, remaining legs re-evaluated)
6. Update `bot_daily_parlays` with `outcome`, `legs_hit`, `legs_missed`, `legs_voided`, `profit_loss`, `settled_at`

## Earnings Tracking

After settlement, send a Telegram summary:
```
⚾ MLB CASCADE SETTLEMENT

📊 Today's Results:
✅ Won: 12/20 tickets
❌ Lost: 6/20 tickets
⏸ Void: 2/20 tickets

💰 Staked: $200.00
💵 Returned: $258.40
📈 Net Profit: +$58.40
📊 ROI: +29.2%

🏆 Running Totals:
Total Staked: $200 | Net P/L: +$58.40
```

## Files

### Create: `supabase/functions/mlb-cascade-parlay-settler/index.ts`
- Fetch pending `mlb_cascade_parlays` from `bot_daily_parlays`
- Extract player names from leg descriptions
- Look up actual RBIs from `mlb_player_game_logs` (matching by name + game date)
- Settle each parlay: won/lost/void
- Update `bot_daily_parlays` with outcome, profit_loss, legs_hit/missed/voided, settled_at
- Calculate daily P/L and running totals across all dates
- Send formatted Telegram summary via `bot-send-telegram`

### No DB changes needed
All columns already exist on `bot_daily_parlays` (`outcome`, `profit_loss`, `legs_hit`, `legs_missed`, `legs_voided`, `settled_at`, `simulated_stake`, `simulated_payout`).

### Integration
- Can be invoked manually or added to the settlement orchestrator cron alongside `mlb-rbi-settler`
- Reuses the same `mlb_player_game_logs` data and name-matching logic from the existing RBI settler

