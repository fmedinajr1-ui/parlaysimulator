-- Create FanDuel trap accuracy metrics table
CREATE TABLE IF NOT EXISTS public.fanduel_trap_accuracy_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL,
  trap_type TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  total_predictions INTEGER DEFAULT 0,
  verified_predictions INTEGER DEFAULT 0,
  correct_predictions INTEGER DEFAULT 0,
  accuracy_rate NUMERIC DEFAULT 0,
  roi_percentage NUMERIC DEFAULT 0,
  avg_trap_score NUMERIC DEFAULT 0,
  avg_odds NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(sport, trap_type, signal_type)
);

-- Enable RLS
ALTER TABLE public.fanduel_trap_accuracy_metrics ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access (accuracy metrics are public data)
CREATE POLICY "Anyone can view fanduel trap accuracy metrics"
ON public.fanduel_trap_accuracy_metrics
FOR SELECT
USING (true);

-- Add outcome tracking columns to fanduel_trap_analysis if not exists
ALTER TABLE public.fanduel_trap_analysis 
ADD COLUMN IF NOT EXISTS outcome TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS outcome_verified_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS fade_won BOOLEAN,
ADD COLUMN IF NOT EXISTS actual_closing_price NUMERIC,
ADD COLUMN IF NOT EXISTS signals_detected TEXT[] DEFAULT '{}';

-- Create index for faster outcome verification queries
CREATE INDEX IF NOT EXISTS idx_fanduel_trap_analysis_pending 
ON public.fanduel_trap_analysis(outcome, commence_time) 
WHERE outcome = 'pending';

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION public.update_fanduel_accuracy_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_fanduel_accuracy_timestamp ON public.fanduel_trap_accuracy_metrics;
CREATE TRIGGER update_fanduel_accuracy_timestamp
BEFORE UPDATE ON public.fanduel_trap_accuracy_metrics
FOR EACH ROW
EXECUTE FUNCTION public.update_fanduel_accuracy_updated_at();