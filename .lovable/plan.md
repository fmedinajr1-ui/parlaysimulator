

# Integrate Shot Chart with Live Hedge Recommendations + Fix Opponent Name Bug

## Root Cause Identified

The console logs reveal why shot chart matchups aren't working for most players:

```
[SweetSpotLiveData] Matchup lookup: {
  "player": "Jonas Valanciunas",
  "opponent": "er Nugget",        ← Should be "Denver Nuggets"
  "hasMatchup": false
}
```

**The bug**: The regex `/[@vs]+/i` treats 'v' and 's' as individual delimiters, not as part of "vs":
- "Denver Nuggets @ Lakers" → "Den", "er Nugget", "@ Laker" (broken!)
- Should be: "Denver Nuggets", "Lakers"

---

## Phase 1: Fix Opponent Name Parsing (Critical)

**File: `src/hooks/useDeepSweetSpots.ts`**

Change regex from `/[@vs]+/i` to `/\s+(?:@|vs)\s+/i`:

| Location | Current | Fixed |
|----------|---------|-------|
| Line 66 | `gameDescription.split(/[@vs]+/i)` | `gameDescription.split(/\s+(?:@\|vs)\s+/i)` |
| Line 77 | `gameDescription.split(/[@vs]+/i)` | `gameDescription.split(/\s+(?:@\|vs)\s+/i)` |

This regex specifically targets " @ " or " vs " as whole words with whitespace.

---

## Phase 2: Enhanced Shot Chart + Hedge Integration

### Current State
- `ShotChartPreview` shows pre-game ONLY (line 20 returns null if `isLive`)
- `HedgeRecommendation` shows shot chart at BOTTOM of the component (lines 379-406)
- Shot chart score affects urgency calculation (line 164-165)

### Enhancement: Deeper Integration

**Modify `HedgeRecommendation.tsx` to weight shot chart more heavily:**

1. **Add shot chart impact to hit probability calculation**
   - If matchup score > +3: boost probability by 10%
   - If matchup score < -3: reduce probability by 15%
   - This affects status (on_track → monitor → alert)

2. **Enhance messaging to reference zone matchups**
   - Current: "Trailing by 2.1 with 8:32 left"
   - Enhanced: "Trailing by 2.1 but has +4.2 advantage in Restricted Area (72% of shots). Defense ranks #26 in paint protection."

3. **Add shot chart insight to action recommendation**
   - Current: "BET UNDER 18.5 NOW"
   - Enhanced: "BET UNDER 18.5 NOW - Zone disadvantage in primary shooting area amplifies risk"

---

## Phase 3: Unified Matchup Display

### Move Shot Chart Higher in Component

Currently shot chart is at the very bottom of `HedgeRecommendation`. Move it to be part of the core analysis section (after progress, before detailed message):

```text
┌─────────────────────────────────────────────────────────────┐
│ [🟡 MONITOR] Watching Closely                               │
├─────────────────────────────────────────────────────────────┤
│ Current: 14 [↑] → Projected: 18.2                           │
│ Line: 22.5 | Gap: -4.3 | Confidence: 45%                    │
├─────────────────────────────────────────────────────────────┤
│ 🎯 SHOT CHART FACTOR: +3.8 (Advantage)                      │  ← NEW POSITION
│    Primary: Restricted Area (68%) vs #24 ranked defense     │
│    "Paint-heavy scorer vs weak interior = production boost" │
├─────────────────────────────────────────────────────────────┤
│ ⏱ 11:24 remaining | Pace: NORMAL (101)                      │
│ Rate: 0.42/min | Need: 0.56/min                             │
├─────────────────────────────────────────────────────────────┤
│ ⚡ Watch for next 3 minutes. Consider UNDER hedge if...     │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 4: Shot Chart Affects Hedge Urgency

**Update `calculateEnhancedHedgeAction` function:**

Add zone-based modifiers:

```typescript
// Existing line 164-165
const hasZoneDisadvantage = shotChartMatchup && shotChartMatchup.overallMatchupScore < -3;

// ADD: Zone advantage modifier
const hasZoneAdvantage = shotChartMatchup && shotChartMatchup.overallMatchupScore > 3;

// In status calculation, factor advantage/disadvantage:
// - Zone advantage for OVER bet: reduce urgency level
// - Zone disadvantage for OVER bet: increase urgency level  
// - Zone advantage for UNDER bet: INCREASE urgency (player likely to produce)
// - Zone disadvantage for UNDER bet: REDUCE urgency (player suppressed)
```

**Adjusted hit probability with zone factor:**

```typescript
function calculateHitProbability(current, line, ratePerMin, gameProgress, side, zoneScore) {
  let baseProbability = /* existing calculation */;
  
  // Zone modifier (max ±15%)
  const zoneModifier = Math.max(-15, Math.min(15, zoneScore * 3));
  
  // For OVER: positive zone = higher probability
  // For UNDER: positive zone = LOWER probability (bad for under)
  if (side === 'over') {
    baseProbability += zoneModifier;
  } else {
    baseProbability -= zoneModifier;
  }
  
  return Math.max(5, Math.min(95, baseProbability));
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useDeepSweetSpots.ts` | Fix regex `/[@vs]+/i` → `/\s+(?:@\|vs)\s+/i` on lines 66 and 77 |
| `src/components/sweetspots/HedgeRecommendation.tsx` | 1. Add zone-aware probability modifier<br>2. Move shot chart section higher in layout<br>3. Include zone insights in messages<br>4. Factor zone advantage/disadvantage into urgency |

---

## Expected Results After Fix

1. **Opponent names resolved correctly:**
   - "Denver Nuggets" not "er Nugget"
   - "Boston Celtics" not "ton Celtic"

2. **Shot chart matchups found for all players:**
   - Summary will show `spotsWithMatchups` matching `pointsSpots + threesSpots`

3. **Integrated hedge recommendations:**
   - Hit probability adjusted by zone matchup
   - Messages reference specific zone advantages/disadvantages
   - Shot chart visible as core part of live analysis, not afterthought

4. **Smarter hedge urgency:**
   - OVER bet with zone advantage = lower urgency (player likely to produce despite low rate)
   - UNDER bet with zone advantage = higher urgency (player likely to exceed line)

