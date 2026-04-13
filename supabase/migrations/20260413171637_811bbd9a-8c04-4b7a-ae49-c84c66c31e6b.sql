
CREATE TABLE public.line_sum_mismatch_analysis (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL,
  game_description TEXT NOT NULL,
  event_id TEXT,
  team_name TEXT NOT NULL,
  opponent_name TEXT,
  stat_category TEXT NOT NULL,
  summed_player_lines NUMERIC,
  players_counted INTEGER DEFAULT 0,
  opponent_defensive_allowed NUMERIC,
  opponent_defensive_rank INTEGER,
  gap NUMERIC,
  gap_pct NUMERIC,
  direction_signal TEXT,
  analysis_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint for upserts
ALTER TABLE public.line_sum_mismatch_analysis
  ADD CONSTRAINT uq_line_sum_mismatch
  UNIQUE (sport, game_description, team_name, stat_category, analysis_date);

-- Index for querying by date and gap
CREATE INDEX idx_line_sum_mismatch_date_gap ON public.line_sum_mismatch_analysis (analysis_date, gap_pct DESC NULLS LAST);
