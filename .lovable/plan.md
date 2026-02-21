

## Cross-Reference Team Totals with Player Props for Higher Accuracy

### Current State

The system has two separate worlds that don't talk to each other:

1. **Team Totals** (`game_bets` table): OVER/UNDER total bets with composite scores, but these categories are **blocked** from parlay generation (OVER_TOTAL: 10.2% hit rate, UNDER_TOTAL: 18.2% hit rate as standalone parlay legs)
2. **Player Props** (`category_sweet_spots`, `mispriced_lines`): Individual player OVER/UNDER recommendations that never check whether the team total signal agrees

The `game-environment-validator` already checks player props against implied team totals (e.g., "can this player really score 30 if the team total is 205?"), but it doesn't cross-reference the **directional signal** from team total analysis ("is this game trending OVER or UNDER?").

### The Problem

- A player PTS OVER is recommended, but the team total for that game signals UNDER with a composite score of 87 -- contradiction
- A player PTS UNDER is recommended, but the game total signals OVER with high pace -- contradiction
- NCAAB unders have a 70%+ hit rate, but player props from those same games aren't filtered by this signal

### The Fix: Team Total Alignment Layer

Add a **cross-reference validation step** that checks every player prop recommendation against the team total signal for that game, applying a bonus or penalty to the composite score.

**How it works:**

```text
For each player prop:
  1. Find the game_bets total entry for this player's game
  2. Check alignment:
     - Player OVER + Game OVER signal = ALIGNED (+8 to composite)
     - Player OVER + Game UNDER signal = CONFLICT (-12 to composite)
     - Player UNDER + Game UNDER signal = ALIGNED (+8 to composite)  
     - Player UNDER + Game OVER signal = CONFLICT (-10 to composite)
  3. High-confidence team totals (composite >= 75) amplify the adjustment
  4. Block player OVERs when game UNDER has composite >= 80 (strong signal)
```

### Implementation Details

**File 1: `supabase/functions/detect-mispriced-lines/index.ts`**
- After computing defense-adjusted edge, load today's `game_bets` WHERE `bet_type = 'total'` for NBA and NCAAB
- Build a map: `gameKey (home_away) -> { side: OVER|UNDER, compositeScore, line }`
- For each mispriced signal, look up the team total signal for that game
- Apply alignment bonus/penalty to the edge calculation
- Store `team_total_alignment: 'aligned' | 'conflict' | 'neutral'` in the mispriced record
- If conflict AND team total composite >= 80, downgrade confidence tier

**File 2: `supabase/functions/bot-generate-daily-parlays/index.ts`**
- During pick selection, load active `game_bets` totals alongside existing game environment data
- Add a `teamTotalAlignment` field to pick game context
- In the coherence scoring function, add alignment checks:
  - Player OVER in a strong UNDER game: -15 coherence
  - Player UNDER in a strong OVER game: -10 coherence
  - Player OVER in strong OVER game: +8 coherence
  - Player UNDER in strong UNDER game: +8 coherence
- For NCAAB specifically: if the NCAAB UNDER total has composite >= 75, hard-block any player OVER from that game

**File 3: `supabase/functions/game-environment-validator/index.ts`**
- Add a new check: `team_total_directional` alongside the existing implied_total, pace, defense checks
- When a game total UNDER signal is strong (composite >= 70), penalize player OVERs with a confidence adjustment of -0.08
- When a game total OVER signal is strong, penalize player UNDERs similarly
- Add this to the validation result's `checks` object for transparency

**Database**: Add two nullable columns to `mispriced_lines`:
- `team_total_signal` (text) -- 'OVER' or 'UNDER' or null
- `team_total_alignment` (text) -- 'aligned', 'conflict', or 'neutral'

### Alignment Logic Table

| Player Prop | Team Total Signal | Team Score | Result |
|---|---|---|---|
| PTS OVER | Game OVER (75+) | High confidence | +8 composite, "aligned" |
| PTS OVER | Game UNDER (80+) | Strong signal | BLOCKED for NCAAB, -12 composite for NBA |
| PTS OVER | Game UNDER (60-79) | Moderate signal | -8 composite, "conflict" |
| PTS UNDER | Game UNDER (75+) | High confidence | +8 composite, "aligned" |
| AST OVER | Game UNDER (80+) | Strong signal | -10 composite, "conflict" |
| 3PM OVER | Game OVER (70+) | Moderate signal | +5 composite, "aligned" |

### NCAAB Special Handling

Since NCAAB unders have a documented 70%+ hit rate:
- When an NCAAB game total UNDER has composite >= 75, all player OVERs from both teams in that game get hard-blocked from parlay inclusion
- Player UNDERs from those games get a +10 composite bonus
- This cross-references the winning NCAAB total strategy with player-level picks for maximum consistency

### Impact

- Eliminates contradictory picks (player OVER in a game trending UNDER)
- Leverages the strong NCAAB UNDER signal to filter player props in those games
- Adds a new coherence dimension to parlay construction
- 3 files modified, 2 columns added to `mispriced_lines`
- No changes to settlement or Telegram display logic needed

