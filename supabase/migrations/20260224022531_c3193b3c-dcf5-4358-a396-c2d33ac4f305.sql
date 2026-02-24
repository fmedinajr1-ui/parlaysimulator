
-- Player-level performance tracking (updated by settlement pipeline)
CREATE TABLE public.bot_player_performance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  side TEXT NOT NULL DEFAULT 'over',
  legs_played INT NOT NULL DEFAULT 0,
  legs_won INT NOT NULL DEFAULT 0,
  hit_rate NUMERIC NOT NULL DEFAULT 0,
  avg_edge NUMERIC DEFAULT 0,
  streak INT DEFAULT 0,
  last_updated DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(player_name, prop_type, side)
);

-- Prop-type-level performance tracking (automated gating)
CREATE TABLE public.bot_prop_type_performance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prop_type TEXT NOT NULL UNIQUE,
  total_legs INT NOT NULL DEFAULT 0,
  legs_won INT NOT NULL DEFAULT 0,
  hit_rate NUMERIC NOT NULL DEFAULT 0,
  is_blocked BOOLEAN NOT NULL DEFAULT false,
  is_boosted BOOLEAN NOT NULL DEFAULT false,
  boost_multiplier NUMERIC DEFAULT 1.0,
  last_updated DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick lookups during generation
CREATE INDEX idx_bot_player_perf_lookup ON public.bot_player_performance(player_name, prop_type);
CREATE INDEX idx_bot_prop_type_perf_blocked ON public.bot_prop_type_performance(is_blocked);
