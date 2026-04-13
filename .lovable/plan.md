

# Line-Sum vs Defensive-Allowed Mismatch Analyzer

## What It Does
An automated edge function that, for every NBA/NHL/MLB game on today's slate:
1. Sums all player prop lines per team per stat category (points, rebounds, assists for NBA; goals, shots, points for NHL; hits, RBIs, runs for MLB)
2. Cross-references the summed lines against what the opposing team allows per game defensively
3. Computes the gap (defensive allowed minus summed lines) and ranks all games by biggest mismatch
4. Stores results in a new table for daily review and signal generation

## New Database Table

**`line_sum_mismatch_analysis`**
- `id` (uuid, PK)
- `sport` (text) — basketball_nba, icehockey_nhl, baseball_mlb
- `game_description` (text) — "Miami Heat @ Charlotte Hornets"
- `event_id` (text)
- `team_name` (text) — the team whose players are summed
- `opponent_name` (text)
- `stat_category` (text) — points, rebounds, assists, goals, etc.
- `summed_player_lines` (numeric) — total of all player lines for this team+stat
- `players_counted` (int) — how many players included
- `opponent_defensive_allowed` (numeric) — what opponent allows per game
- `opponent_defensive_rank` (int) — rank (1=best defense)
- `gap` (numeric) — defensive_allowed minus summed_lines (positive = OVER opportunity)
- `gap_pct` (numeric) — gap as % of defensive allowed
- `direction_signal` (text) — OVER or UNDER based on gap
- `analysis_date` (date)
- `created_at` (timestamptz)

Unique constraint on `(sport, game_description, team_name, stat_category, analysis_date)`.

## Edge Function: `line-sum-mismatch-analyzer`

### Logic Flow

1. **Get today's games** — query `unified_props` for distinct `game_description` per sport where `commence_time` is today
2. **NBA analysis**:
   - For each game, extract home/away team names from `game_description` ("Away @ Home")
   - Join player names to teams via `bdl_player_cache.team_name`
   - Sum `current_line` per team for `player_points`, `player_rebounds`, `player_assists`
   - Look up opponent's `stat_allowed_per_game` from `team_defensive_ratings` (position_group = 'all')
   - Compute gap = allowed - summed
3. **NHL analysis**:
   - Sum `player_goals`, `player_assists`, `player_shots_on_goal` per team
   - Cross-reference `nhl_team_defense_rankings` for `goals_against_per_game`, `shots_against_per_game`
   - NHL player-to-team mapping derived from `game_description` team names
4. **MLB analysis**:
   - Sum `batter_hits`, `batter_rbis`, `batter_runs_scored` per team
   - No MLB defensive ratings table exists yet, so store summed lines with null defensive data (future enrichment)
5. **Rank and store** — upsert all rows, compute gap_pct, assign direction_signal (positive gap = OVER, negative = UNDER)

### Team Name Resolution
- NBA: `bdl_player_cache.team_name` matches `team_defensive_ratings.team_name` (handle "LA Clippers" vs "Los Angeles Clippers")
- NHL: Parse team names from `game_description`, match to `nhl_team_defense_rankings.team_name`
- MLB: Parse from `game_description`, no defensive table yet

### Pipeline Integration
Add this function call to `morning-prep-pipeline` after the analysis phase (after step 4.7b), so it runs daily with fresh odds data.

## Technical Details
- Migration creates the table with RLS disabled (internal analytics only)
- Edge function processes all 3 sports in one invocation
- Results ordered by `abs(gap_pct)` descending to surface biggest mismatches
- Telegram summary sent with top 5 mismatches across all sports

