

## Fix Play-by-Play and Box Score in War Room

### Problems Found

1. **Play-by-Play is hardcoded empty** -- `CustomerLiveGamePanel` has a `useMemo` that always returns `[]` with a TODO comment. The `fetch-live-pbp` backend function exists and returns real play-by-play data from ESPN, but the component never calls it.

2. **Box Score uses stale data** -- The component reads `game.playerStats` from the `live_game_scores` database table, which only updates when `sync-live-scores` runs. During live games, box score data can be minutes behind. The `fetch-live-pbp` function returns fresh player stats directly from ESPN but isn't used.

### Solution

Call `fetch-live-pbp` directly from `CustomerLiveGamePanel` on a 15-second polling interval. This gives the component real-time box score AND play-by-play data straight from ESPN.

### Changes

**File: `src/components/scout/CustomerLiveGamePanel.tsx`**

1. Add a new `useLivePBP` hook (inline or extracted) that:
   - Takes the ESPN event ID
   - Calls `fetch-live-pbp` every 15 seconds via `supabase.functions.invoke`
   - Returns `{ players, recentPlays, isLoading }`
   - Only polls when the game status is `in_progress` or `halftime`

2. Replace the hardcoded empty `recentPlays` with the real plays from `fetch-live-pbp`

3. Merge box score data: prefer fresh PBP player stats over stale `live_game_scores` player stats. When PBP data is available, use it; fall back to DB data otherwise.

4. Map the PBP `recentPlays` format to the component's `RecentPlay` interface:
   - `fetch-live-pbp` returns: `{ time, text, playType, team, playerName, isHighMomentum }`
   - Component expects: `{ id, playType, description, clock, period, team }`
   - Simple field mapping needed

### Technical Details

**New polling logic in `CustomerLiveGamePanel`:**
```
- State: pbpData (players + recentPlays)
- Effect: poll fetch-live-pbp every 15s when espnEventId exists and game is live
- Cleanup: clear interval on unmount or when game ends
```

**Box Score priority:**
```
PBP players (fresh from ESPN) > game.playerStats (from live_game_scores DB)
```

**Play-by-Play mapping:**
```
PBP response play -> Component RecentPlay:
  text -> description
  time -> parse into period + clock (e.g. "Q2 8:45" -> period=2, clock="8:45")
  playType -> playType (already matching format)
  team -> team
```

**Files modified:**
- `src/components/scout/CustomerLiveGamePanel.tsx` -- Add direct `fetch-live-pbp` polling; wire real PBP data to PlayByPlayFeed; use fresh box score data from PBP response
