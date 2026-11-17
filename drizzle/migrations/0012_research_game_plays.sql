CREATE TABLE public.research_game_plays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_date date NOT NULL,
  home text NOT NULL,
  away text NOT NULL,
  start_time timestamptz,
  method text NOT NULL,
  market text NOT NULL,
  pick text NOT NULL,
  odds integer NOT NULL,
  book text,
  chance numeric,
  reason text,
  status text NOT NULL DEFAULT 'open',
  home_score integer,
  away_score integer,
  profit_units numeric,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_date, home, away, method, market)
);
GRANT ALL ON public.research_game_plays TO service_role;
ALTER TABLE public.research_game_plays ENABLE ROW LEVEL SECURITY;