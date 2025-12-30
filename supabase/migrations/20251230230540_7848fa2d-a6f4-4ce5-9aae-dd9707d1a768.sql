-- Create table to store learned loss patterns
CREATE TABLE public.elite_hitter_loss_patterns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pattern_type TEXT NOT NULL, -- 'prop_type_side', 'engine_concentration', 'player_variance', 'margin_analysis'
  pattern_key TEXT NOT NULL, -- e.g., 'player_assists_under', 'all_pvs_parlay'
  description TEXT,
  loss_count INTEGER NOT NULL DEFAULT 0,
  hit_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  accuracy_rate NUMERIC DEFAULT 0,
  severity TEXT NOT NULL DEFAULT 'penalize', -- 'block' or 'penalize'
  penalty_amount NUMERIC DEFAULT 0.3,
  example_losses JSONB DEFAULT '[]'::jsonb, -- Store examples for debugging
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(pattern_type, pattern_key)
);

-- Enable RLS
ALTER TABLE public.elite_hitter_loss_patterns ENABLE ROW LEVEL SECURITY;

-- Allow public read access (patterns are not user-specific)
CREATE POLICY "Allow public read access to loss patterns"
ON public.elite_hitter_loss_patterns
FOR SELECT
USING (true);

-- Allow service role to manage patterns
CREATE POLICY "Allow service role to manage loss patterns"
ON public.elite_hitter_loss_patterns
FOR ALL
USING (true);

-- Create updated_at trigger
CREATE TRIGGER update_elite_hitter_loss_patterns_updated_at
BEFORE UPDATE ON public.elite_hitter_loss_patterns
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Seed initial patterns based on loss analysis
INSERT INTO public.elite_hitter_loss_patterns (pattern_type, pattern_key, description, loss_count, hit_count, total_count, accuracy_rate, severity, penalty_amount, example_losses)
VALUES
  ('engine_concentration', 'all_pvs_parlay', 'All 3 legs from PVS engine only', 2, 0, 2, 0, 'penalize', 0.5, '["Dec 26 - 0/3 hit", "Dec 29 - 0/3 hit"]'::jsonb),
  ('prop_type_side', 'player_assists_under', 'Player assists UNDER props have high variance', 1, 1, 2, 0.5, 'penalize', 0.3, '["Dec 29 - Halliburton 8 ast vs 5.5 line"]'::jsonb),
  ('prop_type_side', 'player_points_over', 'Points OVER missed on HitRate picks', 2, 0, 2, 0, 'penalize', 0.4, '["Dec 27 - LaMelo 26 vs 21.5 (won but fragile)", "Dec 27 - Harden 16 vs 18.5 line"]'::jsonb),
  ('prop_type_side', 'player_rebounds_under', 'Rebounds UNDER has high variance', 1, 0, 1, 0, 'penalize', 0.3, '["Dec 29 - Edwards 6 reb vs 5.5 line"]'::jsonb),
  ('margin_analysis', 'close_miss_under_1', 'Props that miss by less than 1 unit indicate variance issues', 3, 0, 3, 0, 'penalize', 0.2, '["Halliburton 8 vs 5.5", "Edwards 6 vs 5.5"]'::jsonb);

-- Create index for pattern lookups
CREATE INDEX idx_loss_patterns_active ON public.elite_hitter_loss_patterns(is_active, pattern_type);