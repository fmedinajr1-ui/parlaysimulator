
# Fix Settlement and Recalibration Pipeline

## Problems Found

### 1. verify-sweet-spot-outcomes finds 0 game logs (CRITICAL)
The verification function matches picks by `analysis_date` against `nba_player_game_logs.game_date`. However, picks tagged `analysis_date = 2026-02-09` are for games on Feb 10-11 (the next day's slate). There is a complete mismatch -- 165 picks, 0 verified.

**Fix**: Instead of matching game logs by `analysis_date`, the function needs to look up each player's actual game date. It should query game logs within a date window (analysis_date to analysis_date + 2 days) and match by player name alone. If a player has a game log in that window, use it. Otherwise, mark as `no_data`.

### 2. bot-settle-and-learn times out (CRITICAL)
The settle function calls `verify-sweet-spot-outcomes` inline (takes 18+ seconds), then processes each of 165 picks one-by-one with individual DB queries. This exceeds the edge function timeout.

**Fix**: 
- Remove the inline call to `verify-sweet-spot-outcomes` -- this should run as a separate pre-step (already handled by cron schedule)
- Remove the 2-second `setTimeout` delay
- Batch the leg outcome lookups instead of querying each leg individually

### 3. Team leg settlement not implemented (CRITICAL)
`bot-settle-and-learn` looks up each leg's outcome from `category_sweet_spots` by `leg.id`. Team legs don't exist in `category_sweet_spots` -- they come from `game_bets`. There is no logic to settle team props (spreads, totals, moneylines) against final scores.

**Fix**: Add team leg settlement logic in `bot-settle-and-learn`:
- For team legs (`leg.type === 'team'`), fetch the game result from `nba_player_game_logs` (aggregate home/away scores) or from a scores source
- For spreads: check if the picked side covered
- For totals: check if over/under hit against the final combined score
- For moneyline: check if the picked side won

### 4. Premature parlay voiding
When `verify-sweet-spot-outcomes` marks all legs as `no_data` (because games haven't happened yet), the settle function voids the entire parlay. Today's parlays should NOT be settled until games are final.

**Fix**: In `bot-settle-and-learn`, skip parlays where the game hasn't started yet. Check `parlay_date` against current Eastern date -- only settle parlays where the date has passed AND games would have concluded (e.g., after midnight ET of the next day).

## Changes

### File 1: `supabase/functions/verify-sweet-spot-outcomes/index.ts`

- Change the game log query from exact `game_date = targetDate` to a 3-day window: `game_date BETWEEN targetDate AND targetDate + 2 days`
- Match players by name within that window
- This allows picks generated on Day N for games on Day N+1 to be verified correctly

### File 2: `supabase/functions/bot-settle-and-learn/index.ts`

1. **Remove inline verify call**: Delete the Phase 0 block that invokes `verify-sweet-spot-outcomes` and the 2-second delay (lines 147-166). This is handled by separate cron runs.

2. **Add date guard**: Only process parlays where `parlay_date < today_eastern` (don't try to settle today's games -- they haven't finished yet).

3. **Add team leg settlement**: When `leg.type === 'team'` or when the leg has `home_team`/`away_team`:
   - Query `game_bets` or fetch scores from the game results
   - For spreads: actual_margin vs spread line determines hit/miss
   - For totals: actual_combined_score vs total line determines hit/miss  
   - For moneyline: winner determines hit/miss
   - Use the `nba-stats-fetcher` or `fetch-game-scores` function to get final scores

4. **Batch leg lookups**: Instead of querying `category_sweet_spots` for each leg individually, fetch all relevant picks at once with a single `IN` query on the leg IDs.

### Technical Detail: Team Leg Settlement Logic

```text
For a team leg with type='team':
  1. Identify game by home_team + away_team
  2. Get final score (from nba_player_game_logs aggregated, or game_environment if updated)
  3. Based on bet_type:
     - 'spread': 
       homeCover = (homeScore - awayScore) > Math.abs(spread)
       leg hits if (side='home' && homeCover) or (side='away' && !homeCover)
     - 'total':
       combinedScore = homeScore + awayScore
       leg hits if (side='over' && combinedScore > line) or (side='under' && combinedScore < line)
     - 'moneyline':
       leg hits if picked side won the game
```

### Deployment Order

1. Deploy `verify-sweet-spot-outcomes` first (date window fix)
2. Deploy `bot-settle-and-learn` (all fixes)
3. Test both functions manually to confirm no errors
4. The scheduled cron jobs (11:00, 17:00, 23:00 UTC) will handle tonight's settlement automatically
