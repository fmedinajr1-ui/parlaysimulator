

# Smart Alt Line: Closest Match with Continuous Polling

## Problem
The current Alt Line column shows whichever line the preferred bookmaker returns — which might be far from the original. The user wants it to find the **closest available line to their original bet line** across all books, and keep polling every few seconds until it locks onto the best match.

## Changes

### 1. `HedgeModeTable.tsx` — Pick Closest Line from `allBookLines`
Instead of showing `p.liveBookLine` (the priority-bookmaker line), scan `p.allBookLines` to find the line **closest to `p.line`** (the original). Display that line with its bookmaker tag. Add a pulsing dot indicator when data is still being refined (no perfect match yet).

**Logic:**
```
closestLine = allBookLines
  .sort((a, b) => Math.abs(a.line - originalLine) - Math.abs(b.line - originalLine))
  [0]
```

Show the closest line value, delta arrow, bookmaker short name, and a "scanning" pulse animation if `|closestLine - originalLine| > 1.5`.

### 2. `useLiveSweetSpotLines.ts` — Faster Polling Until Match Found
- Add a `bestMatchFound` state that tracks whether all spots have found a line within ±0.5 of original.
- When not all matched: poll at 6s (turbo). When all matched: slow down to 15s.
- Add a `closestLine` field to `LiveLineData` that pre-computes the closest line from `allBookLines`.

### 3. `WarRoomLayout.tsx` — Pass `closestBookLine` to props
Add a `closestBookLine` and `closestBookmaker` field derived from `allBookLines` so the table can display it directly.

### 4. `LiveLineData` Interface Update
Add:
```ts
closestLine?: number;
closestBookmaker?: string;
closestDelta?: number;
isScanning?: boolean; // true while still searching for closer match
```

## Result
The Alt Line column will show the nearest available market line to the user's original, with the bookmaker name. A pulsing indicator shows it's still scanning. Once a tight match is found (within ±0.5), it locks and the indicator stops.

