

# Add Actual Game Total Line + Team Name to Derived Team Market Alerts

## Problem
Your screenshot shows:
- **TOTALS alert**: Says "Action: OVER" but doesn't tell you **what the game total line is** (e.g., OVER 218.5)
- **MONEYLINE alert**: Says "BACK — back this side" but doesn't tell you **which team** to back

These alerts are derived from player prop shifts but never look up the actual FanDuel team market data.

## Root Cause
In `fanduel-behavior-analyzer` (~line 365-413), when a team news shift generates TOTALS and MONEYLINE signals, it only carries player prop data. It never queries `game_market_snapshots` to get:
- The current FanDuel game total line (e.g., 218.5)
- The team names + moneyline odds

## Fix

### File: `supabase/functions/fanduel-behavior-analyzer/index.ts`

**A. After detecting a team news shift (~line 363), query `game_market_snapshots` for the game's team markets**

Before generating the TOTALS/MONEYLINE derived alerts, look up the event in `game_market_snapshots`:
- Match by home/away team names extracted from `sampleShift.eventDesc` (e.g., "Detroit Pistons @ Orlando Magic")
- Get the latest `total` row → `fanduel_line` (e.g., 218.5)
- Get the latest `moneyline` row → `fanduel_home_odds`, `fanduel_away_odds`, `home_team`, `away_team`

**B. Attach the looked-up data to the derived alert objects**

Add fields to the alert:
- `game_total_line` for totals alerts
- `team_to_back` + `ml_odds` for moneyline alerts
- Determine which team to back: if player props are **rising**, the team those players belong to is likely performing better → back that team's ML

**C. Update the Telegram formatting (~lines 1681-1690)**

For TOTALS:
```
Action: OVER 218.5 — 4 player props rising → game total likely higher
```

For MONEYLINE:
```
Action: BACK Orlando Magic (-150) — 4 player props rising → back this side
```

**D. Determine team from player shifts**

The `event_description` contains "Detroit Pistons @ Orlando Magic". The players moving (Suggs, Banchero, Harris, Jenkins) are all Magic players. Parse the event description to extract home/away teams, then determine which team's players are shifting to identify the correct ML side.

## Scope
- 1 edge function file modified
- No migration needed
- Uses existing `game_market_snapshots` table

