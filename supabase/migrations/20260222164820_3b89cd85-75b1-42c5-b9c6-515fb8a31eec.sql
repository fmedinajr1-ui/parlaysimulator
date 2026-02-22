
CREATE TABLE public.recurring_winners (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_date DATE NOT NULL,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  recommended_side TEXT NOT NULL,
  yesterday_line NUMERIC,
  yesterday_actual NUMERIC,
  today_line NUMERIC,
  today_l10_hit_rate NUMERIC,
  today_l10_avg NUMERIC,
  streak_days INTEGER NOT NULL DEFAULT 2,
  composite_score NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (analysis_date, player_name, prop_type)
);

ALTER TABLE public.recurring_winners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access" ON public.recurring_winners
  FOR SELECT USING (true);

CREATE POLICY "Allow service role full access" ON public.recurring_winners
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_recurring_winners_date ON public.recurring_winners (analysis_date);
CREATE INDEX idx_recurring_winners_composite ON public.recurring_winners (analysis_date, composite_score DESC);
