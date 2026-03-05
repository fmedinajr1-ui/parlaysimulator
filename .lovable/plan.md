

# Load NHL Goalie Props Data + NHL Defense/Offense Rankings for Parlay Engine

## Current State
- **`nhl_player_game_logs`** has 11,995 skater records (forwards + defensemen) but **zero goalie data** — the ESPN fetcher explicitly skips the "goaltenders" category (line 83)
- **`nhl_team_pace_stats`** has team-level offensive/defensive stats (shots for/against, goals for/against, save %, win %) but no goalie-specific or prop-specific defensive rankings
- No `nhl_goalie_game_logs` table exists

## What We Need

### 1. New `nhl_goalie_game_logs` table
Stores per-game goalie stats for L10 analysis:

| Column | Type | Description |
|--------|------|-------------|
| player_name | text | Goalie name |
| game_date | date | Game date |
| opponent | text | Opponent abbreviation |
| is_home | boolean | Home/away |
| saves | integer | Total saves (key prop) |
| shots_against | integer | Shots faced |
| goals_against | integer | Goals allowed |
| save_pct | numeric | Game save % |
| minutes_played | integer | TOI |
| win | boolean | Got the W |
| shutout | boolean | Shutout game |

Unique constraint on `(player_name, game_date)` for upserts.

### 2. New `nhl_team_defense_rankings` table
Prop-specific offensive/defensive rankings for matchup scoring:

| Column | Type | Description |
|--------|------|-------------|
| team_abbrev | text (PK) | Team abbreviation |
| goals_for_rank | integer | Offensive goals rank (1=most) |
| goals_against_rank | integer | Defensive goals rank (1=fewest) |
| shots_for_rank | integer | Shot generation rank |
| shots_against_rank | integer | Shot suppression rank |
| power_play_rank | integer | PP efficiency rank |
| penalty_kill_rank | integer | PK efficiency rank |
| goals_for_per_game | numeric | Avg goals scored |
| goals_against_per_game | numeric | Avg goals allowed |
| shots_for_per_game | numeric | Avg shots generated |
| shots_against_per_game | numeric | Avg shots faced |
| season | text | Season identifier |
| updated_at | timestamptz | Last refresh |

### 3. Update `nhl-stats-fetcher` to capture goalies
- Remove the `if (categoryName !== 'forwards' && categoryName !== 'defensemen') continue` gate
- Add a `categoryName === 'goaltenders'` branch that parses ESPN goalie stats (SA, GA, SV, SV%, TOI, W) and inserts into `nhl_goalie_game_logs`
- ESPN goalie stat order: SA, GA, SV, SV%, TOI (index positions vary — will log and map)

### 4. Create `nhl-team-defense-rankings-fetcher` edge function
- Reads from `nhl_team_pace_stats` (already populated by `nhl-team-stats-fetcher`)
- Computes rank columns by sorting teams on each metric
- Upserts into `nhl_team_defense_rankings`
- Could also be computed from NHL API standings endpoint for PP%/PK%

### 5. Backfill goalie data
- Run the updated `nhl-stats-fetcher` with `daysBack: 60` to populate ~2 months of goalie game logs for L10 analysis

## Files Changed
1. **SQL migration** — create `nhl_goalie_game_logs` and `nhl_team_defense_rankings` tables
2. **`supabase/functions/nhl-stats-fetcher/index.ts`** — add goaltender parsing branch for both ESPN and NHL API paths
3. **`supabase/functions/nhl-team-defense-rankings-fetcher/index.ts`** (new) — compute and persist prop-specific rankings from existing team stats
4. **`supabase/config.toml`** — register new edge function

## Execution Order
1. Create tables via migration
2. Update `nhl-stats-fetcher` with goalie parsing
3. Deploy and invoke with `daysBack: 60` to backfill
4. Create and deploy rankings fetcher
5. Verify data in both tables

