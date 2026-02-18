
-- Create bot_stake_config table
CREATE TABLE public.bot_stake_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_stake numeric NOT NULL DEFAULT 300,
  validation_stake numeric NOT NULL DEFAULT 150,
  exploration_stake numeric NOT NULL DEFAULT 50,
  bankroll_doubler_stake numeric NOT NULL DEFAULT 25,
  max_daily_parlays_execution int DEFAULT 5,
  max_daily_parlays_validation int DEFAULT 8,
  max_daily_parlays_exploration int DEFAULT 10,
  block_two_leg_parlays boolean DEFAULT true,
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.bot_stake_config ENABLE ROW LEVEL SECURITY;

-- Admins can read and write
CREATE POLICY "Admins can read bot_stake_config"
  ON public.bot_stake_config
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can update bot_stake_config"
  ON public.bot_stake_config
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can insert bot_stake_config"
  ON public.bot_stake_config
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Seed default row
INSERT INTO public.bot_stake_config (
  execution_stake, validation_stake, exploration_stake, bankroll_doubler_stake,
  max_daily_parlays_execution, max_daily_parlays_validation, max_daily_parlays_exploration,
  block_two_leg_parlays
) VALUES (300, 150, 50, 25, 5, 8, 10, true);

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION public.update_bot_stake_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_bot_stake_config_updated_at
  BEFORE UPDATE ON public.bot_stake_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_bot_stake_config_timestamp();
