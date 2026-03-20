
CREATE TABLE public.bot_weak_leg_tracker (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name text NOT NULL,
  prop_type text NOT NULL,
  side text NOT NULL,
  miss_count integer DEFAULT 1,
  last_miss_date date,
  context jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.bot_weak_leg_tracker ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_weak_legs" ON public.bot_weak_leg_tracker FOR SELECT USING (true);
CREATE INDEX idx_weak_leg_player ON public.bot_weak_leg_tracker (player_name, prop_type, side);

CREATE TABLE public.bot_straight_bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_date date NOT NULL DEFAULT CURRENT_DATE,
  player_name text NOT NULL,
  prop_type text NOT NULL,
  line numeric NOT NULL,
  side text NOT NULL,
  l10_hit_rate numeric,
  composite_score numeric,
  simulated_stake numeric DEFAULT 50,
  simulated_payout numeric,
  american_odds integer,
  outcome text DEFAULT 'pending',
  profit_loss numeric DEFAULT 0,
  settled_at timestamptz,
  source text DEFAULT 'sweet_spot',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.bot_straight_bets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_straight_bets" ON public.bot_straight_bets FOR SELECT USING (true);
CREATE INDEX idx_straight_bets_date ON public.bot_straight_bets (bet_date, outcome);
