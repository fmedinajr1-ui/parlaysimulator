CREATE TABLE public.wnba_player_game_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  espn_event_id text NOT NULL,
  espn_athlete_id text,
  player_name text NOT NULL,
  team text,
  opponent_team text,
  game_date_et date NOT NULL,
  game_start_ts timestamptz,
  season int,
  season_type text,
  minutes numeric,
  points int,
  rebounds int,
  assists int,
  steals int,
  blocks int,
  turnovers int,
  threes_made int,
  threes_att int,
  fg_made int,
  fg_att int,
  ft_made int,
  ft_att int,
  did_not_play boolean DEFAULT false,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (espn_event_id, player_name)
);
CREATE INDEX idx_wnba_pgl_date ON public.wnba_player_game_logs(game_date_et);
CREATE INDEX idx_wnba_pgl_player ON public.wnba_player_game_logs(player_name);
CREATE INDEX idx_wnba_pgl_event ON public.wnba_player_game_logs(espn_event_id);
GRANT ALL ON public.wnba_player_game_logs TO service_role;
ALTER TABLE public.wnba_player_game_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access wnba_player_game_logs"
  ON public.wnba_player_game_logs FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TABLE public.wnba_historical_odds_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  espn_event_id text,
  game_start_ts timestamptz NOT NULL,
  game_date_et date NOT NULL,
  home_team text,
  away_team text,
  market text NOT NULL,
  player_name text,
  line numeric,
  side text NOT NULL,
  price int NOT NULL,
  snapshot_ts timestamptz NOT NULL,
  snapshot_tag text NOT NULL,
  bookmaker text NOT NULL DEFAULT 'fanduel',
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_wnba_odds_snap
  ON public.wnba_historical_odds_snapshots (
    event_id, market, COALESCE(player_name,''), COALESCE(line, -999999), side, snapshot_tag
  );
CREATE INDEX idx_wnba_odds_date ON public.wnba_historical_odds_snapshots(game_date_et);
CREATE INDEX idx_wnba_odds_event ON public.wnba_historical_odds_snapshots(event_id);
CREATE INDEX idx_wnba_odds_market ON public.wnba_historical_odds_snapshots(market);
CREATE INDEX idx_wnba_odds_player ON public.wnba_historical_odds_snapshots(player_name) WHERE player_name IS NOT NULL;
GRANT ALL ON public.wnba_historical_odds_snapshots TO service_role;
ALTER TABLE public.wnba_historical_odds_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access wnba_historical_odds_snapshots"
  ON public.wnba_historical_odds_snapshots FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');