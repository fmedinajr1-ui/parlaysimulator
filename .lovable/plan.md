
# Bug Fixes for Today's Props - Stock Market Framework Alignment

## Overview
This plan fixes two key issues in the Today's Props feature to align with the "Props as a Stock Market" analytical framework:

1. **Edge calculation bug** - Currently uses `projected_value - line` instead of `L10_avg - line` (OVER) or `line - L10_avg` (UNDER)
2. **Hit rate mismatch** - UI shows `l10_hit_rate` (calculated against a different line) while displaying `actual_line`

---

## Changes Summary

| File | Changes |
|------|---------|
| `src/hooks/useTodayProps.ts` | Fix edge calculation, add `actual_hit_rate` field, update stats to use display hit rate |
| `src/components/sweetspots/TodayPropsSection.tsx` | Sort and display using correct hit rate (actual_hit_rate when actual_line exists) |

---

## Part 1: Fix `useTodayProps.ts`

### 1.1 Update TodayPropPick Interface (lines 51-69)

Add `actual_hit_rate` field with documentation:

```typescript
export interface TodayPropPick {
  id: string;
  player_name: string;
  prop_type: string;
  category: string;
  recommended_line: number;
  actual_line: number | null;
  l10_hit_rate: number;
  l10_avg: number | null;
  l5_avg: number | null;
  confidence_score: number;
  projected_value: number | null;
  team: string;
  reliabilityTier: string | null;
  reliabilityHitRate: number | null;
  analysis_date: string;
  /** Edge per framework: L10_avg − line (OVER) or line − L10_avg (UNDER). */
  edge: number | null;
  recommended_side: 'OVER' | 'UNDER';
  /** Hit rate vs actual market line (when actual_line is set). Use for display when available. */
  actual_hit_rate: number | null;
}
```

### 1.2 Fix Edge Calculation in Step 7 (lines 213-254)

Replace the broken edge calculation with the framework-correct logic:

```typescript
// Step 7: Transform picks
const picks: TodayPropPick[] = filteredSpots.map(pick => {
  const playerKey = pick.player_name?.toLowerCase() || '';
  const reliabilityKey = `${playerKey}_${config.reliabilityKey}`;
  const reliability = reliabilityMap.get(reliabilityKey);
  const team = teamMap.get(playerKey) || 'Unknown';
  
  // Use live line from unified_props, fallback to actual_line, then recommended
  const actualLine = linesMap.get(playerKey) ?? pick.actual_line ?? pick.recommended_line;
  
  const l5Avg = l5Map.get(playerKey) ?? null;
  const l10Avg = pick.l10_avg ?? null;
  
  // Determine recommended side from category or explicit field
  const recommendedSide: 'OVER' | 'UNDER' = 
    pick.recommended_side === 'UNDER' || pick.category?.includes('UNDER') 
      ? 'UNDER' 
      : 'OVER';

  // Edge calculation per framework: L10_avg − line (OVER) or line − L10_avg (UNDER)
  let edge: number | null = null;
  if (actualLine != null) {
    if (l10Avg != null) {
      edge = recommendedSide === 'OVER' ? l10Avg - actualLine : actualLine - l10Avg;
    } else if (pick.projected_value != null) {
      // Fallback to projected_value if no L10 avg
      edge = pick.projected_value - actualLine;
    }
  }

  return {
    id: pick.id,
    player_name: pick.player_name || '',
    prop_type: pick.prop_type || config.reliabilityKey,
    category: pick.category || '',
    recommended_line: pick.recommended_line || 0.5,
    actual_line: actualLine,
    l10_hit_rate: pick.l10_hit_rate || 0,
    l10_avg: l10Avg,
    l5_avg: l5Avg,
    confidence_score: pick.confidence_score || 0,
    projected_value: pick.projected_value,
    team,
    reliabilityTier: reliability?.tier || null,
    reliabilityHitRate: reliability?.hitRate || null,
    analysis_date: pick.analysis_date || analysisDate,
    edge,
    recommended_side: recommendedSide,
    actual_hit_rate: pick.actual_hit_rate ?? null,
  };
});
```

