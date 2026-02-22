

## Simplify War Room: Merge Hedge Table + Confidence Dashboard

### Problem
The Hedge Mode Table and Confidence Dashboard show the same data (player progress toward their line) in two different formats. This is redundant and overwhelming. The column headers (PROJ, EDGE) use jargon that isn't immediately clear.

### Solution
1. **Remove the Confidence Dashboard entirely** when Hedge Mode is active (it's duplicate information)
2. **Simplify the Hedge Table** with clearer language and visual cues
3. **Add inline progress bars** to the Hedge Table so it combines both views into one

### Changes

**File: `src/components/scout/warroom/HedgeModeTable.tsx`**
- Rename columns to plain English:
  - "PROP" stays
  - "CURRENT" becomes "NOW"
  - "LINE" becomes "NEED" 
  - "PROJ" becomes "PROJECTED"
  - "EDGE" becomes "GAP"
  - "HEDGE" becomes "ACTION"
- Add a small inline progress bar in each row (colored green/yellow/red) showing current vs line visually
- Add a single survival % badge in the table header (replaces the entire Confidence Dashboard)
- Color the ACTION column more distinctly: red background pill for EXIT, yellow for MONITOR, green for LOCK

**File: `src/components/scout/warroom/WarRoomLayout.tsx`**
- When Hedge Mode is ON, hide the `CustomerConfidenceDashboard` component since the table now includes that info
- The Confidence Dashboard still shows in normal Game Mode (where there's no table)

### Result
One clean table that tells you everything at a glance:
- Player name + stat
- What they have NOW vs what they NEED
- A mini progress bar showing how close they are
- A clear colored ACTION pill (EXIT / MONITOR / HOLD / LOCK)
- Overall survival % in the header

No duplicate sections. No jargon. One view, one decision.

### Technical Details

**Files modified:**
- `src/components/scout/warroom/HedgeModeTable.tsx` -- simplified headers, added inline progress bars, added survival badge
- `src/components/scout/warroom/WarRoomLayout.tsx` -- conditionally hide `CustomerConfidenceDashboard` when hedge mode is active

**No database changes. No new files.**

