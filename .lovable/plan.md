

## Always-Fresh Live Scoreboard

### Problem

The scoreboard currently shows scores from `useLiveScores` (30-second polling from the database + realtime subscription). But you already have fresher data from ESPN via `useLivePBP` (15-second polling) -- it's just not being used for the scoreboard display. The PBP data includes `homeScore`, `awayScore`, `period`, and `clock` but those values are only used for box score stats today.

### Fix

**File: `src/components/scout/CustomerLiveGamePanel.tsx`**

Two changes:

1. **Reduce PBP polling from 15s to 8s** (line 90) -- faster ESPN score updates
2. **Prefer PBP data for the scoreboard** (lines 526-536) -- use `pbpData.homeScore`/`awayScore`/`period`/`clock` when available, falling back to `game.*` when PBP hasn't loaded yet

```text
Before (line 526-536):
  homeScore={game.homeScore}
  awayScore={game.awayScore}
  period={game.period}
  clock={game.clock}

After:
  homeScore={pbpData?.homeScore ?? game.homeScore}
  awayScore={pbpData?.awayScore ?? game.awayScore}
  period={pbpData?.period ? `Q${pbpData.period}` : game.period}
  clock={pbpData?.clock ?? game.clock}
```

### Technical Details

- `useLivePBP` interval changes from `15000` to `8000` ms on line 90
- Scoreboard props on lines 529-532 updated to prefer `pbpData` fields with `??` fallback to `game` fields
- PBP `period` is a number (e.g. `2`), scoreboard expects string (e.g. `Q2`), so we format it
- No new API calls, no new hooks -- just using data you already fetch but weren't displaying

### Files Modified

- `src/components/scout/CustomerLiveGamePanel.tsx` -- Reduce poll interval to 8s, wire PBP scores into scoreboard display

### Result

Scoreboard updates every 8 seconds from ESPN instead of every 30 seconds from the database. Scores, period, and clock will always reflect the freshest available data.

