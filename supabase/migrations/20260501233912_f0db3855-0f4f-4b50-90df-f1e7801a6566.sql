ALTER TABLE public.mlb_no_hr_team_analysis
  ADD COLUMN IF NOT EXISTS broadcast_sent_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_no_hr_broadcast_sent
  ON public.mlb_no_hr_team_analysis (game_date, broadcast_sent_at);