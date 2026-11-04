CREATE TABLE public.research_real_bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name text NOT NULL,
  stat text NOT NULL,
  side text NOT NULL,
  line numeric NOT NULL,
  odds integer NOT NULL,
  stake numeric NOT NULL,
  book text,
  game_date date NOT NULL,
  placed_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open',
  result_value numeric,
  settled_at timestamptz
);
GRANT ALL ON public.research_real_bets TO service_role;
ALTER TABLE public.research_real_bets ENABLE ROW LEVEL SECURITY;
CREATE INDEX research_real_bets_open_idx ON public.research_real_bets (status, game_date);