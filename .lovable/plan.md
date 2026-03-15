

# Real Quarter-by-Quarter Data via StatMuse Scraping

## Problem

The War Room quarter breakdown (Q1/Q2/Q3/Q4 boxes on each prop card) currently shows **estimated** values based on tier distributions (star: 24/26/27/23%, starter: 25/26/26/23%, etc.). These are not real. You need actual per-quarter averages from the player's season games.

## Data Source

StatMuse provides game-by-game quarter stats via simple URL patterns:
```
https://www.statmuse.com/nba/ask/{player-name}-stats-by-quarter-this-season
```

Returns a table with columns: QUARTER, DATE, MIN, PTS, REB, AST, STL, BLK, 3PM per game per quarter. This is exactly what we need.

## Plan

### 1. Create `scrape-statmuse-quarter-stats` Edge Function

A new edge function that:
- Accepts `{ playerNames: string[] }`
- For each player, uses Firecrawl (already connected) to scrape `statmuse.com/nba/ask/{name}-stats-by-quarter-this-season`
- Parses the markdown table response to extract per-quarter stats (PTS, REB, AST, STL, BLK, 3PM) for each game
- Averages across the last 10 games (L10) per quarter to produce real Q1/Q2/Q3/Q4 averages
- Upserts results into `player_quarter_baselines` table (already exists with `q1_avg`, `q2_avg`, `q3_avg`, `q4_avg` columns)
- Rate-limits requests (1 per second) to avoid hammering StatMuse

### 2. Update `get-player-quarter-profile` to Prefer Real Baselines

Currently the priority is: `quarter_player_snapshots` (live game data) > tier-based fallback.

Add a middle tier: check `player_quarter_baselines` table for StatMuse-sourced data before falling back to tier distributions. New priority:
1. Live `quarter_player_snapshots` (for in-progress games)
2. `player_quarter_baselines` with StatMuse real averages
3. Tier-based distribution fallback (last resort)

### 3. Wire Into Orchestrator

Add StatMuse scraping as a step in the `refresh-l10-and-rebuild` pipeline (after game logs sync, before generation). Only scrape players that are in today's slate to limit Firecrawl credits.

### 4. No UI Changes Needed

The War Room `QuarterBreakdown` component already renders `quarterAvgs.q1/q2/q3/q4` — once the data in the database is real, the cards will automatically show real numbers.

## Technical Notes

- Firecrawl API key is already configured
- StatMuse returns markdown tables that are straightforward to parse (pipe-delimited columns)
- The `player_quarter_baselines` table already has the schema we need (`q1_avg` through `q4_avg`, `q1_pct` through `q4_pct`)
- We'll add a `source` or `data_source` column to distinguish StatMuse-sourced vs tier-estimated baselines
- L10 window keeps averages recent and relevant for betting

