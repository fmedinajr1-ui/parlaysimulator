

## Show Game Selector First in War Room Tab

### Problem
When clicking "War Room", it immediately loads into a game (or demo mode) without letting you choose which game to view first. The game strip is buried below the live panel.

### Solution
Modify `AdminWarRoomView` to start with NO game selected. Instead of auto-resolving the active game, show a **game picker screen** first. Once you click a game, the full War Room loads for that game.

### What Changes

**File modified: `src/components/admin/AdminWarRoomView.tsx`**

1. Remove the `useEffect` that auto-resolves the active game on mount (lines 48-58)
2. When `gameContext` is `null` (no game selected yet), render a **game selection screen** instead of falling back to `demoGameContext`:
   - Show a title like "Select a Game"
   - Render the `WarRoomGameStrip` component (the horizontal pill selector) prominently
   - The strip already derives its game list from `enrichedSpots` (unified_props data), so all available games with props will appear
3. Once the user clicks a game pill, `handleGameChange` fires, sets `gameContext`, and the full War Room renders as normal

### Technical Detail

The tricky part: `WarRoomGameStrip` gets its `propsGames` list from `WarRoomLayout`, which only renders after a game is selected. To solve this, we need to either:
- **Option A**: Pull the props-fetching logic (`useDeepSweetSpots`) up into `AdminWarRoomView` and derive the games list there for the picker screen
- **Option B**: Create a lightweight `GamePickerScreen` component that fetches `useDeepSweetSpots` just to build the game list

We'll go with **Option A** -- fetch sweet spots in `AdminWarRoomView`, derive available games, and pass them to a standalone game strip on the picker screen. Once a game is picked, render `CustomerScoutView` as before.

Changes to `AdminWarRoomView`:
- Import `useDeepSweetSpots` and `WarRoomGameStrip`
- Build `availableGames` list from sweet spot data (same logic as `WarRoomLayout`)
- When no game selected: render game strip + a prompt message
- When game selected: render `CustomerScoutView` as today
- Add a "back to game select" option so you can switch without reloading the tab
