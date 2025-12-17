-- Create coaching_predictions table to track individual predictions
CREATE TABLE public.coaching_predictions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coach_id UUID REFERENCES public.coach_profiles(id),
  coach_name TEXT NOT NULL,
  team_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  game_date DATE NOT NULL,
  situation TEXT NOT NULL DEFAULT 'fresh',
  prop_type TEXT NOT NULL,
  player_name TEXT,
  recommendation TEXT NOT NULL,
  confidence NUMERIC NOT NULL DEFAULT 0.5,
  prop_adjustments JSONB DEFAULT '{}',
  prop_line NUMERIC,
  predicted_direction TEXT,
  actual_stat_value NUMERIC,
  outcome TEXT DEFAULT 'pending',
  outcome_verified BOOLEAN DEFAULT FALSE,
  prediction_accurate BOOLEAN,
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create coaching_accuracy_metrics table for aggregated stats
CREATE TABLE public.coaching_accuracy_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coach_id UUID REFERENCES public.coach_profiles(id),
  coach_name TEXT NOT NULL,
  team_name TEXT NOT NULL,
  situation TEXT NOT NULL DEFAULT 'all',
  prop_type TEXT NOT NULL DEFAULT 'all',
  total_predictions INTEGER DEFAULT 0,
  correct_predictions INTEGER DEFAULT 0,
  win_rate NUMERIC DEFAULT 0,
  avg_confidence NUMERIC DEFAULT 0.5,
  roi_percentage NUMERIC DEFAULT 0,
  calibration_factor NUMERIC DEFAULT 1.0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(coach_id, situation, prop_type)
);

-- Enable RLS
ALTER TABLE public.coaching_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coaching_accuracy_metrics ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access (these are analytics tables)
CREATE POLICY "coaching_predictions_public_read" ON public.coaching_predictions FOR SELECT USING (true);
CREATE POLICY "coaching_accuracy_metrics_public_read" ON public.coaching_accuracy_metrics FOR SELECT USING (true);

-- Create indexes for efficient queries
CREATE INDEX idx_coaching_predictions_event ON public.coaching_predictions(event_id);
CREATE INDEX idx_coaching_predictions_date ON public.coaching_predictions(game_date);
CREATE INDEX idx_coaching_predictions_outcome ON public.coaching_predictions(outcome);
CREATE INDEX idx_coaching_predictions_coach ON public.coaching_predictions(coach_id);
CREATE INDEX idx_coaching_accuracy_coach ON public.coaching_accuracy_metrics(coach_id);

-- Create updated_at triggers
CREATE TRIGGER update_coaching_predictions_updated_at
  BEFORE UPDATE ON public.coaching_predictions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_fanduel_accuracy_updated_at();

CREATE TRIGGER update_coaching_accuracy_metrics_updated_at
  BEFORE UPDATE ON public.coaching_accuracy_metrics
  FOR EACH ROW
  EXECUTE FUNCTION public.update_fanduel_accuracy_updated_at();