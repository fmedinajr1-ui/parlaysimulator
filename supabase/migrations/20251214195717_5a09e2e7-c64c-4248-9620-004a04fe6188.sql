-- Create engine_brier_scores table for tracking calibration quality
CREATE TABLE public.engine_brier_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  engine_name TEXT NOT NULL,
  sport TEXT,
  bet_type TEXT,
  brier_score NUMERIC NOT NULL DEFAULT 0,
  log_loss NUMERIC DEFAULT 0,
  sample_size INTEGER NOT NULL DEFAULT 0,
  period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  period_end TIMESTAMP WITH TIME ZONE NOT NULL,
  calibration_error NUMERIC DEFAULT 0,
  reliability_score NUMERIC DEFAULT 0,
  resolution_score NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(engine_name, sport, bet_type, period_start, period_end)
);

-- Create calibration_buckets table for storing binned calibration data
CREATE TABLE public.calibration_buckets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  engine_name TEXT NOT NULL,
  sport TEXT,
  bucket_start NUMERIC NOT NULL,
  bucket_end NUMERIC NOT NULL,
  predicted_avg NUMERIC NOT NULL,
  actual_avg NUMERIC NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  confidence_lower NUMERIC,
  confidence_upper NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create isotonic_calibration table for storing recalibration mappings
CREATE TABLE public.isotonic_calibration (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  engine_name TEXT NOT NULL,
  sport TEXT,
  bet_type TEXT,
  raw_probability NUMERIC NOT NULL,
  calibrated_probability NUMERIC NOT NULL,
  sample_size INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.engine_brier_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calibration_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.isotonic_calibration ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access
CREATE POLICY "Anyone can view brier scores" ON public.engine_brier_scores FOR SELECT USING (true);
CREATE POLICY "Anyone can view calibration buckets" ON public.calibration_buckets FOR SELECT USING (true);
CREATE POLICY "Anyone can view isotonic calibration" ON public.isotonic_calibration FOR SELECT USING (true);

-- Create indexes for efficient lookups
CREATE INDEX idx_brier_scores_engine ON public.engine_brier_scores(engine_name, sport);
CREATE INDEX idx_calibration_buckets_engine ON public.calibration_buckets(engine_name, sport);
CREATE INDEX idx_isotonic_engine ON public.isotonic_calibration(engine_name, sport, bet_type);

-- Create update triggers
CREATE TRIGGER update_brier_scores_updated_at
  BEFORE UPDATE ON public.engine_brier_scores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_calibration_buckets_updated_at
  BEFORE UPDATE ON public.calibration_buckets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_isotonic_updated_at
  BEFORE UPDATE ON public.isotonic_calibration
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();