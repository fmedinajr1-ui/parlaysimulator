-- Create elite_hitter_matchup_patterns table for opponent defense correlation
CREATE TABLE public.elite_hitter_matchup_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport TEXT NOT NULL DEFAULT 'NBA',
  prop_type TEXT NOT NULL,
  side TEXT NOT NULL,
  
  -- Defensive tier bucketing (1-5 = elite, 6-12 = good, 13-20 = average, 21-30 = weak)
  defense_tier TEXT NOT NULL,
  
  -- Tracking counts
  hit_count INTEGER DEFAULT 0,
  miss_count INTEGER DEFAULT 0,
  total_count INTEGER DEFAULT 0,
  accuracy_rate NUMERIC DEFAULT 0,
  
  -- For deeper analysis
  avg_line NUMERIC,
  avg_actual_value NUMERIC,
  avg_miss_margin NUMERIC,
  
  -- Example cases
  example_matchups JSONB DEFAULT '[]',
  
  -- Penalty/boost settings
  penalty_amount NUMERIC DEFAULT 0,
  is_boost BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(sport, prop_type, side, defense_tier)
);

-- Add opponent context columns to daily_elite_leg_outcomes
ALTER TABLE public.daily_elite_leg_outcomes 
  ADD COLUMN IF NOT EXISTS opponent_name TEXT,
  ADD COLUMN IF NOT EXISTS opponent_defense_rank INTEGER,
  ADD COLUMN IF NOT EXISTS opponent_defense_rating NUMERIC,
  ADD COLUMN IF NOT EXISTS sport TEXT DEFAULT 'NBA';

-- Create index for faster pattern lookups
CREATE INDEX idx_matchup_patterns_lookup 
  ON public.elite_hitter_matchup_patterns (sport, prop_type, side, defense_tier) 
  WHERE is_active = true;

-- Enable RLS
ALTER TABLE public.elite_hitter_matchup_patterns ENABLE ROW LEVEL SECURITY;

-- Allow public read access (patterns are system-generated, not user-specific)
CREATE POLICY "Allow public read access to matchup patterns"
  ON public.elite_hitter_matchup_patterns FOR SELECT
  USING (true);

-- Allow service role full access for edge functions
CREATE POLICY "Allow service role full access to matchup patterns"
  ON public.elite_hitter_matchup_patterns FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);