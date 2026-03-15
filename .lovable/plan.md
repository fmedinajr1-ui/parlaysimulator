

# Live Quarter Score Progression on War Room Cards

## What This Does
Adds real-time quarter-by-quarter stat tracking to each War Room prop card, showing how the player is performing in the current game quarter-by-quarter compared to their historical quarter averages.

## Changes

### 1. Extend `WarRoomPropData` with live quarter stats
**File**: `src/components/scout/warroom/WarRoomPropCard.tsx`

Add a new optional field to the interface:
```typescript
liveQuarterStats?: {
  currentQuarter: number;       // 1-4
  quarterActuals: number[];     // actual stats per quarter [q1, q2, q3, q4]
  isLive: boolean;
  clock?: string;
  period?: string;
};
```

### 2. Update `QuarterBreakdown` to show live overlay
**File**: `src/components/scout/warroom/WarRoomPropCard.tsx`

When `liveQuarterStats` is provided:
- Show the actual value below each quarter average (e.g., "Q1: avg 6.2 / actual 8")
- Color-code: green if actual >= average, red if below
- Highlight the current quarter with a pulsing border
- Show a cumulative progress bar: actual total vs projected line

### 3. Wire live data into `WarRoomLayout`
**File**: `src/components/scout/warroom/WarRoomLayout.tsx`

In the `propCards` builder (~line 182), extract per-quarter stats from the unified feed's `quarter_scores` or from `live_game_scores` player stats combined with the current period. The unified feed already returns `currentStats` and `period` — we map the player's current stat accumulation by quarter using the `quarter_player_snapshots` table data when available, falling back to splitting current stats proportionally by game progress.

### 4. Fetch quarter snapshots for active players
**File**: `src/components/scout/warroom/WarRoomLayout.tsx`

Add a query to `quarter_player_snapshots` for the current event's players. This table already stores per-quarter breakdowns (points, rebounds, assists, threes, steals, blocks) recorded at quarter boundaries. Map these into the `liveQuarterStats` shape for each prop card.

## Summary

| Change | File |
|---|---|
| Add `liveQuarterStats` to data interface | `WarRoomPropCard.tsx` |
| Update QuarterBreakdown with live overlay | `WarRoomPropCard.tsx` |
| Wire quarter snapshots + live period data | `WarRoomLayout.tsx` |

