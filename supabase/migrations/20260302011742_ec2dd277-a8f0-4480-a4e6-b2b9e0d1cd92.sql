CREATE TABLE public.team_moneyline_odds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport text NOT NULL,
  event_id text NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  home_odds numeric,
  away_odds numeric,
  bookmaker text NOT NULL,
  commence_time timestamptz,
  implied_home_prob numeric,
  implied_away_prob numeric,
  analysis_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, bookmaker, analysis_date)
);

ALTER TABLE public.team_moneyline_odds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON public.team_moneyline_odds
  FOR SELECT USING (true);

CREATE POLICY "Service role write access" ON public.team_moneyline_odds
  FOR ALL USING (true) WITH CHECK (true);