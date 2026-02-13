

# Fix NCAA Baseball Stats Fetcher: Switch to ESPN Standings Endpoint

## Problem
The current `ncaa-baseball-team-stats-fetcher` calls the individual team endpoint (`/teams/{id}`) for each of 234 teams. This endpoint is returning 400 errors for college baseball, resulting in all stat columns (ERA, batting avg, runs per game, etc.) being NULL. This means the scoring engine has no statistical data to work with.

## Solution
Replace the broken individual-team enrichment with the ESPN **standings** endpoint, which returns all teams with their records and stats in a single bulk request per conference. This is the same pattern already used successfully in `fetch-season-standings` for NBA and NFL.

## How It Works

### Current (broken) flow:
1. Fetch all team IDs via `/teams?limit=100&page=X` (6 pages)
2. For each team, call `/teams/{id}` individually (200+ requests) -- **these return 400 errors**
3. Parse `record.items` for stats -- **no data returned**

### New flow:
1. Fetch standings from `https://site.api.espn.com/apis/v2/sports/baseball/college-baseball/standings`
2. Parse all conferences and their team entries in one response
3. Extract wins, losses, win percentage, points for/against, home/away records
4. Calculate runs per game and runs allowed per game from the standings stats
5. Fall back to team list endpoint only for teams missing from standings (if any)

## Technical Details

### File: `supabase/functions/ncaa-baseball-team-stats-fetcher/index.ts`

**Full rewrite** of the fetcher to:

1. **Replace `ESPN_TEAMS_URL` with standings URL**:
   - Primary: `https://site.api.espn.com/apis/v2/sports/baseball/college-baseball/standings`
   - Fallback team list: keep existing `/teams` endpoint for any missing teams

2. **New `fetchStandings()` function** replacing `fetchAllTeamIds()` + `enrichTeamStats()`:
   - Single request fetches all conferences
   - Parse `data.children[]` (conferences) -> `standings.entries[]` (teams)
   - Extract from `entry.stats[]`: wins, losses, winPercent, avgPointsFor, avgPointsAgainst, home/away records
   - Map stat names to our schema (runs_per_game, runs_allowed_per_game, etc.)
   - Conference name from `conference.name` or `conference.abbreviation`

3. **Preserve existing logic**:
   - National ranking by run differential (unchanged)
   - Upsert to `ncaa_baseball_team_stats` on conflict `team_name` (unchanged)
   - Cron job history logging (unchanged)
   - Time budget safety (45s, unchanged)

4. **Stat mapping** (from ESPN standings stat names):
   - `avgPointsFor` or `pointsFor` / games -> `runs_per_game`
   - `avgPointsAgainst` or `pointsAgainst` / games -> `runs_allowed_per_game`
   - `Home_display` or `home_display` -> `home_record`
   - `Road_display` or `away_display` -> `away_record`
   - ERA and batting average are not in standings data -- these will remain NULL (standings don't include pitching/batting detail stats)

### Post-deploy steps (automated):
1. Deploy the updated edge function
2. Invoke `ncaa-baseball-team-stats-fetcher` to re-enrich all teams
3. Invoke `team-bets-scoring-engine` for `baseball_ncaa` to rescore today's bets with real stat data

## Trade-offs
- **ERA and batting_avg will remain NULL** since standings data doesn't include detailed pitching/batting stats. However, runs_per_game, runs_allowed_per_game, home/away records, and national rank will all be populated -- which are the primary inputs to `scoreBaseballNcaa`.
- This is a massive improvement over the current state where ALL columns are NULL.

