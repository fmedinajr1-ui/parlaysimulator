

## Cross-Reference Shooting Percentages to Find Mispriced NBA Lines

### What This Does
Every NBA prop in `unified_props` gets cross-referenced against a player's actual shooting/stat percentages (FG%, FT%, 3P%, OREB, DREB, TO, FGM/FGA, FTM/FTA) calculated from their game logs. By comparing historical averages to the current sportsbook line, we can flag "mispriced" lines where the book's number is significantly off from what the data says.

For example: if a player averages 2.8 threes on 38% shooting with 7.4 attempts per game, and the book sets the line at 1.5 threes, that's a strong OVER signal. Conversely, if they're shooting 28% from three with declining attempts, an Over 2.5 line is mispriced in the other direction.

---

### Phase 1: Add Missing Stat Columns to `nba_player_game_logs`

The screenshot shows: 3PM, FG%, FT%, TO, OREB, DREB, 3PA, 3P%, FGM, FGA, FTM, FTA.

Currently missing from the table (need to add):
- `field_goals_made` (integer)
- `free_throws_made` (integer)
- `free_throws_attempted` (integer)
- `offensive_rebounds` (integer)
- `defensive_rebounds` (integer)
- `min` (text) -- raw minutes string for display

Already present: `threes_made`, `threes_attempted`, `field_goals_attempted`, `turnovers`, `rebounds` (total), `points`, `assists`, `blocks`, `steals`

**Database migration:** ALTER TABLE to add the 6 missing columns (all nullable integers, no breaking changes).

---

### Phase 2: Update ESPN Backfill to Capture All Stats

**File:** `supabase/functions/backfill-player-stats/index.ts`

Update the ESPN parser's `getStatByLabel` calls to also extract:
- `FGM` (from the `FG` label, split "5-10" to get made)
- `FGA` (from the `FG` label, split to get attempted -- already done for `field_goals_attempted`)
- `FTM` (from `FT` label, split for made)
- `FTA` (from `FT` label, split for attempted)
- `OREB` (ESPN provides this directly)
- `DREB` (ESPN provides this directly)

Update the upsert to include these new columns.

---

### Phase 3: Build Mispriced Line Detector Edge Function

**New file:** `supabase/functions/detect-mispriced-lines/index.ts`

Logic:
1. Pull all active NBA props from `unified_props` for today
2. For each player, fetch their last 10-20 games from `nba_player_game_logs`
3. Calculate per-game averages and shooting percentages:

```text
Stat          | How Calculated
--------------+------------------------------------------
FG%           | SUM(fgm) / SUM(fga)
FT%           | SUM(ftm) / SUM(fta)
3P%           | SUM(threes_made) / SUM(threes_attempted)
Avg 3PM       | AVG(threes_made)
Avg Points    | AVG(points)
Avg Rebounds   | AVG(rebounds)
Avg OREB      | AVG(offensive_rebounds)
Avg DREB      | AVG(defensive_rebounds)
Avg Assists   | AVG(assists)
Avg TO        | AVG(turnovers)
```

4. Compare each average to the sportsbook line to compute an **edge percentage**:

```text
edge = ((player_avg - line) / line) * 100
```

5. Flag as "mispriced" when:
   - Edge > +15% (strong OVER signal)
   - Edge < -15% (strong UNDER signal)
   - Shooting trend diverges (L5 avg vs L20 avg shows momentum)

6. Persist results to a new `mispriced_lines` table with columns: player_name, prop_type, book_line, player_avg_l10, player_avg_l20, edge_pct, signal (OVER/UNDER), shooting_context (JSON with FG%, 3P%, FT% etc.), confidence_tier, analysis_date

---

### Phase 4: Wire Into the Pipeline

**File:** `supabase/functions/engine-cascade-runner/index.ts`

Add `detect-mispriced-lines` as a step after `category-props-analyzer` in the cascade, so it runs automatically with each daily refresh.

---

### Phase 5: Backfill Historical Shooting Stats

After deploying the updated backfill function, run it with `days_back: 60` to populate the new columns for recent games. This gives us enough data for L10/L20 calculations immediately.

---

### Database Changes Summary

1. **ALTER** `nba_player_game_logs`: add 6 columns (field_goals_made, free_throws_made, free_throws_attempted, offensive_rebounds, defensive_rebounds, min)
2. **CREATE** `mispriced_lines` table: stores detected mispriced lines with edge calculations and shooting context

### Files to Modify
1. `supabase/functions/backfill-player-stats/index.ts` -- capture all shooting stats from ESPN
2. `supabase/functions/engine-cascade-runner/index.ts` -- add new step

### Files to Create
1. `supabase/functions/detect-mispriced-lines/index.ts` -- core mispricing detection logic

