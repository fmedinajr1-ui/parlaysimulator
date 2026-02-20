

## Add MLB Cross-Reference to Mispriced Line Detector

### Overview
Extend the existing `detect-mispriced-lines` function to also analyze MLB player props using the 24,000+ game logs already backfilled from last year. Since the MLB season just started, all historical data comes from the 2024 season (July-November in the database). The function will use this full-season data to calculate player averages and compare against current book lines.

Instead of NBA shooting context (FG%, 3P%, FT%), MLB will use baseball-specific context: **AVG, OBP, SLG, OPS** -- matching the stats shown in the screenshot.

---

### Database Change

**Add `sport` column to `mispriced_lines` table** so we can distinguish NBA vs MLB results:
- Column: `sport` (text, default `'basketball_nba'`)
- Backfill existing rows to `'basketball_nba'`
- Update the unique constraint to include sport: `(player_name, prop_type, analysis_date, sport)`

---

### Code Changes (1 file)

**File: `supabase/functions/detect-mispriced-lines/index.ts`**

Add MLB support alongside the existing NBA logic:

1. **New MLB prop-to-stat mapping:**
   - `batter_hits` -> `hits`
   - `batter_rbis` -> `rbis`
   - `batter_runs_scored` -> `runs`
   - `batter_total_bases` -> `total_bases`
   - `batter_home_runs` -> `home_runs`
   - `batter_stolen_bases` -> `stolen_bases`
   - `pitcher_strikeouts` -> `pitcher_strikeouts`
   - `pitcher_outs` -> (skip for now, not in game logs)

2. **New `calcBaseballContext(logs)` function** computing from raw game log data:

| Stat | Formula |
|------|---------|
| AVG  | total hits / total at_bats |
| OBP  | (hits + walks) / (at_bats + walks) |
| SLG  | total_bases / at_bats |
| OPS  | OBP + SLG |
| Avg Hits | avg hits per game |
| Avg RBIs | avg rbis per game |
| Avg Total Bases | avg total_bases per game |

3. **MLB analysis block** (runs after NBA block):
   - Pulls all `baseball_mlb` props from `unified_props`
   - Fetches player logs from `mlb_player_game_logs` (using ALL available data from last year, not just L20 -- since we're cross-referencing a full season)
   - For MLB, use L20 and full-season averages (we have 50-100+ games per player from 2024)
   - Calculates edge the same way: `edge = ((player_avg - line) / line) * 100`
   - Tags results with `sport: 'baseball_mlb'`

4. **Update delete/upsert logic** to include `sport` in the conflict key and delete filter.

5. **Update cron history result** to include MLB counts alongside NBA counts.

---

### Key Design Decision: Full Season Data

Since the MLB season just started and all our data is from last year, the function will use the entire backfill (~50-150 games per player) for calculating averages rather than just L10/L20. This gives us:
- **L20 avg**: Most recent 20 games from last season
- **Season avg**: Full 2024 season average (much more reliable for baseball)
- The edge calculation will use the **season average** as the primary comparison since baseball stats stabilize over larger samples

---

### Files Summary

- **1 migration**: Add `sport` column to `mispriced_lines`, update unique constraint
- **1 file modified**: `supabase/functions/detect-mispriced-lines/index.ts` -- add MLB prop mapping, baseball context calculator, and MLB analysis block

