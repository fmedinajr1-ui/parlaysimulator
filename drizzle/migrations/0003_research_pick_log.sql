CREATE TABLE public.research_pick_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_date date NOT NULL,
  player_name text NOT NULL,
  stat text NOT NULL,
  side text NOT NULL,
  line numeric NOT NULL,
  odds integer,
  projection numeric,
  win_prob numeric,
  ev numeric,
  opponent text,
  this_season integer,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  rank integer,
  model_version text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  result_value numeric,
  logged_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE (game_date, player_name, stat, side, model_version)
);
GRANT ALL ON public.research_pick_log TO service_role;
ALTER TABLE public.research_pick_log ENABLE ROW LEVEL SECURITY;