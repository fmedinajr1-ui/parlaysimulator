

## Category Concentration Cap and Projection Buffer Fix

### Problem
On Feb 19, 8 out of 12 missed legs were all 3PT overs. The system tracks "category" (e.g., THREE_POINT_SHOOTER, BIG_REBOUNDER) for diversity, but multiple categories can map to the same underlying prop type ("threes"). There is also no minimum projection buffer gate -- picks where the projected value barely exceeds the line slip through.

### Solution

Add two new safety gates across all three parlay builders:

**1. Prop Type Concentration Cap (40% max per parlay)**

Track `prop_type` (not just `category`) within each parlay. No single prop type (threes, rebounds, points, assists) can exceed 40% of the total legs. For a 3-leg parlay, max 1 of same prop type. For a 5-leg parlay, max 2. For a 6-leg parlay, max 2.

**2. Minimum Projection Buffer Gate (0.3 floor)**

Block any pick where `projected_value - line < 0.3` for OVER picks (or `line - projected_value < 0.3` for UNDER picks). This prevents razor-thin edges from entering the pool.

### Files to Change

| File | Change |
|------|--------|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Add `propTypeCount` tracking in leg selection loop, enforce 40% cap in `canUsePickInParlay`. Add 0.3 minimum buffer gate before leg inclusion. |
| `supabase/functions/sharp-parlay-builder/index.ts` | Add `propTypeCount` map in `buildParlay`, enforce 40% cap during both first and second pass. Add buffer gate. |
| `supabase/functions/heat-prop-engine/index.ts` | Add prop type diversity check in `buildParlays` (only 2 legs, so effectively blocks same prop type for both legs). Add buffer gate. |

### Technical Details

**bot-generate-daily-parlays (main generator)**

In `canUsePickInParlay` (line ~1787), add a new parameter `parlayPropTypeCount: Map<string, number>` and enforce:
```
const propType = normalizePropType(pick.prop_type);
const propTypeCount = parlayPropTypeCount.get(propType) || 0;
const maxPropTypeLegs = Math.max(1, Math.floor(totalLegs * 0.4));
if (propTypeCount >= maxPropTypeLegs) return false;
```

In the leg selection loop (line ~4118), after pushing a leg, increment the prop type counter alongside the existing category counter.

Add a buffer gate before leg creation (line ~4047):
```
const projBuffer = Math.abs((pick.projected_value || 0) - pick.line);
if (projBuffer < 0.3) continue; // Too thin
```

**sharp-parlay-builder**

In `buildParlay` (line ~1068), add a `propTypeCount` map. During both first pass and second pass, check that no prop type exceeds 40% of `config.maxLegs`. Add buffer gate filtering in the Dream Team candidate filter.

**heat-prop-engine**

In `buildParlays` (line ~529), since it only builds 2-leg parlays, enforce that leg1 and leg2 must have different prop types (already partially done via `getPropCategory`, but tighten to block same underlying stat). Add buffer gate to `eligibleProps` filter.

**Monster parlay selectLegs**

In `selectLegs` (line ~4680), add a `propTypeCount` map with the same 40% cap logic, plus the 0.3 buffer gate.

### What This Prevents
- A slate where 8/12 legs are all 3PT overs (would be capped to max 2-3 threes per parlay)
- Razor-thin edges like "projected 3.6 vs line 3.5" sneaking in (must have at least 0.3 buffer)
- Correlated failures where one bad stat category wipes the entire bankroll
