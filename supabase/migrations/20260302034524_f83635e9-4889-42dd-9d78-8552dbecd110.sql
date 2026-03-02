CREATE TABLE public.bot_lottery_tier_performance (
  tier TEXT PRIMARY KEY,
  total_tickets INT NOT NULL DEFAULT 0,
  total_won INT NOT NULL DEFAULT 0,
  total_lost INT NOT NULL DEFAULT 0,
  win_rate NUMERIC NOT NULL DEFAULT 0,
  avg_odds NUMERIC NOT NULL DEFAULT 0,
  avg_payout NUMERIC NOT NULL DEFAULT 0,
  total_profit NUMERIC NOT NULL DEFAULT 0,
  streak INT NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_lottery_tier_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access on bot_lottery_tier_performance"
  ON public.bot_lottery_tier_performance
  FOR ALL
  USING (true)
  WITH CHECK (true);