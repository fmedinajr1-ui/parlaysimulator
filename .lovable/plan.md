

# Track 7-Day Ladder Challenge with $100 Stakes + Telegram Updates

## What's Missing Today
1. The ladder challenge insert **doesn't set `simulated_stake`** — settlement defaults to $100 (which is correct), but it should be explicit.
2. When a ladder pick settles (won/lost), the existing `parlay_settled_alert` fires but it looks like any other parlay — no special "Ladder Challenge" branding or running tally.
3. No 7-day running scoreboard showing the ladder challenge streak, cumulative profit, and record.

## Plan

### 1. `nba-ladder-challenge/index.ts` — Set explicit $100 stake
- Add `simulated_stake: 100` to the insert at line 399 so it's tracked explicitly.

### 2. `bot-settle-and-learn/index.ts` — Add ladder-specific Telegram alert
- After a ladder pick settles (detect via `strategy_name === 'ladder_challenge'`), query the last 7 days of ladder picks from `bot_daily_parlays` to build a running scoreboard.
- Send a dedicated Telegram notification type `ladder_challenge_result` with:
  - The pick result (won/lost)
  - Running 7-day record (e.g., "3W-1L")
  - Cumulative P&L (e.g., "+$420")
  - Day number in the challenge (e.g., "Day 4 of 7")

### 3. `bot-send-telegram/index.ts` — New `ladder_challenge_result` formatter
- Add a new message type and formatter that produces:

```
🔒 LADDER LOCK RESULT — Day 4 of 7
━━━━━━━━━━━━━━━━━━━━━
🟢 WON — Jose Alvarado AST O2.5
Actual: 4 ✅

💰 Stake: $100 | Profit: +$173

📊 7-Day Challenge: 3W-1L
💵 Running P&L: +$420
🎯 Win Rate: 75%
━━━━━━━━━━━━━━━━━━━━━
```

### Files Changed
1. `supabase/functions/nba-ladder-challenge/index.ts` — add `simulated_stake: 100`
2. `supabase/functions/bot-settle-and-learn/index.ts` — detect ladder settlements, query 7-day tally, fire dedicated alert
3. `supabase/functions/bot-send-telegram/index.ts` — add `ladder_challenge_result` type + formatter

