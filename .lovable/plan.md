
## Fix: Line Validation to Prevent Phantom/Unavailable Lines in Parlays

### Problem
Lines like "Jaylen Wells 0.5 Assists" are appearing in parlays even though they're not actually available on sportsbooks. This happens because:

1. **No minimum line filter**: The `detect-mispriced-lines` function accepts ANY line from `unified_props`, including 0.5 lines that are either alternate lines not commonly available or stale/phantom data
2. **No line verification step**: Neither the mispriced line detector nor the parlay generators validate that a line is currently live on a real sportsbook before using it
3. **Hardcoded stale data**: `bot-insert-longshot-parlay` has a literal hardcoded "Jaylen Wells 0.5 assists" leg -- this function inserts a static parlay regardless of whether those lines exist today
4. **Edge inflation on 0.5 lines**: A 0.5 line with an L10 average of 1.9 produces a 280% "edge" -- but this is meaningless if the line isn't actually offered

### Root Cause
The Odds API occasionally returns 0.5 lines from some books (alternate markets), but these lines are often:
- Not available on the user's preferred books (Hard Rock, FanDuel, DraftKings)
- Alternate lines with extreme juice (-500 or worse) making them impractical
- Stale entries that are no longer offered

### Fix (3 Changes)

#### Change 1: Add minimum line filter to `detect-mispriced-lines`
Add a filter to skip lines that are suspiciously low (0.5 for most props) since these are either alternate lines or not practically bettable. For assists, rebounds, steals, blocks, turnovers -- minimum line should be 1.5. For points -- minimum 5.5. For threes -- minimum 0.5 (this is a standard line).

**File**: `supabase/functions/detect-mispriced-lines/index.ts`
- After `if (line === 0) continue;` (line 293), add a minimum line check:
  - `player_assists`: min 1.5
  - `player_rebounds`: min 2.5
  - `player_steals`: min 0.5
  - `player_blocks`: min 0.5
  - `player_turnovers`: min 0.5
  - `player_points`: min 5.5
  - `player_threes`: min 0.5 (standard)
  - Combo props (PRA, PR, PA, RA): min 5.5

#### Change 2: Add line validation to `bot-force-fresh-parlays`
Add the same minimum line filter when reading from `mispriced_lines`, rejecting any pick with a suspiciously low line before building parlays.

**File**: `supabase/functions/bot-force-fresh-parlays/index.ts`
- In the filter step (around line 126), add minimum line validation alongside the blocked prop type check

#### Change 3: Disable `bot-insert-longshot-parlay`
This function contains hardcoded, stale player data (Jaylen Wells 0.5 assists from a specific date) and should not run automatically. It inserts the same static parlay every time it's called.

**File**: `supabase/functions/bot-insert-longshot-parlay/index.ts`
- Add an early return with a deprecation message so it no longer inserts stale hardcoded data

### Technical Details

Minimum line thresholds (based on standard sportsbook offerings):

```text
Prop Type           | Min Line | Rationale
--------------------|----------|----------------------------------
player_points       | 5.5      | No book offers under 5.5 pts
player_rebounds      | 2.5      | Standard minimum
player_assists       | 1.5      | 0.5 is alternate/phantom
player_threes        | 0.5      | Standard line exists
player_blocks        | 0.5      | Standard line exists
player_steals        | 0.5      | Standard line exists
player_turnovers     | 0.5      | Standard line exists
player_pra           | 10.5     | Combo prop minimum
player_pr            | 5.5      | Combo prop minimum
player_pa            | 5.5      | Combo prop minimum
player_ra            | 3.5      | Combo prop minimum
```

### Expected Outcome
- No more 0.5 assist lines appearing in parlays
- Edge calculations become meaningful (no more 280% "edges" on phantom lines)
- Parlays only contain lines that are actually bettable on standard sportsbooks
- `bot-insert-longshot-parlay` stops inserting stale hardcoded data
