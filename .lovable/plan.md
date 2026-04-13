

# Settle April 12th RBI Picks & Report Parlay Results

## Problem
All 23 April 12th RBI picks remain unsettled. The `mlb-rbi-settler` edge function needs to run to match alerts against `mlb_player_game_logs` and determine wins/losses.

## Steps

1. **Invoke `mlb-rbi-settler`** — call the edge function to settle all pending April 12th RBI alerts against actual game log data
2. **Query settled results** — pull the updated picks with `was_correct` and `actual_outcome` values
3. **Report parlay outcomes** — specifically check if the 2-leg (Doyle + Adames) and 3-leg (Doyle + Adames + Walker) parlays hit
4. **Show overall April 12th accuracy** — wins, losses, win rate by signal type

## Technical Details
- The settler matches player names from `fanduel_prediction_alerts` against `mlb_player_game_logs` using normalized name matching
- Settlement logic: 1+ RBI = OVER hit, 0 RBI = UNDER hit
- No code changes needed — just invoke the existing edge function and query results

