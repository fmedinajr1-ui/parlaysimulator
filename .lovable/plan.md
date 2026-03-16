

# Live Hedge Telegram Tracker — Using StatMuse Quarter Data

## Overview
Create a new edge function that sends Telegram updates for your War Room hedge picks, using **StatMuse-sourced quarter averages** from `player_quarter_baselines` (the same data powering the War Room quarter breakdowns) plus live game stats and rotation role analysis.

## Data Sources
- **Quarter Averages**: `player_quarter_baselines` table filtered by `data_source = 'statmuse'` — real per-quarter splits (Q1/Q2/Q3/Q4) for PTS, REB, AST, STL, BLK, 3PM
- **Live Stats**: `unified-player-feed` edge function for current game stats, pace, minutes
- **Rotation Role**: `player_profiles` table → `avg_minutes_per_quarter`, `avg_first_rest_time`, `role_tier`
- **Hedge Status**: Same buffer thresholds as War Room UI (`getBufferThresholds`)

## Implementation

### 1. DB Migration: `hedge_telegram_tracker` table
Tracks notification state per pick to prevent duplicate messages:
- `pick_id`, `player_name`, `prop_type`, `line`, `side`
- `last_status_sent` (LOCK/HOLD/MONITOR/ALERT/HEDGE NOW)
- `last_quarter_sent` (0–4)
- `pregame_sent` (boolean)
- `analysis_date`

### 2. New Edge Function: `hedge-live-telegram-tracker/index.ts`
Runs on 5-minute cron during game hours. Flow:
1. Fetch today's unsettled `category_sweet_spots` picks
2. For each player, fetch from `player_quarter_baselines` where `data_source = 'statmuse'` for real Q1–Q4 averages
3. Fetch `player_profiles` for rotation role (starter/bench/fringe), avg minutes per quarter
4. Call `unified-player-feed` for live stats (current value, pace, minutes played, game progress)
5. Calculate hedge status using progress-aware thresholds
6. Compare to `hedge_telegram_tracker` — only send if status changed or new quarter completed
7. Send via `bot-send-telegram`

### 3. Message Formats

**Pre-game scout** (~30 min before tipoff):
```
🏀 PRE-GAME SCOUT — Mar 16

🎯 LeBron James PTS O24.5
  ⭐ STARTER | ~36 min expected | Plays all 4Q
  📊 StatMuse Q-Avg: Q1: 7.2 | Q2: 6.8 | Q3: 5.9 | Q4: 6.1
  🔥 L10 Avg: 26.2

⚠️ Precious Achiuwa REB O8.5
  🪑 BENCH (~14 min/game) | Unlikely all 4Q
  ❌ FADE SIGNAL — bench player, inconsistent minutes
```

**Quarter-end / status change update**:
```
🎯 HEDGE UPDATE — LeBron James PTS O24.5

📊 Status: 🟡 MONITOR → 🔴 HEDGE ALERT
📈 Current: 12 pts | Projected: 21.3
⏱️ Q2 4:32 | Progress: 42%
🏃 Pace: 92 | Rate: 0.6/min

📋 StatMuse Q-Avg: Q1: 7.2 | Q2: 6.8 | Q3: 5.9 | Q4: 6.1
✅ Q1 Actual: 8 (above avg)
💡 Role: STARTER — expected to play closing minutes
```

### 4. Update `bot-send-telegram/index.ts`
Add two new notification types to the `NotificationType` union and `formatMessage` switch:
- `hedge_pregame_scout` — formats the pre-game briefing
- `hedge_live_update` — formats the in-game status update

### 5. Cron Schedule
```sql
-- Every 5 minutes during game hours (7 PM - 1 AM ET = 00:00 - 06:00 UTC)
select cron.schedule(
  'hedge-live-telegram-tracker',
  '*/5 * * * *',
  $$ select net.http_post(...) $$
);
```

### 6. Bench Player Detection Logic
From `player_profiles`:
- `avg_minutes` < 20 → `BENCH`
- `avg_minutes` < 15 → `BENCH_FRINGE`
- `avg_minutes` >= 28 → `STARTER` (plays all 4Q)
- Message includes "⚠️ BENCH — consider fading" for fringe players

## Files to Create/Edit
- **Create**: `supabase/functions/hedge-live-telegram-tracker/index.ts`
- **Edit**: `supabase/functions/bot-send-telegram/index.ts` — add 2 notification types
- **DB Migration**: Create `hedge_telegram_tracker` table
- **Cron**: Schedule via pg_cron (insert tool)

