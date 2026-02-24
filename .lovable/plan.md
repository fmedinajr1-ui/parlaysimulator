

## Fix bot-matchup-defense-scanner -- Two Critical Bugs

The scanner has never produced results because of two bugs that prevent it from finding any games or matching any teams.

### Bug 1: Wrong Date Range

The scanner builds a UTC midnight-to-midnight window:
```text
startUtc = "2026-02-24T00:00:00+00:00"
endUtc   = "2026-02-24T23:59:59+00:00"
```

Tonight's 11 NBA games (Feb 24 ET evening) are stored with UTC commence times on Feb **25** (00:10 - 03:40 UTC), so they're completely missed.

**Fix:** Replace with the same `getEasternDateRange()` pattern used by `bot-generate-daily-parlays` -- a noon-ET-to-noon-ET window that correctly captures tonight's games.

### Bug 2: Team Name Never Converted to Abbreviation

The scanner does `game.home_team.toUpperCase()` which produces `"INDIANA PACERS"`, then looks it up in `defenseMap` which is keyed by abbreviation `"IND"`. No match is ever found.

**Fix:** Add an NBA team name-to-abbreviation map inside the edge function (can't import from `src/lib` in Deno) and convert full team names to abbreviations before the defense lookup.

### Changes

**File: `supabase/functions/bot-matchup-defense-scanner/index.ts`**

1. Replace `getEasternDate()` with a proper `getEasternDateRange()` function that returns a noon-to-noon ET window in UTC (matching the parlay generator's approach)
2. Add an `NBA_TEAM_NAME_TO_ABBREV` map covering all 30 NBA teams and common variations (full names, short names)
3. Add a `resolveTeamAbbrev(teamName)` helper that converts "Indiana Pacers" to "IND"
4. Update the game loop to use `resolveTeamAbbrev()` instead of raw `.toUpperCase()`
5. Also deduplicate games by `event_id` since `game_bets` can have multiple rows per game (one per bookmaker)

### After the Fix

When the scanner runs, it will:
- Find all 11 NBA games tonight (plus any NCAAB games)
- Match teams like "Indiana Pacers" to defense profile "IND"
- Produce the matchup opportunity map with prime/favorable/avoid classifications
- Write results to `bot_research_findings` for the parlay generator to consume

