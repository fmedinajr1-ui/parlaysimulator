-- Create leg-level tracking table for granular accuracy analysis
CREATE TABLE public.daily_elite_leg_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parlay_id UUID REFERENCES public.daily_elite_parlays(id) ON DELETE CASCADE,
  leg_index INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  line NUMERIC NOT NULL,
  side TEXT NOT NULL,
  predicted_probability NUMERIC,
  actual_value NUMERIC,
  outcome TEXT DEFAULT 'pending',
  engine_signals JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  verified_at TIMESTAMPTZ
);

-- Create accuracy metrics table for tracking by engine/prop/bucket
CREATE TABLE public.elite_parlay_accuracy_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_type TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  total_predictions INTEGER DEFAULT 0,
  correct_predictions INTEGER DEFAULT 0,
  accuracy_rate NUMERIC,
  avg_predicted_probability NUMERIC,
  calibration_factor NUMERIC,
  sample_confidence TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(metric_type, metric_key)
);

-- Enable RLS
ALTER TABLE public.daily_elite_leg_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elite_parlay_accuracy_metrics ENABLE ROW LEVEL SECURITY;

-- RLS policies for leg outcomes
CREATE POLICY "Anyone can view elite leg outcomes"
  ON public.daily_elite_leg_outcomes FOR SELECT
  USING (true);

-- RLS policies for accuracy metrics
CREATE POLICY "Anyone can view elite accuracy metrics"
  ON public.elite_parlay_accuracy_metrics FOR SELECT
  USING (true);

-- Create indexes for performance
CREATE INDEX idx_elite_leg_outcomes_parlay_id ON public.daily_elite_leg_outcomes(parlay_id);
CREATE INDEX idx_elite_leg_outcomes_outcome ON public.daily_elite_leg_outcomes(outcome);
CREATE INDEX idx_elite_accuracy_metrics_type ON public.elite_parlay_accuracy_metrics(metric_type);