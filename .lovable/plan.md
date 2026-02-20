

## Remove Unavailable Markets from Odds Scraper

### What
Remove `player_turnovers` and `player_double_double` from the NBA market batches in `whale-odds-scraper/index.ts` since The Odds API does not return data for these markets, resulting in wasted API calls.

### Change
**File:** `supabase/functions/whale-odds-scraper/index.ts` (lines 31)

Delete Batch 3 entirely (`['player_turnovers', 'player_double_double']`), reducing the NBA market config from 4 batches to 3:

```
'basketball_nba': [
  ['player_points', 'player_rebounds', 'player_assists'],
  ['player_threes', 'player_blocks', 'player_steals'],
  ['player_points_rebounds_assists', 'player_points_rebounds', 'player_points_assists', 'player_rebounds_assists'],
],
```

This saves 2 API calls per scraper run with no impact on available data. Deploy the updated function afterward.

