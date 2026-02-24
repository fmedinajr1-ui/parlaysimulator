

## Unify Hedge Status Wording Across War Room

### The Problem

There are currently **four independent label systems** that don't align with each other:

| Component | Labels Used | Source Logic |
|-----------|-------------|-------------|
| Engine (`hedgeStatusUtils.ts`) | on_track, monitor, alert, urgent, profit_lock | Smart: game progress, pace, blowout, foul trouble |
| Hedge Mode Table | LOCK, HOLD, MONITOR, HEDGE | Simple: `edge > 2 / > 0 / > -2 / else` |
| PropHedgeIndicator | ON TRACK, MONITOR, HEDGE ALERT, HEDGE NOW | Simple: `buffer >= 3 / >= 1 / >= -1 / else` |
| CustomerHedgeIndicator | ON TRACK, CAUTION, ACTION NEEDED | Maps from engine statuses |

The Hedge Mode Table and PropHedgeIndicator both **ignore** the smart engine logic (game progress awareness, pace overrides, blowout detection) and use their own simple buffer math.

### The Fix

Align everything to a **single unified label set** that maps cleanly from the engine's 5-tier internal statuses:

| Engine Status | Action Label | Color |
|---------------|-------------|-------|
| `profit_lock` | **LOCK** | Green |
| `on_track` | **HOLD** | Green |
| `monitor` | **MONITOR** | Gold |
| `alert` | **HEDGE ALERT** | Orange |
| `urgent` | **HEDGE NOW** | Red |

### Changes

**1. `HedgeModeTable.tsx` -- Use engine status instead of simple edge math**

- Import `calculateHedgeStatus` from `hedgeStatusUtils.ts` (or adapt it for the `WarRoomPropData` shape since it expects `DeepSweetSpot`)
- Create a mapping function that converts `WarRoomPropData` fields into the inputs `calculateHedgeStatus` needs (currentValue, projectedFinal, line, side, gameProgress, paceRating, riskFlags)
- Replace the inline `edge > 2 ? 'LOCK' : ...` logic (line 159) with the mapped engine status
- Update `actionPill` styles to include all 5 labels: LOCK, HOLD, MONITOR, HEDGE ALERT, HEDGE NOW

**2. `PropHedgeIndicator.tsx` -- Align labels and thresholds**

- Update `calcHedgeStatus` to use the same threshold logic as the engine (progress-aware buffers via `getBufferThresholds`) instead of hardcoded `buffer >= 3 / >= 1 / >= -1`
- Rename labels to match: ON TRACK becomes HOLD, alert becomes HEDGE ALERT, hedge_now becomes HEDGE NOW
- Keep the settled states (HIT, LOST) as-is since those are clear terminal states

**3. `CustomerHedgeIndicator.tsx` -- Align customer-facing labels**

- Update the 3-tier customer mapping to use the unified wording:
  - `on_track` / `profit_lock` -> "ON TRACK" (no change)
  - `monitor` -> "MONITOR" (was "CAUTION")
  - `alert` / `urgent` -> "HEDGE ALERT" (was "ACTION NEEDED")
- This keeps the simplified 3-tier view but uses consistent terminology

**4. `actionPill` style map update in `HedgeModeTable.tsx`**

Add entries for the two new labels:
```
LOCK: green
HOLD: green (slightly muted)
MONITOR: gold
'HEDGE ALERT': orange
'HEDGE NOW': red (same as current HEDGE)
```

### Technical Detail

The `HedgeModeTable` receives `WarRoomPropData` which already has `currentValue`, `projectedFinal`, `line`, `side`, `paceRating`, and `confidence`. It's missing `gameProgress` and `riskFlags`. Two options:

- **Option A**: Add `gameProgress` to `WarRoomPropData` (it's available from the live feed) and create a lightweight adapter function in the table
- **Option B**: Create a standalone `getHedgeAction(currentValue, projectedFinal, line, side, gameProgress, paceRating)` function in `hedgeStatusUtils.ts` that both components can call directly

Option B is cleaner -- a single shared function that returns the unified label.

### Files Modified

| File | What Changes |
|------|-------------|
| `src/lib/hedgeStatusUtils.ts` | Add `getHedgeActionLabel()` utility that takes raw values and returns unified label |
| `src/components/scout/warroom/HedgeModeTable.tsx` | Use `getHedgeActionLabel()` instead of inline edge math; update `actionPill` styles for 5 labels |
| `src/components/scout/warroom/WarRoomPropCard.tsx` | Add optional `gameProgress` field to `WarRoomPropData` interface |
| `src/components/scout/warroom/WarRoomLayout.tsx` | Pass `gameProgress` from live feed data into prop cards |
| `src/components/scout/PropHedgeIndicator.tsx` | Use `getHedgeActionLabel()` and align label text |
| `src/components/scout/CustomerHedgeIndicator.tsx` | Rename "CAUTION" to "MONITOR" and "ACTION NEEDED" to "HEDGE ALERT" |

