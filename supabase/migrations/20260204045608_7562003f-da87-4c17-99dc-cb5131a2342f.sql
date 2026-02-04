-- Create table for historical quarter baselines per player/prop
CREATE TABLE public.player_quarter_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL, -- 'points', 'assists', 'threes', 'blocks'
  
  -- Quarter distributions (as percentage of total, 0.00-1.00)
  q1_pct NUMERIC(5,4) NOT NULL DEFAULT 0.25,
  q2_pct NUMERIC(5,4) NOT NULL DEFAULT 0.25,
  q3_pct NUMERIC(5,4) NOT NULL DEFAULT 0.25,
  q4_pct NUMERIC(5,4) NOT NULL DEFAULT 0.25,
  
  -- Quarter averages (actual values)
  q1_avg NUMERIC(6,2) NOT NULL DEFAULT 0,
  q2_avg NUMERIC(6,2) NOT NULL DEFAULT 0,
  q3_avg NUMERIC(6,2) NOT NULL DEFAULT 0,
  q4_avg NUMERIC(6,2) NOT NULL DEFAULT 0,
  
  -- Half distributions for halftime recalibration
  h1_pct NUMERIC(5,4) NOT NULL DEFAULT 0.50, -- 1st half percentage (Q1+Q2)
  h2_pct NUMERIC(5,4) NOT NULL DEFAULT 0.50, -- 2nd half percentage (Q3+Q4)
  
  -- Rate-based metrics (per minute)
  q1_rate NUMERIC(6,4) DEFAULT 0,
  q2_rate NUMERIC(6,4) DEFAULT 0,
  q3_rate NUMERIC(6,4) DEFAULT 0,
  q4_rate NUMERIC(6,4) DEFAULT 0,
  
  -- Game-level context from L10
  game_avg NUMERIC(6,2) NOT NULL DEFAULT 0,
  sample_size INTEGER NOT NULL DEFAULT 0,
  minutes_avg NUMERIC(5,2) NOT NULL DEFAULT 0,
  
  -- Player tier for regression calculations
  player_tier TEXT DEFAULT 'starter', -- 'star', 'starter', 'role_player'
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Ensure one baseline per player/prop combination
  UNIQUE(player_name, prop_type)
);

-- Enable RLS
ALTER TABLE public.player_quarter_baselines ENABLE ROW LEVEL SECURITY;

-- Public read access (betting analytics data)
CREATE POLICY "Anyone can read quarter baselines"
  ON public.player_quarter_baselines
  FOR SELECT
  USING (true);

-- Only service role can write (populated by edge function)
CREATE POLICY "Service role can manage quarter baselines"
  ON public.player_quarter_baselines
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Index for fast player lookups
CREATE INDEX idx_quarter_baselines_player ON public.player_quarter_baselines(player_name);
CREATE INDEX idx_quarter_baselines_player_prop ON public.player_quarter_baselines(player_name, prop_type);

-- Trigger for updated_at
CREATE TRIGGER update_player_quarter_baselines_updated_at
  BEFORE UPDATE ON public.player_quarter_baselines
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();