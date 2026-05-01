-- mlb_no_hr_team_analysis: per-(team, game_date) row for the No HR engine
CREATE TABLE IF NOT EXISTS public.mlb_no_hr_team_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team text NOT NULL,
  opponent text,
  home_team text,
  game_date date NOT NULL,
  opposing_pitcher text,
  pitcher_hr9 numeric,
  pitcher_sample_ip numeric,
  park_hr_factor numeric,
  weather_mult numeric DEFAULT 1.0,
  team_hr_per_game_l30 numeric,
  team_games_l30 integer,
  team_hr_per_game_season numeric,
  blended_hr_per_game numeric,
  lambda numeric,
  p_no_hr numeric,
  confidence_score numeric,
  tier text CHECK (tier IN ('S','A','B','PASS')),
  block_reason text,
  recommend boolean DEFAULT false,
  outcome text DEFAULT 'pending',
  actual_team_hr integer,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mlb_no_hr_team_analysis_unique UNIQUE (team, game_date)
);

CREATE INDEX IF NOT EXISTS idx_mlb_no_hr_team_date ON public.mlb_no_hr_team_analysis (game_date DESC);
CREATE INDEX IF NOT EXISTS idx_mlb_no_hr_team_tier ON public.mlb_no_hr_team_analysis (tier, game_date DESC);

ALTER TABLE public.mlb_no_hr_team_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read mlb_no_hr_team_analysis"
  ON public.mlb_no_hr_team_analysis FOR SELECT USING (true);

CREATE POLICY "Service insert mlb_no_hr_team_analysis"
  ON public.mlb_no_hr_team_analysis FOR INSERT WITH CHECK (true);

CREATE POLICY "Service update mlb_no_hr_team_analysis"
  ON public.mlb_no_hr_team_analysis FOR UPDATE USING (true);