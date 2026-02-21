
## Filter Props and Games to Selected NBA Game

### Problem
Right now, the War Room shows props from ALL games across ALL sports, and the game strip shows every sport. Props and hedge data need to be scoped to the currently selected game.

### Changes

**1. Filter Game Strip to NBA only (`WarRoomGameStrip.tsx`)**
- Pass `sport: 'NBA'` filter to `useLiveScores` so only NBA games appear in the strip

**2. Filter prop cards to selected game (`WarRoomLayout.tsx`)**
- After `useDeepSweetSpots` returns all today's spots, filter `enrichedSpots` to only include players whose `gameDescription` matches the selected game's `homeTeam` and `awayTeam`
- This filtering happens in the `useMemo` that builds `propCards`, checking if the spot's `gameDescription` contains both `homeTeam` and `awayTeam`

**3. Hedge opportunities automatically follow**
- Since `hedgeOpportunities` are derived from `propCards`, they will automatically be scoped to the selected game once `propCards` is filtered

### Technical Details

**Game Strip filter** -- `useLiveScores` already supports a `sport` option. Change:
```
useLiveScores({})  -->  useLiveScores({ sport: 'NBA' })
```

**Prop filtering** -- Add a filter step in `WarRoomLayout.tsx` before the `propCards` useMemo. Each `DeepSweetSpot` has a `gameDescription` field (e.g. "Detroit Pistons @ Chicago Bulls"). Filter by checking if `gameDescription` includes both `homeTeam` and `awayTeam` from `gameContext`.

**Files modified:**
- `src/components/scout/warroom/WarRoomGameStrip.tsx` -- add NBA sport filter
- `src/components/scout/warroom/WarRoomLayout.tsx` -- filter enrichedSpots to selected game before building propCards, and filter confidencePicks/whisperPicks similarly
