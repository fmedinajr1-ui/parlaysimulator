

## Fix Heat Engine CORE/UPSIDE Parlay Building

### Problem Summary

The Heat Prop Engine is failing to build CORE and UPSIDE 2-man parlays because:

1. **Primary data source is empty** - `nba_risk_engine_picks` table has 0 rows for today
2. **`scan` action fails** - Returns "NO_RISK_ENGINE_DATA" and processes 0 props
3. **`heat_prop_tracker` never populated** - Since scan found nothing, build action finds "0 eligible props"
4. **Alternative data exists but unused** - `category_sweet_spots` has 107+ picks with 70-86% confidence scores

---

### Root Cause

The Heat Engine currently has a hard dependency on `nba_risk_engine_picks`:

| Step | Current Behavior | Problem |
|------|-----------------|---------|
| scan | Query `nba_risk_engine_picks` WHERE mode='full_slate' | Table is empty |
| scan | Return error if 0 picks found | Blocks entire pipeline |
| build | Query `heat_prop_tracker` for eligible props | Table is empty (never populated) |
| build | Return "INSUFFICIENT_PROPS" error | No parlays built |

---

### Solution: Use `category_sweet_spots` as Fallback Source

Modify the `scan` action to fall back to `category_sweet_spots` when `nba_risk_engine_picks` is empty:

**Step 1: After Risk Engine query returns 0 picks, query category_sweet_spots**
```typescript
// If no Risk Engine picks, use category_sweet_spots as fallback
if (!picks || picks.length === 0) {
  console.log('[Heat Engine] No Risk Engine picks, using category_sweet_spots as fallback');
  
  const { data: sweetSpotPicks } = await supabase
    .from('category_sweet_spots')
    .select('*')
    .eq('analysis_date', today)
    .gte('confidence_score', 0.70)  // 70%+ confidence
    .not('actual_line', 'is', null);  // Must have line data
  
  // Convert to tracker-compatible format
  picks = (sweetSpotPicks || []).map(p => ({
    player_name: p.player_name,
    prop_type: p.prop_type,
    line: p.actual_line,
    current_line: p.actual_line,
    side: p.recommended_side,
    confidence_score: p.confidence_score * 10,  // Scale 0.8 -> 8.0
    game_date: today,
    // Derive other fields from category data
    player_role: inferRoleFromCategory(p.category),
    projected_minutes: null,
  }));
}
```

**Step 2: Add role inference from category**
```typescript
function inferRoleFromCategory(category: string): string {
  const cat = category?.toUpperCase() || '';
  if (cat.includes('STAR')) return 'STAR';
  if (cat.includes('ELITE')) return 'ELITE_REBOUNDER';
  if (cat.includes('ROLE_PLAYER')) return 'ROLE_PLAYER';
  if (cat.includes('HIGH_ASSIST')) return 'PLAYMAKER';
  return 'SECONDARY_GUARD';
}
```

**Step 3: Update eligibility scoring for category-sourced picks**
- CORE eligibility: confidence_score >= 0.75 AND L10 hit rate >= 70%
- UPSIDE eligibility: confidence_score >= 0.65 AND category match

---

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/heat-prop-engine/index.ts` | Add category_sweet_spots fallback in scan action, add role inference function |

---

### Expected Outcome

After this fix:
- Heat Engine will find 107+ picks from `category_sweet_spots` when Risk Engine is empty
- `heat_prop_tracker` will be populated with scored props
- CORE 2-man parlay: Top 2 non-overlapping high-confidence legs
- UPSIDE 2-man parlay: Different players from CORE with upside potential

---

### Data Flow After Fix

```text
Heat Engine SCAN
       │
       ▼
┌─────────────────────────────────────┐
│  1. Query nba_risk_engine_picks     │
│     → 0 picks found                 │
│                                     │
│  2. FALLBACK: Query category_sweet_spots│
│     → 107 picks with lines          │
│     → Filter: confidence >= 70%     │
│     → Filter: has actual_line       │
│                                     │
│  3. Score & populate heat_prop_tracker │
│     → 40+ eligible CORE props       │
│     → 60+ eligible UPSIDE props     │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  Heat Engine BUILD                  │
│                                     │
│  1. Query heat_prop_tracker         │
│     → Find eligible props           │
│                                     │
│  2. Build CORE 2-man parlay         │
│     → Leg 1: Highest score          │
│     → Leg 2: Different team/prop    │
│                                     │
│  3. Build UPSIDE 2-man parlay       │
│     → Exclude CORE players          │
│     → Different category mix        │
└─────────────────────────────────────┘
```

---

### Benefits

1. **No dependency on Risk Engine** - Heat Engine works independently
2. **Uses existing high-quality data** - category_sweet_spots already has projections
3. **Maintains quality thresholds** - 70%+ confidence, must have line data
4. **Team diversity enforced** - Existing logic prevents same-team parlays

