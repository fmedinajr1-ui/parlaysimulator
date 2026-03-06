

# Fix: player_backed Always 0 in Matchup Scanner

## Root Cause

Two bugs in `bot-matchup-defense-scanner`:

1. **Category key mismatch** (line 56-61): The scanner looks for categories like `NBA_POINTS`, `NBA_THREES`, `NBA_ASSISTS`, `NBA_REBOUNDS` — but `category_sweet_spots` uses behavior-based categories like `STAR_FLOOR_OVER`, `VOLUME_SCORER`, `THREE_POINT_SHOOTER`, `HIGH_ASSIST`, `BIG_REBOUNDER`, etc. The lookup returns 0 results every time.

2. **No team filtering**: Sweet spots have no `team` column, so even if the category matched, it would return ALL players across the league, not just those on the attacking team. The `bdl_player_cache` table has reliable `player_name → team_name` mappings that can be used for filtering.

## Fix

Rewrite the player target lookup in `bot-matchup-defense-scanner/index.ts`:

1. **Replace category-based lookup with prop_type-based lookup**: Instead of matching on `category`, query `category_sweet_spots` using `prop_type` column (which contains `'points'`, `'threes'`, `'assists'`, `'rebounds'`). This field aligns directly with the scanner's stat categories.

2. **Add team filtering via bdl_player_cache**: At startup, load `bdl_player_cache` to build a `player_name → team_abbreviation` map. In `findPlayerTargets`, filter sweet spots to only include players on the attacking team.

### Changes to `supabase/functions/bot-matchup-defense-scanner/index.ts`:

- **Remove** `STAT_TO_SWEET_SPOT_CATEGORIES` mapping (lines 56-61) — no longer needed
- **Add** on startup: load `bdl_player_cache` into a `playerTeamMap: Map<string, string>` (player_name → team abbreviation, using `resolveTeamAbbrev` on team_name)
- **Replace** sweet spot indexing (lines 188-195): index by `prop_type` instead of `category`
- **Rewrite** `findPlayerTargets` (lines 199-243): filter by `prop_type` match AND `playerTeamMap.get(playerName) === teamAbbrev`

### File changed
- `supabase/functions/bot-matchup-defense-scanner/index.ts`

