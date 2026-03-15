

# Populate player_quarter_baselines with Real NBA Quarter Stats

## Current State

The `player_quarter_baselines` table already exists with the right schema. The `calculate-quarter-baselines` edge function currently estimates quarter splits using hardcoded tier distributions (24/26/26/24%) applied to L10 full-game averages — no real quarter-level data.

## Approach

The NBA stats API (`stats.nba.com`) supports a `Period` parameter on the `leaguedashplayerstats` endpoint. By calling it 4 times (Period=1 through 4), we get actual per-quarter averages for every NBA player. The project already uses this API pattern in `fetch-team-defense-ratings`.

## Changes

### 1. Rewrite `calculate-quarter-baselines` edge function

Replace the tier-based estimation with real NBA stats API calls:

- Call `https://stats.nba.com/stats/leaguedashplayerstats` with `Period=1`, `Period=2`, `Period=3`, `Period=4` and `Period=0` (full game) — 5 requests total
- Use `PerMode=PerGame` to get per-game averages
- Use `LastNGames=10` for L10 window (or `LastNGames=0` for season averages)
- Extract `PTS`, `AST`, `FG3M`, `BLK`, `REB`, `STL`, `MIN` from each period response
- Calculate real `q1_pct` through `q4_pct` as `qN_avg / game_avg`
- Calculate real `qN_rate` as `qN_avg / qN_minutes`
- Derive `player_tier` from full-game minutes
- Upsert into `player_quarter_baselines`

The NBA stats API headers/retry pattern already exists in `fetch-team-defense-ratings` — reuse the same approach.

### 2. Add `rebounds` and `steals` to PROP_CONFIGS

Currently only points/assists/threes/blocks are calculated. Add rebounds and steals to match the full set of props used in the War Room.

### 3. No schema changes needed

The `player_quarter_baselines` table already has all required columns (`q1_avg` through `q4_avg`, `q1_pct` through `q4_pct`, `q1_rate` through `q4_rate`, `game_avg`, `sample_size`, `minutes_avg`, `player_tier`).

## Technical Details

**NBA Stats API endpoint:**
```
https://stats.nba.com/stats/leaguedashplayerstats?
  Period={1-4}&PerMode=PerGame&LastNGames=10&Season=2025-26
  &SeasonType=Regular+Season&LeagueID=00
```

**Response parsing:** Same `resultSets[0].headers` + `resultSets[0].rowSet` pattern used in `fetch-team-defense-ratings`.

**Key fields by header index:** `PLAYER_NAME`, `PTS`, `AST`, `FG3M`, `BLK`, `REB`, `STL`, `MIN`

**Rate limiting:** 1-second delay between API calls (5 calls total), with 3-retry pattern already established.

| Change | File |
|---|---|
| Rewrite to use real NBA stats API per-quarter data | `supabase/functions/calculate-quarter-baselines/index.ts` |

