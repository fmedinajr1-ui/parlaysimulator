
# Fix "Unknown" Display for Team Bet Legs

## Problem

Team bet legs in the database have `home_team`, `away_team`, `bet_type`, `side`, and `type: 'team'` — but no `player_name`. The `BotParlayCard` always renders `leg.player_name ?? 'Unknown'`, so every team leg shows "Unknown".

## Solution

Two changes needed:

### 1. Update `BotLeg` type (`src/hooks/useBotEngine.ts`)

Add optional team-specific fields to the `BotLeg` interface:
- `type?: 'player' | 'team'`
- `home_team?: string`
- `away_team?: string`
- `bet_type?: string` (spread, total, moneyline)

### 2. Update `BotParlayCard` rendering (`src/components/bot/BotParlayCard.tsx`)

Check `leg.type === 'team'` and render differently:

- **Name line**: Instead of `player_name`, show the matchup like `"Lakers vs Spurs"` (using `home_team` and `away_team`), or show the specific side (e.g., `"Lakers -9.5"` for spreads, `"Over 229.5"` for totals).
- **Detail line**: Show `bet_type` (Spread/Total/Moneyline) instead of `prop_type`, and show the side contextually (home/away for spreads, over/under for totals).
- **Team badge**: Skip the `team_name` dot since the teams are already in the name.

For player legs, everything stays exactly as it is now.

### Files Modified
1. `src/hooks/useBotEngine.ts` -- add team fields to BotLeg interface
2. `src/components/bot/BotParlayCard.tsx` -- conditional rendering for team vs player legs
