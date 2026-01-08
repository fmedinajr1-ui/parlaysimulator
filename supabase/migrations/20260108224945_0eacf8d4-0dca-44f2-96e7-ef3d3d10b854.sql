-- Create table for Sharp AI Parlays
CREATE TABLE public.sharp_ai_parlays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  parlay_date DATE NOT NULL,
  parlay_type TEXT NOT NULL CHECK (parlay_type IN ('SAFE', 'BALANCED', 'UPSIDE')),
  legs JSONB NOT NULL DEFAULT '[]',
  total_odds NUMERIC,
  combined_probability NUMERIC,
  rule_compliance JSONB DEFAULT '{}',
  outcome TEXT DEFAULT 'pending' CHECK (outcome IN ('pending', 'won', 'lost', 'push', 'partial')),
  settled_at TIMESTAMPTZ,
  model_version TEXT DEFAULT 'v1',
  generation_round INTEGER DEFAULT 1,
  sport TEXT DEFAULT 'basketball_nba'
);

-- Enable RLS
ALTER TABLE public.sharp_ai_parlays ENABLE ROW LEVEL SECURITY;

-- Public read access for all parlays
CREATE POLICY "Anyone can view sharp AI parlays"
ON public.sharp_ai_parlays
FOR SELECT
USING (true);

-- Create index for efficient queries
CREATE INDEX idx_sharp_ai_parlays_date ON public.sharp_ai_parlays(parlay_date DESC);
CREATE INDEX idx_sharp_ai_parlays_type ON public.sharp_ai_parlays(parlay_type);
CREATE INDEX idx_sharp_ai_parlays_outcome ON public.sharp_ai_parlays(outcome);