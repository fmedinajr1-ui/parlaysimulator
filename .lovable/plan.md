

# Fix All 6 Settlement Bugs

## Migration (run first)

Create `settlement_runs` table and add `cascade_confirmation_rate` + `settlement_method` columns to `fanduel_prediction_accuracy`. Also backfill existing `trap_warning` records from `was_correct: true` to `was_correct: null`.

```sql
-- 1. settlement_runs table (Bug 3)
CREATE TABLE IF NOT EXISTS public.settlement_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date text NOT NULL,
  settled_count integer NOT NULL DEFAULT 0,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.settlement_runs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_settlement_runs_date ON public.settlement_runs(run_date);

-- 2. New columns on fanduel_prediction_accuracy (Bug 6)
ALTER TABLE public.fanduel_prediction_accuracy 
  ADD COLUMN IF NOT EXISTS cascade_confirmation_rate real,
  ADD COLUMN IF NOT EXISTS settlement_method text;

-- 3. Backfill trap_warnings to null (Bug 1)
UPDATE public.fanduel_prediction_accuracy 
  SET was_correct = null, actual_outcome = 'informational_excluded'
  WHERE signal_type = 'trap_warning' AND was_correct = true;
```

## Function Changes (5 files)

### 1. `fanduel-accuracy-feedback/index.ts` — Bug 1 + Bug 2 + Bug 6

**Bug 1** (lines 58-63): Change trap_warning settlement from `was_correct: true` to `was_correct: null, actual_outcome: 'informational_excluded'`.

**Bug 2** (lines 102-106 vs 633): The main loop fetches timeline `ascending: false` (newest first), so `playerTimeline[0]` = closing. The stale sweeper fetches `ascending: true` (oldest first), so `pTimeline[0]` = opening. Fix: change main loop to `ascending: true` and swap the `closingLine`/`openingLine` assignments at line 131-132 to match.

**Bug 6** (lines 196-216): After cascade settlement, store `cascade_confirmation_rate` on the update and tag `settlement_method: 'clv'` on all CLV settlements.

Also: add `.neq('actual_outcome', 'informational_excluded')` to the accuracy rollup query at line 544.

### 2. `auto-settle-parlays/index.ts` — Bug 3

**Lines 400-419**: Remove the `calculate_calibration_factors` and `update_strategy_performance` RPC calls. Replace with a `settlement_runs` insert to log what was settled. Calibration is now only triggered by `calibrate-bot-weights`.

### 3. `calibrate-bot-weights/index.ts` — Bug 5 + Bug 3 guard

**Bug 5** (lines 310-342): After the existing sweep pass that blocks categories, add a **rehabilitation pass** that queries `is_blocked = true` categories (excluding `force-blocked%` reasons). If they have 20+ picks and hit rate ≥ 52%, unblock them at half weight (0.5).

**Bug 3 guard**: Add optional `force_run` body param. If not set, check `settlement_runs` — only proceed if the latest run for today is ≥ 2 hours old (meaning settlement has stabilized). Skip otherwise with a log message.

### 4. `bot-settle-and-learn/index.ts` — Bug 4

**Lines 1178-1187**: Replace the batch streak logic with chronological sequential processing. Instead of aggregating hits/misses and computing `hits - misses`, sort the settled legs by `settled_at` ascending and update the streak one leg at a time: hit extends positive or resets to +1, miss extends negative or resets to -1.

### 5. `settlement-weight-updater/index.ts` — No changes needed

Already implements Bayesian smoothing correctly. No bugs identified in this file.

## Files Changed
1. **Migration**: `settlement_runs` table + 2 columns + trap_warning backfill
2. **Edit**: `supabase/functions/fanduel-accuracy-feedback/index.ts`
3. **Edit**: `supabase/functions/auto-settle-parlays/index.ts`
4. **Edit**: `supabase/functions/calibrate-bot-weights/index.ts`
5. **Edit**: `supabase/functions/bot-settle-and-learn/index.ts`

