

# Scout Page TikTok-Ready Upgrade: UI Polish, Hedging, and L5 Hit Rate Cards

## Overview
Three enhancements to make the Scout page showcase-ready for a live TikTok demo:
1. UI cleanup and bug scan
2. Add hedging recommendations to the Player Props (EdgeRowCompact) cards
3. Add L5 game scoring history + hit rate under each player prop card

---

## 1. UI Cleanup and Bug Fixes

### Issues Found
- **Header overflow on mobile**: The "Halftime Betting Console" header has too many elements (title, refresh, timestamp, status badge, game time badge, Copy All button) that can overflow on narrow TikTok-portrait screens
- **EdgeRowCompact stat row wrapping**: The "Now / Proj / Edge / Conf" row wraps awkwardly on small screens
- **Tab labels cut off on mobile**: The 4-tab layout (Game Bets / Player Props / Lock / Advanced) uses `grid-cols-4` which gets cramped
- **Empty states visible during demo**: When no edges are loaded yet, generic empty states show (not good for a live demo)
- **ScoutAutonomousAgent video preview aspect ratio**: The `aspect-video` container looks large on mobile when not actively capturing

### Fixes
- Tighten the HalftimeBettingPanel header: stack timestamp below title on mobile, reduce badge padding
- Make EdgeRowCompact stat row use smaller text (`text-xs`) and tighter gaps on mobile
- Ensure tab labels are readable on mobile with shorter labels
- Add a subtle loading shimmer instead of generic empty states
- Reduce video preview height on mobile

---

## 2. Hedging Recommendations on EdgeRowCompact (Player Props)

### What It Does
Under each player prop edge card, show a compact hedging recommendation based on the existing `HedgeRecommendation` logic from `src/components/sweetspots/HedgeRecommendation.tsx`.

### Implementation
- Create a new `PropHedgeIndicator` component that takes a `PropEdge` and calculates:
  - Current progress toward line (already shown as progress bar)
  - Hedge status: ON TRACK / MONITOR / HEDGE ALERT / HEDGE NOW
  - Recommended action text (e.g., "Bet UNDER 24.5 now" or "Hold position")
  - Hedge sizing suggestion based on gap
- Display this as a compact colored banner below the progress bar in `EdgeRowCompact`:
  - Green = on track, no action
  - Yellow = monitor, prepare hedge
  - Red = hedge now with specific action
- Uses existing data from `PropEdge`: `currentStat`, `expectedFinal`, `line`, `lean`, `confidence`, `remainingMinutes`
- No new API calls needed -- all data is already in the edge object

### Visual Design
```text
+-----------------------------------------------+
| #1 LeBron James  [OVER Points 28.5]           |
| Now 14  Proj 30.2  Edge +1.7  Conf 78%        |
| [=========>          ] 49% to line             |
| [green] ON TRACK -- Projected to clear by 3.2 |
+-----------------------------------------------+
```

or in urgent state:
```text
| [red] HEDGE NOW -- Bet UNDER 28.5 ($25-50)    |
```

---

## 3. L5 Game Scoring History + Hit Rate Under Each Prop Card

### What It Does
For each player prop edge, fetch that player's last 5 game results for the relevant stat and show:
- A compact row of their L5 scores (e.g., `22 | 18 | 31 | 25 | 19`)
- Hit rate vs the current line (e.g., "3/5 would have hit OVER 24.5")
- Visual indicators (green/red dots per game)

### Implementation
- Create a new `PlayerL5History` component
- Create a `usePlayerL5Stats` hook that:
  - Takes `playerName` and `propType` (Points/Rebounds/Assists)
  - Queries `nba_player_game_logs` for last 5 games: `points`, `rebounds`, `assists`, `threes_made`
  - Calculates hit rate against the current line
  - Caches results per player to avoid repeated queries
- Uses React Query with `staleTime: 300000` (5 min cache) to avoid hammering DB during live demo
- Display inside `EdgeRowCompact` below the progress bar (always visible, not in the collapsible)

### Visual Design
```text
L5: 22  18  31  25  19  |  3/5 hit OVER 24.5 (60%)
    [g] [r] [g] [g] [r]
```

Where `[g]` = green dot (would have hit), `[r]` = red dot (would have missed)

---

## Technical Details

### New Files
1. `src/components/scout/PropHedgeIndicator.tsx` -- Compact hedge status banner
2. `src/components/scout/PlayerL5History.tsx` -- L5 game history display
3. `src/hooks/usePlayerL5Stats.ts` -- Hook to fetch L5 game logs per player/prop

### Modified Files
1. `src/components/scout/EdgeRowCompact.tsx` -- Add `PropHedgeIndicator` and `PlayerL5History` below progress bar
2. `src/components/scout/HalftimeBettingPanel.tsx` -- Minor mobile layout fixes
3. `src/components/scout/ScoutAutonomousAgent.tsx` -- Minor mobile viewport fixes, tighten video preview

### Data Flow
- `nba_player_game_logs` table already has all needed columns: `player_name`, `game_date`, `points`, `rebounds`, `assists`, `threes_made`
- No new database tables or migrations needed
- No new edge functions needed
- All hedging logic derived from existing `PropEdge` fields

### Performance Considerations
- L5 queries batched per visible player (max 8 at a time due to `slice(0, 8)` in ranked edges)
- React Query deduplication prevents duplicate fetches
- 5-minute stale time means minimal DB load during a TikTok stream

