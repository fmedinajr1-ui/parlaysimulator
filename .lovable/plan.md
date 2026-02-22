

## Add MLB Sweet Spots to Category Props Analyzer

### Goal
Extend the `category-props-analyzer` to analyze MLB player game logs and generate sweet spots for MLB props. This enables MLB double-confirmed picks by cross-referencing sweet spots with existing mispriced lines.

### What Changes

**1. Add MLB Game Log Fetching (alongside NBA/NCAAB)**

After the existing NBA and NCAAB log fetching blocks (~lines 1000-1043), add a new block that fetches from `mlb_player_game_logs` with pagination. MLB logs use different columns (hits, runs, rbis, total_bases, stolen_bases, walks, strikeouts, pitcher_strikeouts, home_runs) so they'll be stored in a separate `mlbPlayerLogs` map with their own stat extraction.

**2. Add MLB-Specific Categories**

New categories added to the `CATEGORIES` config:

| Category | Prop Type | Side | Logic |
|----------|-----------|------|-------|
| MLB_PITCHER_K_OVER | pitcher_strikeouts | over | Pitchers averaging 5-12 Ks, lines 4.5-8.5 |
| MLB_PITCHER_K_UNDER | pitcher_strikeouts | under | Same range, catches overhyped Ks |
| MLB_HITTER_FANTASY_OVER | hitter_fantasy_score | over | Calculated field (hits+walks+runs+rbis+TB+SB), lines 5.5-15.5 |
| MLB_HITTER_FANTASY_UNDER | hitter_fantasy_score | under | Same calc, catches inflated lines |
| MLB_HITS_OVER | hits | over | Batters averaging 0.8-2.5 hits, lines 0.5-2.5 |
| MLB_TOTAL_BASES_OVER | total_bases | over | Batters averaging 1.5-4.0 TB, lines 1.5-3.5 |
| MLB_RUNS_OVER | runs | over | Batters averaging 0.5-1.5 runs, lines 0.5-1.5 |

Note: `batter_home_runs UNDER` is **removed/not included** per your request -- replaced by fantasy score props.

**3. MLB Stat Value Extraction**

New `getMLBStatValue()` function that maps prop types to `mlb_player_game_logs` columns:
- `pitcher_strikeouts` -> `pitcher_strikeouts` column
- `hits` -> `hits` column
- `total_bases` -> `total_bases` column
- `runs` -> `runs` column
- `hitter_fantasy_score` -> calculated: `hits + walks + runs + rbis + total_bases + stolen_bases`

**4. MLB Analysis Loop**

After the existing NBA category analysis loop, add a parallel MLB loop that:
- Iterates through MLB categories
- Uses `mlbPlayerLogs` (from `mlb_player_game_logs`)
- Calculates L10 averages, hit rates, medians using the same math
- Generates sweet spots with `prop_type` matching mispriced_lines format
- Skips archetype validation (NBA-only concept)
- Uses simplified projection (L10 median, no matchup/pace adjustment for now)

**5. Prop Type Normalization for Double-Confirmed Matching**

The double-confirmed scanner normalizes prop types by stripping `player_` prefix and underscores. Ensure MLB sweet spots store `prop_type` values that normalize the same way as mispriced_lines `prop_type`:
- Sweet spot: `pitcher_strikeouts` -> normalizes to `pitcherstrikeouts`
- Mispriced line: `pitcher_strikeouts` -> normalizes to `pitcherstrikeouts`
- Match confirmed

**6. Unified Props Lookup for MLB**

The existing `unified_props` validation step already fetches all props by `commence_time`. MLB props from `pp_snapshot` are synced to `unified_props` via `mlb-props-sync`. The existing validation logic will work for MLB spots too -- just need to ensure the prop_type key matching works for MLB stat names.

### Technical Details

**File modified: `supabase/functions/category-props-analyzer/index.ts`**

1. **New interface** `MLBGameLog` with MLB-specific fields (hits, walks, runs, rbis, total_bases, stolen_bases, home_runs, strikeouts, pitcher_strikeouts)

2. **New MLB categories** added to `CATEGORIES` object (after line 474) -- 7 new category configs

3. **New function** `getMLBStatValue(log, propType)` -- extracts stat from MLB log, including fantasy score calculation

4. **New MLB log fetching block** (~after line 1043) -- paginated fetch from `mlb_player_game_logs` for last 30 days, grouped into `mlbPlayerLogs` map

5. **New MLB analysis section** (~after line 1290) -- iterates MLB categories against `mlbPlayerLogs`, generates sweet spots with same schema as NBA spots

6. **Sweet spots from MLB** get the same validation against `unified_props` actual lines, hit rate recalculation, and database upsert as NBA spots

### Expected Outcome

After this change:
- Running `category-props-analyzer` generates both NBA and MLB sweet spots
- MLB sweet spots for `pitcher_strikeouts` and `hitter_fantasy_score` (plus hits, TB, runs) land in `category_sweet_spots`
- Running `double-confirmed-scanner` can now match MLB mispriced lines against MLB sweet spots
- Fantasy score props replace the removed homer UNDER section

