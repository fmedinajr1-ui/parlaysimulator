

# Fix Live Hedge Recommendations - Data Display & Halftime Persistence

## Issues Identified

### Issue 1: Floating Point Precision Bug
**Screenshot shows**: `10.600000000000001% hit probability`

**Root cause**: Line 369 in `HedgeRecommendation.tsx`:
```typescript
{hedgeAction.hitProbability}% hit probability
```
The `hitProbability` value is displayed without rounding, causing JavaScript floating-point artifacts to appear.

**Fix**: Format the number to remove decimal artifacts:
```typescript
{Math.round(hedgeAction.hitProbability)}% hit probability
```

---

### Issue 2: Hedge Recommendations Disappear at Halftime

**Root cause**: Two locations work together to cause this:

1. **useSweetSpotLiveData.ts** (Lines 75-98): When `game.status !== 'in_progress'` (including `'halftime'`), it sets `isLive: false`
2. **HedgeRecommendation.tsx** (Line 355): Component returns `null` when `!spot.liveData?.isLive`

The game status `'halftime'` is correctly detected by the feed, but the component treats it as "not live" and hides itself.

**Fix Strategy**: 
- Keep live data during halftime and other intermission statuses
- Add a `gameStatus` field to track the actual state
- Component should stay visible during halftime, showing the last known data with a "Halftime" indicator

---

## Technical Implementation

### File 1: `src/hooks/useSweetSpotLiveData.ts`

**Change**: Treat `halftime` as a "live" state (game is still in progress, just paused)

| Line | Current | New |
|------|---------|-----|
| 75-76 | `if (game.status !== 'in_progress')` | `if (game.status !== 'in_progress' && game.status !== 'halftime')` |

Also update the live data to include the actual game status:
```typescript
const liveData: LivePropData = {
  isLive: true,
  gameStatus: game.status, // NEW: 'in_progress' | 'halftime'
  // ... rest of data
};
```

### File 2: `src/types/sweetSpot.ts`

**Add `gameStatus` field to LivePropData**:
```typescript
export interface LivePropData {
  isLive: boolean;
  gameStatus?: 'in_progress' | 'halftime' | 'scheduled' | 'final'; // NEW
  currentValue: number;
  // ... rest
}
```

### File 3: `src/components/sweetspots/HedgeRecommendation.tsx`

**Multiple fixes**:

1. **Fix floating point display** (Line 369):
```typescript
// Before
{hedgeAction.hitProbability}% hit probability

// After  
{Math.round(hedgeAction.hitProbability)}% hit probability
```

2. **Keep visible during halftime** (Line 355):
```typescript
// Before
if (!spot.liveData?.isLive) return null;

// After - also show during halftime with last known data
if (!spot.liveData?.isLive && spot.liveData?.gameStatus !== 'halftime') return null;
```

3. **Add halftime indicator** (after line 365):
```typescript
{spot.liveData?.gameStatus === 'halftime' && (
  <div className="mb-2 flex items-center gap-2 text-xs text-warning">
    <Clock className="w-3 h-3" />
    <span className="font-medium">HALFTIME - Data from 1st half</span>
  </div>
)}
```

4. **Also fix other probability displays** in the component:
- Line 459: `paceRating.toFixed(0)` - already correct
- Line 426: `Math.round(shotChartMatchup.primaryZonePct * 100)` - already correct

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/types/sweetSpot.ts` | Add `gameStatus` optional field to `LivePropData` interface |
| `src/hooks/useSweetSpotLiveData.ts` | Treat `'halftime'` as live status, pass gameStatus through |
| `src/components/sweetspots/HedgeRecommendation.tsx` | 1. Round hitProbability display<br>2. Keep visible during halftime<br>3. Add halftime indicator |

---

## Expected Results

1. **Hit probability displays correctly**: `11%` instead of `10.600000000000001%`

2. **Recommendations persist during halftime**:
   - Component stays visible
   - Shows "HALFTIME - Data from 1st half" indicator
   - Retains all 1st half stats and projections
   - Users can still see hedge recommendations during the break

3. **No data loss**: All live data (current value, rate, projections) preserved during halftime

