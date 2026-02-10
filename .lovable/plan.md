

# P&L Calendar for Bot Dashboard

## Overview
Build a visual calendar showing daily profit/loss for the bot, with color-coded cells, streak tracking, and monthly stats. Add a `/calendar` Telegram command with a monthly summary and link to the dashboard.

## What gets built

### 1. New Component: `BotPnLCalendar.tsx`
A monthly calendar grid component placed on the Bot Dashboard page (`/bot`).

- **Calendar grid** showing each day of the selected month
- **Color-coded cells**: green for profit days, red for loss days, neutral for no-data days
- **Cell content**: shows daily P&L amount (e.g., +$42 or -$18)
- **Monthly navigation**: prev/next month arrows with month/year selector
- **Monthly summary bar** at top: total P&L, win days vs loss days, best day, worst day, current streak, best streak
- **Data source**: `bot_activation_status` table (already has `check_date`, `daily_profit_loss`, `is_profitable_day`, `parlays_won`, `parlays_lost`, `simulated_bankroll`)

### 2. New Hook: `useBotPnLCalendar.ts`
Fetches `bot_activation_status` rows for the selected month range. Computes:
- Daily P&L map (date -> profit/loss)
- Monthly totals, streaks, best/worst days
- Win rate by month

### 3. Add to Bot Dashboard
Insert `BotPnLCalendar` into `BotDashboard.tsx` near the top (after activation card, before today's parlays).

### 4. Telegram `/calendar` Command
Add a `/calendar` command handler in `telegram-webhook/index.ts` that:
- Fetches current month's `bot_activation_status` data
- Formats a monthly summary: W-L record, total P&L, best day, worst day, current streak
- Includes a link to the dashboard calendar view

### 5. Update Telegram `/start` help
Add `/calendar` to the command list in the start message.

---

## Technical Details

### BotPnLCalendar component structure
- Uses `date-fns` for month/day calculations (already installed)
- State: `selectedMonth` (Date)
- Query: fetch `bot_activation_status` where `check_date` between first and last day of month
- Renders a 7-column CSS grid (Sun-Sat) with day cells
- Each cell shows: day number, P&L amount, small W/L indicator
- Header row: S M T W T F S

### Monthly summary stats
```text
+---------------------------------------+
| Feb 2026                    < >       |
| P&L: +$182 | 12W-6L | Best: +$95    |
| Streak: 3W | Worst: -$42 | ROI: 18% |
+---------------------------------------+
| S   M   T   W   T   F   S            |
|     1   2   3   4   5   6            |
|    +42 -18 +25 +12  --  --           |
| 7   8   9  ...                       |
+---------------------------------------+
```

### Telegram /calendar output format
```
📅 February 2026 P&L

Record: 12W - 6L (67%)
Total P&L: +$182
Best Day: Feb 8 (+$95)
Worst Day: Feb 3 (-$42)
Current Streak: 3W
Bankroll: $1,182

📊 View full calendar:
https://parlaysimulator.lovable.app/bot
```

### Files to create
- `src/components/bot/BotPnLCalendar.tsx` - Calendar component
- `src/hooks/useBotPnLCalendar.ts` - Data hook

### Files to modify
- `src/pages/BotDashboard.tsx` - Add calendar component
- `supabase/functions/telegram-webhook/index.ts` - Add `/calendar` command + update `/start`

