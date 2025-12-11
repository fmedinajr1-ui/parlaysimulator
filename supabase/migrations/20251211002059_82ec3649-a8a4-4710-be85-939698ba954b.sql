-- Create ai_formula_performance table to track individual formula accuracy
CREATE TABLE public.ai_formula_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_name TEXT NOT NULL,
  engine_source TEXT NOT NULL,
  total_picks INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  current_accuracy NUMERIC DEFAULT 0,
  current_weight NUMERIC DEFAULT 1.0,
  last_win_streak INTEGER DEFAULT 0,
  last_loss_streak INTEGER DEFAULT 0,
  optimal_threshold NUMERIC,
  sport_breakdown JSONB DEFAULT '{}',
  compound_formulas JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(formula_name, engine_source)
);

-- Add new columns to ai_generated_parlays for formula tracking
ALTER TABLE public.ai_generated_parlays 
ADD COLUMN IF NOT EXISTS formula_breakdown JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS source_engines TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS leg_sources JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS sport TEXT;

-- Enable RLS on ai_formula_performance
ALTER TABLE public.ai_formula_performance ENABLE ROW LEVEL SECURITY;

-- RLS policies for ai_formula_performance
CREATE POLICY "Anyone can view formula performance"
ON public.ai_formula_performance FOR SELECT
USING (true);

CREATE POLICY "Admins can manage formula performance"
ON public.ai_formula_performance FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Create function to update formula performance timestamps
CREATE OR REPLACE FUNCTION public.update_formula_performance_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_formula_performance_timestamp
BEFORE UPDATE ON public.ai_formula_performance
FOR EACH ROW
EXECUTE FUNCTION public.update_formula_performance_updated_at();

-- Seed initial formula performance data
INSERT INTO public.ai_formula_performance (formula_name, engine_source, current_weight) VALUES
('sharp_ses_30+', 'sharp', 1.0),
('sharp_fade_30-', 'sharp', 1.0),
('pvs_final_70+', 'pvs', 1.0),
('pvs_final_80+', 'pvs', 1.2),
('hitrate_5_5', 'hitrate', 1.3),
('hitrate_4_5', 'hitrate', 1.1),
('juiced_extreme', 'juiced', 1.0),
('juiced_heavy', 'juiced', 0.9),
('godmode_high_65+', 'godmode', 1.0),
('godmode_medium_50+', 'godmode', 0.8),
('fatigue_diff_20+', 'fatigue', 1.1),
('fatigue_diff_30+', 'fatigue', 1.3),
('bestbets_high_accuracy', 'bestbets', 1.2)
ON CONFLICT (formula_name, engine_source) DO NOTHING;