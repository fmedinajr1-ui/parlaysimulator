

## Keep All Props and Hedge Data Visible During All Game States

### The Problem
When a game is at halftime or hasn't started yet, props get `isLive: false` with zeroed-out values (`currentValue: 0`, `projectedFinal: 0`). This means:
- The Hedge Mode table shows 0s for "Now" and "Projected" columns
- Hedge status can't calculate (returns null for non-live spots)
- Props look broken during halftime transitions even though the game is still active

During live play, timeouts are NOT an issue (the feed reports them as `in_progress`), but halftime and pre-game states currently neuter the data.

### The Fix

**File: `src/hooks/useSweetSpotLiveData.ts`**

1. When a player IS found in the feed but game status isn't `in_progress` or `halftime` (e.g., `scheduled`), **preserve pre-game projection data** instead of zeroing everything out. Use the spot's existing edge + line as the projected final, and L10 avg as the baseline.

2. For the `isLive` flag, introduce a softer check: set `isLive: true` for both `in_progress` AND `halftime` (already done). But critically, for `scheduled` games, still set `isLive: false` but keep the projections populated so the hedge table can still show useful data.

3. Remove the early-return on line 102 that zeros out data when game isn't in progress. Instead, populate a "pre-game" version of liveData that carries forward the pre-game projections and any available live line data.

**File: `src/lib/hedgeStatusUtils.ts`**

4. Relax the gate on line 28: allow hedge status calculation for spots that have a populated `projectedFinal` even when `isLive` is false. The key guard should be "is there enough data to calculate?" not "is the game literally in progress right now?"

5. Only return `null` when there's truly no data (no projectedFinal, no currentValue) or game is `final`.

### Technical Details

**`useSweetSpotLiveData.ts` -- Replace the early return (lines 101-128):**

Instead of returning zeroed-out data when game isn't in_progress/halftime, build liveData with pre-game projections:

```typescript
// Game found but not actively in progress
if (game.status !== 'in_progress' && game.status !== 'halftime') {
  // Still populate with pre-game projections so hedge table works
  const preGameProjection = projection?.projected ?? (spot.edge + spot.line);
  const preGameCurrent = projection?.current ?? 0;
  
  return {
    ...spot,
    liveData: {
      isLive: false,
      gameStatus: game.status as any,
      currentValue: preGameCurrent,
      projectedFinal: preGameProjection,
      gameProgress: 0,
      period: '',
      clock: '',
      confidence: projection?.confidence ?? spot.sweetSpotScore ?? 50,
      riskFlags: [],
      trend: 'stable' as const,
      minutesPlayed: 0,
      ratePerMinute: 0,
      paceRating: game.pace ?? 100,
      shotChartMatchup,
      currentQuarter: 0,
      quarterHistory: [],
      liveBookLine: liveLineData?.liveBookLine,
      lineMovement: liveLineData?.lineMovement,
      lastLineUpdate: liveLineData?.lastUpdate,
      bookmaker: liveLineData?.bookmaker,
    },
  };
}
```

**`hedgeStatusUtils.ts` -- Relax the gate (line 28):**

```typescript
// Old: blocks all non-live, non-halftime
if (!liveData || (!liveData.isLive && liveData.gameStatus !== 'halftime')) {
  return null;
}

// New: only block when there's truly no useful data or game is done
if (!liveData) return null;
if (liveData.gameStatus === 'final') return null;
if (!liveData.projectedFinal && !liveData.currentValue) return null;
```

This means:
- **Pre-game**: hedge status calculates using pre-game projections (shows LOCK/HOLD/MONITOR based on expected performance)
- **In-progress**: full live data, same as now
- **Halftime**: full live data with recalibrated projections
- **Timeouts**: stay as `in_progress`, no change needed
- **Final**: returns null (game over, no hedging possible)

### What Changes for the User
- All props stay on the board with their data populated during every game state
- Hedge Mode table always shows meaningful numbers, never zeros
- Pre-game props show pre-game projections and can trigger early MONITOR/HEDGE based on line movement
- Halftime props keep their data and hedge status intact
- Nothing disappears during quarter breaks or timeouts

**2 files modified. No database changes.**
