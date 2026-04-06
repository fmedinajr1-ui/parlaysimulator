

# Add Alt Line Buffer to Team News Shift Alerts

## Problem
Team News Shift and Correlated Movement alerts never show the `🎯 Alt Line Edge` in Telegram because these aggregate alerts don't include `current_line` or `line_to` in their alert object. The `getAltLineText` function receives `null` and returns empty string.

Your screenshot confirms this — the Team News Shift for "Detroit Pistons @ Orlando Magic — POINTS REBOUNDS ASSISTS" shows the action but no alt line edge.

## Root Cause
When building correlation alerts (lines 303-317), the alert object has `players_moving`, `dominant_direction`, `correlation_rate`, etc. — but no `current_line`. This is because it's an aggregate signal across multiple players, not a single player's line.

## Fix

### 1. Add average line to correlation alert objects

**File:** `supabase/functions/fanduel-behavior-analyzer/index.ts`

When building team_news_shift and correlated_movement alerts (~line 303 and ~line 430), calculate the average current line from the contributing shifts and include it:

```
avg_current_line: average of each shift's current line value
```

This requires the shift objects to carry their current line. Need to check the shift data structure and propagate the line values.

### 2. Show per-player alt lines in Telegram formatter

In the correlation/team_news_shift Telegram formatter (~line 1194-1252), enhance the display to show alt lines for each listed player:

Instead of just:
```
Jalen Suggs: rising 1
Tobias Harris: rising 1  
Daniss Jenkins: rising 2
```

Show:
```
Jalen Suggs: rising 1 → Alt OVER 12.5
Tobias Harris: rising 1 → Alt OVER 8.5
Daniss Jenkins: rising 2 → Alt OVER 10.5
```

Each player's alt line = their individual current line adjusted by the prop-type buffer.

### 3. Propagate line values through shift detection

The shift objects (built during correlation detection) need to carry each player's `current_line` so we can compute per-player alt lines. Update the shift mapping (~lines 250-270) to include the line value from the snapshot data.

### 4. Update prediction row builder

For team_news_shift prediction rows (~line 957), use the average line from the alert so `recommended_alt_line` gets stored instead of being null.

## Scope
- Single file: `supabase/functions/fanduel-behavior-analyzer/index.ts`
- No migration needed — uses existing `recommended_alt_line` column
- Affects both Telegram display and prediction accuracy storage

