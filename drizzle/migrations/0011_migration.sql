CREATE TABLE public.research_sim_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_date date NOT NULL,
  player_name text NOT NULL,
  stat text NOT NULL,
  line numeric NOT NULL,
  side text NOT NULL,
  odds integer,
  projection numeric,
  model_win_prob numeric,
  sim_side_prob numeric NOT NULL,
  sim_p10 numeric, sim_p50 numeric, sim_p90 numeric,
  qualifies boolean NOT NULL DEFAULT false,
  model_version text NOT NULL,
  sim_version text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  result_value numeric,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_date, player_name, stat, sim_version)
);
GRANT ALL ON public.research_sim_log TO service_role;
ALTER TABLE public.research_sim_log ENABLE ROW LEVEL SECURITY;