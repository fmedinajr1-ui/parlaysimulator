

# Live Line Tracking for Hedge Recommendations

## Problem Statement
The hedge recommendation system currently uses the **original pre-game line** for all calculations. During live games, sportsbooks dynamically adjust lines based on player performance:

| Scenario | Original Line | Live Line | Issue |
|----------|---------------|-----------|-------|
| Anthony Edwards slow start | OVER 28.5 | OVER 24.5 | System says "hedge UNDER 28.5" but book only offers UNDER 24.5 |
| Jalen Brunson hot start | OVER 22.5 | OVER 26.5 | Line moved up, better hedge opportunity exists |

**The current system gives stale hedge advice that doesn't match what's actually available to bet.**

---

## Solution: Integrate Live Line Tracking into Sweet Spots

### 1. Add Live Line Data to LivePropData Type

Extend the `LivePropData` interface to track live book lines:

```typescript
// In src/types/sweetSpot.ts
export interface LivePropData {
  // ... existing fields
  
  // NEW: Live line tracking
  liveBookLine?: number;        // Current book line (vs originalLine)
  lineMovement?: number;        // liveBookLine - originalLine
  lastLineUpdate?: string;      // ISO timestamp of last fetch
  bookmaker?: string;           // Which book the line is from
}
```

### 2. Create useLiveSweetSpotLines Hook

New hook that fetches live lines for all active Sweet Spot picks:

```typescript
// src/hooks/useLiveSweetSpotLines.ts

export function useLiveSweetSpotLines(
  spots: DeepSweetSpot[],
  options: { enabled?: boolean; intervalMs?: number } = {}
) {
  // Only scan spots with live games
  const liveSpots = spots.filter(s => s.liveData?.isLive);
  
  // Fetch live lines every 30s using fetch-current-odds
  // Returns Map<spotId, { liveBookLine, lineMovement, bookmaker }>
  
  // Key logic:
  // - For each live spot, call fetch-current-odds
  // - Track line movement (liveBookLine - spot.line)
  // - Cache results to avoid redundant API calls
}
```

### 3. Update HedgeRecommendation Component

Show both original line and live line, calculate against live line:

**New UI Section:**
```text
┌─────────────────────────────────────────────────┐
│ ⚠️ HEDGE ALERT                                  │
├─────────────────────────────────────────────────┤
│ 📌 Your Bet: OVER 28.5 (original line)         │
│ 📊 Current Book: UNDER 25.5 (-110)  ↓3.0       │
│                                                 │
│ Line moved in your favor! Book dropped 3 pts.  │
│ Hedge at 25.5 for guaranteed profit window.    │
├─────────────────────────────────────────────────┤
│ 🎯 Projected: 24.2 | Gap to 25.5: -1.3         │
│ ⚡ Action: BET UNDER 25.5 NOW ($25-50)          │
└─────────────────────────────────────────────────┘
```

**Calculation Changes:**
```typescript
function calculateEnhancedHedgeAction(spot: DeepSweetSpot) {
  // Use LIVE book line if available, otherwise original
  const hedgeLine = liveData.liveBookLine ?? spot.line;
  const lineMovement = liveData.lineMovement ?? 0;
  
  // Calculate gap against LIVE line
  const gapToLine = side === 'over' 
    ? projectedFinal - hedgeLine 
    : hedgeLine - projectedFinal;
  
  // Show "middle opportunity" when line moved significantly
  if (Math.abs(lineMovement) >= 2) {
    // Potential profit lock / middle bet opportunity
    status = 'profit_lock';
    headline = '💰 MIDDLE OPPORTUNITY';
    message = `Line moved ${lineMovement.toFixed(1)} pts. Hedge at ${hedgeLine} creates profit window.`;
  }
}
```

### 4. Add Line Movement Indicators

Visual indicators for line movement in the hedge card:

| Movement | Display | Meaning |
|----------|---------|---------|
| 3.0 | `↓3.0 📉` (green for OVER) | Line dropped, OVER more likely |
| -2.0 | `↑2.0 📈` (green for UNDER) | Line rose, UNDER more likely |
| 0.0 | `—` (neutral) | No movement |

Color coding:
- **Green**: Movement favors your bet
- **Red**: Movement against your bet
- **Yellow**: Neutral movement

### 5. Add Line Freshness Indicator

Show when line was last checked:

```text
Book Line: 25.5 (FanDuel) • Updated 15s ago
```

With staleness warnings:
- Under 1 min: Green dot
- 1-2 min: Yellow dot
- Over 2 min: "Refresh" button

---

## Technical Implementation

### Files to Create
1. `src/hooks/useLiveSweetSpotLines.ts` - Fetches live lines for sweet spots

### Files to Modify
1. `src/types/sweetSpot.ts` - Add `liveBookLine`, `lineMovement`, `bookmaker` to `LivePropData`
2. `src/components/sweetspots/HedgeRecommendation.tsx` - Use live line for calculations, show movement
3. `src/hooks/useSweetSpotLiveData.ts` - Integrate live line fetching

### API Usage
- Reuses existing `fetch-current-odds` edge function
- Batches requests to minimize API calls
- Caches results for 30s (matches Lock Mode scanner)

---

## Hedge Calculation Logic Update

```text
BEFORE (using original line):
┌───────────────────────────────────────────────┐
│ Player: Anthony Edwards                       │
│ Your Bet: OVER 28.5                           │
│ Current: 12 pts | Projected: 24.2             │
│ Gap to 28.5: -4.3 (URGENT)                    │
│ Action: "Hedge UNDER 28.5"                    │
│                                               │
│ ❌ Problem: Book now shows UNDER 25.5         │
│    The 28.5 line doesn't exist anymore!       │
└───────────────────────────────────────────────┘

AFTER (using live line):
┌───────────────────────────────────────────────┐
│ Player: Anthony Edwards                       │
│ Your Bet: OVER 28.5 (original)                │
│ Live Book: 25.5 ↓3.0                          │
│ Current: 12 pts | Projected: 24.2             │
│ Gap to 25.5: -1.3 (ALERT)                     │
│                                               │
│ 💰 MIDDLE OPPORTUNITY                         │
│ Original bet: OVER 28.5                       │
│ Hedge available: UNDER 25.5                   │
│ If player scores 26-28: BOTH BETS WIN         │
│                                               │
│ Action: "BET UNDER 25.5 NOW"                  │
└───────────────────────────────────────────────┘
```

---

## Middle Bet Detection

When line moves significantly, detect "middle" opportunities:

```typescript
function detectMiddleOpportunity(
  originalLine: number,
  liveBookLine: number,
  side: 'over' | 'under'
): MiddleOpportunity | null {
  const gap = Math.abs(originalLine - liveBookLine);
  
  if (gap < 2) return null; // Not enough gap
  
  if (side === 'over' && liveBookLine < originalLine) {
    // You bet OVER 28.5, now UNDER 25.5 is available
    // If player scores 26-28, both win!
    return {
      type: 'middle',
      lowerBound: liveBookLine,
      upperBound: originalLine,
      profitWindow: `${liveBookLine + 0.5} to ${originalLine - 0.5}`,
      recommendation: `Hedge UNDER ${liveBookLine} for guaranteed profit if player scores ${Math.floor(liveBookLine + 1)}-${Math.floor(originalLine)}`
    };
  }
  
  return null;
}
```

---

## Expected Outcomes

1. Hedge recommendations use **actual available lines** from books
2. Users see when lines have moved in their favor (or against)
3. "Middle bet" opportunities are automatically detected
4. Stale line warnings prevent acting on outdated information
5. Matches the live line tracking already used in Lock Mode

