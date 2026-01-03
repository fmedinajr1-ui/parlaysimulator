-- Create median_parlay_picks table for AI-generated parlays
CREATE TABLE public.median_parlay_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  parlay_date DATE NOT NULL,
  parlay_type TEXT NOT NULL, -- 'SAFE', 'BALANCED', 'VALUE'
  legs JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of 6 leg objects
  total_edge NUMERIC,
  combined_hit_rate NUMERIC,
  confidence_score NUMERIC, -- 0-100
  stat_breakdown JSONB DEFAULT '{}'::jsonb, -- {"points": 2, "assists": 1, "pra": 1}
  duo_stacks JSONB DEFAULT '[]'::jsonb, -- [{"player": "X", "type": "points+assists", "boost": 10}]
  defense_advantage_score NUMERIC,
  engine_version TEXT DEFAULT 'v2',
  outcome TEXT DEFAULT 'pending', -- 'pending', 'won', 'lost', 'partial', 'push'
  leg_outcomes JSONB DEFAULT '[]'::jsonb, -- Track individual leg results
  legs_won INTEGER DEFAULT 0,
  legs_lost INTEGER DEFAULT 0,
  verified_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.median_parlay_picks ENABLE ROW LEVEL SECURITY;

-- Public read access policy
CREATE POLICY "Public can view median parlay picks" 
ON public.median_parlay_picks 
FOR SELECT 
USING (true);

-- Service role full access policy
CREATE POLICY "Service role can manage median parlay picks" 
ON public.median_parlay_picks 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Create index for efficient date-based queries
CREATE INDEX idx_median_parlay_picks_date ON public.median_parlay_picks(parlay_date);
CREATE INDEX idx_median_parlay_picks_outcome ON public.median_parlay_picks(outcome);