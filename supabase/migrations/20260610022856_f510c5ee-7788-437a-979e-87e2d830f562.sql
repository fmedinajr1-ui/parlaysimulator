-- live_game_state: one row per live game, updated by background sync
CREATE TABLE public.live_game_state (
  game_id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  league TEXT,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_score INTEGER NOT NULL DEFAULT 0,
  away_score INTEGER NOT NULL DEFAULT 0,
  period TEXT,
  clock TEXT,
  possession TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  situation JSONB NOT NULL DEFAULT '{}'::jsonb,
  commence_time TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.live_game_state TO anon, authenticated;
GRANT ALL ON public.live_game_state TO service_role;

ALTER TABLE public.live_game_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "live_game_state_read_all"
  ON public.live_game_state FOR SELECT
  USING (true);

CREATE INDEX live_game_state_status_idx ON public.live_game_state (status);
CREATE INDEX live_game_state_sport_idx ON public.live_game_state (sport);

ALTER PUBLICATION supabase_realtime ADD TABLE public.live_game_state;
ALTER TABLE public.live_game_state REPLICA IDENTITY FULL;

-- live_prop_quotes: per-book player prop snapshot for live multi-book comparison
CREATE TABLE public.live_prop_quotes (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  line NUMERIC,
  bookmaker TEXT NOT NULL,
  over_price INTEGER,
  under_price INTEGER,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, player_name, prop_type, line, bookmaker)
);

GRANT SELECT ON public.live_prop_quotes TO anon, authenticated;
GRANT ALL ON public.live_prop_quotes TO service_role;

ALTER TABLE public.live_prop_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "live_prop_quotes_read_all"
  ON public.live_prop_quotes FOR SELECT
  USING (true);

CREATE INDEX live_prop_quotes_event_idx ON public.live_prop_quotes (event_id);
CREATE INDEX live_prop_quotes_fetched_idx ON public.live_prop_quotes (fetched_at DESC);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER live_game_state_touch
  BEFORE UPDATE ON public.live_game_state
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();