

## Add Customer Game Selector to War Room

Currently, customers only see the single game an admin sets live via `scout_active_game`. This change adds a game picker so customers can browse and switch between all available live games.

### How It Works

- A horizontal game strip appears at the top of the War Room, showing all today's games from `live_game_scores`
- Each game shows as a compact pill with team abbreviations, score, and live status
- The admin-set game is pre-selected and marked with a star indicator
- Clicking a different game switches the entire War Room context to that game
- Live games (in_progress) are highlighted with a pulsing dot; scheduled games show tip-off time

### What Changes

**1. New Component: `WarRoomGameStrip.tsx`**
- Horizontal scrollable strip of game pills
- Fetches all today's games from `live_game_scores` via `useLiveScores`
- Each pill: `AWY score @ HME score` with status indicator
- Active game highlighted with green border
- Admin-set game gets a small star badge
- Clicking a pill calls `onSelectGame` with the game's team info and event ID

**2. Modified: `Scout.tsx` (Customer Flow)**
- Instead of locking to only `activeGame`, allow `selectedGame` to be changed by customers too
- Pass an `onGameChange` callback to `CustomerScoutView` -> `WarRoomLayout`
- Resolve ESPN event ID when customer switches games

**3. Modified: `WarRoomLayout.tsx`**
- Add the `WarRoomGameStrip` above the mode toggle
- Accept optional `onGameChange` and `allGames` props
- When a game is selected from the strip, propagate up to `Scout.tsx` to update `selectedGame`

**4. Modified: `CustomerScoutView.tsx`**
- Pass through `onGameChange` prop to `WarRoomLayout`

### Technical Details

**Data source:** `useLiveScores()` (no filters) gives all games across sports. We filter to NBA or show all sports with section headers.

**Game switching flow:**
1. User taps a game pill in the strip
2. `WarRoomLayout` calls `onGameChange({ eventId, homeTeam, awayTeam, ... })`
3. `Scout.tsx` updates `selectedGame` state and resolves the ESPN event ID
4. `CustomerLiveGamePanel` and all prop/hedge data re-render for the new game

**ESPN ID resolution:** When switching games, we call `get-espn-event-id` to resolve the new game's ESPN ID for live score matching (same pattern already used on initial load).

**Files created:**
- `src/components/scout/warroom/WarRoomGameStrip.tsx`

**Files modified:**
- `src/pages/Scout.tsx` -- allow customers to change `selectedGame`, pass `onGameChange` callback
- `src/components/scout/CustomerScoutView.tsx` -- pass `onGameChange` through
- `src/components/scout/warroom/WarRoomLayout.tsx` -- render `WarRoomGameStrip`, wire up game change
