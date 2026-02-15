

# Gap Analysis: Missing Historical Data, Projections, and Points Allowed

## Current State Summary

After auditing the database and pipeline, here are the specific gaps hurting the bot's totals performance (33% OVER hit rate, 38% UNDER hit rate):

---

## GAP 1: NCAAB Team Stats Are Incomplete (Critical)

**The `ncaab_team_stats` table has 200 teams but is missing key columns:**
- `conference` -- NULL for all 200 rows
- `away_record` -- NULL for all 200 rows
- `ats_record` -- NULL for all 200 rows (ATS cover tracking)
- `over_under_record` -- NULL for all 200 rows (O/U hit tracking)

**Impact:** The scoring engine has logic to use ATS records and O/U records for bonuses, but they're always NULL so these signals are dead. Conference data for same-conference penalties also never fires.

**Fix:** Update the `ncaab-team-stats-fetcher` to extract these fields from ESPN's API response. The fetcher already gets `home_record` successfully, so the same `record.items` data contains `away`, and the stats detail endpoint has ATS/O/U data.

---

## GAP 2: No Points Allowed Per Game in NCAAB Stats (Critical)

**The `ncaab_team_stats` table stores `adj_defense` (efficiency rating) but NOT raw `ppg_allowed`.**

The scoring engine uses `adj_defense` as an efficiency proxy, but this doesn't tell you the actual points a team gives up. A team with adj_defense of 65 in a slow conference plays very differently from a team with adj_defense of 65 in a fast conference.

**Fix:** Add `ppg` and `oppg` (opponent PPG / points allowed) columns to `ncaab_team_stats`. The fetcher already extracts `ppg` and `oppg` from ESPN (lines 85-126) but only uses them to calculate `adj_offense` and `adj_defense` -- the raw values get discarded instead of stored.

---

## GAP 3: No Historical Game Results for Settlement or Backtesting

**There is no table storing team-level game results (final scores).**

- `game_bets` has no `actual_score` or `final_score` column -- just `outcome` (win/loss/void)
- No `team_game_results` or `ncaab_game_results` table exists
- The bot can't look at "last 5 game scores" or "PPG in last 10" for teams because there's no historical score data

**Impact:** The AI Research Agent references "last 5 scores" and "PPG allowed" for NCAAB, but there's no underlying data table to query. This means research findings are either generic or hallucinated by the AI.

**Fix:** Create a `team_game_results` table and populate it from ESPN's scoreboard API during settlement, storing home/away teams and final scores. This enables:
- Last-N-games scoring trends
- Home vs away PPG differentials  
- Recent form tracking for totals

---

## GAP 4: Projected Total Has No Defensive Adjustment (Medium)

The current projected total formula in `team-bets-scoring-engine` (line 187):
```
projectedTotal = ((homeOff + awayOff) / 2) * tempoFactor * 2
```

This only uses **offensive** efficiency. It completely ignores defensive efficiency (`homeDef`, `awayDef`), even though those values are loaded. A matchup between two elite offenses (82+ adj_offense) with elite defenses (62 adj_defense) will project way too high.

**Fix:** Use the standard KenPom-style formula:
```
projectedTotal = (homeOff + awayOff - homeDef - awayDef + avgD2) * tempoFactor
```
Where `avgD2` is the D1 average PPG (~70). This properly accounts for defense.

---

## GAP 5: NBA Defense Data Is Hardcoded / Stale (Low-Medium)

The `fetch-team-defense-ratings` function has all 30 NBA team defense ratings **hardcoded** as static data (lines 50-400+). These are 2024-25 season numbers that don't update automatically.

Meanwhile, the `nba_opponent_defense_stats` table exists with 30 rows but it's unclear if it auto-refreshes.

**Impact:** Player prop projections against stale defense ratings will drift as the season progresses.

---

## Implementation Plan

### Phase 1: Enrich NCAAB Team Stats (fetcher + schema)
1. Add `ppg` and `oppg` columns to `ncaab_team_stats`
2. Update `ncaab-team-stats-fetcher` to:
   - Store raw `ppg` and `oppg` values (already extracted, just discarded)
   - Extract `away_record` from ESPN `record.items` (same pattern as `home_record`)
   - Extract `conference` from team group data (already fetched on line 68)
3. Re-run the fetcher to populate all 200 teams

### Phase 2: Create Team Game Results Table
1. Create `team_game_results` table:
   - `sport`, `game_date`, `home_team`, `away_team`, `home_score`, `away_score`, `total_score`
2. Build a `fetch-team-game-results` function that pulls recent completed games from ESPN's scoreboard
3. Wire it into the settlement pipeline so results accumulate automatically

### Phase 3: Fix Projected Total Formula
1. Update `team-bets-scoring-engine` to use the defense-adjusted projection formula
2. This alone could materially improve totals accuracy since the current formula ignores half the equation

### Phase 4: Wire Historical Data Into Scoring
1. Add "last 5 games PPG" and "last 5 opponent PPG" lookups from `team_game_results`
2. Apply recent-form bonuses/penalties to the totals scoring engine
3. Flag teams on hot/cold scoring streaks

---

## Priority

1. **Phase 3** (fix projected total formula) -- quickest win, 1 function edit
2. **Phase 1** (enrich NCAAB stats) -- medium effort, unlocks multiple scoring signals  
3. **Phase 2** (game results table) -- enables backtesting and trend analysis
4. **Phase 4** (historical scoring integration) -- depends on Phase 2

