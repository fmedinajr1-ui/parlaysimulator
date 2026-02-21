
CREATE TABLE public.mlb_engine_picks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  line NUMERIC,
  side TEXT NOT NULL,
  confidence_score NUMERIC DEFAULT 0,
  signal_sources JSONB DEFAULT '{}',
  game_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_name, prop_type, game_date)
);

ALTER TABLE public.mlb_engine_picks ENABLE ROW LEVEL SECURITY;
