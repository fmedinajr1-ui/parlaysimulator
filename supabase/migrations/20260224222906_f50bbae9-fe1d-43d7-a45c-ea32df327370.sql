
ALTER TABLE public.bot_stake_config
  ADD COLUMN IF NOT EXISTS streak_multiplier numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS baseline_execution_stake numeric NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS baseline_validation_stake numeric NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS baseline_exploration_stake numeric NOT NULL DEFAULT 75,
  ADD COLUMN IF NOT EXISTS baseline_bankroll_doubler_stake numeric NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS last_streak_date date;

-- Populate baseline values from current stakes
UPDATE public.bot_stake_config
SET
  baseline_execution_stake = execution_stake,
  baseline_validation_stake = validation_stake,
  baseline_exploration_stake = exploration_stake,
  baseline_bankroll_doubler_stake = bankroll_doubler_stake;
