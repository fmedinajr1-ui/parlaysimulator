-- Create user_bankroll table for Kelly-based risk management
CREATE TABLE public.user_bankroll (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  bankroll_amount DECIMAL DEFAULT 1000,
  default_unit_size DECIMAL DEFAULT 0.02,
  kelly_multiplier DECIMAL DEFAULT 0.5,
  max_bet_percent DECIMAL DEFAULT 0.05,
  current_win_streak INT DEFAULT 0,
  current_loss_streak INT DEFAULT 0,
  peak_bankroll DECIMAL DEFAULT 1000,
  total_bets INT DEFAULT 0,
  total_won INT DEFAULT 0,
  total_lost INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.user_bankroll ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own bankroll"
ON public.user_bankroll FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own bankroll"
ON public.user_bankroll FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own bankroll"
ON public.user_bankroll FOR UPDATE
USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_user_bankroll_updated_at
BEFORE UPDATE ON public.user_bankroll
FOR EACH ROW
EXECUTE FUNCTION public.update_god_mode_updated_at();