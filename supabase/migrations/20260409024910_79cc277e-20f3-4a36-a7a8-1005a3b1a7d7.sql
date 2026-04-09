
CREATE TABLE public.mlb_rbi_under_analysis (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  team TEXT,
  opponent TEXT,
  opposing_pitcher TEXT,
  pitcher_era NUMERIC,
  pitcher_k_rate NUMERIC,
  l10_rbis INTEGER,
  l10_hit_rate NUMERIC,
  score NUMERIC,
  tier TEXT,
  analysis_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mlb_rbi_under_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON public.mlb_rbi_under_analysis FOR SELECT USING (true);

CREATE INDEX idx_rbi_under_analysis_date ON public.mlb_rbi_under_analysis (analysis_date);
CREATE INDEX idx_rbi_under_player ON public.mlb_rbi_under_analysis (player_name, analysis_date);
