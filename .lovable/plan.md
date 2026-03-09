

## Plan: Filter Bidirectional Scanner by Lineup & Injury Status

### Problem
The bidirectional scanner (`bot-matchup-defense-scanner`) pulls player targets from `category_sweet_spots` but never checks `lineup_alerts` or `starting_lineups`. Players who are OUT, DOUBTFUL, or not on today's roster still appear as targets.

### Fix: Add Injury/Lineup Filter to `bot-matchup-defense-scanner`

**File**: `supabase/functions/bot-matchup-defense-scanner/index.ts`

After loading `bdl_player_cache` and `category_sweet_spots` (~line 200), add two queries:

1. **Fetch `lineup_alerts` for today** — build a set of players with status `OUT` or `DOUBTFUL`
2. **Fetch `starting_lineups` for today** — build a set of confirmed active players (optional positive signal)

Then in the `findPlayerTargets` function (~line 215), before adding a player to targets, check:
- If player is in the OUT/DOUBTFUL set → **skip entirely**
- If player is GTD/QUESTIONABLE → add but tag with a warning flag

This ensures the broadcast and bench-under parlays only include players who are actually available.

After deploying, re-invoke `nba-matchup-daily-broadcast` to get a clean scan with only active players.

### Changes

| Location | Change |
|----------|--------|
| `bot-matchup-defense-scanner/index.ts` ~line 195 | Add queries for `lineup_alerts` (today, status IN OUT/DOUBTFUL) and build exclusion set |
| `bot-matchup-defense-scanner/index.ts` ~line 225 | In `findPlayerTargets`, skip players in exclusion set |
| Deploy + invoke | Deploy scanner, then invoke `nba-matchup-daily-broadcast` to regenerate |

