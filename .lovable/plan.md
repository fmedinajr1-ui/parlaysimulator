

# Fix Quarter Data to Use Real Per-Quarter Stats

## Confirmed Problems

1. **Baselines are synthetic**: `player_quarter_baselines` stores fake quarter averages (full-game avg × tier percentages like 25/26/26/23%). CJ McCollum shows Q1=4.58, Q2=4.68 points — that's just ~18 PPG split by formula, not what he actually scores per quarter.

2. **Snapshots are evenly distributed**: When `auto-quarter-snapshots` catches up on multiple quarters at once, it divides cumulative stats equally. CJ McCollum shows 8/8/8/8 points across all 4 quarters — clearly wrong.

## Fixes

### 1. `auto-quarter-snapshots` — Stop even distribution

When capturing multiple missed quarters, assign ALL the remaining delta to the **latest completed quarter only**. Earlier missed quarters get zeros. This is more honest than making all quarters equally wrong.

```
// Before: divide by qCount for each quarter
// After: only the last quarter in quartersToCapture gets the delta, others get 0
```

### 2. `get-player-quarter-profile` — Use real snapshot data from L3 games

Replace the current approach (baselines table with synthetic splits) with actual per-quarter averages computed from the `quarter_player_snapshots` table:

- Query `quarter_player_snapshots` for each player, get their last 3 distinct event IDs
- Group by quarter, average each stat across those 3 games
- This gives real Q1/Q2/Q3/Q4 averages based on what players actually scored per quarter
- **Fallback**: If fewer than 2 games of snapshot data exist, fall back to the existing tier-distribution math using L3 game logs (not L10)

Also change the game logs query from `limit(playerNames.length * 10)` to `limit(playerNames.length * 3)` so averages reflect last 3 games.

### 3. No UI changes needed

The War Room already reads `quarterAvgs` from the edge function response and displays them. Once the data source is fixed, the UI will show correct numbers automatically.

## Changes

| File | Change |
|------|--------|
| `supabase/functions/auto-quarter-snapshots/index.ts` | Assign delta to latest quarter only instead of dividing evenly |
| `supabase/functions/get-player-quarter-profile/index.ts` | Query `quarter_player_snapshots` for L3 real per-quarter averages; fall back to tier splits with L3 logs |

