CREATE TABLE IF NOT EXISTS public.correct_priced_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name text NOT NULL,
  prop_type text NOT NULL,
  book_line numeric NOT NULL,
  player_avg_l10 numeric,
  player_avg_l20 numeric,
  edge_pct numeric,
  signal text CHECK (signal IN ('OVER', 'UNDER')),
  shooting_context jsonb,
  confidence_tier text,
  analysis_date date NOT NULL DEFAULT CURRENT_DATE,
  sport text DEFAULT 'basketball_nba',
  defense_adjusted_avg numeric,
  opponent_defense_rank integer,
  team_total_signal text,
  team_total_alignment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_name, prop_type, analysis_date, sport)
);

ALTER TABLE public.correct_priced_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read correct priced lines"
  ON public.correct_priced_lines FOR SELECT USING (true);

CREATE POLICY "Service role can manage correct priced lines"
  ON public.correct_priced_lines FOR ALL USING (true) WITH CHECK (true);