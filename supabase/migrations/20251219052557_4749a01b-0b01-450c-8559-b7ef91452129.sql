-- Create daily_elite_parlays table for storing the daily elite hitter selection
CREATE TABLE public.daily_elite_parlays (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  parlay_date DATE NOT NULL UNIQUE,
  
  -- Selected legs (3 legs)
  legs JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Scoring metrics
  slip_score DECIMAL(10,4),
  combined_probability DECIMAL(10,6),
  total_edge DECIMAL(6,2),
  variance_penalty DECIMAL(6,2),
  
  -- Per-leg diagnostics
  leg_probabilities JSONB DEFAULT '{}'::jsonb,
  leg_edges JSONB DEFAULT '{}'::jsonb,
  engine_consensus JSONB DEFAULT '[]'::jsonb,
  
  -- Parlay details
  total_odds DECIMAL(10,2),
  sports JSONB DEFAULT '[]'::jsonb,
  source_engines JSONB DEFAULT '[]'::jsonb,
  
  -- Outcome tracking
  outcome TEXT NOT NULL DEFAULT 'pending',
  settled_at TIMESTAMPTZ,
  actual_result JSONB DEFAULT '[]'::jsonb,
  
  -- Learning
  generation_round INTEGER DEFAULT 1,
  model_version TEXT DEFAULT 'v1'
);

-- Enable RLS
ALTER TABLE public.daily_elite_parlays ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone with elite_access or admin can view
CREATE POLICY "Elite users can view daily elite parlays"
ON public.daily_elite_parlays
FOR SELECT
USING (
  has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'elite_access')
);

-- Policy: Service role can manage (for edge functions)
CREATE POLICY "Service role can manage daily elite parlays"
ON public.daily_elite_parlays
FOR ALL
USING (true)
WITH CHECK (true);

-- Create index for faster date lookups
CREATE INDEX idx_daily_elite_parlay_date ON public.daily_elite_parlays(parlay_date DESC);
CREATE INDEX idx_daily_elite_outcome ON public.daily_elite_parlays(outcome);