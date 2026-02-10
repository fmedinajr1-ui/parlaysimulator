
CREATE TABLE public.bot_diagnostic_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_date DATE NOT NULL DEFAULT CURRENT_DATE,
  checks_passed INTEGER NOT NULL DEFAULT 0,
  checks_warned INTEGER NOT NULL DEFAULT 0,
  checks_failed INTEGER NOT NULL DEFAULT 0,
  overall_status TEXT NOT NULL DEFAULT 'healthy',
  results JSONB NOT NULL DEFAULT '{}',
  improvement_metrics JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_diagnostic_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access on bot_diagnostic_runs"
  ON public.bot_diagnostic_runs
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_bot_diagnostic_runs_date ON public.bot_diagnostic_runs (run_date DESC);
