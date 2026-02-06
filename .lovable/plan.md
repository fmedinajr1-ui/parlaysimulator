

# Pre-Game Matchup Scanner Accuracy Tracking

## Current Status

The matchup scanner accuracy infrastructure **already exists** but has limited data:

| Component | Status |
|-----------|--------|
| Pick persistence | Working (4 picks saved on 2026-02-04) |
| Categories tracked | `MATCHUP_SCANNER_PTS`, `MATCHUP_SCANNER_3PT` |
| Unified Accuracy RPC | Already includes both categories |
| Settled picks | 0 (too new - needs time to collect data) |

The system will start showing accuracy data once games complete and outcomes are verified.

---

## Proposed Enhancement: Matchup Scanner Accuracy Dashboard

Add a dedicated accuracy breakdown for the Matchup Scanner that shows performance by multiple dimensions.

### 1. Database Changes

Add a new RPC function to break down accuracy by edge score, side, and grade:

```sql
CREATE OR REPLACE FUNCTION get_matchup_scanner_accuracy_breakdown(days_back INTEGER DEFAULT 30)
RETURNS TABLE (
  category TEXT,           -- MATCHUP_SCANNER_PTS or MATCHUP_SCANNER_3PT
  grade TEXT,              -- A+, A, B+, B (derived from confidence_score)
  side TEXT,               -- over, under
  total_picks BIGINT,
  hits BIGINT,
  misses BIGINT,
  hit_rate NUMERIC,
  avg_edge_score NUMERIC
)
```

**Grade derivation from edge score:**
- `A+`: edge_score >= 8
- `A`: edge_score >= 5
- `B+`: edge_score >= 2
- `B`: edge_score < 2

### 2. New Component: MatchupScannerAccuracyCard

Display a dedicated accuracy section on the Sweet Spots page:

```text
+----------------------------------------------------------+
| Matchup Scanner Accuracy (Last 30 Days)                   |
+----------------------------------------------------------+
|                                                           |
|  POINTS (PTS)                 3-POINTERS (3PT)            |
|  +------------------------+   +------------------------+  |
|  | 14W - 8L - 0P          |   | 11W - 6L - 0P          |  |
|  | 63.6% Hit Rate         |   | 64.7% Hit Rate         |  |
|  +------------------------+   +------------------------+  |
|                                                           |
|  By Grade:                                                |
|  +--------+-------+--------+-----------+                  |
|  | Grade  | Picks | Hits   | Hit Rate  |                  |
|  +--------+-------+--------+-----------+                  |
|  | A+/A   | 12    | 9      | 75.0%     |                  |
|  | B+/B   | 17    | 10     | 58.8%     |                  |
|  +--------+-------+--------+-----------+                  |
|                                                           |
|  By Side:                                                 |
|  +--------+-------+--------+-----------+                  |
|  | Side   | Picks | Hits   | Hit Rate  |                  |
|  +--------+-------+--------+-----------+                  |
|  | OVER   | 18    | 13     | 72.2%     |                  |
|  | UNDER  | 11    | 6      | 54.5%     |                  |
|  +--------+-------+--------+-----------+                  |
|                                                           |
|  Calibration: Are A+ picks actually better?               |
|  A+/A picks hit at 75% vs B+/B at 59%                     |
|  Edge score correlates with outcomes                      |
|                                                           |
+----------------------------------------------------------+
```

### 3. Update Matchup Scanner Card to Show Historical Accuracy

When displaying each player's matchup card, show the historical accuracy for picks with similar characteristics:

```text
+------------------------------------+
| Anthony Edwards    #1 ranked       |
| OVER 28.5 PTS    A+ Grade          |
|                                    |
| Defense allows 58% at rim (#3 worst)|
|                                    |
| Similar picks: 75% hit rate (9/12) |
| (A+ grade PTS OVER picks)          |
+------------------------------------+
```

### 4. Files to Modify/Create

| File | Changes |
|------|---------|
| `supabase/migrations/xxx_matchup_scanner_accuracy.sql` | Add `get_matchup_scanner_accuracy_breakdown` RPC |
| `src/hooks/useMatchupScannerAccuracy.ts` | New hook to fetch breakdown data |
| `src/components/matchup-scanner/MatchupScannerAccuracyCard.tsx` | New accuracy visualization component |
| `src/pages/SweetSpots.tsx` | Add accuracy card below scanner dashboard |
| `src/components/matchup-scanner/MatchupGradeCard.tsx` | Add historical accuracy for similar picks |

### 5. Enhance Pick Persistence

Update the `generate-matchup-scanner-picks` edge function to store additional metadata for better accuracy analysis:

```typescript
// Add to the pick object
{
  // ... existing fields
  grade: overallGrade,          // A+, A, B+, B (for grouping)
  primary_zone: primaryZone,    // restricted_area, corner_3, etc.
  opponent_defense_rank: zones[0].defenseRank,  // 1-30
}
```

This enables future breakdowns by:
- Zone matchup type (inside vs outside)
- Defense quality faced
- Edge score calibration

---

## Implementation Order

1. **Add RPC function** for accuracy breakdown
2. **Create hook** to fetch data
3. **Build accuracy card** component
4. **Integrate into Sweet Spots** page
5. **Enhance pick metadata** in edge function
6. **Add similar-pick accuracy** to grade cards

---

## Expected Insights (After 1-2 Weeks of Data)

Once picks are verified, you'll be able to answer:

- **"Do A+ picks actually hit more often?"** - Expected: 70%+ vs 55% for B grades
- **"Are OVER or UNDER picks more reliable?"** - Identify systematic bias
- **"Which matchup types are most predictive?"** - Rim matchups vs 3PT coverage
- **"Is the edge score well-calibrated?"** - Higher scores should correlate with higher hit rates

