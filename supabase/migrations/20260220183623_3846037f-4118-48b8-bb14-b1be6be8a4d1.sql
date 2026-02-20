
-- Phase 1: Add missing stat columns to nba_player_game_logs
ALTER TABLE public.nba_player_game_logs
  ADD COLUMN IF NOT EXISTS field_goals_made integer,
  ADD COLUMN IF NOT EXISTS free_throws_made integer,
  ADD COLUMN IF NOT EXISTS free_throws_attempted integer,
  ADD COLUMN IF NOT EXISTS offensive_rebounds integer,
  ADD COLUMN IF NOT EXISTS defensive_rebounds integer,
  ADD COLUMN IF NOT EXISTS min text;

-- Phase 3: Create mispriced_lines table
CREATE TABLE IF NOT EXISTS public.mispriced_lines (
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
  game_date date,
  opponent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add unique constraint for daily dedup
ALTER TABLE public.mispriced_lines
  ADD CONSTRAINT mispriced_lines_player_prop_date_unique
  UNIQUE (player_name, prop_type, analysis_date);

-- Enable RLS
ALTER TABLE public.mispriced_lines ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Anyone can read mispriced lines"
  ON public.mispriced_lines FOR SELECT
  USING (true);

-- Service role write (edge functions)
CREATE POLICY "Service role can manage mispriced lines"
  ON public.mispriced_lines FOR ALL
  USING (true)
  WITH CHECK (true);
