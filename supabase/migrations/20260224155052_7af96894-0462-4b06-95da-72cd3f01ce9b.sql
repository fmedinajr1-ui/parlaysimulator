
ALTER TABLE team_defense_rankings
  ADD COLUMN IF NOT EXISTS opp_points_rank INTEGER,
  ADD COLUMN IF NOT EXISTS opp_threes_rank INTEGER;
