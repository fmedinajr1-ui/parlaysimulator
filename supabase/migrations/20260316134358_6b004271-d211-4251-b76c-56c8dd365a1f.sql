
CREATE TABLE public.hedge_telegram_tracker (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_id UUID,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  line NUMERIC NOT NULL,
  side TEXT NOT NULL DEFAULT 'over',
  last_status_sent TEXT,
  last_quarter_sent INT DEFAULT 0,
  pregame_sent BOOLEAN DEFAULT false,
  analysis_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_name, prop_type, analysis_date)
);

ALTER TABLE public.hedge_telegram_tracker ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on hedge_telegram_tracker"
  ON public.hedge_telegram_tracker
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
