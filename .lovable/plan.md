

## Refresh Defense Rankings + Add Offensive Rankings + Automate Daily Updates

### Current State

**Defense Data**: All 30 NBA teams have defensive rankings (`opp_points_rank`, `opp_threes_rank`, `opp_rebounds_rank`, `opp_assists_rank`) but they are **stale -- last updated December 19, 2025** (over 2 months old).

**Offensive Data**: The database columns exist (`off_points_rank`, `off_rebounds_rank`, `off_assists_rank`, `off_threes_rank`, `off_pace_rank`) but are **all NULL**. The `fetch-team-defense-ratings` function already has hardcoded offensive ranking data and the code to write it (lines 510-528), but it hasn't been run since those columns were added.

**Root Problem**: The `fetch-team-defense-ratings` function uses **hardcoded arrays** (lines 56-301) rather than scraping live data. Running it will populate offensive ranks but won't fix the staleness issue.

### Plan

#### 1. Convert `fetch-team-defense-ratings` to scrape live data from NBA.com

Replace the hardcoded `NBA_DEFENSE_RATINGS` and `OFFENSIVE_RANKINGS` arrays with live API calls to the NBA.com stats endpoint:
- **Defensive stats**: `https://stats.nba.com/stats/leaguedashteamstats` with `MeasureType=Opponent` to get opponent points, rebounds, assists, 3PM per game, then rank them 1-30
- **Offensive stats**: Same endpoint with `MeasureType=Base` to get team PPG, RPG, APG, 3PM/G, then rank 1-30
- **Pace**: Use `MeasureType=Advanced` to get team pace ratings

This ensures every time the function runs, it pulls **current season** data.

**Fallback**: Keep the hardcoded data as a fallback if the NBA.com API fails (rate limits, offseason, etc.)

#### 2. Write both defensive AND offensive rankings to all 3 target tables

The function currently writes to:
- `team_defensive_ratings` (position-specific, used by matchup-intelligence)
- `nba_opponent_defense_stats` (used by composite scoring)
- `team_defense_rankings` (used by `shouldAdjustLine()` and `calculateEnvironmentScore()`)

Ensure all three get updated with fresh data, and `team_defense_rankings` gets the offensive columns populated.

#### 3. Add daily cron schedule

Create a `pg_cron` job to run `fetch-team-defense-ratings` daily at **11:00 AM ET** (before the 3:00 PM generation deadline). This runs as part of the existing `engine-cascade-runner` pipeline (which already calls it at step 3), but adding a standalone cron ensures it runs even if the cascade isn't triggered.

### Technical Details

**File: `supabase/functions/fetch-team-defense-ratings/index.ts`**

- Add `fetchLiveNBAStats()` function that calls the NBA.com stats API endpoints
- Parse response to extract per-team opponent stats (OPP_PTS, OPP_REB, OPP_AST, OPP_FG3M) and team stats (PTS, REB, AST, FG3M, PACE)
- Rank teams 1-30 for each category (1 = fewest allowed for defense, 1 = most produced for offense)
- Fall back to existing hardcoded arrays if API returns errors
- Update the `updated_at` timestamp on all records so staleness is trackable

**Cron Job (SQL insert)**

```text
Schedule: Daily at 16:00 UTC (11:00 AM ET)
Target: fetch-team-defense-ratings with action='refresh'
```

### Impact

- The `shouldAdjustLine()` system will use current defensive data instead of 2-month-old rankings
- Offensive rankings (`off_points_rank`, etc.) will be populated, enabling the `calculateEnvironmentScore()` function to factor in team offensive strength
- Data refreshes automatically every day without manual intervention
- If NBA.com API is down, the system gracefully falls back to the last known good data

### Files Modified
- `supabase/functions/fetch-team-defense-ratings/index.ts` -- add live scraping, keep hardcoded fallback
- SQL insert for cron job schedule

