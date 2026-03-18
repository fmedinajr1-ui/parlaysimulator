CREATE TABLE public.bot_daily_pick_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_date date NOT NULL,
  player_name text NOT NULL,
  prop_type text,
  recommended_side text,
  recommended_line numeric,
  l10_hit_rate numeric,
  l10_avg numeric,
  l3_avg numeric,
  confidence_score numeric,
  composite_score numeric,
  projected_value numeric,
  historical_over_rate numeric,
  historical_under_rate numeric,
  historical_samples integer DEFAULT 0,
  rejection_reason text,
  was_used_in_parlay boolean DEFAULT false,
  category text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_bot_daily_pick_pool_date ON public.bot_daily_pick_pool(pick_date);
CREATE INDEX idx_bot_daily_pick_pool_player ON public.bot_daily_pick_pool(player_name, prop_type);

ALTER TABLE public.bot_daily_pick_pool ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access to pick pool" ON public.bot_daily_pick_pool FOR SELECT USING (true);