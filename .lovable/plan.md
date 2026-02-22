

## Add Clear Action Instructions to Hedge Alerts

### Problem
The Hedge Opportunity pop-ups show raw numbers (Projection: 18.0, Live Line: 17.5, Edge: +0.5) but never say **what to do**. You have to do the math yourself to figure out "projection is above the line, so... bet OVER?" That defeats the purpose.

### Solution
Add a bold, color-coded **action instruction** to each alert card that says exactly what to do, like:

- **"BET OVER 17.5"** (green) when projection is above the line
- **"BET UNDER 17.5"** (red) when projection is below the line

Also replace the vague "Hedge Now" button text with the actual action (e.g., "Take OVER 17.5").

### What Changes

**File: `src/components/scout/warroom/WarRoomLayout.tsx`**
- Pass the prop's `side` through to the `HedgeOpportunity` object so the alert knows the original bet direction
- Compute a `suggestedAction` string (e.g., "BET OVER 17.5") based on projection vs line

**File: `src/components/scout/warroom/HedgeSlideIn.tsx`**
- Add `side` and `suggestedAction` fields to the `HedgeOpportunity` interface
- Display the action instruction prominently at the top of each alert card, below the player name, in a large bold colored line (green for OVER, red for UNDER)
- Change the "Hedge Now" button label to show the action (e.g., "Take OVER 17.5")
- Remove "Edge" row (redundant with the action instruction) to keep cards clean

### Result
Instead of seeing just numbers, each alert will clearly say:

**Chet Holmgren**
**BET OVER 17.5** (in bold green)
Projection: 18.0 | Kelly: 0.71%
[Take OVER 17.5] [Dismiss]

No more guessing what the numbers mean.
