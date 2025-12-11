-- Add loss_patterns column to ai_formula_performance
ALTER TABLE public.ai_formula_performance 
ADD COLUMN IF NOT EXISTS loss_patterns JSONB DEFAULT '[]'::jsonb;

-- Create ai_avoid_patterns table for tracking patterns to avoid
CREATE TABLE IF NOT EXISTS public.ai_avoid_patterns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pattern_type TEXT NOT NULL,
  pattern_key TEXT NOT NULL,
  description TEXT,
  sport TEXT,
  engine_source TEXT,
  formula_name TEXT,
  loss_count INTEGER DEFAULT 0,
  total_count INTEGER DEFAULT 0,
  accuracy_rate NUMERIC DEFAULT 0,
  last_loss_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  avoid_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(pattern_type, pattern_key)
);

-- Create ai_compound_formulas table for successful formula combinations
CREATE TABLE IF NOT EXISTS public.ai_compound_formulas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  combination TEXT NOT NULL UNIQUE,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  total_picks INTEGER DEFAULT 0,
  accuracy_rate NUMERIC DEFAULT 0,
  avg_odds NUMERIC DEFAULT 0,
  roi_percentage NUMERIC DEFAULT 0,
  sports JSONB DEFAULT '[]'::jsonb,
  last_win_at TIMESTAMP WITH TIME ZONE,
  last_loss_at TIMESTAMP WITH TIME ZONE,
  is_preferred BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create ai_cross_engine_performance for tracking cross-engine learning
CREATE TABLE IF NOT EXISTS public.ai_cross_engine_performance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  engine_a TEXT NOT NULL,
  engine_b TEXT NOT NULL,
  event_type TEXT,
  sport TEXT,
  engine_a_wins INTEGER DEFAULT 0,
  engine_b_wins INTEGER DEFAULT 0,
  both_wins INTEGER DEFAULT 0,
  both_losses INTEGER DEFAULT 0,
  total_comparisons INTEGER DEFAULT 0,
  preference_score NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(engine_a, engine_b, event_type, sport)
);

-- Enable RLS
ALTER TABLE public.ai_avoid_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_compound_formulas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_cross_engine_performance ENABLE ROW LEVEL SECURITY;

-- Create policies for viewing
CREATE POLICY "Anyone can view avoid patterns" ON public.ai_avoid_patterns FOR SELECT USING (true);
CREATE POLICY "Admins can manage avoid patterns" ON public.ai_avoid_patterns FOR ALL USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anyone can view compound formulas" ON public.ai_compound_formulas FOR SELECT USING (true);
CREATE POLICY "Admins can manage compound formulas" ON public.ai_compound_formulas FOR ALL USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anyone can view cross engine performance" ON public.ai_cross_engine_performance FOR SELECT USING (true);
CREATE POLICY "Admins can manage cross engine performance" ON public.ai_cross_engine_performance FOR ALL USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_avoid_patterns_active ON public.ai_avoid_patterns(is_active, pattern_type);
CREATE INDEX IF NOT EXISTS idx_compound_formulas_preferred ON public.ai_compound_formulas(is_preferred, accuracy_rate);
CREATE INDEX IF NOT EXISTS idx_cross_engine_sport ON public.ai_cross_engine_performance(sport, engine_a, engine_b);