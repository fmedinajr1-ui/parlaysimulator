

## Refine Hedge Recommendation Thresholds

### Current State

The hedge snapshot table has 133 records (all from Feb 7-8), but **none of them have matching settled outcomes** in any outcome table. The players/prop types recorded in snapshots don't overlap with the players that have `actual_value` populated in `category_sweet_spots`. Until more games are played with the recorder active AND outcomes get settled, we cannot do empirical threshold calibration.

However, there are structural problems we can fix now that will improve accuracy and prepare for data-driven calibration later.

### Problems Found

1. **Duplicate hedge status logic**: `useHedgeStatusRecorder.ts` has its own `calculateHedgeStatus()` that uses **confidence-based thresholds** (65/45/25), while the shared `hedgeStatusUtils.ts` uses **projection buffer thresholds** (+2/0/-2). The recorder is saving statuses calculated with the wrong (stale) algorithm.

2. **Buffer thresholds are too tight**: The current +2/0/-2 buffer in `hedgeStatusUtils.ts` doesn't account for game progress. A +2 buffer in Q1 is very different from +2 in Q4. Early-game buffers should be wider (projections are less certain), late-game buffers should be tighter.

3. **No outcome backfill pipeline**: Snapshots exist but can never be validated because no edge function settles them against final box scores.

### Changes

**1. `src/hooks/useHedgeStatusRecorder.ts`**
- Remove the duplicate `calculateHedgeStatus()` function (lines 135-167)
- Import and use the shared `calculateHedgeStatus` from `@/lib/hedgeStatusUtils`
- This ensures the recorder saves the same status that the UI displays

**2. `src/lib/hedgeStatusUtils.ts`**
- Replace fixed +2/0/-2 buffer thresholds with **game-progress-aware thresholds**:
  - Q1 (0-25%): on_track at +4, monitor at +1, alert at -2, urgent below
  - Q2 (25-50%): on_track at +3, monitor at +0.5, alert at -1.5
  - Q3 (50-75%): on_track at +2, monitor at 0, alert at -1
  - Q4 (75-100%): on_track at +1.5, monitor at -0.5, alert at -1 (tightest -- less time to recover)
- This reflects the reality that early-game projections have wider variance

**3. `src/components/sweetspots/HedgeRecommendation.tsx`**
- Update `calculateHitProbability()` buffer thresholds to match the new progress-aware logic (align with hedgeStatusUtils)
- Currently uses fixed +3/+1/0/-1/-2 buckets -- switch to the same progress-aware scaling

**4. New edge function: `settle-hedge-snapshots`**
- Runs after games end (can be triggered by existing cron or manually)
- Matches snapshots to final box scores in `category_sweet_spots` using `player_name + prop_type + analysis_date`
- Writes `actual_final` and `outcome` (hit/miss) back to the snapshots table
- This creates the feedback loop needed for future empirical calibration

**5. Database migration: add outcome columns to `sweet_spot_hedge_snapshots`**
```sql
ALTER TABLE sweet_spot_hedge_snapshots
  ADD COLUMN IF NOT EXISTS actual_final numeric,
  ADD COLUMN IF NOT EXISTS outcome text; -- 'hit', 'miss', 'push'
```

### Progress-Aware Buffer Thresholds (Detail)

```text
Game Progress    on_track    monitor    alert    urgent
0-25% (Q1)       >= +4       >= +1      >= -2    < -2
25-50% (Q2)      >= +3       >= +0.5    >= -1.5  < -1.5
50-75% (Q3)      >= +2       >= 0       >= -1    < -1
75-100% (Q4)     >= +1.5     >= -0.5    >= -1    < -1
```

This means in Q1, a player projected 3 pts above their line is only "monitor" (not "on_track"), because projections are volatile early. By Q4, being projected 1.5 above is enough for "on_track" because there's little time for variance.

### Summary

- Fix the duplicate status logic (immediate accuracy improvement)
- Add game-progress-aware thresholds (smarter classification)
- Add outcome settlement pipeline (enables future data-driven refinement)
- Align the HedgeRecommendation probability calculation with the shared utility

