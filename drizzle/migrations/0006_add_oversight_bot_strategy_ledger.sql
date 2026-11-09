CREATE TABLE public.research_bot_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_date date NOT NULL,
  player_name text NOT NULL,
  stat text NOT NULL,
  side text NOT NULL,
  line numeric NOT NULL,
  odds integer NOT NULL,
  projection numeric,
  win_prob numeric,
  ev numeric,
  opponent text,
  model_version text NOT NULL,
  strategy_version text NOT NULL,
  rank integer NOT NULL,
  warning_count integer NOT NULL,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_score integer NOT NULL,
  stake_units numeric NOT NULL,
  status text NOT NULL DEFAULT 'open',
  result_value numeric,
  logged_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CONSTRAINT research_bot_picks_side_check CHECK (side IN ('over', 'under')),
  CONSTRAINT research_bot_picks_status_check CHECK (status IN ('open', 'won', 'lost', 'push', 'void')),
  CONSTRAINT research_bot_picks_stake_check CHECK (stake_units > 0 AND stake_units <= 1.5),
  CONSTRAINT research_bot_picks_risk_check CHECK (risk_score >= 0 AND risk_score <= 100)
);
CREATE UNIQUE INDEX research_bot_picks_unique_pick ON public.research_bot_picks (game_date, player_name, stat, side, strategy_version);
GRANT ALL ON public.research_bot_picks TO service_role;
ALTER TABLE public.research_bot_picks ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.research_bot_picks IS 'Private passcode-only Oversight Bot simulated positions; no public policies and no real-money wagers.';