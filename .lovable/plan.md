

# Daily NHL Floor Lock Parlay + Bidirectional Scanner + Data Refresh — Cron Setup

## What We're Adding

Three new daily cron jobs:

### 1. NHL Data Refresh + Sweet Spots Scan (11:00 AM ET / 16:00 UTC)
Runs before parlays are built. Sequence:
- `nhl-stats-fetcher` — refresh game logs
- `nhl-team-defense-rankings-fetcher` — refresh defensive rankings
- `nhl-prop-sweet-spots-scanner` — scan props against fresh L10 data

### 2. NHL Floor Lock Parlay Build + Broadcast (12:00 PM ET / 17:00 UTC)
New edge function `nhl-floor-lock-daily` that:
- Queries `category_sweet_spots` for NHL props with 100% L10 hit rate (`actual_hit_rate = 1.0`) and `l10_min >= 1`
- Builds a 4-5 leg floor lock parlay from the highest-conviction picks
- Inserts into `bot_daily_parlays` with `strategy_name = 'nhl_floor_lock'`
- Sends formatted Telegram broadcast via `bot-send-telegram`

### 3. Bidirectional Matchup Scanner Broadcast (12:30 PM ET / 17:30 UTC)
New edge function `nba-matchup-daily-broadcast` that:
- Runs `bot-matchup-defense-scanner` (bidirectional)
- Queries results from `bot_research_findings` 
- Formats elite/prime/avoid matchups and sends via `bot-send-telegram`

## Cron Schedule Summary

| Job | Time (ET) | UTC | Function |
|-----|-----------|-----|----------|
| NHL data refresh | 11:00 AM | 16:00 | `nhl-floor-lock-daily` (orchestrates 3 sub-steps) |
| NHL Floor Lock broadcast | 12:00 PM | 17:00 | `nhl-floor-lock-daily` (build + send) |
| NBA Matchup broadcast | 12:30 PM | 17:30 | `nba-matchup-daily-broadcast` |

Actually, simpler: one orchestrator function `nhl-floor-lock-daily` handles refresh → scan → build → send. A separate `nba-matchup-daily-broadcast` handles the bidirectional scanner broadcast.

## Files to Create/Modify

1. **`supabase/functions/nhl-floor-lock-daily/index.ts`** (NEW) — Orchestrator: refreshes NHL data, scans sweet spots, builds floor lock parlay from 100% hit rate picks, inserts to `bot_daily_parlays`, broadcasts via Telegram
2. **`supabase/functions/nba-matchup-daily-broadcast/index.ts`** (NEW) — Runs bidirectional scanner then formats and broadcasts elite/prime/avoid matchups to Telegram  
3. **3 new `pg_cron` jobs** via SQL insert — schedule both functions daily

