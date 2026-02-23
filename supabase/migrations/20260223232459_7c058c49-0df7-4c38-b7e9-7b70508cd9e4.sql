ALTER TABLE team_defense_rankings 
  ADD COLUMN IF NOT EXISTS opp_rebounds_allowed_pg NUMERIC,
  ADD COLUMN IF NOT EXISTS opp_assists_allowed_pg NUMERIC,
  ADD COLUMN IF NOT EXISTS opp_rebounds_rank INTEGER,
  ADD COLUMN IF NOT EXISTS opp_assists_rank INTEGER;