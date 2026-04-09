
-- 1. Create settlement_records table
CREATE TABLE public.settlement_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id UUID NOT NULL,
  settlement_method TEXT NOT NULL CHECK (settlement_method IN ('clv', 'outcome', 'parlay_composite')),
  was_correct BOOLEAN,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  settled_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups by signal
CREATE UNIQUE INDEX idx_settlement_records_signal ON public.settlement_records (signal_id);
CREATE INDEX idx_settlement_records_method ON public.settlement_records (settlement_method);
CREATE INDEX idx_settlement_records_settled_at ON public.settlement_records (settled_at);

-- Enable RLS
ALTER TABLE public.settlement_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to settlement_records"
  ON public.settlement_records
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 2. Add columns to fanduel_prediction_alerts
ALTER TABLE public.fanduel_prediction_alerts
  ADD COLUMN IF NOT EXISTS settlement_method TEXT,
  ADD COLUMN IF NOT EXISTS contrarian_flip_applied BOOLEAN DEFAULT false;

-- Index for settlement queries
CREATE INDEX IF NOT EXISTS idx_fpa_settlement_method
  ON public.fanduel_prediction_alerts (settlement_method);

-- 3. Create materialized view for unified accuracy
CREATE MATERIALIZED VIEW public.signal_accuracy AS
SELECT
  s.signal_type,
  s.prop_type,
  s.contrarian_flip_applied,
  COUNT(*) FILTER (WHERE sr.was_correct IS NOT NULL) AS settled_n,
  COUNT(*) FILTER (WHERE sr.was_correct = true) AS wins,
  ROUND(
    COUNT(*) FILTER (WHERE sr.was_correct = true)::numeric /
    NULLIF(COUNT(*) FILTER (WHERE sr.was_correct IS NOT NULL), 0),
    4
  ) AS win_rate,
  MAX(sr.settled_at) AS last_settled
FROM public.fanduel_prediction_alerts s
JOIN public.settlement_records sr ON sr.signal_id = s.id
GROUP BY s.signal_type, s.prop_type, s.contrarian_flip_applied;

-- Index on the materialized view
CREATE UNIQUE INDEX idx_signal_accuracy_key
  ON public.signal_accuracy (signal_type, prop_type, contrarian_flip_applied);

-- 4. Function to refresh the materialized view
CREATE OR REPLACE FUNCTION public.refresh_signal_accuracy()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.signal_accuracy;
$$;
