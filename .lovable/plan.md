

## Daily Winners Recap Report — Customer Telegram Broadcast

### Overview

Create a new edge function that pulls yesterday's winning parlays from the database, formats them into a clean customer-friendly Telegram report, broadcasts it to all authorized customers, and runs automatically at 8 AM ET every day.

### Report Format (Telegram)

```text
🏆 YESTERDAY'S WINS — Feb 22
━━━━━━━━━━━━━━━━━━━━
Excellent Day — 6 Winners

#1 | Validation | +596 | $1,192 profit
  ✅ Desmond Bane PTS O18.5 (actual: 36)
  ✅ Vucevic REB O6.5 (actual: 8)
  ✅ Brunson REB O2.5 (actual: 5)

#2 | Validation | +594 | $1,188 profit
  ✅ Kon Knueppel 3PT O3.5 (actual: 5)
  ✅ Desmond Bane PTS O18.5 (actual: 36)
  ✅ Knueppel PTS O19.5 (actual: 28)

#3 | Exploration | +596 | $447 profit
  ✅ Knueppel 3PT O3.5 (actual: 5)
  ✅ Vucevic REB O6.5 (actual: 8)
  ✅ Bane PTS O18.5 (actual: 36)

... (up to 10 winners shown)

💰 Total: +$4,132 profit across 6 winners

🔑 Key Players: Bane (PTS), Knueppel (3PT), Vucevic (REB)

📊 Powered by ParlayIQ Engine
```

The rating line ("Excellent Day", "Solid Day", "Decent Day") is based on winner count and total profit.

### New Files

**1. `supabase/functions/daily-winners-broadcast/index.ts`**

- Queries `bot_daily_parlays` for yesterday's date where `outcome = 'won'`
- Pulls `strategy_name`, `tier`, `expected_odds`, `profit_loss`, `legs`, `simulated_stake`
- Calculates total profit across all winners
- Formats into the clean Telegram report above
- Sends to `bot-send-telegram` with a new type `'daily_winners_recap'`
- Can accept `{ date: "2025-02-22" }` in the body to run for a specific date (for the initial invocation)

**2. Update `supabase/functions/bot-send-telegram/index.ts`**

- Add `'daily_winners_recap'` to the `NotificationType` union
- Add `formatDailyWinnersRecap()` function that renders the structured parlay winner data
- Add to the bypass list (always sends, ignores quiet hours)
- Add to customer broadcast block (same pattern as `mega_parlay_scanner`)

### Cron Job

After approval and deployment, set up a cron job via SQL:

```text
Schedule: 0 13 * * *  (13:00 UTC = 8:00 AM ET)
Target: daily-winners-broadcast
```

This runs every day at 8 AM Eastern and sends yesterday's winning parlays to all customers.

### After Deployment

Immediately invoke the function with yesterday's date to send the first report to all customers.

### Technical Summary

| File | Action |
|------|--------|
| `supabase/functions/daily-winners-broadcast/index.ts` | New -- fetches yesterday's won parlays, sends structured data to Telegram |
| `supabase/functions/bot-send-telegram/index.ts` | Add `daily_winners_recap` type, formatter, bypass, and customer broadcast |
| `supabase/config.toml` | Add `daily-winners-broadcast` function config |
| Cron job (SQL) | Schedule at 8 AM ET daily |

