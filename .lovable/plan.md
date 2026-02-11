

## Fix: Show Settled Parlays (Won/Lost) Across All Views

### Root Cause

1. **Bot Dashboard Parlays tab** only queries `bot_daily_parlays` for today's date -- settled parlays from previous days are invisible.
2. **Profile Parlay History** reads from `parlay_history` (user-uploaded slips), not from `bot_daily_parlays`. If you're logged in as a user without manually settled slips, you see nothing.
3. There is no "past settled parlays" view that spans multiple days.

### Database Status (confirmed)

- `bot_daily_parlays`: 13 won, 10 lost, 35 void, 9 pending (all settled ones from Feb 9)
- `parlay_history`: 59 settled for user `2839f89e`, 0 settled for other users
- `user_parlay_outcomes`: empty (no recorded outcomes)
- `bot_activation_status`: P/L calendar data exists and is writing correctly

### Plan

#### 1. Add "Recent Settled" Section to Bot Dashboard Parlays Tab

Update `useBotEngine` to include a second query fetching recently settled bot parlays (last 7 days, outcome != 'pending'):

```
bot_daily_parlays
  .select('*')
  .neq('outcome', 'pending')
  .neq('outcome', 'void')
  .order('settled_at', { ascending: false })
  .limit(20)
```

Display these in the Parlays tab below today's parlays, grouped as "Recent Results" with won/lost indicators.

#### 2. Make P/L Calendar Days Clickable

When you tap a day cell in `BotPnLCalendar`, show a detail panel listing the individual bot parlays for that date -- each with its outcome (won/lost/void), legs hit/missed, and profit/loss amount.

This requires:
- Adding a `selectedDate` state to the calendar
- A new query in `useBotPnLCalendar` that fetches `bot_daily_parlays` for the selected date
- A `DayDetailPanel` component showing the parlays

#### 3. Fix Profile Parlay History to Show Bot Parlays Too

Update `ParlayHistoryFeed` to also query `bot_daily_parlays` for the logged-in user's settled bot parlays (if any exist) and merge them with `parlay_history` entries. Alternatively, add a separate "Bot Results" section.

Note: `bot_daily_parlays` is not user-scoped (no `user_id` column), so this section would show all bot results. If user-scoping is needed, that's a separate migration.

### Technical Details

**Files to modify:**
- `src/hooks/useBotEngine.ts` -- Add `recentSettled` query for last 7 days of non-pending bot parlays
- `src/pages/BotDashboard.tsx` -- Render "Recent Results" section in the Parlays tab
- `src/hooks/useBotPnLCalendar.ts` -- Add `selectedDate` state and day-detail query
- `src/components/bot/BotPnLCalendar.tsx` -- Make day cells clickable, show detail panel
- `src/components/profile/ParlayHistoryFeed.tsx` -- Optionally merge bot parlay results

**New component:**
- `src/components/bot/DayParlayDetail.tsx` -- Panel showing individual parlays for a selected calendar day

**No database migrations needed** -- all data already exists in `bot_daily_parlays` and `bot_activation_status`.

