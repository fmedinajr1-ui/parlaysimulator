

# Implement All 17 Telegram Bot Features

All changes go into one file: `supabase/functions/telegram-webhook/index.ts`. No database migrations needed -- all data already exists in the tables.

---

## Batch 1: Analytics and Reporting (4 features)

### 1. `/roi` -- ROI Breakdown
Queries `bot_daily_parlays` (settled) grouped by strategy_name and date ranges (7d, 30d, all-time). Also queries `bot_category_weights` for per-category hit rates. Output shows ROI by tier, top/bottom categories, and time period comparison.

### 2. `/streaks` -- Hot/Cold Streaks
Queries `bot_category_weights` for `current_streak`, `best_streak`, `worst_streak` columns. Also queries `category_sweet_spots` for recent player-level streaks (consecutive hits/misses). Shows top 5 hot streaks and top 5 cold streaks.

### 3. `/compare [7d vs 30d]` -- Period Comparison
Queries `bot_daily_parlays` with date filters for two periods. Calculates win rate, ROI, avg odds, best strategy for each period. Displays side-by-side comparison.

### 4. Weekly Sunday Digest (auto-cron)
Create a new cron job that fires every Sunday at 10 AM ET. It calls a new handler `handleWeeklySummary` that compiles 7-day P&L, best/worst categories, top strategies, and sends via `bot-send-telegram`. Requires a new cron schedule SQL insert (not a migration).

---

## Batch 2: Intelligence and Strategy (4 features)

### 5. `/sharp` -- Highest Edge Categories
Queries `bot_category_weights` where `is_blocked = false`, sorted by `current_hit_rate DESC`. Shows top 10 with hit rate, sample size, and weight. Highlights "golden" categories (60%+ hit rate, 20+ samples).

### 6. `/avoid` -- Blocked Categories
Queries `bot_category_weights` where `is_blocked = true`. Shows category, block reason, hit rate, and sample count. Also shows categories close to being blocked (hit rate 40-45%).

### 7. `/backtest [strategy]` -- On-Demand Backtest
Queries `bot_daily_parlays` filtered by `strategy_name ILIKE '%input%'`. Calculates historical win rate, ROI, avg odds, best/worst day. If no strategy name given, lists available strategies from `bot_strategies`.

### 8. Auto-Research Trigger
Add a check in the `/settle` handler: after settlement, if the 7-day rolling win rate drops below 35%, automatically invoke the `ai-research-agent` and notify via Telegram. This piggybacks on existing settlement flow.

---

## Batch 3: Real-Time and Alerts (3 features)

### 9. Live Game Alerts
This requires a polling mechanism. Add a new edge function `bot-check-live-props` that runs every 15 minutes during game hours (7 PM - 12 AM ET). It checks `category_sweet_spots` for today's picks, cross-references with `nba_player_game_logs` for final stats, and sends a Telegram alert when a tracked pick hits or misses.

### 10. Line Movement Alerts
Add logic to the `whale-odds-scraper` flow: after scraping, compare new lines against `category_sweet_spots` recommended lines. If a line moves more than 1.5 points on an active pick, send a Telegram notification via `bot-send-telegram`.

### 11. `/watch [player]` -- Player Tracking
Queries `category_sweet_spots` and `unified_props` for the given player name (case-insensitive search). Shows all active props, lines, hit rates, and upcoming matchups. No persistent watch list needed -- it's a live lookup.

---

## Batch 4: Control and Configuration (3 features)

### 12. `/pause` and `/resume` -- Toggle Bot
Uses the `bot_activation_status` table. On `/pause`, update today's record with a flag or insert a row into `bot_activity_log` with event_type `bot_paused`. The `/generate` handler checks for this flag before running. On `/resume`, clear the flag.

Since there's no `is_paused` column, we'll add a simple convention: check `bot_activity_log` for the most recent `bot_paused` or `bot_resumed` event to determine state. No schema change needed.

### 13. `/bankroll [amount]` -- Update Bankroll
Parses the amount from the command text (e.g., `/bankroll 1500`). Updates `bot_activation_status` for today's record (`simulated_bankroll` or `real_bankroll` depending on mode). Validates input is a positive number.

### 14. `/force-settle [date]` -- Manual Settlement
Parses date from command (e.g., `/force-settle 2026-02-08`). Invokes `bot-settle-and-learn` with `{ targetDate: date }` in the request body. Returns settlement results.

---

## Batch 5: UX Improvements (3 features)

### 15. Inline Buttons
Modify `sendMessage` to support an optional `reply_markup` parameter for Telegram inline keyboards. Add "View Legs" buttons to parlay messages in `/parlays`. Handle callback queries in the main webhook handler to show leg details when buttons are pressed.

### 16. `/subscribe` and `/unsubscribe` -- Toggle Notifications
Queries and updates `bot_notification_settings`. `/subscribe` shows current settings and toggles. `/unsubscribe [type]` disables a specific notification type. Without arguments, shows current subscription status.

### 17. `/export [date]` -- Data Export
Queries `category_sweet_spots` for the given date. Formats all picks as a plain-text table (player, prop, line, side, outcome, actual). Sends as a long Telegram message (split into chunks if over 4096 chars).

---

## Updated `/start` Help Text

Reorganized into sections:
- **Core**: /status, /parlays, /performance, /weights, /calendar
- **Actions**: /generate, /settle, /force-settle
- **Analytics**: /roi, /streaks, /compare, /sharp, /avoid, /backtest
- **Learning**: /learning, /tiers, /explore, /validate
- **Multi-Sport**: /nhl, /tennis, /spreads, /totals
- **Intelligence**: /research, /watch
- **Control**: /pause, /resume, /bankroll, /subscribe, /export

---

## Technical Notes

- All 17 handlers are added to `telegram-webhook/index.ts`
- The file is already 1047 lines; this will grow it significantly but keeps everything in one deployable function
- The weekly digest cron requires a separate SQL insert (not a migration) to schedule it
- Live game alerts require a new edge function (`bot-check-live-props`) with its own cron
- Line movement alerts hook into existing scraper flow
- Inline button support requires handling `callback_query` in addition to `message` in the main webhook handler
- Input validation on `/bankroll` and `/force-settle` to prevent injection
- Messages over 4096 chars (Telegram limit) will be split into multiple sends

