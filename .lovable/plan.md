

## Plan: Add DD/TD Grading to bot-settle-and-learn

### What It Does
After settling parlays, the function will query all `dd_td_predictions` with `outcome = 'pending'` for past dates, look up actual box scores from `nba_player_game_logs`, and grade each prediction as `hit` or `miss`.

### Grading Logic
- **Double-Double (DD)**: Player has 10+ in at least 2 of: points, rebounds, assists, blocks, steals
- **Triple-Double (TD)**: Player has 10+ in at least 3 of: points, rebounds, assists, blocks, steals

### Changes

**File: `supabase/functions/bot-settle-and-learn/index.ts`**

Add a new section before the final `return` (around line 1940), after the hit-rate refresh:

1. **Fetch pending DD/TD predictions** where `prediction_date < todayET` and `outcome = 'pending'` (limit 500)
2. **Batch-fetch game logs** from `nba_player_game_logs` for matching player names and dates (using the existing `NAME_ALIASES` map for fuzzy matching)
3. **Grade each prediction**:
   - Find the player's game log for that date
   - Count how many stat categories hit 10+ (points, rebounds, assists, blocks, steals)
   - DD prediction: `hit` if count >= 2, else `miss`
   - TD prediction: `hit` if count >= 3, else `miss`
   - If no game log found (player didn't play / DNP): mark as `miss`
4. **Batch update** `dd_td_predictions` with the outcome
5. **Log summary** of graded predictions (X hit, Y miss)

This reuses the existing `NAME_ALIASES` and name normalization already in the file, keeping the approach consistent with how parlay legs are settled.

