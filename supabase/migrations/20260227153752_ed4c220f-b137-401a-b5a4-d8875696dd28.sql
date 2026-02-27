
ALTER TABLE public.team_defense_rankings 
  ADD COLUMN IF NOT EXISTS off_points_rank INTEGER,
  ADD COLUMN IF NOT EXISTS off_rebounds_rank INTEGER,
  ADD COLUMN IF NOT EXISTS off_assists_rank INTEGER,
  ADD COLUMN IF NOT EXISTS off_threes_rank INTEGER,
  ADD COLUMN IF NOT EXISTS off_pace_rank INTEGER;

COMMENT ON COLUMN public.team_defense_rankings.off_points_rank IS 'Offensive points rank 1-30 (1=highest scoring)';
COMMENT ON COLUMN public.team_defense_rankings.off_rebounds_rank IS 'Offensive rebounds rank 1-30 (1=most rebounds)';
COMMENT ON COLUMN public.team_defense_rankings.off_assists_rank IS 'Offensive assists rank 1-30 (1=most assists)';
COMMENT ON COLUMN public.team_defense_rankings.off_threes_rank IS 'Offensive threes rank 1-30 (1=most threes)';
COMMENT ON COLUMN public.team_defense_rankings.off_pace_rank IS 'Offensive pace rank 1-30 (1=fastest pace)';
