

## Simplify War Room Prop Cards

### Problem
Each prop card currently shows **6 sections** of data with redundant information:
- Pace appears TWICE (a full meter bar AND a percentage in the bottom row)
- P(O) and P(U) always add up to ~100%, so showing both is unnecessary
- Foul Risk showing "LOW" on every card is just noise
- Minutes Stability bar is secondary information that clutters the card
- The Fatigue Ring, Pace meter, and Min Stability are all variations of "is this player getting enough playing time"

### What Gets Removed
1. **Pace meter bar** -- redundant with the Pace % in the bottom row
2. **Minutes Stability bar** -- secondary metric, not actionable
3. **Foul Risk indicator** -- only useful when medium/high, "LOW" adds nothing
4. **Duplicate P(O)/P(U)** -- show only the one matching the pick side (OVER shows P(O), UNDER shows P(U))

### What Stays (simplified)
1. **Header**: Player name, prop type, side + line, edge badge, regression badge, hedge bolt
2. **Win probability**: Single number -- "72% chance" instead of "P(O): 72.0% P(U): 28.0%"
3. **Progress bar**: Current / Line + Projected final
4. **Bottom row**: Pace % | AI confidence | L10 hit rate

### Result
Cards go from 6 sections down to 4. Each card is roughly 40% shorter, letting you see more props on screen at once without scrolling.

### Technical Details

**1 file modified: `src/components/scout/warroom/WarRoomPropCard.tsx`**

- Remove the entire Pace Meter section (lines 186-214)
- Remove the entire Minutes Stability section (lines 216-240)
- Replace the P(O)/P(U)/Foul Risk row with a single "Win prob" line showing only the relevant probability for the pick side
- Keep header, progress bar, and bottom metrics row unchanged
