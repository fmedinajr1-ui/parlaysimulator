CREATE TABLE public.high_conviction_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_date text NOT NULL,
  player_name text NOT NULL,
  prop_type text NOT NULL,
  display_prop_type text,
  signal text NOT NULL,
  edge_pct numeric NOT NULL DEFAULT 0,
  confidence_tier text,
  current_line numeric,
  player_avg numeric,
  sport text,
  engines jsonb DEFAULT '[]'::jsonb,
  side_agreement boolean DEFAULT false,
  conviction_score numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(player_name, prop_type, analysis_date)
);

CREATE INDEX idx_hcr_date ON public.high_conviction_results(analysis_date);

ALTER TABLE public.high_conviction_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read high conviction results"
  ON public.high_conviction_results
  FOR SELECT
  USING (true);
