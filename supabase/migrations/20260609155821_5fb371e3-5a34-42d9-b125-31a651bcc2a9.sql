
-- Soccer settlement scaffold
CREATE TABLE IF NOT EXISTS public.soccer_match_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text UNIQUE,
  league text NOT NULL,
  match_date date NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  home_score integer,
  away_score integer,
  status text NOT NULL DEFAULT 'scheduled',
  settled boolean NOT NULL DEFAULT false,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.soccer_match_results TO anon, authenticated;
GRANT ALL ON public.soccer_match_results TO service_role;
ALTER TABLE public.soccer_match_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "soccer_match_results readable" ON public.soccer_match_results FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS idx_soccer_match_results_date ON public.soccer_match_results(match_date);
CREATE INDEX IF NOT EXISTS idx_soccer_match_results_league_date ON public.soccer_match_results(league, match_date);

CREATE TABLE IF NOT EXISTS public.soccer_player_match_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_external_id text,
  league text NOT NULL,
  match_date date NOT NULL,
  player_name text NOT NULL,
  team text,
  opponent text,
  goals integer DEFAULT 0,
  assists integer DEFAULT 0,
  shots integer DEFAULT 0,
  shots_on_target integer DEFAULT 0,
  passes integer DEFAULT 0,
  tackles integer DEFAULT 0,
  fouls integer DEFAULT 0,
  cards_yellow integer DEFAULT 0,
  cards_red integer DEFAULT 0,
  minutes integer DEFAULT 0,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_external_id, player_name)
);
GRANT SELECT ON public.soccer_player_match_stats TO anon, authenticated;
GRANT ALL ON public.soccer_player_match_stats TO service_role;
ALTER TABLE public.soccer_player_match_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "soccer_player_match_stats readable" ON public.soccer_player_match_stats FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS idx_soccer_pms_date ON public.soccer_player_match_stats(match_date);
CREATE INDEX IF NOT EXISTS idx_soccer_pms_player ON public.soccer_player_match_stats(player_name, match_date);

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS soccer_match_results_touch ON public.soccer_match_results;
CREATE TRIGGER soccer_match_results_touch BEFORE UPDATE ON public.soccer_match_results
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
