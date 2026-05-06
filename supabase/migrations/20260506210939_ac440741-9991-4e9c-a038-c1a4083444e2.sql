-- Nuke Parlay Scout schema
CREATE TABLE IF NOT EXISTS public.nuke_game_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL,
  game_date date NOT NULL,
  sport text NOT NULL DEFAULT 'basketball_nba',
  home_team text NOT NULL,
  away_team text NOT NULL,
  commence_time timestamptz NOT NULL,
  home_spread numeric,
  away_spread numeric,
  total numeric,
  home_ml integer,
  away_ml integer,
  favorite_team text,
  dog_team text,
  spread_pts integer NOT NULL DEFAULT 0,
  ml_pts integer NOT NULL DEFAULT 0,
  gap_pts integer NOT NULL DEFAULT 0,
  juice_pts integer NOT NULL DEFAULT 0,
  juice_signal_count integer NOT NULL DEFAULT 0,
  script_score integer NOT NULL DEFAULT 0,
  script_tier text NOT NULL DEFAULT 'skip',
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nuke_game_scores_unique UNIQUE (game_id, game_date)
);

CREATE INDEX IF NOT EXISTS idx_nuke_game_scores_date_tier
  ON public.nuke_game_scores (game_date DESC, script_tier);

CREATE TABLE IF NOT EXISTS public.nuke_parlays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL,
  game_date date NOT NULL,
  script_tier text NOT NULL,
  template text NOT NULL,
  legs jsonb NOT NULL DEFAULT '[]'::jsonb,
  combined_odds_american integer NOT NULL,
  combined_odds_decimal numeric NOT NULL,
  posted_to_telegram boolean NOT NULL DEFAULT false,
  telegram_message_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nuke_parlays_unique UNIQUE (game_id, template, game_date)
);

CREATE INDEX IF NOT EXISTS idx_nuke_parlays_date
  ON public.nuke_parlays (game_date DESC);

CREATE TABLE IF NOT EXISTS public.nuke_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parlay_id uuid NOT NULL REFERENCES public.nuke_parlays(id) ON DELETE CASCADE,
  outcome text NOT NULL DEFAULT 'pending',
  legs_hit integer NOT NULL DEFAULT 0,
  legs_total integer NOT NULL DEFAULT 5,
  final_score_home integer,
  final_score_away integer,
  margin integer,
  was_blowout boolean,
  notes text,
  graded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nuke_results_parlay_unique UNIQUE (parlay_id)
);

CREATE TABLE IF NOT EXISTS public.nuke_run_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  game_date date NOT NULL,
  phase text NOT NULL,
  games_scanned integer NOT NULL DEFAULT 0,
  strong_count integer NOT NULL DEFAULT 0,
  medium_count integer NOT NULL DEFAULT 0,
  weak_count integer NOT NULL DEFAULT 0,
  parlays_built integer NOT NULL DEFAULT 0,
  parlays_posted integer NOT NULL DEFAULT 0,
  parlays_graded integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_nuke_run_log_recent
  ON public.nuke_run_log (run_at DESC);

ALTER TABLE public.nuke_game_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nuke_parlays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nuke_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nuke_run_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read nuke_game_scores"
  ON public.nuke_game_scores FOR SELECT USING (true);
CREATE POLICY "Service role writes nuke_game_scores"
  ON public.nuke_game_scores FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can read nuke_parlays"
  ON public.nuke_parlays FOR SELECT USING (true);
CREATE POLICY "Service role writes nuke_parlays"
  ON public.nuke_parlays FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can read nuke_results"
  ON public.nuke_results FOR SELECT USING (true);
CREATE POLICY "Service role writes nuke_results"
  ON public.nuke_results FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can read nuke_run_log"
  ON public.nuke_run_log FOR SELECT USING (true);
CREATE POLICY "Service role writes nuke_run_log"
  ON public.nuke_run_log FOR ALL USING (true) WITH CHECK (true);