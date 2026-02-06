
# Track UNDER Pick Performance Over Time

## Overview
Create a dedicated "Over vs Under Performance" tracking section in the Accuracy Dashboard to monitor the new filtering logic's impact. This will compare historical UNDER hit rates (pre-fix baseline ~60%) against new picks generated with the 70% ceiling protection threshold.

## Current State Analysis

### Historical Performance (All-Time)
| Side | Hits | Misses | Hit Rate |
|------|------|--------|----------|
| OVER | 307 | 286 | 51.8% |
| UNDER | 64 | 42 | **60.4%** |

### Weekly Trend (Recent)
| Week | OVER Hit Rate | UNDER Hit Rate |
|------|--------------|----------------|
| Feb 2-8 | 48.3% | **80.0%** (4-1) |
| Jan 26-Feb 1 | 49.2% | 52.2% |
| Jan 19-25 | 56.6% | 61.5% |

The Feb 2-8 week shows early improvement after the fix was deployed!

---

## Implementation Plan

### 1. Create New RPC Function: `get_side_performance_tracking`

**Purpose**: Return OVER vs UNDER performance broken down by week with trend analysis.

```sql
CREATE OR REPLACE FUNCTION get_side_performance_tracking(
  days_back INTEGER DEFAULT 30
)
RETURNS TABLE(
  week_start DATE,
  side TEXT,
  hits INTEGER,
  misses INTEGER,
  total_picks INTEGER,
  hit_rate NUMERIC,
  avg_ceiling_protection NUMERIC,
  avg_l10_hit_rate NUMERIC
)
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    DATE_TRUNC('week', css.analysis_date::timestamp)::date as week_start,
    css.recommended_side as side,
    COUNT(*) FILTER (WHERE css.outcome = 'hit')::integer as hits,
    COUNT(*) FILTER (WHERE css.outcome = 'miss')::integer as misses,
    COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss'))::integer as total_picks,
    ROUND(
      COUNT(*) FILTER (WHERE css.outcome = 'hit')::numeric / 
      NULLIF(COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')), 0) * 100, 
      1
    ) as hit_rate,
    ROUND(AVG(
      CASE WHEN css.recommended_side = 'under' 
           THEN css.recommended_line / NULLIF(css.l10_max, 0)
           ELSE NULL 
      END
    )::numeric * 100, 1) as avg_ceiling_protection,
    ROUND(AVG(css.l10_hit_rate)::numeric * 100, 1) as avg_l10_hit_rate
  FROM category_sweet_spots css
  WHERE css.outcome IN ('hit', 'miss')
    AND css.recommended_side IS NOT NULL
    AND css.analysis_date >= CURRENT_DATE - (days_back || ' days')::interval
  GROUP BY week_start, side
  ORDER BY week_start DESC, side;
END;
$$ LANGUAGE plpgsql;
```

### 2. Create React Hook: `useSidePerformanceTracking`

**File**: `src/hooks/useSidePerformanceTracking.ts`

```typescript
interface SidePerformance {
  weekStart: string;
  side: 'over' | 'under';
  hits: number;
  misses: number;
  totalPicks: number;
  hitRate: number;
  avgCeilingProtection: number | null;
  avgL10HitRate: number;
}

interface SideSummary {
  side: 'over' | 'under';
  totalHits: number;
  totalMisses: number;
  overallHitRate: number;
  weeklyTrend: 'improving' | 'stable' | 'declining';
  recentWeekRate: number;
}
```

### 3. Create Component: `SidePerformanceCard`

**File**: `src/components/accuracy/SidePerformanceCard.tsx`

**Design**:
```text
┌─────────────────────────────────────────────────┐
│ 📊 Over vs Under Performance                    │
├───────────────────────┬─────────────────────────┤
│ ⬆️ OVER               │ ⬇️ UNDER               │
│ 51.8%                 │ 60.4%                  │
│ 307W - 286L           │ 64W - 42L              │
│ Trend: Stable ➡️       │ Trend: Improving 📈    │
├───────────────────────┴─────────────────────────┤
│ Weekly Breakdown                                │
│ ┌─────────┬─────────┬─────────┬──────────────┐ │
│ │ Week    │ OVER    │ UNDER   │ Ceiling Prot │ │
│ ├─────────┼─────────┼─────────┼──────────────┤ │
│ │ Feb 2-8 │ 48.3%   │ 80.0%🔥 │ 92%          │ │
│ │ Jan 26  │ 49.2%   │ 52.2%   │ 68%          │ │
│ │ Jan 19  │ 56.6%   │ 61.5%   │ 71%          │ │
│ └─────────┴─────────┴─────────┴──────────────┘ │
│                                                 │
│ 🎯 New Filter Active: 70% Ceiling Protection   │
│ Expected improvement: 60% → 70%+ on UNDERs     │
└─────────────────────────────────────────────────┘
```

**Key Features**:
- Side-by-side comparison cards (OVER vs UNDER)
- Weekly breakdown table with ceiling protection tracking
- Visual trend indicators (📈 improving, ➡️ stable, 📉 declining)
- Highlight weeks after fix deployment (Feb 5+)
- Color-coded hit rates (green ≥55%, yellow 50-55%, red <50%)

### 4. Integrate into UnifiedAccuracyView

**File**: `src/components/accuracy/UnifiedAccuracyView.tsx`

Add new collapsible section after Category Breakdown:

```tsx
{/* Side Performance Tracking */}
<Card className="p-4 bg-card/50 border-border/50">
  <Collapsible open={sideOpen} onOpenChange={setSideOpen}>
    <CollapsibleTrigger className="flex items-center justify-between w-full">
      <h3 className="font-semibold flex items-center gap-2">
        <span>⬆️⬇️</span>
        Over vs Under Performance
      </h3>
      <ChevronDown className={cn(
        "w-4 h-4 transition-transform",
        sideOpen && "rotate-180"
      )} />
    </CollapsibleTrigger>
    <CollapsibleContent>
      <SidePerformanceCard />
    </CollapsibleContent>
  </Collapsible>
</Card>
```

---

## Technical Details

### Files to Create
1. `src/hooks/useSidePerformanceTracking.ts` - Data fetching hook
2. `src/components/accuracy/SidePerformanceCard.tsx` - UI component

### Files to Modify
1. `src/components/accuracy/UnifiedAccuracyView.tsx` - Add new section
2. Database migration - Create `get_side_performance_tracking` function

### Database Column Usage
- `recommended_side` - Filter OVER vs UNDER
- `l10_max` - Calculate ceiling protection for UNDERs
- `recommended_line` - Calculate ceiling protection ratio
- `outcome` - Track hit/miss/push
- `analysis_date` - Group by week
- `l10_hit_rate` - Track correlation with outcomes

### Validation Metrics
Track these to validate the fix is working:
1. **UNDER Hit Rate Trend**: Target 70%+ post-fix (vs 60% baseline)
2. **Ceiling Protection Average**: Should be ≥70% for all new UNDERs
3. **Bad Pick Reduction**: Fewer missed UNDERs per week

---

## Expected Outcome

After 7 days of data:
- Clear visualization showing UNDER hit rate improvement
- Weekly trend comparison pre-fix vs post-fix
- Ceiling protection correlation with outcomes
- Automated tracking without manual intervention
