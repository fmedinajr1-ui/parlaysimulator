
-- Table 1: Track all AI-generated parlays
CREATE TABLE public.ai_generated_parlays (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  generation_round INTEGER NOT NULL DEFAULT 1,
  strategy_used TEXT NOT NULL,
  signals_used TEXT[] NOT NULL DEFAULT '{}',
  legs JSONB NOT NULL DEFAULT '[]',
  total_odds NUMERIC NOT NULL DEFAULT 1,
  confidence_score NUMERIC NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT 'pending',
  settled_at TIMESTAMP WITH TIME ZONE,
  accuracy_at_generation NUMERIC,
  ai_reasoning TEXT
);

-- Table 2: Track AI learning progress over time
CREATE TABLE public.ai_learning_progress (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  generation_round INTEGER NOT NULL UNIQUE,
  parlays_generated INTEGER NOT NULL DEFAULT 0,
  parlays_settled INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  current_accuracy NUMERIC NOT NULL DEFAULT 0,
  target_accuracy NUMERIC NOT NULL DEFAULT 65,
  strategy_weights JSONB NOT NULL DEFAULT '{"nhl_pick": 1.0, "nba_fade": 1.0, "ncaab_fade": 1.0, "hit_streak": 1.0, "sharp_money": 1.0, "fatigue_edge": 1.0}',
  learned_patterns JSONB NOT NULL DEFAULT '{"winning": [], "losing": []}',
  is_milestone BOOLEAN NOT NULL DEFAULT false,
  milestone_reached TEXT
);

-- Enable RLS
ALTER TABLE public.ai_generated_parlays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_learning_progress ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Admins can manage, anyone can view
CREATE POLICY "Anyone can view AI generated parlays" 
ON public.ai_generated_parlays 
FOR SELECT 
USING (true);

CREATE POLICY "Admins can manage AI generated parlays" 
ON public.ai_generated_parlays 
FOR ALL 
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Anyone can view AI learning progress" 
ON public.ai_learning_progress 
FOR SELECT 
USING (true);

CREATE POLICY "Admins can manage AI learning progress" 
ON public.ai_learning_progress 
FOR ALL 
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Enable realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_generated_parlays;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_learning_progress;

-- Create index for faster queries
CREATE INDEX idx_ai_generated_parlays_outcome ON public.ai_generated_parlays(outcome);
CREATE INDEX idx_ai_generated_parlays_round ON public.ai_generated_parlays(generation_round);
CREATE INDEX idx_ai_learning_progress_round ON public.ai_learning_progress(generation_round);
