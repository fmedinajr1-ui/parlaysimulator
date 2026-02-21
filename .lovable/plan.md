

## Fix War Room: Game Accuracy, Prop Cards, and Live Connectivity

### Problems Identified

1. **Game strip shows stale/wrong games**: The `live_game_scores` table has yesterday's (Feb 20) games. No date filter means ALL historical games appear in the strip. Today's games haven't been synced yet.

2. **Prop cards never display**: The filter `s.liveData || isDemo` blocks all pre-game prop cards. Sweet spot data exists in `unified_props` for tonight's games but is hidden because there's no live feed yet.

3. **Team name mismatch between data sources**: Games in `live_game_scores` (old) don't match team names in `unified_props` (current), so the game-to-prop filter produces zero results.

### Solution

**1. Derive game list from `unified_props` instead of `live_game_scores` (`WarRoomGameStrip.tsx`)**

The sweet spots engine already fetches today's props from `unified_props` with `game_description` and `commence_time`. Instead of relying on `live_game_scores` (which may be stale), extract the unique games from the props data that's already loaded.

- Accept a `games` prop derived from `useDeepSweetSpots` data
- Fall back to `useLiveScores` only for live score/status overlay
- Cross-reference with `live_game_scores` for live status indicators when available

**2. Show prop cards without requiring live data (`WarRoomLayout.tsx`)**

Remove the `s.liveData || isDemo` gate. Pre-game props have edge, line, confidence, hit rate -- all the data needed for the War Room cards. Live data enriches them when a game starts but shouldn't be required.

Change:
```
.filter((s) => s.liveData || isDemo)
```
To:
```
// Show all enriched spots (pre-game data is sufficient for cards)
// No liveData filter -- cards display with pre-game stats
```

**3. Build game list from enriched spots (`WarRoomLayout.tsx`)**

Extract unique games from `enrichedSpots` (from `useDeepSweetSpots`) and pass them to `WarRoomGameStrip`. This guarantees the game list matches available prop data.

**4. Trigger `sync-live-scores` on mount (`WarRoomLayout.tsx`)**

Call `sync-live-scores` once when the War Room mounts to ensure `live_game_scores` has today's games. This populates live status/scores for the game strip overlay.

**5. Auto-select first game if none selected (`Scout.tsx`)**

When the customer has no admin-set game and no selection, auto-select the first available game from the props list (sorted by commence time, live games first).

### Files Modified

- `src/components/scout/warroom/WarRoomGameStrip.tsx` -- Accept games from props data; merge with live scores for status; filter to NBA; add date guard
- `src/components/scout/warroom/WarRoomLayout.tsx` -- Extract games from enrichedSpots; remove liveData gate on propCards; trigger sync-live-scores on mount; pass games to strip
- `src/pages/Scout.tsx` -- Auto-select first available game when no admin game is set; pass available games down

### Technical Details

**Game list derivation:**
```typescript
// In WarRoomLayout.tsx
const availableGames = useMemo(() => {
  const gameMap = new Map();
  for (const s of allEnrichedSpots) {
    if (!s.gameDescription) continue;
    const key = s.gameDescription;
    if (!gameMap.has(key)) {
      // Parse "Away Team @ Home Team"
      const parts = key.split(/\s+@\s+/);
      gameMap.set(key, {
        awayTeam: parts[0]?.trim() || '',
        homeTeam: parts[1]?.trim() || '',
        gameDescription: key,
        commenceTime: s.commenceTime || '',
        propCount: 1,
      });
    } else {
      gameMap.get(key).propCount++;
    }
  }
  return Array.from(gameMap.values())
    .filter(g => g.homeTeam && g.awayTeam);
}, [allEnrichedSpots]);
```

**Prop card gate removal:**
```typescript
// Before (blocks pre-game cards):
.filter((s) => s.liveData || isDemo)

// After (shows all matched props):
// No filter - all enrichedSpots for this game are shown
```

**Live score overlay merge:**
The `WarRoomGameStrip` will accept both the props-derived game list AND live scores, merging them so pills show live score/status when available while always showing all games that have props.