### 1.3 Update Stats Calculation (lines 269-284)

Use display hit rate (actual_hit_rate when actual_line exists, else l10_hit_rate):

```typescript
const picks = data || [];

// Helper: get display hit rate (actual_hit_rate when we have actual_line, else l10_hit_rate)
const displayHitRate = (p: TodayPropPick) =>
  p.actual_line != null && p.actual_hit_rate != null ? p.actual_hit_rate : p.l10_hit_rate;

// Calculate summary stats using display hit rate
const stats = {
  totalPicks: picks.length,
  eliteCount: picks.filter(p => displayHitRate(p) >= 1).length,
  nearPerfectCount: picks.filter(p => displayHitRate(p) >= 0.97 && displayHitRate(p) < 1).length,
  strongCount: picks.filter(p => displayHitRate(p) >= 0.90 && displayHitRate(p) < 0.97).length,
  uniqueTeams: new Set(picks.map(p => p.team)).size,
  avgHitRate: picks.length > 0 
    ? picks.reduce((sum, p) => sum + displayHitRate(p), 0) / picks.length 
    : 0,
  avgConfidence: picks.length > 0
    ? picks.reduce((sum, p) => sum + p.confidence_score, 0) / picks.length
    : 0,
};
```

---

## Part 2: Fix `TodayPropsSection.tsx`

### 2.1 Update Sorting Logic (lines 59-63)

Sort by display hit rate (consistent with the line being shown):

```typescript
// Helper: get display hit rate (actual_hit_rate when actual_line + actual_hit_rate exist)
const displayHitRate = (p: TodayPropPick) =>
  p.actual_line != null && p.actual_hit_rate != null ? p.actual_hit_rate : p.l10_hit_rate;

// Sort by display hit rate, then confidence
const sortedPicks = [...picks].sort((a, b) => {
  const rateA = displayHitRate(a);
  const rateB = displayHitRate(b);
  if (rateB !== rateA) return rateB - rateA;
  return b.confidence_score - a.confidence_score;
});
```

### 2.2 Update PropPickCard Component (lines 141-212)

Use display hit rate for elite badge and percentage display:

```typescript
function PropPickCard({ pick, propType, onAdd }: PropPickCardProps) {
  // Display hit rate: use actual_hit_rate when we have actual_line, else l10_hit_rate
  const hitRate = (pick.actual_line != null && pick.actual_hit_rate != null) 
    ? pick.actual_hit_rate 
    : pick.l10_hit_rate;
  
  const isElite = hitRate >= 1;
  const isPremium = hitRate >= 0.9 && hitRate < 1;
  const line = pick.actual_line ?? pick.recommended_line;
  const edge = pick.edge;

  // ... rest of component uses hitRate for display ...
  
  // Badge text updates:
  // - Elite badge: "100%" (when hitRate >= 1)
  // - Percentage display: (hitRate * 100).toFixed(0)%
  // - Label: "Hit Rate" instead of "L10 Hit" (since it may be actual_hit_rate)
}
```

---

## Technical Notes

1. **Database field**: `actual_hit_rate` already exists in `category_sweet_spots` table and is populated by the `category-props-analyzer` edge function when live lines are matched.

2. **Edge formula per framework**:
   - **OVER picks**: Edge = L10_avg − line (positive = player averages above the line)
   - **UNDER picks**: Edge = line − L10_avg (positive = line is above player's average)

3. **Hit rate alignment**: When displaying `actual_line`, we show `actual_hit_rate` (calculated against that specific line). When no actual line exists, we fall back to `l10_hit_rate`.

---

## Route to Verify
`/sweet-spots` → Sweet Spots tab → Today's Props section (visible when there are 3PT or assist picks for today)
