
# Fix Player Props Not Displaying in Halftime Betting Console

## Problem Analysis

After investigating the code and logs, I found that **data IS being generated** - the scout-agent-loop returns 44 prop edges. However, users see no props because the default filter settings are too restrictive.

### Root Cause

In `HalftimeBettingPanel.tsx`, the `rankedEdges` computation (lines 123-140) applies multiple filters:

```typescript
return [...(edges || [])]
  .filter(e => propFilter === 'ALL' || e.prop === propFilter)
  .filter(e => getConfidence(e) >= minConfidence)  // Default 65%
  .filter(e => !hideVolatile || !e.rotationVolatilityFlag)  // Default true
  .filter(e => { /* startersOnly check */ })
  .filter(e => { /* fatigueUndersOnly check */ })
  .sort((a, b) => rankEdge(b) - rankEdge(a))
  .slice(0, 8);
```

With these defaults:
- `minConfidence = 65` - Filters out edges with 50-64% confidence
- `hideVolatile = true` - Filters out bench/fringe players

Combined, this can filter ALL 44 edges, leaving nothing to display.

---

## Solution

### 1. Lower Default Confidence Threshold

Change the default `minConfidence` from 65 to 50:

**File:** `src/components/scout/HalftimeBettingPanel.tsx`
```diff
- const [minConfidence, setMinConfidence] = useState(65);
+ const [minConfidence, setMinConfidence] = useState(50);
```

### 2. Add Visibility Into Filtering

Show users how many edges exist vs how many match their filters:

**File:** `src/components/scout/HalftimeBettingPanel.tsx`

Add a small info badge showing `{rankedEdges.length}/{edges.length}` near the filters section so users understand their filters are affecting visibility.

### 3. Improve Empty State Messaging

When edges exist but are all filtered out, show a more helpful message that tells users specifically what filters are hiding their data:

```text
"44 edges available, but none match your current filters.
Try lowering Min Conf to 50% or turning off Hide Volatile."
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/scout/HalftimeBettingPanel.tsx` | Lower default `minConfidence` from 65 to 50, add edge count badge, improve empty state messaging |

---

## Expected Result

After this fix:
1. Users will see player prop edges immediately (with 50%+ confidence)
2. A visible count shows total vs filtered edges
3. Empty state clearly explains why no edges are visible and how to fix it

---

## Technical Details

The edge confidence scores from `scout-data-projection` start at 50 (base) and add bonuses for:
- Edge margin (+6 to +25 points)
- Minutes played (+4 to +10 points)

A freshly started game (Q1) may have many edges in the 55-65% range because players haven't accumulated enough minutes for confidence bonuses. By lowering the default to 50%, these early-game edges become visible.
