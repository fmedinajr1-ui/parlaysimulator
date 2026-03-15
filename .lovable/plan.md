

# Add Smart Alt Line Column to Hedge Monitor Table

## What This Does

Adds a new **"Smart Line"** column to the Hedge Monitor table (the compact table view) so users can see when the live book line has moved from their original line — right next to the existing columns. This mirrors the live-vs-original comparison already shown on individual prop cards.

## Change

### `src/components/scout/warroom/HedgeModeTable.tsx`

1. **Add a new column header** "Alt Line" between "Need" and "Progress" (or after "Hedge") with a tooltip explaining it shows the current live book line vs original.

2. **Add cell content** for each row:
   - If `p.liveBookLine` exists and differs from `p.line` by ≥ 0.5:
     - Show the live book line value with color coding (green if favorable movement, red if unfavorable)
     - Show the delta (e.g., `↓ 2.0`) 
   - Otherwise show "—"

3. The data is already available — `WarRoomPropData` already has `liveBookLine` and `allBookLines` fields, so no data plumbing is needed.

## Example Row Output

```text
PROP          NOW  NEED  ALT LINE    PROGRESS  PROJECTED  GAP   VALUE  ACTION  HEDGE
Player PTS O   8   24.5  22.5 ↓2.0   ████──    26.2      +1.7  SOFT   HOLD    —
```

The alt line `22.5 ↓2.0` would be green (line moved in the user's favor for an OVER bet).

