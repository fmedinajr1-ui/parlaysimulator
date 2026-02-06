
# Fix MID_SCORER_UNDER Visibility in Fades Tab

## Current Situation

The MID_SCORER_UNDER picks exist in the database (15 total), but:
- Only **2 players have games today**: Andrew Wiggins and John Collins
- Both have **negative fade edges** when betting OVER:
  - Andrew Wiggins: L10 avg 13.2 vs line 14.5 = -1.3 edge
  - John Collins: L10 avg 15.2 vs line 16.5 = -1.3 edge
- They're classified as "Risky Fades" (no positive edge) and hidden after the first 4 cards

The badge shows "0/1 smart fades" because there's 1 pick total (probably just one got matched) but 0 qualify as smart.

## The Core Issue

The MID_SCORER_UNDER category was designed to find players whose L10 average is **below** the line (good for UNDER bets). When you flip to OVER, these players have negative edge by design.

## Solution Options

### Option A: Show All Risky Fades (Quick Fix)
Remove the limit of 4 risky fades so MID_SCORER_UNDER picks are visible.

| File | Change |
|------|--------|
| `ContrarianFadeCard.tsx` | Remove `.slice(0, 4)` limit or increase to 10 |

### Option B: Change Category Logic (Recommended)
For MID_SCORER to work as a fade, we need players whose L10 is **above** the line. This means creating a new `MID_SCORER_OVER` category that the analyzer flags when players are trending up, then we fade to UNDER.

| File | Change |
|------|--------|
| `category-props-analyzer/index.ts` | Add MID_SCORER_OVER category with `fadeOnly: true` |
| `useContrarianParlayBuilder.ts` | Add MID_SCORER_OVER to FADE_CATEGORIES, fading to UNDER |

### Option C: Reverse the Edge Logic for This Category
Treat MID_SCORER_UNDER differently - consider negative edge as "expected" and still show them.

| File | Change |
|------|--------|
| `useContrarianParlayBuilder.ts` | Add special handling for categories where negative edge is acceptable |

## Recommended Approach: Option A + Display Fix

1. **Show more risky fades** - Increase the limit so MID_SCORER picks are visible
2. **Group by category** - Display risky fades organized by category for better visibility
3. **Add "View All" toggle** - Let users expand to see all fades

## Technical Changes

### 1. Update ContrarianFadeCard.tsx

```typescript
// Change line 289 to show more risky fades
{riskyPicks.slice(0, 8).map(pick => (
  <ContrarianFadeCard key={pick.id} pick={pick} />
))}

// Update the "+N more hidden" text accordingly
{riskyPicks.length > 8 && (
  <p className="text-xs text-muted-foreground text-center">
    +{riskyPicks.length - 8} more risky fades hidden
  </p>
)}
```

### 2. Optional: Add Category Grouping

Group risky fades by category to ensure MID_SCORER_UNDER picks are visible even when mixed with other categories.

## Expected Outcome

After implementation:
- MID_SCORER_UNDER picks (Andrew Wiggins, John Collins) will appear in the "Risky Fades" section
- Users can see all contrarian opportunities, not just the first 4
- The category breakdown badge will still show "0/1 smart fades" (accurate since they have negative edge)
