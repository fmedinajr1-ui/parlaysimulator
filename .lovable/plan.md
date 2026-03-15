

# Add NBA Stats API as Direct Per-Quarter Data Source

## The Opportunity

Your project already successfully calls `stats.nba.com` from edge functions (the `fetch-team-defense-ratings` function does this today with proper headers). The NBA Stats API has a `boxscoretraditionalv2` endpoint that supports **actual per-quarter player stats** using `RangeType=2` with period-specific time ranges. This eliminates the need for the snapshot delta workaround entirely.

## How It Works

The `boxscoretraditionalv2` endpoint accepts these parameters to return stats for a specific quarter only:

```text
Q1: StartPeriod=1, EndPeriod=1, StartRange=0,     EndRange=7200,  RangeType=2
Q2: StartPeriod=2, EndPeriod=2, StartRange=7200,   EndRange=14400, RangeType=2
Q3: StartPeriod=3, EndPeriod=3, StartRange=14400,  EndRange=21600, RangeType=2
Q4: StartPeriod=4, EndPeriod=4, StartRange=21600,  EndRange=28800, RangeType=2
```

This returns exactly what each player scored in that quarter — no delta math, no snapshot timing issues.

## Challenge: Game ID Format

Your system uses ESPN event IDs (e.g., `401810828`), but the NBA API uses NBA game IDs (e.g., `0022500974`). We need a mapping step. The NBA CDN scoreboard (`cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json`) provides NBA game IDs with team matchup info we can cross-reference.

## Plan

### 1. New edge function: `backfill-quarter-stats`

A function that runs after games finish to fetch **real per-quarter player stats** from the NBA Stats API and populate `quarter_player_snapshots` with accurate data.

**Flow:**
1. Query `live_game_scores` for games with status `final` 
2. Fetch NBA CDN scoreboard to get NBA game IDs, match to ESPN events by team names
3. For each game, call `boxscoretraditionalv2` 4 times (once per quarter) with `RangeType=2`
4. Parse player stats (PTS, REB, AST, FG3M, STL, BLK) per quarter
5. Upsert into `quarter_player_snapshots` — overwriting any delta-based estimates

### 2. Update `auto-quarter-snapshots` 

Keep as-is for **live in-game** updates (still useful for real-time progression during games). The backfill function will correct any inaccuracies after games complete.

### 3. Update `get-player-quarter-profile`

No changes needed — it already reads from `quarter_player_snapshots`. Once the backfill function writes accurate data, the quarter averages will be correct automatically.

### 4. Schedule the backfill

Add a cron job to run `backfill-quarter-stats` every 30 minutes (catches games as they finish).

## What Changes

| File | Change |
|------|--------|
| `supabase/functions/backfill-quarter-stats/index.ts` | **New** — fetches real per-quarter stats from NBA Stats API for completed games |
| Cron job | Schedule backfill to run every 30 minutes |

## Result

- **During games**: Live progression still works via `auto-quarter-snapshots` (delta-based, best-effort)
- **After games**: `backfill-quarter-stats` overwrites with **exact per-quarter stats** from the NBA Stats API
- **Quarter averages**: Based on real data — Russell Westbrook's Q1/Q2/Q3/Q4 breakdown will reflect what he actually scored in each quarter

