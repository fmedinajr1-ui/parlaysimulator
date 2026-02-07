
# Add "On Track" Live Status Filter

## Overview

Add a new filter option to the Quality filter bar that shows only live bets with "On Track" status. This helps users quickly find bets that are progressing well during live games.

## Current Architecture

The hedge status (`on_track`, `monitor`, `alert`, `urgent`, `profit_lock`) is calculated dynamically in `HedgeRecommendation.tsx` via `calculateEnhancedHedgeAction()`. However, this calculation is:
1. Not exported for reuse
2. Not stored on the `DeepSweetSpot` type
3. Only computed during render of the HedgeRecommendation component

## Solution

### Step 1: Create a Utility Function for Hedge Status Calculation

Extract the core hedge status logic into a reusable utility that can be called during data enrichment.

**New file:** `src/lib/hedgeStatusUtils.ts`

```text
This utility will contain:
- calculateHedgeStatus(spot: DeepSweetSpot): HedgeStatus
- A simplified version of the logic from HedgeRecommendation.tsx
- Focus on returning just the status, not the full action details
```

### Step 2: Extend the LivePropData Type

Add a `hedgeStatus` field to store the calculated status.

**File:** `src/types/sweetSpot.ts`

| Line | Change |
|------|--------|
| ~95 | Add `hedgeStatus?: HedgeStatus;` to LivePropData interface |

### Step 3: Compute Hedge Status During Live Data Enrichment

**File:** `src/hooks/useSweetSpotLiveData.ts`

| Line | Change |
|------|--------|
| Import | Add import for the new utility |
| ~137-160 | After creating liveData, call `calculateHedgeStatus(spot)` and add to result |

### Step 4: Add Filter Option to UI

**File:** `src/pages/SweetSpots.tsx`

| Line | Change |
|------|--------|
| 25 | Extend QualityFilter type: `'all' | 'ELITE' | 'PREMIUM+' | 'STRONG+' | 'MIDDLE' | 'ON_TRACK'` |
| 71-85 | Add new filter case for 'ON_TRACK' that filters to spots where `liveData?.hedgeStatus === 'on_track'` |
| 339-365 | Add "ON TRACK" button to the filter row (only visible when live games exist) |

## UI Changes

The Quality filter bar will display:

```text
All | ELITE | PREMIUM+ | STRONG+ | [MIDDLE (2)] | [✓ ON TRACK (5)]
```

The "ON TRACK" button:
- Only appears when there are live games
- Shows count of spots with on_track status
- Uses a green color scheme to match the on_track badge styling

## Technical Details

### Hedge Status Calculation (Simplified)

The utility will use a streamlined version of the calculation:

```text
1. If no live data → null (not applicable)
2. If game not in progress → null
3. For OVER bets:
   - currentValue >= line → 'on_track' (already hit)
   - projectedFinal >= line + 2 → 'on_track'
   - projectedFinal >= line → 'monitor'
   - projectedFinal < line but recoverable → 'alert'
   - projectedFinal significantly below → 'urgent'
4. For UNDER bets:
   - currentValue >= line → 'urgent' (already lost)
   - projectedFinal < line - 2 → 'on_track'
   - projectedFinal <= line → 'monitor'
   - projectedFinal > line → 'alert' or 'urgent'
5. Middle opportunity detected → 'profit_lock'
```

### Files Changed Summary

| File | Change Type |
|------|-------------|
| `src/lib/hedgeStatusUtils.ts` | New file - hedge status calculation utility |
| `src/types/sweetSpot.ts` | Add `hedgeStatus` to LivePropData interface |
| `src/hooks/useSweetSpotLiveData.ts` | Compute and store hedge status during enrichment |
| `src/pages/SweetSpots.tsx` | Add "ON TRACK" filter button and filtering logic |

## Expected Outcome

When live games are active:
- Users see a new "ON TRACK" filter button in the Quality row
- Clicking it filters to show only bets with `on_track` status
- Count badge shows how many bets are currently on track
- This makes it easy to find bets that are progressing well without needing to read each card individually
