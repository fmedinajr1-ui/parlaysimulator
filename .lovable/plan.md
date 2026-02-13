

# Fix NCAA Baseball: Replace Synthetic Data with Real Games from The Odds API

## The Problem
The `game_bets` table currently contains **synthetic test data** for baseball (LSU vs Georgia, Vanderbilt vs Fresno State, Florida vs Oregon) that doesn't match the **real games today** (Wright State vs #15 Georgia, Washington vs #17 NC State, #23 Vanderbilt vs #10 TCU, #18 Kentucky, etc. as shown in the screenshot).

The `whale-odds-scraper` function already supports `baseball_ncaa` and fetches from The Odds API -- it just needs to be triggered to pull today's real games. However, the `track-odds-movement` function has a bug: it receives `baseball_ncaa` from the orchestrator but silently skips it because `baseball_ncaa` is missing from its `SPORT_KEYS` map.

## Steps

### 1. Fix `track-odds-movement` SPORT_KEYS mapping
Add the missing `baseball_ncaa` entry so the orchestrator's calls actually process baseball odds movements:

```
const SPORT_KEYS = {
  'NBA': 'basketball_nba',
  'NFL': 'americanfootball_nfl',
  'NCAAF': 'americanfootball_ncaaf',
  'NCAAB': 'basketball_ncaab',
  'NHL': 'icehockey_nhl',
  'MLB': 'baseball_mlb',
  'BASEBALL': 'baseball_ncaa',   // <-- add this
};
```

### 2. Delete the synthetic baseball test data
Remove the 8 fake `baseball_ncaa` rows from `game_bets` so they don't conflict with or duplicate real data.

### 3. Run `whale-odds-scraper` to fetch real games
Trigger the scraper in full mode for `baseball_ncaa`. This will call The Odds API at `https://api.the-odds-api.com/v4/sports/baseball_ncaa/odds/` and upsert today's real matchups (Wright State vs Georgia, Washington vs NC State, Vanderbilt vs TCU, Kentucky, etc.) into `game_bets` with actual spreads, totals, and moneylines.

### 4. Regenerate today's parlays
Clear today's existing parlays and re-trigger `bot-generate-daily-parlays` so the new real baseball data flows into parlay generation.

### 5. Verify
Confirm the `game_bets` table now contains the real NCAA baseball matchups matching what the user sees in the screenshot.

