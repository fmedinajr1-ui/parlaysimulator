

# Remove Misleading Summary Alt Line from Team News Shift / Correlation Alerts

## Problem
Team News Shift and Correlated Movement alerts show a summary "Alt Line Edge: OVER 21 (-5 pts)" at the bottom. This number is calculated by averaging the current lines of ALL players in the group, then applying the buffer. That averaged line is meaningless — you can't bet on it. The per-player alt lines shown inline (e.g., "Jalen Suggs: rising 1 → Alt OVER 22.5") are already correct and actionable.

## Fix

### File: `supabase/functions/fanduel-behavior-analyzer/index.ts`

**Remove the summary alt line for correlation alerts (~line 1673)**

The `getAltLineText(...)` call on line 1673 produces the misleading summary. Remove it for `team_news_shift` and `correlated_movement` alert types since each player already has their own per-player alt line displayed inline (lines 1622-1631).

Change line 1673 from:
```
const altLineMsg = isTeamMarketCorr ? "" : getAltLineText(action, ...);
```
to:
```
const altLineMsg = ""; // Per-player alt lines already shown inline
```

This removes the nonsensical averaged alt line while keeping the correct per-player alt lines intact.

## What Stays
- Per-player alt lines (e.g., "Suggs: rising 1 → Alt OVER 22.5") — unchanged
- Volatile player buffers on per-player alt lines — unchanged
- Alt Line Edge on single-player signals (take_it_now, velocity_spike, etc.) — unchanged

## Scope
- 1 line change in `fanduel-behavior-analyzer`
- No migration needed

