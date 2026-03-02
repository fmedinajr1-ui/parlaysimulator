

# Hot Streak Bonus for Lottery Scanner

## What Changes

Add a "hot streak" bonus to the `nba-mega-parlay-scanner` that boosts the composite score of players who have hit their props 3+ games in a row, making them more likely to be selected for lottery tickets.

## Data Source

The `bot_player_performance` table already tracks per-player streaks (the `streak` column, positive = consecutive hits). Current data shows strong candidates like:
- Cason Wallace rebounds over: 11-game streak
- Victor Wembanyama steals over: 5-game streak  
- Paolo Banchero assists over: 5-game streak
- Desmond Bane points over: 5-game streak

## Implementation

**Single file change:** `supabase/functions/nba-mega-parlay-scanner/index.ts`

### 1. Fetch streak data alongside existing DB queries

Add `bot_player_performance` to the parallel `Promise.all` fetch block (around line 376). Query players with `streak >= 3` to build a lookup map keyed by `player_name|prop_type|side`.

### 2. Add streak bonus to composite scoring

In the scoring loop (around line 605), apply a tiered bonus:

| Streak Length | Bonus Points |
|--------------|-------------|
| 3-4 games | +8 |
| 5-7 games | +12 |
| 8+ games | +18 |

Additionally, require a minimum of 5 legs played to avoid small-sample flukes.

### 3. Track streak info in scored props

Add `streakLength` and `streakBonus` fields to the `ScoredProp` interface so the streak context carries through to ticket building and logging.

### 4. Log streak-boosted picks

Add a console log showing how many props received a hot streak bonus, helping with debugging and transparency.

## Expected Outcome

- Players on 3+ game hit streaks get priority selection in all three lottery tiers (Standard, High Roller, Mega Jackpot)
- The bonus stacks with existing boosts (defense matchup, sweet spot alignment, mispriced edge) so a streaking player against a weak defense becomes a top-tier pick
- Small-sample streaks (under 5 legs played) are excluded to prevent noise
