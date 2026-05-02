
CREATE TABLE public.mlb_pitcher_k_analysis (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pitcher_name TEXT NOT NULL,
  team TEXT NOT NULL,
  opponent TEXT NOT NULL,
  home_team TEXT NOT NULL,
  game_date DATE NOT NULL,
  line NUMERIC,
  pitcher_k9_blended NUMERIC,
  pitcher_k9_sample_starts INT,
  expected_ip NUMERIC,
  opp_k_rate_mult NUMERIC,
  park_k_mult NUMERIC,
  expected_k NUMERIC,
  p_over NUMERIC,
  edge NUMERIC,
  confidence_score NUMERIC,
  tier TEXT,
  block_reason TEXT,
  recommend BOOLEAN NOT NULL DEFAULT false,
  outcome TEXT NOT NULL DEFAULT 'pending',
  actual_k INT,
  settled_at TIMESTAMPTZ,
  broadcast_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pitcher_name, game_date)
);

CREATE INDEX idx_mlb_pitcher_k_game_date ON public.mlb_pitcher_k_analysis(game_date DESC);
CREATE INDEX idx_mlb_pitcher_k_tier ON public.mlb_pitcher_k_analysis(tier) WHERE tier IN ('S','A');

ALTER TABLE public.mlb_pitcher_k_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view pitcher K analysis"
ON public.mlb_pitcher_k_analysis
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
