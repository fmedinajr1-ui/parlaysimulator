

## Upgrade Hedge Recommendations: Clearer Actions + Alt Line Suggestions

### Problem 1: "EXIT" is confusing
The Hedge Mode table shows "EXIT" as an action label but doesn't explain what to do. EXIT means the prop is going badly and you should **bet the opposite side** to lock in a smaller loss (or break even). The current label gives no direction.

### Problem 2: Hedge alerts aren't helpful enough
The slide-in alerts just say "BET OVER 17.5" with a Kelly %. They don't explain **why**, don't show alt lines from other books, and don't give you options.

### Changes

**File: `src/components/scout/warroom/HedgeModeTable.tsx`**

1. Replace "EXIT" with "HEDGE" as the action label (red pill stays)
2. Add a new column **"Hedge"** that only appears when a row's action is HEDGE -- shows a mini recommendation like "Bet UNDER 19.5" with the smartest book line
3. Use `allBookLines` from the prop data to find the best alt line for the opposite side
4. Update the tooltip for Action column to explain HEDGE instead of EXIT

**File: `src/components/scout/warroom/HedgeSlideIn.tsx`**

5. Add a new **"Alt Lines"** section inside each hedge alert card showing all available book lines so users can compare (e.g., "HR: 19.5 | FD: 17.5 | DK: 18.5")
6. Add a **"Why"** explanation line that says something like "Projection (15.2) is 4.3 below the line (19.5)" so users understand the reasoning
7. Show the **original bet side** vs the **hedge side** clearly (e.g., "Your bet: OVER 17.5 -- Hedge: UNDER 19.5 @ Hard Rock")
8. Update the primary action button to say the specific hedge action (e.g., "Hedge UNDER 19.5")

**File: `src/components/scout/warroom/WarRoomLayout.tsx`**

9. Pass `allBookLines` and the original pre-game `side` into the `HedgeOpportunity` object so the slide-in has everything it needs
10. Add `originalSide` and `originalLine` fields to the opportunity
11. Generate a plain-English `alertMessage` explaining the gap (e.g., "Proj 15.2 is 4.3 below line. Consider hedging UNDER.")

**File: `src/components/scout/warroom/HedgeSlideIn.tsx` (interface)**

12. Add to `HedgeOpportunity`: `originalSide`, `originalLine`, `allBookLines`

### What This Fixes
- **EXIT becomes HEDGE** with a clear instruction on what to bet
- Each hedge alert shows **all available alt lines** across books so you can pick the best one
- A **"Why"** line explains the math in plain English
- The **original bet vs hedge** is shown side by side so you know exactly what you're protecting

### Example Card (After)

```
HEDGE OPPORTUNITY
LeBron James

Your bet: OVER 17.5
Hedge: BET UNDER 19.5

Why: Projection (15.2) is 2.3 below line. Hedging locks in protection.

Alt Lines:
  Hard Rock: 19.5  |  FanDuel: 17.5  |  DraftKings: 18.5
  Best for UNDER: Hard Rock 19.5 (most room)

via Hard Rock
Kelly: 3.2%

[Hedge UNDER 19.5]  [Dismiss]
```

### Technical Details

**HedgeOpportunity interface additions:**
```typescript
originalSide: string;    // The side from your original bet
originalLine: number;    // The pre-game line
allBookLines?: { line: number; bookmaker: string }[];
```

**HedgeModeTable action logic update (line 123):**
```typescript
// Old: edge > -2 ? 'MONITOR' : 'EXIT'
// New: edge > -2 ? 'MONITOR' : 'HEDGE'
```

**Alert message generation (WarRoomLayout.tsx):**
```typescript
const gap = Math.abs(p.projectedFinal - smartLine).toFixed(1);
const direction = side === 'OVER' ? 'above' : 'below';
const alertMessage = `Proj ${p.projectedFinal.toFixed(1)} is ${gap} ${direction} line. ${
  side !== p.side ? 'Hedging locks in protection.' : ''
}`;
```

**3 files modified. No database changes.**

