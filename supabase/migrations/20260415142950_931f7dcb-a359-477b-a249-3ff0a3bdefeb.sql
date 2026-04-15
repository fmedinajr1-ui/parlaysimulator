
CREATE TABLE public.straight_bet_tracker (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bet_date DATE NOT NULL DEFAULT CURRENT_DATE,
  signal_type TEXT NOT NULL,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  side TEXT NOT NULL,
  line NUMERIC NOT NULL,
  stake NUMERIC NOT NULL DEFAULT 0,
  odds_american INTEGER DEFAULT -130,
  outcome TEXT DEFAULT 'pending',
  profit_loss NUMERIC DEFAULT 0,
  bankroll_before NUMERIC DEFAULT 0,
  bankroll_after NUMERIC DEFAULT 0,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_straight_bet_tracker_date ON public.straight_bet_tracker (bet_date);
CREATE INDEX idx_straight_bet_tracker_outcome ON public.straight_bet_tracker (outcome);

-- Bankroll state table (singleton per user/day)
CREATE TABLE public.straight_bet_bankroll (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bankroll_date DATE NOT NULL DEFAULT CURRENT_DATE,
  starting_bankroll NUMERIC NOT NULL DEFAULT 100,
  current_bankroll NUMERIC NOT NULL DEFAULT 100,
  total_bets INTEGER DEFAULT 0,
  total_wins INTEGER DEFAULT 0,
  total_losses INTEGER DEFAULT 0,
  daily_pnl NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(bankroll_date)
);

-- Seed initial bankroll
INSERT INTO public.straight_bet_bankroll (bankroll_date, starting_bankroll, current_bankroll)
VALUES (CURRENT_DATE, 100, 100);
