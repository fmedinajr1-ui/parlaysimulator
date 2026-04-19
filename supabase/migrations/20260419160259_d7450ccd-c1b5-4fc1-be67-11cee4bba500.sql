-- 1. Bankroll state table (singleton)
CREATE TABLE IF NOT EXISTS public.bot_bankroll_state (
  id INT PRIMARY KEY CHECK (id = 1),
  current_bankroll NUMERIC NOT NULL DEFAULT 5000,
  starting_bankroll NUMERIC NOT NULL DEFAULT 5000,
  peak_bankroll NUMERIC NOT NULL DEFAULT 5000,
  daily_max_exposure_pct NUMERIC NOT NULL DEFAULT 20,
  current_form TEXT NOT NULL DEFAULT 'neutral' CHECK (current_form IN ('hot','neutral','cold','ice_cold')),
  form_streak INT NOT NULL DEFAULT 0,
  last_7d_pnl NUMERIC NOT NULL DEFAULT 0,
  last_7d_win_rate NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_bankroll_state ENABLE ROW LEVEL SECURITY;

-- Service role only — no public policies (deny by default)
CREATE POLICY "service role full access bankroll state"
  ON public.bot_bankroll_state
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Seed singleton row
INSERT INTO public.bot_bankroll_state (id, current_bankroll, starting_bankroll, peak_bankroll)
VALUES (1, 5000, 5000, 5000)
ON CONFLICT (id) DO NOTHING;

-- 2. Add curation columns to bot_daily_picks
ALTER TABLE public.bot_daily_picks
  ADD COLUMN IF NOT EXISTS stake_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS stake_tier TEXT,
  ADD COLUMN IF NOT EXISTS bankroll_reason TEXT,
  ADD COLUMN IF NOT EXISTS pass_reason TEXT,
  ADD COLUMN IF NOT EXISTS line_at_generation NUMERIC,
  ADD COLUMN IF NOT EXISTS curated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bot_daily_picks_status_date
  ON public.bot_daily_picks(pick_date, status);

CREATE INDEX IF NOT EXISTS idx_bot_daily_picks_stake_tier
  ON public.bot_daily_picks(pick_date, stake_tier)
  WHERE stake_tier IS NOT NULL;