

# Add NCAA Baseball Data Ingestion

## Overview

Create a full NCAA baseball ingestion pipeline mirroring the existing NCAAB pattern: a player game log table, a team stats table, an ESPN-based data ingestion function, and wire it into the odds scraper and pipeline orchestrator.

## What Gets Built

### 1. Database Tables

**`ncaa_baseball_player_game_logs`** -- stores individual player box score data from ESPN
- Columns: player_name, team, game_date, opponent, at_bats, hits, runs, rbis, home_runs, stolen_bases, walks, strikeouts, batting_avg (per-game), innings_pitched, earned_runs, pitcher_strikeouts, is_home
- Unique constraint on (player_name, game_date) for upsert

**`ncaa_baseball_team_stats`** -- stores team-level efficiency metrics (analogous to KenPom for basketball)
- Columns: team_name, espn_id, conference, national_rank, runs_per_game, runs_allowed_per_game, era, batting_avg, home_record, away_record, updated_at
- Unique constraint on team_name for upsert

### 2. Edge Function: `ncaa-baseball-data-ingestion`

Modeled directly on `ncaab-data-ingestion`:
- Uses ESPN college baseball scoreboard API (`/sports/baseball/college-baseball/scoreboard`)
- Uses ESPN college baseball summary API for box scores
- Filters to players with active props in `unified_props` where `sport = 'baseball_ncaa'`
- Parses batting and pitching stats from ESPN box score labels
- Upserts into `ncaa_baseball_player_game_logs`
- Logs results to `cron_job_history`

### 3. Edge Function: `ncaa-baseball-team-stats-fetcher`

Modeled on `ncaab-team-stats-fetcher`:
- Uses ESPN college baseball teams API (`/sports/baseball/college-baseball/teams`)
- Fetches team-level stats (runs scored, runs allowed, ERA, batting avg) via parallel batches
- Computes national ranking by run differential
- Upserts into `ncaa_baseball_team_stats`

### 4. Wire Into Existing Pipeline

**`whale-odds-scraper/index.ts`**:
- Add `'baseball_ncaa'` to `TIER_2_SPORTS` array
- Add player market batch: `'baseball_ncaa': [['batter_hits', 'batter_rbis', 'batter_runs_scored', 'batter_total_bases']]`

**`data-pipeline-orchestrator/index.ts`**:
- Add `'baseball_ncaa'` to the sports arrays in Phase 1 (odds scraper), Phase 1 (track-odds-movement), and Phase 2 (whale-signal-detector)
- Add calls to `ncaa-baseball-data-ingestion` and `ncaa-baseball-team-stats-fetcher` in Phase 1

**`pp-props-scraper`** call in orchestrator:
- Add `'NCAAB_BASEBALL'` or appropriate sport tag if PrizePicks covers college baseball

## Technical Details

### ESPN API Endpoints
- Scoreboard: `https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard`
- Box Score: `https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/summary?event={id}`
- Teams: `https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/teams`

### Baseball-Specific Box Score Parsing
ESPN baseball labels differ from basketball. Expected labels include:
- Batting: AB, R, H, RBI, HR, BB, SO, SB, AVG
- Pitching: IP, H, R, ER, BB, SO, HR, ERA

The parser will extract both batting lines and pitching lines from each box score, storing them in the same table with nullable pitching columns.

### Odds API Sport Key
The Odds API uses `baseball_ncaa` for NCAA baseball. This will be used consistently throughout the scraper, signal detector, and scoring engine -- no normalization needed.

### Files Changed
1. **New**: `supabase/functions/ncaa-baseball-data-ingestion/index.ts`
2. **New**: `supabase/functions/ncaa-baseball-team-stats-fetcher/index.ts`
3. **Edit**: `supabase/functions/whale-odds-scraper/index.ts` -- add baseball_ncaa to tiers + markets
4. **Edit**: `supabase/functions/data-pipeline-orchestrator/index.ts` -- add baseball_ncaa to sport arrays + call new functions
5. **Migration**: Create two new tables with RLS disabled (service-role only access from edge functions)

