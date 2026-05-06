
CREATE TABLE public.nuke_historical_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport text NOT NULL,
  game_date date NOT NULL,
  external_id text,
  home text NOT NULL,
  away text NOT NULL,
  spread numeric,
  ml_home integer,
  ml_away integer,
  total numeric,
  closing_snapshot_ts timestamptz,
  actual_home_score integer,
  actual_away_score integer,
  settled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sport, game_date, home, away)
);
CREATE INDEX idx_nuke_hist_games_date ON public.nuke_historical_games(sport, game_date);

CREATE TABLE public.nuke_historical_props (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.nuke_historical_games(id) ON DELETE CASCADE,
  player text NOT NULL,
  prop_type text NOT NULL,
  side text NOT NULL,
  line numeric NOT NULL,
  price integer NOT NULL,
  book text NOT NULL DEFAULT 'fanduel',
  snapshot_ts timestamptz,
  actual_value numeric,
  result text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_nuke_hist_props_game ON public.nuke_historical_props(game_id);
CREATE INDEX idx_nuke_hist_props_player ON public.nuke_historical_props(player);

CREATE TABLE public.nuke_backtest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_name text NOT NULL,
  window_start date NOT NULL,
  window_end date NOT NULL,
  sports text[] NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.nuke_backtest_parlays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.nuke_backtest_runs(id) ON DELETE CASCADE,
  parlay_date date NOT NULL,
  sport text NOT NULL,
  game_ref text,
  tier text NOT NULL,
  template text NOT NULL,
  legs jsonb NOT NULL,
  combined_odds integer,
  in_window boolean NOT NULL DEFAULT false,
  outcome text NOT NULL DEFAULT 'pending',
  profit_units numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_nuke_bt_parlays_run ON public.nuke_backtest_parlays(run_id);
CREATE INDEX idx_nuke_bt_parlays_tier ON public.nuke_backtest_parlays(sport, tier);

ALTER TABLE public.nuke_historical_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nuke_historical_props ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nuke_backtest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nuke_backtest_parlays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read hist games" ON public.nuke_historical_games
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins read hist props" ON public.nuke_historical_props
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins read bt runs" ON public.nuke_backtest_runs
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins read bt parlays" ON public.nuke_backtest_parlays
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
