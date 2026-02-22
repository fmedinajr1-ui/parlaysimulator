

## Fix War Room: Smooth Game Switching, Loading States, and Stability

### Problems Identified

1. **Game disappearing on switch**: When clicking a new game in the strip, `CustomerLiveGamePanel` immediately renders "Game data not available yet" because the new `eventId`/`espnEventId` hasn't resolved yet -- there's no transition state
2. **No loading indicator during game switch**: The ESPN event ID resolution is async (`get-espn-event-id`), so there's a window where the panel has no `espnEventId` and the PBP hook returns nothing
3. **Jarring transitions**: No `AnimatePresence` or fade on the live game panel when switching between games -- it hard-cuts
4. **PBP data not cleared on game switch**: When switching games, stale PBP data from the previous game can briefly flash before new data arrives

### Fix Plan

**File 1: `src/components/scout/CustomerLiveGamePanel.tsx`**

- **Add a loading/transition state when `game` is null but we have team names**: Show a proper loading skeleton with team names and a spinner instead of the static "Game data not available yet" message
- **Clear PBP data on game change**: Reset `pbpData` to `null` when `espnEventId` changes so stale scores from the previous game don't flash
- **Wrap the entire panel in a keyed container**: Use `key={eventId}` so React cleanly unmounts/remounts the panel on game switch rather than trying to reconcile stale state

**File 2: `src/components/scout/warroom/WarRoomLayout.tsx`**

- **Add `AnimatePresence` + fade transition around `CustomerLiveGamePanel`**: Wrap the live game panel with `AnimatePresence` and `motion.div` keyed by `gameContext.eventId` so switching games gets a smooth crossfade instead of a hard cut
- **Show a loading skeleton while game context is resolving**: If `homeTeam`/`awayTeam` are empty (brief window during switch), show a placeholder

**File 3: `src/pages/Scout.tsx`**

- **Fix the game switch race condition**: In `resolveAndSetGame`, the `espnEventId` is set asynchronously. If a user clicks a second game before the first resolve completes, the stale resolve callback can overwrite the new game. Add a guard using the `eventId` to prevent stale updates (already partially there but needs strengthening)

### Technical Details

**CustomerLiveGamePanel.tsx changes:**
```text
1. In useLivePBP hook: reset data to null when espnEventId changes
   - Add useEffect that calls setData(null) when espnEventId changes

2. Replace the "Game data not available yet" block (lines 502-519) with a loading card:
   - Show team names (awayTeam @ homeTeam)
   - Add an animated loading spinner
   - Text: "Loading game data..."

3. Add key={primaryEventId} to the outermost Card (line 523) to force clean remount
```

**WarRoomLayout.tsx changes:**
```text
1. Wrap CustomerLiveGamePanel (around line 180) in:
   <AnimatePresence mode="wait">
     <motion.div
       key={gameContext.eventId}
       initial={{ opacity: 0 }}
       animate={{ opacity: 1 }}
       exit={{ opacity: 0 }}
       transition={{ duration: 0.2 }}
     >
       <CustomerLiveGamePanel ... />
     </motion.div>
   </AnimatePresence>
```

**Scout.tsx changes:**
```text
1. In resolveAndSetGame, use a ref to track the latest eventId being resolved
2. In the .then() callback, check if the ref still matches before updating state
   - This prevents a slow ESPN resolve from overwriting a newer game selection
```

### Files Modified

1. `src/components/scout/CustomerLiveGamePanel.tsx` -- Clear stale PBP data on switch, add loading state, key-based remount
2. `src/components/scout/warroom/WarRoomLayout.tsx` -- Smooth fade transition on game switch
3. `src/pages/Scout.tsx` -- Fix ESPN ID resolution race condition

### Expected Outcome

- Switching games shows a smooth fade with loading indicator
- No more "game disappeared" -- loading skeleton bridges the gap
- Previous game's scores never flash on the new game
- ESPN ID resolution can't clobber a newer game selection
