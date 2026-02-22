

## Fix Hedge Side Logic — Always Hedge OPPOSITE to the Bet

### The Bug
The hedge column shows "OVER 14.5" for Aaron Wiggins when his bet IS over. The hedge should be UNDER (bet the opposite side to protect).

**Root cause:** The `side` field on each prop comes from the algorithm's recommended side (which might be 'under' based on L10 stats), not necessarily matching the user's actual bet. When the hedge logic flips 'under' to 'OVER', it incorrectly shows the same direction as the user's real bet.

Additionally, the edge/gap calculation (`projectedFinal - line`) always assumes OVER logic. For UNDER bets, a positive gap should mean the player is staying below the line (good), not above it.

### Fix

**File: `src/components/scout/warroom/HedgeModeTable.tsx`**

1. **Make edge calculation side-aware:**
   - OVER bets: `edge = projectedFinal - line` (positive = on track, negative = behind)
   - UNDER bets: `edge = line - projectedFinal` (positive = staying under, negative = going over)

2. **Fix hedge side derivation** — the hedge is always the OPPOSITE of the bet side:
   - If `side` is OVER, hedge must be UNDER
   - If `side` is UNDER, hedge must be OVER
   - Default to OVER when side is undefined/null (most bets are overs)

3. **Display the original side in the Prop column** so users can see what they bet (e.g., "Chet Holmgren PTS O" or "U")

4. **Progress bar** — already side-aware (line 64), no change needed

### Technical Details

```
// Current (broken):
const edge = p.projectedFinal - p.line;  // ignores side
const hedgeSide = p.side?.toUpperCase() === 'OVER' ? 'UNDER' : 'OVER';  // p.side may be algorithm's side, not user's bet

// Fixed:
const betSide = (p.side || 'OVER').toUpperCase();
const isOver = betSide !== 'UNDER';
const edge = isOver
  ? p.projectedFinal - p.line      // OVER: positive = clearing line
  : p.line - p.projectedFinal;     // UNDER: positive = staying under
const hedgeSide = isOver ? 'UNDER' : 'OVER';  // always opposite
```

The hedge line selection logic (lines 140-150) is already correct — it picks the highest line for UNDER hedges and lowest for OVER hedges. Only the side derivation and edge calculation need fixing.

### Result
- Aaron Wiggins (OVER 14.5, projected 10.0): Gap = -4.5, Action = HEDGE, Hedge = **UNDER 14.5** (not OVER)
- All OVER bets that are failing will correctly suggest UNDER hedges
- UNDER bets that are failing will correctly suggest OVER hedges
- Gap column will show positive (green) when on track regardless of side

**1 file modified. No database changes.**
