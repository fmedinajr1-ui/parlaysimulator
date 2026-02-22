

## Fix Hedge Recommendations: Use Live Lines + Stop Defaulting to OVER

### Problem 1: Stale Lines
Hedge alerts currently show the **original pre-game line** (e.g., "BET OVER 17.5") even when the book has moved it to 19.5. The live book line (`liveData.liveBookLine`) already exists in the data but is never passed through to the prop cards or hedge alerts.

### Problem 2: Always Defaulting to OVER
When the sweet spot engine doesn't specify a side, the code defaults to "OVER" (line 155: `s.side || 'OVER'`). The hedge alert then blindly echoes that side. There's no check of whether OVER or UNDER is actually favorable based on projection vs the live line.

### Changes

**File: `src/components/scout/warroom/WarRoomLayout.tsx`**

1. **Pass live book line through to prop cards** -- add `liveBookLine` field to `WarRoomPropData`, populated from `s.liveData?.liveBookLine ?? s.line` (falls back to original line if no live data)

2. **Use live line in hedge opportunities** -- replace `p.line` with `p.liveBookLine` for `liveLine`, `suggestedAction`, edge calculation, and Kelly sizing

3. **Fix side logic in hedge alerts** -- instead of echoing the pre-game side, determine the hedge side from the live projection vs live line:
   - If `projectedFinal > liveBookLine` then recommend OVER
   - If `projectedFinal < liveBookLine` then recommend UNDER
   - This means if UNDERS are hitting (projections coming in low), the system will correctly recommend UNDER

**File: `src/components/scout/warroom/WarRoomPropCard.tsx`**

4. **Add `liveBookLine` to the interface** so it's available if needed for display

### What This Fixes
- Hedge alerts will show the **current book line** (e.g., "BET UNDER 19.5") not the stale pre-game one
- The recommended side (OVER/UNDER) will be based on **projection vs live line math**, not a hardcoded default
- If projections are coming in under the line, the system will correctly say "BET UNDER"

### Technical Details

**`WarRoomPropData` interface change:**
```
liveBookLine: number;  // Current book line (may differ from original)
```

**Hedge side logic (replaces `p.side`):**
```
const liveLine = p.liveBookLine;
const side = p.projectedFinal >= liveLine ? 'OVER' : 'UNDER';
const suggestedAction = `BET ${side} ${liveLine}`;
```

**2 files modified. No database changes.**
