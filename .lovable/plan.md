

## Defense-Adjusted Line Projections

### What Changes

Right now, the engine calculates edge like this:

```
edge = (player_avg_L10 - book_line) / book_line
```

It ignores who the player is facing tonight. The defense rank only affects pick **priority** (composite score), not the actual **projected line**. This means a player facing the #1 defense gets the same edge calculation as one facing the #30 defense.

### The Fix

Introduce a **defense-adjusted projection** in two places:

**1. Mispriced Line Detection (`detect-mispriced-lines/index.ts`)**

After calculating the raw L10 average, apply a defense multiplier before computing edge:

| Opponent Defense Rank | Adjustment (OVER props) | Adjustment (UNDER props) |
|---|---|---|
| 1-5 (elite) | -6% to projection | +4% to projection |
| 6-10 (strong) | -3% to projection | +2% to projection |
| 11-20 (average) | No change | No change |
| 21-25 (soft) | +2% to projection | -2% to projection |
| 26-30 (weak) | +4% to projection | -4% to projection |

Example: Wembanyama averages 25.0 L10, facing #3 defense. Adjusted projection = 25.0 x 0.94 = 23.5. Against a book line of 23.5, the edge drops to ~0% (no longer mispriced). Against #28 defense: 25.0 x 1.04 = 26.0, edge grows to +10.6%.

This requires loading today's opponent matchups from `game_bets` and defense ranks from `nba_opponent_defense_stats` during the mispriced detection run.

**2. Parlay Generation (`bot-generate-daily-parlays/index.ts`)**

The existing `getDefenseMatchupAdjustment` function already adjusts composite scores (+8/-10). We enhance it to also store a `defense_adjusted_line` on each leg so Telegram reports show the realistic projection, not just the raw average.

### Data Flow

1. `detect-mispriced-lines` loads today's NBA schedule from `game_bets` to map each player's team to their opponent
2. Looks up opponent defense rank from `nba_opponent_defense_stats` for the relevant stat category
3. Applies multiplier to L10 average before calculating edge
4. Only flags as mispriced if the **defense-adjusted** edge still exceeds the 15% threshold
5. Stores `defense_adjusted_avg` and `opponent_defense_rank` in the `mispriced_lines` record

### Technical Details

**File 1: `supabase/functions/detect-mispriced-lines/index.ts`**
- Add queries for `game_bets` (today's NBA games) and `nba_opponent_defense_stats`
- Build team-to-opponent map and defense rank lookup
- Add `getDefenseMultiplier(rank, signal)` function
- Apply multiplier: `adjustedAvg = avgL10 * multiplier`
- Use `adjustedAvg` instead of `avgL10` for edge calculation
- Store `defense_adjusted_avg` and `opponent_defense_rank` in output

**File 2: `supabase/functions/bot-generate-daily-parlays/index.ts`**
- When building leg metadata, include `defense_adjusted_line` if available from mispriced data
- No change to composite scoring logic (that already works correctly)

**Database**: Add two nullable columns to `mispriced_lines`:
- `defense_adjusted_avg` (numeric) -- the projection after defense context
- `opponent_defense_rank` (integer) -- rank 1-30

### Impact

- Picks against elite defenses need a **larger** raw edge to qualify as mispriced (the bar is higher)
- Picks against weak defenses qualify more easily (the matchup confirms the edge)
- Eliminates false-positive OVER signals against top defenses
- Telegram caution icons will now align with whether the pick actually survived defense adjustment

