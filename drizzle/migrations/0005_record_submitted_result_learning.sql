CREATE TABLE public.research_result_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_key text NOT NULL UNIQUE,
  game_date date NOT NULL,
  platform text NOT NULL DEFAULT 'PrizePicks',
  entry_type text NOT NULL,
  pick_count integer NOT NULL CHECK (pick_count > 0),
  stake_amount numeric CHECK (stake_amount IS NULL OR stake_amount >= 0),
  stake_kind text NOT NULL CHECK (stake_kind IN ('cash', 'bonus')),
  potential_payout numeric NOT NULL CHECK (potential_payout >= 0),
  status text NOT NULL CHECK (status IN ('open', 'won', 'lost', 'void')),
  source text NOT NULL DEFAULT 'user_screenshot',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.research_result_entries TO service_role;
ALTER TABLE public.research_result_entries ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.research_result_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.research_result_entries(id) ON DELETE CASCADE,
  player_name text NOT NULL,
  game_date date NOT NULL,
  stat text NOT NULL CHECK (stat IN ('points', 'rebounds', 'assists', 'threes_made', 'pra')),
  side text NOT NULL CHECK (side IN ('over', 'under')),
  line numeric NOT NULL,
  actual_value numeric,
  status text NOT NULL CHECK (status IN ('open', 'won', 'lost', 'push', 'void')),
  l5_games integer NOT NULL CHECK (l5_games >= 0 AND l5_games <= 5),
  l5_hit_rate numeric CHECK (l5_hit_rate IS NULL OR (l5_hit_rate >= 0 AND l5_hit_rate <= 100)),
  l5_avg numeric,
  l5_median numeric,
  l10_games integer NOT NULL CHECK (l10_games >= 0 AND l10_games <= 10),
  l10_hit_rate numeric CHECK (l10_hit_rate IS NULL OR (l10_hit_rate >= 0 AND l10_hit_rate <= 100)),
  l10_avg numeric,
  l10_median numeric,
  pregame_values jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, player_name, stat)
);
GRANT ALL ON public.research_result_legs TO service_role;
ALTER TABLE public.research_result_legs ENABLE ROW LEVEL SECURITY;
CREATE INDEX research_result_legs_entry_idx ON public.research_result_legs(entry_id);
CREATE INDEX research_result_legs_learning_idx ON public.research_result_legs(game_date, player_name, stat);