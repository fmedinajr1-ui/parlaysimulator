

## Fix Ladder Challenge: Correct Opponent, Single Pick Per Player, Top 3 Candidates

### Problem
Three issues with the current ladder challenge:

1. **Wrong opponent**: The bot doesn't know which team a player is on, so it guesses by picking the team with worse 3PT defense. This caused Julian Champagnie (Spurs) to show "vs San Antonio Spurs" instead of "vs New York Knicks."

2. **Can't stack same prop at different lines**: Sportsbooks won't let you parlay Over 1.5, Over 2.5, and Over 3.5 threes for the same player -- they're correlated. The ladder needs to pick ONE line (the boom/highest value line) per player as a single-leg pick.

3. **Only shows 1 pick**: You want the top 3 candidates (e.g., Julian, Sam, Jayson), each as their own single-leg ladder pick at their best boom line.

### Changes

**File: `supabase/functions/nba-ladder-challenge/index.ts`**

1. **Fix opponent detection** (lines 260-297):
   - Query `bdl_player_cache` for `player_name, team_name` at startup
   - Build a `playerTeamMap` (normalized name -> team name)
   - When scoring, look up the player's actual team, then set opponent to the OTHER team in the game
   - Use the actual opponent's `opp_threes_rank` (not the worse of the two)

2. **Switch from multi-rung parlay to single boom pick** (lines 371-425):
   - Instead of building 3 legs at different lines, pick the highest line where the player's L10 avg still clears comfortably (the "boom" line)
   - Save as a single-leg entry with that line's odds (e.g., Over 4.5 at +650)
   - Still show all available lines and hit rates in the rationale for context

3. **Generate top 3 candidates** (lines 371-478):
   - Loop over `candidates.slice(0, 3)` instead of just `candidates[0]`
   - Save each as a separate `bot_daily_parlays` row
   - Build a combined Telegram message showing all 3 picks
   - Update dedup check threshold from `> 0` to `>= 3`

4. **Updated Telegram format**:
```text
LADDER CHALLENGE (3 Picks)

1. Julian Champagnie | 3PT Over 4.5 (+650)
   vs Knicks (Rank 22 3PT D)
   L10 Avg: 3.9 | Floor: 1 | Ceiling: 8
   Matchup: GOOD

2. Sam Hauser | 3PT Over 3.5 (+180)
   vs Wizards (Rank 28 3PT D)
   L10 Avg: 4.2 | Floor: 2 | Ceiling: 7
   Matchup: ELITE

3. Jayson Tatum | 3PT Over 3.5 (+150)
   vs Pistons (Rank 25 3PT D)
   L10 Avg: 3.6 | Floor: 1 | Ceiling: 6
   Matchup: ELITE
```

### Technical Details
- **File modified**: `supabase/functions/nba-ladder-challenge/index.ts`
- Uses existing `bdl_player_cache` table for player-team mapping (same pattern as `bot-generate-daily-parlays`)
- Each pick is a single-leg entry in `bot_daily_parlays` (leg_count: 1)
- The "boom line" selection logic: pick the highest available line where L10 avg >= line value, maximizing upside odds

