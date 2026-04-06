

# Alt Line Buffer System — Every Sport Prop on FanDuel

## What This Does

Every player prop signal (take_it_now, line_about_to_move, velocity_spike, snapback, correlated_movement, team_news_shift) will now include a **recommended alt line** with a sport-and-stat-aware buffer. The Telegram alerts will show both the book line and the alt line edge. The database will track alt line accuracy separately.

## Buffer Table (by prop type)

```text
Prop Type                          Buffer
─────────────────────────────────  ──────
Points / PRA / Pts+Reb / Pts+Ast   3.0
Rebounds / Assists / Reb+Ast        2.0
Threes / Steals / Blocks            1.0
Steals+Blocks                       1.0
Turnovers                           0.5
Double/Triple Double                N/A (skip)
Totals (game)                       3.0
Spreads                             1.5
```

- **OVER signals**: `alt_line = current_line - buffer` (lower line = easier to clear)
- **UNDER signals**: `alt_line = current_line + buffer` (higher line = easier to stay under)

## Changes

### 1. Database Migration
Add 3 columns to `fanduel_prediction_accuracy`:
- `recommended_alt_line` (numeric, nullable)
- `alt_line_buffer` (numeric, nullable)  
- `alt_line_was_correct` (boolean, nullable) — for separate settlement tracking

### 2. Edge Function: `fanduel-behavior-analyzer/index.ts`

**A. Add buffer constants** (top of file, ~line 20):
A `PROP_BUFFER` map keyed by prop_type returning the numeric buffer. Skip props like double_double/triple_double.

**B. Calculate alt line for every alert** (~line 788-808, inside `addAlert` calls and prediction row builder):
For each alert, compute `recommended_alt_line` based on the action side (OVER → subtract buffer, UNDER → add buffer). Store in the alert object.

**C. Update prediction accuracy rows** (~lines 888-931):
Add `recommended_alt_line` and `alt_line_buffer` to every inserted prediction row.

**D. Update ALL Telegram alert formatters** (~lines 948-1174):
For every signal type (take_it_now, line_about_to_move, velocity_spike, snapback, correlation/team_news), add a `🎯 Alt Line Edge` line showing the recommended alt line and buffer. Only for player props (skip team markets like h2h/moneyline where alt lines don't apply).

Example output change:
```
✅ Action: OVER 28.5
🎯 Alt Line Edge: OVER 25.5 (-3 pts)
```

### 3. Files Modified
- `supabase/functions/fanduel-behavior-analyzer/index.ts` — buffer constants, alt line calculation, Telegram formatting, prediction storage
- Database migration — 3 new columns on `fanduel_prediction_accuracy`

### 4. What This Does NOT Change
- Signal detection logic (thresholds, directional logic) stays the same
- Team market signals (h2h, moneyline) skip alt line — those use odds not lines
- Spreads and totals DO get alt lines since they have numeric lines

