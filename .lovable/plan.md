

# Add NHL Scoring Factors to the Team Bets Scoring Engine

## Current State

The scoring engine (`team-bets-scoring-engine`) already has a `scoreNhl()` function (lines 228-295) with basic shot differential and home ice logic. However, it has three blockers:

1. **No `save_pct` column** -- the code references `homeStats?.save_pct` but that column doesn't exist in `nhl_team_pace_stats`. It silently falls back to 0.900 for every team, making the goaltending factor useless.
2. **No NHL game_bets exist** -- the whale signal detector uses sport key `hockey_nhl` while the odds scraper uses `icehockey_nhl`, so NHL odds never become `game_bets` rows. Zero NHL bets exist to score.
3. **Team name matching gap** -- the NHL map keys on full team names ("Colorado Avalanche") but odds API team names may differ. No fuzzy resolver exists like NCAAB has.

## Changes

### 1. Database: Add `save_pct` and `win_pct` columns to `nhl_team_pace_stats`

```sql
ALTER TABLE nhl_team_pace_stats
  ADD COLUMN IF NOT EXISTS save_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS win_pct NUMERIC;
```

These are derived stats:
- `save_pct` = 1 - (goals_against / shots_against) -- already have the source data
- `win_pct` = wins / games_played

### 2. Update `nhl-team-stats-fetcher` to calculate and store save_pct / win_pct

After fetching standings and shot data, compute:
- `save_pct = 1 - (goals_against_per_game / shots_against_per_game)` per team
- `win_pct = wins / games_played`

Store both in the upsert so the scoring engine has real goaltending data.

### 3. Fix sport key mismatch in `whale-signal-detector`

Change `hockey_nhl` to `icehockey_nhl` in:
- `ALL_SPORTS` array (line 12)
- `SPORT_THRESHOLDS` map (line 24)

This unblocks NHL odds from flowing into `game_bets`.

### 4. Enhance `scoreNhl()` in the scoring engine

Add these factors to the existing NHL scoring function:

- **Win percentage edge** (0-8 pts): Teams with significantly better records get a bonus
- **Shots against per game** (0-6 pts): Low SA/GP = strong defensive structure (separate from shot differential)
- **Record-based home ice** (0-4 pts): Bonus if team has 60%+ win rate at home (using win_pct as proxy)
- **NHL team name resolver**: Add fuzzy matching function mapping common odds API names to full names (e.g., "NY Rangers" to "New York Rangers")

Updated factor weights for NHL:

| Factor | Points | Source |
|--------|--------|--------|
| Shot differential | -12 to +12 | `shot_differential` |
| Save percentage | -8 to +8 | `save_pct` (new column) |
| Home ice | +4 | Side = HOME |
| Win % edge | -8 to +8 | `win_pct` (new column) |
| Defensive structure | 0-6 | `shots_against_per_game` |
| Sharp confirmation | 0-15 | `sharp_score` (existing) |
| Base | 50 | Starting score |

Total range: ~30-95

### 5. Add NHL tab to TeamBetsDashboard

Add `icehockey_nhl` as a sport option with a hockey emoji in the Team Bets UI. Update auto-detection to cascade: NBA -> NCAAB -> NHL.

## Technical Details

### Files Modified

1. **Database migration** -- Add `save_pct` and `win_pct` columns to `nhl_team_pace_stats`

2. **`supabase/functions/nhl-team-stats-fetcher/index.ts`**
   - Calculate `save_pct` and `win_pct` from existing data before upsert
   - Add both fields to the `TeamPaceStats` interface and upsert payload

3. **`supabase/functions/whale-signal-detector/index.ts`**
   - Replace `hockey_nhl` with `icehockey_nhl` in `ALL_SPORTS` and `SPORT_THRESHOLDS`

4. **`supabase/functions/team-bets-scoring-engine/index.ts`**
   - Add `NHL_NAME_MAP` for fuzzy team name matching (similar to `NCAAB_NAME_MAP`)
   - Add `resolveNhlTeam()` function to match odds API names to `nhl_team_pace_stats` entries
   - Enhance `scoreNhl()` with win_pct edge, defensive structure bonus, and real save_pct data
   - Update `nhlMap` construction to index by both `team_name` and `team_abbrev`

5. **`src/components/team-bets/TeamBetsDashboard.tsx`**
   - Add `icehockey_nhl` sport tab with hockey emoji
   - Update auto-detection cascade

### Execution After Deploy

1. Run migration to add columns
2. Trigger `nhl-team-stats-fetcher` to populate `save_pct` and `win_pct`
3. Trigger `whale-odds-scraper` for `icehockey_nhl` to create odds
4. Trigger `whale-signal-detector` (now with correct sport key) to create `game_bets`
5. Trigger `team-bets-scoring-engine` to score NHL bets with the full multi-factor engine
6. Verify NHL picks appear on the Team Bets page with reasoning pills

