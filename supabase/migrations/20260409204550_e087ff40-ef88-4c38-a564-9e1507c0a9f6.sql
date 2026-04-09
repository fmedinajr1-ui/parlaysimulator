
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
